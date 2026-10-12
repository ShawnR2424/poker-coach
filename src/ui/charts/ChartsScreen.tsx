// The chart explorer: browse every preflop chart the trainer plays, for you or the opponents, at
// each stack depth, with or without the rake and the low-stakes adjustments, and see which hands
// those layers moved from the plain 100bb chart.

import { useMemo, useState } from 'react';
import { DEPTHS, isCustomChart, type Depth, type SpotKind } from '../../engine/preflop/charts';
import { strategyGrid } from '../../engine/preflop/coach';
import {
  baseStrategy, CHART_KINDS, chartKeys, changesFrom, choiceNames, exploreStrategy, rangeTexts, shares, sizeText, type ExploreOptions,
} from '../../engine/preflop/explorer';
import { StrategyGrid } from '../play/StrategyGrid';
import { CustomCharts } from './CustomCharts';
import { savedPack } from './customCharts';
import '../session/session.css';
import './charts.css';

const KEY = 'charts:v1';
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const pct0 = (x: number) => `${Math.round(x * 100)}%`;

interface Pick extends ExploreOptions {
  kind: SpotKind;
  key: string;
}

const DEFAULT: Pick = { kind: 'rfi', key: 'BTN', audience: 'hero', lowStakes: true, depth: 100, raked: false };

function load(): Pick {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Pick> | null;
    if (!p) return DEFAULT;
    const kind = CHART_KINDS.some((k) => k.kind === p.kind) ? p.kind! : DEFAULT.kind;
    const keys = chartKeys(kind);
    return {
      kind,
      key: keys.some((k) => k.key === p.key) ? p.key! : keys[0].key,
      audience: p.audience === 'pool' ? 'pool' : 'hero',
      lowStakes: p.lowStakes !== false,
      depth: (DEPTHS as number[]).includes(p.depth as number) ? (p.depth as Depth) : 100,
      raked: p.raked === true,
    };
  } catch {
    return DEFAULT;
  }
}

