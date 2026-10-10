// Optional coaching prose from the Claude API. The trainer computes every number itself; the
// model only rewords those results in a coaching voice. This module builds the facts it is
// given and checks the reply, so it never sees hidden cards and never adds a number of its own.

import { freqLine, type Decision, type Feedback } from '../preflop/coach';
import type { PostflopFeedback } from '../postflop/coach';
import { bbs, describeOption, type Analysis } from '../postflop/recommend';

export type Verdict = 'correct' | 'playable' | 'mistake';

/** Everything the coach is told: only what the feedback panel already shows the player. */
export interface CoachFacts {
  /** Where the decision was, e.g. "BTN first in" or "Flop Ts7d3c". */
  spot: string;
  /** Hero cards, e.g. "AhKd". */
  hand: string;
  /** What the hero did, e.g. "call" or "bet 1/2 pot". */
  action: string;
  verdict: Verdict;
  heading: string;
  /** The trainer's own explanation lines. */
  reasons: string[];
  /** Postflop: every option with its EV and predicted response, as shown in the EV table. */
  options: string[];
  leakTags: string[];
  concept: string;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

export function preflopFacts(d: Decision, fb: Feedback, action: string, hand: string): CoachFacts {
  const equity = `Your equity against their range: ${pct(fb.equity.hero)}${fb.equity.needed !== null ? `; equity needed to call: ${(fb.equity.needed * 100).toFixed(1)}%` : ''}.`;
  return {
    spot: d.spot.label,
    hand,
    action,
    verdict: fb.grade.verdict,
    heading: fb.grade.heading,
    reasons: [...fb.bullets, freqLine(d), equity, fb.alternative, fb.sunkCost].filter((x): x is string => !!x),
    options: [],
    leakTags: fb.grade.tags,
    concept: fb.concept,
  };
}

export function postflopFacts(
  spot: string,
  hand: string,
  analysis: Analysis,
  fb: PostflopFeedback,
  concept: string,
  bb: number,
  multiway = false,
): CoachFacts {
  const options = analysis.rows.map((r) => {
    const parts = [`EV ${r.ev > 0 ? '+' : ''}${bbs(r.ev, bb)}`];
    if (r.fold !== undefined) parts.push(`${multiway ? 'everyone folds' : 'they fold'} ${pct(r.fold)}`);
    if (r.eqWhenCalled !== undefined) parts.push(`your equity when called ${pct(r.eqWhenCalled)}`);
    const marks = [r === analysis.best && 'best', r === fb.grade.chosen && 'your choice'].filter(Boolean);
    return `${describeOption(r.option)}: ${parts.join(', ')}${marks.length ? ` (${marks.join(', ')})` : ''}`;
  });
  return {
    spot,
    hand,
    action: describeOption(fb.grade.chosen.option).toLowerCase(),
    verdict: fb.grade.verdict,
    heading: fb.grade.heading,
    // The outcome line (what the opponent held) is left out: the coach explains the decision, not the result.
    reasons: [...fb.bullets, fb.sunkCost].filter((x): x is string => !!x),
    options,
    leakTags: fb.grade.tags,
    concept,
  };
}

export const SYSTEM_PROMPT = [
  'You are a poker coach explaining one decision to a student at a 6-max No-Limit Hold\'em cash game.',
  'The trainer has already computed every number and the verdict. Your job is only to explain its result in a warm, direct coaching voice.',
  'Rules:',
  '- Use only the facts in the message. Copy any number exactly as written, with no rounding and no new numbers: no equities, combo counts, frequencies, pot sizes or odds that are not in the facts.',
  '- Do not change or second-guess the verdict.',
  '- Do not guess what cards the opponent holds.',
  '- Write one short paragraph of three to five sentences of plain text, with no headings, lists or markdown.',
  '- Lead with the main reason, then give the student one thing to remember for next time.',
].join('\n');

export function buildPrompt(facts: CoachFacts): { system: string; user: string } {
  return {
    system: SYSTEM_PROMPT,
    user: `Explain this decision to the student. The facts, as computed by the trainer:\n\n${JSON.stringify(facts, null, 2)}`,
  };
}

/** Numbers written in a text, normalized: "+1.50bb" gives "1.5", "28.6%" gives "28.6". */
export function numbersIn(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(/\d+(?:[.,]\d+)*/g)) {
    const n = Number(m[0].replace(/,/g, ''));
    if (Number.isFinite(n)) out.add(String(n));
  }
  return out;
}

/** Numbers in the coach's reply that the trainer did not compute. Empty means the reply can be shown. */
export function unsupportedNumbers(reply: string, facts: CoachFacts): string[] {
  const known = numbersIn(JSON.stringify(facts));
  return [...numbersIn(reply)].filter((n) => !known.has(n));
}
