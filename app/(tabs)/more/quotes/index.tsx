import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  Pressable,
  RefreshControl,
  Animated,
  ScrollView,
  Dimensions,
} from 'react-native';
import {
  Text,
  Searchbar,
  Chip,
  FAB,
  ActivityIndicator,
  Portal,
  Modal,
  Button,
  IconButton,
  Divider,
  Menu,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../../../stores/authStore';
import { useAppTheme } from '../../../../hooks/useAppTheme';
import { useRTL } from '../../../../hooks/useRTL';
import { quotesApi } from '../../../../services/api/quotes';
import { formatDate, formatCurrency, withAlpha } from '../../../../utils/formatters';
import { spacing, borderRadius } from '../../../../constants/theme';
import type { Quote } from '../../../../types';

const STATUS_FILTERS = ['all', 'draft', 'sent', 'accepted', 'awaiting_payment', 'paid', 'rejected', 'expired'] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

const KANBAN_STATUSES = ['draft', 'sent', 'accepted', 'awaiting_payment', 'paid', 'rejected', 'expired'] as const;

type SortField = 'date' | 'amount' | 'status';
type SortDirection = 'asc' | 'desc';

const STATUS_COLORS: Record<string, string> = {
  draft: '#9E9E9E',
  sent: '#2196F3',
  accepted: '#4CAF50',
  awaiting_payment: '#FF9800',
  paid: '#388E3C',
  rejected: '#F44336',
  expired: '#795548',
};

const STATUS_ICONS: Record<string, string> = {
  draft: 'file-edit-outline',
  sent: 'send-check',
  accepted: 'check-circle',
  awaiting_payment: 'clock-outline',
  paid: 'cash-check',
  rejected: 'close-circle',
  expired: 'clock-alert-outline',
};

const STATUS_ORDER: Record<string, number> = {
  draft: 0,
  sent: 1,
  accepted: 2,
  awaiting_payment: 3,
  paid: 4,
  rejected: 5,
  expired: 6,
};

function getStatusColor(status: string): string {
  return STATUS_COLORS[status] || '#9E9E9E';
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const KANBAN_COLUMN_WIDTH = SCREEN_WIDTH * 0.72;

export default function QuotesListScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useAppTheme();
  const { isRTL, flexDirection, textAlign } = useRTL();
  const { t } = useTranslation();

  const user = useAuthStore((s) => s.user);

  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchVisible, setSearchVisible] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [viewMode, setViewMode] = useState<'list' | 'kanban'>('list');
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [sortMenuVisible, setSortMenuVisible] = useState(false);

  const [statusPickerQuote, setStatusPickerQuote] = useState<Quote | null>(null);

  const searchAnim = useRef(new Animated.Value(0)).current;

  const fetchQuotes = useCallback(async () => {
    if (!user?.organization) { setLoading(false); return; }
    try {
      setError(null);
      const result = await quotesApi.getAll(user.organization);
      setQuotes(Array.isArray(result.data) ? result.data : []);
    } catch (err: any) {
      setError(err.message || t('errors.generic'));
    } finally {
      setLoading(false);
    }
  }, [user?.organization, t]);

  useEffect(() => {
    fetchQuotes();
  }, [fetchQuotes]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchQuotes();
    setRefreshing(false);
  }, [fetchQuotes]);

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
  }, [searchVisible, searchAnim]);

  const filteredAndSortedQuotes = useMemo(() => {
    let result = quotes;

    if (statusFilter !== 'all') {
      result = result.filter((q) => q.status === statusFilter);
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (q) =>
          q.title?.toLowerCase().includes(query) ||
          q.quoteNumber?.toLowerCase().includes(query) ||
          q.contactName?.toLowerCase().includes(query),
      );
    }

    return result.sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case 'date':
          comparison =
            new Date(a.createdOn || a.createdAt || 0).getTime() -
            new Date(b.createdOn || b.createdAt || 0).getTime();
          break;
        case 'amount':
          comparison = (a.total || 0) - (b.total || 0);
          break;
        case 'status':
          comparison = (STATUS_ORDER[a.status] || 0) - (STATUS_ORDER[b.status] || 0);
          break;
      }
      return sortDirection === 'desc' ? -comparison : comparison;
    });
  }, [quotes, statusFilter, searchQuery, sortField, sortDirection]);

  const kanbanData = useMemo(() => {
    const grouped: Record<string, Quote[]> = {};
    for (const status of KANBAN_STATUSES) {
      grouped[status] = [];
    }
    const searchFiltered = searchQuery.trim()
      ? quotes.filter((q) => {
          const query = searchQuery.toLowerCase();
          return (
            q.title?.toLowerCase().includes(query) ||
            q.quoteNumber?.toLowerCase().includes(query) ||
            q.contactName?.toLowerCase().includes(query)
          );
        })
      : quotes;

    for (const q of searchFiltered) {
      if (grouped[q.status]) {
        grouped[q.status].push(q);
      }
    }
    return grouped;
  }, [quotes, searchQuery]);

  const openQuote = useCallback(
    (quote: Quote) => {
      router.push({ pathname: '/(tabs)/more/quotes/[id]', params: { id: quote.id } });
    },
    [router],
  );

  const handleStatusChange = useCallback(
    async (quote: Quote, newStatus: string) => {
      setStatusPickerQuote(null);
      if (!user?.organization) return;
      try {
        await quotesApi.update(
          user.organization,
          { id: quote.id, status: newStatus as any },
          user.uID || user.userId,
          user.fullname,
        );
        setQuotes((prev) =>
          prev.map((q) => (q.id === quote.id ? { ...q, status: newStatus as any } : q)),
        );
      } catch (err: any) {
        Alert.alert(t('common.error'), err.message || t('errors.generic'));
        // rollback optimistic update
        setQuotes((prev) =>
          prev.map((q) => (q.id === quote.id ? { ...q, status: quote.status } : q)),
        );
      }
    },
    [user, t],
  );

  const searchHeightInterp = searchAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 56],
  });

  const handleSortSelect = useCallback((field: SortField) => {
    setSortField((prev) => {
      if (prev === field) {
        setSortDirection((d) => (d === 'desc' ? 'asc' : 'desc'));
      } else {
        setSortDirection('desc');
      }
      return field;
    });
    setSortMenuVisible(false);
  }, []);

  const renderQuoteCard = useCallback(
    ({ item }: { item: Quote }) => {
      const statusColor = getStatusColor(item.status);

      return (
        <Pressable
          onPress={() => openQuote(item)}
          android_ripple={{ color: theme.colors.surfaceVariant }}
          style={({ pressed }) => [
            styles.quoteCard,
            {
              backgroundColor: pressed ? theme.colors.surfaceVariant : theme.custom.cardBackground,
              borderColor: theme.colors.outlineVariant,
            },
          ]}
        >
          <View style={[styles.cardStatusBar, { backgroundColor: statusColor }]} />

          <View style={styles.cardContent}>
            <View style={[styles.cardTopRow, { flexDirection }]}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text
                  variant="titleSmall"
                  numberOfLines={1}
                  style={[styles.cardTitle, { color: theme.colors.onSurface, textAlign }]}
                >
                  {item.title}
                </Text>
                {item.quoteNumber ? (
                  <Text
                    variant="labelSmall"
                    style={{ color: theme.colors.onSurfaceVariant, textAlign }}
                  >
                    #{item.quoteNumber}
                  </Text>
                ) : null}
              </View>
              <Chip
                compact
                textStyle={[styles.statusChipText, { color: statusColor }]}
                style={[styles.statusChip, { backgroundColor: `${statusColor}35` }]}
              >
                {t(`quotes.${item.status}`)}
              </Chip>
            </View>

            <Divider style={{ marginVertical: 8, backgroundColor: theme.colors.outlineVariant }} />

            <View style={[styles.cardMeta, { flexDirection }]}>
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

              <View style={[styles.metaItem, { flexDirection }]}>
                <MaterialCommunityIcons
                  name="calendar"
                  size={14}
                  color={theme.colors.onSurfaceVariant}
                />
                <Text
                  variant="labelSmall"
                  style={[styles.metaText, { color: theme.colors.onSurfaceVariant }]}
                >
                  {formatDate(item.createdOn || item.createdAt || '')}
                </Text>
              </View>

              {item.validUntil ? (
                <View style={[styles.metaItem, { flexDirection }]}>
                  <MaterialCommunityIcons
                    name="clock-alert-outline"
                    size={14}
                    color={
                      new Date(item.validUntil) < new Date()
                        ? '#F44336'
                        : theme.colors.onSurfaceVariant
                    }
                  />
                  <Text
                    variant="labelSmall"
                    style={[
                      styles.metaText,
                      {
                        color:
                          new Date(item.validUntil) < new Date()
                            ? '#F44336'
                            : theme.colors.onSurfaceVariant,
                      },
                    ]}
                  >
                    {formatDate(item.validUntil)}
                  </Text>
                </View>
              ) : null}
            </View>

            <View style={[styles.cardBottomRow, { flexDirection }]}>
              <View style={{ flex: 1 }} />
              <Text
                variant="titleMedium"
                style={[styles.totalAmount, { color: theme.colors.primary }]}
              >
                {formatCurrency(item.total || 0, item.currency || '₪')}
              </Text>
            </View>
          </View>
        </Pressable>
      );
    },
    [theme, openQuote, flexDirection, textAlign, t],
  );

  const renderKanbanCard = useCallback(
    (item: Quote) => {
      const statusColor = getStatusColor(item.status);
      return (
        <Pressable
          key={item.id}
          onPress={() => openQuote(item)}
          onLongPress={() => setStatusPickerQuote(item)}
          delayLongPress={400}
          android_ripple={{ color: theme.colors.surfaceVariant }}
          style={({ pressed }) => [
            styles.kanbanCard,
            {
              backgroundColor: pressed ? theme.colors.surfaceVariant : theme.custom.cardBackground,
              borderColor: theme.colors.outlineVariant,
            },
          ]}
        >
          <Text
            variant="titleSmall"
            numberOfLines={1}
            style={[styles.cardTitle, { color: theme.colors.onSurface, textAlign }]}
          >
            {item.title}
          </Text>
          {item.quoteNumber ? (
            <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant, textAlign }}>
              #{item.quoteNumber}
            </Text>
          ) : null}

          {item.contactName ? (
            <View style={[styles.kanbanMeta, { flexDirection }]}>
              <MaterialCommunityIcons name="account" size={13} color={theme.colors.onSurfaceVariant} />
              <Text variant="labelSmall" numberOfLines={1} style={{ color: theme.colors.onSurfaceVariant, flex: 1 }}>
                {item.contactName}
              </Text>
            </View>
          ) : null}

          <View style={[styles.kanbanBottom, { flexDirection }]}>
            <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
              {formatDate(item.createdOn || item.createdAt || '')}
            </Text>
            <Text variant="titleSmall" style={{ color: theme.colors.primary, fontWeight: '700' }}>
              {formatCurrency(item.total || 0, item.currency || '₪')}
            </Text>
          </View>
        </Pressable>
      );
    },
    [theme, openQuote, flexDirection, textAlign],
  );

  const renderKanbanView = useCallback(() => {
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.kanbanContainer}
        style={{ flex: 1 }}
      >
        {KANBAN_STATUSES.map((status) => {
          const statusColor = getStatusColor(status);
          const statusQuotes = kanbanData[status] || [];
          return (
            <View key={status} style={[styles.kanbanColumn, { width: KANBAN_COLUMN_WIDTH }]}>
              <View
                style={[
                  styles.kanbanColumnHeader,
                  { backgroundColor: `${statusColor}15`, borderBottomColor: statusColor },
                ]}
              >
                <View style={[styles.kanbanHeaderInner, { flexDirection }]}>
                  <MaterialCommunityIcons
                    name={(STATUS_ICONS[status] || 'file-document') as any}
                    size={16}
                    color={statusColor}
                  />
                  <Text variant="labelLarge" style={{ color: statusColor, fontWeight: '700', flex: 1 }}>
                    {t(`quotes.${status}`)}
                  </Text>
                  <View style={[styles.kanbanBadge, { backgroundColor: `${statusColor}25` }]}>
                    <Text variant="labelSmall" style={{ color: statusColor, fontWeight: '700' }}>
                      {statusQuotes.length}
                    </Text>
                  </View>
                </View>
              </View>

              <ScrollView
                style={styles.kanbanColumnBody}
                contentContainerStyle={styles.kanbanColumnContent}
                showsVerticalScrollIndicator={false}
              >
                {statusQuotes.length === 0 ? (
                  <View style={styles.kanbanEmpty}>
                    <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center' }}>
                      {t('quotes.noQuotesInStatus')}
                    </Text>
                  </View>
                ) : (
                  statusQuotes.map(renderKanbanCard)
                )}
              </ScrollView>
            </View>
          );
        })}
      </ScrollView>
    );
  }, [kanbanData, theme, t, flexDirection, renderKanbanCard]);

  const renderEmpty = useCallback(() => {
    if (loading) return null;

    return (
      <View style={styles.emptyContainer}>
        <MaterialCommunityIcons
          name="file-document-outline"
          size={72}
          color={theme.colors.onSurfaceVariant}
          style={{ opacity: 0.3 }}
        />
        <Text
          variant="titleMedium"
          style={[styles.emptyTitle, { color: theme.colors.onSurface }]}
        >
          {t('quotes.noQuotes')}
        </Text>
        <Text
          variant="bodyMedium"
          style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center' }}
        >
          {t('quotes.noQuotesDesc')}
        </Text>
      </View>
    );
  }, [loading, theme, t]);

  if (loading && quotes.length === 0) {
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
          <Text style={[styles.headerTitle, { flex: 1, textAlign }]}>{t('quotes.title')}</Text>

          <Pressable
            onPress={() => setViewMode((v) => (v === 'list' ? 'kanban' : 'list'))}
            hitSlop={8}
            style={({ pressed }) => [styles.headerIcon, pressed && { opacity: 0.7 }]}
          >
            <MaterialCommunityIcons
              name={viewMode === 'list' ? 'view-column' : 'view-list'}
              size={22}
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
            placeholder={t('quotes.searchPlaceholder')}
            value={searchQuery}
            onChangeText={setSearchQuery}
            style={[styles.searchbar, { backgroundColor: theme.colors.surface }]}
            inputStyle={{ fontSize: 14, textAlign: isRTL ? 'right' : 'left' }}
            iconColor={theme.colors.onSurfaceVariant}
            autoFocus
          />
        </Animated.View>
      )}

      {/* Filter chips + sort (only in list mode) */}
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
          {viewMode === 'list' &&
            STATUS_FILTERS.map((f) => {
              const chipColor = f === 'all' ? theme.colors.primary : getStatusColor(f);
              const isActive = statusFilter === f;

              return (
                <Chip
                  key={f}
                  selected={isActive}
                  onPress={() => setStatusFilter(f)}
                  showSelectedOverlay
                  compact
                  style={[
                    styles.filterChip,
                    isActive
                      ? { backgroundColor: `${chipColor}20`, borderColor: chipColor, borderWidth: 1 }
                      : { backgroundColor: theme.colors.surfaceVariant },
                  ]}
                  textStyle={[
                    styles.filterChipText,
                    isActive && { color: chipColor, fontWeight: '600' },
                  ]}
                >
                  {f === 'all' ? t('common.all') : t(`quotes.${f}`)}
                </Chip>
              );
            })}

          {viewMode === 'list' && (
            <Menu
              visible={sortMenuVisible}
              onDismiss={() => setSortMenuVisible(false)}
              anchor={
                <Chip
                  compact
                  icon="sort"
                  onPress={() => setSortMenuVisible(true)}
                  style={[styles.filterChip, { backgroundColor: theme.colors.surfaceVariant }]}
                  textStyle={styles.filterChipText}
                >
                  {t('quotes.sortBy')}
                </Chip>
              }
              contentStyle={{ backgroundColor: theme.colors.surface }}
            >
              <Menu.Item
                onPress={() => handleSortSelect('date')}
                title={t('quotes.sortByDate')}
                leadingIcon={sortField === 'date' ? (sortDirection === 'desc' ? 'sort-calendar-descending' : 'sort-calendar-ascending') : 'calendar'}
                titleStyle={sortField === 'date' ? { color: theme.colors.primary, fontWeight: '600' } : undefined}
              />
              <Menu.Item
                onPress={() => handleSortSelect('amount')}
                title={t('quotes.sortByAmount')}
                leadingIcon={sortField === 'amount' ? (sortDirection === 'desc' ? 'sort-numeric-descending' : 'sort-numeric-ascending') : 'cash'}
                titleStyle={sortField === 'amount' ? { color: theme.colors.primary, fontWeight: '600' } : undefined}
              />
              <Menu.Item
                onPress={() => handleSortSelect('status')}
                title={t('quotes.sortByStatus')}
                leadingIcon="list-status"
                titleStyle={sortField === 'status' ? { color: theme.colors.primary, fontWeight: '600' } : undefined}
              />
            </Menu>
          )}
        </ScrollView>
      </View>

      {/* Error banner */}
      {error ? (
        <Pressable
          onPress={fetchQuotes}
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

      {/* View: List or Kanban */}
      {viewMode === 'kanban' ? (
        renderKanbanView()
      ) : (
        <FlatList
          data={filteredAndSortedQuotes}
          renderItem={renderQuoteCard}
          keyExtractor={(item) => item.id}
          ListEmptyComponent={renderEmpty}
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
            filteredAndSortedQuotes.length === 0 && styles.listContentEmpty,
          ]}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* FAB */}
      <FAB
        icon="plus"
        onPress={() => router.push({ pathname: '/(tabs)/more/quotes/[id]', params: { id: 'new' } })}
        style={[
          styles.fab,
          { backgroundColor: theme.colors.primary, bottom: insets.bottom + 16, left: isRTL ? 16 : undefined, right: isRTL ? undefined : 16 },
        ]}
        color="#FFFFFF"
        label={t('quotes.addQuote')}
      />

      <Portal>
        <Modal
          visible={!!statusPickerQuote}
          onDismiss={() => setStatusPickerQuote(null)}
          contentContainerStyle={[styles.statusPickerModal, { backgroundColor: theme.colors.surface }]}
        >
          <Text variant="titleMedium" style={{ color: theme.colors.onSurface, fontWeight: '700', marginBottom: 4 }}>
            {t('leads.moveStage')}
          </Text>
          {statusPickerQuote ? (
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 16 }}>
              {statusPickerQuote.title}
            </Text>
          ) : null}
          {KANBAN_STATUSES.map((status) => {
            const color = getStatusColor(status);
            const isCurrent = statusPickerQuote?.status === status;
            return (
              <Pressable
                key={status}
                onPress={() => statusPickerQuote && handleStatusChange(statusPickerQuote, status)}
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
                <MaterialCommunityIcons
                  name={(STATUS_ICONS[status] || 'file-document') as any}
                  size={18}
                  color={color}
                />
                <Text
                  variant="bodyMedium"
                  style={{
                    flex: 1,
                    color: isCurrent ? color : theme.colors.onSurface,
                    fontWeight: isCurrent ? '700' : '400',
                  }}
                >
                  {t(`quotes.${status}`)}
                </Text>
                {isCurrent ? (
                  <MaterialCommunityIcons name="check" size={20} color={color} />
                ) : null}
              </Pressable>
            );
          })}
          <Button
            mode="text"
            onPress={() => setStatusPickerQuote(null)}
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
  searchWrap: {
    paddingHorizontal: 14,
    overflow: 'hidden',
    justifyContent: 'center',
    paddingBottom: 8,
  },
  searchbar: { height: 40, borderRadius: 20, elevation: 0 },
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
  quoteCard: {
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
  cardStatusBar: {
    width: 5,
    borderTopLeftRadius: borderRadius.lg,
    borderBottomLeftRadius: borderRadius.lg,
  },
  cardContent: {
    flex: 1,
    padding: 14,
  },
  cardTopRow: {
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  cardTitle: {
    fontWeight: '600',
    fontSize: 15,
  },
  statusChip: {
    height: 24,
    borderRadius: 12,
  },
  statusChipText: {
    fontSize: 11,
    fontWeight: '600',
  },
  cardMeta: {
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
  cardBottomRow: {
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  totalAmount: {
    fontWeight: '700',
    fontSize: 18,
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
  modalActions: {
    gap: 12,
    justifyContent: 'flex-end',
    marginTop: 8,
  },
  modalButton: {
    minWidth: 100,
    borderRadius: borderRadius.md,
  },
  // Kanban styles
  kanbanContainer: {
    paddingHorizontal: 10,
    paddingTop: 10,
    paddingBottom: 100,
    gap: 10,
  },
  kanbanColumn: {
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  kanbanColumnHeader: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 2,
  },
  kanbanHeaderInner: {
    alignItems: 'center',
    gap: 6,
  },
  kanbanBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    minWidth: 24,
    alignItems: 'center',
  },
  kanbanColumnBody: {
    flex: 1,
    maxHeight: Dimensions.get('window').height * 0.6,
  },
  kanbanColumnContent: {
    padding: 8,
    gap: 8,
  },
  kanbanCard: {
    borderRadius: borderRadius.md,
    borderWidth: 1,
    padding: 12,
    gap: 4,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
  },
  kanbanMeta: {
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  kanbanBottom: {
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E0E0E0',
  },
  kanbanEmpty: {
    paddingVertical: 24,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  statusPickerModal: {
    marginHorizontal: 24,
    borderRadius: 16,
    padding: 20,
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
});
