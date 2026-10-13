// Replace the trainer's estimated postflop play with solver output: paste or open the strategy
// report a solver exports for one spot, check how it reads by hand class, and add it. The spots
// added so far are averaged into the opponents' tables (see solverImport.ts).

import { useMemo, useState } from 'react';
import { POSTFLOP_CLASS_LABEL, POSTFLOP_CLASSES, type PostflopClass } from '../../engine/postflop/classify';
import { continueProb, firstToActFreq, postflopOverrides, responseFor, type PostflopOverrides } from '../../engine/postflop/model';
import { boardTexture, TEXTURE_LABEL, TEXTURES, type Texture } from '../../engine/postflop/texture';
import { parseCards } from '../../engine/cards';
import {
  isFacing, makePostflopPack, parsePostflopPack, postflopPackFileName, postflopPackText, readSolverReport, SPOT_KINDS,
  type ActFreq, type FacingFreq, type PostflopPack, type ReadResult, type SolverSpot, type SpotKind,
} from '../../engine/postflop/solverImport';
import { savePostflop, savedPostflopPack } from './customPostflop';
import { ScrollBox } from '../ScrollBox';

const pct = (x: number) => `${Math.round(x * 100)}%`;
const kindLabel = (k: SpotKind) => SPOT_KINDS.find((s) => s.kind === k)!.label;

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

const textureText = (board: string) => TEXTURE_LABEL[boardTexture(parseCards(board))].toLowerCase();

const spotText = (s: SolverSpot) => `${s.label}: ${s.board} (${textureText(s.board)}), ${kindLabel(s.kind).toLowerCase()}${s.f !== undefined ? ` of ${Math.round(s.f * 100)}% pot` : ''}`;

const EXAMPLE = 'Hand, Weight, Check, Bet 33%, Bet 75%\nAsAh, 1, 0.2, 0.5, 0.3\nKQs, 0.6, 0.7, 0.3, 0';

/** What one class does in a spot just read, for the check table. */
function ReadTable({ spot }: { spot: SolverSpot }) {
  const facing = isFacing(spot.kind);
  const total = Object.values(spot.classes).reduce((t, c) => t + (c?.w ?? 0), 0);
  const cols = facing ? (['fold', 'call', 'raise'] as const) : (['check', 'small', 'big'] as const);
  const names = facing ? ['Fold', 'Call', 'Raise'] : ['Check', 'Bet up to half pot', 'Bet more'];
  return (
    <ScrollBox label="What each hand class does">
      <table className="data solver-read">
        <thead>
          <tr><th scope="col">Hand class</th><th scope="col" className="n">Share of range</th>{names.map((n) => <th key={n} scope="col" className="n">{n}</th>)}</tr>
        </thead>
        <tbody>
          {POSTFLOP_CLASSES.filter((c) => spot.classes[c]).map((cls) => {
            const v = spot.classes[cls] as ActFreq & FacingFreq;
            return (
              <tr key={cls}>
                <th scope="row">{POSTFLOP_CLASS_LABEL[cls]}</th>
                <td className="n num">{pct(v.w / total)}</td>
                {cols.map((k) => <td key={k} className="n num">{pct(v[k])}</td>)}
              </tr>
            );
          })}
        </tbody>
      </table>
    </ScrollBox>
  );
}

/**
 * The regular opponent's play now on one board texture (or the base tables), with the numbers
 * that come from imported spots in bold.
 */
