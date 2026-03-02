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
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Text, Searchbar, Chip, FAB, Avatar, Divider, Surface, Portal, Modal, Button, TextInput as PaperInput, ActivityIndicator } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useLeadStore } from '../../../stores/leadStore';
import { useAuthStore } from '../../../stores/authStore';
import { leadsApi } from '../../../services/api/leads';
import { useAppTheme } from '../../../hooks/useAppTheme';
import { useRTL } from '../../../hooks/useRTL';
import { formatCurrency, formatDate, getInitials } from '../../../utils/formatters';
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

function isInDateRange(dateStr: string | undefined, preset: string): boolean {
  if (!dateStr) return false;
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return false;
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (preset) {
    case 'Today':
      return date >= startOfDay;
    case 'This Week': {
      const startOfWeek = new Date(startOfDay);
      startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
      return date >= startOfWeek;
    }
    case 'This Month':
      return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
    case 'Last Month': {
      const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lmEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
      return date >= lm && date <= lmEnd;
    }
    case 'This Year':
      return date.getFullYear() === now.getFullYear();
    default:
      return true;
  }
}

function applyLeadFilters(
  list: Lead[],
  source: string,
  owner: string,
  status: string,
  priority: string,
  dateRange: string,
): Lead[] {
  let result = list;
  if (source.trim()) {
    result = result.filter((l) =>
      l.source?.toLowerCase().includes(source.toLowerCase()),
    );
  }
  if (owner.trim()) {
    result = result.filter(
      (l) =>
        l.ownerName?.toLowerCase().includes(owner.toLowerCase()) ||
        l.owner?.toLowerCase().includes(owner.toLowerCase()),
    );
  }
  if (status) {
    result = result.filter((l) => l.status === status);
  }
  if (priority) {
    result = result.filter((l) => l.priority === priority);
  }
  if (dateRange) {
    result = result.filter((l) => isInDateRange(l.createdOn, dateRange));
  }
  return result;
}

