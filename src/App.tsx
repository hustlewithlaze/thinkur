import { useEffect, useState } from 'react';
import { Database, Inbox, LayoutDashboard, Menu, Network, X } from 'lucide-react';
import { cx } from './components/ui';
import { useAiStatus } from './components/useAiStatus';
import { useStore } from './state/store';
import { href, useRoute, type Route } from './state/router';
import Overview from './pages/Overview';
import Queue from './pages/Queue';
import TicketDetail from './pages/TicketDetail';
import Incidents from './pages/Incidents';
import DataSettings from './pages/DataSettings';

const NAV: { page: Route['page']; label: string; icon: typeof Inbox; to: string }[] = [
  { page: 'overview', label: 'Overview', icon: LayoutDashboard, to: href.overview() },
  { page: 'queue', label: 'Operations Queue', icon: Inbox, to: href.queue() },
  { page: 'incidents', label: 'Incident Intelligence', icon: Network, to: href.incidents() },
  { page: 'data', label: 'Data & Settings', icon: Database, to: href.data() },
];

function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden>
        <rect width="32" height="32" rx="7" fill="#2D3238" />
        <path d="M9 11h14M16 11v12" stroke="#79A9FF" strokeWidth="3" strokeLinecap="round" />
        <circle cx="23" cy="21" r="2.5" fill="#67D6A3" />
      </svg>
      <div className="leading-tight">
        <div className="text-[15px] font-semibold tracking-tight text-ink">Thinkur</div>
        <div className="text-[10.5px] text-faint">Think clearly. Act decisively.</div>
      </div>
    </div>
  );
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const route = useRoute();
  const { metrics, groups, statusOf } = useStore();
  const needReview = groups.filter((g) => ['Candidate', 'Needs Review'].includes(statusOf(g))).length;
  const counts: Partial<Record<Route['page'], number>> = { queue: metrics.unresolved, incidents: needReview };
  return (
    <nav aria-label="Main">
      <ul className="space-y-0.5">
        {NAV.map(({ page, label, icon: Icon, to }) => {
          const active = route.page === page;
          return (
            <li key={page}>
              <a
                href={to}
                onClick={onNavigate}
                aria-current={active ? 'page' : undefined}
                className={cx(
                  'flex min-h-11 items-center gap-3 rounded-md px-3 text-sm transition-colors lg:min-h-9',
                  active ? 'bg-elevated font-medium text-ink' : 'text-muted hover:bg-elevated/60 hover:text-ink',
                )}
              >
                <Icon size={16} className={active ? 'text-accent' : ''} aria-hidden />
                <span className="flex-1">{label}</span>
                {!!counts[page] && (
                  <span className="tabular rounded bg-bg px-1.5 text-[11px] text-muted" title={page === 'queue' ? 'Open + pending tickets' : 'Groups awaiting review'}>
                    {counts[page]}
                  </span>
                )}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function SourceFooter() {
  const { dataset, tickets } = useStore();
  const ai = useAiStatus();
  return (
    <div className="space-y-2 border-t border-line/70 pt-3 text-[11px] text-faint">
      <div>
        <div className="uppercase tracking-wider">Active dataset</div>
        <div className="mt-0.5 truncate text-muted" title={dataset.name}>
          {dataset.name}
        </div>
        <div>
          {tickets.length} tickets · {dataset.source === 'bundled' ? 'challenge dataset' : 'uploaded'}
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <span className={cx('h-1.5 w-1.5 rounded-full', ai.configured ? 'bg-good' : 'bg-faint')} aria-hidden />
        {ai.loading ? 'Checking AI…' : ai.configured ? `AI briefs: ${ai.model}` : 'AI off · rule-based briefs'}
      </div>
    </div>
  );
}

export default function App() {
  const route = useRoute();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    window.scrollTo(0, 0);
    setMenuOpen(false);
  }, [route.page, (route as { ticketId?: string }).ticketId, (route as { groupId?: string }).groupId]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[240px_minmax(0,1fr)]">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-card focus:px-3 focus:py-2">
        Skip to content
      </a>

      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen flex-col gap-6 border-r border-line bg-sidebar px-3 py-5 lg:flex">
        <div className="px-2">
          <Logo />
        </div>
        <div className="flex-1">
          <NavList />
        </div>
        <div className="px-2">
          <SourceFooter />
        </div>
      </aside>

      {/* Mobile / tablet top bar */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-sidebar/95 px-4 backdrop-blur lg:hidden">
        <Logo />
        <button
          type="button"
          className="inline-flex h-11 w-11 items-center justify-center rounded-md text-muted hover:bg-elevated hover:text-ink"
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={menuOpen}
          aria-controls="mobile-nav"
          onClick={() => setMenuOpen((o) => !o)}
        >
          {menuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </header>
      {menuOpen && (
        <>
          <div className="fixed inset-0 top-14 z-20 bg-black/50 lg:hidden" onClick={() => setMenuOpen(false)} aria-hidden />
          <div id="mobile-nav" className="fixed inset-x-0 top-14 z-30 space-y-4 border-b border-line bg-sidebar px-3 pb-4 pt-3 lg:hidden">
            <NavList onNavigate={() => setMenuOpen(false)} />
            <div className="px-2">
              <SourceFooter />
            </div>
          </div>
        </>
      )}

      <main id="main" className="min-w-0 px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
        <div className="mx-auto max-w-[1600px]">
          {route.page === 'overview' && <Overview />}
          {route.page === 'queue' && (route.ticketId ? <TicketDetail id={route.ticketId} /> : <Queue />)}
          {route.page === 'incidents' && <Incidents groupId={route.groupId} />}
          {route.page === 'data' && <DataSettings />}
        </div>
      </main>
    </div>
  );
}
