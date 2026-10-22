import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View,
  StyleSheet,
  Pressable,
  RefreshControl,
  ScrollView,
  Alert,
  BackHandler,
} from 'react-native';
import {
  Text,
  Searchbar,
  Chip,
  FAB,
  Avatar,
  ActivityIndicator,
  Portal,
  Modal,
  TextInput,
  Button,
  IconButton,
  Divider,
  Snackbar,
  Menu,
} from 'react-native-paper';
import { FlashList } from '@shopify/flash-list';
import * as Haptics from 'expo-haptics';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { KanbanBoard, type KanbanColumn } from '../../../../components/KanbanBoard';
import { useMultiSelect, SelectCheck, SelectionHeader, BulkActionBar, type BulkAction } from '../../../../components/MultiSelect';
import { useRouter, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../../../stores/authStore';
import { useAppTheme } from '../../../../hooks/useAppTheme';
import { useRTL } from '../../../../hooks/useRTL';
import { casesApi } from '../../../../services/api/cases';
import { tasksApi } from '../../../../services/api/tasks';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { cacheEntities } from '../../../../services/entityCache';
import { ENDPOINTS } from '../../../../constants/api';
import axiosInstance from '../../../../services/api/axiosInstance';
import { getDataVisibility } from '../../../../constants/permissions';
import { formatRelativeTime, getInitials, withAlpha } from '../../../../utils/formatters';
import { borderRadius } from '../../../../constants/theme';
import type { Case } from '../../../../types';
import { EmptyState } from '../../../../components/EmptyState';

const STATUS_FILTERS = ['all', 'open', 'in_progress', 'resolved', 'closed'] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];
const DATE_RANGE_PRESETS = ['Today', 'This Week', 'This Month', 'Last Month', 'This Year'] as const;

const PRIORITY_COLORS: Record<string, string> = {
  low: '#4CAF50',
  medium: '#FF9800',
  high: '#FF5722',
  urgent: '#F44336',
};

const STATUS_COLORS: Record<string, string> = {
  open: '#2196F3',
  in_progress: '#FF9800',
  resolved: '#4CAF50',
  closed: '#757575',
  pending: '#9E9E9E',
};

const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;

function getStatusColor(status: string): string {
  const normalized = status.toLowerCase().replace(/\s+/g, '_');
  return STATUS_COLORS[normalized] || '#9E9E9E';
}

// Parse any backend date shape (ISO string, epoch number, Firestore {_seconds}/{seconds},
// or a "Timestamp: <iso>" prefixed string) to millis for sorting. Returns 0 when absent.
function parseTs(val: any): number {
  if (!val) return 0;
  if (typeof val === 'number') return val;
  if (typeof val === 'object') {
    const secs = val._seconds ?? val.seconds;
    if (typeof secs === 'number') return secs * 1000;
    return 0;
  }
  if (typeof val === 'string') {
    const cleaned = val.startsWith('Timestamp: ') ? val.slice('Timestamp: '.length) : val;
    const d = new Date(cleaned);
    return isNaN(d.getTime()) ? 0 : d.getTime();
  }
  return 0;
}

// Same as parseTs but returns a Date (or null) — used for task due/reminder dates.
function parseTaskDate(val: any): Date | null {
  const ms = parseTs(val);
  if (!ms) return null;
  const d = new Date(ms);
  return isNaN(d.getTime()) ? null : d;
}

// Whether a case is currently in SLA breach — mirrors the web/backend logic. Powers the "SLA
// breaches" view opened from the aggregated digest push.
function isCaseSlaBreached(c: any): boolean {
  if (!c || c.resolvedAt) return false;
  if (c.slaPaused === true || c.slaPaused === 'true') return false;
  if (c.stageSlaBreached === true || c.slaResponseBreached === true || c.slaResolutionBreached === true) return true;
  const parse = (v: any) => { const ms = parseTs(v); return ms || null; };
  const hasFR = !!c.firstResponseAt;
  const respDue = parse(c.slaResponseDueAt);
  const resnDue = parse(c.slaResolutionDueAt);
  const due = (!hasFR && respDue) ? respDue : resnDue;
  if (!due) return false;
  return (due - Date.now()) <= 0;
}

// Per-case SLA level for the list/detail badge: 'breach' (already over), 'warn' (due within the
// next hour) or null. Reuses isCaseSlaBreached for the breach decision so it stays in sync.
function caseSlaLevel(c: any): 'breach' | 'warn' | null {
  if (!c || c.resolvedAt) return null;
  if (c.slaPaused === true || c.slaPaused === 'true') return null;
  if (isCaseSlaBreached(c)) return 'breach';
  const parse = (v: any) => { const ms = parseTs(v); return ms || null; };
  const hasFR = !!c.firstResponseAt;
  const stageDue = parse(c.stageDueAt);
  const respDue = parse(c.slaResponseDueAt);
  const resnDue = parse(c.slaResolutionDueAt);
  // Nearest upcoming deadline across the active due dates.
  const dues = [stageDue, (!hasFR ? respDue : null), resnDue].filter((d): d is number => !!d && d > Date.now());
  if (dues.length === 0) return null;
  const soonest = Math.min(...dues);
  const minsLeft = (soonest - Date.now()) / 60000;
  return minsLeft <= 60 ? 'warn' : null;
}

interface SavedView {
  id: string;
  Name: string;
  ViewData: { filters?: any; searchTerm?: string };
  IsPinned?: boolean;
  Visibility?: string;
  UserId?: string;
}

const OWNER_COLORS = ['#2e6155', '#3b82f6', '#9C27B0', '#f59e0b', '#06b6d4', '#ef4444', '#8b5cf6', '#10b981'];

// Compact owner avatar (initials on a stable per-name color); a dashed placeholder when unassigned.
function OwnerAvatar({ name, theme, size = 22 }: { name?: string; theme: any; size?: number }) {
  if (!name) {
    return (
      <View style={{ width: size, height: size, borderRadius: size / 2, borderWidth: 1, borderStyle: 'dashed', borderColor: theme.colors.outline, alignItems: 'center', justifyContent: 'center' }}>
        <MaterialCommunityIcons name="account-outline" size={size * 0.62} color={theme.colors.onSurfaceVariant} />
      </View>
    );
  }
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return (
    <Avatar.Text
      size={size}
      label={getInitials(name)}
      style={{ backgroundColor: OWNER_COLORS[hash % OWNER_COLORS.length] }}
      labelStyle={{ fontSize: size * 0.42, lineHeight: size * 0.5, color: '#fff' }}
    />
  );
}

// One-tap filter pill used by the quick-filter row (same look as the Leads list).
function QuickChip({
  theme, icon, label, color, active, onPress, count, caret, disabled,
}: {
  theme: any; icon: string; label: string; color: string; active?: boolean; onPress: () => void;
  count?: number; caret?: boolean; disabled?: boolean;
}) {
  const fg = active ? color : theme.colors.onSurfaceVariant;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.quickChip,
        {
          backgroundColor: active ? withAlpha(color, 0.14) : theme.colors.surfaceVariant,
          borderColor: active ? color : 'transparent',
          opacity: disabled ? 0.6 : 1,
        },
      ]}
    >
      <MaterialCommunityIcons name={icon as any} size={14} color={fg} />
      <Text style={{ fontSize: 12, fontWeight: active ? '700' : '500', color: fg }} numberOfLines={1}>
        {label}
      </Text>
      {count != null && count > 0 ? (
        <View style={{ backgroundColor: color, borderRadius: 8, minWidth: 16, paddingHorizontal: 4, alignItems: 'center' }}>
          <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>{count}</Text>
        </View>
      ) : null}
      {caret ? <MaterialCommunityIcons name="chevron-down" size={14} color={fg} /> : null}
    </Pressable>
  );
}

const CaseDivider = () => <Divider />;

