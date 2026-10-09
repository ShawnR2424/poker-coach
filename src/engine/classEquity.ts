// Hero equity against each hand class of a range, used to color the range grid.

import type { Card } from './cards';
import { computeEquity } from './equity';
import { CLASS_COMBOS, COMBO_CARDS, NUM_COMBOS, type HandClass, type Range } from './range';

/**
 * For each class with live combos in `range`, hero equity against that class alone
 * (its live combos weighted as in the range). Exact heads-up postflop; Monte Carlo preflop.
 */
export function classEquities(
  hero: readonly Card[],
  board: readonly Card[],
  range: Range,
  iterations = 1500,
  seed = 1,
): Map<HandClass, number> {
  const dead = new Set<Card>([...hero, ...board]);
  const out = new Map<HandClass, number>();
  for (const [cls, idx] of CLASS_COMBOS) {
    const sub = new Float32Array(NUM_COMBOS);
    let any = false;
    for (const i of idx) {
      const [a, b] = COMBO_CARDS[i];
      if (range[i] > 0 && !dead.has(a) && !dead.has(b)) { sub[i] = range[i]; any = true; }
    }
    if (!any) continue;
    out.set(cls, computeEquity({ hero, board, villains: [sub], iterations, seed }).equity);
  }
  return out;
}
