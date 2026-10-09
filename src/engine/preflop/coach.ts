// Preflop coaching: the recommended play, grading the hero's choice, and the range-read text.
// Everything here works from chart frequencies and engine state; equities are passed in.

import handRank from '../../../data/hand-rank.json';
import type { Card } from '../cards';
import { legalActions, pot, type Action, type ActionRecord, type HandState } from '../hand';
import { breakEvenFoldPct, potOdds } from '../math';
import {
  ALL_CLASSES, CLASS_COMBOS, COMBO_CARDS, NUM_COMBOS, classOfCombo, comboIndex, type HandClass, type Range,
} from '../range';
import { classFrequencies, frequencies, getStrategy, type Choice, type Frequencies, type SpotKind, type Strategy } from './charts';
import { actionToChoice, choiceToAction, narrowPreflop, type NarrowStep, type PreflopOptions } from './policy';
import { classifySpot, hasChart, spotFor, type PreflopSpot } from './spot';

const RANK_ORDER: HandClass[] = handRank.order;
const STRENGTH = new Map(RANK_ORDER.map((c, i) => [c, i]));

// ---- Names ----

const RAISE_NAMES: Record<SpotKind, string> = {
  rfi: 'open', vsOpen: '3-bet', squeeze: 'squeeze', vs3bet: '4-bet', vs4bet: 'all-in 5-bet',
  cold4bet: 'cold 4-bet', vsJam: 'all-in', vsLimp: 'isolation raise',
};

