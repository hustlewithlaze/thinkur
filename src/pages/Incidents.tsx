import { useMemo, useState } from 'react';
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  ClipboardCopy,
  FileText,
  ListChecks,
  Network,
  NotebookPen,
  RotateCcw,
  Search,
  Sparkles,
  TriangleAlert,
  XCircle,
} from 'lucide-react';
import { Badge, Button, Card, EmptyState, PageHeader, ReviewBadge, StatusBadge, TicketLink, cx, fmtDate, fmtStamp, inputCls, plural } from '../components/ui';
import { useAiStatus } from '../components/useAiStatus';
import { buildRuleBasedBrief, briefToMarkdown } from '../lib/brief';
import type { Brief, CandidateGroup, EvidenceItem, ReviewStatus } from '../lib/types';
import { href } from '../state/router';
import { useStore } from '../state/store';

type Tab = 'open' | 'progress' | 'confirmed' | 'dismissed' | 'all';
const TAB_MATCH: Record<Tab, (s: ReviewStatus) => boolean> = {
  open: (s) => s === 'Candidate' || s === 'Needs Review',
  progress: (s) => s === 'Under Investigation',
  confirmed: (s) => s === 'Confirmed by Operator',
  dismissed: (s) => s === 'Dismissed',
  all: () => true,
};
const TAB_LABEL: Record<Tab, string> = { open: 'To review', progress: 'Investigating', confirmed: 'Confirmed', dismissed: 'Dismissed', all: 'All' };

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

function GroupCard({ g, active }: { g: CandidateGroup; active: boolean }) {
  const { statusOf } = useStore();
  return (
    <a
      href={href.incidents(g.id)}
      aria-current={active ? 'true' : undefined}
      className={cx('block rounded-lg border p-3.5 transition-colors', active ? 'border-accent/60 bg-elevated' : 'border-line bg-card hover:border-accent/40')}
    >
      <div className="flex items-start gap-2">
        <Network size={15} className="mt-0.5 shrink-0 text-accent" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium leading-snug text-ink">{g.title}</div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <ReviewBadge status={statusOf(g)} />
            {g.unresolvedCount > 0 && <Badge tone="warn">{g.unresolvedCount} unresolved</Badge>}
          </div>
          <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-muted">{g.description}</p>
          <dl className="tabular mt-2.5 grid grid-cols-3 gap-2 text-[11px]">
            <div>
              <dt className="text-faint">Tickets</dt>
              <dd className="text-ink">{g.ticketIds.length}</dd>
            </div>
            <div>
              <dt className="text-faint">Customers</dt>
              <dd className="text-ink">{g.distinctCustomers ?? 'n/a'}</dd>
            </div>
            <div>
              <dt className="text-faint">Product</dt>
              <dd className="truncate text-ink">{g.product.join(', ')}</dd>
            </div>
          </dl>
          <div className="mt-1.5 text-[11px] text-faint">
            {fmtDate(g.firstAt)} – {fmtDate(g.lastAt)}
          </div>
        </div>
      </div>
    </a>
  );
}

function Ids({ ids }: { ids: string[] }) {
  return (
    <span className="inline-flex flex-wrap gap-x-1.5 gap-y-0.5 align-baseline">
      {ids.map((id) => (
        <TicketLink key={id} id={id} className="text-[11px]" />
      ))}
    </span>
  );
}

function EvidenceList({ items, empty }: { items: EvidenceItem[]; empty: string }) {
  if (!items.length) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <ul className="space-y-2">
      {items.map((e, i) => (
        <li key={i} className="text-sm leading-relaxed text-ink">
          {e.text} <Ids ids={e.ticketIds} />
        </li>
      ))}
    </ul>
  );
}

function BriefSection({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="border-t border-line/70 py-4 first:border-t-0 first:pt-0">
      <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted">
        {icon}
        {title}
      </h3>
      {children}
    </section>
  );
}

