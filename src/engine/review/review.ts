// Mistake review: every decision graded a mistake becomes a card that deals the same spot again,
// from the saved hand, until it has been played correctly a few times with growing gaps.
//
// Scheduling is a Leitner box system. A new card starts in box 0 and is due at once. A correct
// answer moves it up a box and schedules it INTERVAL_DAYS of the new box later; the answer that
// would move it past the last box marks it learned. A mistake sends it back to box 0, due again
// a few minutes later in the same sitting. A playable answer keeps its box and comes back a day
// later: close, but not yet the play the card is teaching.

import { formatCards } from '../cards';
import { computeEquity } from '../equity';
import type { Action, HandState } from '../hand';
import { conceptFor, multiwayConcept, postflopFeedback, type PostflopFeedback } from '../postflop/coach';
import { gradePostflop, type Analysis, type DecisionBasics } from '../postflop/recommend';
import { blockerCount, heroDecision, opponentReads, playersBehind, preflopFeedback, type Decision, type Feedback } from '../preflop/coach';
import { hasChart, spotFor } from '../preflop/spot';
import { NUM_COMBOS } from '../range';
import { postflopSpotAt, replayOptions } from '../session/gradeAt';
import { replayStates, type HandReplay } from '../session/replay';
import type { SavedSessions, Session, Verdict } from '../session/session';

/** Days until a card is due again after a correct answer moves it into box 1, 2, 3, 4. */
export const INTERVAL_DAYS = [0, 1, 3, 7, 21] as const;
/** Correct answers in a row (one per box) that mark a card learned. */
export const LEARNED_AFTER = INTERVAL_DAYS.length;
/** Minutes until a card answered wrongly comes back. */
export const RETRY_MINUTES = 10;
/** Cards kept in the deck at once; the newest mistakes are added first. */
export const DECK_MAX = 150;

interface CardBase {
  id: string;
  /** The hand's spot, e.g. "BB vs BTN open", and where the decision was, e.g. "Flop Ts7d3c". */
  spot: string;
  label: string;
  hand: string;
  /** What was played the first time, and its heading. */
  you: string;
  heading: string;
  /** When the spot was played. */
  at: string;
  box: number;
  due: string;
  reviews: number;
  /** Times it was answered with a mistake in review. */
  lapses: number;
  last?: Verdict;
}

/** A decision from a saved hand on the Play tab or an imported hand. */
export interface HandCard extends CardBase {
  kind?: undefined;
  /** Ids are `${sessionId}:${hand number}:${step}`, unique per decision. */
  tags: string[];
  /** The practice level (0 for imported hands). */
  level: number;
  /** The saved hand, kept with the card so it outlives the session's replay limit. */
  replay: HandReplay;
  step: number;
}

/**
 * A push/fold, call or reshove spot from Tournament mode. The table is saved rather than its
 * ranges: the ranges are worked out again when the card is dealt, the same way as the first time.
 */
export interface TournamentCardSpot {
  kind: 'push' | 'call' | 'reshove';
  stacks: number[];
  ante: boolean;
  mode: 'chips' | 'final' | 'bubble';
  opener: number;
  hero: number;
  hand: [number, number];
  /** Whether the hero went all-in or called the first time (rather than folding). */
  played: boolean;
}

export interface TournamentCard extends CardBase {
  kind: 'tournament';
  /** `t:${time played}`. */
  t: TournamentCardSpot;
}

export type ReviewCard = HandCard | TournamentCard;

export const isTournamentCard = (c: ReviewCard): c is TournamentCard => c.kind === 'tournament';

export interface ReviewDeck {
  v: 1;
  cards: ReviewCard[];
  /** Ids of cards learned or removed, so syncing never adds them back. */
  done: string[];
  /** How many of `done` were learned (the rest were removed by hand). */
  learned: number;
}

export const emptyDeck = (): ReviewDeck => ({ v: 1, cards: [], done: [], learned: 0 });

const allSessions = (saved: SavedSessions): Session[] => [saved.current, ...saved.past];
const addMinutes = (now: Date, m: number) => new Date(now.getTime() + m * 60_000).toISOString();

/**
 * Adds a card for every saved mistake with a replay that is not in the deck yet, newest first,
 * while the deck has room. Existing cards keep their schedule.
 */
