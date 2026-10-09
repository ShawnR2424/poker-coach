import { PREFLOP_CATEGORY_INFO, PREFLOP_ORDER, categoryTotals, type CellCategory, type PreflopCategory } from '../../engine/categories';
import type { Card } from '../../engine/cards';
import type { OpponentRead } from '../../engine/preflop/coach';
import { CLASS_COMBOS, comboCount, formatRange, removeDead, type HandClass } from '../../engine/range';
import { CategoryGrid } from './CategoryGrid';

export const PREFLOP_COLORS: Record<PreflopCategory, string> = {
  dominates: '--cat-bad',
  flip: '--cat-flip',
  dominated: '--cat-good',
  rest: '--cat-rest',
};

export interface ReadView {
  read: OpponentRead;
  position: string;
  cells: CellCategory<PreflopCategory>[] | null;
}

interface Props {
  reads: ReadView[];
  hero: Card[];
  dead: Card[];
  folded: string[];
  heroLine: string;
  nudge: string;
  heroEquity: number | null;
  threshold: { label: string; value: string } | null;
  hypothetical: boolean;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

function removedClasses(r: OpponentRead): Set<HandClass> {
  const out = new Set<HandClass>();
  if (!r.previous) return out;
  for (const [cls, idx] of CLASS_COMBOS) {
    const before = idx.reduce((a, i) => a + r.previous![i], 0);
    const after = idx.reduce((a, i) => a + r.range[i], 0);
    if (before > 0 && after <= 1e-9) out.add(cls);
  }
  return out;
}

export function RangeReadPanel({ reads, hero, dead, folded, heroLine, nudge, heroEquity, threshold, hypothetical }: Props) {
  return (
    <section className="range-read" aria-labelledby="rr-h">
      <div className="rr-head">
        <h2 id="rr-h">Range read</h2>
        <span className="sample-tag">Approximate GTO charts</span>
      </div>
      {reads.length > 1 && !hypothetical && (
        <p className="interaction">
          {reads.length} opponents are in. The caller saw the open and chose not to 3-bet, so their range is capped, while the opener's is not.
        </p>
      )}
      {reads.map(({ read, position, cells }) => {
        const live = removeDead(read.range, dead);
        const totals = cells ? categoryTotals(cells) : null;
        const all = comboCount(live);
        return (
          <article className="opp" key={read.seat}>
            <h3>{read.line}</h3>
            <p className="range-text"><code>{formatRange(read.range) || '(no hands)'}</code></p>
            <p className="muted small num">
              {all.toFixed(0)} combos after card removal ({pct(all / 1326)} of all hands)
            </p>
            <p>{read.change}</p>
            {read.tendency && <p className="tendency"><span className="eyebrow">Low-stakes tendency</span> {read.tendency}</p>}
            <CategoryGrid
              cells={cells}
              removed={removedClasses(read)}
              hero={hero}
              info={PREFLOP_CATEGORY_INFO}
              order={PREFLOP_ORDER}
              colorVar={PREFLOP_COLORS}
            />
            {totals && (
              <div className="cat-tiles">
                {PREFLOP_ORDER.map((k) => (
                  <div key={k} className="cat-tile">
                    <i style={{ background: `var(${PREFLOP_COLORS[k]})` }} />
                    <span className="small">{PREFLOP_CATEGORY_INFO[k].label}</span>
                    <strong className="num">{(totals.get(k) ?? 0).toFixed(0)}</strong>
                    <span className="muted small num">{all > 0 ? pct((totals.get(k) ?? 0) / all) : '0%'}</span>
                  </div>
                ))}
              </div>
            )}
            <span className="sr-only">{position}</span>
          </article>
        );
      })}
      <div className="read-summary">
        <div className="stat">
          <p className="eyebrow">{reads.length > 1 && !hypothetical ? 'Your equity vs all ranges' : 'Your equity vs this range'}</p>
          <p className="stat-value num">{heroEquity === null ? '…' : pct(heroEquity)}</p>
        </div>
        {threshold && (
          <div className="stat">
            <p className="eyebrow">{threshold.label}</p>
            <p className="stat-value num">{threshold.value}</p>
          </div>
        )}
      </div>
      {folded.length > 0 && <p className="folded-line muted">{folded.join(', ')} folded and {folded.length === 1 ? 'is' : 'are'} out.</p>}
      <div className="hero-read">
        <p className="eyebrow">What your line says</p>
        <p>{heroLine}</p>
      </div>
      <div className="nudge">
        <p className="eyebrow">What the read tells you</p>
        <p>{nudge}</p>
      </div>
    </section>
  );
}
