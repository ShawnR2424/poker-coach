// Push/fold tournament spots: one player goes all-in first (everyone before them folded), and the
// players behind call or fold. Each player maximizes their own payout, in chips (chip EV) or in
// prize money by the Independent Chip Model (ICM), and the ranges are found by fictitious play:
// every player repeatedly answers the others' current ranges, and the ranges move toward those
// answers until they settle.
//
// Simplifications, also listed in docs/model.md: only the first caller plays (players after a
// caller fold); a player who folds is assumed to let the hand finish without them, so a fold by
// the first player to act ends the hand with the big blind taking the blinds; and equities are
// all-in preflop equities between hand classes, with card removal between the two hands only.

import { icmEquities } from './icm';
import { CLASS_SIZE, COMPAT_EQ, COMPAT_F, COMPAT_TOTAL, NUM_CLASSES } from './classEquity';

export type PayoutMode = 'chips' | 'final' | 'bubble';

/** Prize shares for 1st, 2nd, ... when `n` players are left. */
export const PAYOUTS: Record<Exclude<PayoutMode, 'chips'>, Record<number, number[]>> = {
  final: {
    6: [0.38, 0.24, 0.16, 0.1, 0.07, 0.05],
    9: [0.3, 0.2, 0.14, 0.1, 0.08, 0.06, 0.05, 0.04, 0.03],
  },
  bubble: {
    6: [0.4, 0.25, 0.17, 0.11, 0.07],
    9: [0.3, 0.2, 0.15, 0.11, 0.08, 0.06, 0.055, 0.045],
  },
};

export const payoutsFor = (mode: PayoutMode, players: number): number[] | null =>
  mode === 'chips' ? null : PAYOUTS[mode][players];

export interface TableSetup {
  /** Stacks in big blinds before the blinds and ante are posted, in preflop action order (SB and BB last). */
  stacks: number[];
  /** A big blind ante of one big blind, paid by the big blind. */
  ante: boolean;
  mode: PayoutMode;
  /** The first player to go all-in. */
  opener: number;
}

export const SB_BLIND = 0.5;
export const BB_BLIND = 1;

const sbOf = (n: number) => n - 2;
const bbOf = (n: number) => n - 1;

/** Chips each player has put in before acting (blind), and the dead ante. */
function posts(t: TableSetup): { blind: number[]; ante: number } {
  const n = t.stacks.length;
  const blind = new Array<number>(n).fill(0);
  blind[sbOf(n)] = Math.min(SB_BLIND, t.stacks[sbOf(n)]);
  const ante = t.ante ? Math.min(1, t.stacks[bbOf(n)] / 2) : 0;
  blind[bbOf(n)] = Math.min(BB_BLIND, t.stacks[bbOf(n)] - ante);
  return { blind, ante };
}

/**
 * Stacks after the hand. `caller` null: everyone folds to the opener's all-in. `walk`: the opener
 * folds too and the big blind takes the blinds. Otherwise the winner of the all-in takes the pot.
 */
export function stacksAfter(t: TableSetup, outcome: { walk: true } | { caller: number | null; openerWins?: boolean }): number[] {
  const n = t.stacks.length;
  const { blind, ante } = posts(t);
  const s = [...t.stacks];
  const bb = bbOf(n);
  if ('walk' in outcome) {
    // Everyone folds to the big blind, who gets their own blind and ante back plus the small blind.
    s[sbOf(n)] -= blind[sbOf(n)];
    s[bb] += blind[sbOf(n)];
    return s;
  }
  const o = t.opener, c = outcome.caller;
  s[bb] -= ante;
  let dead = ante;
  for (let i = 0; i < n; i++) {
    if (i === o || i === c) continue;
    s[i] -= blind[i];
    dead += blind[i];
  }
  if (c === null) {
    s[o] += dead;
    return s;
  }
  const eff = Math.min(s[o], s[c]);
  s[o] -= eff;
  s[c] -= eff;
  s[outcome.openerWins ? o : c] += 2 * eff + dead;
  return s;
}

/** Each player's payout for a set of stacks: chips, or their share of the prize pool by ICM. */
export function utilities(stacks: readonly number[], mode: PayoutMode): number[] {
  const pay = payoutsFor(mode, stacks.length);
  return pay ? icmEquities(stacks, pay) : [...stacks];
}

