import { useSyncExternalStore } from 'react';

export type Route =
  | { page: 'overview' }
  | { page: 'queue'; ticketId?: string }
  | { page: 'incidents'; groupId?: string }
  | { page: 'data' };

export function parseHash(hash: string): Route {
  const [page, id] = hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  if (page === 'queue') return { page: 'queue', ticketId: id || undefined };
  if (page === 'incidents') return { page: 'incidents', groupId: id || undefined };
  if (page === 'data') return { page: 'data' };
  return { page: 'overview' };
}

export const href = {
  overview: () => '#/overview',
  queue: (ticketId?: string) => (ticketId ? `#/queue/${encodeURIComponent(ticketId)}` : '#/queue'),
  incidents: (groupId?: string) => (groupId ? `#/incidents/${encodeURIComponent(groupId)}` : '#/incidents'),
  data: () => '#/data',
};

const subscribe = (cb: () => void) => {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
};

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash);
  return parseHash(hash);
}

export const navigate = (h: string) => {
  window.location.hash = h;
};
