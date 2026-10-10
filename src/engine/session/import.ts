// Imports real hands from pasted hand histories (the text format PokerStars and GGPoker write)
// and grades the hero's decisions with the same models the practice table uses. Each imported
// hand becomes an ordinary session hand with a replay, so the Session tab, leak tracking and
// leak-targeted practice all work on it.
//
// Supported: no-limit hold'em cash games with 3 to 9 players dealt in, blinds only (no antes,
// straddles or dead blinds), amounts in $, € or £. Tables with fewer than six players are
// played as 6-max with the missing early seats folding first, which leaves every real seat's
// position and the players behind it unchanged. Heads-up hands are skipped: the engine always
// puts the small blind first after the flop, while heads-up the small blind is the button.

import { formatCards, parseCard, type Card } from '../cards';
import { comboEquities } from '../equity';
import { applyAction, legalActions, newHand, type Action, type HandConfig, type HandState } from '../hand';
import { analyzeMultiway, multiwaySituationFromState } from '../postflop/multiway';
import { PROFILES } from '../postflop/model';
import { narrowHand } from '../postflop/narrow';
import { analyze, describeOption, gradePostflop, leaksAtRisk, situationFromState } from '../postflop/recommend';
import { gradePreflop, heroDecision, preflopLeaksAtRisk } from '../preflop/coach';
import type { PreflopOptions } from '../preflop/policy';
import { hasChart, spotFor } from '../preflop/spot';
import type { PostflopMove } from './adapt';
import { replayStates, type HandReplay } from './replay';
import { handLesson, type DecisionRecord, type HandRecord } from './session';

/** The level number imported hands are filed under, so they never count toward a practice level. */
export const IMPORTED_LEVEL = 0;

type ActionType = Action['type'];

/** One hand as read from the text, before it is checked against the hand engine. */
export interface ParsedHand {
  id: string;
  sb: number;
  bb: number;
  /** Seat numbers of the players dealt in, clockwise from the small blind. */
  order: string[];
  stacks: number[];
  hero: number;
  holes: (Card[] | null)[];
  board: Card[];
  /** Actions after the blinds, by index into `order`; `to` is the street total for bets and raises. */
  actions: { player: number; type: ActionType; to?: number; added?: number }[];
  /** Chips each player collected from the pot, after any rake. */
  collected: number[];
}

export interface SkippedHand {
  id: string;
  reason: string;
}

export interface ImportedHand {
  id: string;
  record: Omit<HandRecord, 'n'>;
}

export interface ImportResult {
  hands: ImportedHand[];
  skipped: SkippedHand[];
}

const HEADER = /^(?:PokerStars|Poker)\s+(?:Zoom\s+|Fast\s+)?Hand\s+#\s*([\w-]+)/i;
const MONEY = /[$€£]\s?([\d,]+(?:\.\d+)?)/;

class Skip extends Error {}

const money = (s: string): number => {
  const m = MONEY.exec(s);
  if (!m) throw new Skip('only cash games with amounts in $, € or £ are supported');
  return Math.round(Number(m[1].replace(/,/g, '')) * 100);
};

const cardsIn = (s: string): Card[] => s.trim().split(/\s+/).filter(Boolean).map((c) => parseCard(c));

/** Splits pasted text into one block per hand history. */
export function splitHands(text: string): string[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks: string[][] = [];
  for (const line of lines) {
    if (HEADER.test(line.trim())) blocks.push([]);
    if (blocks.length) blocks[blocks.length - 1].push(line);
  }
  return blocks.map((b) => b.join('\n').trim()).filter(Boolean);
}

