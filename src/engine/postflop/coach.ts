// Words for the postflop range read and feedback. Every number in the text comes from the
// analysis (recommend.ts) or the category breakdown (categories.ts).

import { evaluate } from '../evaluator';
import type { Card } from '../cards';
import { COMBO_CARDS, NUM_COMBOS } from '../range';
import { classifyHand, POSTFLOP_CLASS_LABEL, type PostflopClass } from './classify';
import type { PostflopBreakdown } from './categories';
import type { PostflopMove } from './model';
import { bbs, describeOption, type Analysis, type OptionRow, type PostflopGrade, type DecisionBasics } from './recommend';

const pct = (x: number) => `${Math.round(x * 100)}%`;
const pct1 = (x: number) => `${(x * 100).toFixed(1)}%`;

/** A pre-decision hint that points at the read without naming the answer. */
export function postflopNudge(a: Analysis, br: PostflopBreakdown): string {
  const share = (k: 'beats' | 'draws' | 'pays' | 'missed') => (br.live > 0 ? (br.totals.get(k) ?? 0) / br.live : 0);
  const parts: string[] = [];
  parts.push(`${pct(share('beats'))} of their range beats you now, ${pct(share('draws'))} can still outdraw you, ${pct(share('pays'))} are worse hands that can pay, and ${pct(share('missed'))} have little.`);
  if (a.facts.potOdds !== null) {
    parts.push(`Compare your equity with the ${pct1(a.facts.potOdds)} the price asks for, and ask whether a raise folds out enough of the hands that beat you.`);
  } else {
    parts.push('Ask which of those groups calls a bet, and whether those hands are better or worse than yours.');
  }
  if (a.facts.spr < 3) parts.push(`The stack-to-pot ratio is only ${a.facts.spr.toFixed(1)}, so think about how much of your stack one bet commits.`);
  return parts.join(' ');
}

export interface PostflopFeedback {
  grade: PostflopGrade;
  bullets: string[];
  sunkCost: string | null;
  outcome: string | null;
}

function rowLineFor(r: OptionRow, bb: number, multiway = false): string {
  const name = describeOption(r.option).toLowerCase();
  if (r.fold === undefined) return `${name} (${bbs(r.ev, bb)})`;
  return `${name} (${bbs(r.ev, bb)}; ${multiway ? 'everyone folds' : 'they fold'} ${pct(r.fold)} and you have ${pct(r.eqWhenCalled ?? 0)} when called)`;
}

