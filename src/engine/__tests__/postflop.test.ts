import { describe, expect, it } from 'vitest';
import { parseCards } from '../cards';
import { comboEquities, computeEquity } from '../equity';
import { callEv } from '../math';
import { COMBO_CARDS, NUM_COMBOS, comboIndex, parseRange, type Range } from '../range';
import { classifyHand, straightOuts } from '../postflop/classify';
import { comboCategory, categorizePostflop, POSTFLOP_ORDER } from '../postflop/categories';
import { narrowPostflop, responseFor } from '../postflop/model';
import { analyze, bestOf, gradePostflop, margins, situationFromState, type Analysis, type OptionRow, type PostflopSituation } from '../postflop/recommend';
import { buildSpot, POSTFLOP_SPOTS, type AnswerKind } from '../postflop/spots';
import type { Action } from '../hand';
import { pot } from '../hand';
import { narrowHand } from '../postflop/narrow';

const c = parseCards;
const cls = (hole: string, board: string) => classifyHand(c(hole), c(board));

describe('postflop hand classes', () => {
  it('sorts made hands on a dry flop', () => {
    const b = 'Ts7d3c';
    expect(cls('AhTh', b)).toBe('topPairGood');
    expect(cls('Th2h', b)).toBe('topPairWeak');
    expect(cls('7c7h', b)).toBe('setPlus');
    expect(cls('QcQh', b)).toBe('overpair');
    expect(cls('8h8d', b)).toBe('middlePair');
    expect(cls('2c2d', b)).toBe('weakPair');
    expect(cls('Tc7c', b)).toBe('twoPair');
    expect(cls('Ah7h', b)).toBe('middlePair');
  });

  it('sorts draws and air', () => {
    expect(cls('9c8c', 'Ts7d3c')).toBe('strongDraw'); // open-ender: 6 or J
    expect(cls('Jh9h', 'Kh8h4c2s')).toBe('strongDraw'); // flush draw
    expect(cls('AcKc', 'Ts7d3h')).toBe('weakDraw'); // two overcards
    expect(cls('9c6d', 'Ts7d3h')).toBe('weakDraw'); // gutshot to the 8
    expect(cls('5c4d', 'KsQd9h')).toBe('air');
    expect(straightOuts(c('9c8c'), c('Ts7d3c'))).toBe(2);
    expect(straightOuts(c('9c6d'), c('Ts7d3h'))).toBe(1);
  });

  it('a weak pair with a draw counts as the draw; no draws on the river', () => {
    expect(cls('4h3h', 'Kh8h4c')).toBe('strongDraw');
    expect(cls('9c8c', 'Ts7d3c2h5s')).toBe('air');
  });

  it('needs a hole card to make straights, flushes and trips count', () => {
    expect(cls('AhKd', '9c8d7h6s5c')).toBe('air'); // the board plays
    expect(cls('Th2d', '9c8d7h6s5c')).toBe('setPlus'); // T-high straight beats the board
    expect(cls('Kc7d', 'KsKh2c')).toBe('setPlus'); // trips
    expect(cls('7c2d', 'KsKh7h')).toBe('middlePair');
  });
});

/** Weighted range of all combos in `text`, minus dead cards. */
const R = (text: string): Range => parseRange(text);

describe('per-combo equity', () => {
  it('averages to the same equity as the range calculation', () => {
    for (const [hero, board] of [['AhTh', 'Ts7d3c2s'], ['KhQs', 'Qd9s4h2c7s']]) {
      const range = R('QQ+, AT+, KT+, 98s, 77, 33');
      const eqs = comboEquities(c(hero), c(board), range);
      let s = 0, w = 0;
      const dead = new Set(c(hero + board));
      for (let i = 0; i < NUM_COMBOS; i++) {
        const [a, b] = COMBO_CARDS[i];
        if (range[i] > 0 && !dead.has(a) && !dead.has(b)) { s += range[i] * eqs[i]; w += range[i]; }
        else expect(Number.isNaN(eqs[i])).toBe(true);
      }
      const total = computeEquity({ hero: c(hero), board: c(board), villains: [range] }).equity;
      expect(s / w).toBeCloseTo(total, 6);
    }
  });
});

