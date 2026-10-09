// Combo counting for the range read: how many combos of each hand class are left after card
// removal, which known cards took the rest, and how the class does against the hero. Uses the
// same per-combo categories as the grid, so the table and the grid always agree.

import type { Card } from '../cards';
import type { HandClass, Range } from '../range';
import { ALL_CLASSES, CLASS_COMBOS, COMBO_CARDS } from '../range';
import { comboCategory, POSTFLOP_ORDER, type PostflopCategory } from './categories';

export interface ComboRow {
  cls: HandClass;
  /** Weighted combos in the range before any card removal. */
  before: number;
  /** Weighted combos still possible given the hero's cards and the board. */
  left: number;
  /** Known cards that remove combos of this class, split by whose they are. */
  yours: Card[];
  board: Card[];
  /** Category holding most of the live combos (null when none are left). */
  category: PostflopCategory | null;
  /** Hero equity against the live combos. */
  heroEquity: number | null;
}

export function comboTable(range: Range, hero: readonly Card[], board: readonly Card[], eqs: Float32Array): ComboRow[] {
  const heroSet = new Set(hero), boardSet = new Set(board);
  const rows: ComboRow[] = [];
  for (const cls of ALL_CLASSES) {
    let before = 0, left = 0, eqSum = 0;
    const yours = new Set<Card>(), onBoard = new Set<Card>();
    const by = new Map<PostflopCategory, number>();
    for (const i of CLASS_COMBOS.get(cls)!) {
      const w = range[i];
      if (!(w > 0)) continue;
      before += w;
      const pair = COMBO_CARDS[i];
      const blocked = pair.filter((c) => heroSet.has(c) || boardSet.has(c));
      if (blocked.length) {
        blocked.forEach((c) => (heroSet.has(c) ? yours : onBoard).add(c));
        continue;
      }
      left += w;
      eqSum += w * eqs[i];
      const cat = comboCategory(hero, board, pair, eqs[i]);
      by.set(cat, (by.get(cat) ?? 0) + w);
    }
    if (before <= 1e-9) continue;
    let category: PostflopCategory | null = null;
    if (left > 1e-9) {
      category = 'beats';
      for (const k of POSTFLOP_ORDER) if ((by.get(k) ?? 0) > (by.get(category) ?? 0)) category = k;
    }
    rows.push({
      cls, before, left,
      yours: [...yours].sort((a, b) => b - a),
      board: [...onBoard].sort((a, b) => b - a),
      category,
      heroEquity: left > 1e-9 ? eqSum / left : null,
    });
  }
  // Group by category in grid order, biggest first; classes wiped out by card removal go last.
  const rank = (r: ComboRow) => (r.category ? POSTFLOP_ORDER.indexOf(r.category) : POSTFLOP_ORDER.length);
  return rows.sort((a, b) => rank(a) - rank(b) || b.left - a.left);
}

/** Classes that had weight before an action and are (nearly) gone after it. */
export function droppedClasses(before: Range, after: Range, dead: readonly Card[], threshold = 0.2): Set<HandClass> {
  const deadSet = new Set(dead);
  const out = new Set<HandClass>();
  for (const [cls, idx] of CLASS_COMBOS) {
    let b = 0, a = 0;
    for (const i of idx) {
      const [x, y] = COMBO_CARDS[i];
      if (deadSet.has(x) || deadSet.has(y)) continue;
      b += before[i];
      a += after[i];
    }
    if (b > 1e-9 && a <= b * threshold) out.add(cls);
  }
  return out;
}

/** Share of the live range an action kept. */
export function keptShare(before: Range, after: Range, dead: readonly Card[]): number {
  const deadSet = new Set(dead);
  let b = 0, a = 0;
  for (let i = 0; i < before.length; i++) {
    const [x, y] = COMBO_CARDS[i];
    if (deadSet.has(x) || deadSet.has(y)) continue;
    b += before[i];
    a += after[i];
  }
  return b > 0 ? a / b : 1;
}
