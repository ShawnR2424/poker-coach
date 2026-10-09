// Hand evaluator for 5 to 7 cards. Higher score wins; equal scores tie.
// Score layout: category << 20, then up to five 4-bit rank slots (most significant first).

import type { Card } from './cards';
import { RANKS } from './cards';

export const Category = {
  HighCard: 0,
  Pair: 1,
  TwoPair: 2,
  Trips: 3,
  Straight: 4,
  Flush: 5,
  FullHouse: 6,
  Quads: 7,
  StraightFlush: 8,
} as const;
export type Category = (typeof Category)[keyof typeof Category];

export const CATEGORY_NAMES = [
  'High card', 'Pair', 'Two pair', 'Three of a kind', 'Straight',
  'Flush', 'Full house', 'Four of a kind', 'Straight flush',
];

// Scratch buffers reused across calls; the evaluator runs millions of times per equity job.
const counts = new Int8Array(13);
const suitMasks = new Int32Array(4);
const suitCounts = new Int8Array(4);

/** Highest rank of a straight in a 13-bit rank mask, or -1. Handles the wheel (A-5). */
function straightHigh(mask: number): number {
  const m = (mask << 1) | ((mask >> 12) & 1); // bit 0 = ace played low
  for (let h = 13; h >= 4; h--) {
    if (((m >> (h - 4)) & 0x1f) === 0x1f) return h - 1;
  }
  return -1;
}

/** Packs the top `n` ranks of a mask, excluding `skip` bits, into consecutive 4-bit slots starting at `shift`. */
function topRanks(mask: number, n: number, shift: number): number {
  let out = 0;
  for (let r = 12; r >= 0 && n > 0; r--) {
    if (mask & (1 << r)) {
      out |= r << shift;
      shift -= 4;
      n--;
    }
  }
  return out;
}

export function evaluate(cards: ArrayLike<Card>, len: number = cards.length): number {
  counts.fill(0);
  suitMasks.fill(0);
  suitCounts.fill(0);
  let rankMask = 0;
  for (let i = 0; i < len; i++) {
    const c = cards[i];
    const r = c >> 2;
    const s = c & 3;
    counts[r]++;
    suitMasks[s] |= 1 << r;
    suitCounts[s]++;
    rankMask |= 1 << r;
  }

  let flushSuit = -1;
  for (let s = 0; s < 4; s++) if (suitCounts[s] >= 5) flushSuit = s;

  if (flushSuit >= 0) {
    const sf = straightHigh(suitMasks[flushSuit]);
    if (sf >= 0) return (Category.StraightFlush << 20) | (sf << 16);
  }

  let quad = -1, trip1 = -1, trip2 = -1, pair1 = -1, pair2 = -1, pair3 = -1;
  for (let r = 12; r >= 0; r--) {
    const n = counts[r];
    if (n === 4) quad = r;
    else if (n === 3) { if (trip1 < 0) trip1 = r; else if (trip2 < 0) trip2 = r; }
    else if (n === 2) { if (pair1 < 0) pair1 = r; else if (pair2 < 0) pair2 = r; else if (pair3 < 0) pair3 = r; }
  }

  if (quad >= 0) {
    return (Category.Quads << 20) | (quad << 16) | topRanks(rankMask & ~(1 << quad), 1, 12);
  }
  if (trip1 >= 0 && (trip2 >= 0 || pair1 >= 0)) {
    const p = Math.max(trip2, pair1);
    return (Category.FullHouse << 20) | (trip1 << 16) | (p << 12);
  }
  if (flushSuit >= 0) {
    return (Category.Flush << 20) | topRanks(suitMasks[flushSuit], 5, 16);
  }
  const st = straightHigh(rankMask);
  if (st >= 0) return (Category.Straight << 20) | (st << 16);
  if (trip1 >= 0) {
    return (Category.Trips << 20) | (trip1 << 16) | topRanks(rankMask & ~(1 << trip1), 2, 12);
  }
  if (pair2 >= 0) {
    const kick = topRanks(rankMask & ~(1 << pair1) & ~(1 << pair2), 1, 8);
    return (Category.TwoPair << 20) | (pair1 << 16) | (pair2 << 12) | kick;
  }
  if (pair1 >= 0) {
    return (Category.Pair << 20) | (pair1 << 16) | topRanks(rankMask & ~(1 << pair1), 3, 12);
  }
  return topRanks(rankMask, 5, 16);
}

export const categoryOf = (score: number): Category => (score >> 20) as Category;

/** Human-readable description, e.g. "Two pair, Kings and Sevens". */
export function describeScore(score: number): string {
  const cat = categoryOf(score);
  const slot = (i: number) => (score >> (16 - 4 * i)) & 0xf;
  const name = (r: number, plural = false) => {
    const n = ['Deuce', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Jack', 'Queen', 'King', 'Ace'][r];
    return plural ? (n === 'Six' ? 'Sixes' : n + 's') : n;
  };
  switch (cat) {
    case Category.StraightFlush: return slot(0) === 12 ? 'Royal flush' : `Straight flush, ${name(slot(0))} high`;
    case Category.Quads: return `Four ${name(slot(0), true)}`;
    case Category.FullHouse: return `Full house, ${name(slot(0), true)} full of ${name(slot(1), true)}`;
    case Category.Flush: return `Flush, ${name(slot(0))} high`;
    case Category.Straight: return `Straight, ${name(slot(0))} high`;
    case Category.Trips: return `Three ${name(slot(0), true)}`;
    case Category.TwoPair: return `Two pair, ${name(slot(0), true)} and ${name(slot(1), true)}`;
    case Category.Pair: return `Pair of ${name(slot(0), true)}`;
    default: return `${RANKS[slot(0)] === 'A' ? 'Ace' : name(slot(0))} high`;
  }
}