describe('postflop grid categories', () => {
  it('puts each combo in exactly one category and totals match live combos', () => {
    const hero = c('AhTh'), board = c('Ts7d3c');
    const range = R('22+, A2s+, K9s+, QTs+, JTs, T9s, 98s, 87s, A9o+, KTo+, QTo+, JTo');
    const eqs = comboEquities(hero, board, range);
    const br = categorizePostflop(range, hero, board, eqs);
    const total = POSTFLOP_ORDER.reduce((a, k) => a + br.totals.get(k)!, 0);
    expect(total).toBeCloseTo(br.live, 6);
    const cellSum = br.cells.reduce((a, x) => a + x.combos, 0);
    expect(cellSum).toBeCloseTo(br.live, 6);
    // Card removal: AhTh and the Ts leave three AA combos... minus Ah: 3 combos of AA.
    expect(br.cells.find((x) => x.cls === 'AA')!.combos).toBe(3);
  });

  it('labels the obvious cases', () => {
    const hero = c('AhTh'), board = c('Ts7d3c');
    expect(comboCategory(hero, board, c('7c7h'), 0.05)).toBe('beats');
    expect(comboCategory(hero, board, c('9c8c'), 0.68)).toBe('draws');
    expect(comboCategory(hero, board, c('KdTd'), 0.88)).toBe('pays');
    expect(comboCategory(hero, board, c('5c4d'), 0.9)).toBe('missed');
    // On the river nothing is a draw any more.
    expect(comboCategory(hero, c('Ts7d3c2s5h'), c('Kc8c'), 1)).toBe('missed');
  });
});

describe('postflop narrowing', () => {
  it('never adds weight and drops strong hands when checking', () => {
    const range = R('22+, AT+, KT+, QT+, JT, 98s');
    const board = c('Ts7d3c');
    const checked = narrowPostflop(range, board, { kind: 'check' });
    for (let i = 0; i < NUM_COMBOS; i++) expect(checked[i]).toBeLessThanOrEqual(range[i] + 1e-9);
    const set = comboIndex(c('7c')[0], c('7h')[0]);
    const air = comboIndex(c('Qh')[0], c('Jh')[0]);
    expect(checked[set] / range[set]).toBeLessThan(checked[air] / range[air]);
  });

  it('calling a bigger bet keeps fewer weak hands', () => {
    const r = responseFor('weakPair', 0.33, true), r2 = responseFor('weakPair', 1, true);
    expect(r2.fold).toBeGreaterThan(r.fold);
    expect(r.fold + r.call + r.raise).toBeCloseTo(1, 9);
  });
});

function riverSituation(over: Partial<PostflopSituation>): PostflopSituation {
  return {
    hero: c('AhAd'),
    board: c('Ac7d3c2s9h'),
    street: 'river',
    pot: 1000,
    heroCommitted: 0,
    villainCommitted: 0,
    heroBehind: 4000,
    villainBehind: 4000,
    bb: 50,
    heroInPosition: true,
    villainRange: R('KK, QQ, 77, 33, 98s, KQs'),
    options: [
      { kind: 'check', label: 'Check' },
      { kind: 'bet', to: 330, label: '33% pot' },
      { kind: 'bet', to: 1000, label: '100% pot' },
      { kind: 'bet', to: 4000, label: 'All-in', allIn: true },
    ],
    heroInvested: 1000,
    heroPreflopAggressor: true,
    heroFirstToAct: false,
    ...over,
  };
}

