import { useState } from 'react';
import { fmtDate } from './ui';

interface Bucket {
  week: Date;
  grouped: number;
  other: number;
}

/** Stacked weekly volume: tickets in candidate groups (accent) vs. all other tickets (neutral). */
export function WeeklyChart({ data }: { data: Bucket[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  if (!data.length) return <p className="text-sm text-muted">No tickets with valid dates.</p>;

  const W = 400;
  const H = 170;
  const pad = { l: 28, r: 8, t: 10, b: 24 };
  const max = Math.max(...data.map((d) => d.grouped + d.other));
  const nice = Math.max(4, Math.ceil(max / 10) * 10);
  const bw = (W - pad.l - pad.r) / data.length;
  const barW = Math.min(36, bw * 0.62);
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / nice);
  const ticks = [0, nice / 2, nice];
  const GAP = 2;

  // Rounded top on the topmost segment only (4px), flat at the baseline
  const topRounded = (x: number, y0: number, w: number, h: number) => {
    const r = Math.min(4, h, w / 2);
    return `M${x},${y0 + h} V${y0 + r} Q${x},${y0} ${x + r},${y0} H${x + w - r} Q${x + w},${y0} ${x + w},${y0 + r} V${y0 + h} Z`;
  };

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-chart-a" aria-hidden /> In a candidate group
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-chart-b" aria-hidden /> Other tickets
        </span>
        <button type="button" className="ml-auto text-accent hover:underline" onClick={() => setShowTable((s) => !s)}>
          {showTable ? 'Show chart' : 'Show table'}
        </button>
      </div>
      {showTable ? (
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted">
            <tr>
              <th className="py-1 font-medium">Week of</th>
              <th className="py-1 text-right font-medium">In group</th>
              <th className="py-1 text-right font-medium">Other</th>
              <th className="py-1 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody className="tabular">
            {data.map((d) => (
              <tr key={d.week.getTime()} className="border-t border-line/60">
                <td className="py-1">{fmtDate(d.week)}</td>
                <td className="py-1 text-right">{d.grouped}</td>
                <td className="py-1 text-right">{d.other}</td>
                <td className="py-1 text-right">{d.grouped + d.other}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="relative mx-auto max-w-[480px]">
          <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Weekly ticket volume, split by candidate-group membership">
            {ticks.map((t) => (
              <g key={t}>
                <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="#393F46" strokeWidth={t === 0 ? 1 : 0.6} strokeDasharray={t === 0 ? undefined : '2 3'} />
                <text x={pad.l - 6} y={y(t) + 3.5} textAnchor="end" fontSize="11" fill="#7D858E" className="tabular">
                  {t}
                </text>
              </g>
            ))}
            {data.map((d, i) => {
              const x = pad.l + i * bw + (bw - barW) / 2;
              const base = y(0);
              const hOther = base - y(d.other);
              const hGroup = base - y(d.grouped);
              const otherTop = base - hOther;
              const groupTop = otherTop - hGroup - (hOther > 0 && hGroup > 0 ? GAP : 0);
              const dim = hover !== null && hover !== i;
              return (
                <g key={d.week.getTime()} opacity={dim ? 0.45 : 1}>
                  {hOther > 0 && (d.grouped === 0 ? <path d={topRounded(x, otherTop, barW, hOther)} fill="#6B7480" /> : <rect x={x} y={otherTop} width={barW} height={hOther} fill="#6B7480" />)}
                  {hGroup > 0 && <path d={topRounded(x, groupTop, barW, hGroup)} fill="#5E8FEA" />}
                  <text x={x + barW / 2} y={H - 8} textAnchor="middle" fontSize="11" fill="#7D858E">
                    {d.week.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}
                  </text>
                  <rect
                    x={pad.l + i * bw}
                    y={pad.t}
                    width={bw}
                    height={H - pad.t - pad.b}
                    fill="transparent"
                    onMouseEnter={() => setHover(i)}
                    onMouseLeave={() => setHover(null)}
                    onFocus={() => setHover(i)}
                    onBlur={() => setHover(null)}
                    tabIndex={0}
                    aria-label={`Week of ${fmtDate(d.week)}: ${d.grouped} in candidate groups, ${d.other} other`}
                  />
                </g>
              );
            })}
          </svg>
          {hover !== null && (
            <div
              className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-md border border-line bg-elevated px-2.5 py-1.5 text-xs shadow-lg"
              style={{ left: `${((pad.l + hover * bw + bw / 2) / W) * 100}%` }}
            >
              <div className="font-medium text-ink">Week of {fmtDate(data[hover].week)}</div>
              <div className="tabular text-muted">
                {data[hover].grouped} in groups · {data[hover].other} other · {data[hover].grouped + data[hover].other} total
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
