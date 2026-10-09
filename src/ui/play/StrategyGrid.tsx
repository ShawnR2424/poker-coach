import type { Frequencies } from '../../engine/preflop/charts';
import { ALL_CLASSES, type HandClass } from '../../engine/range';

interface Props {
  freqs: Map<HandClass, Frequencies>;
  heroClass: HandClass;
  names: { raise: string; call: string; fold: string };
}

/** The hero's chart for this spot: each cell split into raise / call / fold shares. */
export function StrategyGrid({ freqs, heroClass, names }: Props) {
  return (
    <div className="grid-wrap">
      <div className="range-grid" role="grid" aria-label="Your strategy for this spot">
        {ALL_CLASSES.map((cls) => {
          const f = freqs.get(cls)!;
          const r = f.raise * 100, c = (f.raise + f.call) * 100;
          const bg = `linear-gradient(to right, var(--act-raise) 0 ${r}%, var(--act-call) ${r}% ${c}%, var(--act-fold) ${c}% 100%)`;
          return (
            <span
              key={cls}
              role="gridcell"
              className={`cell strat${f.fold < 0.5 ? ' strong' : ''}${cls === heroClass ? ' hero' : ''}`}
              style={{ background: bg }}
              title={`${cls}: ${names.raise} ${Math.round(f.raise * 100)}%, ${names.call} ${Math.round(f.call * 100)}%, ${names.fold} ${Math.round(f.fold * 100)}%`}
            >
              {cls}
            </span>
          );
        })}
      </div>
      <ul className="legend">
        <li><i style={{ background: 'var(--act-raise)' }} />{cap(names.raise)}</li>
        <li><i style={{ background: 'var(--act-call)' }} />{cap(names.call)}</li>
        <li><i style={{ background: 'var(--act-fold)' }} />{cap(names.fold)}</li>
      </ul>
    </div>
  );
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
