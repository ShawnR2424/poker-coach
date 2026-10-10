// The hero's own range after the flop, as the opponents see it: what the line so far says about
// it (capped or not, nut advantage, blockers), and how the model's typical player would split it
// across the actions available now. The split uses the same class tables as the opponents
// (actions.json), so it is an estimate, not solver output.

import type { Card } from '../cards';
import type { HandState } from '../hand';
import { COMBO_CARDS, NUM_COMBOS, type Range } from '../range';
import { classifyHand, POSTFLOP_CLASS_LABEL, STRONG_CLASSES, type PostflopClass } from './classify';
import { firstToActFreq, rangeDefense, responseFor, SMALL_BET_MAX, type Profile } from './model';
import type { ActionContext, PostflopStep } from './narrow';
import { BOARD_LEN, facedShare } from './narrow';

const pct = (x: number) => `${Math.round(x * 100)}%`;
const RANKS = '23456789TJQKA';
const SUITS = '♣♦♥♠';

/** Share of a range that is two pair or better on this board, skipping combos that use a dead card. */
export function strongShare(range: Range, board: readonly Card[], dead: Iterable<Card>): number {
  const d = new Set(dead);
  let s = 0, t = 0;
  for (let i = 0; i < NUM_COMBOS; i++) {
    if (!(range[i] > 0)) continue;
    const [a, b] = COMBO_CARDS[i];
    if (d.has(a) || d.has(b)) continue;
    t += range[i];
    if (STRONG_CLASSES.has(classifyHand([a, b], board))) s += range[i];
  }
  return t > 0 ? s / t : 0;
}

/** Total weight of a range's combos that don't use a board card. */
function liveWeight(range: Range, board: readonly Card[]): number {
  const b = new Set(board);
  let t = 0;
  for (let i = 0; i < NUM_COMBOS; i++) {
    const [x, y] = COMBO_CARDS[i];
    if (range[i] > 0 && !b.has(x) && !b.has(y)) t += range[i];
  }
  return t;
}

/** Weight of a range's two pair or better combos, and how much of it the hero's cards remove. */
function strongBlocked(range: Range, board: readonly Card[], hero: readonly Card[]): { total: number; blocked: number } {
  const b = new Set(board), h = new Set(hero);
  let total = 0, blocked = 0;
  for (let i = 0; i < NUM_COMBOS; i++) {
    if (!(range[i] > 0)) continue;
    const [x, y] = COMBO_CARDS[i];
    if (b.has(x) || b.has(y)) continue;
    if (!STRONG_CLASSES.has(classifyHand([x, y], board))) continue;
    total += range[i];
    if (h.has(x) || h.has(y)) blocked += range[i];
  }
  return { total, blocked };
}

/** The ace of a suit with three or more cards on the board, when the hero holds it. */
function nutFlushBlocker(hero: readonly Card[], board: readonly Card[]): Card | null {
  for (let suit = 0; suit < 4; suit++) {
    if (board.filter((c) => (c & 3) === suit).length < 3) continue;
    const ace = (12 << 2) | suit;
    if (hero.includes(ace) && !board.includes(ace)) return ace;
  }
  return null;
}

const STREET_WORD = { check: 'check', bet: 'bet', call: 'call', raise: 'raise', checkBehind: 'check' } as const;

export interface HeroLine {
  capped: boolean;
  /** Two pair or better, as a share of the hero's range (board cards removed only); 0 with no range. */
  heroStrong: number;
  /** The same share for the strongest opponent range (hero's cards removed too). */
  villainStrong: number;
  /** Share of the opponents' two pair or better combos that use one of the hero's cards. */
  blocked: number;
  text: string;
}

/**
 * What the hero's line so far says to the opponents. `steps` are the hero's own postflop
 * narrowing steps; `heroAggressor` is whether the hero made the last preflop raise.
 */
