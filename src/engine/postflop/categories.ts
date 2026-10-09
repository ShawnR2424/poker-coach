// Groups an opponent's postflop range by what each hand means for the hero right now.

import type { Card } from '../cards';
import { evaluate } from '../evaluator';
import type { CellCategory } from '../categories';
import { ALL_CLASSES, CLASS_COMBOS, COMBO_CARDS, type Range } from '../range';
import { classifyHand, DRAW_CLASSES } from './classify';

export type PostflopCategory = 'beats' | 'draws' | 'pays' | 'missed';

export const POSTFLOP_CATEGORY_INFO: Record<PostflopCategory, { label: string; detail: string }> = {
  beats: { label: 'Beats you', detail: 'ahead of you now, or a chop' },
  draws: { label: 'Can outdraw you', detail: 'behind now with 25% or more to win' },
  pays: { label: 'Worse hands that pay', detail: 'a pair or better that you beat' },
  missed: { label: 'Missed, will fold', detail: 'behind with little chance' },
};
export const POSTFLOP_ORDER: PostflopCategory[] = ['beats', 'draws', 'pays', 'missed'];

/** Category of one opponent combo given the hero's equity against it. */
export function comboCategory(hero: readonly Card[], board: readonly Card[], villain: readonly Card[], heroEq: number): PostflopCategory {
  const h = evaluate([...hero, ...board]);
  const v = evaluate([...villain, ...board]);
  if (v >= h) return 'beats';
  if (board.length < 5 && 1 - heroEq >= 0.25) return 'draws';
  const cls = classifyHand(villain, board);
  return cls === 'air' || DRAW_CLASSES.has(cls) ? 'missed' : 'pays';
}

export interface PostflopBreakdown {
  /** One entry per grid cell, colored by the category holding most of its combos. */
  cells: CellCategory<PostflopCategory>[];
  /** Weighted live combos per category, counted combo by combo. */
  totals: Map<PostflopCategory, number>;
  live: number;
}

export function categorizePostflop(range: Range, hero: readonly Card[], board: readonly Card[], eqs: Float32Array): PostflopBreakdown {
  const dead = new Set([...hero, ...board]);
  const totals = new Map<PostflopCategory, number>(POSTFLOP_ORDER.map((k) => [k, 0]));
  let live = 0;
  const cells = ALL_CLASSES.map((cls): CellCategory<PostflopCategory> => {
    const by = new Map<PostflopCategory, number>();
    let combos = 0, eqSum = 0;
    for (const i of CLASS_COMBOS.get(cls)!) {
      const w = range[i];
      if (!(w > 0)) continue;
      const [a, b] = COMBO_CARDS[i];
      if (dead.has(a) || dead.has(b)) continue;
      const cat = comboCategory(hero, board, [a, b], eqs[i]);
      by.set(cat, (by.get(cat) ?? 0) + w);
      totals.set(cat, totals.get(cat)! + w);
      combos += w;
      eqSum += w * eqs[i];
    }
    live += combos;
    if (combos <= 1e-9) return { cls, combos: 0, category: null, heroEquity: null };
    let top: PostflopCategory = 'beats';
    for (const k of POSTFLOP_ORDER) if ((by.get(k) ?? 0) > (by.get(top) ?? 0)) top = k;
    return { cls, combos, category: top, heroEquity: eqSum / combos };
  });
  return { cells, totals, live };
}
