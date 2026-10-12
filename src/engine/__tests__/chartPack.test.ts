// Imported charts: solver and range-tool exports are read into the trainer's notation, every chart
// is checked before use, and an imported chart replaces the built-in one for every reader until it
// is removed.

import { afterEach, describe, expect, it } from 'vitest';
import { makeBackup, parseBackup } from '../backup/backup';
import { builtInEntry, CHARTS, classFrequencies, customCharts, getStrategy, isCustomChart, setCustomCharts, type SpotKind } from '../preflop/charts';
import {
  chartCount, checkChart, currentPack, makePack, normalizeRange, packText, parsePack, playedShare, withChart, withoutChart,
} from '../preflop/chartPack';
import { chartStrategy } from '../preflop/policy';
import { chartRaiseTo, type PreflopSpot } from '../preflop/spot';
import { parseRange } from '../range';

afterEach(() => setCustomCharts({}));

describe('reading exported ranges', () => {
  it('reads PioSOLVER, GTO+ and GTO Wizard style weights', () => {
    expect(normalizeRange('AA:1.0,KK:0.5,AKs: 0.25')).toBe('AA, KK:0.5, AKs:0.25');
    expect(normalizeRange('AA:100, KK:50%, QQ:25')).toBe('AA, KK:0.5, QQ:0.25');
  });

  it('reads line and semicolon separated lists and drops hands with no weight', () => {
    expect(normalizeRange('AA\nKK:0.5;\r\nQQ:0\n\nJJ')).toBe('AA, KK:0.5, JJ');
  });

  it('reads Flopzilla and HRC style groups', () => {
    expect(normalizeRange('AA, [50.0]AQo, KQo[/50.0], [25]A5s[/25]')).toBe('AA, AQo:0.5, KQo:0.5, A5s:0.25');
  });

  it('reads exact combos, spans and plus notation', () => {
    const r = parseRange(normalizeRange('AhKd:0.5, 77-55, A2s+'));
    const exact = parseRange('AhKd');
    const i = exact.indexOf(1);
    expect(r[i]).toBe(0.5);
    expect(r.reduce((n, w) => n + (w === 0.5 ? 1 : 0), 0)).toBe(1);
    expect(playedShare('77-55, A2s+')).toBeCloseTo((18 + 48) / 1326, 6);
  });

  it('names the part it cannot read', () => {
    expect(() => normalizeRange('AA, XY')).toThrow('"XY" is not a hand');
    expect(() => normalizeRange('AA:abc')).toThrow('weight that is not a number');
    expect(() => normalizeRange('AA:150')).toThrow('above 100%');
    expect(() => normalizeRange('[50]AQo')).toThrow('not closed');
  });
});

describe('checking a chart', () => {
  it('keeps the built-in size unless one is given, and a squeeze keeps its extra per caller', () => {
    expect(checkChart('rfi', 'BTN', { raise: 'AA' })).toEqual({ raise: 'AA', size: 2.5 });
    expect(checkChart('rfi', 'BTN', { raise: 'AA', size: 2.2 }).size).toBe(2.2);
    expect(checkChart('squeeze', 'IP', { raise: 'QQ+', call: 'JJ' })).toEqual({ raise: 'QQ+', call: 'JJ', size: 4, perCaller: 1 });
  });

  it('refuses ranges that raise and call more than all of a hand', () => {
    expect(() => checkChart('vsOpen', 'BB_vs_BTN', { raise: 'AA, KK:0.6', call: 'KK:0.5, QQ' })).toThrow('KK raise and call more than 100%');
    // Weights that add to exactly 1 are fine.
    expect(() => checkChart('vsOpen', 'BB_vs_BTN', { raise: 'KK:0.6', call: 'KK:0.4' })).not.toThrow();
  });

  it('refuses unknown charts, empty charts and impossible sizes', () => {
    expect(() => checkChart('rfi', 'MP7', { raise: 'AA' })).toThrow('no "MP7" chart');
    expect(() => checkChart('rfi', 'BTN', { raise: ' ', call: '' })).toThrow('both ranges are empty');
    expect(() => checkChart('rfi', 'BTN', { raise: 'AA', size: 'allin' })).toThrow('not all-in');
    expect(() => checkChart('rfi', 'BTN', { raise: 'AA', size: 0.5 })).toThrow('size must be');
    expect(() => checkChart('vs4bet', 'IP', { raise: 'AA', size: 2.2 })).toThrow('always all-in');
    expect(() => checkChart('rfi', 'SB', { raise: 'AA', call: 'KK' })).toThrow('opening charts are raise or fold');
  });
});

