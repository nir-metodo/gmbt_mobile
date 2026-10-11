import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { contactsApi, type ContactView } from '../../services/api/contacts';
import { toWebViewFilters, type ContactFilterState } from '../../services/contactFilters';

// Saved contact views, synced with the server (same `ContactViews` collection the web uses).
// The last server response is cached in AsyncStorage so the tabs render instantly / offline and
// are simply refreshed in the background.

const MAX_RECENT = 8;

export function useContactViews(organization: string, userId: string, isAdmin: boolean) {
  const [views, setViews] = useState<ContactView[]>([]);
  const cacheKey = `contacts_views_cache_v1:${organization}:${userId}`;
  const viewsRef = useRef<ContactView[]>([]);
  viewsRef.current = views;

  const persist = useCallback(
    (next: ContactView[]) => {
      AsyncStorage.setItem(cacheKey, JSON.stringify(next)).catch(() => {});
    },
    [cacheKey],
  );

  const refresh = useCallback(async () => {
    if (!organization) return;
    try {
      const fresh = await contactsApi.getViews(organization, userId);
      setViews(fresh);
      persist(fresh);
    } catch {
      // offline / server error: keep what we have (cached or in memory)
    }
  }, [organization, userId, persist]);

  useEffect(() => {
    if (!organization) return;
    let cancelled = false;
    AsyncStorage.getItem(cacheKey)
      .then((raw) => {
        if (cancelled || !raw) return;
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) setViews((cur) => (cur.length ? cur : parsed));
        } catch {
          // ignore corrupt cache
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) refresh();
      });
    return () => {
      cancelled = true;
    };
  }, [organization, cacheKey, refresh]);

  const canEdit = useCallback(
    (v: ContactView) => isAdmin || !v.userId || v.userId === userId,
    [isAdmin, userId],
  );

  const saveView = useCallback(
    async (name: string, filters: ContactFilterState, visibility: 'personal' | 'shared' = 'personal') => {
      const viewData = {
        name: name.trim(),
        filters: toWebViewFilters(filters),
        userId,
        visibility: isAdmin ? visibility : 'personal',
        sharedWithUserIds: [] as string[],
        locked: false,
      };
      const id = await contactsApi.saveView(organization, viewData);
      const created: ContactView = { ...viewData, id };
      const next = [...viewsRef.current, created];
      setViews(next);
      persist(next);
      return created;
    },
    [organization, userId, isAdmin, persist],
  );

  // Overwrites a view's filters with the current ones (the server merges, so sharing metadata stays).
  const updateView = useCallback(
    async (id: string, filters: ContactFilterState) => {
      const f = toWebViewFilters(filters);
      await contactsApi.saveView(organization, { id, filters: f });
      const next = viewsRef.current.map((v) => (v.id === id ? { ...v, filters: f } : v));
      setViews(next);
      persist(next);
    },
    [organization, persist],
  );

  const deleteView = useCallback(
    async (id: string) => {
      await contactsApi.deleteView(organization, id);
      const next = viewsRef.current.filter((v) => v.id !== id);
      setViews(next);
      persist(next);
    },
    [organization, persist],
  );

  return { views, refresh, saveView, updateView, deleteView, canEdit };
}

// Per-organization recent search terms (most recent first).
export function useRecentSearches(organization: string) {
  const [recent, setRecent] = useState<string[]>([]);
  const key = `contacts_recent_searches_v1:${organization}`;

  useEffect(() => {
    if (!organization) return;
    AsyncStorage.getItem(key)
      .then((raw) => {
        if (!raw) return;
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) setRecent(parsed.filter((s) => typeof s === 'string'));
        } catch {
          // ignore
        }
      })
      .catch(() => {});
  }, [organization, key]);

  const add = useCallback(
    (term: string) => {
      const t = term.trim();
      if (t.length < 2) return;
      setRecent((cur) => {
        const next = [t, ...cur.filter((x) => x.toLowerCase() !== t.toLowerCase())].slice(0, MAX_RECENT);
        AsyncStorage.setItem(key, JSON.stringify(next)).catch(() => {});
        return next;
      });
    },
    [key],
  );

  const clear = useCallback(() => {
    setRecent([]);
    AsyncStorage.removeItem(key).catch(() => {});
  }, [key]);

  const remove = useCallback(
    (term: string) => {
      setRecent((cur) => {
        const next = cur.filter((x) => x !== term);
        AsyncStorage.setItem(key, JSON.stringify(next)).catch(() => {});
        return next;
      });
    },
    [key],
  );

  return { recent, add, clear, remove };
}
