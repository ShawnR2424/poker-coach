// Practice levels and the hand loop: generate a hand, let opponents act until the hero must
// decide, and keep only the chosen opponents in (one on levels 2-4 and 6, two on level 5).
// New hands lean toward the spots where the hero's open leaks show up.

import { COMBO_CARDS, NUM_COMBOS, type Range } from '../range';
import { applyAction, legalActions, type HandState } from '../hand';
import type { Card } from '../cards';
import { preflopOrder } from '../positions';
import { CHARTS, getStrategy } from '../preflop/charts';
import { botAction, type PreflopOptions } from '../preflop/policy';
import { DEFAULT_MIX, generatePreflopScenario, type PracticeSpot, type TableOptions } from '../preflop/scenario';
import { vsOpenKey } from '../preflop/spot';
import { randInt, type Rng } from '../rng';
import { botPostflopAction } from '../postflop/bot';
import { classifyHand, type PostflopClass } from '../postflop/classify';
import { PROFILE_IDS, PROFILES, type Profile, type ProfileId } from '../postflop/model';
import { adaptProfile, type Adaptation } from '../session/adapt';


export type LevelId = 1 | 2 | 3 | 4 | 5 | 6;

export interface Level {
  id: LevelId;
  name: string;
  /** Spot mix for the preflop scenario that starts each hand. */
  mix: Partial<Record<PracticeSpot, number>>;
  /** Hands continue past preflop. */
  postflop: boolean;
  /** After the flop betting, the rest is checked down. */
  stopAfterFlop: boolean;
  /** Earlier streets play themselves; the hero decides only on the river, with a medium hand. */
  riverOnly?: boolean;
}

const NO_MIX = { rfi: 0, vsOpen: 0, squeeze: 0, vs3bet: 0, vs4bet: 0 };

export const LEVELS: Record<LevelId, Level> = {
  1: { id: 1, name: 'Preflop only', mix: {}, postflop: false, stopAfterFlop: false },
  2: { id: 2, name: 'Preflop + flop', mix: { ...NO_MIX, rfi: 45, vsOpen: 55 }, postflop: true, stopAfterFlop: true },
  3: { id: 3, name: 'Full hands heads-up', mix: { ...NO_MIX, rfi: 45, vsOpen: 55 }, postflop: true, stopAfterFlop: false },
  4: { id: 4, name: '3-bet and 4-bet pots', mix: { ...NO_MIX, vsOpen: 35, vs3bet: 45, vs4bet: 20 }, postflop: true, stopAfterFlop: false },
  5: { id: 5, name: 'Multiway pots', mix: { ...NO_MIX, rfi: 45, squeeze: 55 }, postflop: true, stopAfterFlop: false },
  6: { id: 6, name: 'Thin value and bluff-catching', mix: { ...NO_MIX, rfi: 45, vsOpen: 55 }, postflop: true, stopAfterFlop: false, riverOnly: true },
};

export const LEVEL_IDS = Object.keys(LEVELS).map(Number) as LevelId[];
export const isMultiway = (level: LevelId) => level === 5;

export interface GameHand {
  state: HandState;
  hero: number;
  level: LevelId;
  /** The opponents who stay in; everyone else folds when it is their turn. Empty on level 1. */
  villains: number[];
  profiles: Record<number, ProfileId>;
  /** The open leak this hand was picked to practice, if any. */
  focus: string | null;
  /** The hero's earlier decisions were played by the bots to reach a postflop leak's spot (drills.ts). */
  drilled?: boolean;
  /** How the opponents have adjusted to the hero's tendencies this session (session/adapt.ts). */
  adapt?: Adaptation | null;
}

/** The style an opponent plays this hand with: its profile plus the session's adjustments. */
export function profileOf(g: Pick<GameHand, 'profiles' | 'adapt'>, seat: number): Profile {
  return adaptProfile(PROFILES[g.profiles[seat] ?? 'regular'], g.adapt);
}

