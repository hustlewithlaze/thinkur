import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronsUpDown, Filter, Network, Search, ShieldAlert, Timer, X } from 'lucide-react';
import { Badge, Button, EmptyState, PageHeader, PriorityBadge, StatusBadge, cx, fmtDateTime, fmtHours, inputCls } from '../components/ui';
import { EMPTY_FILTERS, activeFilterCount, distinctValues, filterTickets, sortTickets, type QueueFilters, type Sort, type SortKey } from '../lib/filter';
import type { Ticket } from '../lib/types';
import { href, navigate } from '../state/router';
import { useStore } from '../state/store';

// Survive navigation to ticket detail and back within the session.
let savedFilters: QueueFilters = EMPTY_FILTERS;
let savedSort: Sort = { key: 'priority', dir: 'desc' };

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-faint">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={cx(inputCls, value && 'border-accent/50')}>
        <option value="">All</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function SignalIcons({ t }: { t: Ticket }) {
  const { priorities, groupByTicket } = useStore();
  const sig = priorities.get(t.id)?.signals ?? [];
  const g = groupByTicket.get(t.id);
  return (
    <span className="inline-flex items-center gap-1.5 text-faint">
      {sig.some((s) => s.ruleId === 'deadlineOrInterruption') && (
        <span title="Deadline or service interruption stated" className="text-warn">
          <Timer size={14} aria-label="Deadline or interruption" />
        </span>
      )}
      {sig.some((s) => s.ruleId === 'security') && (
        <span title="Security concern stated" className="text-crit">
          <ShieldAlert size={14} aria-label="Security concern" />
        </span>
      )}
      {g && (
        <span title={`Candidate group: ${g.title}`} className="text-accent">
          <Network size={14} aria-label="In candidate group" />
        </span>
      )}
    </span>
  );
}