/** Reads one hand history. Throws Skip with a reason for hands the trainer cannot model. */
export function parseHand(block: string): ParsedHand {
  const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
  const head = HEADER.exec(lines[0]);
  const id = head ? head[1] : '?';
  const fail = (reason: string): never => {
    throw new Skip(reason);
  };
  if (/tournament/i.test(lines[0])) fail('tournament hands are not supported');
  if (!/hold'?em/i.test(lines[0]) || !/no\s*limit/i.test(lines[0])) fail("only no-limit hold'em is supported");
  const stakes = /\(([^)]*?)\/([^)]*?)\)/.exec(lines[0]);
  if (!stakes) fail('the stakes could not be read');
  const sb = money(stakes![1]), bb = money(stakes![2]);

  const buttonSeat = /Seat\s+#(\d+)\s+is the button/i.exec(block)?.[1];
  const seats = new Map<string, { name: string; stack: number }>();
  for (const l of lines) {
    const m = /^Seat\s+(\d+):\s+(.+?)\s+\(([^)]*?)\s+in chips/i.exec(l);
    if (m && !seats.has(m[1]) && !/\*\*\*/.test(l)) seats.set(m[1], { name: m[2], stack: money(m[3]) });
    if (/^\*\*\* SUMMARY/i.test(l)) break;
  }
  if (!seats.size) fail('no seats were listed');
  // Longest names first, so "Bob 2" is not read as "Bob".
  const names = [...seats.entries()].sort((a, b) => b[1].name.length - a[1].name.length);
  const who = (l: string): [string, string] | null => {
    for (const [seat, { name }] of names) if (l.startsWith(`${name}:`)) return [seat, l.slice(name.length + 1).trim()];
    return null;
  };

  let street = 0;
  let sbSeat: string | null = null, bbSeat: string | null = null;
  const inHand = new Set<string>();
  const raw: { seat: string; type: ActionType; to?: number; added?: number; street: number }[] = [];
  const holes = new Map<string, Card[]>();
  let heroSeat: string | null = null;
  let board: Card[] = [];
  const collected = new Map<string, number>();
  let summary = false;

  for (const l of lines.slice(1)) {
    if (/^\*\*\* SUMMARY/i.test(l)) {
      summary = true;
      continue;
    }
    if (summary) {
      // "Seat 3: Bob (button) showed [Ah Kd] and won ..." or "mucked [..]": cards revealed at showdown.
      const m = /^Seat\s+(\d+):.*?\b(?:showed|mucked)\s+\[([^\]]+)\]/i.exec(l);
      if (m && seats.has(m[1]) && !holes.has(m[1])) holes.set(m[1], cardsIn(m[2]));
      continue;
    }
    if (/^\*\*\*\s*(FIRST|SECOND)\b/i.test(l)) fail('run-it-twice hands are not supported');
    const st = /^\*\*\*\s*(HOLE CARDS|FLOP|TURN|RIVER|SHOW ?DOWN)\s*\*\*\*\s*(.*)$/i.exec(l);
    if (st) {
      const kind = st[1].toUpperCase();
      if (kind === 'FLOP') street = 1;
      else if (kind === 'TURN') street = 2;
      else if (kind === 'RIVER') street = 3;
      const groups = [...st[2].matchAll(/\[([^\]]+)\]/g)].map((g) => cardsIn(g[1]));
      if (groups.length) board = groups.flat();
      continue;
    }
    const dealt = /^Dealt to\s+(.+?)\s*\[([^\]]+)\]/i.exec(l);
    if (dealt) {
      const seat = names.find(([, s]) => s.name === dealt[1])?.[0];
      if (seat) {
        holes.set(seat, cardsIn(dealt[2]));
        heroSeat = seat;
      }
      continue;
    }
    const col = /^(.+?)\s+collected\s+(.+?)\s+from/i.exec(l);
    if (col) {
      const seat = names.find(([, s]) => s.name === col[1])?.[0];
      if (seat) collected.set(seat, (collected.get(seat) ?? 0) + money(col[2]));
      continue;
    }
    const w = who(l);
    if (!w) continue;
    const [seat, rest] = w;
    const act = rest.replace(/\s+and is all-in\.?$/i, '');
    if (/^posts (the )?ante/i.test(act)) fail('hands with antes are not supported');
    if (/^posts small & big|^posts (a )?dead|^posts straddle|^straddle/i.test(act)) fail('straddles and dead blinds are not supported');
    if (/^posts small blind/i.test(act)) {
      if (sbSeat) fail('two small blinds were posted');
      sbSeat = seat;
      inHand.add(seat);
      continue;
    }
    if (/^posts big blind/i.test(act)) {
      if (bbSeat) fail('more than one big blind was posted');
      bbSeat = seat;
      inHand.add(seat);
      continue;
    }
    const shows = /^shows\s+\[([^\]]+)\]/i.exec(act);
    if (shows) {
      holes.set(seat, cardsIn(shows[1]));
      continue;
    }
    if (/^folds/i.test(act)) raw.push({ seat, type: 'fold', street });
    else if (/^checks/i.test(act)) raw.push({ seat, type: 'check', street });
    else if (/^calls/i.test(act)) raw.push({ seat, type: 'call', added: money(act), street });
    else if (/^bets/i.test(act)) raw.push({ seat, type: 'bet', added: money(act), street });
    else if (/^raises/i.test(act)) {
      const to = /\bto\s+(.+)$/i.exec(act);
      if (!to) fail('a raise without a total could not be read');
      raw.push({ seat, type: 'raise', to: money(to![1]), street });
    } else continue;
    if (street === 0) inHand.add(seat);
  }

  if (!heroSeat) fail('the hero\'s cards ("Dealt to") were not found');
  if (!sbSeat || !bbSeat) fail('both blinds must be posted');
  inHand.add(heroSeat!);
  // Clockwise seat order starting from the small blind.
  const seatNums = [...seats.keys()].filter((s) => inHand.has(s)).sort((a, b) => Number(a) - Number(b));
  const start = seatNums.indexOf(sbSeat!);
  const order = [...seatNums.slice(start), ...seatNums.slice(0, start)];
  if (order.length < 3) fail('heads-up hands are not supported');
  if (order.length > 9) fail('more than nine players were dealt in');
  if (order[1] !== bbSeat) fail('the big blind is not next to the small blind');
  if (buttonSeat && order[order.length - 1] !== buttonSeat) fail('the button is not the seat before the small blind (a dead button)');

  const index = new Map(order.map((s, i) => [s, i]));
  // Bets are written as the amount added; the engine takes the street total.
  const streetTotal = new Map<string, number>();
  let lastStreet = 0;
  const actions: ParsedHand['actions'] = [];
  for (const a of raw) {
    if (a.street !== lastStreet) {
      streetTotal.clear();
      lastStreet = a.street;
    }
    if (a.street === 0 && streetTotal.size === 0) {
      streetTotal.set(sbSeat!, Math.min(sb, seats.get(sbSeat!)!.stack));
      streetTotal.set(bbSeat!, Math.min(bb, seats.get(bbSeat!)!.stack));
    }
    const i = index.get(a.seat);
    if (i === undefined) fail('a player acted who was not dealt in');
    const before = streetTotal.get(a.seat) ?? 0;
    if (a.type === 'bet') {
      actions.push({ player: i!, type: 'bet', to: before + a.added! });
      streetTotal.set(a.seat, before + a.added!);
    } else if (a.type === 'raise') {
      actions.push({ player: i!, type: 'raise', to: a.to! });
      streetTotal.set(a.seat, a.to!);
    } else if (a.type === 'call') {
      actions.push({ player: i!, type: 'call', added: a.added });
      streetTotal.set(a.seat, before + a.added!);
    } else actions.push({ player: i!, type: a.type });
  }

  return {
    id,
    sb,
    bb,
    order,
    stacks: order.map((s) => seats.get(s)!.stack),
    hero: index.get(heroSeat!)!,
    holes: order.map((s) => holes.get(s) ?? null),
    board,
    actions,
    collected: order.map((s) => collected.get(s) ?? 0),
  };
}

