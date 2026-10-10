// Range quizzes: paint an opponent's range for a preflop line, then estimate your equity against it
// on a flop. Both answers are scored against the trainer's charts and an exact equity enumeration.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  addResult, equityBand, KIND_LABEL, makeQuiz, parseHistory, QUIZ_KINDS, rangeBand, scoreRange, summarizeQuizzes,
  type Quiz, type QuizKind, type QuizResult, type RangeScore,
} from '../../engine/quiz/quiz';
import { classOfCombo, type HandClass } from '../../engine/range';
import { makeRng, randomSeed } from '../../engine/rng';
import { runEquity } from '../../workers/equityClient';
import { PlayingCard } from '../PlayingCard';
import { PaintGrid } from './PaintGrid';
import '../session/session.css';
import './quiz.css';

const HISTORY_KEY = 'quiz-history';
const pct = (x: number, digits = 0) => `${(x * 100).toFixed(digits)}%`;
const pts = (x: number) => `${Math.abs(x).toFixed(1)} points`;

function loadHistory(): QuizResult[] {
  try { return parseHistory(localStorage.getItem(HISTORY_KEY)); } catch { return []; }
}
function saveHistory(h: QuizResult[]) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(h)); } catch { /* storage unavailable */ }
}

type Stage = 'paint' | 'equity' | 'done';