describe('chart packs', () => {
  it('every built-in chart passes the checks, so a saved pack of them reads back unchanged', () => {
    const pack = currentPack('Built in', new Date('2026-10-12T00:00:00Z'));
    const back = parsePack(packText(pack));
    expect(back.name).toBe('Built in');
    expect(chartCount(back.charts)).toBe(chartCount(pack.charts));
    for (const kind of Object.keys(CHARTS) as SpotKind[]) {
      for (const key of Object.keys(CHARTS[kind])) {
        const a = getStrategy(kind, key);
        setCustomCharts(back.charts);
        const b = getStrategy(kind, key);
        setCustomCharts({});
        expect(Array.from(b.raise)).toEqual(Array.from(a.raise));
        expect(Array.from(b.call)).toEqual(Array.from(a.call));
        expect(b.entry.size).toEqual(a.entry.size);
      }
    }
  });

  it('refuses files that are not chart packs, naming the chart at fault', () => {
    expect(() => parsePack('nope')).toThrow('not JSON');
    expect(() => parsePack('{"app":"poker-coach"}')).toThrow('not a Poker Coach chart pack');
    expect(() => parsePack('{"app":"poker-coach-charts","v":2,"charts":{}}')).toThrow('version 2');
    expect(() => parsePack('{"app":"poker-coach-charts","v":1,"charts":{}}')).toThrow('holds no charts');
    expect(() => parsePack('{"app":"poker-coach-charts","v":1,"charts":{"limps":{"BTN":{"raise":"AA"}}}}')).toThrow('"limps" is not a kind');
    expect(() => parsePack('{"app":"poker-coach-charts","v":1,"charts":{"vsOpen":{"BB_vs_BTN":{"raise":"AA","call":"AA:0.5"}}}}')).toThrow('BB facing a BTN open: AA raise and call');
  });

  it('adds and removes single charts', () => {
    let set = withChart({}, 'rfi', 'BTN', { raise: 'AA', size: 2.5 });
    set = withChart(set, 'rfi', 'CO', { raise: 'KK', size: 2.5 });
    expect(chartCount(set)).toBe(2);
    set = withoutChart(set, 'rfi', 'BTN');
    expect(Object.keys(set.rfi!)).toEqual(['CO']);
    expect(withoutChart(set, 'rfi', 'CO')).toEqual({});
  });
});

describe('playing imported charts', () => {
  const btnOpen = { kind: 'rfi', key: 'BTN', player: 0, position: 'BTN', aggressor: null, raiseTos: [], callers: 0, limpers: 0 } as unknown as PreflopSpot;

  it('replaces the chart for the recommendations and the opponents, sizes included', () => {
    setCustomCharts({ rfi: { BTN: { raise: 'AA, 72o:0.5', size: 2.2 } } });
    expect(isCustomChart('rfi', 'BTN')).toBe(true);
    expect(isCustomChart('rfi', 'CO')).toBe(false);
    for (const audience of ['hero', 'pool'] as const) {
      const s = chartStrategy('rfi', 'BTN', audience, { lowStakes: false, stacksBB: 100 });
      expect(classFrequencies(s, 'AA').raise).toBe(1);
      expect(classFrequencies(s, '72o').raise).toBe(0.5);
      expect(classFrequencies(s, 'KK').fold).toBe(1);
    }
    expect(chartRaiseTo(btnOpen, 1, false, 'hero')).toBeCloseTo(2.2);
    // Other charts stay built in.
    expect(classFrequencies(getStrategy('rfi', 'CO'), 'KK').raise).toBe(1);
  });

  it('applies the stack depth layer on top of an imported chart', () => {
    setCustomCharts({ rfi: { BTN: { raise: '22+, 54s', size: 2.5 } } });
    const at40 = getStrategy('rfi', 'BTN', 'baseline', false, 40);
    expect(at40.key).toBe('BTN');
    expect(classFrequencies(at40, 'AA').raise).toBe(1);
  });

  it('puts every built-in chart back when the imports are cleared', () => {
    setCustomCharts({ rfi: { BTN: { raise: 'AA', size: 2.5 } } });
    setCustomCharts({});
    expect(CHARTS.rfi.BTN).toBe(builtInEntry('rfi', 'BTN'));
    expect(customCharts()).toEqual({});
    expect(classFrequencies(getStrategy('rfi', 'BTN'), 'K2s').raise).toBe(1);
  });

  it('ignores charts the trainer has no spot for', () => {
    setCustomCharts({ rfi: { MP7: { raise: 'AA' } } } as never);
    expect(CHARTS.rfi.MP7).toBeUndefined();
    expect(customCharts()).toEqual({});
  });
});

describe('backups', () => {
  it('carry imported charts and refuse ones that do not check out', () => {
    const pack = makePack('Mine', { rfi: { BTN: { raise: 'AA', size: 2.5 } } }, new Date('2026-10-12T00:00:00Z'));
    const store: Record<string, string> = { 'custom-charts:v1': JSON.stringify(pack) };
    const b = makeBackup((k) => store[k] ?? null);
    expect(parseBackup(JSON.stringify(b)).data['custom-charts:v1']).toBe(store['custom-charts:v1']);
    const bad = { ...b, data: { 'custom-charts:v1': JSON.stringify({ ...pack, charts: { rfi: { BTN: { raise: 'XX' } } } }) } };
    expect(() => parseBackup(JSON.stringify(bad))).toThrow('imported charts do not check out');
  });
});
