// The chart explorer: every preflop chart the trainer plays, named in plain words, with its
// size, how much of the deck each action takes, and which hands the depth, rake and low-stakes
// layers changed from the plain 100bb chart.

import { ALL_CLASSES, formatRange, NUM_COMBOS, type HandClass } from '../range';
import {
  CHARTS, classFrequencies, depthSizes, getStrategy, LIMP_SIZING, LOWSTAKES,
  type Audience, type Depth, type Frequencies, type SpotKind, type Strategy,
} from './charts';
import { choiceName } from './coach';

/** Spot types in the order a hand reaches them. */
export const CHART_KINDS: { kind: SpotKind; label: string }[] = [
  { kind: 'rfi', label: 'Open when folded to' },
  { kind: 'vsLimp', label: 'Facing limpers' },
  { kind: 'vsOpen', label: 'Facing an open' },
  { kind: 'squeeze', label: 'Squeeze (open and a caller)' },
  { kind: 'vs3bet', label: 'Your open is 3-bet' },
  { kind: 'cold4bet', label: 'Cold 4-bet' },
  { kind: 'vs4bet', label: 'Your 3-bet is 4-bet' },
  { kind: 'vsJam', label: 'Facing an all-in' },
];

const SEAT: Record<string, string> = {
  EP: 'early seat', EP1: 'EP1 (the seat before the LJ, 7-9 handed)', EP2: 'EP2 (8-9 handed)', EP3: 'EP3 (UTG at 9-handed)',
};
const seat = (s: string) => SEAT[s] ?? s;

/** A plain name for one chart, e.g. "BB facing a BTN open". */
export function chartLabel(kind: SpotKind, key: string): string {
  switch (kind) {
    case 'rfi': return `${seat(key)} opens`;
    case 'vsOpen': {
      const [me, them] = key.split('_vs_');
      return `${seat(me)} facing ${them === 'EP' ? 'an early-seat' : `a ${them}`} open`;
    }
    case 'vs3bet': {
      const [me, by] = key.split('_vs_');
      return `${seat(me)} open, 3-bet ${by === 'IP' ? 'by a player behind you' : 'from the blinds'}`;
    }
    case 'vs4bet': return key === 'IP' ? 'Your 3-bet in position is 4-bet' : 'Your 3-bet out of position is 4-bet';
    case 'squeeze': return key === 'IP' ? 'Squeeze in position' : 'Squeeze from the blinds';
    case 'cold4bet': return 'Facing an open and a 3-bet';
    case 'vsJam': return 'Facing an all-in after you raised';
    case 'vsLimp': return `${seat(key)} facing limpers`;
  }
}

/** Every chart of a kind, in the order the data lists them. */
export const chartKeys = (kind: SpotKind): { key: string; label: string }[] =>
  Object.keys(CHARTS[kind]).map((key) => ({ key, label: chartLabel(kind, key) }));

/** What each column of a chart is called: the BB checks rather than folds against limpers. */
export const choiceNames = (kind: SpotKind, key: string) => {
  const canCheck = kind === 'vsLimp' && key === 'BB';
  return { raise: choiceName(kind, 'raise', canCheck), call: choiceName(kind, 'call', canCheck), fold: choiceName(kind, 'fold', canCheck) };
};

export interface ExploreOptions {
  audience: Exclude<Audience, 'baseline'>;
  lowStakes: boolean;
  depth: Depth;
  raked: boolean;
}

const num = (x: number) => `${+x.toFixed(2)}`;

/** The chart's raise size in words, at this depth. */
export function sizeText(kind: SpotKind, key: string, o: ExploreOptions): string {
  const entry = CHARTS[kind][key];
  const sz = depthSizes(o.depth);
  const allIn = entry.size === 'allin';
  switch (kind) {
    case 'rfi': return `${num(Math.min(entry.size as number, sz.rfiMax))}bb`;
    case 'vsOpen': return allIn ? 'all-in' : `${num((entry.size as number) * sz.raiseScale)}x the open`;
    case 'squeeze': return `${num((entry.size as number) * sz.raiseScale)}x the open, plus ${num((entry.perCaller ?? 1) * sz.raiseScale)}x per caller`;
    case 'vs3bet':
    case 'cold4bet': return sz.fourBetAllIn || allIn ? 'all-in' : `${num((entry.size as number) * sz.fourBetScale)}x the 3-bet`;
    case 'vs4bet':
    case 'vsJam': return 'all-in';
    case 'vsLimp': {
      const extra = o.lowStakes ? LOWSTAKES.isoExtraBB : 0;
      return `${num(LIMP_SIZING.size + extra)}bb plus ${num(LIMP_SIZING.perLimper)}bb per limper${key === 'SB' || key === 'BB' ? ', and 1bb more from the blinds' : ''}`;
    }
  }
}

export const exploreStrategy = (kind: SpotKind, key: string, o: ExploreOptions): Strategy =>
  getStrategy(kind, key, o.audience, o.lowStakes, o.depth, o.raked);

/** The plain 100bb chart with no adjustments, which the layers are measured against. */
export const baseStrategy = (kind: SpotKind, key: string): Strategy => getStrategy(kind, key, 'baseline', false, 100, false);

export interface ChartShares {
  raise: number;
  call: number;
  fold: number;
}

/** Share of all 1326 starting hands that take each action. */
export function shares(s: Strategy): ChartShares {
  let raise = 0, call = 0;
  for (let i = 0; i < NUM_COMBOS; i++) { raise += s.raise[i]; call += s.call[i]; }
  return { raise: raise / NUM_COMBOS, call: call / NUM_COMBOS, fold: 1 - (raise + call) / NUM_COMBOS };
}

/** The chart's raise and call ranges in standard notation. */
export const rangeTexts = (s: Strategy) => ({ raise: formatRange(s.raise), call: formatRange(s.call) });

export interface ClassChange {
  cls: HandClass;
  before: Frequencies;
  after: Frequencies;
}

/** Hand classes whose frequencies differ from the plain chart by at least `min` in any action, biggest change first. */
export function changesFrom(base: Strategy, s: Strategy, min = 0.01): ClassChange[] {
  const out: ClassChange[] = [];
  for (const cls of ALL_CLASSES) {
    const before = classFrequencies(base, cls), after = classFrequencies(s, cls);
    if (Math.abs(before.raise - after.raise) >= min || Math.abs(before.call - after.call) >= min || Math.abs(before.fold - after.fold) >= min) {
      out.push({ cls, before, after });
    }
  }
  const moved = (c: ClassChange) => Math.abs(c.after.raise - c.before.raise) + Math.abs(c.after.call - c.before.call) + Math.abs(c.after.fold - c.before.fold);
  return out.sort((a, b) => moved(b) - moved(a));
}

