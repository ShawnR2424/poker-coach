// A player's range through the whole hand: preflop chart narrowing, then the postflop model
// applied to each of their actions on the board as it was at the time.
// The bots (bot.ts) read the same context, so what they do and how we narrow always agree.

import type { ActionRecord, HandState, Street } from '../hand';
import type { Audience } from '../preflop/charts';
import { narrowPreflop, type PreflopOptions } from '../preflop/policy';
import type { Range } from '../range';
import { narrowPostflop, type PostflopMove, type Profile } from './model';

export const BOARD_LEN: Record<Street, number> = { preflop: 0, flop: 3, turn: 4, river: 5 };

/** What a player knows when it is their turn, before their action. */
export interface ActionContext {
  street: Street;
  /** Chips in the pot, including bets on this street. */
  pot: number;
  /** Highest street total so far. */
  currentBet: number;
  /** The opponent made the last bet or raise on the previous street. */
  intoAggressor: boolean;
  /** This player already bet or raised on this street, so a bet now facing them is a raise. */
  beingRaised: boolean;
  /** The last bet or raise on this street was all-in, so raising is impossible. */
  facingAllIn: boolean;
  /** Chips this player has in on this street. */
  committed: number;
}

class Walker {
  street: Street = 'preflop';
  pot = 0;
  currentBet = 0;
  prevAggressor: number | null = null;
  streetAggressor: number | null = null;
  lastBetAllIn = false;
  readonly betThisStreet = new Set<number>();
  readonly committed = new Map<number, number>();

  enter(street: Street) {
    if (street === this.street) return;
    this.street = street;
    this.currentBet = 0;
    this.prevAggressor = this.streetAggressor;
    this.streetAggressor = null;
    this.lastBetAllIn = false;
    this.betThisStreet.clear();
    this.committed.clear();
  }

  contextFor(player: number): ActionContext {
    return {
      street: this.street,
      pot: this.pot,
      currentBet: this.currentBet,
      intoAggressor: this.prevAggressor !== null && this.prevAggressor !== player,
      beingRaised: this.betThisStreet.has(player),
      facingAllIn: this.lastBetAllIn,
      committed: this.committed.get(player) ?? 0,
    };
  }

  apply(a: ActionRecord) {
    this.enter(a.street);
    this.pot += a.added;
    this.committed.set(a.player, a.to);
    if (a.type === 'bet' || a.type === 'raise') {
      this.streetAggressor = a.player;
      this.betThisStreet.add(a.player);
      this.lastBetAllIn = a.allIn;
    }
    this.currentBet = Math.max(this.currentBet, a.to);
  }
}

/** The bet faced as a share of the pot before that bet: the `f` the response tables use. */
export const facedShare = (ctx: ActionContext): number => {
  const faced = ctx.currentBet - ctx.committed;
  return faced / Math.max(1, ctx.pot - faced);
};

/** Converts a recorded postflop action into a narrowing move, given the context before it. */
export function moveFor(a: ActionRecord, ctx: ActionContext): PostflopMove | null {
  if (a.type === 'check') return { kind: 'check', intoAggressor: ctx.intoAggressor };
  if (a.type === 'bet') return { kind: 'bet', f: a.added / Math.max(1, ctx.pot), intoAggressor: ctx.intoAggressor, allIn: a.allIn };
  if (a.type === 'call') return { kind: 'call', f: facedShare(ctx), beingRaised: ctx.beingRaised, canRaise: !ctx.facingAllIn };
  if (a.type === 'raise') return { kind: 'raise', f: facedShare(ctx), beingRaised: ctx.beingRaised };
  return null;
}

/** Context for `player` right now (they should be the player to act). */
export function currentContext(s: HandState, player: number): ActionContext {
  const w = new Walker();
  for (const a of s.actions) w.apply(a);
  w.enter(s.street);
  return w.contextFor(player);
}

export interface PostflopStep {
  street: Street;
  move: PostflopMove;
  before: Range;
  after: Range;
}

export function narrowHand(
  s: HandState,
  player: number,
  audience: Audience,
  opts: PreflopOptions,
  profile?: Profile,
): { range: Range; preflop: Range; steps: PostflopStep[] } {
  const positions = s.players.map((p) => p.position);
  const { range: preflop } = narrowPreflop(positions, s.actions, player, audience, opts);
  let range = preflop;
  const steps: PostflopStep[] = [];
  const w = new Walker();
  for (const a of s.actions) {
    w.enter(a.street);
    if (a.street !== 'preflop' && a.player === player) {
      const move = moveFor(a, w.contextFor(player));
      if (move) {
        const after = narrowPostflop(range, s.board.slice(0, BOARD_LEN[a.street]), move, profile);
        steps.push({ street: a.street, move, before: range, after });
        range = after;
      }
    }
    w.apply(a);
  }
  return { range, preflop, steps };
}
