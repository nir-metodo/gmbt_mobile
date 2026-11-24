import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  StyleSheet,
  Pressable,
  RefreshControl,
  ScrollView,
  Linking,
  Alert,
  Platform,
} from 'react-native';
import {
  Text,
  Searchbar,
  Chip,
  ActivityIndicator,
  Appbar,
  Divider,
  Surface,
  Portal,
  Modal,
  Button,
  TextInput,
  FAB,
  IconButton,
} from 'react-native-paper';
import { FlashList } from '@shopify/flash-list';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../../../stores/authStore';
import { sendDocAndAlert } from '../../../../utils/sendDocAlert';
import { useAppTheme } from '../../../../hooks/useAppTheme';
import { useRTL } from '../../../../hooks/useRTL';
import { useModalKeyboard } from '../../../../hooks/useModalKeyboard';
import { useDebouncedValue, useWindowedList } from '../../../../hooks/useWindowedList';
import { ListPaginationFooter } from '../../../../components/ListPaginationFooter';
import { paymentsApi, type Transaction } from '../../../../services/api/payments';
import { withAlpha, formatCurrency } from '../../../../utils/formatters';
import { ScreenHeader } from '../../../../components/ScreenHeader';
import { ListToolbar } from '../../../../components/ListToolbar';
import { StatusFilterBar } from '../../../../components/StatusFilterBar';
import { SummaryHeader } from '../../../../components/SummaryHeader';
import { DocumentListItem } from '../../../../components/DocumentListItem';
import { EmptyState } from '../../../../components/EmptyState';
import { TransactionRowActions } from '../../../../components/TransactionRowActions';
import PaymentFormSheet from '../../../../components/PaymentFormSheet';

const BRAND_COLOR = '#2e6155';

type StatusFilter = '' | 'paid' | 'pending' | 'failed';
type DateRangeKey = 'all' | 'today' | 'yesterday' | '7d' | 'month';
const DATE_RANGE_KEYS: DateRangeKey[] = ['all', 'today', 'yesterday', '7d', 'month'];
const DATE_RANGE_LABEL: Record<DateRangeKey, { he: string; en: string }> = {
  all: { he: 'כל התאריכים', en: 'All dates' },
  today: { he: 'היום', en: 'Today' },
  yesterday: { he: 'אתמול', en: 'Yesterday' },
  '7d': { he: '7 ימים', en: '7 days' },
  month: { he: 'החודש', en: 'This month' },
};
const NO_SENDER = '__none';

/** Local-day [from, to) bounds of a preset range. */
function rangeBounds(key: DateRangeKey): [number, number] | null {
  if (key === 'all') return null;
  const n = new Date();
  const today = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
  const day = 86400000;
  if (key === 'today') return [today, today + day];
  if (key === 'yesterday') return [today - day, today];
  if (key === '7d') return [today - 6 * day, today + day];
  return [new Date(n.getFullYear(), n.getMonth(), 1).getTime(), today + day];
}

const STATUS_CONFIG: Record<string, { icon: string; color: string; labelHe: string; labelEn: string }> = {
  paid: { icon: 'check-circle', color: '#16a34a', labelHe: 'שולם', labelEn: 'Paid' },
  pending: { icon: 'clock-outline', color: '#d97706', labelHe: 'ממתין', labelEn: 'Pending' },
  failed: { icon: 'close-circle', color: '#dc2626', labelHe: 'נכשל', labelEn: 'Failed' },
};

function parseTxDate(ts: any): Date | null {
  if (!ts) return null;
  if (ts._seconds) return new Date(ts._seconds * 1000);
  const d = new Date(ts);
  return isNaN(d.getTime()) ? null : d;
}

