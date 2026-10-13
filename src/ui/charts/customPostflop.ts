// Imported postflop solver spots are saved in this browser as a postflop pack and turned into the
// opponents' tables when the app starts. A change reloads the page, as imported charts do.

import { setPostflopOverrides } from '../../engine/postflop/model';
import { makePostflopPack, overridesFrom, parsePostflopPack, type PostflopPack, type SolverSpot } from '../../engine/postflop/solverImport';

export const POSTFLOP_KEY = 'custom-postflop:v1';

let loaded: PostflopPack | null = null;

/** Reads the saved pack and puts its tables in place; a pack that no longer checks out is ignored. */
export function applySavedPostflop() {
  try {
    const raw = localStorage.getItem(POSTFLOP_KEY);
    loaded = raw ? parsePostflopPack(raw) : null;
  } catch {
    loaded = null;
  }
  setPostflopOverrides(loaded ? overridesFrom(loaded.spots) : {});
}

export const savedPostflopPack = () => loaded;

/** Saves the spots (or clears them when there are none) and reloads the app. */
export function savePostflop(name: string, spots: SolverSpot[]) {
  try {
    if (!spots.length) localStorage.removeItem(POSTFLOP_KEY);
    else localStorage.setItem(POSTFLOP_KEY, JSON.stringify(makePostflopPack(name, spots)));
  } catch {
    throw new Error('This browser would not save the spots');
  }
  location.reload();
}
