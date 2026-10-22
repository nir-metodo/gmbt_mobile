import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  Alert,
} from 'react-native';
import {
  Text,
  Chip,
  ActivityIndicator,
  IconButton,
  FAB,
  Portal,
  Modal,
  Button,
  TextInput,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { KanbanBoard, type KanbanColumn } from '../../../../components/KanbanBoard';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../../../stores/authStore';
import { useAppTheme } from '../../../../hooks/useAppTheme';
import { useRTL } from '../../../../hooks/useRTL';
import {
  ordersApi,
  Order,
  OrderStatusConfig,
  DEFAULT_ORDER_STATUSES,
  normalizeOrderStatus,
  resolveOrderStatusIcon,
  getOrderTotal,
} from '../../../../services/api/orders';
import { useDebouncedValue, useWindowedList } from '../../../../hooks/useWindowedList';
import { ListPaginationFooter } from '../../../../components/ListPaginationFooter';
import { formatDate, formatCurrency } from '../../../../utils/formatters';
import { ScreenHeader } from '../../../../components/ScreenHeader';
import { ListToolbar } from '../../../../components/ListToolbar';
import { StatusFilterBar } from '../../../../components/StatusFilterBar';
import { SummaryHeader } from '../../../../components/SummaryHeader';
import { DocumentListItem } from '../../../../components/DocumentListItem';
import { EmptyState } from '../../../../components/EmptyState';
import { borderRadius } from '../../../../constants/theme';
import { appCache } from '../../../../services/cache';
import { cacheEntities } from '../../../../services/entityCache';
import { readList as readDiskList, cacheList as cacheDiskList } from '../../../../services/db/genericCache';

const BRAND_COLOR = '#2e6155';

type StatusFilter = string;

const STATUS_COLORS: Record<string, string> = {
  pending: '#FF9800',
  confirmed: '#2196F3',
  collected: '#9C27B0',
  processing: '#9C27B0',
  shipped: '#00BCD4',
  delivered: '#4CAF50',
  cancelled: '#9E9E9E',
  refunded: '#F44336',
};

const STATUS_ICONS: Record<string, string> = {
  pending: 'clock-outline',
  confirmed: 'check-circle-outline',
  collected: 'package-variant',
  processing: 'cog-outline',
  shipped: 'truck-outline',
  delivered: 'package-variant-closed-check',
  cancelled: 'close-circle-outline',
  refunded: 'cash-refund',
};

function getStatusColor(statusId: string, statuses: OrderStatusConfig[]): string {
  return statuses.find((s) => s.id === statusId)?.color
    || STATUS_COLORS[statusId]
    || '#9E9E9E';
}

function getStatusIcon(statusId: string, statuses: OrderStatusConfig[]): string {
  return statuses.find((s) => s.id === statusId)?.icon
    || STATUS_ICONS[statusId]
    || resolveOrderStatusIcon(statusId);
}

export default function OrdersScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useAppTheme();
  const { isRTL, flexDirection, textAlign } = useRTL();
  const { t, i18n } = useTranslation();
  const lang: 'en' | 'he' = (i18n.language || 'he').startsWith('he') ? 'he' : 'en';
  const user = useAuthStore((s) => s.user);

  const CACHE_KEY = `orders_${user?.organization}`;

  const [orders, setOrders] = useState<Order[]>(() => appCache.get<Order[]>(CACHE_KEY) ?? []);
  const [loading, setLoading] = useState(!appCache.get<Order[]>(CACHE_KEY));
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState<'date' | 'amount' | 'status'>('date');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [viewMode, setViewModeState] = useState<'list' | 'kanban'>('list');
  const [statuses, setStatuses] = useState<OrderStatusConfig[]>(DEFAULT_ORDER_STATUSES);

  // View (list / kanban): the user's own last choice wins; with no choice yet, follow the org's
  // "default view" from Orders settings (same rule as the web).
  const VIEW_KEY = 'orders_view_mode';
  const hasStoredViewRef = useRef(false);
  const viewResolvedRef = useRef(false);
  const setViewMode = useCallback((m: 'list' | 'kanban') => {
    hasStoredViewRef.current = true;
    setViewModeState(m);
    AsyncStorage.setItem(VIEW_KEY, m).catch(() => {});
  }, []);
  useEffect(() => {
    AsyncStorage.getItem(VIEW_KEY).then((v) => {
      if (v === 'list' || v === 'kanban') {
        hasStoredViewRef.current = true;
        viewResolvedRef.current = true;
        setViewModeState(v);
      }
    }).catch(() => {});
  }, []);

  // Advanced filters
  const [advancedVisible, setAdvancedVisible] = useState(false);
  const [filterSource, setFilterSource] = useState('');
  const [filterOwner, setFilterOwner] = useState('');
  const [filterProduct, setFilterProduct] = useState('');
  const [filterPayment, setFilterPayment] = useState('');
  const [filterCustom, setFilterCustom] = useState<Record<string, string>>({});
  const [customFieldDefs, setCustomFieldDefs] = useState<{ key: string; label: string }[]>([]);

  const loadSettings = useCallback(async () => {
    if (!user?.organization) return;
    try {
      const { statuses: loaded, defaultView } = await ordersApi.getSettings(user.organization);
      if (loaded.length > 0) setStatuses(loaded);
      if (defaultView && !hasStoredViewRef.current && !viewResolvedRef.current) {
        viewResolvedRef.current = true;
        setViewModeState(defaultView);
      }
    } catch {
      setStatuses(DEFAULT_ORDER_STATUSES);
    }
    // Load custom field definitions so we can offer custom-field filters.
    try {
      const { sections } = await ordersApi.getOrderFormSettings(user.organization);
      const defs: { key: string; label: string }[] = [];
      (sections || []).forEach((section: any) => {
        const raw = section?.fields;
        const entries = Array.isArray(raw)
          ? raw.map((f: any, i: number) => [f.key || f.id || `field_${i}`, f])
          : Object.entries(raw || {});
        entries.forEach(([key, f]: any) => {
          const label = (lang === 'he' ? f?.labelHe : f?.labelEn) || f?.label || key;
          if (!defs.some((d) => d.key === key)) defs.push({ key, label });
        });
      });
      setCustomFieldDefs(defs);
    } catch { /* settings optional */ }
  }, [user?.organization, lang]);

  const fetchOrders = useCallback(async () => {
    if (!user?.organization) { setLoading(false); return; }
    try {
      setError(null);
      const data = await ordersApi.getAll(user.organization);
      appCache.set(CACHE_KEY, data);
      cacheEntities('orders', data);
      cacheDiskList('orders', user.organization, data, (o) => o.id);
      setOrders(data);
    } catch (err: any) {
      setError(err.message || t('errors.generic'));
    } finally {
      setLoading(false);
    }
  }, [user?.organization, t, CACHE_KEY]);

  // Instant open after an app restart: hydrate from the on-device DB before the network responds.
  useEffect(() => {
    if (!user?.organization || orders.length > 0) return;
    let active = true;
    readDiskList<Order>('orders', user.organization).then((cached) => {
      if (active && cached.length > 0) {
        setOrders((prev) => (prev.length > 0 ? prev : cached));
        setLoading(false);
      }
    });
    return () => { active = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.organization]);

  useEffect(() => {
    fetchOrders();
    loadSettings();
  }, [fetchOrders, loadSettings]);

  const didMountRef = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!didMountRef.current) {
        didMountRef.current = true;
        return;
      }
      fetchOrders();
      loadSettings();
    }, [fetchOrders, loadSettings])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchOrders();
    setRefreshing(false);
  }, [fetchOrders]);

  // Distinct values present in the loaded orders, for selectable advanced filters
  const orderOptions = useMemo(() => {
    const sources = new Set<string>();
    const owners = new Set<string>();
    const products = new Set<string>();
    (Array.isArray(orders) ? orders : []).forEach((o) => {
      if (o.source) sources.add(o.source);
      const assignee = (o as any).assignedTo;
      if (assignee) owners.add(String(assignee));
      (o.items || []).forEach((i: any) => {
        const n = i.productName || i.name;
        if (n) products.add(String(n));
      });
    });
    const sortFn = (a: string, b: string) => a.localeCompare(b);
    return {
      sources: [...sources].sort(sortFn),
      owners: [...owners].sort(sortFn),
      products: [...products].sort(sortFn),
    };
  }, [orders]);

  const activeAdvancedCount = useMemo(() => {
    let c = 0;
    if (filterSource) c++;
    if (filterOwner) c++;
    if (filterProduct) c++;
    if (filterPayment) c++;
    c += Object.values(filterCustom).filter((v) => v && String(v).trim() !== '').length;
    return c;
  }, [filterSource, filterOwner, filterProduct, filterPayment, filterCustom]);

  const clearAdvancedFilters = useCallback(() => {
    setFilterSource('');
    setFilterOwner('');
    setFilterProduct('');
    setFilterPayment('');
    setFilterCustom({});
  }, []);

  // Debounce search so the list re-filters once typing pauses (no per-keystroke flicker).
  const debouncedSearch = useDebouncedValue(searchQuery, 350);

  // Search + advanced filters apply to everything (counts, totals, list); the status chip only narrows the list.
  const baseList = useMemo(() => {
    let result = Array.isArray(orders) ? orders : [];
    if (debouncedSearch.trim()) {
      const q = debouncedSearch.toLowerCase();
      result = result.filter(
        (o) =>
          o.orderNumber?.toLowerCase().includes(q) ||
          o.customerName?.toLowerCase().includes(q) ||
          o.customerPhone?.toLowerCase().includes(q) ||
          o.customerEmail?.toLowerCase().includes(q),
      );
    }
    if (filterSource) result = result.filter((o) => (o.source || 'manual') === filterSource);
    if (filterOwner) result = result.filter((o) => String((o as any).assignedTo || '') === filterOwner);
    if (filterPayment) result = result.filter((o) => String((o as any).paymentStatus || 'unpaid') === filterPayment);
    if (filterProduct) {
      result = result.filter((o) =>
        (o.items || []).some((i: any) => String(i.productName || i.name || '') === filterProduct),
      );
    }
    Object.entries(filterCustom).forEach(([key, val]) => {
      if (!val || String(val).trim() === '') return;
      const needle = String(val).toLowerCase();
      result = result.filter((o) =>
        String((o as any).customFields?.[key] ?? (o as any)[key] ?? '').toLowerCase().includes(needle),
      );
    });
    return result;
  }, [orders, debouncedSearch, filterSource, filterOwner, filterPayment, filterProduct, filterCustom]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const o of baseList) {
      const s = normalizeOrderStatus(o.status);
      c[s] = (c[s] || 0) + 1;
    }
    return c;
  }, [baseList]);

  const statusOrderIndex = useMemo(() => {
    const m: Record<string, number> = {};
    statuses.forEach((s, i) => { m[s.id] = s.order ?? i; });
    return m;
  }, [statuses]);

  const filteredOrders = useMemo(() => {
    const result = statusFilter === 'all'
      ? [...baseList]
      : baseList.filter((o) => normalizeOrderStatus(o.status) === statusFilter);
    return result.sort((a, b) => {
      let cmp = 0;
      if (sortField === 'amount') cmp = getOrderTotal(a) - getOrderTotal(b);
      else if (sortField === 'status') {
        cmp = (statusOrderIndex[normalizeOrderStatus(a.status)] ?? 99) - (statusOrderIndex[normalizeOrderStatus(b.status)] ?? 99);
      } else {
        cmp = (a.createdAt ? new Date(a.createdAt).getTime() : 0) - (b.createdAt ? new Date(b.createdAt).getTime() : 0);
      }
      return sortDirection === 'desc' ? -cmp : cmp;
    });
  }, [baseList, statusFilter, sortField, sortDirection, statusOrderIndex]);

  // Client-side pagination over the filtered list (search still spans everything).
  const { visible: visibleOrders, hasMore: ordersHasMore, loadMore: ordersLoadMore, loadAll: ordersLoadAll, count: ordersCount } = useWindowedList(filteredOrders, {
    pageSize: 30,
    resetKey: `${statusFilter}|${debouncedSearch}|${sortField}|${sortDirection}|${filterSource}|${filterOwner}|${filterPayment}|${filterProduct}|${JSON.stringify(filterCustom)}`,
  });

  const handleSort = useCallback((field: string) => {
    if (field === sortField) setSortDirection((d) => (d === 'desc' ? 'asc' : 'desc'));
    else { setSortField(field as 'date' | 'amount' | 'status'); setSortDirection('desc'); }
  }, [sortField]);

  // Open = still being worked on (not delivered / cancelled / refunded).
  const summary = useMemo(() => {
    let openTotal = 0;
    let openCount = 0;
    let doneTotal = 0;
    for (const o of baseList) {
      const s = normalizeOrderStatus(o.status);
      if (s === 'cancelled' || s === 'refunded') continue;
      if (s === 'delivered') doneTotal += getOrderTotal(o);
      else { openTotal += getOrderTotal(o); openCount++; }
    }
    return [
      { label: `${t('docs.openOrders', 'הזמנות פתוחות')} (${openCount})`, value: formatCurrency(openTotal), color: theme.colors.primary },
      { label: t('docs.deliveredTotal', 'נמסרו'), value: formatCurrency(doneTotal), color: STATUS_COLORS.delivered },
    ];
  }, [baseList, t, theme.colors.primary]);

  const getStatusLabel = useCallback((statusId: string) => {
    const configured = statuses.find((s) => s.id === statusId);
    return t(`orders.status_${statusId}`, { defaultValue: configured?.label || statusId });
  }, [statuses, t]);

  // Filter chips derived from the org-configured statuses (unified with web settings).
  const statusFilterOptions = useMemo(
    () => ['all', ...[...statuses].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((s) => s.id)],
    [statuses],
  );

  const handleStatusChange = useCallback(async (order: Order, newStatus: string) => {
    if (!user?.organization || order.status === newStatus) return;
    const prevStatus = order.status;
    setOrders((prev) => {
      const updated = prev.map((o) => (o.id === order.id ? { ...o, status: newStatus } : o));
      appCache.set(CACHE_KEY, updated);
      cacheDiskList('orders', user.organization, [{ ...order, status: newStatus }], (o) => o.id);
      return updated;
    });
    try {
      await ordersApi.updateStatus(
        user.organization,
        order.id,
        newStatus,
        user.uID || user.userId,
        user.fullname,
      );
    } catch (err: any) {
      setOrders((prev) => {
        const reverted = prev.map((o) => (o.id === order.id ? { ...o, status: prevStatus } : o));
        appCache.set(CACHE_KEY, reverted);
        return reverted;
      });
      Alert.alert(t('common.error', 'שגיאה'), err?.message || t('errors.generic'));
    }
  }, [user?.organization, CACHE_KEY, t]);

  const ordersKanbanColumns = useMemo<KanbanColumn<Order>[]>(() => {
    const sortedStatuses = [...statuses].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const knownIds = new Set(sortedStatuses.map((s) => s.id));
    const orphanOrders = filteredOrders.filter((o) => !knownIds.has(normalizeOrderStatus(o.status)));
    return sortedStatuses.map((status, index) => ({
      id: status.id,
      title: getStatusLabel(status.id),
      color: status.color || getStatusColor(status.id, statuses),
      icon: status.icon || getStatusIcon(status.id, statuses),
      items: [
        ...filteredOrders.filter((o) => normalizeOrderStatus(o.status) === status.id),
        ...(index === 0 ? orphanOrders : []),
      ],
    }));
  }, [statuses, filteredOrders, getStatusLabel]);

  const handleOrdersKanbanMove = useCallback((item: Order, _from: string, toColumnId: string) => {
    handleStatusChange(item, toColumnId);
  }, [handleStatusChange]);

  const createOrder = useCallback(
    () => router.push({ pathname: '/(tabs)/more/orders/[id]', params: { id: 'new' } }),
    [router],
  );

  const openOrder = useCallback((order: Order) => {
    router.push({ pathname: '/(tabs)/more/orders/[id]', params: { id: order.id } });
  }, [router]);

  const renderOrderCard = useCallback(
    ({ item }: { item: Order }) => {
      const normalizedStatus = normalizeOrderStatus(item.status);
      const total = getOrderTotal(item);
      const itemCount = item.items?.length ?? 0;
      return (
        <DocumentListItem
          title={item.customerName || (item.orderNumber ? `#${item.orderNumber}` : `#${item.id.slice(0, 8)}`)}
          subtitle={[
            item.customerName && item.orderNumber ? `#${item.orderNumber}` : '',
            itemCount > 0 ? `${itemCount} ${t('orders.items')}` : '',
          ].filter(Boolean).join(' · ')}
          amount={total > 0 ? formatCurrency(total, item.currency || '₪') : ''}
          statusLabel={getStatusLabel(normalizedStatus)}
          statusColor={getStatusColor(normalizedStatus, statuses)}
          date={item.createdAt ? formatDate(item.createdAt) : ''}
          onPress={() => openOrder(item)}
        />
      );
    },
    [statuses, getStatusLabel, openOrder, t],
  );

  const renderKanbanCard = useCallback((item: Order) => {
    const total = getOrderTotal(item);
    const itemCount = item.items?.length ?? 0;
    return (
      <Pressable
        onPress={() => openOrder(item)}
        style={({ pressed }) => ({
          backgroundColor: pressed ? theme.colors.surfaceVariant : theme.colors.surface,
          borderRadius: 10,
          padding: 12,
          borderStartWidth: 3,
          borderStartColor: getStatusColor(normalizeOrderStatus(item.status), statuses),
        })}
      >
        <Text variant="titleSmall" numberOfLines={1} style={{ color: theme.colors.onSurface, fontWeight: '700' }}>
          {item.orderNumber ? `#${item.orderNumber}` : `#${item.id.slice(0, 8)}`}
        </Text>
        {item.customerName ? (
          <View style={{ flexDirection, alignItems: 'center', gap: 4, marginTop: 4 }}>
            <MaterialCommunityIcons name="account-outline" size={13} color={theme.colors.onSurfaceVariant} />
            <Text variant="labelSmall" numberOfLines={1} style={{ color: theme.colors.onSurfaceVariant, flex: 1 }}>
              {item.customerName}
            </Text>
          </View>
        ) : null}
        <View style={{ flexDirection, alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
          {itemCount > 0 ? (
            <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
              {itemCount} {t('orders.items')}
            </Text>
          ) : <View />}
          {total > 0 ? (
            <Text variant="labelMedium" style={{ color: BRAND_COLOR, fontWeight: '700' }}>
              {item.currency || '₪'}{total.toFixed(2)}
            </Text>
          ) : null}
        </View>
      </Pressable>
    );
  }, [theme, flexDirection, statuses, openOrder, t]);

  const renderEmpty = useCallback(() => {
    if (loading) return null;
    const filtering = orders.length > 0;
    return (
      <EmptyState
        icon="cart-outline"
        title={filtering ? t('common.noResults') : t('orders.noOrders')}
        actionLabel={filtering ? undefined : t('orders.newOrder')}
        onAction={filtering ? undefined : createOrder}
      />
    );
  }, [loading, orders.length, t, createOrder]);

  if (loading && orders.length === 0) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator size="large" color={BRAND_COLOR} />
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
      <ScreenHeader
        title={t('orders.title')}
        onBack={() => router.back()}
        actions={
          <>
            <IconButton
              icon={viewMode === 'kanban' ? 'view-list' : 'view-column'}
              iconColor={theme.custom.headerText}
              size={22}
              onPress={() => setViewMode(viewMode === 'kanban' ? 'list' : 'kanban')}
            />
            <View>
              <IconButton
                icon="filter-variant"
                iconColor={theme.custom.headerText}
                size={22}
                onPress={() => setAdvancedVisible(true)}
              />
              {activeAdvancedCount > 0 ? <View style={[styles.activeDot, { backgroundColor: '#FFB300' }]} /> : null}
            </View>
          </>
        }
      />

      <ListToolbar
        query={searchQuery}
        onChangeQuery={setSearchQuery}
        placeholder={t('orders.searchPlaceholder')}
        sortOptions={viewMode === 'list' ? [
          { key: 'date', label: t('quotes.sortByDate') },
          { key: 'amount', label: t('quotes.sortByAmount') },
          { key: 'status', label: t('quotes.sortByStatus') },
        ] : undefined}
        sortKey={sortField}
        sortDir={sortDirection}
        onSort={handleSort}
      />

      {viewMode === 'list' ? (
        <>
          <SummaryHeader items={summary} />
          <StatusFilterBar
            allLabel={t('common.all')}
            allCount={baseList.length}
            options={statusFilterOptions.filter((f) => f !== 'all').map((s) => ({
              key: s,
              label: getStatusLabel(s),
              color: getStatusColor(s, statuses),
              count: counts[s] || 0,
            }))}
            value={statusFilter}
            onChange={setStatusFilter}
          />
        </>
      ) : null}

      {error ? (
        <Pressable onPress={fetchOrders} style={[styles.errorBanner, { backgroundColor: theme.colors.errorContainer }]}>
          <MaterialCommunityIcons name="alert-circle" size={18} color={theme.colors.error} />
          <Text variant="bodySmall" style={[styles.errorText, { color: theme.colors.error }]} numberOfLines={1}>{error}</Text>
          <Text variant="labelSmall" style={{ color: theme.colors.error, fontWeight: '600' }}>{t('common.retry')}</Text>
        </Pressable>
      ) : null}

      {viewMode === 'kanban' ? (
        <KanbanBoard
          columns={ordersKanbanColumns}
          keyExtractor={(item) => item.id}
          onMoveItem={handleOrdersKanbanMove}
          emptyLabel={t('orders.kanbanEmpty', 'גרור הזמנה לכאן')}
          renderCard={renderKanbanCard}
        />
      ) : (
        <FlatList
          data={visibleOrders}
          renderItem={renderOrderCard}
          keyExtractor={(item) => item.id}
          ListEmptyComponent={renderEmpty}
          ListFooterComponent={
            <ListPaginationFooter
              count={ordersCount}
              total={filteredOrders.length}
              hasMore={ordersHasMore}
              onLoadMore={ordersLoadMore}
              onLoadAll={ordersLoadAll}
            />
          }
          onEndReached={ordersHasMore ? ordersLoadMore : undefined}
          onEndReachedThreshold={0.4}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[BRAND_COLOR]} tintColor={BRAND_COLOR} />}
          contentContainerStyle={[styles.listContent, filteredOrders.length === 0 && styles.listContentEmpty]}
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          showsVerticalScrollIndicator={false}
        />
      )}

      <FAB
        icon="plus"
        label={t('orders.newOrder')}
        onPress={createOrder}
        style={[styles.fab, { backgroundColor: BRAND_COLOR, bottom: insets.bottom + 16, left: isRTL ? 16 : undefined, right: isRTL ? undefined : 16 }]}
        color="#FFF"
      />

      <Portal>
        <Modal
          visible={advancedVisible}
          onDismiss={() => setAdvancedVisible(false)}
          contentContainerStyle={[styles.advancedModal, { backgroundColor: theme.colors.surface }]}
        >
          <Text variant="titleLarge" style={{ color: theme.colors.onSurface, fontWeight: '700', marginBottom: 16, textAlign }}>
            {t('orders.advancedFilter', 'סינון מתקדם')}
          </Text>

          <ScrollView showsVerticalScrollIndicator={false} style={{ flexShrink: 1 }}>
            {orderOptions.sources.length > 0 && (
              <>
                <Text variant="labelMedium" style={[styles.advancedLabel, { color: theme.colors.onSurfaceVariant }]}>
                  {t('orders.columns.source', 'מקור')}
                </Text>
                <View style={styles.advancedChipRow}>
                  {orderOptions.sources.map((opt) => {
                    const sel = filterSource === opt;
                    return (
                      <Chip key={opt} selected={sel} compact onPress={() => setFilterSource(sel ? '' : opt)}
                        style={[styles.filterChip, { backgroundColor: sel ? theme.colors.primaryContainer : theme.colors.surfaceVariant }]}
                        textStyle={[styles.filterChipText, sel && { color: theme.colors.primary, fontWeight: '600' }]}>
                        {t('orders.source_' + opt, { defaultValue: opt })}
                      </Chip>
                    );
                  })}
                </View>
              </>
            )}

            {orderOptions.owners.length > 0 && (
              <>
                <Text variant="labelMedium" style={[styles.advancedLabel, { color: theme.colors.onSurfaceVariant }]}>
                  {t('orders.columns.assignee', 'בעלים')}
                </Text>
                <View style={styles.advancedChipRow}>
                  {orderOptions.owners.map((opt) => {
                    const sel = filterOwner === opt;
                    return (
                      <Chip key={opt} selected={sel} compact onPress={() => setFilterOwner(sel ? '' : opt)}
                        style={[styles.filterChip, { backgroundColor: sel ? theme.colors.primaryContainer : theme.colors.surfaceVariant }]}
                        textStyle={[styles.filterChipText, sel && { color: theme.colors.primary, fontWeight: '600' }]}>
                        {opt}
                      </Chip>
                    );
                  })}
                </View>
              </>
            )}

            {orderOptions.products.length > 0 && (
              <>
                <Text variant="labelMedium" style={[styles.advancedLabel, { color: theme.colors.onSurfaceVariant }]}>
                  {t('orders.columns.items', 'פריט / מוצר')}
                </Text>
                <View style={styles.advancedChipRow}>
                  {orderOptions.products.map((opt) => {
                    const sel = filterProduct === opt;
                    return (
                      <Chip key={opt} selected={sel} compact onPress={() => setFilterProduct(sel ? '' : opt)}
                        style={[styles.filterChip, { backgroundColor: sel ? theme.colors.primaryContainer : theme.colors.surfaceVariant }]}
                        textStyle={[styles.filterChipText, sel && { color: theme.colors.primary, fontWeight: '600' }]}>
                        {opt}
                      </Chip>
                    );
                  })}
                </View>
              </>
            )}

            <Text variant="labelMedium" style={[styles.advancedLabel, { color: theme.colors.onSurfaceVariant }]}>
              {t('orders.paymentStatus', 'סטטוס תשלום')}
            </Text>
            <View style={styles.advancedChipRow}>
              {[
                { id: 'paid', label: t('orders.paid', 'שולם') },
                { id: 'partial', label: t('orders.partial', 'חלקי') },
                { id: 'unpaid', label: t('orders.unpaid', 'לא שולם') },
              ].map((opt) => {
                const sel = filterPayment === opt.id;
                return (
                  <Chip key={opt.id} selected={sel} compact onPress={() => setFilterPayment(sel ? '' : opt.id)}
                    style={[styles.filterChip, { backgroundColor: sel ? theme.colors.primaryContainer : theme.colors.surfaceVariant }]}
                    textStyle={[styles.filterChipText, sel && { color: theme.colors.primary, fontWeight: '600' }]}>
                    {opt.label}
                  </Chip>
                );
              })}
            </View>

            {customFieldDefs.map((def) => (
              <React.Fragment key={def.key}>
                <Text variant="labelMedium" style={[styles.advancedLabel, { color: theme.colors.onSurfaceVariant }]}>
                  {def.label}
                </Text>
                <TextInput
                  mode="outlined"
                  dense
                  value={filterCustom[def.key] || ''}
                  onChangeText={(v) => setFilterCustom((prev) => ({ ...prev, [def.key]: v }))}
                  placeholder={t('orders.filterByValue', 'סנן לפי ערך')}
                  style={{ marginBottom: 8, textAlign }}
                  activeOutlineColor={BRAND_COLOR}
                />
              </React.Fragment>
            ))}
          </ScrollView>

          <View style={{ flexDirection: 'row', gap: 12, justifyContent: 'flex-end', marginTop: 16 }}>
            <Button mode="outlined" onPress={clearAdvancedFilters} textColor={theme.colors.onSurface}>
              {t('common.clear', 'נקה')}
            </Button>
            <Button mode="contained" onPress={() => setAdvancedVisible(false)} buttonColor={BRAND_COLOR} textColor="#FFF">
              {t('common.apply', 'החל')} {activeAdvancedCount > 0 ? `(${activeAdvancedCount})` : ''}
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
  searchbar: { height: 40, borderRadius: 20, elevation: 0 },
  filtersRow: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  filtersScroll: { paddingHorizontal: 14, gap: 8, alignItems: 'center' },
  filterChip: { height: 32 },
  filterChipText: { fontSize: 13 },
  listContent: { padding: 14, paddingBottom: 32 },
  listContentEmpty: { flexGrow: 1 },
  card: {
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    overflow: 'hidden',
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
  },
  cardLeft: {
    padding: 14,
    borderStartWidth: 4,
    gap: 6,
  },
  cardHeader: {
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  orderNumber: { fontWeight: '700', fontSize: 15, flex: 1 },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  statusText: { fontSize: 11, fontWeight: '600' },
  metaRow: { alignItems: 'center', gap: 5 },
  metaText: { fontSize: 13 },
  cardFooter: {
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  total: { fontWeight: '700', fontSize: 15 },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    paddingHorizontal: 40,
    gap: 12,
  },
  emptyTitle: { fontWeight: '600', marginTop: 8 },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
  },
  errorText: { flex: 1, fontSize: 13 },
  fab: { position: 'absolute', borderRadius: 16 },
  activeDot: { position: 'absolute', top: 8, right: 8, width: 8, height: 8, borderRadius: 4 },
  advancedModal: {
    marginHorizontal: 20,
    borderRadius: 18,
    padding: 20,
    maxHeight: '80%',
  },
  advancedLabel: { marginBottom: 6, marginTop: 12 },
  advancedChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
