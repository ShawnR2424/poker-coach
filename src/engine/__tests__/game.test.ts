import { describe, expect, it } from 'vitest';
import { parseCards } from '../cards';
import { applyAction, legalActions, newHand, pot, type HandState } from '../hand';
import { advance, LEVELS, newGameHand, type GameHand, type LevelId } from '../game/levels';
import { botPostflopAction } from '../postflop/bot';
import { classifyHand } from '../postflop/classify';
import { continueProb, firstToActFreq, narrowPostflop, PROFILES, PROFILE_IDS } from '../postflop/model';
import { currentContext, narrowHand } from '../postflop/narrow';
import { botAction } from '../preflop/policy';
import { comboIndex, NUM_COMBOS, parseRange } from '../range';
import { makeRng } from '../rng';

const opts = { lowStakes: true };
const sum = (r: Float32Array) => r.reduce((a, x) => a + x, 0);

describe('narrowing splits a range without losing weight', () => {
  const range = parseRange('22+, A2s+, K9s+, QTs+, JTs, T9s, 98s, 87s, A9o+, KTo+, QJo');
  const board = parseCards('Ts7d3c');
  for (const id of PROFILE_IDS) {
    it(`first to act: check + small + big = everything (${id})`, () => {
      const p = PROFILES[id];
      const parts = [
        narrowPostflop(range, board, { kind: 'check' }, p),
        narrowPostflop(range, board, { kind: 'bet', f: 0.33 }, p),
        narrowPostflop(range, board, { kind: 'bet', f: 0.75 }, p),
      ];
      for (let i = 0; i < NUM_COMBOS; i++) {
        const total = parts[0][i] + parts[1][i] + parts[2][i];
        if (total > 0) expect(total).toBeCloseTo(range[i], 5);
      }
      // Only combos that use a board card drop out.
      expect(parts.reduce((a, r) => a + sum(r), 0)).toBeGreaterThan(sum(range) * 0.8);
    });
    it(`facing a bet: fold + call + raise = everything (${id})`, () => {
      const p = PROFILES[id];
      const call = narrowPostflop(range, board, { kind: 'call', f: 0.66 }, p);
      const raise = narrowPostflop(range, board, { kind: 'raise', f: 0.66 }, p);
      for (let i = 0; i < NUM_COMBOS; i++) {
        if (!(range[i] > 0) || call[i] + raise[i] === 0) continue;
        expect(call[i] + raise[i]).toBeLessThanOrEqual(range[i] + 1e-6);
      }
    });
  }

  it('styles differ the way their names say', () => {
    expect(continueProb('middlePair', 0.75, false, PROFILES.station)).toBeGreaterThan(continueProb('middlePair', 0.75, false, PROFILES.nit));
    expect(firstToActFreq('air', false, PROFILES.aggro).check).toBeLessThan(firstToActFreq('air', false, PROFILES.station).check);
    // Sets continue no matter the style.
    expect(continueProb('setPlus', 1, false, PROFILES.nit)).toBe(1);
  });
});

/** A heads-up flop spot: BTN opened, BB called, BB to act. */
function flopSpot(bbHole: string): HandState {
  const holes = [null, parseCards(bbHole), null, null, null, parseCards('AhKh')];
  let s = newHand({ config: { tableSize: 6, sb: 25, bb: 50 }, stacks: Array(6).fill(5000), hole: holes, board: parseCards('Ts7d3c2s9h'), seed: 3 });
  for (const a of [{ type: 'fold' }, { type: 'fold' }, { type: 'fold' }, { type: 'raise', to: 125 }, { type: 'fold' }, { type: 'call' }] as const) s = applyAction(s, a);
  return s;
}

