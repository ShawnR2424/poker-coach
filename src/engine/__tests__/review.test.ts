// Mistake review: the deck picks up every saved mistake, a card deals exactly the spot that was
// played, grades an answer the same way the hand was graded, and schedules it by the Leitner boxes.

import { describe, expect, it } from 'vitest';
import { practiceHand } from '../game/drills';
import { advance, heroDecides } from '../game/levels';
import { applyAction, legalActions, type Action, type HandState } from '../hand';
import type { HeroOption } from '../postflop/recommend';
import { choiceToAction } from '../preflop/policy';
import {
  answerCard, canGrade, cardState, DECK_MAX, dueCards, emptyDeck, gradeCard, INTERVAL_DAYS, LEARNED_AFTER, originalAction,
  parseDeck, removeCard, RETRY_MINUTES, summarizeDeck, syncDeck, type ReviewDeck,
} from '../review/review';
import { replayOptions } from '../session/gradeAt';
import { gradeReplay } from '../session/import';
import { replayOf } from '../session/replay';
import { addHand, parseSaved, startNewSession, trimReplays, type HandRecord, type SavedSessions } from '../session/session';
import { makeRng, type Rng } from '../rng';

const opts = { lowStakes: true };
const NOW = new Date('2026-10-11T12:00:00.000Z');
const later = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

function randomAction(s: HandState, rng: Rng): Action {
  const l = legalActions(s);
  const options: Action[] = [];
  if (l.fold) options.push({ type: 'fold' });
  if (l.check) options.push({ type: 'check' });
  if (l.call !== null) options.push({ type: 'call' });
  const r = l.bet ?? l.raise;
  if (r) options.push({ type: l.bet ? 'bet' : 'raise', to: r.min + Math.floor(rng() * (r.max - r.min + 1)) });
  return options[Math.floor(rng() * options.length)];
}

/** Hands played with random hero actions (plenty of mistakes), graded the way imports are. */
function playedHands(n: number, seed: number, level: 3 | 4 = 3): Omit<HandRecord, 'n'>[] {
  const rng = makeRng(seed);
  const out: Omit<HandRecord, 'n'>[] = [];
  for (let i = 0; i < n; i++) {
    const g = practiceHand(level, rng, opts, []);
    let s = advance(g, g.state, rng, opts);
    while (heroDecides(g, s)) s = advance(g, applyAction(s, randomAction(s, rng)), rng, opts);
    const replay = replayOf(s, g.hero, g.villains, g.profiles);
    out.push({
      at: NOW.toISOString(), level, spot: `hand ${i}`, hand: '', net: 0, bb: s.config.bb, decided: true,
      decisions: gradeReplay(replay), lesson: '', replay,
    });
  }
  return out;
}

function savedWith(hands: Omit<HandRecord, 'n'>[]): SavedSessions {
  let saved = parseSaved(null, NOW);
  for (const h of hands) saved = addHand(saved, h);
  return saved;
}

const mistakesIn = (saved: SavedSessions) =>
  [saved.current, ...saved.past].flatMap((x) => x.hands.flatMap((h) => h.decisions.filter((d) => d.verdict === 'mistake' && d.step !== undefined)));

/** The trainer's best play at a card's spot, as an action. */
function bestAction(deck: ReviewDeck, i: number): { action: Action; s: HandState } {
  const card = deck.cards[i];
  const s = cardState(card);
  const res = gradeCard(card, s, originalAction(card));
  if (res.kind === 'preflop') return { action: choiceToAction(s, res.decision.spot, res.decision.best, 'hero', replayOptions(card.replay)), s };
  const o: HeroOption = res.analysis.best.option;
  return { action: (o.kind === 'bet' || o.kind === 'raise' ? { type: o.kind, to: o.to! } : { type: o.kind }) as Action, s };
}

