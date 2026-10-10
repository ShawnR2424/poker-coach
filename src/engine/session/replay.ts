// A finished practice hand saved compactly enough to keep in localStorage, and rebuilt action
// by action for review. The hand engine is deterministic given the seats, stacks, hole cards,
// board and actions, so replaying the actions reproduces every state the hero saw.

import type { Card } from '../cards';
import { applyAction, newHand, type Action, type HandConfig, type HandState } from '../hand';

export interface HandReplay {
  v: 1;
  config: HandConfig;
  stacks: number[];
  holes: Card[][];
  board: Card[];
  /** Every action after the blinds, as [player, type, to] (`to` only for bets and raises). */
  actions: [number, Action['type'], number?][];
  hero: number;
  villains: number[];
  /** Opponent style ids by seat. */
  profiles: Record<number, string>;
  /** Whether the low-stakes layer was on, so the replay narrows ranges as the read did. */
  lowStakes: boolean;
}

/** Saves a hand from its final state. */
export function replayOf(final: HandState, hero: number, villains: number[], profiles: Record<number, string>, lowStakes = true): HandReplay {
  return {
    v: 1,
    config: final.config,
    stacks: [...final.startingStacks],
    holes: final.players.map((p) => [...p.hole]),
    board: [...final.board],
    actions: final.actions
      .filter((a) => a.type !== 'post')
      .map((a): [number, Action['type'], number?] => (a.type === 'bet' || a.type === 'raise' ? [a.player, a.type, a.to] : [a.player, a.type as Action['type']])),
    hero,
    villains: [...villains],
    profiles: { ...profiles },
    lowStakes,
  };
}

const toAction = ([, type, to]: HandReplay['actions'][number]): Action =>
  (type === 'bet' || type === 'raise' ? { type, to: to! } : { type }) as Action;

/**
 * Every state of the hand: index k is the state after the first k actions (index 0 is right
 * after the blinds), so the last entry is the final state.
 */
export function replayStates(r: HandReplay): HandState[] {
  let s = newHand({ config: r.config, stacks: r.stacks, hole: r.holes, board: r.board, seed: 1 });
  const out = [s];
  for (const a of r.actions) {
    if (s.toAct !== a[0]) throw new Error(`Replay out of step: seat ${a[0]} acted, seat ${s.toAct} was to act`);
    s = applyAction(s, toAction(a));
    out.push(s);
  }
  return out;
}

/** Steps (indices into replayStates) where the hero was to act. */
export function heroSteps(r: HandReplay): number[] {
  return r.actions.map((a, k) => (a[0] === r.hero ? k : -1)).filter((k) => k >= 0);
}
