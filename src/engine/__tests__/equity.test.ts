import { describe, expect, it } from 'vitest';
import { parseCards } from '../cards';
import { computeEquity } from '../equity';
import { evaluate } from '../evaluator';
import { COMBO_CARDS, NUM_COMBOS, parseRange, removeDead } from '../range';

const eq = (hero: string, board: string, villains: string[], opts: { iterations?: number; allowExact?: boolean } = {}) =>
  computeEquity({
    hero: parseCards(hero),
    board: parseCards(board),
    villains: villains.map(parseRange),
    seed: 7,
    iterations: opts.iterations ?? 60000,
    allowExact: opts.allowExact,
  });

describe('equity', () => {
  it('matches well-known preflop matchups', () => {
    // Published values: AA vs KK ~82%, AKo vs QQ ~43%, 22 vs AKo ~52%.
    expect(eq('AhAs', '', ['KK']).equity).toBeGreaterThan(0.81);
    expect(eq('AhAs', '', ['KK']).equity).toBeLessThan(0.835);
    expect(eq('AsKd', '', ['QhQc']).equity).toBeGreaterThan(0.415);
    expect(eq('AsKd', '', ['QhQc']).equity).toBeLessThan(0.445);
    expect(eq('2c2d', '', ['AKo']).equity).toBeGreaterThan(0.5);
    expect(eq('2c2d', '', ['AKo']).equity).toBeLessThan(0.54);
  });

  it('is exact and deterministic on the river', () => {
    // Hero has top two; villain range: one set (beats), one worse pair (loses), one chop.
    const r = eq('AhKh', '2c7dKcAd9s', ['7h7c, QsQd, AcKd']);
    expect(r.exact).toBe(true);
    // 7h7c beats hero, QsQd loses, AcKd chops: (0 + 1 + 0.5) / 3.
    expect(r.equity).toBeCloseTo(0.5, 6);
  });

  it('exact flop enumeration agrees with Monte Carlo', () => {
    const range = 'TT+, AQs+, AQo+, KQs, JTs, 98s';
    const exact = eq('QsQd', 'Ah7c2d', [range]);
    const mc = eq('QsQd', 'Ah7c2d', [range], { allowExact: false, iterations: 80000 });
    expect(exact.exact).toBe(true);
    expect(Math.abs(exact.equity - mc.equity)).toBeLessThan(4 * mc.stderr + 0.002);
  });

  it('respects range weights', () => {
    // Half-weighting the losing combo moves equity exactly as the weighted average predicts.
    const r = eq('AhKh', '2c7dKcAd9s', ['7h7c, QsQd:0.5']);
    // weights 1 (lose) and 0.5 (win): equity = 0.5 / 1.5.
    expect(r.equity).toBeCloseTo(1 / 3, 6);
  });

  it('multiway Monte Carlo matches brute force on a river', () => {
    const hero = parseCards('JhTh');
    const board = parseCards('9h8c2d2sKd');
    const v1 = 'QQ, AK, KJs, QJs';
    const v2 = '99, 88, T9s, K9s, 22';
    // Brute force: every non-conflicting pair of combos, equally weighted.
    const r1 = removeDead(parseRange(v1), [...hero, ...board]);
    const r2 = removeDead(parseRange(v2), [...hero, ...board]);
    const hs = evaluate([...hero, ...board]);
    let share = 0, n = 0;
    for (let i = 0; i < NUM_COMBOS; i++) {
      if (!r1[i]) continue;
      for (let j = 0; j < NUM_COMBOS; j++) {
        if (!r2[j]) continue;
        const a = COMBO_CARDS[i], b = COMBO_CARDS[j];
        if (a.includes(b[0]) || a.includes(b[1])) continue;
        const s1 = evaluate([...a, ...board]), s2 = evaluate([...b, ...board]);
        const best = Math.max(s1, s2);
        if (hs > best) share += 1;
        else if (hs === best) share += 1 / (1 + (s1 === best ? 1 : 0) + (s2 === best ? 1 : 0));
        n++;
      }
    }
    const truth = share / n;
    const mc = eq('JhTh', '9h8c2d2sKd', [v1, v2], { iterations: 60000 });
    expect(Math.abs(mc.equity - truth)).toBeLessThan(4 * mc.stderr + 0.002);
  });

  it('rejects impossible requests', () => {
    expect(() => eq('AhAh', '', ['KK'])).toThrow();
    expect(() => eq('AhAs', '2c3c', ['KK'])).toThrow();
    // Every AA combo is dead once hero holds two aces and the board has the other two.
    expect(() => eq('AhAs', 'AcAd2c', ['AA'])).toThrow();
  });
});
