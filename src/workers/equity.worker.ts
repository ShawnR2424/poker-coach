// Runs equity calculations off the main thread so the UI stays responsive.

import { classEquities } from '../engine/classEquity';
import { computeEquity, type EquityResult } from '../engine/equity';

export type EquityJob =
  | { id: number; kind: 'equity'; hero: number[]; board: number[]; villains: Float32Array[]; iterations?: number }
  | { id: number; kind: 'classEquity'; hero: number[]; board: number[]; range: Float32Array; iterations?: number };

export type EquityReply =
  | { id: number; ok: true; kind: 'equity'; result: EquityResult; ms: number }
  | { id: number; ok: true; kind: 'classEquity'; result: [string, number][]; ms: number }
  | { id: number; ok: false; error: string };

const post = (m: EquityReply) => (self as unknown as Worker).postMessage(m);

self.onmessage = (e: MessageEvent<EquityJob>) => {
  const job = e.data;
  const t0 = performance.now();
  try {
    if (job.kind === 'equity') {
      const result = computeEquity({ hero: job.hero, board: job.board, villains: job.villains, iterations: job.iterations });
      post({ id: job.id, ok: true, kind: 'equity', result, ms: performance.now() - t0 });
    } else {
      const m = classEquities(job.hero, job.board, job.range, job.iterations);
      post({ id: job.id, ok: true, kind: 'classEquity', result: [...m], ms: performance.now() - t0 });
    }
  } catch (err) {
    post({ id: job.id, ok: false, error: (err as Error).message });
  }
};
