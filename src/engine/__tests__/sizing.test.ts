import { describe, expect, it } from 'vitest';
import { applyAction, legalActions, newHand, type HandConfig } from '../hand';
import { presetSizes } from '../sizing';

const cfg: HandConfig = { tableSize: 6, sb: 25, bb: 50 };
const stacks = () => Array(6).fill(5000) as number[];
const labels = (o: ReturnType<typeof presetSizes>) => o.map((x) => `${x.label}:${'to' in x.action ? x.action.to : ''}`);

describe('preset sizes', () => {
  it('offers open sizes when unopened', () => {
    const s = newHand({ config: cfg, stacks: stacks(), seed: 1 });
    expect(labels(presetSizes(s))).toEqual(['2.5bb:125', '3bb:150', 'All-in:5000']);
  });

  it('offers iso sizes over limpers and 3-bet sizes over a raise', () => {
    let s = newHand({ config: cfg, stacks: stacks(), seed: 1 });
    s = applyAction(s, { type: 'call' });
    expect(labels(presetSizes(s))).toEqual(['5bb:250', '6bb:300', 'All-in:5000']);
    let t = newHand({ config: cfg, stacks: stacks(), seed: 1 });
    t = applyAction(t, { type: 'raise', to: 150 });
    expect(labels(presetSizes(t))).toEqual(['3x:450', '4x:600', 'All-in:5000']);
  });

  it('offers pot fractions postflop and collapses oversized bets into all-in', () => {
    const st = stacks();
    st[5] = 400; // short BTN
    let s = newHand({ config: cfg, stacks: st, seed: 1 });
    for (const a of [{ type: 'fold' }, { type: 'fold' }, { type: 'fold' }, { type: 'raise', to: 150 }, { type: 'fold' }, { type: 'call' }] as const) {
      s = applyAction(s, a);
    }
    s = applyAction(s, { type: 'check' }); // BB checks to BTN; pot 325, BTN has 250 behind
    expect(labels(presetSizes(s))).toEqual(['33% pot:100', '66% pot:225', 'All-in:250']);
    for (const o of presetSizes(s)) expect(o.action.type).toBe('bet');
  });

  it('every preset is legal', () => {
    let s = newHand({ config: cfg, stacks: stacks(), seed: 1 });
    s = applyAction(s, { type: 'raise', to: 150 });
    for (const o of presetSizes(s)) {
      const r = legalActions(s).raise!;
      if ('to' in o.action) expect(o.action.to).toBeGreaterThanOrEqual(r.min);
      expect(() => applyAction(s, o.action)).not.toThrow();
    }
  });
});
