// Runs equity calculations off the main thread so the UI stays responsive.

import { computeEquity, type EquityResult } from '../engine/equity';

export interface EquityJob {
  id: number;
  hero: number[];
  board: number[];
  villains: Float32Array[];
  iterations?: number;
}

export type EquityReply =
  | { id: number; ok: true; result: EquityResult; ms: number }
  | { id: number; ok: false; error: string };

self.onmessage = (e: MessageEvent<EquityJob>) => {
  const { id, ...req } = e.data;
  const t0 = performance.now();
  try {
    const result = computeEquity(req);
    (self as unknown as Worker).postMessage({ id, ok: true, result, ms: performance.now() - t0 } satisfies EquityReply);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, ok: false, error: (err as Error).message } satisfies EquityReply);
  }
};
