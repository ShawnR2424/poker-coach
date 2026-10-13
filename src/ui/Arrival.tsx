// Placed inside a panel that appears after the player acts (a grade, a hand result): says the
// panel's news aloud, and if focus was dropped (the pressed button is gone) moves it to the
// panel's main button, so Enter carries on.

import { useEffect, useRef } from 'react';
import { announce } from './Announcer';
import { focusLost } from './a11y';

/** `focus` picks the control to move to; by default the panel's main (primary) button. */
export function Arrival({ text, focus }: { text: string; focus?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    announce(text);
    const panel = ref.current?.parentElement;
    const target = focus
      ? panel?.querySelector<HTMLElement>(focus)
      : panel?.querySelector<HTMLElement>('.fb-actions .primary') ?? panel?.querySelector<HTMLElement>('.primary');
    if (target && focusLost()) target.focus({ preventScroll: true });
    // Only when the panel first appears.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return <span ref={ref} hidden />;
}
