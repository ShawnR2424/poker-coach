import { RANKS, isRed, rankOf, suitOf, type Card } from '../engine/cards';

const SUIT_GLYPHS = ['♣', '♦', '♥', '♠'];

export function PlayingCard({ card, size = 'md', highlight = false }: { card: Card; size?: 'sm' | 'md'; highlight?: boolean }) {
  const rank = RANKS[rankOf(card)] === 'T' ? '10' : RANKS[rankOf(card)];
  return (
    <span
      className={`pcard pcard-${size}${isRed(card) ? ' red' : ''}${highlight ? ' newest' : ''}`}
      aria-label={`${rank} of ${['clubs', 'diamonds', 'hearts', 'spades'][suitOf(card)]}`}
    >
      <span className="pcard-rank">{rank}</span>
      <span className="pcard-suit">{SUIT_GLYPHS[suitOf(card)]}</span>
    </span>
  );
}

export function CardSlot({ size = 'md' }: { size?: 'sm' | 'md' }) {
  return <span className={`pcard pcard-${size} empty`} aria-hidden="true" />;
}
