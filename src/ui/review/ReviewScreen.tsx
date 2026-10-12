// Mistake review: deals the spots you got wrong again, one card at a time, and grades the new
// answer with the same feedback as the Play tab. Cards come back on a growing schedule until
// they are learned.

import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { describeScore, evaluate } from '../../engine/evaluator';
import type { Action, HandState } from '../../engine/hand';
import { PROFILES, type ProfileId } from '../../engine/postflop/model';
import {
  canGrade, cardState, dueCards, gradeCard, INTERVAL_DAYS, isTournamentCard, LEARNED_AFTER, summarizeDeck, type CardResult, type HandCard, type ReviewCard,
} from '../../engine/review/review';
import { IMPORTED_LEVEL } from '../../engine/session/import';
import { FeedbackPanel } from '../play/FeedbackPanel';
import { withSuits } from '../session/ReplayView';
import { PostflopFeedbackPanel } from '../spots/PostflopPanels';
import { ActionBar } from '../table/ActionBar';
import { HeroStrip } from '../table/HeroStrip';
import { TableView } from '../table/TableView';
import { Timeline } from '../table/Timeline';
import { heroTiles, seatViews, timeline } from '../table/view';
import { scheduleText } from './schedule';
import { answer, remove, useDeck } from './store';
import '../session/session.css';
import '../spots/spots.css';
import './review.css';

// Tournament cards work out their ranges with Tournament mode's equity table, so they load only when dealt.
const TournamentCardView = lazy(() => import('../tournament/TournamentReviewCard').then((m) => ({ default: m.TournamentReviewCard })));

export const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/** "in 10 minutes", "tomorrow", "in 3 days". */
export function untilText(iso: string, now: Date): string {
  const min = Math.max(0, Math.round((Date.parse(iso) - now.getTime()) / 60_000));
  if (min < 60) return min <= 1 ? 'in a minute' : `in ${min} minutes`;
  const h = Math.round(min / 60);
  if (h < 20) return `in ${h} hour${h === 1 ? '' : 's'}`;
  const d = Math.round(min / 1440);
  return d <= 1 ? 'tomorrow' : `in ${d} days`;
}

export function ReviewScreen() {
  const deck = useDeck();
  const [now, setNow] = useState(() => new Date());
  // Re-check what is due now and then, so a card answered wrongly comes back in the same sitting.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  const [shown, setShown] = useState<ReviewCard | null>(null);
  const due = useMemo(() => dueCards(deck, now), [deck, now]);
  const summary = useMemo(() => summarizeDeck(deck, now), [deck, now]);
  // Hold the card on screen once dealt, so a newly due card never replaces it mid-answer.
  useEffect(() => { if (!shown && due[0]) setShown(due[0]); }, [shown, due]);
  const card = shown ?? due[0] ?? null;

  return (
    <div className="screen review">
      <div className="session-head">
        <div>
          <p className="eyebrow">Mistake review</p>
          <h1>Play your mistakes again</h1>
        </div>
      </div>
      <div className="tiles">
        <div className="stat"><p className="eyebrow">Due now</p><p className="stat-value num">{summary.due}</p></div>
        <div className="stat"><p className="eyebrow">In the deck</p><p className="stat-value num">{summary.total}</p></div>
        <div className="stat"><p className="eyebrow">Learned</p><p className="stat-value num">{summary.learned}</p></div>
        <div className="stat">
          <p className="eyebrow">Next card</p>
          <p className="stat-value">{summary.due ? 'now' : summary.nextDue ? untilText(summary.nextDue, now) : '–'}</p>
        </div>
      </div>

      {card ? (
        isTournamentCard(card) ? (
          <Suspense key={card.id} fallback={<section className="panel"><p className="muted">Loading the tournament spot…</p></section>}>
            <TournamentCardView
              card={card}
              left={due.filter((c) => c.id !== card.id).length}
              after={deck.cards.find((c) => c.id === card.id)}
              onNext={() => { setShown(null); setNow(new Date()); }}
            />
          </Suspense>
        ) : (
          <CardView
            key={card.id}
            card={card}
            left={due.filter((c) => c.id !== card.id).length}
            after={deck.cards.find((c) => c.id === card.id)}
            onNext={() => { setShown(null); setNow(new Date()); }}
          />
        )
      ) : (
        <section className="panel empty">
          <h2>{summary.total ? 'Nothing due right now' : 'No mistakes to review yet'}</h2>
          <p>
            {summary.total
              ? `Every card in the deck is scheduled for later; the next one comes up ${summary.nextDue ? untilText(summary.nextDue, now) : 'later'}.`
              : 'Each decision graded a mistake on the Play tab, in imported hands or in Tournament mode becomes a card here.'}
            {' '}A card deals the same spot again with the opponents' cards hidden. Each right answer spaces it out further ({INTERVAL_DAYS.slice(1, -1).join(', ')}, then {INTERVAL_DAYS[INTERVAL_DAYS.length - 1]} days), and after {LEARNED_AFTER} right answers in a row it is learned. Get it wrong and it comes back in a few minutes.
          </p>
          {!summary.total && (
            <div className="import-actions">
              <a className="button primary" href="#table">Go to Play</a>
              <a className="button" href="#import">Import hands</a>
            </div>
          )}
        </section>
      )}

      {deck.cards.length > 0 && (
        <section className="panel" aria-labelledby="boxes-h">
          <h2 id="boxes-h">Cards by box</h2>
          <p className="small muted">A right answer moves a card one box along and spaces it out further; a mistake sends it back to the first box.</p>
          <ol className="boxes">
            {summary.boxes.map((n, b) => (
              <li key={b}>
                <span className="box-n num">{n}</span>
                <span className="small">{b === 0 ? 'New or missed' : `Box ${b + 1} · back after ${INTERVAL_DAYS[b]} day${INTERVAL_DAYS[b] === 1 ? '' : 's'}`}</span>
              </li>
            ))}
            <li><span className="box-n num">{summary.learned}</span><span className="small">Learned</span></li>
          </ol>
        </section>
      )}
    </div>
  );
}

