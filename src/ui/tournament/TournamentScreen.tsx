// Tournament mode: short-stack spots with antes, graded in chips or by ICM. A spot is folded to
// you (go all-in or fold), an all-in in front of you (call or fold), or an open in front of you
// (reshove all-in or fold); the answer is compared with the solved ranges for that table, stacks
// and payouts.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { TournamentMistake } from '../../engine/review/review';
import { makeRng, randomSeed } from '../../engine/rng';
import { ALL_CLASSES } from '../../engine/range';
import type { ClassRange, PayoutMode } from '../../engine/tournament/pushfold';
import { callingHands, OPEN_TO } from '../../engine/tournament/reshove';
import {
  addAnswer, answer, dealSpot, DEFAULT_OPTIONS, emptyTally, equityNeeded, overcallOdds, handClass, handText, MARGINS, MODE_LABELS, SPOT_LABELS,
  parseTally, payoutText, positionNames, postedLabel, rangeText, shareText, type SolvedSpot, type TableSize, type TournamentAnswer,
  type SpotChoice, type TournamentOptions, type TournamentTally,
} from '../../engine/tournament/spots';
import { PlayingCard } from '../PlayingCard';
import { StrategyGrid } from '../play/StrategyGrid';
import { addTournament } from '../review/store';
import '../charts/charts.css';
import '../play/play.css';
import '../session/session.css';
import './tournament.css';

