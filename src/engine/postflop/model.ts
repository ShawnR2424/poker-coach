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
  facingBet: { base: ByClass; slope: ByClass; raise: ByClass; maxSize: number; overbetDecay: number };
  facingRaise: { continue: ByClass };
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
}
export const PROFILES = Object.fromEntries(
  Object.entries(profileTable).filter(([k]) => !k.startsWith('_')),
) as Record<ProfileId, Profile>;
export const PROFILE_IDS = Object.keys(PROFILES) as ProfileId[];
const DEFAULT: Profile = PROFILES.regular;

/** Classes whose willingness to continue does not depend on the player's style. */
const STYLE_FREE = new Set<PostflopClass>(['setPlus', 'twoPair']);

/** Bets up to this fraction of the pot count as "small" when narrowing. */
export const SMALL_BET_MAX = 0.5;

const clip01 = (x: number) => Math.min(1, Math.max(0, x));

/**
 * How likely a hand class continues (calls or raises) facing a bet of `f` times the pot.
 * `beingRaised` is true when the player had bet and now faces a raise.
 */
export function continueProb(cls: PostflopClass, f: number, beingRaised = false, profile: Profile = DEFAULT): number {
  const add = STYLE_FREE.has(cls) ? 0 : profile.continueAdd;
  const { base, slope, maxSize, overbetDecay } = ACTIONS.facingBet;
  let p = clip01(base[cls] + add - slope[cls] * Math.min(f, maxSize));
  // Past an overbet, the straight line would fold even overpairs to a shove; see actions.json.
  if (f > maxSize) p *= (maxSize / f) ** (overbetDecay * slope[cls]);
  return beingRaised ? p * ACTIONS.facingRaise.continue[cls] : p;
}

export interface Response {
  fold: number;
  call: number;
  raise: number;
}

export function responseFor(cls: PostflopClass, f: number, canRaise: boolean, beingRaised = false, profile: Profile = DEFAULT): Response {
  const cont = continueProb(cls, f, beingRaised, profile);
  const raise = canRaise ? cont * Math.min(1, ACTIONS.facingBet.raise[cls] * profile.raiseMult) : 0;
  return { fold: 1 - cont, call: cont - raise, raise };
}

/** `intoAggressor`: the opponent made the last bet or raise on the previous street. */
export function firstToActFreq(
  cls: PostflopClass,
  intoAggressor = false,
  profile: Profile = DEFAULT,
): { check: number; small: number; big: number } {
  const t = intoAggressor ? ACTIONS.leadIntoAggressor : ACTIONS.firstToAct;
  let small = t.betSmall[cls] * profile.betMult;
  let big = t.betBig[cls] * profile.betMult;
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
        p = responseFor(cls, move.f, move.canRaise !== false, move.beingRaised, profile).call;
        break;
      case 'raise':
        p = responseFor(cls, move.f, true, move.beingRaised, profile).raise;
        break;
    }
    out[i] = range[i] * p;
  }
  return out;
}
