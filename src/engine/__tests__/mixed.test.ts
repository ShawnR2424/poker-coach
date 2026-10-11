import { describe, expect, it } from 'vitest';
import { comboEquities } from '../equity';
import { advance, heroDecides, liveVillains, newGameHand, profileOf } from '../game/levels';
import { applyAction, type Action, type HandState } from '../hand';
import { botPostflopAction } from '../postflop/bot';
import { postflopFeedback } from '../postflop/coach';
import { PROFILES } from '../postflop/model';
import { narrowHand } from '../postflop/narrow';
import {
  analyze, gradePostflop, margins, mixMoves, mixOf, mixText, situationFromState,
  type Analysis, type DecisionBasics, type Facts, type HeroOption, type OptionRow,
} from '../postflop/recommend';
import { botAction } from '../preflop/policy';
import { makeRng } from '../rng';
import { countText, heroTendencies } from '../session/adapt';
import type { DecisionRecord, HandRecord } from '../session/session';

// Pot 1000, bb 50: the "correct" margin is max(12.5, 40) = 40 chips.
const sit = { pot: 1000, bb: 50, street: 'flop', heroInvested: 0, heroBehind: 5000, heroFirstToAct: true, heroInPosition: false, heroPreflopAggressor: true, hero: [] } as unknown as DecisionBasics;
const row = (kind: HeroOption['kind'], ev: number, to?: number): OptionRow => ({
  option: { kind, label: kind === 'bet' ? `${to! / 10}% pot` : kind[0].toUpperCase() + kind.slice(1), ...(to ? { to } : {}) }, ev,
});
const analysis = (rows: OptionRow[]): Analysis => ({
  rows, best: rows.reduce((a, b) => (b.ev > a.ev ? b : a)),
  facts: { equity: 0.5, potOdds: null, spr: 5, villainStrong: 0.1, heroStrong: 0.1, heroClass: 'middlePair', liveCombos: 100, realization: 0.9 } as Facts,
});
const act = (r: OptionRow): Action => (r.option.to ? { type: r.option.kind, to: r.option.to } : { type: r.option.kind }) as Action;

describe('mixes in close spots', () => {
  it('is pure when one kind of action is clearly best', () => {
    const a = analysis([row('check', 0), row('bet', 120, 330), row('bet', 100, 660)]);
    expect(mixOf(a, 1000, 50)).toEqual([{ row: a.best, freq: 1 }]);
    expect(mixMoves(mixOf(a, 1000, 50))).toBeNull();
  });

  it('splits equal options evenly and takes the best size of each kind', () => {
    const small = row('bet', 30, 330), big = row('bet', 10, 660), check = row('check', 30);
    const m = mixOf(analysis([check, small, big]), 1000, 50);
    expect(m.map((p) => [p.row, p.freq])).toEqual([[check, 0.5], [small, 0.5]]);
    expect(mixMoves(m)).toEqual({ check: 0.5, bet: 0.5 });
    expect(mixText(m)).toBe('check (50%) and bet 33% pot (50%)');
  });

  it('weights a close option by how far behind it is, down to about a ninth at the margin', () => {
    const m = margins(1000, 50).correct;
    const near = mixOf(analysis([row('check', 0), row('bet', m / 4, 330)]), 1000, 50);
    expect(near.map((p) => p.freq)).toEqual([0.6, 0.4]);
    const edge = mixOf(analysis([row('check', 0), row('bet', m, 330)]), 1000, 50);
    expect(edge.map((p) => p.freq)).toEqual([0.9, 0.1]);
    expect(mixOf(analysis([row('check', 0), row('bet', m + 1, 330)]), 1000, 50)).toHaveLength(1);
  });

  it('always gives shares in 5% steps that add up to 100%, best first', () => {
    const rng = makeRng(9);
    for (let n = 0; n < 500; n++) {
      const rows = [row('fold', 0), row('call', rng() * 60 - 20), row('raise', rng() * 60 - 20, 800)];
      const mix = mixOf(analysis(rows), 1000, 50);
      expect(mix.reduce((t, p) => t + p.freq, 0)).toBeCloseTo(1, 9);
      for (const p of mix) {
        expect(Math.round(p.freq * 20)).toBeCloseTo(p.freq * 20, 9);
        expect(p.freq).toBeGreaterThanOrEqual(0.05);
      }
      for (let i = 1; i < mix.length; i++) expect(mix[i].row.ev).toBeLessThanOrEqual(mix[i - 1].row.ev);
    }
  });
});

