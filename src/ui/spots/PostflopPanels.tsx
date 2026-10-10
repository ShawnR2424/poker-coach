// Postflop range read and feedback, shared by the practice spots and the full-hand levels.

import { forwardRef, useEffect, useMemo, useState } from 'react';
import type { ActionRecord } from '../../engine/hand';
import { POSTFLOP_CATEGORY_INFO, POSTFLOP_ORDER, categorizePostflop, type PostflopBreakdown } from '../../engine/postflop/categories';
import { POSTFLOP_CLASS_LABEL } from '../../engine/postflop/classify';
import { classMix, multiwayNudge, postflopNudge, stepLine, type PostflopFeedback } from '../../engine/postflop/coach';
import { comboTable, droppedClasses, keptShare } from '../../engine/postflop/combos';
import { heroClassLine, RANGE_ACTION_LABEL, type RangeAction, type RangeActions } from '../../engine/postflop/heroRange';
import type { Profile } from '../../engine/postflop/model';
import type { MultiwayResult, MultiwaySituation } from '../../engine/postflop/multiway';
import type { PostflopStep } from '../../engine/postflop/narrow';
import { analyze, type Analysis, type DecisionBasics, type PostflopSituation } from '../../engine/postflop/recommend';
import type { HandClass, Range } from '../../engine/range';
import { runComboEquity, runMultiway } from '../../workers/equityClient';
import { CategoryGrid } from '../play/CategoryGrid';
import { dollars } from '../table/format';
import { POSTFLOP_COLORS } from './colors';
import { ComboTable } from './ComboTable';
import { EvTable } from './EvTable';

export { POSTFLOP_COLORS };

const BADGE = {
  correct: { icon: '✅', label: 'Correct' },
  playable: { icon: '👍', label: 'Playable, not best' },
  mistake: { icon: '⚠️', label: 'Mistake' },
} as const;

const pct = (x: number) => `${Math.round(x * 100)}%`;
const NO_REMOVED = new Set<HandClass>();

/** Per-combo equity (in the worker), the EV analysis and the grid breakdown for one decision. */
export function usePostflopRead(sit: PostflopSituation | null, villainRange: Range | null) {
  // Equities are tagged with the situation they belong to, so a change never pairs new cards with old numbers.
  const [eqState, setEqState] = useState<{ for: unknown; eqs: Float32Array } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!sit || !villainRange) return;
    let cancelled = false;
    setError(null);
    runComboEquity(sit.hero, sit.board, villainRange)
      .then((e) => { if (!cancelled) setEqState({ for: sit, eqs: e }); })
      .catch((e: Error) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [sit, villainRange]);
  const eqs = sit && eqState && eqState.for === sit ? eqState.eqs : null;
  const analysis = useMemo(() => (sit && eqs ? analyze(sit, eqs) : null), [sit, eqs]);
  const breakdown = useMemo(
    () => (sit && eqs && villainRange ? categorizePostflop(villainRange, sit.hero, sit.board, eqs) : null),
    [sit, eqs, villainRange],
  );
  return { analysis, breakdown, eqs, error };
}

export function villainLine(actions: ActionRecord[], villain: number): string {
  return actions
    .filter((a) => a.player === villain && a.type !== 'post' && a.type !== 'fold')
    .map((a) => {
      const where = a.street === 'preflop' ? 'preflop' : `on the ${a.street}`;
      if (a.type === 'check') return `checked ${where}`;
      if (a.type === 'call') return `called ${where}`;
      return `${a.type === 'bet' ? 'bet' : 'raised to'} ${dollars(a.to)} ${where}`;
    })
    .join(', ');
}

/** Runs the multiway analysis in the worker, tagged with the situation it belongs to. */
export function useMultiwayRead(sit: MultiwaySituation | null) {
  const [res, setRes] = useState<{ for: unknown; r: MultiwayResult } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!sit) return;
    let cancelled = false;
    setError(null);
    runMultiway(sit)
      .then((r) => { if (!cancelled) setRes({ for: sit, r }); })
      .catch((e: Error) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [sit]);
  return { result: sit && res && res.for === sit ? res.r : null, error };
}

/** Where the combo table opens by default: rivers and 4-bet pots, where exact counts decide. */
export function comboTableReason(street: string, fourBetPot: boolean): string | undefined {
  if (street === 'river') return 'open on the river, where combo counts decide';
  if (fourBetPot) return 'open in 4-bet pots, where ranges are narrow';
  return undefined;
}

export interface OpponentView {
  title: string;
  profile?: Profile;
  range: Range;
  /** Their most recent postflop action, for crossed-out cells and the change line. */
  lastStep?: PostflopStep;
}

interface OpponentProps {
  view: OpponentView;
  sit: DecisionBasics;
  eqs: Float32Array | null;
  breakdown: PostflopBreakdown | null;
  comboReason?: string;
}

