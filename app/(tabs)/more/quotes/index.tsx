import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { View, StyleSheet, FlatList, Pressable, RefreshControl, Dimensions, Alert } from 'react-native';
import { Text, FAB, ActivityIndicator, Portal, Modal, Button, IconButton, Menu } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { KanbanBoard, type KanbanColumn } from '../../../../components/KanbanBoard';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../../../stores/authStore';
import { useAppTheme } from '../../../../hooks/useAppTheme';
import { useRTL } from '../../../../hooks/useRTL';
import { quotesApi } from '../../../../services/api/quotes';
import { cacheEntities } from '../../../../services/entityCache';
import { useDebouncedValue, useWindowedList } from '../../../../hooks/useWindowedList';
import { ListPaginationFooter } from '../../../../components/ListPaginationFooter';
import { formatDate, formatCurrency, withAlpha } from '../../../../utils/formatters';
import type { Quote } from '../../../../types';
import { currencySymbol } from '../../../../utils/currency';
import { ScreenHeader } from '../../../../components/ScreenHeader';
import { ListToolbar } from '../../../../components/ListToolbar';
import { StatusFilterBar } from '../../../../components/StatusFilterBar';
import { SummaryHeader } from '../../../../components/SummaryHeader';
import { DocumentListItem } from '../../../../components/DocumentListItem';
import { EmptyState } from '../../../../components/EmptyState';

const STATUSES = ['draft', 'sent', 'accepted', 'awaiting_payment', 'paid', 'rejected', 'expired'] as const;
/** Quotes that still wait for the customer / payment — summed in the header. */
const OPEN_STATUSES = ['sent', 'accepted', 'awaiting_payment'];

type SortField = 'date' | 'amount' | 'status';
type SortDirection = 'asc' | 'desc';
type DateRange = 'all' | 'thisWeek' | 'thisMonth' | 'lastMonth';

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

const getStatusColor = (status: string): string => STATUS_COLORS[status] || '#9E9E9E';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const KANBAN_COLUMN_WIDTH = SCREEN_WIDTH * 0.72;

const parseTs = (v: any): number => {
  if (!v) return 0;
  if (typeof v === 'number') return v;
  if (v._seconds) return v._seconds * 1000;
  if (v.seconds) return v.seconds * 1000;
  const d = new Date(v);
  return isNaN(d.getTime()) ? 0 : d.getTime();
};

