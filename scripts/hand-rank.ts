// Generates data/hand-rank.json: the 169 starting-hand classes ordered by equity against a random hand.
// Used only to order classes when describing what a range kept or dropped. Run: npm run gen:hand-rank

import { writeFileSync } from 'node:fs';
import { computeEquity } from '../src/engine/equity';
import { ALL_CLASSES, CLASS_COMBOS, COMBO_CARDS, parseRange } from '../src/engine/range';

const any = parseRange('22+, A2s+, K2s+, Q2s+, J2s+, T2s+, 92s+, 82s+, 72s+, 62s+, 52s+, 42s+, 32s, A2o+, K2o+, Q2o+, J2o+, T2o+, 92o+, 82o+, 72o+, 62o+, 52o+, 42o+, 32o');
const rows = ALL_CLASSES.map((cls) => {
  const [a, b] = COMBO_CARDS[CLASS_COMBOS.get(cls)![0]];
  const r = computeEquity({ hero: [a, b], board: [], villains: [any], iterations: 40000, seed: 1 });
  return { cls, eq: r.equity };
});
rows.sort((x, y) => y.eq - x.eq);
writeFileSync(
  new URL('../data/hand-rank.json', import.meta.url),
  JSON.stringify({ _about: 'Starting hands ordered by equity vs a random hand (strongest first).', order: rows.map((r) => r.cls) }, null, 0) + '\n',
);
console.log(rows.slice(0, 12).map((r) => `${r.cls} ${(r.eq * 100).toFixed(1)}`).join(', '));
