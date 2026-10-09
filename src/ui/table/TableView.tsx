import type { HandState } from '../../engine/hand';
import { pot } from '../../engine/hand';
import { CardSlot, PlayingCard } from '../PlayingCard';
import { bbs, dollars } from './format';
import { STREET_LABEL, type SeatView } from './view';

interface Props {
  state: HandState;
  seats: SeatView[];
  hero: number;
}

/** Oval table with the hero fixed at bottom center and the other seats clockwise from there. */
export function TableView({ state, seats, hero }: Props) {
  const n = seats.length;
  const bb = state.config.bb;
  const boardSize = state.board.length;
  return (
    <div className="table-wrap" aria-label="Poker table">
      <div className="felt" aria-hidden="true" />
      <div className="table-center">
        <p className="street-label">{STREET_LABEL[state.street]}</p>
        <div className="board-cards" aria-label="Board">
          {Array.from({ length: 5 }, (_, i) =>
            i < boardSize ? (
              <PlayingCard key={i} card={state.board[i]} size="sm" highlight={boardSize > 3 ? i === boardSize - 1 : false} />
            ) : (
              <CardSlot key={i} size="sm" />
            ),
          )}
        </div>
        <p className="pot-line">
          Pot <strong className="num">{dollars(pot(state))}</strong> <span className="muted num">{bbs(pot(state), bb)}</span>
        </p>
        <p className="blinds muted">Blinds {dollars(state.config.sb)}/{dollars(bb)}</p>
      </div>
      {seats.map((s) => {
        const offset = (s.index - hero + n) % n;
        const theta = Math.PI / 2 + (offset * 2 * Math.PI) / n;
        const x = Math.cos(theta), y = Math.sin(theta);
        // Radii live in CSS so the phone layout can pull seats and bets inward.
        const style = { ['--cx' as string]: x.toFixed(4), ['--cy' as string]: y.toFixed(4) };
        return (
          <div key={s.index} className="seat-slot" style={style}>
            <div
              className={`seat${s.folded ? ' folded' : ''}${s.isHero ? ' hero' : ''}${s.isAggressor ? ' aggressor' : ''}${s.badge.kind === 'yourturn' || s.badge.kind === 'toact' ? ' acting' : ''}`}
              aria-label={`${s.isHero ? 'You, ' : ''}${s.position}, stack ${dollars(s.stack)}, ${s.badge.text || 'waiting'}`}
            >
              <div className="seat-top">
                <span className="seat-pos">{s.isHero ? `You · ${s.position}` : s.position}</span>
                {s.isButton && <span className="dealer" title="Dealer button">D</span>}
              </div>
              <span className="seat-stack num">{dollars(s.stack)}</span>
              {s.badge.text && <span className={`badge badge-${s.badge.kind}`}>{s.badge.text}</span>}
              {s.profile && !s.isHero && <span className="profile-tag">{s.profile}</span>}
              {!s.folded && !s.isHero && (
                <span className="card-backs" aria-hidden="true"><i /><i /></span>
              )}
            </div>
            {s.committed > 0 && (
              <span className="bet-chip num">{dollars(s.committed)}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