/** One opponent's read: style, latest change, class mix, grid, totals, and combo table. */
export function OpponentPanel({ view, sit, eqs, breakdown, comboReason }: OpponentProps) {
  const dead = useMemo(() => [...sit.hero, ...sit.board], [sit]);
  const mix = useMemo(() => classMix(view.range, sit.board, sit.hero), [view.range, sit]);
  const step = view.lastStep;
  const removed = useMemo(() => (step ? droppedClasses(step.before, step.after, dead) : NO_REMOVED), [step, dead]);
  const rows = useMemo(() => (eqs ? comboTable(view.range, sit.hero, sit.board, eqs) : null), [eqs, view.range, sit]);
  const live = breakdown?.live ?? 0;
  return (
    <article className="opp">
      <h3>{view.title}</h3>
      {view.profile && (
        <p className="tendency"><span className="eyebrow">{view.profile.label}</span> {view.profile.about}</p>
      )}
      {step && <p className="change small">{stepLine(step.move.kind, step.street, keptShare(step.before, step.after, dead))}</p>}
      <p className="muted small num">
        {live ? `${live.toFixed(1)} weighted combos after card removal` : 'Weighing combos…'}
      </p>
      <ul className="mix">
        {mix.filter((m) => m.share >= 0.02).slice(0, 6).map((m) => (
          <li key={m.cls}><span>{POSTFLOP_CLASS_LABEL[m.cls]}</span><span className="num">{pct(m.share)}</span></li>
        ))}
      </ul>
      <CategoryGrid
        cells={breakdown?.cells ?? null}
        removed={removed}
        hero={sit.hero}
        info={POSTFLOP_CATEGORY_INFO}
        order={POSTFLOP_ORDER}
        colorVar={POSTFLOP_COLORS}
        showRemoved={!!step}
      />
      {breakdown && (
        <div className="cat-tiles">
          {POSTFLOP_ORDER.map((k) => (
            <div key={k} className="cat-tile">
              <i style={{ background: `var(${POSTFLOP_COLORS[k]})` }} />
              <span className="small">{POSTFLOP_CATEGORY_INFO[k].label}</span>
              <strong className="num">{(breakdown.totals.get(k) ?? 0).toFixed(1)}</strong>
              <span className="muted small num">{live > 0 ? pct((breakdown.totals.get(k) ?? 0) / live) : '0%'}</span>
            </div>
          ))}
        </div>
      )}
      {rows && <ComboTable rows={rows} open={!!comboReason} reason={comboReason} />}
    </article>
  );
}

function Summary({ analysis, label }: { analysis: Analysis | null; label: string }) {
  return (
    <div className="read-summary">
      <div className="stat">
        <p className="eyebrow">{label}</p>
        <p className="stat-value num">{analysis ? pct(analysis.facts.equity) : '…'}</p>
      </div>
      {analysis?.facts.potOdds != null && (
        <div className="stat">
          <p className="eyebrow">Equity needed to call</p>
          <p className="stat-value num">{(analysis.facts.potOdds * 100).toFixed(1)}%</p>
        </div>
      )}
      <div className="stat">
        <p className="eyebrow">Stack-to-pot ratio</p>
        <p className="stat-value num">{analysis ? analysis.facts.spr.toFixed(1) : '…'}</p>
      </div>
      {analysis && analysis.facts.heroStrong !== null && (
        <div className="stat">
          <p className="eyebrow">Two pair or better</p>
          <p className="stat-value num">{pct(analysis.facts.heroStrong)} <span className="muted small">you</span> · {pct(analysis.facts.villainStrong)} <span className="muted small">them</span></p>
        </div>
      )}
    </div>
  );
}

interface ReadProps {
  sit: PostflopSituation;
  view: OpponentView;
  analysis: Analysis | null;
  eqs: Float32Array | null;
  breakdown: PostflopBreakdown | null;
  error: string | null;
  comboReason?: string;
  /** What the hero's own line says to the opponents. */
  heroLine?: string;
}

function HeroLineRead({ text }: { text?: string }) {
  if (!text) return null;
  return (
    <div className="hero-read">
      <p className="eyebrow">What your line says</p>
      <p>{text}</p>
    </div>
  );
}

export function PostflopReadPanel({ sit, view, analysis, eqs, breakdown, error, comboReason, heroLine }: ReadProps) {
  return (
    <section className="range-read" aria-labelledby="pf-rr">
      <div className="rr-head">
        <h2 id="pf-rr">Range read</h2>
        <span className="sample-tag">Approximate model</span>
      </div>
      <OpponentPanel view={view} sit={sit} eqs={eqs} breakdown={breakdown} comboReason={comboReason} />
      <Summary analysis={analysis} label="Your equity vs this range" />
      <HeroLineRead text={heroLine} />
      {analysis && breakdown && (
        <div className="nudge">
          <p className="eyebrow">What the read tells you</p>
          <p>{postflopNudge(analysis, breakdown)}</p>
        </div>
      )}
      {error && <p className="errors">{error}</p>}
    </section>
  );
}

