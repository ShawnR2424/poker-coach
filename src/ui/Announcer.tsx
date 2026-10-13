// One polite live region for the whole app. Screens call `announce` with a sentence (an
// opponent's action, a new card, a grade) and screen readers say it without moving focus.

import { useEffect, useState } from 'react';

const listeners = new Set<(text: string) => void>();

export function announce(text: string) {
  if (text) listeners.forEach((f) => f(text));
}

export function Announcer() {
  const [text, setText] = useState('');
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    let queued = '';
    const f = (next: string) => {
      // Sentences that arrive together are read together. Clearing first means the same
      // sentence twice in a row is still read.
      if (!queued) setText('');
      queued = queued ? `${queued} ${next}` : next;
      clearTimeout(t);
      t = setTimeout(() => { setText(queued); queued = ''; }, 50);
    };
    listeners.add(f);
    return () => { listeners.delete(f); clearTimeout(t); };
  }, []);
  return <div className="sr-only" role="status" aria-live="polite" aria-atomic="true" id="announcer">{text}</div>;
}