export default function Queue() {
  const { tickets, priorities, groupByTicket, groups, settings, importResult } = useStore();
  const [f, setF] = useState<QueueFilters>(savedFilters);
  const [sort, setSort] = useState<Sort>(savedSort);
  const [filtersOpen, setFiltersOpen] = useState(false);
  savedFilters = f;
  savedSort = sort;

  const set = <K extends keyof QueueFilters>(k: K, v: QueueFilters[K]) => setF((p) => ({ ...p, [k]: v }));
  const options = useMemo(
    () => ({
      status: distinctValues(tickets, (t) => t.status),
      product: distinctValues(tickets, (t) => t.product),
      segment: distinctValues(tickets, (t) => t.customerSegment),
      country: distinctValues(tickets, (t) => t.country),
    }),
    [tickets],
  );
  const rows = useMemo(
    () => sortTickets(filterTickets(tickets, f, { priorities, groupByTicket, lowCsatThreshold: settings.lowCsatThreshold }), sort, priorities),
    [tickets, f, sort, priorities, groupByTicket, settings.lowCsatThreshold],
  );
  const nActive = activeFilterCount({ ...f, q: '' });
  const has = (col: string) => importResult.headers.includes(col);

  const toggleSort = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'id' || key === 'product' || key === 'status' ? 'asc' : 'desc' }));

  const SortHeader = ({ k, children, className }: { k: SortKey; children: React.ReactNode; className?: string }) => (
    <th scope="col" className={cx('px-3 py-2.5 font-medium', className)} aria-sort={sort.key === k ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" onClick={() => toggleSort(k)} className="inline-flex items-center gap-1 hover:text-ink">
        {children}
        {sort.key === k ? sort.dir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} /> : <ChevronsUpDown size={12} className="opacity-40" />}
      </button>
    </th>
  );

  const filterPanel = (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-8">
      <Select
        label="Status"
        value={f.status}
        onChange={(v) => set('status', v)}
        options={[{ value: 'unresolved', label: 'Open + pending' }, ...options.status.map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) }))]}
      />
      {has('product') && <Select label="Product" value={f.product} onChange={(v) => set('product', v)} options={options.product.map((v) => ({ value: v, label: v }))} />}
      {has('customer_segment') && <Select label="Segment" value={f.segment} onChange={(v) => set('segment', v)} options={options.segment.map((v) => ({ value: v, label: v }))} />}
      {has('country') && <Select label="Country" value={f.country} onChange={(v) => set('country', v)} options={options.country.map((v) => ({ value: v, label: v }))} />}
      <Select label="Priority" value={f.priority} onChange={(v) => set('priority', v)} options={['High Attention', 'Review', 'Routine'].map((v) => ({ value: v, label: v }))} />
      <Select
        label="Candidate group"
        value={f.group}
        onChange={(v) => set('group', v)}
        options={[{ value: 'any', label: 'In any group' }, { value: 'none', label: 'Not in a group' }, ...groups.map((g) => ({ value: g.id, label: g.title }))]}
      />
      {has('csat_score') && (
        <Select
          label="CSAT"
          value={f.csat}
          onChange={(v) => set('csat', v)}
          options={[
            { value: 'low', label: `Low (≤ ${settings.lowCsatThreshold}, resolved)` },
            { value: '3plus', label: '3 or higher' },
            { value: 'missing', label: 'Not recorded' },
          ]}
        />
      )}
      {has('resolution_time_hours') && (
        <Select
          label="Resolution time"
          value={f.resolution}
          onChange={(v) => set('resolution', v)}
          options={[
            { value: 'lt8', label: 'Under 8h' },
            { value: '8to24', label: '8–24h' },
            { value: 'gt24', label: 'Over 24h' },
            { value: 'missing', label: 'Not recorded' },
          ]}
        />
      )}
    </div>
  );

  return (
    <div>
      <PageHeader title="Operations Queue" description="Search, filter and sort every ticket. Priority labels come from transparent rules; open a ticket to see exactly which rules fired." />

      <div className="rounded-lg border border-line bg-card">
        <div className="flex flex-wrap items-center gap-2 border-b border-line/70 p-3">
          <div className="relative min-w-0 flex-1 basis-60">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" aria-hidden />
            <input
              type="search"
              value={f.q}
              onChange={(e) => set('q', e.target.value)}
              placeholder="Search ID, subject, body, customer…"
              aria-label="Search tickets"
              className={cx(inputCls, 'pl-9')}
            />
          </div>
          <Button variant={f.status === 'unresolved' ? 'primary' : 'secondary'} onClick={() => set('status', f.status === 'unresolved' ? '' : 'unresolved')} aria-pressed={f.status === 'unresolved'}>
            Unresolved
          </Button>
          <Button variant={f.urgentOnly ? 'primary' : 'secondary'} onClick={() => set('urgentOnly', !f.urgentOnly)} aria-pressed={f.urgentOnly} title="Deadline, interruption or security signals">
            <Timer size={14} aria-hidden /> Urgency signals
          </Button>
          <Button onClick={() => setFiltersOpen((o) => !o)} aria-expanded={filtersOpen} aria-controls="queue-filters">
            <Filter size={14} aria-hidden /> Filters
            {nActive > 0 && <Badge tone="accent">{nActive}</Badge>}
          </Button>
          {(nActive > 0 || f.q) && (
            <Button variant="ghost" onClick={() => setF(EMPTY_FILTERS)}>
              <X size={14} aria-hidden /> Clear
            </Button>
          )}
        </div>
        {filtersOpen && (
          <div id="queue-filters" className="border-b border-line/70 bg-bg/30 p-3">
            {filterPanel}
          </div>
        )}
        <div className="px-3 py-2 text-xs text-muted" aria-live="polite">
          Showing <span className="tabular text-ink">{rows.length}</span> of {tickets.length} tickets
        </div>

        {tickets.length === 0 ? (
          <EmptyState title="No tickets loaded" body="Load a CSV in Data & Settings to populate the queue." action={<a className="text-accent hover:underline" href={href.data()}>Go to Data & Settings</a>} />
        ) : rows.length === 0 ? (
          <EmptyState icon={<Search size={22} />} title="No tickets match these filters" body="Try removing a filter or broadening the search." action={<Button onClick={() => setF(EMPTY_FILTERS)}>Clear all filters</Button>} />
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden lg:block">
              <table className="w-full table-fixed text-left text-sm">
                <thead className="border-y border-line/70 bg-bg/40 text-xs text-muted">
                  <tr>
                    <SortHeader k="priority" className="w-[140px]">Priority</SortHeader>
                    <SortHeader k="id" className="w-[88px]">Ticket</SortHeader>
                    <th scope="col" className="px-3 py-2.5 font-medium">Subject</th>
                    <SortHeader k="created" className="w-[112px]">Created</SortHeader>
                    {has('product') && <SortHeader k="product" className="w-[88px]">Product</SortHeader>}
                    {has('customer_segment') && <th scope="col" className="hidden w-[100px] px-3 py-2.5 font-medium 2xl:table-cell">Segment</th>}
                    {has('country') && <th scope="col" className="hidden w-[56px] px-3 py-2.5 font-medium 2xl:table-cell">Ctry</th>}
                    <SortHeader k="status" className="w-[100px]">Status</SortHeader>
                    {has('resolution_time_hours') && <SortHeader k="resolution" className="w-[68px] text-right">Res.</SortHeader>}
                    {has('csat_score') && <SortHeader k="csat" className="w-[64px]">CSAT</SortHeader>}
                    <th scope="col" className="w-[60px] px-3 py-2.5 font-medium">
                      <span className="sr-only">Signals</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((t) => {
                    const p = priorities.get(t.id)!;
                    return (
                      <tr
                        key={t.id}
                        tabIndex={0}
                        onClick={() => navigate(href.queue(t.id))}
                        onKeyDown={(e) => e.key === 'Enter' && navigate(href.queue(t.id))}
                        className="cursor-pointer border-b border-line/50 outline-none transition-colors last:border-0 hover:bg-elevated/50 focus-visible:bg-elevated/70"
                        aria-label={`${t.id}: ${t.subject}`}
                      >
                        <td className="px-3 py-2.5">
                          <PriorityBadge label={p.label} score={p.score} />
                        </td>
                        <td className="px-3 py-2.5 font-mono text-[12px] text-accent">{t.id}</td>
                        <td className="px-3 py-2.5">
                          <div className="truncate text-ink">{t.subject || <span className="text-faint">(no subject)</span>}</div>
                          <div className="truncate text-xs text-faint">{t.customerName ? `${t.customerName} · ` : ''}{t.body}</div>
                        </td>
                        <td className="tabular whitespace-nowrap px-3 py-2.5 text-[13px] text-muted">{fmtDateTime(t.createdAt)}</td>
                        {has('product') && <td className="truncate px-3 py-2.5 text-muted">{t.product ?? '—'}</td>}
                        {has('customer_segment') && <td className="hidden truncate px-3 py-2.5 text-muted 2xl:table-cell">{t.customerSegment ?? '—'}</td>}
                        {has('country') && <td className="hidden px-3 py-2.5 text-muted 2xl:table-cell" title={t.country ?? ''}>{t.country === 'United States' ? 'US' : t.country === 'Canada' ? 'CA' : (t.country ?? '—')}</td>}
                        <td className="px-3 py-2.5">
                          <StatusBadge t={t} />
                        </td>
                        {has('resolution_time_hours') && <td className="tabular px-3 py-2.5 text-right text-muted">{fmtHours(t.resolutionTimeHours)}</td>}
                        {has('csat_score') && (
                          <td className={cx('tabular px-3 py-2.5', t.csatScore !== null && t.csatScore <= settings.lowCsatThreshold ? 'text-crit' : 'text-muted')}>{t.csatScore ?? '—'}</td>
                        )}
                        <td className="px-3 py-2.5">
                          <SignalIcons t={t} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile / tablet cards */}
            <div className="flex items-center justify-between gap-2 border-t border-line/70 px-3 py-2 lg:hidden">
              <label className="flex items-center gap-2 text-xs text-muted">
                Sort
                <select
                  value={`${sort.key}:${sort.dir}`}
                  onChange={(e) => {
                    const [key, dir] = e.target.value.split(':') as [SortKey, 'asc' | 'desc'];
                    setSort({ key, dir });
                  }}
                  className={cx(inputCls, 'w-auto')}
                >
                  <option value="priority:desc">Priority (high first)</option>
                  <option value="created:desc">Newest first</option>
                  <option value="created:asc">Oldest first</option>
                  <option value="resolution:desc">Longest resolution</option>
                  <option value="csat:asc">Lowest CSAT</option>
                  <option value="id:asc">Ticket ID</option>
                </select>
              </label>
            </div>
            <ul className="space-y-2 p-3 pt-1 lg:hidden">
              {rows.map((t) => {
                const p = priorities.get(t.id)!;
                return (
                  <li key={t.id}>
                    <a href={href.queue(t.id)} className="block rounded-md border border-line bg-bg/40 p-3 hover:border-accent/50">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[12px] text-accent">{t.id}</span>
                        <StatusBadge t={t} />
                        <PriorityBadge label={p.label} score={p.score} />
                        <span className="ml-auto">
                          <SignalIcons t={t} />
                        </span>
                      </div>
                      <div className="mt-1.5 text-sm font-medium text-ink">{t.subject}</div>
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted">{t.body}</p>
                      <div className="tabular mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-faint">
                        <span>{fmtDateTime(t.createdAt)}</span>
                        {t.product && <span>{t.product}</span>}
                        {t.customerSegment && <span>{t.customerSegment}</span>}
                        {t.country && <span>{t.country}</span>}
                        {t.resolutionTimeHours !== null && <span>{fmtHours(t.resolutionTimeHours)}</span>}
                        {t.csatScore !== null && <span>CSAT {t.csatScore}</span>}
                      </div>
                    </a>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
