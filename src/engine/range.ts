// Ranges as weighted combo sets. A range is 1326 weights (one per two-card combo), 0..1.
// Text notation, the 13x13 grid, and combo counts are all derived from this one structure,
// so the grid can never disagree with the range text.

import type { Card } from './cards';
import { RANKS, rankOf, suitOf, formatCard, parseCard } from './cards';

export const NUM_COMBOS = 1326;

/** COMBO_CARDS[i] = [high card, low card] (by card id). */
export const COMBO_CARDS: ReadonlyArray<readonly [Card, Card]> = (() => {
  const out: [Card, Card][] = [];
  for (let a = 51; a >= 0; a--) for (let b = a - 1; b >= 0; b--) out.push([a, b]);
  return out;
})();

const COMBO_INDEX = (() => {
  const t = new Int16Array(52 * 52).fill(-1);
  COMBO_CARDS.forEach(([a, b], i) => {
    t[a * 52 + b] = i;
    t[b * 52 + a] = i;
  });
  return t;
})();

export const comboIndex = (a: Card, b: Card): number => COMBO_INDEX[a * 52 + b];

export type Range = Float32Array;
export const emptyRange = (): Range => new Float32Array(NUM_COMBOS);

// ---- Hand classes (the 169 grid cells) ----

export type HandClass = string; // "AA", "AKs", "AKo"

/** Grid index for a rank: row/col 0 is Ace, 12 is Deuce. */
const gridIdx = (rank: number) => 12 - rank;
const rankAtGrid = (idx: number) => 12 - idx;

/** Class name for grid cell (row, col): pairs on the diagonal, suited above, offsuit below. */
export function classAt(row: number, col: number): HandClass {
  const hi = rankAtGrid(Math.min(row, col));
  const lo = rankAtGrid(Math.max(row, col));
  if (row === col) return RANKS[hi] + RANKS[hi];
  return RANKS[hi] + RANKS[lo] + (row < col ? 's' : 'o');
}

export function cellOf(cls: HandClass): [row: number, col: number] {
  const hi = RANKS.indexOf(cls[0]);
  const lo = RANKS.indexOf(cls[1]);
  if (hi === lo) return [gridIdx(hi), gridIdx(hi)];
  return cls[2] === 's' ? [gridIdx(hi), gridIdx(lo)] : [gridIdx(lo), gridIdx(hi)];
}

export function classOfCombo(a: Card, b: Card): HandClass {
  const ra = rankOf(a), rb = rankOf(b);
  const hi = Math.max(ra, rb), lo = Math.min(ra, rb);
  if (hi === lo) return RANKS[hi] + RANKS[lo];
  return RANKS[hi] + RANKS[lo] + (suitOf(a) === suitOf(b) ? 's' : 'o');
}

/** All 169 classes in grid order (row by row). */
export const ALL_CLASSES: HandClass[] = (() => {
  const out: HandClass[] = [];
  for (let r = 0; r < 13; r++) for (let c = 0; c < 13; c++) out.push(classAt(r, c));
  return out;
})();

/** Combo indices belonging to each class: 6 for pairs, 4 suited, 12 offsuit. */
export const CLASS_COMBOS: ReadonlyMap<HandClass, number[]> = (() => {
  const m = new Map<HandClass, number[]>();
  for (const cls of ALL_CLASSES) m.set(cls, []);
  COMBO_CARDS.forEach(([a, b], i) => m.get(classOfCombo(a, b))!.push(i));
  return m;
})();

export const COMBO_CLASS: ReadonlyArray<HandClass> = COMBO_CARDS.map(([a, b]) => classOfCombo(a, b));

// ---- Parsing ----

const TOKEN_RE = /^([2-9TJQKA])([2-9TJQKA])([so])?(\+)?$/i;

function classesForToken(tok: string): HandClass[] {
  const dash = tok.split('-');
  if (dash.length === 2) return classesForSpan(dash[0], dash[1]);
  if (dash.length > 2) throw new Error(`Bad range token "${tok}"`);

  const m = TOKEN_RE.exec(tok);
  if (!m) throw new Error(`Bad range token "${tok}"`);
  let hi = RANKS.indexOf(m[1].toUpperCase());
  let lo = RANKS.indexOf(m[2].toUpperCase());
  if (lo > hi) [hi, lo] = [lo, hi];
  const kind = m[3]?.toLowerCase();
  const plus = !!m[4];

  if (hi === lo) {
    if (kind) throw new Error(`Pairs can't be suited or offsuit: "${tok}"`);
    const out: HandClass[] = [];
    for (let r = hi; r <= (plus ? 12 : hi); r++) out.push(RANKS[r] + RANKS[r]);
    return out;
  }
  const kinds = kind ? [kind] : ['s', 'o'];
  const out: HandClass[] = [];
  for (let k = lo; k <= (plus ? hi - 1 : lo); k++) {
    for (const kd of kinds) out.push(RANKS[hi] + RANKS[k] + kd);
  }
  return out;
}