function Workspace({ g }: { g: CandidateGroup }) {
  const store = useStore();
  const { byId, statusOf, reviewOf, setStatus, addNote, addAction, toggleAction, aiBriefOf, saveAiBrief } = store;
  const status = statusOf(g);
  const review = reviewOf(g.id);
  const ai = useAiStatus();
  const ruleBrief = useMemo(() => buildRuleBasedBrief(g, byId), [g, byId]);
  const aiBrief = aiBriefOf(g.id);
  const [useAi, setUseAi] = useState(true);
  const brief: Brief = aiBrief && useAi ? aiBrief : ruleBrief;
  const [note, setNote] = useState('');
  const [action, setAction] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [aiState, setAiState] = useState<{ loading: boolean; error?: string; dropped?: number }>({ loading: false });
  const membershipChanged = review.memberSnapshot && review.memberSnapshot.join(',') !== g.ticketIds.join(',');

  const flash = (m: string) => {
    setToast(m);
    window.setTimeout(() => setToast(null), 2500);
  };

  const onCopy = async () => {
    const ok = await copyText(briefToMarkdown(g, brief, status));
    flash(ok ? 'Investigation brief copied as Markdown' : 'Copy failed — your browser blocked clipboard access');
  };

  const generateAi = async () => {
    setAiState({ loading: true });
    // Pseudonymise customers; send only fields needed to describe the pattern.
    const names = new Map<string, string>();
    const tickets = g.ticketIds.map((id) => {
      const t = byId.get(id)!;
      const key = t.customerName ?? `unknown-${id}`;
      if (!names.has(key)) names.set(key, `Customer ${String.fromCharCode(65 + (names.size % 26))}${names.size >= 26 ? Math.floor(names.size / 26) : ''}`);
      return { id: t.id, created: t.createdAtRaw, product: t.product, status: t.status, customer: names.get(key), subject: t.subject, body: t.body };
    });
    try {
      const res = await fetch('/api/ai/brief', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: g.title, tickets }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? `Request failed (${res.status})`);
      saveAiBrief(g.id, {
        source: 'ai',
        model: j.model,
        generatedAt: new Date().toISOString(),
        happening: j.happening,
        evidence: ruleBrief.evidence, // source excerpts always come from the records, never the model
        differences: j.differences,
        impact: j.impact,
        unknowns: j.unknowns,
        questions: j.questions,
        nextStep: j.nextStep,
      });
      setUseAi(true);
      setAiState({ loading: false, dropped: j.droppedUnsupported ?? 0 });
    } catch (e) {
      setAiState({ loading: false, error: `${(e as Error).message}. Showing the rule-based brief instead.` });
    }
  };

  return (
    <div className="min-w-0">
      <a href={href.incidents()} className="mb-3 inline-flex min-h-10 items-center gap-1.5 text-sm text-muted hover:text-ink xl:hidden">
        <ArrowLeft size={15} /> All candidate groups
      </a>

      <div className="rounded-lg border border-line bg-card">
        <div className="border-b border-line/70 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <ReviewBadge status={status} />
            <span className="font-mono text-[11px] text-faint">{g.id}</span>
          </div>
          <h2 className="mt-2 text-lg font-semibold tracking-tight text-ink">{g.title}</h2>
          <p className="mt-1 text-sm text-muted">{g.description}</p>
          <dl className="tabular mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-5">
            {[
              ['Tickets', g.ticketIds.length],
              ['Distinct customers', g.distinctCustomers ?? 'n/a'],
              ['Unresolved', g.unresolvedCount],
              ['Products', g.product.join(', ')],
              ['Date range', `${fmtDate(g.firstAt)} – ${fmtDate(g.lastAt)}`],
            ].map(([k, v]) => (
              <div key={k as string}>
                <dt className="text-faint">{k}</dt>
                <dd className="mt-0.5 text-ink">{v}</dd>
              </div>
            ))}
          </dl>

          <div className="mt-4 flex flex-wrap gap-2">
            {status === 'Dismissed' ? (
              <Button variant="secondary" onClick={() => setStatus(g, 'Needs Review', 'reopened')}>
                <RotateCcw size={14} /> Reopen
              </Button>
            ) : (
              <>
                {status !== 'Under Investigation' && status !== 'Confirmed by Operator' && (
                  <Button variant="primary" onClick={() => setStatus(g, 'Under Investigation')}>
                    <Search size={14} /> Start investigation
                  </Button>
                )}
                {status !== 'Confirmed by Operator' && (
                  <Button variant="good" onClick={() => setStatus(g, 'Confirmed by Operator')}>
                    <CheckCircle2 size={14} /> Confirm grouping
                  </Button>
                )}
                {status === 'Confirmed by Operator' && (
                  <Button variant="secondary" onClick={() => setStatus(g, 'Under Investigation', 'confirmation withdrawn')}>
                    <RotateCcw size={14} /> Withdraw confirmation
                  </Button>
                )}
                <Button variant="danger" onClick={() => setStatus(g, 'Dismissed')}>
                  <XCircle size={14} /> Dismiss
                </Button>
              </>
            )}
            <Button onClick={onCopy}>
              <ClipboardCopy size={14} /> Copy brief
            </Button>
            <a href="#decision" className="inline-flex min-h-10 items-center px-2 text-sm text-accent hover:underline sm:min-h-9">
              Notes & actions
            </a>
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-faint">
            “Confirmed by Operator” means the operator agrees these tickets belong in one investigation. It does not establish a technical root cause. Dismissing keeps all source tickets and removes the
            “similar reports” priority points from them.
          </p>
          {membershipChanged && (
            <p className="mt-2 flex items-center gap-1.5 text-xs text-warn">
              <TriangleAlert size={13} /> Ticket membership has changed since this group was last reviewed (settings or data were reprocessed).
            </p>
          )}
        </div>

        <div className="grid min-[1600px]:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0 p-4">
            <div className="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-line bg-bg/40 p-2.5 text-xs">
              {brief.source === 'ai' ? (
                <Badge tone="accent" icon={<Sparkles size={11} />}>
                  AI-assisted
                </Badge>
              ) : (
                <Badge tone="neutral" icon={<FileText size={11} />}>
                  Rule-based template
                </Badge>
              )}
              <span className="min-w-0 flex-1 text-muted">
                {brief.source === 'ai'
                  ? `Drafted by ${brief.model} at ${fmtStamp(brief.generatedAt)} from pseudonymised ticket text. Statements citing tickets outside this group are removed automatically. Verify before acting.`
                  : 'Generated in the browser from the member tickets using fixed rules and templates. No AI involved.'}
              </span>
              {aiBrief && (
                <Button size="sm" variant="ghost" onClick={() => setUseAi((u) => !u)}>
                  Show {useAi ? 'rule-based' : 'AI-assisted'}
                </Button>
              )}
              {ai.configured ? (
                <Button size="sm" onClick={generateAi} disabled={aiState.loading} title="Sends pseudonymised ticket subject/body text for this group to the configured AI provider">
                  <Sparkles size={12} /> {aiState.loading ? 'Generating…' : aiBrief ? 'Refresh AI brief' : 'Generate AI brief'}
                </Button>
              ) : (
                !ai.loading && <span className="text-faint">AI not configured on server</span>
              )}
            </div>
            {aiState.error && <p className="mb-3 rounded-md border border-crit/40 bg-crit/10 p-2.5 text-xs text-crit">{aiState.error}</p>}
            {!!aiState.dropped && <p className="mb-3 text-xs text-warn">{plural(aiState.dropped, 'unsupported AI statement')} removed during validation.</p>}

            <BriefSection title="Why this group was surfaced">
              <ul className="list-disc space-y-1 pl-5 text-sm text-muted marker:text-faint">
                {g.why.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </BriefSection>
            <BriefSection title="What appears to be happening">
              <EvidenceList items={brief.happening} empty="No summary available." />
            </BriefSection>
            <BriefSection title={`Supporting evidence (${brief.evidence.length})`}>
              <ul className="space-y-2">
                {brief.evidence.map((e) => {
                  const t = byId.get(e.ticketIds[0]);
                  return (
                    <li key={e.ticketIds[0]} className="rounded-md border border-line/70 bg-bg/30 p-2.5">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <TicketLink id={e.ticketIds[0]} />
                        {t && <StatusBadge t={t} />}
                        <span className="text-faint">{t?.subject}</span>
                      </div>
                      <p className="mt-1 text-sm leading-relaxed text-muted">{e.text}</p>
                    </li>
                  );
                })}
              </ul>
            </BriefSection>
            <BriefSection title="Differences and contradictions">
              <EvidenceList items={brief.differences} empty="No differences detected by the rules. Read the evidence before assuming one cause." />
            </BriefSection>
            <BriefSection title="Potential customer impact (explicitly stated)">
              <EvidenceList items={brief.impact} empty="No explicit impact statements in these tickets." />
            </BriefSection>
            <BriefSection title="Unknowns">
              <ul className="list-disc space-y-1 pl-5 text-sm text-ink marker:text-faint">
                {brief.unknowns.map((u) => (
                  <li key={u}>{u}</li>
                ))}
              </ul>
            </BriefSection>
            <BriefSection title="Questions to investigate">
              <ol className="list-decimal space-y-1 pl-5 text-sm text-ink marker:text-faint">
                {brief.questions.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ol>
            </BriefSection>
            <BriefSection title="Suggested next step">
              <p className="rounded-md border border-accent/30 bg-accent/5 p-3 text-sm leading-relaxed text-ink">{brief.nextStep}</p>
              <p className="mt-2 text-[11px] text-faint">Decision support only. Thinkur never moves money, changes permissions, freezes accounts, contacts customers or closes tickets.</p>
            </BriefSection>
          </div>

          <aside id="decision" className="space-y-5 border-t border-line/70 p-4 min-[1600px]:border-l min-[1600px]:border-t-0">
            <div>
              <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted">
                <ListChecks size={13} /> Next actions
              </h3>
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!action.trim()) return;
                  addAction(g.id, action.trim());
                  setAction('');
                }}
              >
                <input value={action} onChange={(e) => setAction(e.target.value)} placeholder="e.g. Ask card ops for decline codes" aria-label="New next action" className={inputCls} />
                <Button type="submit" disabled={!action.trim()}>
                  Add
                </Button>
              </form>
              <ul className="mt-2 space-y-1.5">
                {review.actions.length === 0 && <li className="text-xs text-faint">No actions recorded.</li>}
                {review.actions.map((a) => (
                  <li key={a.id}>
                    <label className="flex min-h-9 cursor-pointer items-start gap-2.5 rounded-md p-1.5 text-sm hover:bg-elevated/50">
                      <input type="checkbox" checked={a.done} onChange={() => toggleAction(g.id, a.id)} className="mt-0.5 h-4 w-4 accent-[#67D6A3]" />
                      <span className={cx('min-w-0 flex-1', a.done ? 'text-faint line-through' : 'text-ink')}>
                        {a.text}
                        <span className="block text-[11px] text-faint no-underline">
                          added {fmtStamp(a.at)}
                          {a.doneAt && ` · done ${fmtStamp(a.doneAt)}`}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted">
                <NotebookPen size={13} /> Notes
              </h3>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!note.trim()) return;
                  addNote(g.id, note.trim());
                  setNote('');
                }}
              >
                <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Add an investigation note…" aria-label="New note" className={cx(inputCls, 'py-2')} />
                <div className="mt-2 flex justify-end">
                  <Button type="submit" size="sm" disabled={!note.trim()}>
                    Save note
                  </Button>
                </div>
              </form>
              <ul className="mt-2 space-y-2">
                {review.notes.map((n) => (
                  <li key={n.id} className="rounded-md border border-line/70 bg-bg/30 p-2.5 text-sm text-ink">
                    <p className="whitespace-pre-wrap break-words">{n.text}</p>
                    <p className="mt-1 text-[11px] text-faint">{fmtStamp(n.at)}</p>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Review history</h3>
              {review.history.length === 0 ? (
                <p className="text-xs text-faint">No changes yet. Default status: {g.defaultStatus}.</p>
              ) : (
                <ol className="space-y-1.5 text-xs">
                  {[...review.history].reverse().map((h, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="tabular shrink-0 text-faint">{fmtStamp(h.at)}</span>
                      <span className="text-muted">{h.event}</span>
                    </li>
                  ))}
                </ol>
              )}
              <p className="mt-3 text-[11px] text-faint">Saved in this browser (localStorage). Not shared with teammates.</p>
            </div>
          </aside>
        </div>
      </div>

      {toast && (
        <div role="status" className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-md border border-line bg-elevated px-3 py-2 text-sm text-ink shadow-xl">
          <Check size={14} className="text-good" /> {toast}
        </div>
      )}
    </div>
  );
}

export default function Incidents({ groupId }: { groupId?: string }) {
  const { groups, statusOf, grouping, settings } = useStore();
  const [tab, setTab] = useState<Tab>('all');
  const selected = groupId ? groups.find((g) => g.id === groupId) : undefined;
  const visible = groups.filter((g) => TAB_MATCH[tab](statusOf(g)));
  const counts = Object.fromEntries((Object.keys(TAB_MATCH) as Tab[]).map((t) => [t, groups.filter((g) => TAB_MATCH[t](statusOf(g))).length])) as Record<Tab, number>;

  const list = (
    <div>
      <div role="tablist" aria-label="Filter by review status" className="mb-3 flex flex-wrap gap-1 rounded-md border border-line bg-card p-1">
        {(Object.keys(TAB_LABEL) as Tab[]).map((t) => (
          <button
            key={t}
            role="tab"
            type="button"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cx('min-h-9 shrink-0 rounded px-2.5 text-xs font-medium', tab === t ? 'bg-elevated text-ink' : 'text-muted hover:text-ink')}
          >
            {TAB_LABEL[t]} <span className="tabular text-faint">{counts[t]}</span>
          </button>
        ))}
      </div>
      {visible.length === 0 ? (
        <Card>
          <EmptyState icon={<Network size={22} />} title={groups.length ? `No groups in “${TAB_LABEL[tab]}”` : 'No candidate groups found'} body={groups.length ? undefined : 'Try lowering the similarity threshold in Data & Settings.'} />
        </Card>
      ) : (
        <ul className="space-y-2.5">
          {visible.map((g) => (
            <li key={g.id}>
              <GroupCard g={g} active={g.id === groupId} />
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 text-[11px] leading-relaxed text-faint">
        Groups link tickets in the same product, created within {settings.grouping.windowDays} days, whose wording and normalised symptoms overlap (similarity ≥ {settings.grouping.similarityThreshold}), with at least{' '}
        {settings.grouping.minTickets} tickets from {settings.grouping.minCustomers}+ customers. {grouping.excludedInformational} how-to tickets that describe no problem are excluded. Similar wording is not
        proof of a shared cause.
      </p>
    </div>
  );

  return (
    <div>
      <div className={cx(selected && 'hidden xl:block')}>
        <PageHeader title="Incident Intelligence" description="Candidate groups of possibly related tickets, with evidence-grounded briefs and human review." />
      </div>
      {groupId && !selected ? (
        <Card>
          <EmptyState
            title="This candidate group no longer exists"
            body="Its membership may have changed after reprocessing or loading a different dataset."
            action={<a href={href.incidents()} className="text-accent hover:underline">Back to all groups</a>}
          />
        </Card>
      ) : selected ? (
        <div className="xl:grid xl:grid-cols-[300px_minmax(0,1fr)] xl:gap-5">
          <div className="hidden xl:block">{list}</div>
          <Workspace key={selected.id} g={selected} />
        </div>
      ) : (
        <div className="xl:grid xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)] xl:gap-5">
          {list}
          <Card className="hidden xl:block">
            <EmptyState icon={<Network size={26} />} title="Select a candidate group" body="Review the evidence, read the brief, then confirm, dismiss or start an investigation." />
          </Card>
        </div>
      )}
    </div>
  );
}
