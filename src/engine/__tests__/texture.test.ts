import { afterEach, describe, expect, it } from 'vitest';
import { parseCards } from '../cards';
import { POSTFLOP_CLASSES } from '../postflop/classify';
import { postflopFeedback } from '../postflop/coach';
import { ACTIONS, continueProb, firstToActFreq, narrowPostflop, PROFILES, rangeDefenseOn, responseFor, setPostflopOverrides, textureOf } from '../postflop/model';
import { overridesFrom, type ActFreq, type FacingFreq, type SolverSpot } from '../postflop/solverImport';
import { boardTexture, straightPossible, TEXTURES } from '../postflop/texture';
import { parseRange } from '../range';
import { analyze, gradePostflop, type PostflopSituation } from '../postflop/recommend';
import { comboEquities } from '../equity';

afterEach(() => setPostflopOverrides({}));

const tex = (b: string) => boardTexture(parseCards(b));

describe('boardTexture', () => {
  it('sorts flops into the five textures', () => {
    expect(tex('As7d2c')).toBe('dryHigh');
    expect(tex('Kh7h2c')).toBe('dryHigh'); // two-tone, but the ranks are spread out
    expect(tex('Qs7d2c')).toBe('dryLow');
    expect(tex('JhTs8c')).toBe('wet');
    expect(tex('9h8h3c')).toBe('wet');
    expect(tex('7s7d2c')).toBe('paired');
    expect(tex('7h7d2h')).toBe('paired');
    expect(tex('Ah8h3h')).toBe('monotone');
  });

  it('counts the ace low for straights', () => {
    expect(straightPossible(parseCards('As5d2c'))).toBe(true);
    expect(straightPossible(parseCards('AsKdQc'))).toBe(true);
    expect(straightPossible(parseCards('As9d2c'))).toBe(false);
    expect(tex('As5d2c')).toBe('wet');
  });

  it('follows the board as the turn and river come', () => {
    expect(tex('Ks7d2c3h')).toBe('dryHigh');
    expect(tex('Ks7d5c6h')).toBe('wet');
    expect(tex('Ks7d2cKh')).toBe('paired');
    expect(tex('Ks7d2c3s9s')).toBe('monotone');
    // A two-tone river cannot hold a flush draw any more.
    expect(tex('Ks9d2c3s4d')).toBe('wet');
    expect(tex('KsTd2s7c4d')).toBe('dryHigh');
  });

  it('needs a flop', () => {
    expect(() => boardTexture(parseCards('AsKd'))).toThrow();
    expect(textureOf(parseCards('AsKd'))).toBeUndefined();
  });
});