export function QuizScreen() {
  const rng = useRef(makeRng(randomSeed()));
  const [lowStakes, setLowStakes] = useState(true);
  const [kinds, setKinds] = useState<QuizKind[]>([...QUIZ_KINDS]);
  const [quiz, setQuiz] = useState<Quiz>(() => makeQuiz(rng.current, { lowStakes: true }));
  const [painted, setPainted] = useState<Set<HandClass>>(() => new Set());
  const [stage, setStage] = useState<Stage>('paint');
  const [score, setScore] = useState<RangeScore | null>(null);
  const [guess, setGuess] = useState(50);
  const [equity, setEquity] = useState<number | null>(null);
  const [equityError, setEquityError] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const [history, setHistory] = useState<QuizResult[]>(loadHistory);
  const resultRef = useRef<HTMLElement>(null);

  // Work out the true equity in the background as soon as the quiz is dealt.
  useEffect(() => {
    let live = true;
    setEquity(null);
    setEquityError(false);
    runEquity(quiz.hand, quiz.board, [quiz.range])
      .then((r) => { if (live) setEquity(r.result.equity * 100); })
      .catch(() => { if (live) setEquityError(true); });
    return () => { live = false; };
  }, [quiz]);

  useEffect(() => { if (stage !== 'paint') resultRef.current?.scrollIntoView({ block: 'start' }); }, [stage]);

  const deal = (opts = { lowStakes, kinds }) => {
    setQuiz(makeQuiz(rng.current, { lowStakes: opts.lowStakes, kinds: opts.kinds }));
    setPainted(new Set());
    setStage('paint');
    setScore(null);
    setGuess(50);
    setSkipped(false);
    window.scrollTo({ top: 0 });
  };

  const checkRange = () => {
    setScore(scoreRange(painted, quiz.range));
    setStage('equity');
  };

  const finish = (skip: boolean) => {
    if (!score) return;
    if (!skip && equity === null) return;
    setSkipped(skip);
    setStage('done');
    const r: QuizResult = {
      at: new Date().toISOString(),
      kind: quiz.kind,
      match: score.match,
      best: score.best,
      widthMiss: (score.paintedPct - score.truePct) * 100,
      ...(skip || equity === null ? {} : { equityMiss: guess - equity }),
    };
    const h = addResult(history, r);
    setHistory(h);
    saveHistory(h);
  };

  const toggleKind = (k: QuizKind) => {
    const next = kinds.includes(k) ? kinds.filter((x) => x !== k) : QUIZ_KINDS.filter((x) => x === k || kinds.includes(x));
    if (!next.length) return;
    setKinds(next);
    if (stage === 'paint' && !painted.size) deal({ lowStakes, kinds: next });
  };

  const setStakes = (on: boolean) => {
    setLowStakes(on);
    if (stage === 'paint' && !painted.size) deal({ lowStakes: on, kinds });
  };

  const heroClass = classOfCombo(quiz.hand[0], quiz.hand[1]);
  const paintedPct = useMemo(() => scoreRange(painted, quiz.range).paintedPct, [painted, quiz]);
  const summary = useMemo(() => summarizeQuizzes(history), [history]);

  return (
    <div className="screen quiz">
      <div className="quiz-head">
        <h1>Range quizzes</h1>
        <div className="quiz-filters" role="group" aria-label="Quiz options">
          {QUIZ_KINDS.map((k) => (
            <button key={k} type="button" className={`chip-toggle${kinds.includes(k) ? ' on' : ''}`} aria-pressed={kinds.includes(k)} onClick={() => toggleKind(k)}>
              {KIND_LABEL[k]}
            </button>
          ))}
          <label className="inline">
            <input id="quiz-lowstakes" type="checkbox" checked={lowStakes} onChange={(e) => setStakes(e.target.checked)} />
            Low-stakes opponents
          </label>
        </div>
      </div>

      <section className="panel" aria-labelledby="quiz-q">
        <p className="eyebrow">6-max, 100bb</p>
        <h2 id="quiz-q">{quiz.story}</h2>
        <div className="quiz-hand">
          <span className="muted small">Your hand</span>
          <span className="cards">{quiz.hand.map((c) => <PlayingCard key={c} card={c} size="sm" />)}</span>
        </div>
        {stage === 'paint' ? (
          <>
            <p>{quiz.rangeAsk} Tap or drag across the grid to paint hands in or out.</p>
            <PaintGrid painted={painted} onChange={setPainted} hero={heroClass} />
            <p className="muted small" aria-live="polite">
              You have painted <span className="num" id="painted-pct">{pct(paintedPct, 1)}</span> of all hands.
            </p>
            <div className="actions">
              <button type="button" onClick={() => setPainted(new Set())} disabled={!painted.size}>Clear</button>
              <button type="button" className="primary" id="check-range" onClick={checkRange} disabled={!painted.size}>Check my range</button>
            </div>
          </>
        ) : (
          score && <RangeResult score={score} quiz={quiz} hero={heroClass} />
        )}
      </section>

      {stage !== 'paint' && score && (
        <section className="panel" aria-labelledby="equity-q" ref={resultRef}>
          <p className="eyebrow">Your equity</p>
          <h2 id="equity-q">The flop comes</h2>
          <div className="quiz-board">
            {quiz.board.map((c) => <PlayingCard key={c} card={c} />)}
          </div>
          <p>Before anyone bets, what share of the pot do you win on average against the whole range above?</p>
          {stage === 'equity' ? (
            <>
              <label className="equity-guess">
                <span>Your estimate: <strong className="num" id="guess-out">{guess}%</strong></span>
                <input id="equity-guess" type="range" min={0} max={100} step={1} value={guess} onChange={(e) => setGuess(Number(e.target.value))} />
              </label>
              <div className="actions">
                <button type="button" onClick={() => finish(true)}>Skip</button>
                <button type="button" className="primary" id="check-equity" onClick={() => finish(false)} disabled={equity === null}>
                  {equity === null && !equityError ? 'Working it out…' : 'Check my equity'}
                </button>
              </div>
              {equityError && <p className="muted small">The equity could not be worked out for this flop. Skip to the next quiz.</p>}
            </>
          ) : (
            <EquityResult equity={equity} guess={guess} skipped={skipped} />
          )}
          {stage === 'done' && (
            <div className="actions">
              <button type="button" className="primary" id="next-quiz" onClick={() => deal()}>Next quiz</button>
            </div>
          )}
        </section>
      )}

      <section className="panel" aria-labelledby="quiz-history-h">
        <h2 id="quiz-history-h">How you're doing</h2>
        {summary.count ? (
          <>
            <div className="tiles" id="quiz-summary">
              <div className="stat">
                <p className="eyebrow">Quizzes</p>
                <p className="stat-value num">{summary.count}</p>
                <p className="muted small">averages over the latest 20</p>
              </div>
              <div className="stat">
                <p className="eyebrow">Range match</p>
                <p className="stat-value num">{pct(summary.match!)}</p>
                <p className="muted small">{pct(summary.ofBest!)} of the best possible</p>
              </div>
              <div className="stat">
                <p className="eyebrow">Range width</p>
                <p className="stat-value num">{summary.width! > 0 ? '+' : summary.width! < 0 ? '−' : ''}{Math.abs(summary.width!).toFixed(1)}</p>
                <p className="muted small">{widthText(summary.width!)}</p>
              </div>
              <div className="stat">
                <p className="eyebrow">Equity miss</p>
                <p className="stat-value num">{summary.equityMiss === null ? '–' : summary.equityMiss.toFixed(1)}</p>
                <p className="muted small">{summary.equityBias === null ? 'no equity answers yet' : biasText(summary.equityBias)}</p>
              </div>
            </div>
            <p className="muted small">
              {QUIZ_KINDS.filter((k) => summary.byKind[k]).map((k) => `${KIND_LABEL[k]}: ${pct(summary.byKind[k]!.match)} match over ${summary.byKind[k]!.count}`).join(' · ')}
            </p>
          </>
        ) : (
          <p className="muted">Your scores show up here after your first quiz. They are saved in this browser only.</p>
        )}
      </section>
    </div>
  );
}

