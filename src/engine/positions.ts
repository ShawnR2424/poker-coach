// Seat labels for 6- to 9-handed tables, listed in preflop action order (first to act ... BB).

export type Position = 'UTG' | 'UTG+1' | 'UTG+2' | 'LJ' | 'HJ' | 'CO' | 'BTN' | 'SB' | 'BB';

const BY_SIZE: Record<number, Position[]> = {
  6: ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'],
  7: ['UTG', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'],
  8: ['UTG', 'UTG+1', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'],
  9: ['UTG', 'UTG+1', 'UTG+2', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'],
};

export function positionsFor(tableSize: number): Position[] {
  const p = BY_SIZE[tableSize];
  if (!p) throw new Error(`Table size must be 6-9, got ${tableSize}`);
  return [...p];
}

/**
 * Positions in clockwise seat order starting from the SB (the order chips move around the table).
 * Postflop action order is the same: SB, BB, then UTG ... BTN.
 */
export function clockwiseFromSB(tableSize: number): Position[] {
  const p = positionsFor(tableSize);
  return [...p.slice(-2), ...p.slice(0, -2)];
}