export function postflopFeedback(
  sit: DecisionBasics,
  a: Analysis,
  grade: PostflopGrade,
  villainHole: readonly Card[],
  fullBoard: readonly Card[],
  opts: { multiway?: boolean } = {},
): PostflopFeedback {
  const mw = !!opts.multiway;
  const rowLine = (r: OptionRow, bb: number) => rowLineFor(r, bb, mw);
  const f = a.facts;
  const bb = sit.bb;
  const bullets: string[] = [];
  bullets.push(`Your hand is in the "${POSTFLOP_CLASS_LABEL[f.heroClass].toLowerCase()}" group, with ${pct(f.equity)} equity against ${mw ? 'all of their ranges together' : 'their range'}.`);
  if (f.potOdds !== null) {
    const callRow = a.rows.find((r) => r.option.kind === 'call');
    bullets.push(
      `Calling needs ${pct1(f.potOdds)}. ${sit.street === 'river' ? 'On the river your equity is final' : `Before the river you can expect to realize about ${pct(f.realization)} of it`}, so a call is worth ${callRow ? bbs(callRow.ev, bb) : 'n/a'}.`,
    );
  }
  const chosen = grade.chosen, best = grade.best;
  if (chosen !== best && grade.verdict === 'correct') {
    bullets.push(`The top play is ${rowLine(best, bb)}. Yours, ${rowLine(chosen, bb)}, is within ${bbs(grade.loss, bb)} of it, close enough to count as correct.`);
  } else if (chosen !== best) {
    bullets.push(`The best play is ${rowLine(best, bb)}. You chose ${rowLine(chosen, bb)}, which gives up ${bbs(grade.loss, bb)}.`);
  } else {
    const runnerUp = a.rows.filter((r) => r !== best).sort((x, y) => y.ev - x.ev)[0];
    bullets.push(`Your play is the best one: ${rowLine(best, bb)}.${runnerUp ? ` Next best is ${describeOption(runnerUp.option).toLowerCase()} at ${bbs(runnerUp.ev, bb)}.` : ''}`);
  }
  if (chosen.breakEvenBluff !== undefined && chosen.fold !== undefined) {
    bullets.push(`As a pure bluff this size needs ${pct(chosen.breakEvenBluff)} folds; the model expects ${mw ? 'everyone to fold ' : ''}${pct(chosen.fold)}${mw ? ' of the time' : ''}.`);
  }
  if (f.heroStrong !== null) {
    const lead = f.heroStrong > f.villainStrong + 0.03 ? 'You have the nut advantage' : f.villainStrong > f.heroStrong + 0.03 ? 'They have the nut advantage' : 'Neither side has a clear nut advantage';
    bullets.push(`${lead}: two pair or better is ${pct(f.heroStrong)} of your range and ${pct(f.villainStrong)} of ${mw ? 'the strongest opponent\'s' : 'theirs'}.`);
  }
  bullets.push(`Stack-to-pot ratio: ${f.spr.toFixed(1)}.${f.spr < 3 ? ' Below 3, a strong one-pair hand is usually committed once it bets.' : ''}`);
  if (grade.sizeNote) bullets.push(grade.sizeNote);

  const behind = sit.heroBehind;
  const sunkCost =
    chosen.option.kind === 'call' && grade.verdict === 'mistake' && sit.heroInvested >= 0.25 * (sit.heroInvested + behind)
      ? `You have ${bbs(sit.heroInvested, bb)} in the pot already, but that money is gone either way. Only the next call matters, and it loses ${bbs(-chosen.ev, bb)}.`
      : chosen.option.kind === 'fold' && grade.verdict === 'correct' && sit.heroInvested >= 0.25 * (sit.heroInvested + behind)
        ? `Folding after putting ${bbs(sit.heroInvested, bb)} in can feel bad, but those chips are already spent. Folding loses nothing more.`
        : null;

  let outcome: string | null = null;
  if (chosen.option.kind !== 'fold' && fullBoard.length === 5) {
    const h = evaluate([...sit.hero, ...fullBoard]);
    const v = evaluate([...villainHole, ...fullBoard]);
    const result = h > v ? 'would win' : h === v ? 'would split' : 'would lose';
    outcome = `This time they held ${villainHole.map(cardText).join(' ')}, and at a showdown on this board you ${result}. `;
    outcome += grade.verdict === 'correct'
      ? result === 'would lose'
        ? 'A good decision can still lose a single hand; it wins over all the hands they could have.'
        : 'The result matches the decision this time.'
      : result === 'would win'
        ? 'Winning this one does not make the play right; across their whole range it loses money.'
        : 'Judge the play by the range, not by this one hand.';
  }
  return { grade, bullets, sunkCost, outcome };
}

const cardText = (c: Card) => '23456789TJQKA'[c >> 2] + '♣♦♥♠'[c & 3];

/** Share of a range in each hand class, largest first, ignoring dead cards. */
export function classMix(range: Float32Array, board: readonly Card[], dead: readonly Card[]): { cls: PostflopClass; share: number; combos: number }[] {
  const d = new Set([...board, ...dead]);
  const by = new Map<PostflopClass, number>();
  let total = 0;
  for (let i = 0; i < NUM_COMBOS; i++) {
    const w = range[i];
    if (!(w > 0)) continue;
    const [a, b] = COMBO_CARDS[i];
    if (d.has(a) || d.has(b)) continue;
    const k = classifyHand([a, b], board);
    by.set(k, (by.get(k) ?? 0) + w);
    total += w;
  }
  return [...by].map(([cls, combos]) => ({ cls, combos, share: total > 0 ? combos / total : 0 })).sort((x, y) => y.share - x.share);
}

