import { useMemo, useState } from 'react';
import { formatCards, type Card } from '../engine/cards';
import { ALL_CLASSES, CLASS_COMBOS, COMBO_CARDS, classOfCombo, type HandClass, type Range } from '../engine/range';

interface Props {
  range: Range;
  dead: readonly Card[];
  hero?: readonly Card[];
}

interface CellInfo {
  cls: HandClass;
  live: number; // weighted combos still possible
  inRange: number; // weighted combos before card removal
  total: number; // combos in the class (6/4/12)
  removed: string[]; // combos in the range knocked out by dead cards
}

/** 13x13 grid: pairs on the diagonal, suited above, offsuit below. Shading = live weighted combos. */
export function RangeGrid({ range, dead, hero }: Props) {
  const [selected, setSelected] = useState<HandClass | null>(null);
  const heroClass = hero && hero.length === 2 ? classOfCombo(hero[0], hero[1]) : null;

  const cells = useMemo<CellInfo[]>(() => {
    const deadSet = new Set(dead);
    return ALL_CLASSES.map((cls) => {
      const idx = CLASS_COMBOS.get(cls)!;
      let live = 0, inRange = 0;
      const removed: string[] = [];
      for (const i of idx) {
        const [a, b] = COMBO_CARDS[i];
        const w = range[i];
        inRange += w;
        if (deadSet.has(a) || deadSet.has(b)) {
          if (w > 0) removed.push(formatCards([a, b]));
        } else live += w;
      }
      return { cls, live, inRange, total: idx.length, removed };
    });
  }, [range, dead]);

  const sel = selected ? cells.find((c) => c.cls === selected)! : null;

  return (
    <div className="grid-wrap">
      <div className="range-grid" role="grid" aria-label="Range grid">
        {cells.map((c) => {
          const share = c.total ? c.live / c.total : 0;
          const crossed = c.inRange > 0 && c.live === 0;
          return (
            <button
              key={c.cls}
              type="button"
              role="gridcell"
              className={`cell${share >= 0.5 ? ' strong' : ''}${c.cls === heroClass ? ' hero' : ''}${crossed ? ' crossed' : ''}${selected === c.cls ? ' selected' : ''}`}
              style={{ ['--fill' as string]: share.toFixed(3) }}
              onClick={() => setSelected(selected === c.cls ? null : c.cls)}
              title={`${c.cls}: ${fmt(c.live)} of ${c.total} combos`}
              aria-label={`${c.cls}, ${fmt(c.live)} of ${c.total} combos in range`}
            >
              {c.cls}
            </button>
          );
        })}
      </div>
      <p className="cell-detail" aria-live="polite">
        {sel ? (
          <>
            <strong>{sel.cls}</strong>: <span className="num">{fmt(sel.live)}</span> of {sel.total} combos live
            {sel.inRange !== sel.live && sel.inRange > 0 && (
              <> (range had <span className="num">{fmt(sel.inRange)}</span>; removed {sel.removed.join(', ')})</>
            )}
            {sel.inRange === 0 && <> (not in this range)</>}
          </>
        ) : (
          <span className="muted">Tap a cell to see its combo count after card removal.</span>
        )}
      </p>
    </div>
  );
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