/** Payout of every player in every way the hand can end. */
export interface Outcomes {
  walk: number[];
  allFold: number[];
  /** By caller seat: the opener wins / the caller wins. */
  openerWins: number[][];
  callerWins: number[][];
}

export function outcomes(t: TableSetup): Outcomes {
  const n = t.stacks.length;
  const u = (s: number[]) => utilities(s, t.mode);
  const openerWins: number[][] = [], callerWins: number[][] = [];
  for (let c = t.opener + 1; c < n; c++) {
    openerWins[c] = u(stacksAfter(t, { caller: c, openerWins: true }));
    callerWins[c] = u(stacksAfter(t, { caller: c, openerWins: false }));
  }
  return { walk: u(stacksAfter(t, { walk: true })), allFold: u(stacksAfter(t, { caller: null })), openerWins, callerWins };
}

/** A range as each class's frequency of going all-in or calling (0..1). */
export type ClassRange = Float64Array;

export interface Solution {
  setup: TableSetup;
  out: Outcomes;
  /** The opener's all-in range. */
  push: ClassRange;
  /** Each caller's calling range, by seat. */
  call: ClassRange[];
}

// Local copies: reading an imported binding can go through a getter in some module loaders,
// which is slow in the inner loops.
const N = NUM_CLASSES;
const CF = COMPAT_F, CE = COMPAT_EQ, CT = COMPAT_TOTAL, SIZE = CLASS_SIZE;

/** Range `r` against a player holding class j: how often j faces it after card removal, and j's equity against it. */
export function hitRate(r: ClassRange, j: number): { eq: number; p: number } {
  let w = 0, we = 0;
  const row = j * N;
  for (let k = 0; k < N; k++) {
    const x = r[k];
    w += x * CF[row + k];
    we += x * CE[row + k];
  }
  return { eq: w > 0 ? we / w : 0.5, p: w / CT[j] };
}

/** How often a range acts, unconditionally (share of all 1326 hands). */
export const rangeShare = (r: ClassRange) => {
  let s = 0;
  for (let k = 0; k < N; k++) s += r[k] * SIZE[k];
  return s / 1326;
};

/** Range-vs-range all-in equity of `a` against `b`. */
function rangeEquity(a: ClassRange, b: ClassRange): number {
  let w = 0, we = 0;
  for (let j = 0; j < N; j++) {
    const x = a[j];
    if (x === 0) continue;
    const row = j * N;
    let rw = 0, re = 0;
    for (let k = 0; k < N; k++) {
      rw += b[k] * CF[row + k];
      re += b[k] * CE[row + k];
    }
    w += x * rw;
    we += x * re;
  }
  return w > 0 ? we / w : 0.5;
}

/** What every decision reads from the current ranges, computed once per pass. */
interface Reads {
  /** Each class's equity against the all-in range, after card removal. */
  vsPush: Float64Array;
  /** By caller seat: how often they call, and the all-in range's equity against their calls. */
  share: number[];
  pushEq: number[];
}

function reads(s: Pick<Solution, 'setup' | 'push' | 'call'>): Reads {
  const n = s.setup.stacks.length;
  const vsPush = new Float64Array(N);
  for (let k = 0; k < N; k++) vsPush[k] = hitRate(s.push, k).eq;
  const share: number[] = [], pushEq: number[] = [];
  for (let c = s.setup.opener + 1; c < n; c++) {
    share[c] = rangeShare(s.call[c]);
    pushEq[c] = share[c] > 0 ? rangeEquity(s.push, s.call[c]) : 0.5;
  }
  return { vsPush, share, pushEq };
}

/** The opener's payout from going all-in with class j, and from folding. */
export function openerValues(s: Pick<Solution, 'setup' | 'out' | 'call'>, j: number): { play: number; fold: number; foldOdds: number; calledEquity: number } {
  const { setup: t, out } = s;
  const o = t.opener, n = t.stacks.length;
  let reach = 1, ev = 0, calledW = 0, calledEq = 0;
  for (let c = o + 1; c < n; c++) {
    const h = hitRate(s.call[c], j);
    const q = h.p;
    ev += reach * q * (h.eq * out.openerWins[c][o] + (1 - h.eq) * out.callerWins[c][o]);
    calledW += reach * q;
    calledEq += reach * q * h.eq;
    reach *= 1 - q;
  }
  ev += reach * out.allFold[o];
  return { play: ev, fold: out.walk[o], foldOdds: reach, calledEquity: calledW > 0 ? calledEq / calledW : 0.5 };
}

