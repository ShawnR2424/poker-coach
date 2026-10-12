// Backup and restore: everything the trainer saves in this browser, written to one JSON file and
// read back. Values are kept exactly as stored, so a restore puts back the same data each tab
// reads today. The Claude API key is never written to a backup.

import { parsePack } from '../preflop/chartPack';
import { parseDeck } from '../review/review';
import { parseHistory } from '../quiz/quiz';
import { parseSaved } from '../session/session';

export const BACKUP_APP = 'poker-coach';
export const BACKUP_VERSION = 1;

/** Every saved item a backup carries, in the order it is listed. */
export const BACKUP_KEYS = [
  'sessions:v1',
  'review-deck:v1',
  'quiz-history',
  'tournament:v1',
  'table:v1',
  'level',
  'focusLeaks',
  'adaptiveOpponents',
  'charts:v1',
  'custom-charts:v1',
  'equity:v1',
  'theme',
] as const;
export type BackupKey = (typeof BACKUP_KEYS)[number];

/** Kept out of backups: the coach voice settings hold the player's API key. */
export const EXCLUDED_KEYS = ['coach-voice:v1'] as const;

export interface Backup {
  app: typeof BACKUP_APP;
  v: typeof BACKUP_VERSION;
  savedAt: string;
  data: Partial<Record<BackupKey, string>>;
}

export interface BackupSummary {
  hands: number;
  sessions: number;
  reviewCards: number;
  quizzes: number;
  tournamentSpots: number;
  settings: number;
}

type Read = (key: string) => string | null;

export function makeBackup(read: Read, now = new Date()): Backup {
  const data: Backup['data'] = {};
  for (const k of BACKUP_KEYS) {
    const v = read(k);
    if (v !== null) data[k] = v;
  }
  return { app: BACKUP_APP, v: BACKUP_VERSION, savedAt: now.toISOString(), data };
}

export const backupText = (b: Backup) => JSON.stringify(b, null, 1);

export const backupFileName = (b: Backup) => `poker-coach-backup-${b.savedAt.slice(0, 10)}.json`;

/** Throws when a stored value is not what its tab would read. */
function checkValue(key: BackupKey, v: string) {
  const json = () => {
    try {
      return JSON.parse(v) as unknown;
    } catch {
      throw new Error(`The saved ${key} is not valid JSON`);
    }
  };
  switch (key) {
    case 'sessions:v1': {
      const d = json() as { version?: number; current?: { hands?: unknown }; past?: unknown };
      if (d?.version !== 1 || !Array.isArray(d.current?.hands) || !Array.isArray(d.past)) throw new Error('The saved sessions are not in a format this trainer reads');
      return;
    }
    case 'review-deck:v1': {
      const d = json() as { v?: number; cards?: unknown };
      if (d?.v !== 1 || !Array.isArray(d.cards)) throw new Error('The saved review deck is not in a format this trainer reads');
      return;
    }
    case 'quiz-history':
      if (!Array.isArray(json())) throw new Error('The saved quiz history is not a list');
      return;
    case 'level':
      if (!/^\d+$/.test(v)) throw new Error('The saved level is not a number');
      return;
    case 'focusLeaks':
    case 'adaptiveOpponents':
      if (v !== '0' && v !== '1') throw new Error(`The saved ${key} setting is not on or off`);
      return;
    case 'custom-charts:v1':
      try {
        parsePack(v);
      } catch (e) {
        throw new Error(`The saved imported charts do not check out: ${(e as Error).message}`);
      }
      return;
    case 'theme':
      if (!['light', 'dark', 'system'].includes(v)) throw new Error('The saved theme is not one the trainer offers');
      return;
    default: {
      const d = json();
      if (!d || typeof d !== 'object') throw new Error(`The saved ${key} is not a settings object`);
    }
  }
}

/** Reads a backup file, checking every value; throws a plain-language error on a bad file. */
export function parseBackup(text: string): Backup {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('This file is not a Poker Coach backup: it is not JSON');
  }
  const b = raw as Partial<Backup> | null;
  if (!b || typeof b !== 'object' || b.app !== BACKUP_APP) throw new Error('This file is not a Poker Coach backup');
  if (b.v !== BACKUP_VERSION) throw new Error(`This backup is version ${String(b.v)}; this trainer reads version ${BACKUP_VERSION}`);
  if (typeof b.savedAt !== 'string' || Number.isNaN(Date.parse(b.savedAt))) throw new Error('This backup has no valid date');
  if (!b.data || typeof b.data !== 'object') throw new Error('This backup has no saved data');
  const data: Backup['data'] = {};
  for (const k of BACKUP_KEYS) {
    const v = (b.data as Record<string, unknown>)[k];
    if (v === undefined) continue;
    if (typeof v !== 'string') throw new Error(`The saved ${k} is not text`);
    checkValue(k, v);
    data[k] = v;
  }
  return { app: BACKUP_APP, v: BACKUP_VERSION, savedAt: b.savedAt, data };
}

// Read directly rather than through the tournament module, which carries a large equity table.
function tournamentSpots(raw: string | undefined): number {
  const n = raw ? (JSON.parse(raw) as { tally?: { spots?: unknown } }).tally?.spots : 0;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : 0;
}

export function summarize(b: Backup): BackupSummary {
  const s = b.data['sessions:v1'] ? parseSaved(b.data['sessions:v1']) : null;
  const all = s ? [s.current, ...s.past] : [];
  return {
    hands: all.reduce((a, x) => a + x.hands.length, 0),
    sessions: all.filter((x) => x.hands.length > 0).length,
    reviewCards: parseDeck(b.data['review-deck:v1'] ?? null).cards.length,
    quizzes: parseHistory(b.data['quiz-history'] ?? null).length,
    tournamentSpots: tournamentSpots(b.data['tournament:v1']),
    settings: (['table:v1', 'level', 'focusLeaks', 'adaptiveOpponents', 'charts:v1', 'custom-charts:v1', 'equity:v1', 'theme'] as const).filter((k) => b.data[k] !== undefined).length,
  };
}

/**
 * Replaces this browser's saved data with the backup's: every item the backup carries is written
 * and every other backed-up item is cleared, so nothing from before is mixed in. The coach voice
 * settings are left as they are.
 */
export function restoreBackup(b: Backup, write: (key: string, value: string) => void, remove: (key: string) => void) {
  for (const k of BACKUP_KEYS) {
    const v = b.data[k];
    if (v === undefined) remove(k);
    else write(k, v);
  }
}