describe('grading a mixed spot', () => {
  const check = row('check', 20), small = row('bet', 30, 330), big = row('bet', -200, 1000);
  const a = analysis([check, small, big]);

  it('counts every part of the mix as correct and says it is a mixed spot', () => {
    for (const r of [check, small]) {
      const g = gradePostflop(sit, a, act(r));
      expect(g.verdict).toBe('correct');
      expect(g.heading).toMatch(/\(a mixed spot\)$/);
      const fb = postflopFeedback(sit, a, g, [], []);
      expect(fb.bullets.join(' ')).toContain(`This is a close spot, so it is played as a mix: ${mixText(g.mix)}.`);
      expect(fb.bullets.join(' ')).toContain('Yours is part of the mix.');
    }
  });

  it('still grades an action outside the mix by the EV it gives up', () => {
    const g = gradePostflop(sit, a, act(big));
    expect(g.verdict).toBe('mistake');
    expect(postflopFeedback(sit, a, g, [], []).bullets.join(' ')).toContain('which gives up 4.6bb against the best part of the mix');
  });
});

describe('adaptive opponents and mixes', () => {
  const hand = (d: Partial<DecisionRecord>, i: number): HandRecord => ({
    n: i + 1, at: '', level: 3, spot: '', hand: '', net: 0, bb: 50, decided: true, lesson: '',
    decisions: [{ label: 'Flop', hand: '', you: '', verdict: 'correct', heading: '', tags: [], atRisk: [], ...d } as DecisionRecord],
  });

  it('counts a mixed best play by its shares', () => {
    const hands = Array.from({ length: 10 }, (_, i) => hand({ move: 'check', bestMove: 'bet', bestMix: { bet: 0.6, check: 0.4 } }, i));
    const t = heroTendencies(hands);
    expect(t.betWhenFree).toEqual({ you: 0, best: expect.closeTo(6, 9), of: 10 });
    expect(countText(t.betWhenFree.best)).toBe('6');
    expect(countText(5.5)).toBe('about 6');
  });
});

describe('mixes in real hands', () => {
  it('finds close spots at a steady rate, each part within the margin of the best', () => {
    const opts = { lowStakes: true };
    let n = 0, mixed = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const rng = makeRng(seed);
      const g = newGameHand(3, rng, opts);
      let s: HandState = advance(g, g.state, rng, opts);
      for (let t = 0; t < 12 && heroDecides(g, s); t++) {
        const live = liveVillains(g, s);
        if (s.street !== 'preflop' && live.length === 1) {
          const v = live[0];
          const profile = profileOf(g, v);
          const st = situationFromState(s, g.hero, v, narrowHand(s, v, 'pool', opts, profile).range, { heroPreflopAggressor: false, villainProfile: profile });
          const a = analyze(st, comboEquities(st.hero, st.board, st.villainRange));
          const mix = mixOf(a, st.pot, st.bb);
          n++;
          if (mix.length > 1) mixed++;
          for (const p of mix) {
            expect(a.best.ev - p.row.ev).toBeLessThanOrEqual(margins(st.pot, st.bb).correct + 1e-9);
            expect(gradePostflop(st, a, act(p.row)).verdict).toBe('correct');
          }
        }
        const action: Action = s.street === 'preflop' ? botAction(s, rng, opts) : botPostflopAction(s, rng, PROFILES.regular);
        s = advance(g, applyAction(s, action), rng, opts);
      }
    }
    // Measured over 300 hands: 98 of 595 decisions were mixed.
    expect(n).toBeGreaterThan(80);
    expect(mixed / n).toBeGreaterThan(0.05);
    expect(mixed / n).toBeLessThan(0.35);
  }, 60_000);
});