export function syncDeck(deck: ReviewDeck, saved: SavedSessions, now = new Date()): ReviewDeck {
  const have = new Set([...deck.cards.map((c) => c.id), ...deck.done]);
  const fresh: HandCard[] = [];
  for (const sess of allSessions(saved)) {
    for (const h of [...sess.hands].reverse()) {
      if (!h.replay) continue;
      for (const d of h.decisions) {
        if (d.verdict !== 'mistake' || d.step === undefined) continue;
        const id = `${sess.id}:${h.n}:${d.step}`;
        if (have.has(id)) continue;
        have.add(id);
        fresh.push({
          id, spot: h.spot, label: d.label, hand: d.hand, you: d.you, heading: d.heading, tags: d.tags, at: h.at, level: h.level,
          replay: h.replay, step: d.step, box: 0, due: now.toISOString(), reviews: 0, lapses: 0,
        });
      }
    }
  }
  const room = Math.max(0, DECK_MAX - deck.cards.length);
  if (!fresh.length || !room) return deck;
  return { ...deck, cards: [...deck.cards, ...fresh.slice(0, room)] };
}

export interface TournamentMistake {
  spot: TournamentCardSpot;
  /** e.g. "Bubble, 9 players". */
  where: string;
  /** e.g. "UTG raises to 2bb; folded to you in the CO". */
  label: string;
  hand: string;
  you: string;
  heading: string;
}

/** Adds a tournament mistake as a new card, due at once, while the deck has room. */
export function addTournamentCard(deck: ReviewDeck, m: TournamentMistake, now = new Date()): ReviewDeck {
  const id = `t:${now.toISOString()}`;
  if (deck.cards.length >= DECK_MAX || deck.cards.some((c) => c.id === id) || deck.done.includes(id)) return deck;
  const card: TournamentCard = {
    kind: 'tournament', id, spot: m.where, label: m.label, hand: m.hand, you: m.you, heading: m.heading, at: now.toISOString(),
    t: m.spot, box: 0, due: now.toISOString(), reviews: 0, lapses: 0,
  };
  return { ...deck, cards: [...deck.cards, card] };
}

/** Schedules a card after an answer. Returns the deck with the card moved, or retired once learned. */
export function answerCard(deck: ReviewDeck, id: string, verdict: Verdict, now = new Date()): ReviewDeck {
  const card = deck.cards.find((c) => c.id === id);
  if (!card) return deck;
  const base = { ...card, reviews: card.reviews + 1, last: verdict };
  if (verdict === 'correct' && card.box + 1 >= LEARNED_AFTER) {
    return { ...deck, cards: deck.cards.filter((c) => c.id !== id), done: [...deck.done, id], learned: deck.learned + 1 };
  }
  const next: ReviewCard =
    verdict === 'correct' ? { ...base, box: card.box + 1, due: addMinutes(now, INTERVAL_DAYS[card.box + 1] * 24 * 60) }
      : verdict === 'playable' ? { ...base, due: addMinutes(now, 24 * 60) }
        : { ...base, box: 0, lapses: card.lapses + 1, due: addMinutes(now, RETRY_MINUTES) };
  return { ...deck, cards: deck.cards.map((c) => (c.id === id ? next : c)) };
}

/** Takes a card out of the deck for good (a spot the player no longer wants to see). */
export function removeCard(deck: ReviewDeck, id: string): ReviewDeck {
  if (!deck.cards.some((c) => c.id === id)) return deck;
  return { ...deck, cards: deck.cards.filter((c) => c.id !== id), done: [...deck.done, id] };
}

/** Cards due now, the most overdue first. */
export function dueCards(deck: ReviewDeck, now = new Date()): ReviewCard[] {
  const t = now.getTime();
  return deck.cards.filter((c) => Date.parse(c.due) <= t).sort((a, b) => Date.parse(a.due) - Date.parse(b.due) || (a.id < b.id ? -1 : 1));
}

export interface DeckSummary {
  due: number;
  /** Cards in the deck, due or not. */
  total: number;
  learned: number;
  /** Cards per box. */
  boxes: number[];
  /** When the next card not yet due comes up, if any. */
  nextDue: string | null;
}

export function summarizeDeck(deck: ReviewDeck, now = new Date()): DeckSummary {
  const t = now.getTime();
  const boxes = INTERVAL_DAYS.map(() => 0);
  let due = 0;
  let nextDue: number | null = null;
  for (const c of deck.cards) {
    boxes[Math.min(c.box, boxes.length - 1)]++;
    const d = Date.parse(c.due);
    if (d <= t) due++;
    else if (nextDue === null || d < nextDue) nextDue = d;
  }
  return { due, total: deck.cards.length, learned: deck.learned, boxes, nextDue: nextDue === null ? null : new Date(nextDue).toISOString() };
}

