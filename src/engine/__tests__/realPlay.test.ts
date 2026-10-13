import { describe, expect, it } from 'vitest';
import { importHands, IMPORTED_LEVEL } from '../session/import';
import { decisionStreet, importedHands, realPlayReport, realStats, share } from '../session/realPlay';
import { BTN_CBET, SAMPLE_HANDS } from '../session/sampleHands';
import { addHands, parseSaved, type HandRecord } from '../session/session';

/** BTN_CBET with its preflop action and result replaced. */
function variant(id: number, preflop: string, rest: string): string {
  const head = BTN_CBET.slice(0, BTN_CBET.indexOf('Anna: folds')).replace('250000000001', String(250000000100 + id));
  return `${head}${preflop}\n${rest}`;
}

const THREE_BET = variant(1, 'Anna: folds\nBen: folds\nCara: raises $0.75 to $1.25\nHero: raises $2.75 to $4\nDan: folds\nEve: folds\nCara: folds',
  'Uncalled bet ($2.75) returned to Hero\nHero collected $3.25 from pot\n*** SUMMARY ***\nTotal pot $3.25 | Rake $0\nSeat 4: Hero (button) collected ($3.25)');
const FOLD_TO_3BET = variant(2, 'Anna: folds\nBen: folds\nCara: folds\nHero: raises $0.75 to $1.25\nDan: raises $3.75 to $5\nEve: folds\nHero: folds',
  'Uncalled bet ($3.75) returned to Dan\nDan collected $3 from pot\n*** SUMMARY ***\nTotal pot $3 | Rake $0\nSeat 5: Dan (small blind) collected ($3)');
const FOLD_FIRST = variant(3, 'Anna: folds\nBen: folds\nCara: raises $0.75 to $1.25\nHero: folds\nDan: folds\nEve: folds',
  'Uncalled bet ($0.75) returned to Cara\nCara collected $1.25 from pot\n*** SUMMARY ***\nTotal pot $1.25 | Rake $0\nSeat 3: Cara collected ($1.25)');

// The sample hands include one heads-up hand, which the import skips.
const read = (text: string) => {
  const r = importHands(text, '2026-10-13T00:00:00.000Z');
  expect(r.skipped.map((x) => x.id)).toEqual(text.includes(SAMPLE_HANDS) ? ['250000000004'] : []);
  return r.hands.map((h, i): HandRecord => ({ ...h.record, n: i + 1 }));
};

describe('realStats', () => {
  it('reads an open that sees the flop', () => {
    const [h] = read(BTN_CBET);
    expect(h.real).toEqual({ pos: 'BTN', vpip: true, pfr: true, threeBetOpp: false, threeBet: false, foldTo3BetOpp: false, foldTo3Bet: false, sawFlop: true });
  });

  it('reads a 3-bet, a fold to a 3-bet and a fold facing an open', () => {
    const [a, b, c] = read([THREE_BET, FOLD_TO_3BET, FOLD_FIRST].join('\n\n'));
    expect(a.real).toMatchObject({ vpip: true, pfr: true, threeBetOpp: true, threeBet: true, sawFlop: false });
    expect(b.real).toMatchObject({ vpip: true, pfr: true, threeBetOpp: false, foldTo3BetOpp: true, foldTo3Bet: true, sawFlop: false });
    expect(c.real).toMatchObject({ vpip: false, pfr: false, threeBetOpp: true, threeBet: false, sawFlop: false });
  });

  it('works the stats out again from the replay for hands saved before they were stored', () => {
    for (const h of read(SAMPLE_HANDS)) expect(realStats(h.replay!)).toEqual(h.real);
  });
});

describe('realPlayReport', () => {
  const hands = read([BTN_CBET, THREE_BET, FOLD_TO_3BET, FOLD_FIRST, SAMPLE_HANDS].join('\n\n'));

  it('adds up the preflop stats, results and grades', () => {
    const r = realPlayReport(hands);
    expect(r.hands).toBe(hands.length);
    expect(r.withStats).toBe(hands.length);
    const sum = (f: (h: HandRecord) => boolean) => hands.filter(f).length;
    expect(r.threeBet).toEqual({ n: sum((h) => h.real!.threeBet), of: sum((h) => h.real!.threeBetOpp) });
    expect(r.threeBet.n).toBeGreaterThanOrEqual(1);
    expect(r.threeBet.of).toBeGreaterThanOrEqual(2);
    expect(r.foldTo3Bet).toEqual({ n: sum((h) => h.real!.foldTo3Bet), of: sum((h) => h.real!.foldTo3BetOpp) });
    expect(r.sawFlop.n).toBe(sum((h) => h.real!.sawFlop));
    expect(r.vpip.of).toBe(hands.length);
    expect(share(r.pfr)).toBeGreaterThan(0);
    expect(r.netBB).toBeCloseTo(hands.reduce((t, h) => t + h.net / h.bb, 0));
    expect(r.bbPer100).toBeNull();
    const decisions = hands.flatMap((h) => h.decisions);
    expect(r.decisions).toBe(decisions.length);
    expect(r.byStreet.reduce((t, s) => t + s.decisions, 0)).toBe(decisions.length);
    expect(r.byStreet[0].lossBB).toBe(0);
    expect(r.byPosition.reduce((t, p) => t + p.hands, 0)).toBe(hands.length);
    expect(r.byPosition.find((p) => p.pos === 'BTN')!.hands).toBe(sum((h) => h.real!.pos === 'BTN'));
  });

  it('ranks leaks and costly decisions by the EV they lost', () => {
    const fake = (lossBB: number, tag: string): HandRecord => ({
      ...hands[0], n: 1, real: undefined, replay: undefined,
      decisions: [{ ...hands[0].decisions[1], verdict: 'mistake', tags: [tag], lossBB }],
    });
    const r = realPlayReport([fake(0.5, 'small'), fake(2, 'big'), fake(0.5, 'small'), fake(0, 'free')]);
    expect(r.leaks.map((l) => l.tag)).toEqual(['big', 'small', 'free']);
    expect(r.leaks[1]).toEqual({ tag: 'small', count: 2, lossBB: 1 });
    expect(r.costly.map((c) => c.lossBB)).toEqual([2, 0.5, 0.5]);
    // Hands without a replay or saved stats still count toward results and grades.
    expect(r.withStats).toBe(0);
    expect(r.decisions).toBe(4);
  });

  it('reports a win rate from ten hands', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ ...hands[0], n: i + 1 }));
    expect(realPlayReport(many).bbPer100).toBeCloseTo((many[0].net / many[0].bb) * 100);
  });
});

describe('importedHands', () => {
  it('collects imported hands from every saved session, leaving practice hands out', () => {
    const practice: Omit<HandRecord, 'n'> = { ...hands0(), level: 2 };
    let saved = parseSaved(null, new Date('2026-10-12T00:00:00Z'));
    saved = addHands(saved, [hands0(), practice], false);
    saved = addHands(saved, [hands0()], true, new Date('2026-10-13T00:00:00Z'));
    const got = importedHands(saved);
    expect(got).toHaveLength(2);
    expect(got.every((h) => h.level === IMPORTED_LEVEL)).toBe(true);
  });
});

function hands0(): Omit<HandRecord, 'n'> {
  return importHands(BTN_CBET).hands[0].record;
}

describe('decisionStreet', () => {
  it('reads the street from the label', () => {
    const [h] = read(BTN_CBET);
    expect(h.decisions.map(decisionStreet)).toEqual(['preflop', 'flop']);
  });
});
