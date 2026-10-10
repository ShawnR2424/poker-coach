// Hand-picked postflop practice spots. Each one is played out by the engine from a script,
// so pot sizes, stacks and the ranges all come from real actions.

import { parseCards, type Card } from '../cards';
import { applyAction, newHand, type Action, type HandState } from '../hand';
import { clockwiseFromSB, type Position } from '../positions';
import type { Range } from '../range';
import { narrowHand, type PostflopStep } from './narrow';

export interface PostflopSpotDef {
  id: string;
  title: string;
  /** One line on what the spot is about, shown before the hero acts. */
  setup: string;
  /** The idea the spot teaches, shown with the feedback. */
  concept: string;
  hero: Position;
  villain: Position;
  heroCards: string;
  villainCards: string;
  board: string;
  stacksBB: number;
  /** Actions in order. Seats not listed fold when it is their turn preflop. */
  script: [Position, Action][];
}

const CONFIG = { tableSize: 6, sb: 25, bb: 50 };
const POSITIONS = clockwiseFromSB(6);

export const POSTFLOP_SPOTS: PostflopSpotDef[] = [
  {
    id: 'btn-cbet-dry',
    concept: 'Value and protection. When most of their range is worse hands and draws, a bet charges the draws and gets called by worse pairs. A check gives free cards and wins less from the hands that would have called.',
    title: 'Checked to you on a dry flop',
    setup: 'You opened the button and the big blind called. They check a T-7-3 rainbow flop to you.',
    hero: 'BTN',
    villain: 'BB',
    heroCards: 'AhTh',
    villainCards: '9c8c',
    board: 'Ts7d3c 2s Kd',
    stacksBB: 100,
    script: [
      ['BTN', { type: 'raise', to: 125 }],
      ['BB', { type: 'call' }],
      ['BB', { type: 'check' }],
    ],
  },
  {
    id: 'bb-turn-draw',
    concept: 'Semi-bluffing. A raise wins two ways: they fold now, or you hit one of your outs. Calling only wins the second way, so strong draws often earn more by raising than by calling.',
    title: 'Combo draw facing a turn bet',
    setup: 'You defended the big blind against a cutoff open, called a small flop bet, and the 9 on the turn gave you an open-ender to go with your flush draw. Now you face a two-thirds pot bet.',
    hero: 'BB',
    villain: 'CO',
    heroCards: 'JhTh',
    villainCards: 'KsQd',
    board: 'Kh8h4c 9s 3d',
    stacksBB: 100,
    script: [
      ['CO', { type: 'raise', to: 125 }],
      ['BB', { type: 'call' }],
      ['BB', { type: 'check' }],
      ['CO', { type: 'bet', to: 90 }],
      ['BB', { type: 'call' }],
      ['BB', { type: 'check' }],
      ['CO', { type: 'bet', to: 300 }],
    ],
  },
  {
    id: 'btn-river-catch',
    concept: 'Bluff-catching. On the river you only need to win as often as the pot odds say. Big river bets from this player include many missed draws, and your hand beats all of them.',
    title: 'River bluff-catch with top pair',
    setup: 'You called a cutoff open on the button with top pair, good kicker. The turn checked through and the cutoff bets big on the river.',
    hero: 'BTN',
    villain: 'CO',
    heroCards: 'KhQs',
    villainCards: 'JdTd',
    board: 'Qd9s4h 2c 7s',
    stacksBB: 100,
    script: [
      ['CO', { type: 'raise', to: 125 }],
      ['BTN', { type: 'call' }],
      ['CO', { type: 'bet', to: 100 }],
      ['BTN', { type: 'call' }],
      ['CO', { type: 'check' }],
      ['BTN', { type: 'check' }],
      ['CO', { type: 'bet', to: 375 }],
    ],
  },
  {
    id: 'sb-3bp-low-spr',
    concept: 'Commitment. With less than two pot-sized bets behind, a strong one-pair hand is worth stacking off. Bet now; the right size matters less than getting the money in against worse hands.',
    title: 'Queens at a low stack-to-pot ratio',
    setup: 'Stacks are 50bb. You 3-bet the button open from the small blind and got called. You are first to act on K-7-2 with queens.',
    hero: 'SB',
    villain: 'BTN',
    heroCards: 'QhQc',
    villainCards: 'AdJd',
    board: 'Kd7s2c 5h 9c',
    stacksBB: 50,
    script: [
      ['BTN', { type: 'raise', to: 125 }],
      ['SB', { type: 'raise', to: 550 }],
      ['BTN', { type: 'call' }],
    ],
  },
];

export interface BuiltSpot {
  def: PostflopSpotDef;
  state: HandState;
  hero: number;
  villain: number;
  villainRange: Range;
  heroRange: Range;
  /** The hero's own postflop narrowing steps, for the read of their line. */
  heroSteps: PostflopStep[];
  heroPreflopAggressor: boolean;
}

const seatOf = (p: Position) => POSITIONS.indexOf(p);

export function buildSpot(def: PostflopSpotDef, opts = { lowStakes: false }): BuiltSpot {
  const hero = seatOf(def.hero), villain = seatOf(def.villain);
  const hole: (Card[] | null)[] = POSITIONS.map(() => null);
  hole[hero] = parseCards(def.heroCards);
  hole[villain] = parseCards(def.villainCards);
  let s = newHand({
    config: CONFIG,
    stacks: POSITIONS.map(() => def.stacksBB * CONFIG.bb),
    hole,
    board: parseCards(def.board),
    seed: 7,
  });
  const script = [...def.script];
  while (script.length) {
    const [pos, action] = script[0];
    if (s.toAct === null) throw new Error(`${def.id}: hand ended early`);
    if (POSITIONS[s.toAct] === pos) {
      s = applyAction(s, action);
      script.shift();
    } else {
      if (s.street !== 'preflop') throw new Error(`${def.id}: ${POSITIONS[s.toAct]} acts before ${pos}`);
      s = applyAction(s, { type: 'fold' });
    }
  }
  if (s.toAct !== hero) throw new Error(`${def.id}: hero is not to act`);
  const preRaises = s.actions.filter((a) => a.street === 'preflop' && a.type === 'raise');
  const heroN = narrowHand(s, hero, 'baseline', opts);
  return {
    def,
    state: s,
    hero,
    villain,
    villainRange: narrowHand(s, villain, 'pool', opts).range,
    heroRange: heroN.range,
    heroSteps: heroN.steps,
    heroPreflopAggressor: preRaises.length > 0 && preRaises[preRaises.length - 1].player === hero,
  };
}
