// The equity calculator: two to four players, each with an exact hand or a range, on any board,
// with optional dead cards. Exact when the problem is small enough, sampled otherwise.

import { useEffect, useMemo, useState } from 'react';
import { formatCard, parseCards, type Card } from '../../engine/cards';
import { MAX_PLAYERS, MIN_PLAYERS, parseBoard, parseHolding, type CalcResult, type PlayerHolding } from '../../engine/calc/equityCalc';
import { formatRange } from '../../engine/range';
import { runCalc } from '../../workers/equityClient';
import { RangeGrid } from '../RangeGrid';
import { chartPresets } from './presets';
import '../session/session.css';
import './equity.css';

const KEY = 'equity:v1';
const SAMPLES = [100_000, 400_000] as const;

interface Inputs {
  players: string[];
  board: string;
  dead: string;
  samples: number;
}

const EXAMPLES: { name: string; inputs: Omit<Inputs, 'samples'> }[] = [
  { name: 'Aces against kings', inputs: { players: ['AhAs', 'KdKc'], board: '', dead: '' } },
  { name: 'Overpair against a flush draw', inputs: { players: ['QsQd', 'AhJh'], board: 'Th7h2c', dead: '' } },
  { name: 'Button open against a big blind 3-bet', inputs: { players: ['22+, A2s+, K9s+, QTs+, JTs, ATo+, KJo+', 'TT+, AQs+, AKo, A5s-A4s'], board: '', dead: '' } },
  { name: 'Three-way all-in', inputs: { players: ['AsKs', 'JJ', '22+, A2s+, KTs+, ATo+'], board: '', dead: '' } },
];

const DEFAULT: Inputs = { ...EXAMPLES[0].inputs, samples: SAMPLES[0] };

