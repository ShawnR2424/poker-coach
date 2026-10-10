// Opponent behavior after the flop, by hand class. Used both to narrow a range from the
// actions a player took and to predict how they respond to the hero's bets.

import table from '../../../data/postflop/actions.json';
import profileTable from '../../../data/postflop/profiles.json';
import type { Card } from '../cards';
import { COMBO_CARDS, NUM_COMBOS, type Range } from '../range';
import { classifyHand, type PostflopClass } from './classify';

type ByClass = Record<PostflopClass, number>;

export const ACTIONS = table as unknown as {
  firstToAct: { betSmall: ByClass; betBig: ByClass };
  leadIntoAggressor: { betSmall: ByClass; betBig: ByClass };
  facingBet: { base: ByClass; slope: ByClass; raise: ByClass; maxSize: number; overbetDecay: number; defend: number; maxBoost: number };
  facingRaise: { continue: ByClass; defend: number };
  realization: { inPosition: number; outOfPosition: number; byClass: ByClass };
  laterStreets: { betSize: number };
};

export type ProfileId = 'regular' | 'nit' | 'station' | 'aggro';
export interface Profile {
  label: string;
  short: string;
  about: string;
  betMult: number;
  raiseMult: number;
  continueAdd: number;
  /** Scales how often air and weak draws bet or raise (1 when missing). Set by adaptation. */
  bluffMult?: number;
  /** How this opponent plays differently from its base style, when it has adjusted to the hero. */
  adjustments?: string[];
}
export const PROFILES = Object.fromEntries(
  Object.entries(profileTable).filter(([k]) => !k.startsWith('_')),
) as Record<ProfileId, Profile>;
export const PROFILE_IDS = Object.keys(PROFILES) as ProfileId[];
const DEFAULT: Profile = PROFILES.regular;

/** Classes that bet or raise only as bluffs or semi-bluffs; bluffMult scales them. */
const BLUFFS = new Set<PostflopClass>(['air', 'weakDraw']);
const bluffScale = (cls: PostflopClass, profile: Profile) => (BLUFFS.has(cls) ? profile.bluffMult ?? 1 : 1);

/** Classes whose willingness to continue does not depend on the player's style. */
const STYLE_FREE = new Set<PostflopClass>(['setPlus', 'twoPair']);

/** Bets up to this fraction of the pot count as "small" when narrowing. */
export const SMALL_BET_MAX = 0.5;

const clip01 = (x: number) => Math.min(1, Math.max(0, x));

/**
 * How likely a hand class continues (calls or raises) facing a bet of `f` times the pot.
 * `beingRaised` is true when the player had bet and now faces a raise. `defense` (from
 * rangeDefense) scales the result so the player's whole range defends enough.
 */
export function continueProb(cls: PostflopClass, f: number, beingRaised = false, profile: Profile = DEFAULT, defense = 1): number {
  const add = STYLE_FREE.has(cls) ? 0 : profile.continueAdd;
  const { base, slope, maxSize, overbetDecay } = ACTIONS.facingBet;
  let p = clip01(base[cls] + add - slope[cls] * Math.min(f, maxSize));
  // Past an overbet, the straight line would fold even overpairs to a shove; see actions.json.
  if (f > maxSize) p *= (maxSize / f) ** (overbetDecay * slope[cls]);
  if (beingRaised) p *= ACTIONS.facingRaise.continue[cls];
  return Math.min(1, p * defense);
}

export interface Response {
  fold: number;
  call: number;
  raise: number;
}

export function responseFor(
  cls: PostflopClass,
  f: number,
  canRaise: boolean,
  beingRaised = false,
  profile: Profile = DEFAULT,
  defense = 1,
): Response {
  const cont = continueProb(cls, f, beingRaised, profile, defense);
  const raise = canRaise ? cont * Math.min(1, ACTIONS.facingBet.raise[cls] * profile.raiseMult * bluffScale(cls, profile)) : 0;
  return { fold: 1 - cont, call: cont - raise, raise };
}

/**
 * A player who folds too much to bets hands every bluff a profit, so a range facing a bet keeps at
 * least `defend` of the minimum defense frequency 1 / (1 + f), moved by the player's style
 * (continueAdd): a nit still folds too much and a calling station defends more. The class table
 * alone folds a wide range (one that checked, or one full of small-bet bluffs that is now raised)
 * far more than that. Returns the factor that multiplies every class's continue chance (capped at
 * 1) to reach the floor: 1 when the range already defends enough. Classes gain in proportion to how
 * often they already continue, up to `maxBoost` times, so pairs and draws take up the extra defense
 * while air keeps folding.
 * See `defend` under facingBet and facingRaise in actions.json.
 */
export function rangeDefense(
  classes: readonly PostflopClass[],
  weights: ArrayLike<number>,
  f: number,
  beingRaised = false,
  profile: Profile = DEFAULT,
): number {
  const byClass = new Map<PostflopClass, number>();
  let total = 0;
  for (let k = 0; k < classes.length; k++) {
    if (!(weights[k] > 0)) continue;
    byClass.set(classes[k], (byClass.get(classes[k]) ?? 0) + weights[k]);
    total += weights[k];
  }
  if (total <= 0) return 1;
  const parts = [...byClass].map(([cls, w]) => ({ w, c: continueProb(cls, f, beingRaised, profile) })).filter((x) => x.c > 0);
  const defended = (m: number) => parts.reduce((t, x) => t + x.w * Math.min(1, x.c * m), 0) / total;
  const defend = beingRaised ? ACTIONS.facingRaise.defend : ACTIONS.facingBet.defend;
  const target = defend / (1 + Math.max(0, f)) + profile.continueAdd;
  if (defended(1) >= target) return 1;
  // No class continues more than maxBoost times as often as it would alone, so a polarized range
  // (strong hands and air) still folds its air and may stay short of the floor.
  let hi = Math.max(1, Math.min(ACTIONS.facingBet.maxBoost, Math.max(...parts.map((x) => 1 / x.c))));
  if (defended(hi) <= target) return hi;
  let lo = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (defended(mid) < target) lo = mid;
    else hi = mid;
  }
  return hi;
}

