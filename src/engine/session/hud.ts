// Opponent stats: how each opponent style has played after the flop in this session's hands,
// and what that suggests doing against it.
//
// Only postflop play is counted. Before the flop every style plays the same pool charts, and the
// practice table scripts the preflop action to reach each level's spot (players who are not in
// the hand simply fold), so preflop numbers such as VPIP or PFR would describe the hand
// generator rather than the opponents. After the flop each opponent acts from its own style.

import type { ActionRecord } from '../hand';
import type { ProfileId } from '../postflop/model';
import { IMPORTED_LEVEL } from './import';
import { replayStates } from './replay';
import type { HandRecord } from './session';

export interface StyleStats {
  /** Hands this style played after the flop. */
  hands: number;
  /** Postflop decisions facing a bet or raise, and how many of them folded. */
  facingBet: number;
  folded: number;
  /** Postflop decisions of any kind, and how many of them bet or raised. */
  actions: number;
  aggressive: number;
}

const empty = (): StyleStats => ({ hands: 0, facingBet: 0, folded: 0, actions: 0, aggressive: 0 });

/** Adds one hand's postflop actions by the seats in `seats` to `out`, keyed by each seat's style. */
export function countHand(actions: readonly ActionRecord[], seats: Record<number, ProfileId>, out: Map<ProfileId, StyleStats>): void {
  let street: ActionRecord['street'] | null = null;
  let bet = 0;
  let committed = new Map<number, number>();
  const played = new Set<number>();
  for (const a of actions) {
    if (a.street !== street) {
      street = a.street;
      bet = 0;
      committed = new Map();
    }
    const style = seats[a.player];
    if (a.street !== 'preflop' && style && a.type !== 'post') {
      const st = out.get(style) ?? empty();
      if (!out.has(style)) out.set(style, st);
      played.add(a.player);
      st.actions++;
      if (a.type === 'bet' || a.type === 'raise') st.aggressive++;
      if (bet > (committed.get(a.player) ?? 0)) {
        st.facingBet++;
        if (a.type === 'fold') st.folded++;
      }
    }
    if (a.type !== 'fold' && a.type !== 'check') committed.set(a.player, a.to);
    bet = Math.max(bet, a.to);
  }
  for (const seat of played) out.get(seats[seat])!.hands++;
}

/** Postflop stats by style over the practice hands with a replay (imported and level 1 hands have no styles). */
export function styleStats(hands: readonly HandRecord[]): Map<ProfileId, StyleStats> {
  const out = new Map<ProfileId, StyleStats>();
  for (const h of hands) {
    const r = h.replay;
    if (!r || h.level === IMPORTED_LEVEL || h.level === 1) continue;
    const seats: Record<number, ProfileId> = {};
    for (const v of r.villains) if (r.profiles[v]) seats[v] = r.profiles[v] as ProfileId;
    try {
      const states = replayStates(r);
      countHand(states[states.length - 1].actions, seats, out);
    } catch {
      // A record that no longer replays is skipped.
    }
  }
  return out;
}

/** Decisions needed before a rate is shown with a note. */
export const MIN_FACING = 12;
export const MIN_ACTIONS = 20;
/**
 * How far a style's rate must sit from the whole table's before it gets a note. Rates are read
 * against the table rather than fixed numbers because how often anyone folds depends on the
 * bets they face: a player who bets big gets more folds from everyone. On a small sample the gap
 * must also be at least two standard errors, so a few lucky folds do not earn a note.
 */
export const FOLD_GAP = 0.12;
export const AGGRESSION_GAP = 0.09;

/** Every style's stats added together: the table the styles are compared with. */
export function poolStats(stats: Map<ProfileId, StyleStats>): StyleStats {
  const t = empty();
  for (const s of stats.values()) {
    t.hands += s.hands; t.facingBet += s.facingBet; t.folded += s.folded; t.actions += s.actions; t.aggressive += s.aggressive;
  }
  return t;
}

export interface StyleRead {
  /** Share of bets and raises they folded to, and the whole table's (null until there are enough). */
  foldToBet: number | null;
  tableFoldToBet: number | null;
  /** Share of their postflop decisions that were a bet or raise, and the whole table's. */
  aggression: number | null;
  tableAggression: number | null;
  /** What to do about it, one line each; empty when the rates are close to the table's or the sample is small. */
  notes: string[];
}

export function readStats(s: StyleStats | undefined, table: StyleStats): StyleRead {
  const tableFoldToBet = table.facingBet >= MIN_FACING ? table.folded / table.facingBet : null;
  const tableAggression = table.actions >= MIN_ACTIONS ? table.aggressive / table.actions : null;
  const foldToBet = s && s.facingBet >= MIN_FACING ? s.folded / s.facingBet : null;
  const aggression = s && s.actions >= MIN_ACTIONS ? s.aggressive / s.actions : null;
  const notes: string[] = [];
  const gap = (min: number, p: number, n: number) => Math.max(min, 2 * Math.sqrt((p * (1 - p)) / n));
  if (foldToBet !== null && tableFoldToBet !== null) {
    const g = gap(FOLD_GAP, tableFoldToBet, s!.facingBet);
    if (foldToBet >= tableFoldToBet + g) notes.push('Folds to bets more than the table: bluff them more, and expect little action on your value bets.');
    if (foldToBet <= tableFoldToBet - g) notes.push('Folds to bets less than the table: value-bet thinner and bluff less.');
  }
  if (aggression !== null && tableAggression !== null) {
    const g = gap(AGGRESSION_GAP, tableAggression, s!.actions);
    if (aggression >= tableAggression + g) notes.push('Bets and raises more than the table: call down lighter, and let them keep betting into your strong hands.');
    if (aggression <= tableAggression - g) notes.push('Bets and raises less than the table: when they do, give them credit for a strong hand.');
  }
  return { foldToBet, tableFoldToBet, aggression, tableAggression, notes };
}
