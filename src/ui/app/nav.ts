// Navigation: every screen keeps its own address (#table, #review, ...), and the screens are
// grouped into four sections so a phone needs only four buttons. Each section reopens the screen
// last used in it.

export type Tab = 'table' | 'tournament' | 'spots' | 'quiz' | 'review' | 'equity' | 'charts' | 'import' | 'lab' | 'session' | 'settings';
export type Group = 'play' | 'train' | 'tools' | 'progress';

export const TABS: { id: Tab; label: string; group: Group | null }[] = [
  { id: 'table', label: 'Cash table', group: 'play' },
  { id: 'tournament', label: 'Tournament', group: 'play' },
  { id: 'spots', label: 'Postflop spots', group: 'train' },
  { id: 'quiz', label: 'Quizzes', group: 'train' },
  { id: 'review', label: 'Review', group: 'train' },
  { id: 'equity', label: 'Equity', group: 'tools' },
  { id: 'charts', label: 'Charts', group: 'tools' },
  { id: 'import', label: 'Import', group: 'tools' },
  { id: 'lab', label: 'Engine lab', group: 'tools' },
  { id: 'session', label: 'Session', group: 'progress' },
  // Settings sits behind its own button, outside the sections.
  { id: 'settings', label: 'Settings', group: null },
];

export const GROUPS: { id: Group; label: string }[] = [
  { id: 'play', label: 'Play' },
  { id: 'train', label: 'Train' },
  { id: 'tools', label: 'Tools' },
  { id: 'progress', label: 'Progress' },
];

export const groupOf = (t: Tab): Group | null => TABS.find((x) => x.id === t)!.group;
export const tabsIn = (g: Group) => TABS.filter((x) => x.group === g);

export function tabFromHash(hash: string): Tab {
  const id = hash.replace(/^#/, '');
  return TABS.some((t) => t.id === id) ? (id as Tab) : 'table';
}

/** The screen each section opens: the last one used in it, or its first. */
export type LastUsed = Partial<Record<Group, Tab>>;

export function parseLastUsed(raw: string | null): LastUsed {
  try {
    const v = JSON.parse(raw ?? 'null') as Record<string, unknown> | null;
    const out: LastUsed = {};
    for (const g of GROUPS) {
      const t = v?.[g.id];
      if (typeof t === 'string' && tabsIn(g.id).some((x) => x.id === t)) out[g.id] = t as Tab;
    }
    return out;
  } catch {
    return {};
  }
}

export const openFor = (g: Group, last: LastUsed): Tab => last[g] ?? tabsIn(g)[0].id;
