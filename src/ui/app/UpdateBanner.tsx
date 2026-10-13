// The prompt shown when a new version of the app is ready: Reload switches to it now, Later
// leaves the open page as it is, and the new version starts the next time the app is opened.

import { useState } from 'react';
import { useUpdate } from './update';

export function UpdateBanner() {
  const update = useUpdate();
  const [later, setLater] = useState(false);
  const show = (update.status === 'ready' && !later) || update.status === 'reloading';
  return (
    <div className="update-banner-slot" role="status" aria-live="polite">
      {show && (
        <div className="update-banner" id="update-banner">
          <p>
            <strong>A new version of Poker Coach is ready.</strong>{' '}
            <span className="muted">Reloading ends a hand in progress; saved hands, sessions and settings are kept.</span>
          </p>
          <div className="update-actions">
            <button type="button" className="primary" id="update-reload" disabled={update.status === 'reloading'} onClick={update.apply}>
              {update.status === 'reloading' ? 'Reloading…' : 'Reload'}
            </button>
            {update.status === 'ready' && <button type="button" id="update-later" onClick={() => setLater(true)}>Later</button>}
          </div>
        </div>
      )}
    </div>
  );
}
