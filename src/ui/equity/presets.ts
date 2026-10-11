// Ranges the Equity tab can fill a player's field from: the trainer's own 100bb charts.

import { chartKeys, rangeTexts, baseStrategy } from '../../engine/preflop/explorer';

export interface ChartPreset {
  id: string;
  group: string;
  label: string;
  text: string;
}

let cache: ChartPreset[] | null = null;

/** Opening ranges by seat, and each seat's 3-bet and calling ranges against an open. */
export function chartPresets(): ChartPreset[] {
  if (cache) return cache;
  const out: ChartPreset[] = [];
  for (const { key, label } of chartKeys('rfi')) {
    const t = rangeTexts(baseStrategy('rfi', key));
    if (t.raise) out.push({ id: `rfi:${key}`, group: 'Opens', label, text: t.raise });
  }
  for (const { key, label } of chartKeys('vsOpen')) {
    const t = rangeTexts(baseStrategy('vsOpen', key));
    if (t.raise) out.push({ id: `3bet:${key}`, group: '3-bets', label: label.replace('facing', '3-bets against'), text: t.raise });
    if (t.call) out.push({ id: `call:${key}`, group: 'Calls', label: label.replace('facing', 'calls'), text: t.call });
  }
  cache = out;
  return out;
}
