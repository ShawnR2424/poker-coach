import { describe, expect, it } from 'vitest';
import { computeEquity } from '../equity';
import { getStrategy } from '../preflop/charts';
import {
  addResult, bestMatch, bestPainting, equityBand, HISTORY_MAX, lineCount, makeQuiz, parseHistory, QUIZ_KINDS, rangeBand, scoreRange, summarizeQuizzes,
  type QuizResult,
} from '../quiz/quiz';
import { ALL_CLASSES, CLASS_COMBOS, comboIndex, NUM_COMBOS, parseRange } from '../range';
import { makeRng } from '../rng';

describe('dealing quizzes', () => {
  it('has lines for every kind', () => {
    for (const k of QUIZ_KINDS) expect(lineCount(k)).toBeGreaterThan(3);
  });

  it('deals a hand from the player\'s own range, a clean flop and a non-empty opponent range', () => {
    const rng = makeRng(7);
    for (let n = 0; n < 300; n++) {
      const q = makeQuiz(rng, { lowStakes: n % 2 === 0 });
      const [kind, key, side] = q.source.split(' ');
      expect(q.range).toEqual(getStrategy(kind as never, key, 'pool', n % 2 === 0)[side as 'raise' | 'call']);
      let w = 0;
      for (let i = 0; i < NUM_COMBOS; i++) w += q.range[i];
      expect(w).toBeGreaterThan(10);
      const cards = [...q.hand, ...q.board];
      expect(new Set(cards).size).toBe(5);
      expect(q.board).toHaveLength(3);
      expect(`${q.story} ${q.rangeAsk}`).not.toMatch(/undefined|NaN/);
    }
  });

  it('only deals the kinds asked for', () => {
    const rng = makeRng(3);
    for (let n = 0; n < 50; n++) expect(makeQuiz(rng, { lowStakes: true, kinds: ['threeBet'] }).kind).toBe('threeBet');
  });

  it('tells the line in plain words', () => {
    const rng = makeRng(11);
    const seen = new Set<string>();
    for (let n = 0; n < 200; n++) {
      const q = makeQuiz(rng, { lowStakes: false });
      seen.add(q.kind);
      if (q.kind === 'open') expect(q.story).toMatch(/opens to \d+(\.\d+)?bb.*you call/);
      if (q.kind === 'call') expect(q.story).toMatch(/^You open to .* calls\./);
      if (q.villain === 'BB' || q.hero === 'BB') expect(q.story).not.toMatch(/Everyone else folds/);
      if (q.kind === 'threeBet') expect(q.story).toMatch(/3-bets to \d+(\.\d+)?bb, and you call\.$/);
      expect(q.rangeAsk).not.toMatch(/low-stakes/);
    }
    expect(seen.size).toBe(3);
  });

  it('gives an exact equity for every dealt flop', () => {
    const rng = makeRng(5);
    for (let n = 0; n < 5; n++) {
      const q = makeQuiz(rng, { lowStakes: true });
      const r = computeEquity({ hero: q.hand, board: q.board, villains: [q.range] });
      expect(r.exact).toBe(true);
      expect(r.equity).toBeGreaterThan(0);
      expect(r.equity).toBeLessThan(1);
    }
  });
});

