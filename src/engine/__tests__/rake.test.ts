// Rake: the house takes 5% of each pot that sees a flop, capped at 3bb, and the best play
// counts what the hero keeps after it.

import { describe, expect, it } from 'vitest';
import { parseCards } from '../cards';
import { comboEquities } from '../equity';
import { advance, heroDecides, liveVillains, newGameHand, profileOf } from '../game/levels';
import { applyAction, legalActions, newHand, rakeKeep, rakeOf, type Action, type HandConfig, type HandState, type Rake } from '../hand';
import { botPostflopAction } from '../postflop/bot';
import { PROFILES } from '../postflop/model';
import { analyzeMultiway, multiwaySituationFromState } from '../postflop/multiway';
import { narrowHand } from '../postflop/narrow';
import { afterRake, analyze, situationFromState } from '../postflop/recommend';
import { botAction } from '../preflop/policy';
import { makeRng } from '../rng';
import { replayOf, replayStates } from '../session/replay';

const RAKE: Rake = { pct: 0.05, capBB: 3 };
const raked: HandConfig = { tableSize: 6, sb: 25, bb: 50, rake: RAKE };
const stacks = (n = 5000) => Array(6).fill(n) as number[];
const play = (s: HandState, ...acts: Action[]) => acts.reduce(applyAction, s);
const F: Action = { type: 'fold' }, C: Action = { type: 'call' }, X: Action = { type: 'check' };
const chips = (s: HandState) => s.players.reduce((a, p) => a + p.stack, 0);

describe('rake on a pot', () => {
  it('is 5% rounded down to the chip, capped at 3bb', () => {
    expect(rakeOf(1000, raked)).toBe(50);
    expect(rakeOf(1019, raked)).toBe(50);
    expect(rakeOf(3000, raked)).toBe(150);
    expect(rakeOf(40000, raked)).toBe(150);
    expect(rakeOf(1000, { bb: 50 })).toBe(0);
  });

  it('leaves the winner 95% of each further chip until the cap, then all of it', () => {
    expect(rakeKeep(1000, raked)).toBeCloseTo(0.95, 9);
    expect(rakeKeep(3000, raked)).toBe(1);
    expect(rakeKeep(1000, { bb: 50 })).toBe(1);
  });
});

