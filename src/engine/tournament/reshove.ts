// Reshove spots: a player opens with a min-raise to 2bb, it is folded to the hero, and the hero
// goes all-in or folds; the opener then calls or folds. The opener's opening range is the
// trainer's 40bb opening chart for that seat. The hero's all-in range and the opener's calling
// range answer each other the same way as push/fold (see pushfold.ts): the opener calls with its
// best answer to the all-in range, and the all-in range follows by fictitious play.
//
// Simplifications, also listed in docs/model.md: the players after the hero fold to the all-in,
// and when the hero folds, the opener takes the pot.

import { getStrategy } from '../preflop/charts';
import { chartSeat, positionsFor } from '../positions';
import { ALL_CLASSES, CLASS_COMBOS } from '../range';
import { NUM_CLASSES } from './classEquity';
import { BB_BLIND, hitRate, SB_BLIND, utilities, type ClassRange, type PayoutMode } from './pushfold';

/** The opener's raise, in big blinds. */
export const OPEN_TO = 2;

export interface ReshoveSetup {
  /** Stacks in big blinds before the blinds and ante, in preflop action order (SB and BB last). */
  stacks: number[];
  ante: boolean;
  mode: PayoutMode;
  /** The player who opened to 2bb. */
  opener: number;
  /** The player deciding whether to go all-in, after the opener. */
  hero: number;
}

const N = NUM_CLASSES;

function posts(t: ReshoveSetup) {
  const n = t.stacks.length;
  const blind = new Array<number>(n).fill(0);
  blind[n - 2] = Math.min(SB_BLIND, t.stacks[n - 2]);
  const ante = t.ante ? Math.min(1, t.stacks[n - 1] / 2) : 0;
  blind[n - 1] = Math.min(BB_BLIND, t.stacks[n - 1] - ante);
  return { blind, ante };
}

/** Chips a player can bet: the stack less the big blind ante. */
export const liveStack = (t: ReshoveSetup, i: number) => t.stacks[i] - (t.ante && i === t.stacks.length - 1 ? posts(t).ante : 0);

export type ReshoveOutcome = 'fold' | 'steal' | 'heroWins' | 'openerWins';

/**
 * Stacks after the hand. `fold`: the hero folds and the opener takes the blinds and ante.
 * `steal`: the hero goes all-in and the opener folds its raise. Otherwise the all-in is called.
 */
export function reshoveStacks(t: ReshoveSetup, outcome: ReshoveOutcome): number[] {
  const n = t.stacks.length;
  const { blind, ante } = posts(t);
  const o = t.opener, h = t.hero;
  const s = [...t.stacks];
  s[n - 1] -= ante;
  let dead = ante;
  const inHand = outcome === 'fold' ? [o] : [o, h];
  for (let i = 0; i < n; i++) {
    if (inHand.includes(i)) continue;
    s[i] -= blind[i];
    dead += blind[i];
  }
  if (outcome === 'fold') {
    s[o] += dead;
    return s;
  }
  if (outcome === 'steal') {
    const open = Math.min(OPEN_TO, liveStack(t, o));
    s[o] -= open;
    s[h] += dead + open;
    return s;
  }
  const eff = Math.min(liveStack(t, o), liveStack(t, h));
  s[o] -= eff;
  s[h] -= eff;
  s[outcome === 'heroWins' ? h : o] += 2 * eff + dead;
  return s;
}

/** The opener's 40bb opening range for its seat, by class. */
export function openRange(players: number, opener: number): ClassRange {
  const pos = positionsFor(players)[opener];
  const s = getStrategy('rfi', chartSeat(pos, players, true), 'baseline', false, 40, false);
  return Float64Array.from(ALL_CLASSES, (c) => {
    const idx = CLASS_COMBOS.get(c)!;
    return idx.reduce((a, i) => a + s.raise[i], 0) / idx.length;
  });
}

export interface ReshoveSolution {
  setup: ReshoveSetup;
  out: Record<ReshoveOutcome, number[]>;
  open: ClassRange;
  /** The all-in range from the hero's seat. */
  shove: ClassRange;
  /** The opener's calling range against it (within its opening range). */
  call: ClassRange;
}

/** The hero's payout from going all-in with class j, and from folding. */
export function shoveValues(s: ReshoveSolution, j: number) {
  const { out, setup: t } = s;
  const h = t.hero;
  const calls = s.open.map((x, k) => x * s.call[k]);
  const opened = hitRate(s.open, j).p;
  const called = hitRate(calls, j);
  const q = opened > 0 ? Math.min(1, called.p / opened) : 0;
  const eq = called.eq;
  return {
    play: (1 - q) * out.steal[h] + q * (eq * out.heroWins[h] + (1 - eq) * out.openerWins[h]),
    fold: out.fold[h],
    foldOdds: 1 - q,
    calledEquity: eq,
    equity: eq,
  };
}

export const ITERATIONS = 150;

export function solveReshove(t: ReshoveSetup, iterations = ITERATIONS): ReshoveSolution {
  const n = t.stacks.length;
  if (!(t.opener >= 0 && t.opener < t.hero && t.hero < n)) throw new Error('The hero must act after the opener');
  const u = (o: ReshoveOutcome) => utilities(reshoveStacks(t, o), t.mode);
  const out = { fold: u('fold'), steal: u('steal'), heroWins: u('heroWins'), openerWins: u('openerWins') };
  const s: ReshoveSolution = { setup: t, out, open: openRange(n, t.opener), shove: new Float64Array(N).fill(0.5), call: new Float64Array(N) };
  const o = t.opener;
  const answerOpener = () => {
    for (let k = 0; k < N; k++) {
      const eq = hitRate(s.shove, k).eq;
      const play = eq * out.openerWins[o] + (1 - eq) * out.heroWins[o];
      s.call[k] = play > out.steal[o] + 1e-12 ? 1 : play < out.steal[o] - 1e-12 ? 0 : 0.5;
    }
  };
  for (let it = 0; it < iterations; it++) {
    answerOpener();
    const step = 1 / (it + 2);
    for (let j = 0; j < N; j++) {
      const v = shoveValues(s, j);
      const best = v.play > v.fold + 1e-12 ? 1 : v.play < v.fold - 1e-12 ? 0 : 0.5;
      s.shove[j] += (best - s.shove[j]) * step;
    }
  }
  for (let j = 0; j < N; j++) s.shove[j] = s.shove[j] < 0.05 ? 0 : s.shove[j] > 0.95 ? 1 : s.shove[j];
  answerOpener();
  return s;
}

/** The opener's calls as a range: its opening hands that call the all-in. */
export const callingHands = (s: ReshoveSolution): ClassRange => s.open.map((x, k) => (x > 0 ? x * s.call[k] : 0));