/** The idea behind the best play, for decisions that come from real hands rather than set spots. */
export function conceptFor(sit: DecisionBasics, a: Analysis): string {
  const best = a.best.option.kind;
  const facing = a.facts.potOdds !== null;
  if (facing && best === 'call') {
    return 'Pot odds. A call only has to win often enough to pay for itself: compare your equity, adjusted for how much of it you can realize, with the price.';
  }
  if (facing && best === 'fold') {
    return 'Folding costs nothing more. When your equity is below what the price asks and a raise will not fold out enough better hands, letting the hand go is the profitable play.';
  }
  if (facing && best === 'raise') {
    return (a.best.eqWhenCalled ?? 0) >= 0.5
      ? 'Raising for value. When the hands that continue are mostly worse than yours, build the pot now.'
      : 'Semi-bluffing. A raise wins when they fold and still has outs when they call, which can beat calling.';
  }
  if (best === 'check') {
    return sit.street === 'river'
      ? 'Showdown value. On the river, betting only helps if worse hands call or better hands fold; when neither happens enough, check.'
      : 'Pot control. When a bet mostly gets called by better hands and folds out worse ones, checking keeps the pot small and your equity alive.';
  }
  return (a.best.eqWhenCalled ?? 0) >= 0.5
    ? 'Value betting. Bet when the hands that call are mostly worse than yours; size to what they will still call.'
    : 'Fold equity. A bet that folds out enough hands is profitable even when it is behind when called.';
}

/** The read's hint for a multiway decision, from each opponent's breakdown. */
export function multiwayNudge(a: Analysis, reads: { name: string; br: PostflopBreakdown }[]): string {
  const share = (br: PostflopBreakdown, k: 'beats' | 'draws') => (br.live > 0 ? (br.totals.get(k) ?? 0) / br.live : 0);
  const parts: string[] = [];
  parts.push(`${reads.map((r) => `${pct(share(r.br, 'beats'))} of ${r.name}'s range beats you`).join(' and ')}.`);
  parts.push(`To win at showdown you have to beat all of them, so your equity against everyone together is ${pct(a.facts.equity)}, lower than against any one of them.`);
  const bets = a.rows.filter((r) => r.fold !== undefined);
  if (bets.length) {
    const most = bets.reduce((x, y) => ((y.fold ?? 0) > (x.fold ?? 0) ? y : x));
    const fold = most.fold ?? 0;
    parts.push(`Your biggest bet makes everyone fold about ${pct(fold)} of the time${fold < 0.5 ? ', so bluffs need real equity behind them' : ''}.`);
  }
  if (a.facts.potOdds !== null) parts.push(`A call needs ${pct1(a.facts.potOdds)}.`);
  return parts.join(' ');
}

export function multiwayConcept(a: Analysis): string {
  const best = a.best.option.kind;
  if ((best === 'bet' || best === 'raise') && (a.best.eqWhenCalled ?? 0) >= 0.5) {
    return 'Value in multiway pots. With more players in, more worse hands are around to pay you, so strong hands should still build the pot.';
  }
  if (best === 'bet' || best === 'raise') {
    return 'Semi-bluffs multiway. A bet that has to fold out several players works only with real equity behind it, like a strong draw.';
  }
  return 'Multiway pots. Each extra opponent makes it less likely everyone folds and more likely someone holds a strong hand, so bluff less, and let marginal hands go more often than heads-up.';
}

/** One line on what the opponent's latest action did to their range. */
export function stepLine(kind: PostflopMove['kind'], street: string, kept: number): string {
  const verb = { check: 'check', bet: 'bet', call: 'call', raise: 'raise', checkBehind: 'check' }[kind];
  return `Their ${verb} on the ${street} kept ${pct(kept)} of their range. Crossed-out cells are hands that mostly drop out with that action.`;
}
