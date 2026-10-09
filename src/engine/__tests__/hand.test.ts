import { describe, expect, it } from 'vitest';
import { parseCards } from '../cards';
import {
  applyAction, legalActions, newHand, pot, type Action, type HandConfig, type HandState,
} from '../hand';
import { makeRng } from '../rng';

const cfg: HandConfig = { tableSize: 6, sb: 25, bb: 50 };
const stacks = (n = 5000) => Array(6).fill(n) as number[];
// Seat order is clockwise from SB: 0 SB, 1 BB, 2 UTG, 3 HJ, 4 CO, 5 BTN.

function play(s: HandState, ...acts: Action[]): HandState {
  for (const a of acts) s = applyAction(s, a);
  return s;
}
const F: Action = { type: 'fold' };
const C: Action = { type: 'call' };
const X: Action = { type: 'check' };
const R = (to: number): Action => ({ type: 'raise', to });
const B = (to: number): Action => ({ type: 'bet', to });

const chipsInPlay = (s: HandState) =>
  s.players.reduce((a, p) => a + p.stack, 0) + (s.result ? 0 : pot(s));

describe('blinds and preflop order', () => {
  it('posts blinds and starts with UTG facing a min-raise of 2bb', () => {
    const s = newHand({ config: cfg, stacks: stacks(), seed: 1 });
    expect(s.players.map((p) => p.position)).toEqual(['SB', 'BB', 'UTG', 'HJ', 'CO', 'BTN']);
    expect(pot(s)).toBe(75);
    expect(s.toAct).toBe(2);
    const l = legalActions(s);
    expect(l).toMatchObject({ fold: true, check: false, call: 50, bet: null, raise: { min: 100, max: 5000 } });
  });

  it('gives the BB the option after limps', () => {
    let s = newHand({ config: cfg, stacks: stacks(), seed: 1 });
    s = play(s, C, F, F, F, C);
    expect(s.toAct).toBe(1);
    expect(legalActions(s).check).toBe(true);
    s = play(s, X);
    expect(s.street).toBe('flop');
    expect(s.board.length).toBe(3);
    expect(s.toAct).toBe(0); // SB first postflop
  });
});

describe('min-raise rules', () => {
  it('re-raise minimum is the last raise increment', () => {
    let s = newHand({ config: cfg, stacks: stacks(), seed: 1 });
    s = play(s, R(150)); // UTG raises by 100
    expect(legalActions(s).raise!.min).toBe(250);
    s = play(s, R(400)); // HJ raises by 250
    expect(legalActions(s).raise!.min).toBe(650);
  });

  it('a short all-in does not reopen raising for a player who already acted', () => {
    const st = stacks();
    st[3] = 200; // HJ has only 4bb
    let s = newHand({ config: cfg, stacks: st, seed: 1 });
    s = play(s, R(150)); // UTG opens to 3bb
    s = play(s, R(200)); // HJ all-in for 200: increment 50 < 100, not a full raise
    expect(s.players[3].allIn).toBe(true);
    s = play(s, F, F, F, F); // CO, BTN, SB, BB fold
    expect(s.toAct).toBe(2);
    const l = legalActions(s);
    expect(l.call).toBe(50);
    expect(l.raise).toBeNull();
  });

  it('a player who has not acted may still raise after a short all-in', () => {
    const st = stacks();
    st[3] = 200;
    let s = newHand({ config: cfg, stacks: st, seed: 1 });
    s = play(s, R(150), R(200));
    expect(s.toAct).toBe(4);
    expect(legalActions(s).raise).toEqual({ min: 300, max: 5000 });
  });

  it('postflop min bet is one big blind', () => {
    let s = newHand({ config: cfg, stacks: stacks(), seed: 1 });
    s = play(s, F, F, F, F, C, X); // SB completes, BB checks
    expect(legalActions(s).bet).toEqual({ min: 50, max: 4950 });
    expect(() => applyAction(s, B(40))).toThrow();
  });
});

