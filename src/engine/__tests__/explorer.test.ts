// The chart explorer shows exactly the charts the trainer plays: every chart has a plain name and
// a size, every option combination gives a valid strategy, and the changed hands are the ones
// the depth, rake and low-stakes layers moved.

import { describe, expect, it } from 'vitest';
import { CHARTS, DEPTHS, getStrategy, type SpotKind } from '../preflop/charts';
import {
  baseStrategy, CHART_KINDS, chartKeys, changesFrom, choiceNames, rangeTexts, shares, sizeText, exploreStrategy, type ExploreOptions,
} from '../preflop/explorer';
import { chartStrategy } from '../preflop/policy';
import { chartRaiseTo, type PreflopSpot } from '../preflop/spot';
import { NUM_COMBOS, parseRange } from '../range';

const ALL_OPTIONS: ExploreOptions[] = DEPTHS.flatMap((depth) =>
  (['hero', 'pool'] as const).flatMap((audience) =>
    [false, true].flatMap((lowStakes) => [false, true].map((raked) => ({ audience, lowStakes, depth, raked })))));
const PLAIN: ExploreOptions = { audience: 'hero', lowStakes: false, depth: 100, raked: false };

describe('chart list', () => {
  it('covers every chart kind once, with every chart named in plain words', () => {
    expect(CHART_KINDS.map((k) => k.kind).sort()).toEqual((Object.keys(CHARTS) as SpotKind[]).sort());
    for (const { kind } of CHART_KINDS) {
      const keys = chartKeys(kind);
      expect(keys.map((k) => k.key)).toEqual(Object.keys(CHARTS[kind]));
      expect(new Set(keys.map((k) => k.label)).size).toBe(keys.length);
      for (const k of keys) {
        expect(k.label).not.toMatch(/undefined|_vs_|\bIP\b/);
        for (const o of ALL_OPTIONS) expect(sizeText(kind, k.key, o)).toMatch(/^(all-in|\d)/);
      }
    }
    expect(chartKeys('vsOpen').find((k) => k.key === 'BB_vs_BTN')!.label).toBe('BB facing a BTN open');
    expect(choiceNames('vsLimp', 'BB').fold).toBe('check');
    expect(choiceNames('vs3bet', 'CO_vs_IP').raise).toBe('4-bet');
  });

  it('states the size the trainer actually raises to', () => {
    const spot = { kind: 'rfi', key: 'BTN', position: 'BTN', raiseTos: [], callers: 0, limpers: 0 } as unknown as PreflopSpot;
    for (const depth of DEPTHS) {
      const bb = chartRaiseTo(spot, 50, false, 'hero', depth) / 50;
      expect(sizeText('rfi', 'BTN', { ...PLAIN, depth })).toBe(`${+bb.toFixed(2)}bb`);
    }
    expect(sizeText('vs4bet', 'IP', PLAIN)).toBe('all-in');
    expect(sizeText('vs3bet', 'CO_vs_IP', { ...PLAIN, depth: 40 })).toBe('all-in');
  });
});

describe('strategies', () => {
  it('match the trainer\'s own chart lookup and stay valid under every option', () => {
    for (const { kind } of CHART_KINDS) {
      for (const { key } of chartKeys(kind)) {
        for (const o of ALL_OPTIONS) {
          const s = exploreStrategy(kind, key, o);
          const rake = o.raked ? { pct: 0.05, capBB: 3 } : undefined;
          expect(s).toBe(chartStrategy(kind, key, o.audience, { lowStakes: o.lowStakes, stacksBB: o.depth, rake }));
          let over = 0;
          for (let i = 0; i < NUM_COMBOS; i++) if (s.raise[i] + s.call[i] > 1 + 1e-6 || s.raise[i] < 0 || s.call[i] < 0) over++;
          expect(over, `${kind} ${key}`).toBe(0);
          const sh = shares(s);
          expect(sh.raise + sh.call + sh.fold).toBeCloseTo(1, 9);
          expect(sh.fold).toBeGreaterThanOrEqual(-1e-9);
        }
      }
    }
  });

  it('writes ranges that parse back to the chart', () => {
    for (const { kind } of CHART_KINDS) {
      for (const { key } of chartKeys(kind)) {
        const s = exploreStrategy(kind, key, PLAIN);
        const t = rangeTexts(s);
        const raise = parseRange(t.raise), call = parseRange(t.call);
        let off = 0;
        for (let i = 0; i < NUM_COMBOS; i++) if (Math.abs(raise[i] - s.raise[i]) > 0.005 || Math.abs(call[i] - s.call[i]) > 0.005) off++;
        expect(off, `${kind} ${key}`).toBe(0);
      }
    }
  });
});

describe('changed hands', () => {
  it('are none for the plain chart, and exactly the moved hands under a layer', () => {
    for (const { kind } of CHART_KINDS) {
      for (const { key } of chartKeys(kind)) {
        const base = baseStrategy(kind, key);
        expect(changesFrom(base, exploreStrategy(kind, key, PLAIN))).toEqual([]);
        for (const o of ALL_OPTIONS) {
          const s = exploreStrategy(kind, key, o);
          // A layer that left notes changed some hands; no notes means nothing moved.
          if (!s.notes.length) expect(changesFrom(base, s, 1e-6)).toEqual([]);
        }
      }
    }
  });

  it('shows the rake tightening the big blind\'s defense against the button', () => {
    const o: ExploreOptions = { ...PLAIN, raked: true };
    const s = exploreStrategy('vsOpen', 'BB_vs_BTN', o);
    const changed = changesFrom(baseStrategy('vsOpen', 'BB_vs_BTN'), s);
    expect(changed.length).toBeGreaterThan(10);
    expect(changed.every((c) => c.after.fold >= c.before.fold - 1e-9)).toBe(true);
    expect(shares(s).fold).toBeGreaterThan(shares(getStrategy('vsOpen', 'BB_vs_BTN', 'hero', false, 100, false)).fold);
  });
});
