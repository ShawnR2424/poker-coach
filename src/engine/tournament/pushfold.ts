// Push/fold tournament spots: one player goes all-in first (everyone before them folded), and the
// players behind call or fold. Each player maximizes their own payout, in chips (chip EV) or in
// prize money by the Independent Chip Model (ICM), and the ranges are found by fictitious play:
// every player repeatedly answers the others' current ranges, and the ranges move toward those
// answers until they settle.
//
// After a call, each player behind may overcall, making a three-way all-in with a side pot; once
// someone has overcalled, the rest fold. Simplifications, also listed in docs/model.md: no fourth
// player joins; a player who folds is assumed to let the hand finish without them, so a fold by
// the first player to act ends the hand with the big blind taking the blinds; equities are all-in
// preflop equities between hand classes, with card removal between the two hands only; and a
// three-way all-in is estimated from the three head-to-head equities.

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

/** The six finishing orders of a three-way all-in: indexes into [opener, caller, overcaller], best hand first. */
export const ORDERS: readonly (readonly [number, number, number])[] = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];

/**
 * Stacks after a three-way all-in between the opener, a caller and an overcaller, when the hands
 * finish in `order` (best first). Each player puts in at most what the biggest other stack can
 * match; the main pot (with the blinds and ante) goes to the best hand, a side pot between the two
 * bigger stacks to the better of those two.
 */
export function stacksAfterThree(t: TableSetup, caller: number, over: number, order: readonly [number, number, number]): number[] {
  const n = t.stacks.length;
  const { blind, ante } = posts(t);
  const s = [...t.stacks];
  const seats = [t.opener, caller, over];
  s[bbOf(n)] -= ante;
  let dead = ante;
  for (let i = 0; i < n; i++) {
    if (seats.includes(i)) continue;
    s[i] -= blind[i];
    dead += blind[i];
  }
  const put = seats.map((x, i) => Math.min(s[x], Math.max(...seats.filter((_, j) => j !== i).map((y) => s[y]))));
  seats.forEach((x, i) => { s[x] -= put[i]; });
  // Pots by level: each level is shared by everyone who put in at least that much.
  const levels = [...new Set(put)].sort((a, b) => a - b);
  let below = 0;
  for (const level of levels) {
    const inIt = [0, 1, 2].filter((i) => put[i] >= level);
    let pot = (level - below) * inIt.length;
    if (below === 0) pot += dead;
    const winner = order.find((i) => inIt.includes(i))!;
    s[seats[winner]] += pot;
    below = level;
  }
  return s;
}

/**
 * How likely each finishing order of a three-way all-in is, from the head-to-head equities: `ab` is
 * how often A beats B heads-up, and so on. A wins the three-way pot in proportion to how often it
 * beats both others, and the two left finish in their head-to-head order. A standard estimate when
 * only pairwise equities are known.
 */
export function orderOdds(ab: number, ac: number, bc: number): number[] {
  const wa = ab * ac, wb = (1 - ab) * bc, wc = (1 - ac) * (1 - bc);
  const tot = wa + wb + wc || 1;
  const pa = wa / tot, pb = wb / tot, pc = wc / tot;
  return [pa * bc, pa * (1 - bc), pb * ac, pb * (1 - ac), pc * ab, pc * (1 - ab)];
}

/** Payout to the player in `seat` over the finishing orders, with `orderOdds(ab, ac, bc)` worked inline (it runs in the inner loops). */
function threeWay(ab: number, ac: number, bc: number, payouts: number[][], seat: number): number {
  const wa = ab * ac, wb = (1 - ab) * bc, wc = (1 - ac) * (1 - bc);
  const tot = wa + wb + wc || 1;
  return (
    (wa * (bc * payouts[0][seat] + (1 - bc) * payouts[1][seat]) +
      wb * (ac * payouts[2][seat] + (1 - ac) * payouts[3][seat]) +
      wc * (ab * payouts[4][seat] + (1 - ab) * payouts[5][seat])) / tot
  );
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
  /** By caller and overcaller seat: every player's payout for each finishing order in ORDERS. */
  three: number[][][][];
}

export function outcomes(t: TableSetup): Outcomes {
  const n = t.stacks.length;
  const u = (s: number[]) => utilities(s, t.mode);
  const openerWins: number[][] = [], callerWins: number[][] = [];
  const three: number[][][][] = [];
  for (let c = t.opener + 1; c < n; c++) {
    openerWins[c] = u(stacksAfter(t, { caller: c, openerWins: true }));
    callerWins[c] = u(stacksAfter(t, { caller: c, openerWins: false }));
    three[c] = [];
    for (let d = c + 1; d < n; d++) three[c][d] = ORDERS.map((order) => u(stacksAfterThree(t, c, d, order)));
  }
  return { walk: u(stacksAfter(t, { walk: true })), allFold: u(stacksAfter(t, { caller: null })), openerWins, callerWins, three };
}

