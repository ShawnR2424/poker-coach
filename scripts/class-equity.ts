// Generates data/tournament/class-equity.json: all-in preflop equity of every starting-hand class
// against every other, for the push/fold model. Each pair is sampled over random compatible combo
// pairs and random boards (card removal included). Run: npm run gen:class-equity
//
//   SAMPLES=20000 npm run gen:class-equity   # samples per class pair (default 20000)

import { writeFileSync } from 'node:fs';
import { evaluate } from '../src/engine/evaluator';
import { ALL_CLASSES, CLASS_COMBOS, COMBO_CARDS } from '../src/engine/range';
import { makeRng } from '../src/engine/rng';

const SAMPLES = Number(process.env.SAMPLES ?? 20000);
const rng = makeRng(20261011);
const n = ALL_CLASSES.length;
const out: number[] = [];
const a7 = new Array<number>(7), b7 = new Array<number>(7);
const deck = new Int8Array(52);
const t0 = Date.now();

for (let i = 0; i < n; i++) {
  for (let j = i; j < n; j++) {
    const pairs: [number, number][] = [];
    for (const x of CLASS_COMBOS.get(ALL_CLASSES[i])!) {
      for (const y of CLASS_COMBOS.get(ALL_CLASSES[j])!) {
        const [p, q] = COMBO_CARDS[x], [r, s] = COMBO_CARDS[y];
        if (p !== r && p !== s && q !== r && q !== s) pairs.push([x, y]);
      }
    }
    let won = 0;
    for (let k = 0; k < SAMPLES; k++) {
      const [x, y] = pairs[k % pairs.length];
      const [p, q] = COMBO_CARDS[x], [r, s] = COMBO_CARDS[y];
      deck.fill(0);
      deck[p] = deck[q] = deck[r] = deck[s] = 1;
      a7[0] = p; a7[1] = q; b7[0] = r; b7[1] = s;
      for (let m = 2; m < 7; m++) {
        let c: number;
        do c = Math.floor(rng() * 52); while (deck[c]);
        deck[c] = 1;
        a7[m] = b7[m] = c;
      }
      const ea = evaluate(a7), eb = evaluate(b7);
      won += ea > eb ? 1 : ea === eb ? 0.5 : 0;
    }
    out.push(Math.round((won / SAMPLES) * 1000));
  }
  if (i % 20 === 0) console.log(`${i}/${n} rows, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

writeFileSync(
  new URL('../data/tournament/class-equity.json', import.meta.url),
  JSON.stringify({
    _about: `All-in preflop equity (per mille) of each starting-hand class against each other, upper triangle by row in the order of ALL_CLASSES (row i holds classes i..168). ${SAMPLES} random combo pairs and boards per class pair.`,
    samples: SAMPLES,
    equity: out,
  }) + '\n',
);
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
