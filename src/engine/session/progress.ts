// Progress across saved sessions: how the mistake rate, the postflop EV given up and each leak
// change over time. Pure functions over the saved sessions, oldest first.

import { leakStats, type HandRecord, type SavedSessions, type Session } from './session';

/** Saved sessions in the order they were played, the current one last (empty ones left out). */
export function sessionsInOrder(saved: SavedSessions): Session[] {
  return [...saved.past].reverse().concat(saved.current).filter((s) => s.hands.length > 0);
}

export interface SessionSummary {
  id: string;
  startedAt: string;
  hands: number;
  decisions: number;
  mistakes: number;
  /** Share of graded decisions that were mistakes (null with no graded decisions). */
  mistakeRate: number | null;
  /** Postflop decisions that recorded the EV given up. */
  measured: number;
  /** Big blinds of EV given up at postflop decisions per 100 hands (null when none were measured). */
  evLostPer100: number | null;
}

export function summarize(s: Session): SessionSummary {
  let decisions = 0, mistakes = 0, measured = 0, lost = 0;
  for (const h of s.hands) {
    for (const d of h.decisions) {
      decisions++;
      if (d.verdict === 'mistake') mistakes++;
      if (d.lossBB !== undefined) {
        measured++;
        lost += d.lossBB;
      }
    }
  }
  // Per 100 hands from the first hand that recorded it, so hands saved before the trainer
  // recorded the EV given up do not dilute the rate.
  const first = s.hands.findIndex((h) => h.decisions.some((d) => d.lossBB !== undefined));
  const measuredHands = first < 0 ? 0 : s.hands.length - first;
  return {
    id: s.id,
    startedAt: s.startedAt,
    hands: s.hands.length,
    decisions,
    mistakes,
    mistakeRate: decisions ? mistakes / decisions : null,
    measured,
    evLostPer100: measured ? (lost / Math.max(1, measuredHands)) * 100 : null,
  };
}

export interface TrendPoint {
  /** Hand number counted across all sessions, from 1. */
  hand: number;
  /** Index into the sessions the point belongs to. */
  session: number;
  /** Share of mistakes over the latest `window` graded decisions. */
  rate: number;
  /** Decisions the rate is over (fewer than `window` early on). */
  over: number;
}

export const TREND_WINDOW = 50;
/** Decisions needed before the trend starts, so the first few do not swing it wildly. */
export const TREND_MIN = 20;

/** The rolling mistake rate after each hand, across sessions in order. */
export function mistakeTrend(sessions: readonly Session[], window = TREND_WINDOW, min = TREND_MIN): TrendPoint[] {
  const recent: boolean[] = [];
  const out: TrendPoint[] = [];
  let hand = 0;
  sessions.forEach((s, si) => {
    for (const h of s.hands) {
      hand++;
      for (const d of h.decisions) {
        recent.push(d.verdict === 'mistake');
        if (recent.length > window) recent.shift();
      }
      if (recent.length >= min && h.decisions.length) {
        out.push({ hand, session: si, rate: recent.filter(Boolean).length / recent.length, over: recent.length });
      }
    }
  });
  return out;
}

export interface LeakRow {
  tag: string;
  total: number;
  /** Whether the leak is currently marked fixed, judged over all sessions in order. */
  fixed: boolean;
  /** Per session: times it showed up, and per 100 graded decisions. */
  bySession: { count: number; per100: number | null }[];
}

/** The `top` most frequent leaks over all sessions, with how often each showed up in each session. */
export function leakTrend(sessions: readonly Session[], top = 6): LeakRow[] {
  const all: HandRecord[] = sessions.flatMap((s) => s.hands).map((h, i) => ({ ...h, n: i + 1 }));
  const stats = leakStats(all);
  const decisions = sessions.map((s) => s.hands.reduce((a, h) => a + h.decisions.length, 0));
  return [...stats]
    .sort((a, b) => b.count - a.count || b.lastHand - a.lastHand)
    .slice(0, top)
    .map((st) => ({
      tag: st.tag,
      total: st.count,
      fixed: st.fixed,
      bySession: sessions.map((s, i) => {
        const count = s.hands.reduce((a, h) => a + h.decisions.filter((d) => d.tags.includes(st.tag)).length, 0);
        return { count, per100: decisions[i] ? (count / decisions[i]) * 100 : null };
      }),
    }));
}
