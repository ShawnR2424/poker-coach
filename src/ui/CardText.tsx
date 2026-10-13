// Cards written as text ("AsKh", "Flop Ks7d2c") shown as they are, and read aloud by name.

import { parseCard } from '../engine/cards';
import { cardName } from './a11y';

const RUN = /\b(?:[2-9TJQKA][cdhs])+\b/g;

/** The text with each run of cards spoken by name: "Flop king of spades, 7 of diamonds, 2 of clubs". */
export function spokenCards(text: string): string {
  return text.replace(RUN, (run) => run.match(/../g)!.map((c) => cardName(parseCard(c))).join(', '));
}

export function CardText({ text }: { text: string }) {
  const spoken = spokenCards(text);
  if (spoken === text) return <>{text}</>;
  return (
    <>
      <span aria-hidden="true">{text}</span>
      <span className="sr-only">{spoken}</span>
    </>
  );
}
