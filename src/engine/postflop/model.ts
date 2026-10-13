// Opponent behavior after the flop, by hand class. Used both to narrow a range from the
// actions a player took and to predict how they respond to the hero's bets.

import table from '../../../data/postflop/actions.json';
import profileTable from '../../../data/postflop/profiles.json';
import type { Card } from '../cards';
import { COMBO_CARDS, NUM_COMBOS, type Range } from '../range';
import { classifyHand, type PostflopClass } from './classify';
import { boardTexture, type Texture } from './texture';

type ByClass = Record<PostflopClass, number>;

export const ACTIONS = table as unknown as {
  firstToAct: { betSmall: ByClass; betBig: ByClass };
  leadIntoAggressor: { betSmall: ByClass; betBig: ByClass };
  facingBet: { base: ByClass; slope: ByClass; raise: ByClass; maxSize: number; overbetDecay: number; defend: number; maxBoost: number };
  facingRaise: { continue: ByClass; defend: number };
  realization: { inPosition: number; outOfPosition: number; byClass: ByClass };
  laterStreets: { betSize: number };
  textures: Record<Texture, { about: string; betSmall: ByClass; betBig: ByClass; continue: ByClass }>;
};

/** The tables as shipped, before any imported solver frequencies replace their entries. */
const BUILT_IN = JSON.parse(JSON.stringify(table)) as typeof ACTIONS;

/**
 * Per-class entries that replace the built-in tables, worked out from imported solver output
 * (see solverImport.ts). A class left out of an entry keeps its built-in value.
 */
export interface PostflopOverrides {
  firstToAct?: { betSmall?: Partial<ByClass>; betBig?: Partial<ByClass> };
  leadIntoAggressor?: { betSmall?: Partial<ByClass>; betBig?: Partial<ByClass> };
  facingBet?: { base?: Partial<ByClass>; slope?: Partial<ByClass>; raise?: Partial<ByClass> };
  facingRaise?: { continue?: Partial<ByClass> };
  /**
   * Entries from the spots imported on boards of one texture. For that texture they replace both
   * the table above and the texture's multiplier.
   */
  byTexture?: Partial<Record<Texture, PostflopOverrides>>;
}

/** Every table entry an override can replace, as [table, entry] pairs. */
export const OVERRIDE_FIELDS = [
  ['firstToAct', 'betSmall'], ['firstToAct', 'betBig'],
  ['leadIntoAggressor', 'betSmall'], ['leadIntoAggressor', 'betBig'],
  ['facingBet', 'base'], ['facingBet', 'slope'], ['facingBet', 'raise'],
  ['facingRaise', 'continue'],
] as const;

type Tables = Record<string, Record<string, ByClass>>;
let overrides: PostflopOverrides = {};
let byTexture: Partial<Record<Texture, PostflopOverrides>> = {};

/** Puts the built-in tables back, then replaces the entries in `o`. Every reader of ACTIONS sees the result. */
export function setPostflopOverrides(o: PostflopOverrides) {
  overrides = o;
  byTexture = o.byTexture ?? {};
  const live = ACTIONS as unknown as Tables;
  const shipped = BUILT_IN as unknown as Tables;
  const given = o as unknown as Record<string, Record<string, Partial<ByClass>> | undefined>;
  for (const [t, field] of OVERRIDE_FIELDS) Object.assign(live[t][field], shipped[t][field], given[t]?.[field] ?? {});
}

export const postflopOverrides = () => overrides;

/** The shipped value of one table entry, whatever is imported. */
export const builtInValue = (t: (typeof OVERRIDE_FIELDS)[number][0], field: string, cls: PostflopClass): number =>
  (BUILT_IN as unknown as Tables)[t][field][cls];

export type ProfileId = 'regular' | 'nit' | 'station' | 'aggro';
export interface Profile {
  label: string;
  short: string;
  about: string;
  betMult: number;
  raiseMult: number;
  continueAdd: number;
  /** Scales how often air and weak draws bet or raise (1 when missing). Set by adaptation. */
  bluffMult?: number;
  /** How this opponent plays differently from its base style, when it has adjusted to the hero. */
  adjustments?: string[];
}
export const PROFILES = Object.fromEntries(
  Object.entries(profileTable).filter(([k]) => !k.startsWith('_')),
) as Record<ProfileId, Profile>;
export const PROFILE_IDS = Object.keys(PROFILES) as ProfileId[];
const DEFAULT: Profile = PROFILES.regular;

