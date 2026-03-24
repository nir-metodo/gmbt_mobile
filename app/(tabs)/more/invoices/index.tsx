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
import { invoicesApi, Invoice, DOCUMENT_TYPES, INVOICE_STATUSES } from '../../../../services/api/invoices';
import { formatDate } from '../../../../utils/formatters';
import { borderRadius } from '../../../../constants/theme';

const BRAND_COLOR = '#2e6155';

type TypeFilter = 'all' | 'tax_invoice' | 'combined' | 'receipt' | 'transaction' | 'credit_invoice' | 'credit_receipt';
type StatusFilterType = 'all' | 'draft' | 'issued' | 'sent' | 'paid' | 'overdue' | 'cancelled';

export default function InvoicesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useAppTheme();
  const { isRTL, flexDirection, textAlign } = useRTL();
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchVisible, setSearchVisible] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilterType>('all');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [page, setPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);

  const fetchInvoices = useCallback(async (p = 1, append = false) => {
    if (!user?.organization) { setLoading(false); return; }
    if (p === 1) setLoading(true); else setLoadingMore(true);
    try {
      setError(null);
      const result = await invoicesApi.getPaginated(user.organization, {
        page: p,
        pageSize: 25,
        searchTerm: searchQuery || undefined,
        statusFilter,
        typeFilter,
      });
      setInvoices((prev) => append ? [...prev, ...result.invoices] : result.invoices);
      setTotalCount(result.totalCount);
      setPage(p);
    } catch (err: any) {
      setError(err.message || t('errors.generic'));
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [user?.organization, searchQuery, statusFilter, typeFilter, t]);

  useEffect(() => {
    fetchInvoices(1);
  }, [fetchInvoices]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchInvoices(1);
    setRefreshing(false);
  }, [fetchInvoices]);

  const onEndReached = useCallback(() => {
    if (!loadingMore && invoices.length < totalCount) {
      fetchInvoices(page + 1, true);
    }
  }, [loadingMore, invoices.length, totalCount, page, fetchInvoices]);

  const getDocLabel = (type: string) => DOCUMENT_TYPES.find((d) => d.key === type)?.labelHe || type;
  const getDocColor = (type: string) => DOCUMENT_TYPES.find((d) => d.key === type)?.color || BRAND_COLOR;
  const getStatusLabel = (status: string) => INVOICE_STATUSES.find((s) => s.key === status)?.labelHe || status;
  const getStatusColor = (status: string) => INVOICE_STATUSES.find((s) => s.key === status)?.color || '#9E9E9E';

  const renderCard = useCallback(({ item }: { item: Invoice }) => {
    const docColor = getDocColor(item.type);
    const statusColor = getStatusColor(item.status);

    return (
      <Pressable
        onPress={() => router.push({ pathname: '/(tabs)/more/invoices/[id]', params: { id: item.id } })}
        android_ripple={{ color: theme.colors.surfaceVariant }}
        style={({ pressed }) => [
          styles.card,
          {
            backgroundColor: pressed ? theme.colors.surfaceVariant : theme.colors.surface,
            borderColor: theme.colors.outlineVariant,
          },
        ]}
      >
        <View style={[styles.cardBar, { backgroundColor: docColor }]} />
        <View style={styles.cardBody}>
          <View style={[styles.cardHeader, { flexDirection }]}>
            <View style={{ flex: 1 }}>
              <Text variant="titleSmall" style={{ color: theme.colors.onSurface, fontWeight: '700', textAlign }}>
                {getDocLabel(item.type)}{item.documentNumber ? ` #${item.documentNumber}` : ''}
              </Text>
              {item.contactName ? (
                <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, textAlign }}>
                  {item.contactName}
                </Text>
              ) : null}
            </View>
            <View style={[styles.statusBadge, { backgroundColor: `${statusColor}18` }]}>
              <Text variant="labelSmall" style={{ color: statusColor, fontWeight: '700' }}>
                {getStatusLabel(item.status)}
              </Text>
            </View>
          </View>

          <View style={[styles.cardFooter, { flexDirection }]}>
            {item.date ? (
              <View style={[styles.metaRow, { flexDirection }]}>
                <MaterialCommunityIcons name="calendar-outline" size={12} color={theme.colors.onSurfaceVariant} />
                <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                  {formatDate(item.date)}
                </Text>
              </View>
            ) : null}
            {item.total != null ? (
              <Text variant="titleSmall" style={{ color: BRAND_COLOR, fontWeight: '700' }}>
                {item.currency === 'USD' ? '$' : item.currency === 'EUR' ? '€' : '₪'}
                {Number(item.total).toFixed(2)}
              </Text>
            ) : null}
          </View>
        </View>
      </Pressable>
    );
  }, [router, theme, flexDirection, textAlign]);

  const renderEmpty = () => {
    if (loading) return null;
    return (
      <View style={styles.emptyContainer}>
        <MaterialCommunityIcons name="file-invoice-dollar" size={72} color={theme.colors.onSurfaceVariant} style={{ opacity: 0.3 }} />
        <Text variant="titleMedium" style={{ color: theme.colors.onSurface, fontWeight: '600', marginTop: 12 }}>
          אין חשבוניות
        </Text>
        <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center', marginTop: 6 }}>
          צור חשבונית חדשה בלחיצה על +
        </Text>
      </View>
    );
  };

  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
      <Appbar.Header style={{ backgroundColor: BRAND_COLOR }} mode="center-aligned">
        {searchVisible ? (
          <Searchbar
            value={searchQuery}
            onChangeText={(q) => { setSearchQuery(q); }}
            onSubmitEditing={() => fetchInvoices(1)}
            placeholder="חפש חשבוניות..."
            style={[styles.searchbar, { flex: 1, marginHorizontal: 8 }]}
            onIconPress={() => { setSearchVisible(false); setSearchQuery(''); }}
            autoFocus
          />
        ) : (
          <>
            <Appbar.Content title="חשבוניות" titleStyle={{ color: '#FFF', fontWeight: '700', fontSize: 18 }} />
            <Appbar.Action icon="magnify" color="#FFF" onPress={() => setSearchVisible(true)} />
            <Appbar.Action
              icon="plus"
              color="#FFF"
              onPress={() => router.push({ pathname: '/(tabs)/more/invoices/[id]', params: { id: 'new' } })}
            />
          </>
        )}
      </Appbar.Header>

      {/* Type filter chips */}
      <View style={[styles.filtersRow, { backgroundColor: theme.colors.surface, borderBottomColor: theme.colors.outline }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filtersScroll}>
          {(['all', ...DOCUMENT_TYPES.map((d) => d.key)] as TypeFilter[]).map((type) => {
            const isActive = typeFilter === type;
            const color = type === 'all' ? BRAND_COLOR : getDocColor(type);
            const label = type === 'all' ? 'הכל' : getDocLabel(type);
            return (
              <Chip
                key={type}
                selected={isActive}
                onPress={() => setTypeFilter(type)}
                compact
                style={[
                  styles.filterChip,
                  isActive ? { backgroundColor: `${color}20`, borderColor: color, borderWidth: 1 } : { backgroundColor: theme.colors.surfaceVariant },
                ]}
                textStyle={[{ fontSize: 12 }, isActive && { color, fontWeight: '600' }]}
              >
                {label}
              </Chip>
            );
          })}
        </ScrollView>
      </View>

      {/* Status filter chips */}
      <View style={[{ backgroundColor: theme.colors.surface, borderBottomColor: theme.colors.outline, borderBottomWidth: StyleSheet.hairlineWidth }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filtersScroll}>
          {(['all', ...INVOICE_STATUSES.map((s) => s.key)] as StatusFilterType[]).map((status) => {
            const isActive = statusFilter === status;
            const statusMeta = INVOICE_STATUSES.find((s) => s.key === status);
            const color = statusMeta?.color || BRAND_COLOR;
            const label = status === 'all' ? 'כל הסטטוסים' : (statusMeta?.labelHe || status);
            return (
              <Chip
                key={status}
                selected={isActive}
                onPress={() => setStatusFilter(status)}
                compact
                style={[
                  styles.filterChip,
                  isActive ? { backgroundColor: `${color}20`, borderColor: color, borderWidth: 1 } : { backgroundColor: theme.colors.surfaceVariant },
                ]}
                textStyle={[{ fontSize: 11 }, isActive && { color, fontWeight: '600' }]}
              >
                {label}
              </Chip>
            );
          })}
        </ScrollView>
      </View>

      {error ? (
        <Pressable onPress={() => fetchInvoices(1)} style={[styles.errorBanner, { backgroundColor: theme.colors.errorContainer }]}>
          <MaterialCommunityIcons name="alert-circle" size={18} color={theme.colors.error} />
          <Text variant="bodySmall" style={{ flex: 1, color: theme.colors.error }} numberOfLines={1}>{error}</Text>
          <Text variant="labelSmall" style={{ color: theme.colors.error, fontWeight: '600' }}>{t('common.retry')}</Text>
        </Pressable>
      ) : null}

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={BRAND_COLOR} />
        </View>
      ) : (
        <FlatList
          data={invoices}
          renderItem={renderCard}
          keyExtractor={(item, idx) => item.id || String(idx)}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[BRAND_COLOR]} tintColor={BRAND_COLOR} />}
          contentContainerStyle={[styles.listContent, invoices.length === 0 && styles.listContentEmpty]}
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={renderEmpty}
          onEndReached={onEndReached}
          onEndReachedThreshold={0.3}
          ListFooterComponent={loadingMore ? <ActivityIndicator size="small" color={BRAND_COLOR} style={{ marginVertical: 16 }} /> : null}
        />
      )}

      <FAB
        icon="plus"
        label="חשבונית חדשה"
        onPress={() => router.push({ pathname: '/(tabs)/more/invoices/[id]', params: { id: 'new' } })}
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
  filtersRow: { borderBottomWidth: StyleSheet.hairlineWidth },
  filtersScroll: { paddingHorizontal: 14, gap: 8, alignItems: 'center', paddingVertical: 10 },
  filterChip: { height: 32 },
  listContent: { padding: 14, paddingBottom: 100 },
  listContentEmpty: { flexGrow: 1 },
  card: {
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
  cardBar: { width: 5 },
  cardBody: { flex: 1, padding: 14, gap: 6 },
  cardHeader: { alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    alignSelf: 'flex-start',
  },
  cardFooter: { alignItems: 'center', justifyContent: 'space-between', marginTop: 2 },
  metaRow: { alignItems: 'center', gap: 4 },
  errorBanner: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  emptyContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80, paddingHorizontal: 40 },
  fab: { position: 'absolute', borderRadius: 16 },
});
