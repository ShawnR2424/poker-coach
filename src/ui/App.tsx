import { useEffect, useState } from 'react';
import { Lab } from './Lab';
import { GameScreen } from './play/GameScreen';
import { SettingsScreen } from './coach/SettingsScreen';
import { ImportScreen } from './session/ImportScreen';
import { SessionScreen } from './session/SessionScreen';
import { SpotsScreen } from './spots/SpotsScreen';

type Tab = 'table' | 'spots' | 'session' | 'import' | 'settings' | 'lab';
type Theme = 'system' | 'light' | 'dark';

const readHash = (): Tab => (location.hash === '#lab' ? 'lab' : location.hash === '#spots' ? 'spots' : location.hash === '#session' ? 'session' : location.hash === '#import' ? 'import' : location.hash === '#settings' ? 'settings' : 'table');

function loadTheme(): Theme {
  try {
    const t = localStorage.getItem('theme');
    return t === 'light' || t === 'dark' ? t : 'system';
  } catch {
    return 'system';
  }
}

export function App() {
  const [tab, setTab] = useState<Tab>(readHash);
  const [theme, setTheme] = useState<Theme>(loadTheme);

  useEffect(() => {
    const onHash = () => setTab(readHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
    try { localStorage.setItem('theme', theme); } catch { /* storage unavailable */ }
  }, [theme]);

  const go = (t: Tab) => {
    setTab(t);
    try { history.replaceState(null, '', `#${t}`); } catch { /* sandboxed */ }
  };

  return (
    <>
      <header className="topbar">
        <p className="brand">Poker Coach <span className="approx">approximate GTO</span></p>
        <nav className="tabs" aria-label="Sections">
          <button type="button" className={tab === 'table' ? 'on' : ''} aria-pressed={tab === 'table'} onClick={() => go('table')}>Play</button>
          <button type="button" className={tab === 'spots' ? 'on' : ''} aria-pressed={tab === 'spots'} onClick={() => go('spots')}>Postflop spots</button>
          <button type="button" className={tab === 'session' ? 'on' : ''} aria-pressed={tab === 'session'} onClick={() => go('session')}>Session</button>
          <button type="button" className={tab === 'import' ? 'on' : ''} aria-pressed={tab === 'import'} onClick={() => go('import')}>Import</button>
          <button type="button" className={tab === 'settings' ? 'on' : ''} aria-pressed={tab === 'settings'} onClick={() => go('settings')}>Settings</button>
          <button type="button" className={tab === 'lab' ? 'on' : ''} aria-pressed={tab === 'lab'} onClick={() => go('lab')}>Engine lab</button>
        </nav>
        <label className="theme-pick">
          <span className="sr-only">Theme</span>
          <select id="theme" value={theme} onChange={(e) => setTheme(e.target.value as Theme)}>
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
      </header>
      {tab === 'table' ? <GameScreen /> : tab === 'spots' ? <SpotsScreen /> : tab === 'session' ? <SessionScreen /> : tab === 'import' ? <ImportScreen /> : tab === 'settings' ? <SettingsScreen /> : <Lab />}
    </>
  );
}
