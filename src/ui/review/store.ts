// The mistake review deck, kept in localStorage and synced with the saved sessions, so a mistake
// made on the Play tab or in an imported hand becomes a card the next time the deck is read.

import { useEffect, useSyncExternalStore } from 'react';
import { answerCard, parseDeck, removeCard, syncDeck, type ReviewDeck } from '../../engine/review/review';
import type { Verdict } from '../../engine/session/session';
import { useSessions } from '../session/store';

const KEY = 'review-deck:v1';
let deck: ReviewDeck = load();
const listeners = new Set<() => void>();

function load(): ReviewDeck {
  try {
    return parseDeck(localStorage.getItem(KEY));
  } catch {
    return parseDeck(null);
  }
}

function set(next: ReviewDeck) {
  if (next === deck) return;
  deck = next;
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage unavailable: keep it in memory */ }
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** The deck, with any new saved mistakes added. */
export function useDeck(): ReviewDeck {
  const saved = useSessions();
  useEffect(() => set(syncDeck(deck, saved)), [saved]);
  return useSyncExternalStore(subscribe, () => deck);
}

export const answer = (id: string, verdict: Verdict) => set(answerCard(deck, id, verdict));
export const remove = (id: string) => set(removeCard(deck, id));
