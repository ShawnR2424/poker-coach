// New versions of the installed app. A new build's service worker installs in the background and
// then waits, so the page that is open keeps the files it started with. The page notices the
// waiting worker and offers to reload; on Reload the worker takes over and the page reloads once
// it is in control. Without a click the new version starts the next time the app is opened.

import { useEffect, useState } from 'react';

/** The parts of a ServiceWorkerRegistration this module uses (a fake one stands in for tests). */
export interface Registration extends EventTarget {
  installing: ServiceWorkerLike | null;
  waiting: ServiceWorkerLike | null;
  active: ServiceWorkerLike | null;
  update(): Promise<unknown>;
}
export interface ServiceWorkerLike extends EventTarget {
  state: string;
  postMessage(message: unknown): void;
}
/** The parts of navigator.serviceWorker this module uses. */
export interface Container extends EventTarget {
  controller: unknown;
}

export type UpdateStatus = 'none' | 'checking' | 'current' | 'ready' | 'reloading';

/** How often an open app checks for a new version, besides each time it comes back into view. */
export const CHECK_EVERY_MS = 60 * 60 * 1000;
/** Checks closer together than this, from switching back and forth between apps, are skipped. */
export const MIN_CHECK_GAP_MS = 60 * 1000;
/** The message that tells a waiting service worker to take over (sw.js listens for it). */
export const SKIP_WAITING = { type: 'SKIP_WAITING' } as const;

export interface UpdaterDeps {
  container: Container;
  reload: () => void;
  now?: () => number;
}

/**
 * Watches one registration for a new version. `status` is 'ready' once a new service worker has
 * installed while an older one controls the page; a first install (nothing in control yet) is
 * not an update.
 */
export class Updater {
  status: UpdateStatus = 'none';
  private lastCheck = -Infinity;
  private readonly listeners = new Set<() => void>();
  private readonly now: () => number;

  constructor(readonly reg: Registration, private readonly deps: UpdaterDeps) {
    this.now = deps.now ?? Date.now;
    if (reg.waiting && deps.container.controller) this.set('ready');
    else if (reg.installing) this.track(reg.installing);
    reg.addEventListener('updatefound', () => {
      if (reg.installing) this.track(reg.installing);
    });
    deps.container.addEventListener('controllerchange', () => {
      // Only a reload the player asked for; a first install also changes the controller.
      if (this.status === 'reloading') deps.reload();
    });
  }

  private track(sw: ServiceWorkerLike) {
    const check = () => {
      if (sw.state === 'installed' && this.deps.container.controller) this.set('ready');
    };
    sw.addEventListener('statechange', check);
    check();
  }

  private set(s: UpdateStatus) {
    if (this.status === s) return;
    this.status = s;
    this.listeners.forEach((f) => f());
  }

  subscribe(f: () => void): () => void {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  }

  /**
   * Asks the server for a new sw.js. `force` (the Settings button) checks even if a check ran a
   * moment ago, and reports 'current' when nothing new turned up.
   */
  async check(force = false): Promise<void> {
    if (this.status === 'ready' || this.status === 'reloading') return;
    const t = this.now();
    if (!force && t - this.lastCheck < MIN_CHECK_GAP_MS) return;
    this.lastCheck = t;
    if (force) this.set('checking');
    try {
      await this.reg.update();
    } catch {
      /* offline, or the server is unreachable: try again later */
    }
    // A new worker reports itself through updatefound and statechange; it may still be installing.
    if (this.reg.waiting && this.deps.container.controller) this.set('ready');
    else if (force && this.status === 'checking') this.set(this.reg.installing ? 'none' : 'current');
  }

  /** Switches to the waiting version and reloads once it is in control. */
  apply() {
    const w = this.reg.waiting;
    if (!w) return;
    this.set('reloading');
    w.postMessage(SKIP_WAITING);
  }
}

let updater: Updater | null = null;
/** Mounted components that show the update status. */
const hooks = new Set<() => void>();
const notifyHooks = () => hooks.forEach((f) => f());

/** Starts watching for new versions once the service worker has registered (install.ts). */
export function watchForUpdates(reg: Registration, deps: UpdaterDeps): Updater {
  updater = new Updater(reg, deps);
  updater.subscribe(notifyHooks);
  notifyHooks();
  const check = () => void updater?.check();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });
  setInterval(check, CHECK_EVERY_MS);
  return updater;
}

/**
 * A lazily loaded screen whose file is gone (the page is older than the build on the server and
 * its cache was replaced) fails to load. Reloading picks up the current build; the time stored
 * in sessionStorage stops a reload loop if the file is missing for some other reason.
 */
export function reloadOnStaleChunk(storage: Pick<Storage, 'getItem' | 'setItem'> | null, reload: () => void, now = Date.now()): boolean {
  const KEY = 'chunk-reload';
  if (!storage) return false;
  try {
    const last = Number(storage.getItem(KEY) ?? 0);
    if (now - last < 60_000) return false;
    storage.setItem(KEY, String(now));
  } catch {
    return false;
  }
  reload();
  return true;
}

export interface UpdateState {
  status: UpdateStatus;
  /** False where there is no service worker (development, an embedded preview). */
  available: boolean;
  check: () => Promise<void>;
  apply: () => void;
}

export function useUpdate(): UpdateState {
  const [, rerender] = useState(0);
  useEffect(() => {
    const f = () => rerender((n) => n + 1);
    hooks.add(f);
    return () => { hooks.delete(f); };
  }, []);
  return {
    status: updater?.status ?? 'none',
    available: updater !== null,
    check: () => updater?.check(true) ?? Promise.resolve(),
    apply: () => updater?.apply(),
  };
}
