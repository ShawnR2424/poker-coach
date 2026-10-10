// The approximate range text on the postflop read has to agree with the grid beside it: every
// hand it names is in the grid, and every hand the grid shows at a meaningful weight is named.
// (An earlier prototype's grid left out part of its stated range.)

import { describe, expect, it } from 'vitest';
import { advance, heroDecides, liveVillains, newGameHand } from '../game/levels';
import { applyAction, legalActions, type Action } from '../hand';
import { categorizePostflop } from '../postflop/categories';
import { PROFILES } from '../postflop/model';
import { narrowHand } from '../postflop/narrow';
import { buildSpot, POSTFLOP_SPOTS } from '../postflop/spots';
import { ALL_CLASSES, CLASS_COMBOS, keptShareOf, parseRange, RANGE_TEXT_PARTIAL, summarizeRange, type Range } from '../range';
import { makeRng } from '../rng';
import { parseCards, type Card } from '../cards';

const opts = { lowStakes: true };

/** Classes named by a piece of notation. */
function classesIn(text: string): Set<string> {
  const r = parseRange(text);
  return new Set(ALL_CLASSES.filter((c) => CLASS_COMBOS.get(c)!.some((i) => r[i] > 0)));
}

function check(range: Range, hero: Card[], board: Card[]) {
  const dead = [...hero, ...board];
  const sum = summarizeRange(range, dead);
  // The text is standard notation for exactly the classes it claims.
  expect(classesIn(sum.core)).toEqual(sum.coreClasses);
  expect(classesIn(sum.partial)).toEqual(sum.partialClasses);
  // Something is always named when the range has hands left.
  if (sum.top > 0) expect(sum.coreClasses.size).toBeGreaterThan(0);
  const grid = categorizePostflop(range, hero, board, new Float32Array(range.length));
  const d = new Set(dead);
  for (const cell of grid.cells) {
    const named = sum.coreClasses.has(cell.cls) || sum.partialClasses.has(cell.cls);
    const kept = keptShareOf(range, cell.cls, d);
    if (named) expect(cell.combos, `${cell.cls} is in the text but empty in the grid`).toBeGreaterThan(0);
    else if (kept !== null) expect(kept, `${cell.cls} is in the grid at weight ${kept} but not in the text`).toBeLessThan(RANGE_TEXT_PARTIAL * sum.top);
  }
}

describe('approximate range text after the flop', () => {
  it('matches the grid on every practice spot', () => {
    for (const def of POSTFLOP_SPOTS) {
      const b = buildSpot(def);
      check(b.villainRange, b.state.players[b.hero].hole, b.state.board);
    }
  });

  it('matches the grid on real postflop decisions at every level', () => {
    let n = 0;
    for (const level of [2, 3, 4, 5, 6] as const) {
      for (let seed = 1; seed <= 10; seed++) {
        const rng = makeRng(seed * 977 + level);
        const g = newGameHand(level, rng, opts);
        let s = advance(g, g.state, rng, opts);
        for (let t = 0; t < 12 && heroDecides(g, s); t++) {
          if (s.street !== 'preflop') {
            for (const v of liveVillains(g, s)) {
              check(narrowHand(s, v, 'pool', opts, PROFILES[g.profiles[v]]).range, s.players[g.hero].hole, s.board);
              n++;
            }
          }
          const l = legalActions(s);
          const a: Action = l.call !== null && rng() < 0.7 ? { type: 'call' } : l.check ? { type: 'check' } : { type: 'fold' };
          s = advance(g, applyAction(s, a), rng, opts);
        }
      }
    }
    expect(n).toBeGreaterThan(40);
  });

  it('keeps naming the strongest part of a range after several streets of narrowing', () => {
    const b = buildSpot(POSTFLOP_SPOTS.find((d) => d.id === 'bb-turn-draw')!);
    const sum = summarizeRange(b.villainRange, [...b.state.players[b.hero].hole, ...b.state.board]);
    expect(sum.top).toBeLessThan(RANGE_TEXT_PARTIAL * 4);
    expect(sum.core).not.toBe('');
  });

  it('uses the kept share of live combos, so card removal does not thin a class', () => {
    // AA with one ace on the board: three of six combos are dead; the rest at full weight is "core".
    const range = parseRange('AA');
    const board = parseCards('As7d2c');
    const sum = summarizeRange(range, board);
    expect(sum.coreClasses.has('AA')).toBe(true);
  });
});