/** Engine seats for a hand: real players keep their positions, missing early seats are filled. */
function seating(p: ParsedHand) {
  const n = p.order.length;
  const tableSize = Math.max(6, n);
  const filler = tableSize - n;
  // Clockwise from SB: SB, BB, [filler early seats], then the rest of the real players.
  const seatOf = (i: number) => (i < 2 ? i : i + filler);
  return { tableSize, filler, seatOf };
}

/** Builds the replay for a parsed hand, checking every action against the hand engine. */
export function replayFor(p: ParsedHand): { replay: HandReplay; final: HandState } {
  const { tableSize, filler, seatOf } = seating(p);
  const config: HandConfig = { tableSize, sb: p.sb, bb: p.bb };
  const stacks = Array.from({ length: tableSize }, () => 100 * p.bb);
  const known: (Card[] | null)[] = Array.from({ length: tableSize }, () => null);
  p.order.forEach((_, i) => {
    stacks[seatOf(i)] = p.stacks[i];
    known[seatOf(i)] = p.holes[i];
  });
  const fillers = Array.from({ length: filler }, (_, k) => 2 + k);
  const winners = new Set(p.order.map((_, i) => i).filter((i) => p.collected[i] > 0).map(seatOf));

  // Unknown hole cards are dealt at random; when the hand reached a showdown with a hidden hand,
  // try a few deals so the engine's winners match the players who collected the pot.
  let best: { replay: HandReplay; final: HandState } | null = null;
  for (let seed = 1; seed <= 60; seed++) {
    const s0 = newHand({ config, stacks, hole: known, board: p.board, seed });
    const actions: HandReplay['actions'] = [];
    let s = s0;
    const step = (player: number, a: Action) => {
      if (s.toAct !== player) throw new Skip('the actions do not follow the betting order');
      const legal = legalActions(s);
      if ((a.type === 'check' && !legal.check) || (a.type === 'call' && legal.call === null) || (a.type === 'fold' && !legal.fold)) {
        throw new Skip(`a ${a.type} was not a legal action`);
      }
      s = applyAction(s, a);
      actions.push(a.type === 'bet' || a.type === 'raise' ? [player, a.type, a.to] : [player, a.type]);
    };
    for (const f of fillers) step(f, { type: 'fold' });
    for (const a of p.actions) {
      step(seatOf(a.player), a.type === 'bet' || a.type === 'raise' ? { type: a.type, to: a.to! } : ({ type: a.type } as Action));
    }
    if (!s.result) throw new Skip('the hand did not finish the way it was written');
    const replay: HandReplay = {
      v: 1,
      config,
      stacks: [...stacks],
      holes: s.players.map((pl) => [...pl.hole]),
      board: [...s.board],
      actions,
      hero: seatOf(p.hero),
      villains: p.order.map((_, i) => seatOf(i)).filter((x) => x !== seatOf(p.hero)),
      profiles: Object.fromEntries(p.order.map((_, i) => [seatOf(i), 'regular'])),
      lowStakes: true,
      hidden: p.order.map((_, i) => i).filter((i) => !p.holes[i]).map(seatOf),
      fillers,
    };
    best ??= { replay, final: s };
    const engineWinners = new Set(s.result.net.map((x, i) => (x > 0 ? i : -1)).filter((i) => i >= 0));
    const matches = engineWinners.size === winners.size && [...winners].every((w) => engineWinners.has(w));
    const hiddenAtShowdown = s.result.wentToShowdown && p.order.some((_, i) => !p.holes[i] && !s.players[seatOf(i)].folded);
    if (matches || !hiddenAtShowdown) return { replay, final: s };
  }
  return best!;
}