describe('pots and showdown', () => {
  it('returns an uncalled bet when everyone folds', () => {
    let s = newHand({ config: cfg, stacks: stacks(), seed: 1 });
    s = play(s, R(150), F, F, F, F, F);
    expect(s.result).not.toBeNull();
    expect(s.result!.net).toEqual([-25, -50, 75, 0, 0, 0]);
    expect(s.players[2].stack).toBe(5075);
  });

  it('builds side pots for a three-way all-in with different stacks', () => {
    const st = [5000, 5000, 1000, 2000, 5000, 5000];
    // UTG (1000) has the best hand, HJ (2000) second, BTN (5000) worst.
    const hole = [null, null, parseCards('AsAd'), parseCards('KsKd'), null, parseCards('7c2h')];
    const board = parseCards('Ah9c4d3sJh');
    let s = newHand({ config: cfg, stacks: st, hole, board, seed: 3 });
    s = play(s, R(1000), R(2000), F, { type: 'raise', to: 5000 }, F, F);
    // BTN shoves 5000; UTG and HJ were all-in already.
    const r = s.result!;
    expect(r.wentToShowdown).toBe(true);
    // Main pot: 1000 x 3 + blinds 75 = 3075 to UTG. Side pot: 1000 x 2 = 2000 to HJ.
    // BTN's uncalled 3000 is returned before settlement.
    expect(r.pots.map((p) => [p.amount, p.winners])).toEqual([[3075, [2]], [2000, [3]]]);
    expect(r.net).toEqual([-25, -50, 2075, 0, 0, -2000]);
  });

  it('splits a chopped pot with the odd chip to the first winner left of the button', () => {
    const hole = [null, parseCards('2c3d'), null, null, null, parseCards('4c5d')];
    const board = parseCards('AhKhQhJhTh'); // royal flush on board: BB and BTN chop
    let s = newHand({ config: cfg, stacks: stacks(), hole, board, seed: 1 });
    s = play(s, F, F, F, C, F, X); // BTN limps, SB folds, BB checks: pot 125
    s = play(s, X, X, X, X, X, X);
    expect(s.result!.pots).toEqual([{ amount: 125, eligible: [1, 5], winners: [1, 5], uncalled: false }]);
    // 62 each, the odd chip to the BB (first winner clockwise from the button).
    expect(s.result!.net).toEqual([-25, 13, 0, 0, 0, 12]);
  });

  it('runs the board out when everyone is all-in preflop', () => {
    const st = [5000, 1000, 5000, 5000, 5000, 5000];
    let s = newHand({ config: cfg, stacks: st, seed: 9 });
    s = play(s, F, F, F, F, R(1000), C);
    expect(s.board.length).toBe(5);
    expect(s.result).not.toBeNull();
  });
});

describe('random play fuzz', () => {
  it('chips always balance, stacks never go negative, and every hand terminates', () => {
    const rng = makeRng(2024);
    for (let h = 0; h < 3000; h++) {
      const st = Array.from({ length: 6 }, () => 100 + Math.floor(rng() * 10000));
      const total = st.reduce((a, b) => a + b, 0);
      let s = newHand({ config: cfg, stacks: st, seed: h });
      let steps = 0;
      while (s.toAct !== null) {
        expect(chipsInPlay(s)).toBe(total);
        const l = legalActions(s);
        const options: Action[] = [];
        if (l.fold) options.push(F);
        if (l.check) options.push(X);
        if (l.call !== null) options.push(C);
        if (l.bet) options.push(B(l.bet.min), B(l.bet.max), B(Math.floor((l.bet.min + l.bet.max) / 2)));
        if (l.raise) options.push(R(l.raise.min), R(l.raise.max));
        s = applyAction(s, options[Math.floor(rng() * options.length)]);
        if (++steps > 200) throw new Error('Hand did not terminate');
      }
      const r = s.result!;
      expect(s.players.every((p) => p.stack >= 0)).toBe(true);
      expect(s.players.reduce((a, p) => a + p.stack, 0)).toBe(total);
      expect(r.net.reduce((a, b) => a + b, 0)).toBe(0);
      // Everything that went into pots came back out to someone.
      const lost = r.net.filter((x) => x < 0).reduce((a, b) => a - b, 0);
      const won = r.net.filter((x) => x > 0).reduce((a, b) => a + b, 0);
      expect(won).toBe(lost);
    }
  });
});
