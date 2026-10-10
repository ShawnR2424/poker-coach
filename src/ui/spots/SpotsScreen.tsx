// Postflop practice spots: the range read, an action, then a verdict with the EV-by-size table.

import { useEffect, useMemo, useRef, useState } from 'react';
import { formatCards, parseCards } from '../../engine/cards';
import { postflopFacts } from '../../engine/coach/explain';
import { describeScore, evaluate } from '../../engine/evaluator';
import { legalActions, type Action } from '../../engine/hand';
import { postflopFeedback, type PostflopFeedback } from '../../engine/postflop/coach';
import { postflopHeroLine, rangeActionOf, rangeActions, type RangeAction } from '../../engine/postflop/heroRange';
import { currentContext } from '../../engine/postflop/narrow';
import { gradePostflop, situationFromState } from '../../engine/postflop/recommend';
import { buildSpot, POSTFLOP_SPOTS } from '../../engine/postflop/spots';
import { CoachVoice } from '../coach/CoachVoice';
import { ActionBar } from '../table/ActionBar';
import { HeroStrip } from '../table/HeroStrip';
import { TableView } from '../table/TableView';
import { Timeline } from '../table/Timeline';
import { heroTiles, seatViews, STREET_LABEL, timeline } from '../table/view';
import { comboTableReason, PostflopFeedbackPanel, PostflopReadPanel, usePostflopRead, villainLine } from './PostflopPanels';

export function SpotsScreen() {
  const [idx, setIdx] = useState(0);
  const [fb, setFb] = useState<PostflopFeedback | null>(null);
  const [chosenSplit, setChosenSplit] = useState<RangeAction | null>(null);

  const spot = useMemo(() => buildSpot(POSTFLOP_SPOTS[idx]), [idx]);
  const { state, hero, villain, def } = spot;
  const sit = useMemo(
    () => situationFromState(state, hero, villain, spot.villainRange, { heroRange: spot.heroRange, heroPreflopAggressor: spot.heroPreflopAggressor }),
    [spot], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const { analysis, breakdown, eqs, error } = usePostflopRead(sit, spot.villainRange);
  const view = useMemo(
    () => ({ title: `${state.players[villain].position} · ${villainLine(state.actions, villain)}`, range: spot.villainRange }),
    [spot], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const heroRead = useMemo(() => {
    const ctx = currentContext(state, hero);
    return {
      ctx,
      line: postflopHeroLine(state, hero, spot.heroRange, spot.heroSteps, [spot.villainRange], spot.heroPreflopAggressor).text,
      split: rangeActions(spot.heroRange, state.players[hero].hole, state.board, ctx, legalActions(state).raise !== null),
    };
  }, [spot]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => setFb(null), [spot]);
  const fbRef = useRef<HTMLElement>(null);
  useEffect(() => { if (fb) fbRef.current?.scrollIntoView({ block: 'start' }); }, [fb]);

  const act = (action: Action) => {
    if (!analysis) return;
    const grade = gradePostflop(sit, analysis, action);
    setChosenSplit(rangeActionOf(action.type, 'to' in action ? action.to : undefined, heroRead.ctx));
    setFb(postflopFeedback(sit, analysis, grade, state.players[villain].hole, parseCards(def.board)));
  };

  const go = (i: number) => {
    setIdx(i);
    window.scrollTo({ top: 0 });
  };
  const seats = seatViews(state, hero, {}, new Set(), true);
  const heroCards = state.players[hero].hole;
  const madeHand = describeScore(evaluate([...heroCards, ...state.board]));

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
        <PostflopReadPanel
          sit={sit}
          view={view}
          analysis={analysis}
          eqs={eqs}
          breakdown={breakdown}
          error={error}
          comboReason={comboTableReason(sit.street, false)}
          heroLine={heroRead.line}
        />
      )}
      {!fb && <ActionBar key={idx} state={state} onAct={(a) => act(a)} disabled={!analysis} />}

      {fb && analysis && (
        <PostflopFeedbackPanel
          ref={fbRef}
          fb={fb}
          analysis={analysis}
          bb={sit.bb}
          concept={def.concept}
          split={heroRead.split ?? undefined}
          chosenSplit={chosenSplit ?? undefined}
          voice={<CoachVoice facts={postflopFacts(`${STREET_LABEL[state.street]} ${formatCards(state.board)}`, formatCards(heroCards), analysis, fb, def.concept, sit.bb)} />}
        >
          <button type="button" onClick={() => setFb(null)}>Try this spot again</button>
          <button type="button" className="primary" onClick={() => go((idx + 1) % POSTFLOP_SPOTS.length)}>Next spot</button>
        </PostflopFeedbackPanel>
      )}
    </div>
  );
}
