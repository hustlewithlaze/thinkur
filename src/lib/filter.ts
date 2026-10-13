import type { CandidateGroup, Ticket, TicketPriority } from './types';

export interface QueueFilters {
  q: string;
  status: string; // '' | 'unresolved' | specific status
  product: string;
  segment: string;
  country: string;
  priority: string; // '' | label
  group: string; // '' | 'any' | 'none' | groupId
  csat: string; // '' | 'low' | 'missing' | '3plus'
  resolution: string; // '' | 'lt8' | '8to24' | 'gt24' | 'missing'
  urgentOnly: boolean; // deadline/interruption or security signal
}

export const EMPTY_FILTERS: QueueFilters = {
  q: '',
  status: '',
  product: '',
  segment: '',
  country: '',
  priority: '',
  group: '',
  csat: '',
  resolution: '',
  urgentOnly: false,
};

export type SortKey = 'priority' | 'created' | 'id' | 'status' | 'resolution' | 'csat' | 'product';
export interface Sort {
  key: SortKey;
  dir: 'asc' | 'desc';
}

interface Ctx {
  priorities: Map<string, TicketPriority>;
  groupByTicket: Map<string, CandidateGroup>;
  lowCsatThreshold: number;
}

export function activeFilterCount(f: QueueFilters): number {
  return Object.entries(f).filter(([k, v]) => (k === 'urgentOnly' ? v : v !== '')).length;
}

export function filterTickets(tickets: Ticket[], f: QueueFilters, ctx: Ctx): Ticket[] {
  const q = f.q.trim().toLowerCase();
  return tickets.filter((t) => {
    if (q) {
      const hay = [t.id, t.subject, t.body, t.customerName, t.product, t.customerSegment, t.country, t.status].join(' ').toLowerCase();
      if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
    }
    if (f.status === 'unresolved' ? t.statusCategory !== 'unresolved' : f.status && t.status !== f.status) return false;
    if (f.product && t.product !== f.product) return false;
    if (f.segment && t.customerSegment !== f.segment) return false;
    if (f.country && t.country !== f.country) return false;
    const p = ctx.priorities.get(t.id);
    if (f.priority && p?.label !== f.priority) return false;
    const g = ctx.groupByTicket.get(t.id);
    if (f.group === 'any' && !g) return false;
    if (f.group === 'none' && g) return false;
    if (f.group && f.group !== 'any' && f.group !== 'none' && g?.id !== f.group) return false;
    if (f.csat === 'low' && !(t.statusCategory === 'resolved' && t.csatScore !== null && t.csatScore <= ctx.lowCsatThreshold)) return false;
    if (f.csat === 'missing' && t.csatScore !== null) return false;
    if (f.csat === '3plus' && !(t.csatScore !== null && t.csatScore >= 3)) return false;
    const r = t.resolutionTimeHours;
    if (f.resolution === 'missing' && r !== null) return false;
    if (f.resolution === 'lt8' && !(r !== null && r < 8)) return false;
    if (f.resolution === '8to24' && !(r !== null && r >= 8 && r <= 24)) return false;
    if (f.resolution === 'gt24' && !(r !== null && r > 24)) return false;
    if (f.urgentOnly && !p?.signals.some((s) => s.ruleId === 'deadlineOrInterruption' || s.ruleId === 'security')) return false;
    return true;
  });
}

/** Sorts a copy. Missing values always sort last regardless of direction. */
export function sortTickets(tickets: Ticket[], sort: Sort, priorities: Map<string, TicketPriority>): Ticket[] {
  const val = (t: Ticket): number | string | null => {
    switch (sort.key) {
      case 'priority':
        return priorities.get(t.id)?.score ?? 0;
      case 'created':
        return t.createdAt?.getTime() ?? null;
      case 'id':
        return t.id;
      case 'status':
        return t.status;
      case 'product':
        return t.product;
      case 'resolution':
        return t.resolutionTimeHours;
      case 'csat':
        return t.csatScore;
    }
  };
  const dir = sort.dir === 'asc' ? 1 : -1;
  return [...tickets].sort((a, b) => {
    const va = val(a);
    const vb = val(b);
    if (va === null && vb === null) return 0;
    if (va === null) return 1;
    if (vb === null) return -1;
    const c = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), undefined, { numeric: true });
    if (c !== 0) return c * dir;
    // stable tie-breaker: newest first
    return (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0);
  });
}

export const distinctValues = (tickets: Ticket[], key: (t: Ticket) => string | null) =>
  [...new Set(tickets.map(key).filter((v): v is string => !!v))].sort();
