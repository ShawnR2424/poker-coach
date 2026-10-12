import { describe, expect, it } from 'vitest';
import { GROUPS, TABS, groupOf, openFor, parseLastUsed, tabFromHash, tabsIn } from './nav';

describe('navigation', () => {
  it('puts every screen but settings in exactly one section', () => {
    for (const t of TABS) expect(groupOf(t.id) === null).toBe(t.id === 'settings');
    expect(GROUPS.flatMap((g) => tabsIn(g.id)).length).toBe(TABS.length - 1);
  });

  it('reads the screen from the address and falls back to the cash table', () => {
    expect(tabFromHash('#review')).toBe('review');
    expect(tabFromHash('#settings')).toBe('settings');
    expect(tabFromHash('')).toBe('table');
    expect(tabFromHash('#nowhere')).toBe('table');
  });

  it('keeps only saved screens that belong to their section', () => {
    expect(parseLastUsed(JSON.stringify({ train: 'quiz', tools: 'review', play: 7, other: 'lab' }))).toEqual({ train: 'quiz' });
    expect(parseLastUsed('not json')).toEqual({});
    expect(parseLastUsed(null)).toEqual({});
    expect(parseLastUsed('[1]')).toEqual({});
  });

  it('opens a section at its last used screen, or its first', () => {
    expect(openFor('train', { train: 'review' })).toBe('review');
    expect(openFor('tools', {})).toBe('equity');
    expect(openFor('play', {})).toBe('table');
  });
});
