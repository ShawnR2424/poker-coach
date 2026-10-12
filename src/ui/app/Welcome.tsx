// A short guide on first visit: what each section is for. It shows until dismissed, and never
// once hands have been played or imported.

import { useState } from 'react';
import { useSessions } from '../session/store';

const KEY = 'welcome:v1';

function seen(): boolean {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}

export function Welcome({ onPlay }: { onPlay: () => void }) {
  const saved = useSessions();
  const [hidden, setHidden] = useState(seen);
  const played = saved.current.hands.length > 0 || saved.past.some((s) => s.hands.length > 0);
  if (hidden || played) return null;
  const dismiss = () => {
    setHidden(true);
    try { localStorage.setItem(KEY, '1'); } catch { /* storage unavailable: hide for this visit */ }
  };
  return (
    <section className="welcome" aria-labelledby="welcome-h">
      <div className="welcome-inner">
        <h2 id="welcome-h">Welcome to Poker Coach</h2>
        <p>Practice no-limit hold'em decisions and get each one graded, with the reasons and the numbers behind them.</p>
        <ol className="welcome-steps">
          <li><strong>Play</strong> deals hands at a cash table, starting at level 1 (preflop only), and short-stack tournament spots.</li>
          <li><strong>Train</strong> drills postflop spots and range quizzes. Every mistake becomes a Review card that comes back until you have it.</li>
          <li><strong>Tools</strong> holds the equity calculator, the preflop charts and hand history import.</li>
          <li><strong>Progress</strong> tracks your sessions and leaks. Back up your progress from Settings.</li>
        </ol>
        <p className="small muted">The strategy is approximate: preflop charts and opponent tendencies are estimates, not solver output.</p>
        <div className="welcome-actions">
          <button type="button" className="primary" onClick={() => { dismiss(); onPlay(); }}>Start playing</button>
          <button type="button" onClick={dismiss}>Close</button>
        </div>
      </div>
    </section>
  );
}
