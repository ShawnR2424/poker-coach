import { useState } from 'react';
import { describeScore, evaluate } from '../../engine/evaluator';
import { ActionBar } from './ActionBar';
import { HeroStrip } from './HeroStrip';
import { RangeRead } from './RangeRead';
import { SAMPLES } from './samples';
import { TableView } from './TableView';
import { Timeline } from './Timeline';
import { heroTiles, seatViews, timeline } from './view';

export function TableScreen() {
  const [spotId, setSpotId] = useState(SAMPLES[0].id);
  const [chosen, setChosen] = useState<string | null>(null);
  const spot = SAMPLES.find((s) => s.id === spotId)!;
  const { state, hero } = spot;
  const heroCards = state.players[hero].hole;
  const madeHand = state.board.length >= 3 ? describeScore(evaluate([...heroCards, ...state.board])) : null;

  return (
    <div className="screen">
      <nav className="spot-picker" aria-label="Sample hands">
        {SAMPLES.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`chip${s.id === spotId ? ' on' : ''}`}
            aria-pressed={s.id === spotId}
            onClick={() => { setSpotId(s.id); setChosen(null); }}
          >
            {s.title}
          </button>
        ))}
      </nav>
      <TableView state={state} seats={seatViews(state, hero, spot.profiles)} hero={hero} />
      <HeroStrip cards={heroCards} tiles={heroTiles(state, hero)} madeHand={madeHand} />
      <Timeline rows={timeline(state, hero)} />
      <RangeRead spot={spot} state={state} />
      <ActionBar key={spotId} state={state} onAct={(_, label) => setChosen(label)} />
      {chosen && (
        <p className="chosen" role="status">
          You chose <strong>{chosen}</strong>. Grading arrives in milestone 4.
        </p>
      )}
    </div>
  );
}
