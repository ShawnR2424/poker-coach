// No-limit hold'em hand state machine: blinds, legal actions, min-raise rules, all-ins,
// street transitions, uncalled bets, side pots, and showdown.
// All chip amounts are integers in the smallest unit (cents at $0.25/$0.50).
// Players are stored clockwise starting from the SB, which is also postflop action order.

import type { Card } from './cards';
import { evaluate } from './evaluator';
import { clockwiseFromSB, type Position } from './positions';
import { makeRng, shuffle } from './rng';

export type Street = 'preflop' | 'flop' | 'turn' | 'river';
export const STREETS: Street[] = ['preflop', 'flop', 'turn', 'river'];

/**
 * The house's cut of each pot: `pct` of the pot, rounded down to the chip and capped at
 * `capBB` big blinds. No flop, no drop: a hand that ends before the flop is dealt pays none.
 */
export interface Rake {
  pct: number;
  capBB: number;
}

export interface HandConfig {
  tableSize: number;
  sb: number;
  bb: number;
  /** No rake when absent. */
  rake?: Rake;
}

/** Share of each further chip in a pot of `amount` that the winner keeps: below 1 until the cap is hit. */
export function rakeKeep(amount: number, config: Pick<HandConfig, 'bb' | 'rake'>): number {
  if (!config.rake || rakeOf(amount, config) >= Math.round(config.rake.capBB * config.bb)) return 1;
  return 1 - config.rake.pct;
}

/** Rake on a pot of `amount` chips once the flop is dealt (0 without a rake). */
export function rakeOf(amount: number, config: Pick<HandConfig, 'bb' | 'rake'>): number {
  if (!config.rake || amount <= 0) return 0;
  return Math.min(Math.floor(config.rake.pct * amount), Math.round(config.rake.capBB * config.bb));
}

export interface Player {
  position: Position;
  stack: number;
  /** Chips put in on the current street. */
  committed: number;
  /** Chips put in over the whole hand. */
  total: number;
  folded: boolean;
  allIn: boolean;
  /** Has acted since the last bet or raise on this street. */
  hasActed: boolean;
  /** May still raise (false after acting until someone makes a full raise). */
  canRaise: boolean;
  hole: Card[];
}

export type ActionType = 'post' | 'fold' | 'check' | 'call' | 'bet' | 'raise';

export interface ActionRecord {
  street: Street;
  player: number;
  type: ActionType;
  /** Chips added to the pot by this action. */
  added: number;
  /** Player's street total after the action (the "to" amount for bets and raises). */
  to: number;
  allIn: boolean;
}

export type Action =
  | { type: 'fold' }
  | { type: 'check' }
  | { type: 'call' }
  | { type: 'bet'; to: number }
  | { type: 'raise'; to: number };

export interface PotResult {
  /** Chips the winners share, after any rake. */
  amount: number;
  eligible: number[];
  winners: number[];
  /** True when only one player could win it (an uncalled excess). */
  uncalled: boolean;
}

export interface HandResult {
  pots: PotResult[];
  /** Net chips won (positive) or lost (negative) per player this hand. */
  net: number[];
  /** Hand scores for players who reached showdown (null otherwise). */
  scores: (number | null)[];
  wentToShowdown: boolean;
  /** Chips the house took from the pot. */
  rake: number;
}

export interface HandState {
  config: HandConfig;
  players: Player[];
  street: Street;
  board: Card[];
  /** Undealt cards, dealt from the end. */
  deck: Card[];
  currentBet: number;
  /** Size of the last full bet or raise increment on this street. */
  minRaise: number;
  /** Index of the player to act, or null when the hand is over. */
  toAct: number | null;
  actions: ActionRecord[];
  startingStacks: number[];
  result: HandResult | null;
}

export interface NewHandInput {
  config: HandConfig;
  /** Stacks clockwise from SB. */
  stacks: number[];
  /** Optional fixed hole cards per player (clockwise from SB); missing ones are dealt. */
  hole?: (Card[] | null)[];
  /** Optional fixed board cards in deal order; the rest are dealt from the deck. */
  board?: Card[];
  seed: number;
}