const widthText = (w: number) =>
  Math.abs(w) < 1 ? 'points of all hands: about right' : w > 0 ? 'points of all hands too wide' : 'points of all hands too tight';
const biasText = (b: number) =>
  Math.abs(b) < 1 ? 'points off, no lean either way' : `points off, guessing ${b > 0 ? 'high' : 'low'} by ${Math.abs(b).toFixed(1)} on average`;

const BAND_TEXT = { 'spot on': 'Spot on', close: 'Close', off: 'Off', 'far off': 'Far off' } as const;

function RangeResult({ score, quiz, hero }: { score: RangeScore; quiz: Quiz; hero: HandClass }) {
  const band = rangeBand(score.match, score.best);
  const wide = score.paintedPct - score.truePct;
  return (
    <div className="quiz-result" id="range-result">
      <p className={`verdict band-${band.replace(' ', '-')}`}>
        <strong>{BAND_TEXT[band]}.</strong> Your painting matches <span className="num">{pct(score.match)}</span> of their range
        {score.best < 0.999 && <> (the best any painting can do here is <span className="num">{pct(score.best)}</span>, because they play some hands only part of the time)</>}.
      </p>
      <p>
        You painted <span className="num">{pct(score.paintedPct, 1)}</span> of hands; they play <span className="num">{pct(score.truePct, 1)}</span>.{' '}
        {Math.abs(wide) < 0.01 ? 'The width is about right.' : wide > 0 ? 'Your range is too wide.' : 'Your range is too tight.'}{' '}
        You left out <span className="num">{score.missed.toFixed(0)}</span> of their combos and added <span className="num">{score.extra.toFixed(0)}</span> that are not in it.
      </p>
      <PaintGrid painted={new Set()} reveal={score} hero={hero} />
      <ul className="quiz-legend" aria-label="Grid key">
        <li><span className="key key-shade" aria-hidden="true" />Shade: how often they play the hand</li>
        <li><span className="key key-extra" aria-hidden="true" />You painted it, but it is not in this range</li>
        <li><span className="key key-missed" aria-hidden="true" />They play it, you left it out</li>
      </ul>
      <p className="muted small">Range from the trainer's {quiz.kind === 'open' ? 'opening' : quiz.kind === 'call' ? 'calling' : '3-bet'} chart, as the trainer's opponents play it.</p>
    </div>
  );
}

function EquityResult({ equity, guess, skipped }: { equity: number | null; guess: number; skipped: boolean }) {
  if (equity === null) return null;
  if (skipped) {
    return <p className="verdict" id="equity-result">Your equity here is <strong className="num">{equity.toFixed(1)}%</strong>.</p>;
  }
  const miss = guess - equity;
  const band = equityBand(guess, equity);
  return (
    <div className="quiz-result" id="equity-result">
      <p className={`verdict band-${band.replace(' ', '-')}`}>
        <strong>{BAND_TEXT[band]}.</strong> Your equity is <span className="num">{equity.toFixed(1)}%</span>; you said <span className="num">{guess}%</span>
        {Math.abs(miss) >= 0.5 && <>, {pts(miss)} {miss > 0 ? 'high' : 'low'}</>}.
      </p>
      <EquityBar equity={equity} guess={guess} />
      <p className="muted small">Exact: every turn and river against every hand in their range that your cards and the flop leave possible.</p>
    </div>
  );
}

/** One scale from 0 to 100% with the true equity and the guess marked on it. */
function EquityBar({ equity, guess }: { equity: number; guess: number }) {
  return (
    <div className="equity-bar" role="img" aria-label={`Equity ${equity.toFixed(1)}%, your estimate ${guess}%`}>
      <div className="equity-fill" style={{ width: `${equity}%` }} />
      <div className="equity-guess-mark" style={{ left: `${guess}%` }}><span>you</span></div>
      <div className="equity-ticks" aria-hidden="true"><span>0%</span><span>50%</span><span>100%</span></div>
    </div>
  );
}
