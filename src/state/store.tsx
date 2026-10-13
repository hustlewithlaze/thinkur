import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import bundledCsv from '../../data/support_tickets.csv?raw';
import { parseTicketsCsv } from '../lib/csv';
import { findCandidateGroups, type GroupingResult } from '../lib/grouping';
import { computeMetrics, type Metrics } from '../lib/metrics';
import { scoreAll } from '../lib/priority';
import {
  DEFAULT_SETTINGS,
  type Brief,
  type CandidateGroup,
  type GroupReview,
  type ImportResult,
  type ReviewStatus,
  type Settings,
  type Ticket,
  type TicketPriority,
} from '../lib/types';

export const BUNDLED_NAME = 'bizops_challenge_support_tickets.csv';
const STORAGE_KEY = 'thinkur:v1';

interface DatasetRef {
  source: 'bundled' | 'upload';
  name: string;
  csv?: string; // only stored for uploads
  loadedAt: string;
}

interface Persisted {
  dataset: DatasetRef;
  settings: Settings;
  reviews: Record<string, Record<string, GroupReview>>; // datasetKey → groupId → review
  aiBriefs: Record<string, Record<string, Brief>>;
}

const initial = (): Persisted => ({
  dataset: { source: 'bundled', name: BUNDLED_NAME, loadedAt: new Date().toISOString() },
  settings: DEFAULT_SETTINGS,
  reviews: {},
  aiBriefs: {},
});

function load(): Persisted {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return initial();
    const p = JSON.parse(raw) as Persisted;
    return {
      ...initial(),
      ...p,
      settings: {
        ...DEFAULT_SETTINGS,
        ...p.settings,
        weights: { ...DEFAULT_SETTINGS.weights, ...p.settings?.weights },
        grouping: { ...DEFAULT_SETTINGS.grouping, ...p.settings?.grouping },
      },
    };
  } catch {
    return initial();
  }
}

export function hashString(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

const emptyReview = (): GroupReview => ({ notes: [], actions: [], history: [] });
const uid = () => Math.random().toString(36).slice(2, 10);

export interface Store {
  dataset: DatasetRef;
  datasetKey: string;
  importResult: ImportResult;
  tickets: Ticket[];
  byId: Map<string, Ticket>;
  grouping: GroupingResult;
  groups: CandidateGroup[];
  groupByTicket: Map<string, CandidateGroup>;
  priorities: Map<string, TicketPriority>;
  metrics: Metrics;
  settings: Settings;
  persistWarning: string | null;
  reviewOf: (groupId: string) => GroupReview;
  statusOf: (g: CandidateGroup) => ReviewStatus;
  aiBriefOf: (groupId: string) => Brief | undefined;
  loadCsv: (csv: string, name: string) => ImportResult;
  resetDemo: () => void;
  updateSettings: (s: Settings) => void;
  setStatus: (g: CandidateGroup, status: ReviewStatus, reason?: string) => void;
  addNote: (groupId: string, text: string) => void;
  addAction: (groupId: string, text: string) => void;
  toggleAction: (groupId: string, actionId: string) => void;
  saveAiBrief: (groupId: string, brief: Brief) => void;
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Persisted>(load);
  const [persistWarning, setPersistWarning] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      setPersistWarning(null);
    } catch {
      setPersistWarning('Browser storage is unavailable or full; changes will be lost when this tab closes.');
    }
  }, [state]);

  const csv = state.dataset.source === 'bundled' ? bundledCsv : (state.dataset.csv ?? '');
  const datasetKey = `${state.dataset.source}:${hashString(csv)}`;
  const importResult = useMemo(() => parseTicketsCsv(csv), [csv]);
  const tickets = importResult.tickets;
  const byId = useMemo(() => new Map(tickets.map((t) => [t.id, t])), [tickets]);
  const grouping = useMemo(() => findCandidateGroups(tickets, state.settings), [tickets, state.settings]);
  const groupByTicket = useMemo(() => {
    const m = new Map<string, CandidateGroup>();
    for (const g of grouping.groups) for (const id of g.ticketIds) m.set(id, g);
    return m;
  }, [grouping]);

  const reviews = state.reviews[datasetKey] ?? {};
  const reviewOf = useCallback((id: string) => reviews[id] ?? emptyReview(), [reviews]);
  const statusOf = useCallback((g: CandidateGroup) => reviews[g.id]?.status ?? g.defaultStatus, [reviews]);
  const priorities = useMemo(() => scoreAll(tickets, { groupByTicket, statusOf }, state.settings), [tickets, groupByTicket, statusOf, state.settings]);
  const metrics = useMemo(() => computeMetrics(tickets, state.settings.lowCsatThreshold), [tickets, state.settings.lowCsatThreshold]);

  const mutateReview = useCallback(
    (groupId: string, fn: (r: GroupReview) => GroupReview) =>
      setState((s) => {
        const ds = s.reviews[datasetKey] ?? {};
        return { ...s, reviews: { ...s.reviews, [datasetKey]: { ...ds, [groupId]: fn(ds[groupId] ?? emptyReview()) } } };
      }),
    [datasetKey],
  );

  const now = () => new Date().toISOString();

  const store: Store = {
    dataset: state.dataset,
    datasetKey,
    importResult,
    tickets,
    byId,
    grouping,
    groups: grouping.groups,
    groupByTicket,
    priorities,
    metrics,
    settings: state.settings,
    persistWarning,
    reviewOf,
    statusOf,
    aiBriefOf: (id) => state.aiBriefs[datasetKey]?.[id],
    loadCsv: (text, name) => {
      const r = parseTicketsCsv(text);
      if (r.ok) setState((s) => ({ ...s, dataset: { source: 'upload', name, csv: text, loadedAt: now() } }));
      return r;
    },
    resetDemo: () => setState(() => initial()),
    updateSettings: (settings) => setState((s) => ({ ...s, settings })),
    setStatus: (g, status, reason) =>
      mutateReview(g.id, (r) => {
        const from = r.status ?? g.defaultStatus;
        return {
          ...r,
          status,
          memberSnapshot: g.ticketIds,
          history: [...r.history, { at: now(), event: `Status changed from ${from} to ${status}${reason ? ` — ${reason}` : ''}` }],
        };
      }),
    addNote: (groupId, text) =>
      mutateReview(groupId, (r) => ({ ...r, notes: [...r.notes, { id: uid(), at: now(), text }], history: [...r.history, { at: now(), event: 'Note added' }] })),
    addAction: (groupId, text) =>
      mutateReview(groupId, (r) => ({
        ...r,
        actions: [...r.actions, { id: uid(), at: now(), text, done: false }],
        history: [...r.history, { at: now(), event: `Next action recorded: ${text}` }],
      })),
    toggleAction: (groupId, actionId) =>
      mutateReview(groupId, (r) => {
        const a = r.actions.find((x) => x.id === actionId);
        if (!a) return r;
        const done = !a.done;
        return {
          ...r,
          actions: r.actions.map((x) => (x.id === actionId ? { ...x, done, doneAt: done ? now() : undefined } : x)),
          history: [...r.history, { at: now(), event: `Action ${done ? 'completed' : 'reopened'}: ${a.text}` }],
        };
      }),
    saveAiBrief: (groupId, brief) =>
      setState((s) => ({ ...s, aiBriefs: { ...s.aiBriefs, [datasetKey]: { ...(s.aiBriefs[datasetKey] ?? {}), [groupId]: brief } } })),
  };

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore outside StoreProvider');
  return s;
}
