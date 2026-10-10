// Import real hands: paste hand histories (or open a saved .txt), see each hand graded with the
// trainer's models, then save them as a session. Saved hands get the Session tab's verdicts,
// leaks and replays, and their leaks steer "Practice my leaks" on the Play tab.

import { useRef, useState } from 'react';
import { importBlock, splitHands, type ImportedHand, type SkippedHand } from '../../engine/session/import';
import { SAMPLE_HANDS } from '../../engine/session/sampleHands';
import { leakStats, totals } from '../../engine/session/session';
import { dollars } from '../table/format';
import { recordHands } from './store';
import './session.css';

const ICON = { correct: '✅', playable: '👍', mistake: '⚠️' } as const;
const sign = (x: number) => (x > 0 ? '+' : x < 0 ? '−' : '');
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '–');

type Stage =
  | { kind: 'idle' }
  | { kind: 'reading'; done: number; of: number }
  | { kind: 'read'; hands: ImportedHand[]; skipped: SkippedHand[] }
  | { kind: 'saved'; count: number; asNew: boolean };

export function ImportScreen() {
  const [text, setText] = useState('');
  const [stage, setStage] = useState<Stage>({ kind: 'idle' });
  const run = useRef(0);

  const read = async (source: string) => {
    const blocks = splitHands(source);
    const id = ++run.current;
    const hands: ImportedHand[] = [];
    const skipped: SkippedHand[] = [];
    const at = new Date().toISOString();
    setStage({ kind: 'reading', done: 0, of: blocks.length });
    for (let i = 0; i < blocks.length; i++) {
      // Grade one hand per tick so the page stays responsive on long files.
      await new Promise((r) => setTimeout(r, 0));
      if (run.current !== id) return;
      const r = importBlock(blocks[i], at);
      if ('hand' in r) hands.push(r.hand);
      else skipped.push(r.skipped);
      setStage({ kind: 'reading', done: i + 1, of: blocks.length });
    }
    setStage({ kind: 'read', hands, skipped });
  };

  const openFile = (f: File | undefined) => {
    if (!f) return;
    f.text().then((t) => setText(t)).catch(() => setText(''));
  };

  const save = (asNew: boolean) => {
    if (stage.kind !== 'read') return;
    recordHands(stage.hands.map((h) => h.record), asNew);
    setStage({ kind: 'saved', count: stage.hands.length, asNew });
    setText('');
  };

  const found = text.trim() ? splitHands(text).length : 0;

  return (
    <div className="screen import-screen">
      <div>
        <p className="eyebrow">Your own hands</p>
        <h1>Import hand histories</h1>
      </div>

      <section className="panel" aria-labelledby="paste-h">
        <h2 id="paste-h">Paste or open hand histories</h2>
        <p className="small measure">
          Paste hands as your poker site writes them (PokerStars and GGPoker text, one hand after another), or open a saved .txt file.
          The trainer reads no-limit hold'em cash hands with 3 to 9 players and grades each of your decisions with the same charts and
          postflop model as the Play tab. Everything stays in this browser.
        </p>
        <label htmlFor="hh-text" className="sr-only">Hand histories</label>
        <textarea
          id="hh-text"
          className="hh-text"
          rows={10}
          spellCheck={false}
          placeholder={"PokerStars Hand #250000000001:  Hold'em No Limit ($0.25/$0.50 USD) …"}
          value={text}
          onChange={(e) => { setText(e.target.value); if (stage.kind !== 'reading') setStage({ kind: 'idle' }); }}
        />
        <div className="import-actions">
          <button type="button" className="primary" disabled={!found || stage.kind === 'reading'} onClick={() => read(text)}>
            Grade {found ? `${found} hand${found === 1 ? '' : 's'}` : 'hands'}
          </button>
          <label className="file-pick">
            <span>Open a file</span>
            <input type="file" accept=".txt,text/plain" onChange={(e) => openFile(e.target.files?.[0])} />
          </label>
          <button type="button" onClick={() => { setText(SAMPLE_HANDS); setStage({ kind: 'idle' }); }}>Try sample hands</button>
          {text.trim() && !found && <span className="muted small">No hand headers found. Each hand should start with a line like "PokerStars Hand #…".</span>}
        </div>
        {stage.kind === 'reading' && <p className="small num" role="status">Grading hand {stage.done} of {stage.of}…</p>}
        {stage.kind === 'saved' && (
          <p className="small" role="status">
            Saved {stage.count} hand{stage.count === 1 ? '' : 's'} {stage.asNew ? 'as a new session' : 'to this session'}. <a href="#session">Open the Session tab</a> to see the leaks and replay each hand.
          </p>
        )}
      </section>

      {stage.kind === 'read' && <ImportPreview hands={stage.hands} skipped={stage.skipped} onSave={save} />}
    </div>
  );
}

function ImportPreview({ hands, skipped, onSave }: { hands: ImportedHand[]; skipped: SkippedHand[]; onSave: (asNew: boolean) => void }) {
  const records = hands.map((h, i) => ({ ...h.record, n: i + 1 }));
  const t = totals(records);
  const leaks = leakStats(records).slice(0, 5);
  return (
    <section className="panel" aria-labelledby="preview-h">
      <h2 id="preview-h">{hands.length} hand{hands.length === 1 ? '' : 's'} graded{skipped.length ? `, ${skipped.length} skipped` : ''}</h2>
      {hands.length > 0 && (
        <>
          <p className="small num">
            {t.decisions} decisions: ✅ {pct(t.verdicts.correct, t.decisions)} · 👍 {pct(t.verdicts.playable, t.decisions)} · ⚠️ {pct(t.verdicts.mistake, t.decisions)}.
            Result {sign(t.net)}{dollars(Math.abs(t.net))} after rake.
          </p>
          {leaks.length > 0 && <p className="small">Most frequent leaks: {leaks.map((l) => `${l.tag} (${l.count})`).join(', ')}.</p>}
          <div className="table-scroll">
            <table className="data hands">
              <thead>
                <tr><th scope="col">Hand</th><th scope="col">Spot</th><th scope="col">Cards</th><th scope="col">Verdicts</th><th scope="col" className="n">Result</th><th scope="col">Lesson</th></tr>
              </thead>
              <tbody>
                {hands.map((h) => (
                  <tr key={h.id}>
                    <td className="num small">#{h.id}</td>
                    <td>{h.record.spot}</td>
                    <td className="num">{h.record.hand}</td>
                    <td className="verdicts" aria-label={h.record.decisions.map((d) => d.verdict).join(', ') || 'none'}>
                      {h.record.decisions.map((d, i) => <span key={i} title={`${d.label}: ${d.heading}`}>{ICON[d.verdict]}</span>)}
                      {!h.record.decisions.length && <span className="muted">–</span>}
                    </td>
                    <td className={`n num ${h.record.net > 0 ? 'up' : h.record.net < 0 ? 'down' : ''}`}>{sign(h.record.net)}{dollars(Math.abs(h.record.net))}</td>
                    <td className="lesson">{h.record.lesson}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="import-actions">
            <button type="button" className="primary" onClick={() => onSave(true)}>Save as a new session</button>
            <button type="button" onClick={() => onSave(false)}>Add to this session</button>
          </div>
        </>
      )}
      {skipped.length > 0 && (
        <details className="skipped" open={!hands.length}>
          <summary>Skipped hands</summary>
          <ul className="small">
            {skipped.map((s, i) => <li key={i}><span className="num">#{s.id}</span>: {s.reason}.</li>)}
          </ul>
        </details>
      )}
    </section>
  );
}
