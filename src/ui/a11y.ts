// Keyboard and screen reader support shared by the screens: card names read aloud, arrow-key
// movement in the 13x13 hand grids, keyboard shortcuts for the table's actions, moving focus to
// the next thing to press once the control that had it is gone, and the sentences the table
// announces as opponents act and cards come.

import { useEffect, useState, type KeyboardEvent, type RefObject } from 'react';
import { RANKS, rankOf, suitOf, type Card } from '../engine/cards';
import type { ActionRecord, HandState } from '../engine/hand';
import { dollars } from './table/format';

const SUIT_NAMES = ['clubs', 'diamonds', 'hearts', 'spades'];
const RANK_NAMES: Record<string, string> = { T: '10', J: 'jack', Q: 'queen', K: 'king', A: 'ace' };

/** A card as a screen reader should say it: "ace of spades", "10 of hearts". */
export function cardName(c: Card): string {
  const r = RANKS[rankOf(c)];
  return `${RANK_NAMES[r] ?? r} of ${SUIT_NAMES[suitOf(c)]}`;
}

export const cardsName = (cs: readonly Card[]) => cs.map(cardName).join(', ');

// ---- Hand grids -------------------------------------------------------------------------------

export const GRID_SIZE = 13;

/**
 * Where a key moves focus in a grid of `count` cells, `cols` wide: arrows by one cell, Home and
 * End to the ends of the row, Ctrl+Home and Ctrl+End to the first and last cell. Null for any
 * other key, or a move off the edge.
 */
export function gridStep(i: number, key: string, ctrl = false, cols = GRID_SIZE, count = GRID_SIZE * GRID_SIZE): number | null {
  const row = Math.floor(i / cols), col = i % cols;
  let next: number;
  switch (key) {
    case 'ArrowRight': next = col < cols - 1 ? i + 1 : i; break;
    case 'ArrowLeft': next = col > 0 ? i - 1 : i; break;
    case 'ArrowDown': next = i + cols < count ? i + cols : i; break;
    case 'ArrowUp': next = i - cols >= 0 ? i - cols : i; break;
    case 'Home': next = ctrl ? 0 : row * cols; break;
    case 'End': next = ctrl ? count - 1 : Math.min(row * cols + cols - 1, count - 1); break;
    default: return null;
  }
  return next;
}

export interface GridCellProps {
  'data-gi': number;
  tabIndex: number;
  onFocus: () => void;
}

/**
 * Roving focus for a hand grid: the grid is one Tab stop, and the arrow keys move between cells.
 * Spread `cellProps(i)` on each cell and `onKeyDown` on the grid.
 */
export function useGridNav() {
  const [active, setActive] = useState(0);
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const from = Number((e.target as HTMLElement).dataset?.gi ?? active);
    const next = gridStep(from, e.key, e.ctrlKey || e.metaKey);
    if (next === null) return;
    e.preventDefault();
    setActive(next);
    e.currentTarget.querySelector<HTMLElement>(`[data-gi="${next}"]`)?.focus();
  };
  const cellProps = (i: number): GridCellProps => ({ 'data-gi': i, tabIndex: i === active ? 0 : -1, onFocus: () => setActive(i) });
  return { onKeyDown, cellProps };
}

// ---- Focus ------------------------------------------------------------------------------------

/** Focus was dropped: the element that had it left the page, or nothing had it. */
export function focusLost(doc: Document = document): boolean {
  const a = doc.activeElement;
  return !a || a === doc.body || a === doc.documentElement;
}

/**
 * Moves focus to `ref` when it appears (or `when` turns true) if focus was dropped: pressing an
 * action removes its button, so the next control to press takes focus and a keyboard player can
 * keep going with Enter. Focus that is somewhere else on purpose is left alone, and the page
 * does not scroll.
 */
export function useClaimFocus(ref: RefObject<HTMLElement | null>, when = true) {
  useEffect(() => {
    if (when && ref.current && focusLost()) ref.current.focus({ preventScroll: true });
  }, [ref, when]);
}