interface MultiProps {
  sit: MultiwaySituation;
  views: OpponentView[];
  note: string;
  result: MultiwayResult | null;
  error: string | null;
  comboReason?: string;
  heroLine?: string;
}

/** One panel per opponent, a note on how their actions interact, and equity against all of them. */
export function MultiwayReadPanel({ sit, views, note, result, error, comboReason, heroLine }: MultiProps) {
  const breakdowns = useMemo(
    () => (result ? views.map((v, j) => categorizePostflop(v.range, sit.hero, sit.board, result.comboEqs[j])) : null),
    [result, views, sit],
  );
  const analysis = result?.analysis ?? null;
  return (
    <section className="range-read" aria-labelledby="mw-rr">
      <div className="rr-head">
        <h2 id="mw-rr">Range read · {views.length} opponents</h2>
        <span className="sample-tag">Approximate model</span>
      </div>
      <p className="interaction">{note}</p>
      {views.map((v, j) => (
        <OpponentPanel
          key={v.title}
          view={v}
          sit={sit}
          eqs={result?.comboEqs[j] ?? null}
          breakdown={breakdowns?.[j] ?? null}
          comboReason={comboReason}
        />
      ))}
      <Summary analysis={analysis} label="Your equity vs everyone" />
      <HeroLineRead text={heroLine} />
      {analysis && breakdowns && (
        <div className="nudge">
          <p className="eyebrow">What the read tells you</p>
          <p>{multiwayNudge(analysis, views.map((v, j) => ({ name: v.title.split(' · ')[0], br: breakdowns[j] })))}</p>
        </div>
      )}
      {error && <p className="errors">{error}</p>}
    </section>
  );
}

interface FeedbackProps {
  fb: PostflopFeedback;
  analysis: Analysis;
  bb: number;
  concept: string;
  multiway?: boolean;
  /** How the model would split the hero's range across the actions, and which row the hero took. */
  split?: RangeActions;
  chosenSplit?: RangeAction;
  /** Optional coaching prose from Claude, shown under the trainer's reasons. */
  voice?: React.ReactNode;
  children: React.ReactNode;
}

export const PostflopFeedbackPanel = forwardRef<HTMLElement, FeedbackProps>(function PostflopFeedbackPanel({ fb, analysis, bb, concept, multiway, split, chosenSplit, voice, children }, ref) {
  return (
    <section ref={ref} className={`feedback verdict-${fb.grade.verdict}`} aria-labelledby="pf-fb">
      <p className="verdict-badge"><span aria-hidden="true">{BADGE[fb.grade.verdict].icon}</span> {BADGE[fb.grade.verdict].label}</p>
      <h2 id="pf-fb">{fb.grade.heading}</h2>
      <ul className="why">{fb.bullets.map((b) => <li key={b}>{b}</li>)}</ul>
      {fb.sunkCost && <p className="sunk">{fb.sunkCost}</p>}
      {voice}
      <div>
        <p className="eyebrow">EV by action and size</p>
        <EvTable analysis={analysis} bb={bb} chosen={fb.grade.chosen} acceptable={fb.grade.acceptable} multiway={multiway} />
      </div>
      {split && <RangeActionsTable split={split} chosen={chosenSplit} />}
      {fb.outcome && <p className="alt">{fb.outcome}</p>}
      {fb.grade.tags.length > 0 && (
        <p className="leaks"><span className="eyebrow">Leak tag</span> {fb.grade.tags.join(', ')}</p>
      )}
      <div className="concept">
        <p className="eyebrow">Key concept</p>
        <p>{concept}</p>
      </div>
      <div className="fb-actions">{children}</div>
    </section>
  );
});

/** Which hands in the hero's range take each action, by the model's class frequencies. */
export function RangeActionsTable({ split, chosen }: { split: RangeActions; chosen?: RangeAction }) {
  return (
    <div className="range-actions">
      <p className="eyebrow">Which hands in your range take each action</p>
      <ul>
        {split.rows.map((r) => {
          const mostly = r.classes.filter((c) => c.share >= 0.1).slice(0, 3);
          return (
            <li key={r.action} className={r.action === chosen ? 'mine' : ''}>
              <div className="ra-head">
                <span className="ra-name">
                  {RANGE_ACTION_LABEL[r.action]}
                  {r.action === chosen && <span className="tag you-tag">You</span>}
                </span>
                <span className="ra-share">{pct(r.share)} of your range</span>
              </div>
              <div className="ra-bar" aria-hidden="true"><span style={{ width: `${r.share * 100}%` }} /></div>
              {r.share > 0 && (
                <p className="ra-mostly">
                  {mostly.length ? `Mostly ${mostly.map((c) => `${POSTFLOP_CLASS_LABEL[c.cls].toLowerCase()} (${pct(c.share)})`).join(', ')}` : 'A thin mix of many hand types'}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      <p className="model-note">{heroClassLine(split)} These frequencies come from the trainer's class model of a typical low-stakes player, not from a solver.</p>
    </div>
  );
}
