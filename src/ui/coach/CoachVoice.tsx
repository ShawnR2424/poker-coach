// Coaching prose from Claude under a graded decision, when switched on in Settings. The
// trainer's own explanation stays on screen either way; this only adds to it.

import { useEffect, useState } from 'react';
import type { CoachFacts } from '../../engine/coach/explain';
import type { Explanation } from './claude';
import { coachVoiceOn, useCoachSettings } from './settings';

const cache = new Map<string, Explanation>();

export function CoachVoice({ facts }: { facts: CoachFacts }) {
  const settings = useCoachSettings();
  const on = coachVoiceOn(settings);
  const key = JSON.stringify(facts);
  const [result, setResult] = useState<Explanation | null>(() => cache.get(key) ?? null);

  useEffect(() => {
    if (!on) return;
    const hit = cache.get(key);
    setResult(hit ?? null);
    if (hit) return;
    const ctrl = new AbortController();
    import('./claude')
      .then(({ explain }) => explain(JSON.parse(key) as CoachFacts, settings.apiKey, ctrl.signal))
      .then((r) => {
        if (ctrl.signal.aborted) return;
        if (r.ok) cache.set(key, r);
        setResult(r);
      })
      .catch(() => { if (!ctrl.signal.aborted) setResult({ ok: false, reason: 'Could not load the Claude client.' }); });
    return () => ctrl.abort();
  }, [on, key, settings.apiKey]);

  if (!on) return null;
  return (
    <div className="coach-voice" aria-live="polite">
      <p className="eyebrow">Coach</p>
      {result === null && <p className="muted">Writing an explanation…</p>}
      {result?.ok && <p>{result.text}</p>}
      {result && !result.ok && <p className="muted small">{result.reason} The trainer's explanation above is complete without it.</p>}
    </div>
  );
}
