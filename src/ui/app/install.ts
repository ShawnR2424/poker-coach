// Installing the trainer as an app: registers the service worker that caches the app for
// offline use, and tracks whether the browser offers to install it.

import { useEffect, useState } from 'react';

/** The browser's install prompt (Chromium only; not in the DOM typings). */
interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallPrompt | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((f) => f());

/** Registers the service worker in a production build served over HTTPS or from localhost. */
export function registerServiceWorker() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPrompt;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    notify();
  });
  if (!import.meta.env.PROD || !window.isSecureContext) return;
  try {
    // Sandboxed frames (such as an embedded preview) refuse service workers; the app works without one.
    navigator.serviceWorker?.register('./sw.js').then(() => navigator.serviceWorker.ready).then(notify, () => {});
  } catch {
    /* service workers unavailable here */
  }
}

const standalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

function offlineReady(): boolean {
  try {
    return !!navigator.serviceWorker?.controller;
  } catch {
    return false;
  }
}

export interface InstallState {
  /** Running as an installed app. */
  installed: boolean;
  /** The browser offered to install the app; `install` shows its prompt. */
  canInstall: boolean;
  /** The app is cached and will open without a connection. */
  offline: boolean;
  install: () => Promise<void>;
}

export function useInstall(): InstallState {
  const [, rerender] = useState(0);
  useEffect(() => {
    const f = () => rerender((n) => n + 1);
    listeners.add(f);
    let sw: ServiceWorkerContainer | undefined;
    try { sw = navigator.serviceWorker; } catch { /* unavailable */ }
    sw?.addEventListener('controllerchange', f);
    return () => {
      listeners.delete(f);
      sw?.removeEventListener('controllerchange', f);
    };
  }, []);
  return {
    installed: standalone(),
    canInstall: deferred !== null,
    offline: offlineReady(),
    install: async () => {
      if (!deferred) return;
      const d = deferred;
      await d.prompt();
      await d.userChoice;
      deferred = null;
      notify();
    },
  };
}
