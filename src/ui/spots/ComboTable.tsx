// Combo counts by hand class: what card removal left, which known cards took the rest, and
// how each class does against the hero. Same numbers as the grid above it.

import { isRed, rankOf, suitOf, type Card } from '../../engine/cards';
import { POSTFLOP_CATEGORY_INFO } from '../../engine/postflop/categories';
import type { ComboRow } from '../../engine/postflop/combos';
import { POSTFLOP_COLORS } from './colors';

const RANKS = '23456789TJQKA';
const SUIT_SYMBOL = ['♣', '♦', '♥', '♠'];
const fmt = (n: number) => (Math.abs(n - Math.round(n)) < 0.05 ? String(Math.round(n)) : n.toFixed(1));

function CardText({ c }: { c: Card }) {
  return <span className={`ct${isRed(c) ? ' red' : ''}`}>{RANKS[rankOf(c)]}{SUIT_SYMBOL[suitOf(c)]}</span>;
}

function Why({ r }: { r: ComboRow }) {
  if (!r.yours.length && !r.board.length) return <span className="muted">–</span>;
  return (
    <>
      {r.yours.length > 0 && <span>you hold {r.yours.map((c) => <CardText key={c} c={c} />)}</span>}
      {r.yours.length > 0 && r.board.length > 0 && '; '}
      {r.board.length > 0 && <span>{r.board.map((c) => <CardText key={c} c={c} />)} on board</span>}
    </>
  );
}

interface Props {
  rows: ComboRow[];
  open: boolean;
  /** Why the table is open by default (rivers, 4-bet pots), shown in the summary. */
  reason?: string;
}

export function ComboTable({ rows, open, reason }: Props) {
  const live = rows.filter((r) => r.left > 0.05);
  const blocked = rows.filter((r) => r.yours.length || r.board.length).length;
  return (
    <details className="combo-table" open={open}>
      <summary>
        Combo table <span className="muted small">· {live.length} hand classes, {blocked} cut by known cards{reason ? ` · ${reason}` : ''}</span>
      </summary>
      <div className="combo-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">Hand</th>
              <th scope="col" className="n">Combos left</th>
              <th scope="col">Removed by</th>
              <th scope="col">Against you</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.cls} className={r.category ? '' : 'gone'}>
                <th scope="row">{r.cls}</th>
                <td className="n num">{fmt(r.left)}<span className="muted small"> / {fmt(r.before)}</span></td>
                <td className="small"><Why r={r} /></td>
                <td className="small">
                  {r.category ? (
                    <>
                      <i className="dot" style={{ background: `var(${POSTFLOP_COLORS[r.category]})` }} />
                      {POSTFLOP_CATEGORY_INFO[r.category].label} <span className="muted num">· you {Math.round(r.heroEquity! * 100)}%</span>
                    </>
                  ) : (
                    <span className="muted">No combos left</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">Combos are weighted by how often their range plays each hand this way, so they can be fractions. The second number is the count before your cards and the board are taken out.</p>
    </details>
  );
}
