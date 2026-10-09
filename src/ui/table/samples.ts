// Hard-coded hands for milestone 2. Built with the real engine so every stack and pot is consistent.

import { parseCards } from '../../engine/cards';
import { applyAction, newHand, type Action, type HandState } from '../../engine/hand';

export interface OpponentRead {
  seat: number;
  line: string;
  range: string;
  note: string;
}

export interface SampleSpot {
  id: string;
  title: string;
  state: HandState;
  hero: number;
  profiles: Record<number, string>;
  reads: OpponentRead[];
  heroRead: string;
  nudge: string;
  /** How the opponents interact in a multiway pot. */
  interaction?: string;
}

const cfg = { tableSize: 6, sb: 25, bb: 50 };
// Seats clockwise from SB: 0 SB, 1 BB, 2 UTG, 3 HJ, 4 CO, 5 BTN.

function build(stacks: number[], hole: (string | null)[], board: string, actions: Action[]): HandState {
  let s = newHand({
    config: cfg,
    stacks,
    hole: hole.map((h) => (h ? parseCards(h) : null)),
    board: parseCards(board),
    seed: 11,
  });
  for (const a of actions) s = applyAction(s, a);
  return s;
}

const F: Action = { type: 'fold' };
const C: Action = { type: 'call' };
const X: Action = { type: 'check' };

export const SAMPLES: SampleSpot[] = [
  {
    id: 'preflop',
    title: 'BB vs BTN open',
    hero: 1,
    state: build(
      [4810, 5000, 6240, 5000, 3875, 5150],
      [null, 'AdJc', null, null, null, null],
      'Ks8h4c7dQs',
      [F, F, F, { type: 'raise', to: 125 }, F],
    ),
    profiles: { 0: 'Loose-passive', 2: 'Nit', 3: 'Default', 4: 'Default', 5: 'Aggro reg' },
    reads: [
      {
        seat: 5,
        line: 'BTN · opens to 2.5bb after three folds',
        range: '22+, A2s+, K2s+, Q5s+, J7s+, T7s+, 96s+, 85s+, 75s+, 64s+, 54s, A5o+, K9o+, Q9o+, J9o+, T9o',
        note: 'A wide steal range. An aggressive regular opens close to all of it.',
      },
    ],
    heroRead: 'From the BB you close the action and are already in for 1bb, so you defend wider than any other seat.',
    nudge: 'AJo is well ahead of a wide button range. The question is whether it plays better as a call or a 3-bet.',
  },
  {
    id: 'flop',
    title: 'Multiway flop facing a c-bet',
    hero: 5,
    state: build(
      [5000, 5000, 5000, 5000, 4400, 5000],
      [null, null, null, null, null, 'AhQh'],
      'Kh9h4cTs2d',
      // UTG opens, CO and hero call; on the flop UTG c-bets and CO calls.
      [{ type: 'raise', to: 150 }, F, C, C, F, F, { type: 'bet', to: 225 }, C],
    ),
    profiles: { 0: 'Default', 1: 'Nit', 2: 'Default', 3: 'Default', 4: 'Loose-passive' },
    reads: [
      {
        seat: 2,
        line: 'UTG · opens 3bb, c-bets 43% pot into two players',
        range: 'TT+, AQs+, AKo, KQs, KJs, A5s, QJs, JTs, T9s, 99',
        note: 'A smaller c-bet multiway still leans on value: strong Kx, sets, and some flush draws.',
      },
      {
        seat: 4,
        line: 'CO · flats the UTG open, calls the c-bet',
        range: '99-22, ATs-A2s, KTs+, QTs+, JTs, T9s, 98s, 87s, AJo+, KQo',
        note: 'Low-stakes callers rarely raise draws here. Expect Kx, 9x, and hearts.',
      },
    ],
    interaction: 'You act last, behind the bettor and a caller. The CO has already passed on raising, which weakens their range.',
    heroRead: 'Your flat call caps you a little (no AA or KK), but you hold the nut-flush blocker and the A♥ is the best heart.',
    nudge: 'You have 12 or more outs against most of these ranges. Count what a raise wins against two players before you choose.',
  },
  {
    id: 'turn',
    title: 'Turn, checked to you',
    hero: 4,
    state: build(
      [5000, 4530, 5000, 5000, 5000, 5000],
      [null, null, null, null, 'TsTc', null],
      '8s5d2cJdKh',
      [F, F, { type: 'raise', to: 125 }, F, F, C, X, { type: 'bet', to: 175 }, C, X],
    ),
    profiles: { 0: 'Default', 1: 'Loose-passive', 2: 'Default', 3: 'Nit', 5: 'Aggro reg' },
    reads: [
      {
        seat: 1,
        line: 'BB · defends vs CO open, check-calls 64% pot, checks the turn',
        range: '77-22, 98s, 87s, 76s, 65s, 54s, A5s-A2s, A8s, K8s, 98o, 87o, A8o, Q8s, J8s, T8s, 99, 66, 44, 33',
        note: 'Mostly an 8x, 5x and pair-plus-draw range. The J♦ adds some backdoor diamond draws.',
      },
    ],
    heroRead: 'Your range has every overpair; the BB has few hands that beat TT.',
    nudge: 'Ask which worse hands call a second bet, and whether checking back lets the BB catch up cheaply.',
  },
];

