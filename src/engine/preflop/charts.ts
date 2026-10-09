// Preflop charts loaded from data/preflop/*.json, with the low-stakes adjustment layer.
// A strategy is two weighted ranges (raise, call); whatever weight is left over folds.

import rfiJson from '../../../data/preflop/rfi.json';
import vsOpenJson from '../../../data/preflop/vs-open.json';
import vs3betJson from '../../../data/preflop/vs-3bet.json';
import vs4betJson from '../../../data/preflop/vs-4bet.json';
import otherJson from '../../../data/preflop/other.json';
import lowstakesJson from '../../../data/preflop/lowstakes.json';
import { CLASS_COMBOS, NUM_COMBOS, parseRange, type HandClass, type Range } from '../range';
import type { Position } from '../positions';

export type SpotKind = 'rfi' | 'vsOpen' | 'vs3bet' | 'vs4bet' | 'squeeze' | 'cold4bet' | 'vsJam' | 'vsLimp';
export type Choice = 'raise' | 'call' | 'fold';

/** Who a strategy is for: opponents use the pool adjustments, the hero gets the hero adjustments. */
export type Audience = 'baseline' | 'pool' | 'hero';

export interface ChartEntry {
  raise: string;
  call?: string;
  /** Big blinds (rfi), multiple of the last raise, or 'allin'. */
  size?: number | 'allin';
  perCaller?: number;
}

export interface Strategy {
  raise: Range;
  call: Range;
  /** Chart key used, e.g. "BB_vs_BTN". */
  key: string;
  entry: ChartEntry;
  /** Notes from adjustment rules that changed this strategy. */
  notes: string[];
}

export interface Frequencies {
  raise: number;
  call: number;
  fold: number;
}

interface Rule {
  spot: SpotKind;
  from: Choice;
  to: Choice;
  hands: string;
  scale: number;
  note: string;
}

const strip = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith('_')));

export const CHARTS: Record<SpotKind, Record<string, ChartEntry>> = {
  rfi: strip(rfiJson) as Record<string, ChartEntry>,
  vsOpen: strip(vsOpenJson) as Record<string, ChartEntry>,
  vs3bet: strip(vs3betJson) as Record<string, ChartEntry>,
  vs4bet: strip(vs4betJson) as Record<string, ChartEntry>,
  squeeze: otherJson.squeeze as Record<string, ChartEntry>,
  cold4bet: { any: otherJson.cold4bet as ChartEntry },
  vsJam: { any: otherJson.vsJam as ChartEntry },
  vsLimp: Object.fromEntries(
    Object.entries(otherJson.vsLimp).filter(([, v]) => typeof v === 'object'),
  ) as Record<string, ChartEntry>,
};

export const LIMP_SIZING = { size: otherJson.vsLimp.size, perLimper: otherJson.vsLimp.perLimper };
export const LOWSTAKES = {
  pool: lowstakesJson.pool as Rule[],
  hero: lowstakesJson.hero as Rule[],
  isoExtraBB: lowstakesJson.sizes.isoExtraBB,
};

const cache = new Map<string, Strategy>();

/** Strategy for a chart entry, with the adjustment layer for `audience` applied when `lowStakes` is on. */
export function getStrategy(kind: SpotKind, key: string, audience: Audience = 'baseline', lowStakes = true): Strategy {
  const ck = `${kind}|${key}|${audience}|${lowStakes}`;
  const hit = cache.get(ck);
  if (hit) return hit;
  const entry = CHARTS[kind][key];
  if (!entry) throw new Error(`No ${kind} chart for ${key}`);
  const raise = parseRange(entry.raise);
  const call = parseRange(entry.call ?? '');
  const notes: string[] = [];
  if (lowStakes && audience !== 'baseline') {
    for (const rule of LOWSTAKES[audience]) {
      if (rule.spot !== kind) continue;
      if (applyRule(raise, call, rule)) notes.push(rule.note);
    }
  }
  const s: Strategy = { raise, call, key, entry, notes };
  cache.set(ck, s);
  return s;
}

function applyRule(raise: Range, call: Range, rule: Rule): boolean {
  const hands = parseRange(rule.hands);
  let changed = false;
  for (let i = 0; i < NUM_COMBOS; i++) {
    if (!hands[i]) continue;
    const f = { raise: raise[i], call: call[i], fold: Math.max(0, 1 - raise[i] - call[i]) };
    const moved = f[rule.from] * rule.scale;
    if (moved <= 0) continue;
    f[rule.from] -= moved;
    f[rule.to] += moved;
    raise[i] = f.raise;
    call[i] = f.call;
    changed = true;
  }
  return changed;
}

export function frequencies(s: Strategy, combo: number): Frequencies {
  const raise = s.raise[combo], call = s.call[combo];
  return { raise, call, fold: Math.max(0, 1 - raise - call) };
}

/** Average frequencies over a hand class (charts are class-level, so this is exact for them). */
export function classFrequencies(s: Strategy, cls: HandClass): Frequencies {
  const idx = CLASS_COMBOS.get(cls)!;
  let raise = 0, call = 0;
  for (const i of idx) { raise += s.raise[i]; call += s.call[i]; }
  raise /= idx.length;
  call /= idx.length;
  return { raise, call, fold: Math.max(0, 1 - raise - call) };
}

export function rfiPositions(): Position[] {
  return Object.keys(CHARTS.rfi) as Position[];
}
