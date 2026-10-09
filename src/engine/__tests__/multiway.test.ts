import { describe, expect, it } from 'vitest';
import { parseCards, type Card } from '../cards';
import { comboEquities } from '../equity';
import { evaluate } from '../evaluator';
import { applyAction, newHand, type HandState } from '../hand';
import { COMBO_CARDS, NUM_COMBOS, parseRange, type Range } from '../range';
import { categorizePostflop } from '../postflop/categories';
import { comboTable, droppedClasses, keptShare } from '../postflop/combos';
import { narrowPostflop } from '../postflop/model';
import { analyzeMultiway, interactionNote, multiwaySituationFromState, type MultiwaySituation } from '../postflop/multiway';
import { analyze, heroOptions, type PostflopSituation } from '../postflop/recommend';

const c = parseCards;

/** Exact hero equity against several ranges: every non-overlapping combo pairing and every runout. */
function exactMultiway(hero: Card[], board: Card[], ranges: Range[]): number {
  const dead = new Set([...hero, ...board]);
  const live = ranges.map((r) => {
    const out: { cards: readonly Card[]; w: number }[] = [];
    for (let i = 0; i < NUM_COMBOS; i++) {
      const [a, b] = COMBO_CARDS[i];
      if (r[i] > 0 && !dead.has(a) && !dead.has(b)) out.push({ cards: [a, b], w: r[i] });
    }
    return out;
  });
  let share = 0, total = 0;
  const pickd: { cards: readonly Card[]; w: number }[] = [];
  const recurse = (k: number) => {
    if (k === live.length) {
      const used = new Set([...dead, ...pickd.flatMap((p) => p.cards)]);
      const w = pickd.reduce((a, p) => a * p.w, 1);
      const deck = Array.from({ length: 52 }, (_, i) => i).filter((x) => !used.has(x));
      const runouts: Card[][] = board.length === 5 ? [[]] : board.length === 4 ? deck.map((x) => [x]) : [];
      for (const extra of runouts) {
        const full = [...board, ...extra];
        const h = evaluate([...hero, ...full]);
        const vs = pickd.map((p) => evaluate([...p.cards, ...full]));
        const best = Math.max(...vs);
        const s = best > h ? 0 : 1 / (1 + vs.filter((v) => v === h).length);
        share += (w * s) / runouts.length;
      }
      total += w;
      return;
    }
    for (const p of live[k]) {
      if (pickd.some((q) => q.cards.some((x) => p.cards.includes(x)))) continue;
      pickd.push(p);
      recurse(k + 1);
      pickd.pop();
    }
  };
  recurse(0);
  return share / total;
}

/** CO opens, BTN and BB call; flop Ts7d3c, BB checks, CO (hero) to act. Holes are fixed so tests are repeatable. */
function threeWayFlop(extra: { type: string; to?: number }[] = []): HandState {
  const holes = [null, c('8h8d'), null, null, c('AhKh'), c('9c8c')];
  let s = newHand({ config: { tableSize: 6, sb: 25, bb: 50 }, stacks: Array(6).fill(5000), hole: holes, board: c('Ts7d3c2s9h'), seed: 3 });
  const pre = [{ type: 'fold' }, { type: 'fold' }, { type: 'raise', to: 125 }, { type: 'call' }, { type: 'fold' }, { type: 'call' }];
  for (const a of [...pre, { type: 'check' }, ...extra]) s = applyAction(s, a as never);
  return s;
}

const wide = parseRange('22+, A2s+, K9s+, QTs+, JTs, T9s, 98s, 87s, 76s, A9o+, KTo+, QJo');
const tight = parseRange('99+, AJs+, KQs, AQo+');

describe('multiway equity', () => {
  it('matches exact enumeration on the turn', () => {
    const hero = c('AhKh'), board = c('Kd7h4c2s');
    const v1 = parseRange('77, 44, AK, KQs, KJs');
    const v2 = parseRange('QQ, JJ, TT, 99, 6h5h, 8h6h');
    const sit = situation(hero, board, [v1, v2]);
    const { analysis } = analyzeMultiway(sit, { iterations: 8000 });
    const exact = exactMultiway(hero, board, [v1, v2]);
    expect(Math.abs(analysis.facts.equity - exact)).toBeLessThan(0.01);
  });

  it('matches exact enumeration on the river, including split pots', () => {
    const hero = c('AsQd'), board = c('AhKd7c7s2h');
    const v1 = parseRange('AK, AQ, AJ, KQ, 77');
    const v2 = parseRange('KJs, KTs, QJs, 22');
    const { analysis } = analyzeMultiway(situation(hero, board, [v1, v2]), { iterations: 8000 });
    expect(Math.abs(analysis.facts.equity - exactMultiway(hero, board, [v1, v2]))).toBeLessThan(0.01);
  });
});

