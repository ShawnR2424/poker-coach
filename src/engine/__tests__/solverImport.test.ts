import { afterEach, describe, expect, it } from 'vitest';
import { makeBackup, parseBackup } from '../backup/backup';
import { ACTIONS, builtInValue, continueProb, firstToActFreq, postflopOverrides, setPostflopOverrides } from '../postflop/model';
import {
  makePostflopPack, overridesFrom, parsePostflopPack, postflopPackText, readSolverReport,
  type ActFreq, type FacingFreq, type SolverSpot,
} from '../postflop/solverImport';

const BOARD = 'Ks7d2c';

afterEach(() => setPostflopOverrides({}));

describe('readSolverReport', () => {
  it('reads a first-to-act report by hand class, splitting bets at half pot', () => {
    const r = readSolverReport('Hand,Weight,Check,Bet 33%,Bet 75%\nKhKd,1,0.2,0.5,0.3\nAsAh,1,0.6,0.4,0', { label: 'c-bet', board: BOARD, kind: 'act' });
    expect(r.combos).toBe(2);
    expect(r.actions).toEqual(['Check', 'Bet 33%', 'Bet 75%']);
    expect(r.spot.classes.setPlus).toEqual({ w: 1, check: 0.2, small: 0.5, big: 0.3 });
    expect(r.spot.classes.overpair).toEqual({ w: 1, check: 0.6, small: 0.4, big: 0 });
    expect(r.spot.board).toBe('Ks7d2c');
  });

  it('reads percentages, tabs, hands that stand for several combos and a combos column', () => {
    const text = 'Hand\tCombos\tEV\tCheck\tBet 50\n"AA"\t6\t12.5\t25\t75\nKK\t3\t20\t0\t100';
    const r = readSolverReport(text, { label: '', board: BOARD, kind: 'act' });
    // KK has three combos left with the king of spades on the board.
    expect(r.combos).toBe(9);
    expect(r.ignored).toEqual(['EV']);
    const over = r.spot.classes.overpair as ActFreq;
    expect(over.w).toBeCloseTo(6);
    expect(over.small).toBeCloseTo(0.75);
    expect((r.spot.classes.setPlus as ActFreq).small).toBeCloseTo(1);
    expect(r.spot.label).toBe('Imported spot');
  });

  it('reads bet columns in chips when the pot is given', () => {
    const r = readSolverReport('Hand,Check,BET 2,BET 8\nAsAh,0,1,0\nAdAc,0,0,1', { label: 'x', board: BOARD, kind: 'act', pot: 10 });
    // 2 chips into 10 is a small bet; 8 into 10 is big.
    expect((r.spot.classes.overpair as ActFreq).small).toBeCloseTo(0.5);
    expect((r.spot.classes.overpair as ActFreq).big).toBeCloseTo(0.5);
  });

  it('reads a spot facing a bet, counting an all-in column as a raise', () => {
    const r = readSolverReport('Hand,Fold,Call,Allin\nAsAh,0.1,0.6,0.3\n6h5h,0.9,0.1,0', { label: 'x', board: BOARD, kind: 'facingBet', facingPct: 75 });
    expect(r.spot.f).toBe(0.75);
    expect(r.spot.classes.overpair).toEqual({ w: 1, fold: 0.1, call: 0.6, raise: 0.3 });
    expect((r.spot.classes.air as FacingFreq).fold).toBeCloseTo(0.9);
  });

  it('explains what is wrong with a report it cannot use', () => {
    const opts = { label: 'x', board: BOARD, kind: 'act' as const };
    expect(() => readSolverReport('AsAh,1,0', opts)).toThrow(/header row/);
    expect(() => readSolverReport('AsAh,0.5,0.5\nKhKd,1,0', opts)).toThrow(/name the columns/);
    expect(() => readSolverReport('Hand,Fold,Call\nAsAh,0,1', opts)).toThrow(/Facing a bet/);
    expect(() => readSolverReport('Hand,Check,Bet 50%\nZZ,0,1', opts)).toThrow(/Row 2: "ZZ"/);
    expect(() => readSolverReport('Hand,Check,Bet 50%\nAsAh,0,x', opts)).toThrow(/not a number/);
    expect(() => readSolverReport('Hand,Check,Bet 50%\nAsAh,0,1', { ...opts, board: 'Ks7d' })).toThrow(/three to five cards/);
    expect(() => readSolverReport('Hand,Fold,Call\nAsAh,0,1', { ...opts, kind: 'facingBet' })).toThrow(/size of the bet/);
    expect(() => readSolverReport('Hand,Check,Bet 50%\nKsKh,0,1', opts)).toThrow(/possible on this board/);
  });
});

const act = (w: number, small: number, big: number): ActFreq => ({ w, check: 1 - small - big, small, big });
const facing = (w: number, fold: number, raise: number): FacingFreq => ({ w, fold, call: 1 - fold - raise, raise });