export function choiceName(kind: SpotKind, choice: Choice, canCheck: boolean): string {
  if (choice === 'raise') return RAISE_NAMES[kind];
  if (choice === 'call') return kind === 'vsLimp' ? 'over-limp' : 'call';
  return canCheck ? 'check' : 'fold';
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const pct = (x: number) => `${Math.round(x * 100)}%`;
const pct1 = (x: number) => `${(x * 100).toFixed(1)}%`;
const bbStr = (chips: number, bb: number) => `${+(chips / bb).toFixed(1)}bb`;

// ---- The hero's decision ----

export interface Decision {
  spot: PreflopSpot;
  strategy: Strategy;
  combo: number;
  hand: HandClass;
  freqs: Frequencies;
  best: Choice;
  /** Recommended raise amount ("to"), clamped to what is legal. */
  raiseTo: number | null;
  canCheck: boolean;
  toCall: number;
  pot: number;
}

export function heroDecision(s: HandState, hero: number, opts: PreflopOptions): Decision {
  const spot = spotFor(s, hero);
  if (!hasChart(spot)) throw new Error(`No chart for ${spot.label}`);
  const strategy = getStrategy(spot.kind, spot.key, 'hero', opts.lowStakes);
  const [a, b] = s.players[hero].hole;
  const combo = comboIndex(a, b);
  const freqs = frequencies(strategy, combo);
  const legal = legalActions(s);
  const raiseAction = choiceToAction(s, spot, 'raise', 'hero', opts);
  const best: Choice = freqs.raise >= freqs.call && freqs.raise >= freqs.fold ? 'raise' : freqs.call >= freqs.fold ? 'call' : 'fold';
  return {
    spot, strategy, combo, hand: classOfCombo(a, b), freqs, best,
    raiseTo: raiseAction.type === 'raise' || raiseAction.type === 'bet' ? raiseAction.to : null,
    canCheck: legal.check,
    toCall: legal.call ?? 0,
    pot: pot(s),
  };
}

// ---- Grading ----

export type Verdict = 'correct' | 'playable' | 'mistake';

export interface Grade {
  verdict: Verdict;
  heading: string;
  chosen: Choice;
  chosenFreq: number;
  best: Choice;
  bestFreq: number;
  /** Set when the action was right but the raise size was off. */
  sizeNote: string | null;
  /** Leak tags for the session tracker. */
  tags: string[];
}

export function gradePreflop(d: Decision, action: Action, bb: number, allInTo?: number): Grade {
  const chosen = actionToChoice(action.type);
  const f = d.freqs;
  const chosenFreq = f[chosen];
  const bestFreq = f[d.best];
  const name = (c: Choice) => choiceName(d.spot.kind, c, d.canCheck);
  let verdict: Verdict = chosenFreq >= 0.5 || chosenFreq >= bestFreq - 1e-9 ? 'correct' : chosenFreq >= 0.1 ? 'playable' : 'mistake';
  let heading =
    verdict === 'correct' ? `Correct ${name(chosen)}`
      : verdict === 'playable' ? `Playable ${name(chosen)}, ${name(d.best)} is more common`
        : `Mistake: ${name(chosen)}`;
  let sizeNote: string | null = null;
  const tags: string[] = [];

  if (chosen === 'raise' && (action.type === 'raise' || action.type === 'bet') && d.raiseTo) {
    const target = d.raiseTo;
    const isJamSpot = d.spot.kind === 'vs4bet' || d.spot.kind === 'vsJam';
    const jammed = allInTo !== undefined && action.to >= allInTo;
    const off = Math.abs(action.to - target) / target;
    if (!isJamSpot && (off > 0.35 || (jammed && target < allInTo! * 0.6))) {
      sizeNote = `The chart size here is ${bbStr(target, bb)}; you made it ${bbStr(action.to, bb)}.`;
      if (verdict === 'correct') {
        verdict = 'playable';
        heading = 'Right idea, wrong size';
      }
      tags.push(action.to > target ? 'oversized preflop raise' : 'undersized preflop raise');
    }
  }
  if (verdict === 'mistake') {
    if (chosen === 'call' && d.spot.kind === 'vs4bet') tags.push('calling 4-bets too wide');
    else if (chosen === 'call' && d.spot.kind === 'vs3bet') tags.push('defending too wide vs 3-bets');
    else if (chosen === 'fold' && d.best === 'raise' && d.spot.kind === 'rfi') tags.push('opening too tight');
    else if (chosen === 'raise' && d.spot.kind === 'rfi') tags.push('opening too loose');
    else if (chosen === 'call' && d.best === 'fold') tags.push('calling too wide preflop');
    else if (chosen === 'fold' && d.best !== 'fold') tags.push('folding too much preflop');
    else if (chosen === 'raise' && d.best !== 'raise') tags.push('raising too light preflop');
    else tags.push('passive with a raising hand');
  }
  return { verdict, heading, chosen, chosenFreq, best: d.best, bestFreq, sizeNote, tags };
}

/** Leak tags a wrong preflop choice could earn here, including the sunk-cost call. */
export function preflopLeaksAtRisk(s: HandState, hero: number, d: Decision): string[] {
  const bb = s.config.bb;
  const out = new Set<string>();
  const actions: Action[] = [{ type: d.canCheck ? 'check' : 'fold' }];
  if (d.toCall > 0) actions.push({ type: 'call' });
  if (d.raiseTo) actions.push({ type: s.currentBet > 0 ? 'raise' : 'bet', to: d.raiseTo });
  for (const a of actions) {
    const g = gradePreflop(d, a, bb);
    g.tags.forEach((t) => out.add(t));
    if (g.verdict === 'mistake' && g.chosen === 'call' && s.players[hero].total >= 3 * bb) out.add('sunk-cost call');
  }
  return [...out];
}

// ---- Feedback ----

export interface Feedback {
  grade: Grade;
  bullets: string[];
  concept: string;
  /** Equity numbers shown in the equity check. */
  equity: { hero: number; needed: number | null; note: string };
  alternative: string | null;
  sunkCost: string | null;
}

const CONCEPTS: Record<SpotKind, string> = {
  rfi: 'Opening ranges widen as fewer players are left to act behind you, because you win the blinds more often and play more pots in position.',
  vsOpen: 'Against an open, ask whether your hand plays better as a 3-bet (value or a blocker bluff) or as a call that keeps their weaker hands in.',
  squeeze: 'A squeeze attacks the caller, whose range is capped. Squeeze larger with each extra caller.',
  vs3bet: 'Facing a 3-bet, call with hands that play well postflop, 4-bet the strongest, and fold the rest. Position changes how wide you can call.',
  vs4bet: 'At 100bb a 4-bet commits a lot of chips. Continue with hands that beat the value part of their range, not just their bluffs.',
  cold4bet: 'Cold 4-bet ranges are very strong, since two players have already shown strength.',
  vsJam: 'Against an all-in, only equity versus their range matters. Compare your equity with the price.',
  vsLimp: 'Isolate limpers with hands that do well heads-up. Raise bigger with each extra limper.',
};

export function freqLine(d: Decision): string {
  const parts = (['raise', 'call', 'fold'] as Choice[])
    .filter((c) => d.freqs[c] > 0.001)
    .map((c) => `${choiceName(d.spot.kind, c, d.canCheck)} ${pct(d.freqs[c])}`);
  return `Chart for ${d.spot.label}: ${d.hand} ${parts.join(', ')}.`;
}

/**
 * Builds the explanation from facts: chart frequencies, computed equity, pot odds,
 * position, and blockers. `heroEquity` is hero equity vs the opponents' current ranges.
 */
export function preflopFeedback(
  s: HandState,
  hero: number,
  d: Decision,
  action: Action,
  heroEquity: number,
  opponentValue: { label: string; before: number; after: number } | null,
): Feedback {
  const bb = s.config.bb;
  const allInTo = s.players[hero].stack + s.players[hero].committed;
  const grade = gradePreflop(d, action, bb, allInTo);
  const bullets: string[] = [freqLine(d)];
  const needed = d.toCall > 0 ? potOdds(d.toCall, d.pot) : null;

  if (needed !== null) {
    bullets.push(
      `Calling costs ${bbStr(d.toCall, bb)} into a ${bbStr(d.pot, bb)} pot, so you need ${pct1(needed)} equity. You have ${pct(heroEquity)} against their range, before position and playability.`,
    );
  } else if (d.spot.kind === 'rfi') {
    const risk = d.raiseTo ?? 2.5 * bb;
    const be = breakEvenFoldPct({ pot: d.pot, risk });
    bullets.push(
      `An open to ${bbStr(risk, bb)} risks ${bbStr(risk, bb)} to win the ${bbStr(d.pot, bb)} in blinds. As a pure steal it needs everyone to fold ${pct(be)} of the time; you have ${pct(heroEquity)} equity when the BB defends.`,
    );
  }
  if (d.spot.kind !== 'rfi') {
    bullets.push(
      d.spot.inPosition
        ? 'You will have position for the rest of the hand, which lets you realize more of your equity.'
        : 'You will be out of position for the rest of the hand, which makes marginal calls worse than the raw equity suggests.',
    );
  }
  if (opponentValue && opponentValue.after < opponentValue.before - 1e-6) {
    bullets.push(
      `Your cards block their strongest hands: ${opponentValue.label} drops from ${+opponentValue.before.toFixed(0)} to ${+opponentValue.after.toFixed(0)} combos.`,
    );
  }
  if (grade.sizeNote) bullets.push(grade.sizeNote);

  let alternative: string | null = null;
  if (grade.chosen !== grade.best && grade.chosenFreq >= 0.1) {
    alternative = `Both lines are in the chart. ${cap(choiceName(d.spot.kind, grade.best, d.canCheck))} is used ${pct(grade.bestFreq)} of the time and ${choiceName(d.spot.kind, grade.chosen, d.canCheck)} ${pct(grade.chosenFreq)}, so your choice is fine; mixing keeps your ranges balanced.`;
  } else if (grade.chosen === grade.best && grade.bestFreq < 0.9) {
    const others = (['raise', 'call', 'fold'] as Choice[]).filter((c) => c !== grade.best && d.freqs[c] > 0.1);
    if (others.length) {
      alternative = `${cap(choiceName(d.spot.kind, others[0], d.canCheck))} is also played ${pct(d.freqs[others[0]])} of the time with this hand.`;
    }
  }
  const invested = s.players[hero].total;
  const sunkCost =
    grade.chosen === 'fold' && invested >= 3 * bb && d.toCall > 0
      ? `You already put ${bbStr(invested, bb)} in. Those chips are gone whatever you do now; only the ${bbStr(d.toCall, bb)} to call matters.`
      : grade.chosen === 'call' && grade.verdict === 'mistake' && invested >= 3 * bb
        ? `Calling because you already invested ${bbStr(invested, bb)} is the sunk-cost trap. The price to continue is what counts.`
        : null;
  if (sunkCost && grade.verdict === 'mistake' && grade.chosen === 'call') grade.tags.push('sunk-cost call');

  return {
    grade,
    bullets: bullets.slice(0, 4),
    concept: CONCEPTS[d.spot.kind],
    equity: {
      hero: heroEquity,
      needed,
      note: needed !== null ? `${pct(heroEquity)} equity vs ${pct1(needed)} needed` : `${pct(heroEquity)} equity vs their continuing range`,
    },
    alternative,
    sunkCost,
  };
}

/** How many combos of the opponent's strongest hands exist before and after removing the hero's cards. */
export function blockerCount(range: Range, heroCards: readonly Card[], topN = 6): { label: string; before: number; after: number } | null {
  const top = RANK_ORDER.filter((cls) => CLASS_COMBOS.get(cls)!.some((i) => range[i] > 0)).slice(0, topN);
  if (!top.length) return null;
  let before = 0, after = 0;
  for (const cls of top) for (const i of CLASS_COMBOS.get(cls)!) {
    before += range[i];
    const [a, b] = COMBO_CARDS[i];
    if (!heroCards.includes(a) && !heroCards.includes(b)) after += range[i];
  }
  return { label: top.join(', '), before, after };
}

// ---- Range read text ----

export interface OpponentRead {
  seat: number;
  line: string;
  range: Range;
  previous: Range | null;
  change: string;
  tendency: string | null;
}

function describeAction(spot: PreflopSpot, a: ActionRecord, bb: number): string {
  const choice = actionToChoice(a.type);
  if (choice === 'raise') {
    if (a.allIn) return 'goes all-in';
    const n = RAISE_NAMES[spot.kind];
    return spot.kind === 'rfi' ? `opens ${bbStr(a.to, bb)}` : `${n}s to ${bbStr(a.to, bb)}`.replace('isolation raises', 'isolates');
  }
  if (choice === 'call') {
    if (spot.kind === 'vsOpen' || spot.kind === 'squeeze') return 'calls the open';
    if (spot.kind === 'vs3bet') return 'calls the 3-bet';
    if (spot.kind === 'vs4bet') return 'calls the 4-bet';
    if (spot.kind === 'rfi') return 'limps';
    return 'calls';
  }
  return a.type === 'check' ? 'checks' : 'folds';
}

function changeText(step: NarrowStep): string {
  let beforeW = 0, afterW = 0;
  const removed: HandClass[] = [];
  const partial: HandClass[] = [];
  for (const cls of ALL_CLASSES) {
    let b = 0, a = 0;
    for (const i of CLASS_COMBOS.get(cls)!) { b += step.before[i]; a += step.after[i]; }
    beforeW += b;
    afterW += a;
    if (b > 0 && a <= 1e-9) removed.push(cls);
    else if (b > 0 && a < b * 0.99) partial.push(cls);
  }
  const byStrength = (xs: HandClass[]) => [...xs].sort((x, y) => STRENGTH.get(x)! - STRENGTH.get(y)!);
  const dropped = beforeW > 0 ? 1 - afterW / beforeW : 0;
  const verb = step.choice === 'raise' ? 'Raising' : step.choice === 'call' ? 'Calling' : 'Checking';
  const strongRemoved = byStrength(removed).slice(0, 5);
  const parts = [`${verb} keeps ${pct(1 - dropped)} of the hands they had before.`];
  if (step.choice === 'call' && strongRemoved.length && STRENGTH.get(strongRemoved[0])! < 20) {
    parts.push(`It removes hands they would have raised, like ${strongRemoved.join(', ')}.`);
  } else if (removed.length) {
    parts.push(`Gone: ${byStrength(removed).slice(-4).reverse().join(', ')} and other weak hands.`);
  }
  if (partial.length) parts.push(`Kept at partial weight: ${byStrength(partial).slice(0, 5).join(', ')}.`);
  return parts.join(' ');
}

export function opponentReads(s: HandState, hero: number, opts: PreflopOptions): OpponentRead[] {
  const positions = s.players.map((p) => p.position);
  const bb = s.config.bb;
  const reads: OpponentRead[] = [];
  s.players.forEach((p, i) => {
    if (i === hero || p.folded) return;
    const { range, steps } = narrowPreflop(positions, s.actions, i, 'pool', opts);
    if (!steps.length) return;
    const pre = s.actions.filter((a) => a.street === 'preflop');
    const mine = pre.filter((a) => a.player === i && a.type !== 'post');
    const descs = mine.map((a) => describeAction(classifySpot(positions, pre.slice(0, pre.indexOf(a)), i), a, bb));
    const last = steps[steps.length - 1];
    const notes = getStrategy(last.spot.kind, last.spot.key, 'pool', opts.lowStakes).notes;
    reads.push({
      seat: i,
      line: `${p.position} · ${descs.join(', ')}`,
      range,
      previous: steps.length ? last.before : null,
      change: changeText(last),
      tendency: notes[0] ?? null,
    });
  });
  return reads;
}

/** Players still to act behind a first-in hero, with the range they continue with against an open. */
export function playersBehind(s: HandState, hero: number, opts: PreflopOptions): OpponentRead[] {
  const heroPos = s.players[hero].position;
  const out: OpponentRead[] = [];
  s.players.forEach((p, i) => {
    if (i === hero || p.folded) return;
    const key = `${p.position}_vs_${heroPos}`;
    const st = (() => { try { return getStrategy('vsOpen', key, 'pool', opts.lowStakes); } catch { return null; } })();
    if (!st) return;
    const range = new Float32Array(NUM_COMBOS);
    for (let k = 0; k < NUM_COMBOS; k++) range[k] = Math.min(1, st.raise[k] + st.call[k]);
    out.push({
      seat: i,
      line: `${p.position} · still to act, continues vs a ${heroPos} open with`,
      range,
      previous: null,
      change: `They 3-bet about ${pct(sumW(st.raise) / NUM_COMBOS)} and call about ${pct(sumW(st.call) / NUM_COMBOS)} of hands.`,
      tendency: st.notes[0] ?? null,
    });
  });
  // The BB defends most often; show it first, then the player with position on the hero.
  return out.sort((a, b) => (s.players[b.seat].position === 'BB' ? 1 : 0) - (s.players[a.seat].position === 'BB' ? 1 : 0) || b.seat - a.seat).slice(0, 2);
}

const sumW = (r: Range) => r.reduce((x, y) => x + y, 0);

export function heroLineRead(s: HandState, hero: number, opts: PreflopOptions): string {
  const positions = s.players.map((p) => p.position);
  const { steps } = narrowPreflop(positions, s.actions, hero, 'baseline', opts);
  const pos = s.players[hero].position;
  if (!steps.length) {
    const spot = spotFor(s, hero);
    if (spot.kind === 'rfi') {
      const behind = s.players.filter((p, i) => i !== hero && !p.folded).length;
      return `Everyone has folded to you in the ${pos}. Your range is uncapped: an open here can hold any premium hand. ${behind} player${behind === 1 ? '' : 's'} can still act behind you.`;
    }
    return pos === 'BB'
      ? 'You have not acted yet. From the BB you close the action and already have 1bb in, so you defend wider than any other seat.'
      : `You have not acted yet. A call from the ${pos} looks capped (you would 3-bet the best hands); a 3-bet represents a strong, mostly linear range.`;
  }
  const last = steps[steps.length - 1];
  if (last.choice === 'raise') {
    return last.spot.kind === 'rfi'
      ? `Your ${pos} open is uncapped: it holds every premium hand, so your range looks strong to the players behind.`
      : 'Your re-raise represents a strong range, weighted toward premium pairs and big aces, plus a few suited blocker hands.';
  }
  return 'Calling caps your range: you would have re-raised the very best hands, and the opponents know it.';
}

export function nudge(d: Decision, heroEquity: number | null): string {
  const needed = d.toCall > 0 ? potOdds(d.toCall, d.pot) : null;
  switch (d.spot.kind) {
    case 'rfi':
      return 'Think about how often everyone behind folds, and how this hand plays when the BB or the button defends.';
    case 'vsOpen':
    case 'squeeze':
      return needed !== null && heroEquity !== null
        ? `You need ${pct1(needed)} equity to call. Compare that with your equity, then ask whether the hand prefers a bigger pot or a cheaper flop.`
        : 'Ask whether your hand prefers a bigger pot or a cheaper flop.';
    case 'vs3bet':
      return 'Your open was wide; their 3-bet is not. Ask how your hand does against the value part of their range, and whether you have position.';
    case 'vs4bet':
    case 'cold4bet':
    case 'vsJam':
      return 'Most low-stakes 4-bets are value. Count which of their hands you beat, not which hands they could be bluffing with.';
    case 'vsLimp':
      return 'Limpers usually hold weak or speculative hands. Ask whether your hand wants to play heads-up in a raised pot.';
  }
}

/** The hero's strategy for this spot as per-class frequencies, for the "which hands take this action" grid. */
export function strategyGrid(st: Strategy): Map<HandClass, Frequencies> {
  return new Map(ALL_CLASSES.map((c) => [c, classFrequencies(st, c)]));
}