export default function CasesListScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useAppTheme();
  const { isRTL, flexDirection, textAlign } = useRTL();
  const { t, i18n } = useTranslation();
  // Inline he/en strings for the new UI (same pattern as the Leads list).
  const tr = useCallback((he: string, en: string) => (isRTL ? he : en), [isRTL]);
  const lang: 'en' | 'he' = i18n.language === 'he' ? 'he' : 'en';

  const user = useAuthStore((s) => s.user);
  const userIsAdmin = String(user?.SecurityRole || '').toLowerCase() === 'admin';
  const routeParams = useLocalSearchParams<{ view?: string }>();

  // "SLA breaches" fixed view — activated by the digest push (params.view === 'sla') or its tab.
  const [slaOnly, setSlaOnly] = useState(false);

  // ── Pagination state ────────────────────────────────────────────────────────
  const PAGE_SIZE = 30;
  const [cases, setCases] = useState<Case[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const fetchingRef = useRef(false);

  // ── Filter state ─────────────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [advancedFilterVisible, setAdvancedFilterVisible] = useState(false);
  const [filterCategory, setFilterCategory] = useState('');
  const [filterAssignee, setFilterAssignee] = useState('');
  const [filterPriority, setFilterPriority] = useState('');
  const [filterDateRange, setFilterDateRange] = useState('');
  const [filterMine, setFilterMine] = useState(false);

  // ── Saved views ─────────────────────────────────────────────────────────────
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [activeViewId, setActiveViewId] = useState('__all');
  const [showSaveViewModal, setShowSaveViewModal] = useState(false);
  const [newViewName, setNewViewName] = useState('');
  const [saveViewVisibility, setSaveViewVisibility] = useState<'personal' | 'shared'>('personal');

  const [viewMode, setViewMode] = useState<'list' | 'kanban'>('list');
  const [moreMenuVisible, setMoreMenuVisible] = useState(false);
  const [sortMenuVisible, setSortMenuVisible] = useState(false);
  const [snackbar, setSnackbar] = useState('');

  // ── Multi-select (list view): long-press a row to start, bulk actions in the bottom bar ──
  const sel = useMultiSelect();
  const clearSelection = sel.clear;
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkModal, setBulkModal] = useState<null | 'stage' | 'priority'>(null);
  // Leaving the screen or switching to the board drops the selection.
  useFocusEffect(useCallback(() => () => clearSelection(), [clearSelection]));
  useEffect(() => {
    if (viewMode !== 'list') clearSelection();
  }, [viewMode, clearSelection]);
  // Android back exits selection mode first.
  useEffect(() => {
    if (!sel.active) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      clearSelection();
      return true;
    });
    return () => subscription.remove();
  }, [sel.active, clearSelection]);

  // ── Sort state (persisted; default = created on, newest first) ────────────────
  type SortKey = 'createdOn' | 'modifiedOn' | 'subject' | 'priority' | 'status';
  type SortDir = 'asc' | 'desc';
  const [sortKey, setSortKey] = useState<SortKey>('createdOn');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const sortPrefLoadedRef = useRef(false);

  useEffect(() => {
    (async () => {
      try {
        const [savedKey, savedDir] = await Promise.all([
          AsyncStorage.getItem('cases_sort_key'),
          AsyncStorage.getItem('cases_sort_dir'),
        ]);
        const valid: SortKey[] = ['createdOn', 'modifiedOn', 'subject', 'priority', 'status'];
        if (savedKey && valid.includes(savedKey as SortKey)) setSortKey(savedKey as SortKey);
        if (savedDir === 'asc' || savedDir === 'desc') setSortDir(savedDir);
      } catch {
        /* keep defaults */
      } finally {
        sortPrefLoadedRef.current = true;
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!sortPrefLoadedRef.current) return;
    AsyncStorage.setItem('cases_sort_key', sortKey).catch(() => {});
    AsyncStorage.setItem('cases_sort_dir', sortDir).catch(() => {});
  }, [sortKey, sortDir]);

  // ── Task quick-filters (today / upcoming / overdue / with-tasks), mirroring Leads ──
  type TaskQuickFilter = 'today' | 'upcoming' | 'overdue' | 'withTasks';
  const [taskQuickFilter, setTaskQuickFilter] = useState<TaskQuickFilter | null>(null);
  const [taskFilterSets, setTaskFilterSets] = useState<{ today: Set<string>; upcoming: Set<string>; overdue: Set<string>; withTasks: Set<string> }>(
    { today: new Set(), upcoming: new Set(), overdue: new Set(), withTasks: new Set() },
  );
  const [taskFilterLoading, setTaskFilterLoading] = useState(false);
  const [loadingAll, setLoadingAll] = useState(false);

  const viewActive = activeViewId !== '__all' || !!taskQuickFilter || slaOnly || filterMine;
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // ── Build filters for API ─────────────────────────────────────────────────
  const buildFilters = useCallback(() => ({
    searchTerm: debouncedSearch.trim(),
    statuses: statusFilter !== 'all' ? [statusFilter] : [],
    categories: filterCategory.trim() ? [filterCategory.trim()] : [],
    owners: filterAssignee.trim() ? [filterAssignee.trim()] : [],
    priorities: filterPriority ? [filterPriority] : [],
    dateRangePreset: filterDateRange || '',
  }), [debouncedSearch, statusFilter, filterCategory, filterAssignee, filterPriority, filterDateRange]);

  const casesDV = getDataVisibility(user?.DataVisibility, user?.SecurityRole, 'cases');

  // ── Fetch a page ─────────────────────────────────────────────────────────
  const fetchPage = useCallback(async (pageNum: number, reset: boolean) => {
    if (!user?.organization || fetchingRef.current) return;
    fetchingRef.current = true;
    if (reset) { setLoading(true); setError(null); } else setLoadingMore(true);
    const shouldFilterOwn = filterMine || casesDV === 'own';
    try {
      const result = await casesApi.getAll(user.organization, {
        page: pageNum,
        pageSize: PAGE_SIZE,
        filters: buildFilters(),
        dataVisibility: shouldFilterOwn ? 'mineOnly' : 'seeAll',
        userId: shouldFilterOwn ? (user.userId || user.uID || '') : '',
      });
      const newItems = result.data ?? [];
      const total = result.total ?? 0;
      cacheEntities('cases', newItems);
      setTotalCount(total);
      setCases((prev) => (reset ? newItems : [...prev, ...newItems]));
      setPage(pageNum);
      setHasMore(newItems.length === PAGE_SIZE);
    } catch (err: any) {
      if (reset) setError(err.message || t('errors.generic'));
    } finally {
      fetchingRef.current = false;
      if (reset) setLoading(false); else setLoadingMore(false);
    }
  }, [user?.organization, buildFilters, t]);

  // Load the WHOLE case dataset in one request so a client-side task filter spans everything
  // (a partial page load is why a task tab could look empty). Mirrors the Leads board. Declared
  // here (before the load/focus effects) so those effects can safely reference it.
  const fetchAllCases = useCallback(async () => {
    if (!user?.organization || loadingAll) return;
    setLoadingAll(true);
    const shouldFilterOwn = filterMine || casesDV === 'own';
    try {
      const result = await casesApi.getAll(user.organization, {
        page: 1,
        pageSize: 5000,
        filters: buildFilters(),
        dataVisibility: shouldFilterOwn ? 'mineOnly' : 'seeAll',
        userId: shouldFilterOwn ? (user.userId || user.uID || '') : '',
      });
      const all = result.data ?? [];
      const total = result.total ?? all.length;
      cacheEntities('cases', all);
      setTotalCount(total);
      setCases(all);
      setPage(Math.max(1, Math.ceil(all.length / PAGE_SIZE)));
      setHasMore(all.length < total);
    } catch {
      /* keep existing data on error */
    } finally {
      setLoadingAll(false);
    }
  }, [user?.organization, user?.userId, user?.uID, loadingAll, filterMine, casesDV, buildFilters]);

  useEffect(() => {
    // A task quick-filter is a client-side filter over the loaded cases, so keep the WHOLE dataset
    // loaded while it's active — a page-1 reset here would shrink the pool and empty the filter.
    if (taskQuickFilter) {
      fetchAllCases();
    } else {
      fetchPage(1, true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.organization, debouncedSearch, statusFilter, filterCategory, filterAssignee, filterPriority, filterDateRange, filterMine]);

  // Load saved views
  useEffect(() => {
    if (!user?.organization) return;
    axiosInstance.post(ENDPOINTS.GET_USER_VIEWS, {
      organization: user.organization,
      userId: user.uID || user.userId,
      viewType: 'cases',
    }).then((res) => {
      const data = res.data;
      if (data?.Success && data?.Data?.views) {
        setSavedViews(data.Data.views);
      } else if (Array.isArray(data)) {
        setSavedViews(data);
      }
    }).catch(() => {});
  }, [user?.organization, user?.uID, user?.userId]);

  const loadSavedView = useCallback((view: SavedView) => {
    const viewData = view.ViewData || {};
    const filters = viewData.filters || {};
    setActiveViewId(view.id);
    setFilterMine(false);
    setStatusFilter(filters.status ? filters.status as StatusFilter : 'all');
    setFilterCategory(filters.category ?? '');
    setFilterAssignee(filters.assignee ?? '');
    setFilterPriority(filters.priority ?? '');
    setFilterDateRange(filters.dateRange ?? '');
    if (viewData.searchTerm) setSearchQuery(viewData.searchTerm);
  }, []);

  const clearAllFilters = useCallback(() => {
    setActiveViewId('__all');
    setStatusFilter('all');
    setFilterCategory('');
    setFilterAssignee('');
    setFilterPriority('');
    setFilterDateRange('');
    setFilterMine(false);
    setSearchQuery('');
    setTaskQuickFilter(null);
    setSlaOnly(false);
  }, []);

  const saveCurrentView = useCallback(async () => {
    if (!newViewName.trim() || !user?.organization) return;
    try {
      const viewData = {
        filters: {
          status: statusFilter !== 'all' ? statusFilter : '',
          category: filterCategory,
          assignee: filterAssignee,
          priority: filterPriority,
          dateRange: filterDateRange,
        },
        searchTerm: searchQuery,
      };
      const res = await axiosInstance.post(ENDPOINTS.SAVE_USER_VIEW, {
        organization: user.organization,
        userId: user.uID || user.userId,
        viewType: 'cases',
        name: newViewName.trim(),
        isPinned: false,
        viewData,
        visibility: userIsAdmin ? saveViewVisibility : 'personal',
      });
      if (res.data?.Success) {
        const newView: SavedView = {
          id: res.data.Data?.id || Date.now().toString(),
          Name: newViewName.trim(),
          ViewData: viewData,
          IsPinned: false,
          Visibility: userIsAdmin ? saveViewVisibility : 'personal',
          UserId: user.uID || user.userId,
        };
        setSavedViews((prev) => [...prev, newView]);
      }
    } catch {}
    setShowSaveViewModal(false);
    setNewViewName('');
    setSaveViewVisibility('personal');
  }, [newViewName, user, statusFilter, filterCategory, filterAssignee, filterPriority, filterDateRange, searchQuery, userIsAdmin, saveViewVisibility]);

  const deleteSavedView = useCallback(async (viewId: string) => {
    if (!user?.organization) return;
    try {
      await axiosInstance.post(ENDPOINTS.DELETE_USER_VIEW, {
        organization: user.organization,
        userId: user.uID || user.userId,
        viewId,
      });
      setSavedViews((prev) => prev.filter((v) => v.id !== viewId));
      if (activeViewId === viewId) clearAllFilters();
    } catch {}
  }, [user, activeViewId, clearAllFilters]);

  // Refetch on screen focus (e.g. returning from detail screen)
  const didMountRef = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!didMountRef.current) {
        didMountRef.current = true;
        return;
      }
      if (user?.organization) {
        // Keep the full dataset when a task quick-filter or the SLA view is active so returning from
        // a case detail doesn't collapse the pool to page 1 and empty out the filtered list.
        if (taskQuickFilter || slaOnly) fetchAllCases();
        else fetchPage(1, true);
      }
    }, [user?.organization, fetchPage, fetchAllCases, taskQuickFilter, slaOnly])
  );

  const onEndReached = useCallback(() => {
    if (!hasMore || loadingMore || loading) return;
    fetchPage(page + 1, false);
  }, [hasMore, loadingMore, loading, page, fetchPage]);

  const fetchCases = useCallback(() => fetchPage(1, true), [fetchPage]);

  // Pull all open tasks for the org and bucket them by the CASE they're attached to
  // (relatedTo.type === 'case'), computing today/upcoming/overdue/with-tasks sets.
  const fetchCaseTaskBuckets = useCallback(async () => {
    if (!user?.organization) return;
    try {
      const allTasks = await tasksApi.getAll(user.organization, '', 'all');
      const now = new Date();
      const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date(now); todayEnd.setHours(23, 59, 59, 999);
      const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      const todaySet = new Set<string>();
      const upcomingSet = new Set<string>();
      const overdueSet = new Set<string>();
      const withTasksSet = new Set<string>();
      (allTasks as any[]).forEach((task: any) => {
        const statusVal = (task.status || task.Status || '').toLowerCase();
        if (statusVal === 'completed' || statusVal === 'cancelled') return;
        const rel = task.relatedTo || task.RelatedTo;
        const relType = (rel?.type || rel?.Type || '').toLowerCase();
        const relId = rel?.entityId || rel?.EntityId;
        if (relType !== 'case' || !relId) return;
        withTasksSet.add(relId);
        const dueDate = parseTaskDate(task.dueDate || task.DueDate) || parseTaskDate(task.reminderDate || task.ReminderDate);
        if (!dueDate) return;
        const isOverdue = dueDate < now;
        const isToday = dueDate >= todayStart && dueDate <= todayEnd;
        if (isOverdue) overdueSet.add(relId);
        if (dueDate >= now && dueDate <= in7Days) upcomingSet.add(relId);
        if (isToday) todaySet.add(relId);
      });
      setTaskFilterSets({ today: todaySet, upcoming: upcomingSet, overdue: overdueSet, withTasks: withTasksSet });
    } catch {
      /* non-critical; leave previous buckets */
    }
  }, [user?.organization]);

  useEffect(() => {
    fetchCaseTaskBuckets();
  }, [fetchCaseTaskBuckets]);

  // Apply/toggle a task quick-filter. Recomputes buckets from fresh task data and loads
  // every case page so the client-side filter matches the whole dataset (mirrors Leads).
  const applyTaskFilter = useCallback(async (type: TaskQuickFilter) => {
    if (taskQuickFilter === type) {
      setTaskQuickFilter(null);
      return;
    }
    setTaskQuickFilter(type);
    setActiveViewId('__all');
    setFilterMine(false);
    setSlaOnly(false);
    setTaskFilterLoading(true);
    try {
      const refresh = fetchCaseTaskBuckets();
      await fetchAllCases();
      await refresh;
    } finally {
      setTaskFilterLoading(false);
    }
  }, [taskQuickFilter, fetchCaseTaskBuckets, fetchAllCases]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    // Preserve the full dataset when a task quick-filter or SLA view is active (a page-1 reset would empty it).
    await ((taskQuickFilter || slaOnly) ? fetchAllCases() : fetchPage(1, true));
    setRefreshing(false);
  }, [fetchPage, fetchAllCases, taskQuickFilter, slaOnly]);

  // Server does the heavy filtering/pagination; here we apply the client-side task
  // quick-filter (when active) and the chosen sort order.
  const PRIORITY_RANK: Record<string, number> = { urgent: 4, high: 3, medium: 2, low: 1 };
  const filteredCases = useMemo(() => {
    let result = [...cases];
    if (taskQuickFilter) {
      const ids = taskFilterSets[taskQuickFilter];
      result = result.filter((c) => ids.has(c.id));
    }
    if (slaOnly) {
      result = result.filter(isCaseSlaBreached);
    }
    result.sort((a: any, b: any) => {
      let aVal: number | string = 0;
      let bVal: number | string = 0;
      if (sortKey === 'createdOn') {
        aVal = parseTs(a.createdOn || a.CreatedOn || a.createdAt);
        bVal = parseTs(b.createdOn || b.CreatedOn || b.createdAt);
      } else if (sortKey === 'modifiedOn') {
        aVal = parseTs(a.modifiedOn || a.ModifiedOn || a.updatedOn || a.UpdatedOn || a.updatedAt) || parseTs(a.createdOn || a.CreatedOn || a.createdAt);
        bVal = parseTs(b.modifiedOn || b.ModifiedOn || b.updatedOn || b.UpdatedOn || b.updatedAt) || parseTs(b.createdOn || b.CreatedOn || b.createdAt);
      } else if (sortKey === 'subject') {
        aVal = (a.subject || a.title || '').toString().toLowerCase();
        bVal = (b.subject || b.title || '').toString().toLowerCase();
      } else if (sortKey === 'priority') {
        aVal = PRIORITY_RANK[(a.priority || '').toLowerCase()] || 0;
        bVal = PRIORITY_RANK[(b.priority || '').toLowerCase()] || 0;
      } else if (sortKey === 'status') {
        aVal = (a.stageName || a.status || '').toString().toLowerCase();
        bVal = (b.stageName || b.status || '').toString().toLowerCase();
      }
      if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return result;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cases, taskQuickFilter, taskFilterSets, sortKey, sortDir, slaOnly]);

  // Deep-link from the SLA digest push: open straight into the breaches view (loads full dataset).
  useEffect(() => {
    if (routeParams?.view === 'sla') {
      setSlaOnly(true);
      setActiveViewId('__sla');
      setTaskQuickFilter(null);
      setFilterMine(false);
      fetchAllCases();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeParams?.view]);


  const openCase = useCallback(
    (caseItem: Case) => {
      router.push({ pathname: '/(tabs)/more/cases/[id]', params: { id: caseItem.id } });
    },
    [router],
  );

  const handleStatusChange = useCallback(
    async (caseItem: Case, newStatus: string) => {
      if (!user?.organization) return;
      // Optimistic update
      setCases((prev) =>
        prev.map((c) => (c.id === caseItem.id ? { ...c, status: newStatus as any } : c)),
      );
      try {
        await casesApi.update(user.organization, caseItem.id, { status: newStatus as any }, user.fullname);
      } catch (err: any) {
        // Revert on failure
        setCases((prev) =>
          prev.map((c) => (c.id === caseItem.id ? { ...c, status: caseItem.status } : c)),
        );
        Alert.alert(t('common.error', 'Error'), err?.message || t('errors.generic'));
      }
    },
    [user, t],
  );

  const CASE_STATUSES = ['open', 'in_progress', 'resolved', 'closed'] as const;
  const STATUS_ICONS_MAP: Record<string, string> = { open: 'folder-open', in_progress: 'progress-clock', resolved: 'check-circle', closed: 'lock' };

  const casesKanbanColumns = useMemo<KanbanColumn<Case>[]>(() => {
    return CASE_STATUSES.map((status) => {
      const filtered = cases.filter((c) => (c.status || '').toLowerCase().replace(/\s+/g, '_') === status);
      return {
        id: status,
        title: t(`cases.${status}`, status),
        color: getStatusColor(status),
        icon: STATUS_ICONS_MAP[status],
        items: filtered,
      };
    });
  }, [cases, t]);

  const handleCasesKanbanMove = useCallback((item: Case, _from: string, toColumnId: string) => {
    handleStatusChange(item, toColumnId);
  }, [handleStatusChange]);

  const handleTakeOwnership = useCallback(async (caseItem: Case) => {
    if (!user?.organization) return;
    const userId = user.uID || user.userId || '';
    const userName = user.fullname || '';
    const patch = { assignedTo: userId, assignedToName: userName, ownerId: userId, ownerName: userName };
    setCases((prev) => prev.map((c) => c.id === caseItem.id ? { ...c, ...patch } as Case : c));
    try {
      await casesApi.update(user.organization, caseItem.id, { assignedTo: userId, assignedToName: userName }, userName, userId);
    } catch {
      setCases((prev) => prev.map((c) => c.id === caseItem.id ? caseItem : c));
    }
  }, [user]);

  // ── Labels ───────────────────────────────────────────────────────────────────
  const statusLabel = useCallback(
    (st: string) => t(`cases.status_${st}`, { defaultValue: st.charAt(0).toUpperCase() + st.slice(1).replace(/_/g, ' ') }),
    [t],
  );
  const normStatus = (c: Case) => (c.status || '').toLowerCase().replace(/\s+/g, '_');

  // ── Bulk actions ─────────────────────────────────────────────────────────────
  // The stage list is the same one the detail screen offers.
  const BULK_STATUSES = ['open', 'pending', 'escalated', 'on_hold', 'in_progress', 'resolved', 'closed'] as const;

  // Applies `data` to every selected case (4 requests at a time) with an optimistic local `patch`
  // that is rolled back per failed case. Shows a summary and clears the selection.
  const runBulk = useCallback(
    async (opts: { patch: Partial<Case>; data: Partial<Case>; doneText: (n: number) => string }) => {
      if (!user?.organization) return;
      const organization = user.organization;
      const userId = user.uID || user.userId || '';
      const idSet = new Set(sel.ids);
      const targets = cases.filter((c) => idSet.has(c.id));
      if (targets.length === 0) { clearSelection(); return; }
      setBulkBusy(true);
      const originals = new Map(targets.map((c) => [c.id, c]));
      setCases((prev) => prev.map((c) => (idSet.has(c.id) ? ({ ...c, ...opts.patch } as Case) : c)));
      const failedIds = new Set<string>();
      let ok = 0;
      const queue = [...targets];
      const worker = async () => {
        while (queue.length > 0) {
          const c = queue.shift()!;
          try {
            const res = await casesApi.update(organization, c.id, opts.data, user.fullname, userId);
            if (res && res.Success === false) throw new Error('update failed');
            ok++;
          } catch {
            failedIds.add(c.id);
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(4, targets.length) }, worker));
      if (failedIds.size > 0) {
        setCases((prev) => prev.map((c) => (failedIds.has(c.id) ? originals.get(c.id) ?? c : c)));
      }
      setBulkBusy(false);
      clearSelection();
      if (failedIds.size > 0) {
        Alert.alert(opts.doneText(ok), tr(`${failedIds.size} פניות נכשלו`, `${failedIds.size} cases failed`));
      } else {
        setSnackbar(opts.doneText(ok));
      }
    },
    [user, cases, sel.ids, clearSelection, tr],
  );

  const bulkSetStatus = useCallback(
    (status: string) => {
      setBulkModal(null);
      const resolved = status === 'resolved' ? { resolvedAt: new Date().toISOString() } : {};
      runBulk({
        patch: { status, stageName: statusLabel(status), ...resolved },
        data: { status, ...resolved },
        doneText: (n) => tr(`עודכנו ${n} פניות`, `${n} cases updated`),
      });
    },
    [runBulk, statusLabel, tr],
  );

  const bulkClose = useCallback(() => {
    const n = sel.count;
    Alert.alert(
      tr('סגירת פניות', 'Close cases'),
      tr(`לסגור ${n} פניות?`, `Close ${n} cases?`),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: tr('סגור', 'Close'), style: 'destructive', onPress: () => bulkSetStatus('closed') },
      ],
    );
  }, [sel.count, tr, t, bulkSetStatus]);

  const bulkSetPriority = useCallback(
    (priority: Case['priority']) => {
      setBulkModal(null);
      runBulk({
        patch: { priority },
        data: { priority },
        doneText: (n) => tr(`עודכנו ${n} פניות`, `${n} cases updated`),
      });
    },
    [runBulk, tr],
  );

  const bulkTakeOwnership = useCallback(() => {
    if (!user) return;
    const userId = user.uID || user.userId || '';
    const userName = user.fullname || '';
    runBulk({
      patch: { assignedTo: userId, assignedToName: userName, ownerId: userId, ownerName: userName },
      data: { assignedTo: userId, assignedToName: userName },
      doneText: (n) => tr(`עודכנו ${n} פניות`, `${n} cases updated`),
    });
  }, [user, runBulk, tr]);

  const bulkActions = useMemo<BulkAction[]>(() => [
    { key: 'stage', icon: 'swap-horizontal', label: tr('שלב', 'Stage'), onPress: () => setBulkModal('stage') },
    { key: 'close', icon: 'lock-outline', label: tr('סגור', 'Close'), onPress: bulkClose, color: '#757575' },
    { key: 'owner', icon: 'account-arrow-left', label: tr('בעלות', 'Owner'), onPress: bulkTakeOwnership },
    { key: 'priority', icon: 'flag-outline', label: tr('עדיפות', 'Priority'), onPress: () => setBulkModal('priority') },
  ], [tr, bulkClose, bulkTakeOwnership]);

  // ── Row ──────────────────────────────────────────────────────────────────────
  const renderCaseCard = useCallback(
    ({ item }: { item: Case }) => {
      const anyItem = item as any;
      const sKey = normStatus(item);
      const sColor = getStatusColor(item.status || '');
      const pillText = item.stageName || statusLabel(sKey);
      const pColor = PRIORITY_COLORS[item.priority];
      const myId = user?.uID || user?.userId;
      const isMyCase = !!myId && (anyItem.ownerId || anyItem.assignedToId || item.assignedTo) === myId;
      const ownerName = anyItem.ownerName || anyItem.assignedToName || '';
      const sub = [item.contactName, item.category].filter(Boolean).join('  ·  ');
      const ts = parseTs(anyItem.modifiedOn || anyItem.updatedAt) || parseTs(anyItem.createdOn || anyItem.createdAt);
      const activity = ts ? formatRelativeTime(new Date(ts).toISOString(), lang) : '';
      const lvl = caseSlaLevel(item);
      const slaColor = lvl === 'breach' ? '#ef4444' : '#f59e0b';
      const taskBadge = taskFilterSets.overdue.has(item.id)
        ? { label: t('tasks.overdue', 'באיחור'), color: '#ef4444' }
        : taskFilterSets.today.has(item.id)
          ? { label: t('tasks.today', 'היום'), color: '#f59e0b' }
          : taskFilterSets.withTasks.has(item.id)
            ? { label: t('tasks.taskShort', 'משימה'), color: '#3b82f6' }
            : null;
      const selecting = sel.active;
      const checked = selecting && sel.isSelected(item.id);
      return (
        <Pressable
          onPress={() => (selecting ? sel.toggle(item.id) : openCase(item))}
          onLongPress={() => {
            if (selecting) return;
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
            sel.start(item.id);
          }}
          delayLongPress={400}
          android_ripple={{ color: theme.colors.surfaceVariant }}
          style={({ pressed }) => [
            styles.caseRow,
            {
              backgroundColor: checked
                ? withAlpha(theme.colors.primary, 0.12)
                : pressed
                  ? theme.colors.surfaceVariant
                  : theme.colors.surface,
              flexDirection,
            },
          ]}
        >
          <View style={[styles.stripe, { backgroundColor: sColor }]} />

          {selecting ? (
            <View style={{ alignSelf: 'center' }}>
              <SelectCheck checked={checked} />
            </View>
          ) : null}

          <View style={styles.caseBody}>
            {/* Row 1: title + SLA + last activity */}
            <View style={[styles.caseTop, { flexDirection }]}>
              <Text
                variant="titleSmall"
                numberOfLines={1}
                style={{ color: theme.colors.onSurface, fontWeight: '700', flex: 1, textAlign }}
              >
                {item.subject || item.title}
              </Text>
              {lvl ? (
                <MaterialCommunityIcons name="clock-alert-outline" size={16} color={slaColor} />
              ) : null}
              {activity ? (
                <Text style={{ fontSize: 11, color: theme.colors.onSurfaceVariant }} numberOfLines={1}>
                  {activity}
                </Text>
              ) : null}
            </View>

            {/* Row 2: contact · category */}
            <Text
              variant="bodySmall"
              numberOfLines={1}
              style={{ color: theme.colors.onSurfaceVariant, textAlign }}
            >
              {sub || ' '}
            </Text>

            {/* Row 3: status pill, priority, tasks, take-ownership, owner */}
            <View style={[styles.caseBottom, { flexDirection }]}>
              <View style={[styles.stagePill, { backgroundColor: withAlpha(sColor, 0.16) }]}>
                <Text style={{ fontSize: 11, fontWeight: '600', color: sColor }} numberOfLines={1}>
                  {pillText}
                </Text>
              </View>
              {pColor ? <MaterialCommunityIcons name="flag" size={14} color={pColor} /> : null}
              {lvl ? (
                <Text style={{ fontSize: 10, fontWeight: '700', color: slaColor }} numberOfLines={1}>
                  {lvl === 'breach' ? t('cases.slaBreach', 'חריגת SLA') : t('cases.slaDueSoon', 'קרוב לחריגה')}
                </Text>
              ) : null}
              {taskBadge ? (
                <View style={[styles.signalChip, { backgroundColor: withAlpha(taskBadge.color, 0.14) }]}>
                  <MaterialCommunityIcons name="clock-outline" size={12} color={taskBadge.color} />
                  <Text style={{ fontSize: 10, fontWeight: '700', color: taskBadge.color }}>{taskBadge.label}</Text>
                </View>
              ) : null}
              <View style={{ flex: 1 }} />
              {!isMyCase && !selecting ? (
                <Pressable
                  onPress={() => handleTakeOwnership(item)}
                  hitSlop={6}
                  style={[styles.takeBtn, { flexDirection }]}
                >
                  <MaterialCommunityIcons name="account-arrow-left" size={14} color={theme.colors.tertiary || '#FF9800'} />
                  <Text style={{ fontSize: 11, color: theme.colors.tertiary || '#FF9800', fontWeight: '600' }}>
                    {t('leads.takeOwnership', 'קח בעלות')}
                  </Text>
                </Pressable>
              ) : null}
              <OwnerAvatar name={ownerName} theme={theme} />
            </View>
          </View>
        </Pressable>
      );
    },
    [theme, flexDirection, textAlign, openCase, user, handleTakeOwnership, t, lang, statusLabel, taskFilterSets,
      sel.active, sel.isSelected, sel.toggle, sel.start],
  );

  const renderEmpty = useCallback(() => {
    if (loading) return null;
    const filtering = statusFilter !== 'all' || !!debouncedSearch.trim() || viewActive;
    return (
      <EmptyState
        icon="briefcase-outline"
        title={filtering ? t('common.noResults') : t('cases.noCases')}
        actionLabel={filtering ? undefined : t('cases.addCase')}
        onAction={filtering ? undefined : () => router.push('/more/cases/new')}
      />
    );
  }, [loading, t, statusFilter, debouncedSearch, viewActive, router]);

  const loadAllPages = useCallback(() => {
    const allPages = Math.ceil(totalCount / PAGE_SIZE);
    for (let p = page + 1; p <= allPages; p++) fetchPage(p, false);
  }, [totalCount, page, fetchPage]);

  const advancedFilterCount =
    (filterCategory.trim() ? 1 : 0) + (filterAssignee.trim() ? 1 : 0) + (filterPriority ? 1 : 0) + (filterDateRange ? 1 : 0);
  const hasAnyFilter = viewActive || statusFilter !== 'all' || advancedFilterCount > 0 || !!searchQuery.trim();
  const ownViews = savedViews.filter((v) => {
    const vis = v.Visibility || 'personal';
    if (vis === 'shared') return true;
    return (v.UserId || '') === (user?.uID || user?.userId || '');
  });
  const slaCount = useMemo(() => cases.filter(isCaseSlaBreached).length, [cases]);

  const sortOptions: { key: SortKey; label: string; icon: string }[] = [
    { key: 'createdOn', label: t('leads.sortCreated', 'נוצר ב'), icon: 'calendar-plus' },
    { key: 'modifiedOn', label: t('leads.sortUpdated', 'עודכן ב'), icon: 'update' },
    { key: 'subject', label: t('leads.name', 'שם'), icon: 'sort-alphabetical-ascending' },
    { key: 'priority', label: t('tasks.priority', 'עדיפות'), icon: 'flag-outline' },
    { key: 'status', label: t('cases.status', 'סטטוס'), icon: 'view-column' },
  ];
  const activeSortLabel = sortOptions.find((o) => o.key === sortKey)?.label ?? '';

  const taskChips: { type: TaskQuickFilter; icon: string; label: string; color: string }[] = [
    { type: 'today', icon: 'calendar-today', label: t('leads.tasksToday', 'משימות להיום'), color: '#f59e0b' },
    { type: 'upcoming', icon: 'clock-outline', label: t('leads.tasksUpcoming', 'משימות קרובות'), color: '#3b82f6' },
    { type: 'overdue', icon: 'alert-circle-outline', label: t('leads.tasksOverdue', 'משימות באיחור'), color: '#ef4444' },
    { type: 'withTasks', icon: 'clipboard-clock-outline', label: t('cases.casesWithTasks', 'פניות עם משימות'), color: '#2e6155' },
  ];

  if (loading && cases.length === 0) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
      {sel.active ? (
        <SelectionHeader
          count={sel.count}
          total={filteredCases.length}
          onClose={clearSelection}
          onSelectAll={() => sel.selectAll(filteredCases.map((c) => c.id))}
          label={tr('נבחרו', 'selected')}
        />
      ) : (
        /* Header: back · title · List|Board switch · filter · overflow */
        <View
          style={[
            styles.header,
            { backgroundColor: theme.custom.headerBackground, paddingTop: insets.top + 4, flexDirection },
          ]}
        >
          <IconButton
            icon={isRTL ? 'arrow-right' : 'arrow-left'}
            iconColor={theme.custom.headerText}
            size={24}
            onPress={() => router.back()}
            style={{ margin: 0 }}
          />
          <Text style={[styles.headerTitle, { flex: 1, textAlign }]} numberOfLines={1}>{t('cases.title')}</Text>

          <View style={[styles.segment, { flexDirection }]}>
            {([
              { key: 'list' as const, icon: 'format-list-bulleted' },
              { key: 'kanban' as const, icon: 'view-column-outline' },
            ]).map((seg) => {
              const active = viewMode === seg.key;
              return (
                <Pressable
                  key={seg.key}
                  onPress={() => setViewMode(seg.key)}
                  style={[styles.segmentItem, active && styles.segmentItemActive]}
                >
                  <MaterialCommunityIcons name={seg.icon as any} size={18} color={active ? theme.custom.headerBackground : '#FFF'} />
                </Pressable>
              );
            })}
          </View>

          <View style={[styles.headerActions, { flexDirection }]}>
            <Pressable
              onPress={() => setAdvancedFilterVisible(true)}
              hitSlop={8}
              style={({ pressed }) => [styles.headerBtn, pressed && { opacity: 0.7 }]}
            >
              <MaterialCommunityIcons name="filter-variant" size={24} color={theme.custom.headerText} />
              {advancedFilterCount > 0 ? (
                <View style={styles.filterBadge}>
                  <Text style={styles.filterBadgeText}>{advancedFilterCount}</Text>
                </View>
              ) : null}
            </Pressable>
            <Menu
              visible={moreMenuVisible}
              onDismiss={() => setMoreMenuVisible(false)}
              anchor={
                <Pressable
                  onPress={() => setMoreMenuVisible(true)}
                  hitSlop={8}
                  style={({ pressed }) => [styles.headerBtn, pressed && { opacity: 0.7 }]}
                >
                  <MaterialCommunityIcons name="dots-vertical" size={24} color={theme.custom.headerText} />
                </Pressable>
              }
            >
              <Menu.Item
                leadingIcon="bookmark-plus-outline"
                title={tr('שמור תצוגה נוכחית', 'Save current view')}
                onPress={() => { setMoreMenuVisible(false); setShowSaveViewModal(true); }}
              />
              {hasAnyFilter ? (
                <Menu.Item
                  leadingIcon="filter-remove-outline"
                  title={tr('נקה את כל הסינונים', 'Clear all filters')}
                  onPress={() => { setMoreMenuVisible(false); clearAllFilters(); }}
                />
              ) : null}
              {hasMore ? (
                <Menu.Item
                  leadingIcon="download"
                  title={t('common.loadAll', 'טען הכול')}
                  onPress={() => { setMoreMenuVisible(false); loadAllPages(); }}
                />
              ) : null}
              <Menu.Item
                leadingIcon="refresh"
                title={tr('רענן', 'Refresh')}
                onPress={() => { setMoreMenuVisible(false); onRefresh(); }}
              />
            </Menu>
          </View>
        </View>
      )}

      {/* Search — always visible, one field */}
      <View style={[styles.searchWrap, { backgroundColor: theme.custom.headerBackground }]}>
        <Searchbar
          placeholder={t('cases.searchPlaceholder')}
          value={searchQuery}
          onChangeText={setSearchQuery}
          returnKeyType="search"
          style={[styles.searchbar, { backgroundColor: theme.colors.surface }]}
          inputStyle={{ fontSize: 14, textAlign: isRTL ? 'right' : 'left', minHeight: 0 }}
          iconColor={theme.colors.onSurfaceVariant}
        />
      </View>

      {/* Views: All · SLA breaches · saved views · save current */}
      <View style={[styles.viewsRow, { backgroundColor: theme.colors.surface, borderBottomColor: theme.colors.outline }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.viewsScroll, { flexDirection }]}>
          <Pressable
            onPress={clearAllFilters}
            style={[styles.viewTab, activeViewId === '__all' && !slaOnly && { borderBottomColor: theme.colors.primary, borderBottomWidth: 2 }]}
          >
            <Text style={[styles.viewTabText, { color: activeViewId === '__all' && !slaOnly ? theme.colors.primary : theme.colors.onSurfaceVariant }]}>
              {t('common.all')}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => {
              if (slaOnly) { setSlaOnly(false); setActiveViewId('__all'); }
              else { setSlaOnly(true); setActiveViewId('__sla'); setTaskQuickFilter(null); setFilterMine(false); fetchAllCases(); }
            }}
            style={[styles.viewTab, slaOnly && { borderBottomColor: '#ef4444', borderBottomWidth: 2 }]}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Text style={[styles.viewTabText, { color: slaOnly ? '#ef4444' : theme.colors.onSurfaceVariant }]}>
                {t('cases.slaBreaches', 'חריגות SLA')}
              </Text>
              {slaCount > 0 && (
                <View style={{ backgroundColor: '#ef4444', borderRadius: 9, minWidth: 18, paddingHorizontal: 4, paddingVertical: 1, alignItems: 'center' }}>
                  <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>{slaCount}</Text>
                </View>
              )}
            </View>
          </Pressable>
          {ownViews.map((view) => (
            <Pressable
              key={view.id}
              onPress={() => { setSlaOnly(false); setTaskQuickFilter(null); loadSavedView(view); }}
              onLongPress={() => {
                Alert.alert(
                  view.Name,
                  t('sidebar.deleteViewConfirm', 'Delete this view?'),
                  [
                    { text: t('common.cancel'), style: 'cancel' },
                    { text: t('common.delete', 'Delete'), style: 'destructive', onPress: () => deleteSavedView(view.id) },
                  ],
                );
              }}
              style={[styles.viewTab, activeViewId === view.id && { borderBottomColor: theme.colors.primary, borderBottomWidth: 2 }]}
            >
              <Text style={[styles.viewTabText, { color: activeViewId === view.id ? theme.colors.primary : theme.colors.onSurfaceVariant }]} numberOfLines={1}>
                {(view.Visibility === 'shared' ? '👥 ' : '') + view.Name}
              </Text>
            </Pressable>
          ))}
          <Pressable
            onPress={() => setShowSaveViewModal(true)}
            style={[styles.viewTab, { flexDirection: 'row', alignItems: 'center', gap: 4 }]}
          >
            <MaterialCommunityIcons name="bookmark-plus-outline" size={18} color={theme.colors.primary} />
            {hasAnyFilter ? (
              <Text style={[styles.viewTabText, { color: theme.colors.primary }]}>{tr('שמור תצוגה', 'Save view')}</Text>
            ) : null}
          </Pressable>
        </ScrollView>
      </View>

      {/* One-tap quick filters: mine · status · tasks (combine with the view and each other) */}
      <View style={{ backgroundColor: theme.colors.surface, borderBottomColor: theme.colors.outline, borderBottomWidth: StyleSheet.hairlineWidth }}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={[styles.quickRow, { flexDirection }]}
        >
          {hasAnyFilter ? (
            <QuickChip
              theme={theme}
              icon="close-circle"
              label={`${tr('נקה', 'Clear')}${advancedFilterCount > 0 ? ` (${advancedFilterCount})` : ''}`}
              color="#ef4444"
              active
              onPress={clearAllFilters}
            />
          ) : null}
          <QuickChip
            theme={theme}
            icon="account-check-outline"
            label={tr('שלי', 'Mine')}
            color={theme.colors.primary}
            active={filterMine}
            onPress={() => {
              setFilterMine((v) => !v);
              setActiveViewId('__all');
            }}
          />
          {CASE_STATUSES.map((st) => (
            <QuickChip
              key={st}
              theme={theme}
              icon={STATUS_ICONS_MAP[st]}
              label={statusLabel(st)}
              color={getStatusColor(st)}
              active={statusFilter === st}
              onPress={() => setStatusFilter(statusFilter === st ? 'all' : st)}
            />
          ))}
          <View style={[styles.quickDivider, { backgroundColor: theme.colors.outline }]} />
          {taskChips.map(({ type, icon, label, color }) => (
            <QuickChip
              key={type}
              theme={theme}
              icon={icon}
              label={label}
              color={color}
              active={taskQuickFilter === type}
              count={taskFilterSets[type].size}
              disabled={taskFilterLoading}
              onPress={() => applyTaskFilter(type)}
            />
          ))}
        </ScrollView>
      </View>

      {/* Summary line: count  +  sort (list) */}
      <View style={[styles.summaryRow, { flexDirection, backgroundColor: theme.colors.surface, borderBottomColor: theme.colors.outline }]}>
        <Text style={{ fontSize: 12, color: theme.colors.onSurfaceVariant, flexShrink: 1 }} numberOfLines={1}>
          <Text style={{ fontWeight: '700', color: theme.colors.onSurface }}>
            {hasMore && !taskQuickFilter && !slaOnly ? `${cases.length} / ${totalCount}` : filteredCases.length}
          </Text>
          {` ${tr('פניות', 'cases')}`}
        </Text>
        <View style={{ flex: 1 }} />
        {viewMode === 'list' ? (
          <Menu
            visible={sortMenuVisible}
            onDismiss={() => setSortMenuVisible(false)}
            anchor={
              <Pressable onPress={() => setSortMenuVisible(true)} hitSlop={6} style={[styles.sortBtn, { flexDirection }]}>
                <MaterialCommunityIcons name="sort" size={16} color={theme.colors.primary} />
                <Text style={{ fontSize: 12, color: theme.colors.primary, fontWeight: '600' }}>{activeSortLabel}</Text>
                <MaterialCommunityIcons name={sortDir === 'asc' ? 'arrow-up' : 'arrow-down'} size={12} color={theme.colors.primary} />
              </Pressable>
            }
          >
            {sortOptions.map((opt) => (
              <Menu.Item
                key={opt.key}
                leadingIcon={opt.icon}
                trailingIcon={sortKey === opt.key ? (sortDir === 'asc' ? 'arrow-up' : 'arrow-down') : undefined}
                title={opt.label}
                titleStyle={sortKey === opt.key ? { color: theme.colors.primary, fontWeight: '700' } : undefined}
                onPress={() => {
                  setSortMenuVisible(false);
                  if (sortKey === opt.key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
                  else { setSortKey(opt.key); setSortDir(['createdOn', 'modifiedOn', 'priority'].includes(opt.key) ? 'desc' : 'asc'); }
                }}
              />
            ))}
          </Menu>
        ) : null}
      </View>

      {/* Error banner */}
      {error ? (
        <Pressable
          onPress={fetchCases}
          style={[styles.errorBanner, { backgroundColor: theme.colors.errorContainer }]}
        >
          <MaterialCommunityIcons name="alert-circle" size={18} color={theme.colors.error} />
          <Text
            variant="bodySmall"
            style={[styles.errorText, { color: theme.colors.error }]}
            numberOfLines={1}
          >
            {error}
          </Text>
          <Text variant="labelSmall" style={{ color: theme.colors.error, fontWeight: '600' }}>
            {t('common.retry')}
          </Text>
        </Pressable>
      ) : null}

      {/* Case list or Kanban */}
      {viewMode === 'kanban' ? (
        <KanbanBoard
          columns={casesKanbanColumns}
          keyExtractor={(item) => item.id}
          onMoveItem={handleCasesKanbanMove}
          emptyLabel={t('cases.noCases', 'אין פניות')}
          renderCard={(item) => {
            const priorityColor = PRIORITY_COLORS[item.priority] || PRIORITY_COLORS.medium;
            return (
              <Pressable
                onPress={() => openCase(item)}
                style={({ pressed }) => ({
                  backgroundColor: pressed ? theme.colors.surfaceVariant : theme.colors.surface,
                  borderRadius: 10,
                  padding: 12,
                  borderStartWidth: 3,
                  borderStartColor: priorityColor,
                })}
              >
                <Text variant="titleSmall" numberOfLines={1} style={{ color: theme.colors.onSurface, fontWeight: '600' }}>
                  {item.title || item.subject}
                </Text>
                {item.contactName ? (
                  <View style={{ flexDirection, alignItems: 'center', gap: 4, marginTop: 4 }}>
                    <MaterialCommunityIcons name="account-outline" size={13} color={theme.colors.onSurfaceVariant} />
                    <Text variant="labelSmall" numberOfLines={1} style={{ color: theme.colors.onSurfaceVariant, flex: 1 }}>
                      {item.contactName}
                    </Text>
                  </View>
                ) : null}
                {item.category ? (
                  <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: 2 }}>
                    {item.category}
                  </Text>
                ) : null}
              </Pressable>
            );
          }}
        />
      ) : (
        <FlashList
          data={filteredCases}
          renderItem={renderCaseCard}
          keyExtractor={(item, idx) => item.id || `case_${idx}`}
          extraData={sel.selected}
          ItemSeparatorComponent={CaseDivider}
          ListEmptyComponent={renderEmpty}
          onEndReached={onEndReached}
          onEndReachedThreshold={0.3}
          ListFooterComponent={
            loadingMore ? (
              <ActivityIndicator size="small" color={theme.colors.primary} style={{ marginVertical: 16 }} />
            ) : hasMore ? (
              <View style={{ alignItems: 'center', paddingVertical: 12, gap: 8 }}>
                <Text variant="labelSmall" style={{ textAlign: 'center', color: theme.colors.onSurfaceVariant }}>
                  {cases.length} / {totalCount}
                </Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Pressable onPress={() => fetchPage(page + 1, false)} style={{ paddingHorizontal: 16, paddingVertical: 6, borderRadius: 16, backgroundColor: theme.colors.primaryContainer }}>
                    <Text style={{ fontSize: 12, fontWeight: '600', color: theme.colors.onPrimaryContainer }}>{t('common.loadMore', 'טען עוד')}</Text>
                  </Pressable>
                  <Pressable onPress={loadAllPages} style={{ paddingHorizontal: 16, paddingVertical: 6, borderRadius: 16, backgroundColor: theme.colors.surfaceVariant }}>
                    <Text style={{ fontSize: 12, fontWeight: '600', color: theme.colors.onSurfaceVariant }}>{t('common.loadAll', 'טען הכול')}</Text>
                  </Pressable>
                </View>
              </View>
            ) : null
          }
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={[theme.colors.primary]}
              tintColor={theme.colors.primary}
            />
          }
          contentContainerStyle={sel.active ? { ...styles.listContent, paddingBottom: 120 + insets.bottom } : styles.listContent}
        />
      )}

      {sel.active ? (
        <BulkActionBar actions={bulkActions} busy={bulkBusy} />
      ) : (
        <FAB
          icon="plus"
          onPress={() => router.push('/more/cases/new')}
          style={[
            styles.fab,
            { backgroundColor: theme.colors.primary, bottom: insets.bottom + 16, left: isRTL ? 16 : undefined, right: isRTL ? undefined : 16 },
          ]}
          color="#FFFFFF"
          label={t('cases.addCase')}
        />
      )}

      <Portal>
        {/* Bulk: change stage / priority for the selected cases */}
        <Modal
          visible={bulkModal !== null}
          onDismiss={() => setBulkModal(null)}
          contentContainerStyle={[styles.statusPickerModal, { backgroundColor: theme.colors.surface }]}
        >
          <Text variant="titleMedium" style={{ color: theme.colors.onSurface, fontWeight: '700', marginBottom: 4, textAlign }}>
            {bulkModal === 'priority' ? tr('שינוי עדיפות', 'Change priority') : tr('שינוי שלב', 'Change stage')}
          </Text>
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 16, textAlign }}>
            {tr(`${sel.count} פניות נבחרו`, `${sel.count} cases selected`)}
          </Text>
          {bulkModal === 'stage'
            ? BULK_STATUSES.map((status) => {
                const color = getStatusColor(status);
                return (
                  <Pressable
                    key={status}
                    onPress={() => bulkSetStatus(status)}
                    style={({ pressed }) => [
                      styles.statusPickerOption,
                      { flexDirection, backgroundColor: pressed ? theme.colors.surfaceVariant : 'transparent' },
                    ]}
                  >
                    <View style={[styles.statusDot, { backgroundColor: color }]} />
                    <Text variant="bodyMedium" style={{ flex: 1, color: theme.colors.onSurface, textAlign }}>
                      {statusLabel(status)}
                    </Text>
                  </Pressable>
                );
              })
            : null}
          {bulkModal === 'priority'
            ? PRIORITIES.map((p) => {
                const color = PRIORITY_COLORS[p];
                return (
                  <Pressable
                    key={p}
                    onPress={() => bulkSetPriority(p)}
                    style={({ pressed }) => [
                      styles.statusPickerOption,
                      { flexDirection, backgroundColor: pressed ? theme.colors.surfaceVariant : 'transparent' },
                    ]}
                  >
                    <MaterialCommunityIcons name="flag" size={18} color={color} />
                    <Text variant="bodyMedium" style={{ flex: 1, color: theme.colors.onSurface, textAlign }}>
                      {t(`tasks.${p}`, p)}
                    </Text>
                  </Pressable>
                );
              })
            : null}
          <Button
            mode="text"
            onPress={() => setBulkModal(null)}
            style={{ marginTop: 8 }}
            textColor={theme.colors.onSurfaceVariant}
          >
            {t('common.cancel')}
          </Button>
        </Modal>

        <Modal
          visible={advancedFilterVisible}
          onDismiss={() => setAdvancedFilterVisible(false)}
          contentContainerStyle={[
            styles.advancedFilterModal,
            { backgroundColor: theme.colors.surface },
          ]}
        >
          <Text variant="titleMedium" style={{ color: theme.colors.onSurface, fontWeight: '700', marginBottom: 16 }}>
            {t('cases.advancedFilter')}
          </Text>
          <ScrollView showsVerticalScrollIndicator={false} style={{ flexShrink: 1 }}>
            <TextInput
              label={t('cases.category')}
              value={filterCategory}
              onChangeText={setFilterCategory}
              mode="outlined"
              style={[styles.formInput, { textAlign }]}
              outlineColor={theme.colors.outline}
              activeOutlineColor={theme.colors.primary}
              right={<TextInput.Icon icon="tag" />}
            />
            <TextInput
              label={t('cases.assignedTo')}
              value={filterAssignee}
              onChangeText={setFilterAssignee}
              mode="outlined"
              style={[styles.formInput, { textAlign }]}
              outlineColor={theme.colors.outline}
              activeOutlineColor={theme.colors.primary}
              right={<TextInput.Icon icon="account-check" />}
            />

            <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 6, marginTop: 8 }}>
              {t('tasks.priority', 'Priority')}
            </Text>
            <View style={[styles.chipRow, { flexDirection }]}>
              {PRIORITIES.map((p) => (
                <Chip
                  key={p}
                  selected={filterPriority === p}
                  onPress={() => setFilterPriority(filterPriority === p ? '' : p)}
                  compact
                  style={[
                    styles.filterChip,
                    filterPriority === p
                      ? { backgroundColor: `${PRIORITY_COLORS[p]}20`, borderColor: PRIORITY_COLORS[p], borderWidth: 1 }
                      : { backgroundColor: theme.colors.surfaceVariant },
                  ]}
                  textStyle={[
                    styles.filterChipText,
                    filterPriority === p && { color: PRIORITY_COLORS[p], fontWeight: '600' },
                  ]}
                >
                  {t(`tasks.${p}`, p)}
                </Chip>
              ))}
            </View>

            <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 6, marginTop: 12 }}>
              {t('leads.dateRange', 'Date Range')}
            </Text>
            <View style={[styles.chipRow, { flexWrap: 'wrap', flexDirection }]}>
              {DATE_RANGE_PRESETS.map((dr) => (
                <Chip
                  key={dr}
                  selected={filterDateRange === dr}
                  onPress={() => setFilterDateRange(filterDateRange === dr ? '' : dr)}
                  compact
                  style={[
                    styles.filterChip,
                    filterDateRange === dr
                      ? { backgroundColor: theme.colors.primaryContainer, borderColor: theme.colors.primary, borderWidth: 1 }
                      : { backgroundColor: theme.colors.surfaceVariant },
                  ]}
                  textStyle={[
                    styles.filterChipText,
                    filterDateRange === dr && { color: theme.colors.primary, fontWeight: '600' },
                  ]}
                >
                  {dr}
                </Chip>
              ))}
            </View>
          </ScrollView>

          <View style={[styles.modalActions, { flexDirection }]}>
            <Button
              mode="outlined"
              onPress={() => {
                setFilterCategory('');
                setFilterAssignee('');
                setFilterPriority('');
                setFilterDateRange('');
                setAdvancedFilterVisible(false);
              }}
              style={styles.modalButton}
              textColor={theme.colors.onSurface}
            >
              {t('common.clear')}
            </Button>
            <Button
              mode="contained"
              onPress={() => setAdvancedFilterVisible(false)}
              style={[styles.modalButton, { backgroundColor: theme.colors.primary }]}
              textColor="#FFFFFF"
            >
              {t('common.apply')}
            </Button>
          </View>
        </Modal>

        {/* Save View Modal */}
        <Modal
          visible={showSaveViewModal}
          onDismiss={() => { setShowSaveViewModal(false); setNewViewName(''); }}
          contentContainerStyle={[styles.statusPickerModal, { backgroundColor: theme.colors.surface }]}
        >
          <Text variant="titleMedium" style={{ color: theme.colors.onSurface, marginBottom: 16 }}>
            {t('sidebar.saveCurrentView', 'שמור תצוגה נוכחית')}
          </Text>
          <TextInput
            label={t('sidebar.viewName', 'שם התצוגה')}
            value={newViewName}
            onChangeText={setNewViewName}
            mode="outlined"
            style={{ marginBottom: 12 }}
          />
          {userIsAdmin && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              <Chip
                selected={saveViewVisibility === 'personal'}
                onPress={() => setSaveViewVisibility('personal')}
                compact
                style={{ backgroundColor: saveViewVisibility === 'personal' ? theme.colors.primaryContainer : theme.colors.surfaceVariant }}
              >
                {t('sidebar.onlyMe', 'רק לי')}
              </Chip>
              <Chip
                selected={saveViewVisibility === 'shared'}
                onPress={() => setSaveViewVisibility('shared')}
                compact
                style={{ backgroundColor: saveViewVisibility === 'shared' ? theme.colors.primaryContainer : theme.colors.surfaceVariant }}
              >
                {t('sidebar.everyone', 'לכולם')}
              </Chip>
            </View>
          )}
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}>
            <Button mode="outlined" onPress={() => { setShowSaveViewModal(false); setNewViewName(''); }}>
              {t('common.cancel')}
            </Button>
            <Button mode="contained" disabled={!newViewName.trim()} onPress={saveCurrentView}>
              {t('common.save', 'שמור')}
            </Button>
          </View>
        </Modal>
      </Portal>

      <Snackbar
        visible={!!snackbar}
        onDismiss={() => setSnackbar('')}
        duration={2500}
        style={{ marginBottom: 70 }}
      >
        {snackbar}
      </Snackbar>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    alignItems: 'center',
    paddingHorizontal: 4,
    paddingBottom: 4,
    gap: 6,
  },
  headerTitle: { fontSize: 22, fontWeight: '700', color: '#FFFFFF' },
  headerActions: { alignItems: 'center', gap: 4, paddingEnd: 10 },
  headerBtn: { padding: 4 },
  filterBadge: {
    position: 'absolute',
    top: -2,
    end: -2,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 3,
    backgroundColor: '#ef4444',
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterBadgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  segment: {
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: 16,
    padding: 2,
    gap: 2,
  },
  segmentItem: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
  },
  segmentItemActive: { backgroundColor: '#FFF' },
  searchWrap: {
    paddingHorizontal: 14,
    justifyContent: 'center',
    paddingTop: 4,
    paddingBottom: 10,
  },
  searchbar: { height: 40, borderRadius: 20, elevation: 0 },
  viewsRow: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingTop: 4,
  },
  viewTab: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginBottom: -1,
  },
  viewTabText: {
    fontSize: 13,
    fontWeight: '600',
    maxWidth: 100,
  },
  viewsScroll: {
    paddingHorizontal: 14,
    gap: 8,
    alignItems: 'center',
  },
  quickRow: { paddingHorizontal: 14, paddingVertical: 8, gap: 6, alignItems: 'center' },
  quickChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
  },
  quickDivider: { width: StyleSheet.hairlineWidth, height: 18, marginHorizontal: 2 },
  summaryRow: {
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 6,
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sortBtn: { alignItems: 'center', gap: 4, paddingVertical: 2 },
  listContent: { paddingTop: 4, paddingBottom: 100 },
  caseRow: {
    alignItems: 'stretch',
    paddingTop: 8,
    paddingBottom: 8,
    paddingEnd: 12,
    gap: 10,
    overflow: 'hidden',
  },
  stripe: {
    width: 4,
    borderTopRightRadius: 2,
    borderBottomRightRadius: 2,
  },
  caseBody: { flex: 1, gap: 3 },
  caseTop: { alignItems: 'center', gap: 6 },
  caseBottom: { alignItems: 'center', gap: 6, marginTop: 2 },
  stagePill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, maxWidth: 140 },
  signalChip: { flexDirection: 'row', alignItems: 'center', gap: 2, borderRadius: 8, paddingHorizontal: 5, paddingVertical: 1 },
  takeBtn: { alignItems: 'center', gap: 3 },
  fab: {
    position: 'absolute',
    borderRadius: 16,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
  },
  errorText: { flex: 1, fontSize: 13 },
  chipRow: { flexWrap: 'wrap', gap: 6, marginBottom: 4 },
  filterChip: { height: 32 },
  filterChipText: { fontSize: 13 },
  formInput: {
    marginBottom: 14,
  },
  modalActions: {
    gap: 12,
    justifyContent: 'flex-end',
    marginTop: 8,
  },
  modalButton: {
    minWidth: 100,
    borderRadius: borderRadius.md,
  },
  statusPickerModal: {
    marginHorizontal: 24,
    borderRadius: 16,
    padding: 20,
  },
  advancedFilterModal: {
    marginHorizontal: 20,
    borderRadius: 16,
    padding: 20,
    maxHeight: '80%',
  },
  statusPickerOption: {
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    gap: 12,
    marginBottom: 2,
  },
  statusDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
});
