import { ArrowLeft, Network } from 'lucide-react';
import { Card, EmptyState, PriorityBadge, ReviewBadge, StatusBadge, TicketLink, fmtDateTime, fmtHours } from '../components/ui';
import { RULES } from '../lib/priority';
import { statedAmounts } from '../lib/text';
import { href } from '../state/router';
import { useStore } from '../state/store';

export default function TicketDetail({ id }: { id: string }) {
  const { byId, priorities, groupByTicket, statusOf, tickets, settings, metrics } = useStore();
  const t = byId.get(id);

  const back = (
    <a href={href.queue()} className="mb-4 inline-flex min-h-10 items-center gap-1.5 text-sm text-muted hover:text-ink">
      <ArrowLeft size={15} /> Operations Queue
    </a>
  );

  if (!t)
    return (
      <div>
        {back}
        <Card>
          <EmptyState title={`Ticket ${id} is not in the active dataset`} body="It may have been removed when a different dataset was loaded." />
        </Card>
      </div>
    );

  const p = priorities.get(t.id)!;
  const g = groupByTicket.get(t.id);
  const sameCustomer = t.customerName ? tickets.filter((x) => x.customerName === t.customerName && x.id !== t.id).sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0)) : [];
  const amounts = statedAmounts(t.body);
  const daysToEnd = t.statusCategory === 'unresolved' && t.createdAt && metrics.lastDate ? (metrics.lastDate.getTime() - t.createdAt.getTime()) / 86_400_000 : null;

  const fields: [string, React.ReactNode][] = [
    ['Created', fmtDateTime(t.createdAt) + (t.createdAt ? '' : ` (raw: “${t.createdAtRaw}”)`)],
    ['Customer', t.customerName ?? '—'],
    ['Segment', t.customerSegment ?? '—'],
    ['Country', t.country ?? '—'],
    ['Product', t.product ?? '—'],
    ['Status', <StatusBadge key="s" t={t} />],
    ['Resolution time', t.resolutionTimeHours === null ? (t.statusCategory === 'unresolved' ? 'Not resolved' : 'Not recorded') : fmtHours(t.resolutionTimeHours)],
    ['CSAT', t.csatScore === null ? 'Not recorded' : `${t.csatScore} / 5`],
    ['Monthly revenue (account)', t.monthlyRevenueUsd === null ? '—' : `$${t.monthlyRevenueUsd.toLocaleString()} USD`],
    ['Source row', `Line ${t.rowNumber}`],
  ];

  return (
    <div>
      {back}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm text-accent">{t.id}</span>
        <StatusBadge t={t} />
        <PriorityBadge label={p.label} score={p.score} />
      </div>
      <h1 className="mb-5 text-xl font-semibold tracking-tight text-ink">{t.subject || '(no subject)'}</h1>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <Card title="Customer message">
            <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-ink">{t.body || <span className="text-faint">(empty)</span>}</p>
            {amounts.length > 0 && (
              <p className="mt-3 text-xs text-faint">Amounts in this ticket ({amounts.join(', ')}) are customer-stated and unverified. They are not used for prioritisation.</p>
            )}
          </Card>
          <Card title="All fields">
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
              {fields.map(([k, v]) => (
                <div key={k} className="min-w-0">
                  <dt className="text-[11px] uppercase tracking-wider text-faint">{k}</dt>
                  <dd className="tabular mt-0.5 break-words text-sm text-ink">{v}</dd>
                </div>
              ))}
            </dl>
            {daysToEnd !== null && (
              <p className="mt-4 text-xs text-faint">
                Still {t.status} at the latest ticket in this dataset, {daysToEnd.toFixed(1)} days after creation. The dataset has no snapshot timestamp, so actual age may be longer.
              </p>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card title="Why this priority" subtitle="Prototype rules — not a probability or official severity">
            {p.signals.length === 0 ? (
              <p className="text-sm text-muted">No priority rules fired. Score 0 → Routine.</p>
            ) : (
              <ul className="space-y-2.5">
                {p.signals.map((s) => (
                  <li key={s.ruleId} className="flex gap-3 text-sm">
                    <span className="tabular w-8 shrink-0 text-right font-medium text-ink">+{s.points}</span>
                    <div className="min-w-0">
                      <div className="text-ink">{s.label}</div>
                      <div className="text-xs text-muted">{s.reason}</div>
                      {s.evidence && <div className="mt-0.5 text-xs text-faint">Matched: “{s.evidence}”</div>}
                    </div>
                  </li>
                ))}
                <li className="flex gap-3 border-t border-line/70 pt-2.5 text-sm">
                  <span className="tabular w-8 shrink-0 text-right font-semibold text-ink">{p.score}</span>
                  <span className="text-muted">
                    Total → <span className="text-ink">{p.label}</span> (High ≥ {settings.highAttentionMin}, Review ≥ {settings.reviewMin})
                  </span>
                </li>
              </ul>
            )}
            <details className="mt-4 text-xs text-muted">
              <summary className="cursor-pointer text-faint hover:text-muted">Rules not triggered</summary>
              <ul className="mt-2 space-y-1">
                {RULES.filter((r) => !p.signals.some((s) => s.ruleId === r.id)).map((r) => (
                  <li key={r.id}>
                    <span className="text-ink">{r.label}</span> (+{settings.weights[r.id]}): {r.description}
                  </li>
                ))}
              </ul>
            </details>
          </Card>

          <Card title="Candidate group">
            {g ? (
              <a href={href.incidents(g.id)} className="block rounded-md border border-line bg-bg/40 p-3 hover:border-accent/50">
                <div className="flex flex-wrap items-center gap-2">
                  <Network size={14} className="text-accent" aria-hidden />
                  <span className="text-sm font-medium text-ink">{g.title}</span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                  <ReviewBadge status={statusOf(g)} />
                  {g.ticketIds.length} tickets · {g.distinctCustomers ?? '?'} customers · {g.unresolvedCount} unresolved
                </div>
              </a>
            ) : (
              <p className="text-sm text-muted">Not part of a candidate group.</p>
            )}
          </Card>

          {sameCustomer.length > 0 && (
            <Card title={`Other tickets from ${t.customerName}`}>
              <ul className="space-y-2">
                {sameCustomer.slice(0, 8).map((x) => (
                  <li key={x.id} className="flex items-center gap-2 text-sm">
                    <TicketLink id={x.id} />
                    <span className="min-w-0 flex-1 truncate text-muted">{x.subject}</span>
                    <StatusBadge t={x} />
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
