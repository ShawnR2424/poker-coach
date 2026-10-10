import { describe, expect, it } from 'vitest';
import { advance, heroDecides, liveVillains, newGameHand, profileOf, type LevelId } from '../game/levels';
import { applyAction, legalActions, type Action, type HandState } from '../hand';
import { botPostflopAction } from '../postflop/bot';
import { PROFILES } from '../postflop/model';
import { narrowHand } from '../postflop/narrow';
import { chartDepth, CHARTS, classFrequencies, DEPTHS, depthRules, getStrategy, type Depth, type SpotKind } from '../preflop/charts';
import { conceptFor } from '../preflop/coach';
import { botAction } from '../preflop/policy';
import { generatePreflopScenario } from '../preflop/scenario';
import { chartRaiseTo, spotFor } from '../preflop/spot';
import { comboIndex, parseRange } from '../range';
import { makeRng } from '../rng';

const freq = (kind: SpotKind, key: string, hand: string, depth: Depth, audience: 'baseline' | 'hero' | 'pool' = 'baseline') =>
  classFrequencies(getStrategy(kind, key, audience, true, depth), hand as Parameters<typeof classFrequencies>[1]);

describe('chart depth', () => {
  it('picks the nearest chart for the table stacks', () => {
    expect(chartDepth()).toBe(100);
    expect(chartDepth(40)).toBe(40);
    expect(chartDepth(60)).toBe(40);
    expect(chartDepth(100)).toBe(100);
    expect(chartDepth(150)).toBe(200);
    expect(chartDepth(200)).toBe(200);
  });

  it('leaves the 100bb charts exactly as written', () => {
    for (const kind of Object.keys(CHARTS) as SpotKind[]) {
      for (const key of Object.keys(CHARTS[kind])) {
        const s = getStrategy(kind, key, 'baseline', false, 100);
        expect([...s.raise]).toEqual([...parseRange(CHARTS[kind][key].raise)]);
        expect(s.notes).toEqual([]);
      }
    }
  });

  it('keeps every strategy a valid split of each hand at every depth', () => {
    for (const depth of DEPTHS) {
      for (const kind of Object.keys(CHARTS) as SpotKind[]) {
        for (const key of Object.keys(CHARTS[kind])) {
          for (const audience of ['baseline', 'hero', 'pool'] as const) {
            const s = getStrategy(kind, key, audience, true, depth);
            let bad = 0;
            for (let i = 0; i < s.raise.length; i++) {
              if (s.raise[i] < 0 || s.call[i] < 0 || s.raise[i] + s.call[i] > 1 + 1e-6) bad++;
            }
            expect(bad, `${depth}bb ${kind} ${key} ${audience}`).toBe(0);
          }
        }
      }
    }
  });

  it('every depth rule parses and changes at least one chart', () => {
    for (const depth of [40, 200] as Depth[]) {
      for (const rule of depthRules(depth)) {
        expect(parseRange(rule.hands).some((w) => w > 0), rule.hands).toBe(true);
        const changed = Object.keys(CHARTS[rule.spot]).some((key) => getStrategy(rule.spot, key, 'baseline', false, depth).notes.includes(rule.note));
        expect(changed, `${depth}bb ${rule.spot}: ${rule.note}`).toBe(true);
      }
    }
  });

  it('plays speculative hands less at 40bb and more at 200bb', () => {
    const call = (hand: string, d: Depth) => freq('vsOpen', 'BTN_vs_CO', hand, d).call;
    expect(call('55', 40)).toBeLessThan(call('55', 100));
    expect(call('76s', 40)).toBeLessThan(call('76s', 100));
    expect(freq('vsOpen', 'CO_vs_EP', '33', 200).call).toBeGreaterThan(freq('vsOpen', 'CO_vs_EP', '33', 100).call);
    expect(freq('rfi', 'UTG', '22', 40).raise).toBeLessThan(freq('rfi', 'UTG', '22', 100).raise);
  });

  it('gets strong hands in sooner at 40bb and pots them up less at 200bb', () => {
    expect(freq('vs3bet', 'CO_vs_IP', 'JJ', 40).raise).toBeGreaterThan(freq('vs3bet', 'CO_vs_IP', 'JJ', 100).raise);
    expect(freq('vs3bet', 'CO_vs_IP', 'QQ', 200).raise).toBeLessThan(freq('vs3bet', 'CO_vs_IP', 'QQ', 100).raise);
    expect(freq('vs4bet', 'IP', 'JJ', 200).call).toBeLessThan(freq('vs4bet', 'IP', 'JJ', 100).call);
    // Facing an all-in 4-bet there is nothing left to raise.
    for (const key of Object.keys(CHARTS.vs4bet)) {
      expect(Math.max(...getStrategy('vs4bet', key, 'hero', true, 40).raise)).toBe(0);
      expect(freq('vs4bet', key, 'AA', 40, 'hero').call).toBe(1);
    }
  });

  it('sizes raises for the stack depth', () => {
    const at = (stacksBB: number) => {
      for (let seed = 1; ; seed++) {
        const g = generatePreflopScenario(makeRng(seed), { lowStakes: true, stacksBB, mix: { vs3bet: 1 } });
        const spot = spotFor(g.state, g.hero);
        if (spot.kind === 'vs3bet') return { g, spot };
      }
    };
    const { g, spot } = at(100);
    expect(spot.kind).toBe('vs3bet');
    const bb = g.state.config.bb;
    expect(chartRaiseTo(spot, bb, true, 'hero', 40)).toBe(Infinity);
    expect(chartRaiseTo(spot, bb, true, 'hero', 200)).toBeCloseTo(chartRaiseTo(spot, bb, true, 'hero', 100) * 1.1, 6);
    for (let seed = 1; seed <= 30; seed++) {
      const rfi = generatePreflopScenario(makeRng(seed), { lowStakes: true, mix: { rfi: 1 } });
      const rs = spotFor(rfi.state, rfi.hero);
      if (rs.kind !== 'rfi') continue;
      expect(chartRaiseTo(rs, bb, true, 'hero', 40)).toBeCloseTo(2.2 * bb, 6);
      expect(chartRaiseTo(rs, bb, true, 'hero', 200)).toBe(chartRaiseTo(rs, bb, true, 'hero', 100));
    }
    expect(at(40).g.state.players.every((p) => p.stack + p.committed === 40 * bb)).toBe(true);
  });

  it('explains a 4-bet in terms of the stack depth', () => {
    expect(conceptFor('vs4bet', 100)).toContain('100bb');
    expect(conceptFor('vs4bet', 40)).toContain('all-in');
    expect(conceptFor('vs4bet', 200)).toContain('200bb');
  });
});

