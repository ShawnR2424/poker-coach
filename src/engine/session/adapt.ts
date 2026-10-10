// Adaptive opponents: the bots watch the hero's postflop decisions over the session and adjust
// to them, for example bluffing more against a hero who folds to bets more often than the
// trainer's best play would. The same adjusted style drives the bots' actions, the range reads
// and the EV grading, so the trainer grades the hero against the opponents they actually face.
// Thresholds are in data/postflop/adapt.json.

import table from '../../../data/postflop/adapt.json';
import type { Profile } from '../postflop/model';
import type { HandRecord } from './session';

export type PostflopMove = 'fold' | 'call' | 'raise' | 'check' | 'bet';

const T = table as unknown as {
  window: number;
  minSample: number;
  gap: number;
  overfolds: { bluffMult: number };
  overcalls: { bluffMult: number };
  betsOften: { continueAdd: number };
  rarelyBets: { continueAdd: number };
};
export const ADAPT = T;

export interface Rate {
  /** Decisions where the hero took the action the rate counts (fold, or bet). */
  you: number;
  /** Decisions where the trainer's best play was that action. */
  best: number;
  /** Decisions counted: the latest `window` of that kind. */
  of: number;
}

export interface HeroTendencies {
  /** Folds among the hero's latest decisions facing a bet. */
  foldToBet: Rate;
  /** Bets among the hero's latest decisions with no bet to face. */
  betWhenFree: Rate;
}

export type AdjustmentKind = 'overfolds' | 'overcalls' | 'betsOften' | 'rarelyBets';

export interface Adjustment {
  kind: AdjustmentKind;
  /** What the opponents noticed and what they do about it. */
  text: string;
}

export interface Adaptation {
  bluffMult: number;
  continueAdd: number;
  adjustments: Adjustment[];
}

/** Each adjustment in a few words, for the opponent panels. */
export const ADJUSTMENT_SHORT: Record<AdjustmentKind, string> = {
  overfolds: 'bluffing more because you fold to bets more than the best play does',
  overcalls: 'bluffing less because you fold to bets less than the best play does',
  betsOften: 'calling your bets lighter because you bet more than the best play does',
  rarelyBets: 'folding more to your bets because you bet less than the best play does',
};

const FACING = new Set<PostflopMove>(['fold', 'call', 'raise']);

/**
 * The hero's postflop rates over the latest graded decisions of each kind, next to how often the
 * trainer's best play took the same action in those same spots.
 */
export function heroTendencies(hands: readonly HandRecord[], window = T.window): HeroTendencies {
  const facing: [PostflopMove, PostflopMove][] = [];
  const free: [PostflopMove, PostflopMove][] = [];
  for (const h of hands) {
    for (const d of h.decisions) {
      if (!d.move || !d.bestMove) continue;
      (FACING.has(d.move) ? facing : free).push([d.move, d.bestMove]);
    }
  }
  const rate = (xs: [PostflopMove, PostflopMove][], m: PostflopMove): Rate => {
    const last = xs.slice(-window);
    return { you: last.filter(([y]) => y === m).length, best: last.filter(([, b]) => b === m).length, of: last.length };
  };
  return { foldToBet: rate(facing, 'fold'), betWhenFree: rate(free, 'bet') };
}

/** How far the hero's rate is from the best play's, as a share of the decisions. */
export const gapOf = (r: Rate) => (r.of ? (r.you - r.best) / r.of : 0);

/** How the opponents adjust to these tendencies; null when they play their base styles. */
export function adaptationFor(t: HeroTendencies): Adaptation | null {
  const adjustments: Adjustment[] = [];
  let bluffMult = 1, continueAdd = 0;
  const { foldToBet: f, betWhenFree: b } = t;
  if (f.of >= T.minSample) {
    const facts = `You folded to ${f.you} of your last ${f.of} bets, where the best play folds ${f.best}`;
    if (gapOf(f) > T.gap) {
      bluffMult = T.overfolds.bluffMult;
      adjustments.push({ kind: 'overfolds', text: `${facts}, so opponents bluff more. Their bets hold more air and weak draws, which makes calling with a fair hand better.` });
    } else if (gapOf(f) < -T.gap) {
      bluffMult = T.overcalls.bluffMult;
      adjustments.push({ kind: 'overcalls', text: `${facts}, so opponents bluff less. Their bets are mostly real hands, which makes folding weak pairs better.` });
    }
  }
  if (b.of >= T.minSample) {
    const facts = `You bet ${b.you} of your last ${b.of} times when nobody had bet, where the best play bets ${b.best}`;
    if (gapOf(b) > T.gap) {
      continueAdd = T.betsOften.continueAdd;
      adjustments.push({ kind: 'betsOften', text: `${facts}, so opponents call your bets with weaker hands. Bluffs work less and thinner value bets work more.` });
    } else if (gapOf(b) < -T.gap) {
      continueAdd = T.rarelyBets.continueAdd;
      adjustments.push({ kind: 'rarelyBets', text: `${facts}, so opponents give your bets more credit and fold more. Bluffs work more and thin value bets get called less.` });
    }
  }
  return adjustments.length ? { bluffMult, continueAdd, adjustments } : null;
}

/** An opponent's style with the session's adjustments applied. */
export function adaptProfile(p: Profile, a: Adaptation | null | undefined): Profile {
  if (!a) return p;
  return {
    ...p,
    bluffMult: (p.bluffMult ?? 1) * a.bluffMult,
    continueAdd: p.continueAdd + a.continueAdd,
    adjustments: a.adjustments.map((x) => ADJUSTMENT_SHORT[x.kind]),
  };
}
