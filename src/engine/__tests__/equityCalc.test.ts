import { describe, expect, it } from 'vitest';
import { parseCards } from '../cards';
import { calcEquity, parseBoard, parseHolding } from '../calc/equityCalc';
import { computeEquity } from '../equity';
import { parseRange } from '../range';
import { chartPresets } from '../../ui/equity/presets';

const calc = (players: string[], board = '', opts: { dead?: string; samples?: number; allowExact?: boolean } = {}) =>
  calcEquity({
    players: players.map((p) => parseHolding(p).range),
    board: parseCards(board),
    dead: parseCards(opts.dead ?? ''),
    samples: opts.samples ?? 60_000,
    seed: 5,
    allowExact: opts.allowExact,
  });

describe('equity calculator', () => {
  it('reads hands, ranges and "random"', () => {
    expect(parseHolding('Ah Kd').kind).toBe('hand');
    const r = parseHolding('QQ+, AKs');
    expect(r.kind).toBe('range');
    expect(r.range.reduce((a, w) => a + w, 0)).toBe(22);
    const any = parseHolding('random');
    expect(any.kind === 'range' && any.random).toBe(true);
    expect(any.range.reduce((a, w) => a + w, 0)).toBe(1326);
    expect(() => parseHolding('')).toThrow();
    expect(() => parseHolding('AX')).toThrow();
    expect(() => parseBoard('AhKd')).toThrow(/0, 3, 4 or 5/);
  });

  it('enumerates two exact hands preflop exactly', () => {
    // Published: AhAs against KhKs 82.6%; against KdKc 81.2%.
    const same = calc(['AhAs', 'KhKs']);
    expect(same.exact).toBe(true);
    expect(same.players[0].equity).toBeCloseTo(0.8264, 3);
    const off = calc(['AhAs', 'KdKc']);
    expect(off.players[0].equity).toBeCloseTo(0.8122, 3);
    expect(off.players[0].equity + off.players[1].equity).toBeCloseTo(1, 9);
  });

  it('agrees with the hero-against-ranges engine', () => {
    const a = calc(['AhKh', 'JJ+, AQs+'], 'Kc7d2h');
    const b = computeEquity({ hero: parseCards('AhKh'), board: parseCards('Kc7d2h'), villains: [parseRange('JJ+, AQs+')] });
    expect(a.exact).toBe(true);
    expect(a.players[0].equity).toBeCloseTo(b.equity, 9);
    expect(a.players[0].tie).toBeCloseTo(b.tie, 9);
  });

  it('samples range against range, and the sample agrees with exact enumeration', () => {
    const exact = calc(['AhKh', 'QQ-TT', '99-77'], 'Kc7d2h');
    const sampled = calc(['AhKh', 'QQ-TT', '99-77'], 'Kc7d2h', { allowExact: false, samples: 80_000 });
    expect(exact.exact).toBe(true);
    expect(sampled.exact).toBe(false);
    exact.players.forEach((p, i) => {
      expect(Math.abs(p.equity - sampled.players[i].equity)).toBeLessThan(4 * sampled.players[i].stderr + 1e-3);
    });
    const total = sampled.players.reduce((a, p) => a + p.equity, 0);
    expect(total).toBeCloseTo(1, 9);
  });

  it('is symmetric: a range against itself splits the pot evenly', () => {
    const r = calc(['QQ+, AKs', 'QQ+, AKs']);
    expect(r.exact).toBe(false);
    expect(Math.abs(r.players[0].equity - 0.5)).toBeLessThan(4 * r.players[0].stderr);
  });

  it('removes dead cards and board cards from the ranges', () => {
    const r = calc(['AA', 'KK'], 'Ah7c2d', { dead: 'Ks' });
    expect(r.players[0].combos).toBe(3);
    expect(r.players[1].combos).toBe(3);
    // Four players with exact hands on the turn: enumerated, shares add to 1.
    const four = calc(['AsAd', 'KsKd', 'QsQd', 'JsJd'], '2c7h9c3h');
    expect(four.exact).toBe(true);
    expect(four.players.reduce((a, p) => a + p.equity, 0)).toBeCloseTo(1, 9);
    expect(four.players[0].equity).toBeGreaterThan(four.players[3].equity);
  });

  it('rejects hands that cannot be dealt together', () => {
    expect(() => calc(['AhKd', 'AhQs'])).toThrow(/Ah is in the hands of players 1 and 2/);
    expect(() => calc(['AA', 'KK'], 'AhAdAc', { dead: 'As' })).toThrow(/Player 1 has no hands left/);
    expect(() => calc(['AhKd', 'QQ'], 'Ah7c2d')).toThrow(/Player 1 has no hands left/);
    expect(() => calc(['AhKd'])).toThrow(/2 to 4 players/);
  });

  it('offers the trainer charts as ranges', () => {
    const presets = chartPresets();
    expect(presets.some((p) => p.group === 'Opens')).toBe(true);
    expect(presets.some((p) => p.group === '3-bets')).toBe(true);
    expect(presets.some((p) => p.group === 'Calls')).toBe(true);
    for (const p of presets) expect(() => parseHolding(p.text)).not.toThrow();
  });
});