describe('EV and verdicts', () => {
  it('bet EV matches the formula, combo by combo', () => {
    const sit = riverSituation({ villainRange: R('KQs') });
    const eqs = comboEquities(sit.hero, sit.board, sit.villainRange);
    const a = analyze(sit, eqs);
    const row = a.rows.find((r) => r.option.to === 1000)!;
    // KQs on this board is air: hero wins every showdown.
    const resp = responseFor('air', 1000 / 1000, true);
    // Villain raising is a shove; hero (with the nuts) calls it: final pot 1000 + 4000 + 4000.
    const expected = resp.fold * 1000 + resp.call * (1 * 3000 - 1000) + resp.raise * (9000 - 4000);
    expect(row.ev).toBeCloseTo(expected, 6);
    expect(row.breakEvenBluff).toBeCloseTo(1000 / 2000, 9);
    expect(row.callsShove).toBe(true);
  });

  it('call EV on the river equals equity × (pot + call) − call', () => {
    const sit = riverSituation({
      hero: c('KhQs'), board: c('Qd9s4h2c7s'), pot: 875, villainCommitted: 375, heroBehind: 4500, villainBehind: 4125,
      villainRange: R('QQ, 99, AQ, JTs, T8s, 65s'),
      options: [{ kind: 'fold', label: 'Fold' }, { kind: 'call', label: 'Call' }],
    });
    const eqs = comboEquities(sit.hero, sit.board, sit.villainRange);
    const a = analyze(sit, eqs);
    const call = a.rows.find((r) => r.option.kind === 'call')!;
    expect(call.ev).toBeCloseTo(callEv(375, 875, a.facts.equity), 6);
    expect(a.facts.potOdds).toBeCloseTo(375 / 1250, 9);
  });

  it('grades the best option correct and a big EV loss a mistake', () => {
    const sit = riverSituation({});
    const eqs = comboEquities(sit.hero, sit.board, sit.villainRange);
    const a = analyze(sit, eqs);
    expect(a.best.option.kind).toBe('bet');
    const best = gradePostflop(sit, a, { type: 'bet', to: a.best.option.to! });
    expect(best.verdict).toBe('correct');
    const check = gradePostflop(sit, a, { type: 'check' });
    expect(check.loss).toBeCloseTo(a.best.ev - a.rows[0].ev, 6);
    const m = margins(sit.pot, sit.bb);
    expect(check.verdict).toBe(check.loss <= m.correct ? 'correct' : check.loss <= m.playable ? 'playable' : 'mistake');
    expect(check.verdict).not.toBe('correct');
  });

  it('calls a worse size of the right action "right idea, wrong size"', () => {
    const sit = riverSituation({});
    const eqs = comboEquities(sit.hero, sit.board, sit.villainRange);
    const a = analyze(sit, eqs);
    const m = margins(sit.pot, sit.bb);
    const worse = a.rows.find((r) => r.option.kind === 'bet' && a.best.ev - r.ev > m.correct);
    expect(worse).toBeDefined();
    const g = gradePostflop(sit, a, { type: 'bet', to: worse!.option.to! });
    expect(g.heading).toBe('Right idea, wrong size');
  });

  it('folding the nuts is a mistake and tagged as overfolding', () => {
    const sit = riverSituation({ villainCommitted: 500, pot: 1500, options: [
      { kind: 'fold', label: 'Fold' }, { kind: 'call', label: 'Call' }, { kind: 'raise', to: 4000, label: 'All-in', allIn: true },
    ] });
    const a = analyze(sit, comboEquities(sit.hero, sit.board, sit.villainRange));
    const g = gradePostflop(sit, a, { type: 'fold' });
    expect(g.verdict).toBe('mistake');
    expect(g.tags).toContain('overfolding');
  });
});

