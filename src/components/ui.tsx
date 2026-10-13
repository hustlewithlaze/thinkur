import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, CircleDot, Clock3, Eye, Search, ShieldAlert, XCircle } from 'lucide-react';
import { href } from '../state/router';
import type { PriorityLabel, ReviewStatus, Ticket } from '../lib/types';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

export function Card({ title, subtitle, action, children, className, id }: { title?: ReactNode; subtitle?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={cx('rounded-lg border border-line bg-card', className)}>
      {(title || action) && (
        <header className="flex flex-wrap items-start justify-between gap-2 border-b border-line/70 px-4 py-3">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-semibold text-ink">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

type Tone = 'neutral' | 'accent' | 'good' | 'warn' | 'crit' | 'faint';
const TONES: Record<Tone, string> = {
  neutral: 'border-line bg-elevated text-ink',
  accent: 'border-accent/35 bg-accent/10 text-accent',
  good: 'border-good/35 bg-good/10 text-good',
  warn: 'border-warn/35 bg-warn/10 text-warn',
  crit: 'border-crit/40 bg-crit/10 text-crit',
  faint: 'border-line bg-transparent text-muted',
};

export function Badge({ tone = 'neutral', children, icon, className, title }: { tone?: Tone; children: ReactNode; icon?: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cx('inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded border px-1.5 py-0.5 text-[11px] font-medium leading-4', TONES[tone], className)}>
      {icon}
      {children}
    </span>
  );
}

export function PriorityBadge({ label, score }: { label: PriorityLabel; score?: number }) {
  const tone: Tone = label === 'High Attention' ? 'crit' : label === 'Review' ? 'warn' : 'faint';
  const icon = label === 'High Attention' ? <AlertTriangle size={11} aria-hidden /> : label === 'Review' ? <Eye size={11} aria-hidden /> : null;
  return (
    <Badge tone={tone} icon={icon} title="Prototype rules-based score — not a probability or official severity">
      {label}
      {score !== undefined && <span className="tabular opacity-80">· {score}</span>}
    </Badge>
  );
}

export function StatusBadge({ t }: { t: Pick<Ticket, 'status' | 'statusCategory'> }) {
  if (t.statusCategory === 'resolved') return <Badge tone="faint" icon={<CheckCircle2 size={11} aria-hidden />}>{t.status}</Badge>;
  if (t.status === 'open') return <Badge tone="warn" icon={<CircleDot size={11} aria-hidden />}>open</Badge>;
  if (t.statusCategory === 'unresolved') return <Badge tone="accent" icon={<Clock3 size={11} aria-hidden />}>{t.status}</Badge>;
  return <Badge tone="neutral">{t.status || 'unknown'}</Badge>;
}

export function ReviewBadge({ status }: { status: ReviewStatus }) {
  const map: Record<ReviewStatus, { tone: Tone; icon: ReactNode }> = {
    Candidate: { tone: 'neutral', icon: <CircleDot size={11} aria-hidden /> },
    'Needs Review': { tone: 'warn', icon: <Eye size={11} aria-hidden /> },
    'Under Investigation': { tone: 'accent', icon: <Search size={11} aria-hidden /> },
    'Confirmed by Operator': { tone: 'good', icon: <CheckCircle2 size={11} aria-hidden /> },
    Dismissed: { tone: 'faint', icon: <XCircle size={11} aria-hidden /> },
  };
  return (
    <Badge tone={map[status].tone} icon={map[status].icon}>
      {status}
    </Badge>
  );
}

export const SecurityIcon = ShieldAlert;

type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'good';
const BTN: Record<BtnVariant, string> = {
  primary: 'bg-accent text-[#0f1726] hover:bg-[#8db6ff] border-transparent',
  secondary: 'bg-elevated text-ink border-line hover:border-[#4a525b] hover:bg-[#333941]',
  ghost: 'bg-transparent text-muted border-transparent hover:text-ink hover:bg-elevated',
  danger: 'bg-transparent text-crit border-crit/40 hover:bg-crit/10',
  good: 'bg-good/15 text-good border-good/40 hover:bg-good/20',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: 'sm' | 'md' }) {
  return (
    <button
      type="button"
      {...rest}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-md border font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45',
        size === 'sm' ? 'min-h-8 px-2.5 text-xs' : 'min-h-10 px-3.5 text-sm sm:min-h-9',
        BTN[variant],
        className,
      )}
    >
      {children}
    </button>
  );
}

export function EmptyState({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center">
      {icon && <div className="text-faint">{icon}</div>}
      <p className="text-sm font-medium text-ink">{title}</p>
      {body && <p className="max-w-md text-sm text-muted">{body}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function TicketLink({ id, className }: { id: string; className?: string }) {
  return (
    <a href={href.queue(id)} className={cx('font-mono text-[12px] text-accent hover:underline', className)}>
      {id}
    </a>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export const inputCls =
  'min-h-10 w-full rounded-md border border-line bg-bg px-3 text-sm text-ink placeholder:text-faint focus:border-accent/60 focus:outline-none sm:min-h-9';

export function fmtDateTime(d: Date | null): string {
  if (!d) return '—';
  return d.toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
}
export function fmtDate(d: Date | null): string {
  if (!d) return '—';
  return d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });
}
export const fmtHours = (h: number | null) => (h === null ? '—' : `${h.toFixed(1)}h`);
export const fmtStamp = (iso: string) => new Date(iso).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
export const plural = (n: number, w: string, p = `${w}s`) => `${n} ${n === 1 ? w : p}`;
