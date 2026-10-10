// The session tracker: every finished hand with its decisions, running profit and loss,
// leak counts, and "leaks fixed" tracking. Pure functions over plain data, so the same
// records can be saved to localStorage and read back.

import type { PostflopMove } from './adapt';
import type { HandReplay } from './replay';

export type Verdict = 'correct' | 'playable' | 'mistake';

export interface DecisionRecord {
  /** Where the decision was, e.g. "BTN first in" or "Flop Ts7d3c". */
  label: string;
  /** Hero cards, e.g. "AhKd". */
  hand: string;
  /** What the hero did, in a few words. */
  you: string;
  verdict: Verdict;
  heading: string;
  /** Leaks this decision showed (empty when it was played well). */
  tags: string[];
  /** Leaks a wrong action could have shown here: the chance to prove a leak is fixed. */
  atRisk: string[];
  /** Actions taken before this decision, not counting the blinds: its step in the replay. */
  step?: number;
  /** The hero's action at a postflop decision, which adaptive opponents learn from. */
  move?: PostflopMove;
  /** The trainer's best action at that decision, which the hero's moves are compared with. */
  bestMove?: PostflopMove;
}

export interface HandRecord {
  /** Hand number in the session, from 1. */
  n: number;
  at: string;
  level: number;
  /** The spot the hand was about, e.g. "BB vs BTN open". */
  spot: string;
  hand: string;
  /** Hero's net result in chips; 0 for a hand that stopped before it was decided. */
  net: number;
  bb: number;
  /** False when the hand stopped early (level 1 stops at the flop) with the hero still in. */
  decided: boolean;
  decisions: DecisionRecord[];
  lesson: string;
  /** Everything needed to step through the hand again (hands saved before replays existed have none). */
  replay?: HandReplay;
}

export interface Session {
  id: string;
  startedAt: string;
  hands: HandRecord[];
}

export interface Totals {
  hands: number;
  net: number;
  /** Net in big blinds. */
  netBB: number;
  /** Big blinds won per 100 hands (null under 10 hands, where it means little). */
  bbPer100: number | null;
  decisions: number;
  verdicts: Record<Verdict, number>;
}

export function newSession(now = new Date()): Session {
  return { id: `s${now.getTime().toString(36)}`, startedAt: now.toISOString(), hands: [] };
}

export function totals(hands: readonly HandRecord[]): Totals {
  const verdicts: Record<Verdict, number> = { correct: 0, playable: 0, mistake: 0 };
  let net = 0, netBB = 0, decisions = 0;
  for (const h of hands) {
    net += h.net;
    netBB += h.net / h.bb;
    for (const d of h.decisions) {
      verdicts[d.verdict]++;
      decisions++;
    }
  }
  return { hands: hands.length, net, netBB, bbPer100: hands.length >= 10 ? (netBB / hands.length) * 100 : null, decisions, verdicts };
}

export interface LeakStat {
  tag: string;
  /** Times the leak showed up. */
  count: number;
  /** Hand number where it last showed up. */
  lastHand: number;
  /** Spots where the leak was possible and the hero played them right, since it last showed up. */
  correctSince: number;
  /** True once the leak was played right after its latest appearance. */
  fixed: boolean;
}

/**
 * Leak counts in order of play. A leak is marked fixed when, after it last showed up, the hero
 * meets a spot where that same leak was possible and plays it without a mistake. It reopens if
 * it shows up again.
 */
export function leakStats(hands: readonly HandRecord[]): LeakStat[] {
  const map = new Map<string, LeakStat>();
  for (const h of hands) {
    for (const d of h.decisions) {
      for (const tag of d.tags) {
        const s = map.get(tag) ?? { tag, count: 0, lastHand: 0, correctSince: 0, fixed: false };
        s.count++;
        s.lastHand = h.n;
        s.correctSince = 0;
        s.fixed = false;
        map.set(tag, s);
      }
      if (d.verdict === 'mistake') continue;
      for (const tag of d.atRisk) {
        const s = map.get(tag);
        if (!s || d.tags.includes(tag)) continue;
        s.correctSince++;
        s.fixed = true;
      }
    }
  }
  return [...map.values()].sort((a, b) => Number(a.fixed) - Number(b.fixed) || b.count - a.count || b.lastHand - a.lastHand);
}

