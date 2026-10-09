import { describe, expect, it } from 'vitest';
import { applyAction, legalActions, newHand, type Action, type HandConfig } from '../hand';
import { clockwiseFromSB } from '../positions';
import {
  CLASS_COMBOS, NUM_COMBOS, cellOf, classAt, classOfCombo, comboCount, comboIndex, formatRange, parseRange,
} from '../range';
import { makeRng } from '../rng';
import { CHARTS, classFrequencies, getStrategy, type SpotKind } from '../preflop/charts';
import { botAction, narrowPreflop } from '../preflop/policy';
import { generatePreflopScenario, runOpponents } from '../preflop/scenario';
import { spotFor } from '../preflop/spot';

const cfg: HandConfig = { tableSize: 6, sb: 25, bb: 50 };
const opts = { lowStakes: true };
const POS = clockwiseFromSB(6);

describe('preflop charts', () => {
  const all = (Object.keys(CHARTS) as SpotKind[]).flatMap((k) => Object.keys(CHARTS[k]).map((key) => [k, key] as const));

  it.each(all)('%s %s parses, round-trips, and never puts more than 100 percent on a hand', (kind, key) => {
    for (const aud of ['baseline', 'pool', 'hero'] as const) {
      const s = getStrategy(kind, key, aud, true);
      for (let i = 0; i < NUM_COMBOS; i++) {
        expect(s.raise[i]).toBeGreaterThanOrEqual(0);
        expect(s.call[i]).toBeGreaterThanOrEqual(0);
        expect(s.raise[i] + s.call[i]).toBeLessThanOrEqual(1 + 1e-6);
      }
    }
    const base = getStrategy(kind, key, 'baseline');
    for (const r of [base.raise, base.call]) {
      expect(Array.from(parseRange(formatRange(r)))).toEqual(Array.from(r));
    }
  });

  it('opens wider from later positions', () => {
    const pct = (p: string) => comboCount(getStrategy('rfi', p).raise) / NUM_COMBOS;
    expect(pct('UTG')).toBeLessThan(pct('HJ'));
    expect(pct('HJ')).toBeLessThan(pct('CO'));
    expect(pct('CO')).toBeLessThan(pct('BTN'));
    expect(pct('UTG')).toBeGreaterThan(0.13);
    expect(pct('BTN')).toBeLessThan(0.5);
  });

  it('covers every vs-open spot in a 6-max game', () => {
    const order = ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
    for (let o = 0; o < 5; o++) for (let h = o + 1; h < 6; h++) {
      expect(CHARTS.vsOpen[`${order[h]}_vs_${order[o]}`], `${order[h]} vs ${order[o]}`).toBeDefined();
    }
  });

  it('applies the low-stakes layer: fewer pool 4-bet bluffs, same value 4-bets', () => {
    const base = getStrategy('vs3bet', 'CO_vs_IP', 'baseline');
    const pool = getStrategy('vs3bet', 'CO_vs_IP', 'pool', true);
    const a5 = CLASS_COMBOS.get('A5s')![0];
    const kk = CLASS_COMBOS.get('KK')![0];
    expect(pool.raise[a5]).toBeLessThan(base.raise[a5]);
    expect(pool.raise[kk]).toBe(base.raise[kk]);
    expect(pool.notes.length).toBeGreaterThan(0);
    // Turning the layer off restores the baseline.
    expect(getStrategy('vs3bet', 'CO_vs_IP', 'pool', false).raise[a5]).toBe(base.raise[a5]);
  });
});

describe('spot classification', () => {
  const F: Action = { type: 'fold' }, C: Action = { type: 'call' };
  it('names the chart for each common spot', () => {
    let s = newHand({ config: cfg, stacks: Array(6).fill(5000), seed: 1 });
    expect(spotFor(s, 2)).toMatchObject({ kind: 'rfi', key: 'UTG' });
    s = applyAction(s, F); // UTG
    s = applyAction(s, { type: 'raise', to: 125 }); // HJ opens
    expect(spotFor(s, 4)).toMatchObject({ kind: 'vsOpen', key: 'CO_vs_HJ', inPosition: true });
    s = applyAction(s, C); // CO calls
    expect(spotFor(s, 5)).toMatchObject({ kind: 'squeeze', key: 'IP', callers: 1 });
    expect(spotFor(s, 1)).toMatchObject({ kind: 'squeeze', key: 'blinds' });
    s = applyAction(s, { type: 'raise', to: 500 }); // BTN squeezes
    s = applyAction(s, F); // SB
    s = applyAction(s, F); // BB
    expect(spotFor(s, 3)).toMatchObject({ kind: 'vs3bet', key: 'HJ_vs_IP', inPosition: false });
    expect(spotFor(s, 4)).toMatchObject({ kind: 'cold4bet' });
  });

  it('identifies a 3-bettor facing a 4-bet and who has position', () => {
    let s = newHand({ config: cfg, stacks: Array(6).fill(5000), seed: 1 });
    s = applyAction(s, F); s = applyAction(s, F);
    s = applyAction(s, { type: 'raise', to: 125 }); // CO
    s = applyAction(s, F); s = applyAction(s, F);
    s = applyAction(s, { type: 'raise', to: 500 }); // BB 3-bets
    s = applyAction(s, { type: 'raise', to: 1150 }); // CO 4-bets
    expect(spotFor(s, 1)).toMatchObject({ kind: 'vs4bet', key: 'OOP' });
  });
});

