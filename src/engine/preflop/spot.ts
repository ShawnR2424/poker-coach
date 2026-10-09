// Works out which preflop chart applies to a player, from the actions taken so far.

import type { ActionRecord, HandState } from '../hand';
import type { Position } from '../positions';
import { CHARTS, LIMP_SIZING, LOWSTAKES, type SpotKind } from './charts';

export interface PreflopSpot {
  kind: SpotKind;
  /** Chart key inside data/preflop for this kind. */
  key: string;
  player: number;
  position: Position;
  /** Seat index of the player whose raise we face (or the first limper). */
  aggressor: number | null;
  /** Raise "to" amounts, in order. */
  raiseTos: number[];
  callers: number;
  limpers: number;
  /** True when this player will act after the aggressor on every postflop street. */
  inPosition: boolean;
  /** Plain description such as "BB vs BTN open". */
  label: string;
}

const isBlind = (p: Position) => p === 'SB' || p === 'BB';

/**
 * Classifies the spot for `player` given the preflop actions before their decision.
 * Seats are clockwise from the SB, so a higher seat index acts later postflop.
 */
export function classifySpot(positions: Position[], actions: ActionRecord[], player: number): PreflopSpot {
  const acts = actions.filter((a) => a.street === 'preflop' && a.type !== 'post');
  const raises = acts.filter((a) => a.type === 'raise' || a.type === 'bet');
  const pos = positions[player];
  const base = { player, position: pos, raiseTos: raises.map((r) => r.to) };
  const ip = (other: number) => player > other;

  if (raises.length === 0) {
    const limps = acts.filter((a) => a.type === 'call');
    if (limps.length === 0) {
      return { ...base, kind: 'rfi', key: pos, aggressor: null, callers: 0, limpers: 0, inPosition: false, label: `${pos} first in` };
    }
    const first = limps[0].player;
    return {
      ...base, kind: 'vsLimp', key: pos, aggressor: first, callers: 0, limpers: limps.length,
      inPosition: ip(first), label: `${pos} vs ${limps.length} limper${limps.length > 1 ? 's' : ''}`,
    };
  }

  const raisers = raises.map((r) => r.player);
  const opener = raisers[0];
  const last = raisers[raisers.length - 1];
  const callersAfterLast = acts.slice(acts.lastIndexOf(raises[raises.length - 1]) + 1).filter((a) => a.type === 'call' && a.player !== player).length;
  const common = { ...base, aggressor: last, callers: callersAfterLast, limpers: 0, inPosition: ip(last) };

  if (raises.length === 1) {
    if (callersAfterLast === 0) {
      return { ...common, kind: 'vsOpen', key: `${pos}_vs_${positions[opener]}`, label: `${pos} vs ${positions[opener]} open` };
    }
    return {
      ...common, kind: 'squeeze', key: isBlind(pos) ? 'blinds' : 'IP',
      label: `${pos} vs ${positions[opener]} open and ${callersAfterLast} caller${callersAfterLast > 1 ? 's' : ''}`,
    };
  }
  if (raises.length === 2 && player === opener) {
    const threeBettor = raisers[1];
    const key = `${pos}_vs_${isBlind(positions[threeBettor]) ? 'blinds' : 'IP'}`;
    return { ...common, kind: 'vs3bet', key, label: `${pos} open vs ${positions[threeBettor]} 3-bet` };
  }
  if (raises.length === 2) {
    return { ...common, kind: 'cold4bet', key: 'any', label: `${pos} vs open and 3-bet` };
  }
  if (raises.length === 3 && player === raisers[1]) {
    return {
      ...common, kind: 'vs4bet', key: ip(last) ? 'IP' : 'OOP',
      label: `${pos} 3-bet vs ${positions[last]} 4-bet`,
    };
  }
  return { ...common, kind: 'vsJam', key: 'any', label: `${pos} facing a big re-raise` };
}

export function spotFor(s: HandState, player: number): PreflopSpot {
  return classifySpot(s.players.map((p) => p.position), s.actions, player);
}

export function hasChart(spot: PreflopSpot): boolean {
  return !!CHARTS[spot.kind][spot.key];
}

/**
 * Chip amount ("to") of the chart's raise for this spot, before clamping to the stack.
 * Returns Infinity for all-in sizes.
 */
export function chartRaiseTo(spot: PreflopSpot, bb: number, lowStakes: boolean, audience: 'pool' | 'hero' | 'baseline'): number {
  const entry = CHARTS[spot.kind][spot.key];
  const last = spot.raiseTos[spot.raiseTos.length - 1] ?? bb;
  switch (spot.kind) {
    case 'rfi':
      return (entry.size as number) * bb;
    case 'vsLimp': {
      const extra = lowStakes && audience !== 'baseline' ? LOWSTAKES.isoExtraBB : 0;
      const oop = isBlind(spot.position) ? 1 : 0;
      return (LIMP_SIZING.size + LIMP_SIZING.perLimper * spot.limpers + oop + extra) * bb;
    }
    case 'squeeze':
      return ((entry.size as number) + (entry.perCaller ?? 1) * spot.callers) * last;
    case 'vs4bet':
    case 'vsJam':
      return Infinity;
    default:
      return entry.size === 'allin' ? Infinity : (entry.size as number) * last;
  }
}
