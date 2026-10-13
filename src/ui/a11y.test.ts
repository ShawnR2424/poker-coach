import { describe, expect, it } from 'vitest';
import { parseCard, parseCards } from '../engine/cards';
import { applyAction, newHand, type Action, type HandConfig, type HandState } from '../engine/hand';
import { cardName, cardsName, gradeSaid, gridStep, sentence, shortcutFor, tableNews, told } from './a11y';
import { spokenCards } from './CardText';

describe('card names', () => {
  it('names every rank and suit the way a person says them', () => {
    expect(cardName(parseCard('As'))).toBe('ace of spades');
    expect(cardName(parseCard('Th'))).toBe('10 of hearts');
    expect(cardName(parseCard('2c'))).toBe('2 of clubs');
    expect(cardsName(parseCards('KdQhJc'))).toBe('king of diamonds, queen of hearts, jack of clubs');
  });

  it('reads cards inside text and leaves other words alone', () => {
    expect(spokenCards('Flop Ks7d2c')).toBe('Flop king of spades, 7 of diamonds, 2 of clubs');
    expect(spokenCards('AhAd')).toBe('ace of hearts, ace of diamonds');
    expect(spokenCards('BTN open, 3-bet pot')).toBe('BTN open, 3-bet pot');
  });
});

describe('gridStep', () => {
  it('moves by cell and row and stops at the edges', () => {
    expect(gridStep(0, 'ArrowRight')).toBe(1);
    expect(gridStep(12, 'ArrowRight')).toBe(12);
    expect(gridStep(13, 'ArrowLeft')).toBe(13);
    expect(gridStep(0, 'ArrowDown')).toBe(13);
    expect(gridStep(5, 'ArrowUp')).toBe(5);
    expect(gridStep(168, 'ArrowDown')).toBe(168);
  });

  it('jumps to the row ends with Home and End, and the grid ends with Ctrl', () => {
    expect(gridStep(20, 'Home')).toBe(13);
    expect(gridStep(20, 'End')).toBe(25);
    expect(gridStep(20, 'Home', true)).toBe(0);
    expect(gridStep(20, 'End', true)).toBe(168);
    expect(gridStep(20, 'Enter')).toBeNull();
  });
});

describe('shortcutFor', () => {
  it('maps F, C, K, A and the digits, and ignores modified keys and other letters', () => {
    expect(shortcutFor('f')).toEqual({ kind: 'fold' });
    expect(shortcutFor('C')).toEqual({ kind: 'passive' });
    expect(shortcutFor('k')).toEqual({ kind: 'passive' });
    expect(shortcutFor('a')).toEqual({ kind: 'allin' });
    expect(shortcutFor('3')).toEqual({ kind: 'size', index: 2 });
    expect(shortcutFor('0')).toBeNull();
    expect(shortcutFor('r')).toBeNull();
    expect(shortcutFor('c', { ctrl: true })).toBeNull();
    expect(shortcutFor('f', { meta: true })).toBeNull();
  });
});

describe('tableNews', () => {
  const cfg: HandConfig = { tableSize: 6, sb: 25, bb: 50 };
  // Seats clockwise from SB: 0 SB, 1 BB, 2 UTG, 3 HJ, 4 CO, 5 BTN. The hero is the BTN.
  const hero = 5;
  const play = (s: HandState, ...acts: Action[]) => acts.reduce(applyAction, s);
  const start = () => newHand({ config: cfg, stacks: Array(6).fill(5000), board: parseCards('Ks7d2c9hAs'), seed: 3 });

  it('says the preflop action before the hero and that it is the hero\'s turn, without the blinds', () => {
    const s = play(start(), { type: 'raise', to: 125 }, { type: 'fold' }, { type: 'fold' });
    expect(tableNews(s, hero, { actions: 0, board: 0 })).toBe('UTG raises to $1.25. HJ folds. CO folds. Your turn.');
  });

  it('says only what is new, deals each street in order, and speaks to the hero as you', () => {
    let s = play(start(), { type: 'raise', to: 125 }, { type: 'fold' }, { type: 'fold' });
    const before = told(s);
    s = play(s, { type: 'call' }, { type: 'fold' }, { type: 'fold' });
    expect(tableNews(s, hero, before)).toBe('You call $1.25. SB folds. BB folds. Flop: king of spades, 7 of diamonds, 2 of clubs.');
    const flop = told(s);
    s = play(s, { type: 'check' }, { type: 'check' }, { type: 'bet', to: 300 });
    expect(tableNews(s, hero, flop)).toBe('UTG checks. You check. Turn: 9 of hearts. UTG bets $3. Your turn.');
  });

  it('leaves out the turn when told not to, and is empty when nothing happened', () => {
    const s = play(start(), { type: 'raise', to: 125 }, { type: 'fold' }, { type: 'fold' });
    expect(tableNews(s, hero, told(s), false)).toBe('');
    expect(tableNews(s, hero, told(s))).toBe('Your turn.');
  });
});

describe('spoken grades', () => {
  it('does not say the verdict twice, and ends sentences once', () => {
    expect(gradeSaid('Correct', 'Correct call')).toBe('Correct call');
    expect(gradeSaid('Mistake', 'This is a fold')).toBe('Mistake. This is a fold');
    expect(sentence('Level 1 stops at the flop.')).toBe('Level 1 stops at the flop.');
    expect(sentence('You win $3.00')).toBe('You win $3.00.');
  });
});
