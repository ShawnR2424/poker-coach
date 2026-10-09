// Groups an opponent's range by how each hand fares against the hero's hand.
// The grid colors, the summary tiles and the tests all use this one function.

import type { Card } from './cards';
import { ALL_CLASSES, CLASS_COMBOS, COMBO_CARDS, type HandClass, type Range } from './range';

export type PreflopCategory = 'dominates' | 'flip' | 'dominated' | 'rest';

export const PREFLOP_CATEGORY_INFO: Record<PreflopCategory, { label: string; detail: string }> = {
  dominates: { label: 'Dominates you', detail: 'you have 35% or less against these' },
  flip: { label: 'Coin flip', detail: '43% to 57% for you' },
  dominated: { label: 'You dominate', detail: 'you have 65% or more' },
  rest: { label: 'Rest of range', detail: 'a moderate edge either way' },
};
export const PREFLOP_ORDER: PreflopCategory[] = ['dominates', 'flip', 'rest', 'dominated'];

export function preflopCategory(heroEquity: number): PreflopCategory {
  if (heroEquity <= 0.35) return 'dominates';
  if (heroEquity >= 0.65) return 'dominated';
  if (heroEquity >= 0.43 && heroEquity <= 0.57) return 'flip';
  return 'rest';
}

export interface CellCategory<C extends string> {
  cls: HandClass;
  /** Weighted combos still live after card removal. */
  combos: number;
  category: C | null;
  heroEquity: number | null;
}

/**
 * Every class with live weight gets a category; every class without gets none.
 * `classEq` must have an entry for every class with live weight.
 */
export function categorizeRange<C extends string>(
  range: Range,
  dead: readonly Card[],
  classEq: ReadonlyMap<HandClass, number>,
  toCategory: (eq: number) => C,
): CellCategory<C>[] {
  const deadSet = new Set(dead);
  return ALL_CLASSES.map((cls) => {
    let combos = 0;
    for (const i of CLASS_COMBOS.get(cls)!) {
      const [a, b] = COMBO_CARDS[i];
      if (!deadSet.has(a) && !deadSet.has(b)) combos += range[i];
    }
    if (combos <= 1e-9) return { cls, combos: 0, category: null, heroEquity: null };
    const eq = classEq.get(cls);
    if (eq === undefined) throw new Error(`Missing equity for ${cls}`);
    return { cls, combos, category: toCategory(eq), heroEquity: eq };
  });
}

export function categoryTotals<C extends string>(cells: CellCategory<C>[]): Map<C, number> {
  const m = new Map<C, number>();
  for (const c of cells) if (c.category) m.set(c.category, (m.get(c.category) ?? 0) + c.combos);
  return m;
}
