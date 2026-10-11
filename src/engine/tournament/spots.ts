// Tournament practice: dealing a push/fold spot, grading the hero's answer against the solved
// ranges in chips and by ICM, and the running tally of answered spots.

import { formatCards, type Card } from '../cards';
import { positionsFor, type Position } from '../positions';
import { ALL_CLASSES, CLASS_COMBOS, classOfCombo, COMBO_CARDS, emptyRange, formatRange, NUM_COMBOS, type HandClass, type Range } from '../range';
import { randInt, type Rng } from '../rng';
import type { Verdict } from '../session/session';
import { CLASS_INDEX } from './classEquity';
import { heroValues, payoutsFor, rangeShare, solve, unitPerBB, type ClassRange, type PayoutMode, type Solution, type TableSetup } from './pushfold';

export type TableSize = 6 | 9;

export interface TournamentOptions {
  players: TableSize;
  ante: boolean;
  mode: PayoutMode;
}

export const DEFAULT_OPTIONS: TournamentOptions = { players: 6, ante: true, mode: 'final' };

export const MODE_LABELS: Record<PayoutMode, string> = {
  chips: 'Chip EV (no payouts yet)',
  final: 'Final table (everyone paid)',
  bubble: 'Bubble (one player from the money)',
};

export interface TournamentSpot extends TableSetup {
  hero: number;
  hand: [Card, Card];
}

/** Short stacks for the hero, where push/fold is the standard play; any depth for the others. */
const HERO_STACKS = [4, 15] as const;
const OTHER_STACKS = [3, 40] as const;
const half = (x: number) => Math.round(x * 2) / 2;

/** Deals the table and the situation, before the hero's cards. */
export function dealTable(rng: Rng, o: TournamentOptions): Omit<TournamentSpot, 'hand'> {
  const n = o.players;
  const push = rng() < 0.6;
  const opener = randInt(rng, n - 1);
  const hero = push ? opener : opener + 1 + randInt(rng, n - 1 - opener);
  const stacks = Array.from({ length: n }, (_, i) =>
    i === hero
      ? half(HERO_STACKS[0] + rng() * (HERO_STACKS[1] - HERO_STACKS[0]))
      : half(OTHER_STACKS[0] + (OTHER_STACKS[1] - OTHER_STACKS[0]) * rng() ** 1.6));
  return { stacks, ante: o.ante, mode: o.mode, opener, hero };
}

export const isPush = (s: Pick<TournamentSpot, 'hero' | 'opener'>) => s.hero === s.opener;

export interface Graded {
  /** The two options' payouts in big blinds (chip EV) or big-blind equivalents (ICM). */
  play: number;
  fold: number;
  best: 'play' | 'fold';
  /** How often the solved strategy plays this hand here (0..1). */
  freq: number;
}

/** Margins in big blinds (or big-blind equivalents): correct within 0.15, playable within 0.5. */
export const MARGINS = { correct: 0.15, playable: 0.5 };

export function verdictFor(loss: number): Verdict {
  return loss <= MARGINS.correct ? 'correct' : loss <= MARGINS.playable ? 'playable' : 'mistake';
}

/** The hero's options in a solved spot, in big blinds. */
export function gradeClass(sol: Solution, hero: number, cls: HandClass): Graded & ReturnType<typeof heroValues> {
  const k = CLASS_INDEX.get(cls)!;
  const v = heroValues(sol, hero, k);
  const unit = unitPerBB(sol.setup);
  const play = v.play / unit, fold = v.fold / unit;
  const range = hero === sol.setup.opener ? sol.push : sol.call[hero];
  return { ...v, play, fold, best: play >= fold ? 'play' : 'fold', freq: range[k] };
}

export interface SolvedSpot {
  spot: TournamentSpot;
  /** The spot solved with its payouts, and in chips for comparison (the same object in chip EV). */
  sol: Solution;
  chips: Solution;
}

/**
 * Deals a spot and the hero's hand. Hands far from the decision boundary teach little, so a hand
 * whose two options are more than 3bb apart is redealt up to three times, each time with a 60%
 * chance; about a third of the spots are still clear-cut.
 */
