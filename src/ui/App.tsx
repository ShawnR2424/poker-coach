import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { Lab } from './Lab';
import { GameScreen } from './play/GameScreen';
import { SettingsScreen } from './coach/SettingsScreen';
import { ImportScreen } from './session/ImportScreen';
import { SessionScreen } from './session/SessionScreen';
import { QuizScreen } from './quiz/QuizScreen';
import { ChartsScreen } from './charts/ChartsScreen';
import { ReviewScreen } from './review/ReviewScreen';
import { useDeck } from './review/store';
import { dueCards } from '../engine/review/review';
import { SpotsScreen } from './spots/SpotsScreen';
import { GROUPS, groupOf, openFor, parseLastUsed, tabFromHash, tabsIn, type Group, type LastUsed, type Tab } from './app/nav';
import { Welcome } from './app/Welcome';
import { UpdateBanner } from './app/UpdateBanner';
import './app/nav.css';

// Tournament mode carries its own equity table, so it loads only when opened.
const TournamentScreen = lazy(() => import('./tournament/TournamentScreen').then((m) => ({ default: m.TournamentScreen })));
const EquityScreen = lazy(() => import('./equity/EquityScreen').then((m) => ({ default: m.EquityScreen })));

type Theme = 'system' | 'light' | 'dark';
const NAV_KEY = 'nav:v1';

function loadTheme(): Theme {
  try {
    const t = localStorage.getItem('theme');
    return t === 'light' || t === 'dark' ? t : 'system';
  } catch {
    return 'system';
  }
}

function loadLastUsed(): LastUsed {
  try { return parseLastUsed(localStorage.getItem(NAV_KEY)); } catch { return {}; }
}

const loading = (what: string) => <div className="screen"><p className="muted">Loading {what}…</p></div>;

function screenFor(tab: Tab): ReactNode {
  switch (tab) {
    case 'table': return <GameScreen />;
    case 'tournament': return <Suspense fallback={loading('tournament mode')}><TournamentScreen /></Suspense>;
    case 'spots': return <SpotsScreen />;
    case 'quiz': return <QuizScreen />;
    case 'review': return <ReviewScreen />;
    case 'equity': return <Suspense fallback={loading('the equity calculator')}><EquityScreen /></Suspense>;
    case 'charts': return <ChartsScreen />;
    case 'import': return <ImportScreen />;
    case 'lab': return <Lab />;
    case 'session': return <SessionScreen />;
    case 'settings': return <SettingsScreen />;
  }
}

/** Simple line icons for the four sections, drawn in the text colour. */
function GroupIcon({ g }: { g: Group }) {
  const path = {
    play: 'M5 4h9a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM18 7l2.5.7a2 2 0 0 1 1.4 2.4l-2.6 9.7M9.5 9.5l-2 3 2 3 2-3z',
    train: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 4a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm0 4a1 1 0 1 0 0 2 1 1 0 0 0 0-2z',
    tools: 'M4 20l7-7M14.5 3.5a4 4 0 0 0-4.7 5.3L4 14.6V20h5.4l5.8-5.8a4 4 0 0 0 5.3-4.7l-2.6 2.6-2.8-.7-.7-2.8z',
    progress: 'M4 20V4M4 20h16M8 16l4-5 3 3 5-7',
  }[g];
  return (
    <svg className="nav-icon" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={path} />
    </svg>
  );
}

export function App() {
  const [tab, setTab] = useState<Tab>(() => tabFromHash(location.hash));
  const [theme, setTheme] = useState<Theme>(loadTheme);
  const [lastUsed, setLastUsed] = useState<LastUsed>(loadLastUsed);
  const dueNow = dueCards(useDeck()).length;
  const group = groupOf(tab);

  useEffect(() => {
    const onHash = () => setTab(tabFromHash(location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // Remember the screen last used in each section, so the section button reopens it.
  useEffect(() => {
    if (!group || lastUsed[group] === tab) return;
    const next = { ...lastUsed, [group]: tab };
    setLastUsed(next);
    try { localStorage.setItem(NAV_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
  }, [tab, group, lastUsed]);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
    try { localStorage.setItem('theme', theme); } catch { /* storage unavailable */ }
  }, [theme]);

  useEffect(() => { window.scrollTo(0, 0); }, [tab]);

  const go = (t: Tab) => {
    setTab(t);
    try { history.replaceState(null, '', `#${t}`); } catch { /* sandboxed */ }
  };
  const badge = (n: number, label: string) => n > 0 && <span className="tab-count num" aria-label={`, ${n} ${label}`}>{n}</span>;

  const groupButtons = GROUPS.map((g) => (
    <button
      key={g.id}
      type="button"
      className={group === g.id ? 'on' : ''}
      aria-current={group === g.id ? 'page' : undefined}
      onClick={() => go(group === g.id ? tabsIn(g.id)[0].id : openFor(g.id, lastUsed))}
    >
      <GroupIcon g={g.id} />
      <span className="nav-label">{g.label}</span>
      {g.id === 'train' && badge(dueNow, 'review cards due')}
    </button>
  ));

  return (
    <>
      <header className="topbar">
        <p className="brand">Poker Coach <span className="approx">approximate GTO</span></p>
        <nav className="nav-groups" aria-label="Sections">{groupButtons}</nav>
        <div className="topbar-end">
          <label className="theme-pick">
            <span className="sr-only">Theme</span>
            <select id="theme" value={theme} onChange={(e) => setTheme(e.target.value as Theme)}>
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
          <button type="button" className={`settings-btn${tab === 'settings' ? ' on' : ''}`} aria-label="Settings" aria-current={tab === 'settings' ? 'page' : undefined} onClick={() => go('settings')}>
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
            </svg>
          </button>
        </div>
      </header>
      {group && tabsIn(group).length > 1 && (
        <nav className="subtabs" aria-label={`${GROUPS.find((g) => g.id === group)!.label} screens`}>
          {tabsIn(group).map((t) => (
            <button key={t.id} type="button" data-tab={t.id} className={tab === t.id ? 'on' : ''} aria-current={tab === t.id ? 'page' : undefined} onClick={() => go(t.id)}>
              {t.label}{t.id === 'review' && badge(dueNow, 'due')}
            </button>
          ))}
        </nav>
      )}
      <UpdateBanner />
      <Welcome onPlay={() => go('table')} />
      <main>{screenFor(tab)}</main>
      <nav className="bottombar" aria-label="Sections">{groupButtons}</nav>
    </>
  );
}
