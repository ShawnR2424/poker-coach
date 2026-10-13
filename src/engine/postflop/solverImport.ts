// Imported postflop solver output. A solver reports, for one spot on one board, how often each
// combo takes each action. The trainer's opponent model works by hand class rather than by combo,
// so each report is boiled down to class frequencies for that board, and the spots of a pack are
// averaged into the class tables of actions.json (firstToAct, leadIntoAggressor, facingBet,
// facingRaise). The imported numbers become the regular opponent's play; the other styles still
// scale them as profiles.json says.

import { parseCards, type Card } from '../cards';
import { COMBO_CARDS, NUM_COMBOS, parseRange } from '../range';
import { classifyHand, POSTFLOP_CLASSES, type PostflopClass } from './classify';
import { ACTIONS, builtInValue, SMALL_BET_MAX, type PostflopOverrides } from './model';
import { boardTexture, TEXTURES, type Texture } from './texture';

export const POSTFLOP_PACK_APP = 'poker-coach-postflop';
export const POSTFLOP_PACK_VERSION = 1;

/**
 * Which table a spot feeds:
 * - `act`: first to act, or checked to (firstToAct);
 * - `lead`: first to act into the player who made the last bet or raise (leadIntoAggressor);
 * - `facingBet`: facing a bet of `f` times the pot (facingBet);
 * - `facingRaise`: had bet and now faces a raise of `f` times the pot (facingRaise).
 */
export type SpotKind = 'act' | 'lead' | 'facingBet' | 'facingRaise';

export const SPOT_KINDS: { kind: SpotKind; label: string }[] = [
  { kind: 'act', label: 'First to act, or checked to' },
  { kind: 'lead', label: 'Leading into the last aggressor' },
  { kind: 'facingBet', label: 'Facing a bet' },
  { kind: 'facingRaise', label: 'Facing a raise after betting' },
];

/** Share of a class's range weight that takes each action. `w` is the class's weight in the range. */
export interface ActFreq { w: number; check: number; small: number; big: number }
export interface FacingFreq { w: number; fold: number; call: number; raise: number }

export interface SolverSpot {
  /** What the spot is, e.g. "BTN vs BB single raised pot, flop c-bet". */
  label: string;
  board: string;
  kind: SpotKind;
  /** The bet or raise faced, divided by the pot before it. Only for facing spots. */
  f?: number;
  classes: Partial<Record<PostflopClass, ActFreq | FacingFreq>>;
}

export interface PostflopPack {
  app: typeof POSTFLOP_PACK_APP;
  v: typeof POSTFLOP_PACK_VERSION;
  name: string;
  savedAt: string;
  spots: SolverSpot[];
}

export const isFacing = (k: SpotKind) => k === 'facingBet' || k === 'facingRaise';

// ---- Reading a solver report ----

type Action = { kind: 'check' | 'fold' | 'call' | 'raise' } | { kind: 'bet'; f: number | null };

/** Reads an action column's name: "Check", "Fold", "Call", "Bet 33%", "BET 2.5", "Raise 9", "Allin". */
function readAction(name: string, pot: number | undefined): Action | null {
  const n = name.trim().toLowerCase();
  if (/^(x|check)\b/.test(n)) return { kind: 'check' };
  if (/^(f|fold)\b/.test(n)) return { kind: 'fold' };
  if (/^(c|call)\b/.test(n)) return { kind: 'call' };
  if (/^(r|raise)\b/.test(n)) return { kind: 'raise' };
  if (/^(all[\s-]?in|jam|shove)\b/.test(n)) return { kind: 'bet', f: null };
  const m = /^(b|bet|donk|lead)\s*([\d.]+)\s*(%?)/.exec(n);
  if (m) {
    const x = Number(m[2]);
    if (!Number.isFinite(x) || x <= 0) return null;
    // "Bet 33%" is a share of the pot; a bare number is chips when the pot is given, else a percentage.
    return { kind: 'bet', f: m[3] || !pot ? x / 100 : x / pot };
  }
  if (/^(b|bet|donk|lead)$/.test(n)) return { kind: 'bet', f: null };
  return null;
}

const WEIGHT_COLUMN = /^(weight|weights|freq|frequency|range|combos|count|strat(egy)?\s*weight)$/i;
const IGNORED_COLUMN = /\b(ev|eq|eqr|equity)\b/i;
const HAND_COLUMN = /^(hand|hands|combo|combos?\s*name|holding|cards?)$/i;

export interface ReadOptions {
  label: string;
  board: string;
  kind: SpotKind;
  /** The bet or raise faced as a percentage of the pot, for facing spots. */
  facingPct?: number;
  /** The pot in chips, when the report's bet columns are chip amounts. */
  pot?: number;
}