/** Keyboard shortcuts are off while typing in a field or using a menu. */
export function isTyping(el: EventTarget | null): boolean {
  if (!(el instanceof Element)) return false;
  return !!el.closest('input, textarea, select, [contenteditable="true"]');
}

// ---- Table shortcuts --------------------------------------------------------------------------

/** What a key does at the table: one of the action buttons, by its kind and place in the row. */
export type ShortcutTarget = { kind: 'fold' } | { kind: 'passive' } | { kind: 'size'; index: number } | { kind: 'allin' };

/**
 * F folds, C checks or calls, 1-9 pick the bet or raise sizes left to right, A goes all-in.
 * Modified keys (Ctrl, Alt, Cmd) are left to the browser.
 */
export function shortcutFor(key: string, mods: { ctrl?: boolean; alt?: boolean; meta?: boolean } = {}): ShortcutTarget | null {
  if (mods.ctrl || mods.alt || mods.meta) return null;
  const k = key.toLowerCase();
  if (k === 'f') return { kind: 'fold' };
  if (k === 'c' || k === 'k') return { kind: 'passive' };
  if (k === 'a') return { kind: 'allin' };
  if (/^[1-9]$/.test(k)) return { kind: 'size', index: Number(k) - 1 };
  return null;
}

// ---- Announcements ----------------------------------------------------------------------------

const STREET_NAMES = { preflop: 'Preflop', flop: 'Flop', turn: 'Turn', river: 'River' } as const;

function saidAction(a: ActionRecord, who: string): string {
  const s = who === 'You' ? '' : 's';
  if (a.allIn && a.type !== 'fold' && a.type !== 'check') return `${who} go${who === 'You' ? '' : 'es'} all-in for ${dollars(a.to)}`;
  switch (a.type) {
    case 'post': return `${who} post${s} ${dollars(a.added)}`;
    case 'fold': return `${who} fold${s}`;
    case 'check': return `${who} check${s}`;
    case 'call': return `${who} call${s} ${dollars(a.to)}`;
    case 'bet': return `${who} bet${s} ${dollars(a.to)}`;
    case 'raise': return `${who} raise${s} to ${dollars(a.to)}`;
  }
}

/** A grade read aloud: "Mistake. This is a fold", without saying the verdict twice. */
export function gradeSaid(label: string, heading: string): string {
  return heading.toLowerCase().startsWith(label.toLowerCase()) ? heading : `${label}. ${heading}`;
}

/** Ends a sentence with one full stop. */
export const sentence = (t: string) => (/[.!?]$/.test(t.trim()) ? t.trim() : `${t.trim()}.`);

/** How much of a hand a screen reader has already been told: actions and board cards. */
export interface Told { actions: number; board: number }
export const told = (s: HandState): Told => ({ actions: s.actions.length, board: s.board.length });

/**
 * What happened at the table since `since`, as sentences for a screen reader: each player's
 * action in order, the cards as each street is dealt, and whether it is the hero's turn (`yourTurn`; by default,
 * whenever the hero is next to act). Blinds are left out;
 * the table already shows them.
 */
export function tableNews(s: HandState, hero: number, since: Told, yourTurn = s.toAct === hero && !s.result): string {
  const parts: string[] = [];
  let shown = since.board;
  const showTo = (n: number) => {
    for (const [st, end] of [['flop', 3], ['turn', 4], ['river', 5]] as const) {
      if (shown < end && n >= end) {
        parts.push(`${STREET_NAMES[st]}: ${cardsName(s.board.slice(shown, end))}`);
        shown = end;
      }
    }
  };
  const boardAt = { preflop: 0, flop: 3, turn: 4, river: 5 } as const;
  for (const a of s.actions.slice(since.actions)) {
    showTo(Math.min(boardAt[a.street], s.board.length));
    if (a.type === 'post') continue;
    parts.push(saidAction(a, a.player === hero ? 'You' : s.players[a.player].position));
  }
  showTo(s.board.length);
  if (yourTurn) parts.push('Your turn');
  return parts.length ? `${parts.join('. ')}.` : '';
}
