// The practice loop for every level: deal a hand, show the range read at each hero decision,
// grade it, let opponents respond, and show the result.

import { useEffect, useMemo, useRef, useState } from 'react';
import { preflopCategory, categorizeRange, type CellCategory, type PreflopCategory } from '../../engine/categories';
import { formatCards } from '../../engine/cards';
import { describeScore, evaluate } from '../../engine/evaluator';
import { practiceHand } from '../../engine/game/drills';
import { advance, heroDecides, isMultiway, LEVEL_IDS, LEVELS, liveVillains as liveVillainsOf, profileOf, type GameHand, type LevelId } from '../../engine/game/levels';
import { applyAction, legalActions, type Action, type HandState } from '../../engine/hand';
import { postflopFacts, preflopFacts, type CoachFacts } from '../../engine/coach/explain';
import { breakEvenFoldPct, potOdds } from '../../engine/math';
import { conceptFor, multiwayConcept, postflopFeedback, type PostflopFeedback } from '../../engine/postflop/coach';
import { PROFILES } from '../../engine/postflop/model';
import { postflopHeroLine, rangeActionOf, rangeActions, type RangeAction, type RangeActions } from '../../engine/postflop/heroRange';
import { currentContext, narrowHand } from '../../engine/postflop/narrow';
import { interactionNote, multiwaySituationFromState } from '../../engine/postflop/multiway';
import { describeOption, gradePostflop, leaksAtRisk, situationFromState, type Analysis, type DecisionBasics } from '../../engine/postflop/recommend';
import {
  blockerCount, heroDecision, heroLineRead, nudge, opponentReads, playersBehind, preflopFeedback, preflopLeaksAtRisk,
  type Decision, type Feedback, type OpponentRead,
} from '../../engine/preflop/coach';
import { hasChart, spotFor } from '../../engine/preflop/spot';
import { NUM_COMBOS } from '../../engine/range';
import { makeRng, randomSeed } from '../../engine/rng';
import { handLesson, levelProgress, openLeaks, totals } from '../../engine/session/session';
import { adaptationFor, heroTendencies, type PostflopMove } from '../../engine/session/adapt';
import { replayOf } from '../../engine/session/replay';
import { currentHands, recordHand, useSessions } from '../session/store';
import { dollars } from '../table/format';
import { runClassEquity, runEquity } from '../../workers/equityClient';
import {
  comboTableReason, MultiwayReadPanel, PostflopFeedbackPanel, PostflopReadPanel, useMultiwayRead, usePostflopRead, villainLine,
  type OpponentView,
} from '../spots/PostflopPanels';
import { CoachVoice } from '../coach/CoachVoice';
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
  | { kind: 'preflop'; decision: Decision; feedback: Feedback; action: Action; facts: CoachFacts }
  | { kind: 'postflop'; fb: PostflopFeedback; analysis: Analysis; sit: DecisionBasics; action: Action; multiway: boolean; concept: string; facts: CoachFacts; split: RangeActions | null; chosenSplit: RangeAction };

/** Actions taken so far, not counting the blinds: a decision's step in the hand replay. */
const stepOf = (s: HandState) => s.actions.filter((a) => a.type !== 'post').length;

const LEVEL_KEY = 'level';
function loadLevel(): LevelId {
  try {
    const v = Number(localStorage.getItem(LEVEL_KEY));
    return (LEVEL_IDS as number[]).includes(v) ? (v as LevelId) : 1;
  } catch {
    return 1;
  }
}

/** Table size and stakes for new hands: 6-9 handed, $0.25/$0.50 or $0.50/$1. */
interface TableSetup { tableSize: number; sb: number; bb: number }
const STAKES = [{ sb: 25, bb: 50, label: '$0.25/$0.50' }, { sb: 50, bb: 100, label: '$0.50/$1' }];
const TABLE_SIZES = [6, 7, 8, 9];
const TABLE_KEY = 'table:v1';
function loadTable(): TableSetup {
  try {
    const t = JSON.parse(localStorage.getItem(TABLE_KEY) ?? 'null') as Partial<TableSetup> | null;
    const stakes = STAKES.find((x) => x.bb === t?.bb) ?? STAKES[0];
    return { tableSize: TABLE_SIZES.includes(t?.tableSize ?? 0) ? t!.tableSize! : 6, sb: stakes.sb, bb: stakes.bb };
  } catch {
    return { tableSize: 6, sb: STAKES[0].sb, bb: STAKES[0].bb };
  }
}