const fmt = (chips: number, bb: number) => {
  const v = chips / 100;
  return `$${Number.isInteger(v) ? v.toFixed(0) : v.toFixed(2)} (${Number.isInteger(chips / bb) ? chips / bb : (chips / bb).toFixed(1)}bb)`;
};

function describe(s: HandState, a: Action): string {
  if (a.type === 'fold' || a.type === 'check') return a.type;
  if (a.type === 'call') return `call ${fmt(legalActions(s).call ?? 0, s.config.bb)}`;
  return `${a.type} to ${fmt(a.to, s.config.bb)}`;
}

const STREET_LABEL: Record<string, string> = { flop: 'Flop', turn: 'Turn', river: 'River' };

/** Grades every hero decision in a replay with the trainer's preflop charts and postflop model. */
export function gradeReplay(r: HandReplay): DecisionRecord[] {
  const states = replayStates(r);
  const opts: PreflopOptions = { lowStakes: r.lowStakes, stacksBB: r.stacks[r.hero] / r.config.bb };
  const profile = PROFILES.regular;
  const out: DecisionRecord[] = [];
  r.actions.forEach((entry, k) => {
    if (entry[0] !== r.hero) return;
    const s = states[k];
    const a: Action = entry[1] === 'bet' || entry[1] === 'raise' ? { type: entry[1], to: entry[2]! } : ({ type: entry[1] } as Action);
    const hand = formatCards(s.players[r.hero].hole);
    try {
      if (s.street === 'preflop') {
        const spot = spotFor(s, r.hero);
        if (!hasChart(spot)) return;
        const d = heroDecision(s, r.hero, opts);
        const g = gradePreflop(d, a, s.config.bb, s.players[r.hero].stack + s.players[r.hero].committed);
        out.push({
          label: d.spot.label, hand, you: describe(s, a), verdict: g.verdict, heading: g.heading, tags: g.tags,
          atRisk: preflopLeaksAtRisk(s, r.hero, d), step: k,
        });
        return;
      }
      const live = r.villains.filter((v) => !s.players[v].folded);
      if (!live.length) return;
      const pre = s.actions.filter((x) => x.street === 'preflop' && x.type === 'raise');
      const heroPreflopAggressor = pre.length > 0 && pre[pre.length - 1].player === r.hero;
      const heroRange = narrowHand(s, r.hero, 'baseline', opts).range;
      const views = live.map((v) => ({ seat: v, range: narrowHand(s, v, 'pool', opts, profile).range, profile }));
      // A line the charts never take leaves no range to grade against.
      if (views.some((v) => !v.range.some((x) => x > 0))) return;
      const label = `${STREET_LABEL[s.street]} ${formatCards(s.board)}`;
      if (views.length === 1) {
        const v = views[0];
        const sit = situationFromState(s, r.hero, v.seat, v.range, { heroRange, heroPreflopAggressor, villainProfile: profile });
        const an = analyze(sit, comboEquities(sit.hero, sit.board, sit.villainRange));
        const g = gradePostflop(sit, an, a);
        out.push({
          label, hand, you: describeOption(g.chosen.option).toLowerCase(), verdict: g.verdict, heading: g.heading, tags: g.tags,
          atRisk: leaksAtRisk(sit, an), step: k, move: a.type as PostflopMove, bestMove: an.best.option.kind,
          lossBB: g.loss / sit.bb,
        });
      } else {
        const sit = multiwaySituationFromState(s, r.hero, views, { heroRange, heroPreflopAggressor });
        const an = analyzeMultiway(sit, { seed: k + 1 }).analysis;
        const g = gradePostflop(sit, an, a);
        out.push({
          label, hand, you: describeOption(g.chosen.option).toLowerCase(), verdict: g.verdict, heading: g.heading, tags: g.tags,
          atRisk: leaksAtRisk(sit, an), step: k, move: a.type as PostflopMove, bestMove: an.best.option.kind,
          lossBB: g.loss / sit.bb,
        });
      }
    } catch {
      // A spot the models cannot read stays ungraded, as it does at the practice table.
    }
  });
  return out;
}