export function newHand({ config, stacks, hole, board, seed }: NewHandInput): HandState {
  const positions = clockwiseFromSB(config.tableSize);
  if (stacks.length !== positions.length) throw new Error('One stack per seat required');

  const used = new Set<Card>();
  const fixed = [...(hole ?? []).flatMap((h) => h ?? []), ...(board ?? [])];
  for (const c of fixed) {
    if (used.has(c)) throw new Error('Duplicate card in setup');
    used.add(c);
  }
  const deck = shuffle(
    Array.from({ length: 52 }, (_, i) => i).filter((c) => !used.has(c)),
    makeRng(seed),
  );
  // Fixed board cards go on top of the deck in deal order (dealt from the end).
  for (const c of [...(board ?? [])].reverse()) deck.push(c);

  const players: Player[] = positions.map((position, i) => ({
    position,
    stack: stacks[i],
    committed: 0,
    total: 0,
    folded: false,
    allIn: false,
    hasActed: false,
    canRaise: true,
    hole: hole?.[i] ? [...hole[i]!] : [],
  }));
  // Deal missing hole cards from the bottom of the deck so fixed board cards stay on top.
  for (const p of players) while (p.hole.length < 2) p.hole.push(deck.shift()!);

  const s: HandState = {
    config,
    players,
    street: 'preflop',
    board: [],
    deck,
    currentBet: 0,
    minRaise: config.bb,
    toAct: null,
    actions: [],
    startingStacks: [...stacks],
    result: null,
  };
  post(s, 0, config.sb);
  post(s, 1, config.bb);
  s.currentBet = Math.max(players[0].committed, players[1].committed);
  s.toAct = nextToAct(s, 1);
  if (s.toAct === null) finishStreet(s);
  return s;
}

function post(s: HandState, i: number, amount: number) {
  const p = s.players[i];
  const added = Math.min(amount, p.stack);
  p.stack -= added;
  p.committed += added;
  p.total += added;
  if (p.stack === 0) p.allIn = true;
  s.actions.push({ street: 'preflop', player: i, type: 'post', added, to: p.committed, allIn: p.allIn });
}

// ---- Queries ----

export const pot = (s: HandState): number => s.players.reduce((a, p) => a + p.total, 0);

/** Pot before the current street's bets. */
export const potAtStreetStart = (s: HandState): number =>
  s.players.reduce((a, p) => a + p.total - p.committed, 0);

export const activePlayers = (s: HandState): number[] =>
  s.players.flatMap((p, i) => (p.folded ? [] : [i]));

/** Smallest stack among `i` and the opponents still in the hand, counting chips behind only. */
export function effectiveStack(s: HandState, i: number): number {
  const others = activePlayers(s).filter((j) => j !== i).map((j) => s.players[j].stack + s.players[j].committed);
  const mine = s.players[i].stack + s.players[i].committed;
  return Math.min(mine, Math.max(0, ...others)) - s.players[i].committed;
}

export interface LegalActions {
  fold: boolean;
  check: boolean;
  /** Chips needed to call (capped at stack), or null. */
  call: number | null;
  /** Bet "to" range when no one has bet this street. */
  bet: { min: number; max: number } | null;
  /** Raise "to" range. min === max means only an all-in is possible. */
  raise: { min: number; max: number } | null;
}

