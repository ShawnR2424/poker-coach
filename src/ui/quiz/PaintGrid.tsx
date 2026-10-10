// The 13x13 grid for painting a range: tap a hand to paint it in or out, or drag to paint a stretch.
// With `reveal`, it shows the true range instead, marking where the painting differed.

import { useRef } from 'react';
import type { RangeScore } from '../../engine/quiz/quiz';
import { ALL_CLASSES, CLASS_COMBOS, type HandClass } from '../../engine/range';

interface Props {
  painted: ReadonlySet<HandClass>;
  onChange?: (next: Set<HandClass>) => void;
  /** Show the scored result instead of a paintable grid. */
  reveal?: RangeScore;
  hero?: HandClass;
}

const MARK_TEXT = { hit: 'painted, in range', partial: 'painted, in range part of the time', missed: 'in range, not painted', extra: 'painted, not in range', out: 'not in range' } as const;

export function PaintGrid({ painted, onChange, reveal, hero }: Props) {
  // While dragging: whether this stroke paints hands in or out, and the hands it already touched.
  const stroke = useRef<{ on: boolean; seen: Set<HandClass> } | null>(null);

  const apply = (cls: HandClass) => {
    const s = stroke.current;
    if (!s || s.seen.has(cls) || !onChange) return;
    s.seen.add(cls);
    const next = new Set(painted);
    for (const c of s.seen) if (s.on) next.add(c); else next.delete(c);
    onChange(next);
  };

  const clsAt = (x: number, y: number): HandClass | null => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-cls]');
    return el?.dataset.cls ?? null;
  };

  if (reveal) {
    return (
      <div className="range-grid paint-grid revealed" role="grid" aria-label="Their range compared with your painting">
        {ALL_CLASSES.map((cls) => {
          const c = reveal.cells.get(cls)!;
          return (
            <span
              key={cls}
              role="gridcell"
              className={`cell mark-${c.mark}${c.share >= 0.5 ? ' strong' : ''}${cls === hero ? ' hero' : ''}`}
              style={{ ['--fill' as string]: c.share.toFixed(3) }}
              title={`${cls}: played ${Math.round(c.share * 100)}% of the time; ${MARK_TEXT[c.mark]}`}
              aria-label={`${cls}, played ${Math.round(c.share * 100)}% of the time, ${MARK_TEXT[c.mark]}`}
            >
              {cls}
            </span>
          );
        })}
      </div>
    );
  }

  return (
    <div
      className="range-grid paint-grid"
      role="grid"
      aria-label="Paint the range"
      onPointerDown={(e) => {
        const cls = clsAt(e.clientX, e.clientY);
        if (!cls) return;
        e.preventDefault();
        stroke.current = { on: !painted.has(cls), seen: new Set() };
        apply(cls);
      }}
      onPointerMove={(e) => {
        if (!stroke.current) return;
        const cls = clsAt(e.clientX, e.clientY);
        if (cls) apply(cls);
      }}
      onPointerUp={() => { stroke.current = null; }}
      onPointerCancel={() => { stroke.current = null; }}
      onPointerLeave={() => { stroke.current = null; }}
    >
      {ALL_CLASSES.map((cls) => {
        const on = painted.has(cls);
        return (
          <button
            key={cls}
            type="button"
            role="gridcell"
            data-cls={cls}
            className={`cell${on ? ' painted' : ''}${cls === hero ? ' hero' : ''}`}
            aria-pressed={on}
            aria-label={`${cls}, ${CLASS_COMBOS.get(cls)!.length} combos, ${on ? 'painted' : 'not painted'}`}
            // Pointer strokes paint on pointer down; keyboard presses (detail 0) toggle here.
            onClick={(e) => {
              if (e.detail !== 0 || !onChange) return;
              const next = new Set(painted);
              if (on) next.delete(cls); else next.add(cls);
              onChange(next);
            }}
          >
            {cls}
          </button>
        );
      })}
    </div>
  );
}