const FOCUS_KEY = 'focusLeaks';
function loadFocus(): boolean {
  try {
    return localStorage.getItem(FOCUS_KEY) !== '0';
  } catch {
    return true;
  }
}

const ADAPT_KEY = 'adaptiveOpponents';
function loadAdapt(): boolean {
  try {
    return localStorage.getItem(ADAPT_KEY) !== '0';
  } catch {
    return true;
  }
}

/** Running session totals on the Play screen, with curriculum progress for the current level. */
function SessionStrip({ level, onLevel }: { level: LevelId; onLevel: (l: LevelId) => void }) {
  const { current } = useSessions();
  const t = totals(current.hands);
  const open = openLeaks(current.hands).length;
  const prog = levelProgress(current.hands, level);
  const next = LEVEL_IDS.find((id) => id === level + 1);
  const sign = (x: number) => (x > 0 ? '+' : x < 0 ? '−' : '');
  return (
    <div className="session-strip small">
      <a href="#session" className="session-link">
        <span className="eyebrow">Session</span>
        <span className="num">{t.hands} hand{t.hands === 1 ? '' : 's'}</span>
        <span className={`num ${t.net > 0 ? 'up' : t.net < 0 ? 'down' : ''}`}>{sign(t.net)}{dollars(Math.abs(t.net))} ({sign(t.netBB)}{Math.abs(t.netBB).toFixed(1)}bb)</span>
        <span className="num">{open} open leak{open === 1 ? '' : 's'}</span>
      </a>
      <span className="muted">
        Level {level}: {prog.recent ? `${prog.good} of your last ${prog.recent} decisions without a mistake` : 'no graded decisions yet'}
      </span>
      {prog.ready && next && (
        <button type="button" className="primary" onClick={() => onLevel(next)}>Ready for level {next}: {LEVELS[next].name}</button>
      )}
    </div>
  );
}