export function legalActions(s: HandState): LegalActions {
  const none: LegalActions = { fold: false, check: false, call: null, bet: null, raise: null };
  if (s.toAct === null) return none;
  const p = s.players[s.toAct];
  const toCall = s.currentBet - p.committed;
  const maxTo = p.committed + p.stack;
  const out = { ...none };
  if (toCall > 0) {
    out.fold = true;
    out.call = Math.min(toCall, p.stack);
  } else {
    out.check = true;
  }
  if (s.currentBet === 0) {
    if (p.stack > 0) out.bet = { min: Math.min(s.config.bb, maxTo), max: maxTo };
  } else if (p.canRaise && p.stack > toCall && othersCanCall(s, s.toAct)) {
    const minTo = s.currentBet + s.minRaise;
    out.raise = maxTo <= minTo ? { min: maxTo, max: maxTo } : { min: minTo, max: maxTo };
  }
  return out;
}

/** A raise needs at least one opponent who still has chips to respond with. */
function othersCanCall(s: HandState, i: number): boolean {
  return s.players.some((p, j) => j !== i && !p.folded && !p.allIn);
}

// ---- Applying actions ----

export function applyAction(prev: HandState, action: Action): HandState {
  if (prev.toAct === null) throw new Error('Hand is over');
  const s = structuredClone(prev);
  const i = s.toAct!;
  const p = s.players[i];
  const legal = legalActions(s);
  const rec = (type: ActionType, added: number) =>
    s.actions.push({ street: s.street, player: i, type, added, to: p.committed, allIn: p.allIn });
  const put = (amount: number) => {
    p.stack -= amount;
    p.committed += amount;
    p.total += amount;
    if (p.stack === 0) p.allIn = true;
  };

  switch (action.type) {
    case 'fold':
      if (!legal.fold) throw new Error('Cannot fold when checking is free');
      p.folded = true;
      rec('fold', 0);
      break;
    case 'check':
      if (!legal.check) throw new Error('Cannot check facing a bet');
      rec('check', 0);
      break;
    case 'call': {
      if (legal.call === null) throw new Error('Nothing to call');
      put(legal.call);
      rec('call', legal.call);
      break;
    }
    case 'bet':
    case 'raise': {
      const range = action.type === 'bet' ? legal.bet : legal.raise;
      if (!range) throw new Error(`Cannot ${action.type} now`);
      const to = action.to;
      if (!Number.isInteger(to) || to < range.min || to > range.max) {
        throw new Error(`${action.type} must be to between ${range.min} and ${range.max}, got ${to}`);
      }
      const increment = to - s.currentBet;
      const added = to - p.committed;
      put(added);
      if (increment >= s.minRaise) {
        // Full raise: reopens action for everyone.
        s.minRaise = increment;
        s.players.forEach((q, j) => { if (j !== i) q.canRaise = true; });
      }
      // Any increase (even a short all-in) means everyone else must respond again.
      s.players.forEach((q, j) => { if (j !== i) q.hasActed = false; });
      s.currentBet = to;
      rec(action.type, added);
      break;
    }
  }
  p.hasActed = true;
  p.canRaise = false;
  advance(s, i);
  return s;
}

function nextToAct(s: HandState, from: number): number | null {
  const n = s.players.length;
  for (let k = 1; k <= n; k++) {
    const j = (from + k) % n;
    const q = s.players[j];
    if (q.folded || q.allIn) continue;
    if (!q.hasActed || q.committed < s.currentBet) return j;
  }
  return null;
}

function advance(s: HandState, from: number) {
  if (activePlayers(s).length === 1) {
    s.toAct = null;
    settle(s);
    return;
  }
  const next = nextToAct(s, from);
  // A lone player with chips left who has already matched the bet has nobody to bet into.
  const canStillAct = s.players.filter((q) => !q.folded && !q.allIn).length;
  if (next !== null && !(canStillAct === 1 && s.players[next].committed >= s.currentBet)) {
    s.toAct = next;
    return;
  }
  s.toAct = null;
  finishStreet(s);
}

function returnUncalled(s: HandState) {
  const totals = s.players.map((p) => p.total);
  const max = Math.max(...totals);
  const top = totals.indexOf(max);
  const second = Math.max(...totals.filter((_, j) => j !== top));
  if (max > second) {
    const p = s.players[top];
    const excess = max - second;
    p.total -= excess;
    p.committed -= excess;
    p.stack += excess;
    if (p.stack > 0) p.allIn = false;
  }
}

