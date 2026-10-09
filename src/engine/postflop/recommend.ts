// Scores every legal hero action after the flop by expected value, using per-combo equity
// against the opponent's range and the class-based response model. Heads-up only.
//
// EV is measured against folding now, so chips the hero already put in are sunk:
//   check  R·eq·P
//   call   R·eq·(P + c) − c
//   bet b  Σ w · [fold·P + call·(R·eq·(P + b + c) − b) + raise·max(call the shove, −b)]
// where P is the pot before the hero acts, R the share of equity the hero realizes
// (1 on the river or when all-in), and c what the opponent adds to call.

import type { Card } from '../cards';
import { legalActions, pot, type Action, type HandState } from '../hand';
import { breakEvenFoldPct, potOdds, spr as sprOf } from '../math';
import { COMBO_CARDS, NUM_COMBOS, type Range } from '../range';
import { presetSizes } from '../sizing';
import { classifyHand, STRONG_CLASSES, type PostflopClass } from './classify';
import { realization, responseFor } from './model';

export type Verdict = 'correct' | 'playable' | 'mistake';

export interface HeroOption {
  kind: 'fold' | 'check' | 'call' | 'bet' | 'raise';
  /** Street total for bets and raises. */
  to?: number;
  label: string;
  allIn?: boolean;
}

export interface PostflopSituation {
  hero: Card[];
  board: Card[];
  street: 'flop' | 'turn' | 'river';
  /** All chips in the middle, including this street's bets. */
  pot: number;
  heroCommitted: number;
  villainCommitted: number;
  heroBehind: number;
  villainBehind: number;
  bb: number;
  heroInPosition: boolean;
  villainRange: Range;
  heroRange?: Range;
  options: HeroOption[];
  /** Chips the hero has put in this hand, for sunk-cost notes. */
  heroInvested: number;
  /** True when the hero made the last preflop raise. */
  heroPreflopAggressor: boolean;
  /** True when no one has bet yet on this street and the hero acts first. */
  heroFirstToAct: boolean;
}

export interface OptionRow {
  option: HeroOption;
  /** Expected value in chips, relative to folding. */
  ev: number;
  /** Opponent response shares (bets and raises only). */
  fold?: number;
  call?: number;
  raise?: number;
  /** Hero equity against the hands that call. */
  eqWhenCalled?: number;
  /** Fold share a pure bluff of this size needs to break even. */
  breakEvenBluff?: number;
  /** Size as a share of the pot before the hero acts. */
  potShare?: number;
  /** Whether the hero should call a shove in the raise branch. */
  callsShove?: boolean;
}

export interface Facts {
  equity: number;
  /** Equity needed to call (null when nothing to call). */
  potOdds: number | null;
  spr: number;
  villainStrong: number;
  heroStrong: number | null;
  heroClass: PostflopClass;
  liveCombos: number;
  realization: number;
}

export interface Analysis {
  rows: OptionRow[];
  best: OptionRow;
  facts: Facts;
}

const sum = (xs: Iterable<number>) => { let s = 0; for (const x of xs) s += x; return s; };

/** Builds the situation for `hero` facing `villain` from a live hand state. */
export function situationFromState(
  s: HandState,
  hero: number,
  villain: number,
  villainRange: Range,
  extra: { heroRange?: Range; heroPreflopAggressor: boolean },
): PostflopSituation {
  if (s.street === 'preflop') throw new Error('Postflop only');
  const legal = legalActions(s);
  const options: HeroOption[] = [];
  if (legal.fold) options.push({ kind: 'fold', label: 'Fold' });
  if (legal.check) options.push({ kind: 'check', label: 'Check' });
  if (legal.call !== null) options.push({ kind: 'call', label: 'Call' });
  for (const p of presetSizes(s)) {
    const a = p.action as Extract<Action, { to: number }>;
    options.push({ kind: a.type, to: a.to, label: p.label, allIn: p.allIn });
  }
  const h = s.players[hero], v = s.players[villain];
  const streetActs = s.actions.filter((a) => a.street === s.street);
  return {
    hero: h.hole,
    board: s.board,
    street: s.street,
    pot: pot(s),
    heroCommitted: h.committed,
    villainCommitted: v.committed,
    heroBehind: h.stack,
    villainBehind: v.stack,
    bb: s.config.bb,
    heroInPosition: hero > villain,
    villainRange,
    heroRange: extra.heroRange,
    options,
    heroInvested: h.total,
    heroPreflopAggressor: extra.heroPreflopAggressor,
    heroFirstToAct: s.currentBet === 0 && streetActs.length === 0,
  };
}

