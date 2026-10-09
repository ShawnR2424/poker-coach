import { comboCount, parseRange, removeDead } from '../../engine/range';
import type { HandState } from '../../engine/hand';
import { RangeGrid } from '../RangeGrid';
import type { SampleSpot } from './samples';

/** Milestone 2 layout of the range read panel, filled with hand-written sample reads. */
export function RangeRead({ spot, state }: { spot: SampleSpot; state: HandState }) {
  const heroCards = state.players[spot.hero].hole;
  const dead = [...heroCards, ...state.board];
  const folded = state.players.filter((p, i) => p.folded && i !== spot.hero).map((p) => p.position);
  return (
    <section className="range-read" aria-labelledby="rr-h">
      <div className="rr-head">
        <h2 id="rr-h">Range read</h2>
        <span className="sample-tag">Sample read · live model in milestones 3 and 5</span>
      </div>
      {spot.interaction && <p className="interaction">{spot.interaction}</p>}
      {spot.reads.map((r) => {
        const range = parseRange(r.range);
        return (
          <article className="opp" key={r.seat}>
            <h3>{r.line}</h3>
            <p className="range-text"><code>{r.range}</code></p>
            <p className="muted small num">
              {comboCount(removeDead(range, dead)).toFixed(0)} combos after card removal ({comboCount(range).toFixed(0)} before)
            </p>
            <p>{r.note}</p>
            <RangeGrid range={range} dead={dead} hero={heroCards} />
          </article>
        );
      })}
      {folded.length > 0 && <p className="folded-line muted">{folded.join(', ')} folded and are out of the hand.</p>}
      <div className="hero-read">
        <p className="eyebrow">What your line says</p>
        <p>{spot.heroRead}</p>
      </div>
      <div className="nudge">
        <p className="eyebrow">What the read tells you</p>
        <p>{spot.nudge}</p>
      </div>
    </section>
  );
}
