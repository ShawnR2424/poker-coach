import { describe, expect, it } from 'vitest';
import { formatCard, formatCards } from '../cards';
import { advance, heroDecides, newGameHand, type LevelId } from '../game/levels';
import { applyAction, type Action, type HandState } from '../hand';
import { botPostflopAction } from '../postflop/bot';
import { PROFILES } from '../postflop/model';
import { botAction } from '../preflop/policy';
import { makeRng } from '../rng';
import { importHands, IMPORTED_LEVEL, splitHands } from '../session/import';
import { heroSteps, replayStates } from '../session/replay';
import { BTN_CBET, FOUR_HANDED_SHOWDOWN, GG_SB_SQUEEZE, HEADS_UP, SAMPLE_HANDS } from '../session/sampleHands';

const TOURNAMENT = `PokerStars Hand #250000000003: Tournament #3000000001, $5+$0.50 USD Hold'em No Limit - Level I (10/20) - 2024/05/01 21:00:00 ET
Table '3000000001 1' 9-max Seat #1 is the button
Seat 1: Hero (1500 in chips)
Seat 2: Jo (1500 in chips)
Seat 3: Kim (1500 in chips)
Jo: posts small blind 10
Kim: posts big blind 20
*** HOLE CARDS ***
Dealt to Hero [2c 3d]
Hero: folds`;

const OUT_OF_ORDER = BTN_CBET.replace('Anna: folds\nBen: folds', 'Ben: folds\nAnna: folds').replace('#250000000001', '#250000000005');

const ALL = [BTN_CBET, FOUR_HANDED_SHOWDOWN, TOURNAMENT, HEADS_UP, GG_SB_SQUEEZE, OUT_OF_ORDER].join('\n\n\n');
const AT = '2024-05-02T00:00:00.000Z';

describe('importing hand histories', () => {
  const res = importHands(ALL, AT);
  const byId = (id: string) => res.hands.find((h) => h.id === id)!.record;

  it('splits pasted text into hands and says why each skipped one was skipped', () => {
    expect(splitHands(ALL)).toHaveLength(6);
    expect(res.hands.map((h) => h.id)).toEqual(['250000000001', '250000000002', 'RC1234567']);
    expect(res.skipped).toEqual([
      { id: '250000000003', reason: 'tournament hands are not supported' },
      { id: '250000000004', reason: 'heads-up hands are not supported' },
      { id: '250000000005', reason: 'the actions do not follow the betting order' },
    ]);
  });

  it('rebuilds a 6-max hand exactly, with the result after rake', () => {
    const h = byId('250000000001');
    const r = h.replay!;
    const states = replayStates(r);
    const final = states[states.length - 1];
    expect(final.players[r.hero].position).toBe('BTN');
    expect(formatCards(final.players[r.hero].hole)).toBe('AhKd');
    expect(final.board.map(formatCard).join(' ')).toBe('Ks 7d 2c');
    expect(final.startingStacks).toEqual([6140, 5000, 5000, 4875, 5210, 5000]);
    expect(h.net).toBe(265 - 125);
    expect(h.level).toBe(IMPORTED_LEVEL);
    expect(r.hidden).toHaveLength(5);
    expect(r.fillers).toEqual([]);
  });

  it('grades every hero decision at its replay step', () => {
    const h = byId('250000000001');
    expect(h.decisions.map((d) => d.step)).toEqual(heroSteps(h.replay!));
    expect(h.decisions[0].label).toContain('BTN');
    expect(h.decisions[0].you).toBe('raise to $1.25 (2.5bb)');
    expect(h.decisions[1].label).toBe('Flop Ks7d2c');
    expect(h.decisions[1].move).toBe('bet');
    for (const d of h.decisions) expect(['correct', 'playable', 'mistake']).toContain(d.verdict);
    // Postflop decisions record the EV given up, which the progress charts add up.
    for (const d of h.decisions) if (d.move) expect(d.lossBB).toBeGreaterThanOrEqual(0);
    expect(h.decisions[1].lossBB).toBeDefined();
    expect(h.lesson.length).toBeGreaterThan(0);
  });

  it('plays a short table as 6-max with the empty early seats folding first', () => {
    const h = byId('250000000002');
    const r = h.replay!;
    const states = replayStates(r);
    const final = states[states.length - 1];
    expect(r.config.tableSize).toBe(6);
    expect(r.fillers).toEqual([2, 3]);
    expect(final.players[r.hero].position).toBe('CO');
    expect(final.players.findIndex((p) => p.position === 'BTN')).not.toBe(r.hero);
    // Finn's shown cards are used; only the blinds, who folded unseen, get stand-in cards.
    expect(formatCards(final.players[5].hole)).toBe('JhTc');
    expect(r.hidden).toEqual([0, 1]);
    expect(final.result!.wentToShowdown).toBe(true);
    expect(final.result!.net[r.hero]).toBe(-2450);
    expect(h.net).toBe(-2450);
    expect(h.decisions.map((d) => d.you.split(' ')[0])).toEqual(['raise', 'bet', 'bet', 'check', 'call']);
    expect(h.decisions.slice(1).every((d) => d.move !== undefined && d.bestMove !== undefined)).toBe(true);
  });

  it('reads GGPoker histories and a squeeze from the small blind', () => {
    const h = byId('RC1234567');
    const r = h.replay!;
    const final = replayStates(r).at(-1)!;
    expect(final.players[r.hero].position).toBe('SB');
    expect(r.config.bb).toBe(10);
    expect(h.net).toBe(203 - 100);
    expect(h.decisions[0].label).toMatch(/SB/);
  });
});

