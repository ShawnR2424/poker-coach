import type { ReactNode } from 'react';
import type { Choice } from '../../engine/preflop/charts';
import { choiceName, strategyGrid, type Decision, type Feedback } from '../../engine/preflop/coach';
import { StrategyGrid } from './StrategyGrid';

const BADGE: Record<string, { icon: string; label: string }> = {
  correct: { icon: '✅', label: 'Correct' },
  playable: { icon: '👍', label: 'Playable, not best' },
  mistake: { icon: '⚠️', label: 'Mistake' },
};
const pct = (x: number) => `${Math.round(x * 100)}%`;

export function FeedbackPanel({ fb, decision, onContinue, voice }: { fb: Feedback; decision: Decision; onContinue: () => void; voice?: ReactNode }) {
  const g = fb.grade;
  const name = (c: Choice) => choiceName(decision.spot.kind, c, decision.canCheck);
  return (
    <section className={`feedback verdict-${g.verdict}`} aria-labelledby="fb-h">
      <p className="verdict-badge"><span aria-hidden="true">{BADGE[g.verdict].icon}</span> {BADGE[g.verdict].label}</p>
      <h2 id="fb-h">{g.heading}</h2>
      <ul className="why">{fb.bullets.map((b) => <li key={b}>{b}</li>)}</ul>
      {fb.alternative && <p className="alt">{fb.alternative}</p>}
      {fb.sunkCost && <p className="sunk">{fb.sunkCost}</p>}
      {voice}
      <div className="eq-check">
        <p className="eyebrow">Equity check</p>
        <p className="num">
          {pct(fb.equity.hero)} your equity{fb.equity.needed !== null && <> · {(fb.equity.needed * 100).toFixed(1)}% needed to call</>}
        </p>
      </div>
      <div>
        <p className="eyebrow">Which hands take each action here</p>
        <StrategyGrid
          freqs={strategyGrid(decision.strategy)}
          heroClass={decision.hand}
          names={{ raise: name('raise'), call: name('call'), fold: name('fold') }}
        />
      </div>
      <div className="concept">
        <p className="eyebrow">Key concept</p>
        <p>{fb.concept}</p>
      </div>
      <button type="button" className="primary" onClick={onContinue}>Continue</button>
    </section>
  );
}
