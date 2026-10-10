// Session review: running profit and loss, every hand with its lesson, and leaks with
// "fixed" tracking, then progress across sessions. Earlier sessions stay available to look back at.

import { useState } from 'react';
import { IMPORTED_LEVEL } from '../../engine/session/import';
import { ADAPT, ADJUSTMENT_SHORT, adaptationFor, heroTendencies, type Rate } from '../../engine/session/adapt';
import { leakStats, totals, type Session } from '../../engine/session/session';
import { LEVELS, type LevelId } from '../../engine/game/levels';
import { dollars } from '../table/format';
import { ProgressPanel } from './ProgressPanel';
import { ReplayView } from './ReplayView';
import { newSession, useSessions } from './store';
import './session.css';

const ICON = { correct: '✅', playable: '👍', mistake: '⚠️' } as const;
const sign = (x: number) => (x > 0 ? '+' : x < 0 ? '−' : '');
const money = (chips: number) => `${sign(chips)}${dollars(Math.abs(chips))}`;
const bbText = (x: number) => `${sign(x)}${Math.abs(x).toFixed(1)}bb`;
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '–');

export function SessionScreen() {
  const saved = useSessions();
  const [viewId, setViewId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const all = [saved.current, ...saved.past];
  const session = all.find((s) => s.id === viewId) ?? saved.current;
  const isCurrent = session.id === saved.current.id;

  return (
    <div className="screen session-screen">
      <div className="session-head">
        <div>
          <p className="eyebrow">{isCurrent ? 'This session' : 'Earlier session'}</p>
          <h1>Started {when(session.startedAt)}</h1>
        </div>
        <div className="session-actions">
          {!isCurrent && <button type="button" onClick={() => setViewId(null)}>Back to this session</button>}
          {isCurrent && !confirming && (
            <button type="button" onClick={() => setConfirming(true)} disabled={!session.hands.length}>Start a new session</button>
          )}
          {isCurrent && confirming && (
            <span className="confirm">
              Save this session and start fresh?
              <button type="button" className="primary" onClick={() => { newSession(); setConfirming(false); }}>Yes, start new</button>
              <button type="button" onClick={() => setConfirming(false)}>Cancel</button>
            </span>
          )}
        </div>
      </div>
      <SessionView session={session} />
      <ProgressPanel saved={saved} />
      {saved.past.length > 0 && (
        <section className="panel" aria-labelledby="past-h">
          <h2 id="past-h">Earlier sessions</h2>
          <div className="table-scroll">
            <table className="data">
              <thead>
                <tr><th scope="col">Started</th><th scope="col" className="n">Hands</th><th scope="col" className="n">Result</th><th scope="col" className="n">Open leaks</th><th scope="col"><span className="sr-only">View</span></th></tr>
              </thead>
              <tbody>
                {saved.past.map((s) => {
                  const t = totals(s.hands);
                  return (
                    <tr key={s.id} className={s.id === session.id ? 'on' : ''}>
                      <td>{when(s.startedAt)}</td>
                      <td className="n num">{t.hands}</td>
                      <td className={`n num ${t.net > 0 ? 'up' : t.net < 0 ? 'down' : ''}`}>{money(t.net)} <span className="muted">({bbText(t.netBB)})</span></td>
                      <td className="n num">{leakStats(s.hands).filter((l) => !l.fixed).length}</td>
                      <td><button type="button" onClick={() => { setViewId(s.id); window.scrollTo({ top: 0 }); }}>View</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function SessionView({ session }: { session: Session }) {
  const [replayN, setReplayN] = useState<number | null>(null);
  const replaying = session.hands.find((h) => h.n === replayN && h.replay) ?? null;
  const t = totals(session.hands);
  const leaks = leakStats(session.hands);
  const hands = [...session.hands].reverse();
  if (!session.hands.length) {
    return (
      <section className="panel empty">
        <h2>No hands yet</h2>
        <p>Play a few hands in the Play tab, or import your own from a poker site. Each finished hand lands here with its result, your verdicts, and the lesson to take from it. Everything is saved in this browser, so you can close the page and come back.</p>
        <div className="import-actions">
          <a className="button primary" href="#table">Go to Play</a>
          <a className="button" href="#import">Import hands</a>
        </div>
      </section>
    );
  }
  return (
    <>
      <div className="tiles">
        <div className="stat"><p className="eyebrow">Hands</p><p className="stat-value num">{t.hands}</p></div>
        <div className="stat">
          <p className="eyebrow">Result</p>
          <p className={`stat-value num ${t.net > 0 ? 'up' : t.net < 0 ? 'down' : ''}`}>{money(t.net)}</p>
          <p className="muted small num">{bbText(t.netBB)}</p>
        </div>
        <div className="stat">
          <p className="eyebrow">bb per 100 hands</p>
          <p className="stat-value num">{t.bbPer100 === null ? '–' : `${sign(t.bbPer100)}${Math.abs(t.bbPer100).toFixed(1)}`}</p>
          {t.bbPer100 === null && <p className="muted small">after 10 hands</p>}
        </div>
        <div className="stat">
          <p className="eyebrow">Decisions</p>
          <p className="stat-value num">{t.decisions}</p>
          <p className="muted small num">✅ {pct(t.verdicts.correct, t.decisions)} · 👍 {pct(t.verdicts.playable, t.decisions)} · ⚠️ {pct(t.verdicts.mistake, t.decisions)}</p>
        </div>
      </div>

      <section className="panel" aria-labelledby="leaks-h">
        <h2 id="leaks-h">Leaks</h2>
        {leaks.length ? (
          <>
            <p className="muted small">A leak is marked fixed when its spot comes up again and you play it without a mistake. It reopens if it shows up again. With “Practice my leaks” on, about half of new hands lean toward spots where your open leaks show up.</p>
            <div className="table-scroll">
              <table className="data">
                <thead>
                  <tr><th scope="col">Leak</th><th scope="col" className="n">Times</th><th scope="col" className="n">Last seen</th><th scope="col">Status</th></tr>
                </thead>
                <tbody>
                  {leaks.map((l) => (
                    <tr key={l.tag}>
                      <th scope="row">{l.tag}</th>
                      <td className="n num">{l.count}</td>
                      <td className="n num">hand {l.lastHand}</td>
                      <td>
                        {l.fixed ? (
                          <span className="status fixed">✓ Fixed <span className="muted">· played right {l.correctSince}× since</span></span>
                        ) : (
                          <span className="status open">Open</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p className="muted">No leaks tagged so far.</p>
        )}
      </section>

      <TendencyPanel hands={session.hands} />

      {replaying && <ReplayView key={`${session.id}-${replaying.n}`} hand={replaying} onClose={() => setReplayN(null)} />}

      <section className="panel" aria-labelledby="hands-h">
        <h2 id="hands-h">Hands</h2>
        <div className="table-scroll">
          <table className="data hands">
            <thead>
              <tr>
                <th scope="col" className="n">#</th>
                <th scope="col">Spot</th>
                <th scope="col">Cards</th>
                <th scope="col">Verdicts</th>
                <th scope="col" className="n">Result</th>
                <th scope="col">Lesson</th>
                <th scope="col"><span className="sr-only">Replay</span></th>
              </tr>
            </thead>
            <tbody>
              {hands.map((h) => (
                <tr key={h.n}>
                  <td className="n num">{h.n}</td>
                  <td>
                    {h.spot}
                    <span className="muted small block">{h.level === IMPORTED_LEVEL ? 'Imported hand' : `Level ${h.level} · ${LEVELS[h.level as LevelId]?.name ?? ''}`}</span>
                  </td>
                  <td className="num">{h.hand}</td>
                  <td className="verdicts" aria-label={h.decisions.map((d) => d.verdict).join(', ') || 'none'}>
                    {h.decisions.map((d, i) => <span key={i} title={`${d.label}: ${d.heading}`}>{ICON[d.verdict]}</span>)}
                    {!h.decisions.length && <span className="muted">–</span>}
                  </td>
                  <td className={`n num ${h.net > 0 ? 'up' : h.net < 0 ? 'down' : ''}`}>
                    {h.decided ? money(h.net) : <span className="muted">not played out</span>}
                  </td>
                  <td className="lesson">{h.lesson}</td>
                  <td>
                    {h.replay && (
                      <button type="button" onClick={() => { setReplayN(h.n); window.scrollTo({ top: 0 }); }} aria-label={`Replay hand ${h.n}`}>
                        Replay
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

/** The two postflop rates adaptive opponents watch, next to the best play's in the same spots. */
function TendencyPanel({ hands }: { hands: Session['hands'] }) {
  const t = heroTendencies(hands);
  const a = adaptationFor(t);
  const rows: { name: string; r: Rate }[] = [
    { name: 'Folding to a bet', r: t.foldToBet },
    { name: 'Betting when nobody has bet', r: t.betWhenFree },
  ];
  const p = (n: number, of: number) => (of ? `${Math.round((100 * n) / of)}%` : '–');
  return (
    <section className="panel" aria-labelledby="tendency-h">
      <h2 id="tendency-h">How opponents read you</h2>
      <p className="muted small">
        With “Opponents adapt to me” on, opponents compare your latest {ADAPT.window} postflop decisions of each kind with the trainer's best play in the same spots. Once a rate has {ADAPT.minSample} decisions behind it and differs from the best play's by more than {Math.round(100 * ADAPT.gap)} points, every opponent adjusts, and the range reads and grades use the adjusted style.
      </p>
      <div className="table-scroll">
        <table className="data">
          <thead>
            <tr><th scope="col">Postflop</th><th scope="col" className="n">You</th><th scope="col" className="n">Best play</th><th scope="col" className="n">Decisions</th></tr>
          </thead>
          <tbody>
            {rows.map(({ name, r }) => (
              <tr key={name}>
                <th scope="row">{name}</th>
                <td className="n num">{p(r.you, r.of)}</td>
                <td className="n num">{p(r.best, r.of)}</td>
                <td className="n num">{r.of}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small">
        {a ? `Opponents are ${a.adjustments.map((x) => ADJUSTMENT_SHORT[x.kind]).join(' and ')}.` : 'Opponents play their usual styles against you.'}
      </p>
    </section>
  );
}