describe('rake in the hand engine', () => {
  it('takes nothing from a pot that ends before the flop (no flop, no drop)', () => {
    let s = newHand({ config: raked, stacks: stacks(), seed: 1 });
    s = play(s, { type: 'raise', to: 125 }, F, F, F, F, F);
    expect(s.result!.rake).toBe(0);
    expect(s.result!.net.reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('takes 5% of a pot won on the flop, even without a showdown', () => {
    let s = newHand({ config: raked, stacks: stacks(), seed: 1 });
    // UTG opens to $1.25, BB calls: $2.75 in the middle.
    s = play(s, { type: 'raise', to: 125 }, F, F, F, F, C);
    s = play(s, X, { type: 'bet', to: 100 }, F);
    expect(s.result!.wentToShowdown).toBe(false);
    expect(s.result!.rake).toBe(13); // 5% of $2.75, rounded down
    expect(s.result!.net[2]).toBe(275 - 125 - 13);
    expect(chips(s) + s.result!.rake).toBe(30000);
  });

  it('stops at the cap in a big pot', () => {
    let s = newHand({ config: raked, stacks: stacks(), seed: 3 });
    s = play(s, { type: 'raise', to: 5000 }, C, F, F, F, F);
    expect(s.board).toHaveLength(5);
    expect(s.result!.rake).toBe(150);
    expect(chips(s) + 150).toBe(30000);
  });

  it('does not rake chips only one player could win, and splits the rake over side pots', () => {
    const hole = [null, null, parseCards('AsAh'), parseCards('KsKh'), parseCards('QsQh'), null];
    let s = newHand({ config: raked, stacks: [5000, 5000, 1000, 3000, 6000, 5000], hole, board: parseCards('2c7d9hTc3s'), seed: 1 });
    s = play(s, { type: 'raise', to: 1000 }, { type: 'raise', to: 3000 }, { type: 'raise', to: 6000 }, F, F, F);
    // QQ's extra $30 is uncalled and goes back; the $30.75 main pot and $40 side pot are contested.
    const r = s.result!;
    expect(r.rake).toBe(150);
    const contested = r.pots.filter((p) => !p.uncalled);
    // $1.50 of rake, shared 65:84 by size with the odd chip from the main pot.
    expect(contested.map((p) => p.amount)).toEqual([3075 - 66, 4000 - 84]);
    expect(chips(s) + r.rake).toBe(25000);
    expect(r.net[2]).toBeGreaterThan(0); // aces win the main pot
  });

  it('keeps chips whole over random hands: stacks plus rake always add up to the start', () => {
    const rng = makeRng(42);
    for (let k = 0; k < 400; k++) {
      let s = newHand({ config: raked, stacks: stacks(1000 + Math.floor(rng() * 9000)), seed: k });
      while (s.toAct !== null) {
        const l = legalActions(s);
        const x = rng();
        const a: Action =
          l.raise && x < 0.15 ? { type: 'raise', to: l.raise.min + Math.floor(rng() * (l.raise.max - l.raise.min + 1)) }
            : l.bet && x < 0.3 ? { type: 'bet', to: l.bet.min + Math.floor(rng() * (l.bet.max - l.bet.min + 1)) }
              : l.fold && x < 0.55 ? F : l.check ? X : C;
        s = applyAction(s, a);
      }
      const r = s.result!;
      expect(chips(s) + r.rake).toBe(s.startingStacks.reduce((a, b) => a + b, 0));
      expect(r.net.reduce((a, b) => a + b, 0) + r.rake).toBe(0);
      expect(r.rake).toBeLessThanOrEqual(150);
      if (s.board.length < 3) expect(r.rake).toBe(0);
    }
  });

  it('replays a raked hand to the same result', () => {
    let s = newHand({ config: raked, stacks: stacks(), seed: 1 });
    s = play(s, { type: 'raise', to: 125 }, F, F, F, F, C, X, { type: 'bet', to: 100 }, F);
    const back = replayStates(replayOf(s, 2, [1], {})).at(-1)!;
    expect(back.result).toEqual(s.result);
  });
});

/** Heads-up postflop hero decisions from level 3 hands, analyzed with and without the rake. */
function decisions(seeds: number) {
  const out: { plain: ReturnType<typeof analyze>; withRake: ReturnType<typeof analyze>; pot: number }[] = [];
  for (let seed = 1; seed <= seeds; seed++) {
    const rng = makeRng(seed);
    const opts = { lowStakes: true, rake: RAKE };
    const g = newGameHand(3, rng, opts);
    expect(g.state.config.rake).toEqual(RAKE);
    let s = advance(g, g.state, rng, opts);
    for (let t = 0; t < 12 && heroDecides(g, s); t++) {
      const live = liveVillains(g, s);
      if (s.street !== 'preflop' && live.length === 1) {
        const v = live[0];
        const profile = profileOf(g, v);
        const sit = situationFromState(s, g.hero, v, narrowHand(s, v, 'pool', opts, profile).range, { heroPreflopAggressor: false, villainProfile: profile });
        const eqs = comboEquities(sit.hero, sit.board, sit.villainRange);
        out.push({ plain: analyze({ ...sit, rake: undefined }, eqs), withRake: analyze(sit, eqs), pot: sit.pot });
      }
      const act: Action = s.street === 'preflop' ? botAction(s, rng, opts) : botPostflopAction(s, rng, PROFILES.regular);
      s = advance(g, applyAction(s, act), rng, opts);
    }
  }
  return out;
}

describe('rake in the best play', () => {
  const ds = decisions(60);

  it('samples enough decisions', () => {
    expect(ds.length).toBeGreaterThan(40);
  });

  it('never makes an option worth more, and leaves folding at zero', () => {
    for (const { plain, withRake } of ds) {
      plain.rows.forEach((r, k) => {
        expect(withRake.rows[k].ev).toBeLessThanOrEqual(r.ev + 1e-9);
        if (r.option.kind === 'fold') expect(withRake.rows[k].ev).toBe(0);
      });
    }
  });

  it('takes no more from an option than the rake on the biggest pot it can win', () => {
    for (const { plain, withRake } of ds) {
      plain.rows.forEach((r, k) => expect(r.ev - withRake.rows[k].ev).toBeLessThanOrEqual(150 + 1e-6));
    }
  });

  it('checking loses exactly the realized share of the rake on the current pot, before later streets', () => {
    for (const { plain, withRake, pot } of ds) {
      const k = plain.rows.findIndex((r) => r.option.kind === 'check');
      if (k < 0 || withRake.facts.realization === 0) continue;
      const lost = plain.rows[k].ev - withRake.rows[k].ev;
      const direct = withRake.facts.realization * withRake.facts.equity * (pot - afterRake(pot, { bb: 50, rake: RAKE }));
      expect(lost).toBeGreaterThanOrEqual(direct - 1e-6);
    }
  });
});

describe('rake in multiway pots', () => {
  it('lowers every option except folding', () => {
    const hole = [parseCards('9c9d'), parseCards('KcQc'), null, null, parseCards('AhJh'), null];
    let s = newHand({ config: raked, stacks: stacks(), hole, board: parseCards('Jd7s2cTh4h'), seed: 1 });
    s = play(s, F, F, { type: 'raise', to: 125 }, F, C, C, X, X);
    expect(s.toAct).toBe(4);
    const opts = { lowStakes: true };
    const villains = [{ seat: 0, range: narrowHand(s, 0, 'pool', opts).range }, { seat: 1, range: narrowHand(s, 1, 'pool', opts).range }];
    const sit = multiwaySituationFromState(s, 4, villains, { heroPreflopAggressor: true });
    expect(sit.rake).toEqual(RAKE);
    const withRake = analyzeMultiway(sit, { iterations: 600 }).analysis;
    const plain = analyzeMultiway({ ...sit, rake: undefined }, { iterations: 600 }).analysis;
    plain.rows.forEach((r, k) => {
      if (r.option.kind === 'fold') expect(withRake.rows[k].ev).toBe(0);
      else expect(withRake.rows[k].ev).toBeLessThan(r.ev);
    });
  });
});
