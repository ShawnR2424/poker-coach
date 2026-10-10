// A saved hand must replay to exactly the hand that was played: same states, same result,
// and small enough to keep in the browser.

import { describe, expect, it } from 'vitest';
import { practiceHand } from '../game/drills';
import { advance, heroDecides, LEVEL_IDS } from '../game/levels';
import { applyAction, legalActions, type Action, type HandState } from '../hand';
import { makeRng, type Rng } from '../rng';
import { heroSteps, replayOf, replayStates, type HandReplay } from '../session/replay';
import { addHand, parseSaved, startNewSession, trimReplays, type HandRecord } from '../session/session';

const opts = { lowStakes: true };

function randomAction(s: HandState, rng: Rng): Action {
  const l = legalActions(s);
  const options: Action[] = [];
  if (l.fold) options.push({ type: 'fold' });
  if (l.check) options.push({ type: 'check' });
  if (l.call !== null) options.push({ type: 'call' });
  const r = l.bet ?? l.raise;
  if (r) options.push({ type: l.bet ? 'bet' : 'raise', to: r.min + Math.floor(rng() * (r.max - r.min + 1)) });
  return options[Math.floor(rng() * options.length)];
}

describe('hand replay', () => {
  it('rebuilds every hand exactly, at every level and table size', () => {
    for (const tableSize of [6, 9]) {
      for (const level of LEVEL_IDS) {
        for (let seed = 1; seed <= 8; seed++) {
          const rng = makeRng(seed * 7 + level + tableSize);
          const table = tableSize === 6 ? {} : { tableSize, sb: 50, bb: 100 };
          const g = practiceHand(level, rng, { ...opts, ...table }, [{ tag: 'missed value bet', weight: 1 }]);
          let s = advance(g, g.state, rng, opts);
          const seen: HandState[] = [];
          while (heroDecides(g, s)) {
            seen.push(s);
            s = advance(g, applyAction(s, randomAction(s, rng)), rng, opts);
          }
          const r = replayOf(s, g.hero, g.villains, g.profiles);
          const states = replayStates(JSON.parse(JSON.stringify(r)));
          const last = states[states.length - 1];
          expect(last.actions).toEqual(s.actions);
          expect(last.board).toEqual(s.board);
          expect(last.result).toEqual(s.result);
          expect(last.players.map((p) => p.stack)).toEqual(s.players.map((p) => p.stack));
          // Every state the hero decided in is one of the replay's steps.
          const steps = heroSteps(r);
          for (const h of seen) {
            const k = h.actions.filter((a) => a.type !== 'post').length;
            expect(steps).toContain(k);
            expect(states[k].actions).toEqual(h.actions);
            expect(states[k].toAct).toBe(g.hero);
          }
          expect(JSON.stringify(r).length).toBeLessThan(2000);
        }
      }
    }
  });

  it('refuses a replay whose actions are out of order', () => {
    const rng = makeRng(3);
    const g = practiceHand(3, rng, opts);
    const s = advance(g, g.state, rng, opts);
    const r = replayOf(s, g.hero, g.villains, g.profiles);
    if (r.actions.length) {
      r.actions[0] = [(r.actions[0][0] + 1) % s.players.length, 'fold'];
      expect(() => replayStates(r)).toThrow(/out of step/);
    }
  });

  it('keeps replays for the newest hands only, so saved data stays small', () => {
    const replay = { v: 1 } as HandReplay;
    const rec = (): Omit<HandRecord, 'n'> => ({
      at: '2026-10-10T00:00:00Z', level: 3, spot: 'BTN first in', hand: 'AhKh', net: 0, bb: 50, decided: true, decisions: [], lesson: '', replay,
    });
    let saved = parseSaved(null);
    for (let i = 0; i < 4; i++) saved = addHand(saved, rec());
    saved = startNewSession(saved);
    for (let i = 0; i < 3; i++) saved = addHand(saved, rec());
    const trimmed = trimReplays(saved, 5);
    expect(trimmed.current.hands.every((h) => h.replay)).toBe(true);
    expect(trimmed.past[0].hands.map((h) => !!h.replay)).toEqual([false, false, true, true]);
    expect(trimReplays(trimmed, 5)).toBe(trimmed);
    expect(JSON.parse(JSON.stringify(trimmed)).past[0].hands[0]).not.toHaveProperty('replay');
  });
});
