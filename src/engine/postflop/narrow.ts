// A player's range through the whole hand: preflop chart narrowing, then the postflop model
// applied to each of their actions on the board as it was at the time.

import type { HandState, Street } from '../hand';
import type { Audience } from '../preflop/charts';
import { narrowPreflop, type PreflopOptions } from '../preflop/policy';
import type { Range } from '../range';
import { narrowPostflop, type PostflopMove } from './model';

const BOARD_LEN: Record<Street, number> = { preflop: 0, flop: 3, turn: 4, river: 5 };

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
): { range: Range; preflop: Range; steps: PostflopStep[] } {
  const positions = s.players.map((p) => p.position);
  const { range: preflop } = narrowPreflop(positions, s.actions, player, audience, opts);
  let range = preflop;
  const steps: PostflopStep[] = [];
  let potRunning = 0;
  let street: Street = 'preflop';
  let currentBet = 0;
  // Last player to bet or raise on the previous street (null when it checked through).
  let prevAggressor: number | null = null;
  let streetAggressor: number | null = null;
  const betThisStreet = new Set<number>();
  for (const a of s.actions) {
    if (a.street !== street) {
      street = a.street;
      currentBet = 0;
      prevAggressor = streetAggressor;
      streetAggressor = null;
      betThisStreet.clear();
    }
    if (a.street !== 'preflop' && a.player === player) {
      const committedBefore = a.to - a.added;
      const faced = currentBet - committedBefore;
      let move: PostflopMove | null = null;
      const intoAggressor = prevAggressor !== null && prevAggressor !== player;
      const beingRaised = betThisStreet.has(player);
      if (a.type === 'check') move = { kind: 'check', intoAggressor };
      else if (a.type === 'bet') move = { kind: 'bet', f: a.added / Math.max(1, potRunning), intoAggressor };
      else if (a.type === 'call') move = { kind: 'call', f: faced / Math.max(1, potRunning - faced), beingRaised };
      else if (a.type === 'raise') move = { kind: 'raise', f: faced / Math.max(1, potRunning - faced), beingRaised };
      if (move) {
        const board = s.board.slice(0, BOARD_LEN[a.street]);
        const after = narrowPostflop(range, board, move);
        steps.push({ street: a.street, move, before: range, after });
        range = after;
      }
    }
    potRunning += a.added;
    if (a.type === 'bet' || a.type === 'raise') {
      streetAggressor = a.player;
      betThisStreet.add(a.player);
    }
    currentBet = Math.max(currentBet, a.to);
  }
  return { range, preflop, steps };
}