function PlayTable({ tex }: { tex?: Texture }) {
  const all = postflopOverrides();
  const o: PostflopOverrides = tex ? all.byTexture?.[tex] ?? {} : all;
  const mark = (on: boolean, text: string) => (on ? <strong>{text}</strong> : text);
  const has = (part: Partial<Record<PostflopClass, number>> | undefined, cls: PostflopClass) => part?.[cls] !== undefined;
  return (
    <ScrollBox label="Opponent postflop play">
      <table className="data solver-play">
        <thead>
          <tr>
            <th scope="col">Hand class</th>
            <th scope="col" className="n">Bets when checked to</th>
            <th scope="col" className="n">Leads into the raiser</th>
            <th scope="col" className="n">Continues vs half pot</th>
            <th scope="col" className="n">Continues vs pot</th>
            <th scope="col" className="n">Raises when continuing</th>
            <th scope="col" className="n">Continues vs a raise</th>
          </tr>
        </thead>
        <tbody>
          {POSTFLOP_CLASSES.map((cls) => {
            const act = firstToActFreq(cls, false, undefined, tex);
            const lead = firstToActFreq(cls, true, undefined, tex);
            const line = has(o.facingBet?.base, cls);
            const half = responseFor(cls, 0.5, true, false, undefined, 1, tex);
            const vsBet = continueProb(cls, 0.5, false, undefined, 1, tex);
            const vsRaise = continueProb(cls, 0.5, true, undefined, 1, tex);
            return (
              <tr key={cls}>
                <th scope="row">{POSTFLOP_CLASS_LABEL[cls]}</th>
                <td className="n num">{mark(has(o.firstToAct?.betSmall, cls), pct(act.small + act.big))}</td>
                <td className="n num">{mark(has(o.leadIntoAggressor?.betSmall, cls), pct(lead.small + lead.big))}</td>
                <td className="n num">{mark(line, pct(vsBet))}</td>
                <td className="n num">{mark(line, pct(continueProb(cls, 1, false, undefined, 1, tex)))}</td>
                <td className="n num">{mark(has(o.facingBet?.raise, cls), pct(half.call + half.raise > 0 ? half.raise / (half.call + half.raise) : 0))}</td>
                <td className="n num">{mark(has(o.facingRaise?.continue, cls), `×${(vsBet > 0 ? vsRaise / vsBet : 0).toFixed(2)}`)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </ScrollBox>
  );
}

export function SolverPostflop() {
  const pack = savedPostflopPack();
  const spots = pack?.spots ?? [];
  const [name, setName] = useState(pack?.name ?? 'My solver spots');
  const [label, setLabel] = useState('');
  const [board, setBoard] = useState('');
  const [kind, setKind] = useState<SpotKind>('act');
  const [facingPct, setFacingPct] = useState('');
  const [pot, setPot] = useState('');
  const [report, setReport] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ pack: PostflopPack; file: string } | null>(null);
  const [clearing, setClearing] = useState(false);
  const [tableTex, setTableTex] = useState<Texture | ''>('');

  // Read the report as it is pasted, so mistakes show before anything is saved.
  const read = useMemo((): { ok: true; r: ReadResult } | { ok: false; error: string } | null => {
    if (!report.trim() || !board.trim()) return null;
    try {
      return {
        ok: true,
        r: readSolverReport(report, {
          label: label || `Spot ${spots.length + 1}`, board, kind,
          facingPct: isFacing(kind) && facingPct.trim() ? Number(facingPct) : undefined,
          pot: pot.trim() ? Number(pot) : undefined,
        }),
      };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }, [report, board, kind, facingPct, pot, label, spots.length]);

  const save = (next: SolverSpot[], packName = name) => {
    try {
      savePostflop(packName.trim() || 'My solver spots', next);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const openReport = async (file: File | undefined) => {
    if (file) setReport(await file.text());
  };

  const openPack = async (file: File | undefined) => {
    setPending(null);
    setError(null);
    if (!file) return;
    try {
      setPending({ pack: parsePostflopPack(await file.text()), file: file.name });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <section className="panel custom-charts solver-postflop" aria-labelledby="solver-h">
      <h2 id="solver-h">Postflop play from a solver</h2>
      <p className="muted">
        After the flop, opponents bet, call and raise by hand class from the trainer's estimates. Add strategy reports
        exported from a solver to replace them: each report is read class by class on its board, and every spot you add is
        averaged into the opponents' play, your grades and the range reads. The regular opponent plays the imported numbers;
        nits, calling stations and aggressive players still adjust them in their own direction.
      </p>
      <p id="solver-status">
        {spots.length
          ? <>Playing <strong>{spots.length} imported {spots.length === 1 ? 'spot' : 'spots'}</strong> from "{pack?.name}"; anything they don't cover stays built in.</>
          : 'Opponents play the built-in postflop estimates.'}
      </p>

      <div className="custom-paste" role="group" aria-labelledby="solver-add-h">
        <h3 id="solver-add-h">Add a solver spot</h3>
        <p className="small muted">
          Export the strategy at one decision, for the player whose play you want: one row per combo or hand, one column per
          action, plus a weight column if the solver gives one. EV and equity columns are skipped. For example:
        </p>
        <pre className="solver-example">{EXAMPLE}</pre>
        <div className="solver-fields">
          <label><span>What the spot is</span><input id="solver-label" placeholder="BTN vs BB, flop c-bet" maxLength={80} value={label} onChange={(e) => setLabel(e.target.value)} /></label>
          <label><span>Board</span><input id="solver-board" placeholder="Ks7d2c" spellCheck={false} value={board} onChange={(e) => setBoard(e.target.value)} /></label>
          <label>
            <span>The player is</span>
            <select id="solver-kind" value={kind} onChange={(e) => setKind(e.target.value as SpotKind)}>
              {SPOT_KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
            </select>
          </label>
          {isFacing(kind) && (
            <label><span>Size faced, % of the pot</span><input id="solver-facing" inputMode="decimal" placeholder="75" value={facingPct} onChange={(e) => setFacingPct(e.target.value)} /></label>
          )}
          <label><span>Pot in chips (only if bets are in chips)</span><input id="solver-pot" inputMode="decimal" placeholder="Bet sizes are % of the pot" value={pot} onChange={(e) => setPot(e.target.value)} /></label>
        </div>
        <label htmlFor="solver-report">Strategy report</label>
        <textarea id="solver-report" rows={6} spellCheck={false} value={report} onChange={(e) => setReport(e.target.value)} />
        <div className="backup-restore">
          <label htmlFor="solver-report-file">Or open the exported file</label>
          <input id="solver-report-file" type="file" accept=".csv,.txt,.tsv,text/csv,text/plain" onChange={(e) => { void openReport(e.target.files?.[0]); e.target.value = ''; }} />
        </div>
        {read && (!read.ok
          ? <p className="errors" role="alert" id="solver-error">{read.error}</p>
          : (
            <>
              <p className="small" id="solver-check" role="status">
                Read {read.r.combos.toLocaleString()} combos on {read.r.spot.board}, a {textureText(read.r.spot.board)} board, with the actions {read.r.actions.join(', ')}.
                {read.r.ignored.length > 0 && <> Skipped the columns {read.r.ignored.join(', ')}.</>}
              </p>
              <ReadTable spot={read.r.spot} />
            </>
          ))}
        <div className="key-row">
          <button type="button" id="solver-add" className="primary" disabled={!read?.ok} onClick={() => read?.ok && save([...spots, read.r.spot])}>Add this spot</button>
        </div>
      </div>

      <div className="custom-list" role="group" aria-labelledby="solver-play-h">
        <h3 id="solver-play-h">How the regular opponent plays now</h3>
        <p className="small muted">
          {spots.length ? 'Bold numbers come from your imported spots on that kind of board; the rest are built in. ' : ''}
          Each cell is the share of that class taking the action, before the floor that keeps a whole range from folding too much to a bet.
          Opponents play differently on each kind of board: spots you import count for their own kind of board, and their average,
          adjusted for the board, fills in the kinds you have no spots for.
        </p>
        <label className="custom-name">
          <span>Board</span>
          <select id="solver-texture" value={tableTex} onChange={(e) => setTableTex(e.target.value as Texture | '')}>
            <option value="">Before adjusting for the board</option>
            {TEXTURES.map((t) => <option key={t} value={t}>{TEXTURE_LABEL[t]}</option>)}
          </select>
        </label>
        <PlayTable tex={tableTex || undefined} />
      </div>

      <div className="custom-pack" role="group" aria-labelledby="solver-pack-h">
        <h3 id="solver-pack-h">Postflop packs</h3>
        <p className="small muted">A postflop pack is one file holding every spot you added, to keep a copy or move it to another device.</p>
        <label className="custom-name">
          <span>Name for your spots</span>
          <input id="solver-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        </label>
        {spots.length > 0 && (
          <div className="key-row">
            <button type="button" id="solver-save" onClick={() => { const p = makePostflopPack(name.trim() || 'My solver spots', spots); download(postflopPackFileName(p), postflopPackText(p)); }}>Save the spots as a pack</button>
          </div>
        )}
        <div className="backup-restore">
          <label htmlFor="solver-file">Open a postflop pack</label>
          <input id="solver-file" type="file" accept=".json,application/json" onChange={(e) => { void openPack(e.target.files?.[0]); e.target.value = ''; }} />
        </div>
        {error && <p className="errors" role="alert">{error}</p>}
        {pending && (
          <div className="backup-confirm" role="group" aria-labelledby="solver-pending-h">
            <p id="solver-pending-h"><strong>{pending.pack.name}</strong> ({pending.file}) holds {pending.pack.spots.length} {pending.pack.spots.length === 1 ? 'spot' : 'spots'}. They replace the spots imported before.</p>
            <div className="key-row">
              <button type="button" id="solver-pack-use" className="primary" onClick={() => save(pending.pack.spots, pending.pack.name)}>Use these spots</button>
              <button type="button" onClick={() => setPending(null)}>Cancel</button>
            </div>
          </div>
        )}
      </div>

      {spots.length > 0 && (
        <div className="custom-list" role="group" aria-labelledby="solver-list-h">
          <h3 id="solver-list-h">Imported spots</h3>
          <ul className="solver-spots">
            {spots.map((s, i) => (
              <li key={i}>
                <span>{spotText(s)}</span>{' '}
                <button type="button" onClick={() => save(spots.filter((_, j) => j !== i))}>Remove</button>
              </li>
            ))}
          </ul>
          {clearing ? (
            <div className="key-row">
              <span>Put the built-in postflop play back?</span>
              <button type="button" id="solver-clear-yes" className="primary" onClick={() => save([])}>Put it back</button>
              <button type="button" onClick={() => setClearing(false)}>Cancel</button>
            </div>
          ) : (
            <button type="button" id="solver-clear" onClick={() => setClearing(true)}>Remove all imported spots</button>
          )}
        </div>
      )}
    </section>
  );
}
