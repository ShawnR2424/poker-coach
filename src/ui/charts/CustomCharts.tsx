// Replace the trainer's approximate charts with your own: paste the raise and call ranges for the
// chart on screen, or open a chart pack file with many charts. Imported charts are used by the
// recommendations, the opponents and the range reads alike.

import { useMemo, useState } from 'react';
import { builtInEntry, CHARTS, customCharts, isCustomChart, type ChartEntry, type ChartSet, type SpotKind } from '../../engine/preflop/charts';
import {
  chartCount, checkChart, currentPack, packFileName, packText, parsePack, playedShare, withChart, withoutChart, type ChartPack,
} from '../../engine/preflop/chartPack';
import { chartLabel, CHART_KINDS } from '../../engine/preflop/explorer';
import { saveCharts, savedPack } from './customCharts';

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Every chart in a set, by plain name, in the order the explorer lists the spots. */
function chartList(set: ChartSet): { kind: SpotKind; key: string; label: string }[] {
  return CHART_KINDS.flatMap(({ kind }) => Object.keys(set[kind] ?? {}).map((key) => ({ kind, key, label: chartLabel(kind, key) })));
}

type Check = { ok: true; entry: ChartEntry; raise: number; call: number } | { ok: false; error: string };

const sizeHint = (kind: SpotKind) =>
  kind === 'rfi' ? 'Big blinds, e.g. 2.5' : kind === 'vs4bet' ? 'Always all-in' : kind === 'vsLimp' ? 'Set for all limp spots' : 'Times the last raise, e.g. 3, or allin';

