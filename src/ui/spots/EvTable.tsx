import { bbs, describeOption, type Analysis, type OptionRow } from '../../engine/postflop/recommend';

const pct = (x: number | undefined) => (x === undefined ? '–' : `${Math.round(x * 100)}%`);

interface Props {
  analysis: Analysis;
  bb: number;
  chosen: OptionRow | null;
  acceptable: OptionRow[];
}

/** Every legal action with the opponent's predicted response and its expected value. */
export function EvTable({ analysis, bb, chosen, acceptable }: Props) {
  const max = Math.max(...analysis.rows.map((r) => Math.abs(r.ev)), 1);
  return (
    <div className="ev-wrap">
      <table className="ev-table">
        <caption className="sr-only">Expected value of each action</caption>
        <thead>
          <tr>
            <th scope="col">Action</th>
            <th scope="col" className="n">EV</th>
            <th scope="col" className="n">They fold</th>
            <th scope="col" className="n">Call</th>
            <th scope="col" className="n">Raise</th>
            <th scope="col" className="n">Your equity when called</th>
            <th scope="col" className="n">Folds a bluff needs</th>
          </tr>
        </thead>
        <tbody>
          {analysis.rows.map((r) => {
            const isBest = r === analysis.best;
            const isChosen = r === chosen;
            const fine = !isBest && acceptable.includes(r);
            return (
              <tr key={describeOption(r.option)} className={`${isBest ? 'best' : ''}${isChosen ? ' chosen' : ''}`}>
                <th scope="row">
                  {describeOption(r.option)}
                  {isBest && <span className="tag best-tag">Best</span>}
                  {fine && <span className="tag fine-tag">Also fine</span>}
                  {isChosen && <span className="tag you-tag">You</span>}
                </th>
                <td className="n num ev-cell">
                  <span className={`ev-bar ${r.ev < 0 ? 'neg' : ''}`} style={{ width: `${(Math.abs(r.ev) / max) * 100}%` }} aria-hidden="true" />
                  <span className="ev-val">{r.ev > 0 ? '+' : ''}{bbs(r.ev, bb)}</span>
                </td>
                <td className="n num">{pct(r.fold)}</td>
                <td className="n num">{pct(r.call)}</td>
                <td className="n num">{pct(r.raise)}</td>
                <td className="n num">{pct(r.eqWhenCalled)}</td>
                <td className="n num">{pct(r.breakEvenBluff)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted small">
        EV is measured against folding now, so chips already in the pot don't count. Responses come from the opponent model in data/postflop/actions.json.
      </p>
    </div>
  );
}