/** Preflop spot types where each leak tends to show up, for leak-targeted practice. */
export const LEAK_SPOTS: Record<string, PracticeSpot[]> = {
  'opening too tight': ['rfi'],
  'opening too loose': ['rfi'],
  'oversized preflop raise': ['rfi', 'vsOpen', 'squeeze'],
  'undersized preflop raise': ['rfi', 'vsOpen', 'squeeze'],
  'calling too wide preflop': ['vsOpen', 'squeeze'],
  'folding too much preflop': ['vsOpen', 'squeeze', 'vs3bet'],
  'raising too light preflop': ['vsOpen', 'squeeze'],
  'passive with a raising hand': ['vsOpen', 'squeeze', 'vs3bet'],
  'defending too wide vs 3-bets': ['vs3bet'],
  'calling 4-bets too wide': ['vs4bet'],
  'sunk-cost call': ['vs3bet', 'vs4bet'],
  'middle sizing at low stack-to-pot ratio': ['vs3bet', 'vs4bet'],
  'donk bet into the preflop raiser': ['vsOpen'],
  'raised top pair into a strong range': ['vs3bet', 'vsOpen'],
};

/**
 * The level's spot mix with extra weight on spots where open leaks show up. Only spots the
 * level already uses get extra weight, so a level keeps its character. Returns null when no
 * open leak maps to this level's spots.
 */
export function biasedMix(level: LevelId, leaks: { tag: string; weight: number }[]): Record<PracticeSpot, number> | null {
  const base: Record<PracticeSpot, number> = { ...DEFAULT_MIX, ...LEVELS[level].mix };
  const W = Object.values(base).reduce((a, x) => a + x, 0);
  const usable = leaks
    .map((l) => ({ ...l, spots: (LEAK_SPOTS[l.tag] ?? []).filter((sp) => base[sp] > 0) }))
    .filter((l) => l.spots.length);
  const total = usable.reduce((a, l) => a + l.weight, 0);
  if (!total) return null;
  const out = { ...base };
  for (const l of usable) for (const sp of l.spots) out[sp] += (W * l.weight) / total / l.spots.length;
  return out;
}

/** The heaviest open leak that shows up in this spot type. */
function focusFor(spot: PracticeSpot, leaks: { tag: string; weight: number }[]): string | null {
  const hits = leaks.filter((l) => LEAK_SPOTS[l.tag]?.includes(spot)).sort((a, b) => b.weight - a.weight);
  return hits[0]?.tag ?? null;
}

/** Hands that make river decisions about thin value and bluff-catching. */
const RIVER_CLASSES = new Set<PostflopClass>(['overpair', 'topPairGood', 'topPairWeak', 'middlePair', 'weakPair']);

/** Plays the hero's earlier streets with the bots' strategy and keeps the hand if it reaches a river decision with a medium hand. */
function playToRiver(g: GameHand, rng: Rng, opts: PreflopOptions): GameHand | null {
  let s = advance(g, g.state, rng, opts);
  let guard = 0;
  while (s.toAct === g.hero && s.street !== 'river' && guard++ < 20) {
    const a = s.street === 'preflop' ? botAction(s, rng, opts) : botPostflopAction(s, rng, PROFILES.regular);
    s = advance(g, applyAction(s, a), rng, opts);
  }
  if (s.toAct !== g.hero || s.street !== 'river') return null;
  const cls = classifyHand(s.players[g.hero].hole, s.board);
  if (!RIVER_CLASSES.has(cls)) return null;
  // Weak pairs reach the river most often; keep half so the other classes get their share.
  if (cls === 'weakPair' && rng() < 0.5) return null;
  return { ...g, state: s };
}

/** The opponent the hero is facing: the last preflop raiser, or a chosen defender when the hero is first in. */
function lastRaiser(s: HandState, hero: number): number | null {
  const r = s.actions.filter((a) => a.street === 'preflop' && (a.type === 'raise' || a.type === 'bet') && a.player !== hero);
  return r.length ? r[r.length - 1].player : null;
}

