import { describe, expect, it } from 'vitest';
import { parseCards, rankOf, suitOf, type Card } from '../cards';
import { Category, categoryOf, describeScore, evaluate } from '../evaluator';
import { makeRng, shuffle } from '../rng';

const ev = (s: string) => evaluate(parseCards(s));

/**
 * Independent reference: scores exactly five cards by grouping ranks by (count, rank),
 * then takes the best of all 21 five-card subsets. Slow but simple.
 */
function ref5(cards: Card[]): number[] {
  const ranks = cards.map(rankOf).sort((a, b) => b - a);
  const flush = cards.every((c) => suitOf(c) === suitOf(cards[0]));
  const uniq = [...new Set(ranks)];
  let straightHigh = -1;
  if (uniq.length === 5 && uniq[0] - uniq[4] === 4) straightHigh = uniq[0];
  if (uniq.join() === '12,3,2,1,0') straightHigh = 3;
  const groups = uniq
    .map((r) => [ranks.filter((x) => x === r).length, r])
    .sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  const counts = groups.map((g) => g[0]).join('');
  const order = groups.map((g) => g[1]);
  if (straightHigh >= 0 && flush) return [8, straightHigh];
  if (counts === '41') return [7, ...order];
  if (counts === '32') return [6, ...order];
  if (flush) return [5, ...order];
  if (straightHigh >= 0) return [4, straightHigh];
  if (counts === '311') return [3, ...order];
  if (counts === '221') return [2, ...order];
  if (counts === '2111') return [1, ...order];
  return [0, ...order];
}

const cmpArr = (a: number[], b: number[]) => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? -1) - (b[i] ?? -1);
    if (d) return Math.sign(d);
  }
  return 0;
};

function ref7(cards: Card[]): number[] {
  let best: number[] = [-1];
  for (let a = 0; a < 7; a++) for (let b = a + 1; b < 7; b++) {
    const five = cards.filter((_, i) => i !== a && i !== b);
    const s = ref5(five);
    if (cmpArr(s, best) > 0) best = s;
  }
  return best;
}

describe('evaluator', () => {
  it('ranks each category correctly', () => {
    expect(categoryOf(ev('AsKsQsJsTs2c3d'))).toBe(Category.StraightFlush);
    expect(categoryOf(ev('9h9d9s9c2d3c4h'))).toBe(Category.Quads);
    expect(categoryOf(ev('KhKdKs2c2d7h8s'))).toBe(Category.FullHouse);
    expect(categoryOf(ev('2h7h9hJhKh3c4d'))).toBe(Category.Flush);
    expect(categoryOf(ev('5c6d7h8s9c2d2h'))).toBe(Category.Straight);
    expect(categoryOf(ev('QcQdQh2s5c7d9h'))).toBe(Category.Trips);
    expect(categoryOf(ev('JcJd4h4s9c2d3h'))).toBe(Category.TwoPair);
    expect(categoryOf(ev('AcAd4h7s9c2dTh'))).toBe(Category.Pair);
    expect(categoryOf(ev('Ac3d5h7s9cJdKh'))).toBe(Category.HighCard);
  });

  it('handles the wheel and steel wheel', () => {
    expect(describeScore(ev('As2d3h4c5s9dKh'))).toBe('Straight, Five high');
    expect(describeScore(ev('As2s3s4s5s9dKh'))).toBe('Straight flush, Five high');
    expect(ev('2d3h4c5s6s9dKh')).toBeGreaterThan(ev('As2d3h4c5s9dKh'));
  });

  it('uses kickers and plays the board correctly', () => {
    expect(ev('AhKd7c7d2s3h9c')).toBeGreaterThan(ev('AhQd7c7d2s3h9c'));
    // Both play the board straight: tie.
    expect(ev('2c3dTsJhQdKcAs')).toBe(ev('4c5dTsJhQdKcAs'));
    // Two pair with three pairs available uses the best kicker, which can be the third pair.
    expect(describeScore(ev('KhKd9c9d5s5hAc'))).toBe('Two pair, Kings and Nines');
    expect(ev('KhKd9c9d5s5h2c')).toBeLessThan(ev('KhKd9c9d5s5hAc'));
    // Full house from two sets uses the higher set.
    expect(describeScore(ev('7h7d7c9d9s9h2c'))).toBe('Full house, Nines full of Sevens');
  });

  it('agrees with a brute-force reference on 20,000 random 7-card hand pairs', () => {
    const rng = makeRng(42);
    for (let t = 0; t < 20000; t++) {
      const d = shuffle(Array.from({ length: 52 }, (_, i) => i), rng);
      const board = d.slice(4, 9);
      const a = [d[0], d[1], ...board];
      const b = [d[2], d[3], ...board];
      const fast = Math.sign(evaluate(a) - evaluate(b));
      const slow = cmpArr(ref7(a), ref7(b));
      if (fast !== slow) throw new Error(`Mismatch on ${a} vs ${b}`);
      expect(categoryOf(evaluate(a))).toBe(ref7(a)[0]);
    }
  });
});