function load(): Inputs {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Inputs> | null;
    if (!p || !Array.isArray(p.players)) return DEFAULT;
    const players = p.players.filter((x): x is string => typeof x === 'string').slice(0, MAX_PLAYERS);
    while (players.length < MIN_PLAYERS) players.push('random');
    return {
      players,
      board: typeof p.board === 'string' ? p.board : '',
      dead: typeof p.dead === 'string' ? p.dead : '',
      samples: SAMPLES.includes(p.samples as (typeof SAMPLES)[number]) ? p.samples! : SAMPLES[0],
    };
  } catch {
    return DEFAULT;
  }
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const fmtCombos = (x: number) => (Number.isInteger(x) ? x.toLocaleString() : x.toFixed(1));

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };
const attempt = <T,>(f: () => T): Parsed<T> => {
  try {
    return { ok: true, value: f() };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
};

function holdingText(h: PlayerHolding): string {
  if (h.kind === 'hand') return h.cards.map(formatCard).join('');
  return h.random ? 'Any two cards' : formatRange(h.range);
}

export function EquityScreen() {
  const [inputs, setInputsState] = useState<Inputs>(load);
  const [out, setOut] = useState<{ result: CalcResult; ms: number } | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const presets = useMemo(chartPresets, []);

  const setInputs = (next: Partial<Inputs>) => {
    const v = { ...inputs, ...next };
    setInputsState(v);
    setOut(null);
    try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* storage unavailable */ }
  };
  const setPlayer = (i: number, text: string) => setInputs({ players: inputs.players.map((p, j) => (j === i ? text : p)) });

  const holdings = inputs.players.map((t) => attempt(() => parseHolding(t)));
  const board = attempt(() => parseBoard(inputs.board));
  const dead = attempt(() => parseCards(inputs.dead));
  const errors = [
    ...holdings.map((h, i) => (h.ok ? null : `Player ${i + 1}: ${h.error}`)),
    board.ok ? null : `Board: ${board.error}`,
    dead.ok ? null : `Dead cards: ${dead.error}`,
  ].filter((e): e is string => e !== null);
  const ready = errors.length === 0;
  const known: Card[] = ready ? [...(board as { value: Card[] }).value, ...(dead as { value: Card[] }).value] : [];

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const t = setTimeout(() => {
      setRunning(true);
      const ranges = holdings.map((h) => (h as { value: PlayerHolding }).value.range);
      runCalc(ranges, (board as { value: Card[] }).value, (dead as { value: Card[] }).value, inputs.samples)
        .then((o) => { if (!cancelled) { setOut(o); setRunError(null); } })
        .catch((e: Error) => { if (!cancelled) { setOut(null); setRunError(e.message); } })
        .finally(() => { if (!cancelled) setRunning(false); });
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputs, ready]);

  const res = out?.result;
  const worst = res ? Math.max(...res.players.map((p) => p.stderr)) : 0;

  return (
    <div className="screen equity-screen">
      <div className="session-head">
        <div>
          <p className="eyebrow">Equity calculator</p>
          <h1>Hands and ranges, head to head</h1>
        </div>
      </div>

      <section className="panel" aria-labelledby="eq-in-h">
        <h2 id="eq-in-h">Players</h2>
        <p className="small muted eq-help">
          Give each player an exact hand (<code>AhKd</code>), a range in standard notation (<code>QQ+, AKs, AQo:0.5</code>), <code>random</code> for any two cards, or a range from the trainer's 100bb charts.
        </p>
        <div className="presets" aria-label="Examples">
          {EXAMPLES.map((ex) => (
            <button key={ex.name} type="button" className="chip" onClick={() => setInputs({ ...ex.inputs })}>{ex.name}</button>
          ))}
        </div>
        <ol className="eq-players">
          {inputs.players.map((text, i) => {
            const h = holdings[i];
            return (
              <li key={i} className={`eq-player p${i + 1}`}>
                <div className="eq-player-head">
                  <label htmlFor={`eq-p${i + 1}`} className="eq-name"><span className="eq-dot" aria-hidden="true" /> Player {i + 1}</label>
                  <select
                    id={`eq-chart-${i + 1}`}
                    aria-label={`Fill player ${i + 1} from a chart`}
                    value=""
                    onChange={(e) => {
                      const p = presets.find((x) => x.id === e.target.value);
                      if (p) setPlayer(i, p.text);
                    }}
                  >
                    <option value="">From a chart…</option>
                    {['Opens', '3-bets', 'Calls'].map((g) => (
                      <optgroup key={g} label={g}>
                        {presets.filter((p) => p.group === g).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                      </optgroup>
                    ))}
                  </select>
                  {inputs.players.length > MIN_PLAYERS && (
                    <button type="button" onClick={() => setInputs({ players: inputs.players.filter((_, j) => j !== i) })}>Remove</button>
                  )}
                </div>
                <textarea id={`eq-p${i + 1}`} rows={2} spellCheck={false} value={text} onChange={(e) => setPlayer(i, e.target.value)} />
                {h.ok && h.value.kind === 'range' && !h.value.random && (
                  <details className="eq-grid">
                    <summary>Range grid</summary>
                    <RangeGrid range={h.value.range} dead={known} />
                  </details>
                )}
              </li>
            );
          })}
        </ol>
        {inputs.players.length < MAX_PLAYERS && (
          <button type="button" className="eq-add" onClick={() => setInputs({ players: [...inputs.players, 'random'] })}>Add a player</button>
        )}
        <div className="eq-cards">
          <label>
            <span className="eyebrow">Board</span>
            <input id="eq-board" spellCheck={false} placeholder="None, or Th7h2c" value={inputs.board} onChange={(e) => setInputs({ board: e.target.value })} />
          </label>
          <label>
            <span className="eyebrow">Dead cards</span>
            <input id="eq-dead" spellCheck={false} placeholder="Folded cards you saw" value={inputs.dead} onChange={(e) => setInputs({ dead: e.target.value })} />
          </label>
          <label>
            <span className="eyebrow">Samples when not exact</span>
            <select id="eq-samples" value={inputs.samples} onChange={(e) => setInputs({ samples: Number(e.target.value) })}>
              {SAMPLES.map((s) => <option key={s} value={s}>{s.toLocaleString()}</option>)}
            </select>
          </label>
        </div>
        {errors.length > 0 && <ul className="errors">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
      </section>

      <section className="panel eq-results" aria-labelledby="eq-out-h" aria-busy={running}>
        <h2 id="eq-out-h">Equity</h2>
        {runError && <p className="errors">{runError}</p>}
        {!res ? (
          <p className="muted">{running ? 'Calculating…' : ready ? ' ' : 'Fix the fields above to see the equities.'}</p>
        ) : (
          <>
            <div className="eq-bar" role="img" aria-label={res.players.map((p, i) => `Player ${i + 1} ${pct(p.equity)}`).join(', ')}>
              {res.players.map((p, i) => (
                <span key={i} className={`p${i + 1}`} style={{ flexGrow: p.equity }} title={`Player ${i + 1}: ${pct(p.equity)}`} />
              ))}
            </div>
            <div className="table-scroll">
              <table className="data eq-table">
                <thead>
                  <tr><th scope="col">Player</th><th scope="col" className="eq-holding-h">Holding</th><th scope="col" className="n">Combos</th><th scope="col" className="n">Equity</th><th scope="col" className="n">Wins</th><th scope="col" className="n">Splits</th></tr>
                </thead>
                <tbody>
                  {res.players.map((p, i) => {
                    const h = holdings[i];
                    return (
                      <tr key={i} className={`p${i + 1}`}>
                        <th scope="row"><span className="eq-dot" aria-hidden="true" /> Player {i + 1}</th>
                        <td className="eq-holding"><code>{h.ok ? holdingText(h.value) : ''}</code></td>
                        <td className="n num">{fmtCombos(p.combos)}</td>
                        <td className="n num eq-value">{pct(p.equity)}</td>
                        <td className="n num">{pct(p.win)}</td>
                        <td className="n num">{pct(p.tie)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="small muted" id="eq-method">
              {res.exact
                ? `Exact: every deal counted (${res.deals.toLocaleString()} deals, ${Math.round(out!.ms)} ms).`
                : `Sampled ${res.deals.toLocaleString()} deals in ${Math.round(out!.ms)} ms; each equity is within ±${(1.96 * worst * 100).toFixed(1)} points 95% of the time.`}
              {' '}Combos are the hands left in each range once the board and dead cards are removed. A split pot counts as a share of the pot.
            </p>
          </>
        )}
      </section>
    </div>
  );
}
