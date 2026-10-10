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

/**
 * The chart seat a position plays from. The charts are written for 6-max; at 7-9 handed the LJ
 * has the same players behind it as the 6-max UTG and uses that chart, and the seats before
 * it are early position: "EP" in the response charts, and EP1 (just before the LJ) to EP3 (UTG
 * at 9-handed) in the open-raise chart.
 */
export function chartSeat(pos: Position, tableSize: number, rfi = false): string {
  if (tableSize === 6) return pos;
  if (pos === 'LJ') return 'UTG';
  if (pos === 'UTG' || pos === 'UTG+1' || pos === 'UTG+2') {
    const order = positionsFor(tableSize);
    return rfi ? `EP${order.indexOf('LJ') - order.indexOf(pos)}` : 'EP';
  }
  return pos;
}

/** Preflop action order of a seat index (seats run clockwise from the SB): 0 for the first to act, the BB last. */
export const preflopOrder = (seat: number, tableSize: number) => (seat + tableSize - 2) % tableSize;