/** Classes that bet or raise only as bluffs or semi-bluffs; bluffMult scales them. */
const BLUFFS = new Set<PostflopClass>(['air', 'weakDraw']);
const bluffScale = (cls: PostflopClass, profile: Profile) => (BLUFFS.has(cls) ? profile.bluffMult ?? 1 : 1);

/** Classes whose willingness to continue does not depend on the player's style. */
const STYLE_FREE = new Set<PostflopClass>(['setPlus', 'twoPair']);

/** Bets up to this fraction of the pot count as "small" when narrowing. */
export const SMALL_BET_MAX = 0.5;

const clip01 = (x: number) => Math.min(1, Math.max(0, x));

/** A solver figure imported for this texture, if any. */
function imported(tex: Texture | undefined, t: 'firstToAct' | 'leadIntoAggressor' | 'facingBet' | 'facingRaise', field: string, cls: PostflopClass): number | undefined {
  if (!tex) return undefined;
  const entry = (byTexture[tex] as Record<string, Record<string, Partial<ByClass>> | undefined> | undefined)?.[t]?.[field];
  return entry?.[cls];
}

/** The board's texture, for the functions below; undefined (no texture adjustment) before the flop. */
export const textureOf = (board: readonly Card[]): Texture | undefined => (board.length >= 3 ? boardTexture(board) : undefined);

/**
 * How likely a hand class continues (calls or raises) facing a bet of `f` times the pot.
 * `beingRaised` is true when the player had bet and now faces a raise. `defense` (from
 * rangeDefense) lifts the result so the player's whole range defends enough. `tex` is the board's
 * texture (textureOf), which scales the table or swaps in solver figures imported for it.
 */
export function continueProb(
  cls: PostflopClass,
  f: number,
  beingRaised = false,
  profile: Profile = DEFAULT,
  defense: Defense | number = 1,
  tex?: Texture,
): number {
  const add = STYLE_FREE.has(cls) ? 0 : profile.continueAdd;
  const { maxSize, overbetDecay } = ACTIONS.facingBet;
  const texBase = imported(tex, 'facingBet', 'base', cls);
  const base = texBase ?? ACTIONS.facingBet.base[cls];
  const slope = (texBase !== undefined ? imported(tex, 'facingBet', 'slope', cls) : undefined) ?? ACTIONS.facingBet.slope[cls];
  let p = clip01(base + add - slope * Math.min(f, maxSize));
  // Past an overbet, the straight line would fold even overpairs to a shove; see actions.json.
  if (f > maxSize) p *= (maxSize / f) ** (overbetDecay * slope);
  if (tex && texBase === undefined) p = clip01(p * ACTIONS.textures[tex].continue[cls]);
  if (beingRaised) p *= imported(tex, 'facingRaise', 'continue', cls) ?? ACTIONS.facingRaise.continue[cls];
  if (typeof defense === 'number') return Math.min(1, p * defense);
  return Math.max(Math.min(1, p * defense.factor), defense.topUp?.[cls] ?? 0);
}

export interface Response {
  fold: number;
  call: number;
  raise: number;
}

export function responseFor(
  cls: PostflopClass,
  f: number,
  canRaise: boolean,
  beingRaised = false,
  profile: Profile = DEFAULT,
  defense: Defense | number = 1,
  tex?: Texture,
): Response {
  const cont = continueProb(cls, f, beingRaised, profile, defense, tex);
  const share = imported(tex, 'facingBet', 'raise', cls) ?? ACTIONS.facingBet.raise[cls];
  const raise = canRaise ? cont * Math.min(1, share * profile.raiseMult * bluffScale(cls, profile)) : 0;
  return { fold: 1 - cont, call: cont - raise, raise };
}

/**
 * How a range lifts its continue chances to defend enough: every class's chance is multiplied by
 * `factor` (capped at always), and a class in `topUp` continues at least that often.
 */
export interface Defense {
  factor: number;
  topUp?: Partial<Record<PostflopClass, number>>;
}

export const NO_DEFENSE: Defense = { factor: 1 };

/** Classes that can be made to call for the floor, strongest first. Air and gutshots never are. */
const TOP_UP_ORDER: PostflopClass[] = ['setPlus', 'twoPair', 'overpair', 'topPairGood', 'topPairWeak', 'middlePair', 'weakPair', 'strongDraw'];

