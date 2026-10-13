import { RANKS, isRed, rankOf, suitOf, type Card } from '../engine/cards';
import { cardName } from './a11y';

const SUIT_GLYPHS = ['♣', '♦', '♥', '♠'];

export function PlayingCard({ card, size = 'md', highlight = false }: { card: Card; size?: 'xs' | 'sm' | 'md'; highlight?: boolean }) {
  const rank = RANKS[rankOf(card)] === 'T' ? '10' : RANKS[rankOf(card)];
  return (
    <span
      className={`pcard pcard-${size}${isRed(card) ? ' red' : ''}${highlight ? ' newest' : ''}`}
      role="img"
      aria-label={cardName(card)}
    >
      <span className="pcard-rank" aria-hidden="true">{rank}</span>
      <span className="pcard-suit" aria-hidden="true">{SUIT_GLYPHS[suitOf(card)]}</span>
    </span>
  );
}

export function CardSlot({ size = 'md' }: { size?: 'xs' | 'sm' | 'md' }) {
  return <span className={`pcard pcard-${size} empty`} aria-hidden="true" />;
}
