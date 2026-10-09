// Engine lab: check the evaluator, range parsing, card removal, equity and pot math by hand.

import { useEffect, useMemo, useState } from 'react';
import { parseCards, type Card } from '../engine/cards';
import { describeScore, evaluate } from '../engine/evaluator';
import { breakEvenFoldPct, callEv, mdf, potOdds, spr } from '../engine/math';
import { comboCount, formatRange, parseRange, removeDead, type Range } from '../engine/range';
import { runEquity, type EquityOutcome } from '../workers/equityClient';
import { CardSlot, PlayingCard } from './PlayingCard';
import { RangeGrid } from './RangeGrid';

const PRESETS: { name: string; text: string }[] = [
  { name: 'UTG open (sample)', text: '22+, A2s+, K9s+, Q9s+, J9s+, T9s, 98s, 87s, 76s, 65s, ATo+, KJo+, QJo' },
  { name: 'BTN open (sample)', text: '22+, A2s+, K2s+, Q5s+, J7s+, T7s+, 96s+, 85s+, 75s+, 64s+, 54s, A5o+, K9o+, Q9o+, J9o+, T9o' },
  { name: '3-bet vs CO (sample)', text: 'TT+, AQs+, AKo, A5s-A4s, KQs:0.5, 76s:0.5' },
  { name: 'Overpair+ on a flop', text: 'TT+, AA, 77, 22, A7s' },
];

interface Spot {
  hero: string;
  board: string;
  villains: string[];
}

const DEFAULT: Spot = {
  hero: 'QsQd',
  board: 'Ah7c2d',
  villains: [PRESETS[0].text],
};

function tryCards(s: string, label: string): { cards: Card[]; error?: string } {
  try {
    return { cards: s.trim() ? parseCards(s) : [] };
  } catch (e) {
    return { cards: [], error: `${label}: ${(e as Error).message}` };
  }
}

const pct = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;

