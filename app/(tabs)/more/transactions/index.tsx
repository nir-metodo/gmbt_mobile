import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  StyleSheet,
  Pressable,
  RefreshControl,
  ScrollView,
  Linking,
  Alert,
  KeyboardAvoidingView,
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
} from 'react-native-paper';
import { FlashList } from '@shopify/flash-list';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../../../stores/authStore';
import { useAppTheme } from '../../../../hooks/useAppTheme';
import { useRTL } from '../../../../hooks/useRTL';
import { useDebouncedValue, useWindowedList } from '../../../../hooks/useWindowedList';
import { ListPaginationFooter } from '../../../../components/ListPaginationFooter';
import { paymentsApi, type Transaction } from '../../../../services/api/payments';
import { withAlpha } from '../../../../utils/formatters';

const BRAND_COLOR = '#2e6155';

type StatusFilter = '' | 'paid' | 'pending' | 'failed';

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
  const { isRTL, flexDirection, textAlign } = useRTL();
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const user = useAuthStore((s) => s.user);
  const organization = user?.organization ?? '';

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchVisible, setSearchVisible] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('');
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState({
    amount: '',
    description: '',
    customerName: '',
    customerPhone: '',
    customerEmail: '',
    payments: '1',
  });
  const [creating, setCreating] = useState(false);

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

  const handleCreatePayment = useCallback(async () => {
    const amount = parseFloat(createForm.amount);
    if (!amount || amount <= 0) {
      Alert.alert(he ? 'שגיאה' : 'Error', he ? 'נא להזין סכום תקין' : 'Please enter a valid amount');
      return;
    }
    setCreating(true);
    try {
      const result = await paymentsApi.createPaymentLink(organization, {
        amount,
        description: createForm.description,
        customerName: createForm.customerName,
        customerPhone: createForm.customerPhone,
        customerEmail: createForm.customerEmail,
        payments: parseInt(createForm.payments) || 1,
      });
      if (result.success) {
        setShowCreateModal(false);
        setCreateForm({ amount: '', description: '', customerName: '', customerPhone: '', customerEmail: '', payments: '1' });
        await fetchTransactions();
        if (result.gambotPaymentUrl || result.paymentUrl) {
          Alert.alert(
            he ? 'קישור תשלום נוצר' : 'Payment Link Created',
            he ? 'האם לפתוח את הקישור?' : 'Open the payment link?',
            [
              { text: he ? 'לא' : 'No', style: 'cancel' },
              { text: he ? 'פתח' : 'Open', onPress: () => Linking.openURL(result.gambotPaymentUrl || result.paymentUrl || '') },
              ...(createForm.customerPhone ? [{
                text: he ? 'שלח בוואטסאפ' : 'WhatsApp',
                onPress: () => {
                  const link = result.gambotPaymentUrl || result.paymentUrl || '';
                  const text = encodeURIComponent(`${he ? 'שלום' : 'Hi'} ${createForm.customerName},\n${he ? 'קישור לתשלום' : 'Payment link'}:\n${link}\n${he ? 'סכום' : 'Amount'}: ₪${amount.toFixed(2)}`);
                  Linking.openURL(`whatsapp://send?phone=${createForm.customerPhone}&text=${text}`);
                },
              }] : []),
            ],
          );
        }
      } else {
        Alert.alert(he ? 'שגיאה' : 'Error', result.error || (he ? 'יצירת תשלום נכשלה' : 'Payment creation failed'));
      }
    } catch {
      Alert.alert(he ? 'שגיאה' : 'Error', he ? 'יצירת תשלום נכשלה' : 'Payment creation failed');
    } finally {
      setCreating(false);
    }
  }, [organization, createForm, he, fetchTransactions]);

  // Debounce search so the list re-filters once typing pauses (no per-keystroke flicker).
  const debouncedSearch = useDebouncedValue(searchQuery, 350);

  const filtered = useMemo(() => {
    let list = [...transactions];
    if (debouncedSearch.trim()) {
      const q = debouncedSearch.trim().toLowerCase();
      list = list.filter(
        (tx) =>
          (tx.customerName || '').toLowerCase().includes(q) ||
          (tx.customerPhone || '').includes(q) ||
          (tx.customerEmail || '').toLowerCase().includes(q) ||
          (tx.description || '').toLowerCase().includes(q) ||
          (tx.transactionId || '').toLowerCase().includes(q),
      );
    }
    if (statusFilter) {
      list = list.filter((tx) => tx.status === statusFilter);
    }
    list.sort((a, b) => {
      const dateA = parseTxDate(a.createdAt)?.getTime() || 0;
      const dateB = parseTxDate(b.createdAt)?.getTime() || 0;
      return dateB - dateA;
    });
    return list;
  }, [transactions, debouncedSearch, statusFilter]);

  // Client-side pagination over the filtered list (search still spans everything).
  const { visible: visibleTx, hasMore: txHasMore, loadMore: txLoadMore, loadAll: txLoadAll, count: txCount } = useWindowedList(filtered, {
    pageSize: 30,
    resetKey: `${debouncedSearch}|${statusFilter}`,
  });

  const stats = useMemo(() => {
    const total = transactions.length;
    const paid = transactions.filter((tx) => tx.status === 'paid').length;
    const pending = transactions.filter((tx) => tx.status === 'pending').length;
    const totalAmount = transactions
      .filter((tx) => tx.status === 'paid')
      .reduce((sum, tx) => sum + (parseFloat(String(tx.amount)) || 0), 0);
    return { total, paid, pending, totalAmount };
  }, [transactions]);

  const he = lang === 'he';

  const renderItem = useCallback(
    ({ item }: { item: Transaction }) => {
      const cfg = STATUS_CONFIG[item.status] || STATUS_CONFIG.pending;
      const amount = parseFloat(String(item.amount)) || 0;
      return (
        <Pressable
          onPress={() => setSelectedTx(item)}
          android_ripple={{ color: theme.colors.surfaceVariant }}
          style={({ pressed }) => [
            styles.txRow,
            {
              backgroundColor: pressed ? theme.colors.surfaceVariant : theme.colors.surface,
              flexDirection,
            },
          ]}
        >
          <View style={[styles.statusStripe, { backgroundColor: cfg.color }]} />
          <View style={styles.txBody}>
            <View style={[styles.txTop, { flexDirection }]}>
              <Text
                variant="titleSmall"
                numberOfLines={1}
                style={{ color: theme.colors.onSurface, fontWeight: '600', flex: 1, textAlign }}
              >
                {item.customerName || item.linkedRecordName || '—'}
              </Text>
              <Text
                variant="titleSmall"
                style={{ color: cfg.color, fontWeight: '700' }}
              >
                ₪{amount.toFixed(2)}
              </Text>
            </View>

            <View style={[styles.txMeta, { flexDirection }]}>
              {item.description ? (
                <Text
                  variant="bodySmall"
                  numberOfLines={1}
                  style={{ color: theme.colors.onSurfaceVariant, flex: 1, textAlign }}
                >
                  {item.description}
                </Text>
              ) : null}
            </View>

            <View style={[styles.txBottom, { flexDirection }]}>
              <Chip
                compact
                icon={() => (
                  <MaterialCommunityIcons name={cfg.icon as any} size={12} color={cfg.color} />
                )}
                textStyle={{ fontSize: 10, color: cfg.color, fontWeight: '600', lineHeight: 14 }}
                style={{ backgroundColor: withAlpha(cfg.color, 0.12), minHeight: 24 }}
              >
                {he ? cfg.labelHe : cfg.labelEn}
              </Chip>
              {item.entityType ? (
                <Chip
                  compact
                  textStyle={{ fontSize: 10, color: theme.colors.onSurfaceVariant, lineHeight: 14 }}
                  style={{ backgroundColor: theme.colors.surfaceVariant, minHeight: 24 }}
                >
                  {item.entityType}
                </Chip>
              ) : null}
              {item.payments && item.payments > 1 ? (
                <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                  {item.payments}x
                </Text>
              ) : null}
              <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                {formatTxDate(item.createdAt, lang)}
              </Text>
              {item.viewCount && item.viewCount > 0 ? (
                <View style={[styles.viewCountBadge, { flexDirection: 'row' }]}>
                  <MaterialCommunityIcons name="eye-check-outline" size={11} color="#53bdeb" />
                  <Text variant="labelSmall" style={{ color: '#53bdeb', fontWeight: '600', fontSize: 10 }}>
                    {item.viewCount}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>

          <MaterialCommunityIcons
            name={isRTL ? 'chevron-left' : 'chevron-right'}
            size={18}
            color={theme.colors.onSurfaceVariant}
            style={{ opacity: 0.4, alignSelf: 'center' }}
          />
        </Pressable>
      );
    },
    [theme, isRTL, flexDirection, textAlign, he, lang],
  );

  const renderEmpty = useCallback(
    () => (
      <View style={styles.emptyWrap}>
        <MaterialCommunityIcons
          name="credit-card-off-outline"
          size={64}
          color={theme.colors.onSurfaceVariant}
          style={{ opacity: 0.35 }}
        />
        <Text variant="titleMedium" style={{ color: theme.colors.onSurface, fontWeight: '600', marginTop: 12 }}>
          {he ? 'אין עסקאות' : 'No transactions'}
        </Text>
        <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center', marginTop: 4 }}>
          {he ? 'עסקאות סליקה יופיעו כאן' : 'Payment transactions will appear here'}
        </Text>
      </View>
    ),
    [theme, he],
  );

  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
      {/* Header */}
      <Appbar.Header style={{ backgroundColor: BRAND_COLOR }}>
        <Appbar.BackAction
          iconColor="#FFF"
          onPress={() => router.back()}
        />
        <Appbar.Content
          title={he ? 'עסקאות סליקה' : 'Transactions'}
          titleStyle={styles.headerTitle}
        />
        <Appbar.Action
          icon={searchVisible ? 'close' : 'magnify'}
          iconColor="#FFF"
          onPress={() => {
            setSearchVisible((v) => !v);
            if (searchVisible) setSearchQuery('');
          }}
        />
      </Appbar.Header>

      {/* Search */}
      {searchVisible ? (
        <View style={[styles.searchWrap, { backgroundColor: BRAND_COLOR }]}>
          <Searchbar
            placeholder={he ? 'חיפוש לפי שם, טלפון, תיאור...' : 'Search by name, phone, description...'}
            value={searchQuery}
            onChangeText={setSearchQuery}
            style={[styles.searchbar, { backgroundColor: theme.colors.surface }]}
            inputStyle={{ fontSize: 14, textAlign: isRTL ? 'right' : 'left' }}
            iconColor={theme.colors.onSurfaceVariant}
            autoFocus
          />
        </View>
      ) : null}

      {/* Stats */}
      {!loading && transactions.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.statsRow}
        >
          <Surface style={[styles.statCard, { backgroundColor: theme.colors.surface }]} elevation={1}>
            <MaterialCommunityIcons name="credit-card-multiple-outline" size={20} color={BRAND_COLOR} />
            <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
              {he ? 'סה"כ' : 'Total'}
            </Text>
            <Text variant="titleMedium" style={{ color: theme.colors.onSurface, fontWeight: '700' }}>
              {stats.total}
            </Text>
          </Surface>
          <Surface style={[styles.statCard, { backgroundColor: theme.colors.surface }]} elevation={1}>
            <MaterialCommunityIcons name="check-circle-outline" size={20} color="#16a34a" />
            <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
              {he ? 'שולמו' : 'Paid'}
            </Text>
            <Text variant="titleMedium" style={{ color: '#16a34a', fontWeight: '700' }}>
              {stats.paid}
            </Text>
          </Surface>
          <Surface style={[styles.statCard, { backgroundColor: theme.colors.surface }]} elevation={1}>
            <MaterialCommunityIcons name="clock-outline" size={20} color="#d97706" />
            <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
              {he ? 'ממתינים' : 'Pending'}
            </Text>
            <Text variant="titleMedium" style={{ color: '#d97706', fontWeight: '700' }}>
              {stats.pending}
            </Text>
          </Surface>
          <Surface style={[styles.statCard, { backgroundColor: theme.colors.surface }]} elevation={1}>
            <MaterialCommunityIcons name="cash-check" size={20} color={BRAND_COLOR} />
            <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
              {he ? 'סה"כ שולם' : 'Total Paid'}
            </Text>
            <Text variant="titleMedium" style={{ color: BRAND_COLOR, fontWeight: '700' }}>
              ₪{stats.totalAmount.toLocaleString(he ? 'he-IL' : 'en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
            </Text>
          </Surface>
        </ScrollView>
      ) : null}

      {/* Status filter chips */}
      <View style={{ backgroundColor: theme.colors.surface, borderBottomColor: theme.colors.outline, borderBottomWidth: StyleSheet.hairlineWidth }}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
        >
          {([
            { key: '' as StatusFilter, label: he ? 'הכל' : 'All' },
            { key: 'paid' as StatusFilter, label: he ? 'שולם' : 'Paid' },
            { key: 'pending' as StatusFilter, label: he ? 'ממתין' : 'Pending' },
            { key: 'failed' as StatusFilter, label: he ? 'נכשל' : 'Failed' },
          ]).map((f) => {
            const isSelected = statusFilter === f.key;
            return (
              <Chip
                key={f.key}
                selected={isSelected}
                onPress={() => setStatusFilter(isSelected && f.key ? '' : f.key)}
                showSelectedOverlay
                compact
                style={[
                  styles.filterChip,
                  isSelected
                    ? { backgroundColor: withAlpha(BRAND_COLOR, 0.12) }
                    : { backgroundColor: theme.colors.surfaceVariant },
                ]}
                textStyle={[
                  styles.filterChipText,
                  isSelected && { color: BRAND_COLOR, fontWeight: '600' },
                ]}
              >
                {f.label}
              </Chip>
            );
          })}
        </ScrollView>
      </View>

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
            ItemSeparatorComponent={() => <Divider />}
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
            estimatedItemSize={90}
          />
        )}
      </View>

      {/* FAB - Create new payment */}
      <FAB
        icon="plus"
        style={[styles.fab, { backgroundColor: BRAND_COLOR }]}
        color="#FFF"
        onPress={() => setShowCreateModal(true)}
        label={he ? 'סליקה חדשה' : 'New Payment'}
      />

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

      {/* Create Payment modal */}
      <Portal>
        <Modal
          visible={showCreateModal}
          onDismiss={() => setShowCreateModal(false)}
          contentContainerStyle={[styles.detailModal, { backgroundColor: theme.colors.surface }]}
        >
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <View style={[{ flexDirection, alignItems: 'center', marginBottom: 16 }]}>
                <MaterialCommunityIcons name="credit-card-plus-outline" size={22} color={BRAND_COLOR} />
                <Text
                  variant="titleMedium"
                  style={{ color: theme.colors.onSurface, fontWeight: '700', flex: 1, marginStart: 8, textAlign }}
                >
                  {he ? 'יצירת סליקה חדשה' : 'Create New Payment'}
                </Text>
              </View>

              <TextInput
                label={he ? 'סכום (₪) *' : 'Amount (₪) *'}
                value={createForm.amount}
                onChangeText={(v) => setCreateForm((f) => ({ ...f, amount: v }))}
                keyboardType="decimal-pad"
                mode="outlined"
                style={styles.formInput}
                outlineColor={theme.colors.outline}
                activeOutlineColor={BRAND_COLOR}
              />
              <TextInput
                label={he ? 'תיאור' : 'Description'}
                value={createForm.description}
                onChangeText={(v) => setCreateForm((f) => ({ ...f, description: v }))}
                mode="outlined"
                style={styles.formInput}
                outlineColor={theme.colors.outline}
                activeOutlineColor={BRAND_COLOR}
              />
              <TextInput
                label={he ? 'שם לקוח' : 'Customer Name'}
                value={createForm.customerName}
                onChangeText={(v) => setCreateForm((f) => ({ ...f, customerName: v }))}
                mode="outlined"
                style={styles.formInput}
                outlineColor={theme.colors.outline}
                activeOutlineColor={BRAND_COLOR}
              />
              <TextInput
                label={he ? 'טלפון לקוח' : 'Customer Phone'}
                value={createForm.customerPhone}
                onChangeText={(v) => setCreateForm((f) => ({ ...f, customerPhone: v }))}
                keyboardType="phone-pad"
                mode="outlined"
                style={styles.formInput}
                outlineColor={theme.colors.outline}
                activeOutlineColor={BRAND_COLOR}
              />
              <TextInput
                label={he ? 'מייל לקוח' : 'Customer Email'}
                value={createForm.customerEmail}
                onChangeText={(v) => setCreateForm((f) => ({ ...f, customerEmail: v }))}
                keyboardType="email-address"
                mode="outlined"
                style={styles.formInput}
                outlineColor={theme.colors.outline}
                activeOutlineColor={BRAND_COLOR}
              />
              <TextInput
                label={he ? 'מספר תשלומים' : 'Installments'}
                value={createForm.payments}
                onChangeText={(v) => setCreateForm((f) => ({ ...f, payments: v }))}
                keyboardType="number-pad"
                mode="outlined"
                style={styles.formInput}
                outlineColor={theme.colors.outline}
                activeOutlineColor={BRAND_COLOR}
              />

              <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
                <Button
                  mode="contained"
                  onPress={handleCreatePayment}
                  loading={creating}
                  disabled={creating}
                  style={{ flex: 1, borderRadius: 10 }}
                  buttonColor={BRAND_COLOR}
                  textColor="#FFF"
                >
                  {he ? 'צור קישור תשלום' : 'Create Payment Link'}
                </Button>
                <Button
                  mode="outlined"
                  onPress={() => setShowCreateModal(false)}
                  style={{ borderRadius: 10 }}
                  textColor={theme.colors.onSurface}
                >
                  {he ? 'ביטול' : 'Cancel'}
                </Button>
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
        </Modal>
      </Portal>
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
              onPress={() => {
                const text = encodeURIComponent(
                  `${he ? 'שלום' : 'Hi'} ${tx.customerName || ''},\n${he ? 'קישור לתשלום' : 'Payment link'}:\n${shareLink}\n${he ? 'סכום' : 'Amount'}: ₪${amount.toFixed(2)}`,
                );
                Linking.openURL(`whatsapp://send?phone=${tx.customerPhone}&text=${text}`);
              }}
              style={{
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
  filterChip: { height: 28 },
  filterChipText: { fontSize: 11, lineHeight: 16 },
  listContent: { paddingTop: 4, paddingBottom: 100 },
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
