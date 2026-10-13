import { useMemo } from 'react';
import { ArrowRight, History, Info, Network } from 'lucide-react';
import { Badge, Card, PageHeader, PriorityBadge, ReviewBadge, StatusBadge, TicketLink, fmtDate, fmtDateTime, fmtStamp, plural } from '../components/ui';
import { WeeklyChart } from '../components/WeeklyChart';
import { countBy, weeklyVolume } from '../lib/metrics';
import { href } from '../state/router';
import { useStore } from '../state/store';

function Metric({ label, value, detail, definition }: { label: string; value: string; detail: string; definition: string }) {
  return (
    <div className="rounded-lg border border-line bg-card px-4 py-3.5">
      <div className="flex items-center gap-1.5 text-xs text-muted">
        {label}
        <span title={definition} className="cursor-help text-faint" aria-label={`Definition: ${definition}`} role="img">
          <Info size={12} />
        </span>
      </div>
      <div className="tabular mt-1.5 text-2xl font-semibold tracking-tight text-ink">{value}</div>
      <div className="mt-1 text-xs text-faint">{detail}</div>
    </div>
  );
}

export default function Overview() {
  const { tickets, metrics: m, groups, statusOf, priorities, groupByTicket, settings, grouping, reviewOf, dataset } = useStore();

  const reviewGroups = groups.filter((g) => ['Candidate', 'Needs Review'].includes(statusOf(g)));
  const activeGroups = groups
    .filter((g) => statusOf(g) !== 'Dismissed')
    .sort((a, b) => b.unresolvedCount - a.unresolvedCount || b.impactStatements.length - a.impactStatements.length);

  const attentionTickets = useMemo(
    () =>
      tickets
        .map((t) => ({ t, p: priorities.get(t.id)! }))
        .filter(({ t, p }) => p.label !== 'Routine' && t.statusCategory !== 'resolved')
        .sort((a, b) => b.p.score - a.p.score || (a.t.createdAt?.getTime() ?? 0) - (b.t.createdAt?.getTime() ?? 0))
        .slice(0, 8),
    [tickets, priorities],
  );

  const weekly = useMemo(() => weeklyVolume(tickets, (id) => groupByTicket.has(id)), [tickets, groupByTicket]);
  const unresolvedByProduct = countBy(
    tickets.filter((t) => t.statusCategory === 'unresolved'),
    (t) => t.product,
  );
  const maxProd = Math.max(1, ...unresolvedByProduct.map((p) => p.count));

  const activity = groups
    .flatMap((g) => reviewOf(g.id).history.map((h) => ({ ...h, g })))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 6);

  const peak = weekly.reduce((a, b) => (b.grouped + b.other > a.grouped + a.other ? b : a), weekly[0]);

  return (
    <div>
      <PageHeader
        title="Overview"
        description={
          <>
            {dataset.name} · {m.firstDate ? `${fmtDate(m.firstDate)} – ${fmtDate(m.lastDate)}` : 'no valid dates'}
            {m.distinctCustomers !== null && ` · ${m.distinctCustomers} customers`}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Metric label="Total tickets" value={String(m.total)} detail={m.undated ? `${m.undated} without a valid date` : 'All with valid dates'} definition="Count of valid ticket rows after import validation (rejected rows excluded)." />
        <Metric label="Open & pending" value={String(m.unresolved)} detail={`${m.open} open · ${m.pending} pending`} definition="Tickets whose status is open or pending." />
        <Metric
          label="Groups needing review"
          value={String(reviewGroups.length)}
          detail={`${plural(groups.length, 'candidate group')} detected`}
          definition="Candidate groups with review status Candidate or Needs Review (not yet investigated, confirmed or dismissed)."
        />
        <Metric
          label="Low-CSAT resolved"
          value={String(m.lowCsat)}
          detail={`of ${m.csatSample} resolved with CSAT (≤ ${settings.lowCsatThreshold})`}
          definition={`Resolved tickets with CSAT at or below ${settings.lowCsatThreshold}. Denominator: resolved tickets with a recorded CSAT. Missing CSAT is never treated as low.`}
        />
        <Metric
          label="Avg resolution time"
          value={m.avgResolutionHours === null ? '—' : `${m.avgResolutionHours.toFixed(1)}h`}
          detail={m.medianResolutionHours === null ? 'No recorded times' : `median ${m.medianResolutionHours.toFixed(1)}h · n=${m.resolutionSample} resolved`}
          definition="Mean of recorded resolution times on resolved tickets. Open/pending tickets have no resolution time and are excluded, not counted as zero."
        />
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card
          title="Needs attention"
          subtitle="Ranked by unresolved tickets in each group, then by rules-based priority score. Not an official severity."
          action={
            <a href={href.queue()} className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
              Full queue <ArrowRight size={12} />
            </a>
          }
        >
          {activeGroups.length > 0 && (
            <div className="mb-5">
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-faint">Candidate groups</h3>
              <ul className="space-y-2">
                {activeGroups.map((g) => (
                  <li key={g.id}>
                    <a href={href.incidents(g.id)} className="block rounded-md border border-line bg-bg/40 p-3 transition-colors hover:border-accent/50 hover:bg-elevated/50">
                      <div className="flex flex-wrap items-center gap-2">
                        <Network size={14} className="text-accent" aria-hidden />
                        <span className="text-sm font-medium text-ink">{g.title}</span>
                        <ReviewBadge status={statusOf(g)} />
                      </div>
                      <p className="mt-1.5 text-xs leading-relaxed text-muted">
                        <span className="text-ink">Why:</span> {plural(g.ticketIds.length, 'ticket')} from {g.distinctCustomers ?? '?'} distinct customers ({fmtDate(g.firstAt)} – {fmtDate(g.lastAt)})
                        {g.unresolvedCount > 0 && <>, {g.unresolvedCount} still open or pending</>}
                        {g.impactStatements.length > 0 && <>, explicit impact statements such as “{g.impactStatements[0].phrase}” ({g.impactStatements[0].ticketId})</>}.
                      </p>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-faint">Unresolved tickets with priority signals</h3>
          {attentionTickets.length === 0 ? (
            <p className="text-sm text-muted">No open or pending tickets meet the Review threshold.</p>
          ) : (
            <ul className="divide-y divide-line/70">
              {attentionTickets.map(({ t, p }) => (
                <li key={t.id} className="py-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <PriorityBadge label={p.label} score={p.score} />
                    <TicketLink id={t.id} />
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">{t.subject}</span>
                    <StatusBadge t={t} />
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    {p.signals.map((s, i) => (
                      <span key={s.ruleId}>
                        {i > 0 && ' · '}
                        {s.reason}
                        {s.evidence && <span className="text-faint"> (“{s.evidence}”)</span>}
                      </span>
                    ))}
                    <span className="text-faint"> · {fmtDateTime(t.createdAt)}</span>
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="space-y-5">
          <Card
            title="Weekly ticket volume"
            subtitle={peak ? `Busiest week: ${fmtDate(peak.week)} (${peak.grouped + peak.other} tickets, ${peak.grouped} in candidate groups)` : undefined}
          >
            <WeeklyChart data={weekly} />
          </Card>

          <Card title="Open & pending by product">
            {unresolvedByProduct.length === 0 ? (
              <p className="text-sm text-muted">No unresolved tickets.</p>
            ) : (
              <ul className="space-y-2">
                {unresolvedByProduct.map((p) => (
                  <li key={p.key} className="grid grid-cols-[88px_minmax(0,1fr)_24px] items-center gap-3 text-sm">
                    <span className="truncate text-muted">{p.key}</span>
                    <span className="h-2 rounded-sm bg-elevated">
                      <span className="block h-2 rounded-sm bg-chart-a" style={{ width: `${(p.count / maxProd) * 100}%` }} />
                    </span>
                    <span className="tabular text-right text-ink">{p.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Recent operator activity" subtitle="Stored in this browser only">
            {activity.length === 0 ? (
              <p className="flex items-center gap-2 text-sm text-muted">
                <History size={14} aria-hidden /> No review activity yet. Open a candidate group to start.
              </p>
            ) : (
              <ul className="space-y-2 text-xs">
                {activity.map((a, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="tabular shrink-0 text-faint">{fmtStamp(a.at)}</span>
                    <span className="min-w-0 text-muted">
                      <a href={href.incidents(a.g.id)} className="text-accent hover:underline">
                        {a.g.title}
                      </a>
                      : {a.event}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="How-to requests" subtitle="Excluded from incident grouping">
            <p className="text-sm text-muted">
              <Badge tone="neutral">{grouping.excludedInformational}</Badge> tickets ask informational questions without describing a problem (e.g. “How do I change the monthly spend limit?”). They are visible in
              the queue but are not used to form candidate groups.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
