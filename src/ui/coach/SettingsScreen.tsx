// Settings: the optional Claude coach voice. Off by default; the trainer works fully without it.

import { useState } from 'react';
import { SYSTEM_PROMPT } from '../../engine/coach/explain';
import { MODEL_NAME } from './model';
import { coachVoiceOn, setCoachSettings, useCoachSettings } from './settings';
import './coach.css';

export function SettingsScreen() {
  const s = useCoachSettings();
  const [draft, setDraft] = useState('');
  const hasKey = s.apiKey.trim().length > 0;
  const masked = hasKey ? `${s.apiKey.slice(0, 7)}…${s.apiKey.slice(-4)}` : '';

  return (
    <div className="screen settings-screen">
      <div>
        <p className="eyebrow">Settings</p>
        <h1>Coach voice</h1>
      </div>

      <section className="panel" aria-labelledby="voice-h">
        <h2 id="voice-h">Explanations written by Claude</h2>
        <p>
          With this on, each graded decision also gets a short explanation in a coaching voice, written by {MODEL_NAME} through the Claude API.
          The trainer still computes every number and verdict. Claude is only given the facts already on the feedback panel and is told to use no other numbers.
          A reply that contains a number the trainer did not compute is not shown.
        </p>
        <label className="switch">
          <input type="checkbox" checked={s.enabled} onChange={(e) => setCoachSettings({ enabled: e.target.checked })} />
          <span>Add Claude's explanation to graded decisions</span>
        </label>
        {s.enabled && !hasKey && <p className="note">Add an API key below to turn explanations on.</p>}
        {coachVoiceOn(s) && <p className="note ok">On. Explanations appear under the verdict on the next graded decision.</p>}
      </section>

      <section className="panel" aria-labelledby="key-h">
        <h2 id="key-h">Your API key</h2>
        <p className="muted">
          Use your own key from the Claude Console. It is saved only in this browser's local storage and is sent only to the Claude API, directly from this page.
          Requests are billed to your account. Anyone with access to this browser profile can read the key, so use a key you can revoke.
        </p>
        {hasKey ? (
          <div className="key-row">
            <span className="num key-mask">{masked}</span>
            <button type="button" onClick={() => setCoachSettings({ apiKey: '' })}>Remove key</button>
          </div>
        ) : (
          <form
            className="key-row"
            onSubmit={(e) => {
              e.preventDefault();
              if (draft.trim()) setCoachSettings({ apiKey: draft.trim() });
              setDraft('');
            }}
          >
            <label className="sr-only" htmlFor="api-key">Claude API key</label>
            <input id="api-key" type="password" autoComplete="off" spellCheck={false} placeholder="sk-ant-…" value={draft} onChange={(e) => setDraft(e.target.value)} />
            <button type="submit" className="primary" disabled={!draft.trim()}>Save key</button>
          </form>
        )}
      </section>

      <details className="panel">
        <summary>What Claude is told</summary>
        <p className="muted small">The instructions sent with every request. The facts that follow them are the spot, your cards, your action, the verdict, the trainer's reasons, the EV table and the key concept. Opponents' cards are never sent.</p>
        <pre className="prompt">{SYSTEM_PROMPT}</pre>
      </details>
    </div>
  );
}
