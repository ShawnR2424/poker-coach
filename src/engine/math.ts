// Decision math. Every number shown to the user comes from here or from equity.ts.

/** Equity needed to call: call / (pot + call). `pot` already includes the opponent's bet. */
export function potOdds(toCall: number, pot: number): number {
  if (toCall <= 0) return 0;
  return toCall / (pot + toCall);
}

export interface BreakEvenInput {
  /** Pot before hero's bet or shove (what hero wins when everyone folds). */
  pot: number;
  /** Chips hero puts in with this bet or shove. */
  risk: number;
  /** Hero's equity when called, 0..1 (0 for a pure bluff). */
  equityWhenCalled?: number;
  /** Pot at showdown when called. Defaults to pot + risk + an equal call. */
  finalPot?: number;
}

/**
 * Fold frequency at which a bet breaks even. Solves
 *   fold% × pot = (1 − fold%) × (risk − equity × finalPot)
 * Returns 0 when the bet is profitable even if always called.
 */
export function breakEvenFoldPct({ pot, risk, equityWhenCalled = 0, finalPot }: BreakEvenInput): number {
  const fp = finalPot ?? pot + 2 * risk;
  const lossWhenCalled = risk - equityWhenCalled * fp;
  if (lossWhenCalled <= 0) return 0;
  return lossWhenCalled / (pot + lossWhenCalled);
}

export interface BetEvInput {
  pot: number;
  bet: number;
  /** Chips the opponent adds when calling. Defaults to `bet`. */
  callAmount?: number;
  foldPct: number;
  equityWhenCalled: number;
}

/** EV of a bet relative to giving up now (hero's chips already in the pot are sunk). */
export function betEv({ pot, bet, callAmount = bet, foldPct, equityWhenCalled }: BetEvInput): number {
  const whenCalled = equityWhenCalled * (pot + bet + callAmount) - bet;
  return foldPct * pot + (1 - foldPct) * whenCalled;
}

/** EV of calling `toCall` into `pot` (pot includes the opponent's bet), relative to folding. */
export function callEv(toCall: number, pot: number, equity: number): number {
  return equity * (pot + toCall) - toCall;
}

/** Stack-to-pot ratio. */
export function spr(effectiveStack: number, pot: number): number {
  return pot > 0 ? effectiveStack / pot : Infinity;
}

/** Minimum defense frequency: share of range that must continue so a pure bluff doesn't auto-profit. */
export function mdf(pot: number, bet: number): number {
  return pot / (pot + bet);
}
