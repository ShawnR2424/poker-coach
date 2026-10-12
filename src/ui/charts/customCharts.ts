// Imported charts are saved in this browser as a chart pack and put in place when the app starts.
// A change reloads the page, so every screen reads the new charts from the start.

import { setCustomCharts, type ChartSet } from '../../engine/preflop/charts';
import { chartCount, makePack, parsePack, type ChartPack } from '../../engine/preflop/chartPack';

export const CUSTOM_KEY = 'custom-charts:v1';

let loaded: ChartPack | null = null;

/** Reads the saved pack and puts its charts in place; a pack that no longer checks out is ignored. */
export function applySavedCharts() {
  try {
    const raw = localStorage.getItem(CUSTOM_KEY);
    loaded = raw ? parsePack(raw) : null;
  } catch {
    loaded = null;
  }
  setCustomCharts(loaded?.charts ?? {});
}

export const savedPack = () => loaded;

/** Saves a set of charts (or clears them when empty) and reloads the app. */
export function saveCharts(name: string, charts: ChartSet) {
  try {
    if (chartCount(charts) === 0) localStorage.removeItem(CUSTOM_KEY);
    else localStorage.setItem(CUSTOM_KEY, JSON.stringify(makePack(name, charts)));
  } catch {
    throw new Error('This browser would not save the charts');
  }
  location.reload();
}
