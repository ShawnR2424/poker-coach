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
  /**
   * What the model must say for the concept text to hold: the kinds the best action may be,
   * and the kinds graded a mistake ('allIn' covers the all-in option alone). Checked by tests.
   */
  answer: { best: AnswerKind[]; mistakes: AnswerKind[] };
}

export type AnswerKind = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allIn';

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
    answer: { best: ['bet'], mistakes: [] },
  },
  {
    id: 'bb-turn-draw',
    concept: 'Semi-bluffing. A raise wins two ways: they fold now, or you hit one of your outs. Calling only wins the second way, but a turn barrel from the cutoff keeps most of its pairs against a raise, so calling and raising come out close. Both beat folding a draw this strong.',
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
    answer: { best: ['call', 'raise'], mistakes: ['allIn'] },
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
    answer: { best: ['call'], mistakes: ['fold'] },
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
    answer: { best: ['bet'], mistakes: ['check'] },
  },
  {
    id: 'btn-ace-high-cbet',
    concept: 'Range advantage. You raised from the button, so your range has far more aces than the big blind\'s, and they rarely have a strong hand on a dry ace-high board. A small, frequent c-bet folds out most of their weak hands, even when you have nothing.',
    title: 'C-bet with nothing on an ace-high flop',
    setup: 'You opened the button with a small suited connector and the big blind called. They check an A-8-3 rainbow flop to you. You missed.',
    hero: 'BTN',
    villain: 'BB',
    heroCards: '6s5s',
    villainCards: 'Kd9h',
    board: 'Ac8d3h Tc 2s',
    stacksBB: 100,
    script: [
      ['BTN', { type: 'raise', to: 125 }],
      ['BB', { type: 'call' }],
      ['BB', { type: 'check' }],
    ],
    answer: { best: ['bet'], mistakes: ['check', 'allIn'] },
  },
  {
    id: 'co-cbet-raised',
    concept: 'Respect the raise. A flop raise from the button is mostly sets, two pair and strong draws, so top pair is a bluff-catcher now. Calling or folding are close; re-raising only gets called by hands that beat you.',
    title: 'Top pair facing a raise',
    setup: 'You opened the cutoff, the button called, and you c-bet top pair on J-8-3. The button raises.',
    hero: 'CO',
    villain: 'BTN',
    heroCards: 'KcJc',
    villainCards: '8h8d',
    board: 'Jd8s3h 6c Qs',
    stacksBB: 100,
    script: [
      ['CO', { type: 'raise', to: 125 }],
      ['BTN', { type: 'call' }],
      ['CO', { type: 'bet', to: 100 }],
      ['BTN', { type: 'raise', to: 330 }],
    ],
    answer: { best: ['fold', 'call'], mistakes: ['raise'] },
  },
  {
    id: 'bb-gutshot-big-turn',
    concept: 'Pricing a draw. A gutshot has four outs, about 9% to hit on the river. Facing a pot-sized bet you need 33% equity, and hitting will not always get paid, so let it go.',
    title: 'Gutshot facing a big turn bet',
    setup: 'You defended the big blind against a cutoff open and called a small flop bet. The 8 on the turn gives you a gutshot, and the cutoff now bets the pot.',
    hero: 'BB',
    villain: 'CO',
    heroCards: '6h5h',
    villainCards: 'KdQd',
    board: 'Ks9d4c 8s 2c',
    stacksBB: 100,
    script: [
      ['CO', { type: 'raise', to: 125 }],
      ['BB', { type: 'call' }],
      ['BB', { type: 'check' }],
      ['CO', { type: 'bet', to: 90 }],
      ['BB', { type: 'call' }],
      ['BB', { type: 'check' }],
      ['CO', { type: 'bet', to: 430 }],
    ],
    answer: { best: ['fold'], mistakes: ['call', 'raise'] },
  },
  {
    id: 'co-overpair-turn-raise',
    concept: 'Facing a check-raise. When the big blind check-raises the turn, their range is mostly two pair, sets and strong draws. Queens are too good to fold at this price, but re-raising only gets called by the hands that beat you.',
    title: 'Overpair facing a turn check-raise',
    setup: 'You opened the cutoff with queens and bet the flop and turn on T-8-4-7. The big blind called the flop and check-raises the turn.',
    hero: 'CO',
    villain: 'BB',
    heroCards: 'QsQh',
    villainCards: '8c7c',
    board: 'Td8d4s 7s 2h',
    stacksBB: 100,
    script: [
      ['CO', { type: 'raise', to: 125 }],
      ['BB', { type: 'call' }],
      ['BB', { type: 'check' }],
      ['CO', { type: 'bet', to: 100 }],
      ['BB', { type: 'call' }],
      ['BB', { type: 'check' }],
      ['CO', { type: 'bet', to: 300 }],
      ['BB', { type: 'raise', to: 900 }],
    ],
    answer: { best: ['call'], mistakes: ['fold', 'raise'] },
  },
  {
    id: 'btn-turn-set-wet',
    concept: 'Protecting a set. On a board full of draws, with about five pot-sized bets behind, get the money in now. Calling lets every flush and straight draw see the river at a fair price.',
    title: 'Set on a wet turn',
    setup: 'You called a cutoff open on the button with sixes and flopped a set on 9-6-5 with two hearts. The cutoff bets again on the king turn.',
    hero: 'BTN',
    villain: 'CO',
    heroCards: '6s6d',
    villainCards: 'AhKh',
    board: '9h6h5c Kc 2d',
    stacksBB: 100,
    script: [
      ['CO', { type: 'raise', to: 125 }],
      ['BTN', { type: 'call' }],
      ['CO', { type: 'bet', to: 110 }],
      ['BTN', { type: 'call' }],
      ['CO', { type: 'bet', to: 300 }],
    ],
    answer: { best: ['allIn'], mistakes: ['fold', 'call'] },
  },
  {
    id: 'btn-river-thin-value',
    concept: 'Value against a capped range. Their check-call and two checks leave mostly second pair and worse, so top pair with a weak kicker is a value hand. A medium or large bet gets called by more worse hands than a small one earns.',
    title: 'Top pair, weak kicker, checked to on the river',
    setup: 'You c-bet the button open on K-7-4 and the big blind called. The turn checked through, and they check the river to you.',
    hero: 'BTN',
    villain: 'BB',
    heroCards: 'Kh9h',
    villainCards: 'QsQc',
    board: 'Kd7c4s 2h 3d',
    stacksBB: 100,
    script: [
      ['BTN', { type: 'raise', to: 125 }],
      ['BB', { type: 'call' }],
      ['BB', { type: 'check' }],
      ['BTN', { type: 'bet', to: 85 }],
      ['BB', { type: 'call' }],
      ['BB', { type: 'check' }],
      ['BTN', { type: 'check' }],
      ['BB', { type: 'check' }],
    ],
    answer: { best: ['bet'], mistakes: ['check', 'allIn'] },
  },
  {
    id: 'btn-river-missed-draw',
    concept: 'Choosing bluffs. A range that called the flop and turn is full of pairs that will not fold to a big bet. Giving up or a small stab is fine; a big bluff into a sticky range just burns money.',
    title: 'Missed flush draw on the river',
    setup: 'You barreled the flop and turn from the button with a flush draw and the big blind called both. The river bricks and they check to you.',
    hero: 'BTN',
    villain: 'BB',
    heroCards: 'QhJh',
    villainCards: '9s8s',
    board: 'Th9h3c 2d 4s',
    stacksBB: 100,
    script: [
      ['BTN', { type: 'raise', to: 125 }],
      ['BB', { type: 'call' }],
      ['BB', { type: 'check' }],
      ['BTN', { type: 'bet', to: 90 }],
      ['BB', { type: 'call' }],
      ['BB', { type: 'check' }],
      ['BTN', { type: 'bet', to: 250 }],
      ['BB', { type: 'call' }],
      ['BB', { type: 'check' }],
    ],
    answer: { best: ['check', 'bet'], mistakes: ['allIn'] },
  },
  {
    id: 'bb-underpair-triple',
    concept: 'Hand reading over three streets. A player who bets the flop and turn and then makes a big river bet at these stakes rarely has a bluff. Nines were a fine call earlier but beat almost nothing that bets this much now.',
    title: 'Underpair facing a river overbet',
    setup: 'You defended the big blind with nines against a button open and called bets on the K-8-4 flop and the turn. The button now bets more than the pot on the river.',
    hero: 'BB',
    villain: 'BTN',
    heroCards: '9c9d',
    villainCards: 'AdKd',
    board: 'Kh8s4d 2c Js',
    stacksBB: 100,
    script: [
      ['BTN', { type: 'raise', to: 125 }],
      ['BB', { type: 'call' }],
      ['BB', { type: 'check' }],
      ['BTN', { type: 'bet', to: 90 }],
      ['BB', { type: 'call' }],
      ['BB', { type: 'check' }],
      ['BTN', { type: 'bet', to: 300 }],
      ['BB', { type: 'call' }],
      ['BB', { type: 'check' }],
      ['BTN', { type: 'bet', to: 1000 }],
    ],
    answer: { best: ['fold'], mistakes: ['call', 'raise'] },
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
