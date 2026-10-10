// The hand flow the Play screen relies on: whatever the hero does, every hand either reaches a
// hero decision the trainer can read and grade, or ends cleanly. A turn that fits neither would
// leave the screen at "Your turn" with nothing to press, as level 1 once did when the hero was
// first to act on the flop.

import { describe, expect, it } from 'vitest';
import { comboEquities } from '../equity';
import { advance, heroDecides, LEVEL_IDS, LEVELS, liveVillains, newGameHand, type GameHand } from '../game/levels';
import { applyAction, legalActions, type Action, type HandState } from '../hand';
import { analyzeMultiway, multiwaySituationFromState } from '../postflop/multiway';
import { narrowHand } from '../postflop/narrow';
import { PROFILES } from '../postflop/model';
import { analyze, gradePostflop, heroOptions, leaksAtRisk, situationFromState } from '../postflop/recommend';
import { gradePreflop, heroDecision, preflopLeaksAtRisk } from '../preflop/coach';
import { hasChart, spotFor } from '../preflop/spot';
import { makeRng, type Rng } from '../rng';

const opts = { lowStakes: true };

/** Any legal action, with raises and bets at a random legal size (custom sizes included). */
function randomAction(s: HandState, rng: Rng): Action {
  const l = legalActions(s);
  const options: Action[] = [];
  if (l.fold) options.push({ type: 'fold' });
  if (l.check) options.push({ type: 'check' });
  if (l.call !== null) options.push({ type: 'call' });
  const r = l.bet ?? l.raise;
  if (r) {
    const to = r.min + Math.floor(rng() * (r.max - r.min + 1));
    options.push({ type: l.bet ? 'bet' : 'raise', to: Math.min(r.max, Math.max(r.min, Math.round(to / 25) * 25)) });
    options.push({ type: l.bet ? 'bet' : 'raise', to: r.max });
  }
  return options[Math.floor(rng() * options.length)];
}

/** Checks one hero turn the way the Play screen handles it; returns which kind of turn it was. */
function checkTurn(g: GameHand, s: HandState, deep: boolean): 'preflop' | 'ungraded' | 'headsUp' | 'multiway' {
  if (s.street === 'preflop') {
    const spot = spotFor(s, g.hero);
    if (!hasChart(spot)) return 'ungraded';
    const d = heroDecision(s, g.hero, opts);
    for (const a of [{ type: 'fold' }, { type: 'call' }, { type: 'raise', to: d.raiseTo ?? 0 }] as Action[]) {
      expect(['correct', 'playable', 'mistake']).toContain(gradePreflop(d, a, s.config.bb).verdict);
    }
    preflopLeaksAtRisk(s, g.hero, d);
    return 'preflop';
  }
  const live = liveVillains(g, s);
  expect(live.length, 'a postflop hero turn needs an opponent to read').toBeGreaterThan(0);
  expect(heroOptions(s).length).toBeGreaterThan(0);
  const views = live.map((seat) => ({ seat, range: narrowHand(s, seat, 'pool', opts, PROFILES[g.profiles[seat]]).range, profile: PROFILES[g.profiles[seat]] }));
  if (live.length === 1) {
    const sit = situationFromState(s, g.hero, views[0].seat, views[0].range, { heroPreflopAggressor: false, villainProfile: views[0].profile });
    if (deep) {
      const a = analyze(sit, comboEquities(sit.hero, sit.board, sit.villainRange));
      for (const r of a.rows) expect(Number.isFinite(r.ev)).toBe(true);
      gradePostflop(sit, a, { type: a.rows[0].option.kind } as Action);
      leaksAtRisk(sit, a);
    }
    return 'headsUp';
  }
  const sit = multiwaySituationFromState(s, g.hero, views, { heroPreflopAggressor: false });
  if (deep) {
    const { analysis } = analyzeMultiway(sit, { iterations: 300 });
    for (const r of analysis.rows) expect(Number.isFinite(r.ev)).toBe(true);
    leaksAtRisk(sit, analysis);
  }
  return 'multiway';
}

describe('every hero turn can be acted on', () => {
  for (const level of LEVEL_IDS) {
    it(`level ${level}: ${LEVELS[level].name}`, () => {
      const kinds = new Map<string, number>();
      let turns = 0;
      for (let seed = 1; seed <= 40; seed++) {
        const rng = makeRng(seed * 104729 + level);
        const g = newGameHand(level, rng, opts);
        let s = advance(g, g.state, rng, opts);
        expect(heroDecides(g, s), `a new hand must open on a hero decision (seed ${seed})`).toBe(true);
        let guard = 0;
        while (heroDecides(g, s) && guard++ < 40) {
          const kind = checkTurn(g, s, turns % 3 === 0);
          kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
          turns++;
          s = advance(g, applyAction(s, randomAction(s, rng)), rng, opts);
        }
        // When the hero has nothing to decide, the hand is over or stopped where the level stops.
        if (s.toAct !== null) {
          expect(LEVELS[level].postflop, `stuck with ${s.players[s.toAct].position} to act (seed ${seed})`).toBe(false);
          expect(s.street).not.toBe('preflop');
        } else {
          expect(s.result).not.toBeNull();
          expect(s.result!.net.reduce((a, x) => a + x, 0)).toBe(0);
        }
      }
      expect(turns).toBeGreaterThanOrEqual(40);
      if (LEVELS[level].postflop && !LEVELS[level].riverOnly) expect(kinds.get('preflop') ?? 0).toBeGreaterThan(0);
      if (LEVELS[level].postflop) expect((kinds.get('headsUp') ?? 0) + (kinds.get('multiway') ?? 0)).toBeGreaterThan(0);
      if (level === 5) expect(kinds.get('multiway') ?? 0).toBeGreaterThan(0);
    });
  }

  it('level 1 stops at the flop even when the hero acts first there', () => {
    // Find a level 1 hand where the hero ends up first to act on the flop.
    for (let seed = 1; seed < 2000; seed++) {
      const rng = makeRng(seed);
      const g = newGameHand(1, rng, opts);
      let s = advance(g, g.state, rng, opts);
      while (heroDecides(g, s)) s = advance(g, applyAction(s, legalActions(s).call !== null ? { type: 'call' } : { type: 'check' }), rng, opts);
      if (s.street === 'flop' && s.toAct === g.hero) {
        expect(heroDecides(g, s)).toBe(false);
        return;
      }
    }
    throw new Error('No level 1 hand put the hero first to act on the flop');
  });
});