/** A caller's payout from folding: the players after them may still call the all-in. */
function foldValue(s: Pick<Solution, 'setup' | 'out'>, r: Reads, c: number): number {
  const { setup: t, out } = s;
  let reach = 1, ev = 0;
  for (let d = c + 1; d < t.stacks.length; d++) {
    const q = r.share[d], e = r.pushEq[d];
    ev += reach * q * (e * out.openerWins[d][c] + (1 - e) * out.callerWins[d][c]);
    reach *= 1 - q;
  }
  return ev + reach * out.allFold[c];
}

/** A caller's payout from calling with class k, from folding, and their equity against the all-in. */
export function callerValues(s: Pick<Solution, 'setup' | 'out' | 'call' | 'push'>, c: number, k: number, r: Reads = reads(s)): { play: number; fold: number; equity: number } {
  const { out } = s;
  const eq = r.vsPush[k];
  return { play: eq * out.callerWins[c][c] + (1 - eq) * out.openerWins[c][c], fold: foldValue(s, r, c), equity: eq };
}

export const ITERATIONS = 150;

/**
 * The callers' best answers to an all-in range, from the last player to act back to the first:
 * each caller knows how the players after them answer.
 */
function answerCallers(s: Solution): void {
  const { setup: t, out } = s;
  const n = t.stacks.length;
  const r: Reads = { vsPush: new Float64Array(N), share: [], pushEq: [] };
  for (let k = 0; k < N; k++) r.vsPush[k] = hitRate(s.push, k).eq;
  for (let c = n - 1; c > t.opener; c--) {
    const fold = foldValue(s, r, c);
    const win = out.callerWins[c][c], lose = out.openerWins[c][c];
    const range = new Float64Array(N);
    for (let k = 0; k < N; k++) {
      const play = r.vsPush[k] * win + (1 - r.vsPush[k]) * lose;
      range[k] = play > fold + 1e-12 ? 1 : play < fold - 1e-12 ? 0 : 0.5;
    }
    s.call[c] = range;
    r.share[c] = rangeShare(range);
    r.pushEq[c] = r.share[c] > 0 ? rangeEquity(s.push, range) : 0.5;
  }
}

/**
 * Solves a spot: the opener's all-in range and every caller's calling range. The callers answer
 * the opener's range exactly; the opener's range moves toward its best answer to them by
 * fictitious play (an average of its answers), so hands on the edge end up mixed.
 */
export function solve(t: TableSetup, iterations = ITERATIONS): Solution {
  const n = t.stacks.length;
  if (t.opener < 0 || t.opener > n - 2) throw new Error('The opener must act before the big blind');
  const out = outcomes(t);
  const s: Solution = { setup: t, out, push: new Float64Array(N).fill(0.5), call: [] };
  for (let it = 0; it < iterations; it++) {
    answerCallers(s);
    const step = 1 / (it + 2);
    for (let j = 0; j < N; j++) {
      const v = openerValues(s, j);
      const best = v.play > v.fold + 1e-12 ? 1 : v.play < v.fold - 1e-12 ? 0 : 0.5;
      s.push[j] += (best - s.push[j]) * step;
    }
  }
  // The average keeps a trace of the early passes: a hand played under 5% or over 95% of the time
  // is rounded to never or always.
  for (let j = 0; j < N; j++) s.push[j] = s.push[j] < 0.05 ? 0 : s.push[j] > 0.95 ? 1 : s.push[j];
  answerCallers(s);
  return s;
}

/** The hero's two options in a solved spot: all-in or call (`play`) and fold, in payout units. */
export function heroValues(s: Solution, hero: number, cls: number) {
  if (hero === s.setup.opener) {
    const v = openerValues(s, cls);
    return { ...v, equity: v.calledEquity };
  }
  return { ...callerValues(s, hero, cls), foldOdds: null as number | null, calledEquity: null as number | null };
}

/** Payout units per big blind: 1 in chip EV; with ICM, the prize pool spread evenly over the chips in play. */
export const unitPerBB = (t: TableSetup) => (t.mode === 'chips' ? 1 : 1 / t.stacks.reduce((a, b) => a + b, 0));