function formatTxDate(ts: any, locale: string): string {
  const d = parseTxDate(ts);
  if (!d) return '—';
  const dateStr = d.toLocaleDateString(locale === 'he' ? 'he-IL' : 'en-US', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  const timeStr = d.toLocaleTimeString(locale === 'he' ? 'he-IL' : 'en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${dateStr} ${timeStr}`;
}

export default function TransactionsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useAppTheme();
  const mk = useModalKeyboard(0.85);
  const { isRTL, flexDirection, textAlign } = useRTL();
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const user = useAuthStore((s) => s.user);
  const organization = user?.organization ?? '';
  const he = lang === 'he';

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchVisible, setSearchVisible] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('');
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [dateRange, setDateRange] = useState<DateRangeKey>('all');
  const [senderFilter, setSenderFilter] = useState('');
  const [filterSheetVisible, setFilterSheetVisible] = useState(false);
  const fetchTransactions = useCallback(async () => {
    if (!organization) { setLoading(false); return; }
    setLoading(true);
    try {
      const data = await paymentsApi.getTransactions(organization);
      setTransactions(data);
    } catch {
      setTransactions([]);
    } finally {
      setLoading(false);
    }
  }, [organization]);

  useEffect(() => { fetchTransactions(); }, [fetchTransactions]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchTransactions();
    setRefreshing(false);
  }, [fetchTransactions]);

  // Debounce search so the list re-filters once typing pauses (no per-keystroke flicker).
  const debouncedSearch = useDebouncedValue(searchQuery, 350);

  // Who created the payments (sent the link / charged): id -> name.
  const senders = useMemo(() => {
    const m = new Map<string, string>();
    transactions.forEach((tx) => { if (tx.createdById) m.set(tx.createdById, tx.createdByName || tx.createdById); });
    return Array.from(m, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [transactions]);

  // Everything but the status filter: the totals strip and the status counts describe this set.
  const scoped = useMemo(() => {
    let list = [...transactions];
    const bounds = rangeBounds(dateRange);
    if (bounds) {
      list = list.filter((tx) => {
        const ms = parseTxDate(tx.createdAt)?.getTime() || 0;
        return ms >= bounds[0] && ms < bounds[1];
      });
    }
    if (senderFilter === NO_SENDER) list = list.filter((tx) => !tx.createdById);
    else if (senderFilter) list = list.filter((tx) => tx.createdById === senderFilter);
    if (debouncedSearch.trim()) {
      const q = debouncedSearch.trim().toLowerCase();
      list = list.filter(
        (tx) =>
          (tx.customerName || '').toLowerCase().includes(q) ||
          (tx.customerPhone || '').includes(q) ||
          (tx.customerEmail || '').toLowerCase().includes(q) ||
          (tx.description || '').toLowerCase().includes(q) ||
          (tx.createdByName || '').toLowerCase().includes(q) ||
          (tx.transactionId || '').toLowerCase().includes(q),
      );
    }
    return list;
  }, [transactions, dateRange, senderFilter, debouncedSearch]);

  const filtered = useMemo(() => {
    let list = [...scoped];
    if (statusFilter) {
      list = list.filter((tx) => tx.status === statusFilter);
    }
    list.sort((a, b) => {
      const dateA = parseTxDate(a.createdAt)?.getTime() || 0;
      const dateB = parseTxDate(b.createdAt)?.getTime() || 0;
      return dateB - dateA;
    });
    return list;
  }, [scoped, statusFilter]);

  // Client-side pagination over the filtered list (search still spans everything).
  const { visible: visibleTx, hasMore: txHasMore, loadMore: txLoadMore, loadAll: txLoadAll, count: txCount } = useWindowedList(filtered, {
    pageSize: 30,
    resetKey: `${debouncedSearch}|${statusFilter}|${dateRange}|${senderFilter}`,
  });

  const stats = useMemo(() => {
    const amt = (tx: Transaction) => parseFloat(String(tx.amount)) || 0;
    const total = scoped.length;
    const paidList = scoped.filter((tx) => tx.status === 'paid');
    const pendingList = scoped.filter((tx) => tx.status === 'pending');
    const totalAmount = paidList.reduce((s, tx) => s + amt(tx), 0);
    const pendingAmount = pendingList.reduce((s, tx) => s + amt(tx), 0);
    const rate = total > 0 ? Math.round((paidList.length / total) * 100) : 0;
    const avg = paidList.length > 0 ? totalAmount / paidList.length : 0;
    return { total, paid: paidList.length, pending: pendingList.length, totalAmount, pendingAmount, rate, avg };
  }, [scoped]);

  const filtersActive = dateRange !== 'all' || !!senderFilter;

  const renderItem = useCallback(
    ({ item }: { item: Transaction }) => {
      const cfg = STATUS_CONFIG[item.status] || STATUS_CONFIG.pending;
      const amount = parseFloat(String(item.amount)) || 0;
      const subtitle = [item.description, item.entityType, item.payments && item.payments > 1 ? `${item.payments}x` : '', item.createdByName ? `${he ? 'נשלח ע"י' : 'by'} ${item.createdByName}` : '']
        .filter(Boolean).join(' · ');
      return (
        <DocumentListItem
          title={item.customerName || item.linkedRecordName || '—'}
          subtitle={subtitle}
          amount={formatCurrency(amount)}
          statusLabel={he ? cfg.labelHe : cfg.labelEn}
          statusColor={cfg.color}
          date={formatTxDate(item.createdAt, lang)}
          viewCount={item.viewCount}
          onPress={() => setSelectedTx(item)}
          actions={<TransactionRowActions tx={item} user={user} />}
        />
      );
    },
    [he, lang, user],
  );

  const openCreate = useCallback(() => setShowCreateModal(true), []);

  const renderEmpty = useCallback(() => {
    const filtering = transactions.length > 0;
    return (
      <EmptyState
        icon="credit-card-off-outline"
        title={filtering ? t('common.noResults') : (he ? 'אין עסקאות' : 'No transactions')}
        description={filtering ? undefined : (he ? 'עסקאות סליקה יופיעו כאן' : 'Payment transactions will appear here')}
        actionLabel={filtering ? undefined : (he ? 'סליקה חדשה' : 'New Payment')}
        onAction={filtering ? undefined : openCreate}
      />
    );
  }, [transactions.length, he, t, openCreate]);

  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
      <ScreenHeader title={he ? 'עסקאות סליקה' : 'Transactions'} onBack={() => router.back()} />

      <ListToolbar
        query={searchQuery}
        onChangeQuery={setSearchQuery}
        placeholder={he ? 'חיפוש לפי שם, טלפון, תיאור, שולח...' : 'Search by name, phone, description, sender...'}
        trailing={
          <View>
            <IconButton
              icon="filter-variant"
              size={22}
              iconColor={filtersActive ? BRAND_COLOR : theme.colors.onSurfaceVariant}
              onPress={() => setFilterSheetVisible(true)}
            />
            {filtersActive ? <View style={styles.filterDot} /> : null}
          </View>
        }
      />

      {!loading && transactions.length > 0 ? (
        <>
          <SummaryHeader
            items={[
              { label: he ? 'סה"כ שולם' : 'Total paid', value: formatCurrency(stats.totalAmount), color: '#16a34a' },
              { label: he ? 'ממתין לתשלום' : 'Awaiting', value: formatCurrency(stats.pendingAmount), color: '#d97706' },
            ]}
          />
          <SummaryHeader
            items={[
              { label: he ? 'עסקאות' : 'Transactions', value: String(stats.total) },
              { label: he ? 'אחוז תשלום' : 'Paid rate', value: `${stats.rate}%`, color: BRAND_COLOR },
              { label: he ? 'ממוצע' : 'Average', value: formatCurrency(stats.avg) },
            ]}
          />
        </>
      ) : null}

      <StatusFilterBar
        allLabel={he ? 'הכל' : 'All'}
        allCount={scoped.length}
        options={(['paid', 'pending', 'failed'] as const).map((k) => ({
          key: k,
          label: he ? STATUS_CONFIG[k].labelHe : STATUS_CONFIG[k].labelEn,
          color: STATUS_CONFIG[k].color,
          count: scoped.filter((tx) => tx.status === k).length,
        }))}
        value={statusFilter || 'all'}
        onChange={(k) => setStatusFilter(k === 'all' ? '' : (k as StatusFilter))}
      />

      {/* Content */}
      <View style={{ flex: 1 }}>
        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={BRAND_COLOR} />
          </View>
        ) : (
          <FlashList
            data={visibleTx}
            renderItem={renderItem}
            keyExtractor={(item, idx) => item.id || item.transactionId || `tx_${idx}`}
            ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
            ListEmptyComponent={renderEmpty}
            ListFooterComponent={
              <ListPaginationFooter
                count={txCount}
                total={filtered.length}
                hasMore={txHasMore}
                onLoadMore={txLoadMore}
                onLoadAll={txLoadAll}
              />
            }
            onEndReached={txHasMore ? txLoadMore : undefined}
            onEndReachedThreshold={0.4}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                colors={[BRAND_COLOR]}
                tintColor={BRAND_COLOR}
              />
            }
            contentContainerStyle={styles.listContent}
          />
        )}
      </View>

      {/* FAB - Create new payment */}
      <FAB
        icon="plus"
        style={[styles.fab, { backgroundColor: BRAND_COLOR, bottom: insets.bottom + 16, left: isRTL ? 16 : undefined, right: isRTL ? undefined : 16 }]}
        color="#FFF"
        onPress={openCreate}
        label={he ? 'סליקה חדשה' : 'New Payment'}
      />

      <Portal>
        {/* Filters: date + who sent */}
        <Modal
          visible={filterSheetVisible}
          onDismiss={() => setFilterSheetVisible(false)}
          contentContainerStyle={[styles.detailModal, { backgroundColor: theme.colors.surface }]}
        >
          <ScrollView keyboardShouldPersistTaps="handled">
            <Text style={{ fontWeight: '700', marginBottom: 8, textAlign }}>{he ? 'לפי תאריך' : 'By date'}</Text>
            <View style={{ flexDirection: isRTL ? 'row-reverse' : 'row', flexWrap: 'wrap', gap: 8 }}>
              {DATE_RANGE_KEYS.map((k) => (
                <Chip key={k} selected={dateRange === k} showSelectedCheck={false} onPress={() => setDateRange(k)}>
                  {he ? DATE_RANGE_LABEL[k].he : DATE_RANGE_LABEL[k].en}
                </Chip>
              ))}
            </View>
            {senders.length > 0 ? (
              <>
                <Text style={{ fontWeight: '700', marginTop: 20, marginBottom: 8, textAlign }}>{he ? 'לפי מי שלח' : 'By sender'}</Text>
                <View style={{ flexDirection: isRTL ? 'row-reverse' : 'row', flexWrap: 'wrap', gap: 8 }}>
                  <Chip selected={!senderFilter} showSelectedCheck={false} onPress={() => setSenderFilter('')}>{he ? 'כולם' : 'Everyone'}</Chip>
                  {senders.map((s) => (
                    <Chip key={s.id} selected={senderFilter === s.id} showSelectedCheck={false} onPress={() => setSenderFilter(s.id)}>{s.name}</Chip>
                  ))}
                  <Chip selected={senderFilter === NO_SENDER} showSelectedCheck={false} onPress={() => setSenderFilter(NO_SENDER)}>{he ? 'אוטומטי / לא ידוע' : 'Automatic / unknown'}</Chip>
                </View>
              </>
            ) : null}
          </ScrollView>
          <View style={{ flexDirection: isRTL ? 'row-reverse' : 'row', gap: 12, marginTop: 20 }}>
            <Button mode="outlined" style={{ flex: 1, borderRadius: 12 }} onPress={() => { setDateRange('all'); setSenderFilter(''); }}>{he ? 'נקה' : 'Clear'}</Button>
            <Button mode="contained" buttonColor={BRAND_COLOR} style={{ flex: 1, borderRadius: 12 }} onPress={() => setFilterSheetVisible(false)}>{he ? 'הצג' : 'Show'}</Button>
          </View>
        </Modal>
      </Portal>

      {/* Detail modal */}
      <Portal>
        <Modal
          visible={!!selectedTx}
          onDismiss={() => setSelectedTx(null)}
          contentContainerStyle={[styles.detailModal, { backgroundColor: theme.colors.surface }]}
        >
          {selectedTx ? (
            <TransactionDetail
              tx={selectedTx}
              theme={theme}
              he={he}
              lang={lang}
              flexDirection={flexDirection}
              textAlign={textAlign}
              isRTL={isRTL}
              onClose={() => setSelectedTx(null)}
            />
          ) : null}
        </Modal>
      </Portal>

      {/* New payment — same form as the web (link to a record, VAT, items) */}
      <PaymentFormSheet
        visible={showCreateModal}
        onDismiss={() => setShowCreateModal(false)}
        onDone={fetchTransactions}
        user={user}
      />
    </View>
  );
}

