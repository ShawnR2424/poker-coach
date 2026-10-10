// EV for hero actions with two or more opponents. Each opponent responds to a bet on its own
// from the class model (the model ignores how one opponent's action changes another's), so:
//   all fold          → hero wins the pot
//   a set S calls     → hero's equity against the calling ranges of S decides the showdown
//   anyone raises     → hero gives up the bet
// Equity against one caller is exact per combo; against two or more it is Monte Carlo.

import type { Card } from '../cards';
import { comboEquities, computeEquity } from '../equity';
import { pot as potOf, type HandState } from '../hand';
import { breakEvenFoldPct, potOdds, spr as sprOf } from '../math';
import { COMBO_CARDS, NUM_COMBOS, type Range } from '../range';
import { classifyHand, type PostflopClass } from './classify';
import { strongShare } from './heroRange';
import { laterStreetValue, rangeDefense, realization, responseFor, type Profile } from './model';
import { heroOptions, type Analysis, type DecisionBasics, type HeroOption, type OptionRow } from './recommend';

export interface MultiwayVillain {
  seat: number;
  committed: number;
  behind: number;
  range: Range;
  profile?: Profile;
}

export interface MultiwaySituation extends DecisionBasics {
  heroCommitted: number;
  /** Highest street total so far (what the hero must match). */
  currentBet: number;
  villains: MultiwayVillain[];
  heroRange?: Range;
  options: HeroOption[];
}

export interface MultiwayResult {
  analysis: Analysis;
  /** Hero equity against each combo of each villain, heads-up (for the grids). */
  comboEqs: Float32Array[];
}

interface Prepared {
  idx: number[];
  w: number[];
  cls: PostflopClass[];
  W: number;
}

function prepare(range: Range, dead: Set<Card>, board: readonly Card[]): Prepared {
  const idx: number[] = [], w: number[] = [], cls: PostflopClass[] = [];
  let W = 0;
  for (let i = 0; i < NUM_COMBOS; i++) {
    if (!(range[i] > 0)) continue;
    const [a, b] = COMBO_CARDS[i];
    if (dead.has(a) || dead.has(b)) continue;
    idx.push(i);
    w.push(range[i]);
    cls.push(classifyHand([a, b], board));
    W += range[i];
  }
  return { idx, w, cls, W };
}

/** All non-empty subsets of 0..n-1 as bit masks. */
const subsets = (n: number) => Array.from({ length: (1 << n) - 1 }, (_, k) => k + 1);

