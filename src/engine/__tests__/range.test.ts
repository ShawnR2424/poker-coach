import { describe, expect, it } from 'vitest';
import { parseCards } from '../cards';
import {
  ALL_CLASSES, CLASS_COMBOS, NUM_COMBOS, cellOf, classAt, classCounts, comboCount,
  formatRange, parseRange, removeDead,
} from '../range';

const classesIn = (text: string) =>
  ALL_CLASSES.filter((c) => CLASS_COMBOS.get(c)!.some((i) => parseRange(text)[i] > 0));

describe('hand classes and grid', () => {
  it('has 169 classes covering all 1326 combos exactly once', () => {
    expect(ALL_CLASSES.length).toBe(169);
    const seen = new Set<number>();
    for (const c of ALL_CLASSES) for (const i of CLASS_COMBOS.get(c)!) seen.add(i);
    expect(seen.size).toBe(NUM_COMBOS);
    expect(CLASS_COMBOS.get('AA')!.length).toBe(6);
    expect(CLASS_COMBOS.get('AKs')!.length).toBe(4);
    expect(CLASS_COMBOS.get('AKo')!.length).toBe(12);
  });

  it('puts pairs on the diagonal, suited above, offsuit below', () => {
    expect(classAt(0, 0)).toBe('AA');
    expect(classAt(12, 12)).toBe('22');
    expect(classAt(0, 1)).toBe('AKs');
    expect(classAt(1, 0)).toBe('AKo');
    expect(classAt(3, 8)).toBe('J6s');
    for (let r = 0; r < 13; r++) for (let c = 0; c < 13; c++) {
      expect(cellOf(classAt(r, c))).toEqual([r, c]);
    }
  });
});

describe('parseRange', () => {
  it.each([
    ['22+', 78],
    ['ATs+', 16],
    ['KQo', 12],
    ['AK', 16],
    ['77-55', 18],
    ['A5s-A2s', 16],
    ['KTo+', 36],
    ['AsKs', 1],
    ['AKo:0.5', 6],
    ['22+, A2s+, K9s+, QTs+, JTs, ATo+, KJo+', 78 + 48 + 16 + 8 + 4 + 48 + 24],
  ])('%s has %d combos', (text, n) => {
    expect(comboCount(parseRange(text))).toBeCloseTo(n, 5);
  });

  it('expands plus notation to exactly the expected classes', () => {
    expect(classesIn('ATs+').sort()).toEqual(['AJs', 'AKs', 'AQs', 'ATs']);
    expect(classesIn('TT+').sort()).toEqual(['AA', 'JJ', 'KK', 'QQ', 'TT']);
    expect(classesIn('K9o-K7o').sort()).toEqual(['K7o', 'K8o', 'K9o']);
  });

  it('rejects malformed tokens', () => {
    for (const bad of ['AAs', 'AK+-', 'A5s-K2s', 'Ax', 'AKs:2', 'AsAs']) {
      expect(() => parseRange(bad)).toThrow();
    }
  });
});

describe('formatRange round trip', () => {
  const samples = [
    '22+, A2s+, K9s+, QTs+, JTs, ATo+, KJo+',
    '77-55, A5s-A2s, KQo',
    'QQ+, AKs, AKo:0.5, A5s:0.25',
    'AsKs, AhKh, 99',
    '33, 55, 77, AQs, A9s, KTo-K8o',
  ];
  it.each(samples)('%s survives text -> range -> text -> range', (text) => {
    const a = parseRange(text);
    const b = parseRange(formatRange(a));
    expect(Array.from(b)).toEqual(Array.from(a));
  });

  it('compresses to standard notation', () => {
    expect(formatRange(parseRange('AA, KK, QQ, JJ'))).toBe('JJ+');
    expect(formatRange(parseRange('AKs, AQs, AJs'))).toBe('AJs+');
    expect(formatRange(parseRange('A5s, A4s, A3s'))).toBe('A5s-A3s');
  });
});

describe('card removal', () => {
  it('removes combos that use dead cards', () => {
    const r = parseRange('AKs, AA');
    const dead = parseCards('AsKd');
    // AKs loses AsKs and AdKd; AA loses every combo with the As.
    expect(comboCount(removeDead(r, dead))).toBe(2 + 3);
    const counts = classCounts(r, dead);
    expect(counts.get('AKs')).toEqual({ combos: 2, available: 2, base: 4 });
    expect(counts.get('AA')).toEqual({ combos: 3, available: 3, base: 6 });
    expect(counts.get('KK')).toEqual({ combos: 0, available: 3, base: 0 });
  });

  it('per-class counts sum to the whole-range count on random boards', () => {
    const r = parseRange('22+, A2s+, K9s+, QTs+, JTs, ATo+, KJo+, 76s:0.5');
    const dead = parseCards('Ah7s7d2c');
    const total = [...classCounts(r, dead).values()].reduce((a, c) => a + c.combos, 0);
    expect(total).toBeCloseTo(comboCount(removeDead(r, dead)), 4);
  });
});
