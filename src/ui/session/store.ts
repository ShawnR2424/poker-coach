// The saved sessions, shared by Play and the Session tab, kept in localStorage.

import { useSyncExternalStore } from 'react';
import { addHand, addHands, parseSaved, startNewSession, type HandRecord, type SavedSessions } from '../../engine/session/session';

const KEY = 'sessions:v1';
let saved: SavedSessions = load();
const listeners = new Set<() => void>();

function load(): SavedSessions {
  try {
    return parseSaved(localStorage.getItem(KEY));
  } catch {
    return parseSaved(null);
  }
}

function set(next: SavedSessions) {
  saved = next;
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage unavailable: keep it in memory */ }
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useSessions(): SavedSessions {
  return useSyncExternalStore(subscribe, () => saved);
}

export const recordHand = (h: Omit<HandRecord, 'n'>) => set(addHand(saved, h));
export const recordHands = (hs: Omit<HandRecord, 'n'>[], asNew: boolean) => set(addHands(saved, hs, asNew));
export const newSession = () => set(startNewSession(saved));
export const currentHands = () => saved.current.hands;