export function analyze(sit: PostflopSituation, eqs: Float32Array): Analysis {
  const dead = new Set([...sit.hero, ...sit.board]);
  const idx: number[] = [];
  const w: number[] = [];
  const cls: PostflopClass[] = [];
  for (let i = 0; i < NUM_COMBOS; i++) {
    const wt = sit.villainRange[i];
    if (!(wt > 0)) continue;
    const [a, b] = COMBO_CARDS[i];
    if (dead.has(a) || dead.has(b)) continue;
    if (Number.isNaN(eqs[i])) throw new Error('Missing equity for a live combo');
    idx.push(i);
    w.push(wt);
    cls.push(classifyHand([a, b], sit.board));
  }
  const W = sum(w);
  if (W <= 0) throw new Error('Opponent range has no live combos');
  const eq = (k: number) => eqs[idx[k]];
  const equity = sum(w.map((x, k) => x * eq(k))) / W;

  const P = sit.pot;
  const hc = sit.heroCommitted, vc = sit.villainCommitted;
  const H = sit.heroBehind, V = sit.villainBehind;
  const heroClass = classifyHand(sit.hero, sit.board);
  const R = realization(sit.street, sit.heroInPosition, heroClass);
  const rows: OptionRow[] = [];

  for (const opt of sit.options) {
    if (opt.kind === 'fold') {
      rows.push({ option: opt, ev: 0 });
    } else if (opt.kind === 'check') {
      rows.push({ option: opt, ev: R * equity * P });
    } else if (opt.kind === 'call') {
      const toCall = Math.min(vc - hc, H);
      const excess = Math.max(0, vc - hc - H);
      const allIn = toCall >= H || V === 0;
      const r = allIn ? 1 : R;
      rows.push({ option: opt, ev: r * equity * (P - excess + toCall) - toCall });
    } else {
      rows.push(betRow(opt));
    }
  }

  function betRow(opt: HeroOption): OptionRow {
    const to = opt.to!;
    const capTo = Math.min(to, vc + V); // the most the opponent can match
    const b = to - hc;
    const bEff = capTo - hc; // hero chips at risk once any uncalled excess returns
    const cv = capTo - vc;
    const potAfter = P + b;
    const f = cv / Math.max(1, potAfter - cv);
    const heroAllIn = to >= hc + H;
    const canRaise = !heroAllIn && V > cv;
    // The opponent already has chips in this street only by betting, so this is a raise of their bet.
    const beingRaised = vc > 0;
    const T = Math.min(hc + H, vc + V);
    const callFinal = P + bEff + cv;
    const rCall = heroAllIn || cv >= V ? 1 : R;
    const shoveFinal = P + (T - hc) + (T - vc);

    let foldW = 0, callW = 0, raiseW = 0, callEqW = 0;
    let evFold = 0, evCall = 0, raiseCallEv = 0;
    for (let k = 0; k < idx.length; k++) {
      const resp = responseFor(cls[k], f, canRaise, beingRaised);
      foldW += w[k] * resp.fold;
      callW += w[k] * resp.call;
      raiseW += w[k] * resp.raise;
      callEqW += w[k] * resp.call * eq(k);
      evFold += w[k] * resp.fold * P;
      evCall += w[k] * resp.call * (rCall * eq(k) * callFinal - bEff);
      raiseCallEv += w[k] * resp.raise * (eq(k) * shoveFinal - (T - hc));
    }
    const raiseFoldEv = -raiseW * b;
    const callsShove = raiseW > 0 && raiseCallEv > raiseFoldEv;
    const ev = (evFold + evCall + Math.max(raiseCallEv, raiseFoldEv)) / W;
    return {
      option: opt,
      ev,
      fold: foldW / W,
      call: callW / W,
      raise: raiseW / W,
      eqWhenCalled: callW > 0 ? callEqW / callW : undefined,
      breakEvenBluff: breakEvenFoldPct({ pot: P, risk: bEff, finalPot: callFinal }),
      potShare: b / Math.max(1, P),
      callsShove: raiseW > 0 ? callsShove : undefined,
    };
  }

  const best = rows.reduce((a, r) => (r.ev > a.ev + 1e-9 ? r : a), rows[0]);
  const strongShare = (range: Range) => {
    let s = 0, t = 0;
    for (let i = 0; i < NUM_COMBOS; i++) {
      if (!(range[i] > 0)) continue;
      const [a, b] = COMBO_CARDS[i];
      if (dead.has(a) || dead.has(b)) continue;
      t += range[i];
      if (STRONG_CLASSES.has(classifyHand([a, b], sit.board))) s += range[i];
    }
    return t > 0 ? s / t : 0;
  };
  const facing = vc - hc;
  return {
    rows,
    best,
    facts: {
      equity,
      potOdds: facing > 0 ? potOdds(Math.min(facing, H), P) : null,
      spr: sprOf(Math.min(H + hc, V + vc) - Math.max(hc, vc), P),
      villainStrong: strongShare(sit.villainRange),
      heroStrong: sit.heroRange ? strongShare(sit.heroRange) : null,
      heroClass,
      liveCombos: W,
      realization: R,
    },
  };
}

// ---- Verdicts ----