export function Lab() {
  const [spot, setSpot] = useState<Spot>(DEFAULT);
  const [iterations, setIterations] = useState(30000);
  const [eq, setEq] = useState<EquityOutcome | null>(null);
  const [eqError, setEqError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const hero = tryCards(spot.hero, 'Hero');
  const board = tryCards(spot.board, 'Board');
  const villains = spot.villains.map((t, i) => {
    try {
      return { range: parseRange(t) as Range, error: undefined };
    } catch (e) {
      return { range: null, error: `Opponent ${i + 1}: ${(e as Error).message}` };
    }
  });
  const dead = useMemo(() => [...hero.cards, ...board.cards], [spot.hero, spot.board]);
  const overlap = hero.cards.some((c) => board.cards.includes(c)) ? 'Hero cards and board share a card' : null;
  const inputErrors = [hero.error, board.error, overlap, ...villains.map((v) => v.error)].filter(Boolean) as string[];
  const ready = inputErrors.length === 0 && hero.cards.length === 2 && [0, 3, 4, 5].includes(board.cards.length);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const t = setTimeout(() => {
      setRunning(true);
      runEquity(hero.cards, board.cards, villains.map((v) => v.range!), iterations)
        .then((o) => { if (!cancelled) { setEq(o); setEqError(null); } })
        .catch((e: Error) => { if (!cancelled) { setEq(null); setEqError(e.message); } })
        .finally(() => { if (!cancelled) setRunning(false); });
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spot, iterations, ready]);

  const heroHand = ready && board.cards.length >= 3 ? describeScore(evaluate([...hero.cards, ...board.cards])) : null;
  const update = (patch: Partial<Spot>) => setSpot((s) => ({ ...s, ...patch }));
  const setVillain = (i: number, text: string) =>
    update({ villains: spot.villains.map((v, j) => (j === i ? text : v)) });

  return (
    <main className="lab">
      <header className="lab-head">
        <p className="eyebrow">Poker Coach · Engine lab</p>
        <h1>Engine lab</h1>
        <p className="muted">
          Enter a hand, a board and opponent ranges. Every number here comes straight from the tested engine:
          card removal, the hand evaluator, equity and pot math.
        </p>
      </header>

      <section className="panel" aria-labelledby="spot-h">
        <h2 id="spot-h">Spot</h2>
        <div className="row">
          <label>
            Hero cards
            <input id="hero" value={spot.hero} onChange={(e) => update({ hero: e.target.value })} placeholder="QsQd" />
          </label>
          <label>
            Board (0, 3, 4 or 5 cards)
            <input id="board" value={spot.board} onChange={(e) => update({ board: e.target.value })} placeholder="Ah7c2d" />
          </label>
        </div>
        <div className="cards-line">
          <div className="cards-group" aria-label="Hero hand">
            {hero.cards.length === 2 ? hero.cards.map((c) => <PlayingCard key={c} card={c} />) : <><CardSlot /><CardSlot /></>}
          </div>
          <div className="cards-group board" aria-label="Board">
            {Array.from({ length: 5 }, (_, i) =>
              board.cards[i] !== undefined ? (
                <PlayingCard key={i} card={board.cards[i]} size="sm" highlight={i === board.cards.length - 1 && i >= 3} />
              ) : (
                <CardSlot key={i} size="sm" />
              ),
            )}
          </div>
          {heroHand && <p className="made-hand">{heroHand}</p>}
        </div>
        {inputErrors.length > 0 && (
          <ul className="errors">{inputErrors.map((e) => <li key={e}>{e}</li>)}</ul>
        )}
      </section>

      <section className="panel" aria-labelledby="eq-h">
        <div className="panel-head">
          <h2 id="eq-h">Equity</h2>
          <label className="inline">
            Samples
            <select id="iters" value={iterations} onChange={(e) => setIterations(Number(e.target.value))}>
              <option value={10000}>10,000</option>
              <option value={30000}>30,000</option>
              <option value={100000}>100,000</option>
            </select>
          </label>
        </div>
        <div className="tiles">
          <div className="tile">
            <p className="eyebrow">Hero equity</p>
            <p className="big num">{eq ? pct(eq.result.equity) : '–'}</p>
            <p className="muted small">
              {eq
                ? eq.result.exact
                  ? 'Exact enumeration'
                  : `Monte Carlo, ±${pct(1.96 * eq.result.stderr)} (95%)`
                : running ? 'Calculating…' : 'Waiting for a valid spot'}
            </p>
          </div>
          <div className="tile">
            <p className="eyebrow">Win / tie</p>
            <p className="big num">{eq ? `${pct(eq.result.win)} / ${pct(eq.result.tie)}` : '–'}</p>
            <p className="muted small">{eq ? `${eq.result.samples.toLocaleString()} ${eq.result.exact ? 'combos' : 'samples'} in ${Math.round(eq.ms)} ms` : ' '}</p>
          </div>
        </div>
        {eqError && <p className="errors">{eqError}</p>}
      </section>

      {spot.villains.map((text, i) => {
        const v = villains[i];
        const live = v.range ? removeDead(v.range, dead) : null;
        return (
          <section className="panel" key={i} aria-labelledby={`v${i}-h`}>
            <div className="panel-head">
              <h2 id={`v${i}-h`}>Opponent {i + 1} range</h2>
              {spot.villains.length > 1 && (
                <button type="button" onClick={() => update({ villains: spot.villains.filter((_, j) => j !== i) })}>
                  Remove
                </button>
              )}
            </div>
            <div className="presets">
              {PRESETS.map((p) => (
                <button key={p.name} type="button" className="chip" onClick={() => setVillain(i, p.text)}>
                  {p.name}
                </button>
              ))}
            </div>
            <textarea id={`range-${i}`} rows={3} value={text} onChange={(e) => setVillain(i, e.target.value)} />
            {v.range && live && (
              <>
                <div className="stats">
                  <span><span className="num">{fmtN(comboCount(v.range))}</span> combos in range</span>
                  <span><span className="num">{fmtN(comboCount(live))}</span> live after card removal</span>
                  <span><span className="num">{pct(comboCount(v.range) / 1326)}</span> of all hands</span>
                </div>
                <p className="normalized">
                  <span className="eyebrow">Parsed as</span> <code>{formatRange(v.range) || '(empty)'}</code>
                </p>
                <RangeGrid range={v.range} dead={dead} hero={hero.cards} />
              </>
            )}
          </section>
        );
      })}
      {spot.villains.length < 3 && (
        <button type="button" className="add-opp" onClick={() => update({ villains: [...spot.villains, PRESETS[1].text] })}>
          Add another opponent (multiway)
        </button>
      )}

      <PotMath equity={eq?.result.equity ?? null} />

      <footer className="muted small foot">
        Approximate GTO trainer, engine build. Ranges shown are sample data for testing, not final charts.
      </footer>
    </main>
  );
}

const fmtN = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

function PotMath({ equity }: { equity: number | null }) {
  const [potBB, setPot] = useState(6.5);
  const [betBB, setBet] = useState(4.5);
  const [stackBB, setStack] = useState(95.5);
  const valid = potBB > 0 && betBB > 0 && stackBB >= 0;
  const potAfterBet = potBB + betBB;
  const need = potOdds(betBB, potAfterBet);
  const rows: [string, string, string][] = valid
    ? [
        ['Equity needed to call', pct(need), 'call ÷ (pot + bet + call)'],
        ...(equity !== null
          ? ([['Call EV with computed equity', `${callEv(betBB, potAfterBet, equity) >= 0 ? '+' : ''}${callEv(betBB, potAfterBet, equity).toFixed(2)} bb`, `${pct(equity)} equity vs ${pct(need)} needed`]] as [string, string, string][])
          : []),
        ['Minimum defense frequency', pct(mdf(potBB, betBB)), 'pot ÷ (pot + bet)'],
        ['Break-even folds for a pure bluff of this size', pct(breakEvenFoldPct({ pot: potBB, risk: betBB })), 'bet ÷ (pot + bet)'],
        ...(equity !== null
          ? ([['Break-even folds as a semi-bluff', pct(breakEvenFoldPct({ pot: potBB, risk: betBB, equityWhenCalled: equity })), `with ${pct(equity)} equity when called`]] as [string, string, string][])
          : []),
        ['Stack-to-pot ratio', spr(stackBB, potBB).toFixed(1), 'effective stack ÷ pot'],
      ]
    : [];
  return (
    <section className="panel" aria-labelledby="pm-h">
      <h2 id="pm-h">Pot math</h2>
      <div className="row three">
        <label>Pot before the bet (bb)<input id="pot" type="number" min={0} step={0.5} value={potBB} onChange={(e) => setPot(Number(e.target.value))} /></label>
        <label>Bet size (bb)<input id="bet" type="number" min={0} step={0.5} value={betBB} onChange={(e) => setBet(Number(e.target.value))} /></label>
        <label>Effective stack (bb)<input id="stack" type="number" min={0} step={0.5} value={stackBB} onChange={(e) => setStack(Number(e.target.value))} /></label>
      </div>
      <div className="table-scroll">
        <table className="math">
          <tbody>
            {rows.map(([k, v, how]) => (
              <tr key={k}><th scope="row">{k}</th><td className="num">{v}</td><td className="muted small">{how}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      {!valid && <p className="errors">Enter a positive pot and bet.</p>}
    </section>
  );
}
