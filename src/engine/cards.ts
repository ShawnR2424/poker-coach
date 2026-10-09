// Cards are integers 0..51: rank = card >> 2 (0 = deuce .. 12 = ace), suit = card & 3.

export type Card = number;

export const RANKS = '23456789TJQKA';
export const SUITS = 'cdhs';

export const rankOf = (c: Card): number => c >> 2;
export const suitOf = (c: Card): number => c & 3;
export const makeCard = (rank: number, suit: number): Card => (rank << 2) | suit;

export function parseCard(s: string): Card {
  if (s.length !== 2) throw new Error(`Bad card "${s}"`);
  const r = RANKS.indexOf(s[0].toUpperCase());
  const su = SUITS.indexOf(s[1].toLowerCase());
  if (r < 0 || su < 0) throw new Error(`Bad card "${s}"`);
  return makeCard(r, su);
}

/** Parses "AsKd", "As Kd" or "As,Kd" into cards. Throws on duplicates. */
export function parseCards(s: string): Card[] {
  const clean = s.replace(/[\s,]+/g, '');
  if (clean.length % 2 !== 0) throw new Error(`Bad card list "${s}"`);
  const out: Card[] = [];
  for (let i = 0; i < clean.length; i += 2) {
    const c = parseCard(clean.slice(i, i + 2));
    if (out.includes(c)) throw new Error(`Duplicate card ${formatCard(c)}`);
    out.push(c);
  }
  return out;
}

export const formatCard = (c: Card): string => RANKS[rankOf(c)] + SUITS[suitOf(c)];
export const formatCards = (cs: readonly Card[]): string => cs.map(formatCard).join('');

export const isRed = (c: Card): boolean => suitOf(c) === 1 || suitOf(c) === 2;

export const fullDeck = (): Card[] => Array.from({ length: 52 }, (_, i) => i);

/** 52-entry lookup where 1 marks a card that is already in use (board, hero, etc). */
export function deadMask(cards: readonly Card[]): Uint8Array {
  const m = new Uint8Array(52);
  for (const c of cards) m[c] = 1;
  return m;
}
