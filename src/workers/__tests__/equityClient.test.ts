// The equity client falls back to the main thread when the worker cannot start, including for
// jobs already sent to it, as when a browser refuses module workers or the script cannot load.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseCard } from '../../engine/cards';
import { parseRange } from '../../engine/range';

class FailingWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  posted = 0;
  jobs: unknown[] = [];
  static last: FailingWorker | null = null;
  constructor() { FailingWorker.last = this; }
  postMessage(job: unknown) { this.posted++; this.jobs.push(job); }
  fail() { this.onerror?.(new Event('error', { cancelable: true })); }
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('equity client', () => {
  it('works out equity on the main thread when the worker fails to start', async () => {
    vi.stubGlobal('Worker', FailingWorker);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { runEquity } = await import('../equityClient');
    const hero = [parseCard('Ah'), parseCard('As')];
    const first = runEquity(hero, [], [parseRange('KK')], 2000);
    expect(FailingWorker.last?.posted).toBe(1);
    FailingWorker.last!.fail();
    const r = await first;
    expect(r.result.equity).toBeGreaterThan(0.75);
    expect(r.result.equity).toBeLessThan(0.9);
    expect(warn).toHaveBeenCalledOnce();
    // Later jobs skip the failed worker.
    const posted = FailingWorker.last!.posted;
    const again = await runEquity(hero, [], [parseRange('KK')], 2000);
    expect(again.result.equity).toBeGreaterThan(0.75);
    expect(FailingWorker.last!.posted).toBe(posted);
  });

  it('sends imported postflop tables along with each multiway job', async () => {
    vi.stubGlobal('Worker', FailingWorker);
    const { setPostflopOverrides } = await import('../../engine/postflop/model');
    const { runMultiway } = await import('../equityClient');
    const tables = { firstToAct: { betSmall: { air: 0.5 } } };
    setPostflopOverrides(tables);
    void runMultiway({} as never).catch(() => {});
    expect(FailingWorker.last?.jobs[0]).toMatchObject({ kind: 'multiway', tables });
    setPostflopOverrides({});
  });
});
