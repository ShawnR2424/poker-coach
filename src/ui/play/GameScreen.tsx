// Level 1 play loop: deal a preflop spot, show the range read, grade the hero's action,
// let opponents respond from their charts, and show the result.

import { useEffect, useMemo, useRef, useState } from 'react';
import { preflopCategory, categorizeRange, type CellCategory, type PreflopCategory } from '../../engine/categories';
import { describeScore, evaluate } from '../../engine/evaluator';
import { applyAction, type Action } from '../../engine/hand';
import { breakEvenFoldPct, potOdds } from '../../engine/math';
import {
  blockerCount, heroDecision, heroLineRead, nudge, opponentReads, playersBehind, preflopFeedback,
  type Decision, type Feedback, type OpponentRead,
} from '../../engine/preflop/coach';
import { generatePreflopScenario, runOpponents } from '../../engine/preflop/scenario';
import { spotFor } from '../../engine/preflop/spot';
import { makeRng, randomSeed } from '../../engine/rng';
import { runClassEquity, runEquity } from '../../workers/equityClient';
import { ActionBar } from '../table/ActionBar';
import { HeroStrip } from '../table/HeroStrip';
import { TableView } from '../table/TableView';
import { Timeline } from '../table/Timeline';
import { heroTiles, seatViews, timeline } from '../table/view';
import { FeedbackPanel } from './FeedbackPanel';
import { HandResult, type DecisionLog } from './HandResult';
import { RangeReadPanel, type ReadView } from './RangeReadPanel';

type Phase = 'decide' | 'feedback' | 'result';

interface Pending {
  decision: Decision;
  feedback: Feedback;
  action: Action;
}