function TransactionDetail({
  tx,
  theme,
  he,
  lang,
  flexDirection,
  textAlign,
  isRTL,
  onClose,
}: {
  tx: Transaction;
  theme: any;
  he: boolean;
  lang: string;
  flexDirection: 'row' | 'row-reverse';
  textAlign: 'left' | 'right';
  isRTL: boolean;
  onClose: () => void;
}) {
  const cfg = STATUS_CONFIG[tx.status] || STATUS_CONFIG.pending;
  const amount = parseFloat(String(tx.amount)) || 0;
  const shareLink = tx.gambotPaymentUrl || tx.paymentUrl;
  const authUser = useAuthStore((st) => st.user);
  const [sendingWa, setSendingWa] = React.useState(false);

  return (
    <ScrollView showsVerticalScrollIndicator={false}>
      <View style={[{ flexDirection, alignItems: 'center', marginBottom: 16 }]}>
        <MaterialCommunityIcons name="credit-card-outline" size={22} color={BRAND_COLOR} />
        <Text
          variant="titleMedium"
          style={{ color: theme.colors.onSurface, fontWeight: '700', flex: 1, marginStart: 8, textAlign }}
        >
          {he ? 'פרטי עסקה' : 'Transaction Details'}
        </Text>
      </View>

      {/* Status badge */}
      <View style={{ alignItems: 'center', marginBottom: 16 }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            paddingHorizontal: 16,
            paddingVertical: 8,
            backgroundColor: withAlpha(cfg.color, 0.1),
            borderRadius: 20,
          }}
        >
          <MaterialCommunityIcons name={cfg.icon as any} size={18} color={cfg.color} />
          <Text style={{ color: cfg.color, fontWeight: '700', fontSize: 14 }}>
            {he ? cfg.labelHe : cfg.labelEn}
          </Text>
        </View>
      </View>

      {/* Amount */}
      <Text
        variant="headlineMedium"
        style={{ textAlign: 'center', color: theme.colors.onSurface, fontWeight: '700', marginBottom: 16 }}
      >
        ₪{amount.toFixed(2)}
      </Text>

      <Divider style={{ marginBottom: 12 }} />

      {/* Fields */}
      <DetailRow icon="account-outline" label={he ? 'לקוח' : 'Customer'} value={tx.customerName || '—'} theme={theme} flexDirection={flexDirection} />
      {tx.customerPhone ? (
        <DetailRow icon="phone-outline" label={he ? 'טלפון' : 'Phone'} value={tx.customerPhone} theme={theme} flexDirection={flexDirection} />
      ) : null}
      {tx.customerEmail ? (
        <DetailRow icon="email-outline" label={he ? 'מייל' : 'Email'} value={tx.customerEmail} theme={theme} flexDirection={flexDirection} />
      ) : null}
      {tx.description ? (
        <DetailRow icon="text-box-outline" label={he ? 'תיאור' : 'Description'} value={tx.description} theme={theme} flexDirection={flexDirection} />
      ) : null}
      {tx.createdByName ? (
        <DetailRow icon="account-arrow-right-outline" label={he ? 'נשלח ע"י' : 'Sent by'} value={tx.createdByName} theme={theme} flexDirection={flexDirection} />
      ) : null}
      <DetailRow icon="calendar-outline" label={he ? 'תאריך' : 'Date'} value={formatTxDate(tx.createdAt, lang)} theme={theme} flexDirection={flexDirection} />
      {tx.status === 'paid' ? (
        <DetailRow icon="calendar-check-outline" label={he ? 'שולם בתאריך' : 'Paid at'} value={formatTxDate(tx.paidAt || tx.updatedAt || tx.createdAt, lang)} theme={theme} flexDirection={flexDirection} />
      ) : null}
      {tx.payments && tx.payments > 1 ? (
        <DetailRow icon="numeric" label={he ? 'תשלומים' : 'Installments'} value={`${tx.payments}`} theme={theme} flexDirection={flexDirection} />
      ) : null}
      {tx.entityType ? (
        <DetailRow icon="link-variant" label={he ? 'ישות' : 'Entity'} value={tx.entityType} theme={theme} flexDirection={flexDirection} />
      ) : null}
      {tx.linkedRecordName ? (
        <DetailRow icon="file-document-outline" label={he ? 'רשומה מקושרת' : 'Linked Record'} value={tx.linkedRecordName} theme={theme} flexDirection={flexDirection} />
      ) : null}
      {tx.invoiceNumber ? (
        <DetailRow icon="receipt" label={he ? 'חשבונית' : 'Invoice'} value={`#${tx.invoiceNumber}`} theme={theme} flexDirection={flexDirection} />
      ) : null}
      {tx.chargeMethod ? (
        <DetailRow icon="cash-register" label={he ? 'אמצעי תשלום' : 'Payment Method'} value={tx.chargeMethod} theme={theme} flexDirection={flexDirection} />
      ) : null}

      {/* Actions */}
      {shareLink && tx.status !== 'paid' ? (
        <View style={{ marginTop: 12, gap: 8 }}>
          <Pressable
            onPress={() => Linking.openURL(shareLink)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              paddingHorizontal: 16,
              paddingVertical: 10,
              backgroundColor: '#f0fdf4',
              borderWidth: 1,
              borderColor: '#bbf7d0',
              borderRadius: 10,
              justifyContent: 'center',
            }}
          >
            <MaterialCommunityIcons name="open-in-new" size={16} color={BRAND_COLOR} />
            <Text style={{ color: BRAND_COLOR, fontWeight: '600', fontSize: 13 }}>
              {he ? 'פתח קישור תשלום' : 'Open Payment Link'}
            </Text>
          </Pressable>

          {tx.customerPhone ? (
            <Pressable
              disabled={sendingWa}
              onPress={async () => {
                if (!authUser?.organization) return;
                setSendingWa(true);
                await sendDocAndAlert({
                  organization: authUser.organization,
                  phone: tx.customerPhone || '',
                  role: 'sendPaymentLink',
                  user: authUser as any,
                  customerName: tx.customerName || '',
                  docLabel: `תשלום על סך ₪${amount.toFixed(2)}`,
                  url: shareLink || '',
                  liveText: `שלום ${tx.customerName || ''},\nקישור לתשלום על סך ₪${amount.toFixed(2)}:`,
                });
                setSendingWa(false);
              }}
              style={{
                opacity: sendingWa ? 0.6 : 1,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                paddingHorizontal: 16,
                paddingVertical: 10,
                backgroundColor: '#25D366',
                borderRadius: 10,
                justifyContent: 'center',
              }}
            >
              <MaterialCommunityIcons name="whatsapp" size={16} color="#FFF" />
              <Text style={{ color: '#FFF', fontWeight: '600', fontSize: 13 }}>
                {he ? 'שלח בוואטסאפ' : 'Send WhatsApp'}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      <Button
        mode="outlined"
        onPress={onClose}
        style={{ marginTop: 16, borderRadius: 10 }}
        textColor={theme.colors.onSurface}
      >
        {he ? 'סגור' : 'Close'}
      </Button>
    </ScrollView>
  );
}

function DetailRow({
  icon,
  label,
  value,
  theme,
  flexDirection,
}: {
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  label: string;
  value: string;
  theme: any;
  flexDirection: 'row' | 'row-reverse';
}) {
  return (
    <View style={[styles.detailRow, { flexDirection }]}>
      <MaterialCommunityIcons name={icon} size={18} color={theme.colors.onSurfaceVariant} style={{ marginEnd: 10 }} />
      <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant, minWidth: 80 }}>
        {label}
      </Text>
      <Text variant="bodyMedium" style={{ color: theme.colors.onSurface, flex: 1, fontWeight: '500' }}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: '#FFFFFF', fontWeight: '700', fontSize: 18 },
  searchWrap: { paddingHorizontal: 14, paddingBottom: 8 },
  searchbar: { height: 40, borderRadius: 20, elevation: 0 },
  statsRow: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 8,
  },
  statCard: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: 'center',
    minWidth: 80,
    gap: 2,
  },
  filterRow: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    gap: 6,
    alignItems: 'center',
  },
  filterDot: { position: 'absolute', top: 8, right: 8, width: 8, height: 8, borderRadius: 4, backgroundColor: '#F4B400' },
  filterChip: { height: 28 },
  filterChipText: { fontSize: 11, lineHeight: 16 },
  listContent: { padding: 14, paddingBottom: 100 },
  txRow: {
    alignItems: 'stretch',
    paddingTop: 10,
    paddingBottom: 10,
    paddingEnd: 14,
  },
  statusStripe: {
    width: 4,
    borderTopRightRadius: 2,
    borderBottomRightRadius: 2,
    marginEnd: 14,
  },
  txBody: { flex: 1, gap: 4 },
  txTop: { alignItems: 'center', justifyContent: 'space-between' },
  txMeta: { alignItems: 'center', gap: 8 },
  txBottom: { alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap' },
  emptyWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    paddingHorizontal: 40,
  },
  detailModal: {
    marginHorizontal: 20,
    borderRadius: 16,
    padding: 20,
    maxHeight: '85%',
  },
  detailRow: {
    alignItems: 'center',
    paddingVertical: 8,
    gap: 4,
  },
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 16,
    borderRadius: 28,
  },
  formInput: {
    marginBottom: 10,
    fontSize: 14,
  },
  viewCountBadge: {
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(83, 189, 235, 0.1)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
});