export default function QuotesListScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useAppTheme();
  const { isRTL, textAlign } = useRTL();
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);

  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [dateRangeFilter, setDateRangeFilter] = useState<DateRange>('all');
  const [dateMenuVisible, setDateMenuVisible] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'kanban'>('list');
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [statusPickerQuote, setStatusPickerQuote] = useState<Quote | null>(null);

  const fetchQuotes = useCallback(async () => {
    if (!user?.organization) { setLoading(false); return; }
    try {
      setError(null);
      const result = await quotesApi.getAll(user.organization);
      const list = Array.isArray(result.data) ? result.data : [];
      setQuotes(list);
      // Warm the detail-screen cache so tapping a quote opens instantly.
      cacheEntities('quotes', list);
    } catch (err: any) {
      setError(err.message || t('errors.generic'));
    } finally {
      setLoading(false);
    }
  }, [user?.organization, t]);

  useEffect(() => { fetchQuotes(); }, [fetchQuotes]);

  const didMountRef = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!didMountRef.current) { didMountRef.current = true; return; }
      fetchQuotes();
    }, [fetchQuotes]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchQuotes();
    setRefreshing(false);
  }, [fetchQuotes]);

  const debouncedSearch = useDebouncedValue(searchQuery, 300);

  // Search + date range apply to everything (counts, totals, list); the status chip only narrows the list.
  const baseList = useMemo(() => {
    let result = quotes;
    if (dateRangeFilter !== 'all') {
      const now = new Date();
      let start: Date | null = null;
      let end: Date | null = null;
      if (dateRangeFilter === 'thisMonth') {
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
      } else if (dateRangeFilter === 'lastMonth') {
        start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
      } else if (dateRangeFilter === 'thisWeek') {
        start = new Date(now);
        start.setDate(now.getDate() - now.getDay());
        start.setHours(0, 0, 0, 0);
        end = now;
      }
      if (start && end) {
        result = result.filter((q) => {
          const d = new Date(q.createdOn || q.date || '');
          return d >= start! && d <= end!;
        });
      }
    }
    const query = debouncedSearch.trim().toLowerCase();
    if (query) {
      result = result.filter(
        (q) =>
          q.title?.toLowerCase().includes(query) ||
          q.quoteNumber?.toLowerCase().includes(query) ||
          q.contactName?.toLowerCase().includes(query),
      );
    }
    return result;
  }, [quotes, dateRangeFilter, debouncedSearch]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const q of baseList) c[q.status] = (c[q.status] || 0) + 1;
    return c;
  }, [baseList]);

  const summary = useMemo(() => {
    let open = 0;
    let paid = 0;
    for (const q of baseList) {
      if (OPEN_STATUSES.includes(q.status)) open += q.total || 0;
      else if (q.status === 'paid') paid += q.total || 0;
    }
    return [
      { label: t('docs.openTotal', 'פתוחות'), value: formatCurrency(open), color: theme.colors.primary },
      { label: t('docs.paidTotal', 'שולמו'), value: formatCurrency(paid), color: STATUS_COLORS.paid },
    ];
  }, [baseList, t, theme.colors.primary]);

  const filteredAndSorted = useMemo(() => {
    const result = statusFilter === 'all' ? [...baseList] : baseList.filter((q) => q.status === statusFilter);
    return result.sort((a, b) => {
      let cmp = 0;
      if (sortField === 'date') cmp = parseTs(a.createdOn || a.createdAt) - parseTs(b.createdOn || b.createdAt);
      else if (sortField === 'amount') cmp = (a.total || 0) - (b.total || 0);
      else cmp = (STATUS_ORDER[a.status] || 0) - (STATUS_ORDER[b.status] || 0);
      return sortDirection === 'desc' ? -cmp : cmp;
    });
  }, [baseList, statusFilter, sortField, sortDirection]);

  const { visible: visibleQuotes, hasMore, loadMore, loadAll, count } = useWindowedList(filteredAndSorted, {
    pageSize: 30,
    resetKey: `${statusFilter}|${dateRangeFilter}|${debouncedSearch}|${sortField}|${sortDirection}`,
  });

  const openQuote = useCallback(
    (quote: Quote) => router.push({ pathname: '/(tabs)/more/quotes/[id]', params: { id: quote.id } }),
    [router],
  );
  const createQuote = useCallback(
    () => router.push({ pathname: '/(tabs)/more/quotes/[id]', params: { id: 'new' } }),
    [router],
  );

  const handleStatusChange = useCallback(
    async (quote: Quote, newStatus: string) => {
      setStatusPickerQuote(null);
      if (!user?.organization) return;
      setQuotes((prev) => prev.map((q) => (q.id === quote.id ? { ...q, status: newStatus as any } : q)));
      try {
        await quotesApi.update(user.organization, { id: quote.id, status: newStatus as any }, user.uID || user.userId, user.fullname);
      } catch (err: any) {
        Alert.alert(t('common.error'), err.message || t('errors.generic'));
        setQuotes((prev) => prev.map((q) => (q.id === quote.id ? { ...q, status: quote.status } : q)));
      }
    },
    [user, t],
  );

  const handleSort = useCallback((field: string) => {
    if (field === sortField) setSortDirection((d) => (d === 'desc' ? 'asc' : 'desc'));
    else { setSortField(field as SortField); setSortDirection('desc'); }
  }, [sortField]);

  // ── Kanban (board view) ──
  const kanbanColumns = useMemo<KanbanColumn<Quote>[]>(() => {
    const grouped: Record<string, Quote[]> = {};
    for (const s of STATUSES) grouped[s] = [];
    for (const q of baseList) if (grouped[q.status]) grouped[q.status].push(q);
    return STATUSES.map((status) => ({
      id: status,
      title: t(`quotes.${status}`),
      color: getStatusColor(status),
      icon: STATUS_ICONS[status] || 'file-document',
      items: grouped[status],
    }));
  }, [baseList, t]);

  const handleKanbanMove = useCallback(
    (item: Quote, _from: string, toColumnId: string) => { handleStatusChange(item, toColumnId); },
    [handleStatusChange],
  );

  const renderQuote = useCallback(
    ({ item }: { item: Quote }) => {
      const validUntilTs = item.validUntil ? new Date(item.validUntil).getTime() : 0;
      const stillOpen = item.status === 'draft' || item.status === 'sent';
      const expired = !!validUntilTs && validUntilTs < Date.now() && stillOpen;
      const showValidity = !!validUntilTs && stillOpen;
      return (
        <DocumentListItem
          title={item.title}
          subtitle={[item.quoteNumber ? `#${item.quoteNumber}` : '', item.contactName || ''].filter(Boolean).join(' · ')}
          amount={formatCurrency(item.total || 0, currencySymbol(item.currency))}
          statusLabel={t(`quotes.${item.status}`)}
          statusColor={getStatusColor(item.status)}
          date={showValidity
            ? `${t('quotes.validUntil')} ${formatDate(item.validUntil!)}`
            : formatDate(item.createdOn || item.createdAt || '')}
          dateWarning={expired}
          viewCount={item.viewCount}
          onPress={() => openQuote(item)}
        />
      );
    },
    [openQuote, t],
  );

  const renderEmpty = useCallback(() => {
    if (loading) return null;
    const filtering = quotes.length > 0;
    return (
      <EmptyState
        icon="file-document-outline"
        title={filtering ? t('common.noResults') : t('quotes.noQuotes')}
        description={filtering ? undefined : t('quotes.noQuotesDesc')}
        actionLabel={filtering ? undefined : t('quotes.addQuote')}
        onAction={filtering ? undefined : createQuote}
      />
    );
  }, [loading, quotes.length, t, createQuote]);

  if (loading && quotes.length === 0) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  const dateOptions: { key: DateRange; label: string }[] = [
    { key: 'all', label: t('docs.allDates', 'כל התאריכים') },
    { key: 'thisWeek', label: t('docs.thisWeek', 'השבוע') },
    { key: 'thisMonth', label: t('docs.thisMonth', 'החודש') },
    { key: 'lastMonth', label: t('docs.lastMonth', 'חודש קודם') },
  ];

  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
      <ScreenHeader
        title={t('quotes.title')}
        onBack={() => router.back()}
        actions={
          <IconButton
            icon={viewMode === 'list' ? 'view-column' : 'view-list'}
            iconColor={theme.custom.headerText}
            size={22}
            onPress={() => setViewMode((v) => (v === 'list' ? 'kanban' : 'list'))}
          />
        }
      />

      <ListToolbar
        query={searchQuery}
        onChangeQuery={setSearchQuery}
        placeholder={t('quotes.searchPlaceholder')}
        sortOptions={viewMode === 'list' ? [
          { key: 'date', label: t('quotes.sortByDate') },
          { key: 'amount', label: t('quotes.sortByAmount') },
          { key: 'status', label: t('quotes.sortByStatus') },
        ] : undefined}
        sortKey={sortField}
        sortDir={sortDirection}
        onSort={handleSort}
        trailing={
          <Menu
            visible={dateMenuVisible}
            onDismiss={() => setDateMenuVisible(false)}
            anchor={
              <View>
                <IconButton
                  icon="calendar-range"
                  size={22}
                  iconColor={dateRangeFilter !== 'all' ? theme.colors.primary : theme.colors.onSurfaceVariant}
                  onPress={() => setDateMenuVisible(true)}
                />
                {dateRangeFilter !== 'all' ? <View style={[styles.activeDot, { backgroundColor: theme.colors.primary }]} /> : null}
              </View>
            }
            contentStyle={{ backgroundColor: theme.colors.surface }}
          >
            {dateOptions.map((o) => (
              <Menu.Item
                key={o.key}
                title={o.label}
                leadingIcon={dateRangeFilter === o.key ? 'check' : undefined}
                onPress={() => { setDateRangeFilter(o.key); setDateMenuVisible(false); }}
              />
            ))}
          </Menu>
        }
      />

      {viewMode === 'list' ? (
        <>
          <SummaryHeader items={summary} />
          <StatusFilterBar
            allLabel={t('common.all')}
            allCount={baseList.length}
            options={STATUSES.map((s) => ({ key: s, label: t(`quotes.${s}`), color: getStatusColor(s), count: counts[s] || 0 }))}
            value={statusFilter}
            onChange={setStatusFilter}
          />
        </>
      ) : null}

      {error ? (
        <Pressable onPress={fetchQuotes} style={[styles.errorBanner, { backgroundColor: theme.colors.errorContainer }]}>
          <MaterialCommunityIcons name="alert-circle" size={18} color={theme.colors.error} />
          <Text variant="bodySmall" style={{ flex: 1, color: theme.colors.error }} numberOfLines={1}>{error}</Text>
          <Text variant="labelSmall" style={{ color: theme.colors.error, fontWeight: '600' }}>{t('common.retry')}</Text>
        </Pressable>
      ) : null}

      {viewMode === 'kanban' ? (
        <KanbanBoard
          columns={kanbanColumns}
          keyExtractor={(item) => item.id}
          onMoveItem={handleKanbanMove}
          columnWidth={KANBAN_COLUMN_WIDTH}
          emptyLabel={t('quotes.noQuotesInStatus')}
          renderCard={(item) => (
            <Pressable
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
              <Text variant="titleSmall" numberOfLines={1} style={{ color: theme.colors.onSurface, fontWeight: '600', textAlign }}>
                {item.title}
              </Text>
              {item.contactName ? (
                <Text variant="labelSmall" numberOfLines={1} style={{ color: theme.colors.onSurfaceVariant, textAlign }}>
                  {item.contactName}
                </Text>
              ) : null}
              <View style={styles.kanbanBottom}>
                <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                  {formatDate(item.createdOn || item.createdAt || '')}
                </Text>
                <Text variant="titleSmall" style={{ color: theme.colors.primary, fontWeight: '700' }}>
                  {formatCurrency(item.total || 0, currencySymbol(item.currency))}
                </Text>
              </View>
            </Pressable>
          )}
        />
      ) : (
        <FlatList
          data={visibleQuotes}
          renderItem={renderQuote}
          keyExtractor={(item) => item.id}
          ListEmptyComponent={renderEmpty}
          ListFooterComponent={
            <ListPaginationFooter count={count} total={filteredAndSorted.length} hasMore={hasMore} onLoadMore={loadMore} onLoadAll={loadAll} />
          }
          onEndReached={hasMore ? loadMore : undefined}
          onEndReachedThreshold={0.4}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[theme.colors.primary]} tintColor={theme.colors.primary} />
          }
          contentContainerStyle={[styles.listContent, filteredAndSorted.length === 0 && styles.listContentEmpty]}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          showsVerticalScrollIndicator={false}
        />
      )}

      <FAB
        icon="plus"
        onPress={createQuote}
        style={[styles.fab, { backgroundColor: theme.colors.primary, bottom: insets.bottom + 16, left: isRTL ? 16 : undefined, right: isRTL ? undefined : 16 }]}
        color="#FFFFFF"
        label={t('quotes.addQuote')}
      />

      {/* Long-press on a board card → quick status change */}
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
          {STATUSES.map((status) => {
            const color = getStatusColor(status);
            const isCurrent = statusPickerQuote?.status === status;
            return (
              <Pressable
                key={status}
                onPress={() => statusPickerQuote && handleStatusChange(statusPickerQuote, status)}
                disabled={isCurrent}
                style={({ pressed }) => [
                  styles.statusPickerOption,
                  { backgroundColor: isCurrent ? withAlpha(color, 0.12) : pressed ? theme.colors.surfaceVariant : 'transparent' },
                ]}
              >
                <MaterialCommunityIcons name={(STATUS_ICONS[status] || 'file-document') as any} size={18} color={color} />
                <Text variant="bodyMedium" style={{ flex: 1, color: isCurrent ? color : theme.colors.onSurface, fontWeight: isCurrent ? '700' : '400' }}>
                  {t(`quotes.${status}`)}
                </Text>
                {isCurrent ? <MaterialCommunityIcons name="check" size={20} color={color} /> : null}
              </Pressable>
            );
          })}
          <Button mode="text" onPress={() => setStatusPickerQuote(null)} style={{ marginTop: 8 }} textColor={theme.colors.onSurfaceVariant}>
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
  listContent: { padding: 14, paddingBottom: 100 },
  listContentEmpty: { flexGrow: 1 },
  fab: { position: 'absolute', borderRadius: 16 },
  activeDot: { position: 'absolute', top: 8, right: 8, width: 8, height: 8, borderRadius: 4 },
  errorBanner: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  kanbanCard: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    gap: 4,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
  },
  kanbanBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
    paddingTop: 6,
  },
  statusPickerModal: { marginHorizontal: 24, borderRadius: 16, padding: 20 },
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
