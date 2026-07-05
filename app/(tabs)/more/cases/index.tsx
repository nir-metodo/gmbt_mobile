import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  Pressable,
  RefreshControl,
  Animated,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import {
  Text,
  Searchbar,
  Chip,
  FAB,
  ActivityIndicator,
  Portal,
  Modal,
  TextInput,
  Button,
  IconButton,
  Divider,
  TouchableRipple,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { KanbanBoard, type KanbanColumn } from '../../../../components/KanbanBoard';
import { useRouter, useFocusEffect } from 'expo-router';
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
import { formatDate, getInitials, withAlpha } from '../../../../utils/formatters';
import { spacing, borderRadius, fontSize } from '../../../../constants/theme';
import type { Case } from '../../../../types';
import { useContactLookup } from '../../../../hooks/useContactLookup';
import ContactLookupField from '../../../../components/ContactLookupField';
import { DynamicFieldsSectionForm, type DynamicSection } from '../../../../components/DynamicFieldsSection';

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

interface SavedView {
  id: string;
  Name: string;
  ViewData: { filters?: any; searchTerm?: string };
  IsPinned?: boolean;
  Visibility?: string;
  UserId?: string;
}

export default function CasesListScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useAppTheme();
  const { isRTL, flexDirection, textAlign } = useRTL();
  const { t } = useTranslation();

  const user = useAuthStore((s) => s.user);
  const userIsAdmin = user?.SecurityRole === 'admin' || user?.SecurityRole === 'Admin';
  const { contactSearch, contactResults, contactSearching, selectedContact, handleContactSearch, handleSelectContact, resetContactLookup } = useContactLookup();

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
  const [searchVisible, setSearchVisible] = useState(false);
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
  const [statusPickerCase, setStatusPickerCase] = useState<Case | null>(null);

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

  const searchAnim = useRef(new Animated.Value(0)).current;

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
        // Keep the full dataset when a task quick-filter is active so returning from a case detail
        // doesn't collapse the pool to page 1 and empty out the filtered list.
        if (taskQuickFilter) fetchAllCases();
        else fetchPage(1, true);
      }
    }, [user?.organization, fetchPage, fetchAllCases, taskQuickFilter])
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
    // Preserve the full dataset when a task quick-filter is active (a page-1 reset would empty it).
    await (taskQuickFilter ? fetchAllCases() : fetchPage(1, true));
    setRefreshing(false);
  }, [fetchPage, fetchAllCases, taskQuickFilter]);

  const toggleSearch = useCallback(() => {
    const willShow = !searchVisible;
    if (willShow) {
      setSearchVisible(true);
      Animated.timing(searchAnim, { toValue: 1, duration: 220, useNativeDriver: false }).start();
    } else {
      Animated.timing(searchAnim, { toValue: 0, duration: 180, useNativeDriver: false }).start(() => {
        setSearchVisible(false);
        setSearchQuery('');
      });
    }
  }, [searchVisible, searchAnim]);

  // Server does the heavy filtering/pagination; here we apply the client-side task
  // quick-filter (when active) and the chosen sort order.
  const PRIORITY_RANK: Record<string, number> = { urgent: 4, high: 3, medium: 2, low: 1 };
  const filteredCases = useMemo(() => {
    let result = [...cases];
    if (taskQuickFilter) {
      const ids = taskFilterSets[taskQuickFilter];
      result = result.filter((c) => ids.has(c.id));
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
  }, [cases, taskQuickFilter, taskFilterSets, sortKey, sortDir]);


  const openCase = useCallback(
    (caseItem: Case) => {
      router.push({ pathname: '/(tabs)/more/cases/[id]', params: { id: caseItem.id } });
    },
    [router],
  );

  const handleStatusChange = useCallback(
    async (caseItem: Case, newStatus: string) => {
      setStatusPickerCase(null);
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

  const searchHeightInterp = searchAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 56],
  });

  const handleTakeOwnership = useCallback(async (caseItem: Case) => {
    if (!user?.organization) return;
    const userId = user.uID || user.userId || '';
    const userName = user.fullname || '';
    setCases((prev) => prev.map((c) => c.id === caseItem.id ? { ...c, assignedTo: userName, assignedToId: userId } as any : c));
    try {
      await casesApi.update(user.organization, caseItem.id, { assignedTo: userName, assignedToId: userId, ownerId: userId, ownerName: userName } as any, userName);
    } catch {
      setCases((prev) => prev.map((c) => c.id === caseItem.id ? { ...c, assignedTo: (caseItem as any).assignedTo, assignedToId: (caseItem as any).assignedToId } : c));
    }
  }, [user]);

  const renderCaseCard = useCallback(
    ({ item }: { item: Case }) => {
      const priorityColor = PRIORITY_COLORS[item.priority] || PRIORITY_COLORS.medium;
      const statusColor = getStatusColor(item.status);
      const isMyCase = ((item as any).ownerId || (item as any).assignedToId) === (user?.uID || user?.userId);

      return (
        <Pressable
          onPress={() => openCase(item)}
          onLongPress={() => setStatusPickerCase(item)}
          delayLongPress={400}
          android_ripple={{ color: theme.colors.surfaceVariant }}
          style={({ pressed }) => [
            styles.caseCard,
            {
              backgroundColor: pressed ? theme.colors.surfaceVariant : theme.custom.cardBackground,
              borderColor: theme.colors.outlineVariant,
              flexDirection,
            },
          ]}
        >
          <View style={[styles.priorityBar, {
            backgroundColor: statusColor,
            borderTopLeftRadius: isRTL ? 0 : borderRadius.lg,
            borderBottomLeftRadius: isRTL ? 0 : borderRadius.lg,
            borderTopRightRadius: isRTL ? borderRadius.lg : 0,
            borderBottomRightRadius: isRTL ? borderRadius.lg : 0,
          }]} />

          <View style={styles.caseContent}>
            <View style={[styles.caseTopRow, { flexDirection }]}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: statusColor, alignSelf: 'center', marginEnd: 6 }} />
              <Text
                variant="titleSmall"
                numberOfLines={1}
                style={[styles.caseTitle, { color: theme.colors.onSurface, textAlign }]}
              >
                {item.subject || item.title}
              </Text>
              <Chip
                compact
                textStyle={[styles.statusChipText, { color: statusColor }]}
                style={[styles.statusChip, { backgroundColor: `${statusColor}35` }]}
              >
                {item.stageName || item.status}
              </Chip>
            </View>

            <View style={[styles.caseMeta, { flexDirection }]}>
              {item.contactName ? (
                <View style={[styles.metaItem, { flexDirection }]}>
                  <MaterialCommunityIcons
                    name="account"
                    size={14}
                    color={theme.colors.onSurfaceVariant}
                  />
                  <Text
                    variant="labelSmall"
                    numberOfLines={1}
                    style={[styles.metaText, { color: theme.colors.onSurfaceVariant }]}
                  >
                    {item.contactName}
                  </Text>
                </View>
              ) : null}

              {item.category ? (
                <View style={[styles.metaItem, { flexDirection }]}>
                  <MaterialCommunityIcons name="tag" size={14} color={theme.colors.onSurfaceVariant} />
                  <Text variant="labelSmall" numberOfLines={1} style={[styles.metaText, { color: theme.colors.onSurfaceVariant }]}>
                    {item.category}
                  </Text>
                </View>
              ) : null}

              {(item as any).ownerName || (item as any).assignedToName ? (
                <View style={[styles.metaItem, { flexDirection }]}>
                  <MaterialCommunityIcons name="account-tie-outline" size={14} color={theme.colors.onSurfaceVariant} />
                  <Text variant="labelSmall" numberOfLines={1} style={[styles.metaText, { color: theme.colors.onSurfaceVariant }]}>
                    {(item as any).ownerName || (item as any).assignedToName}
                  </Text>
                </View>
              ) : null}

              <View style={[styles.metaItem, { flexDirection }]}>
                <MaterialCommunityIcons name="calendar" size={14} color={theme.colors.onSurfaceVariant} />
                <Text variant="labelSmall" style={[styles.metaText, { color: theme.colors.onSurfaceVariant }]}>
                  {formatDate(item.createdOn || '')}
                </Text>
              </View>

              {!isMyCase && (
                <Pressable
                  onPress={(e) => { e.stopPropagation?.(); handleTakeOwnership(item); }}
                  style={[styles.metaItem, { flexDirection }]}
                  hitSlop={4}
                >
                  <MaterialCommunityIcons name="account-arrow-left" size={14} color={theme.colors.tertiary || '#FF9800'} />
                  <Text variant="labelSmall" style={{ color: theme.colors.tertiary || '#FF9800', marginStart: 3, fontWeight: '600' }}>
                    {t('leads.takeOwnership', 'קח בעלות')}
                  </Text>
                </Pressable>
              )}
            </View>
          </View>
        </Pressable>
      );
    },
    [theme, openCase, flexDirection, textAlign, user, handleTakeOwnership, t],
  );

  const renderEmpty = useCallback(() => {
    if (loading) return null;

    return (
      <View style={styles.emptyContainer}>
        <MaterialCommunityIcons
          name="briefcase-outline"
          size={72}
          color={theme.colors.onSurfaceVariant}
          style={{ opacity: 0.3 }}
        />
        <Text
          variant="titleMedium"
          style={[styles.emptyTitle, { color: theme.colors.onSurface }]}
        >
          {t('cases.noCases')}
        </Text>
        <Text
          variant="bodyMedium"
          style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center' }}
        >
          {t('cases.noCases')}
        </Text>
      </View>
    );
  }, [loading, theme, t]);

  if (loading && cases.length === 0) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
      {/* Header */}
      <View
        style={[
          styles.header,
          { backgroundColor: theme.custom.headerBackground, paddingTop: insets.top + 8 },
        ]}
      >
        <View style={[styles.headerRow, { flexDirection }]}>
          <IconButton
            icon={isRTL ? 'arrow-right' : 'arrow-left'}
            iconColor={theme.custom.headerText}
            size={24}
            onPress={() => router.back()}
          />
          <Text style={[styles.headerTitle, { flex: 1, textAlign }]}>{t('cases.title')}</Text>
          {hasMore && (
          <Pressable
            onPress={() => {
              const allPages = Math.ceil(totalCount / PAGE_SIZE);
              for (let p = page + 1; p <= allPages; p++) fetchPage(p, false);
            }}
            hitSlop={8}
            style={({ pressed }) => [styles.headerIcon, pressed && { opacity: 0.7 }]}
          >
            <MaterialCommunityIcons
              name="download"
              size={24}
              color={theme.custom.headerText}
            />
          </Pressable>
          )}
          <Pressable
            onPress={() => setViewMode(viewMode === 'list' ? 'kanban' : 'list')}
            hitSlop={8}
            style={({ pressed }) => [styles.headerIcon, pressed && { opacity: 0.7 }]}
          >
            <MaterialCommunityIcons
              name={viewMode === 'list' ? 'view-column-outline' : 'format-list-bulleted'}
              size={24}
              color={theme.custom.headerText}
            />
          </Pressable>
          <Pressable
            onPress={() => setAdvancedFilterVisible(true)}
            hitSlop={8}
            style={({ pressed }) => [styles.headerIcon, pressed && { opacity: 0.7 }]}
          >
            <MaterialCommunityIcons
              name="filter-variant"
              size={24}
              color={theme.custom.headerText}
            />
          </Pressable>
          <Pressable
            onPress={toggleSearch}
            hitSlop={8}
            style={({ pressed }) => [styles.headerIcon, pressed && { opacity: 0.7 }]}
          >
            <MaterialCommunityIcons
              name={searchVisible ? 'close' : 'magnify'}
              size={24}
              color={theme.custom.headerText}
            />
          </Pressable>
        </View>
      </View>

      {/* Search bar */}
      {searchVisible && (
        <Animated.View
          style={[
            styles.searchWrap,
            {
              height: searchHeightInterp,
              opacity: searchAnim,
              backgroundColor: theme.custom.headerBackground,
            },
          ]}
        >
          <Searchbar
            placeholder={t('cases.searchPlaceholder')}
            value={searchQuery}
            onChangeText={setSearchQuery}
            returnKeyType="search"
            style={[styles.searchbar, { backgroundColor: theme.colors.surface }]}
            inputStyle={{ fontSize: 14, textAlign: isRTL ? 'right' : 'left' }}
            iconColor={theme.colors.onSurfaceVariant}
            autoFocus
          />
        </Animated.View>
      )}

      {/* Saved Views Tabs */}
      <View style={[styles.viewsRow, { backgroundColor: theme.colors.surface, borderBottomColor: theme.colors.outline }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.viewsScroll, { flexDirection }]}>
          {(() => {
            // "All" is only active when no task quick-filter is applied; while a task filter is
            // active it shows an X so it's an obvious one-tap way back to every case.
            const allActive = activeViewId === '__all' && !taskQuickFilter;
            return (
              <Pressable
                onPress={clearAllFilters}
                style={[styles.viewTab, { flexDirection: 'row', alignItems: 'center', gap: 4 }, allActive && { borderBottomColor: theme.colors.primary, borderBottomWidth: 2 }]}
              >
                {taskQuickFilter && (
                  <MaterialCommunityIcons name="close-circle" size={14} color={theme.colors.primary} />
                )}
                <Text style={[styles.viewTabText, { color: allActive ? theme.colors.primary : (taskQuickFilter ? theme.colors.primary : theme.colors.onSurfaceVariant) }]}>
                  {t('common.all')}
                </Text>
              </Pressable>
            );
          })()}
          <Pressable
            onPress={() => { setActiveViewId('__mine'); setFilterMine(true); setTaskQuickFilter(null); }}
            style={[styles.viewTab, activeViewId === '__mine' && { borderBottomColor: theme.colors.primary, borderBottomWidth: 2 }]}
          >
            <Text style={[styles.viewTabText, { color: activeViewId === '__mine' ? theme.colors.primary : theme.colors.onSurfaceVariant }]}>
              {t('leads.viewMine', 'שלי')}
            </Text>
          </Pressable>
          {([
            { type: 'today' as TaskQuickFilter, icon: 'calendar-today', label: t('leads.tasksToday', 'משימות להיום'), color: '#f59e0b' },
            { type: 'upcoming' as TaskQuickFilter, icon: 'clock-outline', label: t('leads.tasksUpcoming', 'משימות קרובות'), color: '#3b82f6' },
            { type: 'overdue' as TaskQuickFilter, icon: 'alert-circle-outline', label: t('leads.tasksOverdue', 'משימות באיחור'), color: '#ef4444' },
            { type: 'withTasks' as TaskQuickFilter, icon: 'clipboard-clock-outline', label: t('cases.casesWithTasks', 'פניות עם משימות'), color: '#2e6155' },
          ]).map(({ type, icon, label, color }) => {
            const isActive = taskQuickFilter === type;
            const count = taskFilterSets[type].size;
            return (
              <Pressable
                key={type}
                onPress={() => applyTaskFilter(type)}
                disabled={taskFilterLoading}
                style={[styles.viewTab, { flexDirection: 'row', alignItems: 'center', gap: 4 }, isActive && { borderBottomColor: color, borderBottomWidth: 2 }]}
              >
                <MaterialCommunityIcons name={icon as any} size={14} color={isActive ? color : theme.colors.onSurfaceVariant} />
                <Text style={[styles.viewTabText, { color: isActive ? color : theme.colors.onSurfaceVariant, maxWidth: 160 }]} numberOfLines={1}>
                  {label}
                </Text>
                {count > 0 && (
                  <View style={{ backgroundColor: color, borderRadius: 9, minWidth: 18, paddingHorizontal: 4, paddingVertical: 1, alignItems: 'center' }}>
                    <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>{count}</Text>
                  </View>
                )}
              </Pressable>
            );
          })}
          {savedViews.filter((v) => {
            const vis = v.Visibility || 'personal';
            if (vis === 'shared') return true;
            return (v.UserId || '') === (user?.uID || user?.userId || '');
          }).map((view) => (
            <Pressable
              key={view.id}
              onPress={() => loadSavedView(view)}
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
          <Pressable onPress={() => setShowSaveViewModal(true)} style={styles.viewTab}>
            <MaterialCommunityIcons name="plus" size={18} color={theme.colors.primary} />
          </Pressable>
        </ScrollView>
      </View>

      {/* Filter chips */}
      <View
        style={[
          styles.filtersRow,
          { backgroundColor: theme.colors.surface, borderBottomColor: theme.colors.outline },
        ]}
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={[styles.filtersScroll, { flexDirection }]}
        >
          {/* Mine quick filter */}
          <Chip
            selected={filterMine}
            onPress={() => setFilterMine((v) => !v)}
            showSelectedOverlay
            compact
            icon="account"
            style={[
              styles.filterChip,
              filterMine
                ? { backgroundColor: theme.colors.primaryContainer }
                : { backgroundColor: theme.colors.surfaceVariant },
            ]}
            textStyle={[
              styles.filterChipText,
              filterMine && { color: theme.colors.primary, fontWeight: '600' },
            ]}
          >
            {t('leads.viewMine', 'שלי')}
          </Chip>
          {STATUS_FILTERS.map((f) => (
            <Chip
              key={f}
              selected={statusFilter === f}
              onPress={() => setStatusFilter(f)}
              showSelectedOverlay
              compact
              style={[
                styles.filterChip,
                statusFilter === f
                  ? { backgroundColor: theme.colors.primaryContainer }
                  : { backgroundColor: theme.colors.surfaceVariant },
              ]}
              textStyle={[
                styles.filterChipText,
                statusFilter === f && { color: theme.colors.primary, fontWeight: '600' },
              ]}
            >
              {f === 'all'
                ? t('common.all')
                : f.charAt(0).toUpperCase() + f.slice(1).replace(/_/g, ' ')}
            </Chip>
          ))}
        </ScrollView>
      </View>

      {/* Sort bar */}
      {viewMode === 'list' && (
        <View style={{ flexDirection, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: theme.colors.surface, borderBottomColor: theme.colors.outline, borderBottomWidth: StyleSheet.hairlineWidth }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ alignItems: 'center', gap: 6, flexDirection }}>
            <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>{t('leads.sortBy', 'מיין לפי:')}</Text>
            {([
              { key: 'createdOn' as SortKey, label: t('leads.sortCreated', 'נוצר ב'), icon: 'calendar-plus' },
              { key: 'modifiedOn' as SortKey, label: t('leads.sortUpdated', 'עודכן ב'), icon: 'calendar-edit' },
              { key: 'subject' as SortKey, label: t('leads.name', 'שם'), icon: 'sort-alphabetical-variant' },
              { key: 'priority' as SortKey, label: t('tasks.priority', 'עדיפות'), icon: 'flag' },
              { key: 'status' as SortKey, label: t('cases.status', 'סטטוס'), icon: 'view-column' },
            ] as const).map((opt) => (
              <Pressable
                key={opt.key}
                onPress={() => {
                  if (sortKey === opt.key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
                  else { setSortKey(opt.key); setSortDir(['createdOn', 'modifiedOn', 'priority'].includes(opt.key) ? 'desc' : 'asc'); }
                }}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12, backgroundColor: sortKey === opt.key ? withAlpha(theme.colors.primary, 0.1) : 'transparent' }}
              >
                <MaterialCommunityIcons name={opt.icon as any} size={14} color={sortKey === opt.key ? theme.colors.primary : theme.colors.onSurfaceVariant} />
                <Text style={{ fontSize: 11, color: sortKey === opt.key ? theme.colors.primary : theme.colors.onSurfaceVariant, fontWeight: sortKey === opt.key ? '600' : '400' }}>
                  {opt.label}
                </Text>
                {sortKey === opt.key && (
                  <MaterialCommunityIcons name={sortDir === 'asc' ? 'arrow-up' : 'arrow-down'} size={12} color={theme.colors.primary} />
                )}
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}

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
        <FlatList
          data={filteredCases}
          renderItem={renderCaseCard}
          keyExtractor={(item) => item.id}
          ListEmptyComponent={renderEmpty}
          onEndReached={onEndReached}
          onEndReachedThreshold={0.3}
          ListFooterComponent={
            loadingMore
              ? () => <ActivityIndicator size="small" color={theme.colors.primary} style={{ marginVertical: 16 }} />
              : totalCount > 0
                ? () => (
                    <View style={{ alignItems: 'center', paddingVertical: 12, gap: 8 }}>
                      <Text variant="labelSmall" style={{ textAlign: 'center', color: theme.colors.onSurfaceVariant }}>
                        {cases.length} / {totalCount}
                      </Text>
                      {hasMore && (
                        <View style={{ flexDirection: 'row', gap: 8 }}>
                          <Pressable onPress={() => fetchPage(page + 1, false)} style={{ paddingHorizontal: 16, paddingVertical: 6, borderRadius: 16, backgroundColor: theme.colors.primaryContainer }}>
                            <Text style={{ fontSize: 12, fontWeight: '600', color: theme.colors.onPrimaryContainer }}>{t('common.loadMore', 'טען עוד')}</Text>
                          </Pressable>
                          <Pressable onPress={() => {
                            const allPages = Math.ceil(totalCount / PAGE_SIZE);
                            for (let p = page + 1; p <= allPages; p++) fetchPage(p, false);
                          }} style={{ paddingHorizontal: 16, paddingVertical: 6, borderRadius: 16, backgroundColor: theme.colors.surfaceVariant }}>
                            <Text style={{ fontSize: 12, fontWeight: '600', color: theme.colors.onSurfaceVariant }}>{t('common.loadAll', 'טען הכול')}</Text>
                          </Pressable>
                        </View>
                      )}
                    </View>
                  )
                : null
          }
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={[theme.colors.primary]}
              tintColor={theme.colors.primary}
            />
          }
          contentContainerStyle={[
            styles.listContent,
            filteredCases.length === 0 && styles.listContentEmpty,
          ]}
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* FAB */}
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

      <Portal>
        <Modal
          visible={!!statusPickerCase}
          onDismiss={() => setStatusPickerCase(null)}
          contentContainerStyle={[styles.statusPickerModal, { backgroundColor: theme.colors.surface }]}
        >
          <Text variant="titleMedium" style={{ color: theme.colors.onSurface, fontWeight: '700', marginBottom: 4 }}>
            {t('leads.moveStage')}
          </Text>
          {statusPickerCase ? (
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 16 }}>
              {statusPickerCase.subject || statusPickerCase.title}
            </Text>
          ) : null}
          {STATUS_FILTERS.filter((f) => f !== 'all').map((status) => {
            const color = getStatusColor(status);
            const isCurrent = statusPickerCase?.status?.toLowerCase().replace(/\s+/g, '_') === status;
            return (
              <Pressable
                key={status}
                onPress={() => statusPickerCase && handleStatusChange(statusPickerCase, status)}
                disabled={isCurrent}
                style={({ pressed }) => [
                  styles.statusPickerOption,
                  {
                    backgroundColor: isCurrent
                      ? withAlpha(color, 0.12)
                      : pressed
                        ? theme.colors.surfaceVariant
                        : 'transparent',
                  },
                ]}
              >
                <View style={[styles.statusDot, { backgroundColor: color }]} />
                <Text
                  variant="bodyMedium"
                  style={{
                    flex: 1,
                    color: isCurrent ? color : theme.colors.onSurface,
                    fontWeight: isCurrent ? '700' : '400',
                  }}
                >
                  {status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, ' ')}
                </Text>
                {isCurrent ? (
                  <MaterialCommunityIcons name="check" size={20} color={color} />
                ) : null}
              </Pressable>
            );
          })}
          <Button
            mode="text"
            onPress={() => setStatusPickerCase(null)}
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
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    paddingBottom: 4,
  },
  headerRow: {
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  headerIcon: { padding: 4, marginRight: 8 },
  chipRow: { flexWrap: 'wrap', gap: 6, marginBottom: 4 },
  searchWrap: {
    paddingHorizontal: 14,
    overflow: 'hidden',
    justifyContent: 'center',
    paddingBottom: 8,
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
  filtersRow: {
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  filtersScroll: {
    paddingHorizontal: 14,
    gap: 8,
    alignItems: 'center',
  },
  filterChip: { height: 32 },
  filterChipText: { fontSize: 13 },
  listContent: { padding: 14, paddingBottom: 100 },
  listContentEmpty: { flexGrow: 1 },
  caseCard: {
    flexDirection: 'row',
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    overflow: 'hidden',
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
  },
  priorityBar: {
    width: 5,
    borderTopLeftRadius: borderRadius.lg,
    borderBottomLeftRadius: borderRadius.lg,
  },
  caseContent: {
    flex: 1,
    padding: 14,
    gap: 8,
  },
  caseTopRow: {
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  caseTitle: {
    flex: 1,
    fontWeight: '600',
    fontSize: 15,
  },
  statusChip: {
    minHeight: 28,
    borderRadius: 14,
  },
  statusChipText: {
    fontSize: 11,
    fontWeight: '600',
    lineHeight: 16,
  },
  caseMeta: {
    alignItems: 'center',
    gap: 14,
    flexWrap: 'wrap',
  },
  metaItem: {
    alignItems: 'center',
    gap: 4,
  },
  metaText: {
    fontSize: 12,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    paddingHorizontal: 40,
    gap: 12,
  },
  emptyTitle: { fontWeight: '600', marginTop: 8 },
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
  modalContainer: {
    marginHorizontal: 20,
    borderRadius: borderRadius.xl,
    maxHeight: '85%',
    padding: 20,
  },
  modalHeader: {
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  formInput: {
    marginBottom: 14,
  },
  formLabel: {
    fontWeight: '600',
    marginBottom: 8,
  },
  priorityRow: {
    gap: 8,
    marginBottom: 14,
    flexWrap: 'wrap',
  },
  priorityChip: {
    height: 32,
  },
  priorityChipText: {
    fontSize: 12,
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
    flexDirection: 'row',
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
