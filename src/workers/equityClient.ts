// Promise wrapper around the equity worker, with a main-thread fallback if workers are unavailable.

import { calcEquity, type CalcResult } from '../engine/calc/equityCalc';
import { classEquities } from '../engine/classEquity';
import { comboEquities, computeEquity, type EquityResult } from '../engine/equity';
import { analyzeMultiway, type MultiwayResult, type MultiwaySituation } from '../engine/postflop/multiway';
import type { HandClass, Range } from '../engine/range';
import type { EquityJob, EquityReply } from './equity.worker';

export interface EquityOutcome {
  result: EquityResult;
  ms: number;
}

type Pending = { job: JobInput; resolve: (r: EquityReply & { ok: true }) => void; reject: (e: Error) => void };

let worker: Worker | null = null;
let workerFailed = false;
let nextId = 1;
const pending = new Map<number, Pending>();

function getWorker(): Worker | null {
  if (worker || workerFailed) return worker;
  try {
    worker = new Worker(new URL('./equity.worker.ts', import.meta.url));
    worker.onmessage = (e: MessageEvent<EquityReply>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.ok) p.resolve(e.data);
      else p.reject(new Error(e.data.error));
    };
    // A worker that cannot start (some browsers refuse module workers, or the script cannot be
    // fetched) hands its jobs to the main thread, and every later job runs there too.
    worker.onerror = (e) => {
      e.preventDefault();
      console.warn('The equity worker failed to start; working out equity on the main thread instead.');
      const jobs = [...pending.values()];
      pending.clear();
      worker = null;
      workerFailed = true;
      for (const p of jobs) runHere(p.job).then(p.resolve, p.reject);
    };
    return worker;
  } catch {
    workerFailed = true;
    return null;
  }
}

type JobInput = EquityJob extends infer J ? (J extends { id: number } ? Omit<J, 'id'> : never) : never;

/** Runs a job on the main thread: the fallback when there is no worker. */
function runHere(job: JobInput): Promise<EquityReply & { ok: true }> {
  const t0 = performance.now();
  try {
    if (job.kind === 'equity') {
      const result = computeEquity({ hero: job.hero, board: job.board, villains: job.villains, iterations: job.iterations });
      return Promise.resolve({ id: 0, ok: true, kind: 'equity', result, ms: performance.now() - t0 });
    }
    if (job.kind === 'comboEquity') {
      const result = comboEquities(job.hero, job.board, job.range);
      return Promise.resolve({ id: 0, ok: true, kind: 'comboEquity', result, ms: performance.now() - t0 });
    }
    if (job.kind === 'multiway') {
      return Promise.resolve({ id: 0, ok: true, kind: 'multiway', result: analyzeMultiway(job.sit), ms: performance.now() - t0 });
    }
    if (job.kind === 'calc') {
      const result = calcEquity({ players: job.players, board: job.board, dead: job.dead, samples: job.samples });
      return Promise.resolve({ id: 0, ok: true, kind: 'calc', result, ms: performance.now() - t0 });
    }
    const m = classEquities(job.hero, job.board, job.range, job.iterations);
    return Promise.resolve({ id: 0, ok: true, kind: 'classEquity', result: [...m], ms: performance.now() - t0 });
  } catch (e) {
    return Promise.reject(e);
  }
}

function send(job: JobInput): Promise<EquityReply & { ok: true }> {
  const w = getWorker();
  if (!w) return runHere(job);
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { job, resolve, reject });
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

/** Hero equity against each combo of `range` (NaN where dead or unweighted). Flop or later. */
export async function runComboEquity(hero: number[], board: number[], range: Range): Promise<Float32Array> {
  const r = await send({ kind: 'comboEquity', hero, board, range: new Float32Array(range) });
  if (r.kind !== 'comboEquity') throw new Error('Unexpected reply');
  return r.result;
}

/** EV of every hero action and per-opponent combo equities for a multiway decision. */
export async function runMultiway(sit: MultiwaySituation): Promise<MultiwayResult> {
  const r = await send({ kind: 'multiway', sit });
  if (r.kind !== 'multiway') throw new Error('Unexpected reply');
  return r.result;
}

/** Equity for two to four players, each with an exact hand or a range (the Equity tab). */
export async function runCalc(players: Range[], board: number[], dead: number[], samples?: number): Promise<{ result: CalcResult; ms: number }> {
  const r = await send({ kind: 'calc', players: players.map((p) => new Float32Array(p)), board, dead, samples });
  if (r.kind !== 'calc') throw new Error('Unexpected reply');
  return { result: r.result, ms: r.ms };
}
