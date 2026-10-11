// Opponent stats: how each opponent style has played after the flop in this session, next to the
// whole table's rates, with what to do about it. The Play tab shows the styles in the current
// hand; the Session tab shows all four.

import { useMemo } from 'react';
import { PROFILE_IDS, PROFILES, type ProfileId } from '../../engine/postflop/model';
import { MIN_ACTIONS, MIN_FACING, poolStats, readStats, styleStats } from '../../engine/session/hud';
import type { HandRecord } from '../../engine/session/session';
import './session.css';

const pct = (x: number | null) => (x === null ? '–' : `${Math.round(x * 100)}%`);

interface Props {
  hands: readonly HandRecord[];
  /** Styles to show, in order; all four when left out. */
  styles?: readonly ProfileId[];
  /** Heading level and wording for the Play tab. */
  compact?: boolean;
}

export function OpponentStats({ hands, styles = PROFILE_IDS, compact = false }: Props) {
  const stats = useMemo(() => styleStats(hands), [hands]);
  const table = poolStats(stats);
  const rows = [...new Set(styles)].map((id) => ({ id, s: stats.get(id), read: readStats(stats.get(id), table) }));
  const sample = (n: number | undefined, min: number) => (n && n >= min ? `${n}` : `${n ?? 0} (needs ${min})`);

  return (
    <section className={`panel opp-stats${compact ? ' compact' : ''}`} aria-labelledby="opp-stats-h">
      <h2 id="opp-stats-h">{compact ? 'How these opponents have played' : 'Opponent stats'}</h2>
      <p className="muted small">
        Each opponent's style is on its seat tag. Below are each style's postflop numbers over this session's practice hands (hands after the flop, how often it folded when facing a bet, and how often it bet or raised), next to the whole table's.
        {compact ? '' : ' Preflop numbers such as VPIP and PFR are left out: every style opens and defends from the same charts, and the table sets up the preflop action to reach each level\'s spot.'}
      </p>
      <div className="table-scroll">
        <table className="data">
          <thead>
            <tr>
              <th scope="col">Style</th>
              <th scope="col" className="n">Hands</th>
              <th scope="col" className="n">Fold to bet</th>
              <th scope="col" className="n">Bet or raise</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ id, s, read }) => (
              <tr key={id} data-style={id}>
                <th scope="row">{PROFILES[id].label}</th>
                <td className="n num">{s?.hands ?? 0}</td>
                <td className="n num" title={`Decisions facing a bet: ${sample(s?.facingBet, MIN_FACING)}`}>{pct(read.foldToBet)}</td>
                <td className="n num" title={`Postflop decisions: ${sample(s?.actions, MIN_ACTIONS)}`}>{pct(read.aggression)}</td>
              </tr>
            ))}
            <tr className="opp-table-row">
              <th scope="row">Table</th>
              <td className="n num">{table.hands}</td>
              <td className="n num">{pct(read0(table.facingBet, table.folded, MIN_FACING))}</td>
              <td className="n num">{pct(read0(table.actions, table.aggressive, MIN_ACTIONS))}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <ul className="opp-notes small">
        {rows.map(({ id, s, read }) => (
          <li key={id}>
            <strong>{PROFILES[id].label}:</strong>{' '}
            {read.notes.length
              ? read.notes.join(' ')
              : read.foldToBet === null && read.aggression === null
                ? `not enough postflop hands yet (a rate shows after ${MIN_FACING} bets faced or ${MIN_ACTIONS} decisions; ${s?.facingBet ?? 0} and ${s?.actions ?? 0} so far).`
                : 'no clear difference from the table yet, so play your usual game.'}
          </li>
        ))}
      </ul>
    </section>
  );
}

const read0 = (of: number, n: number, min: number) => (of >= min ? n / of : null);
