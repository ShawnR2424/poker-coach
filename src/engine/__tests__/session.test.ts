import { describe, expect, it } from 'vitest';
import { parseCards } from '../cards';
import { applyAction, newHand } from '../hand';
import { biasedMix } from '../game/levels';
import { heroDecision, preflopLeaksAtRisk } from '../preflop/coach';
import {
  addHand, handLesson, leakStats, levelProgress, openLeaks, parseSaved, startNewSession, totals,
  type DecisionRecord, type HandRecord,
} from '../session/session';

const d = (verdict: DecisionRecord['verdict'], tags: string[] = [], atRisk: string[] = []): DecisionRecord => ({
  label: 'Flop Ts7d3c', hand: 'AhKh', you: 'bet', verdict, heading: verdict === 'mistake' ? 'Mistake: bet 75%' : 'Correct', tags, atRisk,
});
const hand = (n: number, net: number, decisions: DecisionRecord[], level = 3): HandRecord => ({
  n, at: '2026-10-09T00:00:00Z', level, spot: 'BTN first in', hand: 'AhKh', net, bb: 50, decided: true, decisions, lesson: '',
});

describe('session totals', () => {
  it('adds up profit and loss in chips and big blinds', () => {
    const hs = [hand(1, 125, [d('correct')]), hand(2, -300, [d('mistake', ['overfolding'])]), hand(3, 0, [])];
    const t = totals(hs);
    expect(t.hands).toBe(3);
    expect(t.net).toBe(-175);
    expect(t.netBB).toBeCloseTo(-3.5, 9);
    expect(t.bbPer100).toBeNull(); // under 10 hands
    expect(t.decisions).toBe(2);
    expect(t.verdicts).toEqual({ correct: 1, playable: 0, mistake: 1 });
  });

  it('reports bb per 100 hands once there are 10 hands', () => {
    const hs = Array.from({ length: 10 }, (_, i) => hand(i + 1, i % 2 ? 100 : -50, []));
    const t = totals(hs);
    expect(t.net).toBe(250);
    expect(t.bbPer100).toBeCloseTo((5 / 10) * 100, 9);
  });

  it('matches the sum of hand results across random sessions', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < 20; k++) {
      const nets = Array.from({ length: 1 + Math.floor(rnd() * 40) }, () => Math.round((rnd() - 0.5) * 4000 / 25) * 25);
      const t = totals(nets.map((x, i) => hand(i + 1, x, [])));
      expect(t.net).toBe(nets.reduce((a, x) => a + x, 0));
      expect(t.netBB * 50).toBeCloseTo(t.net, 6);
    }
  });
});

describe('leaks fixed', () => {
  it('a leak is fixed when its spot comes up again and is played right', () => {
    const hs = [
      hand(1, 0, [d('mistake', ['overfolding'], ['overfolding'])]),
      hand(2, 0, [d('correct', [], ['missed value bet'])]), // a different leak's spot: no change
    ];
    let s = leakStats(hs);
    expect(s).toEqual([{ tag: 'overfolding', count: 1, lastHand: 1, correctSince: 0, fixed: false }]);
    hs.push(hand(3, 0, [d('correct', [], ['overfolding'])]));
    s = leakStats(hs);
    expect(s[0]).toMatchObject({ tag: 'overfolding', fixed: true, correctSince: 1 });
    expect(openLeaks(hs)).toEqual([]);
  });

  it('a playable (not best) decision still counts as fixing it; a mistake in the spot does not', () => {
    const hs = [hand(1, 0, [d('mistake', ['overfolding'])]), hand(2, 0, [d('mistake', ['missed value bet'], ['overfolding', 'missed value bet'])])];
    expect(leakStats(hs).find((x) => x.tag === 'overfolding')!.fixed).toBe(false);
    hs.push(hand(3, 0, [d('playable', [], ['overfolding'])]));
    expect(leakStats(hs).find((x) => x.tag === 'overfolding')!.fixed).toBe(true);
  });

  it('a fixed leak reopens when it shows up again', () => {
    const hs = [
      hand(1, 0, [d('mistake', ['sunk-cost call'])]),
      hand(2, 0, [d('correct', [], ['sunk-cost call'])]),
      hand(3, 0, [d('mistake', ['sunk-cost call'])]),
    ];
    const s = leakStats(hs)[0];
    expect(s).toMatchObject({ count: 2, lastHand: 3, fixed: false, correctSince: 0 });
    expect(openLeaks(hs)).toEqual([{ tag: 'sunk-cost call', weight: 2 }]);
  });

  it('a spot where a leak was possible, before it ever showed up, does not count', () => {
    const hs = [hand(1, 0, [d('correct', [], ['overfolding'])]), hand(2, 0, [d('mistake', ['overfolding'])])];
    expect(leakStats(hs)[0]).toMatchObject({ fixed: false, correctSince: 0 });
  });
});