export function dealSpot(rng: Rng, o: TournamentOptions): SolvedSpot {
  const table = dealTable(rng, o);
  const sol = solve(table);
  const chips = table.mode === 'chips' ? sol : solve({ ...table, mode: 'chips' });
  let hand: [Card, Card] = [0, 0];
  for (let tries = 0; tries < 4; tries++) {
    const [a, b] = COMBO_CARDS[randInt(rng, NUM_COMBOS)];
    hand = [a, b];
    const g = gradeClass(sol, table.hero, classOfCombo(a, b));
    if (Math.abs(g.play - g.fold) <= 3 || rng() >= 0.6) break;
  }
  return { spot: { ...table, hand }, sol, chips };
}

export interface TournamentAnswer {
  verdict: Verdict;
  /** Big blinds (or equivalents) given up against the better option. */
  loss: number;
  played: boolean;
  g: Graded & ReturnType<typeof heroValues>;
  /** The same hand in chip EV, when the spot has payouts. */
  chipG: (Graded & ReturnType<typeof heroValues>) | null;
}

export function answer(s: SolvedSpot, played: boolean): TournamentAnswer {
  const cls = classOfCombo(s.spot.hand[0], s.spot.hand[1]);
  const g = gradeClass(s.sol, s.spot.hero, cls);
  const chipG = s.spot.mode === 'chips' ? null : gradeClass(s.chips, s.spot.hero, cls);
  const loss = Math.max(0, (played ? g.fold - g.play : g.play - g.fold));
  return { verdict: verdictFor(loss), loss, played, g, chipG };
}

/** The equity a call needs to beat folding: from the payouts of winning, losing and folding. */
export function equityNeeded(sol: Solution, caller: number): number {
  const { out } = sol;
  const win = out.callerWins[caller][caller], lose = out.openerWins[caller][caller];
  // Folding's payout does not depend on the hand, so any class gives it.
  const fold = heroValues(sol, caller, 0).fold;
  return win === lose ? 0 : (fold - lose) / (win - lose);
}

export const positionNames = (n: number): Position[] => positionsFor(n);

/** Stacks after the blinds and ante, for display. */
export function postedLabel(spot: TournamentSpot, seat: number): string | null {
  const n = spot.stacks.length;
  if (seat === n - 2) return 'SB 0.5';
  if (seat === n - 1) return spot.ante ? 'BB 1 + ante 1' : 'BB 1';
  return null;
}

export const handText = (spot: TournamentSpot) => formatCards(spot.hand);
export const handClass = (spot: TournamentSpot) => classOfCombo(spot.hand[0], spot.hand[1]);

/** A class range as a combo range, for range text. */
export function comboRange(r: ClassRange): Range {
  const out = emptyRange();
  ALL_CLASSES.forEach((c, i) => { for (const k of CLASS_COMBOS.get(c)!) out[k] = r[i]; });
  return out;
}

export const rangeText = (r: ClassRange) => formatRange(comboRange(r));

export const shareText = (r: ClassRange) => `${(rangeShare(r) * 100).toFixed(1)}%`;

export const payoutText = (mode: PayoutMode, players: number) => {
  const p = payoutsFor(mode, players);
  return p ? p.map((x, i) => `${i + 1}${['st', 'nd', 'rd'][i] ?? 'th'} ${Math.round(x * 1000) / 10}%`).join(', ') : null;
};

// Tally of answered spots, kept in the browser.

export interface TournamentTally {
  v: 1;
  spots: number;
  correct: number;
  playable: number;
  mistake: number;
  /** Big blinds (or equivalents) given up in total. */
  lost: number;
  /** Mistakes ICM decided: the chip EV answer would have been right in chips but not here. */
  icmMistakes: number;
}

export const emptyTally = (): TournamentTally => ({ v: 1, spots: 0, correct: 0, playable: 0, mistake: 0, lost: 0, icmMistakes: 0 });

export function addAnswer(t: TournamentTally, a: TournamentAnswer): TournamentTally {
  const icm = a.verdict === 'mistake' && a.chipG !== null && (a.played ? a.chipG.play >= a.chipG.fold : a.chipG.fold >= a.chipG.play);
  return { ...t, spots: t.spots + 1, [a.verdict]: t[a.verdict] + 1, lost: t.lost + a.loss, icmMistakes: t.icmMistakes + (icm ? 1 : 0) };
}

export function parseTally(text: string | null): TournamentTally {
  try {
    const t = JSON.parse(text ?? 'null');
    if (t?.v !== 1) return emptyTally();
    const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : 0);
    return { v: 1, spots: num(t.spots), correct: num(t.correct), playable: num(t.playable), mistake: num(t.mistake), lost: num(t.lost), icmMistakes: num(t.icmMistakes) };
  } catch {
    return emptyTally();
  }
}
