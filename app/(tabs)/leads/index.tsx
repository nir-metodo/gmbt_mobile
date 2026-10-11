import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  View,
  StyleSheet,
  Pressable,
  RefreshControl,
  ScrollView,
  Alert,
  Linking,
  Modal as RNModal,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Text, Searchbar, Chip, FAB, Avatar, Divider, Surface, Portal, Modal, Button, TextInput as PaperInput, ActivityIndicator, IconButton, Snackbar, Menu } from 'react-native-paper';
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
import { formatCurrency, formatDate, formatRelativeTime, getInitials, withAlpha } from '../../../utils/formatters';
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

// yyyy-MM-dd in local time (the backend interprets dateFrom/dateTo as Israel-local days).
function ymd(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

// Resolve an advanced-filter date preset into the dateFrom/dateTo the backend actually understands.
function presetToRange(preset: string): { dateFrom?: string; dateTo?: string } {
  if (!preset) return {};
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (preset) {
    case 'Today':
      return { dateFrom: ymd(start), dateTo: ymd(start) };
    case 'This Week': {
      const from = new Date(start);
      from.setDate(start.getDate() - start.getDay()); // week starts Sunday (Israel)
      return { dateFrom: ymd(from), dateTo: ymd(start) };
    }
    case 'This Month':
      return { dateFrom: ymd(new Date(now.getFullYear(), now.getMonth(), 1)), dateTo: ymd(start) };
    case 'Last Month':
      return {
        dateFrom: ymd(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
        dateTo: ymd(new Date(now.getFullYear(), now.getMonth(), 0)),
      };
    case 'This Year':
      return { dateFrom: ymd(new Date(now.getFullYear(), 0, 1)), dateTo: ymd(start) };
    default:
      return {};
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;
const STALE_DAYS = 7;
const OTHER_COLUMN_ID = '__other';

// Sum lead values per currency symbol (a column / list can mix currencies).
function summarizeValue(leads: Lead[]): string {
  const totals = new Map<string, number>();
  leads.forEach((l) => {
    const v = Number(l.value);
    if (!v || v <= 0) return;
    const cur = l.currency ?? '₪';
    totals.set(cur, (totals.get(cur) || 0) + v);
  });
  return Array.from(totals.entries())
    .map(([cur, sum]) => `${cur}${Math.round(sum).toLocaleString('he-IL')}`)
    .join(' · ');
}

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

// One-tap filter pill used by the quick-filter row.
function QuickChip({
  theme,
  icon,
  label,
  color,
  active,
  onPress,
  count,
  caret,
  disabled,
}: {
  theme: any;
  icon: string;
  label: string;
  color: string;
  active?: boolean;
  onPress: () => void;
  count?: number;
  caret?: boolean;
  disabled?: boolean;
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

export default function LeadsListScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useAppTheme();
  const { isRTL, flexDirection, textAlign } = useRTL();
  const { t } = useTranslation();
  // Inline he/en strings for the new UI (no i18n file changes).
  const tr = useCallback((he: string, en: string) => (isRTL ? he : en), [isRTL]);

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
  const [advancedFilterVisible, setAdvancedFilterVisible] = useState(false);
  const [moreMenuVisible, setMoreMenuVisible] = useState(false);
  const [sortMenuVisible, setSortMenuVisible] = useState(false);
  const [stageFilterVisible, setStageFilterVisible] = useState(false);
  // One-tap client-side quick filters (combine with saved views / advanced filter / task chips).
  type QuickFilterKey = 'hot' | 'today' | 'unassigned' | 'highValue' | 'stale';
  const [quickFilters, setQuickFilters] = useState<QuickFilterKey[]>([]);
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
    // Stage + owner are filtered client-side: the backend matches stages by stageId and owners by
    // ownerId, while the UI picks stage NAMES / free-text owner names (so server filtering matched nothing).
    sources: filterSource.trim() ? [filterSource.trim()] : [],
    statuses: filterStatus ? [filterStatus] : [],
    priorities: filterPriority ? [filterPriority] : [],
    // The backend ignores dateRangePreset (it only reads dateFrom/dateTo), so resolve the preset here.
    ...presetToRange(filterDateRange),
    utmSource: filterUtmSource.trim(),
    utmMedium: filterUtmMedium.trim(),
    utmCampaign: filterUtmCampaign.trim(),
    campaignId: filterCampaignId.trim(),
    formId: filterFormId.trim(),
    adId: filterAdId.trim(),
  }), [debouncedSearch, filterSource, filterStatus, filterPriority, filterDateRange, filterUtmSource, filterUtmMedium, filterUtmCampaign, filterCampaignId, filterFormId, filterAdId]);

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

  // Data scope sent with every request: "Mine" and own-only roles are enforced server-side.
  const requestScope = useCallback(() => {
    const ownOnly = filterMine || getDataVisibility(user?.DataVisibility, user?.SecurityRole, 'leads') === 'own';
    return {
      dataVisibility: ownOnly ? 'own' : 'seeAll',
      userId: ownOnly ? (user?.uID || user?.userId || '') : '',
    };
  }, [filterMine, user]);

  // Monotonic request id: a newer request (filter change / refresh / load-all) supersedes any
  // in-flight one so a slow earlier response can never overwrite fresher data.
  const requestSeqRef = useRef(0);

  // ── Fetch a page ────────────────────────────────────────────────────────────
  const fetchPage = useCallback(async (pageNum: number, reset: boolean) => {
    if (!organization) return;
    // Load-more calls are serialised; a reset (filter change / refresh) always runs and wins.
    if (!reset && fetchingRef.current) return;
    const seq = reset ? ++requestSeqRef.current : requestSeqRef.current;
    fetchingRef.current = true;
    if (reset) { setIsLoading(true); setLoadingMore(false); setLoadingAll(false); } else setLoadingMore(true);
    try {
      const result = await leadsApi.getAll(organization, {
        page: pageNum,
        pageSize: PAGE_SIZE,
        filters: buildFilters(),
        ...requestScope(),
      });
      if (seq !== requestSeqRef.current) return; // superseded
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
      if (seq === requestSeqRef.current) {
        fetchingRef.current = false;
        if (reset) setIsLoading(false); else setLoadingMore(false);
      }
    }
  }, [organization, buildFilters, requestScope]);

  // ── Load EVERYTHING in one request ──────────────────────────────────────────
  // The web has a "load all" action; mirror it here. A single large-pageSize request
  // (the lead store already uses pageSize 5000) is reliable, unlike firing many
  // paged requests in parallel. This is also what the Kanban board and every client-side
  // filter (stage, owner, quick chips, task buckets) need: they only see loaded leads.
  const fetchAll = useCallback(async () => {
    if (!organization) return;
    const seq = ++requestSeqRef.current;
    fetchingRef.current = true;
    setLoadingAll(true);
    setLoadingMore(false);
    try {
      const result = await leadsApi.getAll(organization, {
        page: 1,
        pageSize: 5000,
        filters: buildFilters(),
        ...requestScope(),
      });
      if (seq !== requestSeqRef.current) return; // superseded
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
      if (seq === requestSeqRef.current) {
        fetchingRef.current = false;
        setLoadingAll(false);
        setIsLoading(false);
      }
    }
  }, [organization, buildFilters, requestScope]);

  // ── Debounced search ────────────────────────────────────────────────────────
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Client-side filters / the Board need the WHOLE dataset in memory: a plain page-1 reset would
  // shrink the pool to the first 30 leads and make them look empty/broken. So while any of them
  // is active we load everything instead of paging.
  const needsAll =
    !!taskQuickFilter ||
    viewMode === 'pipeline' ||
    !!selectedStage ||
    !!filterOwner.trim() ||
    unseenOnly ||
    quickFilters.length > 0;

  // ── Initial load & filter change → reset ───────────────────────────────────
  useEffect(() => {
    if (!organization) return;
    if (needsAll) {
      fetchAll();
    } else {
      fetchPage(1, true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organization, needsAll, debouncedSearch, filterSource, filterStatus, filterPriority, filterDateRange, filterMine, filterUtmSource, filterUtmMedium, filterUtmCampaign, filterCampaignId, filterFormId, filterAdId]);

  // Pipeline stages (colors / won / auto-quote config) only depend on the org.
  useEffect(() => {
    if (!organization) return;
    leadsApi.getPipelineSettings(organization)
      .then((res) => { if (res.stages.length > 0) setPipelineStages(res.stages); })
      .catch(() => {});
  }, [organization]);

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
    // Combines with the other filters (Mine, quick chips, saved view, advanced). The full lead
    // dataset is loaded by the needsAll effect as soon as a task filter is active.
    setTaskQuickFilter(type);
    setTaskFilterLoading(true);
    try {
      // Always recompute the task→lead buckets from fresh task data on tap, so the filter
      // reflects the latest statuses/due dates (not a stale snapshot from screen mount).
      await fetchActiveTasksForCards();
    } finally {
      setTaskFilterLoading(false);
    }
  }, [taskQuickFilter, fetchActiveTasksForCards]);

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
        if (updated && (updated.stageName !== local.stageName || updated.stage !== local.stage || updated.ownerName !== (local as any).ownerName || (updated as any).modifiedOn !== (local as any).modifiedOn)) {
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
        // Keep the full dataset loaded when a client-side filter / the Board is active so returning
        // from a lead detail doesn't collapse the pool to page 1 and empty out the filtered list.
        if (needsAll) {
          fetchAll();
        } else {
          fetchPage(1, true);
        }
        fetchActiveTasksForCards();
      }
    }, [organization, fetchPage, fetchAll, fetchActiveTasksForCards, needsAll])
  );

  const loadSavedView = useCallback((view: SavedView) => {
    const viewData = view.ViewData || {};
    const filters = viewData.filters || {};
    setActiveViewId(view.id);
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
    // Quick chips / "Mine" are saved with the view too (older views simply don't have them).
    setQuickFilters(Array.isArray(filters.quick) ? filters.quick : []);
    setFilterMine(!!filters.mine);
    setSearchQuery(viewData.searchTerm ?? '');
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
    setQuickFilters([]);
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
          quick: quickFilters,
          mine: filterMine,
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
        setActiveViewId(newView.id);
      }
    } catch {}
    setShowSaveViewModal(false);
    setNewViewName('');
    setSaveViewVisibility('personal');
  }, [newViewName, organization, user, quickFilters, filterMine, selectedStage, filterSource, filterOwner, filterStatus, filterPriority, filterDateRange, filterUtmSource, filterUtmMedium, filterUtmCampaign, filterCampaignId, filterFormId, filterAdId, searchQuery, userIsAdmin, saveViewVisibility]);

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

  const parseTs = useCallback((val: any): number => {
    if (!val) return 0;
    if (typeof val === 'number') return val;
    if (val._seconds) return val._seconds * 1000;
    if (val.seconds) return val.seconds * 1000;
    const d = new Date(val);
    return isNaN(d.getTime()) ? 0 : d.getTime();
  }, []);

  const createdTs = useCallback((l: any) => parseTs(l.createdOn || l.CreatedOn || l.createdAt), [parseTs]);
  // Last activity = last modification, falling back to creation.
  const lastActivityTs = useCallback(
    (l: any) => parseTs(l.modifiedOn || l.ModifiedOn || l.updatedOn || l.UpdatedOn || l.updatedAt) || createdTs(l),
    [parseTs, createdTs],
  );

  // Won / lost leads are "closed" — never flagged as stale.
  const isClosedLead = useCallback((lead: Lead) => {
    const s = pipelineStages.find(
      (st) => st.id === lead.stageId || st.name === lead.stageName || st.name === lead.stage || st.id === lead.stageName,
    );
    if (s) return !!(s.isWon || s.isLost);
    return /closed|won|lost/i.test(lead.stageName || lead.stage || '');
  }, [pipelineStages]);

  // "High value" chip threshold: top quartile of the loaded leads' values, rounded to 2 significant digits.
  const highValueThreshold = useMemo(() => {
    const vals = leads.map((l) => Number(l.value) || 0).filter((v) => v > 0).sort((a, b) => a - b);
    if (vals.length < 4) return 10000;
    const q = vals[Math.floor(vals.length * 0.75)];
    const mag = Math.pow(10, Math.max(0, String(Math.round(q)).length - 2));
    return Math.max(1, Math.round(q / mag) * mag);
  }, [leads]);

  // Distinct owner names in the loaded leads — drives the advanced-filter owner picker.
  const ownerOptions = useMemo(() => {
    const set = new Set<string>();
    leads.forEach((l) => { const n = (l as any).ownerName; if (n) set.add(String(n)); });
    if (filterOwner.trim()) set.add(filterOwner.trim());
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [leads, filterOwner]);

  // Every client-side filter (unseen, task bucket, owner, quick chips) applied to the loaded leads.
  // Shared by the List and the Board so both always show the same set.
  const baseLeads = useMemo(() => {
    const ownerQ = filterOwner.trim().toLowerCase();
    const now = Date.now();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayMs = todayStart.getTime();
    const taskIds = taskQuickFilter ? taskFilterSets[taskQuickFilter] : null;
    const hot = quickFilters.includes('hot');
    const today = quickFilters.includes('today');
    const unassigned = quickFilters.includes('unassigned');
    const highValue = quickFilters.includes('highValue');
    const stale = quickFilters.includes('stale');
    return leads.filter((l: any) => {
      if (unseenOnly && seenLeadIds.has(l.id)) return false;
      if (taskIds && !taskIds.has(l.id)) return false;
      if (ownerQ && !`${l.ownerName || ''} ${l.ownerId || ''} ${l.owner || ''}`.toLowerCase().includes(ownerQ)) return false;
      if (hot && !(l.priority === 'high' || Number(l.score) >= 4)) return false;
      if (today && createdTs(l) < todayMs) return false;
      if (unassigned && (l.ownerId || l.ownerName || l.owner)) return false;
      if (highValue && !(Number(l.value) >= highValueThreshold)) return false;
      if (stale && (isClosedLead(l) || now - lastActivityTs(l) < STALE_DAYS * DAY_MS)) return false;
      return true;
    });
  }, [leads, unseenOnly, seenLeadIds, taskQuickFilter, taskFilterSets, filterOwner, quickFilters, highValueThreshold, createdTs, lastActivityTs, isClosedLead]);

  // Board leads: same filters as the list (the Board's columns ARE the stages, so no stage filter).
  const pipelineLeads = baseLeads;

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

  const filteredLeads = useMemo(() => {
    const result = selectedStage
      ? baseLeads.filter((lead) => getLeadStageName(lead) === selectedStage)
      : [...baseLeads];

    result.sort((a: any, b: any) => {
      let aVal: any, bVal: any;
      if (sortKey === 'createdOn') {
        aVal = parseTs(a.createdOn || a.CreatedOn || a.createdAt);
        bVal = parseTs(b.createdOn || b.CreatedOn || b.createdAt);
      } else if (sortKey === 'modifiedOn') {
        // Fall back to createdOn when a lead has no modifiedOn so it still orders sensibly.
        aVal = lastActivityTs(a);
        bVal = lastActivityTs(b);
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
  }, [baseLeads, selectedStage, getLeadStageName, sortKey, sortDir, parseTs, lastActivityTs]);

  // Order each Kanban column newest-first (by last-modified, falling back to created), so a
  // card just dragged into a column — whose timestamp we bump on move — appears at the top.
  const sortByRecency = useCallback((arr: Lead[]) => {
    const recency = (l: any) => Math.max(lastActivityTs(l), createdTs(l));
    return [...arr].sort((a, b) => recency(b) - recency(a));
  }, [lastActivityTs, createdTs]);

  const kanbanColumns = useMemo<KanbanColumn<Lead>[]>(() => {
    // When the real pipeline is loaded, build columns keyed by the stable stage id and
    // match leads by stageId first (like the web), falling back to name/id stored on the
    // lead. Grouping by display name alone hid every lead whose stored stage didn't map
    // back to a name key (custom pipelines), leaving the board empty.
    if (pipelineStages.length > 0) {
      const matched = new Set<string>();
      const cols: KanbanColumn<Lead>[] = pipelineStages.map((s) => {
        const items = sortByRecency(pipelineLeads.filter(
          (l) =>
            l.stageId === s.id ||
            l.stageName === s.name ||
            l.stage === s.name ||
            l.stageName === s.id ||
            l.stage === s.id,
        ));
        items.forEach((l) => matched.add(l.id));
        return {
          id: s.id,
          title: STAGE_I18N[s.name] ? t(STAGE_I18N[s.name]) : s.name,
          color: s.color ?? stageColorMap[s.id] ?? theme.colors.primary,
          subtitle: summarizeValue(items) || '—',
          items,
        };
      });
      // Leads whose stored stage no longer exists in the pipeline would otherwise be invisible on the board.
      const orphans = pipelineLeads.filter((l) => !matched.has(l.id));
      if (orphans.length > 0) {
        cols.push({
          id: OTHER_COLUMN_ID,
          title: tr('ללא שלב', 'No stage'),
          color: '#9ca3af',
          subtitle: summarizeValue(orphans) || '—',
          items: sortByRecency(orphans),
        });
      }
      return cols;
    }
    // No pipeline settings loaded → fall back to the default keys grouped by display name.
    return DEFAULT_STAGE_KEYS.map((stage) => {
      const items = sortByRecency(leadsByStage.get(stage) ?? []);
      return {
        id: stage,
        title: t(STAGE_I18N[stage] ?? stage),
        color: stageColorMap[stage] ?? theme.colors.primary,
        subtitle: summarizeValue(items) || '—',
        items,
      };
    });
  }, [pipelineStages, pipelineLeads, stageColorMap, leadsByStage, t, tr, theme.colors.primary, sortByRecency]);

  // Totals line (count + currency-aware value) for whatever the active view currently shows.
  const visibleLeads = viewMode === 'pipeline' ? pipelineLeads : filteredLeads;
  const totalsSummary = useMemo(() => summarizeValue(visibleLeads), [visibleLeads]);

  // Number of active filters (everything except free-text search) → badge on the filter button.
  const activeFilterCount = useMemo(() => {
    const flags = [
      selectedStage, filterSource, filterOwner.trim(), filterStatus, filterPriority, filterDateRange,
      filterUtmSource, filterUtmMedium, filterUtmCampaign, filterCampaignId, filterFormId, filterAdId,
    ].filter(Boolean).length;
    return flags + quickFilters.length + (filterMine ? 1 : 0) + (unseenOnly ? 1 : 0) + (taskQuickFilter ? 1 : 0);
  }, [selectedStage, filterSource, filterOwner, filterStatus, filterPriority, filterDateRange, filterUtmSource, filterUtmMedium, filterUtmCampaign, filterCampaignId, filterFormId, filterAdId, quickFilters, filterMine, unseenOnly, taskQuickFilter]);

  const hasAnyFilter = activeFilterCount > 0 || !!searchQuery.trim();

  const toggleQuickFilter = useCallback((key: QuickFilterKey) => {
    setQuickFilters((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }, []);

  // Switching between List and Board. The Board's columns are the stages, so a list stage filter is dropped.
  const switchView = useCallback((mode: 'list' | 'pipeline') => {
    if (mode === viewMode) return;
    if (mode === 'pipeline') setSelectedStage(null);
    setViewMode(mode);
  }, [viewMode, setViewMode]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    // Preserve the full dataset when a client-side filter / the Board is active (a page-1 reset would empty it).
    await Promise.all([needsAll ? fetchAll() : fetchPage(1, true), fetchActiveTasksForCards()]);
    setRefreshing(false);
  }, [fetchPage, fetchAll, fetchActiveTasksForCards, needsAll]);

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
    if (toColumnId === OTHER_COLUMN_ID) return; // read-only "no stage" bucket — can't move a lead into it
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

  const callLead = useCallback((lead: Lead) => {
    const phone = lead.contactPhone || lead.phoneNumber || '';
    if (!phone) return;
    placeSmartCall({
      phoneNumber: phone,
      organization,
      user,
      relatedTo: { type: 'lead', entityId: lead.id || '', entityName: lead.title },
      leadId: lead.id || '',
      customerName: lead.contactName,
    });
  }, [organization, user]);

  // "Last activity" label (modified → created), e.g. "לפני 3 ימים" / "3 days ago".
  const activityLabel = useCallback((lead: Lead): string => {
    const ts = lastActivityTs(lead);
    return ts ? formatRelativeTime(new Date(ts).toISOString(), isRTL ? 'he' : 'en') : '';
  }, [lastActivityTs, isRTL]);

  const renderLeadItem = useCallback(
    ({ item }: { item: Lead; index?: number }) => {
      const stageName = getLeadStageName(item);
      const sColor = stageColor(stageName);
      const phone = item.contactPhone || item.phoneNumber || '';
      const company = (item as any).companyName as string | undefined;
      const sub = [company || item.contactName, phone].filter(Boolean).join('  ·  ');
      const task = leadTaskMap.get(item.id);
      const activity = activityLabel(item);
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
          },
        ]}
      >
        <View style={[styles.stageStripe, { backgroundColor: sColor }]} />

        <View style={styles.leadBody}>
          {/* Row 1: name + value */}
          <View style={[styles.leadTop, { flexDirection }]}>
            {!seenLeadIds.has(item.id) && <View style={styles.unseenDot} />}
            <Text
              variant="titleSmall"
              numberOfLines={1}
              style={{ color: theme.colors.onSurface, fontWeight: '700', flex: 1, textAlign }}
            >
              {item.title}
            </Text>
            {item.value != null && item.value > 0 ? (
              <Text variant="titleSmall" style={{ color: theme.colors.primary, fontWeight: '700' }}>
                {formatCurrency(item.value, item.currency ?? '₪')}
              </Text>
            ) : null}
          </View>

          {/* Row 2: company / contact · phone, last activity */}
          <View style={[styles.leadTop, { flexDirection }]}>
            <Text
              variant="bodySmall"
              numberOfLines={1}
              style={{ color: theme.colors.onSurfaceVariant, flex: 1, textAlign }}
            >
              {sub || ' '}
            </Text>
            {activity ? (
              <Text style={{ fontSize: 11, color: theme.colors.onSurfaceVariant }} numberOfLines={1}>
                {activity}
              </Text>
            ) : null}
          </View>

          {/* Row 3: stage pill, signals, owner */}
          <View style={[styles.leadBottom, { flexDirection }]}>
            <View style={[styles.stagePill, { backgroundColor: withAlpha(sColor, 0.16) }]}>
              <Text style={{ fontSize: 11, fontWeight: '600', color: sColor }} numberOfLines={1}>
                {stageName}
              </Text>
            </View>
            {task ? <LeadTaskBadge info={task} t={t} formatDate={formatDate} /> : null}
            {(item as any).score ? (
              <View style={[styles.signalChip, { backgroundColor: withAlpha(scoreColor((item as any).score), 0.16) }]}>
                <MaterialCommunityIcons name="fire" size={12} color={scoreColor((item as any).score)} />
                <Text style={{ fontSize: 10, fontWeight: '700', color: scoreColor((item as any).score) }}>{Number((item as any).score)}</Text>
              </View>
            ) : null}
            {item.priority ? (
              <MaterialCommunityIcons name="flag" size={14} color={PRIORITY_COLORS[item.priority] || theme.colors.onSurfaceVariant} />
            ) : null}
            {item.source ? (
              <Text variant="labelSmall" numberOfLines={1} style={{ color: theme.colors.onSurfaceVariant, flexShrink: 1 }}>
                {item.source}
              </Text>
            ) : null}
            <View style={{ flex: 1 }} />
            <OwnerAvatar name={(item as any).ownerName} theme={theme} />
          </View>
        </View>

        {phone ? (
          <Pressable
            onPress={() => callLead(item)}
            hitSlop={6}
            style={[styles.callBtn, { backgroundColor: withAlpha(theme.colors.primary, 0.1) }]}
          >
            <MaterialCommunityIcons name="phone-outline" size={18} color={theme.colors.primary} />
          </Pressable>
        ) : null}
      </Pressable>
    );},
    [theme, flexDirection, textAlign, openLead, stageColor, t, getLeadStageName, seenLeadIds, leadTaskMap, activityLabel, callLead],
  );

  // Board card: name, value, priority/score, owner, age + task/overdue hint. Dragging (long-press) is
  // handled by KanbanBoard; the ⇄ button is the visible alternative that opens the stage picker.
  const renderBoardCard = useCallback(
    (item: Lead) => {
      const stageName = getLeadStageName(item);
      const task = leadTaskMap.get(item.id);
      const company = (item as any).companyName as string | undefined;
      const lastTs = lastActivityTs(item);
      const stale = !!lastTs && Date.now() - lastTs > STALE_DAYS * DAY_MS && !isClosedLead(item);
      const sub = company || item.contactName || '';
      return (
        <Pressable
          onPress={() => openLead(item)}
          style={({ pressed }) => [
            styles.pipelineCard,
            {
              backgroundColor: pressed ? theme.colors.surfaceVariant : theme.colors.surface,
              borderStartColor: stageColor(stageName),
              borderStartWidth: 3,
            },
          ]}
        >
          <View style={[styles.leadTop, { flexDirection }]}>
            {!seenLeadIds.has(item.id) && <View style={styles.unseenDot} />}
            <Text
              variant="titleSmall"
              numberOfLines={1}
              style={{ color: theme.colors.onSurface, fontWeight: '700', flex: 1, textAlign }}
            >
              {item.title}
            </Text>
            <Pressable
              onPress={() => setStagePickerLead(item)}
              hitSlop={8}
              style={[styles.moveBtn, { backgroundColor: theme.colors.surfaceVariant }]}
              accessibilityLabel={tr('העבר שלב', 'Move stage')}
            >
              <MaterialCommunityIcons name="swap-horizontal" size={16} color={theme.colors.onSurfaceVariant} />
            </Pressable>
          </View>
          {sub ? (
            <Text variant="bodySmall" numberOfLines={1} style={{ color: theme.colors.onSurfaceVariant, textAlign, marginTop: 2 }}>
              {sub}
            </Text>
          ) : null}
          <View style={[styles.leadTop, { flexDirection, marginTop: 6 }]}>
            {item.value != null && item.value > 0 ? (
              <Text variant="titleSmall" style={{ color: theme.colors.primary, fontWeight: '700', flex: 1, textAlign }}>
                {formatCurrency(item.value, item.currency ?? '₪')}
              </Text>
            ) : <View style={{ flex: 1 }} />}
            {(item as any).score ? (
              <View style={[styles.signalChip, { backgroundColor: withAlpha(scoreColor((item as any).score), 0.16) }]}>
                <MaterialCommunityIcons name="fire" size={12} color={scoreColor((item as any).score)} />
                <Text style={{ fontSize: 10, fontWeight: '700', color: scoreColor((item as any).score) }}>{Number((item as any).score)}</Text>
              </View>
            ) : null}
            {item.priority ? (
              <MaterialCommunityIcons name="flag" size={14} color={PRIORITY_COLORS[item.priority] || theme.colors.onSurfaceVariant} />
            ) : null}
          </View>
          <View style={[styles.leadBottom, { flexDirection, marginTop: 8 }]}>
            {task ? (
              <LeadTaskBadge info={task} t={t} formatDate={formatDate} />
            ) : lastTs ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                <MaterialCommunityIcons name="history" size={12} color={stale ? '#ef4444' : theme.colors.onSurfaceVariant} />
                <Text style={{ fontSize: 10, color: stale ? '#ef4444' : theme.colors.onSurfaceVariant, fontWeight: stale ? '700' : '400' }}>
                  {activityLabel(item)}
                </Text>
              </View>
            ) : null}
            <View style={{ flex: 1 }} />
            <OwnerAvatar name={(item as any).ownerName} theme={theme} />
          </View>
        </Pressable>
      );
    },
    [theme, flexDirection, textAlign, openLead, stageColor, getLeadStageName, leadTaskMap, t, tr, seenLeadIds, lastActivityTs, isClosedLead, activityLabel],
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
        {hasAnyFilter ? (
          <Button mode="outlined" icon="filter-remove-outline" onPress={clearAllFilters} style={{ marginTop: 12 }}>
            {tr('נקה סינונים', 'Clear filters')}
          </Button>
        ) : (
          <Text
            variant="bodyMedium"
            style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center', marginTop: 4 }}
          >
            {t('leads.addLead')}
          </Text>
        )}
      </View>
    ),
    [theme, t, tr, hasAnyFilter, clearAllFilters],
  );

  const sortOptions = [
    { key: 'createdOn' as SortKey, label: t('leads.sortCreated', 'נוצר ב'), icon: 'calendar-plus' },
    { key: 'modifiedOn' as SortKey, label: t('leads.sortUpdated', 'עודכן ב'), icon: 'calendar-edit' },
    { key: 'title' as SortKey, label: t('leads.name', 'שם'), icon: 'sort-alphabetical-variant' },
    { key: 'value' as SortKey, label: t('leads.value', 'סכום'), icon: 'cash' },
    { key: 'priority' as SortKey, label: t('leads.priority', 'עדיפות'), icon: 'flag' },
    { key: 'score' as SortKey, label: t('leads.score', 'דירוג'), icon: 'fire' },
    { key: 'stageName' as SortKey, label: t('leads.stage', 'שלב'), icon: 'view-column' },
  ];
  const activeSortLabel = sortOptions.find((o) => o.key === sortKey)?.label ?? '';

  const unseenCount = useMemo(() => leads.filter((l) => !seenLeadIds.has(l.id)).length, [leads, seenLeadIds]);

  const taskChips: { type: TaskQuickFilter; icon: string; label: string; color: string }[] = [
    { type: 'today', icon: 'calendar-today', label: t('leads.tasksToday', 'משימות להיום'), color: '#f59e0b' },
    { type: 'upcoming', icon: 'clock-outline', label: t('leads.tasksUpcoming', 'משימות קרובות'), color: '#3b82f6' },
    { type: 'overdue', icon: 'alert-circle-outline', label: t('leads.tasksOverdue', 'משימות באיחור'), color: '#ef4444' },
    { type: 'withTasks', icon: 'clipboard-clock-outline', label: t('leads.leadsWithTasks', 'לידים עם משימות'), color: '#2e6155' },
  ];

  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.background, flexDirection: 'column' }]}>
      {/* Header: title · List|Board switch · filter · overflow  (3 controls max) */}
      <View
        style={[
          styles.header,
          { backgroundColor: theme.custom.headerBackground, paddingTop: insets.top, flexDirection },
        ]}
      >
        <Text style={styles.headerTitle}>{t('leads.title')}</Text>

        <View style={[styles.segment, { flexDirection }]}>
          {([
            { key: 'list' as const, icon: 'format-list-bulleted', label: tr('רשימה', 'List') },
            { key: 'pipeline' as const, icon: 'view-column-outline', label: tr('לוח', 'Board') },
          ]).map((seg) => {
            const active = viewMode === seg.key;
            return (
              <Pressable
                key={seg.key}
                onPress={() => switchView(seg.key)}
                style={[styles.segmentItem, { flexDirection }, active && styles.segmentItemActive]}
              >
                <MaterialCommunityIcons name={seg.icon as any} size={16} color={active ? theme.custom.headerBackground : '#FFF'} />
                <Text style={{ fontSize: 12, fontWeight: '700', color: active ? theme.custom.headerBackground : '#FFF' }}>
                  {seg.label}
                </Text>
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
            {activeFilterCount > 0 ? (
              <View style={styles.filterBadge}>
                <Text style={styles.filterBadgeText}>{activeFilterCount}</Text>
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
            <Menu.Item
              leadingIcon="eye-check-outline"
              title={t('leads.markAllSeen', 'סמן הכול כנצפה')}
              onPress={() => { setMoreMenuVisible(false); markAllLeadsSeen(); }}
            />
            {hasMore ? (
              <Menu.Item
                leadingIcon="download"
                title={t('common.loadAll', 'טען הכול')}
                onPress={() => { setMoreMenuVisible(false); fetchAll(); }}
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

      {/* Search — always visible, one field */}
      <View style={[styles.searchWrap, { backgroundColor: theme.custom.headerBackground }]}>
        <Searchbar
          placeholder={t('leads.searchPlaceholder')}
          value={searchQuery}
          onChangeText={setSearchQuery}
          returnKeyType="search"
          style={[styles.searchbar, { backgroundColor: theme.colors.surface }]}
          inputStyle={{ fontSize: 14, textAlign: isRTL ? 'right' : 'left', minHeight: 0 }}
          iconColor={theme.colors.onSurfaceVariant}
        />
      </View>

      {/* Views: the primary way to switch (All · New · saved views · save current) */}
      <View style={[styles.viewsRow, { backgroundColor: theme.colors.surface, borderBottomColor: theme.colors.outline }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.viewsScroll, { flexDirection }]}>
          <Pressable
            onPress={clearAllFilters}
            style={[styles.viewTab, activeViewId === '__all' && { borderBottomColor: theme.colors.primary, borderBottomWidth: 2 }]}
          >
            <Text style={[styles.viewTabText, { color: activeViewId === '__all' ? theme.colors.primary : theme.colors.onSurfaceVariant }]}>
              {t('leads.viewAll', 'הכל')}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => {
              if (activeViewId === '__new') { setUnseenOnly(false); setActiveViewId('__all'); }
              else { setActiveViewId('__new'); setUnseenOnly(true); }
            }}
            style={[styles.viewTab, activeViewId === '__new' && { borderBottomColor: '#ef4444', borderBottomWidth: 2 }]}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Text style={[styles.viewTabText, { color: activeViewId === '__new' ? '#ef4444' : theme.colors.onSurfaceVariant }]}>
                {t('leads.viewNew', 'חדשים')}
              </Text>
              {unseenCount > 0 && (
                <View style={{ backgroundColor: '#ef4444', borderRadius: 9, minWidth: 18, paddingHorizontal: 4, paddingVertical: 1, alignItems: 'center' }}>
                  <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>{unseenCount}</Text>
                </View>
              )}
            </View>
          </Pressable>
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

      {/* One-tap quick filters (combine with the view, the advanced filter and each other) */}
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
              label={`${tr('נקה', 'Clear')}${activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}`}
              color="#ef4444"
              active
              onPress={clearAllFilters}
            />
          ) : null}
          <QuickChip theme={theme} icon="account-check-outline" label={tr('שלי', 'Mine')} color={theme.colors.primary} active={filterMine} onPress={() => setFilterMine((v) => !v)} />
          <QuickChip theme={theme} icon="fire" label={tr('חמים', 'Hot')} color="#f97316" active={quickFilters.includes('hot')} onPress={() => toggleQuickFilter('hot')} />
          <QuickChip theme={theme} icon="calendar-today" label={tr('היום', 'Today')} color="#3b82f6" active={quickFilters.includes('today')} onPress={() => toggleQuickFilter('today')} />
          <QuickChip theme={theme} icon="account-off-outline" label={tr('ללא בעלים', 'Unassigned')} color="#8b5cf6" active={quickFilters.includes('unassigned')} onPress={() => toggleQuickFilter('unassigned')} />
          <QuickChip
            theme={theme}
            icon="cash"
            label={`${tr('מעל', 'Over')} ${formatCurrency(highValueThreshold, '₪').replace(/\.00$/, '')}`}
            color="#16a34a"
            active={quickFilters.includes('highValue')}
            onPress={() => toggleQuickFilter('highValue')}
          />
          <QuickChip theme={theme} icon="clock-alert-outline" label={tr(`לא עודכן ${STALE_DAYS} ימים`, `Stale ${STALE_DAYS}d`)} color="#ef4444" active={quickFilters.includes('stale')} onPress={() => toggleQuickFilter('stale')} />
          {viewMode === 'list' ? (
            <QuickChip
              theme={theme}
              icon="view-column-outline"
              label={selectedStage ? (STAGE_I18N[selectedStage] ? t(STAGE_I18N[selectedStage]) : selectedStage) : tr('שלב', 'Stage')}
              color={selectedStage ? stageColor(selectedStage) : theme.colors.primary}
              active={!!selectedStage}
              caret
              onPress={() => setStageFilterVisible(true)}
            />
          ) : null}
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

      {/* Summary line: count · total value  +  sort (list) */}
      <View style={[styles.summaryRow, { flexDirection, backgroundColor: theme.colors.surface, borderBottomColor: theme.colors.outline }]}>
        <Text style={{ fontSize: 12, color: theme.colors.onSurfaceVariant, flexShrink: 1 }} numberOfLines={1}>
          <Text style={{ fontWeight: '700', color: theme.colors.onSurface }}>
            {hasMore && !needsAll ? `${leads.length} / ${totalCount}` : visibleLeads.length}
          </Text>
          {` ${tr('לידים', 'leads')}`}
          {totalsSummary ? `  ·  ${totalsSummary}` : ''}
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
                  else { setSortKey(opt.key); setSortDir(['createdOn', 'modifiedOn', 'value', 'priority', 'score'].includes(opt.key) ? 'desc' : 'asc'); }
                }}
              />
            ))}
          </Menu>
        ) : null}
      </View>

      {/* Unseen banner */}
      {activeViewId === '__new' && (
        <View style={{ flexDirection, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: '#fef2f2', alignItems: 'center', gap: 8 }}>
          <Text style={{ color: '#ef4444', fontSize: 12, fontWeight: '600' }}>●</Text>
          <Text style={{ color: '#dc2626', fontSize: 12, flex: 1 }}>
            {visibleLeads.length} {t('leads.unseenLeads', 'לידים שלא נצפו')}
          </Text>
          {visibleLeads.length > 0 && (
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
            ) : hasMore ? (
              <View style={{ alignItems: 'center', paddingVertical: 12, gap: 8 }}>
                <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                  {leads.length} / {totalCount}
                </Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Pressable onPress={() => fetchPage(page + 1, false)} disabled={loadingAll} style={{ paddingHorizontal: 16, paddingVertical: 6, borderRadius: 16, backgroundColor: theme.colors.primaryContainer, opacity: loadingAll ? 0.5 : 1 }}>
                    <Text style={{ fontSize: 12, fontWeight: '600', color: theme.colors.onPrimaryContainer }}>{t('common.loadMore', 'טען עוד')}</Text>
                  </Pressable>
                  <Pressable onPress={fetchAll} disabled={loadingAll} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 6, borderRadius: 16, backgroundColor: theme.colors.surfaceVariant, opacity: loadingAll ? 0.7 : 1 }}>
                    {loadingAll && <ActivityIndicator size={12} color={theme.colors.onSurfaceVariant} />}
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
          onEndReached={onEndReached}
          onEndReachedThreshold={0.3}
          contentContainerStyle={styles.listContent}
        />
      ) : (
        <View style={{ flex: 1 }}>
          {loadingAll ? (
            <ActivityIndicator size="small" color={theme.colors.primary} style={{ marginTop: 6 }} />
          ) : null}
          <KanbanBoard
            columns={kanbanColumns}
            keyExtractor={(item) => item.id}
            onMoveItem={handleKanbanMove}
            emptyLabel={tr('אין לידים בשלב זה', 'No leads in this stage')}
            renderCard={renderBoardCard}
            refreshing={refreshing}
            onRefresh={onRefresh}
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
            {ownerOptions.length > 0 ? (
              <>
                <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 6, marginTop: 4 }}>
                  {t('leads.owner', 'Owner')}
                </Text>
                <OptionChips options={ownerOptions} value={filterOwner} onChange={setFilterOwner} theme={theme} />
              </>
            ) : (
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
            )}

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
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 12 }}>
              {stagePickerLead.title}
            </Text>
          ) : null}
          {/* Secondary lead actions live here (long-press / ⇄) instead of cluttering every row */}
          {stagePickerLead ? (
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
              {(stagePickerLead.contactPhone || stagePickerLead.phoneNumber) ? (
                <Chip
                  icon="phone-outline"
                  compact
                  onPress={() => { const l = stagePickerLead; setStagePickerLead(null); if (l) callLead(l); }}
                >
                  {tr('התקשר', 'Call')}
                </Chip>
              ) : null}
              {(stagePickerLead as any).ownerId !== (user?.uID || user?.userId) ? (
                <Chip
                  icon="account-arrow-left"
                  compact
                  onPress={() => { const l = stagePickerLead; setStagePickerLead(null); if (l) handleTakeOwnership(l); }}
                >
                  {t('leads.takeOwnership', 'קח בעלות')}
                </Chip>
              ) : null}
            </View>
          ) : null}
          <ScrollView style={{ maxHeight: 340 }} showsVerticalScrollIndicator={false}>
          {stageKeys.map((stage) => {
            const color = stageColor(stage);
            const isCurrent = !!stagePickerLead && getLeadStageName(stagePickerLead) === stage;
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
          </ScrollView>
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

      {/* Stage filter (list view) */}
      <Portal>
        <Modal
          visible={stageFilterVisible}
          onDismiss={() => setStageFilterVisible(false)}
          contentContainerStyle={[styles.stageModal, { backgroundColor: theme.colors.surface }]}
        >
          <Text variant="titleMedium" style={{ color: theme.colors.onSurface, fontWeight: '700', marginBottom: 12 }}>
            {tr('סינון לפי שלב', 'Filter by stage')}
          </Text>
          <ScrollView style={{ maxHeight: 380 }} showsVerticalScrollIndicator={false}>
            {[null, ...stageKeys].map((stage) => {
              const color = stage ? stageColor(stage) : theme.colors.primary;
              const isSelected = selectedStage === stage;
              return (
                <Pressable
                  key={stage ?? '__all'}
                  onPress={() => { setSelectedStage(stage); setStageFilterVisible(false); }}
                  style={({ pressed }) => [
                    styles.stageOption,
                    { backgroundColor: isSelected ? withAlpha(color, 0.12) : pressed ? theme.colors.surfaceVariant : 'transparent' },
                  ]}
                >
                  <View style={[styles.stageOptionDot, { backgroundColor: color }]} />
                  <Text variant="bodyMedium" style={{ flex: 1, color: isSelected ? color : theme.colors.onSurface, fontWeight: isSelected ? '700' : '400' }}>
                    {stage ? t(STAGE_I18N[stage] ?? stage) : t('common.all')}
                  </Text>
                  {isSelected ? <MaterialCommunityIcons name="check" size={20} color={color} /> : null}
                </Pressable>
              );
            })}
          </ScrollView>
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
    gap: 4,
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
  unseenDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#ef4444', marginEnd: 6 },
  stagePill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, maxWidth: 140 },
  signalChip: { flexDirection: 'row', alignItems: 'center', gap: 1, borderRadius: 8, paddingHorizontal: 5, paddingVertical: 1 },
  callBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' },
  moveBtn: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginStart: 6 },
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
    paddingTop: 8,
    paddingBottom: 8,
    paddingEnd: 12,
    gap: 10,
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
  leadBody: { flex: 1, gap: 3 },
  leadTop: { alignItems: 'center', gap: 6 },
  leadMeta: { alignItems: 'center', gap: 12, marginTop: 2 },
  metaChip: { alignItems: 'center' },
  leadBottom: { alignItems: 'center', gap: 6, marginTop: 2 },
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
