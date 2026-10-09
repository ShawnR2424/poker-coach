// Preset bet and raise sizes for the action buttons, clamped to what is legal.

import { legalActions, pot, type Action, type HandState } from './hand';

export interface SizeOption {
  label: string;
  action: Action;
  allIn: boolean;
}

/** Preset sizes for the player to act. Sizes at or above the stack collapse into a single all-in. */
export function presetSizes(s: HandState): SizeOption[] {
  if (s.toAct === null) return [];
  const legal = legalActions(s);
  const range = legal.bet ?? legal.raise;
  if (!range) return [];
  const type: 'bet' | 'raise' = legal.bet ? 'bet' : 'raise';
  const bb = s.config.bb;

  const candidates: { label: string; to: number }[] = [];
  if (s.street === 'preflop') {
    const raises = s.actions.filter((a) => a.street === 'preflop' && a.type === 'raise').length;
    const limpers = s.actions.filter((a) => a.street === 'preflop' && a.type === 'call').length;
    if (raises === 0 && limpers === 0) {
      candidates.push({ label: '2.5bb', to: 2.5 * bb }, { label: '3bb', to: 3 * bb });
    } else if (raises === 0) {
      candidates.push(
        { label: `${4 + limpers}bb`, to: (4 + limpers) * bb },
        { label: `${5 + limpers}bb`, to: (5 + limpers) * bb },
      );
    } else {
      const mult = raises === 1 ? [3, 4] : [2.2, 2.5];
      for (const m of mult) candidates.push({ label: `${m}x`, to: m * s.currentBet });
    }
  } else if (type === 'bet') {
    const p = pot(s);
    for (const f of [0.33, 0.66, 1]) candidates.push({ label: `${Math.round(f * 100)}% pot`, to: f * p });
  } else {
    for (const m of [2.5, 3.5]) candidates.push({ label: `${m}x`, to: m * s.currentBet });
  }

  const out: SizeOption[] = [];
  const seen = new Set<number>();
  for (const c of candidates) {
    const to = Math.min(range.max, Math.max(range.min, roundChips(c.to, s.config.sb)));
    if (to >= range.max || seen.has(to)) continue;
    seen.add(to);
    out.push({ label: c.label, action: { type, to }, allIn: false });
  }
  out.push({ label: 'All-in', action: { type, to: range.max }, allIn: true });
  return out;
}

/** Rounds to the nearest small-blind unit so sizes look like real bets ($0.25 steps at 25/50). */
function roundChips(x: number, unit: number): number {
  return Math.max(unit, Math.round(x / unit) * unit);
}