export interface ReadResult {
  spot: SolverSpot;
  /** Combos read, after removing those that clash with the board. */
  combos: number;
  actions: string[];
  ignored: string[];
}

function splitRow(line: string, sep: string): string[] {
  return line.split(sep).map((c) => c.trim().replace(/^"(.*)"$/, '$1').trim());
}

/** Parses the board for a spot: three to five cards. */
export function readBoard(text: string): Card[] {
  let cards: Card[];
  try {
    cards = parseCards(text.trim());
  } catch (e) {
    throw new Error(`The board: ${(e as Error).message}`);
  }
  if (cards.length < 3 || cards.length > 5) throw new Error('The board needs three to five cards, like "Ks7d2c"');
  return cards;
}

/**
 * Reads a strategy report exported from a solver (PioSolver, GTO+, GTO Wizard and similar): one
 * row per combo or hand, an action per column. Columns can be separated by commas, tabs or
 * semicolons. A hand can be an exact combo ("AsKs") or a hand ("AKs", "QQ"); a weight, freq or
 * combos column gives its weight in the range (otherwise every row counts the same); EV and
 * equity columns are skipped. Frequencies can be shares (0.25) or percentages (25).
 */
export function readSolverReport(text: string, opts: ReadOptions): ReadResult {
  const board = readBoard(opts.board);
  const boardSet = new Set(board);
  const facing = isFacing(opts.kind);
  let f: number | undefined;
  if (facing) {
    const pct = opts.facingPct;
    if (pct === undefined || !Number.isFinite(pct) || pct <= 0 || pct > 2000) throw new Error('Enter the size of the bet or raise faced, as a percentage of the pot');
    f = pct / 100;
  }
  if (opts.pot !== undefined && !(Number.isFinite(opts.pot) && opts.pot > 0)) throw new Error('The pot must be a positive number of chips');

  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  if (lines.length < 2) throw new Error('Paste a header row naming the actions, then one row per hand');
  const head = lines[0];
  const sep = [',', '\t', ';'].reduce((best, s) => (head.split(s).length > head.split(best).length ? s : best), ',');
  const header = splitRow(head, sep);
  if (looksLikeHand(header[0])) throw new Error('The first row should name the columns, like "Hand, Weight, Check, Bet 33%"');

  let handCol = header.findIndex((h) => HAND_COLUMN.test(h));
  if (handCol < 0) handCol = 0;
  let weightCol = -1;
  const actionCols: { i: number; name: string; action: Action }[] = [];
  const ignored: string[] = [];
  header.forEach((h, i) => {
    if (i === handCol) return;
    if (weightCol < 0 && WEIGHT_COLUMN.test(h)) {
      weightCol = i;
      return;
    }
    const action = IGNORED_COLUMN.test(h) ? null : readAction(h, opts.pot);
    if (action) actionCols.push({ i, name: h, action });
    else ignored.push(h || `column ${i + 1}`);
  });
  if (!actionCols.length) throw new Error('No column names an action. Name them like "Check", "Bet 33%", "Fold", "Call" or "Raise"');

  const kinds = new Set(actionCols.map((c) => c.action.kind));
  if (facing) {
    if (!kinds.has('fold') || !(kinds.has('call') || kinds.has('raise'))) throw new Error('A spot facing a bet needs a Fold column and a Call or Raise column');
    if (kinds.has('check')) throw new Error('A spot facing a bet has no Check column; choose "First to act" instead');
    // An all-in or bet column facing a bet is a raise.
    for (const c of actionCols) if (c.action.kind === 'bet') c.action = { kind: 'raise' };
  } else {
    if (kinds.has('fold') || kinds.has('call') || kinds.has('raise')) throw new Error('A first-to-act spot has only Check and Bet columns; choose "Facing a bet" for a spot with Fold and Call');
    if (!kinds.has('bet')) throw new Error('A first-to-act spot needs at least one Bet column');
  }

  // Frequencies are percentages when any cell is above 1.
  const rows: { combos: number[]; w: number; vals: number[] }[] = [];
  let percent = false;
  let weightPercent = false;
  for (let r = 1; r < lines.length; r++) {
    const cells = splitRow(lines[r], sep);
    const hand = cells[handCol] ?? '';
    if (!hand) continue;
    let range;
    try {
      range = parseRange(hand.replace(/\s+/g, ''));
    } catch {
      throw new Error(`Row ${r + 1}: "${hand}" is not a hand or a combo`);
    }
    const combos: number[] = [];
    let all = 0;
    for (let i = 0; i < NUM_COMBOS; i++) {
      if (!(range[i] > 0)) continue;
      all++;
      const [a, b] = COMBO_CARDS[i];
      if (!boardSet.has(a) && !boardSet.has(b)) combos.push(i);
    }
    if (!combos.length) continue;
    const num = (cell: string | undefined, what: string) => {
      const x = Number((cell ?? '').replace('%', ''));
      if (!Number.isFinite(x) || x < 0) throw new Error(`Row ${r + 1} (${hand}): the ${what} "${cell ?? ''}" is not a number`);
      return x;
    };
    let w = 1;
    if (weightCol >= 0) {
      w = num(cells[weightCol], header[weightCol]);
      // A combos column counts the hand's combos, so each live combo gets its share.
      if (/combos|count/i.test(header[weightCol])) w = w / all;
      else if (w > 1) weightPercent = true;
    }
    const vals = actionCols.map((c) => num(cells[c.i], `${c.name} frequency`));
    if (vals.some((v) => v > 1.0001)) percent = true;
    rows.push({ combos, w, vals });
  }
  if (!rows.length) throw new Error('No row holds a hand that is possible on this board');

  const sums = new Map<PostflopClass, { w: number; a: number[] }>();
  let read = 0;
  for (const row of rows) {
    const vals = percent ? row.vals.map((v) => v / 100) : row.vals;
    const total = vals.reduce((t, v) => t + v, 0);
    const w = weightPercent ? row.w / 100 : row.w;
    if (total <= 0 || !(w > 0)) continue;
    for (const i of row.combos) {
      const [a, b] = COMBO_CARDS[i];
      const cls = classifyHand([a, b], board);
      const s = sums.get(cls) ?? { w: 0, a: new Array(actionCols.length).fill(0) };
      s.w += w;
      vals.forEach((v, k) => (s.a[k] += (w * v) / total));
      sums.set(cls, s);
      read++;
    }
  }
  if (!read) throw new Error('Every row has a weight or frequencies of zero');

  const classes: SolverSpot['classes'] = {};
  for (const cls of POSTFLOP_CLASSES) {
    const s = sums.get(cls);
    if (!s || s.w <= 0) continue;
    const share = (pick: (a: Action) => boolean) => actionCols.reduce((t, c, k) => t + (pick(c.action) ? s.a[k] : 0), 0) / s.w;
    if (facing) {
      classes[cls] = { w: s.w, fold: share((a) => a.kind === 'fold'), call: share((a) => a.kind === 'call'), raise: share((a) => a.kind === 'raise') };
    } else {
      // Unsized and all-in bets count as big; sized ones split at the trainer's small-bet line.
      const small = share((a) => a.kind === 'bet' && a.f !== null && a.f <= SMALL_BET_MAX);
      const big = share((a) => a.kind === 'bet' && (a.f === null || a.f > SMALL_BET_MAX));
      classes[cls] = { w: s.w, check: share((a) => a.kind === 'check'), small, big };
    }
  }
  const spot: SolverSpot = { label: opts.label.trim().slice(0, 80) || 'Imported spot', board: board.map(cardText).join(''), kind: opts.kind, classes };
  if (f !== undefined) spot.f = f;
  return { spot: roundSpot(spot), combos: read, actions: actionCols.map((c) => c.name), ignored };
}