/** Imports one parsed hand: its replay, graded decisions and result. */
export function importParsed(p: ParsedHand, at = new Date().toISOString()): Omit<HandRecord, 'n'> {
  const { replay, final } = replayFor(p);
  const hero = replay.hero;
  const decisions = gradeReplay(replay);
  // The result comes from what the history says the hero collected, so it includes any rake.
  const net = p.collected[p.hero] - final.players[hero].total;
  const first = replayStates(replay)[0];
  return {
    at,
    level: IMPORTED_LEVEL,
    spot: decisions[0]?.label ?? spotFor(first, hero).label,
    hand: formatCards(final.players[hero].hole),
    net,
    bb: p.bb,
    decided: true,
    decisions,
    lesson: handLesson(decisions, net, true),
    replay,
  };
}

/** Reads and grades one hand history block, or says why it was skipped. */
export function importBlock(block: string, at = new Date().toISOString()): { hand: ImportedHand } | { skipped: SkippedHand } {
  const id = HEADER.exec(block.split('\n')[0].trim())?.[1] ?? '?';
  try {
    return { hand: { id, record: importParsed(parseHand(block), at) } };
  } catch (e) {
    return { skipped: { id, reason: e instanceof Skip ? e.message : `it could not be read (${(e as Error).message})` } };
  }
}

/** Reads every hand in the pasted text. Hands that cannot be modeled are listed with a reason. */
export function importHands(text: string, at = new Date().toISOString()): ImportResult {
  const hands: ImportedHand[] = [];
  const skipped: SkippedHand[] = [];
  for (const block of splitHands(text)) {
    const r = importBlock(block, at);
    if ('hand' in r) hands.push(r.hand);
    else skipped.push(r.skipped);
  }
  return { hands, skipped };
}
