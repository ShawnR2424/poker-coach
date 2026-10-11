// The equity calculator: two to four players, each holding an exact hand or a range, on any
// board, with optional dead cards. Small problems are enumerated exactly (every deal of the
// players' combos and every runout); larger ones are sampled.

import { formatCard, parseCards, type Card } from '../cards';
import { evaluate } from '../evaluator';
import { COMBO_CARDS, comboIndex, emptyRange, NUM_COMBOS, parseRange, type Range } from '../range';
import { makeRng, randomSeed } from '../rng';

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;
/** Evaluations an exact answer may cost before the calculator samples instead. */
export const EXACT_BUDGET = 4_000_000;
export const DEFAULT_SAMPLES = 100_000;

export type PlayerHolding =
  | { kind: 'hand'; cards: [Card, Card]; range: Range }
  | { kind: 'range'; range: Range; random: boolean };

/**
 * Reads one player's field: an exact hand ("AhKd", "Ah Kd"), standard range notation
 * ("QQ+, AKs, AQo:0.5") or "random" for any two cards.
 */
export function parseHolding(text: string): PlayerHolding {
  const t = text.trim();
  if (!t) throw new Error('Enter a hand or a range');
  if (/^(random|any)$/i.test(t)) return { kind: 'range', range: emptyRange().fill(1), random: true };
  if (/^[2-9TJQKA][cdhs]\s*[2-9TJQKA][cdhs]$/i.test(t)) {
    const [a, b] = parseCards(t);
    const range = emptyRange();
    range[comboIndex(a, b)] = 1;
    return { kind: 'hand', cards: [a, b], range };
  }
  const range = parseRange(t);
  if (!range.some((w) => w > 0)) throw new Error('The range is empty');
  return { kind: 'range', range, random: false };
}

/** Reads a board: none, a flop, a turn or a river. */
export function parseBoard(text: string): Card[] {
  const cards = parseCards(text);
  if (cards.length === 1 || cards.length === 2 || cards.length > 5) throw new Error('The board needs 0, 3, 4 or 5 cards');
  return cards;
}

export interface CalcRequest {
  players: readonly Range[];
  board: readonly Card[];
  dead?: readonly Card[];
  /** Samples when the problem is too large to enumerate. */
  samples?: number;
  seed?: number;
  /** Set false to sample even when exact enumeration is affordable. */
  allowExact?: boolean;
}

export interface PlayerEquity {
  /** Share of the pot, 0..1, counting split pots fractionally. */
  equity: number;
  /** Share of deals won outright. */
  win: number;
  /** Share of deals that split the pot with this player in it. */
  tie: number;
  /** Standard error of `equity` (0 when exact). */
  stderr: number;
  /** Weighted combos left once the board and dead cards are removed. */
  combos: number;
}

export interface CalcResult {
  players: PlayerEquity[];
  exact: boolean;
  /** Deals counted: enumerated deals when exact, samples otherwise. */
  deals: number;
}

interface Live {
  idx: Int16Array;
  w: Float64Array;
  cum: Float64Array;
  total: number;
}

function liveCombos(range: Range, dead: Uint8Array): Live {
  const idx: number[] = [], w: number[] = [], cum: number[] = [];
  let total = 0;
  for (let i = 0; i < NUM_COMBOS; i++) {
    const x = range[i];
    if (!(x > 0)) continue;
    const [a, b] = COMBO_CARDS[i];
    if (dead[a] || dead[b]) continue;
    total += x;
    idx.push(i);
    w.push(x);
    cum.push(total);
  }
  return { idx: Int16Array.from(idx), w: Float64Array.from(w), cum: Float64Array.from(cum), total };
}

const choose = (n: number, k: number) => {
  let r = 1;
  for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1);
  return Math.round(r);
};

/** Validates the request and returns the dead-card mask (board plus dead cards). */
function prepare(req: CalcRequest) {
  const n = req.players.length;
  if (n < MIN_PLAYERS || n > MAX_PLAYERS) throw new Error(`Enter ${MIN_PLAYERS} to ${MAX_PLAYERS} players`);
  if (req.board.length === 1 || req.board.length === 2 || req.board.length > 5) throw new Error('The board needs 0, 3, 4 or 5 cards');
  const dead = new Uint8Array(52);
  for (const c of [...req.board, ...(req.dead ?? [])]) {
    if (dead[c]) throw new Error(`${formatCard(c)} is used twice`);
    dead[c] = 1;
  }
  const live = req.players.map((r, p) => {
    const l = liveCombos(r, dead);
    if (l.total <= 0) throw new Error(`Player ${p + 1} has no hands left once the board and dead cards are removed`);
    return l;
  });
  // Two exact hands that share a card can never be dealt together.
  const fixed = new Map<Card, number>();
  live.forEach((l, p) => {
    if (l.idx.length !== 1) return;
    for (const c of COMBO_CARDS[l.idx[0]]) {
      if (fixed.has(c)) throw new Error(`${formatCard(c)} is in the hands of players ${fixed.get(c)! + 1} and ${p + 1}`);
      fixed.set(c, p);
    }
  });
  return { dead, live };
}

export function calcEquity(req: CalcRequest): CalcResult {
  const { dead, live } = prepare(req);
  const n = live.length;
  const need = 5 - req.board.length;
  let deadCount = 0;
  for (let c = 0; c < 52; c++) deadCount += dead[c];
  const cost = live.reduce((a, l) => a * l.idx.length, 1) * choose(52 - deadCount - 2 * n, need) * n;
  const result = req.allowExact !== false && cost <= EXACT_BUDGET ? exact(req, dead, live) : sampled(req, dead, live);
  result.players.forEach((p, i) => { p.combos = live[i].total; });
  return result;
}

