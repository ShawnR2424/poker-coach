import { useEffect, useState } from 'react';
import { formatCards } from '../../engine/cards';
import { describeScore } from '../../engine/evaluator';
import type { HandState } from '../../engine/hand';
import { comboIndex, NUM_COMBOS } from '../../engine/range';
import type { DecisionRecord } from '../../engine/session/session';
import { runEquity } from '../../workers/equityClient';
import { bbs, dollars } from '../table/format';

export type DecisionLog = DecisionRecord;

const ICON = { correct: '✅', playable: '👍', mistake: '⚠️' } as const;
const pct = (x: number) => `${Math.round(x * 100)}%`;

export function HandResult({ state, hero, log, onNext, stopNote }: { state: HandState; hero: number; log: DecisionLog[]; onNext: () => void; stopNote?: string }) {
  const me = state.players[hero];
  const bb = state.config.bb;
  const opponents = state.players.map((p, i) => ({ p, i })).filter(({ p, i }) => i !== hero && !p.folded);
  const [eqs, setEqs] = useState<Map<number, number>>(new Map());

  useEffect(() => {
    if (me.folded || state.result) return;
    // Preflop equity against each opponent's actual hand.
    opponents.forEach(({ p, i }) => {
      const r = new Float32Array(NUM_COMBOS);
      r[comboIndex(p.hole[0], p.hole[1])] = 1;
      runEquity(me.hole, [], [r], 20000).then((o) => setEqs((m) => new Map(m).set(i, o.result.equity)));
    });
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  const net = state.result ? state.result.net[hero] : -me.total;
  const allGood = log.every((d) => d.verdict !== 'mistake');
  const takeaways: string[] = [];
  const mistakes = log.filter((d) => d.verdict === 'mistake');
  if (mistakes.length) takeaways.push(`${mistakes[0].label} with ${mistakes[0].hand}: ${mistakes[0].heading.toLowerCase()}. ${mistakes[0].tags[0] ? `Leak to watch: ${mistakes[0].tags[0]}.` : ''}`);
  else if (log.length) takeaways.push('No mistakes this hand.');
  if (state.result && net < 0 && allGood) takeaways.push('You lost chips, but your decisions were sound. Judge the decision, not the result.');
  if (state.result && net > 0 && mistakes.length) takeaways.push('You won this pot, but that does not make the mistake right. Over many hands it costs money.');

  let headline: string;
  if (me.folded) {
    headline = me.total > 0 ? `You folded, losing the ${dollars(me.total)} you put in` : 'You folded';
  } else if (state.result) {
    headline = net > 0 ? `You win ${dollars(net)} (${bbs(net, bb)})` : net < 0 ? `You lose ${dollars(-net)} (${bbs(-net, bb)})` : 'You break even';
  } else {
    headline = stopNote ?? 'The hand stops here.';
  }

  return (
    <section className="hand-result" aria-labelledby="hr-h">
      <h2 id="hr-h">{headline}</h2>
      {state.result?.wentToShowdown && (
        <ul className="showdown">
          {state.players.map((p, i) =>
            state.result!.scores[i] !== null ? (
              <li key={i}>
                <strong>{i === hero ? 'You' : p.position}</strong> {formatCards(p.hole)}: {describeScore(state.result!.scores[i]!)}
                {state.result!.pots.some((pt) => pt.winners.includes(i)) && <span className="badge badge-call">Winner</span>}
              </li>
            ) : null,
          )}
        </ul>
      )}
      {!state.result && opponents.length > 0 && (
        <ul className="showdown">
          {opponents.map(({ p, i }) => (
            <li key={i}>
              <strong>{p.position}</strong> had {formatCards(p.hole)}
              {!me.folded && <> · your preflop equity against it: <span className="num">{eqs.has(i) ? pct(eqs.get(i)!) : '…'}</span></>}
            </li>
          ))}
        </ul>
      )}
      <div className="table-scroll">
        <table className="math verdicts">
          <thead><tr><th>Spot</th><th>Hand</th><th>You</th><th>Verdict</th></tr></thead>
          <tbody>
            {log.map((d, k) => (
              <tr key={k}>
                <td>{d.label}</td>
                <td className="num">{d.hand}</td>
                <td>{d.you}</td>
                <td><span aria-hidden="true">{ICON[d.verdict]}</span> {d.heading}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {takeaways.length > 0 && (
        <div className="concept">
          <p className="eyebrow">Takeaways</p>
          <ul className="why">{takeaways.slice(0, 2).map((t) => <li key={t}>{t}</li>)}</ul>
        </div>
      )}
      <button type="button" className="primary" onClick={onNext}>Next hand</button>
    </section>
  );
}