export function analyzeMultiway(sit: MultiwaySituation, opts: { iterations?: number; seed?: number } = {}): MultiwayResult {
  const iterations = opts.iterations ?? 4000;
  const seed = opts.seed ?? 7;
  const dead = new Set([...sit.hero, ...sit.board]);
  const vs = sit.villains.map((v) => prepare(v.range, dead, sit.board));
  if (vs.some((p) => p.W <= 0)) throw new Error('An opponent range has no live combos');
  const comboEqs = sit.villains.map((v) => comboEquities(sit.hero, sit.board, v.range));
  // One caller: the exact per-combo equities weighted by the calling range. Two or more: Monte Carlo.
  const eqVs = (callers: { j: number; callRange: Range }[], its: number) =>
    callers.length === 1
      ? weightedEq(callers[0].callRange, comboEqs[callers[0].j])
      : computeEquity({ hero: sit.hero, board: sit.board, villains: callers.map((c) => c.callRange), iterations: its, seed }).equity;

  const equity = computeEquity({ hero: sit.hero, board: sit.board, villains: sit.villains.map((v) => v.range), iterations: iterations * 4, seed }).equity;
  const heroClass = classifyHand(sit.hero, sit.board);
  const R = realization(sit.street, sit.heroInPosition, heroClass);
  const P = sit.pot, hc = sit.heroCommitted, H = sit.heroBehind;
  const rows: OptionRow[] = [];
  /**
   * Later-street value against opponent j's hands, weighted by `range` (their whole range, or
   * the part that called). With more than one opponent in, it is scaled by how much the others
   * cut the hero's equity, since the hero has to beat them too.
   */
  const hu = vs.map((_, j) => weightedEq(sit.villains[j].range, comboEqs[j]));
  const laterVs = (j: number, range: Range, pot: number, behind: number, others: number, eqAll: number) => {
    const p = vs[j];
    let t = 0, tw = 0;
    for (let k = 0; k < p.idx.length; k++) {
      const x = range[p.idx[k]];
      if (!(x > 0)) continue;
      t += x * laterStreetValue(sit.street, p.cls[k], comboEqs[j][p.idx[k]], pot, behind, sit.villains[j].profile);
      tw += x;
    }
    const scale = others === 0 ? 1 : Math.min(1, eqAll / Math.max(1e-9, hu[j]));
    return tw > 0 ? (t / tw) * scale : 0;
  };
  /** Later-street value when everyone still in goes on to the next street. */
  const laterAll = (pot: number, heroBehind: number) =>
    sit.villains.reduce((t, v, j) => t + laterVs(j, v.range, pot, Math.min(heroBehind, v.behind), sit.villains.length - 1, equity), 0);

  for (const opt of sit.options) {
    if (opt.kind === 'fold') rows.push({ option: opt, ev: 0 });
    else if (opt.kind === 'check') rows.push({ option: opt, ev: R * equity * P + laterAll(P, H) });
    else if (opt.kind === 'call') {
      const toCall = Math.min(sit.currentBet - hc, H);
      const r = toCall >= H ? 1 : R;
      const later = toCall >= H ? 0 : laterAll(P + toCall, H - toCall);
      rows.push({ option: opt, ev: r * equity * (P + toCall) - toCall + later });
    } else rows.push(betRow(opt));
  }

  function betRow(opt: HeroOption): OptionRow {
    const to = opt.to!;
    const b = to - hc;
    const heroAllIn = to >= hc + H;
    const per = sit.villains.map((v, j) => {
      const capTo = Math.min(to, v.committed + v.behind);
      const cv = capTo - v.committed;
      const f = cv / Math.max(1, P + b - cv);
      const canRaise = !heroAllIn && v.behind > cv;
      const beingRaised = v.committed > 0;
      const p = vs[j];
      const defense = rangeDefense(p.cls, p.w, f, beingRaised, v.profile);
      let fold = 0, call = 0, raise = 0;
      const callRange = new Float32Array(NUM_COMBOS);
      for (let k = 0; k < p.idx.length; k++) {
        const resp = responseFor(p.cls[k], f, canRaise, beingRaised, v.profile, defense);
        fold += p.w[k] * resp.fold;
        call += p.w[k] * resp.call;
        raise += p.w[k] * resp.raise;
        callRange[p.idx[k]] = p.w[k] * resp.call;
      }
      return { cv, fold: fold / p.W, call: call / p.W, raise: raise / p.W, callRange, j };
    });
    const allFold = per.reduce((a, x) => a * x.fold, 1);
    const noRaise = per.reduce((a, x) => a * (1 - x.raise), 1);
    let evCalled = 0, pCalled = 0, eqCalled = 0;
    for (const mask of subsets(per.length)) {
      const inS = per.filter((_, j) => mask & (1 << j));
      const pS = per.reduce((a, x, j) => a * (mask & (1 << j) ? x.call : x.fold), 1);
      if (pS <= 1e-9 || inS.some((x) => x.call <= 1e-9)) continue;
      const eqS = eqVs(inS, iterations);
      const finalPot = P + b + inS.reduce((a, x) => a + x.cv, 0);
      const rCall = heroAllIn ? 1 : R;
      const later = heroAllIn ? 0 : inS.reduce((t, x) => t + laterVs(x.j, x.callRange, finalPot, Math.min(H - b, sit.villains[x.j].behind - x.cv), inS.length - 1, eqS), 0);
      evCalled += pS * (rCall * eqS * finalPot - b + later);
      eqCalled += pS * eqS;
      pCalled += pS;
    }
    const ev = allFold * P + evCalled - (1 - noRaise) * b;
    return {
      option: opt,
      ev,
      fold: allFold,
      call: pCalled,
      raise: 1 - noRaise,
      eqWhenCalled: pCalled > 0 ? eqCalled / pCalled : undefined,
      breakEvenBluff: breakEvenFoldPct({ pot: P, risk: b, finalPot: P + b + per[0].cv }),
      potShare: b / Math.max(1, P),
    };
  }

  const best = rows.reduce((a, r) => (r.ev > a.ev + 1e-9 ? r : a), rows[0]);
  const facing = sit.currentBet - hc;
  const deepest = Math.max(...sit.villains.map((v) => v.behind + v.committed));
  return {
    comboEqs,
    analysis: {
      rows,
      best,
      facts: {
        equity,
        potOdds: facing > 0 ? potOdds(Math.min(facing, H), P) : null,
        spr: sprOf(Math.min(H + hc, deepest) - Math.max(hc, sit.currentBet), P),
        villainStrong: Math.max(...sit.villains.map((v) => strongShare(v.range, sit.board, dead))),
        heroStrong: sit.heroRange ? strongShare(sit.heroRange, sit.board, sit.board) : null,
        heroClass,
        liveCombos: vs.reduce((a, p) => a + p.W, 0),
        realization: R,
      },
    },
  };
}

