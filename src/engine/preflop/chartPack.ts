// Imported preflop charts: ranges pasted from a solver or range tool, or a chart pack file holding
// many charts at once. Every chart is checked before it is used, and only charts the trainer
// already has can be replaced.

import { ALL_CLASSES, CLASS_COMBOS, formatRange, NUM_COMBOS, parseRange, type Range } from '../range';
import { builtInEntry, CHARTS, type ChartEntry, type ChartSet, type SpotKind } from './charts';
import { chartLabel } from './explorer';

export const PACK_APP = 'poker-coach-charts';
export const PACK_VERSION = 1;

export interface ChartPack {
  app: typeof PACK_APP;
  v: typeof PACK_VERSION;
  /** What the charts are, e.g. "GTO Wizard 100bb 6-max NL50". */
  name: string;
  savedAt: string;
  charts: ChartSet;
}

const WEIGHT_TOLERANCE = 0.002;

/**
 * Rewrites a range as solvers and range tools export it into the trainer's notation. Accepts
 * comma, space-after-comma, semicolon or line separated hands; weights after a colon as a share
 * (0.5) or a percentage (50 or 50%); Flopzilla and HRC style groups ("[50]AKo, AQs[/50]"); and
 * exact combos ("AhKh:0.5"). Hands with a weight of 0 are dropped.
 */
export function normalizeRange(text: string): string {
  let t = text.replace(/[\r\n\t;]+/g, ',');
  // Bracket groups: every hand inside takes the group's percentage.
  t = t.replace(/\[\s*([\d.]+)\s*\]([^[]*)\[\s*\/\s*[\d.]+\s*\]/g, (_m, pctText: string, body: string) => {
    const w = Number(pctText) / 100;
    return body
      .split(',')
      .map((h) => h.trim())
      .filter(Boolean)
      .map((h) => `${h.split(':')[0].trim()}:${w}`)
      .join(',');
  });
  if (/[[\]]/.test(t)) throw new Error('A bracketed group like "[50]AKo[/50]" is not closed');
  const out: string[] = [];
  for (const raw of t.split(',')) {
    const part = raw.trim();
    if (!part) continue;
    const [hand, weightText, extra] = part.split(':').map((x) => x.trim());
    if (extra !== undefined || !hand) throw new Error(`Could not read "${part}"`);
    let w = 1;
    if (weightText !== undefined) {
      const pct = weightText.endsWith('%');
      const n = Number(pct ? weightText.slice(0, -1) : weightText);
      if (!Number.isFinite(n) || n < 0) throw new Error(`"${part}" has a weight that is not a number`);
      w = pct || n > 1 ? n / 100 : n;
      if (w > 1) throw new Error(`"${part}" has a weight above 100%`);
    }
    if (w === 0) continue;
    try {
      parseRange(hand);
    } catch {
      throw new Error(`"${hand}" is not a hand, a range like "QQ+" or "A5s-A2s", or a combo like "AhKh"`);
    }
    out.push(w === 1 ? hand : `${hand}:${+w.toFixed(4)}`);
  }
  return out.join(', ');
}

/** Hands whose raise and call weights add up to more than all of the hand. */
export function overfull(raise: Range, call: Range): string[] {
  const bad: string[] = [];
  for (const cls of ALL_CLASSES) {
    if (CLASS_COMBOS.get(cls)!.some((i) => raise[i] + call[i] > 1 + WEIGHT_TOLERANCE)) bad.push(cls);
  }
  return bad;
}

const sizeOk = (kind: SpotKind, size: unknown) =>
  size === undefined || size === 'allin' || (typeof size === 'number' && Number.isFinite(size) && size > (kind === 'rfi' ? 1 : 1.5) && size <= 100);

/**
 * Checks one chart and returns it in the trainer's notation. A size left out keeps the built-in
 * chart's size, as does a squeeze's extra per caller.
 */
export function checkChart(kind: SpotKind, key: string, input: { raise?: unknown; call?: unknown; size?: unknown }): ChartEntry {
  const base = builtInEntry(kind, key);
  if (!base) throw new Error(`The trainer has no "${key}" chart for ${kindName(kind)}`);
  const where = chartLabel(kind, key);
  const text = (v: unknown, what: string) => {
    if (v === undefined || v === null) return '';
    if (typeof v !== 'string') throw new Error(`${where}: the ${what} range is not text`);
    try {
      return normalizeRange(v);
    } catch (e) {
      throw new Error(`${where}, ${what} range: ${(e as Error).message}`);
    }
  };
  const raise = text(input.raise, 'raise');
  const call = text(input.call, 'call');
  if (!raise && !call) throw new Error(`${where}: both ranges are empty, so every hand would fold`);
  if (kind === 'rfi' && call) throw new Error(`${where}: opening charts are raise or fold, since the trainer has no charts for the spots after an open limp. Leave the call range empty`);
  const bad = overfull(parseRange(raise), parseRange(call));
  if (bad.length) throw new Error(`${where}: ${listHands(bad)} raise and call more than 100% of the time between them`);
  if (!sizeOk(kind, input.size)) throw new Error(`${where}: the size must be a number of big blinds (opens) or a multiple of the last raise, or "allin"`);
  if (kind === 'rfi' && input.size === 'allin') throw new Error(`${where}: an open is a number of big blinds, not all-in`);
  if (kind === 'vs4bet' && input.size !== undefined && input.size !== 'allin') throw new Error(`${where}: a 5-bet is always all-in`);
  const entry: ChartEntry = { raise };
  if (call) entry.call = call;
  const size = (input.size as ChartEntry['size']) ?? base.size;
  if (size !== undefined) entry.size = size;
  if (base.perCaller !== undefined) entry.perCaller = base.perCaller;
  return entry;
}

const KIND_NAMES: Record<SpotKind, string> = {
  rfi: 'opens', vsOpen: 'facing an open', vs3bet: 'facing a 3-bet', vs4bet: 'facing a 4-bet',
  squeeze: 'squeezes', cold4bet: 'cold 4-bets', vsJam: 'facing an all-in', vsLimp: 'facing limpers',
};
const kindName = (k: SpotKind) => KIND_NAMES[k];
const listHands = (h: string[]) => (h.length > 6 ? `${h.slice(0, 6).join(', ')} and ${h.length - 6} more` : h.join(', '));

/** Reads a chart pack file, checking every chart; throws a plain-language error on a bad file. */
export function parsePack(text: string): ChartPack {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('This file is not a chart pack: it is not JSON');
  }
  const p = raw as Partial<ChartPack> | null;
  if (!p || typeof p !== 'object' || p.app !== PACK_APP) throw new Error('This file is not a Poker Coach chart pack');
  if (p.v !== PACK_VERSION) throw new Error(`This chart pack is version ${String(p.v)}; this trainer reads version ${PACK_VERSION}`);
  if (!p.charts || typeof p.charts !== 'object') throw new Error('This chart pack holds no charts');
  const charts: ChartSet = {};
  let count = 0;
  for (const [kind, entries] of Object.entries(p.charts as Record<string, unknown>)) {
    if (!(kind in CHARTS)) throw new Error(`"${kind}" is not a kind of chart this trainer plays`);
    if (!entries || typeof entries !== 'object') throw new Error(`The ${kind} charts are not a list of charts`);
    for (const [key, entry] of Object.entries(entries as Record<string, unknown>)) {
      if (!entry || typeof entry !== 'object') throw new Error(`The ${kind} chart "${key}" is not a chart`);
      (charts[kind as SpotKind] ??= {})[key] = checkChart(kind as SpotKind, key, entry as Record<string, unknown>);
      count++;
    }
  }
  if (!count) throw new Error('This chart pack holds no charts');
  const name = typeof p.name === 'string' && p.name.trim() ? p.name.trim().slice(0, 80) : 'Imported charts';
  const savedAt = typeof p.savedAt === 'string' && !Number.isNaN(Date.parse(p.savedAt)) ? p.savedAt : new Date(0).toISOString();
  return { app: PACK_APP, v: PACK_VERSION, name, savedAt, charts };
}