describe('texture tables', () => {
  it('give every texture a positive multiplier for every class and a line for the feedback', () => {
    for (const t of TEXTURES) {
      const row = ACTIONS.textures[t];
      expect(row.about.length).toBeGreaterThan(20);
      for (const field of ['betSmall', 'betBig', 'continue'] as const) {
        for (const cls of POSTFLOP_CLASSES) expect(row[field][cls]).toBeGreaterThan(0);
      }
    }
  });

  it('bet small with air more on a dry high board than on a wet one, and big with strong hands less', () => {
    expect(firstToActFreq('air', false, undefined, 'dryHigh').small).toBeGreaterThan(firstToActFreq('air', false, undefined, 'wet').small);
    expect(firstToActFreq('overpair', false, undefined, 'wet').big).toBeGreaterThan(firstToActFreq('overpair', false, undefined, 'dryHigh').big);
    expect(firstToActFreq('topPairGood', false, undefined, 'monotone').big).toBeLessThan(firstToActFreq('topPairGood').big);
  });

  it('fold weak pairs more to a bet on a wet or three-suited board, and keep draws in', () => {
    expect(continueProb('weakPair', 0.66, false, undefined, 1, 'wet')).toBeLessThan(continueProb('weakPair', 0.66, false, undefined, 1, 'dryHigh'));
    expect(continueProb('middlePair', 0.66, false, undefined, 1, 'monotone')).toBeLessThan(continueProb('middlePair', 0.66));
    expect(continueProb('strongDraw', 0.66, false, undefined, 1, 'wet')).toBeGreaterThanOrEqual(continueProb('strongDraw', 0.66));
  });

  it('keep every response a valid split on every texture and style', () => {
    for (const t of TEXTURES) {
      for (const profile of Object.values(PROFILES)) {
        for (const cls of POSTFLOP_CLASSES) {
          const fr = firstToActFreq(cls, false, profile, t);
          expect(fr.check + fr.small + fr.big).toBeCloseTo(1, 9);
          expect(Math.min(fr.check, fr.small, fr.big)).toBeGreaterThanOrEqual(0);
          for (const f of [0.33, 0.75, 1.5, 3]) {
            const r = responseFor(cls, f, true, false, profile, 1, t);
            expect(r.fold + r.call + r.raise).toBeCloseTo(1, 9);
            expect(Math.min(r.fold, r.call, r.raise)).toBeGreaterThanOrEqual(0);
          }
        }
      }
    }
  });

  it('narrow a range with the same texture the bots play by', () => {
    const board = parseCards('JhTs8c');
    const range = parseRange('22+,A2s+,K9s+,QTs+,JTs,ATo+,KJo+');
    const bet = narrowPostflop(range, board, { kind: 'bet', f: 0.75 });
    // Every live combo keeps the share its class bets big on this wet board.
    let checked = 0;
    for (let i = 0; i < range.length && checked < 50; i++) {
      if (!(range[i] > 0) || !(bet[i] > 0)) continue;
      expect(bet[i] / range[i]).toBeLessThanOrEqual(1);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
    // The defense floor sees the texture too: a range defends at least the floor on any board.
    const d = rangeDefenseOn(range, board, 0.75);
    expect(d.factor).toBeGreaterThanOrEqual(1);
  });
});

const act = (w: number, small: number, big: number): ActFreq => ({ w, check: 1 - small - big, small, big });
const facing = (w: number, fold: number, raise: number): FacingFreq => ({ w, fold, call: 1 - fold - raise, raise });

describe('imported solver spots by texture', () => {
  const spots: SolverSpot[] = [
    { label: 'dry c-bet', board: 'Ks7d2c', kind: 'act', classes: { air: act(1, 0.7, 0) } },
    { label: 'wet c-bet', board: 'JhTs8c', kind: 'act', classes: { air: act(1, 0.1, 0.2) } },
    { label: 'wet vs bet', board: 'JhTs8c', kind: 'facingBet', f: 0.5, classes: { weakPair: facing(1, 0.7, 0) } },
  ];

  it('keeps each texture its own figures and the average for the rest', () => {
    const o = overridesFrom(spots);
    expect(o.firstToAct?.betSmall?.air).toBeCloseTo(0.4);
    expect(o.byTexture?.dryHigh?.firstToAct?.betSmall?.air).toBeCloseTo(0.7);
    expect(o.byTexture?.wet?.firstToAct?.betSmall?.air).toBeCloseTo(0.1);
    expect(o.byTexture?.wet?.facingBet?.base?.weakPair).toBeDefined();
    expect(o.byTexture?.dryHigh?.facingBet).toBeUndefined();
    expect(o.byTexture?.paired).toBeUndefined();
  });

  it('plays the solver figures on their texture and scales the average elsewhere', () => {
    setPostflopOverrides(overridesFrom(spots));
    expect(firstToActFreq('air', false, undefined, 'dryHigh').small).toBeCloseTo(0.7);
    expect(firstToActFreq('air', false, undefined, 'wet').small).toBeCloseTo(0.1);
    expect(firstToActFreq('air', false, undefined, 'wet').big).toBeCloseTo(0.2);
    expect(firstToActFreq('air', false, undefined, 'paired').small).toBeCloseTo(0.4 * ACTIONS.textures.paired.betSmall.air);
    // The fitted line is the solver's, with no multiplier on top.
    expect(continueProb('weakPair', 0.5, false, undefined, 1, 'wet')).toBeCloseTo(0.3);
  });
});

describe('board in the feedback', () => {
  it('names the texture and what it changes', () => {
    const board = parseCards('JhTs8c');
    const sit: PostflopSituation = {
      hero: parseCards('AhAd'), board, street: 'flop', pot: 600, heroCommitted: 0, villainCommitted: 0,
      heroBehind: 9700, villainBehind: 9700, bb: 100, heroInPosition: true,
      villainRange: parseRange('22+,A2s+,K9s+,QTs+,JTs,ATo+,KJo+'),
      options: [{ kind: 'check', label: 'Check' }, { kind: 'bet', to: 400, label: 'Bet 400' }],
      heroInvested: 300, heroPreflopAggressor: true, heroFirstToAct: false,
    };
    const a = analyze(sit, comboEquities(sit.hero, board, sit.villainRange));
    const g = gradePostflop(sit, a, { type: 'bet', to: 400 });
    const text = postflopFeedback(sit, a, g, [], []).bullets.join(' ');
    expect(text).toContain('Board: connected or two-tone.');
    expect(text).toContain(ACTIONS.textures.wet.about);
  });
});
