// Turns chart frequencies into engine actions, and narrows a player's range from their preflop actions.

import { comboIndex } from '../range';
import { legalActions, type Action, type ActionRecord, type HandState } from '../hand';
import type { Position } from '../positions';
import type { Rng } from '../rng';
import { chartDepth, frequencies, getStrategy, type Audience, type Choice, type Frequencies, type Strategy } from './charts';
import { chartRaiseTo, classifySpot, hasChart, spotFor, type PreflopSpot } from './spot';
import { NUM_COMBOS, type Range } from '../range';

export interface PreflopOptions {
  lowStakes: boolean;
  /** Starting stacks in big blinds (100 when missing); picks the chart depth. */
  stacksBB?: number;
}

/** The chart depth these options play at. */
export const depthOf = (opts: PreflopOptions) => chartDepth(opts.stacksBB);

export function strategyFor(spot: PreflopSpot, audience: Audience, opts: PreflopOptions): Strategy {
  return getStrategy(spot.kind, spot.key, audience, opts.lowStakes, depthOf(opts));
}

/** Converts a chart choice into a legal engine action for the player to act. */
export function choiceToAction(s: HandState, spot: PreflopSpot, choice: Choice, audience: Audience, opts: PreflopOptions): Action {
  const legal = legalActions(s);
  if (choice === 'raise') {
    const range = legal.raise ?? legal.bet;
    if (range) {
      const target = chartRaiseTo(spot, s.config.bb, opts.lowStakes, audience, depthOf(opts));
      const to = Math.min(range.max, Math.max(range.min, Math.round(target / s.config.sb) * s.config.sb));
      return { type: legal.raise ? 'raise' : 'bet', to: Number.isFinite(target) ? to : range.max };
    }
    choice = 'call';
  }
  if (choice === 'call' && legal.call !== null) return { type: 'call' };
  return legal.check ? { type: 'check' } : { type: 'fold' };
}

/** Which chart choice an engine action corresponds to. A free check counts as the passive "fold" branch. */
export function actionToChoice(type: Action['type'] | ActionRecord['type']): Choice {
  if (type === 'raise' || type === 'bet') return 'raise';
  if (type === 'call') return 'call';
  return 'fold';
}

export function sampleChoice(f: Frequencies, rng: Rng): Choice {
  const x = rng();
  if (x < f.raise) return 'raise';
  if (x < f.raise + f.call) return 'call';
  return 'fold';
}

/** Chart-driven decision for an opponent holding `s.players[toAct].hole`. */
export function botAction(s: HandState, rng: Rng, opts: PreflopOptions): Action {
  const i = s.toAct!;
  const spot = spotFor(s, i);
  if (!hasChart(spot)) return legalActions(s).check ? { type: 'check' } : { type: 'fold' };
  const strat = strategyFor(spot, 'pool', opts);
  const [a, b] = s.players[i].hole;
  return choiceToAction(s, spot, sampleChoice(frequencies(strat, comboIndex(a, b)), rng), 'pool', opts);
}

export interface NarrowStep {
  spot: PreflopSpot;
  choice: Choice;
  before: Range;
  after: Range;
}

/**
 * A player's preflop range: start from every hand, then for each of their actions keep each combo
 * at the chart frequency of the action they took. Weights multiply, so mixed hands stay partial.
 */
export function narrowPreflop(
  positions: Position[],
  actions: ActionRecord[],
  player: number,
  audience: Audience,
  opts: PreflopOptions,
): { range: Range; steps: NarrowStep[] } {
  let range: Range = new Float32Array(NUM_COMBOS).fill(1);
  const steps: NarrowStep[] = [];
  const pre = actions.filter((a) => a.street === 'preflop');
  pre.forEach((a, idx) => {
    if (a.player !== player || a.type === 'post') return;
    const spot = classifySpot(positions, pre.slice(0, idx), player);
    if (!hasChart(spot)) return;
    const strat = getStrategy(spot.kind, spot.key, audience, opts.lowStakes, depthOf(opts));
    const choice = actionToChoice(a.type);
    const before = range;
    const after = new Float32Array(NUM_COMBOS);
    for (let i = 0; i < NUM_COMBOS; i++) {
      const f = frequencies(strat, i);
      after[i] = before[i] * f[choice];
    }
    // A BB check after limps keeps everything that didn't raise; that is the "fold" branch here.
    range = after;
    steps.push({ spot, choice, before, after });
  });
  return { range, steps };
}
