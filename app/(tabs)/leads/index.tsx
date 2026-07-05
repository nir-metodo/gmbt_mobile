import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  View,
  StyleSheet,
  Pressable,
  RefreshControl,
  Animated,
  ScrollView,
  Alert,
  Linking,
  Modal as RNModal,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Text, Searchbar, Chip, FAB, Avatar, Divider, Surface, Portal, Modal, Button, TextInput as PaperInput, ActivityIndicator, IconButton, Snackbar } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { KanbanBoard, type KanbanColumn } from '../../../components/KanbanBoard';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useLeadStore } from '../../../stores/leadStore';
import { useAuthStore } from '../../../stores/authStore';
import { leadsApi } from '../../../services/api/leads';
import { quotesApi } from '../../../services/api/quotes';
import { tasksApi } from '../../../services/api/tasks';
import { ENDPOINTS } from '../../../constants/api';
import axiosInstance from '../../../services/api/axiosInstance';
import { useAppTheme } from '../../../hooks/useAppTheme';
import { useRTL } from '../../../hooks/useRTL';
import { getDataVisibility } from '../../../constants/permissions';
import { formatCurrency, formatDate, getInitials, withAlpha } from '../../../utils/formatters';
import { placeSmartCall } from '../../../utils/phoneCall';
import { spacing, borderRadius } from '../../../constants/theme';
import type { Lead, LeadStage } from '../../../types';


const DEFAULT_STAGE_COLORS: Record<string, string> = {
  New: '#2e6155',
  Contacted: '#00BCD4',
  Qualified: '#9C27B0',
  Proposal: '#FF9800',
  Negotiation: '#FFC107',
  'Closed Won': '#4CAF50',
  'Closed Lost': '#F44336',
};

const DEFAULT_STAGE_KEYS = ['New', 'Contacted', 'Qualified', 'Proposal', 'Negotiation', 'Closed Won', 'Closed Lost'];

const STAGE_I18N: Record<string, string> = {
  New: 'leads.newLead',
  Contacted: 'leads.contacted',
  Qualified: 'leads.qualified',
  Proposal: 'leads.proposal',
  Negotiation: 'leads.negotiation',
  'Closed Won': 'leads.closed_won',
  'Closed Lost': 'leads.closed_lost',
};


const STATUS_OPTIONS = ['Active', 'Interested', 'Not Interested', 'On Hold', 'Archived'] as const;
const PRIORITY_OPTIONS = ['low', 'medium', 'high'] as const;
const DATE_RANGE_PRESETS = ['Today', 'This Week', 'This Month', 'Last Month', 'This Year'] as const;

const PRIORITY_COLORS: Record<string, string> = {
  low: '#4CAF50',
  medium: '#FF9800',
  high: '#FF5722',
};

// Lead rating (score) 1..5 = Cold / Cool / Warm / Hot / Fire — matches the web lead form.
const SCORE_COLORS = ['#9ca3af', '#3b82f6', '#06b6d4', '#f59e0b', '#f97316', '#ef4444'];
const SCORE_LABELS = ['', 'Cold', 'Cool', 'Warm', 'Hot', 'Fire'];
const scoreColor = (s?: number) => SCORE_COLORS[Math.min(5, Math.max(0, Math.round(Number(s) || 0)))] || '#9ca3af';


interface SavedView {
  id: string;
  Name: string;
  ViewData: { filters?: any; searchTerm?: string };
  IsPinned?: boolean;
  Visibility?: string;
  UserId?: string;
}

const LeadDivider = () => <Divider />;

// Single-select chip group used by the advanced filter to let users pick from the
// distinct values that actually exist in the org's leads (UTM, campaign, source...).
function OptionChips({
  options,
  value,
  onChange,
  theme,
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
  theme: any;
}) {
  if (!options || options.length === 0) return null;
  return (
    <View style={styles.filterChipRow}>
      {options.map((opt) => {
        const isSelected = value === opt;
        return (
          <Chip
            key={opt}
            selected={isSelected}
            onPress={() => onChange(isSelected ? '' : opt)}
            compact
            style={[
              styles.filterChip,
              isSelected
                ? { backgroundColor: withAlpha(theme.colors.primary, 0.145), borderColor: theme.colors.primary, borderWidth: 1 }
                : { backgroundColor: theme.colors.surfaceVariant },
            ]}
            textStyle={{
              fontSize: 12,
              color: isSelected ? theme.colors.primary : theme.colors.onSurfaceVariant,
              fontWeight: isSelected ? '600' : '400',
            }}
          >
            {opt}
          </Chip>
        );
      })}
    </View>
  );
}

// Parse a task due/reminder date that may arrive as a plain ISO string, a Firestore
// timestamp object ({ _seconds } / { seconds }), an epoch number, or a "Timestamp: <iso>"
// prefixed string. Returning a real Date (or null) prevents the today/upcoming/overdue
// buckets from silently dropping tasks whose date `new Date()` couldn't parse — the exact
// reason those tabs looked empty while the lead still showed a task badge.
function parseTaskDate(val: any): Date | null {
  if (!val) return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  if (typeof val === 'number') {
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof val === 'object') {
    const secs = val._seconds ?? val.seconds;
    if (typeof secs === 'number') {
      const d = new Date(secs * 1000);
      return isNaN(d.getTime()) ? null : d;
    }
    return null;
  }
  if (typeof val === 'string') {
    const cleaned = val.startsWith('Timestamp: ') ? val.slice('Timestamp: '.length) : val;
    const d = new Date(cleaned);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

// Compact clock badge shown on a lead card when it has open tasks. Mirrors the web Leads board:
// red = has an overdue task, amber = due today, neutral = upcoming. Count appears when >1.
function LeadTaskBadge({
  info,
  t,
  formatDate,
}: {
  info: { count: number; hasOverdue: boolean; hasToday: boolean; nextDueDate: string | null };
  t: (key: any, defaultValue?: any) => string;
  formatDate: (v: string) => string;
}) {
  // Two clear states (per request): red = the task's time has passed, blue = still upcoming/before.
  const color = info.hasOverdue ? '#ef4444' : '#3b82f6';
  const label = info.hasOverdue
    ? t('tasks.overdue', 'באיחור')
    : info.hasToday
      ? t('tasks.today', 'היום')
      : (info.nextDueDate ? formatDate(info.nextDueDate) : t('tasks.task', 'משימה'));
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 10,
        backgroundColor: withAlpha(color, 0.14),
      }}
    >
      <MaterialCommunityIcons name="clock-outline" size={12} color={color} />
      <Text style={{ fontSize: 10, color, fontWeight: '700' }}>
        {label}{info.count > 1 ? ` (${info.count})` : ''}
      </Text>
    </View>
  );
}

