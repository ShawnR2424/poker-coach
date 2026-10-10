import { describe, expect, it } from 'vitest';
import { leakTrend, mistakeTrend, sessionsInOrder, summarize } from '../session/progress';
import { addHand, parseSaved, startNewSession, type DecisionRecord, type HandRecord, type SavedSessions, type Session } from '../session/session';

const dec = (verdict: DecisionRecord['verdict'], tags: string[] = [], lossBB?: number): DecisionRecord => ({
  label: 'Flop', hand: 'AhKd', you: 'bet', verdict, heading: '', tags, atRisk: tags, ...(lossBB !== undefined ? { lossBB, move: 'bet' as const } : {}),
});
const hand = (decisions: DecisionRecord[]): Omit<HandRecord, 'n'> => ({
  at: '2024-05-01T00:00:00.000Z', level: 3, spot: 'BTN open', hand: 'AhKd', net: 0, bb: 50, decided: true, decisions, lesson: '',
});
const session = (id: string, hands: Omit<HandRecord, 'n'>[]): Session => ({ id, startedAt: '2024-05-01T00:00:00.000Z', hands: hands.map((h, i) => ({ ...h, n: i + 1 })) });

describe('sessions in order', () => {
  it('puts earlier sessions oldest first, the current one last, and drops empty ones', () => {
    let saved: SavedSessions = parseSaved(null, new Date('2024-05-01'));
    saved = addHand(saved, hand([dec('correct')]));
    saved = startNewSession(saved, new Date('2024-05-02'));
    saved = addHand(saved, hand([dec('mistake')]));
    saved = startNewSession(saved, new Date('2024-05-03'));
    saved = addHand(saved, hand([dec('playable')]));
    const order = sessionsInOrder(saved);
    expect(order.map((s) => s.hands[0].decisions[0].verdict)).toEqual(['correct', 'mistake', 'playable']);
    expect(sessionsInOrder(startNewSession(saved, new Date('2024-05-04')))).toHaveLength(3);
  });
});

describe('session summary', () => {
  it('counts the mistake rate over graded decisions', () => {
    const s = summarize(session('a', [hand([dec('mistake'), dec('correct')]), hand([dec('playable'), dec('mistake')]), hand([])]));
    expect(s).toMatchObject({ hands: 3, decisions: 4, mistakes: 2, mistakeRate: 0.5 });
  });

  it('gives no rate for a session without graded decisions', () => {
    expect(summarize(session('a', [hand([])])).mistakeRate).toBeNull();
  });

  it('measures EV given up per 100 hands from the first hand that recorded it', () => {
    // Two old hands without the measurement, then four hands that gave up 0.5bb and 1.5bb.
    const s = summarize(session('a', [
      hand([dec('mistake')]), hand([dec('correct')]),
      hand([dec('playable', [], 0.5)]), hand([dec('correct')]), hand([dec('mistake', [], 1.5), dec('correct', [], 0)]), hand([]),
    ]));
    expect(s.measured).toBe(3);
    expect(s.evLostPer100).toBeCloseTo((2 / 4) * 100, 9);
    expect(summarize(session('b', [hand([dec('mistake')])])).evLostPer100).toBeNull();
  });
});

describe('mistake trend', () => {
  it('waits for enough decisions, then follows the latest window across sessions', () => {
    const a = session('a', Array.from({ length: 30 }, () => hand([dec('mistake')])));
    const b = session('b', Array.from({ length: 30 }, () => hand([dec('correct')])));
    const t = mistakeTrend([a, b], 20, 10);
    expect(t[0]).toMatchObject({ hand: 10, session: 0, rate: 1, over: 10 });
    expect(t.find((p) => p.hand === 30)).toMatchObject({ rate: 1, over: 20 });
    expect(t.find((p) => p.hand === 40)).toMatchObject({ session: 1, rate: 0.5 });
    expect(t.at(-1)).toMatchObject({ hand: 60, rate: 0 });
    for (const p of t) {
      expect(p.rate).toBeGreaterThanOrEqual(0);
      expect(p.rate).toBeLessThanOrEqual(1);
      expect(p.over).toBeLessThanOrEqual(20);
    }
  });

  it('skips hands with no graded decision, keeping the hand count', () => {
    const s = session('a', [...Array.from({ length: 20 }, () => hand([dec('correct')])), hand([]), hand([dec('mistake')])]);
    const t = mistakeTrend([s], 50, 20);
    expect(t.map((p) => p.hand)).toEqual([20, 22]);
  });
});

describe('leak trend', () => {
  it('lists the most frequent leaks with their rate per 100 decisions in each session', () => {
    const a = session('a', [hand([dec('mistake', ['overfolding']), dec('mistake', ['overfolding']), dec('mistake', ['overfolding']), dec('mistake', ['missed value bet'])])]);
    const b = session('b', [hand([dec('mistake', ['missed value bet']), dec('correct')])]);
    const rows = leakTrend([a, b]);
    expect(rows.map((r) => r.tag)).toEqual(['overfolding', 'missed value bet']);
    expect(rows[0].bySession).toEqual([{ count: 3, per100: 75 }, { count: 0, per100: 0 }]);
    expect(rows[1].bySession).toEqual([{ count: 1, per100: 25 }, { count: 1, per100: 50 }]);
    expect(rows.reduce((t, r) => t + r.total, 0)).toBe(5);
  });

  it('marks a leak fixed when a later session plays its spot right', () => {
    const a = session('a', [hand([dec('mistake', ['overfolding'])])]);
    const b = session('b', [hand([{ ...dec('correct'), atRisk: ['overfolding'] }])]);
    expect(leakTrend([a]).map((r) => r.fixed)).toEqual([false]);
    expect(leakTrend([a, b]).map((r) => r.fixed)).toEqual([true]);
  });
});
