// A range facing a bet or a raise defends close to the minimum defense frequency, so neither
// betting nor raising with nothing turns a profit on its own, and the best play bets and raises
// at steadier rates than when opponents folded every weak hand.

import { beforeAll, describe, expect, it } from 'vitest';
import { comboEquities } from '../equity';
import { advance, heroDecides, liveVillains, newGameHand, profileOf } from '../game/levels';
import { applyAction, legalActions, type Action, type HandState } from '../hand';
import { botPostflopAction } from '../postflop/bot';
import type { PostflopClass } from '../postflop/classify';
import { ACTIONS, continueProb, PROFILES, rangeDefense, responseFor } from '../postflop/model';
import { narrowHand } from '../postflop/narrow';
import { analyze, situationFromState } from '../postflop/recommend';
import { botAction } from '../preflop/policy';
import { makeRng } from '../rng';

const opts = { lowStakes: true };
const reg = PROFILES.regular;

/** Share of a range of classes (equal weights) that continues facing `f`. */
function defended(classes: PostflopClass[], f: number, beingRaised: boolean, profile = reg): number {
  const d = rangeDefense(classes, classes.map(() => 1), f, beingRaised, profile);
  return classes.reduce((t, c) => t + continueProb(c, f, beingRaised, profile, d), 0) / classes.length;
}

describe('range defense floor', () => {
  it('leaves a range that already defends enough alone', () => {
    expect(rangeDefense(['setPlus', 'overpair', 'topPairGood'], [1, 1, 1], 0.5)).toBe(1);
  });

  it('lifts a wide range to the minimum defense frequency', () => {
    const wide: PostflopClass[] = ['topPairWeak', 'middlePair', 'weakPair', 'weakPair', 'weakDraw', 'air'];
    for (const f of [0.33, 0.75]) {
      const table = wide.reduce((t, c) => t + continueProb(c, f), 0) / wide.length;
      const target = ACTIONS.facingBet.defend / (1 + f);
      expect(table, `f=${f}`).toBeLessThan(target);
      expect(defended(wide, f, false)).toBeCloseTo(target, 6);
    }
  });

  it('takes the extra defense from pairs and draws, not air', () => {
    const wide: PostflopClass[] = ['middlePair', 'weakPair', 'weakDraw', 'air', 'air'];
    const d = rangeDefense(wide, wide.map(() => 1), 0.33);
    expect(d).toBeGreaterThan(1);
    expect(d).toBeLessThanOrEqual(ACTIONS.facingBet.maxBoost);
    const gain = (c: PostflopClass) => continueProb(c, 0.33, false, reg, d) - continueProb(c, 0.33);
    expect(gain('weakPair')).toBeGreaterThan(gain('air'));
    expect(continueProb('air', 0.33, false, reg, d)).toBeLessThan(0.5);
  });

  it('keeps a raised range of small bets from folding like the class table alone', () => {
    const bets: PostflopClass[] = ['topPairGood', 'topPairWeak', 'middlePair', 'weakPair', 'strongDraw', 'weakDraw'];
    const f = 0.32;
    const table = bets.reduce((t, c) => t + continueProb(c, f, true), 0) / bets.length;
    expect(defended(bets, f, true)).toBeGreaterThan(table);
    expect(defended(bets, f, true)).toBeCloseTo(ACTIONS.facingRaise.defend / (1 + f), 6);
  });

  it('follows the opponent style: a nit still overfolds, a station defends more', () => {
    const wide: PostflopClass[] = ['middlePair', 'weakPair', 'weakPair', 'weakDraw', 'air'];
    expect(defended(wide, 0.5, false, PROFILES.nit)).toBeLessThan(defended(wide, 0.5, false, reg));
    expect(defended(wide, 0.5, false, PROFILES.station)).toBeGreaterThan(defended(wide, 0.5, false, reg));
  });

  it('keeps every response a valid split', () => {
    for (const d of [1, 2, ACTIONS.facingBet.maxBoost]) {
      for (const c of Object.keys(ACTIONS.facingBet.base) as PostflopClass[]) {
        const r = responseFor(c, 0.5, true, true, reg, d);
        expect(r.fold).toBeGreaterThanOrEqual(0);
        expect(r.call).toBeGreaterThanOrEqual(0);
        expect(r.fold + r.call + r.raise).toBeCloseTo(1, 9);
      }
    }
  });
});

/** The trainer's best kind at each heads-up postflop hero decision of level 3 hands. */
function sample(seeds: number) {
  const facing: string[] = [], open: string[] = [];
  let raiseFold = 0, raiseBreakEven = 0, raises = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    const rng = makeRng(seed);
    const g = newGameHand(3, rng, opts);
    let s: HandState = advance(g, g.state, rng, opts);
    for (let t = 0; t < 12 && heroDecides(g, s); t++) {
      const live = liveVillains(g, s);
      if (s.street !== 'preflop' && live.length === 1) {
        const v = live[0];
        const profile = profileOf(g, v);
        const sit = situationFromState(s, g.hero, v, narrowHand(s, v, 'pool', opts, profile).range, { heroPreflopAggressor: false, villainProfile: profile });
        const a = analyze(sit, comboEquities(sit.hero, sit.board, sit.villainRange));
        const kind = a.best.option.allIn ? 'allIn' : a.best.option.kind;
        if (legalActions(s).call !== null) {
          facing.push(kind);
          const raise = a.rows.find((r) => r.option.kind === 'raise' && !r.option.allIn);
          if (raise) {
            raiseFold += raise.fold!;
            raiseBreakEven += raise.breakEvenBluff!;
            raises++;
          }
        } else open.push(kind);
      }
      const act: Action = s.street === 'preflop' ? botAction(s, rng, opts) : botPostflopAction(s, rng, PROFILES.regular);
      s = advance(g, applyAction(s, act), rng, opts);
    }
  }
  const share = (xs: string[], ks: string[]) => xs.filter((x) => ks.includes(x)).length / xs.length;
  return {
    facing: facing.length,
    open: open.length,
    raiseBest: share(facing, ['raise', 'allIn']),
    checkBest: share(open, ['check']),
    raiseFold: raiseFold / raises,
    raiseBreakEven: raiseBreakEven / raises,
  };
}

describe('how often betting and raising grade best', () => {
  // Measured over 300 hands: before the floor, raising was best at 89 of 159 decisions facing a
  // bet and checking at 50 of 405 with no bet to face; with it, 64 of 161 and 102 of 434.
  let r: ReturnType<typeof sample>;
  beforeAll(() => {
    r = sample(200);
  }, 120_000);

  it('samples enough decisions', () => {
    expect(r.facing).toBeGreaterThan(80);
    expect(r.open).toBeGreaterThan(250);
  });

  it('facing a bet, raising is best less than half the time', () => {
    expect(r.raiseBest).toBeLessThan(0.48);
  });

  it('with no bet to face, checking is best at least a sixth of the time', () => {
    expect(r.checkBest).toBeGreaterThan(1 / 6);
  });

  it('a 2.5x raise gets folds clearly less often than a pure bluff needs', () => {
    // Before the floor the two were 0.405 and 0.435, so nearly every raise was a free bluff.
    expect(r.raiseFold).toBeLessThan(r.raiseBreakEven - 0.08);
  });
});