export function GameScreen() {
  const rngRef = useRef(makeRng(randomSeed()));
  const [lowStakes, setLowStakes] = useState(true);
  const opts = useMemo(() => ({ lowStakes }), [lowStakes]);
  const [{ state, hero }, setHand] = useState(() => {
    const sc = generatePreflopScenario(rngRef.current, { lowStakes: true });
    return { state: sc.state, hero: sc.hero };
  });
  const [phase, setPhase] = useState<Phase>('decide');
  const [pending, setPending] = useState<Pending | null>(null);
  const [log, setLog] = useState<DecisionLog[]>([]);
  const [heroEq, setHeroEq] = useState<number | null>(null);
  const [cells, setCells] = useState<Map<number, CellCategory<PreflopCategory>[]>>(new Map());

  const heroCards = state.players[hero].hole;
  const spot = phase !== 'result' && state.toAct === hero ? spotFor(state, hero) : null;
  const hypothetical = spot?.kind === 'rfi';
  const reads: OpponentRead[] = useMemo(
    () => (state.toAct !== hero ? [] : hypothetical ? playersBehind(state, hero, opts) : opponentReads(state, hero, opts)),
    [state, hero, opts, hypothetical],
  );

  // Equity vs the ranges and per-class matchups for the grids.
  useEffect(() => {
    if (phase !== 'decide' || !reads.length) return;
    let cancelled = false;
    setHeroEq(null);
    setCells(new Map());
    const villains = hypothetical ? [reads[0].range] : reads.map((r) => r.range);
    runEquity(heroCards, state.board, villains, 20000)
      .then((o) => { if (!cancelled) setHeroEq(o.result.equity); })
      .catch(() => { if (!cancelled) setHeroEq(NaN); });
    reads.forEach((r) => {
      runClassEquity(heroCards, state.board, r.range, 800).then((m) => {
        if (cancelled) return;
        const c = categorizeRange(r.range, [...heroCards, ...state.board], m, preflopCategory);
        setCells((prev) => new Map(prev).set(r.seat, c));
      });
    });
    return () => { cancelled = true; };
  }, [reads, phase]); // eslint-disable-line react-hooks/exhaustive-deps

  const decision = useMemo(() => (spot ? heroDecision(state, hero, opts) : null), [state, hero, opts, spot?.key, spot?.kind]); // eslint-disable-line react-hooks/exhaustive-deps

  const nextHand = () => {
    const sc = generatePreflopScenario(rngRef.current, opts);
    setHand({ state: sc.state, hero: sc.hero });
    setPhase('decide');
    setPending(null);
    setLog([]);
  };

  const act = (action: Action) => {
    if (!decision || heroEq === null) return;
    const blocker = reads.length && !hypothetical ? blockerCount(reads[0].range, heroCards) : null;
    const fb = preflopFeedback(state, hero, decision, action, Number.isNaN(heroEq) ? 0 : heroEq, blocker);
    setPending({ decision, feedback: fb, action });
    setLog((l) => [...l, { label: decision.spot.label, hand: decision.hand, grade: fb.grade }]);
    setPhase('feedback');
  };

  const cont = () => {
    if (!pending) return;
    const s2 = runOpponents(applyAction(state, pending.action), hero, rngRef.current, opts);
    setPending(null);
    setHand({ state: s2, hero });
    setPhase(s2.toAct === hero && s2.street === 'preflop' ? 'decide' : 'result');
  };

  const reveal = phase === 'result' ? new Set(state.players.map((_, i) => i).filter((i) => i !== hero && !state.players[i].folded)) : new Set<number>();
  const seats = seatViews(state, hero, {}, reveal, phase !== 'result');
  const madeHand = state.board.length >= 3 ? describeScore(evaluate([...heroCards, ...state.board])) : null;
  const folded = state.players.filter((p, i) => p.folded && i !== hero).map((p) => p.position);

  const threshold = (() => {
    if (!decision) return null;
    if (decision.toCall > 0) return { label: 'Equity needed to call', value: `${(potOdds(decision.toCall, decision.pot) * 100).toFixed(1)}%` };
    if (decision.spot.kind === 'rfi' && decision.raiseTo) {
      return { label: 'Folds needed for a pure steal', value: `${Math.round(breakEvenFoldPct({ pot: decision.pot, risk: decision.raiseTo }) * 100)}%` };
    }
    return null;
  })();

  const readViews: ReadView[] = reads.map((r) => ({ read: r, position: state.players[r.seat].position, cells: cells.get(r.seat) ?? null }));

  return (
    <div className="screen">
      <div className="play-bar">
        <label className="inline">
          Level
          <select id="level" value="1" onChange={() => undefined}>
            <option value="1">1 · Preflop only</option>
            <option value="2" disabled>2 · Preflop + flop (milestone 5)</option>
            <option value="3" disabled>3 · Full hands heads-up (milestone 5)</option>
            <option value="4" disabled>4 · 3-bet and 4-bet pots (milestone 5)</option>
            <option value="5" disabled>5 · Multiway pots (milestone 6)</option>
            <option value="6" disabled>6 · Thin value and bluff-catching (milestone 7)</option>
          </select>
        </label>
        <label className="toggle">
          <input id="lowstakes" type="checkbox" checked={lowStakes} onChange={(e) => setLowStakes(e.target.checked)} />
          Low-stakes adjustments
        </label>
        <button type="button" onClick={nextHand}>New hand</button>
      </div>

      <TableView state={state} seats={seats} hero={hero} />
      <HeroStrip cards={heroCards} tiles={heroTiles(state, hero)} madeHand={madeHand} />
      <Timeline rows={timeline(state, hero, phase !== 'result')} />

      {phase === 'decide' && decision && (
        <>
          <RangeReadPanel
            reads={readViews}
            hero={heroCards}
            dead={[...heroCards, ...state.board]}
            folded={folded}
            heroLine={heroLineRead(state, hero, opts)}
            nudge={nudge(decision, heroEq)}
            heroEquity={heroEq !== null && !Number.isNaN(heroEq) ? heroEq : null}
            threshold={threshold}
            hypothetical={hypothetical}
          />
          <ActionBar key={state.actions.length} state={state} onAct={(a) => act(a)} disabled={heroEq === null} />
        </>
      )}
      {phase === 'feedback' && pending && (
        <FeedbackPanel fb={pending.feedback} decision={pending.decision} onContinue={cont} />
      )}
      {phase === 'result' && <HandResult state={state} hero={hero} log={log} onNext={nextHand} />}
    </div>
  );
}

