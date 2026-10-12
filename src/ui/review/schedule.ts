// What happens to a review card after an answer, in words, shared by hand and tournament cards.

import { INTERVAL_DAYS, type ReviewCard } from '../../engine/review/review';
import type { Verdict } from '../../engine/session/session';

/** `after` is the card as scheduled now, or undefined once it has left the deck. */
export function scheduleText(after: ReviewCard | undefined, verdict: Verdict | undefined): string {
  if (!after) return 'Learned: this card leaves the deck.';
  if (verdict === 'correct') return `This card moves to box ${after.box + 1} and comes back after ${INTERVAL_DAYS[after.box]} day${INTERVAL_DAYS[after.box] === 1 ? '' : 's'}.`;
  if (verdict === 'playable') return 'Close, but not the play this card teaches: it comes back tomorrow.';
  return 'It comes back in a few minutes.';
}