/** "77-55" or "A5s-A2s" or "KTo-K8o". Both ends inclusive. */
function classesForSpan(a: string, b: string): HandClass[] {
  const ma = TOKEN_RE.exec(a), mb = TOKEN_RE.exec(b);
  if (!ma || !mb || ma[4] || mb[4]) throw new Error(`Bad range span "${a}-${b}"`);
  const [ah, al] = [RANKS.indexOf(ma[1].toUpperCase()), RANKS.indexOf(ma[2].toUpperCase())];
  const [bh, bl] = [RANKS.indexOf(mb[1].toUpperCase()), RANKS.indexOf(mb[2].toUpperCase())];
  const kind = ma[3]?.toLowerCase();
  if (kind !== mb[3]?.toLowerCase()) throw new Error(`Span ends must match: "${a}-${b}"`);
  const out: HandClass[] = [];
  if (ah === al && bh === bl) {
    for (let r = Math.min(ah, bh); r <= Math.max(ah, bh); r++) out.push(RANKS[r] + RANKS[r]);
    return out;
  }
  if (ah !== bh) throw new Error(`Span must share the top card: "${a}-${b}"`);
  const kinds = kind ? [kind] : ['s', 'o'];
  for (let k = Math.min(al, bl); k <= Math.max(al, bl); k++) {
    if (k >= ah) throw new Error(`Bad span "${a}-${b}"`);
    for (const kd of kinds) out.push(RANKS[ah] + RANKS[k] + kd);
  }
  return out;
}

/**
 * Parses standard notation into a weighted range.
 * Supports: AA, AKs, AKo, AK, 22+, ATs+, KTo+, 77-55, A5s-A2s, specific combos (AsKs),
 * and weights as a suffix (AKo:0.5). Later tokens overwrite earlier ones.
 */
export function parseRange(text: string): Range {
  const r = emptyRange();
  for (const raw of text.split(',')) {
    const part = raw.trim();
    if (!part) continue;
    const [tok, wStr] = part.split(':');
    const w = wStr === undefined ? 1 : Number(wStr);
    if (!(w >= 0 && w <= 1)) throw new Error(`Bad weight in "${part}"`);
    const t = tok.trim();
    if (/^[2-9TJQKA][cdhs][2-9TJQKA][cdhs]$/i.test(t)) {
      const a = parseCard(t.slice(0, 2)), b = parseCard(t.slice(2, 4));
      if (a === b) throw new Error(`Bad combo "${t}"`);
      r[comboIndex(a, b)] = w;
      continue;
    }
    for (const cls of classesForToken(t)) for (const i of CLASS_COMBOS.get(cls)!) r[i] = w;
  }
  return r;
}

// ---- Formatting ----

const fmtW = (w: number) => (w === 1 ? '' : `:${+w.toFixed(3)}`);

/** Compresses a list of classes that share a weight into standard notation. */
function compressClasses(set: Set<HandClass>): string[] {
  const out: string[] = [];
  // Pairs, high to low.
  let r = 12;
  while (r >= 0) {
    if (!set.has(RANKS[r] + RANKS[r])) { r--; continue; }
    const top = r;
    while (r - 1 >= 0 && set.has(RANKS[r - 1] + RANKS[r - 1])) r--;
    const bottom = r;
    const p = (x: number) => RANKS[x] + RANKS[x];
    if (top === bottom) out.push(p(top));
    else if (top === 12) out.push(`${p(bottom)}+`);
    else out.push(`${p(top)}-${p(bottom)}`);
    r--;
  }
  // Suited then offsuit, by top card, kickers high to low.
  for (const kind of ['s', 'o']) {
    for (let hi = 12; hi >= 1; hi--) {
      let k = hi - 1;
      while (k >= 0) {
        const name = (x: number) => RANKS[hi] + RANKS[x] + kind;
        if (!set.has(name(k))) { k--; continue; }
        const top = k;
        while (k - 1 >= 0 && set.has(name(k - 1))) k--;
        const bottom = k;
        if (top === bottom) out.push(name(top));
        else if (top === hi - 1) out.push(`${name(bottom)}+`);
        else out.push(`${name(top)}-${name(bottom)}`);
        k--;
      }
    }
  }
  return out;
}

/**
 * Formats a range as notation. Whole classes at one weight are compressed (22+, ATs+);
 * classes with mixed per-combo weights are written as individual combos.
 */