export default function LeadsListScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useAppTheme();
  const { isRTL, flexDirection, textAlign } = useRTL();
  const { t } = useTranslation();

  const user = useAuthStore((s) => s.user);
  const organization = user?.organization ?? '';
  const userIsAdmin = String(user?.SecurityRole ?? '').toLowerCase() === 'admin';

  // Store – used only for create/update/delete to keep detail screen in sync
  const updateLead = useLeadStore((s) => s.updateLead);
  const setViewMode = useLeadStore((s) => s.setViewMode);
  const viewMode = useLeadStore((s) => s.viewMode);
  const setSelectedLead = useLeadStore((s) => s.setSelectedLead);

  // ── Pagination state ────────────────────────────────────────────────────────
  const PAGE_SIZE = 30;
  const [leads, setLeads] = useState<Lead[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadingAll, setLoadingAll] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // ── Filter state ────────────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStage, setSelectedStage] = useState<string | null>(null);
  const [filterSource, setFilterSource] = useState('');
  const [filterOwner, setFilterOwner] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterPriority, setFilterPriority] = useState('');
  const [filterDateRange, setFilterDateRange] = useState('');
  const [filterMine, setFilterMine] = useState(false);
  const [filterUtmSource, setFilterUtmSource] = useState('');
  const [filterUtmMedium, setFilterUtmMedium] = useState('');
  const [filterUtmCampaign, setFilterUtmCampaign] = useState('');
  const [filterCampaignId, setFilterCampaignId] = useState('');
  const [filterFormId, setFilterFormId] = useState('');
  const [filterAdId, setFilterAdId] = useState('');

  // Distinct values that exist in the org's leads, used to populate selectable filters
  const [filterOptions, setFilterOptions] = useState<Record<string, string[]>>({});

  // ── UI state ────────────────────────────────────────────────────────────────
  const [searchVisible, setSearchVisible] = useState(false);
  const [advancedFilterVisible, setAdvancedFilterVisible] = useState(false);
  const searchAnim = useRef(new Animated.Value(0)).current;
  const [stagePickerLead, setStagePickerLead] = useState<Lead | null>(null);
  const [pipelineStages, setPipelineStages] = useState<LeadStage[]>([]);
  const fetchingRef = useRef(false);
  const latestLeadsRef = useRef<Lead[]>([]);

  // ── Sort state ──────────────────────────────────────────────────────────────
  // Default sort is by "created on" (newest first), matching the web. The chosen sort is
  // persisted (localStorage-style, via AsyncStorage) and restored on next open.
  type SortKey = 'createdOn' | 'modifiedOn' | 'title' | 'value' | 'priority' | 'score' | 'stageName';
  type SortDir = 'asc' | 'desc';
  const [sortKey, setSortKey] = useState<SortKey>('createdOn');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const sortPrefLoadedRef = useRef(false);

  // Restore the saved sort preference once on mount (default = created on, descending).
  useEffect(() => {
    (async () => {
      try {
        const [savedKey, savedDir] = await Promise.all([
          AsyncStorage.getItem('leads_sort_key'),
          AsyncStorage.getItem('leads_sort_dir'),
        ]);
        const validKeys: SortKey[] = ['createdOn', 'modifiedOn', 'title', 'value', 'priority', 'score', 'stageName'];
        if (savedKey && validKeys.includes(savedKey as SortKey)) setSortKey(savedKey as SortKey);
        if (savedDir === 'asc' || savedDir === 'desc') setSortDir(savedDir);
      } catch {
        /* keep defaults */
      } finally {
        sortPrefLoadedRef.current = true;
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist the sort preference whenever the user changes it (skip the initial restore).
  useEffect(() => {
    if (!sortPrefLoadedRef.current) return;
    AsyncStorage.setItem('leads_sort_key', sortKey).catch(() => {});
    AsyncStorage.setItem('leads_sort_dir', sortDir).catch(() => {});
  }, [sortKey, sortDir]);

  // ── Seen/Unseen leads tracking ─────────────────────────────────────────────
  const [seenLeadIds, setSeenLeadIds] = useState<Set<string>>(new Set());
  const [unseenOnly, setUnseenOnly] = useState(false);

  // ── Active tasks per lead (clock badge, like the web) ───────────────────────
  // Map<leadId, { count, hasOverdue, hasToday, nextTitle, nextDueDate }>
  type LeadTaskInfo = { count: number; hasOverdue: boolean; hasToday: boolean; nextTitle: string; nextDueDate: string | null };
  const [leadTaskMap, setLeadTaskMap] = useState<Map<string, LeadTaskInfo>>(new Map());

  // ── Task quick-filters (like the web tabs: today / upcoming / overdue / has-tasks) ──
  type TaskQuickFilter = 'today' | 'upcoming' | 'overdue' | 'withTasks';
  const [taskQuickFilter, setTaskQuickFilter] = useState<TaskQuickFilter | null>(null);
  // Lead ids that have a task matching each bucket — precomputed alongside the badge map.
  const [taskFilterSets, setTaskFilterSets] = useState<{ today: Set<string>; upcoming: Set<string>; overdue: Set<string>; withTasks: Set<string> }>(
    { today: new Set(), upcoming: new Set(), overdue: new Set(), withTasks: new Set() },
  );
  const [taskFilterLoading, setTaskFilterLoading] = useState(false);

  // ── Saved views ─────────────────────────────────────────────────────────────
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [activeViewId, setActiveViewId] = useState('__all');
  const [showSaveViewModal, setShowSaveViewModal] = useState(false);
  const [newViewName, setNewViewName] = useState('');
  const [saveViewVisibility, setSaveViewVisibility] = useState<'personal' | 'shared'>('personal');

  const stageColorMap = useMemo(() => {
    if (pipelineStages.length > 0) {
      const map: Record<string, string> = {};
      pipelineStages.forEach((s) => {
        map[s.name] = s.color;
        map[s.id] = s.color;
      });
      return map;
    }
    return DEFAULT_STAGE_COLORS;
  }, [pipelineStages]);

  // Maps any stage identifier (id, name, legacy key) to its display name
  const stageDisplayName = useMemo(() => {
    const map: Record<string, string> = {};
    if (pipelineStages.length > 0) {
      pipelineStages.forEach((s) => {
        map[s.name] = s.name;
        map[s.id] = s.name;
      });
    }
    return map;
  }, [pipelineStages]);

  const stageKeys = useMemo(() => {
    const base = pipelineStages.length > 0 ? pipelineStages.map((s) => s.name) : DEFAULT_STAGE_KEYS;
    return base;
  }, [pipelineStages]);

  // Get display name for a lead's stage
  const getLeadStageName = useCallback((lead: Lead): string => {
    const raw = lead.stageName || lead.stage || '';
    if (stageDisplayName[raw]) return stageDisplayName[raw];
    if (lead.stageId && stageDisplayName[lead.stageId]) return stageDisplayName[lead.stageId];
    return raw || 'New';
  }, [stageDisplayName]);

  // Debounced search value (declared here so buildFilters can depend on it).
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // ── Build filter object for API ─────────────────────────────────────────────
  const buildFilters = useCallback(() => ({
    searchTerm: debouncedSearch.trim(),
    stages: selectedStage ? [selectedStage] : [],
    sources: filterSource.trim() ? [filterSource.trim()] : [],
    owners: filterOwner.trim() ? [filterOwner.trim()] : [],
    statuses: filterStatus ? [filterStatus] : [],
    priorities: filterPriority ? [filterPriority] : [],
    dateRangePreset: filterDateRange || '',
    utmSource: filterUtmSource.trim(),
    utmMedium: filterUtmMedium.trim(),
    utmCampaign: filterUtmCampaign.trim(),
    campaignId: filterCampaignId.trim(),
    formId: filterFormId.trim(),
    adId: filterAdId.trim(),
  }), [debouncedSearch, selectedStage, filterSource, filterOwner, filterStatus, filterPriority, filterDateRange, filterUtmSource, filterUtmMedium, filterUtmCampaign, filterCampaignId, filterFormId, filterAdId]);

  // Attribution filters rendered as selectable chips, but only when the org's leads
  // actually contain values for that field (sections with no data stay hidden).
  const attributionFilters = [
    { key: 'utmSource', label: 'UTM Source', value: filterUtmSource, set: setFilterUtmSource },
    { key: 'utmMedium', label: t('leads.utmMedium', 'UTM Medium'), value: filterUtmMedium, set: setFilterUtmMedium },
    { key: 'utmCampaign', label: 'UTM Campaign', value: filterUtmCampaign, set: setFilterUtmCampaign },
    { key: 'campaignId', label: t('leads.campaignId', 'Campaign ID'), value: filterCampaignId, set: setFilterCampaignId },
    { key: 'formId', label: t('leads.formId', 'Form ID'), value: filterFormId, set: setFilterFormId },
    { key: 'adId', label: t('leads.adId', 'Ad ID'), value: filterAdId, set: setFilterAdId },
  ];

  // ── Fetch a page ────────────────────────────────────────────────────────────
  const fetchPage = useCallback(async (pageNum: number, reset: boolean) => {
    if (!organization || fetchingRef.current) return;
    fetchingRef.current = true;
    if (reset) setIsLoading(true); else setLoadingMore(true);
    try {
      const result = await leadsApi.getAll(organization, {
        page: pageNum,
        pageSize: PAGE_SIZE,
        filters: buildFilters(),
        dataVisibility: filterMine
          ? 'own'
          : getDataVisibility(user?.DataVisibility, user?.SecurityRole, 'leads') === 'own'
            ? 'own'
            : 'seeAll',
        userId: (filterMine || getDataVisibility(user?.DataVisibility, user?.SecurityRole, 'leads') === 'own')
          ? (user?.uID || user?.userId || '')
          : '',
      });
      const newItems = result.data ?? [];
      const total = result.total ?? 0;
      setTotalCount(total);
      setLeads((prev) => {
        const merged = reset ? newItems : [...prev, ...newItems];
        setHasMore(newItems.length === PAGE_SIZE && merged.length < total);
        latestLeadsRef.current = merged;
        return merged;
      });
      setPage(pageNum);
      // Sync store after state update so detail screens can modify individual leads
      setTimeout(() => useLeadStore.setState({ leads: latestLeadsRef.current }), 0);
    } catch {
      /* keep existing data on error */
    } finally {
      fetchingRef.current = false;
      if (reset) setIsLoading(false); else setLoadingMore(false);
    }
  }, [organization, buildFilters, filterMine, user]);

  // ── Load EVERYTHING in one request ──────────────────────────────────────────
  // The web has a "load all" action; mirror it here. A single large-pageSize request
  // (the lead store already uses pageSize 5000) is reliable, unlike firing many
  // paged requests in parallel (which the fetchingRef guard would drop). This is also
  // what the Kanban board needs: it can only group/drag leads that are actually loaded.
  const fetchAll = useCallback(async () => {
    if (!organization || loadingAll) return;
    setLoadingAll(true);
    try {
      const result = await leadsApi.getAll(organization, {
        page: 1,
        pageSize: 5000,
        filters: buildFilters(),
        dataVisibility: filterMine
          ? 'own'
          : getDataVisibility(user?.DataVisibility, user?.SecurityRole, 'leads') === 'own'
            ? 'own'
            : 'seeAll',
        userId: (filterMine || getDataVisibility(user?.DataVisibility, user?.SecurityRole, 'leads') === 'own')
          ? (user?.uID || user?.userId || '')
          : '',
      });
      const all = result.data ?? [];
      const total = result.total ?? all.length;
      setTotalCount(total);
      setLeads(all);
      latestLeadsRef.current = all;
      setHasMore(all.length < total);
      setPage(Math.max(1, Math.ceil(all.length / PAGE_SIZE)));
      setTimeout(() => useLeadStore.setState({ leads: all }), 0);
    } catch {
      /* keep existing data on error */
    } finally {
      setLoadingAll(false);
    }
  }, [organization, loadingAll, buildFilters, filterMine, user]);

  // ── Debounced search ────────────────────────────────────────────────────────
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // ── Initial load & filter change → reset ───────────────────────────────────
  useEffect(() => {
    if (!organization) return;
    // A task quick-filter (today/upcoming/overdue/with-tasks) is a CLIENT-side filter over the
    // loaded leads, so it needs the WHOLE dataset in memory. A plain fetchPage(1) reset here would
    // shrink the pool back to the first page and make the filter look empty/broken — reload all
    // leads instead while a task filter is active.
    if (taskQuickFilter) {
      fetchAll();
    } else {
      fetchPage(1, true);
    }
    leadsApi.getPipelineSettings(organization)
      .then((res) => { if (res.stages.length > 0) setPipelineStages(res.stages); })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organization, debouncedSearch, selectedStage, filterSource, filterOwner, filterStatus, filterPriority, filterDateRange, filterMine, filterUtmSource, filterUtmMedium, filterUtmCampaign, filterCampaignId, filterFormId, filterAdId]);

  // Load distinct filter values that exist in the org's leads (for selectable filters)
  useEffect(() => {
    if (!organization) return;
    leadsApi.getFilterOptions(organization).then(setFilterOptions).catch(() => {});
  }, [organization]);

  // Load saved views
  useEffect(() => {
    if (!organization) return;
    axiosInstance.post(ENDPOINTS.GET_USER_VIEWS, {
      organization,
      userId: user?.uID || user?.userId,
      viewType: 'leads',
    }).then((res) => {
      const data = res.data;
      if (data?.Success && data?.Data?.views) {
        setSavedViews(data.Data.views);
      } else if (Array.isArray(data)) {
        setSavedViews(data);
      }
    }).catch(() => {});
  }, [organization, user?.uID, user?.userId]);

  // Load seen lead IDs
  useEffect(() => {
    if (!organization) return;
    axiosInstance.post(ENDPOINTS.GET_LEAD_SEEN_IDS, { organization })
      .then((res) => {
        const ids = res.data?.SeenLeadIds || [];
        setSeenLeadIds(new Set(ids));
      })
      .catch(() => {});
  }, [organization]);

  const markLeadSeen = useCallback((leadId: string) => {
    setSeenLeadIds((prev) => {
      if (prev.has(leadId)) return prev;
      const next = new Set(prev);
      next.add(leadId);
      axiosInstance.post(ENDPOINTS.MARK_LEAD_SEEN, { organization, leadId }).catch(() => {});
      return next;
    });
  }, [organization]);

  const markAllLeadsSeen = useCallback(() => {
    const allIds = leads.map((l) => l.id);
    setSeenLeadIds((prev) => new Set([...prev, ...allIds]));
    if (allIds.length > 0)
      axiosInstance.post(ENDPOINTS.MARK_LEAD_SEEN, { organization, leadIds: allIds }).catch(() => {});
  }, [organization, leads]);

  // Pull all open tasks for the org and bucket them by the lead they're attached to so each lead
  // card can show a clock badge (overdue/today/upcoming) exactly like the web Leads board.
  const fetchActiveTasksForCards = useCallback(async () => {
    if (!organization) return;
    try {
      const allTasks = await tasksApi.getAll(organization, '', 'all');
      const now = new Date();
      const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date(now); todayEnd.setHours(23, 59, 59, 999);
      const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      const map = new Map<string, LeadTaskInfo>();
      const todaySet = new Set<string>();
      const upcomingSet = new Set<string>();
      const overdueSet = new Set<string>();
      const withTasksSet = new Set<string>();
      allTasks.forEach((task: any) => {
        const statusVal = (task.status || task.Status || '').toLowerCase();
        if (statusVal === 'completed' || statusVal === 'cancelled') return;
        const rel = task.relatedTo || task.RelatedTo;
        const relType = (rel?.type || rel?.Type || '').toLowerCase();
        const relId = rel?.entityId || rel?.EntityId;
        if (relType !== 'lead' || !relId) return;
        const dueRaw = task.dueDate || task.DueDate || '';
        // Fall back to the reminder date when a task has no explicit due date, so a scheduled
        // follow-up still lands in the today/upcoming buckets instead of being invisible.
        const dueDate = parseTaskDate(dueRaw) || parseTaskDate(task.reminderDate || task.ReminderDate);
        const hasValidDue = !!dueDate;
        const isOverdue = hasValidDue ? dueDate! < now : false;
        const isToday = hasValidDue ? dueDate! >= todayStart && dueDate! <= todayEnd : false;
        const title = task.title || task.Title || '';
        const existing = map.get(relId);
        if (existing) {
          existing.count += 1;
          if (isOverdue) existing.hasOverdue = true;
          if (isToday && !isOverdue) existing.hasToday = true;
        } else {
          map.set(relId, { count: 1, hasOverdue: isOverdue, hasToday: isToday && !isOverdue, nextTitle: title, nextDueDate: dueDate ? dueDate.toISOString() : null });
        }

        // Every lead that still has an open task → the "all leads with tasks" bucket.
        withTasksSet.add(relId);

        // Quick-filter buckets. overdue = past due, upcoming = due within the next 7 days,
        // today = due anytime today (regardless of who it's assigned to — the previous
        // "assigned to me" gate silently emptied this tab whenever tasks weren't assigned to
        // the exact current user id, which is why "today" showed nothing).
        if (hasValidDue) {
          if (isOverdue) overdueSet.add(relId);
          if (dueDate! >= now && dueDate! <= in7Days) upcomingSet.add(relId);
          if (isToday) todaySet.add(relId);
        }
      });
      setLeadTaskMap(map);
      setTaskFilterSets({ today: todaySet, upcoming: upcomingSet, overdue: overdueSet, withTasks: withTasksSet });
    } catch {
      /* non-critical; leave previous badges */
    }
  }, [organization, user?.uID, user?.userId]);

  // Apply a task quick-filter. Loads every lead page first so the client-side filter
  // spans the whole dataset (matches the web, which raises pageSize to "all").
  const applyTaskFilter = useCallback(async (type: TaskQuickFilter) => {
    if (taskQuickFilter === type) {
      setTaskQuickFilter(null);
      return;
    }
    setTaskQuickFilter(type);
    setActiveViewId('__all');
    setFilterMine(false);
    setUnseenOnly(false);
    setSelectedStage(null);
    setTaskFilterLoading(true);
    try {
      // Always recompute the task→lead buckets from fresh task data on tap, so the filter
      // reflects the latest statuses/due dates (not a stale snapshot from screen mount).
      const tasksRefresh = fetchActiveTasksForCards();
      // Load the WHOLE lead dataset in one request so the client-side task filter can match
      // every lead (a partial page load is why the tab could look empty). Mirrors the web,
      // which raises pageSize to "all" when a task filter is active.
      await fetchAll();
      await tasksRefresh;
    } finally {
      setTaskFilterLoading(false);
    }
  }, [taskQuickFilter, fetchAll, fetchActiveTasksForCards]);

  useEffect(() => {
    fetchActiveTasksForCards();
  }, [fetchActiveTasksForCards]);

  // Sync store changes into local state (e.g. stage change from detail screen)
  const storeLeads = useLeadStore((s) => s.leads);
  useEffect(() => {
    if (storeLeads.length === 0) return;
    setLeads((prev) => {
      let changed = false;
      const next = prev.map((local) => {
        const updated = storeLeads.find((s) => s.id === local.id);
        if (updated && (updated.stageName !== local.stageName || updated.stage !== local.stage || updated.ownerName !== (local as any).ownerName)) {
          changed = true;
          return { ...local, ...updated };
        }
        return local;
      });
      return changed ? next : prev;
    });
  }, [storeLeads]);

  // Refetch on screen focus (e.g. returning from detail screen)
  const didMountRef = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!didMountRef.current) {
        didMountRef.current = true;
        return;
      }
      if (organization) {
        // Keep the full dataset loaded when a task quick-filter is active so returning from a lead
        // detail doesn't collapse the pool to page 1 and empty out the filtered list.
        if (taskQuickFilter) {
          fetchAll();
        } else {
          fetchPage(1, true);
        }
        fetchActiveTasksForCards();
      }
    }, [organization, fetchPage, fetchAll, fetchActiveTasksForCards, taskQuickFilter])
  );

  const loadSavedView = useCallback((view: SavedView) => {
    const viewData = view.ViewData || {};
    const filters = viewData.filters || {};
    setActiveViewId(view.id);
    setFilterMine(false);
    setUnseenOnly(false);
    setTaskQuickFilter(null);
    setSelectedStage(filters.stage ?? null);
    setFilterSource(filters.source ?? '');
    setFilterOwner(filters.owner ?? '');
    setFilterStatus(filters.status ?? '');
    setFilterPriority(filters.priority ?? '');
    setFilterDateRange(filters.dateRange ?? '');
    setFilterUtmSource(filters.utmSource ?? '');
    setFilterUtmMedium(filters.utmMedium ?? '');
    setFilterUtmCampaign(filters.utmCampaign ?? '');
    setFilterCampaignId(filters.campaignId ?? '');
    setFilterFormId(filters.formId ?? '');
    setFilterAdId(filters.adId ?? '');
    if (viewData.searchTerm) setSearchQuery(viewData.searchTerm);
  }, []);

  const clearAllFilters = useCallback(() => {
    setActiveViewId('__all');
    setTaskQuickFilter(null);
    setSelectedStage(null);
    setFilterSource('');
    setFilterOwner('');
    setFilterStatus('');
    setFilterPriority('');
    setFilterDateRange('');
    setFilterUtmSource('');
    setFilterUtmMedium('');
    setFilterUtmCampaign('');
    setFilterCampaignId('');
    setFilterFormId('');
    setFilterAdId('');
    setFilterMine(false);
    setUnseenOnly(false);
    setSearchQuery('');
  }, []);

  const saveCurrentView = useCallback(async () => {
    if (!newViewName.trim() || !organization) return;
    try {
      const viewData = {
        filters: {
          stage: selectedStage,
          source: filterSource,
          owner: filterOwner,
          status: filterStatus,
          priority: filterPriority,
          dateRange: filterDateRange,
          utmSource: filterUtmSource,
          utmMedium: filterUtmMedium,
          utmCampaign: filterUtmCampaign,
          campaignId: filterCampaignId,
          formId: filterFormId,
          adId: filterAdId,
        },
        searchTerm: searchQuery,
      };
      const res = await axiosInstance.post(ENDPOINTS.SAVE_USER_VIEW, {
        organization,
        userId: user?.uID || user?.userId,
        viewType: 'leads',
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
          UserId: user?.uID || user?.userId,
        };
        setSavedViews((prev) => [...prev, newView]);
      }
    } catch {}
    setShowSaveViewModal(false);
    setNewViewName('');
    setSaveViewVisibility('personal');
  }, [newViewName, organization, user, selectedStage, filterSource, filterOwner, filterStatus, filterPriority, filterDateRange, filterUtmSource, filterUtmMedium, filterUtmCampaign, filterCampaignId, filterFormId, filterAdId, searchQuery, userIsAdmin, saveViewVisibility]);

  const deleteSavedView = useCallback(async (viewId: string) => {
    if (!organization) return;
    try {
      await axiosInstance.post(ENDPOINTS.DELETE_USER_VIEW, {
        organization,
        userId: user?.uID || user?.userId,
        viewId,
      });
      setSavedViews((prev) => prev.filter((v) => v.id !== viewId));
      if (activeViewId === viewId) clearAllFilters();
    } catch {}
  }, [organization, user, activeViewId, clearAllFilters]);


  // ── Infinite scroll ─────────────────────────────────────────────────────────
  const onEndReached = useCallback(() => {
    if (!hasMore || loadingMore || isLoading) return;
    fetchPage(page + 1, false);
  }, [hasMore, loadingMore, isLoading, page, fetchPage]);

  // Base lead list for the pipeline/kanban view, honoring the active task quick-filter so
  // overdue/upcoming/today filtering applies to the board too (not just the list).
  const pipelineLeads = useMemo(() => {
    if (!taskQuickFilter) return leads;
    const ids = taskFilterSets[taskQuickFilter];
    return leads.filter((l) => ids.has(l.id));
  }, [leads, taskQuickFilter, taskFilterSets]);

  // ── Pipeline view grouping (uses loaded leads) ──────────────────────────────
  const leadsByStage = useMemo(() => {
    const grouped = new Map<string, Lead[]>();
    pipelineLeads.forEach((lead) => {
      const stage = getLeadStageName(lead);
      if (!grouped.has(stage)) grouped.set(stage, []);
      grouped.get(stage)!.push(lead);
    });
    return grouped;
  }, [pipelineLeads, getLeadStageName]);

  const parseTs = useCallback((val: any): number => {
    if (!val) return 0;
    if (typeof val === 'number') return val;
    if (val._seconds) return val._seconds * 1000;
    if (val.seconds) return val.seconds * 1000;
    const d = new Date(val);
    return isNaN(d.getTime()) ? 0 : d.getTime();
  }, []);

  const filteredLeads = useMemo(() => {
    let result = [...leads];
    if (selectedStage) result = result.filter((lead) => getLeadStageName(lead) === selectedStage);
    if (unseenOnly) result = result.filter((lead) => !seenLeadIds.has(lead.id));
    if (taskQuickFilter) {
      const ids = taskFilterSets[taskQuickFilter];
      result = result.filter((lead) => ids.has(lead.id));
    }

    result.sort((a: any, b: any) => {
      let aVal: any, bVal: any;
      if (sortKey === 'createdOn') {
        aVal = parseTs(a.createdOn || a.CreatedOn || a.createdAt);
        bVal = parseTs(b.createdOn || b.CreatedOn || b.createdAt);
      } else if (sortKey === 'modifiedOn') {
        // Fall back to createdOn when a lead has no modifiedOn so it still orders sensibly.
        aVal = parseTs(a.modifiedOn || a.ModifiedOn || a.updatedOn || a.UpdatedOn || a.updatedAt) || parseTs(a.createdOn || a.CreatedOn || a.createdAt);
        bVal = parseTs(b.modifiedOn || b.ModifiedOn || b.updatedOn || b.UpdatedOn || b.updatedAt) || parseTs(b.createdOn || b.CreatedOn || b.createdAt);
      } else if (sortKey === 'title') {
        aVal = (a.title || '').toLowerCase();
        bVal = (b.title || '').toLowerCase();
      } else if (sortKey === 'value') {
        aVal = Number(a.value) || 0;
        bVal = Number(b.value) || 0;
      } else if (sortKey === 'priority') {
        const pri: Record<string, number> = { high: 3, medium: 2, low: 1 };
        aVal = pri[a.priority] || 0;
        bVal = pri[b.priority] || 0;
      } else if (sortKey === 'score') {
        aVal = Number(a.score) || 0;
        bVal = Number(b.score) || 0;
      } else if (sortKey === 'stageName') {
        aVal = getLeadStageName(a);
        bVal = getLeadStageName(b);
      } else {
        aVal = a[sortKey] || '';
        bVal = b[sortKey] || '';
      }
      if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });

    return result;
  }, [leads, selectedStage, getLeadStageName, unseenOnly, seenLeadIds, sortKey, sortDir, parseTs, taskQuickFilter, taskFilterSets]);

  // Order each Kanban column newest-first (by last-modified, falling back to created), so a
  // card just dragged into a column — whose timestamp we bump on move — appears at the top.
  const sortByRecency = useCallback((arr: Lead[]) => {
    const recency = (l: any) => Math.max(
      parseTs(l.modifiedOn || l.ModifiedOn || l.updatedOn || l.UpdatedOn || l.updatedAt),
      parseTs(l.createdOn || l.CreatedOn || l.createdAt),
    );
    return [...arr].sort((a, b) => recency(b) - recency(a));
  }, [parseTs]);

  const kanbanColumns = useMemo<KanbanColumn<Lead>[]>(() => {
    // When the real pipeline is loaded, build columns keyed by the stable stage id and
    // match leads by stageId first (like the web), falling back to name/id stored on the
    // lead. Grouping by display name alone hid every lead whose stored stage didn't map
    // back to a name key (custom pipelines), leaving the board empty.
    if (pipelineStages.length > 0) {
      return pipelineStages.map((s) => ({
        id: s.id,
        title: STAGE_I18N[s.name] ? t(STAGE_I18N[s.name]) : s.name,
        color: s.color ?? stageColorMap[s.id] ?? theme.colors.primary,
        items: sortByRecency(pipelineLeads.filter(
          (l) =>
            l.stageId === s.id ||
            l.stageName === s.name ||
            l.stage === s.name ||
            l.stageName === s.id ||
            l.stage === s.id,
        )),
      }));
    }
    // No pipeline settings loaded → fall back to the default keys grouped by display name.
    return DEFAULT_STAGE_KEYS.map((stage) => ({
      id: stage,
      title: t(STAGE_I18N[stage] ?? stage),
      color: stageColorMap[stage] ?? theme.colors.primary,
      items: sortByRecency(leadsByStage.get(stage) ?? []),
    }));
  }, [pipelineStages, pipelineLeads, stageKeys, stageColorMap, leadsByStage, t, theme.colors.primary, sortByRecency]);

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

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    // Preserve the full dataset when a task quick-filter is active (a page-1 reset would empty it).
    await Promise.all([taskQuickFilter ? fetchAll() : fetchPage(1, true), fetchActiveTasksForCards()]);
    setRefreshing(false);
  }, [fetchPage, fetchAll, fetchActiveTasksForCards, taskQuickFilter]);

  const openLead = useCallback(
    (lead: Lead) => {
      markLeadSeen(lead.id);
      setSelectedLead(lead);
      router.push({
        pathname: '/(tabs)/leads/[id]',
        params: { id: lead.id },
      });
    },
    [router, setSelectedLead, markLeadSeen],
  );

  const stageColor = useCallback(
    (stage: string) => stageColorMap[stage] ?? theme.colors.primary,
    [stageColorMap, theme],
  );

  const handleStageChange = useCallback(
    async (lead: Lead, newStage: string) => {
      setStagePickerLead(null);
      const stageObj =
        pipelineStages.find((s) => s.name === newStage) ||
        pipelineStages.find((s) => s.id === newStage);
      const newStageId = stageObj?.id || newStage;
      const newStageName = stageObj?.name || newStage;

      if (!organization || !lead.id || !newStageId) {
        Alert.alert(t('common.error', 'Error'), 'Missing required data');
        return;
      }

      // Optimistic local update. Bump the timestamp so the card floats to the TOP of the
      // target column (columns are sorted by recency), matching the "just moved" expectation.
      const movedAtIso = new Date().toISOString();
      setLeads((prev) =>
        prev.map((l) => (l.id === lead.id ? ({ ...l, stageName: newStageName, stage: newStageName, stageId: newStageId, modifiedOn: movedAtIso, updatedOn: movedAtIso } as Lead) : l)),
      );

      try {
        await leadsApi.moveStage(
          organization,
          lead.id,
          newStageId,
          newStageName,
          user?.fullname || user?.name || '',
        );

        // Won celebration
        if (stageObj?.isWon) {
          setWonCelebration({ title: lead.title || '', value: lead.value });
          setTimeout(() => setWonCelebration(null), 5000);
        }

        // Auto-quote prompt
        if (stageObj?.autoQuote?.enabled) {
          setAutoQuotePrompt({ lead, config: stageObj.autoQuote as NonNullable<LeadStage['autoQuote']> });
        }
      } catch (err: any) {
        setLeads((prev) =>
          prev.map((l) =>
            l.id === lead.id
              ? { ...l, stageName: lead.stageName, stage: lead.stage, stageId: lead.stageId }
              : l,
          ),
        );
        Alert.alert(t('common.error', 'Error'), err?.message || t('errors.generic'));
      }
    },
    [organization, user, t, pipelineStages],
  );

  const handleKanbanMove = useCallback((item: Lead, _fromColumnId: string, toColumnId: string) => {
    handleStageChange(item, toColumnId);
  }, [handleStageChange]);

  const [ownershipSnackbar, setOwnershipSnackbar] = useState('');
  const [wonCelebration, setWonCelebration] = useState<{ title: string; value?: number | string } | null>(null);
  const [autoQuotePrompt, setAutoQuotePrompt] = useState<{ lead: Lead; config: NonNullable<LeadStage['autoQuote']> } | null>(null);
  const [autoQuoteLoading, setAutoQuoteLoading] = useState(false);

  const handleAutoQuoteAction = useCallback(
    async (action: 'create' | 'createAndSend' | 'createAndNavigate') => {
      if (!autoQuotePrompt || !organization) return;
      const { lead: promptLead, config } = autoQuotePrompt;
      setAutoQuoteLoading(true);
      try {
        const contactName = promptLead.contactName || promptLead.title || '';
        const contactPhone = promptLead.contactPhone || promptLead.phoneNumber || '';
        const titleTemplate = config.quoteTitle || 'הצעת מחיר - {{leadTitle}}';
        const leadLabel = promptLead.title || contactName || 'ליד';
        const quoteTitle = titleTemplate.replace('{{leadTitle}}', leadLabel);
        const validDays = config.validDays || 30;
        const tax = config.tax ?? 18;
        const discountPct = config.discount || 0;

        const products = Array.isArray((promptLead as any).interestedProducts) ? (promptLead as any).interestedProducts : [];
        const items = products.length > 0
          ? products.map((p: any) => ({ type: 'item', description: p.name || '', quantity: p.quantity || 1, unitPrice: parseFloat(p.unitPrice) || 0 }))
          : [{ type: 'item', description: promptLead.title || 'שירות', quantity: 1, unitPrice: parseFloat(String(promptLead.value)) || 0 }];

        const subtotal = items.reduce((sum: number, it: any) => sum + (it.unitPrice || 0) * (it.quantity || 1), 0);
        const discountAmount = Math.round(subtotal * discountPct / 100 * 100) / 100;
        const afterDiscount = subtotal - discountAmount;
        const taxAmount = Math.round(afterDiscount * tax / 100 * 100) / 100;
        const total = Math.round((afterDiscount + taxAmount) * 100) / 100;

        const quoteData = {
          title: quoteTitle,
          date: new Date().toISOString().split('T')[0],
          validUntil: new Date(Date.now() + validDays * 86400000).toISOString().split('T')[0],
          contactName,
          contactPhone,
          contactEmail: (promptLead as any).email || '',
          contactCompany: (promptLead as any).companyName || '',
          leadId: promptLead.id,
          leadTitle: promptLead.title || contactName || '',
          currency: (promptLead as any).currency || 'ILS',
          items,
          discount: discountPct,
          discountType: 'percent' as const,
          tax,
          notes: config.defaultNotes || '',
          terms: '',
          status: 'draft' as const,
          salespersonId: (promptLead as any).ownerId || user?.uID || '',
          salespersonName: (promptLead as any).ownerName || user?.fullname || '',
          subtotal,
          discountAmount,
          taxAmount,
          total,
        };

        const res = await quotesApi.create(organization, quoteData, user?.uID || '', user?.fullname || '');
        const newQuoteId = res?.Data?.id || res?.id || res?.quoteId || '';
        setAutoQuotePrompt(null);

        if ((action === 'createAndNavigate' || action === 'createAndSend') && newQuoteId) {
          router.push({ pathname: '/(tabs)/more/quotes/[id]', params: { id: newQuoteId } });
        }
      } catch {
        Alert.alert(t('common.error', 'Error'), t('quotes.createError', 'שגיאה ביצירת הצעת מחיר'));
      } finally {
        setAutoQuoteLoading(false);
      }
    },
    [autoQuotePrompt, organization, user, router, t],
  );

  const handleTakeOwnership = useCallback(async (lead: Lead) => {
    if (!organization || !user) return;
    const userId = user.uID || user.userId || '';
    const userName = user.fullname || '';
    setLeads((prev) => prev.map((l) => l.id === lead.id ? { ...l, ownerId: userId, ownerName: userName } : l));
    setOwnershipSnackbar(t('leads.ownershipTaken', `לקחת בעלות על "${lead.title}"`));
    try {
      await leadsApi.update(organization, { id: lead.id, ownerId: userId, ownerName: userName }, userId, userName);
    } catch {
      setLeads((prev) => prev.map((l) => l.id === lead.id ? { ...l, ownerId: lead.ownerId, ownerName: (lead as any).ownerName } : l));
      setOwnershipSnackbar('');
    }
  }, [organization, user, t]);

  const renderLeadItem = useCallback(
    ({ item }: { item: Lead; index?: number }) => {
      const isMyLead = (item as any).ownerId === (user?.uID || user?.userId);
      return (
      <Pressable
        onPress={() => openLead(item)}
        onLongPress={() => setStagePickerLead(item)}
        delayLongPress={400}
        android_ripple={{ color: theme.colors.surfaceVariant }}
        style={({ pressed }) => [
          styles.leadRow,
          {
            backgroundColor: pressed ? theme.colors.surfaceVariant : theme.colors.surface,
            flexDirection,
            paddingEnd: 14,
          },
        ]}
      >
        <View style={[styles.stageStripe, {
          backgroundColor: stageColor(getLeadStageName(item)),
          borderTopRightRadius: isRTL ? 0 : 2,
          borderBottomRightRadius: isRTL ? 0 : 2,
          borderTopLeftRadius: isRTL ? 2 : 0,
          borderBottomLeftRadius: isRTL ? 2 : 0,
        }]} />

        <View style={styles.leadBody}>
          <View style={[styles.leadTop, { flexDirection }]}>
            {/* Unseen dot */}
            {!seenLeadIds.has(item.id) && (
              <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: '#ef4444', alignSelf: 'center', marginEnd: 4, flexShrink: 0 }} />
            )}
            {/* Stage color dot */}
            <View
              style={{
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: stageColor(getLeadStageName(item)),
                alignSelf: 'center',
                marginEnd: 6,
                flexShrink: 0,
              }}
            />
            <Text
              variant="titleMedium"
              numberOfLines={1}
              style={{ color: theme.colors.onSurface, fontWeight: '600', flex: 1, textAlign }}
            >
              {item.title}
            </Text>
            {item.value != null && item.value > 0 ? (
              <Text
                variant="titleSmall"
                style={{ color: theme.colors.primary, fontWeight: '700', marginEnd: 6 }}
              >
                {formatCurrency(item.value, item.currency ?? '₪')}
              </Text>
            ) : null}
            {(item as any).score ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 1, backgroundColor: withAlpha(scoreColor((item as any).score), 0.16), borderRadius: 8, paddingHorizontal: 5, paddingVertical: 1, marginEnd: 4 }}>
                <MaterialCommunityIcons name="fire" size={12} color={scoreColor((item as any).score)} />
                <Text style={{ fontSize: 10, fontWeight: '700', color: scoreColor((item as any).score) }}>{Number((item as any).score)}</Text>
              </View>
            ) : null}
            {item.priority ? (
              <MaterialCommunityIcons name="flag" size={14} color={PRIORITY_COLORS[item.priority] || theme.colors.onSurfaceVariant} />
            ) : null}
          </View>

          <View style={[styles.leadMeta, { flexDirection }]}>
            {item.contactName ? (
              <View style={[styles.metaChip, { flexDirection }]}>
                <MaterialCommunityIcons name="account-outline" size={14} color={theme.colors.onSurfaceVariant} />
                <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginStart: 4 }}>
                  {item.contactName}
                </Text>
              </View>
            ) : null}
            {(item as any).companyName ? (
              <View style={[styles.metaChip, { flexDirection }]}>
                <MaterialCommunityIcons name="office-building-outline" size={14} color={theme.colors.onSurfaceVariant} />
                <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginStart: 4 }}>
                  {(item as any).companyName}
                </Text>
              </View>
            ) : null}
            {(item.createdOn || item.createdAt) ? (
              <View style={[styles.metaChip, { flexDirection }]}>
                <MaterialCommunityIcons name="calendar-outline" size={14} color={theme.colors.onSurfaceVariant} />
                <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginStart: 4 }}>
                  {formatDate(item.createdOn || item.createdAt || '')}
                </Text>
              </View>
            ) : null}
          </View>

          <View style={[styles.leadBottom, { flexDirection }]}>
            <Chip
              compact
              textStyle={{ fontSize: 11, color: stageColor(getLeadStageName(item)), fontWeight: '600', lineHeight: 16 }}
              style={{ backgroundColor: withAlpha(stageColor(getLeadStageName(item)), 0.21), minHeight: 28 }}
            >
              {getLeadStageName(item)}
            </Chip>
            {leadTaskMap.get(item.id) ? (
              <LeadTaskBadge info={leadTaskMap.get(item.id)!} t={t} formatDate={formatDate} />
            ) : null}
            {(item as any).status ? (
              <Chip
                compact
                textStyle={{ fontSize: 10, color: theme.colors.onSurfaceVariant, lineHeight: 14 }}
                style={{ backgroundColor: theme.colors.surfaceVariant, minHeight: 24 }}
              >
                {(item as any).status}
              </Chip>
            ) : null}
            {item.source ? (
              <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                {item.source}
              </Text>
            ) : null}
            {(item as any).ownerName ? (
              <View style={[{ flexDirection, alignItems: 'center', gap: 2 }]}>
                <MaterialCommunityIcons name="account-tie-outline" size={12} color={theme.colors.onSurfaceVariant} />
                <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                  {(item as any).ownerName}
                </Text>
              </View>
            ) : null}
          </View>

          {/* Quick dialer */}
          {(item.contactPhone || item.phoneNumber) ? (
            <Pressable
              onPress={(e) => {
                e.stopPropagation?.();
                const phone = item.contactPhone || item.phoneNumber || '';
                placeSmartCall({
                  phoneNumber: phone,
                  organization,
                  user,
                  relatedTo: { type: 'lead', entityId: item.id || '', entityName: item.title },
                  leadId: item.id || '',
                  customerName: item.contactName,
                });
              }}
              style={[styles.quickDialRow, { flexDirection }]}
              hitSlop={4}
            >
              <MaterialCommunityIcons name="phone-outline" size={13} color={theme.colors.primary} />
              <Text variant="labelSmall" style={{ color: theme.colors.primary, marginStart: 4 }}>
                {item.contactPhone || item.phoneNumber}
              </Text>
            </Pressable>
          ) : null}

          {/* Take ownership */}
          {!isMyLead && (
            <Pressable
              onPress={(e) => { e.stopPropagation?.(); handleTakeOwnership(item); }}
              style={[styles.quickDialRow, { flexDirection, marginTop: 4 }]}
              hitSlop={4}
            >
              <MaterialCommunityIcons name="account-arrow-left" size={13} color={theme.colors.tertiary || '#FF9800'} />
              <Text variant="labelSmall" style={{ color: theme.colors.tertiary || '#FF9800', marginStart: 4, fontWeight: '600' }}>
                {t('leads.takeOwnership', 'קח בעלות')}
              </Text>
            </Pressable>
          )}
        </View>

        <MaterialCommunityIcons
          name={isRTL ? 'chevron-left' : 'chevron-right'}
          size={20}
          color={theme.colors.onSurfaceVariant}
          style={{ opacity: 0.4, alignSelf: 'center' }}
        />
      </Pressable>
    );},
    [theme, isRTL, flexDirection, textAlign, openLead, stageColor, t, user, handleTakeOwnership, getLeadStageName, seenLeadIds, leadTaskMap],
  );

  const renderPipelineCard = useCallback(
    (lead: Lead) => (
      <Pressable
        key={lead.id}
        onPress={() => openLead(lead)}
        onLongPress={() => setStagePickerLead(lead)}
        delayLongPress={400}
        style={({ pressed }) => [
          styles.pipelineCard,
          {
            backgroundColor: pressed ? theme.colors.surfaceVariant : theme.colors.surface,
            borderStartColor: stageColor(getLeadStageName(lead)),
            borderStartWidth: 3,
          },
        ]}
      >
        <Text
          variant="titleSmall"
          numberOfLines={1}
          style={{ color: theme.colors.onSurface, fontWeight: '600' }}
        >
          {lead.title}
        </Text>
        {lead.contactName ? (
          <View style={[styles.pipelineCardMeta, { flexDirection }]}>
            <MaterialCommunityIcons
              name="account-outline"
              size={14}
              color={theme.colors.onSurfaceVariant}
            />
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginStart: 4 }}>
              {lead.contactName}
            </Text>
          </View>
        ) : null}
        {lead.value != null && lead.value > 0 ? (
          <Text variant="titleSmall" style={{ color: theme.colors.primary, fontWeight: '700', marginTop: 4 }}>
            {formatCurrency(lead.value, lead.currency ?? '₪')}
          </Text>
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
          {leadTaskMap.get(lead.id) ? (
            <LeadTaskBadge info={leadTaskMap.get(lead.id)!} t={t} formatDate={formatDate} />
          ) : null}
          {(lead as any).score ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 1, backgroundColor: withAlpha(scoreColor((lead as any).score), 0.16), borderRadius: 8, paddingHorizontal: 5, paddingVertical: 1 }}>
              <MaterialCommunityIcons name="fire" size={12} color={scoreColor((lead as any).score)} />
              <Text style={{ fontSize: 10, fontWeight: '700', color: scoreColor((lead as any).score) }}>{Number((lead as any).score)}</Text>
            </View>
          ) : null}
          {lead.priority ? (
            <MaterialCommunityIcons name="flag" size={14} color={PRIORITY_COLORS[lead.priority] || theme.colors.onSurfaceVariant} />
          ) : null}
        </View>
      </Pressable>
    ),
    [theme, flexDirection, openLead, stageColor, getLeadStageName, leadTaskMap, t],
  );

  const renderEmpty = useCallback(
    () => (
      <View style={styles.emptyWrap}>
        <MaterialCommunityIcons
          name="trending-up"
          size={72}
          color={theme.colors.onSurfaceVariant}
          style={{ opacity: 0.35 }}
        />
        <Text variant="titleMedium" style={{ color: theme.colors.onSurface, fontWeight: '600', marginTop: 12 }}>
          {t('leads.noLeads')}
        </Text>
        <Text
          variant="bodyMedium"
          style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center', marginTop: 4 }}
        >
          {t('leads.addLead')}
        </Text>
      </View>
    ),
    [theme, t],
  );

  const searchHeight = searchAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 56],
  });

  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.background, flexDirection: 'column' }]}>
      {/* Header */}
      <View
        style={[
          styles.header,
          { backgroundColor: theme.custom.headerBackground, paddingTop: insets.top, flexDirection },
        ]}
      >
        <Text style={styles.headerTitle}>{t('leads.title')}</Text>
        <View style={[styles.headerActions, { flexDirection }]}>
          {hasMore && (
          <Pressable
            onPress={() => {
              const allPages = Math.ceil(totalCount / PAGE_SIZE);
              for (let p = page + 1; p <= allPages; p++) fetchPage(p, false);
            }}
            hitSlop={8}
            style={({ pressed }) => [styles.headerBtn, pressed && { opacity: 0.7 }]}
          >
            <MaterialCommunityIcons
              name="download"
              size={24}
              color={theme.custom.headerText}
            />
          </Pressable>
          )}
          <Pressable
            onPress={() => setViewMode(viewMode === 'list' ? 'pipeline' : 'list')}
            hitSlop={8}
            style={({ pressed }) => [styles.headerBtn, pressed && { opacity: 0.7 }]}
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
            style={({ pressed }) => [styles.headerBtn, pressed && { opacity: 0.7 }]}
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
            style={({ pressed }) => [styles.headerBtn, pressed && { opacity: 0.7 }]}
          >
            <MaterialCommunityIcons
              name={searchVisible ? 'close' : 'magnify'}
              size={24}
              color={theme.custom.headerText}
            />
          </Pressable>
        </View>
      </View>

      {/* Search */}
      {searchVisible ? (
        <Animated.View
          style={[
            styles.searchWrap,
            {
              height: searchHeight,
              opacity: searchAnim,
              backgroundColor: theme.custom.headerBackground,
            },
          ]}
        >
          <Searchbar
            placeholder={t('leads.searchPlaceholder')}
            value={searchQuery}
            onChangeText={setSearchQuery}
            returnKeyType="search"
            style={[styles.searchbar, { backgroundColor: theme.colors.surface }]}
            inputStyle={{ fontSize: 14, textAlign: isRTL ? 'right' : 'left' }}
            iconColor={theme.colors.onSurfaceVariant}
            autoFocus
          />
        </Animated.View>
      ) : null}

      {/* Saved Views Tabs */}
      <View style={[styles.viewsRow, { backgroundColor: theme.colors.surface, borderBottomColor: theme.colors.outline }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.viewsScroll, { flexDirection }]}>
          {(() => {
            // "All" is only the active tab when no task quick-filter is applied, so while a
            // task filter (today/upcoming/overdue/with-tasks) is active this tab is visibly
            // un-selected — giving the user an obvious one-tap way back to every lead.
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
                  {t('leads.viewAll', 'הכל')}
                </Text>
              </Pressable>
            );
          })()}
          <Pressable
            onPress={() => { setActiveViewId('__mine'); setFilterMine(true); setUnseenOnly(false); setTaskQuickFilter(null); }}
            style={[styles.viewTab, activeViewId === '__mine' && { borderBottomColor: theme.colors.primary, borderBottomWidth: 2 }]}
          >
            <Text style={[styles.viewTabText, { color: activeViewId === '__mine' ? theme.colors.primary : theme.colors.onSurfaceVariant }]}>
              {t('leads.viewMine', 'שלי')}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => { setActiveViewId('__new'); setUnseenOnly(true); setFilterMine(false); setSelectedStage(null); setTaskQuickFilter(null); }}
            style={[styles.viewTab, activeViewId === '__new' && { borderBottomColor: '#ef4444', borderBottomWidth: 2 }]}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Text style={[styles.viewTabText, { color: activeViewId === '__new' ? '#ef4444' : theme.colors.onSurfaceVariant }]}>
                {t('leads.viewNew', 'חדשים')}
              </Text>
              {leads.filter((l) => !seenLeadIds.has(l.id)).length > 0 && (
                <View style={{ backgroundColor: '#ef4444', borderRadius: 9, minWidth: 18, paddingHorizontal: 4, paddingVertical: 1, alignItems: 'center' }}>
                  <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>
                    {leads.filter((l) => !seenLeadIds.has(l.id)).length}
                  </Text>
                </View>
              )}
            </View>
          </Pressable>
          {([
            { type: 'today' as TaskQuickFilter, icon: 'calendar-today', label: t('leads.tasksToday', 'משימות להיום'), color: '#f59e0b' },
            { type: 'upcoming' as TaskQuickFilter, icon: 'clock-outline', label: t('leads.tasksUpcoming', 'משימות קרובות'), color: '#3b82f6' },
            { type: 'overdue' as TaskQuickFilter, icon: 'alert-circle-outline', label: t('leads.tasksOverdue', 'משימות באיחור'), color: '#ef4444' },
            { type: 'withTasks' as TaskQuickFilter, icon: 'clipboard-clock-outline', label: t('leads.leadsWithTasks', 'לידים עם משימות'), color: '#2e6155' },
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

      {/* Stage filter chips */}
      {viewMode === 'list' ? (
        <View style={{ height: 40, backgroundColor: theme.colors.surface, borderBottomColor: theme.colors.outline, borderBottomWidth: StyleSheet.hairlineWidth }}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={[
            styles.stageFilters,
            { paddingStart: 14, paddingEnd: 14 },
          ]}
          style={{ flex: 1 }}
        >
          <Chip
            selected={selectedStage === null}
            onPress={() => setSelectedStage(null)}
            showSelectedOverlay
            compact
            style={[
              styles.stageChip,
              selectedStage === null
                ? { backgroundColor: theme.colors.primaryContainer }
                : { backgroundColor: theme.colors.surfaceVariant },
            ]}
            textStyle={[
              styles.stageChipText,
              selectedStage === null && { color: theme.colors.primary, fontWeight: '600' },
            ]}
          >
            {t('common.all')}
          </Chip>
          {stageKeys.map((stage) => {
            const isSelected = selectedStage === stage;
            const color = stageColor(stage);
            return (
              <Chip
                key={stage}
                selected={isSelected}
                onPress={() => setSelectedStage(isSelected ? null : stage)}
                showSelectedOverlay
                compact
                style={[
                  styles.stageChip,
                  isSelected
                    ? { backgroundColor: withAlpha(color, 0.12) }
                    : { backgroundColor: theme.colors.surfaceVariant },
                ]}
                textStyle={[
                  styles.stageChipText,
                  isSelected && { color, fontWeight: '600' },
                ]}
              >
                {t(STAGE_I18N[stage] ?? stage)}
              </Chip>
            );
          })}
        </ScrollView>
        </View>
      ) : null}

      {/* Sort bar */}
      {viewMode === 'list' && (
        <View style={{ flexDirection, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: theme.colors.surface, borderBottomColor: theme.colors.outline, borderBottomWidth: StyleSheet.hairlineWidth, gap: 6, alignItems: 'center' }}>
          <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>{t('leads.sortBy', 'מיין לפי:')}</Text>
          {([
            { key: 'createdOn' as SortKey, label: t('leads.sortCreated', 'נוצר ב'), icon: 'calendar-plus' },
            { key: 'modifiedOn' as SortKey, label: t('leads.sortUpdated', 'עודכן ב'), icon: 'calendar-edit' },
            { key: 'title' as SortKey, label: t('leads.name', 'שם'), icon: 'sort-alphabetical-variant' },
            { key: 'value' as SortKey, label: t('leads.value', 'סכום'), icon: 'cash' },
            { key: 'priority' as SortKey, label: t('leads.priority', 'עדיפות'), icon: 'flag' },
            { key: 'score' as SortKey, label: t('leads.score', 'דירוג'), icon: 'fire' },
            { key: 'stageName' as SortKey, label: t('leads.stage', 'שלב'), icon: 'view-column' },
          ] as const).map((opt) => (
            <Pressable
              key={opt.key}
              onPress={() => {
                if (sortKey === opt.key) setSortDir((d) => d === 'asc' ? 'desc' : 'asc');
                else { setSortKey(opt.key); setSortDir(['createdOn', 'modifiedOn', 'value', 'priority', 'score'].includes(opt.key) ? 'desc' : 'asc'); }
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
        </View>
      )}

      {/* Unseen banner */}
      {activeViewId === '__new' && (
        <View style={{ flexDirection, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: '#fef2f2', alignItems: 'center', gap: 8 }}>
          <Text style={{ color: '#ef4444', fontSize: 12, fontWeight: '600' }}>●</Text>
          <Text style={{ color: '#dc2626', fontSize: 12, flex: 1 }}>
            {filteredLeads.length} {t('leads.unseenLeads', 'לידים שלא נצפו')}
          </Text>
          {filteredLeads.length > 0 && (
            <Pressable onPress={markAllLeadsSeen} style={{ paddingHorizontal: 10, paddingVertical: 4, backgroundColor: '#fee2e2', borderRadius: 8 }}>
              <Text style={{ color: '#dc2626', fontSize: 11, fontWeight: '600' }}>{t('leads.markAllSeen', 'סמן הכול כנצפה')}</Text>
            </Pressable>
          )}
        </View>
      )}

      {/* Content */}
      {isLoading && leads.length === 0 ? (
        <View style={[styles.centered, { flex: 1 }]}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      ) : viewMode === 'list' ? (
        <FlashList
          data={filteredLeads}
          renderItem={renderLeadItem}
          keyExtractor={(item, idx) => item.id || `lead_${idx}`}
          ItemSeparatorComponent={LeadDivider}
          ListEmptyComponent={renderEmpty}
          ListFooterComponent={
            loadingMore ? (
              <ActivityIndicator size="small" color={theme.colors.primary} style={{ marginVertical: 16 }} />
            ) : totalCount > 0 ? (
              <View style={{ alignItems: 'center', paddingVertical: 12, gap: 8 }}>
                <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                  {leads.length} / {totalCount}
                </Text>
                {hasMore && (
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <Pressable onPress={() => fetchPage(page + 1, false)} disabled={loadingAll} style={{ paddingHorizontal: 16, paddingVertical: 6, borderRadius: 16, backgroundColor: theme.colors.primaryContainer, opacity: loadingAll ? 0.5 : 1 }}>
                      <Text style={{ fontSize: 12, fontWeight: '600', color: theme.colors.onPrimaryContainer }}>{t('common.loadMore', 'טען עוד')}</Text>
                    </Pressable>
                    <Pressable onPress={fetchAll} disabled={loadingAll} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 6, borderRadius: 16, backgroundColor: theme.colors.surfaceVariant, opacity: loadingAll ? 0.7 : 1 }}>
                      {loadingAll && <ActivityIndicator size={12} color={theme.colors.onSurfaceVariant} />}
                      <Text style={{ fontSize: 12, fontWeight: '600', color: theme.colors.onSurfaceVariant }}>{t('common.loadAll', 'טען הכול')}</Text>
                    </Pressable>
                  </View>
                )}
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
          onEndReached={onEndReached}
          onEndReachedThreshold={0.3}
          contentContainerStyle={styles.listContent}
        />
      ) : (
        <View style={{ flex: 1 }}>
          {hasMore && (
            <Pressable onPress={fetchAll} disabled={loadingAll} style={{ flexDirection: 'row', alignSelf: 'center', alignItems: 'center', gap: 6, marginTop: 8, marginBottom: 4, paddingHorizontal: 16, paddingVertical: 6, borderRadius: 16, backgroundColor: theme.colors.primaryContainer, opacity: loadingAll ? 0.7 : 1 }}>
              {loadingAll ? <ActivityIndicator size={12} color={theme.colors.onPrimaryContainer} /> : <MaterialCommunityIcons name="download" size={14} color={theme.colors.onPrimaryContainer} />}
              <Text style={{ fontSize: 12, fontWeight: '600', color: theme.colors.onPrimaryContainer }}>{t('common.loadAll', 'טען הכול')} ({leads.length}/{totalCount})</Text>
            </Pressable>
          )}
          <KanbanBoard
          columns={kanbanColumns}
          keyExtractor={(item) => item.id}
          onMoveItem={handleKanbanMove}
          emptyLabel={t('leads.noLeads')}
          renderCard={(item) => (
            <Pressable
              onPress={() => openLead(item)}
              style={({ pressed }) => [
                styles.pipelineCard,
                {
                  backgroundColor: pressed ? theme.colors.surfaceVariant : theme.colors.surface,
                  borderStartColor: stageColor(getLeadStageName(item)),
                  borderStartWidth: 3,
                },
              ]}
            >
              <Text
                variant="titleSmall"
                numberOfLines={1}
                style={{ color: theme.colors.onSurface, fontWeight: '600' }}
              >
                {item.title}
              </Text>
              {item.contactName ? (
                <View style={[styles.pipelineCardMeta, { flexDirection }]}>
                  <MaterialCommunityIcons name="account-outline" size={14} color={theme.colors.onSurfaceVariant} />
                  <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginStart: 4 }}>
                    {item.contactName}
                  </Text>
                </View>
              ) : null}
              {item.value != null && item.value > 0 ? (
                <Text variant="titleSmall" style={{ color: theme.colors.primary, fontWeight: '700', marginTop: 4 }}>
                  {formatCurrency(item.value, item.currency ?? '₪')}
                </Text>
              ) : null}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                {leadTaskMap.get(item.id) ? (
                  <LeadTaskBadge info={leadTaskMap.get(item.id)!} t={t} formatDate={formatDate} />
                ) : null}
                {(item as any).score ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 1, backgroundColor: withAlpha(scoreColor((item as any).score), 0.16), borderRadius: 8, paddingHorizontal: 5, paddingVertical: 1 }}>
                    <MaterialCommunityIcons name="fire" size={12} color={scoreColor((item as any).score)} />
                    <Text style={{ fontSize: 10, fontWeight: '700', color: scoreColor((item as any).score) }}>{Number((item as any).score)}</Text>
                  </View>
                ) : null}
                {item.priority ? (
                  <MaterialCommunityIcons name="flag" size={14} color={PRIORITY_COLORS[item.priority] || theme.colors.onSurfaceVariant} />
                ) : null}
              </View>
            </Pressable>
          )}
          />
        </View>
      )}

      <FAB
        icon="plus"
        onPress={() => router.push({ pathname: '/(tabs)/leads/[id]', params: { id: 'new' } })}
        style={[styles.fab, { backgroundColor: theme.colors.primary, bottom: insets.bottom + 16, left: isRTL ? 16 : undefined, right: isRTL ? undefined : 16 }]}
        color="#FFF"
      />

      <Portal>
        <Modal
          visible={advancedFilterVisible}
          onDismiss={() => setAdvancedFilterVisible(false)}
          contentContainerStyle={[
            styles.advancedFilterModal,
            { backgroundColor: theme.colors.surface },
          ]}
        >
          <Text variant="titleLarge" style={{ color: theme.colors.onSurface, fontWeight: '700', marginBottom: 16 }}>
            {t('leads.advancedFilter', 'Advanced Filter')}
          </Text>

          <ScrollView showsVerticalScrollIndicator={false} style={{ flexShrink: 1 }}>
            <PaperInput
              label={t('leads.owner', 'Owner')}
              value={filterOwner}
              onChangeText={setFilterOwner}
              mode="outlined"
              style={{ marginBottom: 12 }}
              outlineColor={theme.colors.outline}
              activeOutlineColor={theme.colors.primary}
              left={<PaperInput.Icon icon="account-outline" />}
            />

            {filterOptions.source && filterOptions.source.length > 0 ? (
              <>
                <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 6, marginTop: 4 }}>
                  {t('leads.source', 'Source')}
                </Text>
                <OptionChips options={filterOptions.source} value={filterSource} onChange={setFilterSource} theme={theme} />
              </>
            ) : (
              <PaperInput
                label={t('leads.source', 'Source')}
                value={filterSource}
                onChangeText={setFilterSource}
                mode="outlined"
                style={{ marginBottom: 12 }}
                outlineColor={theme.colors.outline}
                activeOutlineColor={theme.colors.primary}
                left={<PaperInput.Icon icon="source-branch" />}
              />
            )}

            <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 6, marginTop: 4 }}>
              {t('leads.status', 'Status')}
            </Text>
            <View style={styles.filterChipRow}>
              {STATUS_OPTIONS.map((st) => {
                const isSelected = filterStatus === st;
                return (
                  <Chip
                    key={st}
                    selected={isSelected}
                    onPress={() => setFilterStatus(isSelected ? '' : st)}
                    compact
                    style={[
                      styles.filterChip,
                      isSelected
                        ? { backgroundColor: withAlpha(theme.colors.primary, 0.145), borderColor: theme.colors.primary, borderWidth: 1 }
                        : { backgroundColor: theme.colors.surfaceVariant },
                    ]}
                    textStyle={{
                      fontSize: 12,
                      color: isSelected ? theme.colors.primary : theme.colors.onSurfaceVariant,
                      fontWeight: isSelected ? '600' : '400',
                    }}
                  >
                    {st}
                  </Chip>
                );
              })}
            </View>

            <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 6, marginTop: 12 }}>
              {t('tasks.priority', 'Priority')}
            </Text>
            <View style={styles.filterChipRow}>
              {PRIORITY_OPTIONS.map((p) => {
                const isSelected = filterPriority === p;
                return (
                  <Chip
                    key={p}
                    selected={isSelected}
                    onPress={() => setFilterPriority(isSelected ? '' : p)}
                    compact
                    style={[
                      styles.filterChip,
                      isSelected
                        ? { backgroundColor: withAlpha(theme.colors.primary, 0.145), borderColor: theme.colors.primary, borderWidth: 1 }
                        : { backgroundColor: theme.colors.surfaceVariant },
                    ]}
                    textStyle={{
                      fontSize: 12,
                      color: isSelected ? theme.colors.primary : theme.colors.onSurfaceVariant,
                      fontWeight: isSelected ? '600' : '400',
                    }}
                  >
                    {t(`tasks.${p}`, p)}
                  </Chip>
                );
              })}
            </View>

            <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 6, marginTop: 12 }}>
              {t('leads.dateRange', 'Date Range')}
            </Text>
            <View style={styles.filterChipRow}>
              {DATE_RANGE_PRESETS.map((dr) => {
                const isSelected = filterDateRange === dr;
                return (
                  <Chip
                    key={dr}
                    selected={isSelected}
                    onPress={() => setFilterDateRange(isSelected ? '' : dr)}
                    compact
                    style={[
                      styles.filterChip,
                      isSelected
                        ? { backgroundColor: withAlpha(theme.colors.primary, 0.145), borderColor: theme.colors.primary, borderWidth: 1 }
                        : { backgroundColor: theme.colors.surfaceVariant },
                    ]}
                    textStyle={{
                      fontSize: 12,
                      color: isSelected ? theme.colors.primary : theme.colors.onSurfaceVariant,
                      fontWeight: isSelected ? '600' : '400',
                    }}
                  >
                    {dr}
                  </Chip>
                );
              })}
            </View>

            {attributionFilters
              .filter((f) => (filterOptions[f.key] || []).length > 0)
              .map((f) => (
                <View key={f.key}>
                  <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 6, marginTop: 12 }}>
                    {f.label}
                  </Text>
                  <OptionChips options={filterOptions[f.key]} value={f.value} onChange={f.set} theme={theme} />
                </View>
              ))}
          </ScrollView>

          <View style={{ flexDirection: 'row', gap: 12, justifyContent: 'flex-end', marginTop: 16 }}>
            <Button
              mode="outlined"
              onPress={() => {
                setFilterSource('');
                setFilterOwner('');
                setFilterStatus('');
                setFilterPriority('');
                setFilterDateRange('');
                setFilterUtmSource('');
                setFilterUtmMedium('');
                setFilterUtmCampaign('');
                setFilterCampaignId('');
                setFilterFormId('');
                setFilterAdId('');
              }}
              textColor={theme.colors.onSurface}
            >
              {t('common.refresh', 'Clear')}
            </Button>
            <Button
              mode="contained"
              onPress={() => setAdvancedFilterVisible(false)}
              buttonColor={theme.colors.primary}
              textColor="#FFF"
            >
              {t('common.confirm', 'Apply')}
            </Button>
          </View>
        </Modal>
      </Portal>

      <Portal>
        <Modal
          visible={!!stagePickerLead}
          onDismiss={() => setStagePickerLead(null)}
          contentContainerStyle={[styles.stageModal, { backgroundColor: theme.colors.surface }]}
        >
          <Text variant="titleMedium" style={{ color: theme.colors.onSurface, fontWeight: '700', marginBottom: 4 }}>
            {t('leads.moveStage')}
          </Text>
          {stagePickerLead ? (
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 16 }}>
              {stagePickerLead.title}
            </Text>
          ) : null}
          {stageKeys.map((stage) => {
            const color = stageColor(stage);
            const isCurrent = stagePickerLead?.stageName === stage || stagePickerLead?.stage === stage;
            return (
              <Pressable
                key={stage}
                onPress={() => stagePickerLead && handleStageChange(stagePickerLead, stage)}
                disabled={isCurrent}
                style={({ pressed }) => [
                  styles.stageOption,
                  {
                    backgroundColor: isCurrent
                      ? withAlpha(color, 0.12)
                      : pressed
                        ? theme.colors.surfaceVariant
                        : 'transparent',
                  },
                ]}
              >
                <View style={[styles.stageOptionDot, { backgroundColor: color }]} />
                <Text
                  variant="bodyMedium"
                  style={{
                    flex: 1,
                    color: isCurrent ? color : theme.colors.onSurface,
                    fontWeight: isCurrent ? '700' : '400',
                  }}
                >
                  {t(STAGE_I18N[stage] ?? stage)}
                </Text>
                {isCurrent ? (
                  <MaterialCommunityIcons name="check" size={20} color={color} />
                ) : null}
              </Pressable>
            );
          })}
          <Button
            mode="text"
            onPress={() => setStagePickerLead(null)}
            style={{ marginTop: 8 }}
            textColor={theme.colors.onSurfaceVariant}
          >
            {t('common.cancel')}
          </Button>
        </Modal>
      </Portal>

      {/* Save View Modal */}
      <Portal>
        <Modal
          visible={showSaveViewModal}
          onDismiss={() => { setShowSaveViewModal(false); setNewViewName(''); }}
          contentContainerStyle={[styles.stageModal, { backgroundColor: theme.colors.surface }]}
        >
          <Text variant="titleMedium" style={{ color: theme.colors.onSurface, marginBottom: 16 }}>
            {t('sidebar.saveCurrentView', 'שמור תצוגה נוכחית')}
          </Text>
          <PaperInput
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
        visible={!!ownershipSnackbar}
        onDismiss={() => setOwnershipSnackbar('')}
        duration={2000}
        style={{ marginBottom: 70 }}
      >
        {ownershipSnackbar}
      </Snackbar>

      {/* Won Celebration */}
      <RNModal visible={!!wonCelebration} transparent animationType="fade" onRequestClose={() => setWonCelebration(null)}>
        <Pressable style={celebStyles.overlay} onPress={() => setWonCelebration(null)}>
          <View style={celebStyles.card}>
            <Text style={celebStyles.trophy}>🏆</Text>
            <Text style={celebStyles.wonTitle}>Deal Won!</Text>
            <Text style={celebStyles.wonLeadName}>{wonCelebration?.title}</Text>
            {wonCelebration?.value ? (
              <Text style={celebStyles.wonValue}>
                {formatCurrency(Number(wonCelebration.value), 'ILS')}
              </Text>
            ) : null}
            <Button mode="contained" onPress={() => setWonCelebration(null)} style={{ marginTop: 16 }}>
              {t('common.close', 'סגור')}
            </Button>
          </View>
        </Pressable>
      </RNModal>

      {/* Auto-Quote Prompt */}
      <RNModal visible={!!autoQuotePrompt} transparent animationType="slide" onRequestClose={() => setAutoQuotePrompt(null)}>
        <Pressable style={celebStyles.overlay} onPress={() => setAutoQuotePrompt(null)}>
          <Pressable style={celebStyles.quoteCard} onPress={() => {}}>
            <Text style={celebStyles.quoteEmoji}>📄</Text>
            <Text style={celebStyles.quoteTitle}>יצירת הצעת מחיר</Text>
            <Text style={celebStyles.quoteSubtitle}>
              {(autoQuotePrompt?.config?.quoteTitle || 'הצעת מחיר - {{leadTitle}}').replace('{{leadTitle}}', autoQuotePrompt?.lead?.title || '')}
            </Text>
            <View style={{ gap: 10, width: '100%', marginTop: 16 }}>
              <Button mode="contained" icon="send" loading={autoQuoteLoading} onPress={() => handleAutoQuoteAction('createAndSend')} buttonColor="#25d366" textColor="#fff">
                צור ושלח ללקוח
              </Button>
              <Button mode="contained" icon="link-variant" loading={autoQuoteLoading} onPress={() => handleAutoQuoteAction('createAndNavigate')} buttonColor="#3b82f6" textColor="#fff">
                צור ונווט להצעה
              </Button>
              <Button mode="outlined" loading={autoQuoteLoading} onPress={() => handleAutoQuoteAction('create')}>
                צור בלבד
              </Button>
              <Button mode="text" onPress={() => setAutoQuotePrompt(null)} textColor="#9ca3af">
                ביטול
              </Button>
            </View>
          </Pressable>
        </Pressable>
      </RNModal>
    </View>
  );
}

const celebStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 32,
    alignItems: 'center',
    width: '80%',
    maxWidth: 340,
    elevation: 10,
  },
  trophy: { fontSize: 56, marginBottom: 12 },
  wonTitle: { fontSize: 24, fontWeight: '800', color: '#1f2937', marginBottom: 4 },
  wonLeadName: { fontSize: 16, color: '#6b7280', textAlign: 'center' },
  wonValue: { fontSize: 20, fontWeight: '700', color: '#16a34a', marginTop: 8 },
  quoteCard: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 28,
    alignItems: 'center',
    width: '85%',
    maxWidth: 380,
    elevation: 10,
  },
  quoteEmoji: { fontSize: 40, marginBottom: 8 },
  quoteTitle: { fontSize: 20, fontWeight: '700', color: '#1f2937', textAlign: 'center' },
  quoteSubtitle: { fontSize: 14, color: '#6b7280', textAlign: 'center', marginTop: 6 },
});

const styles = StyleSheet.create({
  screen: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingBottom: 4,
  },
  headerTitle: { fontSize: 22, fontWeight: '700', color: '#FFF' },
  headerActions: { alignItems: 'center', gap: 4 },
  headerBtn: { padding: 4 },
  searchWrap: {
    paddingHorizontal: 14,
    overflow: 'hidden',
    justifyContent: 'center',
    paddingBottom: 2,
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
  stageFilters: {
    gap: 6,
    alignItems: 'center',
    paddingVertical: 4,
  },
  stageChip: { height: 28 },
  stageChipText: { fontSize: 11, lineHeight: 16, marginVertical: 0 },
  listContent: { paddingTop: 4, paddingBottom: 100 },
  leadRow: {
    alignItems: 'stretch',
    paddingTop: 10,
    paddingBottom: 10,
    gap: 14,
    overflow: 'hidden',
  },
  quickDialRow: {
    alignItems: 'center',
    marginTop: 6,
    gap: 2,
    paddingVertical: 2,
  },
  stageStripe: {
    width: 4,
    borderTopRightRadius: 2,
    borderBottomRightRadius: 2,
  },
  leadBody: { flex: 1, gap: 4 },
  leadTop: { alignItems: 'center', justifyContent: 'space-between' },
  leadMeta: { alignItems: 'center', gap: 12, marginTop: 2 },
  metaChip: { alignItems: 'center' },
  leadBottom: { alignItems: 'center', justifyContent: 'space-between', marginTop: 6 },
  pipelineContainer: {
    paddingHorizontal: 8,
    paddingTop: 0,
    paddingBottom: 100,
    gap: 6,
  },
  pipelineColumn: {
    borderRadius: 12,
    overflow: 'hidden',
    flex: 1,
  },
  pipelineHeader: {
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 6,
  },
  pipelineHeaderDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  pipelineCount: {
    minWidth: 26,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  pipelineCards: { paddingHorizontal: 8, paddingTop: 2, paddingBottom: 12, gap: 6 },
  pipelineCard: {
    borderRadius: 10,
    padding: 12,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
  },
  pipelineCardMeta: { alignItems: 'center', marginTop: 6 },
  pipelineEmpty: {
    alignItems: 'center',
    paddingVertical: 16,
  },
  advancedFilterModal: {
    marginHorizontal: 20,
    borderRadius: 16,
    padding: 20,
    maxHeight: '80%',
  },
  filterChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 4,
  },
  filterChip: { height: 30 },
  stageModal: {
    marginHorizontal: 24,
    borderRadius: 16,
    padding: 20,
  },
  stageOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    gap: 12,
    marginBottom: 2,
  },
  stageOptionDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  emptyWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    paddingHorizontal: 40,
  },
  fab: { position: 'absolute', borderRadius: 16 },
});
