// Postflop practice spots: the range read, an action, then a verdict with the EV-by-size table.

import { useEffect, useMemo, useRef, useState } from 'react';
import { parseCards } from '../../engine/cards';
import { describeScore, evaluate } from '../../engine/evaluator';
import type { Action } from '../../engine/hand';
import { POSTFLOP_CATEGORY_INFO, POSTFLOP_ORDER, categorizePostflop, type PostflopCategory } from '../../engine/postflop/categories';
import { POSTFLOP_CLASS_LABEL } from '../../engine/postflop/classify';
import { classMix, postflopFeedback, postflopNudge, type PostflopFeedback } from '../../engine/postflop/coach';
import { analyze, gradePostflop, situationFromState } from '../../engine/postflop/recommend';
import { buildSpot, POSTFLOP_SPOTS } from '../../engine/postflop/spots';
import { runComboEquity } from '../../workers/equityClient';
import { CategoryGrid } from '../play/CategoryGrid';
import { ActionBar } from '../table/ActionBar';
import { HeroStrip } from '../table/HeroStrip';
import { TableView } from '../table/TableView';
import { Timeline } from '../table/Timeline';
import { dollars } from '../table/format';
import { heroTiles, seatViews, timeline } from '../table/view';
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

export function SpotsScreen() {
  const [idx, setIdx] = useState(0);
  // Equities are tagged with the situation they belong to, so a spot change never pairs new cards with old numbers.
  const [eqState, setEqState] = useState<{ for: unknown; eqs: Float32Array } | null>(null);
  const [fb, setFb] = useState<PostflopFeedback | null>(null);
  const [error, setError] = useState<string | null>(null);

  const spot = useMemo(() => buildSpot(POSTFLOP_SPOTS[idx]), [idx]);
  const { state, hero, villain, def } = spot;
  const sit = useMemo(
    () => situationFromState(state, hero, villain, spot.villainRange, { heroRange: spot.heroRange, heroPreflopAggressor: spot.heroPreflopAggressor }),
    [spot], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const eqs = eqState && eqState.for === sit ? eqState.eqs : null;

  useEffect(() => {
    let cancelled = false;
    setFb(null);
    setError(null);
    runComboEquity(sit.hero, sit.board, spot.villainRange)
      .then((e) => { if (!cancelled) setEqState({ for: sit, eqs: e }); })
      .catch((e: Error) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [sit, spot]);

  const analysis = useMemo(() => (eqs ? analyze(sit, eqs) : null), [sit, eqs]);
  const breakdown = useMemo(() => (eqs ? categorizePostflop(spot.villainRange, sit.hero, sit.board, eqs) : null), [spot, sit, eqs]);
  const mix = useMemo(() => classMix(spot.villainRange, sit.board, sit.hero), [spot, sit]);

  const fbRef = useRef<HTMLElement>(null);
  useEffect(() => { if (fb) fbRef.current?.scrollIntoView({ block: 'start' }); }, [fb]);

  const act = (action: Action) => {
    if (!analysis) return;
    const grade = gradePostflop(sit, analysis, action);
    setFb(postflopFeedback(sit, analysis, grade, state.players[villain].hole, parseCards(def.board)));
  };

  const go = (i: number) => {
    setIdx(i);
    window.scrollTo({ top: 0 });
  };
  const seats = seatViews(state, hero, {}, new Set(), true);
  const heroCards = state.players[hero].hole;
  const madeHand = describeScore(evaluate([...heroCards, ...state.board]));
  const villainPos = state.players[villain].position;
  const villainLine = state.actions
    .filter((a) => a.player === villain && a.type !== 'post' && a.type !== 'fold')
    .map((a) => {
      const where = a.street === 'preflop' ? 'preflop' : `on the ${a.street}`;
      if (a.type === 'check') return `checked ${where}`;
      if (a.type === 'call') return `called ${where}`;
      return `${a.type === 'bet' ? 'bet' : 'raised to'} ${dollars(a.to)} ${where}`;
    })
    .join(', ');
  const live = breakdown?.live ?? 0;

  return (
    <div className="screen">
      <nav className="spot-pick" aria-label="Practice spots">
        {POSTFLOP_SPOTS.map((d, i) => (
          <button key={d.id} type="button" className={i === idx ? 'on' : ''} aria-pressed={i === idx} onClick={() => go(i)}>
            <span className="eyebrow">Spot {i + 1}</span>
            {d.title}
          </button>
        ))}
      </nav>
      <p className="spot-setup">{def.setup}</p>

      <TableView state={state} seats={seats} hero={hero} />
      <HeroStrip cards={heroCards} tiles={heroTiles(state, hero)} madeHand={madeHand} />
      <Timeline rows={timeline(state, hero, true)} />

      {!fb && (
        <section className="range-read" aria-labelledby="pf-rr">
          <div className="rr-head">
            <h2 id="pf-rr">Range read</h2>
            <span className="sample-tag">Approximate model</span>
          </div>
          <article className="opp">
            <h3>{villainPos} · {villainLine}</h3>
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
              hero={heroCards}
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
      )}

      {!fb && <ActionBar key={idx} state={state} onAct={(a) => act(a)} disabled={!analysis} />}

      {fb && analysis && (
        <section ref={fbRef} className={`feedback verdict-${fb.grade.verdict}`} aria-labelledby="pf-fb">
          <p className="verdict-badge"><span aria-hidden="true">{BADGE[fb.grade.verdict].icon}</span> {BADGE[fb.grade.verdict].label}</p>
          <h2 id="pf-fb">{fb.grade.heading}</h2>
          <ul className="why">{fb.bullets.map((b) => <li key={b}>{b}</li>)}</ul>
          {fb.sunkCost && <p className="sunk">{fb.sunkCost}</p>}
          <div>
            <p className="eyebrow">EV by action and size</p>
            <EvTable analysis={analysis} bb={sit.bb} chosen={fb.grade.chosen} acceptable={fb.grade.acceptable} />
          </div>
          {fb.outcome && <p className="alt">{fb.outcome}</p>}
          {fb.grade.tags.length > 0 && (
            <p className="leaks"><span className="eyebrow">Leak tag</span> {fb.grade.tags.join(', ')}</p>
          )}
          <div className="concept">
            <p className="eyebrow">Key concept</p>
            <p>{def.concept}</p>
          </div>
          <div className="fb-actions">
            <button type="button" onClick={() => setFb(null)}>Try this spot again</button>
            <button type="button" className="primary" onClick={() => go((idx + 1) % POSTFLOP_SPOTS.length)}>Next spot</button>
          </div>
        </section>
      )}
    </div>
  );
}
