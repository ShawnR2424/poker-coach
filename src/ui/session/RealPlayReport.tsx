// The real-play report on the Import tab: every imported hand in the saved sessions, as win
// rate, preflop stats, grades by position and street, and the leaks that cost the most.

import { importedHands, realPlayReport, share, type Rate } from '../../engine/session/realPlay';
import { useSessions } from './store';
import { ScrollBox } from '../ScrollBox';

const pct = (x: Rate) => {
  const s = share(x);
  return s === null ? '–' : `${Math.round(s * 100)}%`;
};
const bb = (x: number) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toFixed(1)}`;
const STREET = { preflop: 'Preflop', flop: 'Flop', turn: 'Turn', river: 'River' } as const;

export function RealPlayReport() {
  const saved = useSessions();
  const hands = importedHands(saved);
  if (!hands.length) {
    return (
      <section className="panel real-play" aria-labelledby="real-h">
        <h2 id="real-h">Your real play</h2>
        <p className="small" id="real-empty">Save imported hands to see a report on your real play: win rate, VPIP and PFR, grades by position and street, and the leaks that cost you the most.</p>
      </section>
    );
  }
  const r = realPlayReport(hands);
  const mistakes = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : '–');
  return (
    <section className="panel real-play" aria-labelledby="real-h">
      <h2 id="real-h">Your real play</h2>
      <p className="small muted measure">
        Every imported hand in your saved sessions ({r.hands} hand{r.hands === 1 ? '' : 's'}{r.withStats < r.hands ? `; preflop stats from the ${r.withStats} that still have their replay` : ''}).
        Grades use the same charts and postflop model as the Play tab.
      </p>
      <div className="tiles" id="real-tiles">
        <div className="stat"><p className="eyebrow">Win rate</p><p className="stat-value num">{r.bbPer100 === null ? `${bb(r.netBB)} bb` : `${bb(r.bbPer100)} bb/100`}</p></div>
        <div className="stat"><p className="eyebrow">VPIP / PFR</p><p className="stat-value num">{pct(r.vpip)} / {pct(r.pfr)}</p></div>
        <div className="stat"><p className="eyebrow">3-bet</p><p className="stat-value num">{pct(r.threeBet)}</p></div>
        <div className="stat"><p className="eyebrow">Fold to 3-bet</p><p className="stat-value num">{pct(r.foldTo3Bet)}</p></div>
      </div>
      {r.bbPer100 === null && <p className="small muted">The win rate shows in big blinds per 100 hands from 10 hands; until then it is the total won or lost.</p>}
      <p className="small muted">
        A 3-bet counts when you faced exactly one raise; fold to 3-bet when you opened and were re-raised ({r.threeBet.of} and {r.foldTo3Bet.of} times so far).
        Small samples swing a lot: a few hundred hands say more than a few dozen.
      </p>

      <h3>By position</h3>
      <ScrollBox label="Results by seat">
        <table className="data real-positions">
          <thead><tr><th scope="col">Seat</th><th scope="col" className="n">Hands</th><th scope="col" className="n">Won (bb)</th><th scope="col" className="n">VPIP</th><th scope="col" className="n">PFR</th><th scope="col" className="n">Mistakes</th></tr></thead>
          <tbody>
            {r.byPosition.map((p) => (
              <tr key={p.pos}>
                <th scope="row">{p.pos}</th>
                <td className="n num">{p.hands}</td>
                <td className={`n num ${p.netBB > 0 ? 'up' : p.netBB < 0 ? 'down' : ''}`}>{bb(p.netBB)}</td>
                <td className="n num">{pct(p.vpip)}</td>
                <td className="n num">{pct(p.pfr)}</td>
                <td className="n num" title={`${p.mistakes} of ${p.decisions} decisions`}>{mistakes(p.mistakes, p.decisions)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollBox>

      <h3>By street</h3>
      <ScrollBox label="Grades by street">
        <table className="data real-streets">
          <thead><tr><th scope="col">Street</th><th scope="col" className="n">Decisions</th><th scope="col" className="n">✅</th><th scope="col" className="n">👍</th><th scope="col" className="n">⚠️</th><th scope="col" className="n">EV lost (bb)</th></tr></thead>
          <tbody>
            {r.byStreet.filter((s) => s.decisions).map((s) => (
              <tr key={s.street}>
                <th scope="row">{STREET[s.street]}</th>
                <td className="n num">{s.decisions}</td>
                <td className="n num">{mistakes(s.verdicts.correct, s.decisions)}</td>
                <td className="n num">{mistakes(s.verdicts.playable, s.decisions)}</td>
                <td className="n num">{mistakes(s.verdicts.mistake, s.decisions)}</td>
                <td className="n num">{s.street === 'preflop' ? '–' : s.lossBB.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollBox>
      <p className="small muted">EV lost is measured against the trainer's best play after the flop. Preflop decisions are graded against the charts, which carry no EV, so they show grades only.</p>

      {r.leaks.length > 0 && (
        <>
          <h3>Leaks that cost the most</h3>
          <ul className="real-leaks small" id="real-leaks">
            {r.leaks.slice(0, 6).map((l) => (
              <li key={l.tag}><strong>{l.tag}</strong>: {l.count} time{l.count === 1 ? '' : 's'}{l.lossBB > 0 ? `, ${l.lossBB.toFixed(1)} bb lost after the flop` : ''}</li>
            ))}
          </ul>
        </>
      )}
      {r.costly.length > 0 && (
        <>
          <h3>Costliest decisions</h3>
          <ol className="real-costly small" id="real-costly">
            {r.costly.map((c, i) => (
              <li key={i}><span className="num">{c.hand}</span>, {c.label}: you chose to {c.you}, {c.lossBB.toFixed(1)} bb behind the best play. {c.heading}</li>
            ))}
          </ol>
        </>
      )}
      <p className="small">
        Your mistakes from imported hands are in the <a href="#review">Review</a> deck, and "Practice my leaks" on the <a href="#table">Play</a> tab deals spots for the leaks still open in this session.
      </p>
    </section>
  );
}
