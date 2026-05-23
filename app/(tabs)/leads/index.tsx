import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  View,
  StyleSheet,
  Pressable,
  RefreshControl,
  Animated,
  ScrollView,
  Dimensions,
  Alert,
  Linking,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Text, Searchbar, Chip, FAB, Avatar, Divider, Surface, Portal, Modal, Button, TextInput as PaperInput, ActivityIndicator, IconButton } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useLeadStore } from '../../../stores/leadStore';
import { useAuthStore } from '../../../stores/authStore';
import { leadsApi } from '../../../services/api/leads';
import { ENDPOINTS } from '../../../constants/api';
import axiosInstance from '../../../services/api/axiosInstance';
import { useAppTheme } from '../../../hooks/useAppTheme';
import { useRTL } from '../../../hooks/useRTL';
import { getDataVisibility } from '../../../constants/permissions';
import { formatCurrency, formatDate, getInitials, withAlpha } from '../../../utils/formatters';
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

const SCREEN_WIDTH = Dimensions.get('window').width;
const PIPELINE_COL_WIDTH = SCREEN_WIDTH * 0.72;

const STATUS_OPTIONS = ['Active', 'Interested', 'Not Interested', 'On Hold', 'Archived'] as const;
const PRIORITY_OPTIONS = ['low', 'medium', 'high'] as const;
const DATE_RANGE_PRESETS = ['Today', 'This Week', 'This Month', 'Last Month', 'This Year'] as const;

const PRIORITY_COLORS: Record<string, string> = {
  low: '#4CAF50',
  medium: '#FF9800',
  high: '#FF5722',
};


interface SavedView {
  id: string;
  Name: string;
  ViewData: { filters?: any; searchTerm?: string };
  IsPinned?: boolean;
  Visibility?: string;
  UserId?: string;
}

const LeadDivider = () => <Divider />;

