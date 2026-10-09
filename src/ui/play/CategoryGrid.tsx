import { useState } from 'react';
import type { CellCategory } from '../../engine/categories';
import { classOfCombo, type HandClass } from '../../engine/range';
import type { Card } from '../../engine/cards';

interface Props<C extends string> {
  cells: CellCategory<C>[] | null;
  /** Classes the latest action removed from the range (shown crossed out). */
  removed: Set<HandClass>;
  hero: readonly Card[];
  info: Record<C, { label: string; detail: string }>;
  order: C[];
  colorVar: Record<C, string>;
}

/** 13x13 grid colored by how each hand class fares against the hero. */
export function CategoryGrid<C extends string>({ cells, removed, hero, info, order, colorVar }: Props<C>) {
  const [sel, setSel] = useState<HandClass | null>(null);
  const heroClass = classOfCombo(hero[0], hero[1]);
  const selected = sel && cells ? cells.find((c) => c.cls === sel) : null;
  return (
    <div className="grid-wrap">
      <div className="range-grid" role="grid" aria-label="Opponent range by matchup">
        {(cells ?? []).map((c) => {
          const crossed = removed.has(c.cls) && !c.category;
          const style = c.category ? { background: `var(${colorVar[c.category]})` } : undefined;
          return (
            <button
              key={c.cls}
              type="button"
              role="gridcell"
              className={`cell cat${c.category ? ' strong' : ''}${c.cls === heroClass ? ' hero' : ''}${crossed ? ' crossed' : ''}${sel === c.cls ? ' selected' : ''}`}
              style={style}
              onClick={() => setSel(sel === c.cls ? null : c.cls)}
              aria-label={`${c.cls}: ${c.category ? info[c.category].label : crossed ? 'just removed' : 'not in range'}`}
            >
              {c.cls}
            </button>
          );
        })}
        {!cells && <p className="muted small grid-loading">Working out matchups…</p>}
      </div>
      <ul className="legend">
        {order.map((k) => (
          <li key={k}><i style={{ background: `var(${colorVar[k]})` }} />{info[k].label}</li>
        ))}
        <li><i className="legend-cross" />Removed by the last action</li>
      </ul>
      <p className="cell-detail" aria-live="polite">
        {selected ? (
          selected.category ? (
            <>
              <strong>{selected.cls}</strong>: <span className="num">{fmt(selected.combos)}</span> combos after card removal.
              You have <span className="num">{Math.round(selected.heroEquity! * 100)}%</span> against it ({info[selected.category].label.toLowerCase()}).
            </>
          ) : removed.has(selected.cls) ? (
            <><strong>{selected.cls}</strong> was in their range before the last action and is now gone.</>
          ) : (
            <><strong>{selected.cls}</strong> is not in their range.</>
          )
        ) : (
          <span className="muted">Tap a cell for its combo count after card removal and your equity against it.</span>
        )}
      </p>
    </div>
  );
}

const fmt = (n: number) => (Math.abs(n - Math.round(n)) < 1e-6 ? String(Math.round(n)) : n.toFixed(1));
