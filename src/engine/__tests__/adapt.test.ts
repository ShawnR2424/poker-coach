import { describe, expect, it } from 'vitest';
import { comboEquities } from '../equity';
import { advance, heroDecides, liveVillains, newGameHand, profileOf, type GameHand } from '../game/levels';
import { applyAction, legalActions, type Action, type HandState } from '../hand';
import { botPostflopAction } from '../postflop/bot';
import { continueProb, firstToActFreq, PROFILES } from '../postflop/model';
import { narrowHand } from '../postflop/narrow';
import { analyze, situationFromState } from '../postflop/recommend';
import { botAction } from '../preflop/policy';
import { makeRng } from '../rng';
import { ADAPT, adaptationFor, adaptProfile, heroTendencies, type Adaptation, type PostflopMove } from '../session/adapt';
import { replayAdaptation, replayOf } from '../session/replay';
import type { DecisionRecord, HandRecord } from '../session/session';

const opts = { lowStakes: true };

/** A session of one-decision hands with these [hero move, best move] pairs, oldest first. */
function sessionOf(pairs: [PostflopMove, PostflopMove][]): HandRecord[] {
  return pairs.map(([move, bestMove], i) => ({
    n: i + 1, at: '', level: 3, spot: '', hand: '', net: 0, bb: 50, decided: true, lesson: '',
    decisions: [{ label: 'Flop', hand: '', you: move, verdict: 'correct', heading: '', tags: [], atRisk: [], move, bestMove } as DecisionRecord],
  }));
}
const times = <T,>(n: number, x: T): T[] => Array.from({ length: n }, () => x);

const OVERFOLDS = adaptationFor(heroTendencies(sessionOf([...times(8, ['fold', 'call']), ...times(4, ['call', 'call'])] as [PostflopMove, PostflopMove][])))!;
const OVERCALLS = adaptationFor(heroTendencies(sessionOf([...times(8, ['call', 'fold']), ...times(4, ['fold', 'fold'])] as [PostflopMove, PostflopMove][])))!;
const BETS_OFTEN = adaptationFor(heroTendencies(sessionOf([...times(8, ['bet', 'check']), ...times(4, ['bet', 'bet'])] as [PostflopMove, PostflopMove][])))!;
const RARELY_BETS = adaptationFor(heroTendencies(sessionOf([...times(8, ['check', 'bet']), ...times(4, ['check', 'check'])] as [PostflopMove, PostflopMove][])))!;

describe('reading the hero', () => {
  it('compares the hero with the best play over the latest decisions of each kind', () => {
    const hands = sessionOf([
      ...times(50, ['call', 'call']),
      ...times(20, ['fold', 'call']),
      ...times(20, ['call', 'call']),
      ...times(5, ['bet', 'check']),
      ...times(5, ['check', 'check']),
    ] as [PostflopMove, PostflopMove][]);
    // A preflop decision has no move and does not count.
    hands[0].decisions.push({ label: 'BTN first in', hand: '', you: 'raise', verdict: 'correct', heading: '', tags: [], atRisk: [] });
    const t = heroTendencies(hands);
    expect(t.foldToBet).toEqual({ you: 20, best: 0, of: ADAPT.window });
    expect(t.betWhenFree).toEqual({ you: 5, best: 0, of: 10 });
  });

  it('waits for enough decisions before adjusting', () => {
    const few = sessionOf(times(ADAPT.minSample - 1, ['fold', 'call']) as [PostflopMove, PostflopMove][]);
    expect(adaptationFor(heroTendencies(few))).toBeNull();
    const enough = sessionOf(times(ADAPT.minSample, ['fold', 'call']) as [PostflopMove, PostflopMove][]);
    expect(adaptationFor(heroTendencies(enough))?.adjustments.map((a) => a.kind)).toEqual(['overfolds']);
  });

  it('leaves a hero who plays like the best play alone', () => {
    const hands = sessionOf([
      ...times(15, ['fold', 'fold']), ...times(15, ['call', 'call']),
      ...times(20, ['bet', 'bet']), ...times(5, ['check', 'check']),
    ] as [PostflopMove, PostflopMove][]);
    expect(adaptationFor(heroTendencies(hands))).toBeNull();
  });

  it('names each tendency with the counts behind it', () => {
    expect(OVERFOLDS.adjustments.map((a) => a.kind)).toEqual(['overfolds']);
    expect(OVERFOLDS.adjustments[0].text).toContain('You folded to 8 of your last 12 bets, where the best play folds 0');
    expect(OVERFOLDS.bluffMult).toBeGreaterThan(1);
    expect(OVERCALLS.adjustments.map((a) => a.kind)).toEqual(['overcalls']);
    expect(OVERCALLS.bluffMult).toBeLessThan(1);
    expect(BETS_OFTEN.adjustments.map((a) => a.kind)).toEqual(['betsOften']);
    expect(BETS_OFTEN.continueAdd).toBeGreaterThan(0);
    expect(RARELY_BETS.adjustments.map((a) => a.kind)).toEqual(['rarelyBets']);
    expect(RARELY_BETS.continueAdd).toBeLessThan(0);
  });
});

