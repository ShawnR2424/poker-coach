// The optional Claude explanations may only reword what the trainer computed. These tests check
// that the prompt carries nothing but the facts the feedback panel shows (no hidden cards, no
// numbers from anywhere else), and that a reply with a number of its own is caught.

import { describe, expect, it } from 'vitest';
import { formatCard, formatCards } from '../cards';
import { buildPrompt, numbersIn, postflopFacts, preflopFacts, SYSTEM_PROMPT, unsupportedNumbers, type CoachFacts } from '../coach/explain';
import { comboEquities } from '../equity';
import { advance, heroDecides, liveVillains, newGameHand, type GameHand } from '../game/levels';
import { applyAction, legalActions, type Action, type HandState } from '../hand';
import { conceptFor, postflopFeedback } from '../postflop/coach';
import { PROFILES } from '../postflop/model';
import { narrowHand } from '../postflop/narrow';
import { analyze, bbs, describeOption, gradePostflop, situationFromState } from '../postflop/recommend';
import { freqLine, heroDecision, preflopFeedback } from '../preflop/coach';
import { hasChart, spotFor } from '../preflop/spot';
import { makeRng } from '../rng';

const opts = { lowStakes: true };
const pct = (x: number) => `${Math.round(x * 100)}%`;

interface Case {
  facts: CoachFacts;
  /** Everything the feedback panel shows for this decision, as text. */
  shown: string;
  /** Cards the hero cannot see. */
  hidden: string[];
}

const hiddenCards = (g: GameHand, s: HandState) => g.villains.flatMap((v) => s.players[v].hole.map(formatCard));

function preflopCase(g: GameHand, s: HandState, action: Action): Case | null {
  if (!hasChart(spotFor(s, g.hero))) return null;
  const d = heroDecision(s, g.hero, opts);
  const fb = preflopFeedback(s, g.hero, d, action, 0.4213, null);
  const hand = formatCards(s.players[g.hero].hole);
  const facts = preflopFacts(d, fb, action.type, hand);
  const shown = [
    d.spot.label, hand, action.type, fb.grade.heading, ...fb.bullets, freqLine(d), fb.alternative ?? '', fb.sunkCost ?? '', fb.concept,
    pct(fb.equity.hero), fb.equity.needed !== null ? (fb.equity.needed * 100).toFixed(1) : '', ...fb.grade.tags,
  ].join('\n');
  return { facts, shown, hidden: hiddenCards(g, s) };
}

function postflopCase(g: GameHand, s: HandState, pick: number): Case | null {
  const live = liveVillains(g, s);
  if (live.length !== 1) return null;
  const v = live[0];
  const profile = PROFILES[g.profiles[v]];
  const range = narrowHand(s, v, 'pool', opts, profile).range;
  const sit = situationFromState(s, g.hero, v, range, { heroPreflopAggressor: false, villainProfile: profile });
  const a = analyze(sit, comboEquities(sit.hero, sit.board, sit.villainRange));
  const opt = a.rows[pick % a.rows.length].option;
  const grade = gradePostflop(sit, a, (opt.to !== undefined ? { type: opt.kind, to: opt.to } : { type: opt.kind }) as Action);
  const fb = postflopFeedback(sit, a, grade, [], []);
  const concept = conceptFor(sit, a);
  const spot = `${s.street} ${formatCards(s.board)}`;
  const hand = formatCards(s.players[g.hero].hole);
  const facts = postflopFacts(spot, hand, a, fb, concept, sit.bb);
  const table = a.rows.flatMap((r) => [describeOption(r.option), bbs(r.ev, sit.bb), r.fold !== undefined ? pct(r.fold) : '', r.eqWhenCalled !== undefined ? pct(r.eqWhenCalled) : '']);
  const shown = [spot, hand, fb.grade.heading, ...fb.bullets, fb.sunkCost ?? '', concept, ...table, ...fb.grade.tags].join('\n');
  return { facts, shown, hidden: hiddenCards(g, s) };
}

