// Range quizzes: the trainer deals a 6-max preflop line, the player paints the opponent's range on the
// 13x13 grid and then estimates their equity against it on a flop. Both answers are scored against
// the trainer's own numbers: the range against the chart the opponents play, the equity against an
// exact enumeration of turns and rivers.

import type { Card } from '../cards';
import { CHARTS, getStrategy, type SpotKind } from '../preflop/charts';
import type { Position } from '../positions';
import { ALL_CLASSES, CLASS_COMBOS, COMBO_CARDS, NUM_COMBOS, type HandClass, type Range } from '../range';
import { randInt, type Rng } from '../rng';

/** What the opponent did: opened, called the player's open, or 3-bet it. */
export type QuizKind = 'open' | 'call' | 'threeBet';
export const QUIZ_KINDS: QuizKind[] = ['open', 'call', 'threeBet'];
export const KIND_LABEL: Record<QuizKind, string> = { open: 'Opens', call: 'Calls your open', threeBet: '3-bets your open' };

const SIX_MAX: Position[] = ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
const NAME: Record<string, string> = { UTG: 'UTG player', HJ: 'hijack', CO: 'cutoff', BTN: 'button', SB: 'small blind', BB: 'big blind' };
/** Where the player sits, as a phrase: "under the gun", "on the button", "in the big blind". */
const seatPhrase = (p: Position) => (p === 'UTG' ? 'under the gun' : isBlind(p) ? `in the ${NAME[p]}` : `on the ${NAME[p]}`);

export interface QuizOptions {
  /** Use the low-stakes pool adjustments the trainer's opponents play with (as on the Play tab). */
  lowStakes: boolean;
  /** Which lines to deal; all of them when empty. */
  kinds?: readonly QuizKind[];
}

export interface Quiz {
  kind: QuizKind;
  hero: Position;
  villain: Position;
  /** The chart the opponent's range comes from, e.g. "vsOpen BB_vs_BTN call". */
  source: string;
  /** What happened preflop, in plain words. */
  story: string;
  /** What the range question asks to paint. */
  rangeAsk: string;
  /** The opponent's range for that action (weights are frequencies). */
  range: Range;
  hand: [Card, Card];
  board: Card[];
}

interface Line {
  kind: QuizKind;
  hero: Position;
  villain: Position;
  villainChart: [SpotKind, string, 'raise' | 'call'];
  heroChart: [SpotKind, string, 'raise' | 'call'];
}

const seatAfter = (a: Position, b: Position) => SIX_MAX.indexOf(a) > SIX_MAX.indexOf(b);
const isBlind = (p: Position) => p === 'SB' || p === 'BB';

/** Every 6-max line the charts can answer, with the chart for each side. */
function lines(): Line[] {
  const out: Line[] = [];
  for (const key of Object.keys(CHARTS.vsOpen)) {
    const [caller, opener] = key.split('_vs_') as [Position, Position];
    if (!SIX_MAX.includes(caller) || !SIX_MAX.includes(opener) || !seatAfter(caller, opener)) continue;
    const entry = CHARTS.vsOpen[key];
    const threeBetKey = `${opener}_vs_${isBlind(caller) ? 'blinds' : 'IP'}`;
    // The player faces an open and calls it.
    if (entry.call) {
      out.push({ kind: 'open', hero: caller, villain: opener, villainChart: ['rfi', opener, 'raise'], heroChart: ['vsOpen', key, 'call'] });
      out.push({ kind: 'call', hero: opener, villain: caller, villainChart: ['vsOpen', key, 'call'], heroChart: ['rfi', opener, 'raise'] });
    }
    if (CHARTS.vs3bet[threeBetKey]?.call) {
      out.push({ kind: 'threeBet', hero: opener, villain: caller, villainChart: ['vsOpen', key, 'raise'], heroChart: ['vs3bet', threeBetKey, 'call'] });
    }
  }
  return out;
}
const LINES = lines();

/** Number of distinct lines a quiz can deal for each kind (for tests and the screen). */
export const lineCount = (kind: QuizKind) => LINES.filter((l) => l.kind === kind).length;

function sampleCombo(range: Range, rng: Rng): [Card, Card] {
  let total = 0;
  for (let i = 0; i < NUM_COMBOS; i++) total += range[i];
  let x = rng() * total;
  for (let i = 0; i < NUM_COMBOS; i++) {
    x -= range[i];
    if (x < 0 && range[i] > 0) return [...COMBO_CARDS[i]] as [Card, Card];
  }
  for (let i = NUM_COMBOS - 1; i >= 0; i--) if (range[i] > 0) return [...COMBO_CARDS[i]] as [Card, Card];
  throw new Error('Empty range');
}

function dealBoard(dead: readonly Card[], rng: Rng): Card[] {
  const used = new Set(dead);
  const board: Card[] = [];
  while (board.length < 3) {
    const c = randInt(rng, 52);
    if (!used.has(c)) {
      used.add(c);
      board.push(c);
    }
  }
  return board;
}

const bb = (x: number) => `${+x.toFixed(2)}bb`;

