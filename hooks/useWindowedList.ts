import { useCallback, useEffect, useMemo, useState } from 'react';

/**
 * Returns a debounced copy of `value`. The debounced value only updates after the
 * caller stops changing `value` for `delay` ms. Used so list screens re-filter once the
 * user pauses typing instead of on every keystroke (which made the screen flicker).
 */
export function useDebouncedValue<T>(value: T, delay = 350): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

export interface WindowedList<T> {
  /** The current visible slice of items (first `count`). */
  visible: T[];
  /** Whether there are more items beyond the visible window. */
  hasMore: boolean;
  /** Grow the window by one page. */
  loadMore: () => void;
  /** Reveal the entire list at once ("load all"). */
  loadAll: () => void;
  /** How many items are currently visible. */
  count: number;
  /** Total items in the (already filtered) source list. */
  total: number;
}

/**
 * Client-side pagination over an in-memory (already filtered/sorted) list. The full list
 * stays searchable/filterable in memory — only the *rendered* slice is paged, which keeps
 * large entity lists (leads, quotes, cases, orders, dynamic tables) snappy without dropping
 * "search across everything".
 *
 * Pass a `resetKey` built from the active filters/search so the window snaps back to the
 * first page whenever the result set changes.
 */
export function useWindowedList<T>(
  items: T[],
  opts?: { pageSize?: number; resetKey?: string },
): WindowedList<T> {
  const pageSize = opts?.pageSize ?? 30;
  const resetKey = opts?.resetKey ?? '';
  const [count, setCount] = useState(pageSize);

  useEffect(() => {
    setCount(pageSize);
  }, [resetKey, pageSize]);

  const total = items.length;
  const visible = useMemo(() => (count >= total ? items : items.slice(0, count)), [items, count, total]);
  const hasMore = count < total;

  const loadMore = useCallback(() => {
    setCount((c) => Math.min(c + pageSize, total));
  }, [pageSize, total]);

  const loadAll = useCallback(() => {
    setCount(total);
  }, [total]);

  return { visible, hasMore, loadMore, loadAll, count: Math.min(count, total), total };
}
