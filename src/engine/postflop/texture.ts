// Board texture. The postflop model sorts hands into classes by how they connect with the board,
// and the texture says what kind of board it is: players bet, size and defend differently on a
// dry ace-high flop than on a connected or three-suited one. The texture's multipliers
// (data/postflop/actions.json, `textures`) and any solver spots imported on boards of that
// texture adjust the class tables.

import { rankOf, suitOf, type Card } from '../cards';

export type Texture = 'dryHigh' | 'dryLow' | 'wet' | 'paired' | 'monotone';

export const TEXTURES: Texture[] = ['dryHigh', 'dryLow', 'wet', 'paired', 'monotone'];

export const TEXTURE_LABEL: Record<Texture, string> = {
  dryHigh: 'Dry, ace or king high',
  dryLow: 'Dry, queen high or lower',
  wet: 'Connected or two-tone',
  paired: 'Paired',
  monotone: 'Three of a suit',
};

const KING = 11;

/** True when three distinct board ranks fit in five consecutive ranks (the ace also plays low). */
export function straightPossible(board: readonly Card[]): boolean {
  let mask = 0;
  for (const c of board) mask |= 1 << rankOf(c);
  const bits = (mask << 1) | ((mask >> 12) & 1); // bit 0 is the ace played low
  for (let lo = 0; lo <= 9; lo++) {
    let n = 0;
    for (let r = lo; r < lo + 5; r++) if (bits & (1 << r)) n++;
    if (n >= 3) return true;
  }
  return false;
}

/**
 * The board's texture, from every card dealt so far, in this order: three or more of a suit,
 * then a paired board, then connected or two-tone, then dry (split by the top card).
 * Two-tone counts as wet when a flush draw is still live (fewer than five cards) and two of the
 * ranks are within two of each other, as on 9h8h3c; a two-tone board with spread ranks such as
 * Kh7h2c stays dry.
 */
export function boardTexture(board: readonly Card[]): Texture {
  if (board.length < 3) throw new Error('A texture needs a flop');
  const suits = [0, 0, 0, 0];
  for (const c of board) suits[suitOf(c)]++;
  if (Math.max(...suits) >= 3) return 'monotone';
  const ranks = board.map(rankOf).sort((a, b) => b - a);
  if (new Set(ranks).size < ranks.length) return 'paired';
  if (straightPossible(board)) return 'wet';
  if (board.length < 5 && Math.max(...suits) === 2 && ranks.some((r, i) => i > 0 && ranks[i - 1] - r <= 2)) return 'wet';
  return ranks[0] >= KING ? 'dryHigh' : 'dryLow';
}
