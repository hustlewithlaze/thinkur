import type { Ticket } from './types';

export interface Metrics {
  total: number;
  unresolved: number;
  open: number;
  pending: number;
  resolved: number;
  otherStatus: number;
  avgResolutionHours: number | null; // mean of valid recorded times on resolved tickets
  medianResolutionHours: number | null;
  resolutionSample: number;
  lowCsat: number; // resolved tickets with csat <= threshold
  csatSample: number; // resolved tickets with a recorded csat
  missingCsatResolved: number;
  missingResolutionResolved: number;
  firstDate: Date | null;
  lastDate: Date | null;
  undated: number;
  distinctCustomers: number | null;
}

export function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function computeMetrics(tickets: Ticket[], lowCsatThreshold: number): Metrics {
  const resolved = tickets.filter((t) => t.statusCategory === 'resolved');
  const times = resolved.map((t) => t.resolutionTimeHours).filter((x): x is number => x !== null);
  const csats = resolved.map((t) => t.csatScore).filter((x): x is number => x !== null);
  const dates = tickets.map((t) => t.createdAt).filter((d): d is Date => d !== null).map((d) => d.getTime());
  const names = tickets.map((t) => t.customerName);
  return {
    total: tickets.length,
    unresolved: tickets.filter((t) => t.statusCategory === 'unresolved').length,
    open: tickets.filter((t) => t.status === 'open').length,
    pending: tickets.filter((t) => t.status === 'pending').length,
    resolved: resolved.length,
    otherStatus: tickets.filter((t) => t.statusCategory === 'other').length,
    avgResolutionHours: mean(times),
    medianResolutionHours: median(times),
    resolutionSample: times.length,
    lowCsat: csats.filter((c) => c <= lowCsatThreshold).length,
    csatSample: csats.length,
    missingCsatResolved: resolved.length - csats.length,
    missingResolutionResolved: resolved.length - times.length,
    firstDate: dates.length ? new Date(Math.min(...dates)) : null,
    lastDate: dates.length ? new Date(Math.max(...dates)) : null,
    undated: tickets.length - dates.length,
    distinctCustomers: names.every((n) => n) ? new Set(names).size : null,
  };
}

/** Monday-start week buckets; tickets without a date are excluded (count reported separately). */
export function weeklyVolume(tickets: Ticket[], inGroup: (id: string) => boolean) {
  const buckets = new Map<number, { week: Date; grouped: number; other: number }>();
  for (const t of tickets) {
    if (!t.createdAt) continue;
    const d = new Date(t.createdAt);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    const k = d.getTime();
    const b = buckets.get(k) ?? { week: d, grouped: 0, other: 0 };
    if (inGroup(t.id)) b.grouped++;
    else b.other++;
    buckets.set(k, b);
  }
  return [...buckets.values()].sort((a, b) => a.week.getTime() - b.week.getTime());
}

export function countBy<T>(xs: T[], key: (x: T) => string | null): { key: string; count: number }[] {
  const m = new Map<string, number>();
  for (const x of xs) {
    const k = key(x) ?? 'Not recorded';
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count);
}