/** Real decisions from practice hands at every postflop level, with random hero play. */
function cases(): Case[] {
  const out: Case[] = [];
  for (const level of [1, 3, 4, 6] as const) {
    for (let seed = 1; seed <= 15; seed++) {
      const rng = makeRng(seed * 7919 + level);
      const g = newGameHand(level, rng, opts);
      let s = advance(g, g.state, rng, opts);
      let turn = 0;
      while (heroDecides(g, s) && turn < 12) {
        const l = legalActions(s);
        const action: Action = l.call !== null && rng() < 0.6 ? { type: 'call' } : l.check ? { type: 'check' } : { type: 'fold' };
        const c = s.street === 'preflop' ? preflopCase(g, s, action) : postflopCase(g, s, seed + turn);
        if (c) out.push(c);
        s = advance(g, applyAction(s, action), rng, opts);
        turn++;
      }
    }
  }
  return out;
}

const all = cases();

describe('Claude explanation prompt', () => {
  it('covers preflop and postflop decisions', () => {
    expect(all.filter((c) => c.facts.options.length === 0).length).toBeGreaterThan(20);
    expect(all.filter((c) => c.facts.options.length > 0).length).toBeGreaterThan(20);
  });

  it('sends exactly the facts object and nothing else about the hand', () => {
    for (const c of all) {
      const { system, user } = buildPrompt(c.facts);
      expect(system).toBe(SYSTEM_PROMPT);
      const json = user.slice(user.indexOf('{'));
      expect(JSON.parse(json)).toEqual(c.facts);
      expect(Object.keys(c.facts).sort()).toEqual(['action', 'concept', 'hand', 'heading', 'leakTags', 'options', 'reasons', 'spot', 'verdict']);
    }
  });

  it('contains only numbers the feedback panel shows', () => {
    for (const c of all) {
      const shown = numbersIn(c.shown);
      const extra = [...numbersIn(buildPrompt(c.facts).user)].filter((n) => !shown.has(n));
      expect(extra, `numbers not on screen: ${extra.join(', ')} in ${JSON.stringify(c.facts)}`).toEqual([]);
    }
  });

  it("never includes the opponents' hidden cards", () => {
    for (const c of all) {
      const { user } = buildPrompt(c.facts);
      for (const card of c.hidden) {
        expect(c.facts.hand).not.toContain(card);
        expect(c.facts.spot).not.toContain(card);
      }
      // Any written run of cards (a hand or a board) uses only cards the hero can see.
      for (const run of user.matchAll(/\b(?:[2-9TJQKA][shdc]){2,}\b/g)) {
        for (const card of run[0].match(/../g)!) expect(c.hidden).not.toContain(card);
      }
    }
  });

  it('has a fixed system prompt with no hand data in it', () => {
    expect(SYSTEM_PROMPT).not.toMatch(/\b[2-9TJQKA][shdc]\b/);
    expect(new Set(all.map((c) => buildPrompt(c.facts).system)).size).toBe(1);
  });
});

describe('checking the reply', () => {
  const facts: CoachFacts = {
    spot: 'BB vs BTN open', hand: 'Kh9s', action: 'call', verdict: 'correct', heading: 'Correct call',
    reasons: ['You need 28.6% equity to call and have 42%.'], options: [], leakTags: [], concept: 'Defend wide in the big blind.',
  };

  it('accepts a reply that only repeats the computed numbers', () => {
    expect(unsupportedNumbers('You had 42% against a price of 28.6%, so calling with Kh9s is right.', facts)).toEqual([]);
  });

  it('flags invented or rounded numbers', () => {
    expect(unsupportedNumbers('You have 42% and they fold 62% of the time.', facts)).toEqual(['62']);
    expect(unsupportedNumbers('You need about 29% equity.', facts)).toEqual(['29']);
  });
});
