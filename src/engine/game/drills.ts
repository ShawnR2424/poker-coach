// Leak practice for postflop leaks. Steering the preflop spot (levels.ts) can't produce, say, a
// checked-to-you flop with a strong hand, so for a postflop leak the trainer plays the hero's
// earlier decisions with the bots' strategy (as level 6 does) and keeps the hand once it
// reaches a decision where that leak's tag is one of the tags a wrong action would earn.

import { comboEquities } from '../equity';
import { applyAction, legalActions, type HandState } from '../hand';
import { spr as sprOf } from '../math';
import { strongShare } from '../postflop/heroRange';
import { botPostflopAction } from '../postflop/bot';
import { classifyHand, type PostflopClass } from '../postflop/classify';
import { PROFILES } from '../postflop/model';
import { narrowHand } from '../postflop/narrow';
import { analyze, leaksAtRisk, situationFromState, type PostflopSituation } from '../postflop/recommend';
import { botAction, type PreflopOptions } from '../preflop/policy';
import type { TableOptions } from '../preflop/scenario';
import type { Rng } from '../rng';
import { advance, heroDecides, isMultiway, LEVELS, liveVillains, newGameHand, type GameHand, type LevelId } from './levels';

interface Spot {
  s: HandState;
  sit: PostflopSituation;
  cls: PostflopClass;
  facing: boolean;
  canBet: boolean;
  canRaise: boolean;
  spr: number;
}

const THIN = new Set<PostflopClass>(['topPairWeak', 'middlePair', 'weakPair']);
const STRONG = new Set<PostflopClass>(['setPlus', 'twoPair', 'overpair', 'topPairGood']);
const WEAK = new Set<PostflopClass>(['middlePair', 'weakPair', 'weakDraw', 'air']);
const CONTINUE = new Set<PostflopClass>(['setPlus', 'twoPair', 'overpair', 'topPairGood', 'topPairWeak', 'strongDraw']);

/**
 * Postflop leak tags the trainer can build hands for, each with a cheap check that a decision
 * is worth the full analysis. The analysis (leaksAtRisk) has the final say.
 */
export const POSTFLOP_DRILLS: Record<string, (x: Spot) => boolean> = {
  'raised top pair into a strong range': (x) =>
    x.facing && x.canRaise && (x.cls === 'topPairGood' || x.cls === 'topPairWeak') && strongShare(x.sit.villainRange, x.sit.board, [...x.sit.hero, ...x.sit.board]) >= 0.3,
  'middle sizing at low stack-to-pot ratio': (x) => (x.canBet || x.canRaise) && x.spr < 2.5 && STRONG.has(x.cls),
  'oversized thin value bet': (x) => x.canBet && THIN.has(x.cls),
  'missed value bet': (x) => x.canBet && STRONG.has(x.cls),
  'calling without the price': (x) => x.facing && WEAK.has(x.cls),
  'sunk-cost call': (x) => x.facing && WEAK.has(x.cls) && x.sit.heroInvested >= 0.3 * (x.sit.heroInvested + x.sit.heroBehind),
  overfolding: (x) => x.facing && CONTINUE.has(x.cls),
  'bluffed into a sticky range': (x) => (x.canBet || x.canRaise) && x.cls === 'air',
  'donk bet into the preflop raiser': (x) => x.s.street === 'flop' && x.canBet && x.sit.heroFirstToAct && !x.sit.heroInPosition && !x.sit.heroPreflopAggressor,
};

/** Leaks that only show up on the flop, so level 6 (river decisions only) can't host them. */
const FLOP_ONLY = new Set(['donk bet into the preflop raiser']);

/** Full analyses per drill hand; each costs up to about a tenth of a second on the flop. */
const MAX_ANALYSES = 6;
const MAX_HANDS = 40;

function spotAt(g: GameHand, s: HandState, opts: PreflopOptions): Spot | null {
  const live = liveVillains(g, s);
  if (live.length !== 1) return null;
  const v = live[0];
  const profile = PROFILES[g.profiles[v] ?? 'regular'];
  const range = narrowHand(s, v, 'pool', opts, profile).range;
  const pre = s.actions.filter((a) => a.street === 'preflop' && a.type === 'raise');
  const sit = situationFromState(s, g.hero, v, range, {
    heroRange: narrowHand(s, g.hero, 'baseline', opts).range,
    heroPreflopAggressor: pre.length > 0 && pre[pre.length - 1].player === g.hero,
    villainProfile: profile,
  });
  const l = legalActions(s);
  const hc = s.players[g.hero].committed, vc = s.players[v].committed;
  return {
    s,
    sit,
    cls: classifyHand(sit.hero, sit.board),
    facing: l.call !== null,
    canBet: l.bet !== null,
    canRaise: l.raise !== null,
    spr: sprOf(Math.min(sit.heroBehind + hc, sit.villainBehind + vc) - Math.max(hc, vc), sit.pot),
  };
}

/**
 * A hand at `level` that reaches a hero decision where `tag` can show up, with the hero's
 * earlier decisions played by the bots. Null when the level can't host it (preflop-only and
 * multiway levels) or no such decision came up within the search budget.
 */
export function drillHand(level: LevelId, rng: Rng, opts: PreflopOptions & TableOptions, tag: string): GameHand | null {
  const check = POSTFLOP_DRILLS[tag];
  const L = LEVELS[level];
  if (!check || !L.postflop || isMultiway(level) || (L.riverOnly && FLOP_ONLY.has(tag))) return null;
  let analyses = 0;
  for (let hand = 0; hand < MAX_HANDS && analyses < MAX_ANALYSES; hand++) {
    const g = newGameHand(level, rng, opts);
    let s = advance(g, g.state, rng, opts);
    for (let guard = 0; guard < 20 && heroDecides(g, s); guard++) {
      if (s.street !== 'preflop' && (!L.riverOnly || s.street === 'river')) {
        const x = spotAt(g, s, opts);
        if (x && check(x)) {
          analyses++;
          const a = analyze(x.sit, comboEquities(x.sit.hero, x.sit.board, x.sit.villainRange));
          if (leaksAtRisk(x.sit, a).includes(tag)) return { ...g, state: s, focus: tag, drilled: true };
          if (analyses >= MAX_ANALYSES) break;
        }
      }
      const a = s.street === 'preflop' ? botAction(s, rng, opts) : botPostflopAction(s, rng, PROFILES.regular);
      s = advance(g, applyAction(s, a), rng, opts);
    }
  }
  return null;
}

/**
 * The next practice hand. With open leaks, about half the hands practice one: a postflop leak
 * gets a drill hand when the level can host one, and everything else leans the preflop spot mix
 * (newGameHand). The leak is drawn in proportion to how often it has come up.
 */
export function practiceHand(level: LevelId, rng: Rng, opts: PreflopOptions & TableOptions, leaks: { tag: string; weight: number }[] = []): GameHand {
  const drillable = leaks.filter((l) => POSTFLOP_DRILLS[l.tag]);
  if (drillable.length && LEVELS[level].postflop && !isMultiway(level) && rng() < 0.5) {
    const total = leaks.reduce((t, l) => t + l.weight, 0);
    let x = rng() * total;
    const pick = leaks.find((l) => (x -= l.weight) < 0) ?? leaks[leaks.length - 1];
    if (POSTFLOP_DRILLS[pick.tag]) {
      const g = drillHand(level, rng, opts, pick.tag);
      if (g) return g;
    }
  }
  return newGameHand(level, rng, opts, leaks);
}
