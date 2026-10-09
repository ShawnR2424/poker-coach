import { describe, expect, it } from 'vitest';
import { parseCards } from '../cards';
import { categorizeRange, categoryTotals, preflopCategory } from '../categories';
import { classEquities } from '../classEquity';
import { applyAction, newHand, type Action, type HandConfig, type HandState } from '../hand';
import { CLASS_COMBOS, comboCount, formatRange, parseRange, removeDead } from '../range';
import { blockerCount, gradePreflop, heroDecision, opponentReads, preflopFeedback } from '../preflop/coach';

const cfg: HandConfig = { tableSize: 6, sb: 25, bb: 50 };
const opts = { lowStakes: true };

/** BB (seat 1) facing a BTN open with the given hand. */
function bbVsBtn(hand: string): HandState {
  const hole = [null, parseCards(hand), null, null, null, null];
  let s = newHand({ config: cfg, stacks: Array(6).fill(5000), hole, seed: 4 });
  for (const a of [{ type: 'fold' }, { type: 'fold' }, { type: 'fold' }, { type: 'raise', to: 125 }, { type: 'fold' }] as Action[]) {
    s = applyAction(s, a);
  }
  return s;
}

describe('grid categories', () => {
  it('every class in the range text gets exactly one category, and nothing else does', () => {
    const text = '22+, A2s+, K9s+, QTs+, JTs, ATo+, KJo+, 76s:0.5';
    const range = parseRange(text);
    const hero = parseCards('AhJh');
    const board: number[] = [];
    const eq = classEquities(hero, board, range, 300);
    const cells = categorizeRange(range, [...hero, ...board], eq, preflopCategory);
    const live = removeDead(range, hero);
    for (const c of cells) {
      const inRange = CLASS_COMBOS.get(c.cls)!.some((i) => live[i] > 0);
      expect(c.category !== null, c.cls).toBe(inRange);
    }
    // Category totals add up to the live combo count of the range text.
    const total = [...categoryTotals(cells).values()].reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(comboCount(live), 4);
    // The grid's classes rebuild the same range text.
    expect(formatRange(parseRange(text))).toBe(formatRange(range));
  });

  it('assigns the expected preflop buckets', () => {
    expect(preflopCategory(0.3)).toBe('dominates');
    expect(preflopCategory(0.5)).toBe('flip');
    expect(preflopCategory(0.7)).toBe('dominated');
    expect(preflopCategory(0.6)).toBe('rest');
    // AJ vs AK is dominated; AJ vs 22 is a flip; AJ vs J9s is dominated by AJ.
    const eq = classEquities(parseCards('AhJh'), [], parseRange('AKo, 22, J9s'), 3000);
    expect(preflopCategory(eq.get('AKo')!)).toBe('dominates');
    expect(preflopCategory(eq.get('22')!)).toBe('flip');
    expect(preflopCategory(eq.get('J9s')!)).toBe('dominated');
  });
});

describe('preflop grading', () => {
  it('grades a pure fold, a mixed hand, and a size mistake', () => {
    // 72o folds 100% in the BB vs a BTN open.
    let d = heroDecision(bbVsBtn('7c2d'), 1, opts);
    expect(gradePreflop(d, { type: 'fold' }, 50).verdict).toBe('correct');
    expect(gradePreflop(d, { type: 'call' }, 50)).toMatchObject({ verdict: 'mistake', heading: 'Mistake: call' });

    // KJs is a mixed 3-bet / call.
    d = heroDecision(bbVsBtn('KhJh'), 1, opts);
    expect(d.freqs.raise).toBeCloseTo(0.5, 6);
    expect(gradePreflop(d, { type: 'call' }, 50).verdict).toBe('correct');
    expect(gradePreflop(d, { type: 'raise', to: d.raiseTo! }, 50).verdict).toBe('correct');

    // AA 3-bets; a min-raise is the right idea at the wrong size.
    d = heroDecision(bbVsBtn('AcAd'), 1, opts);
    const g = gradePreflop(d, { type: 'raise', to: 250 }, 50);
    expect(g).toMatchObject({ verdict: 'playable', heading: 'Right idea, wrong size' });
    expect(g.tags).toContain('undersized preflop raise');
  });

  it('builds feedback from computed numbers only', () => {
    const s = bbVsBtn('Td8d');
    const d = heroDecision(s, 1, opts);
    const fb = preflopFeedback(s, 1, d, { type: 'call' }, 0.41, null);
    // Pot: SB 25 + BB 50 + BTN 125 = 200. Call 75 more: needs 75 / 275 = 27%.
    expect(fb.equity.needed).toBeCloseTo(75 / 275, 10);
    expect(fb.bullets.join(' ')).toContain('you need 27.3% equity');
    expect(fb.bullets.join(' ')).toContain('41%');
  });
});

describe('range reads', () => {
  it('describes the opener and keeps the RFI range', () => {
    const s = bbVsBtn('KhJh');
    const reads = opponentReads(s, 1, opts);
    expect(reads.map((r) => r.line)).toEqual(['BTN · opens 2.5bb']);
    expect(reads[0].change).toMatch(/keeps \d+% of the hands/);
  });

  it('counts blockers with card removal', () => {
    const range = parseRange('QQ+, AKs, AKo');
    const r = blockerCount(range, parseCards('As5s'), 6)!;
    expect(r.before).toBe(6 * 3 + 4 + 12);
    // AA loses 3 of 6, AKs loses 1 of 4, AKo loses 3 of 12.
    expect(r.after).toBe(3 + 6 + 6 + 3 + 9);
  });
});