export function postflopHeroLine(
  s: HandState,
  hero: number,
  heroRange: Range,
  steps: readonly PostflopStep[],
  villainRanges: readonly Range[],
  heroAggressor: boolean,
): HeroLine {
  const board = s.board;
  const holes = s.players[hero].hole;
  const parts: string[] = [];
  const charted = liveWeight(heroRange, board) > 0;

  const last = steps[steps.length - 1];
  const aggressive = last ? last.move.kind === 'bet' || last.move.kind === 'raise' : heroAggressor;
  if (!charted) {
    parts.push("The charts never play your line so far this way, so the trainer has no range for you here and can't say what your line represents.");
  } else if (last) {
    const sum = (r: Range) => liveWeight(r, board.slice(0, BOARD_LEN[last.street]));
    const before = sum(last.before);
    const kept = before > 0 ? sum(last.after) / before : 0;
    const verb = STREET_WORD[last.move.kind];
    parts.push(
      aggressive
        ? `Your ${verb} on the ${last.street} keeps your range uncapped: the model bets and raises its strongest hands, so the opponents have to respect every big hand. It kept about ${pct(kept)} of the range you had before it.`
        : `Your ${verb} on the ${last.street} caps your range: the model bets or raises most of its strongest hands, so the opponents can discount them. It kept about ${pct(kept)} of the range you had before it.`,
    );
  } else {
    parts.push(
      aggressive
        ? 'You made the last raise before the flop, so your range is uncapped and still holds every premium pair.'
        : 'You called before the flop, so your range is capped: you would have re-raised most premium pairs.',
    );
  }

  const heroStrong = strongShare(heroRange, board, board);
  const villainStrong = villainRanges.length ? Math.max(...villainRanges.map((r) => strongShare(r, board, [...board, ...holes]))) : 0;
  const lead = heroStrong > villainStrong + 0.03 ? 'You have the nut advantage' : villainStrong > heroStrong + 0.03 ? 'They have the nut advantage' : 'Neither side has a clear nut advantage';
  if (charted) parts.push(`${lead}: two pair or better is ${pct(heroStrong)} of your range and ${pct(villainStrong)} of ${villainRanges.length > 1 ? "the strongest opponent's" : 'theirs'}.`);

  let total = 0, blockedW = 0;
  for (const r of villainRanges) {
    const x = strongBlocked(r, board, holes);
    total += x.total;
    blockedW += x.blocked;
  }
  const blocked = total > 0 ? blockedW / total : 0;
  const ace = nutFlushBlocker(holes, board);
  if (ace !== null) {
    parts.push(`You hold the ${RANKS[ace >> 2]}${SUITS[ace & 3]}, so nobody else can have the nut flush.`);
  }
  if (total > 0) {
    parts.push(
      blocked >= 0.15
        ? `Your cards block ${pct(blocked)} of their two pair or better combos, which makes a bluff more believable and their strongest hands less likely.`
        : Math.round(blocked * 100) === 0
          ? 'Your cards block almost none of their two pair or better combos.'
          : `Your cards block only ${pct(blocked)} of their two pair or better combos.`,
    );
  }
  return { capped: !aggressive, heroStrong, villainStrong, blocked, text: parts.join(' ') };
}

// ---- Which hands in the hero's range take each action ----

export type RangeAction = 'fold' | 'call' | 'raise' | 'check' | 'betSmall' | 'betBig';

export const RANGE_ACTION_LABEL: Record<RangeAction, string> = {
  fold: 'Fold',
  call: 'Call',
  raise: 'Raise',
  check: 'Check',
  betSmall: 'Bet up to half pot',
  betBig: 'Bet more than half pot',
};

export interface RangeActionRow {
  action: RangeAction;
  /** Share of the whole range that takes this action. */
  share: number;
  /** Classes that make up this action, largest first, as shares of the action. */
  classes: { cls: PostflopClass; share: number }[];
}