/** Plays hands at a depth; the read always holds every villain's real hand. */
function playAt(stacksBB: number, level: LevelId, seeds: number) {
  const opts = { lowStakes: true, stacksBB };
  let checks = 0, finished = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    const rng = makeRng(seed * 7717 + level + stacksBB);
    const g = newGameHand(level, rng, opts);
    expect(g.state.players.every((p) => p.stack + p.committed === stacksBB * g.state.config.bb)).toBe(true);
    let s: HandState = advance(g, g.state, rng, opts);
    for (let t = 0; t < 30 && heroDecides(g, s); t++) {
      for (const v of liveVillains(g, s)) {
        const { range } = narrowHand(s, v, 'pool', opts, profileOf(g, v));
        const [a, b] = s.players[v].hole;
        expect(range[comboIndex(a, b)], `${stacksBB}bb level ${level} seed ${seed}: villain hand missing from read`).toBeGreaterThan(0);
        checks++;
      }
      const legal = legalActions(s);
      const a: Action = s.street === 'preflop' ? botAction(s, rng, opts) : botPostflopAction(s, rng, PROFILES.regular);
      expect(a.type === 'check' ? legal.check : true).toBe(true);
      s = advance(g, applyAction(s, a), rng, opts);
    }
    if (s.result) {
      finished++;
      expect(s.result.net.reduce((x, y) => x + y, 0)).toBe(0);
    }
  }
  return { checks, finished };
}

describe('hands at other depths', () => {
  for (const stacksBB of [40, 200]) {
    it(`at ${stacksBB}bb, hands at levels 3-5 finish and the read holds the real hand`, () => {
      for (const level of [3, 4, 5] as LevelId[]) {
        const { checks, finished } = playAt(stacksBB, level, 40);
        expect(checks).toBeGreaterThan(20);
        expect(finished).toBe(40);
      }
    }, 60_000);
  }
});
