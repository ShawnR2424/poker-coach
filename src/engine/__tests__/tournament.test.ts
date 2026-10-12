// Tournament mode: ICM payouts, chips conserved in every outcome, push/fold ranges that match
// the known heads-up equilibrium and answer each other, ICM tightening calls, and grading.

import { describe, expect, it } from 'vitest';
import { ALL_CLASSES } from '../range';
import { makeRng } from '../rng';
import { CLASS_INDEX, EQUITY, NUM_CLASSES } from '../tournament/classEquity';
import { icmEquities } from '../tournament/icm';
import {
  openerValues, orderOdds, ORDERS, overValues, rangeShare, solve, stacksAfter, stacksAfterThree, unitPerBB, type TableSetup,
} from '../tournament/pushfold';
import {
  addAnswer, answer, dealSpot, emptyTally, equityNeeded, overcallOdds, gradeClass, gradeSpot, MARGINS, parseTally, rangeText, solveSpot, verdictFor,
  type SolvedSpot,
} from '../tournament/spots';
import {
  addTournamentCard, answerCard, dueCards, emptyDeck, isTournamentCard, parseDeck, type TournamentCard, type TournamentCardSpot,
} from '../review/review';
import { callingHands, openRange, reshoveStacks, shoveValues, solveReshove, type ReshoveSetup } from '../tournament/reshove';
import { getStrategy } from '../preflop/charts';

