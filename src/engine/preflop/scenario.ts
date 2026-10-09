// Builds preflop practice hands that stop at an interesting hero decision.
// Opponents' hole cards are sampled from the chart range for the action they take, so their
// actions, the range read, and any showdown all agree.

import type { Card } from '../cards';
import { applyAction, newHand, type Action, type HandState } from '../hand';
import { clockwiseFromSB, type Position } from '../positions';
import {
  ALL_CLASSES, CLASS_COMBOS, COMBO_CARDS, NUM_COMBOS, cellOf, comboIndex, type HandClass, type Range,
} from '../range';
import { randInt, type Rng } from '../rng';
import { CHARTS, classFrequencies, getStrategy, type Choice, type SpotKind } from './charts';
import { botAction, choiceToAction, type PreflopOptions } from './policy';
import { spotFor } from './spot';

export type PracticeSpot = 'rfi' | 'vsOpen' | 'squeeze' | 'vs3bet' | 'vs4bet';

export interface ScenarioOptions extends PreflopOptions {
  /** Relative weights for each spot type. */
  mix?: Partial<Record<PracticeSpot, number>>;
  stacksBB?: number;
  /** Deal the hero only hands their chart plays (for levels that continue after preflop). */
  heroContinues?: boolean;
}

export interface Scenario {
  state: HandState;
  hero: number;
  spot: PracticeSpot;
}

const CONFIG = { tableSize: 6, sb: 25, bb: 50 };
const POSITIONS = clockwiseFromSB(6); // SB, BB, UTG, HJ, CO, BTN
const seatOf = (p: Position) => POSITIONS.indexOf(p);
const PREFLOP_ORDER: Position[] = ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
const before = (a: Position, b: Position) => PREFLOP_ORDER.indexOf(a) < PREFLOP_ORDER.indexOf(b);

const DEFAULT_MIX: Record<PracticeSpot, number> = { rfi: 25, vsOpen: 35, squeeze: 10, vs3bet: 20, vs4bet: 10 };

/** One scripted step: who acts and with which chart choice; their hand is drawn from that choice. */
interface Step {
  pos: Position;
  choice: Choice;
}

function pickWeighted<T extends string>(w: Record<T, number>, rng: Rng): T {
  const entries = Object.entries(w) as [T, number][];
  const total = entries.reduce((a, [, x]) => a + x, 0);
  let x = rng() * total;
  for (const [k, v] of entries) { if ((x -= v) < 0) return k; }
  return entries[entries.length - 1][0];
}

const pick = <T,>(xs: T[], rng: Rng): T => xs[randInt(rng, xs.length)];

/** Draws a combo with probability proportional to `weights`, avoiding dead cards. */
function drawCombo(weights: Range, dead: Set<Card>, rng: Rng): [Card, Card] | null {
  let total = 0;
  for (let i = 0; i < NUM_COMBOS; i++) {
    const [a, b] = COMBO_CARDS[i];
    if (weights[i] > 0 && !dead.has(a) && !dead.has(b)) total += weights[i];
  }
  if (total <= 0) return null;
  let x = rng() * total;
  for (let i = 0; i < NUM_COMBOS; i++) {
    const [a, b] = COMBO_CARDS[i];
    if (weights[i] > 0 && !dead.has(a) && !dead.has(b)) {
      x -= weights[i];
      if (x < 0) return [a, b];
    }
  }
  return null;
}

function choiceWeights(kind: SpotKind, key: string, choice: Choice, opts: PreflopOptions): Range {
  const s = getStrategy(kind, key, 'pool', opts.lowStakes);
  if (choice === 'raise') return s.raise;
  if (choice === 'call') return s.call;
  const out = new Float32Array(NUM_COMBOS);
  for (let i = 0; i < NUM_COMBOS; i++) out[i] = Math.max(0, 1 - s.raise[i] - s.call[i]);
  return out;
}

/**
 * Hero hand weights that favor decisions worth practicing: mixed hands and hands on the edge of
 * a range get most of the weight, clear folds very little.
 */
