import type { Card } from '../../engine/cards';
import { PlayingCard } from '../PlayingCard';
import type { StatTile } from './view';

export function HeroStrip({ cards, tiles, madeHand }: { cards: Card[]; tiles: StatTile[]; madeHand: string | null }) {
  return (
    <section className="hero-strip" aria-label="Your hand">
      <div className="hero-cards">
        <div className="cards-group">{cards.map((c) => <PlayingCard key={c} card={c} />)}</div>
        {madeHand && <p className="made-hand">{madeHand}</p>}
      </div>
      <div className="hero-tiles">
        {tiles.map((t) => (
          <div className="stat" key={t.label}>
            <p className="eyebrow">{t.label}</p>
            <p className="stat-value num">{t.value}</p>
            {t.sub && <p className="muted small">{t.sub}</p>}
          </div>
        ))}
      </div>
    </section>
  );
}