/** Harville by brute force: every finishing order, with its probability. */
function bruteIcm(stacks: number[], payouts: number[]): number[] {
  const out = new Array(stacks.length).fill(0);
  const go = (left: number[], p: number, place: number) => {
    if (!left.length) return;
    const total = left.reduce((a, i) => a + stacks[i], 0);
    for (const i of left) {
      const q = p * (stacks[i] / total);
      out[i] += q * (payouts[place] ?? 0);
      go(left.filter((x) => x !== i), q, place + 1);
    }
  };
  go(stacks.map((_, i) => i), 1, 0);
  return out;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const eq = (a: string, b: string) => EQUITY[CLASS_INDEX.get(a)! * NUM_CLASSES + CLASS_INDEX.get(b)!];

describe('class equity table', () => {
  it('is consistent and matches known matchups', () => {
    let off = 0;
    for (let i = 0; i < NUM_CLASSES; i++) for (let j = 0; j < NUM_CLASSES; j++) if (Math.abs(EQUITY[i * NUM_CLASSES + j] + EQUITY[j * NUM_CLASSES + i] - 1) > 1e-6) off++;
    expect(off).toBe(0);
    expect(eq('AA', 'KK')).toBeCloseTo(0.82, 1);
    expect(eq('AKo', 'QQ')).toBeCloseTo(0.43, 1);
    expect(eq('22', 'AKs')).toBeCloseTo(0.5, 1);
    expect(eq('AKs', '72o')).toBeGreaterThan(0.65);
  });
});

describe('ICM', () => {
  it('matches a brute-force Harville model and pays out the whole pool', () => {
    const rng = makeRng(5);
    for (let t = 0; t < 30; t++) {
      const n = 3 + Math.floor(rng() * 4);
      const stacks = Array.from({ length: n }, () => 1 + Math.floor(rng() * 40));
      const payouts = [0.5, 0.3, 0.2, 0.1].slice(0, Math.min(n, 1 + Math.floor(rng() * 4)));
      const got = icmEquities(stacks, payouts), want = bruteIcm(stacks, payouts);
      got.forEach((g, i) => expect(g).toBeCloseTo(want[i], 9));
      expect(sum(got)).toBeCloseTo(sum(payouts), 9);
    }
  });

  it('gives equal stacks equal shares, a bigger stack more, and a busted player the lowest place', () => {
    expect(icmEquities([10, 10, 10], [0.5, 0.3, 0.2]).map((x) => +x.toFixed(9))).toEqual([1 / 3, 1 / 3, 1 / 3].map((x) => +x.toFixed(9)));
    const e = icmEquities([30, 20, 10], [0.5, 0.3, 0.2]);
    expect(e[0]).toBeGreaterThan(e[1]);
    expect(e[1]).toBeGreaterThan(e[2]);
    // A chip leader's share of the money is less than their share of the chips.
    expect(e[0]).toBeLessThan(0.5);
    const b = icmEquities([20, 0, 10], [0.5, 0.3]);
    expect(b[1]).toBe(0);
    expect(b[0] + b[2]).toBeCloseTo(0.8, 9);
  });
});

describe('outcomes', () => {
  it('keep every chip in play, with and without the ante', () => {
    const rng = makeRng(9);
    for (let t = 0; t < 40; t++) {
      const n = rng() < 0.5 ? 6 : 9;
      const stacks = Array.from({ length: n }, () => 3 + Math.round(rng() * 60) / 2);
      const setup: TableSetup = { stacks, ante: rng() < 0.5, mode: 'chips', opener: Math.floor(rng() * (n - 1)) };
      const total = sum(stacks);
      expect(sum(stacksAfter(setup, { walk: true }))).toBeCloseTo(total, 9);
      expect(sum(stacksAfter(setup, { caller: null }))).toBeCloseTo(total, 9);
      for (let c = setup.opener + 1; c < n; c++) {
        for (const openerWins of [true, false]) {
          const after = stacksAfter(setup, { caller: c, openerWins });
          expect(sum(after)).toBeCloseTo(total, 9);
          expect(Math.min(...after)).toBeGreaterThanOrEqual(-1e-9);
        }
        for (let d = c + 1; d < n; d++) {
          for (const order of ORDERS) {
            const after = stacksAfterThree(setup, c, d, order);
            expect(sum(after)).toBeCloseTo(total, 9);
            expect(Math.min(...after)).toBeGreaterThanOrEqual(-1e-9);
          }
        }
      }
    }
  });

  it('give a three-way all-in a main pot and a side pot', () => {
    // The button has 4bb against two 10bb blinds: the main pot (3 x 4bb) goes to the best hand,
    // the side pot (2 x 6bb) to the better of the two blinds.
    const t: TableSetup = { stacks: [10, 10, 10, 4, 10, 10], ante: false, mode: 'chips', opener: 3 };
    expect(stacksAfterThree(t, 4, 5, [0, 2, 1])).toEqual([10, 10, 10, 12, 0, 12]);
    expect(stacksAfterThree(t, 4, 5, [1, 0, 2])).toEqual([10, 10, 10, 0, 24, 0]);
    expect(stacksAfterThree(t, 4, 5, [2, 1, 0])).toEqual([10, 10, 10, 0, 0, 24]);
  });

  it('spread a three-way all-in over the finishing orders by the head-to-head equities', () => {
    const rng = makeRng(4);
    for (let i = 0; i < 50; i++) {
      const odds = orderOdds(rng(), rng(), rng());
      expect(sum(odds)).toBeCloseTo(1, 12);
      expect(Math.min(...odds)).toBeGreaterThanOrEqual(0);
    }
    for (const x of orderOdds(0.5, 0.5, 0.5)) expect(x).toBeCloseTo(1 / 6, 12);
    // A hand that beats both others most of the time finishes first most of the time.
    const odds = orderOdds(0.8, 0.8, 0.5);
    expect(odds[0] + odds[1]).toBeGreaterThan(0.7);
    expect(odds[0] + odds[1]).toBeGreaterThan(odds[2] + odds[3] + odds[4] + odds[5]);
  });

  it('let the opener steal the blinds and ante when everyone folds', () => {
    const after = stacksAfter({ stacks: [10, 10, 10, 10, 10, 10], ante: true, mode: 'chips', opener: 3 }, { caller: null });
    expect(after).toEqual([10, 10, 10, 12.5, 9.5, 8]);
  });
});

const HU = (bb: number, ante = false): TableSetup => ({ stacks: [bb, bb, bb, bb, bb, bb], ante, mode: 'chips', opener: 4 });

describe('push/fold ranges', () => {
  it('match the known heads-up equilibrium and widen as stacks get shorter', () => {
    const s10 = solve(HU(10));
    // Published heads-up push/fold equilibria at 10bb, no ante: the small blind shoves about 58%
    // of hands and the big blind calls about 37%.
    expect(rangeShare(s10.push)).toBeGreaterThan(0.52);
    expect(rangeShare(s10.push)).toBeLessThan(0.63);
    expect(rangeShare(s10.call[5])).toBeGreaterThan(0.32);
    expect(rangeShare(s10.call[5])).toBeLessThan(0.42);
    const shares = [5, 10, 15, 20].map((b) => rangeShare(solve(HU(b)).push));
    for (let i = 1; i < shares.length; i++) expect(shares[i]).toBeLessThan(shares[i - 1]);
    // An ante adds dead money, so the small blind shoves more.
    expect(rangeShare(solve(HU(10, true)).push)).toBeGreaterThan(rangeShare(s10.push));
    expect(rangeText(s10.push)).toMatch(/^22\+/);
  });

  it('answer each other: the opener\'s range is its best answer to the calls, within the margin', () => {
    const tables: TableSetup[] = [
      { stacks: [10, 25, 8, 15, 12, 30, 20, 9, 14], ante: true, mode: 'final', opener: 0 },
      { stacks: [12, 7, 30, 18, 6, 22], ante: true, mode: 'bubble', opener: 3 },
      { stacks: [12, 7, 30, 18, 6, 22], ante: false, mode: 'chips', opener: 2 },
    ];
    for (const t of tables) {
      const s = solve(t);
      const unit = unitPerBB(t);
      let wrong = 0;
      for (let j = 0; j < NUM_CLASSES; j++) {
        const v = openerValues(s, j);
        const gap = (v.play - v.fold) / unit;
        if (s.push[j] === 1 && gap < -MARGINS.correct) wrong++;
        if (s.push[j] === 0 && gap > MARGINS.correct) wrong++;
      }
      expect(wrong, `${t.mode} opener ${t.opener}`).toBe(0);
      // Callers call with a top range: every hand that calls has more equity than every hand that folds.
      for (let c = t.opener + 1; c < t.stacks.length; c++) {
        const v = ALL_CLASSES.map((cls) => gradeClass(s, c, cls));
        const calls = v.filter((x) => x.freq === 1).map((x) => x.equity), folds = v.filter((x) => x.freq === 0).map((x) => x.equity);
        if (calls.length && folds.length) expect(Math.min(...calls)).toBeGreaterThanOrEqual(Math.max(...folds) - 1e-9);
      }
    }
  });

  it('let a second player overcall, with a tighter range than a first call, that is its best answer within half a big blind', () => {
    // The callers answer exactly; an overcall range is an average of answers, so a hand at its edge can be off by a little.
    const tables: TableSetup[] = [
      { stacks: [10, 10, 10, 10, 10, 10], ante: true, mode: 'chips', opener: 0 },
      { stacks: [12, 7, 30, 18, 6, 22], ante: true, mode: 'final', opener: 1 },
    ];
    for (const t of tables) {
      const s = solve(t);
      const unit = unitPerBB(t);
      let overcalls = 0;
      for (let c = t.opener + 1; c < t.stacks.length; c++) {
        if (!(rangeShare(s.call[c]) > 0)) continue;
        for (let d = c + 1; d < t.stacks.length; d++) {
          const o = s.over[c][d];
          const share = rangeShare(o);
          if (share > 0) overcalls++;
          expect(share, `seat ${d} behind ${c}`).toBeLessThan(rangeShare(s.call[d]));
          let wrong = 0;
          for (let m = 0; m < NUM_CLASSES; m++) {
            const v = overValues(s, c, d, m);
            const gap = (v.play - v.fold) / unit;
            if (o[m] === 1 && gap < -MARGINS.playable) wrong++;
            if (o[m] === 0 && gap > MARGINS.playable) wrong++;
          }
          expect(wrong, `${t.mode}: seat ${d} behind ${c}`).toBe(0);
        }
      }
      expect(overcalls).toBeGreaterThan(0);
      expect(overcallOdds(s, t.opener + 1)).toBeGreaterThan(0);
      expect(overcallOdds(s, t.stacks.length - 1)).toBe(0);
    }
  });

  it('tighten under ICM, more so on the bubble', () => {
    const stacks = [15, 12, 20, 9, 14, 11];
    const chips = solve({ stacks, ante: true, mode: 'chips', opener: 3 });
    const final = solve({ stacks, ante: true, mode: 'final', opener: 3 });
    const bubble = solve({ stacks, ante: true, mode: 'bubble', opener: 3 });
    for (const c of [4, 5]) {
      expect(rangeShare(final.call[c])).toBeLessThan(rangeShare(chips.call[c]));
      expect(rangeShare(bubble.call[c])).toBeLessThan(rangeShare(final.call[c]));
      expect(equityNeeded(final, c)).toBeGreaterThan(equityNeeded(chips, c));
    }
  });
});

describe('reshove spots', () => {
  const table = (mode: ReshoveSetup['mode'], heroStack = 15, ante = true): ReshoveSetup => {
    const stacks = [30, 30, 30, 30, 30, 30];
    stacks[5] = heroStack;
    return { stacks, ante, mode, opener: 2, hero: 5 };
  };

  it('keep every chip in play and pay the opener\'s raise to a successful all-in', () => {
    const rng = makeRng(23);
    for (let t = 0; t < 40; t++) {
      const n = rng() < 0.5 ? 6 : 9;
      const opener = Math.floor(rng() * (n - 1));
      const hero = opener + 1 + Math.floor(rng() * (n - 1 - opener));
      const setup: ReshoveSetup = { stacks: Array.from({ length: n }, () => 3 + Math.round(rng() * 60) / 2), ante: rng() < 0.5, mode: 'chips', opener, hero };
      const total = sum(setup.stacks);
      for (const o of ['fold', 'steal', 'heroWins', 'openerWins'] as const) {
        const after = reshoveStacks(setup, o);
        expect(sum(after)).toBeCloseTo(total, 9);
        expect(Math.min(...after)).toBeGreaterThanOrEqual(-1e-9);
      }
    }
    // BB reshoves over a CO open and the CO folds: +2bb from the CO, +0.5 from the SB, the ante back.
    const steal = reshoveStacks(table('chips'), 'steal');
    expect(steal).toEqual([30, 30, 28, 30, 29.5, 17.5]);
    expect(reshoveStacks(table('chips'), 'fold')).toEqual([30, 30, 32.5, 30, 29.5, 13]);
  });

  it('open from the 40bb chart, shove a top range that narrows with depth and under ICM, and call with the best opens', () => {
    const open = openRange(6, 2);
    const chart = getStrategy('rfi', 'CO', 'baseline', false, 40, false);
    expect(rangeShare(open)).toBeCloseTo(Array.from(chart.raise).reduce((a, b) => a + b, 0) / 1326, 6);
    const s15 = solveReshove(table('chips', 15)), s25 = solveReshove(table('chips', 25));
    expect(rangeShare(s25.shove)).toBeLessThan(rangeShare(s15.shove));
    expect(rangeShare(solveReshove(table('final', 15)).shove)).toBeLessThan(rangeShare(s15.shove));
    expect(rangeShare(solveReshove(table('bubble', 15)).call)).toBeLessThan(rangeShare(s15.call));
    expect(s15.shove[CLASS_INDEX.get('AA')!]).toBe(1);
    expect(s15.shove[CLASS_INDEX.get('72o')!]).toBe(0);
    // The calls are the opens that do best against the all-in range, and lie inside the opens.
    const calls = callingHands(s15);
    for (let k = 0; k < NUM_CLASSES; k++) expect(calls[k]).toBeLessThanOrEqual(open[k] + 1e-12);
    // The all-in range is the hero's best answer to the calls, within the correct margin.
    let wrong = 0;
    for (let j = 0; j < NUM_CLASSES; j++) {
      const v = shoveValues(s15, j);
      if (s15.shove[j] === 1 && v.play - v.fold < -MARGINS.correct) wrong++;
      if (s15.shove[j] === 0 && v.play - v.fold > MARGINS.correct) wrong++;
    }
    expect(wrong).toBe(0);
  });

  it('only deal reshoves when asked, with the opener deep enough to open', () => {
    const rng = makeRng(31);
    for (let i = 0; i < 6; i++) {
      const s = dealSpot(rng, { players: 9, ante: true, mode: 'final', spots: 'reshove' });
      expect(s.kind).toBe('reshove');
      expect(s.spot.stacks[s.spot.opener]).toBeGreaterThanOrEqual(15);
      expect(gradeSpot(s, 'AA').best).toBe('play');
    }
    for (let i = 0; i < 6; i++) expect(dealSpot(rng, { players: 6, ante: false, mode: 'chips', spots: 'pushfold' }).kind).not.toBe('reshove');
  }, 30_000);
});

describe('grading', () => {
  it('grades by the gap to the better option, and the needed equity agrees with calling', () => {
    expect(verdictFor(0)).toBe('correct');
    expect(verdictFor(MARGINS.correct + 0.01)).toBe('playable');
    expect(verdictFor(MARGINS.playable + 0.01)).toBe('mistake');
    const rng = makeRng(17);
    let tally = emptyTally();
    const kinds = new Set<string>();
    for (let i = 0; i < 25; i++) {
      const s = dealSpot(rng, { players: i % 2 ? 9 : 6, ante: i % 3 !== 0, mode: (['chips', 'final', 'bubble'] as const)[i % 3], spots: 'both' });
      const { spot } = s;
      kinds.add(s.kind);
      const [lo, hi] = s.kind === 'reshove' ? [12, 25] : [4, 15];
      expect(spot.stacks[spot.hero]).toBeGreaterThanOrEqual(lo);
      expect(spot.stacks[spot.hero]).toBeLessThanOrEqual(hi);
      if (s.kind === 'push') expect(spot.hero).toBe(spot.opener);
      else expect(spot.hero).toBeGreaterThan(spot.opener);
      const best = answer(s, true).g.best === 'play';
      const right = answer(s, best), wrong = answer(s, !best);
      expect(right.verdict).toBe('correct');
      expect(right.loss).toBe(0);
      expect(wrong.loss).toBeCloseTo(Math.abs(right.g.play - right.g.fold), 9);
      expect(wrong.verdict).toBe(verdictFor(wrong.loss));
      if (s.kind === 'call') {
        const need = equityNeeded(s.sol, spot.hero);
        if (Math.abs(right.g.equity - need) > 1e-6) expect(right.g.play > right.g.fold).toBe(right.g.equity > need);
      }
      tally = addAnswer(tally, wrong);
    }
    expect([...kinds].sort()).toEqual(['call', 'push', 'reshove']);
    expect(tally.spots).toBe(25);
    expect(tally.correct + tally.playable + tally.mistake).toBe(25);
    expect(parseTally(JSON.stringify(tally))).toEqual(tally);
    expect(parseTally('{"v":2}')).toEqual(emptyTally());
    expect(parseTally('not json')).toEqual(emptyTally());
  }, 60_000);
});

describe('tournament review cards', () => {
  const now = new Date('2026-10-12T03:00:00Z');
  const cardSpot = (s: SolvedSpot, played: boolean): TournamentCardSpot => ({
    kind: s.kind, stacks: s.spot.stacks, ante: s.spot.ante, mode: s.spot.mode, opener: s.spot.opener, hero: s.spot.hero, hand: s.spot.hand, played,
  });
  const mistake = (s: SolvedSpot, played: boolean) => ({ spot: cardSpot(s, played), where: 'Bubble, 9 players', label: 'Spot', hand: 'AhKd', you: 'Fold', heading: 'This is an all-in' });

  // Deal spots of every kind until each has a mistake to save.
  const mistakes: { s: SolvedSpot; played: boolean }[] = [];
  const rng = makeRng(21);
  for (const spots of ['pushfold', 'reshove'] as const) {
    for (const mode of ['chips', 'bubble'] as const) {
      let found = 0;
      for (let i = 0; i < 40 && found < 2; i++) {
        const s = dealSpot(rng, { players: 9, ante: true, mode, spots });
        for (const played of [true, false]) {
          if (answer(s, played).verdict === 'mistake') { mistakes.push({ s, played }); found++; }
        }
      }
    }
  }

  it('saves a mistake as a card that is due at once and survives saving and loading', () => {
    expect(mistakes.length).toBeGreaterThanOrEqual(6);
    const { s, played } = mistakes[0];
    const deck = addTournamentCard(emptyDeck(), mistake(s, played), now);
    expect(deck.cards).toHaveLength(1);
    const card = deck.cards[0];
    expect(isTournamentCard(card)).toBe(true);
    expect(dueCards(deck, now).map((c) => c.id)).toEqual([card.id]);
    expect(parseDeck(JSON.stringify(deck))).toEqual(deck);
    // A malformed tournament card is dropped when read back.
    const bad = { ...deck, cards: [{ ...card, t: { ...(card as TournamentCard).t, hero: 12 } }] };
    expect(parseDeck(JSON.stringify(bad)).cards).toHaveLength(0);
    // The same moment is not added twice, and a full deck takes no more.
    expect(addTournamentCard(deck, mistake(s, played), now)).toBe(deck);
  });

  it('deals the same spot again: the first answer is still a mistake and the best answer is correct', () => {
    const kinds = new Set<string>();
    for (const { s, played } of mistakes) {
      const t = cardSpot(s, played);
      const { played: _p, kind, ...spot } = t;
      const again = solveSpot(kind, spot);
      kinds.add(kind);
      const first = answer(again, played), was = answer(s, played);
      expect(first.verdict).toBe('mistake');
      expect(first.g.play).toBeCloseTo(was.g.play, 9);
      expect(first.g.fold).toBeCloseTo(was.g.fold, 9);
      expect(answer(again, first.g.best === 'play').verdict).toBe('correct');
    }
    expect(kinds.has('reshove')).toBe(true);
    expect(kinds.has('push') || kinds.has('call')).toBe(true);
  });

  it('schedules a tournament card like any other', () => {
    const { s, played } = mistakes[0];
    let deck = addTournamentCard(emptyDeck(), mistake(s, played), now);
    const id = deck.cards[0].id;
    deck = answerCard(deck, id, 'correct', now);
    expect(deck.cards[0].box).toBe(1);
    deck = answerCard(deck, id, 'mistake', now);
    expect(deck.cards[0].box).toBe(0);
    expect(deck.cards[0].lapses).toBe(1);
  });
});