/** A bare multiway decision: hero first to act on `board` with a 1000-chip pot. */
function situation(hero: Card[], board: Card[], ranges: Range[]): MultiwaySituation {
  return {
    hero, board,
    street: board.length === 3 ? 'flop' : board.length === 4 ? 'turn' : 'river',
    pot: 1000, bb: 50, heroBehind: 4500, heroInvested: 500, heroCommitted: 0, currentBet: 0,
    heroFirstToAct: true, heroInPosition: false, heroPreflopAggressor: true,
    villains: ranges.map((range, j) => ({ seat: j + 1, committed: 0, behind: 4500, range })),
    options: [
      { kind: 'check', label: 'Check' },
      { kind: 'bet', to: 330, label: '33%' },
      { kind: 'bet', to: 750, label: '75%' },
    ],
  };
}

describe('multiway EV', () => {
  it('with one opponent, agrees with the heads-up analysis', () => {
    const hero = c('AhKh'), board = c('Ts7d3c');
    const sit = situation(hero, board, [wide]);
    const { analysis: mw } = analyzeMultiway(sit);
    const hu: PostflopSituation = {
      ...sit, villainRange: wide, villainCommitted: 0, villainBehind: 4500,
    } as unknown as PostflopSituation;
    const ha = analyze(hu, comboEquities(hero, board, wide));
    expect(mw.facts.equity).toBeCloseTo(ha.facts.equity, 2);
    for (const r of mw.rows) {
      const h = ha.rows.find((x) => x.option.label === r.option.label)!;
      if (r.option.kind === 'check') expect(r.ev).toBeCloseTo(h.ev, 0);
      else {
        expect(r.fold!).toBeCloseTo(h.fold!, 6);
        expect(r.call!).toBeCloseTo(h.call!, 6);
        expect(r.raise!).toBeCloseTo(h.raise!, 6);
        expect(r.eqWhenCalled!).toBeCloseTo(h.eqWhenCalled!, 4);
      }
    }
  });

  it('a second opponent lowers equity and how often a bet takes the pot', () => {
    const hero = c('AhKh'), board = c('Ts7d3c');
    const one = analyzeMultiway(situation(hero, board, [wide])).analysis;
    const two = analyzeMultiway(situation(hero, board, [wide, tight])).analysis;
    expect(two.facts.equity).toBeLessThan(one.facts.equity);
    for (const label of ['33%', '75%']) {
      const a = one.rows.find((r) => r.option.label === label)!;
      const b = two.rows.find((r) => r.option.label === label)!;
      expect(b.fold!).toBeLessThan(a.fold!);
      expect(b.ev).toBeLessThan(a.ev);
    }
  });

  it('everyone folds with the product of each fold share, and shares add up', () => {
    const { analysis } = analyzeMultiway(situation(c('AhKh'), c('Ts7d3c'), [wide, tight]));
    const singles = [wide, tight].map((r) => analyzeMultiway(situation(c('AhKh'), c('Ts7d3c'), [r])).analysis);
    for (const r of analysis.rows.filter((x) => x.option.kind === 'bet')) {
      const f = singles.map((a) => a.rows.find((x) => x.option.label === r.option.label)!.fold!);
      expect(r.fold!).toBeCloseTo(f[0] * f[1], 6);
      expect(r.fold! + r.call! + r.raise!).toBeLessThanOrEqual(1 + 1e-9);
    }
  });
});

