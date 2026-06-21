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
  Searchbar,
  Chip,
  ActivityIndicator,
  Appbar,
  FAB,
  Portal,
  Modal,
  Button,
  TextInput,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
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
import { formatDate } from '../../../../utils/formatters';
import { borderRadius } from '../../../../constants/theme';
import { appCache } from '../../../../services/cache';
import { cacheEntities } from '../../../../services/entityCache';
import { readList as readDiskList, cacheList as cacheDiskList } from '../../../../services/db/genericCache';

const BRAND_COLOR = '#2e6155';

const STATUS_FILTERS = ['all', 'pending', 'confirmed', 'collected', 'shipped', 'delivered', 'cancelled'] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

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
  const [searchVisible, setSearchVisible] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [viewMode, setViewMode] = useState<'list' | 'kanban'>('list');
  const [statuses, setStatuses] = useState<OrderStatusConfig[]>(DEFAULT_ORDER_STATUSES);

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
      const { statuses: loaded } = await ordersApi.getSettings(user.organization);
      if (loaded.length > 0) setStatuses(loaded);
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

  const filteredOrders = useMemo(() => {
    let result = Array.isArray(orders) ? orders : [];
    if (statusFilter !== 'all') {
      result = result.filter((o) => {
        const normalized = normalizeOrderStatus(o.status);
        if (statusFilter === 'collected') {
          return normalized === 'collected';
        }
        return normalized === statusFilter;
      });
    }
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
    return result.sort((a, b) => {
      const aDate = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bDate = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bDate - aDate;
    });
  }, [orders, statusFilter, debouncedSearch, filterSource, filterOwner, filterPayment, filterProduct, filterCustom]);

  // Client-side pagination over the filtered list (search still spans everything).
  const { visible: visibleOrders, hasMore: ordersHasMore, loadMore: ordersLoadMore, loadAll: ordersLoadAll, count: ordersCount } = useWindowedList(filteredOrders, {
    pageSize: 30,
    resetKey: `${statusFilter}|${debouncedSearch}|${filterSource}|${filterOwner}|${filterPayment}|${filterProduct}|${JSON.stringify(filterCustom)}`,
  });

  const getStatusLabel = useCallback((statusId: string) => {
    const configured = statuses.find((s) => s.id === statusId);
    return t(`orders.status_${statusId}`, { defaultValue: configured?.label || statusId });
  }, [statuses, t]);

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

  const openOrder = useCallback((order: Order) => {
    router.push({ pathname: '/(tabs)/more/orders/[id]', params: { id: order.id } });
  }, [router]);

  const renderOrderCard = useCallback(
    ({ item }: { item: Order }) => {
      const normalizedStatus = normalizeOrderStatus(item.status);
      const statusColor = getStatusColor(normalizedStatus, statuses);
      const statusIcon = getStatusIcon(normalizedStatus, statuses);

      return (
        <Pressable
          onPress={() => router.push({ pathname: '/(tabs)/more/orders/[id]', params: { id: item.id } })}
          android_ripple={{ color: theme.colors.surfaceVariant }}
          style={({ pressed }) => [
            styles.card,
            {
              backgroundColor: pressed ? theme.colors.surfaceVariant : theme.custom?.cardBackground || theme.colors.surface,
              borderColor: theme.colors.outlineVariant,
            },
          ]}
        >
          <View style={[styles.cardLeft, { borderStartColor: statusColor }]}>
            <View style={[styles.cardHeader, { flexDirection }]}>
              <Text variant="titleSmall" style={[styles.orderNumber, { color: theme.colors.onSurface, textAlign }]} numberOfLines={1}>
                {item.orderNumber ? `#${item.orderNumber}` : `#${item.id.slice(0, 8)}`}
              </Text>
              <View style={[styles.statusBadge, { backgroundColor: `${statusColor}18` }]}>
                <MaterialCommunityIcons name={statusIcon as any} size={13} color={statusColor} />
                <Text variant="labelSmall" style={[styles.statusText, { color: statusColor }]}>
                  {getStatusLabel(normalizedStatus)}
                </Text>
              </View>
            </View>

            {item.customerName ? (
              <View style={[styles.metaRow, { flexDirection }]}>
                <MaterialCommunityIcons name="account-outline" size={14} color={theme.colors.onSurfaceVariant} />
                <Text variant="bodySmall" style={[styles.metaText, { color: theme.colors.onSurfaceVariant }]} numberOfLines={1}>
                  {item.customerName}
                </Text>
              </View>
            ) : null}

            <View style={[styles.cardFooter, { flexDirection }]}>
              {item.createdAt ? (
                <View style={[styles.metaRow, { flexDirection }]}>
                  <MaterialCommunityIcons name="calendar-outline" size={13} color={theme.colors.onSurfaceVariant} />
                  <Text variant="labelSmall" style={[styles.metaText, { color: theme.colors.onSurfaceVariant }]}>
                    {formatDate(item.createdAt)}
                  </Text>
                </View>
              ) : null}

              {getOrderTotal(item) > 0 ? (
                <Text variant="titleSmall" style={[styles.total, { color: BRAND_COLOR }]}>
                  {item.currency || '₪'}{getOrderTotal(item).toFixed(2)}
                </Text>
              ) : null}
            </View>
          </View>
        </Pressable>
      );
    },
    [theme, router, flexDirection, textAlign, statuses, getStatusLabel],
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
    return (
      <View style={styles.emptyContainer}>
        <MaterialCommunityIcons name="cart-outline" size={72} color={theme.colors.onSurfaceVariant} style={{ opacity: 0.3 }} />
        <Text variant="titleMedium" style={[styles.emptyTitle, { color: theme.colors.onSurface }]}>
          {t('orders.noOrders')}
        </Text>
      </View>
    );
  }, [loading, theme, t]);

  if (loading && orders.length === 0) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator size="large" color={BRAND_COLOR} />
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
      <Appbar.Header style={{ backgroundColor: BRAND_COLOR }} mode="center-aligned">
        <Appbar.BackAction onPress={() => router.back()} color="#FFF" />
        <Appbar.Content title={t('orders.title')} titleStyle={{ color: '#FFF', fontWeight: '700', fontSize: 18 }} />
        <Appbar.Action
          icon={viewMode === 'kanban' ? 'view-list' : 'view-column'}
          color="#FFF"
          onPress={() => setViewMode((m) => (m === 'kanban' ? 'list' : 'kanban'))}
        />
        <Appbar.Action
          icon={activeAdvancedCount > 0 ? 'filter-variant-plus' : 'filter-variant'}
          color="#FFF"
          onPress={() => setAdvancedVisible(true)}
        />
        <Appbar.Action
          icon={searchVisible ? 'close' : 'magnify'}
          color="#FFF"
          onPress={() => { setSearchVisible(!searchVisible); if (searchVisible) setSearchQuery(''); }}
        />
        <Appbar.Action
          icon="plus"
          color="#FFF"
          onPress={() => router.push({ pathname: '/(tabs)/more/orders/[id]', params: { id: 'new' } })}
        />
      </Appbar.Header>

      {searchVisible && (
        <View style={{ paddingHorizontal: 14, paddingVertical: 8, backgroundColor: theme.colors.surface }}>
          <Searchbar
            placeholder={t('orders.searchPlaceholder')}
            value={searchQuery}
            onChangeText={setSearchQuery}
            style={[styles.searchbar, { backgroundColor: theme.colors.surfaceVariant }]}
            inputStyle={{ fontSize: 14, textAlign: isRTL ? 'right' : 'left' }}
            iconColor={theme.colors.onSurfaceVariant}
            autoFocus
          />
        </View>
      )}

      <View style={[styles.filtersRow, { backgroundColor: theme.colors.surface, borderBottomColor: theme.colors.outline }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.filtersScroll, { flexDirection }]}>
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
              textStyle={[styles.filterChipText, statusFilter === f && { color: theme.colors.primary, fontWeight: '600' }]}
            >
              {f === 'all' ? t('common.all') : t(`orders.status_${f}`, { defaultValue: f })}
            </Chip>
          ))}
        </ScrollView>
      </View>

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
        onPress={() => router.push({ pathname: '/(tabs)/more/orders/[id]', params: { id: 'new' } })}
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
  advancedModal: {
    marginHorizontal: 20,
    borderRadius: 18,
    padding: 20,
    maxHeight: '80%',
  },
  advancedLabel: { marginBottom: 6, marginTop: 12 },
  advancedChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
