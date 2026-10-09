// Promise wrapper around the equity worker, with a main-thread fallback if workers are unavailable.

import { classEquities } from '../engine/classEquity';
import { computeEquity, type EquityResult } from '../engine/equity';
import type { HandClass, Range } from '../engine/range';
import type { EquityJob, EquityReply } from './equity.worker';

export interface EquityOutcome {
  result: EquityResult;
  ms: number;
}

type Pending = { resolve: (r: EquityReply & { ok: true }) => void; reject: (e: Error) => void };

let worker: Worker | null = null;
let workerFailed = false;
let nextId = 1;
const pending = new Map<number, Pending>();

function getWorker(): Worker | null {
  if (worker || workerFailed) return worker;
  try {
    worker = new Worker(new URL('./equity.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<EquityReply>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.ok) p.resolve(e.data);
      else p.reject(new Error(e.data.error));
    };
    worker.onerror = () => {
      for (const p of pending.values()) p.reject(new Error('Equity worker failed'));
      pending.clear();
      worker = null;
      workerFailed = true;
    };
    return worker;
  } catch {
    workerFailed = true;
    return null;
  }
}

type JobInput = EquityJob extends infer J ? (J extends { id: number } ? Omit<J, 'id'> : never) : never;

function send(job: JobInput): Promise<EquityReply & { ok: true }> {
  const w = getWorker();
  if (!w) {
    // Main-thread fallback.
    const t0 = performance.now();
    try {
      if (job.kind === 'equity') {
        const result = computeEquity({ hero: job.hero, board: job.board, villains: job.villains, iterations: job.iterations });
        return Promise.resolve({ id: 0, ok: true, kind: 'equity', result, ms: performance.now() - t0 });
      }
      const m = classEquities(job.hero, job.board, job.range, job.iterations);
      return Promise.resolve({ id: 0, ok: true, kind: 'classEquity', result: [...m], ms: performance.now() - t0 });
    } catch (e) {
      return Promise.reject(e);
    }
  }
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ ...job, id });
  });
}

export async function runEquity(hero: number[], board: number[], villains: Range[], iterations?: number): Promise<EquityOutcome> {
  const r = await send({ kind: 'equity', hero, board, villains: villains.map((v) => new Float32Array(v)), iterations });
  if (r.kind !== 'equity') throw new Error('Unexpected reply');
  return { result: r.result, ms: r.ms };
}

export async function runClassEquity(hero: number[], board: number[], range: Range, iterations?: number): Promise<Map<HandClass, number>> {
  const r = await send({ kind: 'classEquity', hero, board, range: new Float32Array(range), iterations });
  if (r.kind !== 'classEquity') throw new Error('Unexpected reply');
  return new Map(r.result);
}
