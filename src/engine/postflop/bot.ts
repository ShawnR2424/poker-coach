// Postflop opponents. They classify their own hand and act with the same probabilities the
// range narrowing assumes, so a read built from their actions always contains their real hand.

import { legalActions, type Action, type HandState } from '../hand';
import type { Rng } from '../rng';
import { classifyHand } from './classify';
import { firstToActFreq, responseFor, type Profile } from './model';
import { currentContext, facedShare } from './narrow';

/** Pot shares the bots use for small and big bets (small is ≤ half pot, big is more). */
export const BOT_SIZES = { small: 0.33, big: 0.75, raiseMult: 3 };

const roundTo = (x: number, unit: number) => Math.max(unit, Math.round(x / unit) * unit);

export function botPostflopAction(s: HandState, rng: Rng, profile: Profile): Action {
  const i = s.toAct;
  if (i === null) throw new Error('Nobody to act');
  if (s.street === 'preflop') throw new Error('Postflop only');
  const p = s.players[i];
  const cls = classifyHand(p.hole, s.board);
  const ctx = currentContext(s, i);
  const legal = legalActions(s);
  const unit = s.config.sb;

  if (legal.check) {
    const fr = firstToActFreq(cls, ctx.intoAggressor, profile);
    const x = rng();
    if (!legal.bet || x < fr.check) return { type: 'check' };
    const share = x < fr.check + fr.small ? BOT_SIZES.small : BOT_SIZES.big;
    const to = Math.min(legal.bet.max, Math.max(legal.bet.min, roundTo(share * ctx.pot, unit)));
    // A bet that would leave a sliver behind goes all-in instead.
    return { type: 'bet', to: to > legal.bet.max * 0.8 ? legal.bet.max : to };
  }

  const resp = responseFor(cls, facedShare(ctx), !!legal.raise && !ctx.facingAllIn, ctx.beingRaised, profile);
  const x = rng();
  if (x < resp.fold) return { type: 'fold' };
  if (x < resp.fold + resp.call || !legal.raise) return { type: 'call' };
  const to = Math.min(legal.raise.max, Math.max(legal.raise.min, roundTo(s.currentBet * BOT_SIZES.raiseMult, unit)));
  return { type: 'raise', to: to > legal.raise.max * 0.7 ? legal.raise.max : to };
}