export interface RangeActions {
  rows: RangeActionRow[];
  heroClass: PostflopClass;
  /** How often the hero's own class takes each action. */
  heroFreq: Record<RangeAction, number>;
}

function freqsFor(cls: PostflopClass, ctx: ActionContext, canRaise: boolean, profile?: Profile, defense = 1): Partial<Record<RangeAction, number>> {
  if (ctx.currentBet > ctx.committed) {
    const r = responseFor(cls, facedShare(ctx), canRaise, ctx.beingRaised, profile, defense);
    return { fold: r.fold, call: r.call, raise: r.raise };
  }
  const f = firstToActFreq(cls, ctx.intoAggressor, profile);
  return { check: f.check, betSmall: f.small, betBig: f.big };
}

/**
 * How the hero's range splits across the actions available now, by class, using the same
 * tables that drive the opponents. `ctx` is the hero's context before acting. Null when the
 * hero's line left no range (an action the charts never take).
 */
export function rangeActions(
  heroRange: Range,
  hole: readonly Card[],
  board: readonly Card[],
  ctx: ActionContext,
  canRaise: boolean,
  profile?: Profile,
): RangeActions | null {
  const facing = ctx.currentBet > ctx.committed;
  const actions: RangeAction[] = facing ? (canRaise ? ['fold', 'call', 'raise'] : ['fold', 'call']) : ['check', 'betSmall', 'betBig'];
  const byClass = new Map<PostflopClass, number>();
  const b = new Set(board);
  let total = 0;
  for (let i = 0; i < NUM_COMBOS; i++) {
    const w = heroRange[i];
    if (!(w > 0)) continue;
    const [x, y] = COMBO_CARDS[i];
    if (b.has(x) || b.has(y)) continue;
    const cls = classifyHand([x, y], board);
    byClass.set(cls, (byClass.get(cls) ?? 0) + w);
    total += w;
  }
  const defense = facing ? rangeDefense([...byClass.keys()], [...byClass.values()], facedShare(ctx), ctx.beingRaised, profile) : 1;
  const rows: RangeActionRow[] = actions.map((action) => {
    let sum = 0;
    const parts: { cls: PostflopClass; w: number }[] = [];
    for (const [cls, w] of byClass) {
      const p = freqsFor(cls, ctx, canRaise, profile, defense)[action] ?? 0;
      if (p * w > 0) parts.push({ cls, w: p * w });
      sum += p * w;
    }
    return {
      action,
      share: total > 0 ? sum / total : 0,
      classes: parts.sort((p, q) => q.w - p.w).map((p) => ({ cls: p.cls, share: sum > 0 ? p.w / sum : 0 })),
    };
  });
  if (!(total > 0)) return null;
  const heroClass = classifyHand(hole, board);
  const hf = freqsFor(heroClass, ctx, canRaise, profile, defense);
  const heroFreq = Object.fromEntries(actions.map((a) => [a, hf[a] ?? 0])) as Record<RangeAction, number>;
  return { rows, heroClass, heroFreq };
}

/** Which row of the split the hero's chosen action falls in. */
export function rangeActionOf(kind: 'fold' | 'check' | 'call' | 'bet' | 'raise', to: number | undefined, ctx: ActionContext): RangeAction {
  if (kind !== 'bet') return kind;
  return ((to ?? 0) - ctx.committed) / Math.max(1, ctx.pot) <= SMALL_BET_MAX ? 'betSmall' : 'betBig';
}

/** One line on where the hero's own hand sits in the split. */
export function heroClassLine(ra: RangeActions): string {
  const parts = ra.rows.filter((r) => ra.heroFreq[r.action] >= 0.005).map((r) => `${RANGE_ACTION_LABEL[r.action].toLowerCase()} ${pct(ra.heroFreq[r.action])}`);
  return `Your hand is in the "${POSTFLOP_CLASS_LABEL[ra.heroClass].toLowerCase()}" group, which the model plays: ${parts.join(', ')}.`;
}