/** A range as each class's frequency of going all-in or calling (0..1). */
export type ClassRange = Float64Array;

export interface Solution {
  setup: TableSetup;
  out: Outcomes;
  /** The opener's all-in range. */
  push: ClassRange;
  /** Each caller's calling range, by seat, when everyone between the opener and them folded. */
  call: ClassRange[];
  /** By first caller and seat: the overcalling range of a player behind a call. */
  over: ClassRange[][];
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
    if (x === 0) continue;
    w += x * CF[row + k];
    we += x * CE[row + k];
  }
  return { eq: w > 0 ? we / w : 0.5, p: w / CT[j] };
}

/** A range's `hitRate` against every class: the raw weights it is computed from, and the result. */
interface Hits { w: Float64Array; we: Float64Array; eq: Float64Array; p: Float64Array }
const hitCache = new WeakMap<ClassRange, Hits>();

function finish(w: Float64Array, we: Float64Array): Hits {
  const eq = new Float64Array(N), p = new Float64Array(N);
  for (let j = 0; j < N; j++) {
    eq[j] = w[j] > 0 ? we[j] / w[j] : 0.5;
    p[j] = w[j] / CT[j];
  }
  return { w, we, eq, p };
}

/**
 * `hitRate` against every class at once. The solver replaces a range with a new array whenever it
 * changes, so the table is kept for as long as the range is.
 */
function hits(r: ClassRange): Hits {
  let h = hitCache.get(r);
  if (h) return h;
  const nz: number[] = [];
  for (let k = 0; k < N; k++) if (r[k] !== 0) nz.push(k);
  const w = new Float64Array(N), we = new Float64Array(N);
  for (let j = 0; j < N; j++) {
    const row = j * N;
    for (const k of nz) {
      w[j] += r[k] * CF[row + k];
      we[j] += r[k] * CE[row + k];
    }
  }
  h = finish(w, we);
  hitCache.set(r, h);
  return h;
}

/** `cur` moved a `step` of the way toward `target`, with its hit table built from theirs (the weights are linear in the range). */
function blend(cur: ClassRange, target: ClassRange, step: number): ClassRange {
  const next = new Float64Array(N);
  for (let k = 0; k < N; k++) next[k] = cur[k] + (target[k] - cur[k]) * step;
  const a = hits(cur), b = hits(target);
  const w = new Float64Array(N), we = new Float64Array(N);
  for (let j = 0; j < N; j++) {
    w[j] = a.w[j] + (b.w[j] - a.w[j]) * step;
    we[j] = a.we[j] + (b.we[j] - a.we[j]) * step;
  }
  hitCache.set(next, finish(w, we));
  return next;
}

/** How often a range acts, unconditionally (share of all 1326 hands). */
export const rangeShare = (r: ClassRange) => {
  let s = 0;
  for (let k = 0; k < N; k++) s += r[k] * SIZE[k];
  return s / 1326;
};

/** Range-vs-range all-in equity of `a` against `b`. */
export function rangeEquity(a: ClassRange, b: ClassRange): number {
  const bk: number[] = [];
  for (let k = 0; k < N; k++) if (b[k] !== 0) bk.push(k);
  let w = 0, we = 0;
  for (let j = 0; j < N; j++) {
    const x = a[j];
    if (x === 0) continue;
    const row = j * N;
    let rw = 0, re = 0;
    for (const k of bk) {
      rw += b[k] * CF[row + k];
      re += b[k] * CE[row + k];
    }
    w += x * rw;
    we += x * re;
  }
  return w > 0 ? we / w : 0.5;
}