const cardText = (c: Card) => '23456789TJQKA'[c >> 2] + 'cdhs'[c & 3];

function looksLikeHand(cell: string | undefined): boolean {
  const t = (cell ?? '').replace(/\s+/g, '');
  return /^([2-9TJQKA][cdhs]){2}$/i.test(t) || /^[2-9TJQKA]{2}[so]?$/i.test(t);
}

const r4 = (x: number) => Math.round(x * 1e4) / 1e4;

/** Rounds a spot's numbers so a saved pack stays small and reads cleanly. */
function roundSpot(spot: SolverSpot): SolverSpot {
  const classes: SolverSpot['classes'] = {};
  for (const [cls, v] of Object.entries(spot.classes) as [PostflopClass, ActFreq | FacingFreq][]) {
    classes[cls] = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, r4(x)])) as unknown as ActFreq | FacingFreq;
  }
  return { ...spot, classes };
}

// ---- Turning spots into table entries ----

const clip01 = (x: number) => Math.min(1, Math.max(0, x));

/**
 * Averages the spots of a pack into per-class table entries, weighting each spot by how much of
 * the class it holds. First-to-act and lead spots set the small and big bet shares. Facing-bet
 * spots set the continue line: with two or more bet sizes for a class, its base and slope are
 * fitted to them by least squares (the slope never below zero); with one size, the built-in
 * slope is kept and the base is moved to match. Bets bigger than the line's limit (maxSize in
 * actions.json) set only the raise share, since past it the overbet rule takes over. Facing-raise
 * spots set how much less often a class continues against a raise than the line says it
 * continues against a bet of that size.
 *
 * The same entries are also worked out for each board texture from that texture's spots alone
 * (`byTexture`), so a dry and a wet flop keep the solver's different strategies; boards of a
 * texture with no spot use the average of all spots, scaled by the texture's multipliers.
 */