/** Opponents who have put chips in voluntarily before the hero's decision (an opener and its callers). */
function inAlready(s: HandState, hero: number): number[] {
  const seats = s.actions.filter((a) => a.street === 'preflop' && (a.type === 'raise' || a.type === 'call' || a.type === 'bet') && a.player !== hero).map((a) => a.player);
  return [...new Set(seats)].filter((i) => !s.players[i].folded);
}

const isBlind = (pos: string) => pos === 'SB' || pos === 'BB';
const sumWeights = (st: { raise: Range; call: Range }, callOnly: boolean) => {
  const out = new Float32Array(NUM_COMBOS);
  for (let i = 0; i < NUM_COMBOS; i++) out[i] = st.call[i] + (callOnly ? 0 : st.raise[i]);
  return out;
};

/** Swaps a player's hole cards for a combo drawn from `weights`, keeping the deck consistent. */
function redeal(s: HandState, seat: number, weights: Range, rng: Rng): boolean {
  const used = new Set<Card>(s.players.flatMap((p, i) => (i === seat ? [] : p.hole)));
  s.board.forEach((c) => used.add(c));
  let total = 0;
  for (let i = 0; i < NUM_COMBOS; i++) {
    const [a, b] = COMBO_CARDS[i];
    if (weights[i] > 0 && !used.has(a) && !used.has(b)) total += weights[i];
  }
  if (total <= 0) return false;
  let x = rng() * total;
  for (let i = 0; i < NUM_COMBOS; i++) {
    const [a, b] = COMBO_CARDS[i];
    if (!(weights[i] > 0) || used.has(a) || used.has(b)) continue;
    x -= weights[i];
    if (x >= 0) continue;
    const old = s.players[seat].hole;
    // New cards leave the deck; the old ones go to the bottom, which is never dealt.
    s.deck = [...old, ...s.deck.filter((c) => c !== a && c !== b)];
    s.players[seat].hole = [a, b];
    return true;
  }
  return false;
}

/**
 * A new hand at `level`. With open leaks, about half the hands lean toward the spots where
 * those leaks show up, and `focus` names the leak being practiced.
 */
export function newGameHand(
  level: LevelId,
  rng: Rng,
  opts: PreflopOptions & TableOptions,
  leaks: { tag: string; weight: number }[] = [],
  adapt: Adaptation | null = null,
): GameHand {
  const L = LEVELS[level];
  const tries = L.riverOnly ? 200 : 30;
  for (let attempt = 0; attempt < tries; attempt++) {
    const mix = leaks.length && rng() < 0.5 ? biasedMix(level, leaks) : null;
    const g = tryHand(level, rng, opts, mix ?? L.mix);
    if (!g) continue;
    const { spot, ...hand } = g;
    hand.focus = mix ? focusFor(spot, leaks) : null;
    hand.adapt = adapt;
    if (!L.riverOnly) return hand;
    const r = playToRiver(hand, rng, opts);
    if (r) return r;
  }
  throw new Error('Could not build a practice hand');
}