describe('leaks at risk', () => {
  it('lists the leaks a wrong preflop choice would earn', () => {
    // BTN first in with a hand the chart opens: folding it is "opening too tight".
    const holes = [null, null, null, null, null, parseCards('AhKd')];
    let s = newHand({ config: { tableSize: 6, sb: 25, bb: 50 }, stacks: Array(6).fill(5000), hole: holes, seed: 1 });
    for (const a of [{ type: 'fold' }, { type: 'fold' }, { type: 'fold' }] as const) s = applyAction(s, a);
    const dec = heroDecision(s, 5, { lowStakes: true });
    expect(preflopLeaksAtRisk(s, 5, dec)).toContain('opening too tight');
  });
});

describe('curriculum and practice', () => {
  it('is ready to move up after 20 decisions with at least 70% non-mistakes', () => {
    const ok = Array.from({ length: 14 }, (_, i) => hand(i + 1, 0, [d('correct')]));
    const bad = Array.from({ length: 6 }, (_, i) => hand(15 + i, 0, [d('mistake')]));
    expect(levelProgress([...ok, ...bad], 3)).toEqual({ recent: 20, good: 14, ready: true });
    expect(levelProgress([...ok.slice(1), ...bad], 3).ready).toBe(false); // only 19 decisions
    expect(levelProgress([...ok, ...bad, hand(21, 0, [d('mistake')])], 3).ready).toBe(false); // 13 of the last 20
    expect(levelProgress([...ok, ...bad], 4).recent).toBe(0); // other levels don't count
  });

  it('leans the spot mix toward open leaks, only within the level', () => {
    const m = biasedMix(3, [{ tag: 'opening too tight', weight: 1 }])!;
    expect(m.rfi).toBeGreaterThan(m.vsOpen);
    expect(m.vs3bet).toBe(0);
    expect(biasedMix(3, [{ tag: 'calling 4-bets too wide', weight: 5 }])).toBeNull();
    expect(biasedMix(3, [{ tag: 'overfolding', weight: 5 }])).toBeNull(); // postflop-only leak: no preflop spot
  });

  it('writes a lesson from the first mistake', () => {
    expect(handLesson([d('correct'), d('mistake', ['overfolding'])], 100, true)).toBe('Flop Ts7d3c with AhKh: mistake: bet 75%. Leak to watch: overfolding.');
    expect(handLesson([d('correct')], -500, true)).toMatch(/Judge the decision/);
    expect(handLesson([], 0, true)).toBe('No graded decisions.');
  });
});

describe('saved sessions', () => {
  it('round-trips through JSON and archives on a new session', () => {
    let saved = parseSaved(null, new Date('2026-10-09T10:00:00Z'));
    saved = addHand(saved, { ...hand(0, 50, [d('correct')]) });
    saved = addHand(saved, { ...hand(0, -25, []) });
    expect(saved.current.hands.map((h) => h.n)).toEqual([1, 2]);
    const back = parseSaved(JSON.stringify(saved));
    expect(back).toEqual(saved);
    expect(totals(back.current.hands).net).toBe(25);
    const next = startNewSession(back, new Date('2026-10-09T11:00:00Z'));
    expect(next.current.hands).toEqual([]);
    expect(next.past[0]).toEqual(saved.current);
    // An empty session is not archived.
    expect(startNewSession(next).past.length).toBe(1);
  });

  it('starts fresh when saved data is missing or broken', () => {
    expect(parseSaved('{not json').current.hands).toEqual([]);
    expect(parseSaved('{"version":2}').past).toEqual([]);
  });
});