export function overridesFrom(spots: readonly SolverSpot[]): PostflopOverrides {
  const out = classOverrides(spots);
  const groups = new Map<Texture, SolverSpot[]>();
  for (const s of spots) {
    const t = boardTexture(readBoard(s.board));
    groups.set(t, [...(groups.get(t) ?? []), s]);
  }
  if (groups.size) out.byTexture = Object.fromEntries(TEXTURES.filter((t) => groups.has(t)).map((t) => [t, classOverrides(groups.get(t)!, t)]));
  return out;
}

/** The table entries from one set of spots; `tex` when they all share that board texture. */
function classOverrides(spots: readonly SolverSpot[], tex?: Texture): PostflopOverrides {
  const out: PostflopOverrides = {};
  for (const kind of ['act', 'lead'] as const) {
    const table = kind === 'act' ? 'firstToAct' : 'leadIntoAggressor';
    for (const cls of POSTFLOP_CLASSES) {
      let w = 0, small = 0, big = 0;
      for (const s of spots) {
        if (s.kind !== kind) continue;
        const c = s.classes[cls] as ActFreq | undefined;
        if (!c || !(c.w > 0)) continue;
        w += c.w;
        small += c.w * c.small;
        big += c.w * c.big;
      }
      if (w <= 0) continue;
      const t = (out[table] ??= {});
      (t.betSmall ??= {})[cls] = r4(small / w);
      (t.betBig ??= {})[cls] = r4(big / w);
    }
  }

  const { maxSize } = ACTIONS.facingBet;
  const line: Partial<Record<PostflopClass, { base: number; slope: number }>> = {};
  for (const cls of POSTFLOP_CLASSES) {
    const pts: { f: number; cont: number; w: number }[] = [];
    let contW = 0, raiseW = 0;
    for (const s of spots) {
      if (s.kind !== 'facingBet' || s.f === undefined) continue;
      const c = s.classes[cls] as FacingFreq | undefined;
      if (!c || !(c.w > 0)) continue;
      const cont = c.call + c.raise;
      contW += c.w * cont;
      raiseW += c.w * c.raise;
      if (s.f <= maxSize) pts.push({ f: s.f, cont, w: c.w });
    }
    if (contW > 0) ((out.facingBet ??= {}).raise ??= {})[cls] = r4(clip01(raiseW / contW));
    if (!pts.length) continue;
    const W = pts.reduce((t, p) => t + p.w, 0);
    const mf = pts.reduce((t, p) => t + p.w * p.f, 0) / W;
    const mc = pts.reduce((t, p) => t + p.w * p.cont, 0) / W;
    const vf = pts.reduce((t, p) => t + p.w * (p.f - mf) ** 2, 0) / W;
    let slope = builtInValue('facingBet', 'slope', cls);
    if (vf > 1e-6) {
      const cov = pts.reduce((t, p) => t + p.w * (p.f - mf) * (p.cont - mc), 0) / W;
      slope = Math.max(0, -cov / vf);
    }
    const base = Math.min(2, Math.max(0, mc + slope * mf));
    line[cls] = { base, slope };
    const fb = (out.facingBet ??= {});
    (fb.base ??= {})[cls] = r4(base);
    (fb.slope ??= {})[cls] = r4(slope);
  }

  for (const cls of POSTFLOP_CLASSES) {
    const fitted = line[cls];
    const l = fitted ?? { base: builtInValue('facingBet', 'base', cls), slope: builtInValue('facingBet', 'slope', cls) };
    // Without a fitted line, the texture's multiplier says how this class meets a bet on these boards.
    const scale = !fitted && tex ? ACTIONS.textures[tex].continue[cls] : 1;
    let w = 0, sum = 0;
    for (const s of spots) {
      if (s.kind !== 'facingRaise' || s.f === undefined) continue;
      const c = s.classes[cls] as FacingFreq | undefined;
      if (!c || !(c.w > 0)) continue;
      const vsBet = clip01(clip01(l.base - l.slope * Math.min(s.f, maxSize)) * scale);
      if (vsBet <= 0) continue;
      w += c.w;
      sum += c.w * clip01((c.call + c.raise) / vsBet);
    }
    if (w > 0) (((out.facingRaise ??= {}).continue ??= {})[cls] = r4(sum / w));
  }
  return out;
}