describe('scoring a painted range', () => {
  const pure = parseRange('QQ+, AKs, AKo');

  it('scores an exact painting 100% and an empty one 0%', () => {
    const exact = scoreRange(new Set(['AA', 'KK', 'QQ', 'AKs', 'AKo']), pure);
    expect(exact.match).toBe(1);
    expect(exact.missed).toBe(0);
    expect(exact.extra).toBe(0);
    expect(exact.truePct).toBeCloseTo(34 / NUM_COMBOS, 9);
    expect(scoreRange(new Set(), pure).match).toBe(0);
  });

  it('counts combos, so missing a 12-combo offsuit hand costs more than missing a pair', () => {
    const noAKo = scoreRange(new Set(['AA', 'KK', 'QQ', 'AKs']), pure);
    const noQQ = scoreRange(new Set(['AA', 'KK', 'AKs', 'AKo']), pure);
    expect(noAKo.match).toBeCloseTo(22 / 34, 9);
    expect(noQQ.match).toBeCloseTo(28 / 34, 9);
    expect(noAKo.cells.get('AKo')!.mark).toBe('missed');
  });

  it('counts a mixed class by its frequency', () => {
    const mixed = parseRange('AA, AKo:0.5');
    const s = scoreRange(new Set(['AA', 'AKo']), mixed);
    // Both: 6 + 6 of AKo; either: 6 + all 12 painted.
    expect(s.match).toBeCloseTo(12 / 18, 9);
    expect(s.extra).toBeCloseTo(6, 9);
    expect(s.cells.get('AKo')!.mark).toBe('partial');
    const skip = scoreRange(new Set(['AA']), mixed);
    expect(skip.match).toBeCloseTo(6 / 12, 9);
    expect(skip.missed).toBeCloseTo(6, 9);
  });

  it('marks painted hands outside the range as extra', () => {
    const s = scoreRange(new Set(['AA', '72o']), parseRange('AA'));
    expect(s.cells.get('72o')!.mark).toBe('extra');
    expect(s.cells.get('AA')!.mark).toBe('hit');
    expect(s.cells.get('KK')!.mark).toBe('out');
    expect(s.match).toBeCloseTo(6 / 18, 9);
  });

  it('finds the best painting, which no other painting beats', () => {
    const rng = makeRng(19);
    for (const k of QUIZ_KINDS) {
      for (let n = 0; n < 15; n++) {
        const q = makeQuiz(rng, { lowStakes: n % 2 === 0, kinds: [k] });
        const best = bestMatch(q.range);
        expect(scoreRange(bestPainting(q.range), q.range).match).toBeCloseTo(best, 9);
        // Painting every hand played at least half the time gets close to the best.
        const majority = new Set(ALL_CLASSES.filter((c) => {
          const idx = CLASS_COMBOS.get(c)!;
          return idx.reduce((a, i) => a + q.range[i], 0) / idx.length >= 0.5;
        }));
        expect(scoreRange(majority, q.range).match).toBeGreaterThanOrEqual(best * 0.9);
        // Random paintings, and the best one with a hand flipped, never beat it.
        const best0 = bestPainting(q.range);
        for (let t = 0; t < 20; t++) {
          const random = new Set(ALL_CLASSES.filter(() => rng() < 0.3));
          expect(scoreRange(random, q.range).match).toBeLessThanOrEqual(best + 1e-9);
          const flipped = new Set(best0);
          const c = ALL_CLASSES[Math.floor(rng() * ALL_CLASSES.length)];
          if (flipped.has(c)) flipped.delete(c); else flipped.add(c);
          expect(scoreRange(flipped, q.range).match).toBeLessThanOrEqual(best + 1e-9);
        }
        expect(scoreRange(new Set(), q.range).best).toBe(best);
      }
    }
  });

  it('has a best match of 100% for a range with no mixed hands', () => {
    expect(bestMatch(pure)).toBe(1);
    expect(bestMatch(parseRange('AA, AKo:0.5'))).toBeCloseTo(12 / 18, 9);
  });

  it('works on the combos, not class labels', () => {
    const r = new Float32Array(NUM_COMBOS);
    r[comboIndex(48, 49)] = 1; // one AA combo
    expect(scoreRange(new Set(['AA']), r).match).toBeCloseTo(1 / 6, 9);
  });
});

describe('bands', () => {
  it('bands an equity guess by points away', () => {
    expect(equityBand(50, 53)).toBe('spot on');
    expect(equityBand(50, 57)).toBe('close');
    expect(equityBand(60, 45)).toBe('off');
    expect(equityBand(20, 80)).toBe('far off');
  });

  it('bands a range match against the best painting could reach', () => {
    expect([0.9, 0.7, 0.5, 0.2].map((m) => rangeBand(m))).toEqual(['spot on', 'close', 'off', 'far off']);
    expect(rangeBand(0.66, 0.75)).toBe('spot on');
  });
});

describe('quiz history', () => {
  const r = (match: number, widthMiss: number, equityMiss?: number, kind: QuizResult['kind'] = 'open'): QuizResult => ({
    at: '2026-10-10T00:00:00.000Z', kind, match, best: 1, widthMiss, ...(equityMiss === undefined ? {} : { equityMiss }),
  });

  it('averages the latest quizzes and keeps the sign of equity misses', () => {
    const h = [r(0, 0, 50), r(0.5, 4, 6), r(0.7, -2, -2, 'call'), r(0.9, 1)];
    const s = summarizeQuizzes(h, 3);
    expect(s.count).toBe(4);
    expect(s.match).toBeCloseTo((0.5 + 0.7 + 0.9) / 3, 9);
    expect(s.ofBest).toBeCloseTo((0.5 + 0.7 + 0.9) / 3, 9);
    expect(summarizeQuizzes([{ ...r(0.6, 0), best: 0.75 }]).ofBest).toBeCloseTo(0.8, 9);
    expect(s.width).toBeCloseTo(1, 9);
    expect(s.equityMiss).toBeCloseTo(4, 9);
    expect(s.equityBias).toBeCloseTo(2, 9);
    expect(s.byKind).toEqual({ open: { count: 2, match: 0.7 }, call: { count: 1, match: 0.7 } });
    expect(summarizeQuizzes([]).match).toBeNull();
  });

  it('caps the saved history and drops malformed entries', () => {
    let h: QuizResult[] = [];
    for (let i = 0; i < HISTORY_MAX + 5; i++) h = addResult(h, r(i / 1000, 0));
    expect(h).toHaveLength(HISTORY_MAX);
    expect(h[0].match).toBeCloseTo(5 / 1000, 9);
    const raw = JSON.stringify([r(0.5, 1, 2), { at: 'x', kind: 'shove', match: 1, best: 1, widthMiss: 0 }, { at: 'x', kind: 'call', match: 1, widthMiss: 0 }, { at: 'x', kind: 'call', match: '1' }, null]);
    expect(parseHistory(raw)).toEqual([r(0.5, 1, 2)]);
    expect(parseHistory('not json')).toEqual([]);
    expect(parseHistory(null)).toEqual([]);
  });
});