function finishStreet(s: HandState) {
  returnUncalled(s);
  const canAct = s.players.filter((q) => !q.folded && !q.allIn).length;
  if (s.street === 'river') {
    settle(s);
    return;
  }
  for (const q of s.players) {
    q.committed = 0;
    q.hasActed = false;
    q.canRaise = true;
  }
  s.currentBet = 0;
  s.minRaise = s.config.bb;
  s.street = STREETS[STREETS.indexOf(s.street) + 1];
  const deal = s.street === 'flop' ? 3 : 1;
  for (let k = 0; k < deal; k++) s.board.push(s.deck.pop()!);

  if (canAct <= 1) {
    // Everyone (or all but one) is all-in: run the board out with no more betting.
    finishStreet(s);
    return;
  }
  s.toAct = nextToAct(s, s.players.length - 1);
  if (s.toAct === null) finishStreet(s);
}

// ---- Settlement ----

function settle(s: HandState) {
  s.toAct = null;
  returnUncalled(s);
  const n = s.players.length;
  const contenders = activePlayers(s);
  const showdown = contenders.length > 1;
  const scores: (number | null)[] = s.players.map((p, i) =>
    showdown && contenders.includes(i) ? evaluate([...p.hole, ...s.board]) : null,
  );

  const remaining = s.players.map((p) => p.total);
  const pots: PotResult[] = [];
  while (remaining.some((x) => x > 0)) {
    const live = contenders.filter((i) => remaining[i] > 0);
    if (live.length === 0) {
      // Dead money from folded players above every live contribution joins the last pot.
      const extra = remaining.reduce((a, b) => a + b, 0);
      if (pots.length) pots[pots.length - 1].amount += extra;
      else pots.push({ amount: extra, eligible: contenders, winners: [], uncalled: false });
      remaining.fill(0);
      break;
    }
    const level = Math.min(...live.map((i) => remaining[i]));
    let amount = 0;
    for (let j = 0; j < n; j++) {
      const take = Math.min(remaining[j], level);
      amount += take;
      remaining[j] -= take;
    }
    pots.push({ amount, eligible: live, winners: [], uncalled: live.length === 1 && showdown });
  }

  const rake = s.board.length >= 3 ? takeRake(pots, s.config) : 0;

  const won = new Array(n).fill(0);
  for (const pt of pots) {
    let winners: number[];
    if (!showdown) winners = contenders;
    else {
      const best = Math.max(...pt.eligible.map((i) => scores[i]!));
      winners = pt.eligible.filter((i) => scores[i] === best);
    }
    pt.winners = winners;
    const share = Math.floor(pt.amount / winners.length);
    let odd = pt.amount - share * winners.length;
    // Odd chips go to the first winners clockwise from the button (SB first).
    for (const w of [...winners].sort((a, b) => a - b)) {
      won[w] += share + (odd > 0 ? 1 : 0);
      if (odd > 0) odd--;
    }
  }

  s.players.forEach((p, i) => {
    p.stack += won[i];
  });
  s.result = {
    pots,
    net: s.players.map((p, i) => p.stack - s.startingStacks[i]),
    scores,
    wentToShowdown: showdown,
    rake,
  };
}

/**
 * Takes the rake on everything contested from the pots, in proportion to their size, with
 * any odd chips from the main pot. Chips only one player could win are not contested.
 */
function takeRake(pots: PotResult[], config: HandConfig): number {
  const contested = pots.filter((p) => !p.uncalled);
  const total = contested.reduce((a, p) => a + p.amount, 0);
  const rake = rakeOf(total, config);
  if (rake === 0) return 0;
  let taken = 0;
  for (const p of contested) {
    const cut = Math.floor((rake * p.amount) / total);
    p.amount -= cut;
    taken += cut;
  }
  contested[0].amount -= rake - taken;
  return rake;
}