export default function LeadsListScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useAppTheme();
  const { isRTL, flexDirection, textAlign } = useRTL();
  const { t } = useTranslation();

  const user = useAuthStore((s) => s.user);
  const organization = user?.organization ?? '';
  const userIsAdmin = user?.SecurityRole === 'admin' || user?.SecurityRole === 'Admin';

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

  // ── UI state ────────────────────────────────────────────────────────────────
  const [searchVisible, setSearchVisible] = useState(false);
  const [advancedFilterVisible, setAdvancedFilterVisible] = useState(false);
  const searchAnim = useRef(new Animated.Value(0)).current;
  const [stagePickerLead, setStagePickerLead] = useState<Lead | null>(null);
  const [pipelineStages, setPipelineStages] = useState<LeadStage[]>([]);
  const fetchingRef = useRef(false);

  // ── Saved views ─────────────────────────────────────────────────────────────
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [activeViewId, setActiveViewId] = useState('__all');
  const [showSaveViewModal, setShowSaveViewModal] = useState(false);
  const [newViewName, setNewViewName] = useState('');
  const [saveViewVisibility, setSaveViewVisibility] = useState<'personal' | 'shared'>('personal');

  const stageColorMap = useMemo(() => {
    if (pipelineStages.length > 0) {
      const map: Record<string, string> = {};
      pipelineStages.forEach((s) => { map[s.name] = s.color; });
      return map;
    }
    return DEFAULT_STAGE_COLORS;
  }, [pipelineStages]);

  const stageKeys = useMemo(() => {
    const base = pipelineStages.length > 0 ? pipelineStages.map((s) => s.name) : DEFAULT_STAGE_KEYS;
    return base;
  }, [pipelineStages]);

  // ── Build filter object for API ─────────────────────────────────────────────
  const buildFilters = useCallback(() => ({
    searchTerm: debouncedSearch.trim(),
    stages: selectedStage ? [selectedStage] : [],
    sources: filterSource.trim() ? [filterSource.trim()] : [],
    owners: filterOwner.trim() ? [filterOwner.trim()] : [],
    statuses: filterStatus ? [filterStatus] : [],
    priorities: filterPriority ? [filterPriority] : [],
    dateRangePreset: filterDateRange || '',
  }), [debouncedSearch, selectedStage, filterSource, filterOwner, filterStatus, filterPriority, filterDateRange]);

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
          ? 'mineOnly'
          : getDataVisibility(user?.DataVisibility, user?.SecurityRole, 'leads') === 'own'
            ? 'mineOnly'
            : 'seeAll',
        userId: (filterMine || getDataVisibility(user?.DataVisibility, user?.SecurityRole, 'leads') === 'own')
          ? (user?.uID || user?.userId || '')
          : '',
      });
      const newItems = result.data ?? [];
      const total = result.total ?? 0;
      setTotalCount(total);
      setLeads((prev) => {
        const updated = reset ? newItems : [...prev, ...newItems];
        setHasMore(newItems.length === PAGE_SIZE && updated.length < total);
        return updated;
      });
      setPage(pageNum);
    } catch {
      /* keep existing data on error */
    } finally {
      fetchingRef.current = false;
      if (reset) setIsLoading(false); else setLoadingMore(false);
    }
  }, [organization, buildFilters, filterMine, user]);

  // ── Debounced search ────────────────────────────────────────────────────────
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // ── Initial load & filter change → reset ───────────────────────────────────
  useEffect(() => {
    if (!organization) return;
    fetchPage(1, true);
    leadsApi.getPipelineSettings(organization)
      .then((res) => { if (res.stages.length > 0) setPipelineStages(res.stages); })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organization, debouncedSearch, selectedStage, filterSource, filterOwner, filterStatus, filterPriority, filterDateRange, filterMine]);

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

  // Refetch on screen focus (e.g. returning from detail screen)
  const didMountRef = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!didMountRef.current) {
        didMountRef.current = true;
        return;
      }
      if (organization) fetchPage(1, true);
    }, [organization, fetchPage])
  );

  const loadSavedView = useCallback((view: SavedView) => {
    const viewData = view.ViewData || {};
    const filters = viewData.filters || {};
    setActiveViewId(view.id);
    setFilterMine(false);
    setSelectedStage(filters.stage ?? null);
    setFilterSource(filters.source ?? '');
    setFilterOwner(filters.owner ?? '');
    setFilterStatus(filters.status ?? '');
    setFilterPriority(filters.priority ?? '');
    setFilterDateRange(filters.dateRange ?? '');
    if (viewData.searchTerm) setSearchQuery(viewData.searchTerm);
  }, []);

  const clearAllFilters = useCallback(() => {
    setActiveViewId('__all');
    setSelectedStage(null);
    setFilterSource('');
    setFilterOwner('');
    setFilterStatus('');
    setFilterPriority('');
    setFilterDateRange('');
    setFilterMine(false);
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
  }, [newViewName, organization, user, selectedStage, filterSource, filterOwner, filterStatus, filterPriority, filterDateRange, searchQuery, userIsAdmin, saveViewVisibility]);

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

  // ── Pipeline view grouping (uses loaded leads) ──────────────────────────────
  const leadsByStage = useMemo(() => {
    const grouped = new Map<string, Lead[]>();
    leads.forEach((lead) => {
      const stage = lead.stageName || lead.stage || 'New';
      if (!grouped.has(stage)) grouped.set(stage, []);
      grouped.get(stage)!.push(lead);
    });
    return grouped;
  }, [leads]);

  const filteredLeads = leads; // already filtered server-side

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
    await fetchPage(1, true);
    setRefreshing(false);
  }, [fetchPage]);

  const openLead = useCallback(
    (lead: Lead) => {
      setSelectedLead(lead);
      router.push({
        pathname: '/(tabs)/leads/[id]',
        params: { id: lead.id },
      });
    },
    [router, setSelectedLead],
  );

  const stageColor = useCallback(
    (stage: string) => stageColorMap[stage] ?? theme.colors.primary,
    [stageColorMap, theme],
  );

  const handleStageChange = useCallback(
    async (lead: Lead, newStage: string) => {
      setStagePickerLead(null);
      const stageObj = pipelineStages.find((s) => s.name === newStage);
      const newStageId = stageObj?.id || '';

      // Optimistic local update
      setLeads((prev) =>
        prev.map((l) => (l.id === lead.id ? { ...l, stageName: newStage, stage: newStage, stageId: newStageId } : l)),
      );

      try {
        await leadsApi.moveStage(
          organization,
          lead.id,
          newStageId,
          newStage,
          user?.fullname || '',
        );
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

  const handleTakeOwnership = useCallback(async (lead: Lead) => {
    if (!organization || !user) return;
    const userId = user.uID || user.userId || '';
    const userName = user.fullname || '';
    setLeads((prev) => prev.map((l) => l.id === lead.id ? { ...l, ownerId: userId, ownerName: userName } : l));
    try {
      await leadsApi.update(organization, { id: lead.id, ownerId: userId, ownerName: userName }, userId, userName);
    } catch {
      setLeads((prev) => prev.map((l) => l.id === lead.id ? { ...l, ownerId: lead.ownerId, ownerName: (lead as any).ownerName } : l));
    }
  }, [organization, user]);

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
          },
        ]}
      >
        <View style={[styles.stageStripe, { backgroundColor: stageColor(item.stageName || item.stage || 'New') }]} />

        <View style={styles.leadBody}>
          <View style={[styles.leadTop, { flexDirection }]}>
            {/* Priority dot */}
            {item.priority ? (
              <View
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: PRIORITY_COLORS[(item.priority as string)?.toLowerCase()] ?? '#9E9E9E',
                  alignSelf: 'center',
                  marginEnd: 6,
                  flexShrink: 0,
                }}
              />
            ) : null}
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
                style={{ color: theme.colors.primary, fontWeight: '700' }}
              >
                {formatCurrency(item.value, item.currency ?? '₪')}
              </Text>
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
              textStyle={{ fontSize: 11, color: stageColor(item.stageName || item.stage || 'New'), fontWeight: '600', lineHeight: 16 }}
              style={{ backgroundColor: withAlpha(stageColor(item.stageName || item.stage || 'New'), 0.21), minHeight: 28 }}
            >
              {t(STAGE_I18N[item.stageName || item.stage || 'New'] ?? item.stageName ?? item.stage ?? 'New')}
            </Chip>
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
                Linking.openURL(`tel:${phone}`);
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
    [theme, isRTL, flexDirection, textAlign, openLead, stageColor, t, user, handleTakeOwnership],
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
            borderLeftColor: stageColor(lead.stageName || lead.stage || 'New'),
            borderLeftWidth: 3,
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
      </Pressable>
    ),
    [theme, flexDirection, openLead, stageColor],
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
          <Pressable
            onPress={clearAllFilters}
            style={[styles.viewTab, activeViewId === '__all' && { borderBottomColor: theme.colors.primary, borderBottomWidth: 2 }]}
          >
            <Text style={[styles.viewTabText, { color: activeViewId === '__all' ? theme.colors.primary : theme.colors.onSurfaceVariant }]}>
              {t('leads.viewAll', 'הכל')}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => { setActiveViewId('__mine'); setFilterMine(true); }}
            style={[styles.viewTab, activeViewId === '__mine' && { borderBottomColor: theme.colors.primary, borderBottomWidth: 2 }]}
          >
            <Text style={[styles.viewTabText, { color: activeViewId === '__mine' ? theme.colors.primary : theme.colors.onSurfaceVariant }]}>
              {t('leads.viewMine', 'שלי')}
            </Text>
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
              <Text variant="labelSmall" style={{ textAlign: 'center', color: theme.colors.onSurfaceVariant, paddingVertical: 12 }}>
                {leads.length} / {totalCount}
              </Text>
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
        <ScrollView
          horizontal
          pagingEnabled={false}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.pipelineContainer}
          style={{ flex: 1 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={[theme.colors.primary]}
              tintColor={theme.colors.primary}
            />
          }
        >
          {stageKeys.map((stage) => {
            const stageLeads = leadsByStage.get(stage) ?? [];
            const color = stageColor(stage);
            return (
              <View
                key={stage}
                style={[styles.pipelineColumn, { width: PIPELINE_COL_WIDTH }]}
              >
                <View style={[styles.pipelineHeader, { flexDirection }]}>
                  <View style={[styles.pipelineHeaderDot, { backgroundColor: color }]} />
                  <Text variant="titleSmall" style={{ color: theme.colors.onSurface, fontWeight: '700', flex: 1 }}>
                    {t(STAGE_I18N[stage] ?? stage)}
                  </Text>
                  <View
                    style={[styles.pipelineCount, { backgroundColor: withAlpha(color, 0.12) }]}
                  >
                    <Text variant="labelSmall" style={{ color, fontWeight: '700' }}>
                      {stageLeads.length}
                    </Text>
                  </View>
                </View>
                <ScrollView
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={styles.pipelineCards}
                >
                  {stageLeads.length === 0 ? (
                    <View style={styles.pipelineEmpty}>
                      <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                        {t('leads.noLeads')}
                      </Text>
                    </View>
                  ) : (
                    stageLeads.map(renderPipelineCard)
                  )}
                </ScrollView>
              </View>
            );
          })}
        </ScrollView>
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
          </ScrollView>

          <View style={{ flexDirection: isRTL ? 'row-reverse' : 'row', gap: 12, justifyContent: 'flex-end', marginTop: 16 }}>
            <Button
              mode="outlined"
              onPress={() => {
                setFilterSource('');
                setFilterOwner('');
                setFilterStatus('');
                setFilterPriority('');
                setFilterDateRange('');
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
            <View style={{ flexDirection: isRTL ? 'row-reverse' : 'row', alignItems: 'center', gap: 8, marginBottom: 16 }}>
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
          <View style={{ flexDirection: isRTL ? 'row-reverse' : 'row', justifyContent: 'flex-end', gap: 8 }}>
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
    paddingEnd: 14,
  },
  quickDialRow: {
    alignItems: 'center',
    marginTop: 6,
    gap: 2,
    paddingVertical: 2,
    alignSelf: 'flex-start',
  },
  stageStripe: {
    width: 4,
    borderTopRightRadius: 2,
    borderBottomRightRadius: 2,
    marginEnd: 14,
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
