import { describe, expect, it, vi } from 'vitest';
import { MIN_CHECK_GAP_MS, reloadOnStaleChunk, SKIP_WAITING, Updater, type Container, type Registration, type ServiceWorkerLike } from './update';

class FakeWorker extends EventTarget implements ServiceWorkerLike {
  messages: unknown[] = [];
  constructor(public state: string) { super(); }
  postMessage(m: unknown) { this.messages.push(m); }
  become(state: string) {
    this.state = state;
    this.dispatchEvent(new Event('statechange'));
  }
}

class FakeRegistration extends EventTarget implements Registration {
  installing: FakeWorker | null = null;
  waiting: FakeWorker | null = null;
  active: FakeWorker | null = null;
  updates = 0;
  /** What the next update() finds on the server: a new worker, nothing, or a network failure. */
  next: 'new' | 'same' | 'offline' = 'same';
  async update() {
    this.updates++;
    if (this.next === 'offline') throw new TypeError('Failed to fetch');
    if (this.next === 'new') this.found(new FakeWorker('installing'));
  }
  found(w: FakeWorker) {
    this.installing = w;
    this.dispatchEvent(new Event('updatefound'));
  }
  /** The installing worker finishes installing and waits. */
  installed() {
    const w = this.installing!;
    this.installing = null;
    this.waiting = w;
    w.become('installed');
  }
}

class FakeContainer extends EventTarget implements Container {
  constructor(public controller: unknown) { super(); }
  takeOver(c: unknown) {
    this.controller = c;
    this.dispatchEvent(new Event('controllerchange'));
  }
}

function setup(controlled = true) {
  const reg = new FakeRegistration();
  if (controlled) reg.active = new FakeWorker('activated');
  const container = new FakeContainer(controlled ? reg.active : null);
  const reload = vi.fn();
  let t = 0;
  const clock = { advance: (ms: number) => { t += ms; } };
  const u = new Updater(reg, { container, reload, now: () => t });
  return { reg, container, reload, u, clock };
}

describe('Updater', () => {
  it('offers a new version once it has installed while an older one is in control', () => {
    const { reg, u } = setup();
    const changes = vi.fn();
    u.subscribe(changes);
    reg.found(new FakeWorker('installing'));
    expect(u.status).toBe('none');
    reg.installed();
    expect(u.status).toBe('ready');
    expect(changes).toHaveBeenCalledTimes(1);
  });

  it('does not treat the first install as an update, and never reloads for it', () => {
    const { reg, container, reload, u } = setup(false);
    reg.found(new FakeWorker('installing'));
    reg.installed();
    expect(u.status).toBe('none');
    container.takeOver(reg.waiting);
    expect(reload).not.toHaveBeenCalled();
  });

  it('finds a version that was already waiting when the page opened', () => {
    const reg = new FakeRegistration();
    reg.active = new FakeWorker('activated');
    reg.waiting = new FakeWorker('installed');
    const u = new Updater(reg, { container: new FakeContainer(reg.active), reload: () => {} });
    expect(u.status).toBe('ready');
  });

  it('switches only when asked: tells the waiting worker to take over, then reloads once it controls the page', () => {
    const { reg, container, reload, u } = setup();
    reg.found(new FakeWorker('installing'));
    reg.installed();
    const w = reg.waiting!;
    expect(w.messages).toEqual([]);
    u.apply();
    expect(u.status).toBe('reloading');
    expect(w.messages).toEqual([SKIP_WAITING]);
    expect(reload).not.toHaveBeenCalled();
    container.takeOver(w);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('checks the server, skipping checks a moment apart unless asked from Settings', async () => {
    const { reg, u, clock } = setup();
    await u.check();
    await u.check();
    expect(reg.updates).toBe(1);
    clock.advance(MIN_CHECK_GAP_MS);
    await u.check();
    expect(reg.updates).toBe(2);
    await u.check(true);
    expect(reg.updates).toBe(3);
    expect(u.status).toBe('current');
  });

  it('reports a check that finds a new version, and survives a check made offline', async () => {
    const { reg, u } = setup();
    reg.next = 'offline';
    await u.check(true);
    expect(u.status).toBe('current');
    reg.next = 'new';
    await u.check(true);
    expect(u.status).toBe('none');
    reg.installed();
    expect(u.status).toBe('ready');
    await u.check(true);
    expect(reg.updates).toBe(2);
  });
});

describe('reloadOnStaleChunk', () => {
  it('reloads once, then lets the error through if the file is still missing a minute later', () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    const reload = vi.fn();
    expect(reloadOnStaleChunk(storage, reload, 1_000_000)).toBe(true);
    expect(reloadOnStaleChunk(storage, reload, 1_030_000)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(reloadOnStaleChunk(storage, reload, 1_070_000)).toBe(true);
  });

  it('does not reload when it cannot remember having done so', () => {
    const reload = vi.fn();
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => {} };
    expect(reloadOnStaleChunk(broken, reload)).toBe(false);
    expect(reloadOnStaleChunk(null, reload)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});
