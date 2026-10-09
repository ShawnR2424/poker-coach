// Sorts a two-card hand into one of ten postflop classes for a given board.
// The classes drive how opponents bet, call and raise (data/postflop/actions.json).

import { rankOf, suitOf, type Card } from '../cards';
import { evaluate, Category } from '../evaluator';

export type PostflopClass =
  | 'setPlus'
  | 'twoPair'
  | 'overpair'
  | 'topPairGood'
  | 'topPairWeak'
  | 'middlePair'
  | 'weakPair'
  | 'strongDraw'
  | 'weakDraw'
  | 'air';

export const POSTFLOP_CLASSES: PostflopClass[] = [
  'setPlus', 'twoPair', 'overpair', 'topPairGood', 'topPairWeak',
  'middlePair', 'weakPair', 'strongDraw', 'weakDraw', 'air',
];

export const POSTFLOP_CLASS_LABEL: Record<PostflopClass, string> = {
  setPlus: 'Sets, straights, flushes and better',
  twoPair: 'Two pair',
  overpair: 'Overpairs',
  topPairGood: 'Top pair, good kicker',
  topPairWeak: 'Top pair, weak kicker',
  middlePair: 'Middle pairs',
  weakPair: 'Weak pairs',
  strongDraw: 'Flush draws and open-enders',
  weakDraw: 'Gutshots and overcards',
  air: 'Nothing',
};

/** Classes that count toward "nut" and range advantage. */
export const STRONG_CLASSES: ReadonlySet<PostflopClass> = new Set(['setPlus', 'twoPair']);
export const DRAW_CLASSES: ReadonlySet<PostflopClass> = new Set(['strongDraw', 'weakDraw']);

const TEN = 8;

/** Highest straight rank in a 13-bit rank mask (wheel counts), or -1. */
function straightHigh(mask: number): number {
  const m = (mask << 1) | ((mask >> 12) & 1);
  for (let h = 13; h >= 4; h--) if (((m >> (h - 4)) & 0x1f) === 0x1f) return h - 1;
  return -1;
}

const maskOf = (cards: readonly Card[]) => cards.reduce((m, c) => m | (1 << rankOf(c)), 0);

/** Number of distinct ranks that would give a straight using a hole card, which the hand doesn't already have. */
export function straightOuts(hole: readonly Card[], board: readonly Card[]): number {
  const all = maskOf([...hole, ...board]);
  const boardMask = maskOf(board);
  if (straightHigh(all) >= 0) return 0;
  let outs = 0;
  for (let r = 0; r < 13; r++) {
    if (all & (1 << r)) continue;
    const mine = straightHigh(all | (1 << r));
    if (mine < 0) continue;
    if (straightHigh(boardMask | (1 << r)) >= mine) continue; // the board would make it alone
    outs++;
  }
  return outs;
}

/** True with four cards to a flush that include at least one hole card (and no flush yet). */
export function hasFlushDraw(hole: readonly Card[], board: readonly Card[]): boolean {
  for (let s = 0; s < 4; s++) {
    const n = [...hole, ...board].filter((c) => suitOf(c) === s).length;
    if (n === 4 && hole.some((c) => suitOf(c) === s)) return true;
  }
  return false;
}

export function classifyHand(hole: readonly Card[], board: readonly Card[]): PostflopClass {
  if (board.length < 3) throw new Error('Postflop classes need a flop');
  const all = [...hole, ...board];
  const score = evaluate(all, all.length);
  const cat = score >> 20;

  // Straights, flushes and full houses count only when a hole card helps make them.
  if (cat >= Category.Straight) {
    const boardOnly = board.length === 5 ? evaluate(board, 5) : 0;
    if (score > boardOnly) return 'setPlus';
  }

  const [h1, h2] = hole.map(rankOf).sort((a, b) => b - a);
  const boardRanks = board.map(rankOf);
  const uniq = [...new Set(boardRanks)].sort((a, b) => b - a);
  const top = uniq[0];
  const second = uniq[1] ?? -1;
  const onBoard = (r: number) => boardRanks.filter((x) => x === r).length;

  let made: PostflopClass | null = null;
  if (h1 === h2) {
    if (onBoard(h1) >= 1) made = 'setPlus';
    else if (h1 > top) made = 'overpair';
    else if (h1 > second) made = 'middlePair';
    else made = 'weakPair';
  } else {
    const hits = [h1, h2].filter((r) => onBoard(r) >= 1);
    if (hits.some((r) => onBoard(r) >= 2)) made = 'setPlus';
    else if (hits.length === 2) made = 'twoPair';
    else if (hits.length === 1) {
      const r = hits[0];
      const kicker = r === h1 ? h2 : h1;
      if (r === top) made = kicker >= TEN ? 'topPairGood' : 'topPairWeak';
      else if (r === second) made = 'middlePair';
      else made = 'weakPair';
    }
  }

  if (made && made !== 'middlePair' && made !== 'weakPair') return made;

  let draw: PostflopClass | null = null;
  if (board.length < 5) {
    if (hasFlushDraw(hole, board) || straightOuts(hole, board) >= 2) draw = 'strongDraw';
    else if (straightOuts(hole, board) === 1 || (h1 !== h2 && h2 > top)) draw = 'weakDraw';
  }

  if (made === 'middlePair') return draw === 'strongDraw' ? 'strongDraw' : 'middlePair';
  if (made === 'weakPair') return draw ?? 'weakPair';
  return draw ?? 'air';
}