const KEY = 'tournament:v1';
const BADGE = { correct: { icon: '✅', label: 'Correct' }, playable: { icon: '👍', label: 'Playable, not best' }, mistake: { icon: '⚠️', label: 'Mistake' } };
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const bb = (x: number) => `${+x.toFixed(1)}bb`;
const signed = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(2)}`;

interface Saved { options: TournamentOptions; tally: TournamentTally }

function load(): Saved {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    const o = raw?.options ?? {};
    return {
      options: {
        players: o.players === 9 ? 9 : 6,
        ante: o.ante !== false,
        mode: o.mode === 'chips' || o.mode === 'bubble' ? o.mode : 'final',
        spots: o.spots === 'pushfold' || o.spots === 'reshove' ? o.spots : 'both',
      },
      tally: parseTally(JSON.stringify(raw?.tally ?? null)),
    };
  } catch {
    return { options: DEFAULT_OPTIONS, tally: emptyTally() };
  }
}

function save(s: Saved) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage unavailable */ }
}

export function TournamentScreen() {
  const rngRef = useRef(makeRng(randomSeed()));
  const [saved, setSaved] = useState<Saved>(load);
  const [solved, setSolved] = useState<SolvedSpot | null>(null);
  const [result, setResult] = useState<TournamentAnswer | null>(null);
  const { options, tally } = saved;

  // Solving takes a moment, so the screen paints "Working out the ranges" first.
  useEffect(() => {
    if (solved) return;
    const id = setTimeout(() => setSolved(dealSpot(rngRef.current, options)), 0);
    return () => clearTimeout(id);
  }, [solved, options]);

  const update = (next: Saved) => { setSaved(next); save(next); };
  const setOptions = (o: Partial<TournamentOptions>) => {
    update({ ...saved, options: { ...options, ...o } });
    setSolved(null);
    setResult(null);
  };
  const next = () => { setSolved(null); setResult(null); };
  const act = (played: boolean) => {
    if (!solved || result) return;
    const a = answer(solved, played);
    setResult(a);
    update({ ...saved, tally: addAnswer(tally, a) });
    if (a.verdict === 'mistake') addTournament(mistakeOf(solved, a));
  };

  return (
    <div className="screen tournament">
      <div className="session-head">
        <div>
          <p className="eyebrow">Tournament mode</p>
          <h1>Short-stack spots</h1>
        </div>
      </div>

      <section className="panel t-pick" aria-label="Tournament settings">
        <div className="chart-selects">
          <label>
            <span className="eyebrow">Players left</span>
            <select id="t-players" value={options.players} onChange={(e) => setOptions({ players: Number(e.target.value) as TableSize })}>
              <option value={6}>6 (6-max final table)</option>
              <option value={9}>9 (full final table)</option>
            </select>
          </label>
          <label>
            <span className="eyebrow">Spots</span>
            <select id="t-spots" value={options.spots} onChange={(e) => setOptions({ spots: e.target.value as SpotChoice })}>
              {(Object.keys(SPOT_LABELS) as SpotChoice[]).map((m) => <option key={m} value={m}>{SPOT_LABELS[m]}</option>)}
            </select>
          </label>
          <label>
            <span className="eyebrow">Payouts</span>
            <select id="t-mode" value={options.mode} onChange={(e) => setOptions({ mode: e.target.value as PayoutMode })}>
              {(Object.keys(MODE_LABELS) as PayoutMode[]).map((m) => <option key={m} value={m}>{MODE_LABELS[m]}</option>)}
            </select>
          </label>
        </div>
        <label className="inline"><input id="t-ante" type="checkbox" checked={options.ante} onChange={(e) => setOptions({ ante: e.target.checked })} /> Big blind ante (1bb)</label>
        <p className="small muted">
          {payoutText(options.mode, options.players)
            ? `Prize pool split: ${payoutText(options.mode, options.players)}${options.mode === 'bubble' ? `; ${ordinal(options.players)} gets nothing.` : '.'}`
            : 'Every chip is worth the same: the best play is the one that wins the most chips.'}
        </p>
      </section>

      <Tally tally={tally} onReset={() => update({ ...saved, tally: emptyTally() })} />

      {!solved ? (
        <section className="panel"><p className="muted">Working out the ranges for this table…</p></section>
      ) : (
        <>
          <SpotView s={solved} />
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
            <Feedback s={solved} a={result} onNext={next} />
          )}
        </>
      )}

      <p className="small muted chart-source">
        Ranges are worked out in the browser for each table: the player who goes all-in and the players who can call answer each other until their ranges settle. Only the first caller plays, and an open comes from the trainer's 40bb opening chart; see <code>docs/model.md</code> for the simplifications. They are not solver output.
      </p>
    </div>
  );
}

const ordinal = (n: number) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;

/** What the hero puts at risk: the whole stack all-in, or the call (capped by the all-in). */
export function playAmount(s: SolvedSpot): number {
  const { spot } = s;
  const n = spot.stacks.length;
  const live = (i: number) => spot.stacks[i] - (spot.ante && i === n - 1 ? 1 : 0);
  if (s.kind !== 'call') return live(spot.hero);
  return Math.min(live(spot.hero), live(spot.opener));
}

function Tally({ tally, onReset }: { tally: TournamentTally; onReset: () => void }) {
  if (!tally.spots) return null;
  return (
    <div className="session-strip small t-tally">
      <span className="eyebrow">Your spots</span>
      <span className="num">{tally.spots} answered</span>
      <span className="num">✅ {tally.correct} · 👍 {tally.playable} · ⚠️ {tally.mistake}</span>
      <span className="num">{tally.lost.toFixed(1)}bb given up</span>
      {tally.icmMistakes > 0 && <span className="num">{tally.icmMistakes} mistake{tally.icmMistakes === 1 ? '' : 's'} right in chips but wrong by ICM</span>}
      <button type="button" onClick={onReset}>Reset</button>
    </div>
  );
}

/** The situation in one line, e.g. "UTG raises to 2bb; folded to you in the CO". */
export function spotHeading(s: SolvedSpot): string {
  const { spot } = s;
  const pos = positionNames(spot.stacks.length);
  return s.kind === 'push'
    ? `Folded to you in the ${pos[spot.hero]}`
    : s.kind === 'reshove'
      ? `${pos[spot.opener]} raises to ${OPEN_TO}bb; folded to you in the ${pos[spot.hero]}`
      : `${pos[spot.opener]} goes all-in for ${bb(spot.stacks[spot.opener])}; folded to you in the ${pos[spot.hero]}`;
}

/** The feedback's heading for an answer: what was right, or what the hand should have done. */
export function answerHeading(s: SolvedSpot, a: TournamentAnswer): string {
  const playName = s.kind === 'call' ? 'call' : 'all-in';
  const g = a.g;
  const bestName = g.best === 'play' ? playName : 'fold';
  return a.verdict === 'correct'
    ? `${cap(a.played ? playName : 'fold')} is right${g.freq > 0.05 && g.freq < 0.95 ? ' (a close hand that the ranges mix)' : ''}`
    : a.verdict === 'playable' ? `Close, but ${bestName} is a little better` : `This is a ${bestName}`;
}

const MODE_SHORT: Record<PayoutMode, string> = { chips: 'Chip EV', final: 'Final table', bubble: 'Bubble' };

/** The spot as a review card: the table, the first answer and its verdict. */
export function mistakeOf(s: SolvedSpot, a: TournamentAnswer): TournamentMistake {
  const { spot } = s;
  return {
    spot: { kind: s.kind, stacks: spot.stacks, ante: spot.ante, mode: spot.mode, opener: spot.opener, hero: spot.hero, hand: spot.hand, played: a.played },
    where: `${MODE_SHORT[spot.mode]}, ${spot.stacks.length} players`,
    label: spotHeading(s),
    hand: handText(spot),
    you: a.played ? (s.kind === 'call' ? 'Call' : 'All-in') : 'Fold',
    heading: answerHeading(s, a),
  };
}

/** The table, the hero's hand and every seat's stack and action. `heading` replaces the default title. */
export function SpotView({ s, heading }: { s: SolvedSpot; heading?: ReactNode }) {
  const { spot } = s;
  const pos = positionNames(spot.stacks.length);
  const push = s.kind === 'push';
  return (
    <section className="panel t-spot" aria-labelledby="t-spot-h">
      {heading ?? <h2 id="t-spot-h">{spotHeading(s)}</h2>}
      <p className="small muted">
        Blinds 0.5/1{spot.ante ? ', big blind ante 1' : ''}.{' '}
        {push ? 'Go all-in or fold.' : s.kind === 'reshove' ? `Go all-in over the raise or fold; the ${pos[spot.opener]} then calls or folds.` : 'Call or fold; players after you who have not acted yet still can.'}
      </p>
      <div className="t-hero">
        <span className="t-cards">{spot.hand.map((c) => <PlayingCard key={c} card={c} />)}</span>
        <span><span className="eyebrow">Your hand</span> <strong>{handClass(spot)}</strong> · <span className="num">{bb(spot.stacks[spot.hero])}</span></span>
      </div>
      <div className="table-scroll">
        <table className="data t-seats">
          <thead><tr><th scope="col">Seat</th><th scope="col" className="n">Stack</th><th scope="col">This hand</th></tr></thead>
          <tbody>
            {spot.stacks.map((st, i) => (
              <tr key={i} className={i === spot.hero ? 't-you' : ''} data-seat={pos[i]}>
                <th scope="row">{pos[i]}{i === spot.hero ? ' (you)' : ''}</th>
                <td className="n num">{bb(st)}</td>
                <td>
                  {i < spot.opener ? 'Folded' : i === spot.opener && !push ? (s.kind === 'reshove' ? `Raised to ${OPEN_TO}bb` : 'All-in') : i === spot.hero ? 'To act' : i < spot.hero ? 'Folded' : 'Still to act'}
                  {postedLabel(spot, i) && <span className="muted"> · posted {postedLabel(spot, i)}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function Feedback({ s, a, onNext, nextLabel = 'Next spot', children }: { s: SolvedSpot; a: TournamentAnswer; onNext: () => void; nextLabel?: string; children?: ReactNode }) {
  const { spot } = s;
  const shoving = s.kind !== 'call';
  const pos = positionNames(spot.stacks.length);
  const icm = spot.mode !== 'chips';
  const playName = shoving ? 'all-in' : 'call';
  const g = a.g;
  const heading = answerHeading(s, a);
  const chipFlip = a.chipG && a.chipG.best !== g.best;
  const range: ClassRange = s.kind === 'push' ? s.sol.push : s.kind === 'reshove' ? s.sol.shove : s.sol.call[spot.hero];
  const freqs = useMemo(() => new Map(ALL_CLASSES.map((c, i) => [c, shoving
    ? { raise: range[i], call: 0, fold: 1 - range[i] }
    : { raise: 0, call: range[i], fold: 1 - range[i] }])), [range, shoving]);

  const bullets: string[] = [];
  if (s.kind === 'push') {
    bullets.push(`Everyone behind you folds ${pct(g.foldOdds ?? 0)} of the time; when someone calls, your hand has ${pct(g.calledEquity ?? 0.5)} equity against their calling range.`);
  } else if (s.kind === 'reshove') {
    bullets.push(`The ${pos[spot.opener]} folds its raise ${pct(g.foldOdds ?? 0)} of the time, giving you ${bb(OPEN_TO)} plus the blinds${spot.ante ? ' and ante' : ''}; when it calls, your hand has ${pct(g.calledEquity ?? 0.5)} equity against its calling range.`);
  } else {
    const needed = equityNeeded(s.sol, spot.hero);
    const chipNeeded = a.chipG ? equityNeeded(s.chips, spot.hero) : null;
    bullets.push(`Your hand has ${pct(g.equity)} equity against the ${pos[spot.opener]}'s all-in range (${shareText(s.sol.push)} of hands).`);
    bullets.push(chipNeeded !== null
      ? `Calling needs ${pct(needed)} equity with these payouts, against ${pct(chipNeeded)} in chips. The difference is ICM's risk premium: chips you lose cost more prize money than chips you win add.`
      : `Calling needs ${pct(needed)} equity to win more chips than folding.`);
    const over = overcallOdds(s.sol, spot.hero);
    if (over >= 0.005) {
      bullets.push(`A player behind you overcalls ${pct(over)} of the time, with a range tighter than a first call; the values below include those three-way pots, so the needed equity is the heads-up figure.`);
    }
  }
  if (chipFlip) {
    bullets.push(`In chips alone this is ${a.chipG!.best === 'play' ? `a ${playName}` : 'a fold'} (${signed(a.chipG!.play - a.chipG!.fold)}bb). With these payouts ${g.best === 'play' ? `the ${playName}` : 'folding'} is better: ${icm && g.best === 'fold' ? 'busting costs more than doubling up gains.' : 'the stacks around you change what each chip is worth.'}`);
  }

  return (
    <section className={`feedback verdict-${a.verdict}`} aria-labelledby="t-fb-h">
      <p className="verdict-badge"><span aria-hidden="true">{BADGE[a.verdict].icon}</span> {BADGE[a.verdict].label}</p>
      <h2 id="t-fb-h">{heading}</h2>
      <ul className="why">{bullets.map((b) => <li key={b}>{b}</li>)}</ul>
      <div className="table-scroll">
        <table className="data t-ev">
          <thead>
            <tr>
              <th scope="col">Option</th>
              <th scope="col" className="n">{icm ? 'Value (bb equivalent)' : 'Chips (bb)'}</th>
              <th scope="col" className="n">Against the best</th>
            </tr>
          </thead>
          <tbody>
            {([['fold', g.fold], [playName, g.play]] as const).map(([name, v]) => (
              <tr key={name} className={(name === 'fold') === (g.best === 'fold') ? 't-best' : ''}>
                <th scope="row">{cap(name)}{(name === 'fold') === (g.best === 'fold') ? ' (best)' : ''}</th>
                <td className="n num">{v.toFixed(2)}</td>
                <td className="n num">{signed(v - Math.max(g.play, g.fold))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted">
        {icm
          ? 'Values are your expected share of the prize pool by ICM, converted to big blinds at the average chip\'s value, so they compare with chip numbers. '
          : 'Values are your expected stack at the end of the hand. '}
        Correct within {MARGINS.correct}bb of the best option, playable within {MARGINS.playable}bb.
      </p>
      <div>
        <p className="eyebrow">{shoving ? `Your all-in range from the ${pos[spot.hero]}` : `Your calling range in the ${pos[spot.hero]}`}: {shareText(range)}</p>
        <StrategyGrid
          freqs={freqs}
          heroClass={handClass(spot)}
          names={{ raise: 'all-in', call: 'call', fold: 'fold' }}
          label={shoving ? 'Your all-in range for this spot' : 'Your calling range for this spot'}
        />
      </div>
      <div className="range-texts small">
        {s.kind === 'push'
          ? spot.stacks.map((_, i) => i > spot.opener && (
            <p key={i}><span className="eyebrow">{pos[i]} calls {shareText(s.sol.call[i])}</span> <code>{rangeText(s.sol.call[i]) || 'nothing'}</code></p>
          ))
          : s.kind === 'reshove'
            ? <>
              <p><span className="eyebrow">{pos[spot.opener]} opens {shareText(s.sol.open)}</span> <code>{rangeText(s.sol.open) || 'nothing'}</code></p>
              <p><span className="eyebrow">and calls your all-in with {shareText(callingHands(s.sol))}</span> <code>{rangeText(callingHands(s.sol)) || 'nothing'}</code></p>
            </>
            : <p><span className="eyebrow">{pos[spot.opener]} goes all-in with {shareText(s.sol.push)}</span> <code>{rangeText(s.sol.push) || 'nothing'}</code></p>}
      </div>
      <div className="fb-actions">
        <button type="button" className="primary" onClick={onNext}>{nextLabel}</button>
        {children}
      </div>
    </section>
  );
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