/** Writes a finished trainer hand as PokerStars text, the way a site would. */
function toPokerStars(s: HandState, hero: number, id: number): string {
  const $ = (c: number) => `$${(c / 100).toFixed(2)}`;
  const n = s.players.length;
  // Seat numbers: the button is seat n, the SB seat 1.
  const name = (i: number) => (i === hero ? 'Hero' : `P${i}`);
  const lines = [
    `PokerStars Hand #${id}:  Hold'em No Limit (${$(s.config.sb)}/${$(s.config.bb)} USD) - 2024/05/01 20:00:00 ET`,
    `Table 'Test' ${n}-max Seat #${n} is the button`,
    ...s.players.map((_, i) => `Seat ${i + 1}: ${name(i)} (${$(s.startingStacks[i])} in chips)`),
  ];
  const committed = new Array(n).fill(0);
  let street = 'preflop';
  const streetLine: Record<string, string> = {
    flop: `*** FLOP *** [${s.board.slice(0, 3).map(formatCard).join(' ')}]`,
    turn: `*** TURN *** [${s.board.slice(0, 3).map(formatCard).join(' ')}] [${s.board[3] !== undefined ? formatCard(s.board[3]) : ''}]`,
    river: `*** RIVER *** [${s.board.slice(0, 4).map(formatCard).join(' ')}] [${s.board[4] !== undefined ? formatCard(s.board[4]) : ''}]`,
  };
  for (const a of s.actions) {
    if (a.street !== street) {
      street = a.street;
      committed.fill(0);
      lines.push(streetLine[street]);
    }
    const allIn = a.allIn ? ' and is all-in' : '';
    if (a.type === 'post') lines.push(`${name(a.player)}: posts ${a.player === 0 ? 'small' : 'big'} blind ${$(a.added)}`);
    else if (a.type === 'fold') lines.push(`${name(a.player)}: folds`);
    else if (a.type === 'check') lines.push(`${name(a.player)}: checks`);
    else if (a.type === 'call') lines.push(`${name(a.player)}: calls ${$(a.added)}${allIn}`);
    else if (a.type === 'bet') lines.push(`${name(a.player)}: bets ${$(a.added)}${allIn}`);
    else lines.push(`${name(a.player)}: raises ${$(a.to - Math.max(...committed))} to ${$(a.to)}${allIn}`);
    if (a.type === 'post') lines.push(...(a.player === 1 ? ['*** HOLE CARDS ***', `Dealt to Hero [${s.players[hero].hole.map(formatCard).join(' ')}]`] : []));
    committed[a.player] = a.to;
  }
  // Streets dealt after the last action (all-in runouts).
  for (const st of ['flop', 'turn', 'river'] as const) {
    const len = st === 'flop' ? 3 : st === 'turn' ? 4 : 5;
    if (s.board.length >= len && !s.actions.some((a) => a.street === st) && !lines.includes(streetLine[st])) lines.push(streetLine[st]);
  }
  if (s.result!.wentToShowdown) {
    lines.push('*** SHOW DOWN ***');
    s.players.forEach((p, i) => { if (!p.folded) lines.push(`${name(i)}: shows [${p.hole.map(formatCard).join(' ')}]`); });
  }
  s.players.forEach((_, i) => {
    const won = s.result!.pots.filter((x) => x.winners.includes(i)).reduce((t, x) => t + x.amount / x.winners.length, 0);
    if (won > 0) lines.push(`${name(i)} collected ${$(Math.floor(won))} from pot`);
  });
  lines.push('*** SUMMARY ***');
  return lines.join('\n');
}

describe('sample hands', () => {
  it('three of the four import and the heads-up one is skipped', () => {
    const res = importHands(SAMPLE_HANDS, AT);
    expect(res.hands).toHaveLength(3);
    expect(res.skipped.map((x) => x.reason)).toEqual(['heads-up hands are not supported']);
  });
});

describe('round trip', () => {
  it('a hand the trainer played, written as a hand history, imports to the same actions and result', () => {
    const opts = { lowStakes: true };
    let checked = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const level = ([3, 4, 5] as LevelId[])[seed % 3];
      const rng = makeRng(seed * 101);
      const g = newGameHand(level, rng, opts);
      let s = advance(g, g.state, rng, opts);
      for (let t = 0; t < 30 && heroDecides(g, s); t++) {
        const a: Action = s.street === 'preflop' ? botAction(s, rng, opts) : botPostflopAction(s, rng, PROFILES.regular);
        s = advance(g, applyAction(s, a), rng, opts);
      }
      // Play the hand out: everyone checks or calls to the end.
      for (let t = 0; t < 40 && s.toAct !== null; t++) s = applyAction(s, { type: s.currentBet > s.players[s.toAct].committed ? 'call' : 'check' });
      if (!s.result) continue;
      const text = toPokerStars(s, g.hero, 9000 + seed);
      const res = importHands(text, '');
      expect(res.skipped, text).toEqual([]);
      const h = res.hands[0].record;
      const back = replayStates(h.replay!).at(-1)!;
      expect(back.actions.map((a) => [a.player, a.type, a.to])).toEqual(s.actions.map((a) => [a.player, a.type, a.to]));
      expect(formatCards(back.board)).toBe(formatCards(s.board));
      // Collected amounts are written rounded down to the cent, as a site would after any split.
      expect(Math.abs(h.net - s.result.net[g.hero])).toBeLessThanOrEqual(1);
      expect(h.decisions.map((d) => d.step)).toEqual(heroSteps(h.replay!).filter((k) => h.decisions.some((d) => d.step === k)));
      checked++;
    }
    expect(checked).toBeGreaterThan(40);
  }, 120_000);
});
