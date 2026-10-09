// Turns an engine HandState into what the table shows: seat badges, timeline chips, hero stat tiles.

import type { Card } from '../../engine/cards';
import {
  effectiveStack, pot, potAtStreetStart, STREETS,
  type ActionRecord, type HandState, type Street,
} from '../../engine/hand';
import { potOdds, spr } from '../../engine/math';
import type { Position } from '../../engine/positions';
import { bbs, dollars, pct } from './format';

export type BadgeKind = 'fold' | 'posted' | 'raise' | 'bet' | 'call' | 'check' | 'allin' | 'toact' | 'yourturn' | 'none';

export interface SeatView {
  index: number;
  position: Position;
  stack: number;
  /** Chips in front of the player on this street. */
  committed: number;
  badge: { kind: BadgeKind; text: string };
  folded: boolean;
  isHero: boolean;
  isButton: boolean;
  isAggressor: boolean;
  hole: Card[] | null; // null = face down
  profile?: string;
}

export interface TimelineChip {
  who: string;
  text: string;
  kind: BadgeKind;
}

export interface TimelineRow {
  street: Street;
  board: Card[];
  chips: TimelineChip[];
}

export interface StatTile {
  label: string;
  value: string;
  sub?: string;
}

export const STREET_LABEL: Record<Street, string> = { preflop: 'Preflop', flop: 'Flop', turn: 'Turn', river: 'River' };

function actionText(a: ActionRecord): { text: string; kind: BadgeKind } {
  const amt = `${dollars(a.to)}`;
  if (a.allIn && a.type !== 'fold' && a.type !== 'check') return { text: `All-in ${amt}`, kind: 'allin' };
  switch (a.type) {
    case 'post': return { text: `Posted ${dollars(a.added)}`, kind: 'posted' };
    case 'fold': return { text: 'Fold', kind: 'fold' };
    case 'check': return { text: 'Check', kind: 'check' };
    case 'call': return { text: `Call ${dollars(a.to)}`, kind: 'call' };
    case 'bet': return { text: `Bet ${amt}`, kind: 'bet' };
    case 'raise': return { text: `Raise ${amt}`, kind: 'raise' };
  }
}

/** The last player to bet or raise on the current street (or the preflop raiser if none yet). */
export function aggressor(s: HandState): number | null {
  for (const street of [s.street, ...STREETS.slice(0, STREETS.indexOf(s.street)).reverse()]) {
    const agg = s.actions.filter((a) => a.street === street && (a.type === 'bet' || a.type === 'raise'));
    if (agg.length) return agg[agg.length - 1].player;
  }
  return null;
}

export function seatViews(s: HandState, hero: number, profiles: Record<number, string> = {}): SeatView[] {
  const agg = aggressor(s);
  return s.players.map((p, i) => {
    const mine = s.actions.filter((a) => a.player === i && a.street === s.street);
    const last = mine[mine.length - 1];
    let badge: SeatView['badge'] = { kind: 'none', text: '' };
    if (p.folded) badge = { kind: 'fold', text: 'Fold' };
    else if (s.toAct === i) badge = i === hero ? { kind: 'yourturn', text: 'Your turn' } : { kind: 'toact', text: 'To act' };
    else if (p.allIn) badge = { kind: 'allin', text: 'All-in' };
    else if (last) badge = last.type === 'call' ? { kind: 'call', text: 'Call' } : actionText(last);
    else if (s.toAct !== null) badge = { kind: 'toact', text: 'To act' };
    return {
      index: i,
      position: p.position,
      stack: p.stack,
      committed: p.committed,
      badge,
      folded: p.folded,
      isHero: i === hero,
      isButton: p.position === 'BTN',
      isAggressor: agg === i && !p.folded,
      hole: i === hero ? p.hole : null,
      profile: profiles[i],
    };
  });
}

export function timeline(s: HandState, hero: number): TimelineRow[] {
  const rows: TimelineRow[] = [];
  const boardAt: Record<Street, number> = { preflop: 0, flop: 3, turn: 4, river: 5 };
  for (const street of STREETS.slice(0, STREETS.indexOf(s.street) + 1)) {
    const chips: TimelineChip[] = s.actions
      .filter((a) => a.street === street)
      .map((a) => {
        const { text, kind } = actionText(a);
        return { who: a.player === hero ? 'You' : s.players[a.player].position, text, kind };
      });
    if (street === s.street && s.toAct === hero) chips.push({ who: 'You', text: '?', kind: 'yourturn' });
    rows.push({ street, board: s.board.slice(0, boardAt[street]), chips });
  }
  return rows;
}

/** Three tiles that change by spot: facing a bet vs. checked to / first in. */
export function heroTiles(s: HandState, hero: number): StatTile[] {
  const bb = s.config.bb;
  const p = s.players[hero];
  const toCall = Math.min(s.currentBet - p.committed, p.stack);
  const total = pot(s);
  if (toCall > 0) {
    const need = potOdds(toCall, total);
    return [
      { label: 'To call', value: dollars(toCall), sub: bbs(toCall, bb) },
      { label: 'Pot odds', value: `${(total / toCall).toFixed(1)} : 1`, sub: `${dollars(total)} pot for ${dollars(toCall)}` },
      { label: 'Equity needed', value: pct(need, 1), sub: 'call ÷ (pot + call)' },
    ];
  }
  const eff = effectiveStack(s, hero);
  const streetPot = s.street === 'preflop' ? total : potAtStreetStart(s);
  return [
    { label: 'Effective stack', value: dollars(eff), sub: bbs(eff, bb) },
    { label: 'Stack-to-pot', value: spr(eff, streetPot).toFixed(1), sub: `${dollars(eff)} behind, ${dollars(streetPot)} pot` },
    { label: 'All-in vs pot', value: `${(eff / total).toFixed(1)}× pot`, sub: 'size of a shove' },
  ];
}