/**
 * A player who folds too much to bets hands every bluff a profit, so a range facing a bet keeps at
 * least `defend` of the minimum defense frequency 1 / (1 + f), moved by the player's style
 * (continueAdd): a nit still folds too much and a calling station defends more. The class table
 * alone folds a wide range (one that checked, or one full of small-bet bluffs that is now raised)
 * far more than that.
 *
 * First every class's continue chance is multiplied by the same factor, up to `maxBoost` times its
 * own, so pairs and draws take up the extra defense while air keeps folding. When that still falls
 * short, as it does against an overbet, where weak pairs and draws give up almost entirely, the
 * rest comes from the range's best hands, strongest first, as a real defender would pick its
 * calls: a range that checked and is capped still calls a shove with its best pairs often enough
 * that a pure bluff does not profit. Air and gutshots are never made to call, so a polarized
 * range of strong hands and air can still stay short of the floor. A range that bet and is now
 * raised gets no top-up: its pairs already face a raise's own continue table, and making them
 * call more would turn thin value raises into the best play.
 * See `defend` under facingBet and facingRaise in actions.json.
 */
export function rangeDefense(
  classes: readonly PostflopClass[],
  weights: ArrayLike<number>,
  f: number,
  beingRaised = false,
  profile: Profile = DEFAULT,
  tex?: Texture,
): Defense {
  const byClass = new Map<PostflopClass, number>();
  let total = 0;
  for (let k = 0; k < classes.length; k++) {
    if (!(weights[k] > 0)) continue;
    byClass.set(classes[k], (byClass.get(classes[k]) ?? 0) + weights[k]);
    total += weights[k];
  }
  if (total <= 0) return NO_DEFENSE;
  const parts = [...byClass].map(([cls, w]) => ({ cls, w, c: continueProb(cls, f, beingRaised, profile, 1, tex) }));
  const defended = (m: number) => parts.reduce((t, x) => t + x.w * Math.min(1, x.c * m), 0) / total;
  const defend = beingRaised ? ACTIONS.facingRaise.defend : ACTIONS.facingBet.defend;
  const target = Math.min(1, defend / (1 + Math.max(0, f)) + profile.continueAdd);
  if (defended(1) >= target) return NO_DEFENSE;
  const live = parts.filter((x) => x.c > 0);
  let hi = live.length ? Math.max(1, Math.min(ACTIONS.facingBet.maxBoost, Math.max(...live.map((x) => 1 / x.c)))) : 1;
  if (defended(hi) < target) return beingRaised ? { factor: hi } : { factor: hi, topUp: topUp(parts, hi, (target - defended(hi)) * total) };
  let lo = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (defended(mid) < target) lo = mid;
    else hi = mid;
  }
  return { factor: hi };
}

/** Raises the strongest classes to always continuing, in order, until `short` weight more continues. */
function topUp(parts: { cls: PostflopClass; w: number; c: number }[], factor: number, short: number): Defense['topUp'] {
  const out: Defense['topUp'] = {};
  for (const cls of TOP_UP_ORDER) {
    if (short <= 1e-12) break;
    const part = parts.find((x) => x.cls === cls);
    if (!part) continue;
    const now = Math.min(1, part.c * factor);
    const room = part.w * (1 - now);
    if (room <= 0) continue;
    const add = Math.min(room, short);
    out[cls] = now + add / part.w;
    short -= add;
  }
  return out;
}

/** rangeDefense for a range of combos on this board. */
export function rangeDefenseOn(range: Range, board: readonly Card[], f: number, beingRaised = false, profile: Profile = DEFAULT): Defense {
  const classes: PostflopClass[] = [];
  const weights: number[] = [];
  const boardSet = new Set(board);
  for (let i = 0; i < NUM_COMBOS; i++) {
    if (!(range[i] > 0)) continue;
    const [a, b] = COMBO_CARDS[i];
    if (boardSet.has(a) || boardSet.has(b)) continue;
    classes.push(classifyHand([a, b], board));
    weights.push(range[i]);
  }
  return rangeDefense(classes, weights, f, beingRaised, profile, textureOf(board));
}