describe('postflop bots', () => {
  it('act with the frequencies the model gives their hand', () => {
    const s = flopSpot('8h8d');
    expect(s.street).toBe('flop');
    const cls = classifyHand(s.players[1].hole, s.board);
    const want = firstToActFreq(cls, currentContext(s, 1).intoAggressor, PROFILES.regular);
    const rng = makeRng(11);
    let checks = 0, small = 0, big = 0;
    const n = 6000;
    for (let k = 0; k < n; k++) {
      const a = botPostflopAction(s, rng, PROFILES.regular);
      if (a.type === 'check') checks++;
      else if (a.type === 'bet' && a.to <= 0.5 * pot(s)) small++;
      else big++;
    }
    expect(checks / n).toBeCloseTo(want.check, 1);
    expect(small / n).toBeCloseTo(want.small, 1);
    expect(big / n).toBeCloseTo(want.big, 1);
  });

  it('only take legal actions', () => {
    const rng = makeRng(5);
    let s = flopSpot('QcJc');
    let guard = 0;
    while (s.toAct !== null && guard++ < 50) {
      const a = botPostflopAction(s, rng, PROFILES.aggro);
      const legal = legalActions(s);
      if (a.type === 'bet') expect(a.to).toBeGreaterThanOrEqual(legal.bet!.min);
      if (a.type === 'raise') expect(a.to).toBeLessThanOrEqual(legal.raise!.max);
      s = applyAction(s, a);
    }
    expect(s.result).not.toBeNull();
  });
});

/** Players still in when the flop was dealt (0 if there was no flop). */
function flopLive(s: HandState): number {
  if (s.board.length < 3) return 0;
  const out = new Set(s.actions.filter((a) => a.street === 'preflop' && a.type === 'fold').map((a) => a.player));
  return s.players.length - out.size;
}

/** Plays the hero with the same bots, checking the villain read at every hero decision. */
function playOut(g: GameHand, seed: number): { checks: number; state: HandState } {
  const rng = makeRng(seed);
  let s = advance(g, g.state, rng, opts);
  let checks = 0;
  let guard = 0;
  while (s.toAct === g.hero && guard++ < 30) {
    for (const vi of g.villains) {
      if (s.players[vi].folded) continue;
      const v = s.players[vi];
      const { range } = narrowHand(s, vi, 'pool', opts, PROFILES[g.profiles[vi]]);
      expect(range[comboIndex(v.hole[0], v.hole[1])], `villain hand missing from read, seed ${seed}`).toBeGreaterThan(0);
      checks++;
    }
    const a = s.street === 'preflop' ? botAction(s, rng, opts) : botPostflopAction(s, rng, PROFILES.regular);
    s = advance(g, applyAction(s, a), rng, opts);
  }
  return { checks, state: s };
}

describe('levels 2-5', () => {
  for (const level of [2, 3, 4, 5] as LevelId[]) {
    it(`level ${level}: hands finish, chips balance, and the read always holds the villain's real hand`, () => {
      let checks = 0;
      let postflop = 0;
      let threeWay = 0;
      for (let seed = 1; seed <= 120; seed++) {
        const g = newGameHand(level, makeRng(seed * 7919 + level), opts);
        expect(g.state.toAct).toBe(g.hero);
        expect(g.villains.length).toBe(level === 5 ? 2 : 1);
        const { checks: c, state } = playOut(g, seed);
        checks += c;
        expect(state.toAct).toBeNull();
        expect(state.result).not.toBeNull();
        expect(state.result!.net.reduce((a, x) => a + x, 0)).toBe(0);
        const live = state.players.filter((p) => !p.folded).length;
        expect(live).toBeLessThanOrEqual(g.villains.length + 1);
        if (state.board.length >= 3 && live >= 2) postflop++;
        // Multiway: count hands that saw a flop three-way.
        if (level === 5 && flopLive(state) === 3) threeWay++;
        if (LEVELS[level].stopAfterFlop) {
          const late = state.actions.filter((a) => a.street === 'turn' || a.street === 'river');
          expect(late.every((a) => a.type === 'check')).toBe(true);
        }
      }
      expect(checks).toBeGreaterThan(120);
      expect(postflop).toBeGreaterThan(20);
      if (level === 5) expect(threeWay).toBeGreaterThan(30);
    });
  }
});
