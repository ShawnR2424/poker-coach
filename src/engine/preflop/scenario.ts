// Builds preflop practice hands that stop at an interesting hero decision.
// Opponents' hole cards are sampled from the chart range for the action they take, so their
// actions, the range read, and any showdown all agree.

import type { Card } from '../cards';
import { applyAction, newHand, type Action, type HandConfig, type HandState, type Rake } from '../hand';
import { chartSeat, clockwiseFromSB } from '../positions';
import {
  ALL_CLASSES, CLASS_COMBOS, COMBO_CARDS, NUM_COMBOS, cellOf, comboIndex, type HandClass, type Range,
} from '../range';
import { randInt, type Rng } from '../rng';
import { CHARTS, classFrequencies, getStrategy, type Choice, type SpotKind } from './charts';
import { botAction, choiceToAction, depthOf, type PreflopOptions } from './policy';
import { spotFor } from './spot';

export type PracticeSpot = 'rfi' | 'vsOpen' | 'squeeze' | 'vs3bet' | 'vs4bet';

/** The table: 6 to 9 seats and the blinds in chips (cents). Defaults to 6-max $0.25/$0.50. */
export interface TableOptions {
  tableSize?: number;
  sb?: number;
  bb?: number;
  /** No rake when absent. */
  rake?: Rake;
}

export interface ScenarioOptions extends PreflopOptions, TableOptions {
  /** Relative weights for each spot type. */
  mix?: Partial<Record<PracticeSpot, number>>;
  /** Deal the hero only hands their chart plays (for levels that continue after preflop). */
  heroContinues?: boolean;
}

export interface Scenario {
  state: HandState;
  hero: number;
  spot: PracticeSpot;
}

export const tableConfig = (o: TableOptions): HandConfig => ({
  tableSize: o.tableSize ?? 6,
  sb: o.sb ?? 25,
  bb: o.bb ?? 50,
  ...(o.rake ? { rake: o.rake } : {}),
});