describe('range narrowing', () => {
  it('an open narrows to exactly the RFI chart', () => {
    let s = newHand({ config: cfg, stacks: Array(6).fill(5000), seed: 1 });
    s = applyAction(s, { type: 'fold' });
    s = applyAction(s, { type: 'fold' });
    s = applyAction(s, { type: 'raise', to: 125 }); // CO opens
    const { range } = narrowPreflop(POS, s.actions, 4, 'baseline', opts);
    expect(Array.from(range)).toEqual(Array.from(getStrategy('rfi', 'CO').raise));
  });

  it('keeps mixed hands at partial weight through two decisions', () => {
    let s = newHand({ config: cfg, stacks: Array(6).fill(5000), seed: 1 });
    s = applyAction(s, { type: 'fold' }); s = applyAction(s, { type: 'fold' });
    s = applyAction(s, { type: 'raise', to: 125 }); // CO
    s = applyAction(s, { type: 'fold' }); s = applyAction(s, { type: 'fold' });
    s = applyAction(s, { type: 'raise', to: 500 }); // BB 3-bets
    s = applyAction(s, { type: 'call' }); // CO calls
    const { range, steps } = narrowPreflop(POS, s.actions, 4, 'baseline', opts);
    expect(steps.map((x) => x.choice)).toEqual(['raise', 'call']);
    const cs = getStrategy('vs3bet', 'CO_vs_blinds');
    // AJo is opened at 100% and calls a 3-bet 25% of the time.
    const ajo = CLASS_COMBOS.get('AJo')![0];
    expect(range[ajo]).toBeCloseTo(cs.call[ajo], 6);
    expect(range[ajo]).toBeCloseTo(0.25, 6);
    // KK 4-bets, so it is gone after a call.
    expect(range[CLASS_COMBOS.get('KK')![0]]).toBe(0);
  });
});

describe('bots and scenarios', () => {
  it('bot actions are always legal and follow the chart', () => {
    const rng = makeRng(5);
    for (let h = 0; h < 300; h++) {
      let s = newHand({ config: cfg, stacks: Array(6).fill(5000), seed: h });
      let guard = 0;
      while (s.toAct !== null && s.street === 'preflop' && guard++ < 30) {
        const i = s.toAct;
        const spot = spotFor(s, i);
        const a = botAction(s, rng, opts);
        if (CHARTS[spot.kind][spot.key] && a.type === 'raise') {
          const st = getStrategy(spot.kind, spot.key, 'pool', true);
          const [x, y] = s.players[i].hole;
          expect(st.raise[comboIndex(x, y)]).toBeGreaterThan(0);
        }
        expect(() => applyAction(s, a)).not.toThrow();
        s = applyAction(s, a);
      }
    }
  });

  it('generates hands that stop at a hero decision with consistent opponent hands', () => {
    const rng = makeRng(99);
    const seen = new Set<string>();
    for (let n = 0; n < 200; n++) {
      const sc = generatePreflopScenario(rng, opts);
      seen.add(sc.spot);
      expect(sc.state.toAct).toBe(sc.hero);
      expect(sc.state.street).toBe('preflop');
      // Every opponent who raised holds a hand their chart raises.
      for (const a of sc.state.actions) {
        if (a.type !== 'raise' || a.player === sc.hero) continue;
        const pre = sc.state.actions.slice(0, sc.state.actions.indexOf(a));
        const { range } = narrowPreflop(POS, [...pre, a], a.player, 'pool', opts);
        const [x, y] = sc.state.players[a.player].hole;
        expect(range[comboIndex(x, y)]).toBeGreaterThan(0);
      }
      expect(legalActions(sc.state).fold || legalActions(sc.state).check).toBe(true);
      const after = runOpponents(sc.state, sc.hero, rng, opts);
      expect(after.toAct === sc.hero).toBe(true);
    }
    expect([...seen].sort()).toEqual(['rfi', 'squeeze', 'vs3bet', 'vs4bet', 'vsOpen']);
  });

  it('rarely deals clear folds (folds with no non-fold neighbor in the grid)', () => {
    const rng = makeRng(3);
    let clear = 0;
    const n = 300;
    for (let k = 0; k < n; k++) {
      const sc = generatePreflopScenario(rng, { ...opts, mix: { rfi: 1, vsOpen: 0, squeeze: 0, vs3bet: 0, vs4bet: 0 } });
      const strat = getStrategy('rfi', sc.state.players[sc.hero].position, 'hero');
      const folds = (cls: string) => classFrequencies(strat, cls).fold > 0.99;
      const [a, b] = sc.state.players[sc.hero].hole;
      const cls = classOfCombo(a, b);
      const [r, c] = cellOf(cls);
      const neighbors = [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]
        .filter(([x, y]) => x >= 0 && x < 13 && y >= 0 && y < 13)
        .map(([x, y]) => classAt(x, y));
      if (folds(cls) && neighbors.every(folds)) clear++;
    }
    expect(clear / n).toBeLessThan(0.1);
  });
});
