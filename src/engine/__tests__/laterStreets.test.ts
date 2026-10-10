// EV counts what a hand that is ahead wins on later streets, so a normal bet with a strong hand
// is not outscored by a shove that gets the whole stack in at once, and opponents keep calling
// a huge overbet with the hands that would call a big bet.

import { describe, expect, it } from 'vitest';
import { comboEquities } from '../equity';
import { advance, heroDecides, liveVillains, newGameHand } from '../game/levels';
import { applyAction, legalActions, type Action } from '../hand';
import { continueProb, laterStreetValue, PROFILES } from '../postflop/model';
import { narrowHand } from '../postflop/narrow';
import { botPostflopAction } from '../postflop/bot';
import { analyze, situationFromState } from '../postflop/recommend';
import { buildSpot, type PostflopSpotDef } from '../postflop/spots';
import { botAction } from '../preflop/policy';
import { makeRng } from '../rng';

const opts = { lowStakes: true };

describe('later-street value', () => {
  it('is zero on the river, when behind, and with nothing left to bet', () => {
    expect(laterStreetValue('river', 'topPairGood', 0.9, 1000, 5000)).toBe(0);
    expect(laterStreetValue('flop', 'topPairGood', 0.4, 1000, 5000)).toBe(0);
    expect(laterStreetValue('flop', 'topPairGood', 0.9, 1000, 0)).toBe(0);
  });

  it('grows with the edge and the streets left, and is capped by the stacks', () => {
    const flop = laterStreetValue('flop', 'topPairGood', 0.9, 1000, 50000);
    expect(flop).toBeGreaterThan(laterStreetValue('turn', 'topPairGood', 0.9, 1000, 50000));
    expect(flop).toBeGreaterThan(laterStreetValue('flop', 'topPairGood', 0.7, 1000, 50000));
    expect(laterStreetValue('flop', 'topPairGood', 1, 1000, 300)).toBeLessThanOrEqual(300);
  });

  it('comes only from hands that would call a later bet', () => {
    expect(laterStreetValue('flop', 'air', 0.95, 1000, 50000)).toBeLessThan(laterStreetValue('flop', 'topPairGood', 0.95, 1000, 50000) / 5);
  });
});

describe('overbets', () => {
  it('strong hands keep calling a huge overbet; weak hands give up', () => {
    for (const cls of ['overpair', 'topPairGood'] as const) expect(continueProb(cls, 15)).toBeGreaterThan(0.15);
    for (const cls of ['setPlus', 'twoPair'] as const) expect(continueProb(cls, 15)).toBe(1);
    for (const cls of ['weakPair', 'weakDraw', 'air'] as const) expect(continueProb(cls, 15)).toBeLessThan(0.02);
    // Up to the overbet size nothing changes.
    expect(continueProb('topPairWeak', 1)).toBeCloseTo(0.95 - 0.3, 9);
  });

  it('a flopped set on a dry board bets rather than shoving 100bb into a small pot', () => {
    const def: PostflopSpotDef = {
      id: 'set-dry', title: '', setup: '', concept: '', hero: 'BTN', villain: 'BB', heroCards: '7s7h', villainCards: 'KdQh',
      board: 'Kc7d2s 9h 4c', stacksBB: 100, answer: { best: [], mistakes: [] },
      script: [['BTN', { type: 'raise', to: 125 }], ['BB', { type: 'call' }], ['BB', { type: 'check' }]],
    };
    const sp = buildSpot(def);
    const sit = situationFromState(sp.state, sp.hero, sp.villain, sp.villainRange, { heroRange: sp.heroRange, heroPreflopAggressor: true });
    const a = analyze(sit, comboEquities(sit.hero, sit.board, sp.villainRange));
    expect(a.best.option.allIn).toBeFalsy();
  });

  it('a deep-stacked all-in is rarely the best play when first to act', () => {
    // Before later streets were counted this was about one decision in five.
    let deep = 0, shoves = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const rng = makeRng(seed * 31);
      const g = newGameHand(3, rng, opts);
      let s = advance(g, g.state, rng, opts);
      for (let t = 0; t < 12 && heroDecides(g, s); t++) {
        const live = liveVillains(g, s);
        if (s.street !== 'preflop' && live.length === 1 && legalActions(s).call === null) {
          const v = live[0];
          const profile = PROFILES[g.profiles[v]];
          const sit = situationFromState(s, g.hero, v, narrowHand(s, v, 'pool', opts, profile).range, { heroPreflopAggressor: false, villainProfile: profile });
          const a = analyze(sit, comboEquities(sit.hero, sit.board, sit.villainRange));
          if (a.facts.spr > 4) {
            deep++;
            if (a.best.option.allIn) shoves++;
          }
        }
        const act: Action = s.street === 'preflop' ? botAction(s, rng, opts) : botPostflopAction(s, rng, PROFILES.regular);
        s = advance(g, applyAction(s, act), rng, opts);
      }
    }
    expect(deep).toBeGreaterThan(100);
    expect(shoves / deep).toBeLessThan(0.13);
  }, 60_000);
});