describe('overridesFrom', () => {
  it('averages first-to-act spots by each class weight', () => {
    const spots: SolverSpot[] = [
      { label: 'a', board: BOARD, kind: 'act', classes: { air: act(3, 0.4, 0) } },
      { label: 'b', board: 'Ah8d3c', kind: 'act', classes: { air: act(1, 0, 0.4) } },
    ];
    const o = overridesFrom(spots);
    expect(o.firstToAct?.betSmall?.air).toBeCloseTo(0.3);
    expect(o.firstToAct?.betBig?.air).toBeCloseTo(0.1);
    expect(o.firstToAct?.betSmall?.setPlus).toBeUndefined();
    expect(o.leadIntoAggressor).toBeUndefined();
  });

  it('fits the continue line to two bet sizes and keeps the built-in slope with one', () => {
    const two = overridesFrom([
      { label: 'half', board: BOARD, kind: 'facingBet', f: 0.5, classes: { middlePair: facing(1, 0.2, 0.05) } },
      { label: 'pot', board: BOARD, kind: 'facingBet', f: 1, classes: { middlePair: facing(1, 0.4, 0.05) } },
    ]);
    expect(two.facingBet?.base?.middlePair).toBeCloseTo(1);
    expect(two.facingBet?.slope?.middlePair).toBeCloseTo(0.4);
    expect(two.facingBet?.raise?.middlePair).toBeCloseTo(0.05 / 0.7, 3);

    const one = overridesFrom([{ label: 'pot', board: BOARD, kind: 'facingBet', f: 1, classes: { weakPair: facing(1, 0.5, 0) } }]);
    const slope = builtInValue('facingBet', 'slope', 'weakPair');
    expect(one.facingBet?.slope?.weakPair).toBeCloseTo(slope);
    expect(one.facingBet?.base?.weakPair).toBeCloseTo(0.5 + slope);
  });

  it('uses an overbet only for the raise share', () => {
    const o = overridesFrom([{ label: 'shove', board: BOARD, kind: 'facingBet', f: 3, classes: { overpair: facing(1, 0.5, 0.25) } }]);
    expect(o.facingBet?.raise?.overpair).toBeCloseTo(0.5);
    expect(o.facingBet?.base).toBeUndefined();
  });

  it('turns a facing-raise spot into a share of the continue line', () => {
    const o = overridesFrom([
      { label: 'bet', board: BOARD, kind: 'facingBet', f: 0.5, classes: { topPairWeak: facing(1, 0.2, 0) } },
      { label: 'raised', board: BOARD, kind: 'facingRaise', f: 0.5, classes: { topPairWeak: facing(1, 0.6, 0) } },
    ]);
    // Continues 0.8 against a half-pot bet and 0.4 against a half-pot raise.
    expect(o.facingRaise?.continue?.topPairWeak).toBeCloseTo(0.5);
  });
});

describe('setPostflopOverrides', () => {
  it('changes what every reader of the tables sees, and puts the built-in values back', () => {
    const before = continueProb('middlePair', 0.5);
    const small = firstToActFreq('air').small;
    setPostflopOverrides({ facingBet: { base: { middlePair: 0.5 }, slope: { middlePair: 0 } }, firstToAct: { betSmall: { air: 0.6 } } });
    expect(continueProb('middlePair', 0.5)).toBeCloseTo(0.5);
    expect(firstToActFreq('air').small).toBeCloseTo(0.6);
    expect(ACTIONS.facingBet.base.setPlus).toBe(builtInValue('facingBet', 'base', 'setPlus'));
    expect(postflopOverrides().firstToAct?.betSmall?.air).toBe(0.6);
    setPostflopOverrides({});
    expect(continueProb('middlePair', 0.5)).toBeCloseTo(before);
    expect(firstToActFreq('air').small).toBeCloseTo(small);
  });
});

describe('postflop packs', () => {
  const spot = readSolverReport('Hand,Fold,Call,Raise 300%\nAsAh,0.1,0.6,0.3', { label: 'BB vs c-bet', board: BOARD, kind: 'facingBet', facingPct: 33 }).spot;

  it('round-trips through a file', () => {
    const pack = makePostflopPack('GTO Wizard NL50', [spot], new Date('2026-10-13T00:00:00Z'));
    const back = parsePostflopPack(postflopPackText(pack));
    expect(back).toEqual(pack);
    expect(overridesFrom(back.spots)).toEqual(overridesFrom([spot]));
  });

  it('refuses files that are not packs or do not add up', () => {
    expect(() => parsePostflopPack('nope')).toThrow(/not JSON/);
    expect(() => parsePostflopPack('{"app":"poker-coach-charts","v":1}')).toThrow(/not a Poker Coach postflop pack/);
    const bad = makePostflopPack('x', [{ ...spot, classes: { overpair: { w: 1, fold: 0.5, call: 0.6, raise: 0.3 } } }]);
    expect(() => parsePostflopPack(JSON.stringify(bad))).toThrow(/add up to 1.40/);
    const noSize = makePostflopPack('x', [{ ...spot, f: undefined }]);
    expect(() => parsePostflopPack(JSON.stringify(noSize))).toThrow(/bet faced/);
    const badClass = makePostflopPack('x', [{ ...spot, classes: { monster: { w: 1, fold: 0, call: 1, raise: 0 } } as never }]);
    expect(() => parsePostflopPack(JSON.stringify(badClass))).toThrow(/"monster" is not a hand class/);
  });

  it('are carried in backups, which refuse spots that do not check out', () => {
    const pack = makePostflopPack('Mine', [spot], new Date('2026-10-13T00:00:00Z'));
    const store: Record<string, string> = { 'custom-postflop:v1': JSON.stringify(pack) };
    const b = makeBackup((k) => store[k] ?? null);
    expect(parseBackup(JSON.stringify(b)).data['custom-postflop:v1']).toBe(store['custom-postflop:v1']);
    const bad = { ...b, data: { 'custom-postflop:v1': JSON.stringify({ ...pack, spots: [{ ...spot, kind: 'river' }] }) } };
    expect(() => parseBackup(JSON.stringify(bad))).toThrow('solver spots do not check out');
  });
});