export interface PostflopGrade {
  verdict: Verdict;
  heading: string;
  chosen: OptionRow;
  best: OptionRow;
  /** EV given up versus the best option, in chips. */
  loss: number;
  /** Options within the "correct" margin. */
  acceptable: OptionRow[];
  tags: string[];
  sizeNote: string | null;
}

/** Margins in chips: correct within max(0.25bb, 4% pot), playable within max(1bb, 15% pot). */
export function margins(potSize: number, bb: number) {
  return { correct: Math.max(0.25 * bb, 0.04 * potSize), playable: Math.max(bb, 0.15 * potSize) };
}

const sized = (k: HeroOption['kind']) => k === 'bet' || k === 'raise';

export function describeOption(o: HeroOption): string {
  if (o.kind === 'bet') return o.allIn ? 'Shove' : `Bet ${o.label}`;
  if (o.kind === 'raise') return o.allIn ? 'Raise all-in' : `Raise ${o.label}`;
  return o.label;
}

/** Finds the row for an action the hero took, matching bets by their "to" amount. */
export function rowForAction(a: Analysis, action: Action): OptionRow {
  if (action.type === 'bet' || action.type === 'raise') {
    const exact = a.rows.find((r) => sized(r.option.kind) && r.option.to === action.to);
    if (exact) return exact;
    // Custom size: nearest preset.
    const bets = a.rows.filter((r) => sized(r.option.kind));
    return bets.reduce((x, r) => (Math.abs(r.option.to! - action.to) < Math.abs(x.option.to! - action.to) ? r : x));
  }
  const row = a.rows.find((r) => r.option.kind === action.type);
  if (!row) throw new Error(`No ${action.type} option here`);
  return row;
}

export function gradePostflop(sit: PostflopSituation, a: Analysis, action: Action): PostflopGrade {
  const chosen = rowForAction(a, action);
  const best = a.best;
  const m = margins(sit.pot, sit.bb);
  const loss = Math.max(0, best.ev - chosen.ev);
  const acceptable = a.rows.filter((r) => best.ev - r.ev <= m.correct);
  const verdict: Verdict = loss <= m.correct ? 'correct' : loss <= m.playable ? 'playable' : 'mistake';
  const name = describeOption(chosen.option);
  let heading =
    verdict === 'correct' ? `Correct: ${name.toLowerCase()}`
      : verdict === 'playable' ? `Playable, but ${describeOption(best.option).toLowerCase()} earns more`
        : `Mistake: ${name.toLowerCase()}`;
  let sizeNote: string | null = null;
  if (verdict !== 'correct' && sized(chosen.option.kind) && sized(best.option.kind)) {
    heading = 'Right idea, wrong size';
    sizeNote = `${describeOption(best.option)} earns ${bbs(loss, sit.bb)} more than ${name.toLowerCase()}.`;
  }

  const tags: string[] = [];
  const f = a.facts;
  const thin = f.heroClass === 'topPairWeak' || f.heroClass === 'middlePair' || f.heroClass === 'weakPair';
  if (verdict !== 'correct') {
    if (chosen.option.kind === 'raise' && (f.heroClass === 'topPairGood' || f.heroClass === 'topPairWeak') && f.villainStrong >= 0.3) {
      tags.push('raised top pair into a strong range');
    }
    if (sized(chosen.option.kind) && !chosen.option.allIn && f.spr < 2.5 && best.option.allIn) {
      tags.push('middle sizing at low stack-to-pot ratio');
    }
    if (sized(chosen.option.kind) && thin && (chosen.potShare ?? 0) >= 0.6) tags.push('oversized thin value bet');
    if (chosen.option.kind === 'check' && sized(best.option.kind) && (best.eqWhenCalled ?? 0) > 0.5) tags.push('missed value bet');
    if (chosen.option.kind === 'call' && best.option.kind === 'fold') {
      tags.push(sit.heroInvested >= 0.3 * (sit.heroInvested + sit.heroBehind) ? 'sunk-cost call' : 'calling without the price');
    }
    if (chosen.option.kind === 'fold' && best.option.kind !== 'fold') tags.push('overfolding');
    if (sized(chosen.option.kind) && f.heroClass === 'air' && (chosen.fold ?? 0) < (chosen.breakEvenBluff ?? 0)) {
      tags.push('bluffed into a sticky range');
    }
  }
  if (verdict !== 'correct' && sit.street === 'flop' && chosen.option.kind === 'bet' && sit.heroFirstToAct && !sit.heroInPosition && !sit.heroPreflopAggressor) {
    tags.push('donk bet into the preflop raiser');
  }
  return { verdict, heading, chosen, best, loss, acceptable, tags, sizeNote };
}

export const bbs = (chips: number, bb: number): string => {
  const x = chips / bb;
  return `${Math.abs(x) >= 100 ? x.toFixed(0) : Math.abs(x) < 1 ? x.toFixed(2) : x.toFixed(1)}bb`;
};
