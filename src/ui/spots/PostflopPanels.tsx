// Postflop range read and feedback, shared by the practice spots and the full-hand levels.

import { forwardRef, useEffect, useMemo, useState } from 'react';
import type { ActionRecord } from '../../engine/hand';
import { POSTFLOP_CATEGORY_INFO, POSTFLOP_ORDER, categorizePostflop, type PostflopBreakdown, type PostflopCategory } from '../../engine/postflop/categories';
import { POSTFLOP_CLASS_LABEL } from '../../engine/postflop/classify';
import { classMix, postflopNudge, type PostflopFeedback } from '../../engine/postflop/coach';
import type { Profile } from '../../engine/postflop/model';
import { analyze, type Analysis, type PostflopSituation } from '../../engine/postflop/recommend';
import type { Range } from '../../engine/range';
import { runComboEquity } from '../../workers/equityClient';
import { CategoryGrid } from '../play/CategoryGrid';
import { dollars } from '../table/format';
import { EvTable } from './EvTable';

export const POSTFLOP_COLORS: Record<PostflopCategory, string> = {
  beats: '--cat-bad',
  draws: '--cat-flip',
  pays: '--cat-good',
  missed: '--cat-rest',
};

const BADGE = {
  correct: { icon: '✅', label: 'Correct' },
  playable: { icon: '👍', label: 'Playable, not best' },
  mistake: { icon: '⚠️', label: 'Mistake' },
} as const;

const pct = (x: number) => `${Math.round(x * 100)}%`;
const NO_REMOVED = new Set<string>();

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
  return { analysis, breakdown, error };
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

interface ReadProps {
  sit: PostflopSituation;
  villainRange: Range;
  title: string;
  profile?: Profile;
  analysis: Analysis | null;
  breakdown: PostflopBreakdown | null;
  error: string | null;
}

export function PostflopReadPanel({ sit, villainRange, title, profile, analysis, breakdown, error }: ReadProps) {
  const mix = useMemo(() => classMix(villainRange, sit.board, sit.hero), [villainRange, sit]);
  const live = breakdown?.live ?? 0;
  return (
    <section className="range-read" aria-labelledby="pf-rr">
      <div className="rr-head">
        <h2 id="pf-rr">Range read</h2>
        <span className="sample-tag">Approximate model</span>
      </div>
      <article className="opp">
        <h3>{title}</h3>
        {profile && (
          <p className="tendency"><span className="eyebrow">{profile.label}</span> {profile.about}</p>
        )}
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
          removed={NO_REMOVED}
          hero={sit.hero}
          info={POSTFLOP_CATEGORY_INFO}
          order={POSTFLOP_ORDER}
          colorVar={POSTFLOP_COLORS}
          showRemoved={false}
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
      </article>
      <div className="read-summary">
        <div className="stat">
          <p className="eyebrow">Your equity vs this range</p>
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

interface FeedbackProps {
  fb: PostflopFeedback;
  analysis: Analysis;
  bb: number;
  concept: string;
  children: React.ReactNode;
}

export const PostflopFeedbackPanel = forwardRef<HTMLElement, FeedbackProps>(function PostflopFeedbackPanel({ fb, analysis, bb, concept, children }, ref) {
  return (
    <section ref={ref} className={`feedback verdict-${fb.grade.verdict}`} aria-labelledby="pf-fb">
      <p className="verdict-badge"><span aria-hidden="true">{BADGE[fb.grade.verdict].icon}</span> {BADGE[fb.grade.verdict].label}</p>
      <h2 id="pf-fb">{fb.grade.heading}</h2>
      <ul className="why">{fb.bullets.map((b) => <li key={b}>{b}</li>)}</ul>
      {fb.sunkCost && <p className="sunk">{fb.sunkCost}</p>}
      <div>
        <p className="eyebrow">EV by action and size</p>
        <EvTable analysis={analysis} bb={bb} chosen={fb.grade.chosen} acceptable={fb.grade.acceptable} />
      </div>
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
