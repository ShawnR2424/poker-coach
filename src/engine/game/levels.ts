// Practice levels and the hand loop for levels 2-4: generate a hand, let opponents act until
// the hero must decide, and keep postflop pots heads-up.

import { COMBO_CARDS, NUM_COMBOS, type Range } from '../range';
import { applyAction, legalActions, type HandState } from '../hand';
import type { Card } from '../cards';
import { CHARTS, getStrategy } from '../preflop/charts';
import { botAction, type PreflopOptions } from '../preflop/policy';
import { generatePreflopScenario, type PracticeSpot } from '../preflop/scenario';
import { randInt, type Rng } from '../rng';
import { botPostflopAction } from '../postflop/bot';
import { PROFILE_IDS, PROFILES, type ProfileId } from '../postflop/model';

export type LevelId = 1 | 2 | 3 | 4;

export interface Level {
  id: LevelId;
  name: string;
  /** Spot mix for the preflop scenario that starts each hand. */
  mix: Partial<Record<PracticeSpot, number>>;
  /** Hands continue past preflop. */
  postflop: boolean;
  /** After the flop betting, the rest is checked down. */
  stopAfterFlop: boolean;
}

const NO_MIX = { rfi: 0, vsOpen: 0, squeeze: 0, vs3bet: 0, vs4bet: 0 };

export const LEVELS: Record<LevelId, Level> = {
  1: { id: 1, name: 'Preflop only', mix: {}, postflop: false, stopAfterFlop: false },
  2: { id: 2, name: 'Preflop + flop', mix: { ...NO_MIX, rfi: 45, vsOpen: 55 }, postflop: true, stopAfterFlop: true },
  3: { id: 3, name: 'Full hands heads-up', mix: { ...NO_MIX, rfi: 45, vsOpen: 55 }, postflop: true, stopAfterFlop: false },
  4: { id: 4, name: '3-bet and 4-bet pots', mix: { ...NO_MIX, vsOpen: 35, vs3bet: 45, vs4bet: 20 }, postflop: true, stopAfterFlop: false },
};

export interface GameHand {
  state: HandState;
  hero: number;
  level: LevelId;
  /** The one opponent who stays in; everyone else folds when it is their turn. Null on level 1. */
  villain: number | null;
  profiles: Record<number, ProfileId>;
}

/** The opponent the hero is facing: the last preflop raiser, or a chosen defender when the hero is first in. */
function lastRaiser(s: HandState, hero: number): number | null {
  const r = s.actions.filter((a) => a.street === 'preflop' && (a.type === 'raise' || a.type === 'bet') && a.player !== hero);
  return r.length ? r[r.length - 1].player : null;
}

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

export function newGameHand(level: LevelId, rng: Rng, opts: PreflopOptions): GameHand {
  const L = LEVELS[level];
  for (let attempt = 0; attempt < 30; attempt++) {
    const sc = generatePreflopScenario(rng, { ...opts, mix: L.mix, heroContinues: L.postflop });
    const { state, hero } = sc;
    const profiles: Record<number, ProfileId> = {};
    state.players.forEach((_, i) => { if (i !== hero) profiles[i] = PROFILE_IDS[randInt(rng, PROFILE_IDS.length)]; });
    if (!L.postflop) return { state, hero, level, villain: null, profiles };

    let villain = lastRaiser(state, hero);
    if (villain === null) {
      // Hero is first in: pick one player behind to defend, and give them a hand that continues.
      const heroPos = state.players[hero].position;
      const behind = state.players
        .map((p, i) => ({ p, i }))
        .filter(({ p, i }) => i !== hero && !p.folded && CHARTS.vsOpen[`${p.position}_vs_${heroPos}`]);
      if (!behind.length) continue;
      const bb = behind.find(({ p }) => p.position === 'BB');
      const pickd = bb && rng() < 0.5 ? bb : behind[randInt(rng, behind.length)];
      const st = getStrategy('vsOpen', `${pickd.p.position}_vs_${heroPos}`, 'pool', opts.lowStakes);
      const cont = new Float32Array(NUM_COMBOS);
      for (let i = 0; i < NUM_COMBOS; i++) cont[i] = st.raise[i] + st.call[i];
      if (!redeal(state, pickd.i, cont, rng)) continue;
      villain = pickd.i;
    }
    return { state, hero, level, villain, profiles };
  }
  throw new Error('Could not build a practice hand');
}

/**
 * Lets everyone but the hero act until the hero must decide or the hand ends. On postflop
 * levels, players other than the villain fold (or check when that is free) so pots stay heads-up.
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
    if (g.villain !== null && i !== g.villain) {
      s = applyAction(s, legalActions(s).check ? { type: 'check' } : { type: 'fold' });
      continue;
    }
    s = applyAction(s, s.street === 'preflop' ? botAction(s, rng, opts) : botPostflopAction(s, rng, PROFILES[g.profiles[i] ?? 'regular']));
  }
  return s;
}