export function interestingWeights(kind: SpotKind, key: string, opts: PreflopOptions): Range {
  const s = getStrategy(kind, key, 'hero', opts.lowStakes);
  const dominant = new Map<HandClass, Choice>();
  const mixed = new Set<HandClass>();
  for (const cls of ALL_CLASSES) {
    const f = classFrequencies(s, cls);
    const best: Choice = f.raise >= f.call && f.raise >= f.fold ? 'raise' : f.call >= f.fold ? 'call' : 'fold';
    dominant.set(cls, best);
    if (Math.max(f.raise, f.call, f.fold) < 0.9) mixed.add(cls);
  }
  const grid = (r: number, c: number) => ALL_CLASSES[r * 13 + c];
  const w = new Float32Array(NUM_COMBOS);
  for (const cls of ALL_CLASSES) {
    const [r, c] = cellOf(cls);
    const d = dominant.get(cls)!;
    const edge = [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]].some(
      ([rr, cc]) => rr >= 0 && rr < 13 && cc >= 0 && cc < 13 && dominant.get(grid(rr, cc)) !== d,
    );
    const weight = mixed.has(cls) || edge ? 6 : d !== 'fold' ? 2 : 0.15;
    for (const i of CLASS_COMBOS.get(cls)!) w[i] = weight;
  }
  return w;
}

function script(spot: PracticeSpot, rng: Rng): { hero: Position; steps: Step[]; heroKind: SpotKind; heroKey: string } {
  const chooseKey = (kind: SpotKind) => pick(Object.keys(CHARTS[kind]), rng);
  switch (spot) {
    case 'rfi': {
      const hero = pick(Object.keys(CHARTS.rfi) as Position[], rng);
      return { hero, steps: [], heroKind: 'rfi', heroKey: hero };
    }
    case 'vsOpen': {
      const key = chooseKey('vsOpen');
      const [hero, opener] = key.split('_vs_') as [Position, Position];
      return { hero, steps: [{ pos: opener, choice: 'raise' }], heroKind: 'vsOpen', heroKey: key };
    }
    case 'squeeze': {
      // Opener, then one caller between the opener and the hero.
      for (let tries = 0; tries < 50; tries++) {
        const opener = pick(['UTG', 'HJ', 'CO'] as Position[], rng);
        const caller = pick(PREFLOP_ORDER.filter((p) => before(opener, p) && p !== 'BB'), rng);
        const heroes = PREFLOP_ORDER.filter((p) => before(caller, p));
        if (!heroes.length) continue;
        const hero = pick(heroes, rng);
        const key = hero === 'SB' || hero === 'BB' ? 'blinds' : 'IP';
        const callKey = `${caller}_vs_${opener}`;
        if (!CHARTS.vsOpen[callKey]) continue;
        return {
          hero,
          steps: [{ pos: opener, choice: 'raise' }, { pos: caller, choice: 'call' }],
          heroKind: 'squeeze',
          heroKey: key,
        };
      }
      return script('vsOpen', rng);
    }
    case 'vs3bet': {
      const key = chooseKey('vs3bet');
      const [hero, kind] = key.split('_vs_') as [Position, string];
      const candidates = Object.keys(CHARTS.vsOpen)
        .filter((k) => k.endsWith(`_vs_${hero}`))
        .map((k) => k.split('_vs_')[0] as Position)
        .filter((p) => (kind === 'blinds') === (p === 'SB' || p === 'BB'));
      if (!candidates.length) return script('vsOpen', rng);
      const threeBettor = pick(candidates, rng);
      return {
        hero,
        steps: [{ pos: hero, choice: 'raise' }, { pos: threeBettor, choice: 'raise' }],
        heroKind: 'vs3bet',
        heroKey: key,
      };
    }
    case 'vs4bet': {
      const key = chooseKey('vsOpen');
      const [hero, opener] = key.split('_vs_') as [Position, Position];
      const ip = seatOf(hero) > seatOf(opener);
      return {
        hero,
        steps: [{ pos: opener, choice: 'raise' }, { pos: hero, choice: 'raise' }, { pos: opener, choice: 'raise' }],
        heroKind: 'vs4bet',
        heroKey: ip ? 'IP' : 'OOP',
      };
    }
  }
}