function validSpot(t: TournamentCardSpot | undefined): boolean {
  if (!t || !['push', 'call', 'reshove'].includes(t.kind) || !['chips', 'final', 'bubble'].includes(t.mode)) return false;
  const n = Array.isArray(t.stacks) ? t.stacks.length : 0;
  const seat = (x: unknown) => Number.isInteger(x) && (x as number) >= 0 && (x as number) < n;
  return (n === 6 || n === 9) && t.stacks.every((x) => typeof x === 'number' && x > 0) && seat(t.opener) && seat(t.hero)
    && Array.isArray(t.hand) && t.hand.length === 2 && t.hand.every((c) => Number.isInteger(c) && c >= 0 && c < 52) && t.hand[0] !== t.hand[1]
    && typeof t.played === 'boolean';
}

/** Reads a saved deck, dropping anything malformed. */
export function parseDeck(raw: string | null): ReviewDeck {
  if (!raw) return emptyDeck();
  try {
    const d = JSON.parse(raw) as ReviewDeck;
    if (!d || d.v !== 1 || !Array.isArray(d.cards) || !Array.isArray(d.done)) return emptyDeck();
    const cards = d.cards.filter((c) =>
      c && typeof c.id === 'string' && typeof c.box === 'number' && typeof c.due === 'string' && !Number.isNaN(Date.parse(c.due))
      && (isTournamentCard(c) ? validSpot(c.t) : typeof c.step === 'number' && c.replay && c.replay.v === 1 && Array.isArray(c.replay.actions)));
    return { v: 1, cards, done: d.done.filter((x) => typeof x === 'string'), learned: Number.isFinite(d.learned) ? d.learned : 0 };
  } catch {
    return emptyDeck();
  }
}

// ---- Dealing and grading a card ----

/** The table as the hero saw it at the card's decision. Throws when the saved hand no longer replays. */
export function cardState(card: HandCard): HandState {
  const states = replayStates(card.replay);
  const s = states[card.step];
  if (!s || s.toAct !== card.replay.hero) throw new Error('The saved hand does not reach this decision');
  return s;
}

export type CardResult =
  | { kind: 'preflop'; verdict: Verdict; decision: Decision; feedback: Feedback }
  | { kind: 'postflop'; verdict: Verdict; sit: DecisionBasics; analysis: Analysis; feedback: PostflopFeedback; concept: string; multiway: boolean };

/** Whether the trainer can grade this card's spot today (the charts or model may have changed). */
export function canGrade(card: HandCard, s: HandState): boolean {
  if (s.street === 'preflop') return hasChart(spotFor(s, card.replay.hero));
  return postflopSpotAt(card.replay, s, card.step) !== null;
}

/** Grades an answer to a card with the same charts, ranges and model as the practice table. */
export function gradeCard(card: HandCard, s: HandState, action: Action): CardResult {
  const r = card.replay;
  const hero = r.hero;
  if (s.street === 'preflop') {
    const opts = replayOptions(r);
    const decision = heroDecision(s, hero, opts);
    const live = new Set(r.villains.filter((v) => !s.players[v].folded));
    const hypothetical = decision.spot.kind === 'rfi';
    const all = hypothetical ? playersBehind(s, hero, opts) : opponentReads(s, hero, opts);
    const reads = r.villains.length ? all.filter((x) => live.has(x.seat)) : all;
    const villains = !reads.length ? [new Float32Array(NUM_COMBOS).fill(1)] : hypothetical ? [reads[0].range] : reads.map((x) => x.range);
    const heroCards = s.players[hero].hole;
    const eq = computeEquity({ hero: heroCards, board: s.board, villains, iterations: 6000, seed: 1 }).equity;
    const blocker = reads.length && !hypothetical ? blockerCount(reads[0].range, heroCards) : null;
    const feedback = preflopFeedback(s, hero, decision, action, eq, blocker);
    return { kind: 'preflop', verdict: feedback.grade.verdict, decision, feedback };
  }
  const at = postflopSpotAt(r, s, card.step);
  if (!at) throw new Error(`No read for ${formatCards(s.board)}`);
  const grade = gradePostflop(at.sit, at.analysis, action);
  const feedback = postflopFeedback(at.sit, at.analysis, grade, [], [], { multiway: at.multiway });
  const concept = at.multiway ? multiwayConcept(at.analysis) : conceptFor(at.sit, at.analysis);
  return { kind: 'postflop', verdict: grade.verdict, sit: at.sit, analysis: at.analysis, feedback, concept, multiway: at.multiway };
}

/** The action the hero took at the card's decision the first time. */
export function originalAction(card: HandCard): Action {
  const [, type, to] = card.replay.actions[card.step];
  return (type === 'bet' || type === 'raise' ? { type, to: to! } : { type }) as Action;
}
