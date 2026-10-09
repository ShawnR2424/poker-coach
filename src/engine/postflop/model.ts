// Opponent behavior after the flop, by hand class. Used both to narrow a range from the
// actions a player took and to predict how they respond to the hero's bets.

import table from '../../../data/postflop/actions.json';
import type { Card } from '../cards';
import { COMBO_CARDS, NUM_COMBOS, type Range } from '../range';
import { classifyHand, type PostflopClass } from './classify';

type ByClass = Record<PostflopClass, number>;

export const ACTIONS = table as unknown as {
  firstToAct: { betSmall: ByClass; betBig: ByClass };
  leadIntoAggressor: { betSmall: ByClass; betBig: ByClass };
  facingBet: { base: ByClass; slope: ByClass; raise: ByClass };
  facingRaise: { continue: ByClass };
  realization: { inPosition: number; outOfPosition: number; byClass: ByClass };
};

/** Bets up to this fraction of the pot count as "small" when narrowing. */
export const SMALL_BET_MAX = 0.5;

const clip01 = (x: number) => Math.min(1, Math.max(0, x));

/**
 * How likely a hand class continues (calls or raises) facing a bet of `f` times the pot.
 * `beingRaised` is true when the player had bet and now faces a raise.
 */
export function continueProb(cls: PostflopClass, f: number, beingRaised = false): number {
  const p = clip01(ACTIONS.facingBet.base[cls] - ACTIONS.facingBet.slope[cls] * f);
  return beingRaised ? p * ACTIONS.facingRaise.continue[cls] : p;
}

export interface Response {
  fold: number;
  call: number;
  raise: number;
}

export function responseFor(cls: PostflopClass, f: number, canRaise: boolean, beingRaised = false): Response {
  const cont = continueProb(cls, f, beingRaised);
  const raise = canRaise ? cont * ACTIONS.facingBet.raise[cls] : 0;
  return { fold: 1 - cont, call: cont - raise, raise };
}

/** `intoAggressor`: the opponent made the last bet or raise on the previous street. */
export function firstToActFreq(cls: PostflopClass, intoAggressor = false): { check: number; small: number; big: number } {
  const t = intoAggressor ? ACTIONS.leadIntoAggressor : ACTIONS.firstToAct;
  const small = t.betSmall[cls];
  const big = t.betBig[cls];
  return { check: clip01(1 - small - big), small, big };
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
  | { kind: 'bet'; f: number; intoAggressor?: boolean }
  | { kind: 'call'; f: number; beingRaised?: boolean }
  | { kind: 'raise'; f: number; beingRaised?: boolean }
  | { kind: 'checkBehind' };

/**
 * Keeps each combo at the probability that its class takes `move`. `f` is the bet faced
 * (or made) divided by the pot before it. Weights multiply, like preflop narrowing.
 */
export function narrowPostflop(range: Range, board: readonly Card[], move: PostflopMove): Range {
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
        p = firstToActFreq(cls, move.intoAggressor).check;
        break;
      case 'checkBehind':
        p = firstToActFreq(cls).check;
        break;
      case 'bet': {
        const fr = firstToActFreq(cls, move.intoAggressor);
        p = move.f <= SMALL_BET_MAX ? fr.small : fr.big;
        break;
      }
      case 'call':
        p = responseFor(cls, move.f, true, move.beingRaised).call;
        break;
      case 'raise':
        p = responseFor(cls, move.f, true, move.beingRaised).raise;
        break;
    }
    out[i] = range[i] * p;
  }
  return out;
}
