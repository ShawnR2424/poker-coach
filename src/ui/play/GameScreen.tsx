// The practice loop for every level: deal a hand, show the range read at each hero decision,
// grade it, let opponents respond, and show the result.

import { useEffect, useMemo, useRef, useState } from 'react';
import { preflopCategory, categorizeRange, type CellCategory, type PreflopCategory } from '../../engine/categories';
import { formatCards } from '../../engine/cards';
import { describeScore, evaluate } from '../../engine/evaluator';
import { advance, LEVELS, newGameHand, type GameHand, type LevelId } from '../../engine/game/levels';
import { applyAction, type Action, type HandState } from '../../engine/hand';
import { breakEvenFoldPct, potOdds } from '../../engine/math';
import { conceptFor, postflopFeedback, type PostflopFeedback } from '../../engine/postflop/coach';
import { PROFILES } from '../../engine/postflop/model';
import { narrowHand } from '../../engine/postflop/narrow';
import { describeOption, gradePostflop, situationFromState, type Analysis, type PostflopSituation } from '../../engine/postflop/recommend';
import {
  blockerCount, heroDecision, heroLineRead, nudge, opponentReads, playersBehind, preflopFeedback,
  type Decision, type Feedback, type OpponentRead,
} from '../../engine/preflop/coach';
import { hasChart, spotFor } from '../../engine/preflop/spot';
import { NUM_COMBOS } from '../../engine/range';
import { makeRng, randomSeed } from '../../engine/rng';
import { runClassEquity, runEquity } from '../../workers/equityClient';
import { PostflopFeedbackPanel, PostflopReadPanel, usePostflopRead, villainLine } from '../spots/PostflopPanels';
import { ActionBar } from '../table/ActionBar';
import { HeroStrip } from '../table/HeroStrip';
import { TableView } from '../table/TableView';
import { Timeline } from '../table/Timeline';
import { heroTiles, seatViews, timeline, STREET_LABEL } from '../table/view';
import { FeedbackPanel } from './FeedbackPanel';
import { HandResult, type DecisionLog } from './HandResult';
import { RangeReadPanel, type ReadView } from './RangeReadPanel';

type Phase = 'decide' | 'feedback' | 'result';

type Pending =
  | { kind: 'preflop'; decision: Decision; feedback: Feedback; action: Action }
  | { kind: 'postflop'; fb: PostflopFeedback; analysis: Analysis; sit: PostflopSituation; action: Action };

const LEVEL_KEY = 'level';
function loadLevel(): LevelId {
  try {
    const v = Number(localStorage.getItem(LEVEL_KEY));
    return v === 2 || v === 3 || v === 4 ? v : 1;
  } catch {
    return 1;
  }
}