export function formatRange(range: Range): string {
  const byWeight = new Map<number, Set<HandClass>>();
  const singles: string[] = [];
  for (const cls of ALL_CLASSES) {
    const idx = CLASS_COMBOS.get(cls)!;
    const w0 = range[idx[0]];
    if (idx.every((i) => range[i] === w0)) {
      if (w0 > 0) {
        if (!byWeight.has(w0)) byWeight.set(w0, new Set());
        byWeight.get(w0)!.add(cls);
      }
    } else {
      for (const i of idx) {
        if (range[i] > 0) {
          const [a, b] = COMBO_CARDS[i];
          singles.push(formatCard(a) + formatCard(b) + fmtW(range[i]));
        }
      }
    }
  }
  const weights = [...byWeight.keys()].sort((a, b) => b - a);
  const parts: string[] = [];
  for (const w of weights) for (const t of compressClasses(byWeight.get(w)!)) parts.push(t + fmtW(w));
  return [...parts, ...singles].join(', ');
}

/** Kept share, relative to the most-kept class, that puts a class in the approximate range text. */
export const RANGE_TEXT_CORE = 0.5;
export const RANGE_TEXT_PARTIAL = 0.15;

export interface RangeSummary {
  /** Classes kept at RANGE_TEXT_CORE or more of the top kept share, in standard notation. */
  core: string;
  /** Classes kept at RANGE_TEXT_PARTIAL up to RANGE_TEXT_CORE of it. */
  partial: string;
  coreClasses: Set<HandClass>;
  partialClasses: Set<HandClass>;
  /** The highest kept share of any class: the scale the thresholds apply to. */
  top: number;
}

/** Share of a class's live combos a weighted range keeps, or null when every combo is dead. */
export function keptShareOf(range: Range, cls: HandClass, dead: ReadonlySet<Card>): number | null {
  let w = 0, n = 0;
  for (const i of CLASS_COMBOS.get(cls)!) {
    const [a, b] = COMBO_CARDS[i];
    if (dead.has(a) || dead.has(b)) continue;
    n++;
    w += range[i];
  }
  return n ? w / n : null;
}

/**
 * A weighted range (after postflop narrowing, say) as approximate standard notation: the
 * classes it holds most of, and the classes it holds less often. Each class is scored by the
 * share of its live combos the range keeps, relative to the most-kept class, so card removal
 * doesn't thin a class and several streets of narrowing don't empty the text.
 */
export function summarizeRange(range: Range, dead: readonly Card[]): RangeSummary {
  const d = new Set(dead);
  const kept = new Map<HandClass, number>();
  for (const cls of ALL_CLASSES) {
    const k = keptShareOf(range, cls, d);
    if (k !== null && k > 0) kept.set(cls, k);
  }
  const top = Math.max(0, ...kept.values());
  const coreClasses = new Set<HandClass>(), partialClasses = new Set<HandClass>();
  for (const [cls, k] of kept) {
    if (k >= RANGE_TEXT_CORE * top) coreClasses.add(cls);
    else if (k >= RANGE_TEXT_PARTIAL * top) partialClasses.add(cls);
  }
  return {
    core: compressClasses(coreClasses).join(', '),
    partial: compressClasses(partialClasses).join(', '),
    coreClasses,
    partialClasses,
    top,
  };
}

// ---- Card removal and counting ----

/** Copy of the range with every combo that uses a dead card removed. */
export function removeDead(range: Range, dead: readonly Card[]): Range {
  const out = new Float32Array(range);
  for (let i = 0; i < NUM_COMBOS; i++) {
    const [a, b] = COMBO_CARDS[i];
    if (dead.includes(a) || dead.includes(b)) out[i] = 0;
  }
  return out;
}

/** Weighted combo count (sum of weights). */
export function comboCount(range: Range): number {
  let s = 0;
  for (let i = 0; i < NUM_COMBOS; i++) s += range[i];
  return s;
}

export interface ClassCount {
  /** Weighted combos still live after card removal. */
  combos: number;
  /** Combos of this class that exist at all with these dead cards (before range weights). */
  available: number;
  /** Combos in the range before card removal. */
  base: number;
}

export function classCounts(range: Range, dead: readonly Card[] = []): Map<HandClass, ClassCount> {
  const deadM = new Uint8Array(52);
  for (const c of dead) deadM[c] = 1;
  const out = new Map<HandClass, ClassCount>();
  for (const cls of ALL_CLASSES) {
    let combos = 0, available = 0, base = 0;
    for (const i of CLASS_COMBOS.get(cls)!) {
      const [a, b] = COMBO_CARDS[i];
      base += range[i];
      if (deadM[a] || deadM[b]) continue;
      available++;
      combos += range[i];
    }
    out.set(cls, { combos, available, base });
  }
  return out;
}

/** Fraction of all possible starting hands (1326 combos) the range covers. */
export const rangePercent = (range: Range): number => comboCount(range) / NUM_COMBOS;

export const comboLabel = (i: number): string => {
  const [a, b] = COMBO_CARDS[i];
  return formatCard(a) + formatCard(b);
};

/** All suits for a class, e.g. for tooltips: "AsKs AhKh ...". */
export function combosOfClass(cls: HandClass): [Card, Card][] {
  return CLASS_COMBOS.get(cls)!.map((i) => [...COMBO_CARDS[i]] as [Card, Card]);
}