/** Chart seats in preflop order; "EP" only exists at 7-9 handed. */
const CHART_ORDER = ['EP', 'UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
const before = (a: string, b: string) => CHART_ORDER.indexOf(a) < CHART_ORDER.indexOf(b);
const isRfiSeat = (cs: string) => /^EP\d$/.test(cs);

/** Seat indices (clockwise from the SB) that play from chart seat `cs` at this table size. */
function seatsOf(cs: string, n: number): number[] {
  const out: number[] = [];
  clockwiseFromSB(n).forEach((p, i) => { if (chartSeat(p, n, isRfiSeat(cs)) === cs) out.push(i); });
  return out;
}

export const DEFAULT_MIX: Record<PracticeSpot, number> = { rfi: 25, vsOpen: 35, squeeze: 10, vs3bet: 20, vs4bet: 10 };

/** One scripted step: who acts (a chart seat, or the hero) and with which chart choice; their hand is drawn from that choice. */
interface Step {
  seat: string;
  hero?: boolean;
  choice: Choice;
}

interface Script {
  hero: string;
  steps: Step[];
  heroKind: SpotKind;
  /** The hero's chart key, or a function of the resolved seats (vs4bet depends on who has position). */
  heroKey: string | ((heroSeat: number, seats: Map<string, number>) => string);
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
  const s = getStrategy(kind, key, 'pool', opts.lowStakes, depthOf(opts));
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
  const s = getStrategy(kind, key, 'hero', opts.lowStakes, depthOf(opts));
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

function script(spot: PracticeSpot, rng: Rng, n: number): Script {
  // Only chart rows whose seats exist at this table size (EP rows need 7+ seats, EP_vs_EP needs two EP seats).
  const exists = (cs: string) => seatsOf(cs, n).length > 0;
  const fits = (key: string) => {
    const [a, b] = key.split('_vs_');
    if (a === b) return seatsOf(a, n).length >= 2;
    return exists(a) && (b === undefined || b === 'IP' || b === 'blinds' || exists(b));
  };
  const chooseKey = (kind: SpotKind) => pick(Object.keys(CHARTS[kind]).filter(fits), rng);
  switch (spot) {
    case 'rfi': {
      const hero = chooseKey('rfi');
      return { hero, steps: [], heroKind: 'rfi', heroKey: hero };
    }
    case 'vsOpen': {
      const key = chooseKey('vsOpen');
      const [hero, opener] = key.split('_vs_');
      return { hero, steps: [{ seat: opener, choice: 'raise' }], heroKind: 'vsOpen', heroKey: key };
    }
    case 'squeeze': {
      // Opener, then one caller between the opener and the hero.
      for (let tries = 0; tries < 50; tries++) {
        const opener = pick(['EP', 'UTG', 'HJ', 'CO'].filter(exists), rng);
        const caller = pick(CHART_ORDER.filter((p) => before(opener, p) && p !== 'BB' && exists(p)), rng);
        const heroes = CHART_ORDER.filter((p) => before(caller, p) && exists(p));
        if (!heroes.length) continue;
        const hero = pick(heroes, rng);
        const key = hero === 'SB' || hero === 'BB' ? 'blinds' : 'IP';
        if (!CHARTS.vsOpen[`${caller}_vs_${opener}`]) continue;
        return {
          hero,
          steps: [{ seat: opener, choice: 'raise' }, { seat: caller, choice: 'call' }],
          heroKind: 'squeeze',
          heroKey: key,
        };
      }
      return script('vsOpen', rng, n);
    }
    case 'vs3bet': {
      const key = chooseKey('vs3bet');
      const [hero, kind] = key.split('_vs_');
      const candidates = Object.keys(CHARTS.vsOpen)
        .filter((k) => k.endsWith(`_vs_${hero}`) && fits(k))
        .map((k) => k.split('_vs_')[0])
        .filter((p) => (kind === 'blinds') === (p === 'SB' || p === 'BB'));
      if (!candidates.length) return script('vsOpen', rng, n);
      const threeBettor = pick(candidates, rng);
      return {
        hero,
        steps: [{ seat: hero, hero: true, choice: 'raise' }, { seat: threeBettor, choice: 'raise' }],
        heroKind: 'vs3bet',
        heroKey: key,
      };
    }
    case 'vs4bet': {
      const key = chooseKey('vsOpen');
      const [hero, opener] = key.split('_vs_');
      return {
        hero,
        steps: [{ seat: opener, choice: 'raise' }, { seat: hero, hero: true, choice: 'raise' }, { seat: opener, choice: 'raise' }],
        heroKind: 'vs4bet',
        heroKey: (heroSeat, seats) => (heroSeat > seats.get(opener)! ? 'IP' : 'OOP'),
      };
    }
  }
}

/** Picks real seats for a script: the hero first, then one player per other chart seat. */
function resolveSeats(sc: Script, n: number, rng: Rng): { heroSeat: number; steps: { seat: number; choice: Choice }[]; heroKey: string } | null {
  const heroOptions = seatsOf(sc.hero, n);
  if (!heroOptions.length) return null;
  const heroSeat = pick(heroOptions, rng);
  const seats = new Map<string, number>();
  const steps: { seat: number; choice: Choice }[] = [];
  for (const st of sc.steps) {
    if (st.hero) {
      steps.push({ seat: heroSeat, choice: st.choice });
      continue;
    }
    if (!seats.has(st.seat)) {
      const options = seatsOf(st.seat, n).filter((i) => i !== heroSeat && ![...seats.values()].includes(i));
      if (!options.length) return null;
      seats.set(st.seat, pick(options, rng));
    }
    steps.push({ seat: seats.get(st.seat)!, choice: st.choice });
  }
  const heroKey = typeof sc.heroKey === 'string' ? sc.heroKey : sc.heroKey(heroSeat, seats);
  return { heroSeat, steps, heroKey };
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
  const config = tableConfig(opts);
  const n = config.tableSize;
  const sc = script(spot, rng, n);
  const resolved = resolveSeats(sc, n, rng);
  if (!resolved) return null;
  const { heroSeat, steps, heroKey } = resolved;
  const heroKind = sc.heroKind;
  const stacks = Array.from({ length: n }, () => (opts.stacksBB ?? 100) * config.bb);
  const dead = new Set<Card>();
  const hole: (Card[] | null)[] = stacks.map(() => null);

  // The hero's hand: interesting for the decision they will face.
  let heroWeights = interestingWeights(heroKind, heroKey, opts);
  if (opts.heroContinues) {
    const st = getStrategy(heroKind, heroKey, 'hero', opts.lowStakes, depthOf(opts));
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
  let scratch = newHand({ config, stacks, seed: 1 });
  const actions: Action[] = [];
  let guard = 0;
  while (scratch.toAct !== null && guard++ < 30) {
    const seat = scratch.toAct;
    const next = queue[0];
    const spotHere = spotFor(scratch, seat);
    if (seat === heroSeat && !next) break; // hero's decision point
    let choice: Choice;
    if (next && next.seat === seat) {
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
      const st = getStrategy(spotHere.kind, spotHere.key, 'hero', opts.lowStakes, depthOf(opts));
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
  let s = newHand({ config, stacks, hole, seed: Math.floor(rng() * 2 ** 31) });
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

