// A box that scrolls a wide table sideways on a narrow screen. While its content is wider than
// the box, it is also a labelled Tab stop, so a keyboard user can scroll it with the arrow keys.

import { useEffect, useRef, useState, type ReactNode } from 'react';

export function ScrollBox({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scrolls, setScrolls] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setScrolls(el.scrollWidth > el.clientWidth + 1);
    check();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(check);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} className="table-scroll" {...(scrolls ? { tabIndex: 0, role: 'region', 'aria-label': `${label}, scrolls sideways` } : {})}>
      {children}
    </div>
  );
}