export function GameScreen() {
  const rngRef = useRef(makeRng(randomSeed()));
  const [lowStakes, setLowStakes] = useState(true);
  const [level, setLevel] = useState<LevelId>(loadLevel);
  const [table, setTable] = useState<TableSetup>(loadTable);
  const opts = useMemo(() => ({ lowStakes, ...table }), [lowStakes, table]);
  const [focusLeaks, setFocusLeaks] = useState(loadFocus);
  const leaksFor = (on = focusLeaks) => (on ? openLeaks(currentHands()) : []);
  const [adaptive, setAdaptive] = useState(loadAdapt);
  const adaptFor = (on = adaptive) => (on ? adaptationFor(heroTendencies(currentHands())) : null);
  const [game, setGame] = useState<GameHand>(() => practiceHand(loadLevel(), rngRef.current, { lowStakes: true, ...loadTable() }, leaksFor(loadFocus()), adaptFor(loadAdapt())));
  const [state, setState] = useState<HandState>(game.state);
  const hero = game.hero;
  const [phase, setPhase] = useState<Phase>('decide');
  const [pending, setPending] = useState<Pending | null>(null);
  const [log, setLog] = useState<DecisionLog[]>([]);

  const heroCards = state.players[hero].hole;
  const isPreflop = state.street === 'preflop';
  const heroToAct = phase === 'decide' && state.toAct === hero;

  const nextHand = (lvl: LevelId = level, o = opts, adapt = adaptive) => {
    const g = practiceHand(lvl, rngRef.current, o, leaksFor(), adaptFor(adapt));
    setGame(g);
    const s0 = advance(g, g.state, rngRef.current, o);
    setState(s0);
    setPhase(heroDecides(g, s0) ? 'decide' : 'result');
    setPending(null);
    setLog([]);
    window.scrollTo({ top: 0 });
  };

  const changeTable = (patch: Partial<TableSetup>) => {
    const next = { ...table, ...patch };
    setTable(next);
    try { localStorage.setItem(TABLE_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
    nextHand(level, { ...opts, ...next });
  };

  const changeFocus = (on: boolean) => {
    setFocusLeaks(on);
    try { localStorage.setItem(FOCUS_KEY, on ? '1' : '0'); } catch { /* storage unavailable */ }
  };

  const changeAdaptive = (on: boolean) => {
    setAdaptive(on);
    try { localStorage.setItem(ADAPT_KEY, on ? '1' : '0'); } catch { /* storage unavailable */ }
    nextHand(level, opts, on);
  };

  // Record each finished hand in the session once.
  const recorded = useRef<GameHand | null>(null);
  useEffect(() => {
    if (phase !== 'result' || recorded.current === game) return;
    recorded.current = game;
    const me = state.players[hero];
    const decided = !!state.result || me.folded;
    const net = state.result ? state.result.net[hero] : me.folded ? -me.total : 0;
    const start = game.state;
    recordHand({
      at: new Date().toISOString(),
      level: game.level,
      spot: log[0]?.label ?? (start.street === 'preflop' ? spotFor(start, hero).label : `${STREET_LABEL[start.street]} ${formatCards(start.board)}`),
      hand: formatCards(me.hole),
      net,
      bb: state.config.bb,
      decided,
      decisions: log,
      lesson: handLesson(log, net, decided),
      replay: replayOf(state, hero, game.villains, game.profiles, lowStakes, game.adapt),
    });
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

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
    // Only the opponents who play on matter for the read.
    const live = liveVillainsOf(game, state);
    return game.villains.length ? all.filter((r) => live.includes(r.seat)) : all;
  }, [state, hero, opts, hypothetical, heroToAct, isPreflop, game]);
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
  const liveVillains = useMemo(
    () => liveVillainsOf(game, state),
    [game, state],
  );
  const postCtx = useMemo(() => {
    if (!heroToAct || isPreflop || !liveVillains.length) return null;
    const pre = state.actions.filter((a) => a.street === 'preflop' && a.type === 'raise');
    const views: (OpponentView & { seat: number })[] = liveVillains.map((seat) => {
      const profile = profileOf(game, seat);
      const n = narrowHand(state, seat, 'pool', opts, profile);
      return {
        seat,
        title: `${state.players[seat].position} · ${villainLine(state.actions, seat)}`,
        profile,
        range: n.range,
        lastStep: n.steps.length && n.steps[n.steps.length - 1].street === state.street ? n.steps[n.steps.length - 1] : undefined,
      };
    });
    const heroN = narrowHand(state, hero, 'baseline', opts);
    const heroPreflopAggressor = pre.length > 0 && pre[pre.length - 1].player === hero;
    const ctx = currentContext(state, hero);
    return {
      views,
      heroRange: heroN.range,
      heroPreflopAggressor,
      heroLine: postflopHeroLine(state, hero, heroN.range, heroN.steps, views.map((v) => v.range), heroPreflopAggressor).text,
      ctx,
      split: rangeActions(heroN.range, state.players[hero].hole, state.board, ctx, legalActions(state).raise !== null),
      comboReason: comboTableReason(state.street, pre.length >= 3),
    };
  }, [state, heroToAct, isPreflop, liveVillains, game, hero, opts]);
  const multiway = !!postCtx && postCtx.views.length > 1;

  const post = useMemo(() => {
    if (!postCtx || multiway) return null;
    const v = postCtx.views[0];
    return situationFromState(state, hero, v.seat, v.range, {
      heroRange: postCtx.heroRange,
      heroPreflopAggressor: postCtx.heroPreflopAggressor,
      villainProfile: v.profile,
    });
  }, [postCtx, multiway]); // eslint-disable-line react-hooks/exhaustive-deps
  const hu = usePostflopRead(post, post?.villainRange ?? null);

  const mwSit = useMemo(() => {
    if (!postCtx || !multiway) return null;
    return multiwaySituationFromState(state, hero, postCtx.views, {
      heroRange: postCtx.heroRange,
      heroPreflopAggressor: postCtx.heroPreflopAggressor,
    });
  }, [postCtx, multiway]); // eslint-disable-line react-hooks/exhaustive-deps
  const mw = useMultiwayRead(mwSit);
  const mwNote = useMemo(() => (mwSit ? interactionNote(state, hero, liveVillains) : ''), [mwSit]); // eslint-disable-line react-hooks/exhaustive-deps

  const postSit: DecisionBasics | null = post ?? mwSit;
  const analysis = multiway ? mw.result?.analysis ?? null : hu.analysis;

  const fbRef = useRef<HTMLElement>(null);
  useEffect(() => { if (phase === 'feedback' && pending?.kind === 'postflop') fbRef.current?.scrollIntoView({ block: 'start' }); }, [phase, pending]);

  const phaseAfter = (s2: HandState): Phase => (heroDecides(game, s2) ? 'decide' : 'result');

  // A line the charts or the model don't cover: play it, without a grade.
  const playUngraded = (action: Action) => {
    const s2 = advance(game, applyAction(state, action), rngRef.current, opts);
    setState(s2);
    setPhase(phaseAfter(s2));
  };
  // Every hero turn must show something to act with; this guards against a turn no panel covers.
  const covered = isPreflop ? !!decision || (!!spot && !charted) : !!(post || mwSit);

  const act = (action: Action, label: string) => {
    if (isPreflop && !charted) {
      playUngraded(action);
      return;
    }
    if (isPreflop) {
      if (!decision || heroEq === null) return;
      const blocker = reads.length && !hypothetical ? blockerCount(reads[0].range, heroCards) : null;
      const fb = preflopFeedback(state, hero, decision, action, Number.isNaN(heroEq) ? 0 : heroEq, blocker);
      setPending({ kind: 'preflop', decision, feedback: fb, action, facts: preflopFacts(decision, fb, label.toLowerCase(), formatCards(heroCards)) });
      setLog((l) => [...l, {
        label: decision.spot.label, hand: formatCards(heroCards), you: label.toLowerCase(),
        verdict: fb.grade.verdict, heading: fb.grade.heading, tags: fb.grade.tags,
        atRisk: preflopLeaksAtRisk(state, hero, decision),
        step: stepOf(state),
      }]);
    } else {
      if (!analysis || !postSit || !postCtx) return;
      const grade = gradePostflop(postSit, analysis, action);
      const fb = postflopFeedback(postSit, analysis, grade, [], [], { multiway });
      const concept = multiway ? multiwayConcept(analysis) : conceptFor(postSit, analysis);
      const facts = postflopFacts(`${STREET_LABEL[state.street]} ${formatCards(state.board)}`, formatCards(heroCards), analysis, fb, concept, postSit.bb, multiway);
      const chosenSplit = rangeActionOf(action.type, 'to' in action ? action.to : undefined, postCtx.ctx);
      setPending({ kind: 'postflop', fb, analysis, sit: postSit, action, multiway, concept, facts, split: postCtx.split, chosenSplit });
      setLog((l) => [...l, {
        label: `${STREET_LABEL[state.street]} ${formatCards(state.board)}`, hand: formatCards(heroCards),
        you: describeOption(grade.chosen.option).toLowerCase(), verdict: grade.verdict, heading: grade.heading, tags: grade.tags,
        atRisk: leaksAtRisk(postSit, analysis),
        step: stepOf(state),
        move: action.type as PostflopMove,
        bestMove: analysis.best.option.kind,
      }]);
    }
    setPhase('feedback');
  };

  const cont = () => {
    if (!pending) return;
    const s2 = advance(game, applyAction(state, pending.action), rngRef.current, opts);
    setPending(null);
    setState(s2);
    setPhase(phaseAfter(s2));
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
            {LEVEL_IDS.map((id) => (
              <option key={id} value={id}>{id} · {LEVELS[id].name}</option>
            ))}
          </select>
        </label>
        <label className="inline">
          Table
          <select id="table-size" value={table.tableSize} onChange={(e) => changeTable({ tableSize: Number(e.target.value) })}>
            {TABLE_SIZES.map((n) => <option key={n} value={n}>{n === 6 ? '6-max' : `${n}-handed`}</option>)}
          </select>
        </label>
        <label className="inline">
          Stakes
          <select id="stakes" value={table.bb} onChange={(e) => { const st = STAKES.find((x) => x.bb === Number(e.target.value))!; changeTable({ sb: st.sb, bb: st.bb }); }}>
            {STAKES.map((st) => <option key={st.bb} value={st.bb}>{st.label}</option>)}
          </select>
        </label>
        <label className="toggle">
          <input id="lowstakes" type="checkbox" checked={lowStakes} onChange={(e) => setLowStakes(e.target.checked)} />
          Low-stakes adjustments
        </label>
        <label className="toggle">
          <input id="focusleaks" type="checkbox" checked={focusLeaks} onChange={(e) => changeFocus(e.target.checked)} />
          Practice my leaks
        </label>
        <label className="toggle">
          <input id="adaptive" type="checkbox" checked={adaptive} onChange={(e) => changeAdaptive(e.target.checked)} />
          Opponents adapt to me
        </label>
        <button type="button" onClick={() => nextHand()}>New hand</button>
      </div>
      <SessionStrip level={level} onLevel={changeLevel} />
      {level > 1 && game.adapt && (
        <div className="adapt-note small">
          <span className="eyebrow">Opponents have adjusted to you</span>
          {game.adapt.adjustments.map((a) => <p key={a.kind}>{a.text}</p>)}
        </div>
      )}
      {game.focus && (
        <p className="focus-note small">
          <span className="eyebrow">Leak practice</span>{' '}
          {game.drilled
            ? `This hand was played up to a decision where “${game.focus}” can show up. Your earlier decisions were made for you by the trainer's default strategy and aren't graded.`
            : `This spot is where “${game.focus}” tends to show up.`}
        </p>
      )}
      {level > 1 && (
        <p className="muted small level-note">
          {level === 2 ? 'You play preflop and the flop; the turn and river are checked down. ' : ''}
          {LEVELS[level].riverOnly ? 'Earlier streets play themselves; you decide on the river with a medium-strength hand: bet thin for value, check, or catch a bluff. ' : ''}
          {isMultiway(level)
            ? 'Two opponents play on with you, so most flops are three-way; everyone else folds. '
            : 'Hands stay heads-up after preflop: players other than your opponent fold. '}
          Seat tags show each opponent's style.
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
      {heroToAct && !covered && (
        <>
          <section className="range-read">
            <h2>No read for this spot</h2>
            <p>The trainer has no range read for this decision, so it isn't graded. Play it and the hand continues.</p>
          </section>
          <ActionBar key={state.actions.length} state={state} onAct={playUngraded} />
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
      {heroToAct && !isPreflop && post && postCtx && (
        <>
          <PostflopReadPanel
            sit={post}
            view={postCtx.views[0]}
            analysis={hu.analysis}
            eqs={hu.eqs}
            breakdown={hu.breakdown}
            error={hu.error}
            comboReason={postCtx.comboReason}
            heroLine={postCtx.heroLine}
            folded={folded}
          />
          <ActionBar key={state.actions.length} state={state} onAct={act} disabled={!analysis} />
        </>
      )}
      {heroToAct && !isPreflop && mwSit && postCtx && (
        <>
          <MultiwayReadPanel
            sit={mwSit}
            views={postCtx.views}
            note={mwNote}
            result={mw.result}
            error={mw.error}
            comboReason={postCtx.comboReason}
            heroLine={postCtx.heroLine}
            folded={folded}
          />
          <ActionBar key={state.actions.length} state={state} onAct={act} disabled={!analysis} />
        </>
      )}
      {phase === 'feedback' && pending?.kind === 'preflop' && (
        <FeedbackPanel fb={pending.feedback} decision={pending.decision} onContinue={cont} voice={<CoachVoice facts={pending.facts} />} />
      )}
      {phase === 'feedback' && pending?.kind === 'postflop' && (
        <PostflopFeedbackPanel
          ref={fbRef}
          fb={pending.fb}
          analysis={pending.analysis}
          bb={pending.sit.bb}
          concept={pending.concept}
          multiway={pending.multiway}
          split={pending.split ?? undefined}
          chosenSplit={pending.chosenSplit}
          voice={<CoachVoice facts={pending.facts} />}
        >
          <button type="button" className="primary" onClick={cont}>Continue</button>
        </PostflopFeedbackPanel>
      )}
      {phase === 'result' && <HandResult state={state} hero={hero} log={log} onNext={() => nextHand()} stopNote={stopNote} />}
    </div>
  );
}