/** Shared scoring: the pot shares of one deal, written into `share`; returns the winner count. */
function score(hands: Int32Array[], n: number, scores: Int32Array, share: Float64Array) {
  let best = -1, count = 0;
  for (let p = 0; p < n; p++) {
    const s = evaluate(hands[p], 7);
    scores[p] = s;
    if (s > best) { best = s; count = 1; }
    else if (s === best) count++;
  }
  for (let p = 0; p < n; p++) share[p] = scores[p] === best ? 1 / count : 0;
  return count;
}

function exact(req: CalcRequest, dead: Uint8Array, live: Live[]): CalcResult {
  const n = live.length;
  const need = 5 - req.board.length;
  const base = 2 + req.board.length;
  const hands = Array.from({ length: n }, () => {
    const h = new Int32Array(7);
    req.board.forEach((c, i) => { h[2 + i] = c; });
    return h;
  });
  const used = new Uint8Array(dead);
  const scores = new Int32Array(n), share = new Float64Array(n);
  const eq = new Float64Array(n), win = new Float64Array(n), tie = new Float64Array(n);
  let total = 0, deals = 0;
  const deck = new Int32Array(52);
  const pick = new Int32Array(5);

  const runouts = (weight: number) => {
    let m = 0;
    for (let c = 0; c < 52; c++) if (!used[c]) deck[m++] = c;
    const per = weight / choose(m, need);
    const tally = () => {
      for (let p = 0; p < n; p++) for (let k = 0; k < need; k++) hands[p][base + k] = deck[pick[k]];
      const count = score(hands, n, scores, share);
      for (let p = 0; p < n; p++) {
        if (share[p] === 0) continue;
        eq[p] += per * share[p];
        if (count === 1) win[p] += per;
        else tie[p] += per;
      }
      deals++;
    };
    const rec = (k: number, from: number) => {
      if (k === need) { tally(); return; }
      for (let i = from; i <= m - (need - k); i++) { pick[k] = i; rec(k + 1, i + 1); }
    };
    rec(0, 0);
    total += weight;
  };

  const assign = (p: number, weight: number) => {
    if (p === n) { runouts(weight); return; }
    const l = live[p];
    for (let i = 0; i < l.idx.length; i++) {
      const [a, b] = COMBO_CARDS[l.idx[i]];
      if (used[a] || used[b]) continue;
      used[a] = used[b] = 1;
      hands[p][0] = a;
      hands[p][1] = b;
      assign(p + 1, weight * l.w[i]);
      used[a] = used[b] = 0;
    }
  };
  assign(0, 1);
  if (total <= 0) throw new Error('These hands and ranges can never be dealt together');
  return {
    players: Array.from({ length: n }, (_, p) => ({ equity: eq[p] / total, win: win[p] / total, tie: tie[p] / total, stderr: 0, combos: 0 })),
    exact: true,
    deals,
  };
}

function sampled(req: CalcRequest, dead: Uint8Array, live: Live[]): CalcResult {
  const n = live.length;
  const samples = req.samples ?? DEFAULT_SAMPLES;
  const rng = makeRng(req.seed ?? randomSeed());
  const need = 5 - req.board.length;
  const base = 2 + req.board.length;
  const hands = Array.from({ length: n }, () => {
    const h = new Int32Array(7);
    req.board.forEach((c, i) => { h[2 + i] = c; });
    return h;
  });
  const used = new Uint8Array(52);
  const runout = new Int32Array(5);
  const scores = new Int32Array(n), share = new Float64Array(n);
  const sum = new Float64Array(n), sumSq = new Float64Array(n), win = new Float64Array(n), tie = new Float64Array(n);
  let done = 0, attempts = 0;
  const maxAttempts = samples * 50;

  while (done < samples && attempts < maxAttempts) {
    attempts++;
    used.set(dead);
    // Deal every player from their range and redeal the whole hand on a clash, so no player's
    // range is favoured by the dealing order.
    let ok = true;
    for (let p = 0; p < n; p++) {
      const l = live[p];
      const x = rng() * l.total;
      let lo = 0, hi = l.cum.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (l.cum[mid] > x) hi = mid;
        else lo = mid + 1;
      }
      const [a, b] = COMBO_CARDS[l.idx[lo]];
      if (used[a] || used[b]) { ok = false; break; }
      used[a] = used[b] = 1;
      hands[p][0] = a;
      hands[p][1] = b;
    }
    if (!ok) continue;
    for (let k = 0; k < need; k++) {
      let c: number;
      do c = Math.floor(rng() * 52); while (used[c]);
      used[c] = 1;
      runout[k] = c;
    }
    for (let p = 0; p < n; p++) for (let k = 0; k < need; k++) hands[p][base + k] = runout[k];
    const count = score(hands, n, scores, share);
    for (let p = 0; p < n; p++) {
      const s = share[p];
      sum[p] += s;
      sumSq[p] += s * s;
      if (s === 0) continue;
      if (count === 1) win[p]++;
      else tie[p]++;
    }
    done++;
  }
  if (done === 0) throw new Error('These hands and ranges can never be dealt together');
  return {
    players: Array.from({ length: n }, (_, p) => {
      const e = sum[p] / done;
      return { equity: e, win: win[p] / done, tie: tie[p] / done, stderr: Math.sqrt(Math.max(0, sumSq[p] / done - e * e) / done), combos: 0 };
    }),
    exact: false,
    deals: done,
  };
}