describe('building the deck', () => {
  const saved = savedWith(playedHands(40, 3));

  it('adds a card for every saved mistake, once, with its own copy of the hand', () => {
    const deck = syncDeck(emptyDeck(), saved, NOW);
    expect(mistakesIn(saved).length).toBeGreaterThan(10);
    expect(deck.cards).toHaveLength(mistakesIn(saved).length);
    expect(new Set(deck.cards.map((c) => c.id)).size).toBe(deck.cards.length);
    expect(deck.cards.every((c) => c.box === 0 && c.due === NOW.toISOString())).toBe(true);
    // Syncing again changes nothing, and a hand whose replay was trimmed keeps its card.
    expect(syncDeck(deck, saved, later(5))).toBe(deck);
    expect(syncDeck(deck, trimReplays(saved, 0), later(5))).toBe(deck);
    expect(syncDeck(emptyDeck(), trimReplays(saved, 0), NOW).cards).toHaveLength(0);
  });

  it('picks up mistakes from past sessions and new hands without disturbing the schedule', () => {
    let deck = syncDeck(emptyDeck(), saved, NOW);
    const first = deck.cards[0].id;
    deck = answerCard(deck, first, 'correct', NOW);
    let next = startNewSession(saved, later(60));
    for (const h of playedHands(10, 99)) next = addHand(next, h);
    const grown = syncDeck(deck, next, later(60));
    expect(grown.cards.length).toBe(mistakesIn(next).length);
    expect(grown.cards.find((c) => c.id === first)).toEqual(deck.cards.find((c) => c.id === first));
  });

  it('keeps the deck to DECK_MAX cards, newest mistakes first, and never re-adds a removed card', () => {
    const big = savedWith(playedHands(260, 5));
    const deck = syncDeck(emptyDeck(), big, NOW);
    expect(mistakesIn(big).length).toBeGreaterThan(DECK_MAX);
    expect(deck.cards).toHaveLength(DECK_MAX);
    const n = (id: string) => Number(id.split(':')[1]);
    expect(Math.max(...deck.cards.map((c) => n(c.id)))).toBe(Math.max(...big.current.hands.filter((h) => h.decisions.some((d) => d.verdict === 'mistake')).map((h) => h.n)));
    const gone = removeCard(deck, deck.cards[0].id);
    expect(gone.cards).toHaveLength(DECK_MAX - 1);
    expect(gone.learned).toBe(0);
    const refilled = syncDeck(gone, big, NOW);
    expect(refilled.cards.some((c) => c.id === deck.cards[0].id)).toBe(false);
    expect(refilled.cards).toHaveLength(DECK_MAX);
  }, 60_000);
});

describe('dealing and grading a card', () => {
  const deck = syncDeck(emptyDeck(), savedWith([...playedHands(30, 11, 3), ...playedHands(30, 12, 4)]), NOW);

  it('deals exactly the spot that was played, with the hero to act', () => {
    for (const card of deck.cards) {
      const s = cardState(card);
      expect(s.toAct).toBe(card.replay.hero);
      expect(s.actions.filter((a) => a.type !== 'post')).toHaveLength(card.step);
      expect(canGrade(card, s)).toBe(true);
    }
  });

  it('grades the original play a mistake again and the best play correct', () => {
    let pre = 0, post = 0;
    deck.cards.forEach((card, i) => {
      const s = cardState(card);
      const again = gradeCard(card, s, originalAction(card));
      expect(again.verdict, card.id).toBe('mistake');
      if (again.kind === 'preflop') pre++; else post++;
      const best = bestAction(deck, i);
      expect(gradeCard(card, best.s, best.action).verdict, card.id).toBe('correct');
    });
    expect(pre).toBeGreaterThan(5);
    expect(post).toBeGreaterThan(5);
    // Grades every card twice with full equity work: about 3.5s locally, so give CI runners room.
  }, 60_000);

  it('gives full feedback, so the review panel matches the practice table', () => {
    for (const card of deck.cards.slice(0, 20)) {
      const res = gradeCard(card, cardState(card), originalAction(card));
      expect(res.feedback.bullets.length).toBeGreaterThan(0);
      expect(res.feedback.grade.heading).toBe(card.heading);
      if (res.kind === 'postflop') expect(res.concept.length).toBeGreaterThan(20);
      else expect(res.feedback.equity.hero).toBeGreaterThan(0);
    }
  });
});