/** `rangeEquity(a, b)` from b's hit table, in one pass over a. */
function equityVs(a: ClassRange, b: ClassRange): number {
  const h = hits(b);
  let w = 0, we = 0;
  for (let j = 0; j < N; j++) {
    const x = a[j];
    if (x === 0) continue;
    const m = x * h.p[j] * CT[j];
    w += m;
    we += m * h.eq[j];
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
  /** By caller and overcaller seat: how often the overcaller joins, and the head-to-head equities of the all-in and the call against the overcalls. */
  overShare: number[][];
  pushVsOver: number[][];
  callVsOver: number[][];
}

type Ranges = Pick<Solution, 'setup' | 'push' | 'call' | 'over'>;

function reads(s: Ranges): Reads {
  const n = s.setup.stacks.length;
  const vsPush = new Float64Array(N);
  for (let k = 0; k < N; k++) vsPush[k] = hitRate(s.push, k).eq;
  const r: Reads = { vsPush, share: [], pushEq: [], overShare: [], pushVsOver: [], callVsOver: [] };
  for (let c = s.setup.opener + 1; c < n; c++) {
    readCaller(s, r, c);
    r.overShare[c] = [];
    r.pushVsOver[c] = [];
    r.callVsOver[c] = [];
    for (let d = c + 1; d < n; d++) readOver(s, r, c, d);
  }
  return r;
}

function readCaller(s: Ranges, r: Reads, c: number) {
  r.share[c] = rangeShare(s.call[c]);
  r.pushEq[c] = r.share[c] > 0 ? equityVs(s.push, s.call[c]) : 0.5;
}

function readOver(s: Ranges, r: Reads, c: number, d: number) {
  const o = s.over[c]?.[d] ?? EMPTY;
  r.overShare[c][d] = rangeShare(o);
  r.pushVsOver[c][d] = r.overShare[c][d] > 0 ? equityVs(s.push, o) : 0.5;
  r.callVsOver[c][d] = r.overShare[c][d] > 0 ? equityVs(s.call[c], o) : 0.5;
}

const EMPTY: ClassRange = new Float64Array(N);

/** Payout to `who` once `c` has called the all-in: the players behind may overcall, else it is heads-up. */
function afterCall(
  s: Pick<Solution, 'setup' | 'out'>, c: number, who: number,
  /** Head-to-head equities for this decision: opener against caller, and opener and caller against each overcall range. */
  oc: number, od: (d: number) => number, cd: (d: number) => number, q: (d: number) => number,
): number {
  const { setup: t, out } = s;
  let reach = 1, ev = 0;
  for (let d = c + 1; d < t.stacks.length; d++) {
    const p = q(d);
    if (p > 0) ev += reach * p * threeWay(oc, od(d), cd(d), out.three[c][d], who);
    reach *= 1 - p;
  }
  return ev + reach * (oc * out.openerWins[c][who] + (1 - oc) * out.callerWins[c][who]);
}

/** The opener's payout from going all-in with class j, and from folding. */
export function openerValues(s: Pick<Solution, 'setup' | 'out' | 'call' | 'over'>, j: number, r?: Reads): { play: number; fold: number; foldOdds: number; calledEquity: number } {
  const { setup: t, out } = s;
  const o = t.opener, n = t.stacks.length;
  const rd = r ?? reads({ ...s, push: EMPTY });
  let reach = 1, ev = 0, calledW = 0, calledEq = 0;
  for (let c = o + 1; c < n; c++) {
    const h = hits(s.call[c]);
    const q = h.p[j], eq = h.eq[j];
    if (q > 0) {
      // As afterCall, written out: this runs for every class on every pass.
      let behind = 1, v = 0;
      for (let d = c + 1; d < n; d++) {
        const oh = hits(s.over[c]?.[d] ?? EMPTY), p = oh.p[j];
        if (p > 0) v += behind * p * threeWay(eq, oh.eq[j], rd.callVsOver[c][d], out.three[c][d], o);
        behind *= 1 - p;
      }
      ev += reach * q * (v + behind * (eq * out.openerWins[c][o] + (1 - eq) * out.callerWins[c][o]));
    }
    calledW += reach * q;
    calledEq += reach * q * eq;
    reach *= 1 - q;
  }
  ev += reach * out.allFold[o];
  return { play: ev, fold: out.walk[o], foldOdds: reach, calledEquity: calledW > 0 ? calledEq / calledW : 0.5 };
}

/** A first caller's payout from folding: a player after them may call the all-in instead, and another overcall. */
function foldValue(s: Pick<Solution, 'setup' | 'out'>, r: Reads, c: number): number {
  const { setup: t, out } = s;
  let reach = 1, ev = 0;
  for (let d = c + 1; d < t.stacks.length; d++) {
    const q = r.share[d];
    if (q > 0) ev += reach * q * afterCall(s, d, c, r.pushEq[d], (e) => r.pushVsOver[d][e], (e) => r.callVsOver[d][e], (e) => r.overShare[d][e]);
    reach *= 1 - q;
  }
  return ev + reach * out.allFold[c];
}

/** A caller's payout from calling with class k, from folding, and their equity against the all-in. */
export function callerValues(
  s: Pick<Solution, 'setup' | 'out' | 'call' | 'push' | 'over'>, c: number, k: number, r: Reads = reads(s),
  /** The fold value, which is the same for every class, when already known. */
  fold = foldValue(s, r, c),
): { play: number; fold: number; equity: number } {
  const { setup: t, out } = s;
  const eq = r.vsPush[k], oc = 1 - eq;
  // As afterCall, written out: this runs for every class on every pass.
  let behind = 1, play = 0;
  for (let d = c + 1; d < t.stacks.length; d++) {
    const p = r.overShare[c][d];
    if (p > 0) play += behind * p * threeWay(oc, r.pushVsOver[c][d], hits(s.over[c][d]).eq[k], out.three[c][d], c);
    behind *= 1 - p;
  }
  play += behind * (oc * out.openerWins[c][c] + (1 - oc) * out.callerWins[c][c]);
  return { play, fold, equity: eq };
}

/**
 * An overcaller's payout, behind `c`'s call, from joining with class m and from folding (a player
 * after them may overcall instead).
 */
export function overValues(s: Pick<Solution, 'setup' | 'out' | 'call' | 'push' | 'over'>, c: number, d: number, m: number, r: Reads = reads(s)): { play: number; fold: number } {
  return { play: overPlay(s, c, d, m, r), fold: overFold(s, c, d, r) };
}

function overPlay(s: Pick<Solution, 'out' | 'call'>, c: number, d: number, m: number, r: Reads): number {
  return threeWay(r.pushEq[c], 1 - r.vsPush[m], 1 - hits(s.call[c]).eq[m], s.out.three[c][d], d);
}

/** An overcaller's fold value, the same for every class. */
function overFold(s: Pick<Solution, 'setup' | 'out'>, c: number, d: number, r: Reads): number {
  const { setup: t, out } = s;
  let reach = 1, fold = 0;
  for (let e = d + 1; e < t.stacks.length; e++) {
    const q = r.overShare[c][e];
    if (q > 0) fold += reach * q * threeWay(r.pushEq[c], r.pushVsOver[c][e], r.callVsOver[c][e], out.three[c][e], d);
    reach *= 1 - q;
  }
  return fold + reach * (r.pushEq[c] * out.openerWins[c][d] + (1 - r.pushEq[c]) * out.callerWins[c][d]);
}

export const ITERATIONS = 150;

const best = (play: number, fold: number) => (play > fold + 1e-12 ? 1 : play < fold - 1e-12 ? 0 : 0.5);

/**
 * The callers' best answers to an all-in range, from the last player to act back to the first:
 * each caller knows how the players after them answer. Behind each first caller, the overcalling
 * ranges move toward their best answers by fictitious play with step `step`, since an overcall
 * and the call in front of it each depend on the other.
 */
function answerCallers(s: Solution, step: number): Reads {
  const { setup: t } = s;
  const n = t.stacks.length;
  const r = reads(s);
  for (let c = n - 1; c > t.opener; c--) {
    s.over[c] ??= [];
    // Nobody can overcall a call that never comes.
    for (let d = n - 1; d > c && r.share[c] > 0; d--) {
      const target = new Float64Array(N);
      const fold = overFold(s, c, d, r);
      for (let m = 0; m < N; m++) target[m] = best(overPlay(s, c, d, m, r), fold);
      s.over[c][d] = blend(s.over[c][d] ?? EMPTY, target, step);
      readOver(s, r, c, d);
    }
    const range = new Float64Array(N);
    const fold = foldValue(s, r, c);
    for (let k = 0; k < N; k++) range[k] = best(callerValues(s, c, k, r, fold).play, fold);
    // An unchanged range keeps its array, and with it its hit table.
    if (range.some((x, k) => x !== s.call[c][k])) s.call[c] = range;
    readCaller(s, r, c);
    for (let d = c + 1; d < n; d++) readOver(s, r, c, d);
  }
  return r;
}

const settle = (x: number) => (x < 0.05 ? 0 : x > 0.95 ? 1 : x);

/**
 * Solves a spot: the opener's all-in range, every caller's calling range and every overcalling
 * range. The callers answer exactly; the opener's and the overcallers' ranges move toward their
 * best answers by fictitious play (an average of their answers), so hands on the edge end up mixed.
 */
export function solve(t: TableSetup, iterations = ITERATIONS): Solution {
  const n = t.stacks.length;
  if (t.opener < 0 || t.opener > n - 2) throw new Error('The opener must act before the big blind');
  const out = outcomes(t);
  const s: Solution = { setup: t, out, push: new Float64Array(N).fill(0.5), call: [], over: [] };
  for (let c = t.opener + 1; c < n; c++) s.call[c] = new Float64Array(N);
  for (let it = 0; it < iterations; it++) {
    const step = 1 / (it + 2);
    const r = answerCallers(s, step);
    for (let j = 0; j < N; j++) {
      const v = openerValues(s, j, r);
      s.push[j] += (best(v.play, v.fold) - s.push[j]) * step;
    }
  }
  // The average keeps a trace of the early passes: a hand played under 5% or over 95% of the time
  // is rounded to never or always.
  for (let j = 0; j < N; j++) s.push[j] = settle(s.push[j]);
  answerCallers(s, 0);
  for (const row of s.over) if (row) row.forEach((o, d) => { if (o) row[d] = o.map(settle); });
  answerCallers(s, 0);
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