/** Open leaks, most frequent first, as weights for leak-targeted practice. */
export function openLeaks(hands: readonly HandRecord[]): { tag: string; weight: number }[] {
  return leakStats(hands).filter((s) => !s.fixed).map((s) => ({ tag: s.tag, weight: s.count }));
}

/** One line to remember from a hand. */
export function handLesson(decisions: readonly DecisionRecord[], net: number, decided: boolean): string {
  const mistake = decisions.find((d) => d.verdict === 'mistake');
  if (mistake) {
    return `${mistake.label} with ${mistake.hand}: ${mistake.heading.toLowerCase()}.${mistake.tags[0] ? ` Leak to watch: ${mistake.tags[0]}.` : ''}`;
  }
  if (!decisions.length) return 'No graded decisions.';
  if (decided && net < 0) return 'Lost chips with sound decisions. Judge the decision, not the result.';
  const playable = decisions.find((d) => d.verdict === 'playable');
  if (playable) return `${playable.label}: ${playable.heading.toLowerCase()}.`;
  return 'No mistakes this hand.';
}

/** Graded decisions at a level, latest last. */
function decisionsAt(hands: readonly HandRecord[], level: number): DecisionRecord[] {
  return hands.filter((h) => h.level === level).flatMap((h) => h.decisions);
}

export const ADVANCE_WINDOW = 20;
export const ADVANCE_SHARE = 0.7;

/**
 * Curriculum progress at a level: share of the last 20 decisions there without a mistake.
 * Ready to move up once 20 decisions are in and at least 70% were correct or playable.
 */
export function levelProgress(hands: readonly HandRecord[], level: number): { recent: number; good: number; ready: boolean } {
  const recent = decisionsAt(hands, level).slice(-ADVANCE_WINDOW);
  const good = recent.filter((d) => d.verdict !== 'mistake').length;
  return { recent: recent.length, good, ready: recent.length >= ADVANCE_WINDOW && good / recent.length >= ADVANCE_SHARE };
}

// ---- Persistence ----

export interface SavedSessions {
  version: 1;
  current: Session;
  /** Earlier sessions, newest first. */
  past: Session[];
}

export const MAX_PAST = 20;
/**
 * Hands that keep their replay record, newest first across sessions. A record is about 1-2 KB,
 * so this keeps the saved data well inside the browser's storage quota; older hands keep their
 * row and lesson but can no longer be replayed.
 */
export const MAX_REPLAYS = 500;

/** Parses saved data, falling back to a fresh session when it is missing or unreadable. */
export function parseSaved(raw: string | null, now = new Date()): SavedSessions {
  if (raw) {
    try {
      const d = JSON.parse(raw) as SavedSessions;
      if (d && d.version === 1 && d.current && Array.isArray(d.current.hands) && Array.isArray(d.past)) return d;
    } catch {
      /* fall through to a fresh session */
    }
  }
  return { version: 1, current: newSession(now), past: [] };
}

export function addHand(saved: SavedSessions, hand: Omit<HandRecord, 'n'>): SavedSessions {
  const n = saved.current.hands.length + 1;
  return trimReplays({ ...saved, current: { ...saved.current, hands: [...saved.current.hands, { ...hand, n }] } });
}

/** Drops the replay records of all but the newest MAX_REPLAYS hands. */
export function trimReplays(saved: SavedSessions, max = MAX_REPLAYS): SavedSessions {
  let kept = 0;
  const trim = (x: Session): Session => {
    let changed = false;
    const hands = [...x.hands].reverse().map((h) => {
      if (!h.replay) return h;
      if (kept++ < max) return h;
      changed = true;
      return { ...h, replay: undefined };
    }).reverse();
    return changed ? { ...x, hands } : x;
  };
  const current = trim(saved.current);
  const past = saved.past.map(trim);
  return current === saved.current && past.every((x, i) => x === saved.past[i]) ? saved : { ...saved, current, past };
}

/** Archives the current session (if it has hands) and starts a new one. */
export function startNewSession(saved: SavedSessions, now = new Date()): SavedSessions {
  const past = saved.current.hands.length ? [saved.current, ...saved.past].slice(0, MAX_PAST) : saved.past;
  return { version: 1, current: newSession(now), past };
}
