// Leak practice for postflop leaks: a drill hand has to stop at a decision where the leak can
// actually recur, be an ordinary hand from there on, and fall back to a normal hand when the
// level can't host the leak.

import { describe, expect, it } from 'vitest';
import { comboEquities } from '../equity';
import { drillHand, POSTFLOP_DRILLS, practiceHand } from '../game/drills';
import { advance, heroDecides, LEAK_SPOTS, liveVillains, type GameHand } from '../game/levels';
import { applyAction, legalActions, type Action } from '../hand';
import { PROFILES } from '../postflop/model';
import { narrowHand } from '../postflop/narrow';
import { analyze, leaksAtRisk, situationFromState } from '../postflop/recommend';
import { makeRng } from '../rng';

const opts = { lowStakes: true };

/** The tags a wrong action would earn at the hand's current decision, computed from scratch. */
function tagsAt(g: GameHand): string[] {
  const s = g.state;
  const [v] = liveVillains(g, s);
  const profile = PROFILES[g.profiles[v]];
  const pre = s.actions.filter((a) => a.street === 'preflop' && a.type === 'raise');
  const sit = situationFromState(s, g.hero, v, narrowHand(s, v, 'pool', opts, profile).range, {
    heroRange: narrowHand(s, g.hero, 'baseline', opts).range,
    heroPreflopAggressor: pre.length > 0 && pre[pre.length - 1].player === g.hero,
    villainProfile: profile,
  });
  return leaksAtRisk(sit, analyze(sit, comboEquities(sit.hero, sit.board, sit.villainRange)));
}

function chipsBalance(g: GameHand, s = g.state) {
  if (s.result) {
    expect(s.result.net.reduce((a, x) => a + x, 0)).toBe(0);
    return;
  }
  const total = s.players.reduce((t, p) => t + p.stack + p.total, 0);
  const start = s.players.length * 100 * s.config.bb;
  expect(total).toBe(start);
}

describe('postflop leak drills', () => {
  const found = new Map<string, number>();
  for (const tag of Object.keys(POSTFLOP_DRILLS)) {
    it(`stops at a decision where "${tag}" can show up`, () => {
      let n = 0;
      for (let seed = 1; seed <= 6; seed++) {
        const g = drillHand(3, makeRng(seed * 7 + tag.length), opts, tag);
        if (!g) continue;
        n++;
        expect(g.focus).toBe(tag);
        expect(g.drilled).toBe(true);
        expect(g.state.street).not.toBe('preflop');
        expect(heroDecides(g, g.state)).toBe(true);
        expect(liveVillains(g, g.state)).toHaveLength(1);
        expect(tagsAt(g)).toContain(tag);
        chipsBalance(g);
      }
      found.set(tag, n);
    });
  }

  it('finds most postflop leaks on full heads-up hands', () => {
    // Sunk-cost calls need a big share of the stack in already, which single-raised pots rarely reach.
    const common = [...found].filter(([t]) => t !== 'sunk-cost call');
    expect(common.filter(([, n]) => n > 0).length).toBeGreaterThanOrEqual(common.length - 1);
  });

  it('plays on normally from the drill spot', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const rng = makeRng(seed * 101);
      const g = drillHand(3, rng, opts, 'missed value bet');
      if (!g) continue;
      let s = g.state;
      for (let turn = 0; turn < 12 && heroDecides(g, s); turn++) {
        const l = legalActions(s);
        const a: Action = l.check ? { type: 'check' } : l.call !== null ? { type: 'call' } : { type: 'fold' };
        s = advance(g, applyAction(s, a), rng, opts);
      }
      expect(s.toAct === null || !heroDecides(g, s)).toBe(true);
      chipsBalance(g, s);
    }
  });

  it('only builds river decisions on level 6, and nothing it cannot host', () => {
    const g = drillHand(6, makeRng(5), opts, 'missed value bet');
    expect(g?.state.street).toBe('river');
    expect(drillHand(6, makeRng(5), opts, 'donk bet into the preflop raiser')).toBeNull();
    expect(drillHand(1, makeRng(5), opts, 'missed value bet')).toBeNull();
    expect(drillHand(5, makeRng(5), opts, 'missed value bet')).toBeNull();
    expect(drillHand(3, makeRng(5), opts, 'opening too tight')).toBeNull();
  });

  it('leaves preflop leaks to the preflop spot mix', () => {
    for (const tag of Object.keys(LEAK_SPOTS)) {
      if (POSTFLOP_DRILLS[tag]) continue;
      expect(drillHand(3, makeRng(1), opts, tag)).toBeNull();
    }
    for (let seed = 1; seed <= 20; seed++) {
      const g = practiceHand(3, makeRng(seed), opts, [{ tag: 'opening too tight', weight: 3 }]);
      expect(g.drilled).toBeFalsy();
    }
  });

  it('practices a postflop leak in some hands, not all of them', () => {
    let drilled = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const g = practiceHand(3, makeRng(seed * 13), opts, [{ tag: 'overfolding', weight: 2 }]);
      if (g.drilled) {
        drilled++;
        expect(g.focus).toBe('overfolding');
      }
    }
    expect(drilled).toBeGreaterThan(3);
    expect(drilled).toBeLessThan(18);
  });
});
