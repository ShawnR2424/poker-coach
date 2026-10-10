import { describe, expect, it } from 'vitest';
import { CHARTS, getStrategy, RAKE_RULES, type SpotKind, type Strategy } from '../preflop/charts';
import { chartStrategy, rakedOf } from '../preflop/policy';
import { parseCards } from '../cards';
import { applyAction, newHand, type Action, type HandState } from '../hand';
import { heroDecision, preflopFeedback } from '../preflop/coach';
import { comboCount, NUM_COMBOS, parseRange } from '../range';

const RAKE = { pct: 0.05, capBB: 3 };
const played = (s: Strategy) => (comboCount(s.raise) + comboCount(s.call)) / NUM_COMBOS;
const kinds = Object.keys(CHARTS) as SpotKind[];

describe('rake chart layer', () => {
  it('has well-formed rules that each reach a chart', () => {
    for (const r of RAKE_RULES) {
      expect(kinds).toContain(r.spot);
      expect(r.scale).toBeGreaterThan(0);
      expect(r.scale).toBeLessThanOrEqual(1);
      expect(comboCount(parseRange(r.hands))).toBeGreaterThan(0);
      expect(r.note.length).toBeGreaterThan(20);
      const keys = Object.keys(CHARTS[r.spot]);
      for (const k of r.keys ?? []) expect(keys.some((key) => (k.endsWith('*') ? key.startsWith(k.slice(0, -1)) : key === k))).toBe(true);
      // Each rule changes at least one chart.
      expect(keys.some((key) => getStrategy(r.spot, key, 'baseline', false, 100, true).notes.includes(r.note))).toBe(true);
    }
  });

  it('keeps every raked strategy a valid mix of raise, call and fold at every depth and audience', () => {
    for (const kind of kinds) {
      for (const key of Object.keys(CHARTS[kind])) {
        for (const depth of [40, 100, 200] as const) {
          for (const audience of ['baseline', 'pool', 'hero'] as const) {
            const s = getStrategy(kind, key, audience, true, depth, true);
            let bad = 0;
            for (let i = 0; i < NUM_COMBOS; i++) if (s.raise[i] < 0 || s.call[i] < 0 || s.raise[i] + s.call[i] > 1 + 1e-6) bad++;
            expect(bad, `${kind} ${key} ${depth}bb ${audience}`).toBe(0);
          }
        }
      }
    }
  });

  it('only ever plays fewer hands, and leaves 3-bet, 4-bet and all-in charts alone', () => {
    for (const kind of kinds) {
      for (const key of Object.keys(CHARTS[kind])) {
        const off = getStrategy(kind, key, 'baseline', false, 100, false);
        const on = getStrategy(kind, key, 'baseline', false, 100, true);
        if (kind === 'vsOpen' && key.startsWith('BB_vs_')) expect(comboCount(on.raise)).toBeGreaterThanOrEqual(comboCount(off.raise));
        expect(played(on)).toBeLessThanOrEqual(played(off) + 1e-9);
        if (['vs3bet', 'vs4bet', 'squeeze', 'cold4bet', 'vsJam'].includes(kind)) {
          expect(on.raise).toEqual(off.raise);
          expect(on.call).toEqual(off.call);
        }
      }
    }
  });

  it('tightens the big blind most and the early opens least', () => {
    const drop = (kind: SpotKind, key: string) => played(getStrategy(kind, key, 'baseline', false)) - played(getStrategy(kind, key, 'baseline', false, 100, true));
    expect(drop('vsOpen', 'BB_vs_BTN')).toBeGreaterThan(0.04);
    expect(drop('vsOpen', 'BB_vs_SB')).toBeGreaterThan(0.04);
    expect(drop('rfi', 'BTN')).toBeGreaterThan(0.01);
    expect(drop('rfi', 'UTG')).toBeLessThan(0.002);
    expect(drop('vsOpen', 'BB_vs_BTN')).toBeGreaterThan(drop('rfi', 'BTN'));
    expect(drop('vsOpen', 'BTN_vs_CO')).toBeGreaterThan(0);
  });

  it('applies from the table options, for everyone, and says why', () => {
    expect(rakedOf({ lowStakes: true })).toBe(false);
    expect(rakedOf({ lowStakes: true, rake: { pct: 0, capBB: 3 } })).toBe(false);
    expect(rakedOf({ lowStakes: true, rake: RAKE })).toBe(true);
    for (const audience of ['baseline', 'pool', 'hero'] as const) {
      const off = chartStrategy('vsOpen', 'BB_vs_BTN', audience, { lowStakes: true });
      const on = chartStrategy('vsOpen', 'BB_vs_BTN', audience, { lowStakes: true, rake: RAKE });
      expect(played(on)).toBeLessThan(played(off));
      expect(on.notes.some((n) => n.includes('rake'))).toBe(true);
      expect(off.notes.some((n) => n.includes('rake'))).toBe(false);
    }
  });

  it('tells the player when the rake changed what the chart does with their hand', () => {
    const bbVsBtn = (hand: string): HandState => {
      let st = newHand({ config: { tableSize: 6, sb: 25, bb: 50, rake: RAKE }, stacks: Array(6).fill(5000), hole: [null, parseCards(hand), null, null, null, null], seed: 4 });
      for (const a of [{ type: 'fold' }, { type: 'fold' }, { type: 'fold' }, { type: 'raise', to: 125 }, { type: 'fold' }] as Action[]) st = applyAction(st, a);
      return st;
    };
    const opts = { lowStakes: true, rake: RAKE };
    // K7o is a pure call in the BB against a button open without rake; the rake folds most of them.
    const d = heroDecision(bbVsBtn('Kc7d'), 1, opts);
    expect(d.freqs.fold).toBeCloseTo(0.6, 6);
    expect(d.rakeShift).toMatchObject({ choice: 'fold', from: 0, to: expect.closeTo(0.6, 6) });
    const fb = preflopFeedback(bbVsBtn('Kc7d'), 1, d, { type: 'fold' }, 0.4, null);
    expect(fb.grade.verdict).toBe('correct');
    expect(fb.bullets[1]).toMatch(/^The rake comes out of every pot.*With the rake on, the chart picks fold for this hand 60% of the time instead of 0%\.$/);
    // 99 3-bets more; aces are untouched; without a rake nothing is said.
    expect(heroDecision(bbVsBtn('9c9d'), 1, opts).rakeShift).toMatchObject({ choice: 'raise', from: 0, to: 0.25 });
    expect(heroDecision(bbVsBtn('AcAd'), 1, opts).rakeShift).toBeUndefined();
    expect(heroDecision(bbVsBtn('Kc7d'), 1, { lowStakes: true }).rakeShift).toBeUndefined();
  });
});
