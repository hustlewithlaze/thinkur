import { useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Info, RotateCcw, Sparkles, Upload } from 'lucide-react';
import { Badge, Button, Card, PageHeader, cx, fmtDate, fmtStamp, inputCls, plural } from '../components/ui';
import { useAiStatus } from '../components/useAiStatus';
import { OPTIONAL_COLUMNS, REQUIRED_COLUMNS } from '../lib/csv';
import { countBy } from '../lib/metrics';
import { RULES } from '../lib/priority';
import { DEFAULT_SETTINGS, type ImportResult, type Settings, type Ticket } from '../lib/types';
import { useStore } from '../state/store';

const FIELD_OF: Record<string, (t: Ticket) => unknown> = {
  customer_name: (t) => t.customerName,
  customer_segment: (t) => t.customerSegment,
  monthly_revenue_usd: (t) => t.monthlyRevenueUsd,
  country: (t) => t.country,
  product: (t) => t.product,
  resolution_time_hours: (t) => t.resolutionTimeHours,
  csat_score: (t) => t.csatScore,
  created_at: (t) => t.createdAt,
  ticket_subject: (t) => t.subject || null,
  ticket_body: (t) => t.body || null,
};

function IssueList({ r }: { r: ImportResult }) {
  const order = { error: 0, warning: 1, info: 2 } as const;
  const issues = [...r.issues].sort((a, b) => order[a.severity] - order[b.severity]);
  if (!issues.length) return <p className="flex items-center gap-1.5 text-sm text-good"><CheckCircle2 size={14} /> No validation issues.</p>;
  return (
    <ul className="max-h-72 space-y-1.5 overflow-y-auto pr-1 text-sm">
      {issues.map((i, k) => (
        <li key={k} className="flex gap-2">
          {i.severity === 'error' ? <AlertCircle size={14} className="mt-0.5 shrink-0 text-crit" /> : i.severity === 'warning' ? <AlertCircle size={14} className="mt-0.5 shrink-0 text-warn" /> : <Info size={14} className="mt-0.5 shrink-0 text-faint" />}
          <span className="min-w-0 text-muted">
            {i.row && <span className="tabular text-faint">Line {i.row}{i.ticketId ? ` (${i.ticketId})` : ''}: </span>}
            {i.message}
          </span>
        </li>
      ))}
    </ul>
  );
}

function NumField({ label, value, onChange, min, max, step = 1, hint }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number; step?: number; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-muted">{label}</span>
      <input type="number" value={value} min={min} max={max} step={step} onChange={(e) => onChange(Number(e.target.value))} className={cx(inputCls, 'tabular')} />
      {hint && <span className="mt-1 block text-[11px] text-faint">{hint}</span>}
    </label>
  );
}

