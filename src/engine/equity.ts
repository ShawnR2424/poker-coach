// Hero equity against one or more weighted ranges.
// Heads-up with a flop or later is enumerated exactly; preflop and multiway use Monte Carlo.

import type { Card } from './cards';
import { evaluate } from './evaluator';
import { COMBO_CARDS, NUM_COMBOS, type Range } from './range';
import { makeRng, randomSeed, type Rng } from './rng';

export interface EquityRequest {
  hero: readonly Card[];
  board: readonly Card[];
  villains: readonly Range[];
  /** Monte Carlo samples (ignored when enumerating exactly). */
  iterations?: number;
  seed?: number;
  /** Set false to force Monte Carlo even when exact enumeration is possible. */
  allowExact?: boolean;
}

export interface EquityResult {
  /** Hero's share of the pot, 0..1, counting split pots fractionally. */
  equity: number;
  win: number;
  tie: number;
  /** Standard error of `equity` (0 when exact). */
  stderr: number;
  samples: number;
  exact: boolean;
}

/** Live combos of a range with dead cards removed, plus cumulative weights for sampling. */
interface Sampler {
  idx: Int16Array;
  cum: Float64Array;
  total: number;
}

function buildSampler(range: Range, dead: Uint8Array): Sampler {
  const idx: number[] = [];
  const cum: number[] = [];
  let total = 0;
  for (let i = 0; i < NUM_COMBOS; i++) {
    const w = range[i];
    if (w <= 0) continue;
    const [a, b] = COMBO_CARDS[i];
    if (dead[a] || dead[b]) continue;
    total += w;
    idx.push(i);
    cum.push(total);
  }
  return { idx: Int16Array.from(idx), cum: Float64Array.from(cum), total };
}

function sample(s: Sampler, rng: Rng): number {
  const x = rng() * s.total;
  let lo = 0, hi = s.cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (s.cum[mid] > x) hi = mid;
    else lo = mid + 1;
  }
  return s.idx[lo];
}

function validate(req: EquityRequest): Uint8Array {
  if (req.hero.length !== 2) throw new Error('Hero needs exactly two cards');
  if (req.board.length > 5 || req.board.length === 1 || req.board.length === 2) {
    throw new Error('Board must have 0, 3, 4 or 5 cards');
  }
  if (req.villains.length < 1) throw new Error('Need at least one opponent range');
  const dead = new Uint8Array(52);
  for (const c of [...req.hero, ...req.board]) {
    if (dead[c]) throw new Error('Duplicate card');
    dead[c] = 1;
  }
  return dead;
}

export function computeEquity(req: EquityRequest): EquityResult {
  const dead = validate(req);
  const samplers = req.villains.map((v) => buildSampler(v, dead));
  if (samplers.some((s) => s.total <= 0)) throw new Error('An opponent range has no live combos');
  if (req.villains.length === 1 && req.board.length >= 3 && req.allowExact !== false) {
    return exactHeadsUp(req, dead, samplers[0]);
  }
  return monteCarlo(req, dead, samplers);
}

function exactHeadsUp(req: EquityRequest, dead: Uint8Array, s: Sampler): EquityResult {
  const need = 5 - req.board.length;
  const cards = new Int32Array(7);
  const vcards = new Int32Array(7);
  cards[0] = req.hero[0];
  cards[1] = req.hero[1];
  req.board.forEach((c, i) => { cards[2 + i] = c; vcards[2 + i] = c; });

  let winW = 0, tieW = 0, totalW = 0;
  const deck: number[] = [];
  for (let i = 0; i < s.idx.length; i++) {
    const ci = s.idx[i];
    const w = s.cum[i] - (i > 0 ? s.cum[i - 1] : 0);
    const [a, b] = COMBO_CARDS[ci];
    vcards[0] = a;
    vcards[1] = b;
    deck.length = 0;
    for (let c = 0; c < 52; c++) if (!dead[c] && c !== a && c !== b) deck.push(c);

    let wins = 0, ties = 0, n = 0;
    const tally = () => {
      const h = evaluate(cards, 7), v = evaluate(vcards, 7);
      if (h > v) wins++;
      else if (h === v) ties++;
      n++;
    };
    const base = 2 + req.board.length;
    if (need === 0) tally();
    else if (need === 1) {
      for (const x of deck) { cards[base] = vcards[base] = x; tally(); }
    } else {
      for (let x = 0; x < deck.length; x++) {
        cards[base] = vcards[base] = deck[x];
        for (let y = x + 1; y < deck.length; y++) {
          cards[base + 1] = vcards[base + 1] = deck[y];
          tally();
        }
      }
    }
    winW += (w * wins) / n;
    tieW += (w * ties) / n;
    totalW += w;
  }
  const win = winW / totalW, tie = tieW / totalW;
  return { equity: win + tie / 2, win, tie, stderr: 0, samples: s.idx.length, exact: true };
}

