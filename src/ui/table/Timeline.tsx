import { PlayingCard } from '../PlayingCard';
import { STREET_LABEL, type TimelineRow } from './view';

export function Timeline({ rows }: { rows: TimelineRow[] }) {
  return (
    <section className="timeline" aria-label="Action so far">
      {rows.map((r) => (
        <div className="tl-row" key={r.street}>
          <div className="tl-street">
            <span className="eyebrow">{STREET_LABEL[r.street]}</span>
            {r.board.length > 0 && (
              <span className="tl-board">{r.board.slice(r.street === 'flop' ? 0 : -1).map((c) => <PlayingCard key={c} card={c} size="xs" />)}</span>
            )}
          </div>
          <ol className="tl-chips">
            {r.chips.map((c, i) => (
              <li key={i} className={`tl-chip badge-${c.kind}${c.who === 'You' ? ' mine' : ''}`}>
                <span className="tl-who">{c.who}</span> {c.text}
              </li>
            ))}
          </ol>
        </div>
      ))}
    </section>
  );
}