describe('scheduling', () => {
  const base = syncDeck(emptyDeck(), savedWith(playedHands(15, 21)), NOW);
  const id = base.cards[0].id;

  it('moves up a box per correct answer with growing gaps, and is learned after the last box', () => {
    let deck = base;
    let t = NOW;
    for (let k = 1; k < LEARNED_AFTER; k++) {
      deck = answerCard(deck, id, 'correct', t);
      const c = deck.cards.find((x) => x.id === id)!;
      expect(c.box).toBe(k);
      expect(Date.parse(c.due) - t.getTime()).toBe(INTERVAL_DAYS[k] * 86_400_000);
      expect(dueCards(deck, t).some((x) => x.id === id)).toBe(false);
      t = new Date(c.due);
      expect(dueCards(deck, t).some((x) => x.id === id)).toBe(true);
    }
    deck = answerCard(deck, id, 'correct', t);
    expect(deck.cards.some((x) => x.id === id)).toBe(false);
    expect(deck.done).toContain(id);
    expect(deck.learned).toBe(1);
    expect(summarizeDeck(deck, t).learned).toBe(1);
  });

  it('sends a mistake back to the first box, due again in a few minutes', () => {
    let deck = answerCard(base, id, 'correct', NOW);
    deck = answerCard(deck, id, 'correct', later(24 * 60));
    deck = answerCard(deck, id, 'mistake', later(5 * 24 * 60));
    const c = deck.cards.find((x) => x.id === id)!;
    expect(c.box).toBe(0);
    expect(c.lapses).toBe(1);
    expect(c.reviews).toBe(3);
    expect(c.last).toBe('mistake');
    expect(Date.parse(c.due)).toBe(later(5 * 24 * 60 + RETRY_MINUTES).getTime());
  });

  it('keeps the box on a playable answer and brings it back a day later', () => {
    let deck = answerCard(base, id, 'correct', NOW);
    deck = answerCard(deck, id, 'playable', later(24 * 60));
    const c = deck.cards.find((x) => x.id === id)!;
    expect(c.box).toBe(1);
    expect(Date.parse(c.due)).toBe(later(2 * 24 * 60).getTime());
  });

  it('lists due cards most overdue first and summarizes the deck', () => {
    let deck = base;
    const [a, b] = deck.cards.map((c) => c.id);
    deck = answerCard(deck, a, 'mistake', NOW);
    deck = answerCard(deck, b, 'mistake', later(1));
    const due = dueCards(deck, later(60)).map((c) => c.id);
    expect(due.indexOf(a)).toBeLessThan(due.indexOf(b));
    expect(due.slice(-2)).toEqual([a, b]);
    const s = summarizeDeck(deck, later(2));
    expect(s.total).toBe(base.cards.length);
    expect(s.due).toBe(base.cards.length - 2);
    expect(s.nextDue).toBe(later(RETRY_MINUTES).toISOString());
    expect(s.boxes[0]).toBe(base.cards.length);
  });

  it('saves and reads back the deck, dropping malformed cards', () => {
    const deck = answerCard(base, id, 'correct', NOW);
    expect(parseDeck(JSON.stringify(deck))).toEqual(deck);
    const broken = { ...deck, cards: [...deck.cards, { id: 'x', step: 1, box: 0, due: 'soon' }, null] };
    expect(parseDeck(JSON.stringify(broken)).cards).toHaveLength(deck.cards.length);
    expect(parseDeck('nope')).toEqual(emptyDeck());
    expect(parseDeck(null)).toEqual(emptyDeck());
  });
});
