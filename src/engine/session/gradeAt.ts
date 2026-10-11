// Grading a hero decision inside a saved hand: the preflop chart decision or the postflop
// analysis at one step of a replay, read with the same ranges and opponent styles the hand was
// played with. Imports grade every decision this way, and mistake review re-grades one.

import { formatCards } from '../cards';
import { comboEquities } from '../equity';
import type { HandState } from '../hand';
import { PROFILES, type ProfileId } from '../postflop/model';
import { analyzeMultiway, multiwaySituationFromState } from '../postflop/multiway';
import { narrowHand } from '../postflop/narrow';
import { analyze, situationFromState, type Analysis, type DecisionBasics } from '../postflop/recommend';
import type { PreflopOptions } from '../preflop/policy';
import { adaptProfile } from './adapt';
import { replayAdaptation, type HandReplay } from './replay';

const STREET_LABEL: Record<string, string> = { flop: 'Flop', turn: 'Turn', river: 'River' };

/** The chart options a replayed hand was played with. */
export const replayOptions = (r: HandReplay): PreflopOptions => ({
  lowStakes: r.lowStakes ?? true,
  stacksBB: r.stacks[r.hero] / r.config.bb,
  rake: r.config.rake,
});

/** A seat's style as it was in the hand, adjustments included (imported hands use the regular style). */
export const replayProfile = (r: HandReplay, seat: number) =>
  adaptProfile(PROFILES[(r.profiles[seat] ?? 'regular') as ProfileId] ?? PROFILES.regular, replayAdaptation(r));

export interface PostflopSpotAt {
  sit: DecisionBasics;
  analysis: Analysis;
  multiway: boolean;
  /** e.g. "Flop Ts7d3c". */
  label: string;
}

/**
 * The postflop analysis for the hero at state `s`, step `k` of the replay. Null when no
 * opponent is left or a line the charts never take leaves an opponent with no range.
 */
export function postflopSpotAt(r: HandReplay, s: HandState, k: number): PostflopSpotAt | null {
  const opts = replayOptions(r);
  const live = r.villains.filter((v) => !s.players[v].folded);
  if (!live.length) return null;
  const pre = s.actions.filter((x) => x.street === 'preflop' && x.type === 'raise');
  const heroPreflopAggressor = pre.length > 0 && pre[pre.length - 1].player === r.hero;
  const heroRange = narrowHand(s, r.hero, 'baseline', opts).range;
  const views = live.map((v) => {
    const profile = replayProfile(r, v);
    return { seat: v, range: narrowHand(s, v, 'pool', opts, profile).range, profile };
  });
  if (views.some((v) => !v.range.some((x) => x > 0))) return null;
  const label = `${STREET_LABEL[s.street]} ${formatCards(s.board)}`;
  if (views.length === 1) {
    const v = views[0];
    const sit = situationFromState(s, r.hero, v.seat, v.range, { heroRange, heroPreflopAggressor, villainProfile: v.profile });
    return { sit, analysis: analyze(sit, comboEquities(sit.hero, sit.board, sit.villainRange)), multiway: false, label };
  }
  const sit = multiwaySituationFromState(s, r.hero, views, { heroRange, heroPreflopAggressor });
  return { sit, analysis: analyzeMultiway(sit, { seed: k + 1 }).analysis, multiway: true, label };
}