// ---- Packs ----

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

function checkSpot(raw: unknown, n: number): SolverSpot {
  const where = `Spot ${n}`;
  const s = raw as Partial<SolverSpot> | null;
  if (!s || typeof s !== 'object') throw new Error(`${where} is not a spot`);
  if (!SPOT_KINDS.some((k) => k.kind === s.kind)) throw new Error(`${where}: "${String(s.kind)}" is not a kind of spot`);
  if (typeof s.board !== 'string') throw new Error(`${where} has no board`);
  const board = readBoard(s.board);
  const kind = s.kind as SpotKind;
  if (isFacing(kind) && !(isNum(s.f) && s.f > 0 && s.f <= 20)) throw new Error(`${where}: the bet faced must be a share of the pot`);
  if (!s.classes || typeof s.classes !== 'object') throw new Error(`${where} has no hand classes`);
  const classes: SolverSpot['classes'] = {};
  const keys = isFacing(kind) ? ['fold', 'call', 'raise'] : ['check', 'small', 'big'];
  for (const [cls, v] of Object.entries(s.classes as Record<string, unknown>)) {
    if (!POSTFLOP_CLASSES.includes(cls as PostflopClass)) throw new Error(`${where}: "${cls}" is not a hand class`);
    const o = v as Record<string, unknown> | null;
    if (!o || typeof o !== 'object' || !isNum(o.w) || o.w < 0) throw new Error(`${where}, ${cls}: needs a weight`);
    const vals = keys.map((k) => o[k]);
    if (!vals.every((x) => isNum(x) && x >= 0 && x <= 1)) throw new Error(`${where}, ${cls}: each of ${keys.join(', ')} must be a share from 0 to 1`);
    const total = (vals as number[]).reduce((t, x) => t + x, 0);
    if (Math.abs(total - 1) > 0.01) throw new Error(`${where}, ${cls}: ${keys.join(', ')} add up to ${total.toFixed(2)}, not 1`);
    classes[cls as PostflopClass] = Object.fromEntries([['w', o.w], ...keys.map((k, i) => [k, vals[i]])]) as unknown as ActFreq | FacingFreq;
  }
  const label = typeof s.label === 'string' && s.label.trim() ? s.label.trim().slice(0, 80) : `Spot ${n}`;
  const spot: SolverSpot = { label, board: board.map(cardText).join(''), kind, classes };
  if (isFacing(kind)) spot.f = s.f;
  return spot;
}

/** Reads a postflop pack file, checking every spot; throws a plain-language error on a bad file. */
export function parsePostflopPack(text: string): PostflopPack {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('This file is not a postflop pack: it is not JSON');
  }
  const p = raw as Partial<PostflopPack> | null;
  if (!p || typeof p !== 'object' || p.app !== POSTFLOP_PACK_APP) throw new Error('This file is not a Poker Coach postflop pack');
  if (p.v !== POSTFLOP_PACK_VERSION) throw new Error(`This postflop pack is version ${String(p.v)}; this trainer reads version ${POSTFLOP_PACK_VERSION}`);
  if (!Array.isArray(p.spots) || !p.spots.length) throw new Error('This postflop pack holds no spots');
  if (p.spots.length > 500) throw new Error('This postflop pack holds more than 500 spots');
  const spots = p.spots.map((s, i) => checkSpot(s, i + 1));
  const name = typeof p.name === 'string' && p.name.trim() ? p.name.trim().slice(0, 80) : 'Imported postflop play';
  const savedAt = typeof p.savedAt === 'string' && !Number.isNaN(Date.parse(p.savedAt)) ? p.savedAt : new Date(0).toISOString();
  return { app: POSTFLOP_PACK_APP, v: POSTFLOP_PACK_VERSION, name, savedAt, spots };
}

export function makePostflopPack(name: string, spots: SolverSpot[], now = new Date()): PostflopPack {
  return { app: POSTFLOP_PACK_APP, v: POSTFLOP_PACK_VERSION, name, savedAt: now.toISOString(), spots };
}

export const postflopPackText = (p: PostflopPack) => JSON.stringify(p, null, 1);
export const postflopPackFileName = (p: PostflopPack) => `poker-coach-postflop-${p.savedAt.slice(0, 10)}.json`;