/** rangeDefense for a range of combos on this board. */
export function rangeDefenseOn(range: Range, board: readonly Card[], f: number, beingRaised = false, profile: Profile = DEFAULT): number {
  const classes: PostflopClass[] = [];
  const weights: number[] = [];
  const boardSet = new Set(board);
  for (let i = 0; i < NUM_COMBOS; i++) {
    if (!(range[i] > 0)) continue;
    const [a, b] = COMBO_CARDS[i];
    if (boardSet.has(a) || boardSet.has(b)) continue;
    classes.push(classifyHand([a, b], board));
    weights.push(range[i]);
  }
  return rangeDefense(classes, weights, f, beingRaised, profile);
}

/** `intoAggressor`: the opponent made the last bet or raise on the previous street. */
export function firstToActFreq(
  cls: PostflopClass,
  intoAggressor = false,
  profile: Profile = DEFAULT,
): { check: number; small: number; big: number } {
  const t = intoAggressor ? ACTIONS.leadIntoAggressor : ACTIONS.firstToAct;
  const m = profile.betMult * bluffScale(cls, profile);
  let small = t.betSmall[cls] * m;
  let big = t.betBig[cls] * m;
  if (small + big > 1) {
    const k = 1 / (small + big);
    small *= k;
    big *= k;
  }
  return { check: clip01(1 - small - big), small, big };
}

/**
 * What the hero adds on the streets after `street` against one opponent hand of class `cls`,
 * with equity `eq` against it, when the hand goes on with `pot` in the middle and `behind`
 * left to bet: one bet per later street, growing with the pot and capped by the stacks, won
 * in proportion to the hero's edge and to how often that hand calls a bet of that size.
 * See laterStreets in actions.json.
 */
export function laterStreetValue(street: string, cls: PostflopClass, eq: number, pot: number, behind: number, profile: Profile = DEFAULT): number {
  const streets = street === 'flop' ? 2 : street === 'turn' ? 1 : 0;
  const edge = 2 * eq - 1;
  if (streets === 0 || behind <= 0 || edge <= 0) return 0;
  const { betSize } = ACTIONS.laterStreets;
  let total = 0, p = pot, left = behind;
  for (let i = 0; i < streets && left > 0; i++) {
    const bet = Math.min(betSize * p, left);
    total += bet;
    p += 2 * bet;
    left -= bet;
  }
  return edge * continueProb(cls, betSize, false, profile) * total;
}

export const realization = (street: string, inPosition: boolean, cls: PostflopClass): number =>
  street === 'river'
    ? 1
    : Math.min(1.1, (inPosition ? ACTIONS.realization.inPosition : ACTIONS.realization.outOfPosition) * ACTIONS.realization.byClass[cls]);

/** Class of every live combo for this board, or null when a card is dead. */
export function comboClasses(board: readonly Card[], dead: readonly Card[]): (PostflopClass | null)[] {
  const d = new Set(dead);
  return COMBO_CARDS.map(([a, b]) => (d.has(a) || d.has(b) ? null : classifyHand([a, b], board)));
}

export type PostflopMove =
  | { kind: 'check'; intoAggressor?: boolean }
  | { kind: 'bet'; f: number; intoAggressor?: boolean; allIn?: boolean }
  | { kind: 'call'; f: number; beingRaised?: boolean; canRaise?: boolean }
  | { kind: 'raise'; f: number; beingRaised?: boolean }
  | { kind: 'checkBehind' };

/**
 * Keeps each combo at the probability that its class takes `move`. `f` is the bet faced
 * (or made) divided by the pot before it. Weights multiply, like preflop narrowing.
 */
export function narrowPostflop(range: Range, board: readonly Card[], move: PostflopMove, profile: Profile = DEFAULT): Range {
  const out = new Float32Array(NUM_COMBOS);
  const boardSet = new Set(board);
  const facing = move.kind === 'call' || move.kind === 'raise';
  const defense = facing ? rangeDefenseOn(range, board, move.f, move.beingRaised, profile) : 1;
  for (let i = 0; i < NUM_COMBOS; i++) {
    if (!(range[i] > 0)) continue;
    const [a, b] = COMBO_CARDS[i];
    if (boardSet.has(a) || boardSet.has(b)) continue;
    const cls = classifyHand([a, b], board);
    let p: number;
    switch (move.kind) {
      case 'check':
        p = firstToActFreq(cls, move.intoAggressor, profile).check;
        break;
      case 'checkBehind':
        p = firstToActFreq(cls, false, profile).check;
        break;
      case 'bet': {
        const fr = firstToActFreq(cls, move.intoAggressor, profile);
        // An all-in bet can come from either size once the stack is short, so it keeps both shares.
        p = move.allIn ? fr.small + fr.big : move.f <= SMALL_BET_MAX ? fr.small : fr.big;
        break;
      }
      case 'call':
        p = responseFor(cls, move.f, move.canRaise !== false, move.beingRaised, profile, defense).call;
        break;
      case 'raise':
        p = responseFor(cls, move.f, true, move.beingRaised, profile, defense).raise;
        break;
    }
    out[i] = range[i] * p;
  }
  return out;
}
