import { useState, useEffect, useCallback, useRef } from 'react';
import { appCache } from '../services/cache';

/**
 * Stale-While-Revalidate hook.
 * - Returns cached data instantly (no loading flash on repeat visits)
 * - Revalidates in the background and updates when fresh data arrives
 */
export function useDataCache<T>(
  key: string,
  fetcher: () => Promise<T>,
) {
  const cached = appCache.get<T>(key);
  const [data, setData] = useState<T | null>(cached);
  const [loading, setLoading] = useState<boolean>(!cached);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else if (!appCache.get<T>(key)) {
      setLoading(true);
    }
    try {
      setError(null);
      const result = await fetcherRef.current();
      if (mountedRef.current) {
        appCache.set(key, result);
        setData(result);
      }
    } catch (err: any) {
      if (mountedRef.current) {
        setError(err?.message || 'Error loading data');
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [key]);

  useEffect(() => {
    load(false);
  }, [load]);

  const refresh = useCallback(() => load(true), [load]);

  const invalidate = useCallback(() => {
    appCache.invalidate(key);
    setData(null);
    load(false);
  }, [key, load]);

  return { data, loading, refreshing, error, refresh, invalidate };
}
