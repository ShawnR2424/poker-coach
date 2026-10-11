// All-in preflop equity between starting-hand classes, from data/tournament/class-equity.json,
// and how many combo pairs of two classes can be dealt together (card removal).

import table from '../../../data/tournament/class-equity.json';
import { ALL_CLASSES, CLASS_COMBOS, COMBO_CARDS, type HandClass } from '../range';

export const NUM_CLASSES = ALL_CLASSES.length;
export const CLASS_INDEX: ReadonlyMap<HandClass, number> = new Map(ALL_CLASSES.map((c, i) => [c, i]));

/** EQUITY[i * 169 + j]: class i's share of the pot all-in preflop against class j. */
export const EQUITY: Float32Array = (() => {
  const out = new Float32Array(NUM_CLASSES * NUM_CLASSES);
  let k = 0;
  for (let i = 0; i < NUM_CLASSES; i++) {
    for (let j = i; j < NUM_CLASSES; j++) {
      const e = table.equity[k++] / 1000;
      out[i * NUM_CLASSES + j] = e;
      out[j * NUM_CLASSES + i] = i === j ? 0.5 : 1 - e;
    }
  }
  return out;
})();

/** COMPAT[i * 169 + j]: combo pairs of classes i and j that share no card. */
export const COMPAT: Uint8Array = (() => {
  const out = new Uint8Array(NUM_CLASSES * NUM_CLASSES);
  for (let i = 0; i < NUM_CLASSES; i++) {
    const a = CLASS_COMBOS.get(ALL_CLASSES[i])!;
    for (let j = i; j < NUM_CLASSES; j++) {
      const b = CLASS_COMBOS.get(ALL_CLASSES[j])!;
      let n = 0;
      for (const x of a) {
        const [p, q] = COMBO_CARDS[x];
        for (const y of b) {
          const [r, s] = COMBO_CARDS[y];
          if (p !== r && p !== s && q !== r && q !== s) n++;
        }
      }
      out[i * NUM_CLASSES + j] = out[j * NUM_CLASSES + i] = n;
    }
  }
  return out;
})();

/** COMPAT as floats, and COMPAT times EQUITY, for the solver's inner loops. */
export const COMPAT_F: Float64Array = Float64Array.from(COMPAT);
export const COMPAT_EQ: Float64Array = COMPAT_F.map((c, i) => c * EQUITY[i]);
/** Combo pairs class j can be dealt against, over all classes. */
export const COMPAT_TOTAL: Float64Array = Float64Array.from({ length: NUM_CLASSES }, (_, j) => {
  let t = 0;
  for (let k = 0; k < NUM_CLASSES; k++) t += COMPAT[j * NUM_CLASSES + k];
  return t;
});

/** Combos in each class: 6 for a pair, 4 suited, 12 offsuit. */
export const CLASS_SIZE: Uint8Array = Uint8Array.from(ALL_CLASSES, (c) => CLASS_COMBOS.get(c)!.length);
