// A tournament mistake dealt again in the Review tab: the same table, stacks, payouts and hand,
// with the ranges worked out again and the answer graded and explained as in Tournament mode.

import { useEffect, useState } from 'react';
import { LEARNED_AFTER, type TournamentCard } from '../../engine/review/review';
import { answer as grade, solveSpot, type SolvedSpot, type TournamentAnswer } from '../../engine/tournament/spots';
import type { CardProps } from '../review/ReviewScreen';
import { day } from '../review/ReviewScreen';
import { scheduleText } from '../review/schedule';
import { answer, remove } from '../review/store';
import { Feedback, playAmount, SpotView } from './TournamentScreen';
import './tournament.css';

const bb = (x: number) => `${+x.toFixed(1)}bb`;

export function TournamentReviewCard({ card, left, after, onNext }: CardProps<TournamentCard>) {
  const [solved, setSolved] = useState<SolvedSpot | null>(null);
  const [failed, setFailed] = useState(false);
  const [result, setResult] = useState<TournamentAnswer | null>(null);

  // Solving takes a moment, so the card paints "Working out the ranges" first.
  useEffect(() => {
    const id = setTimeout(() => {
      try {
        const { played: _played, kind, ...spot } = card.t;
        setSolved(solveSpot(kind, spot));
      } catch {
        setFailed(true);
      }
    }, 0);
    return () => clearTimeout(id);
  }, [card]);

  const act = (played: boolean) => {
    if (!solved || result) return;
    const a = grade(solved, played);
    setResult(a);
    answer(card.id, a.verdict);
  };
  const drop = () => { remove(card.id); onNext(); };

  const head = (
    <div className="review-card-head">
      <div>
        <p className="eyebrow">Tournament · {card.spot} · played {day(card.at)}</p>
        <h2 id="rc-h">{card.label}: what do you do?</h2>
      </div>
      <p className="small muted">{card.box === 0 ? (card.reviews ? 'Missed last time' : 'New card') : `Box ${card.box + 1} of ${LEARNED_AFTER}`}{left ? ` · ${left} more due` : ''}</p>
    </div>
  );

  if (failed) {
    return (
      <section className="panel review-card" aria-labelledby="rc-h">
        {head}
        <p>This spot can no longer be graded: Tournament mode has changed since it was played.</p>
        <div className="fb-actions"><button type="button" className="primary" onClick={drop}>Remove it and go on</button></div>
      </section>
    );
  }

  return (
    <section className="panel review-card t-review" aria-labelledby="rc-h">
      {head}
      {!solved ? (
        <p className="muted">Working out the ranges for this table…</p>
      ) : (
        <>
          <SpotView s={solved} heading={<h3 id="t-spot-h" className="sr-only">{card.label}</h3>} />
          {!result ? (
            <div className="action-bar">
              <div className="action-buttons">
                <button type="button" className="act fold" onClick={() => act(false)}>Fold</button>
                <button type="button" className="act allin" onClick={() => act(true)}>
                  {solved.kind === 'call' ? 'Call' : 'All-in'}
                  <span className="num">{bb(playAmount(solved))}</span>
                </button>
              </div>
            </div>
          ) : (
            <>
              <p className="first-time small">
                The first time you chose <strong>{card.you}</strong>: {card.heading}. {scheduleText(after, result.verdict)}
              </p>
              <Feedback s={solved} a={result} onNext={onNext} nextLabel="Next card">
                {after && <button type="button" onClick={drop}>Remove from deck</button>}
              </Feedback>
            </>
          )}
        </>
      )}
    </section>
  );
}