export function GameScreen() {
  const rngRef = useRef(makeRng(randomSeed()));
  const [lowStakes, setLowStakes] = useState(true);
  const [level, setLevel] = useState<LevelId>(loadLevel);
  const opts = useMemo(() => ({ lowStakes }), [lowStakes]);
  const [game, setGame] = useState<GameHand>(() => newGameHand(loadLevel(), rngRef.current, { lowStakes: true }));
  const [state, setState] = useState<HandState>(game.state);
  const hero = game.hero;
  const [phase, setPhase] = useState<Phase>('decide');
  const [pending, setPending] = useState<Pending | null>(null);
  const [log, setLog] = useState<DecisionLog[]>([]);

  const heroCards = state.players[hero].hole;
  const isPreflop = state.street === 'preflop';
  const heroToAct = phase === 'decide' && state.toAct === hero;

  const nextHand = (lvl: LevelId = level) => {
    const g = newGameHand(lvl, rngRef.current, opts);
    setGame(g);
    setState(advance(g, g.state, rngRef.current, opts));
    setPhase('decide');
    setPending(null);
    setLog([]);
    window.scrollTo({ top: 0 });
  };

  const changeLevel = (lvl: LevelId) => {
    setLevel(lvl);
    try { localStorage.setItem(LEVEL_KEY, String(lvl)); } catch { /* storage unavailable */ }
    nextHand(lvl);
  };

  // ---- Preflop read ----
  const spot = heroToAct && isPreflop ? spotFor(state, hero) : null;
  const hypothetical = spot?.kind === 'rfi';
  const reads: OpponentRead[] = useMemo(() => {
    if (!heroToAct || !isPreflop) return [];
    const all = hypothetical ? playersBehind(state, hero, opts) : opponentReads(state, hero, opts);
    // Heads-up levels: only the villain plays on, so only their read matters.
    return game.villain === null ? all : all.filter((r) => r.seat === game.villain);
  }, [state, hero, opts, hypothetical, heroToAct, isPreflop, game.villain]);
  const [heroEq, setHeroEq] = useState<number | null>(null);
  const [cells, setCells] = useState<Map<number, CellCategory<PreflopCategory>[]>>(new Map());

  useEffect(() => {
    if (!heroToAct || !isPreflop) return;
    let cancelled = false;
    setHeroEq(null);
    setCells(new Map());
    // With no chart read (an unusual line), measure against any two cards.
    const villains = !reads.length ? [new Float32Array(NUM_COMBOS).fill(1)] : hypothetical ? [reads[0].range] : reads.map((r) => r.range);
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
  }, [reads]); // eslint-disable-line react-hooks/exhaustive-deps

  const charted = spot ? hasChart(spot) : false;
  const decision = useMemo(() => (spot && hasChart(spot) ? heroDecision(state, hero, opts) : null), [state, hero, opts, spot?.key, spot?.kind]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Postflop read ----
  const villain = game.villain;
  const villainProfile = villain !== null ? PROFILES[game.profiles[villain]] : undefined;
  const post = useMemo(() => {
    if (!heroToAct || isPreflop || villain === null || state.players[villain].folded) return null;
    const villainRange = narrowHand(state, villain, 'pool', opts, villainProfile).range;
    const heroRange = narrowHand(state, hero, 'baseline', opts).range;
    const pre = state.actions.filter((a) => a.street === 'preflop' && a.type === 'raise');
    const sit = situationFromState(state, hero, villain, villainRange, {
      heroRange,
      heroPreflopAggressor: pre.length > 0 && pre[pre.length - 1].player === hero,
      villainProfile,
    });
    return { sit, villainRange };
  }, [state, heroToAct, isPreflop, villain, villainProfile, hero, opts]);
  const { analysis, breakdown, error } = usePostflopRead(post?.sit ?? null, post?.villainRange ?? null);

  const fbRef = useRef<HTMLElement>(null);
  useEffect(() => { if (phase === 'feedback' && pending?.kind === 'postflop') fbRef.current?.scrollIntoView({ block: 'start' }); }, [phase, pending]);

  const act = (action: Action, label: string) => {
    if (isPreflop && !charted) {
      // A line the charts don't cover: play it, without a grade.
      const s2 = advance(game, applyAction(state, action), rngRef.current, opts);
      setState(s2);
      setPhase(s2.toAct === hero ? 'decide' : 'result');
      return;
    }
    if (isPreflop) {
      if (!decision || heroEq === null) return;
      const blocker = reads.length && !hypothetical ? blockerCount(reads[0].range, heroCards) : null;
      const fb = preflopFeedback(state, hero, decision, action, Number.isNaN(heroEq) ? 0 : heroEq, blocker);
      setPending({ kind: 'preflop', decision, feedback: fb, action });
      setLog((l) => [...l, {
        label: decision.spot.label, hand: decision.hand, you: label.toLowerCase(),
        verdict: fb.grade.verdict, heading: fb.grade.heading, tags: fb.grade.tags,
      }]);
    } else {
      if (!analysis || !post) return;
      const grade = gradePostflop(post.sit, analysis, action);
      const fb = postflopFeedback(post.sit, analysis, grade, [], []);
      setPending({ kind: 'postflop', fb, analysis, sit: post.sit, action });
      setLog((l) => [...l, {
        label: `${STREET_LABEL[state.street]} ${formatCards(state.board)}`, hand: formatCards(heroCards),
        you: describeOption(grade.chosen.option).toLowerCase(), verdict: grade.verdict, heading: grade.heading, tags: grade.tags,
      }]);
    }
    setPhase('feedback');
  };

  const cont = () => {
    if (!pending) return;
    const s2 = advance(game, applyAction(state, pending.action), rngRef.current, opts);
    setPending(null);
    setState(s2);
    setPhase(s2.toAct === hero ? 'decide' : 'result');
  };

  const reveal = phase === 'result' ? new Set(state.players.map((_, i) => i).filter((i) => i !== hero && !state.players[i].folded)) : new Set<number>();
  const profileLabels = level === 1 ? {} : Object.fromEntries(Object.entries(game.profiles).map(([k, v]) => [k, PROFILES[v].short]));
  const seats = seatViews(state, hero, profileLabels, reveal, phase !== 'result');
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
  const stopNote = level === 1 ? 'Preflop is over. Level 1 stops at the flop.' : undefined;

  return (
    <div className="screen">
      <div className="play-bar">
        <label className="inline">
          Level
          <select id="level" value={level} onChange={(e) => changeLevel(Number(e.target.value) as LevelId)}>
            {([1, 2, 3, 4] as LevelId[]).map((id) => (
              <option key={id} value={id}>{id} · {LEVELS[id].name}</option>
            ))}
            <option value="5" disabled>5 · Multiway (coming)</option>
            <option value="6" disabled>6 · Thin value (coming)</option>
          </select>
        </label>
        <label className="toggle">
          <input id="lowstakes" type="checkbox" checked={lowStakes} onChange={(e) => setLowStakes(e.target.checked)} />
          Low-stakes adjustments
        </label>
        <button type="button" onClick={() => nextHand()}>New hand</button>
      </div>
      {level > 1 && (
        <p className="muted small level-note">
          {level === 2 ? 'You play preflop and the flop; the turn and river are checked down. ' : ''}
          Hands stay heads-up after preflop: players other than your opponent fold. Seat tags show each opponent's style.
        </p>
      )}

      <TableView state={state} seats={seats} hero={hero} />
      <HeroStrip cards={heroCards} tiles={heroTiles(state, hero)} madeHand={madeHand} />
      <Timeline rows={timeline(state, hero, phase !== 'result')} />

      {heroToAct && isPreflop && decision && (
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
          <ActionBar key={state.actions.length} state={state} onAct={act} disabled={heroEq === null} />
        </>
      )}
      {heroToAct && isPreflop && spot && !charted && (
        <>
          <section className="range-read">
            <h2>No chart for this line</h2>
            <p>{spot.label}: the preflop charts don't cover this spot (usually after limping and facing a raise), so this decision isn't graded.</p>
          </section>
          <ActionBar key={state.actions.length} state={state} onAct={act} />
        </>
      )}
      {heroToAct && !isPreflop && post && villain !== null && (
        <>
          <PostflopReadPanel
            sit={post.sit}
            villainRange={post.villainRange}
            title={`${state.players[villain].position} · ${villainLine(state.actions, villain)}`}
            profile={villainProfile}
            analysis={analysis}
            breakdown={breakdown}
            error={error}
          />
          <ActionBar key={state.actions.length} state={state} onAct={act} disabled={!analysis} />
        </>
      )}
      {phase === 'feedback' && pending?.kind === 'preflop' && (
        <FeedbackPanel fb={pending.feedback} decision={pending.decision} onContinue={cont} />
      )}
      {phase === 'feedback' && pending?.kind === 'postflop' && (
        <PostflopFeedbackPanel ref={fbRef} fb={pending.fb} analysis={pending.analysis} bb={pending.sit.bb} concept={conceptFor(pending.sit, pending.analysis)}>
          <button type="button" className="primary" onClick={cont}>Continue</button>
        </PostflopFeedbackPanel>
      )}
      {phase === 'result' && <HandResult state={state} hero={hero} log={log} onNext={() => nextHand()} stopNote={stopNote} />}
    </div>
  );
}