export default function DataSettings() {
  const store = useStore();
  const { dataset, importResult: r, tickets, metrics, settings, grouping } = store;
  const ai = useAiStatus();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadResult, setUploadResult] = useState<{ name: string; result: ImportResult } | null>(null);
  const [draft, setDraft] = useState<Settings>(settings);
  const [applied, setApplied] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const onFile = async (file: File) => {
    if (!/\.csv$/i.test(file.name) && file.type !== 'text/csv') {
      setUploadResult({ name: file.name, result: { ...r, ok: false, tickets: [], issues: [{ severity: 'error', message: 'Please choose a .csv file.' }], rejectedRows: [] } });
      return;
    }
    if (file.size > 5_000_000) {
      setUploadResult({ name: file.name, result: { ...r, ok: false, tickets: [], issues: [{ severity: 'error', message: 'File is larger than 5 MB; this prototype keeps data in the browser.' }], rejectedRows: [] } });
      return;
    }
    const text = await file.text();
    const result = store.loadCsv(text, file.name);
    setUploadResult({ name: file.name, result });
    if (fileRef.current) fileRef.current.value = '';
  };

  const setW = (k: keyof Settings['weights'], v: number) => setDraft((d) => ({ ...d, weights: { ...d.weights, [k]: v } }));
  const setG = (k: keyof Settings['grouping'], v: number) => setDraft((d) => ({ ...d, grouping: { ...d.grouping, [k]: v } }));
  const draftValid =
    draft.highAttentionMin > draft.reviewMin &&
    draft.reviewMin >= 1 &&
    Object.values(draft.weights).every((w) => Number.isFinite(w) && w >= 0 && w <= 10) &&
    draft.grouping.similarityThreshold > 0 &&
    draft.grouping.similarityThreshold <= 1 &&
    draft.grouping.windowDays >= 1 &&
    draft.grouping.minTickets >= 2 &&
    draft.grouping.minCustomers >= 1 &&
    draft.lowCsatThreshold >= 1 &&
    draft.lowCsatThreshold <= 4;
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);

  const apply = (s: Settings) => {
    const before = grouping.groups.length;
    store.updateSettings(s);
    setDraft(s);
    setApplied(`Reprocessed at ${new Date().toLocaleTimeString()} (previously ${plural(before, 'group')}).`);
  };

  const csatValues = tickets.map((t) => t.csatScore).filter((x): x is number => x !== null);
  const csatRange = csatValues.length ? `${Math.min(...csatValues)}–${Math.max(...csatValues)}` : 'no values';
  const resolvedN = tickets.filter((t) => t.statusCategory === 'resolved').length;

  return (
    <div>
      <PageHeader title="Data & Settings" description="Load and validate data, inspect quality, and tune the transparent rules. Every view recalculates from the active dataset." />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card
          title="Active data source"
          action={dataset.source === 'bundled' ? <Badge tone="accent">Challenge dataset</Badge> : <Badge tone="neutral">Uploaded</Badge>}
        >
          <dl className="tabular grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
            <div className="col-span-2 sm:col-span-3">
              <dt className="text-xs text-faint">File</dt>
              <dd className="break-all text-ink">{dataset.name}</dd>
            </div>
            <div>
              <dt className="text-xs text-faint">Rows in file</dt>
              <dd className="text-ink">{r.totalDataRows}</dd>
            </div>
            <div>
              <dt className="text-xs text-faint">Valid tickets</dt>
              <dd className="text-ink">{tickets.length}</dd>
            </div>
            <div>
              <dt className="text-xs text-faint">Rejected rows</dt>
              <dd className={r.rejectedRows.length ? 'text-warn' : 'text-ink'}>{r.rejectedRows.length}</dd>
            </div>
            <div>
              <dt className="text-xs text-faint">Date coverage</dt>
              <dd className="text-ink">{metrics.firstDate ? `${fmtDate(metrics.firstDate)} – ${fmtDate(metrics.lastDate)}` : '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-faint">Loaded</dt>
              <dd className="text-ink">{dataset.source === 'bundled' ? 'Bundled with app' : fmtStamp(dataset.loadedAt)}</dd>
            </div>
            <div>
              <dt className="text-xs text-faint">Customers</dt>
              <dd className="text-ink">{metrics.distinctCustomers ?? 'not identifiable'}</dd>
            </div>
          </dl>
          <div className="mt-4 flex flex-wrap gap-2">
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="sr-only" id="csv-upload" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
            <Button variant="primary" onClick={() => fileRef.current?.click()}>
              <Upload size={14} /> Upload CSV
            </Button>
            {confirmReset ? (
              <>
                <Button
                  variant="danger"
                  onClick={() => {
                    store.resetDemo();
                    setDraft(DEFAULT_SETTINGS);
                    setConfirmReset(false);
                    setUploadResult(null);
                    setApplied(null);
                  }}
                >
                  Confirm reset
                </Button>
                <Button variant="ghost" onClick={() => setConfirmReset(false)}>
                  Cancel
                </Button>
              </>
            ) : (
              <Button onClick={() => setConfirmReset(true)}>
                <RotateCcw size={14} /> Reset demo data
              </Button>
            )}
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-faint">
            Required columns: {REQUIRED_COLUMNS.join(', ')}. Optional: {OPTIONAL_COLUMNS.join(', ')}. Reset restores the challenge dataset and default settings and clears all review notes and actions. The CSV
            is parsed in your browser; it is not uploaded to a server.
          </p>
          {uploadResult && (
            <div className={cx('mt-4 rounded-md border p-3', uploadResult.result.ok ? 'border-good/40 bg-good/5' : 'border-crit/40 bg-crit/5')} role="status">
              <p className="mb-2 text-sm font-medium text-ink">
                {uploadResult.result.ok
                  ? `Loaded ${uploadResult.name}: ${uploadResult.result.tickets.length} valid tickets, ${uploadResult.result.rejectedRows.length} rejected.`
                  : `${uploadResult.name} was not loaded. The previous dataset is still active.`}
              </p>
              {!uploadResult.result.ok && <IssueList r={uploadResult.result} />}
            </div>
          )}
        </Card>

        <Card title="Import summary & validation" subtitle={`${r.issues.filter((i) => i.severity === 'error').length} errors · ${r.issues.filter((i) => i.severity === 'warning').length} warnings · ${r.issues.filter((i) => i.severity === 'info').length} notes`}>
          <IssueList r={r} />
          {r.rejectedRows.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-muted">Rejected rows ({r.rejectedRows.length})</summary>
              <ul className="mt-2 space-y-1 text-xs text-faint">
                {r.rejectedRows.map((x) => (
                  <li key={x.row}>
                    Line {x.row}: {x.reason} — {Object.values(x.raw).slice(0, 3).join(' · ')}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </Card>

        <Card title="Missing values" subtitle="Missing values are never treated as zero or as a low score">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-faint">
              <tr>
                <th className="pb-2 font-medium">Column</th>
                <th className="pb-2 text-right font-medium">Missing</th>
              </tr>
            </thead>
            <tbody className="tabular">
              {Object.entries(FIELD_OF)
                .filter(([col]) => r.headers.includes(col))
                .map(([col, get]) => {
                  const miss = tickets.filter((t) => get(t) === null || get(t) === undefined);
                  const allUnresolved = miss.length > 0 && miss.every((t) => t.statusCategory === 'unresolved');
                  return (
                    <tr key={col} className="border-t border-line/60">
                      <td className="break-all py-1.5 pr-3 font-mono text-[12px] text-muted">
                        {col}
                        {miss.length > 0 && <span className="block font-sans text-[11px] text-faint">{allUnresolved ? 'Only on open/pending tickets (expected)' : 'Check source'}</span>}
                      </td>
                      <td className={cx('whitespace-nowrap py-1.5 text-right align-top', miss.length ? 'text-warn' : 'text-ink')}>
                        {miss.length} <span className="text-faint">({tickets.length ? Math.round((miss.length / tickets.length) * 100) : 0}%)</span>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </Card>

        <Card title="Available filter categories">
          <div className="grid gap-4 sm:grid-cols-2">
            {(
              [
                ['Status', (t: Ticket) => t.status],
                ['Product', (t: Ticket) => t.product],
                ['Segment', (t: Ticket) => t.customerSegment],
                ['Country', (t: Ticket) => t.country],
              ] as const
            ).map(([label, key]) => (
              <div key={label}>
                <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wider text-faint">{label}</h3>
                <ul className="tabular space-y-1 text-sm">
                  {countBy(tickets, key).map((c) => (
                    <li key={c.key} className="flex justify-between gap-2">
                      <span className="truncate text-muted">{c.key}</span>
                      <span className="text-ink">{c.count}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Priority rules" subtitle="Illustrative prototype weights — not Loop Financial policy. Revenue and segment are never scored." className="xl:col-span-2">
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <div className="space-y-3">
              {RULES.map((rule) => (
                <div key={rule.id} className="grid grid-cols-[minmax(0,1fr)_88px] items-start gap-3">
                  <div>
                    <div className="text-sm text-ink">{rule.label}</div>
                    <div className="text-xs text-muted">{rule.description}</div>
                  </div>
                  <input
                    type="number"
                    min={0}
                    max={10}
                    value={draft.weights[rule.id]}
                    onChange={(e) => setW(rule.id, Number(e.target.value))}
                    aria-label={`${rule.label} points`}
                    className={cx(inputCls, 'tabular')}
                  />
                </div>
              ))}
            </div>
            <div className="grid content-start gap-4 sm:grid-cols-2">
              <NumField label="High Attention at score ≥" value={draft.highAttentionMin} min={1} max={20} onChange={(v) => setDraft((d) => ({ ...d, highAttentionMin: v }))} />
              <NumField label="Review at score ≥" value={draft.reviewMin} min={1} max={20} onChange={(v) => setDraft((d) => ({ ...d, reviewMin: v }))} />
              <NumField
                label="Low CSAT threshold (≤)"
                value={draft.lowCsatThreshold}
                min={1}
                max={4}
                onChange={(v) => setDraft((d) => ({ ...d, lowCsatThreshold: v }))}
                hint={`Observed CSAT range: ${csatRange} across ${csatValues.length} of ${resolvedN} resolved tickets; read as a 1–5 scale.`}
              />
              <div />
              <NumField label="Grouping: similarity threshold" value={draft.grouping.similarityThreshold} min={0.05} max={1} step={0.05} onChange={(v) => setG('similarityThreshold', v)} hint="0–1; lower links more loosely" />
              <NumField label="Grouping: time window (days)" value={draft.grouping.windowDays} min={1} max={60} onChange={(v) => setG('windowDays', v)} />
              <NumField label="Grouping: minimum tickets" value={draft.grouping.minTickets} min={2} max={50} onChange={(v) => setG('minTickets', v)} />
              <NumField label="Grouping: minimum distinct customers" value={draft.grouping.minCustomers} min={1} max={50} onChange={(v) => setG('minCustomers', v)} />
            </div>
          </div>
          {!draftValid && <p className="mt-3 text-xs text-crit">Check values: High Attention must exceed Review, weights 0–10, CSAT threshold 1–4, similarity 0–1, minimum tickets ≥ 2.</p>}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button variant="primary" disabled={!dirty || !draftValid} onClick={() => apply(draft)}>
              Apply & reprocess
            </Button>
            <Button variant="ghost" onClick={() => apply(DEFAULT_SETTINGS)}>
              Restore defaults
            </Button>
            {applied && <span className="text-xs text-good" role="status">{applied} Now {plural(grouping.groups.length, 'group')}.</span>}
          </div>
        </Card>

        <Card title="AI assistance" action={ai.configured ? <Badge tone="good">Configured</Badge> : <Badge tone="faint">Not configured</Badge>}>
          <div className="space-y-2 text-sm text-muted">
            {ai.loading ? (
              <p>Checking server…</p>
            ) : ai.configured ? (
              <p className="flex items-center gap-1.5">
                <Sparkles size={14} className="text-accent" /> Server reports model <span className="font-mono text-ink">{ai.model}</span>.
              </p>
            ) : (
              <p>{ai.reachable ? 'No ANTHROPIC_API_KEY on the server.' : 'API server not reachable (static hosting).'} Briefs are generated by Thinkur’s rule-based templates.</p>
            )}
            <p className="text-xs text-faint">
              AI is used only to draft a group brief when an operator clicks “Generate AI brief”. The request goes through Thinkur’s server, which holds the key. It carries ticket IDs, dates, product, status, subject and
              body, with customer names replaced by “Customer A/B/…”. Bodies can still contain identifying details. Output is schema-validated, and statements citing tickets outside the group are dropped. Counts,
              filters, scores and grouping never use AI.
            </p>
          </div>
        </Card>

        <Card title="Persistence & limits">
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted marker:text-faint">
            <li>Review status, notes, actions and settings are saved in this browser’s localStorage. They are not shared with teammates and are cleared with browser data.</li>
            <li>Review state is stored per dataset. Loading a different file starts a clean review; reloading the same file restores it.</li>
            <li>Group IDs come from each group’s earliest ticket. If reprocessing changes membership, the workspace flags it.</li>
            {store.persistWarning && <li className="text-warn">{store.persistWarning}</li>}
          </ul>
        </Card>
      </div>
    </div>
  );
}
