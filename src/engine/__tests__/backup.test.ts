import { describe, expect, it } from 'vitest';
import { BACKUP_KEYS, backupFileName, backupText, makeBackup, parseBackup, restoreBackup, summarize } from '../backup/backup';
import { parseSaved } from '../session/session';

const now = new Date('2026-10-11T12:00:00Z');

function browser(entries: Record<string, string>) {
  const store = new Map(Object.entries(entries));
  return {
    store,
    read: (k: string) => store.get(k) ?? null,
    write: (k: string, v: string) => void store.set(k, v),
    remove: (k: string) => void store.delete(k),
  };
}

const sessions = () => {
  const s = parseSaved(null, now);
  const hand = { at: now.toISOString(), level: 3, result: 1.5, decisions: [] } as unknown as (typeof s.current.hands)[number];
  s.current.hands.push({ ...hand, n: 1 }, { ...hand, n: 2 });
  s.past.push({ id: 'old', startedAt: now.toISOString(), hands: [{ ...hand, n: 1 }] });
  return JSON.stringify(s);
};

const full = () => browser({
  'sessions:v1': sessions(),
  'review-deck:v1': JSON.stringify({ v: 1, cards: [], done: [], learned: 0 }),
  'quiz-history': JSON.stringify([{ at: now.toISOString(), kind: 'open', match: 0.8, best: 0.9, widthMiss: 0.1 }]),
  'tournament:v1': JSON.stringify({ options: { players: 9 }, tally: { v: 1, spots: 7, correct: 5, playable: 1, mistake: 1, lost: 0.4, icmMistakes: 0 } }),
  level: '4',
  focusLeaks: '0',
  theme: 'dark',
  'coach-voice:v1': JSON.stringify({ enabled: true, apiKey: 'sk-ant-secret' }),
});

describe('backup and restore', () => {
  it('saves every backed-up item exactly and never the API key', () => {
    const b = full();
    const backup = makeBackup(b.read, now);
    expect(backup.data['sessions:v1']).toBe(b.store.get('sessions:v1'));
    expect(backup.data.level).toBe('4');
    const text = backupText(backup);
    expect(text).not.toContain('sk-ant-secret');
    expect(text).not.toContain('coach-voice');
    expect(backupFileName(backup)).toBe('poker-coach-backup-2026-10-11.json');
  });

  it('round-trips into an empty browser and summarizes what it holds', () => {
    const backup = parseBackup(backupText(makeBackup(full().read, now)));
    const s = summarize(backup);
    expect(s).toEqual({ hands: 3, sessions: 2, reviewCards: 0, quizzes: 1, tournamentSpots: 7, settings: 3 });
    const fresh = browser({});
    restoreBackup(backup, fresh.write, fresh.remove);
    for (const k of BACKUP_KEYS) expect(fresh.store.get(k)).toBe(full().store.get(k));
  });

  it('replaces data rather than merging, and leaves the API key alone', () => {
    const backup = parseBackup(backupText(makeBackup(browser({ level: '2' }).read, now)));
    const target = full();
    restoreBackup(backup, target.write, target.remove);
    expect(target.store.get('level')).toBe('2');
    expect(target.store.has('sessions:v1')).toBe(false);
    expect(target.store.has('theme')).toBe(false);
    expect(target.store.get('coach-voice:v1')).toContain('sk-ant-secret');
  });

  it('rejects files that are not a usable backup', () => {
    const good = makeBackup(full().read, now);
    expect(() => parseBackup('not json')).toThrow(/not JSON/);
    expect(() => parseBackup(JSON.stringify({ hello: 1 }))).toThrow(/not a Poker Coach backup/);
    expect(() => parseBackup(JSON.stringify({ ...good, v: 2 }))).toThrow(/version 2/);
    expect(() => parseBackup(JSON.stringify({ ...good, data: { ...good.data, 'sessions:v1': '{"version":9}' } }))).toThrow(/sessions/);
    expect(() => parseBackup(JSON.stringify({ ...good, data: { ...good.data, level: 'four' } }))).toThrow(/level/);
    expect(() => parseBackup(JSON.stringify({ ...good, data: { ...good.data, theme: 'neon' } }))).toThrow(/theme/);
    expect(() => parseBackup(JSON.stringify({ ...good, data: { ...good.data, 'quiz-history': '{' } }))).toThrow(/JSON/);
  });

  it('ignores unknown items, including an API key added by hand', () => {
    const good = makeBackup(full().read, now);
    const b = parseBackup(JSON.stringify({ ...good, data: { ...good.data, 'coach-voice:v1': '{"apiKey":"x"}', other: 'y' } }));
    expect(Object.keys(b.data)).not.toContain('coach-voice:v1');
    expect(Object.keys(b.data)).not.toContain('other');
  });
});