export default function LeadsListScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useAppTheme();
  const { isRTL, flexDirection, textAlign } = useRTL();
  const { t } = useTranslation();

  const user = useAuthStore((s) => s.user);
  const organization = user?.organization ?? '';

  const leads = useLeadStore((s) => s.leads);
  const isLoading = useLeadStore((s) => s.isLoading);
  const searchQuery = useLeadStore((s) => s.searchQuery);
  const selectedStage = useLeadStore((s) => s.selectedStage);
  const viewMode = useLeadStore((s) => s.viewMode);
  const setSearchQuery = useLeadStore((s) => s.setSearchQuery);
  const setSelectedStage = useLeadStore((s) => s.setSelectedStage);
  const setViewMode = useLeadStore((s) => s.setViewMode);
  const loadLeads = useLeadStore((s) => s.loadLeads);
  const getFilteredLeads = useLeadStore((s) => s.getFilteredLeads);
  const getLeadsByStage = useLeadStore((s) => s.getLeadsByStage);
  const updateLead = useLeadStore((s) => s.updateLead);

  const [refreshing, setRefreshing] = useState(false);
  const [searchVisible, setSearchVisible] = useState(false);
  const [advancedFilterVisible, setAdvancedFilterVisible] = useState(false);
  const [filterSource, setFilterSource] = useState('');
  const [filterOwner, setFilterOwner] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterPriority, setFilterPriority] = useState('');
  const [filterDateRange, setFilterDateRange] = useState('');
  const searchAnim = useRef(new Animated.Value(0)).current;
  const [stagePickerLead, setStagePickerLead] = useState<Lead | null>(null);
  const [pipelineStages, setPipelineStages] = useState<LeadStage[]>([]);

  const stageKeys = useMemo(() => {
    const base = pipelineStages.length > 0
      ? pipelineStages.map((s) => s.name)
      : DEFAULT_STAGE_KEYS;
    const extras = new Set<string>();
    leads.forEach((l) => {
      const s = l.stageName || l.stage;
      if (s && !base.includes(s)) extras.add(s);
    });
    return extras.size > 0 ? [...base, ...Array.from(extras)] : base;
  }, [pipelineStages, leads]);

  const stageColorMap = useMemo(() => {
    if (pipelineStages.length > 0) {
      const map: Record<string, string> = {};
      pipelineStages.forEach((s) => { map[s.name] = s.color; });
      return map;
    }
    return DEFAULT_STAGE_COLORS;
  }, [pipelineStages]);

  useEffect(() => {
    if (!organization) return;
    loadLeads(organization);
    leadsApi.getPipelineSettings(organization)
      .then((res) => { if (res.stages.length > 0) setPipelineStages(res.stages); })
      .catch(() => {});
  }, [organization, loadLeads]);

  const filteredLeads = useMemo(() => {
    const result = getFilteredLeads();
    return applyLeadFilters(result, filterSource, filterOwner, filterStatus, filterPriority, filterDateRange);
  }, [leads, searchQuery, selectedStage, getFilteredLeads, filterSource, filterOwner, filterStatus, filterPriority, filterDateRange]);

  const leadsByStage = useMemo(() => {
    const grouped = getLeadsByStage();
    const hasFilters = filterSource.trim() || filterOwner.trim() || filterStatus || filterPriority || filterDateRange;
    if (!hasFilters) return grouped;
    const filteredGrouped = new Map<string, Lead[]>();
    grouped.forEach((stageLeads, stage) => {
      const filtered = applyLeadFilters(stageLeads, filterSource, filterOwner, filterStatus, filterPriority, filterDateRange);
      if (filtered.length > 0) filteredGrouped.set(stage, filtered);
    });
    return filteredGrouped;
  }, [leads, getLeadsByStage, filterSource, filterOwner, filterStatus, filterPriority, filterDateRange]);

  const toggleSearch = useCallback(() => {
    const willShow = !searchVisible;
    if (willShow) {
      setSearchVisible(true);
      Animated.timing(searchAnim, {
        toValue: 1,
        duration: 220,
        useNativeDriver: false,
      }).start();
    } else {
      Animated.timing(searchAnim, {
        toValue: 0,
        duration: 180,
        useNativeDriver: false,
      }).start(() => {
        setSearchVisible(false);
        setSearchQuery('');
      });
    }
  }, [searchVisible, searchAnim, setSearchQuery]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    if (organization) await loadLeads(organization);
    setRefreshing(false);
  }, [organization, loadLeads]);

  const openLead = useCallback(
    (lead: Lead) => {
      router.push({
        pathname: '/(tabs)/leads/[id]',
        params: { id: lead.id },
      });
    },
    [router],
  );

  const stageColor = useCallback(
    (stage: string) => stageColorMap[stage] ?? theme.colors.primary,
    [stageColorMap, theme],
  );

  const handleStageChange = useCallback(
    async (lead: Lead, newStage: string) => {
      setStagePickerLead(null);
      try {
        await updateLead(organization, { id: lead.id, stageName: newStage, stage: newStage });
      } catch (err: any) {
        Alert.alert(t('common.error', 'Error'), err?.message || t('errors.generic'));
      }
    },
    [organization, updateLead, t],
  );

  const renderLeadItem = useCallback(
    ({ item }: { item: Lead }) => (
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
                <MaterialCommunityIcons
                  name="account-outline"
                  size={14}
                  color={theme.colors.onSurfaceVariant}
                />
                <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginStart: 4 }}>
                  {item.contactName}
                </Text>
              </View>
            ) : null}
            {(item.createdOn || item.createdAt) ? (
              <View style={[styles.metaChip, { flexDirection }]}>
                <MaterialCommunityIcons
                  name="calendar-outline"
                  size={14}
                  color={theme.colors.onSurfaceVariant}
                />
                <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginStart: 4 }}>
                  {formatDate(item.createdOn || item.createdAt || '')}
                </Text>
              </View>
            ) : null}
          </View>

          <View style={[styles.leadBottom, { flexDirection }]}>
            <Chip
              compact
              textStyle={{
                fontSize: 11,
                color: stageColor(item.stageName || item.stage || 'New'),
                fontWeight: '600',
              }}
              style={{
                backgroundColor: `${stageColor(item.stageName || item.stage || 'New')}35`,
                height: 26,
              }}
            >
              {t(STAGE_I18N[item.stageName || item.stage || 'New'] ?? item.stageName ?? item.stage ?? 'New')}
            </Chip>
            {item.source ? (
              <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                {item.source}
              </Text>
            ) : null}
          </View>
        </View>

        <MaterialCommunityIcons
          name={isRTL ? 'chevron-left' : 'chevron-right'}
          size={20}
          color={theme.colors.onSurfaceVariant}
          style={{ opacity: 0.4, alignSelf: 'center' }}
        />
      </Pressable>
    ),
    [theme, isRTL, flexDirection, textAlign, openLead, stageColor, t],
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
    <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
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
            style={[styles.searchbar, { backgroundColor: theme.colors.surface }]}
            inputStyle={{ fontSize: 14, textAlign: isRTL ? 'right' : 'left' }}
            iconColor={theme.colors.onSurfaceVariant}
            autoFocus
          />
        </Animated.View>
      ) : null}

      {/* Stage filter chips */}
      {viewMode === 'list' ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={[
            styles.stageFilters,
            { flexDirection, paddingStart: 14, paddingEnd: 14 },
          ]}
          style={{ backgroundColor: theme.colors.surface, borderBottomColor: theme.colors.outline, borderBottomWidth: StyleSheet.hairlineWidth }}
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
                    ? { backgroundColor: `${color}20` }
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
      ) : null}

      {/* Content */}
      <View style={{ flex: 1 }}>
      {isLoading && leads.length === 0 ? (
        <View style={[styles.centered, { flex: 1 }]}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      ) : viewMode === 'list' ? (
        <FlashList
          data={filteredLeads}
          renderItem={renderLeadItem}
          keyExtractor={(item, idx) => item.id || `lead_${idx}`}
          estimatedItemSize={90}
          ItemSeparatorComponent={() => <Divider />}
          ListEmptyComponent={renderEmpty}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={[theme.colors.primary]}
              tintColor={theme.colors.primary}
            />
          }
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
                    style={[styles.pipelineCount, { backgroundColor: `${color}20` }]}
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
      </View>

      <FAB
        icon="plus"
        onPress={() => router.push({ pathname: '/(tabs)/leads/[id]', params: { id: 'new' } })}
        style={[styles.fab, { backgroundColor: theme.colors.primary, bottom: insets.bottom + 16 }]}
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
                        ? { backgroundColor: `${theme.colors.primary}25`, borderColor: theme.colors.primary, borderWidth: 1 }
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
                        ? { backgroundColor: `${theme.colors.primary}25`, borderColor: theme.colors.primary, borderWidth: 1 }
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
                        ? { backgroundColor: `${theme.colors.primary}25`, borderColor: theme.colors.primary, borderWidth: 1 }
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
                      ? `${color}20`
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
  stageFilters: {
    gap: 6,
    paddingVertical: 4,
  },
  stageChip: { height: 26 },
  stageChipText: { fontSize: 11 },
  listContent: { paddingTop: 4, paddingBottom: 100 },
  leadRow: {
    alignItems: 'stretch',
    paddingVertical: 10,
    paddingEnd: 14,
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
  leadBottom: { alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
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
  fab: { position: 'absolute', end: 16, borderRadius: 16 },
});