function weightedEq(range: Range, eqs: Float32Array): number {
  let s = 0, w = 0;
  for (let i = 0; i < NUM_COMBOS; i++) {
    if (range[i] > 0 && !Number.isNaN(eqs[i])) { s += range[i] * eqs[i]; w += range[i]; }
  }
  return w > 0 ? s / w : 0;
}

/** Builds the multiway situation for `hero` from a live hand state. */
export function multiwaySituationFromState(
  s: HandState,
  hero: number,
  villains: { seat: number; range: Range; profile?: Profile }[],
  extra: { heroRange?: Range; heroPreflopAggressor: boolean },
): MultiwaySituation {
  if (s.street === 'preflop') throw new Error('Postflop only');
  const h = s.players[hero];
  const streetActs = s.actions.filter((a) => a.street === s.street);
  return {
    hero: h.hole,
    board: s.board,
    street: s.street,
    pot: potOf(s),
    bb: s.config.bb,
    heroBehind: h.stack,
    heroInvested: h.total,
    heroCommitted: h.committed,
    currentBet: s.currentBet,
    heroFirstToAct: s.currentBet === 0 && streetActs.length === 0,
    // In position only when the hero acts last of everyone still in.
    heroInPosition: villains.every((v) => hero > v.seat),
    heroPreflopAggressor: extra.heroPreflopAggressor,
    heroRange: extra.heroRange,
    villains: villains.map((v) => ({
      seat: v.seat,
      committed: s.players[v.seat].committed,
      behind: s.players[v.seat].stack,
      range: v.range,
      profile: v.profile,
    })),
    options: heroOptions(s),
  };
}

/** How the opponents' actions on this street interact, from the hero's seat. */
export function interactionNote(s: HandState, hero: number, villains: number[]): string {
  const name = (i: number) => s.players[i].position;
  const live = villains.filter((v) => !s.players[v].folded);
  const acts = s.actions.filter((a) => a.street === s.street && a.type !== 'post');
  const lastBet = [...acts].reverse().find((a) => a.type === 'bet' || a.type === 'raise');
  const parts: string[] = [];
  if (lastBet && lastBet.player !== hero) {
    const after = acts.slice(acts.lastIndexOf(lastBet) + 1);
    const callers = after.filter((a) => a.type === 'call' && a.player !== hero).map((a) => a.player);
    const toAct = live.filter((v) => v !== lastBet.player && !callers.includes(v) && !s.players[v].allIn);
    const verb = lastBet.type === 'bet' ? 'bet' : 'raise';
    if (callers.length) {
      parts.push(
        `${callers.map(name).join(' and ')} called ${name(lastBet.player)}'s ${verb} before you. A caller sandwiched between the bettor and you usually holds a real hand or a draw (weak hands fold, the strongest often raise), and you now have to beat both of them, so call with less and raise only with strong hands.`,
      );
    } else {
      parts.push(`${name(lastBet.player)} ${verb === 'bet' ? 'bet' : 'raised'} into ${live.length} players, which is a stronger signal than the same ${verb} heads-up.`);
    }
    if (toAct.length) {
      parts.push(`${toAct.map(name).join(' and ')} still act${toAct.length === 1 ? 's' : ''} after you and can raise, so a call with a marginal hand can get squeezed.`);
    }
  } else if (acts.some((a) => a.type === 'check' && live.includes(a.player))) {
    const checkers = acts.filter((a) => a.type === 'check' && live.includes(a.player)).map((a) => name(a.player));
    const behind = live.filter((v) => !acts.some((a) => a.player === v));
    parts.push(`${[...new Set(checkers)].join(' and ')} checked to you. Each check takes some strong hands out, but with ${live.length} opponents one of them often has something worth calling with, so a bluff needs every player to fold.`);
    if (behind.length) parts.push(`${behind.map(name).join(' and ')} still act${behind.length === 1 ? 's' : ''} after you.`);
  } else {
    parts.push(`You act first against ${live.length} players. A bet has to get through all of them, so bluff less than you would heads-up and bet mostly for value; strong draws can still bet.`);
  }
  return parts.join(' ');
}