function tell(l: Line, lowStakes: boolean): { story: string; rangeAsk: string } {
  const v = NAME[l.villain], h = seatPhrase(l.hero);
  const open = CHARTS.rfi[l.kind === 'open' ? l.villain : l.hero].size as number;
  const vsOpen = CHARTS.vsOpen[l.kind === 'open' ? `${l.hero}_vs_${l.villain}` : `${l.villain}_vs_${l.hero}`];
  // ", everyone in between folds," when seats sit between the two players, else nothing.
  const between = (from: Position, to: Position) => (SIX_MAX.indexOf(to) - SIX_MAX.indexOf(from) > 1 ? ', everyone in between folds,' : '');
  if (l.kind === 'open') {
    const first = l.villain === 'UTG' ? 'opens' : 'is first in and opens';
    return {
      story: `The ${v} ${first} to ${bb(open)}${between(l.villain, l.hero) || ','} and you call ${h}.${l.hero === 'BB' ? '' : ' Everyone else folds.'}`,
      rangeAsk: `Paint the hands the ${v} opens with${lowStakes ? ' (a typical low-stakes player)' : ''}.`,
    };
  }
  const threeBet = (vsOpen.size as number) * open;
  if (l.kind === 'call') {
    return {
      story: `You open to ${bb(open)} ${h}${between(l.hero, l.villain)} and the ${v} calls.${l.villain === 'BB' ? '' : ' Everyone else folds.'}`,
      rangeAsk: `Paint the hands the ${v} calls with${lowStakes ? ' (a typical low-stakes player)' : ''}. Hands they would 3-bet instead are not part of it.`,
    };
  }
  return {
    story: `You open to ${bb(open)} ${h}, the ${v} 3-bets to ${bb(threeBet)}, and you call.`,
    rangeAsk: `Paint the hands the ${v} 3-bets with${lowStakes ? ' (a typical low-stakes player)' : ''}.`,
  };
}

/** Deals a quiz: a line, the player's hand from their own range for it, and a flop. */
export function makeQuiz(rng: Rng, opts: QuizOptions): Quiz {
  const kinds = opts.kinds?.length ? opts.kinds : QUIZ_KINDS;
  const pool = LINES.filter((l) => kinds.includes(l.kind));
  const l = pool[randInt(rng, pool.length)];
  const [vk, vkey, vside] = l.villainChart;
  const range = new Float32Array(getStrategy(vk, vkey, 'pool', opts.lowStakes)[vside]);
  const [hk, hkey, hside] = l.heroChart;
  const hand = sampleCombo(getStrategy(hk, hkey, 'baseline', false)[hside], rng);
  const board = dealBoard(hand, rng);
  return { kind: l.kind, hero: l.hero, villain: l.villain, source: `${vk} ${vkey} ${vside}`, ...tell(l, opts.lowStakes), range, hand, board };
}

// ---- Scoring the range ----

/** Each class's share of combos in a range (the chart frequency for chart ranges). */
export function classShares(range: Range): Map<HandClass, number> {
  const out = new Map<HandClass, number>();
  for (const cls of ALL_CLASSES) {
    const idx = CLASS_COMBOS.get(cls)!;
    let w = 0;
    for (const i of idx) w += range[i];
    out.set(cls, w / idx.length);
  }
  return out;
}

export type CellMark = 'hit' | 'partial' | 'missed' | 'extra' | 'out';

export interface RangeScore {
  /** Weighted overlap of the painted and true ranges: combos in both over combos in either, 0..1. */
  match: number;
  /**
   * The best match any painting can reach. Painting is all or nothing per hand, so a range that
   * plays hands some of the time can't be matched exactly (a 3-bet range full of 50% hands tops out
   * near 75%).
   */
  best: number;
  /** Share of all 1326 combos in the painted and the true range. */
  paintedPct: number;
  truePct: number;
  /** True combos the player painted, and painted combos that are not in the range. */
  caught: number;
  missed: number;
  extra: number;
  /** Per class: how the painting compares with the range. */
  cells: Map<HandClass, { share: number; painted: boolean; mark: CellMark }>;
}

/**
 * Scores a painted set of classes against a weighted range. A class the range plays some of the
 * time counts by its frequency: painting a 50% class catches half its combos and wastes the other half.
 */
export function scoreRange(painted: ReadonlySet<HandClass>, range: Range): RangeScore {
  const shares = classShares(range);
  let both = 0, either = 0, mine = 0, theirs = 0, missed = 0, extra = 0;
  const cells = new Map<HandClass, { share: number; painted: boolean; mark: CellMark }>();
  for (const cls of ALL_CLASSES) {
    const n = CLASS_COMBOS.get(cls)!.length;
    const t = shares.get(cls)! * n;
    const p = painted.has(cls) ? n : 0;
    both += Math.min(t, p);
    either += Math.max(t, p);
    mine += p;
    theirs += t;
    if (p) extra += p - t;
    else missed += t;
    const share = shares.get(cls)!;
    const mark: CellMark = p ? (share >= 0.75 ? 'hit' : share > 0 ? 'partial' : 'extra') : share > 0 ? 'missed' : 'out';
    cells.set(cls, { share, painted: p > 0, mark });
  }
  return {
    match: either ? both / either : 1,
    best: bestMatch(range),
    paintedPct: mine / NUM_COMBOS,
    truePct: theirs / NUM_COMBOS,
    caught: both,
    missed,
    extra,
    cells,
  };
}

