import { useState } from 'react';
import { legalActions, type Action, type HandState } from '../../engine/hand';
import { presetSizes } from '../../engine/sizing';
import { dollars } from './format';

interface Props {
  state: HandState;
  onAct: (action: Action, label: string) => void;
}

export function ActionBar({ state, onAct }: Props) {
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

  return (
    <section className="action-bar" aria-label="Your action">
      <div className="action-buttons">
        {legal.fold && <button type="button" className="act fold" onClick={() => onAct({ type: 'fold' }, 'Fold')}>Fold</button>}
        {legal.check && <button type="button" className="act" onClick={() => onAct({ type: 'check' }, 'Check')}>Check</button>}
        {legal.call !== null && (
          <button type="button" className="act" onClick={() => onAct({ type: 'call' }, `Call ${dollars(legal.call!)}`)}>
            Call <span className="num">{dollars(legal.call)}</span>
          </button>
        )}
        {presets.map((p) => {
          const to = 'to' in p.action ? p.action.to : 0;
          const label = p.allIn ? `All-in ${dollars(to)}` : `${verb} ${p.label}`;
          return (
            <button key={p.label} type="button" className={`act size${p.allIn ? ' allin' : ''}`} onClick={() => onAct(p.action, label)}>
              {p.allIn ? 'All-in' : `${verb} ${p.label}`} <span className="num">{dollars(to)}</span>
            </button>
          );
        })}
      </div>
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
            <button type="submit" className="act">{verb}</button>
          </div>
          {error && <p className="errors">{error}</p>}
        </form>
      )}
    </section>
  );
}
