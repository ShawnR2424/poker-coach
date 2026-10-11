// Opponent stats: postflop actions are counted per style, preflop and the hero are ignored, and
// over a real session each style's notes describe how that style actually plays.

import { describe, expect, it } from 'vitest';
import { practiceHand } from '../game/drills';
import { advance, heroDecides } from '../game/levels';
import { applyAction, legalActions, type Action, type ActionRecord, type HandState } from '../hand';
import type { ProfileId } from '../postflop/model';
import { makeRng, type Rng } from '../rng';
import { IMPORTED_LEVEL } from '../session/import';
import { countHand, MIN_ACTIONS, MIN_FACING, poolStats, readStats, styleStats, type StyleStats } from '../session/hud';
import { replayOf } from '../session/replay';
import type { HandRecord } from '../session/session';

const opts = { lowStakes: true };

const act = (street: ActionRecord['street'], player: number, type: ActionRecord['type'], to = 0): ActionRecord =>
  ({ street, player, type, added: 0, to, allIn: false });

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

function playedHands(n: number, seed: number): HandRecord[] {
  const rng = makeRng(seed);
  const out: HandRecord[] = [];
  for (let i = 0; i < n; i++) {
    const level = ([3, 4, 5] as const)[i % 3];
    const g = practiceHand(level, rng, opts, []);
    let s = advance(g, g.state, rng, opts);
    while (heroDecides(g, s)) s = advance(g, applyAction(s, randomAction(s, rng)), rng, opts);
    out.push({
      n: i + 1, at: '2026-10-11T12:00:00.000Z', level, spot: '', hand: '', net: 0, bb: s.config.bb, decided: true,
      decisions: [], lesson: '', replay: replayOf(s, g.hero, g.villains, g.profiles),
    });
  }
  return out;
}

describe('counting one hand', () => {
  it('counts postflop decisions by style, facing bets and folds, and ignores preflop and the hero', () => {
    const out = new Map<ProfileId, StyleStats>();
    countHand([
      act('preflop', 1, 'post', 1), act('preflop', 2, 'post', 2), act('preflop', 0, 'raise', 6),
      act('preflop', 1, 'fold'), act('preflop', 2, 'call', 6),
      // Flop: the nit checks, the hero bets, the nit calls.
      act('flop', 2, 'check'), act('flop', 0, 'bet', 4), act('flop', 2, 'call', 4),
      // Turn: the nit bets, the hero raises, the nit folds.
      act('turn', 2, 'bet', 8), act('turn', 0, 'raise', 24), act('turn', 2, 'fold'),
    ], { 1: 'station', 2: 'nit' }, out);
    expect(out.get('nit')).toEqual({ hands: 1, facingBet: 2, folded: 1, actions: 4, aggressive: 1 });
    // The station only acted preflop, so it has no postflop stats.
    expect(out.has('station')).toBe(false);
  });

  it('does not count a check as facing a bet after the street changes', () => {
    const out = new Map<ProfileId, StyleStats>();
    countHand([act('flop', 0, 'bet', 4), act('flop', 1, 'call', 4), act('turn', 1, 'check'), act('turn', 0, 'check')], { 1: 'aggro' }, out);
    expect(out.get('aggro')).toEqual({ hands: 1, facingBet: 1, folded: 0, actions: 2, aggressive: 0 });
  });
});

describe('reading the stats', () => {
  const table: StyleStats = { hands: 100, facingBet: 200, folded: 80, actions: 400, aggressive: 100 };

  it('says nothing until there are enough decisions', () => {
    const r = readStats({ hands: 3, facingBet: MIN_FACING - 1, folded: MIN_FACING - 1, actions: MIN_ACTIONS - 1, aggressive: 0 }, table);
    expect(r.foldToBet).toBeNull();
    expect(r.aggression).toBeNull();
    expect(r.notes).toEqual([]);
    expect(readStats(undefined, table).notes).toEqual([]);
  });

  it('compares each rate with the table', () => {
    const r = readStats({ hands: 20, facingBet: 40, folded: 30, actions: 60, aggressive: 3 }, table);
    expect(r.foldToBet).toBeCloseTo(0.75);
    expect(r.tableFoldToBet).toBeCloseTo(0.4);
    expect(r.notes.join(' ')).toMatch(/Folds to bets more than the table: bluff them more/);
    expect(r.notes.join(' ')).toMatch(/Bets and raises less than the table/);
    expect(readStats({ hands: 20, facingBet: 40, folded: 16, actions: 60, aggressive: 15 }, table).notes).toEqual([]);
  });
});

describe('a session of practice hands', () => {
  const hands = playedHands(900, 11);

  it('skips imported and level 1 hands', () => {
    const imported = hands.slice(0, 30).map((h) => ({ ...h, level: IMPORTED_LEVEL }));
    const level1 = hands.slice(0, 30).map((h) => ({ ...h, level: 1 }));
    expect(styleStats([...imported, ...level1]).size).toBe(0);
  });

  it('tells each style apart the way it plays', () => {
    const stats = styleStats(hands);
    const table = poolStats(stats);
    const notes = (p: ProfileId) => readStats(stats.get(p), table).notes.join(' ');
    for (const p of ['nit', 'station', 'aggro', 'regular'] as const) expect(stats.get(p)!.facingBet).toBeGreaterThanOrEqual(MIN_FACING);
    const fold = (p: ProfileId) => stats.get(p)!.folded / stats.get(p)!.facingBet;
    const aggression = (p: ProfileId) => stats.get(p)!.aggressive / stats.get(p)!.actions;
    expect(fold('nit')).toBeGreaterThan(fold('regular'));
    expect(fold('regular')).toBeGreaterThan(fold('station'));
    expect(aggression('aggro')).toBeGreaterThan(aggression('regular'));
    expect(aggression('regular')).toBeGreaterThan(aggression('station'));
    expect(notes('nit')).toMatch(/Folds to bets more/);
    expect(notes('station')).toMatch(/Folds to bets less/);
    expect(notes('aggro')).toMatch(/Bets and raises more/);
    // The regular plays close to the table, so it never gets the opposite style's note.
    expect(notes('regular')).not.toMatch(/Folds to bets less|Bets and raises more/);
  }, 120_000);
});