/**
 * The highest weighted overlap an all-or-nothing painting can reach. Adding a hand that the range
 * plays with frequency s raises the overlap exactly when s is above the current overlap, so the best
 * painting is every hand played at least some threshold of the time; this tries each threshold.
 */
export function bestMatch(range: Range): number {
  const shares = [...classShares(range)].map(([cls, s]) => ({ s, n: CLASS_COMBOS.get(cls)!.length })).filter((c) => c.s > 0);
  if (!shares.length) return 1;
  const total = shares.reduce((a, c) => a + c.s * c.n, 0);
  shares.sort((a, b) => b.s - a.s);
  let both = 0, painted = 0, best = 0;
  for (const c of shares) {
    both += c.s * c.n;
    painted += c.n;
    // Painted hands all lie inside the range's classes, so "either" is the painted combos plus the
    // range's combos in hands not painted yet.
    best = Math.max(best, both / (painted + (total - both)));
  }
  return best;
}

/** The painting that reaches `bestMatch`. */
export function bestPainting(range: Range): Set<HandClass> {
  const shares = [...classShares(range)].filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]);
  const target = bestMatch(range);
  const out = new Set<HandClass>();
  for (const [cls] of shares) {
    out.add(cls);
    if (scoreRange(out, range).match >= target - 1e-9) break;
  }
  return out;
}

// ---- Scoring the equity ----

export type EquityBand = 'spot on' | 'close' | 'off' | 'far off';

/** Bands for an equity guess, in percentage points away from the true equity. */
export const EQUITY_BANDS: { band: EquityBand; within: number }[] = [
  { band: 'spot on', within: 3 },
  { band: 'close', within: 7 },
  { band: 'off', within: 15 },
  { band: 'far off', within: Infinity },
];

export function equityBand(guessPct: number, truePct: number): EquityBand {
  const miss = Math.abs(guessPct - truePct);
  return EQUITY_BANDS.find((b) => miss <= b.within)!.band;
}

/** Range match bands, by the match as a share of the best painting could reach. */
export function rangeBand(match: number, best = 1): 'spot on' | 'close' | 'off' | 'far off' {
  const r = best > 0 ? match / best : 0;
  return r >= 0.85 ? 'spot on' : r >= 0.65 ? 'close' : r >= 0.45 ? 'off' : 'far off';
}

// ---- History ----

export interface QuizResult {
  at: string;
  kind: QuizKind;
  /** Range match, 0..1. */
  match: number;
  /** The best match a painting could reach on that range. */
  best: number;
  /** Painted minus true range size, in percentage points of all hands (positive = too wide). */
  widthMiss: number;
  /** Equity guess minus the true equity, in percentage points (absent if the player skipped it). */
  equityMiss?: number;
}

export const HISTORY_MAX = 200;

export function addResult(history: readonly QuizResult[], r: QuizResult): QuizResult[] {
  return [...history, r].slice(-HISTORY_MAX);
}

export interface QuizSummary {
  count: number;
  /** Average range match over the latest `window` quizzes. */
  match: number | null;
  /** Average range match as a share of the best each painting could reach. */
  ofBest: number | null;
  /** Average painted-minus-true width: positive means painting too wide. */
  width: number | null;
  /** Average absolute equity miss in points, and the average signed miss (positive = guessing high). */
  equityMiss: number | null;
  equityBias: number | null;
  /** Average range match per kind, over the same window. */
  byKind: Partial<Record<QuizKind, { count: number; match: number }>>;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function summarizeQuizzes(history: readonly QuizResult[], window = 20): QuizSummary {
  const recent = history.slice(-window);
  const eq = recent.flatMap((r) => (r.equityMiss === undefined ? [] : [r.equityMiss]));
  const byKind: QuizSummary['byKind'] = {};
  for (const k of QUIZ_KINDS) {
    const rs = recent.filter((r) => r.kind === k);
    if (rs.length) byKind[k] = { count: rs.length, match: mean(rs.map((r) => r.match))! };
  }
  return {
    count: history.length,
    match: mean(recent.map((r) => r.match)),
    ofBest: mean(recent.map((r) => (r.best > 0 ? r.match / r.best : 0))),
    width: mean(recent.map((r) => r.widthMiss)),
    equityMiss: mean(eq.map(Math.abs)),
    equityBias: mean(eq),
    byKind,
  };
}

/** Reads saved quiz history, dropping anything malformed. */
export function parseHistory(raw: string | null): QuizResult[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v.filter(
      (r): r is QuizResult =>
        r && typeof r.at === 'string' && QUIZ_KINDS.includes(r.kind) && typeof r.match === 'number' && typeof r.best === 'number' && typeof r.widthMiss === 'number' &&
        (r.equityMiss === undefined || typeof r.equityMiss === 'number'),
    ).slice(-HISTORY_MAX);
  } catch {
    return [];
  }
}
