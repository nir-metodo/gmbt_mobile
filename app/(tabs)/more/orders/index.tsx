import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
} from 'react-native';
import {
  Text,
  Searchbar,
  Chip,
  ActivityIndicator,
  Appbar,
  FAB,
  Divider,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../../../stores/authStore';
import { useAppTheme } from '../../../../hooks/useAppTheme';
import { useRTL } from '../../../../hooks/useRTL';
import { ordersApi, Order } from '../../../../services/api/orders';
import { formatDate } from '../../../../utils/formatters';
import { borderRadius } from '../../../../constants/theme';
import { appCache } from '../../../../services/cache';

const BRAND_COLOR = '#2e6155';

const STATUS_FILTERS = ['all', 'pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

const STATUS_COLORS: Record<string, string> = {
  pending: '#FF9800',
  confirmed: '#2196F3',
  processing: '#9C27B0',
  shipped: '#00BCD4',
  delivered: '#4CAF50',
  cancelled: '#9E9E9E',
  refunded: '#F44336',
};

const STATUS_ICONS: Record<string, string> = {
  pending: 'clock-outline',
  confirmed: 'check-circle-outline',
  processing: 'cog-outline',
  shipped: 'truck-outline',
  delivered: 'package-variant-closed-check',
  cancelled: 'close-circle-outline',
  refunded: 'cash-refund',
};

export default function OrdersScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useAppTheme();
  const { isRTL, flexDirection, textAlign } = useRTL();
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);

  const CACHE_KEY = `orders_${user?.organization}`;

  const [orders, setOrders] = useState<Order[]>(() => appCache.get<Order[]>(CACHE_KEY) ?? []);
  const [loading, setLoading] = useState(!appCache.get<Order[]>(CACHE_KEY));
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchVisible, setSearchVisible] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');


  const fetchOrders = useCallback(async () => {
    if (!user?.organization) { setLoading(false); return; }
    try {
      setError(null);
      const data = await ordersApi.getAll(user.organization);
      appCache.set(CACHE_KEY, data);
      setOrders(data);
    } catch (err: any) {
      setError(err.message || t('errors.generic'));
    } finally {
      setLoading(false);
    }
  }, [user?.organization, t, CACHE_KEY]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchOrders();
    setRefreshing(false);
  }, [fetchOrders]);

  const filteredOrders = useMemo(() => {
    let result = Array.isArray(orders) ? orders : [];
    if (statusFilter !== 'all') {
      result = result.filter((o) => o.status === statusFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (o) =>
          o.orderNumber?.toLowerCase().includes(q) ||
          o.customerName?.toLowerCase().includes(q) ||
          o.customerPhone?.toLowerCase().includes(q) ||
          o.customerEmail?.toLowerCase().includes(q),
      );
    }
    return result.sort((a, b) => {
      const aDate = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bDate = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bDate - aDate;
    });
  }, [orders, statusFilter, searchQuery]);

  const renderOrderCard = useCallback(
    ({ item }: { item: Order }) => {
      const statusColor = STATUS_COLORS[item.status] || '#9E9E9E';
      const statusIcon = STATUS_ICONS[item.status] || 'help-circle-outline';

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
          <View style={[styles.cardLeft, { borderLeftColor: statusColor }]}>
            <View style={[styles.cardHeader, { flexDirection }]}>
              <Text variant="titleSmall" style={[styles.orderNumber, { color: theme.colors.onSurface, textAlign }]} numberOfLines={1}>
                {item.orderNumber ? `#${item.orderNumber}` : `#${item.id.slice(0, 8)}`}
              </Text>
              <View style={[styles.statusBadge, { backgroundColor: `${statusColor}18` }]}>
                <MaterialCommunityIcons name={statusIcon as any} size={13} color={statusColor} />
                <Text variant="labelSmall" style={[styles.statusText, { color: statusColor }]}>
                  {t(`orders.status_${item.status}`, { defaultValue: item.status })}
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

              {item.totalAmount != null ? (
                <Text variant="titleSmall" style={[styles.total, { color: BRAND_COLOR }]}>
                  {item.currency || '₪'}{Number(item.totalAmount).toFixed(2)}
                </Text>
              ) : null}
            </View>
          </View>
        </Pressable>
      );
    },
    [theme, router, flexDirection, textAlign, t],
  );

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
          icon={searchVisible ? 'close' : 'magnify'}
          color="#FFF"
          onPress={() => { setSearchVisible(!searchVisible); if (searchVisible) setSearchQuery(''); }}
        />
        <Appbar.Action icon="plus" color="#FFF" onPress={() => setCreateVisible(true)} />
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

      <FlatList
        data={filteredOrders}
        renderItem={renderOrderCard}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={renderEmpty}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[BRAND_COLOR]} tintColor={BRAND_COLOR} />}
        contentContainerStyle={[styles.listContent, filteredOrders.length === 0 && styles.listContentEmpty]}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        showsVerticalScrollIndicator={false}
      />

      <FAB
        icon="plus"
        label={t('orders.newOrder')}
        onPress={() => router.push({ pathname: '/(tabs)/more/orders/[id]', params: { id: 'new' } })}
        style={[styles.fab, { backgroundColor: BRAND_COLOR, bottom: insets.bottom + 16, left: isRTL ? 16 : undefined, right: isRTL ? undefined : 16 }]}
        color="#FFF"
      />

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
    borderLeftWidth: 4,
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
});
