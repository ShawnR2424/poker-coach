// The real-play report: every imported hand in the saved sessions, summed up as a picture of how
// the player plays for real money. Imported hands are graded with the practice models when they
// are read (import.ts); this adds the numbers a tracker shows (win rate, VPIP, PFR, 3-bet) and
// sorts the grades by position, street and leak. Preflop stats are meaningful here, unlike at the
// practice table, because the preflop action of a real hand is not scripted.

import { clockwiseFromSB, type Position } from '../positions';
import { IMPORTED_LEVEL } from './import';
import { replayStates, type HandReplay } from './replay';
import type { DecisionRecord, HandRecord, SavedSessions, Verdict } from './session';

/** What one imported hand adds to the preflop stats. */
export interface RealStats {
  pos: Position;
  /** Put money in preflop by choice: a call, a completion of the small blind or a raise. */
  vpip: boolean;
  /** Raised preflop. */
  pfr: boolean;
  /** Faced exactly one raise at a preflop decision, and whether the hero re-raised it. */
  threeBetOpp: boolean;
  threeBet: boolean;
  /** Opened, faced a re-raise, and whether the hero folded to it. */
  foldTo3BetOpp: boolean;
  foldTo3Bet: boolean;
  sawFlop: boolean;
}

/** Works out a hand's preflop stats from its replay. */
export function realStats(r: HandReplay): RealStats {
  const states = replayStates(r);
  const out: RealStats = {
    pos: clockwiseFromSB(r.config.tableSize)[r.hero],
    vpip: false, pfr: false, threeBetOpp: false, threeBet: false, foldTo3BetOpp: false, foldTo3Bet: false, sawFlop: false,
  };
  let raises = 0;
  let opened = false;
  for (let k = 0; k < r.actions.length; k++) {
    const s = states[k];
    if (s.street !== 'preflop') break;
    const [player, type] = r.actions[k];
    if (player === r.hero) {
      if (raises === 1 && !opened && !out.threeBetOpp) {
        out.threeBetOpp = true;
        out.threeBet = type === 'raise';
      }
      if (opened && raises === 2 && !out.foldTo3BetOpp) {
        out.foldTo3BetOpp = true;
        out.foldTo3Bet = type === 'fold';
      }
      if (type === 'call' || type === 'raise') out.vpip = true;
      if (type === 'raise') {
        out.pfr = true;
        if (raises === 0) opened = true;
      }
    }
    if (type === 'raise') raises++;
  }
  // The hero saw the flop when the hand reached it without the hero folding before the flop.
  let foldedPreflop = false;
  for (let k = 0; k < r.actions.length && states[k].street === 'preflop'; k++) {
    if (r.actions[k][0] === r.hero && r.actions[k][1] === 'fold') foldedPreflop = true;
  }
  out.sawFlop = !foldedPreflop && states.some((s) => s.street !== 'preflop');
  return out;
}

export type Street = 'preflop' | 'flop' | 'turn' | 'river';
const STREETS: Street[] = ['preflop', 'flop', 'turn', 'river'];

/** The street of a decision, from its label ("Flop Ts7d3c" and so on; preflop labels name the spot). */
export function decisionStreet(d: DecisionRecord): Street {
  const m = /^(Flop|Turn|River)\b/.exec(d.label);
  return m ? (m[1].toLowerCase() as Street) : 'preflop';
}

export interface Rate { n: number; of: number }

export interface PositionRow {
  pos: Position;
  hands: number;
  netBB: number;
  vpip: Rate;
  pfr: Rate;
  decisions: number;
  mistakes: number;
}

export interface StreetRow {
  street: Street;
  decisions: number;
  verdicts: Record<Verdict, number>;
  /** EV given up against the best play, in big blinds (postflop only; preflop grades carry no EV). */
  lossBB: number;
}

export interface LeakRow {
  tag: string;
  count: number;
  /** Postflop EV lost on the decisions that showed it, in big blinds. */
  lossBB: number;
}

export interface CostlyDecision {
  at: string;
  hand: string;
  label: string;
  you: string;
  heading: string;
  lossBB: number;
}