export const chartCount = (set: ChartSet) => Object.values(set).reduce((n, e) => n + Object.keys(e ?? {}).length, 0);

export function makePack(name: string, charts: ChartSet, now = new Date()): ChartPack {
  return { app: PACK_APP, v: PACK_VERSION, name, savedAt: now.toISOString(), charts };
}

/** Every chart the trainer is playing now, as a pack: a template to edit, or a copy to keep. */
export function currentPack(name: string, now = new Date()): ChartPack {
  const charts: ChartSet = {};
  for (const kind of Object.keys(CHARTS) as SpotKind[]) charts[kind] = { ...CHARTS[kind] };
  return makePack(name, charts, now);
}

export const packText = (p: ChartPack) => JSON.stringify(p, null, 1);
export const packFileName = (p: ChartPack) => `poker-coach-charts-${p.savedAt.slice(0, 10)}.json`;

/** Adds or replaces one chart in a set. */
export function withChart(set: ChartSet, kind: SpotKind, key: string, entry: ChartEntry): ChartSet {
  return { ...set, [kind]: { ...set[kind], [key]: entry } };
}

/** Removes one chart from a set, putting the built-in one back. */
export function withoutChart(set: ChartSet, kind: SpotKind, key: string): ChartSet {
  const rest = { ...set[kind] };
  delete rest[key];
  const out = { ...set, [kind]: rest };
  if (!Object.keys(rest).length) delete out[kind];
  return out;
}

/** The share of all hands a range plays, for a quick read of an imported range. */
export function playedShare(text: string): number {
  const r = parseRange(text);
  let s = 0;
  for (let i = 0; i < NUM_COMBOS; i++) s += r[i];
  return s / NUM_COMBOS;
}

/** A chart's ranges written back in the trainer's compact notation. */
export const compact = (text: string) => formatRange(parseRange(text));
