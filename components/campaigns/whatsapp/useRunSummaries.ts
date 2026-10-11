import { useCallback, useEffect, useRef, useState } from 'react';
import { campaignsApi } from '../../../services/api/campaigns';
import { summarizeRuns, RunSummary } from './campaignUtils';

/**
 * Lazy "last run" summaries for the campaigns list.
 *
 * The campaigns list endpoint carries no run info, so a card's last-run line (and the Sent/Draft
 * distinction for manual campaigns) needs GetCampaignResultByCmpaignId. That payload can be heavy
 * (per-recipient rows), so it is fetched lazily — only for cards that become visible (or when the
 * Sent/Draft filter needs them) — with a small concurrency limit and a module-level cache.
 *
 * Cache value: RunSummary = loaded, null = fetch failed (don't retry automatically), undefined = unknown.
 */
const cache = new Map<string, RunSummary | null>();
const MAX_CONCURRENT = 3;

export function invalidateRunSummary(campaignId?: string) {
  if (campaignId) cache.delete(campaignId);
  else cache.clear();
}

export function useRunSummaries(organization: string | undefined) {
  const [, setVersion] = useState(0);
  const queueRef = useRef<string[]>([]);
  const inflightRef = useRef<Set<string>>(new Set());
  const activeRef = useRef(0);
  const mountedRef = useRef(true);
  const orgRef = useRef(organization);
  orgRef.current = organization;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const pump = useCallback(() => {
    while (activeRef.current < MAX_CONCURRENT && queueRef.current.length > 0) {
      const id = queueRef.current.shift() as string;
      const org = orgRef.current;
      if (!org || cache.has(id)) {
        inflightRef.current.delete(id);
        continue;
      }
      activeRef.current += 1;
      campaignsApi
        .getResults(org, id)
        .then((runs) => {
          cache.set(id, summarizeRuns(runs));
        })
        .catch(() => {
          cache.set(id, null);
        })
        .finally(() => {
          activeRef.current -= 1;
          inflightRef.current.delete(id);
          if (mountedRef.current) setVersion((v) => v + 1);
          pump();
        });
    }
  }, []);

  const request = useCallback(
    (ids: string[]) => {
      let added = false;
      ids.forEach((id) => {
        if (!id || cache.has(id) || inflightRef.current.has(id)) return;
        inflightRef.current.add(id);
        queueRef.current.push(id);
        added = true;
      });
      if (added) pump();
    },
    [pump],
  );

  const get = useCallback((id: string): RunSummary | null | undefined => cache.get(id), []);

  /** How many requested summaries are still loading. */
  const pending = inflightRef.current.size;

  return { get, request, pending };
}
