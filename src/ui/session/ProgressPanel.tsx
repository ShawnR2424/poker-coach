// Progress across sessions: the rolling mistake rate, postflop EV given up per session, and how
// often each leak showed up in each session. Every chart has the same numbers in a table.

import { useEffect, useRef, useState } from 'react';
import { leakTrend, mistakeTrend, sessionsInOrder, summarize, TREND_MIN, TREND_WINDOW, type SessionSummary, type TrendPoint } from '../../engine/session/progress';
import type { SavedSessions } from '../../engine/session/session';

const pct = (x: number | null) => (x === null ? '–' : `${Math.round(x * 100)}%`);
const bb1 = (x: number | null) => (x === null ? '–' : `${x.toFixed(1)}bb`);
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/** A round step for an axis that should show about `n` gridlines up to `max`. */
function niceStep(max: number, n: number): number {
  const raw = max / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
}

export function ProgressPanel({ saved }: { saved: SavedSessions }) {
  const sessions = sessionsInOrder(saved);
  const summaries = sessions.map(summarize);
  const trend = mistakeTrend(sessions);
  const leaks = leakTrend(sessions);
  const decisions = summaries.reduce((a, s) => a + s.decisions, 0);
  if (decisions < TREND_MIN) return null;
  return (
    <section className="panel progress" aria-labelledby="progress-h">
      <h2 id="progress-h">Progress</h2>
      <p className="muted small measure">
        Every saved session in the order you played them, {sessions.length === 1 ? 'one session so far' : `${sessions.length} sessions`}.
        Session lines mark where each new session started.
      </p>
      <TrendChart points={trend} sessions={summaries} />
      <EvChart sessions={summaries} />
      {leaks.length > 0 && <LeakTable rows={leaks} sessions={summaries} />}
      <details>
        <summary>Show the numbers as a table</summary>
        <div className="table-scroll">
          <table className="data" id="progress-table">
            <thead>
              <tr><th scope="col">Session</th><th scope="col">Started</th><th scope="col" className="n">Hands</th><th scope="col" className="n">Decisions</th><th scope="col" className="n">Mistakes</th><th scope="col" className="n">EV given up / 100 hands</th></tr>
            </thead>
            <tbody>
              {summaries.map((s, i) => (
                <tr key={s.id}>
                  <th scope="row">{i + 1}</th>
                  <td>{day(s.startedAt)}</td>
                  <td className="n num">{s.hands}</td>
                  <td className="n num">{s.decisions}</td>
                  <td className="n num">{pct(s.mistakeRate)}</td>
                  <td className="n num">{bb1(s.evLostPer100)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

const H = 200, PAD = { l: 40, r: 12, t: 12, b: 26 };

/** The rendered width of a chart box, so the chart draws at its real size and text stays legible on a phone. */
function useWidth(): [(el: HTMLDivElement | null) => void, number] {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [w, setW] = useState(640);
  useEffect(() => {
    if (!el) return;
    const update = () => setW(Math.max(260, Math.round(el.clientWidth)));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, w];
}

/** Index of the item whose x is nearest the pointer, from a pointer event on the chart. */
function nearest(e: React.PointerEvent<SVGElement>, svg: SVGSVGElement | null, xs: number[], W: number): number | null {
  if (!svg || !xs.length) return null;
  const r = svg.getBoundingClientRect();
  const x = ((e.clientX - r.left) / r.width) * W;
  let best = 0;
  xs.forEach((v, i) => { if (Math.abs(v - x) < Math.abs(xs[best] - x)) best = i; });
  return best;
}

function TrendChart({ points, sessions }: { points: TrendPoint[]; sessions: SessionSummary[] }) {
  const svg = useRef<SVGSVGElement>(null);
  const [box, W] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  if (!points.length) return null;
  const lastHand = sessions.reduce((a, s) => a + s.hands, 0);
  const maxRate = Math.max(0.2, ...points.map((p) => p.rate));
  const step = niceStep(maxRate, 4);
  const top = Math.ceil(maxRate / step) * step;
  const x = (hand: number) => PAD.l + ((hand - 1) / Math.max(1, lastHand - 1)) * (W - PAD.l - PAD.r);
  const y = (rate: number) => PAD.t + (1 - rate / top) * (H - PAD.t - PAD.b);
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  // Hand number where each session after the first starts.
  const starts: number[] = [];
  sessions.reduce((a, s) => { starts.push(a + 1); return a + s.hands; }, 0);
  const xs = points.map((p) => x(p.hand));
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${xs[i].toFixed(1)},${y(p.rate).toFixed(1)}`).join('');
  const h = hover === null ? null : points[hover];
  const last = points[points.length - 1];
  return (
    <figure className="chart">
      <figcaption>
        <strong>Mistake rate</strong> <span className="muted">over your latest {TREND_WINDOW} graded decisions, after each hand</span>
      </figcaption>
      <div className="chart-box" ref={box}>
        <svg
          ref={svg}
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`Mistake rate over the latest ${TREND_WINDOW} decisions: ${pct(points[0].rate)} at hand ${points[0].hand}, ${pct(last.rate)} at hand ${last.hand}.`}
          onPointerMove={(e) => setHover(nearest(e, svg.current, xs, W))}
          onPointerLeave={() => setHover(null)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line className="grid" x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} />
              <text className="tick" x={PAD.l - 6} y={y(t)} dy="0.35em" textAnchor="end">{Math.round(t * 100)}%</text>
            </g>
          ))}
          {starts.slice(1).map((st, i) => (
            <g key={st}>
              <line className="session-line" x1={x(st)} x2={x(st)} y1={PAD.t} y2={H - PAD.b} />
              <text className="tick" x={x(st) + 3} y={PAD.t + 9}>S{i + 2}</text>
            </g>
          ))}
          <text className="tick" x={PAD.l} y={H - 8}>Hand 1</text>
          <text className="tick" x={W - PAD.r} y={H - 8} textAnchor="end">Hand {lastHand}</text>
          <path className="trend-line" d={path} />
          <circle className="trend-end" cx={xs[xs.length - 1]} cy={y(last.rate)} r={4} />
          {h && (
            <g>
              <line className="crosshair" x1={xs[hover!]} x2={xs[hover!]} y1={PAD.t} y2={H - PAD.b} />
              <circle className="trend-end" cx={xs[hover!]} cy={y(h.rate)} r={4} />
            </g>
          )}
        </svg>
        {h && (
          <div className="chart-tip" style={{ left: `${Math.min(80, Math.max(20, (xs[hover!] / W) * 100))}%` }} role="status">
            <strong className="num">{pct(h.rate)}</strong> mistakes
            <span className="muted"> · hand {h.hand}, session {h.session + 1}, over {h.over} decisions</span>
          </div>
        )}
      </div>
    </figure>
  );
}

function EvChart({ sessions }: { sessions: SessionSummary[] }) {
  const svg = useRef<SVGSVGElement>(null);
  const [box, W] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const measured = sessions.some((s) => s.evLostPer100 !== null);
  if (!measured) {
    return (
      <p className="muted small">
        EV given up after the flop is recorded for hands played from this version on; it will chart here once you play some.
      </p>
    );
  }
  const max = Math.max(1, ...sessions.map((s) => s.evLostPer100 ?? 0));
  const step = niceStep(max, 4);
  const top = Math.ceil(max / step) * step;
  const h = 160;
  const band = (W - PAD.l - PAD.r) / sessions.length;
  const bw = Math.min(48, band - 2);
  const cx = (i: number) => PAD.l + band * (i + 0.5);
  const y = (v: number) => PAD.t + (1 - v / top) * (h - PAD.t - PAD.b);
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const xs = sessions.map((_, i) => cx(i));
  const s = hover === null ? null : sessions[hover];
  // Value labels only when the bars are wide enough to keep them apart.
  const labelled = band >= 34;
  return (
    <figure className="chart">
      <figcaption>
        <strong>EV given up after the flop</strong> <span className="muted">big blinds per 100 hands, by session; lower is better</span>
      </figcaption>
      <div className="chart-box" ref={box}>
        <svg
          ref={svg}
          viewBox={`0 0 ${W} ${h}`}
          role="img"
          aria-label={`EV given up after the flop per 100 hands by session: ${sessions.map((x, i) => `session ${i + 1} ${bb1(x.evLostPer100)}`).join(', ')}.`}
          onPointerMove={(e) => setHover(nearest(e, svg.current, xs, W))}
          onPointerLeave={() => setHover(null)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line className="grid" x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} />
              <text className="tick" x={PAD.l - 6} y={y(t)} dy="0.35em" textAnchor="end">{t}</text>
            </g>
          ))}
          {sessions.map((x, i) => {
            const v = x.evLostPer100;
            const bar = v === null ? null : { top: y(v), height: Math.max(0, y(0) - y(v)) };
            return (
              <g key={x.id}>
                {bar && bar.height > 0 && (
                  <path className={`ev-bar${hover === i ? ' on' : ''}`} d={roundedTop(cx(i) - bw / 2, bar.top, bw, bar.height, Math.min(4, bar.height))} />
                )}
                {labelled && v !== null && <text className="bar-label num" x={cx(i)} y={(bar?.top ?? y(0)) - 4} textAnchor="middle">{v.toFixed(1)}</text>}
                <text className="tick" x={cx(i)} y={h - 8} textAnchor="middle">{v === null ? '–' : `S${i + 1}`}</text>
              </g>
            );
          })}
        </svg>
        {s && (
          <div className="chart-tip" style={{ left: `${Math.min(80, Math.max(20, (xs[hover!] / W) * 100))}%` }} role="status">
            <strong className="num">{bb1(s.evLostPer100)}</strong> per 100 hands
            <span className="muted"> · session {hover! + 1}, {s.hands} hands, {s.measured} postflop decisions measured</span>
          </div>
        )}
      </div>
    </figure>
  );
}

/** A bar with its top corners rounded and its base square on the axis. */
function roundedTop(x: number, y: number, w: number, h: number, r: number): string {
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

function LeakTable({ rows, sessions }: { rows: ReturnType<typeof leakTrend>; sessions: SessionSummary[] }) {
  const max = Math.max(1, ...rows.flatMap((r) => r.bySession.map((c) => c.per100 ?? 0)));
  // Four shades of one hue, light to dark, for how often the leak showed up.
  const shade = (v: number | null) => (v === null || v === 0 ? 0 : Math.min(4, 1 + Math.floor((v / max) * 3.999)));
  return (
    <figure className="chart">
      <figcaption>
        <strong>Leaks by session</strong> <span className="muted">times per 100 graded decisions; darker is more often</span>
      </figcaption>
      <div className="table-scroll">
        <table className="data leak-grid" id="leak-grid">
          <thead>
            <tr>
              <th scope="col">Leak</th>
              {sessions.map((s, i) => <th key={s.id} scope="col" className="n" title={day(s.startedAt)}>S{i + 1}</th>)}
              <th scope="col">Now</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.tag}>
                <th scope="row">{r.tag}</th>
                {r.bySession.map((c, i) => (
                  <td key={i} className={`n num heat-${shade(c.per100)}`} title={`Session ${i + 1}: ${c.count} time${c.count === 1 ? '' : 's'}`}>
                    {c.per100 === null ? '–' : c.count ? c.per100.toFixed(0) : '·'}
                  </td>
                ))}
                <td><span className={`status ${r.fixed ? 'fixed' : 'open'}`}>{r.fixed ? 'Fixed' : 'Open'}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