function tryHand(level: LevelId, rng: Rng, opts: PreflopOptions & TableOptions, mix: Partial<Record<PracticeSpot, number>>): (GameHand & { spot: PracticeSpot }) | null {
  const L = LEVELS[level];
  const sc = generatePreflopScenario(rng, { ...opts, mix, heroContinues: L.postflop });
  const { state, hero, spot } = sc;
  const base = { state, hero, level, profiles: {} as Record<number, ProfileId>, focus: null as string | null, spot };
  const profiles = base.profiles;
  state.players.forEach((_, i) => { if (i !== hero) profiles[i] = PROFILE_IDS[randInt(rng, PROFILE_IDS.length)]; });
  if (!L.postflop) return { ...base, villains: [] };
  const n = state.players.length;
  const behind = state.players
    .map((p, i) => ({ p, i }))
    .filter(({ p, i }) => i !== hero && !p.folded && CHARTS.vsOpen[vsOpenKey(state, i, hero)]);

  if (isMultiway(level)) {
    const already = inAlready(state, hero);
    if (already.length >= 2) return { ...base, villains: already };
    if (already.length > 0 || behind.length < 2) return null;
    // Hero is first in: two players behind defend. The first flats the open; the second
    // overcalls (the squeeze chart's call column), so the flop is usually three-way.
    const order = [...behind].sort((a, b) => preflopOrder(a.i, n) - preflopOrder(b.i, n));
    const first = order[randInt(rng, order.length - 1)];
    const rest = order.filter((x) => preflopOrder(x.i, n) > preflopOrder(first.i, n));
    const bb = rest.find(({ p }) => p.position === 'BB');
    const second = bb && rng() < 0.5 ? bb : rest[randInt(rng, rest.length)];
    const flat = sumWeights(getStrategy('vsOpen', vsOpenKey(state, first.i, hero), 'pool', opts.lowStakes), true);
    const over = sumWeights(getStrategy('squeeze', isBlind(second.p.position) ? 'blinds' : 'IP', 'pool', opts.lowStakes), true);
    if (!redeal(state, first.i, flat, rng) || !redeal(state, second.i, over, rng)) return null;
    return { ...base, villains: [first.i, second.i] };
  }

  let villain = lastRaiser(state, hero);
  if (villain === null) {
    // Hero is first in: pick one player behind to defend, and give them a hand that continues.
    if (!behind.length) return null;
    const bb = behind.find(({ p }) => p.position === 'BB');
    const pickd = bb && rng() < 0.5 ? bb : behind[randInt(rng, behind.length)];
    const cont = sumWeights(getStrategy('vsOpen', vsOpenKey(state, pickd.i, hero), 'pool', opts.lowStakes), false);
    if (!redeal(state, pickd.i, cont, rng)) return null;
    villain = pickd.i;
  }
  return { ...base, villains: [villain] };
}

/**
 * True when the hero has a decision to make in this state. False means the hand is over for
 * practice purposes: it finished, or it reached the point where the level stops (level 1 stops
 * at the flop even when the hero would act first there).
 */
export function heroDecides(g: GameHand, s: HandState): boolean {
  return s.toAct === g.hero && (LEVELS[g.level].postflop || s.street === 'preflop');
}

/**
 * Opponents still in the hand that the hero is playing against. If every chosen opponent has
 * folded while the hand goes on (say the hero limped, the chosen opponent folded and the BB
 * checked its option), whoever is still in becomes the opponent.
 */
export function liveVillains(g: GameHand, s: HandState): number[] {
  const live = g.villains.filter((v) => !s.players[v].folded);
  if (live.length || !g.villains.length) return live;
  return s.players.map((_, i) => i).filter((i) => i !== g.hero && !s.players[i].folded);
}

/**
 * Lets everyone but the hero act until the hero must decide or the hand ends. On postflop
 * levels, players other than the chosen opponents fold (or check when that is free).
 * On level 2, the turn and river are checked down by everyone, the hero included.
 */
export function advance(g: GameHand, s: HandState, rng: Rng, opts: PreflopOptions): HandState {
  const L = LEVELS[g.level];
  let guard = 0;
  while (s.toAct !== null && guard++ < 200) {
    const i = s.toAct;
    const checkDown = L.stopAfterFlop && (s.street === 'turn' || s.street === 'river');
    if (checkDown) {
      s = applyAction(s, legalActions(s).check ? { type: 'check' } : { type: 'call' });
      continue;
    }
    if (i === g.hero) break;
    if (!L.postflop && s.street !== 'preflop') break; // level 1 stops at the flop
    if (g.villains.length && !liveVillains(g, s).includes(i)) {
      s = applyAction(s, legalActions(s).check ? { type: 'check' } : { type: 'fold' });
      continue;
    }
    s = applyAction(s, s.street === 'preflop' ? botAction(s, rng, opts) : botPostflopAction(s, rng, profileOf(g, i)));
  }
  return s;
}