export function CustomCharts({ kind, chartKey }: { kind: SpotKind; chartKey: string }) {
  const pack = savedPack();
  const saved = customCharts();
  const [name, setName] = useState(pack?.name ?? 'My charts');
  const [raise, setRaise] = useState('');
  const [call, setCall] = useState('');
  const [size, setSize] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ pack: ChartPack; file: string } | null>(null);
  const [clearing, setClearing] = useState(false);
  const label = chartLabel(kind, chartKey);
  const custom = isCustomChart(kind, chartKey);
  const sizeFixed = kind === 'vs4bet' || kind === 'vsLimp';

  // Check the pasted ranges as they are typed.
  const check = useMemo((): Check | null => {
    if (!raise.trim() && !call.trim()) return null;
    try {
      const sizeValue = !size.trim() ? undefined : size.trim().toLowerCase() === 'allin' ? 'allin' : Number(size);
      const entry = checkChart(kind, chartKey, { raise, call, size: sizeValue });
      return { ok: true, entry, raise: playedShare(entry.raise), call: playedShare(entry.call ?? '') };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }, [kind, chartKey, raise, call, size]);

  const save = (charts: ChartSet, packName = name) => {
    try {
      saveCharts(packName.trim() || 'My charts', charts);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const fill = () => {
    const e = CHARTS[kind][chartKey];
    setRaise(e.raise);
    setCall(e.call ?? '');
    setSize(sizeFixed || e.size === undefined ? '' : String(e.size));
  };

  const choose = async (file: File | undefined) => {
    setPending(null);
    setError(null);
    if (!file) return;
    try {
      setPending({ pack: parsePack(await file.text()), file: file.name });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const list = chartList(saved);

  return (
    <section className="panel custom-charts" aria-labelledby="custom-h">
      <h2 id="custom-h">Use your own charts</h2>
      <p className="muted">
        Replace any chart with ranges exported from a solver or a chart pack you trust. Imported charts are used everywhere the
        trainer reads a chart: your recommendations and grades, the opponents' play and their range reads. They are the 100bb
        charts; at 40bb or 200bb, with the rake on, or with the low-stakes adjustments on, those adjustments still apply on top.
      </p>
      <p id="custom-status">
        {list.length ? <>Playing <strong>{chartCount(saved)} imported {chartCount(saved) === 1 ? 'chart' : 'charts'}</strong> from "{pack?.name}"; every other chart is built in.</> : 'Every chart is the built-in one.'}
      </p>

      <div className="custom-paste" role="group" aria-labelledby="custom-paste-h">
        <h3 id="custom-paste-h">Replace this chart: {label}</h3>
        <p className="small muted">
          Paste each action's range as your tool exports it: <code>AA, KK:0.5, AKs:75%</code>, groups like <code>[50]AQo, KQo[/50]</code>,
          or exact combos like <code>AhKh:0.5</code>. A weight is the share of the time the hand takes the action; whatever is left folds.
        </p>
        <label htmlFor="custom-raise">{kind === 'rfi' ? 'Open range' : kind === 'vsLimp' ? 'Isolation raise range' : 'Raise range'}</label>
        <textarea id="custom-raise" rows={3} spellCheck={false} value={raise} onChange={(e) => setRaise(e.target.value)} />
        {kind !== 'rfi' && (
          <>
            <label htmlFor="custom-call">{kind === 'vsLimp' ? 'Over-limp range' : 'Call range'}</label>
            <textarea id="custom-call" rows={3} spellCheck={false} value={call} onChange={(e) => setCall(e.target.value)} />
          </>
        )}
        {!sizeFixed && (
          <label className="custom-size">
            <span>Raise size</span>
            <input id="custom-size" inputMode="decimal" placeholder={`${builtInEntry(kind, chartKey)?.size ?? ''} (built in)`} value={size} onChange={(e) => setSize(e.target.value)} />
            <span className="small muted">{sizeHint(kind)}</span>
          </label>
        )}
        {check && (!check.ok
          ? <p className="errors" role="alert" id="custom-error">{check.error}</p>
          : <p className="small" id="custom-check" role="status">Reads as raising {pct(check.raise)} and calling {pct(check.call)} of all hands, folding the other {pct(Math.max(0, 1 - check.raise - check.call))}.</p>)}
        <div className="key-row">
          <button type="button" id="custom-use" className="primary" disabled={!check?.ok} onClick={() => check?.ok && save(withChart(saved, kind, chartKey, check.entry))}>Use for this chart</button>
          <button type="button" id="custom-fill" onClick={fill}>Start from the current chart</button>
          {custom && <button type="button" id="custom-restore" onClick={() => save(withoutChart(saved, kind, chartKey))}>Put back the built-in chart</button>}
        </div>
      </div>

      <div className="custom-pack" role="group" aria-labelledby="custom-pack-h">
        <h3 id="custom-pack-h">Chart packs</h3>
        <p className="small muted">
          A chart pack is one file holding any number of charts. Save the charts you play now as a pack to get a template with
          every chart's name, edit its ranges with your solver's output, and open it here.
        </p>
        <label className="custom-name">
          <span>Name for your charts</span>
          <input id="custom-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="key-row">
          <button type="button" id="custom-save" onClick={() => { const p = currentPack(name.trim() || 'My charts'); download(packFileName(p), packText(p)); }}>Save all charts as a pack</button>
        </div>
        <div className="backup-restore">
          <label htmlFor="custom-file">Open a chart pack</label>
          <input id="custom-file" type="file" accept=".json,application/json" onChange={(e) => { void choose(e.target.files?.[0]); e.target.value = ''; }} />
        </div>
        {error && <p className="errors" role="alert">{error}</p>}
        {pending && (
          <div className="backup-confirm" role="group" aria-labelledby="custom-pending-h">
            <p id="custom-pending-h"><strong>{pending.pack.name}</strong> ({pending.file}) holds {chartCount(pending.pack.charts)} {chartCount(pending.pack.charts) === 1 ? 'chart' : 'charts'}. They replace any charts imported before; charts the pack leaves out stay built in.</p>
            <div className="key-row">
              <button type="button" id="custom-pack-use" className="primary" onClick={() => save(pending.pack.charts, pending.pack.name)}>Use these charts</button>
              <button type="button" onClick={() => setPending(null)}>Cancel</button>
            </div>
          </div>
        )}
      </div>

      {list.length > 0 && (
        <div className="custom-list" role="group" aria-labelledby="custom-list-h">
          <h3 id="custom-list-h">Imported charts</h3>
          <ul>{list.map((c) => <li key={`${c.kind}|${c.key}`}>{c.label}</li>)}</ul>
          {clearing ? (
            <div className="key-row">
              <span>Put every built-in chart back?</span>
              <button type="button" id="custom-clear-yes" className="primary" onClick={() => save({})}>Put them back</button>
              <button type="button" onClick={() => setClearing(false)}>Cancel</button>
            </div>
          ) : (
            <button type="button" id="custom-clear" onClick={() => setClearing(true)}>Remove all imported charts</button>
          )}
        </div>
      )}
    </section>
  );
}