export interface RealPlayReport {
  hands: number;
  /** Hands whose preflop stats could be read (all but old hands that lost their replay). */
  withStats: number;
  netBB: number;
  /** Big blinds won per 100 hands; null under 10 hands. */
  bbPer100: number | null;
  decisions: number;
  verdicts: Record<Verdict, number>;
  vpip: Rate;
  pfr: Rate;
  threeBet: Rate;
  foldTo3Bet: Rate;
  sawFlop: Rate;
  byPosition: PositionRow[];
  byStreet: StreetRow[];
  leaks: LeakRow[];
  costly: CostlyDecision[];
}

const POSITION_ORDER: Position[] = ['UTG', 'UTG+1', 'UTG+2', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
const verdicts = (): Record<Verdict, number> => ({ correct: 0, playable: 0, mistake: 0 });

/** Every imported hand in the saved sessions, oldest first. */
export function importedHands(saved: SavedSessions): HandRecord[] {
  return [...saved.past].reverse().concat(saved.current).flatMap((s) => s.hands.filter((h) => h.level === IMPORTED_LEVEL));
}

/** The stats saved with a hand, or worked out from its replay for hands imported before they were saved. */
function statsOf(h: HandRecord): RealStats | null {
  if (h.real) return h.real;
  if (!h.replay) return null;
  try {
    return realStats(h.replay);
  } catch {
    return null;
  }
}

export function realPlayReport(hands: readonly HandRecord[], costlyCount = 5): RealPlayReport {
  const rate = (): Rate => ({ n: 0, of: 0 });
  const r: RealPlayReport = {
    hands: hands.length, withStats: 0, netBB: 0, bbPer100: null, decisions: 0, verdicts: verdicts(),
    vpip: rate(), pfr: rate(), threeBet: rate(), foldTo3Bet: rate(), sawFlop: rate(),
    byPosition: [], byStreet: STREETS.map((street) => ({ street, decisions: 0, verdicts: verdicts(), lossBB: 0 })), leaks: [], costly: [],
  };
  const pos = new Map<Position, PositionRow>();
  const leaks = new Map<string, LeakRow>();
  const costly: CostlyDecision[] = [];
  const count = (x: Rate, yes: boolean, when = true) => {
    if (!when) return;
    x.of++;
    if (yes) x.n++;
  };

  for (const h of hands) {
    const netBB = h.net / h.bb;
    r.netBB += netBB;
    const st = statsOf(h);
    let row: PositionRow | undefined;
    if (st) {
      r.withStats++;
      count(r.vpip, st.vpip);
      count(r.pfr, st.pfr);
      count(r.threeBet, st.threeBet, st.threeBetOpp);
      count(r.foldTo3Bet, st.foldTo3Bet, st.foldTo3BetOpp);
      count(r.sawFlop, st.sawFlop);
      row = pos.get(st.pos) ?? { pos: st.pos, hands: 0, netBB: 0, vpip: rate(), pfr: rate(), decisions: 0, mistakes: 0 };
      row.hands++;
      row.netBB += netBB;
      count(row.vpip, st.vpip);
      count(row.pfr, st.pfr);
      pos.set(st.pos, row);
    }
    for (const d of h.decisions) {
      r.decisions++;
      r.verdicts[d.verdict]++;
      const s = r.byStreet[STREETS.indexOf(decisionStreet(d))];
      s.decisions++;
      s.verdicts[d.verdict]++;
      const loss = d.lossBB ?? 0;
      s.lossBB += loss;
      if (row) {
        row.decisions++;
        if (d.verdict === 'mistake') row.mistakes++;
      }
      for (const tag of d.tags) {
        const l = leaks.get(tag) ?? { tag, count: 0, lossBB: 0 };
        l.count++;
        l.lossBB += loss;
        leaks.set(tag, l);
      }
      if (loss > 0 && d.verdict !== 'correct') costly.push({ at: h.at, hand: d.hand, label: d.label, you: d.you, heading: d.heading, lossBB: loss });
    }
  }
  r.bbPer100 = hands.length >= 10 ? (r.netBB / hands.length) * 100 : null;
  r.byPosition = POSITION_ORDER.filter((p) => pos.has(p)).map((p) => pos.get(p)!);
  r.leaks = [...leaks.values()].sort((a, b) => b.lossBB - a.lossBB || b.count - a.count);
  r.costly = costly.sort((a, b) => b.lossBB - a.lossBB).slice(0, costlyCount);
  return r;
}

export const share = (x: Rate): number | null => (x.of ? x.n / x.of : null);
