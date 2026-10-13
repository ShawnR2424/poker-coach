import { useEffect, useRef, useState } from 'react';
import { legalActions, type Action, type HandState } from '../../engine/hand';
import { isTyping, shortcutFor, useClaimFocus } from '../a11y';
import { presetSizes } from '../../engine/sizing';
import { dollars } from './format';

interface Props {
  state: HandState;
  onAct: (action: Action, label: string) => void;
  disabled?: boolean;
}

export function ActionBar({ state, onAct, disabled = false }: Props) {
  const legal = legalActions(state);
  const presets = presetSizes(state);
  const sizeRange = legal.bet ?? legal.raise;
  const verb = legal.bet ? 'Bet' : 'Raise';
  const [custom, setCustom] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submitCustom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!sizeRange) return;
    const cents = Math.round(Number(custom) * 100);
    if (!Number.isFinite(cents) || cents < sizeRange.min || cents > sizeRange.max) {
      setError(`${verb} to between ${dollars(sizeRange.min)} and ${dollars(sizeRange.max)}.`);
      return;
    }
    setError(null);
    onAct({ type: legal.bet ? 'bet' : 'raise', to: cents }, `${verb} to ${dollars(cents)}`);
  };

  const first = useRef<HTMLButtonElement>(null);
  useClaimFocus(first, !disabled);
  const sizes = presets.filter((p) => !p.allIn);
  const allIn = presets.find((p) => p.allIn);
  const sizeLabel = (p: (typeof presets)[number]) => {
    const to = 'to' in p.action ? p.action.to : 0;
    return p.allIn ? `All-in ${dollars(to)}` : `${verb} ${p.label}`;
  };

  // F folds, C (or K) checks or calls, 1-9 pick a size, A goes all-in.
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e) => {
    if (disabled || e.defaultPrevented || isTyping(e.target)) return;
    const t = shortcutFor(e.key, { ctrl: e.ctrlKey, alt: e.altKey, meta: e.metaKey });
    if (!t) return;
    const pick = (action: Action, label: string) => {
      e.preventDefault();
      onAct(action, label);
    };
    if (t.kind === 'fold' && legal.fold) pick({ type: 'fold' }, 'Fold');
    else if (t.kind === 'passive' && legal.check) pick({ type: 'check' }, 'Check');
    else if (t.kind === 'passive' && legal.call !== null) pick({ type: 'call' }, `Call ${dollars(legal.call!)}`);
    else if (t.kind === 'size' && sizes[t.index]) pick(sizes[t.index].action, sizeLabel(sizes[t.index]));
    else if (t.kind === 'allin' && allIn) pick(allIn.action, sizeLabel(allIn));
  };
  useEffect(() => {
    const f = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, []);
  const sizeKey = (p: (typeof presets)[number]) => (p.allIn ? 'A' : sizes.indexOf(p) < 9 ? String(sizes.indexOf(p) + 1) : undefined);

  return (
    <section className="action-bar" aria-label="Your action" aria-busy={disabled}>
      {disabled && <p className="muted small">Reading the ranges…</p>}
      <div className="action-buttons">
        {legal.fold && <button ref={first} type="button" disabled={disabled} className="act fold" aria-keyshortcuts="F" onClick={() => onAct({ type: 'fold' }, 'Fold')}>Fold</button>}
        {legal.check && <button ref={legal.fold ? undefined : first} type="button" disabled={disabled} className="act" aria-keyshortcuts="C" onClick={() => onAct({ type: 'check' }, 'Check')}>Check</button>}
        {legal.call !== null && (
          <button ref={legal.fold || legal.check ? undefined : first} type="button" disabled={disabled} className="act" aria-keyshortcuts="C" onClick={() => onAct({ type: 'call' }, `Call ${dollars(legal.call!)}`)}>
            Call <span className="num">{dollars(legal.call)}</span>
          </button>
        )}
        {presets.map((p) => {
          const to = 'to' in p.action ? p.action.to : 0;
          return (
            <button key={p.label} type="button" disabled={disabled} className={`act size${p.allIn ? ' allin' : ''}`} aria-keyshortcuts={sizeKey(p)} onClick={() => onAct(p.action, sizeLabel(p))}>
              {p.allIn ? 'All-in' : `${verb} ${p.label}`} <span className="num">{dollars(to)}</span>
            </button>
          );
        })}
      </div>
      <p className="keys-hint small muted" aria-hidden="true">
        Keys: <kbd>F</kbd> fold · <kbd>C</kbd> {legal.check ? 'check' : 'call'}
        {sizes.length > 0 && <> · <kbd>1</kbd>{sizes.length > 1 && <>–<kbd>{Math.min(sizes.length, 9)}</kbd></>} {verb.toLowerCase()} sizes</>}
        {allIn && <> · <kbd>A</kbd> all-in</>}
      </p>
      {sizeRange && (
        <form className="custom-size" onSubmit={submitCustom}>
          <label htmlFor="custom-size">Custom {verb.toLowerCase()} to ($)</label>
          <div className="custom-row">
            <input
              id="custom-size"
              type="number"
              inputMode="decimal"
              step="0.25"
              min={sizeRange.min / 100}
              max={sizeRange.max / 100}
              placeholder={`${(sizeRange.min / 100).toFixed(2)} to ${(sizeRange.max / 100).toFixed(2)}`}
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
            />
            <button type="submit" disabled={disabled} className="act">{verb}</button>
          </div>
          {error && <p className="errors">{error}</p>}
        </form>
      )}
    </section>
  );
}
