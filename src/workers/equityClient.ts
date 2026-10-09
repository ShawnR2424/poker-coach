// Promise wrapper around the equity worker, with a main-thread fallback if workers are unavailable.

import { computeEquity, type EquityResult } from '../engine/equity';
import type { Range } from '../engine/range';
import type { EquityJob, EquityReply } from './equity.worker';

export interface EquityOutcome {
  result: EquityResult;
  ms: number;
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (o: EquityOutcome) => void; reject: (e: Error) => void }>();

function getWorker(): Worker | null {
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./equity.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<EquityReply>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.ok) p.resolve({ result: e.data.result, ms: e.data.ms });
      else p.reject(new Error(e.data.error));
    };
    worker.onerror = () => {
      for (const p of pending.values()) p.reject(new Error('Equity worker failed'));
      pending.clear();
      worker = null;
    };
    return worker;
  } catch {
    return null;
  }
}

export function runEquity(hero: number[], board: number[], villains: Range[], iterations?: number): Promise<EquityOutcome> {
  const w = getWorker();
  if (!w) {
    const t0 = performance.now();
    try {
      const result = computeEquity({ hero, board, villains, iterations });
      return Promise.resolve({ result, ms: performance.now() - t0 });
    } catch (e) {
      return Promise.reject(e);
    }
  }
  const id = nextId++;
  const job: EquityJob = { id, hero, board, villains: villains.map((v) => new Float32Array(v)), iterations };
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage(job);
  });
}