describe('practice spots', () => {
  for (const def of POSTFLOP_SPOTS) {
    it(`${def.id} builds, balances chips and analyzes`, () => {
      const sp = buildSpot(def);
      const s = sp.state;
      expect(s.toAct).toBe(sp.hero);
      const chips = s.players.reduce((a, p) => a + p.stack, 0) + pot(s);
      expect(chips).toBe(6 * def.stacksBB * 50);
      const sit = situationFromState(s, sp.hero, sp.villain, sp.villainRange, { heroRange: sp.heroRange, heroPreflopAggressor: sp.heroPreflopAggressor });
      const a = analyze(sit, comboEquities(sit.hero, sit.board, sp.villainRange));
      expect(a.facts.equity).toBeGreaterThan(0);
      expect(a.facts.equity).toBeLessThan(1);
      expect(a.facts.liveCombos).toBeGreaterThan(1);
      for (const r of a.rows) if (r.fold !== undefined) expect(r.fold + r.call! + r.raise!).toBeCloseTo(1, 6);
    });

    it(`${def.id} grades the way its concept says`, () => {
      const sp = buildSpot(def);
      const sit = situationFromState(sp.state, sp.hero, sp.villain, sp.villainRange, { heroRange: sp.heroRange, heroPreflopAggressor: sp.heroPreflopAggressor });
      const a = analyze(sit, comboEquities(sit.hero, sit.board, sp.villainRange));
      const kindOf = (r: OptionRow): AnswerKind => (r.option.allIn ? 'allIn' : r.option.kind);
      expect(def.answer.best).toContain(kindOf(a.best));
      for (const r of a.rows) {
        const action = r.option.to !== undefined ? { type: r.option.kind, to: r.option.to } : { type: r.option.kind };
        const g = gradePostflop(sit, a, action as Action);
        const named = def.answer.mistakes.includes(kindOf(r)) || (!r.option.allIn && def.answer.mistakes.includes(r.option.kind));
        if (named) expect(g.verdict, `${def.id}: ${r.option.label}`).toBe('mistake');
      }
    });
  }
});

describe('overbet shoves', () => {
  it('a shove for many times the pot is at most playable, even when it scores highest', () => {
    const shove = { option: { kind: 'bet', to: 5000, label: 'All-in', allIn: true }, ev: 900, potShare: 15, fold: 0.95, call: 0.05, raise: 0 } as OptionRow;
    const bet = { option: { kind: 'bet', to: 200, label: '66% pot' }, ev: 600, potShare: 0.66, fold: 0.6, call: 0.4, raise: 0 } as OptionRow;
    const check = { option: { kind: 'check', label: 'Check' }, ev: 400 } as OptionRow;
    const rows = [check, bet, shove];
    const best = bestOf(rows);
    expect(best).toBe(bet);
    const a = { rows, best, facts: { equity: 0.5, potOdds: null, spr: 15, villainStrong: 0.1, heroStrong: null, heroClass: 'air', liveCombos: 100, realization: 0.9 } } as Analysis;
    const sit = { pot: 300, bb: 50, street: 'flop', heroInvested: 125, heroBehind: 4875, heroFirstToAct: true, heroInPosition: true, heroPreflopAggressor: true } as unknown as PostflopSituation;
    const g = gradePostflop(sit, a, { type: 'bet', to: 5000 });
    expect(g.verdict).toBe('playable');
    expect(g.sizeNote).toMatch(/one street at a time/);
    expect(g.acceptable).not.toContain(shove);
    expect(gradePostflop(sit, a, { type: 'bet', to: 200 }).verdict).toBe('correct');
  });

  it('a shove at a low stack-to-pot ratio can still be the best play', () => {
    const shove = { option: { kind: 'bet', to: 600, label: 'All-in', allIn: true }, ev: 900, potShare: 2 } as OptionRow;
    const bet = { option: { kind: 'bet', to: 200, label: '66% pot' }, ev: 600, potShare: 0.66 } as OptionRow;
    expect(bestOf([bet, shove])).toBe(shove);
  });
});

describe('narrowing through a whole hand', () => {
  it('a check into the preflop raiser keeps most strong hands', () => {
    const sp = buildSpot(POSTFLOP_SPOTS[0]);
    const { range, preflop, steps } = narrowHand(sp.state, sp.villain, 'pool', { lowStakes: false });
    expect(steps).toHaveLength(1);
    expect(steps[0].move).toMatchObject({ kind: 'check', intoAggressor: true });
    const set = comboIndex(c('7c')[0], c('7h')[0]);
    expect(range[set] / preflop[set]).toBeGreaterThan(0.8);
  });

  it('the river bettor was narrowed on every street they acted', () => {
    const sp = buildSpot(POSTFLOP_SPOTS[2]);
    const { steps } = narrowHand(sp.state, sp.villain, 'pool', { lowStakes: false });
    expect(steps.map((s) => `${s.street}:${s.move.kind}`)).toEqual(['flop:bet', 'turn:check', 'river:bet']);
  });
});
