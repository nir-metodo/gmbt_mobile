import React, { useState, useCallback, useEffect, useRef } from 'react';
import { View, StyleSheet, FlatList, Pressable, RefreshControl } from 'react-native';
import { Text, ActivityIndicator, FAB, IconButton, Menu } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../../../stores/authStore';
import { useAppTheme } from '../../../../hooks/useAppTheme';
import { useRTL } from '../../../../hooks/useRTL';
import { useDebouncedValue } from '../../../../hooks/useWindowedList';
import {
  invoicesApi,
  Invoice,
  OpenInvoicesSummary,
  DOCUMENT_TYPES,
  INVOICE_STATUSES,
} from '../../../../services/api/invoices';
import { cacheEntities } from '../../../../services/entityCache';
import { formatDate, formatCurrency } from '../../../../utils/formatters';
import { currencySymbol } from '../../../../utils/currency';
import { ScreenHeader } from '../../../../components/ScreenHeader';
import { ListToolbar } from '../../../../components/ListToolbar';
import { StatusFilterBar } from '../../../../components/StatusFilterBar';
import { SummaryHeader } from '../../../../components/SummaryHeader';
import { DocumentListItem } from '../../../../components/DocumentListItem';
import { EmptyState } from '../../../../components/EmptyState';

const BRAND_COLOR = '#2e6155';