describe('multiway from a live hand', () => {
  it('builds the situation and describes a sandwiched caller', () => {
    // BB (seat 1) bets, CO (seat 4) calls, BTN (seat 5) is the hero.
    const holes = [null, c('8h8d'), null, null, c('AhKh'), c('9c8c')];
    let s = newHand({ config: { tableSize: 6, sb: 25, bb: 50 }, stacks: Array(6).fill(5000), hole: holes, board: c('Ts7d3c2s9h'), seed: 3 });
    const acts = [{ type: 'fold' }, { type: 'fold' }, { type: 'raise', to: 125 }, { type: 'call' }, { type: 'fold' }, { type: 'call' }, { type: 'bet', to: 200 }, { type: 'call' }];
    for (const a of acts) s = applyAction(s, a as never);
    expect(s.toAct).toBe(5);
    expect(interactionNote(s, 5, [1, 4])).toContain('sandwiched');
    const sit = multiwaySituationFromState(s, 5, [1, 4].map((seat) => ({ seat, range: wide })), { heroPreflopAggressor: false });
    expect(sit.heroInPosition).toBe(true);
    expect(sit.currentBet).toBe(200);
    expect(sit.options.map((o) => o.kind)).toEqual(heroOptions(s).map((o) => o.kind));
    const { analysis } = analyzeMultiway(sit);
    expect(analysis.facts.potOdds).toBeCloseTo(200 / (sit.pot + 200), 6);
    // CO still to act behind a BB bet is told it can be squeezed.
    let t = newHand({ config: { tableSize: 6, sb: 25, bb: 50 }, stacks: Array(6).fill(5000), hole: holes, board: c('Ts7d3c2s9h'), seed: 3 });
    for (const a of acts.slice(0, 7)) t = applyAction(t, a as never);
    expect(interactionNote(t, 4, [1, 5])).toMatch(/BTN still acts after you/);
  });

  it('notes when players checked to the hero', () => {
    const s = threeWayFlop();
    const hero = s.toAct!;
    const others = s.players.map((_, i) => i).filter((i) => i !== hero && !s.players[i].folded);
    expect(interactionNote(s, hero, others)).toMatch(/checked to you/);
  });
});

describe('combo table', () => {
  it('matches the grid cell for every class', () => {
    for (const [hero, board] of [['AhKh', 'Ts7d3c'], ['QsQd', 'Qh9c4d2s'], ['As5s', 'AhKd7c7s2h']] as const) {
      const h = c(hero), b = c(board);
      const eqs = comboEquities(h, b, wide);
      const grid = categorizePostflop(wide, h, b, eqs);
      const table = comboTable(wide, h, b, eqs);
      const byCls = new Map(table.map((r) => [r.cls, r]));
      for (const cell of grid.cells) {
        const row = byCls.get(cell.cls);
        if (cell.combos > 0) {
          expect(row, cell.cls).toBeDefined();
          expect(row!.left).toBeCloseTo(cell.combos, 6);
          expect(row!.category).toBe(cell.category);
          expect(row!.heroEquity!).toBeCloseTo(cell.heroEquity!, 6);
        } else if (row) {
          expect(row.left).toBe(0);
        }
      }
      expect(table.reduce((a, r) => a + r.left, 0)).toBeCloseTo(grid.live, 4);
    }
  });

  it('explains card removal', () => {
    const table = comboTable(wide, c('AhKh'), c('Ks7d3c'), comboEquities(c('AhKh'), c('Ks7d3c'), wide));
    const kk = table.find((r) => r.cls === 'KK')!;
    expect(kk.before).toBe(6);
    expect(kk.left).toBe(1); // only KdKc is left
    expect(kk.yours).toEqual(c('Kh'));
    expect(kk.board).toEqual(c('Ks'));
    const ak = table.find((r) => r.cls === 'AKs')!;
    expect(ak.left).toBe(2); // AhKh is yours; AsKs uses the board king
  });
});

describe('crossed-out cells after a postflop action', () => {
  it('a call of a big bet drops the air and keeps the strong hands', () => {
    const board = c('Ts7d3c');
    const after = narrowPostflop(wide, board, { kind: 'call', f: 1, beingRaised: false, canRaise: true });
    const dropped = droppedClasses(wide, after, board);
    expect(dropped.has('TT')).toBe(false);
    expect(dropped.has('A9o')).toBe(true);
    const kept = keptShare(wide, after, board);
    expect(kept).toBeGreaterThan(0.1);
    expect(kept).toBeLessThan(0.8);
  });
});
