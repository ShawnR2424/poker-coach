// Backup and restore: save everything the trainer keeps in this browser to a file, and load it
// back on this device or another.

import { useState } from 'react';
import { backupFileName, backupText, makeBackup, parseBackup, restoreBackup, summarize, type Backup, type BackupSummary } from '../../engine/backup/backup';
import { useSessions } from '../session/store';

const read = (k: string) => {
  try { return localStorage.getItem(k); } catch { return null; }
};
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

function describe(s: BackupSummary): string {
  return `${plural(s.hands, 'hand')} in ${plural(s.sessions, 'session')}, ${plural(s.reviewCards, 'review card')}, ${plural(s.quizzes, 'quiz result')} and ${plural(s.tournamentSpots, 'tournament spot')}`;
}

export function BackupPanel() {
  useSessions(); // re-render as hands are saved, so the summary stays current
  const here = summarize(makeBackup(read));
  const [pending, setPending] = useState<{ backup: Backup; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const save = () => {
    const b = makeBackup(read);
    const url = URL.createObjectURL(new Blob([backupText(b)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = backupFileName(b);
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setSaved(a.download);
  };

  const choose = async (file: File | undefined) => {
    setPending(null);
    setError(null);
    if (!file) return;
    try {
      setPending({ backup: parseBackup(await file.text()), name: file.name });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const restore = () => {
    if (!pending) return;
    try {
      restoreBackup(pending.backup, (k, v) => localStorage.setItem(k, v), (k) => localStorage.removeItem(k));
    } catch {
      setError('This browser would not save the data. Its storage may be full or turned off.');
      return;
    }
    // Every tab reads its saved data when it starts, so a reload shows the restored data everywhere.
    location.reload();
  };

  return (
    <section className="panel backup" aria-labelledby="backup-h">
      <h2 id="backup-h">Back up your progress</h2>
      <p className="muted">
        The trainer keeps your hands, sessions, review cards, quiz results, tournament tally and settings in this browser only.
        Save a backup file to keep them safe or to move them to another device. Your Claude API key is never written to a backup.
      </p>
      <p id="backup-here">This browser holds {describe(here)}.</p>
      <div className="key-row">
        <button type="button" id="backup-save" className="primary" onClick={save}>Save a backup</button>
        {saved && <span className="small muted" role="status">Saved as {saved}.</span>}
      </div>
      <div className="backup-restore">
        <label htmlFor="backup-file">Restore from a backup file</label>
        <input id="backup-file" type="file" accept=".json,application/json" onChange={(e) => { void choose(e.target.files?.[0]); e.target.value = ''; }} />
      </div>
      {error && <p className="errors" role="alert">{error}</p>}
      {pending && (
        <div className="backup-confirm" role="group" aria-labelledby="backup-confirm-h">
          <p id="backup-confirm-h"><strong>{pending.name}</strong>, saved {new Date(pending.backup.savedAt).toLocaleString()}, holds {describe(summarize(pending.backup))}.</p>
          <p className="note">Restoring replaces everything saved in this browser with the backup. Save a backup of this browser first if you may want it back.</p>
          <div className="key-row">
            <button type="button" id="backup-restore" className="primary" onClick={restore}>Replace my data with this backup</button>
            <button type="button" onClick={() => setPending(null)}>Cancel</button>
          </div>
        </div>
      )}
    </section>
  );
}
