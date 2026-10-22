import React, { useState, useCallback, useEffect, useRef } from 'react';
import { View, StyleSheet, FlatList, Pressable, RefreshControl, ScrollView } from 'react-native';
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
  InvoiceCreator,
  InvoiceSortKey,
} from '../../../../services/api/invoices';
import {
  InvoiceFiltersSheet,
  InvoiceFilters,
  EMPTY_INVOICE_FILTERS,
  countInvoiceFilters,
} from '../../../../components/invoices/InvoiceFiltersSheet';
import { getDataVisibility } from '../../../../constants/permissions';
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

  // Sorting is done by the server (the list is paged). `null` = the default order (newest created first;
  // the "open" status keeps its own most-urgent-first order).
  const [sortKey, setSortKey] = useState<InvoiceSortKey | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [filters, setFilters] = useState<InvoiceFilters>(EMPTY_INVOICE_FILTERS);
  const [filtersVisible, setFiltersVisible] = useState(false);
  const invoicesDV = getDataVisibility(user?.DataVisibility, user?.SecurityRole, 'invoices');
  const [creators, setCreators] = useState<InvoiceCreator[]>([]);
  const creatorsLoadedRef = useRef(false);

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
        fromDate: filters.fromDate || undefined,
        toDate: filters.toDate || undefined,
        minAmount: filters.minAmount !== '' ? Number(filters.minAmount) : undefined,
        maxAmount: filters.maxAmount !== '' ? Number(filters.maxAmount) : undefined,
        createdByFilter: filters.createdBy || undefined,
        sortBy: sortKey || undefined,
        sortDir: sortKey ? sortDir : undefined,
        includeCreators: !creatorsLoadedRef.current,
        dataVisibility: invoicesDV,
        userId: user.uID || user.userId,
      });
      if (result.creators.length > 0) { setCreators(result.creators); creatorsLoadedRef.current = true; }
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
  }, [user?.organization, user?.uID, user?.userId, invoicesDV, debouncedSearch, statusFilter, typeFilter, filters, sortKey, sortDir, t]);

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

  const advancedCount = countInvoiceFilters(filters);
  const filtering = statusFilter !== 'all' || typeFilter !== 'all' || !!debouncedSearch || advancedCount > 0;

  const SORT_LABELS: Record<InvoiceSortKey, string> = {
    created: t('invoices.sortCreated', 'תאריך יצירה'),
    date: t('invoices.sortDate', 'תאריך המסמך'),
    dueDate: t('invoices.sortDue', 'תאריך פירעון'),
    amount: t('invoices.sortAmount', 'סכום'),
    balance: t('invoices.sortBalance', 'יתרה לתשלום'),
    customer: t('invoices.sortCustomer', 'לקוח'),
    number: t('invoices.sortNumber', 'מספר מסמך'),
    createdBy: t('invoices.sortCreatedBy', 'נוצר על ידי'),
  };
  // Text columns read best A→Z first; everything else newest/biggest first.
  const TEXT_SORTS: InvoiceSortKey[] = ['customer', 'createdBy'];

  const handleSort = useCallback((key: string) => {
    const k = key as InvoiceSortKey;
    if ((sortKey ?? 'created') === k) {
      setSortKey(k);
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortKey(k);
      setSortDir(TEXT_SORTS.includes(k) ? 'asc' : 'desc');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortKey]);

  const sortSummary = (() => {
    const k = sortKey ?? 'created';
    if (TEXT_SORTS.includes(k)) return `${SORT_LABELS[k]} ${sortDir === 'asc' ? 'א→ת' : 'ת→א'}`;
    if (k === 'amount' || k === 'balance' || k === 'number')
      return `${SORT_LABELS[k]} ${sortDir === 'desc' ? t('invoices.highFirst', 'גבוה קודם') : t('invoices.lowFirst', 'נמוך קודם')}`;
    return `${SORT_LABELS[k]} ${sortDir === 'desc' ? t('invoices.newestFirst', 'חדש קודם') : t('invoices.oldestFirst', 'ישן קודם')}`;
  })();

  const creatorName = creators.find((c) => c.id === filters.createdBy)?.name || t('invoices.unknownUser', 'משתמש');
  const activeChips: { key: string; label: string; onClear?: () => void }[] = [];
  if (sortKey) activeChips.push({ key: 'sort', label: `${t('invoices.sortBy', 'מיון')}: ${sortSummary}`, onClear: () => { setSortKey(null); setSortDir('desc'); } });
  if (filters.fromDate || filters.toDate)
    activeChips.push({
      key: 'dates',
      label: `${filters.fromDate ? formatDate(filters.fromDate) : '…'} – ${filters.toDate ? formatDate(filters.toDate) : '…'}`,
      onClear: () => setFilters((f) => ({ ...f, fromDate: '', toDate: '' })),
    });
  if (filters.createdBy)
    activeChips.push({ key: 'by', label: `${t('invoices.createdBy', 'נוצר על ידי')}: ${creatorName}`, onClear: () => setFilters((f) => ({ ...f, createdBy: '' })) });
  if (filters.minAmount || filters.maxAmount)
    activeChips.push({
      key: 'amt',
      label: `${t('invoices.sortAmount', 'סכום')}: ${filters.minAmount || '0'}–${filters.maxAmount || '∞'}`,
      onClear: () => setFilters((f) => ({ ...f, minAmount: '', maxAmount: '' })),
    });

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
        sortOptions={(Object.keys(SORT_LABELS) as InvoiceSortKey[]).map((k) => ({ key: k, label: SORT_LABELS[k] }))}
        sortKey={sortKey ?? 'created'}
        sortDir={sortDir}
        onSort={handleSort}
        trailing={
          <>
          <View>
            <IconButton
              icon="filter-variant"
              size={22}
              iconColor={advancedCount > 0 ? BRAND_COLOR : theme.colors.onSurfaceVariant}
              onPress={() => setFiltersVisible(true)}
            />
            {advancedCount > 0 ? <View style={[styles.activeDot, { backgroundColor: BRAND_COLOR }]} /> : null}
          </View>
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
          </>
        }
      />

      {activeChips.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ flexGrow: 0, backgroundColor: theme.colors.surface }}
          contentContainerStyle={styles.chipsRow}
        >
          {activeChips.map((c) => (
            <Pressable
              key={c.key}
              onPress={c.onClear}
              style={[styles.activeChip, { backgroundColor: theme.colors.primaryContainer }]}
            >
              <Text style={{ fontSize: 12, color: theme.colors.primary, fontWeight: '600' }}>{c.label}</Text>
              {c.onClear ? <MaterialCommunityIcons name="close" size={14} color={theme.colors.primary} /> : null}
            </Pressable>
          ))}
          {activeChips.length > 1 ? (
            <Pressable
              onPress={() => { setSortKey(null); setSortDir('desc'); setFilters(EMPTY_INVOICE_FILTERS); }}
              style={styles.activeChip}
            >
              <Text style={{ fontSize: 12, color: theme.colors.onSurfaceVariant }}>{t('common.clear', 'נקה')}</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      ) : null}

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

      <InvoiceFiltersSheet
        visible={filtersVisible}
        filters={filters}
        creators={creators}
        onApply={(f) => { setFilters(f); setFiltersVisible(false); }}
        onDismiss={() => setFiltersVisible(false)}
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
  chipsRow: { paddingHorizontal: 12, paddingBottom: 6, gap: 8, alignItems: 'center' },
  activeChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14 },
});