export function generatePreflopScenario(rng: Rng, opts: ScenarioOptions): Scenario {
  for (let attempt = 0; attempt < 40; attempt++) {
    const spot = pickWeighted({ ...DEFAULT_MIX, ...opts.mix }, rng);
    const sc = tryBuild(spot, rng, opts);
    if (sc) return sc;
  }
  throw new Error('Could not build a practice hand');
}

function tryBuild(spot: PracticeSpot, rng: Rng, opts: ScenarioOptions): Scenario | null {
  const { hero, steps, heroKind, heroKey } = script(spot, rng);
  const heroSeat = seatOf(hero);
  const stacks = POSITIONS.map(() => (opts.stacksBB ?? 100) * CONFIG.bb);
  const dead = new Set<Card>();
  const hole: (Card[] | null)[] = POSITIONS.map(() => null);

  // The hero's hand: interesting for the decision they will face.
  let heroWeights = interestingWeights(heroKind, heroKey, opts);
  if (opts.heroContinues) {
    const st = getStrategy(heroKind, heroKey, 'hero', opts.lowStakes);
    heroWeights = heroWeights.map((w, i) => w * Math.min(1, st.raise[i] + st.call[i]));
  }
  const heroCombo = drawCombo(heroWeights, dead, rng);
  if (!heroCombo) return null;
  // If the hero acts earlier in the script, their hand must also fit those earlier actions.
  hole[heroSeat] = heroCombo;
  heroCombo.forEach((c) => dead.add(c));

  // Walk preflop order; every seat before the hero's decision either takes its scripted
  // action or folds. Hands are drawn from the matching chart region.
  const queue = [...steps];
  const plannedHands: { seat: number; weights: Range }[] = [];
  // First pass: replay the script on a scratch state to learn each actor's chart spot.
  let scratch = newHand({ config: CONFIG, stacks, seed: 1 });
  const actions: Action[] = [];
  let guard = 0;
  while (scratch.toAct !== null && guard++ < 30) {
    const seat = scratch.toAct;
    const pos = POSITIONS[seat];
    const next = queue[0];
    const spotHere = spotFor(scratch, seat);
    if (seat === heroSeat && !next) break; // hero's decision point
    let choice: Choice;
    if (next && next.pos === pos) {
      choice = next.choice;
      queue.shift();
    } else if (seat === heroSeat) {
      return null; // script expected a different actor
    } else {
      choice = 'fold';
    }
    if (seat !== heroSeat && CHARTS[spotHere.kind][spotHere.key]) {
      plannedHands.push({ seat, weights: choiceWeights(spotHere.kind, spotHere.key, choice, opts) });
    } else if (seat === heroSeat) {
      // Hero's earlier action must be consistent with their hand.
      const st = getStrategy(spotHere.kind, spotHere.key, 'hero', opts.lowStakes);
      const ci = comboIndex(heroCombo[0], heroCombo[1]);
      const f = choice === 'raise' ? st.raise[ci] : choice === 'call' ? st.call[ci] : 1 - st.raise[ci] - st.call[ci];
      if (f <= 0) return null;
    }
    const act = choiceToAction(scratch, spotHere, choice, seat === heroSeat ? 'hero' : 'pool', opts);
    actions.push(act);
    scratch = applyAction(scratch, act);
  }
  if (scratch.toAct !== heroSeat || queue.length) return null;

  for (const p of plannedHands) {
    const c = drawCombo(p.weights, dead, rng);
    if (!c) return null;
    hole[p.seat] = c;
    c.forEach((x) => dead.add(x));
  }
  let s = newHand({ config: CONFIG, stacks, hole, seed: Math.floor(rng() * 2 ** 31) });
  for (const a of actions) s = applyAction(s, a);
  if (s.toAct !== heroSeat) return null;
  return { state: s, hero: heroSeat, spot };
}

/** Lets opponents act until the hero must decide, preflop ends, or the hand is over. */
export function runOpponents(s: HandState, hero: number, rng: Rng, opts: PreflopOptions): HandState {
  let guard = 0;
  while (s.toAct !== null && s.toAct !== hero && s.street === 'preflop' && guard++ < 40) {
    s = applyAction(s, botAction(s, rng, opts));
  }
  return s;
}

