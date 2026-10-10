// Steps through a saved hand: the table as it was after each action, with the hero's graded
// decisions marked. At a decision it shows the verdict and each opponent's range at that point,
// rebuilt with the same narrowing the read used.

import { useMemo, useState } from 'react';
import { formatCards } from '../../engine/cards';
import { describeScore, evaluate } from '../../engine/evaluator';
import { liveVillains } from '../../engine/game/levels';
import type { HandState } from '../../engine/hand';
import { PROFILES, type ProfileId } from '../../engine/postflop/model';
import { narrowHand } from '../../engine/postflop/narrow';
import { formatRange, summarizeRange } from '../../engine/range';
import { adaptProfile } from '../../engine/session/adapt';
import { replayAdaptation, replayStates } from '../../engine/session/replay';
import type { DecisionRecord, HandRecord } from '../../engine/session/session';
import { HeroStrip } from '../table/HeroStrip';
import { TableView } from '../table/TableView';
import { Timeline } from '../table/Timeline';
import { heroTiles, seatViews, timeline } from '../table/view';

const ICON = { correct: '✅', playable: '👍', mistake: '⚠️' } as const;
const GLYPH: Record<string, string> = { c: '♣', d: '♦', h: '♥', s: '♠' };

/** "Flop 8hQhJh" reads as "Flop 8♥Q♥J♥": only whole runs of card codes are rewritten. */
const withSuits = (text: string) =>
  text.replace(/\b((?:[2-9TJQKA][cdhs])+)\b/g, (run) => run.replace(/([2-9TJQKA])([cdhs])/g, (_, r, su) => r + GLYPH[su]));

/** Each live opponent's range at this state, in notation: exact preflop, approximate after. */
function rangesAt(s: HandState, hand: HandRecord) {
  const r = hand.replay!;
  const g = { villains: r.villains, hero: r.hero };
  return liveVillains(g as Parameters<typeof liveVillains>[0], s).map((v) => {
    const profile = adaptProfile(PROFILES[(r.profiles[v] ?? 'regular') as ProfileId], replayAdaptation(r));
    const range = narrowHand(s, v, 'pool', { lowStakes: r.lowStakes ?? true }, profile).range;
    const text = s.street === 'preflop'
      ? { core: formatRange(range), partial: '' }
      : summarizeRange(range, [...s.players[r.hero].hole, ...s.board]);
    return { seat: v, position: s.players[v].position, profile: profile?.short, ...text };
  });
}

export function ReplayView({ hand, onClose }: { hand: HandRecord; onClose: () => void }) {
  const r = hand.replay!;
  const states = useMemo(() => {
    try {
      return replayStates(r);
    } catch {
      return null;
    }
  }, [r]);
  const decisions = useMemo(() => new Map(hand.decisions.filter((d) => d.step !== undefined).map((d) => [d.step!, d])), [hand]);
  const first = hand.decisions.find((d) => d.step !== undefined)?.step ?? 0;
  const [k, setK] = useState(first);

  if (!states) {
    return (
      <section className="panel replay" aria-labelledby="rp-h">
        <h2 id="rp-h">Hand {hand.n}</h2>
        <p>This hand's saved record could not be replayed.</p>
        <button type="button" onClick={onClose}>Close</button>
      </section>
    );
  }
  const last = states.length - 1;
  const s = states[Math.min(k, last)];
  const hero = r.hero;
  const decision: DecisionRecord | undefined = decisions.get(k);
  const reveal = new Set(s.players.map((_, i) => i).filter((i) => i !== hero && !s.players[i].folded));
  const labels = hand.level === 1 ? {} : Object.fromEntries(Object.entries(r.profiles).map(([seat, id]) => [seat, PROFILES[id as ProfileId]?.short ?? '']));
  const seats = seatViews(s, hero, labels, reveal, k < last);
  const heroCards = s.players[hero].hole;
  const made = s.board.length >= 3 ? describeScore(evaluate([...heroCards, ...s.board])) : null;

  return (
    <section className="panel replay" aria-labelledby="rp-h">
      <div className="replay-head">
        <div>
          <p className="eyebrow">Replay · opponents' cards shown</p>
          <h2 id="rp-h">Hand {hand.n}: {hand.spot}</h2>
        </div>
        <button type="button" onClick={onClose}>Close replay</button>
      </div>

      <div className="replay-steps" role="group" aria-label="Your decisions in this hand">
        {hand.decisions.map((d, i) =>
          d.step !== undefined ? (
            <button key={i} type="button" className={d.step === k ? 'on' : ''} aria-pressed={d.step === k} onClick={() => setK(d.step!)}>
              <span aria-hidden="true">{ICON[d.verdict]}</span> {withSuits(d.label)}: {d.you}
            </button>
          ) : null,
        )}
        <button type="button" className={k === last ? 'on' : ''} aria-pressed={k === last} onClick={() => setK(last)}>End of hand</button>
      </div>

      <TableView state={s} seats={seats} hero={hero} />
      <HeroStrip cards={heroCards} tiles={heroTiles(s, hero)} madeHand={made} />
      <Timeline rows={timeline(s, hero, k < last)} />

      <div className="replay-nav">
        <button type="button" onClick={() => setK(0)} disabled={k === 0}>Start</button>
        <button type="button" onClick={() => setK(k - 1)} disabled={k === 0}>Back</button>
        <button type="button" onClick={() => setK(k + 1)} disabled={k === last}>Next</button>
        <button type="button" onClick={() => setK(last)} disabled={k === last}>End</button>
        <span className="muted small num">Step {k} of {last}</span>
      </div>

      {decision && <DecisionAt d={decision} s={s} hand={hand} />}
      {k === last && <p className="replay-result">{hand.lesson}</p>}
    </section>
  );
}

function DecisionAt({ d, s, hand }: { d: DecisionRecord; s: HandState; hand: HandRecord }) {
  const ranges = useMemo(() => rangesAt(s, hand), [s, hand]);
  return (
    <div className={`replay-decision verdict-${d.verdict}`}>
      <p className="eyebrow">Your decision</p>
      <p><strong><span aria-hidden="true">{ICON[d.verdict]}</span> {d.heading}</strong> · you chose {d.you} with {withSuits(d.hand)}</p>
      {d.tags.length > 0 && <p className="small"><span className="eyebrow">Leak tag</span> {d.tags.join(', ')}</p>}
      {ranges.map((v) => (
        <div key={v.seat} className="range-text">
          <p className="eyebrow">{v.position}{v.profile && hand.level !== 1 ? ` · ${v.profile}` : ''}: range at this point</p>
          <p><code>{v.core || 'no hands'}</code></p>
          {v.partial && <p className="small muted">and some of <code>{v.partial}</code></p>}
        </div>
      ))}
      <p className="small muted">Board {s.board.length ? withSuits(formatCards(s.board)) : 'not dealt yet'}.</p>
    </div>
  );
}
