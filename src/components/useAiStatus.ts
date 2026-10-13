import { useEffect, useState } from 'react';

export interface AiStatus {
  loading: boolean;
  configured: boolean;
  model: string | null;
  reachable: boolean;
}

let cache: Promise<AiStatus> | null = null;

function fetchStatus(): Promise<AiStatus> {
  cache ??= fetch('/api/ai/status')
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((j) => ({ loading: false, configured: !!j.configured, model: j.model ?? null, reachable: true }))
    .catch(() => ({ loading: false, configured: false, model: null, reachable: false }));
  return cache;
}

/** AI availability as reported by the server. The browser never sees the key. */
export function useAiStatus(): AiStatus {
  const [s, setS] = useState<AiStatus>({ loading: true, configured: false, model: null, reachable: false });
  useEffect(() => {
    let live = true;
    fetchStatus().then((v) => live && setS(v));
    return () => {
      live = false;
    };
  }, []);
  return s;
}