export interface CardProps<C extends ReviewCard = HandCard> {
  card: C;
  left: number;
  /** The card as scheduled now (missing once it is learned or removed). */
  after: ReviewCard | undefined;
  onNext: () => void;
}

function CardView({ card, left, after, onNext }: CardProps) {
  const r = card.replay;
  const hero = r.hero;
  const s: HandState | null = useMemo(() => { try { return cardState(card); } catch { return null; } }, [card]);
  const gradable = useMemo(() => (s ? canGrade(card, s) : false), [card, s]);
  const [result, setResult] = useState<{ res: CardResult; label: string } | null>(null);
  const [failed, setFailed] = useState(false);

  const respond = (action: Action, label: string) => {
    if (!s) return;
    try {
      const res = gradeCard(card, s, action);
      setResult({ res, label });
      answer(card.id, res.verdict);
    } catch {
      setFailed(true);
    }
  };
  const drop = () => { remove(card.id); onNext(); };

  const head = (
    <div className="review-card-head">
      <div>
        <p className="eyebrow">{card.level === IMPORTED_LEVEL ? 'Imported hand' : `Level ${card.level}`} · played {day(card.at)} · {card.spot}</p>
        <h2 id="rc-h">{withSuits(card.label)}: what do you do?</h2>
      </div>
      <p className="small muted">{card.box === 0 ? (card.reviews ? 'Missed last time' : 'New card') : `Box ${card.box + 1} of ${LEARNED_AFTER}`}{left ? ` · ${left} more due` : ''}</p>
    </div>
  );

  if (!s || !gradable || failed) {
    return (
      <section className="panel review-card" aria-labelledby="rc-h">
        {head}
        <p>This spot can no longer be graded: the trainer's charts or model have changed since the hand was played.</p>
        <div className="fb-actions"><button type="button" className="primary" onClick={drop}>Remove it and go on</button></div>
      </section>
    );
  }

  const labels: Record<number, string> = card.level === IMPORTED_LEVEL || card.level === 1
    ? {}
    : Object.fromEntries(Object.entries(r.profiles).map(([seat, id]) => [seat, PROFILES[id as ProfileId]?.short ?? '']));
  for (const f of r.fillers ?? []) labels[f] = 'empty seat';
  const heroCards = s.players[hero].hole;
  const made = s.board.length >= 3 ? describeScore(evaluate([...heroCards, ...s.board])) : null;

  const firstTime = (
    <p className="first-time small">
      The first time you chose <strong>{card.you}</strong>: {card.heading}.{' '}
      {scheduleText(after, result?.res.verdict)}
    </p>
  );
  const extra = after ? <button type="button" onClick={drop}>Remove from deck</button> : null;

  return (
    <section className="panel review-card" aria-labelledby="rc-h">
      {head}
      <TableView state={s} seats={seatViews(s, hero, labels, new Set(), true)} hero={hero} />
      <HeroStrip cards={heroCards} tiles={heroTiles(s, hero)} madeHand={made} />
      <Timeline rows={timeline(s, hero, true)} />
      {!result && <ActionBar key={card.id} state={s} onAct={respond} />}
      {result && firstTime}
      {result && result.res.kind === 'preflop' && (
        <FeedbackPanel fb={result.res.feedback} decision={result.res.decision} onContinue={onNext} continueLabel="Next card">
          {extra}
        </FeedbackPanel>
      )}
      {result && result.res.kind === 'postflop' && (
        <PostflopFeedbackPanel fb={result.res.feedback} analysis={result.res.analysis} bb={result.res.sit.bb} concept={result.res.concept} multiway={result.res.multiway}>
          <button type="button" className="primary" onClick={onNext}>Next card</button>
          {extra}
        </PostflopFeedbackPanel>
      )}
    </section>
  );
}