export default function InvoicesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useAppTheme();
  const { isRTL } = useRTL();
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [summary, setSummary] = useState<OpenInvoicesSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [typeMenuVisible, setTypeMenuVisible] = useState(false);
  const [page, setPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadedOnceRef = useRef(false);

  // Search runs as you type (debounced) — no hidden magnifier, no "submit" step.
  const debouncedSearch = useDebouncedValue(searchQuery, 350);

  const fetchInvoices = useCallback(async (p = 1, append = false) => {
    if (!user?.organization) { setLoading(false); return; }
    // Full-screen spinner only on the very first load; later refreshes/filters keep the rows on screen.
    if (p === 1 && !append) { if (!loadedOnceRef.current) setLoading(true); } else setLoadingMore(true);
    try {
      setError(null);
      const result = await invoicesApi.getPaginated(user.organization, {
        page: p,
        pageSize: 25,
        searchTerm: debouncedSearch || undefined,
        statusFilter,
        typeFilter,
      });
      cacheEntities('invoices', result.invoices);
      setInvoices((prev) => (append ? [...prev, ...result.invoices] : result.invoices));
      setTotalCount(result.totalCount);
      setPage(p);
    } catch (err: any) {
      setError(err.message || t('errors.generic'));
    } finally {
      loadedOnceRef.current = true;
      setLoading(false);
      setLoadingMore(false);
    }
  }, [user?.organization, debouncedSearch, statusFilter, typeFilter, t]);

  const fetchSummary = useCallback(async () => {
    if (!user?.organization) return;
    try {
      setSummary(await invoicesApi.getOpenSummary(user.organization));
    } catch {
      setSummary(null); // header is optional — never block the list
    }
  }, [user?.organization]);

  useEffect(() => { fetchInvoices(1); }, [fetchInvoices]);
  useEffect(() => { fetchSummary(); }, [fetchSummary]);

  const didMountRef = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!didMountRef.current) { didMountRef.current = true; return; }
      fetchInvoices(1);
      fetchSummary();
    }, [fetchInvoices, fetchSummary]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([fetchInvoices(1), fetchSummary()]);
    setRefreshing(false);
  }, [fetchInvoices, fetchSummary]);

  const onEndReached = useCallback(() => {
    if (!loadingMore && invoices.length < totalCount) fetchInvoices(page + 1, true);
  }, [loadingMore, invoices.length, totalCount, page, fetchInvoices]);

  const createInvoice = useCallback(
    () => router.push({ pathname: '/(tabs)/more/invoices/[id]', params: { id: 'new' } }),
    [router],
  );

  const getDocLabel = (type: string) => DOCUMENT_TYPES.find((d) => d.key === type)?.labelHe || type;
  const getStatusLabel = (status: string) => INVOICE_STATUSES.find((s) => s.key === status)?.labelHe || status;
  const getStatusColor = (status: string) => INVOICE_STATUSES.find((s) => s.key === status)?.color || '#9E9E9E';

  const renderCard = useCallback(({ item }: { item: Invoice }) => {
    const overdue = item.status === 'overdue';
    return (
      <DocumentListItem
        title={`${getDocLabel(item.type)}${item.documentNumber ? ` #${item.documentNumber}` : ''}`}
        subtitle={item.contactName}
        amount={item.total != null ? formatCurrency(Number(item.total), currencySymbol(item.currency)) : undefined}
        statusLabel={getStatusLabel(item.status)}
        statusColor={getStatusColor(item.status)}
        date={overdue && item.dueDate ? `${t('invoices.dueDate', 'פירעון')} ${formatDate(item.dueDate)}` : item.date ? formatDate(item.date) : undefined}
        dateWarning={overdue}
        viewCount={item.viewCount}
        onPress={() => router.push({ pathname: '/(tabs)/more/invoices/[id]', params: { id: item.id } })}
      />
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, t]);

  const filtering = statusFilter !== 'all' || typeFilter !== 'all' || !!debouncedSearch;

  const summaryItems = summary
    ? [
        { label: t('invoices.unpaid', 'לתשלום'), value: formatCurrency(summary.total), color: BRAND_COLOR },
        {
          label: t('invoices.overdueTotal', 'באיחור'),
          value: formatCurrency(summary.overdueTotal),
          color: summary.overdueCount > 0 ? '#dc2626' : theme.colors.onSurfaceVariant,
        },
      ]
    : [];

  const renderEmpty = () => {
    if (loading) return null;
    return (
      <EmptyState
        icon="file-document-outline"
        title={filtering ? t('common.noResults') : t('invoices.noInvoices', 'אין חשבוניות')}
        description={filtering ? undefined : t('invoices.noInvoicesDesc', 'הפק את החשבונית הראשונה שלך')}
        actionLabel={filtering ? undefined : t('invoices.newInvoice', 'חשבונית חדשה')}
        onAction={filtering ? undefined : createInvoice}
      />
    );
  };

  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
      <ScreenHeader title={t('invoices.title', 'חשבוניות')} onBack={() => router.back()} />

      <ListToolbar
        query={searchQuery}
        onChangeQuery={setSearchQuery}
        placeholder={t('invoices.searchPlaceholder', 'חפש חשבוניות...')}
        trailing={
          <Menu
            visible={typeMenuVisible}
            onDismiss={() => setTypeMenuVisible(false)}
            anchor={
              <View>
                <IconButton
                  icon="file-document-multiple-outline"
                  size={22}
                  iconColor={typeFilter !== 'all' ? BRAND_COLOR : theme.colors.onSurfaceVariant}
                  onPress={() => setTypeMenuVisible(true)}
                />
                {typeFilter !== 'all' ? <View style={[styles.activeDot, { backgroundColor: BRAND_COLOR }]} /> : null}
              </View>
            }
            contentStyle={{ backgroundColor: theme.colors.surface }}
          >
            <Menu.Item
              title={t('invoices.allTypes', 'כל סוגי המסמכים')}
              leadingIcon={typeFilter === 'all' ? 'check' : undefined}
              onPress={() => { setTypeFilter('all'); setTypeMenuVisible(false); }}
            />
            {DOCUMENT_TYPES.map((d) => (
              <Menu.Item
                key={d.key}
                title={d.labelHe}
                leadingIcon={typeFilter === d.key ? 'check' : undefined}
                onPress={() => { setTypeFilter(d.key); setTypeMenuVisible(false); }}
              />
            ))}
          </Menu>
        }
      />

      <SummaryHeader items={summaryItems} />

      <StatusFilterBar
        allLabel={t('common.all')}
        options={INVOICE_STATUSES.map((s) => ({ key: s.key, label: s.labelHe, color: s.color }))}
        value={statusFilter}
        onChange={setStatusFilter}
      />

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
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={renderEmpty}
          onEndReached={onEndReached}
          onEndReachedThreshold={0.3}
          ListFooterComponent={loadingMore ? <ActivityIndicator size="small" color={BRAND_COLOR} style={{ marginVertical: 16 }} /> : null}
        />
      )}

      <FAB
        icon="plus"
        label={t('invoices.newTaxInvoice', 'חשבונית מס חדשה')}
        onPress={createInvoice}
        style={[styles.fab, { backgroundColor: BRAND_COLOR, bottom: insets.bottom + 16, left: isRTL ? 16 : undefined, right: isRTL ? undefined : 16 }]}
        color="#FFF"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { padding: 14, paddingBottom: 100 },
  listContentEmpty: { flexGrow: 1 },
  errorBanner: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  activeDot: { position: 'absolute', top: 8, right: 8, width: 8, height: 8, borderRadius: 4 },
  fab: { position: 'absolute', borderRadius: 16 },
});