function monteCarlo(req: EquityRequest, dead: Uint8Array, samplers: Sampler[]): EquityResult {
  const iterations = req.iterations ?? 20000;
  const rng = makeRng(req.seed ?? randomSeed());
  const nv = samplers.length;
  const need = 5 - req.board.length;
  const used = new Uint8Array(52);
  const hand = new Int32Array(7);
  const vHands = Array.from({ length: nv }, () => new Int32Array(7));
  const runout = new Int32Array(5);
  const base = 2 + req.board.length;

  let share = 0, shareSq = 0, wins = 0, ties = 0, done = 0, attempts = 0;
  const maxAttempts = iterations * 50;

  while (done < iterations && attempts < maxAttempts) {
    attempts++;
    used.set(dead);
    // Sample each opponent's hand; reject if two opponents collide on a card.
    let ok = true;
    for (let v = 0; v < nv && ok; v++) {
      const [a, b] = COMBO_CARDS[sample(samplers[v], rng)];
      if (used[a] || used[b]) { ok = false; break; }
      used[a] = used[b] = 1;
      vHands[v][0] = a;
      vHands[v][1] = b;
    }
    if (!ok) continue;

    for (let k = 0; k < need; k++) {
      let c: number;
      do c = Math.floor(rng() * 52); while (used[c]);
      used[c] = 1;
      runout[k] = c;
    }

    hand[0] = req.hero[0];
    hand[1] = req.hero[1];
    for (let i = 0; i < req.board.length; i++) hand[2 + i] = req.board[i];
    for (let k = 0; k < need; k++) hand[base + k] = runout[k];
    const hs = evaluate(hand, 7);

    let best = -1, bestCount = 0;
    for (let v = 0; v < nv; v++) {
      const vh = vHands[v];
      for (let i = 2; i < 7; i++) vh[i] = hand[i];
      const s = evaluate(vh, 7);
      if (s > best) { best = s; bestCount = 1; }
      else if (s === best) bestCount++;
    }

    let x = 0;
    if (hs > best) { x = 1; wins++; }
    else if (hs === best) { x = 1 / (bestCount + 1); ties++; }
    share += x;
    shareSq += x * x;
    done++;
  }
  if (done === 0) throw new Error('Could not deal non-conflicting hands for these ranges');

  const eq = share / done;
  const variance = Math.max(0, shareSq / done - eq * eq);
  return {
    equity: eq,
    win: wins / done,
    tie: ties / done,
    stderr: Math.sqrt(variance / done),
    samples: done,
    exact: false,
  };
}

/**
 * Hero equity against every single combo of `range`, enumerated exactly (flop or later).
 * Entries for combos with no weight or a dead card are NaN. The weighted average of the
 * result equals computeEquity's heads-up answer.
 */
export function comboEquities(hero: readonly Card[], board: readonly Card[], range: Range): Float32Array {
  if (board.length < 3) throw new Error('Per-combo equity needs a flop');
  const dead = validate({ hero, board, villains: [range] });
  const out = new Float32Array(NUM_COMBOS).fill(NaN);
  const need = 5 - board.length;
  const cards = new Int32Array(7);
  const vcards = new Int32Array(7);
  cards[0] = hero[0];
  cards[1] = hero[1];
  board.forEach((c, i) => { cards[2 + i] = c; vcards[2 + i] = c; });
  const base = 2 + board.length;
  const deck: number[] = [];
  for (let c = 0; c < 52; c++) if (!dead[c]) deck.push(c);

  // The hero's score depends only on the runout, so score every runout once.
  const heroScore = new Int32Array(need === 2 ? 52 * 52 : 52);
  if (need === 0) heroScore[0] = evaluate(cards, 7);
  else if (need === 1) {
    for (const x of deck) { cards[base] = x; heroScore[x] = evaluate(cards, 7); }
  } else {
    for (let i = 0; i < deck.length; i++) {
      cards[base] = deck[i];
      for (let j = i + 1; j < deck.length; j++) {
        cards[base + 1] = deck[j];
        heroScore[deck[i] * 52 + deck[j]] = evaluate(cards, 7);
      }
    }
  }

  for (let k = 0; k < NUM_COMBOS; k++) {
    if (!(range[k] > 0)) continue;
    const [a, b] = COMBO_CARDS[k];
    if (dead[a] || dead[b]) continue;
    vcards[0] = a;
    vcards[1] = b;
    let share = 0, n = 0;
    const tally = (h: number) => {
      const v = evaluate(vcards, 7);
      share += h > v ? 1 : h === v ? 0.5 : 0;
      n++;
    };
    if (need === 0) tally(heroScore[0]);
    else if (need === 1) {
      for (const x of deck) {
        if (x === a || x === b) continue;
        vcards[base] = x;
        tally(heroScore[x]);
      }
    } else {
      for (let i = 0; i < deck.length; i++) {
        const x = deck[i];
        if (x === a || x === b) continue;
        vcards[base] = x;
        for (let j = i + 1; j < deck.length; j++) {
          const y = deck[j];
          if (y === a || y === b) continue;
          vcards[base + 1] = y;
          tally(heroScore[x * 52 + y]);
        }
      }
    }
    out[k] = share / n;
  }
  return out;
}