/** `intoAggressor`: the opponent made the last bet or raise on the previous street. */
export function firstToActFreq(
  cls: PostflopClass,
  intoAggressor = false,
  profile: Profile = DEFAULT,
  tex?: Texture,
): { check: number; small: number; big: number } {
  const name = intoAggressor ? 'leadIntoAggressor' : 'firstToAct';
  const t = ACTIONS[name];
  const share = (field: 'betSmall' | 'betBig') =>
    imported(tex, name, field, cls) ?? t[field][cls] * (tex ? ACTIONS.textures[tex][field][cls] : 1);
  const m = profile.betMult * bluffScale(cls, profile);
  let small = share('betSmall') * m;
  let big = share('betBig') * m;
  if (small + big > 1) {
    const k = 1 / (small + big);
    small *= k;
    big *= k;
  }
  return { check: clip01(1 - small - big), small, big };
}

/**
 * What the hero adds on the streets after `street` against one opponent hand of class `cls`,
 * with equity `eq` against it, when the hand goes on with `pot` in the middle and `behind`
 * left to bet: one bet per later street, growing with the pot and capped by the stacks, won
 * in proportion to the hero's edge and to how often that hand calls a bet of that size.
 * See laterStreets in actions.json.
 */
export function laterStreetValue(street: string, cls: PostflopClass, eq: number, pot: number, behind: number, profile: Profile = DEFAULT, tex?: Texture): number {
  const streets = street === 'flop' ? 2 : street === 'turn' ? 1 : 0;
  const edge = 2 * eq - 1;
  if (streets === 0 || behind <= 0 || edge <= 0) return 0;
  const { betSize } = ACTIONS.laterStreets;
  let total = 0, p = pot, left = behind;
  for (let i = 0; i < streets && left > 0; i++) {
    const bet = Math.min(betSize * p, left);
    total += bet;
    p += 2 * bet;
    left -= bet;
  }
  return edge * continueProb(cls, betSize, false, profile, 1, tex) * total;
}

export const realization = (street: string, inPosition: boolean, cls: PostflopClass): number =>
  street === 'river'
    ? 1
    : Math.min(1.1, (inPosition ? ACTIONS.realization.inPosition : ACTIONS.realization.outOfPosition) * ACTIONS.realization.byClass[cls]);

/** Class of every live combo for this board, or null when a card is dead. */
export function comboClasses(board: readonly Card[], dead: readonly Card[]): (PostflopClass | null)[] {
  const d = new Set(dead);
  return COMBO_CARDS.map(([a, b]) => (d.has(a) || d.has(b) ? null : classifyHand([a, b], board)));
}

export type PostflopMove =
  | { kind: 'check'; intoAggressor?: boolean }
  | { kind: 'bet'; f: number; intoAggressor?: boolean; allIn?: boolean }
  | { kind: 'call'; f: number; beingRaised?: boolean; canRaise?: boolean }
  | { kind: 'raise'; f: number; beingRaised?: boolean }
  | { kind: 'checkBehind' };

/**
 * Keeps each combo at the probability that its class takes `move`. `f` is the bet faced
 * (or made) divided by the pot before it. Weights multiply, like preflop narrowing.
 */
export function narrowPostflop(range: Range, board: readonly Card[], move: PostflopMove, profile: Profile = DEFAULT): Range {
  const out = new Float32Array(NUM_COMBOS);
  const boardSet = new Set(board);
  const facing = move.kind === 'call' || move.kind === 'raise';
  const defense = facing ? rangeDefenseOn(range, board, move.f, move.beingRaised, profile) : 1;
  const tex = textureOf(board);
  for (let i = 0; i < NUM_COMBOS; i++) {
    if (!(range[i] > 0)) continue;
    const [a, b] = COMBO_CARDS[i];
    if (boardSet.has(a) || boardSet.has(b)) continue;
    const cls = classifyHand([a, b], board);
    let p: number;
    switch (move.kind) {
      case 'check':
        p = firstToActFreq(cls, move.intoAggressor, profile, tex).check;
        break;
      case 'checkBehind':
        p = firstToActFreq(cls, false, profile, tex).check;
        break;
      case 'bet': {
        const fr = firstToActFreq(cls, move.intoAggressor, profile, tex);
        // An all-in bet can come from either size once the stack is short, so it keeps both shares.
        p = move.allIn ? fr.small + fr.big : move.f <= SMALL_BET_MAX ? fr.small : fr.big;
        break;
      }
      case 'call':
        p = responseFor(cls, move.f, move.canRaise !== false, move.beingRaised, profile, defense, tex).call;
        break;
      case 'raise':
        p = responseFor(cls, move.f, true, move.beingRaised, profile, defense, tex).raise;
        break;
    }
    out[i] = range[i] * p;
  }
  return out;
}