describe('adjusted styles', () => {
  it('change bluffs and calls, never sets and two pair', () => {
    const reg = PROFILES.regular;
    const more = adaptProfile(reg, OVERFOLDS);
    const less = adaptProfile(reg, OVERCALLS);
    const betAir = (p: typeof reg) => 1 - firstToActFreq('air', false, p).check;
    expect(betAir(more)).toBeGreaterThan(betAir(reg));
    expect(betAir(less)).toBeLessThan(betAir(reg));
    expect(firstToActFreq('setPlus', false, more)).toEqual(firstToActFreq('setPlus', false, reg));
    expect(firstToActFreq('topPairGood', false, more)).toEqual(firstToActFreq('topPairGood', false, reg));
    expect(continueProb('topPairWeak', 0.66, false, adaptProfile(reg, BETS_OFTEN))).toBeGreaterThan(continueProb('topPairWeak', 0.66, false, reg));
    expect(continueProb('air', 0.66, false, adaptProfile(reg, RARELY_BETS))).toBeLessThanOrEqual(continueProb('air', 0.66, false, reg));
    expect(continueProb('setPlus', 0.66, false, adaptProfile(reg, RARELY_BETS))).toBe(continueProb('setPlus', 0.66, false, reg));
    expect(adaptProfile(reg, null)).toBe(reg);
    expect(more.adjustments?.length).toBe(1);
  });

  it('survive a replay, so the replay reads ranges as the hand did', () => {
    const g = newGameHand(3, makeRng(5), opts, [], OVERFOLDS);
    expect(g.adapt).toBe(OVERFOLDS);
    const r = JSON.parse(JSON.stringify(replayOf(g.state, g.hero, g.villains, g.profiles, true, g.adapt))) as ReturnType<typeof replayOf>;
    const back = replayAdaptation(r)!;
    expect(back.bluffMult).toBe(OVERFOLDS.bluffMult);
    expect(back.continueAdd).toBe(OVERFOLDS.continueAdd);
    expect(r.adapt?.kinds).toEqual(['overfolds']);
    expect(replayAdaptation(replayOf(g.state, g.hero, g.villains, g.profiles))).toBeNull();
  });
});

/** Heads-up postflop hero decisions from level 3 hands, with the trainer's best kind. */
function bestKinds(adapt: Adaptation | null, seeds: number, facing: boolean): string[] {
  const out: string[] = [];
  for (let seed = 1; seed <= seeds; seed++) {
    const rng = makeRng(seed * 31 + 7);
    const g: GameHand = newGameHand(3, rng, opts, [], adapt);
    let s: HandState = advance(g, g.state, rng, opts);
    for (let t = 0; t < 12 && heroDecides(g, s); t++) {
      const live = liveVillains(g, s);
      if (s.street !== 'preflop' && live.length === 1 && (legalActions(s).call !== null) === facing) {
        const v = live[0];
        const profile = profileOf(g, v);
        const sit = situationFromState(s, g.hero, v, narrowHand(s, v, 'pool', opts, profile).range, { heroPreflopAggressor: false, villainProfile: profile });
        out.push(analyze(sit, comboEquities(sit.hero, sit.board, sit.villainRange)).best.option.kind);
      }
      const a: Action = s.street === 'preflop' ? botAction(s, rng, opts) : botPostflopAction(s, rng, PROFILES.regular);
      s = advance(g, applyAction(s, a), rng, opts);
    }
  }
  return out;
}
const share = (xs: string[], k: string) => xs.filter((x) => x === k).length / xs.length;

describe('the grades follow the adjustment', () => {
  it('folding to a bet grades best less often once opponents bluff more', () => {
    const base = bestKinds(null, 250, true);
    const more = bestKinds(OVERFOLDS, 250, true);
    expect(base.length).toBeGreaterThan(80);
    expect(share(more, 'fold')).toBeLessThan(share(base, 'fold'));
  }, 60_000);

  it('folding to a bet grades best more often once opponents bluff less', () => {
    const base = bestKinds(null, 250, true);
    const less = bestKinds(OVERCALLS, 250, true);
    expect(share(less, 'fold')).toBeGreaterThan(share(base, 'fold'));
  }, 60_000);

  it('betting grades best more often against opponents who give your bets credit', () => {
    const lighter = bestKinds(BETS_OFTEN, 150, false);
    const credit = bestKinds(RARELY_BETS, 150, false);
    expect(lighter.length).toBeGreaterThan(150);
    expect(share(credit, 'bet')).toBeGreaterThan(share(lighter, 'bet'));
  }, 60_000);
});
