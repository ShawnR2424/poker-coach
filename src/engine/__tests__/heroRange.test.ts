// The hero's own range after the flop: the read of their line, and how the model splits the
// range across the actions available. The split has to account for the whole range, and the
// line read has to agree with what the hero actually did.

import { describe, expect, it } from 'vitest';
import { legalActions, type Action } from '../hand';
import { postflopHeroLine, rangeActionOf, rangeActions, strongShare } from '../postflop/heroRange';
import { currentContext } from '../postflop/narrow';
import { buildSpot, POSTFLOP_SPOTS, type PostflopSpotDef } from '../postflop/spots';

const close = (x: number, y: number) => expect(Math.abs(x - y)).toBeLessThan(1e-6);

function readOf(def: PostflopSpotDef) {
  const b = buildSpot(def);
  const ctx = currentContext(b.state, b.hero);
  const line = postflopHeroLine(b.state, b.hero, b.heroRange, b.heroSteps, [b.villainRange], b.heroPreflopAggressor);
  const split = rangeActions(b.heroRange, b.state.players[b.hero].hole, b.state.board, ctx, legalActions(b.state).raise !== null)!;
  return { b, ctx, line, split };
}

const custom = (over: Partial<PostflopSpotDef>): PostflopSpotDef => ({
  id: 'test', title: 'test', setup: '', concept: '', hero: 'BTN', villain: 'BB', heroCards: 'AsKd', villainCards: '9c8c',
  board: '2s7sJs 4h 5d', stacksBB: 100,
  script: [['BTN', { type: 'raise', to: 125 }], ['BB', { type: 'call' }], ['BB', { type: 'check' }]],
  answer: { best: [], mistakes: [] },
  ...over,
});

describe('which hands in your range take each action', () => {
  it('accounts for the whole range in every practice spot', () => {
    for (const def of POSTFLOP_SPOTS) {
      const { split, ctx } = readOf(def);
      const facing = ctx.currentBet > ctx.committed;
      expect(split.rows.map((r) => r.action)).toEqual(facing ? ['fold', 'call', 'raise'] : ['check', 'betSmall', 'betBig']);
      close(split.rows.reduce((a, r) => a + r.share, 0), 1);
      close(Object.values(split.heroFreq).reduce((a, x) => a + x, 0), 1);
      for (const r of split.rows) {
        if (r.share > 0) close(r.classes.reduce((a, c) => a + c.share, 0), 1);
        for (let i = 1; i < r.classes.length; i++) expect(r.classes[i].share).toBeLessThanOrEqual(r.classes[i - 1].share);
      }
    }
  });

  it('bets strong hands more often than air, and folds air more often than strong hands', () => {
    const checkedTo = readOf(custom({})).split;
    const bet = (cls: string) => checkedTo.rows.filter((r) => r.action !== 'check').reduce((a, r) => a + (r.classes.find((c) => c.cls === cls)?.share ?? 0) * r.share, 0);
    expect(bet('setPlus') + bet('twoPair')).toBeGreaterThan(0);
    const facing = readOf(POSTFLOP_SPOTS.find((d) => d.id === 'bb-turn-draw')!).split;
    const fold = facing.rows.find((r) => r.action === 'fold')!;
    const share = (cls: string) => fold.classes.find((c) => c.cls === cls)?.share ?? 0;
    expect(share('air')).toBeGreaterThan(share('setPlus'));
    expect(share('setPlus')).toBe(0);
  });

  it('drops the raise row when the hero cannot raise', () => {
    const { b, ctx } = readOf(POSTFLOP_SPOTS.find((d) => d.id === 'bb-turn-draw')!);
    const split = rangeActions(b.heroRange, b.state.players[b.hero].hole, b.state.board, ctx, false)!;
    expect(split.rows.map((r) => r.action)).toEqual(['fold', 'call']);
    close(split.rows.reduce((a, r) => a + r.share, 0), 1);
  });

  it("puts the hero's action in the right row", () => {
    const { ctx } = readOf(custom({}));
    const pot = ctx.pot;
    expect(rangeActionOf('check', undefined, ctx)).toBe('check');
    expect(rangeActionOf('bet', Math.floor(pot * 0.33), ctx)).toBe('betSmall');
    expect(rangeActionOf('bet', Math.floor(pot * 0.5), ctx)).toBe('betSmall');
    expect(rangeActionOf('bet', Math.ceil(pot * 0.75), ctx)).toBe('betBig');
    for (const a of [{ type: 'fold' }, { type: 'call' }] as Action[]) expect(rangeActionOf(a.type, undefined, ctx)).toBe(a.type);
  });
});

describe('what your line says', () => {
  it('calls a preflop raiser checked to on the flop uncapped, and a preflop caller capped', () => {
    expect(readOf(custom({})).line.capped).toBe(false);
    const bb = readOf(POSTFLOP_SPOTS.find((d) => d.id === 'bb-turn-draw')!).line;
    expect(bb.capped).toBe(true);
    expect(bb.text).toMatch(/^Your check on the turn caps your range/);
  });

  it('names the nut flush blocker when the hero holds it', () => {
    expect(readOf(custom({})).line.text).toContain('You hold the A♠, so nobody else can have the nut flush.');
    expect(readOf(custom({ heroCards: 'AdKd' })).line.text).not.toContain('nut flush');
  });

  it('measures blockers against the opponent range', () => {
    // KK on a K-high board removes most of the opponent's sets of kings and top two pair.
    const kk = readOf(custom({ heroCards: 'KhKc', board: 'Kd7c2h 4s 9d' })).line;
    const low = readOf(custom({ heroCards: '5h5c', board: 'Kd7c2h 4s 9d' })).line;
    expect(kk.blocked).toBeGreaterThan(low.blocked);
    expect(kk.text).toMatch(/Your cards block \d+% of their two pair or better combos/);
  });

  it('says so when the line left no range, instead of inventing one', () => {
    const { b, ctx } = readOf(custom({}));
    const empty = new Float32Array(b.heroRange.length);
    expect(rangeActions(empty, b.state.players[b.hero].hole, b.state.board, ctx, true)).toBeNull();
    const line = postflopHeroLine(b.state, b.hero, empty, [], [b.villainRange], true);
    expect(line.text).toMatch(/no range for you here/);
    expect(line.text).not.toMatch(/nut advantage/);
  });

  it('uses the same nut-advantage numbers as the feedback', () => {
    for (const def of POSTFLOP_SPOTS) {
      const { b, line } = readOf(def);
      close(line.heroStrong, strongShare(b.heroRange, b.state.board, b.state.board));
      expect(line.text).toContain(`${Math.round(line.heroStrong * 100)}% of your range`);
    }
  });
});