export function ChartsScreen() {
  const [pick, setPickState] = useState<Pick>(load);
  const setPick = (next: Partial<Pick>) => {
    const p = { ...pick, ...next };
    if (next.kind && next.kind !== pick.kind && !next.key) p.key = chartKeys(next.kind)[0].key;
    setPickState(p);
    try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* storage unavailable */ }
  };

  const { kind, key } = pick;
  const s = useMemo(() => exploreStrategy(kind, key, pick), [kind, key, pick]);
  const grid = useMemo(() => strategyGrid(s), [s]);
  const changes = useMemo(() => changesFrom(baseStrategy(kind, key), s), [kind, key, s]);
  const marked = useMemo(() => new Set(changes.map((c) => c.cls)), [changes]);
  const names = choiceNames(kind, key);
  const sh = shares(s);
  const text = rangeTexts(s);
  const label = chartKeys(kind).find((k) => k.key === key)!.label;
  const layered = pick.depth !== 100 || pick.raked || pick.lowStakes;
  const custom = isCustomChart(kind, key);

  return (
    <div className="screen charts">
      <div className="session-head">
        <div>
          <p className="eyebrow">Chart explorer</p>
          <h1>Preflop charts</h1>
        </div>
      </div>

      <section className="panel chart-pick" aria-label="Choose a chart">
        <div className="chart-selects">
          <label>
            <span className="eyebrow">Spot</span>
            <select id="chart-kind" value={kind} onChange={(e) => setPick({ kind: e.target.value as SpotKind })}>
              {CHART_KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
            </select>
          </label>
          <label>
            <span className="eyebrow">Chart</span>
            <select id="chart-key" value={key} onChange={(e) => setPick({ key: e.target.value })}>
              {chartKeys(kind).map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
            </select>
          </label>
          <label>
            <span className="eyebrow">Whose chart</span>
            <select id="chart-audience" value={pick.audience} onChange={(e) => setPick({ audience: e.target.value as Pick['audience'] })}>
              <option value="hero">Yours (the recommendations)</option>
              <option value="pool">The opponents'</option>
            </select>
          </label>
          <label>
            <span className="eyebrow">Stacks</span>
            <select id="chart-depth" value={pick.depth} onChange={(e) => setPick({ depth: Number(e.target.value) as Depth })}>
              {DEPTHS.map((d) => <option key={d} value={d}>{d}bb</option>)}
            </select>
          </label>
        </div>
        <div className="chart-toggles">
          <label className="inline"><input id="chart-rake" type="checkbox" checked={pick.raked} onChange={(e) => setPick({ raked: e.target.checked })} /> Rake on (5%, cap 3bb)</label>
          <label className="inline"><input id="chart-lowstakes" type="checkbox" checked={pick.lowStakes} onChange={(e) => setPick({ lowStakes: e.target.checked })} /> Low-stakes adjustments</label>
        </div>
      </section>

      <section className="panel chart-view" aria-labelledby="chart-h">
        <div>
          <h2 id="chart-h">{label}{custom && <span className="badge imported">Imported</span>}</h2>
          <p className="small muted">{pick.audience === 'hero' ? 'Your chart' : 'The opponents\' chart'} at {pick.depth}bb{pick.raked ? ', raked' : ''}{pick.lowStakes ? ', with the low-stakes adjustments' : ''}. Size: {sizeText(kind, key, pick)}.</p>
        </div>
        <div className="tiles chart-shares">
          <div className="stat"><p className="eyebrow">{names.raise}</p><p className="stat-value num">{pct(sh.raise)}</p></div>
          <div className="stat"><p className="eyebrow">{names.call}</p><p className="stat-value num">{pct(sh.call)}</p></div>
          <div className="stat"><p className="eyebrow">{names.fold}</p><p className="stat-value num">{pct(sh.fold)}</p></div>
          <div className="stat"><p className="eyebrow">Hands played</p><p className="stat-value num">{pct(sh.raise + sh.call)}</p></div>
        </div>
        <StrategyGrid
          freqs={grid}
          names={names}
          label={`${label}: each hand's split between ${names.raise}, ${names.call} and ${names.fold}`}
          marked={layered ? { hands: marked, label: 'Changed from the plain 100bb chart' } : undefined}
        />
        <div className="range-texts">
          <p><span className="eyebrow">{names.raise}</span> <code>{text.raise || 'none'}</code></p>
          {text.call && <p><span className="eyebrow">{names.call}</span> <code>{text.call}</code></p>}
        </div>
      </section>

      {layered && (
        <section className="panel" aria-labelledby="changes-h">
          <h2 id="changes-h">What changed from the plain 100bb chart{custom ? ' you imported' : ''}</h2>
          {changes.length === 0 ? (
            <p className="small">Nothing: the settings above leave this chart as it is at 100bb with no rake.</p>
          ) : (
            <>
              <ul className="why">{s.notes.map((n) => <li key={n}>{n}</li>)}</ul>
              <div className="table-scroll">
                <table className="data chart-changes">
                  <thead>
                    <tr>
                      <th scope="col">Hand</th>
                      <th scope="col" className="n">{names.raise}</th>
                      <th scope="col" className="n">{names.call}</th>
                      <th scope="col" className="n">{names.fold}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {changes.map((c) => (
                      <tr key={c.cls}>
                        <th scope="row">{c.cls}</th>
                        {(['raise', 'call', 'fold'] as const).map((a) => (
                          <td key={a} className="n num">
                            {Math.round(c.before[a] * 100) === Math.round(c.after[a] * 100) ? pct0(c.after[a]) : <>{pct0(c.before[a])} → <strong>{pct0(c.after[a])}</strong></>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      )}

      <CustomCharts key={`${kind}|${key}`} kind={kind} chartKey={key} />

      <p className="small muted chart-source">
        {custom
          ? <>This chart is the one you imported in "{savedPack()?.name}". </>
          : <>This chart is the trainer's approximate chart from <code>data/preflop/</code>, not solver output. </>}
        The Play tab grades you with the same charts the opponents play from.
      </p>
    </div>
  );
}
