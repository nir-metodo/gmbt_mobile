import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  Pressable,
  RefreshControl,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TouchableOpacity,
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
  TextInput,
  Button,
  IconButton,
  Divider,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../../../stores/authStore';
import { useAppTheme } from '../../../../hooks/useAppTheme';
import { useRTL } from '../../../../hooks/useRTL';
import { purchaseOrdersApi, PurchaseOrder } from '../../../../services/api/purchaseOrders';
import { suppliersApi, Supplier } from '../../../../services/api/suppliers';
import { formatDate, withAlpha } from '../../../../utils/formatters';
import { borderRadius } from '../../../../constants/theme';
import { appCache } from '../../../../services/cache';

const BRAND_COLOR = '#7B2D8E';

const STATUS_COLORS: Record<string, string> = {
  draft: '#9E9E9E',
  ordered: '#2196F3',
  partial: '#FF9800',
  received: '#4CAF50',
  cancelled: '#F44336',
};

const STATUS_ICONS: Record<string, string> = {
  draft: 'file-edit-outline',
  ordered: 'send-check',
  partial: 'package-variant',
  received: 'package-variant-closed-check',
  cancelled: 'close-circle-outline',
};

const STATUS_FILTERS = ['all', 'draft', 'ordered', 'partial', 'received', 'cancelled'] as const;
type StatusFilter = typeof STATUS_FILTERS[number];

export default function PurchasingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useAppTheme();
  const { isRTL, flexDirection, textAlign } = useRTL();
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);

  const CACHE_KEY = `purchasing_${user?.organization}`;

  const [orders, setOrders] = useState<PurchaseOrder[]>(() => appCache.get<PurchaseOrder[]>(CACHE_KEY) ?? []);
  const [loading, setLoading] = useState(!appCache.get<PurchaseOrder[]>(CACHE_KEY));
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchVisible, setSearchVisible] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const [createVisible, setCreateVisible] = useState(false);
  const [creating, setCreating] = useState(false);
  const [formNotes, setFormNotes] = useState('');
  const [formExpectedDate, setFormExpectedDate] = useState('');

  // Supplier picker
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [suppliersLoading, setSuppliersLoading] = useState(false);
  const [supplierSearch, setSupplierSearch] = useState('');
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  const [supplierDropdownOpen, setSupplierDropdownOpen] = useState(false);
  const supplierDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchOrders = useCallback(async () => {
    if (!user?.organization) { setLoading(false); return; }
    try {
      setError(null);
      const data = await purchaseOrdersApi.getAll(user.organization);
      appCache.set(CACHE_KEY, data);
      setOrders(data);
    } catch (err: any) {
      setError(err.message || t('errors.generic'));
    } finally {
      setLoading(false);
    }
  }, [user?.organization, t, CACHE_KEY]);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchOrders();
    setRefreshing(false);
  }, [fetchOrders]);

  const resetForm = () => {
    setFormNotes(''); setFormExpectedDate('');
    setSelectedSupplier(null); setSupplierSearch(''); setSupplierDropdownOpen(false);
  };

  const loadSuppliers = useCallback(async () => {
    if (!user?.organization || suppliers.length > 0) return;
    setSuppliersLoading(true);
    try {
      const data = await suppliersApi.getAll(user.organization);
      setSuppliers(data);
    } catch { setSuppliers([]); }
    finally { setSuppliersLoading(false); }
  }, [user?.organization, suppliers.length]);

  const filteredSuppliers = useMemo(() => {
    if (!supplierSearch.trim()) return suppliers;
    const q = supplierSearch.toLowerCase();
    return suppliers.filter((s) => (s.name || '').toLowerCase().includes(q) || (s.phone || '').includes(q));
  }, [suppliers, supplierSearch]);

  const handleCreate = useCallback(async () => {
    if (!user?.organization) return;
    if (!selectedSupplier) {
      Alert.alert(t('common.error'), 'יש לבחור ספק');
      return;
    }
    setCreating(true);
    try {
      await purchaseOrdersApi.create(user.organization, {
        supplierId: selectedSupplier.id,
        supplierName: selectedSupplier.name,
        status: 'draft',
        notes: formNotes.trim(),
        expectedDate: formExpectedDate.trim(),
        items: [],
        currency: 'ILS',
      }, user.uID || user.userId, user.fullname);
      setCreateVisible(false);
      resetForm();
      appCache.invalidate(CACHE_KEY);
      await fetchOrders();
    } catch (err: any) {
      Alert.alert(t('common.error'), err.message || t('errors.generic'));
    } finally {
      setCreating(false);
    }
  }, [user, selectedSupplier, formNotes, formExpectedDate, fetchOrders, CACHE_KEY, t]);

  const handleStatusChange = useCallback(async (order: PurchaseOrder, newStatus: string) => {
    if (!user?.organization) return;
    try {
      await purchaseOrdersApi.updateStatus(user.organization, order.id, newStatus, user.uID || user.userId, user.fullname);
      setOrders(prev => prev.map(o => o.id === order.id ? { ...o, status: newStatus } : o));
    } catch (err: any) {
      Alert.alert(t('common.error'), err.message || t('errors.generic'));
    }
  }, [user, t]);

  const handleDelete = useCallback((order: PurchaseOrder) => {
    Alert.alert(t('common.delete'), t('purchasing.deleteConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'), style: 'destructive',
        onPress: async () => {
          try {
            await purchaseOrdersApi.delete(user!.organization, order.id);
            appCache.invalidate(CACHE_KEY);
            setOrders(prev => prev.filter(o => o.id !== order.id));
          } catch (err: any) {
            Alert.alert(t('common.error'), err.message || t('errors.generic'));
          }
        },
      },
    ]);
  }, [user, CACHE_KEY, t]);

  const filtered = useMemo(() => {
    let result = Array.isArray(orders) ? orders : [];
    if (statusFilter !== 'all') result = result.filter(o => o.status === statusFilter);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(o =>
        o.supplierName?.toLowerCase().includes(q) ||
        o.poNumber?.toLowerCase().includes(q) ||
        o.notes?.toLowerCase().includes(q),
      );
    }
    return result.sort((a, b) => {
      const aD = a.createdOn ? new Date(a.createdOn).getTime() : 0;
      const bD = b.createdOn ? new Date(b.createdOn).getTime() : 0;
      return bD - aD;
    });
  }, [orders, statusFilter, searchQuery]);

  const renderCard = useCallback(({ item }: { item: PurchaseOrder }) => {
    const color = STATUS_COLORS[item.status] || '#9E9E9E';
    const icon = STATUS_ICONS[item.status] || 'file-document-outline';
    return (
      <Pressable
        onLongPress={() => {
          Alert.alert(
            item.supplierName || t('purchasing.purchaseOrder'),
            '',
            [
              { text: t('common.cancel'), style: 'cancel' },
              ...(['draft', 'ordered', 'partial', 'received', 'cancelled'].map(s => ({
                text: s === 'draft' ? t('purchasing.statusDraft') : s === 'ordered' ? t('purchasing.statusOrdered') : s === 'partial' ? t('purchasing.statusPartial') : s === 'received' ? t('purchasing.statusReceived') : t('purchasing.statusCancelled'),
                onPress: () => handleStatusChange(item, s),
              }))),
              { text: t('common.delete'), style: 'destructive', onPress: () => handleDelete(item) },
            ],
          );
        }}
        android_ripple={{ color: theme.colors.surfaceVariant }}
        style={({ pressed }) => [
          styles.card,
          {
            backgroundColor: pressed ? theme.colors.surfaceVariant : theme.custom?.cardBackground || theme.colors.surface,
            borderColor: theme.colors.outlineVariant,
          },
        ]}
      >
        <View style={[styles.cardBar, { backgroundColor: color }]} />
        <View style={styles.cardBody}>
          <View style={[styles.cardHeader, { flexDirection }]}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="titleSmall" style={[{ color: theme.colors.onSurface, fontWeight: '700', textAlign }]} numberOfLines={1}>
                {item.supplierName || t('purchasing.noSupplier')}
              </Text>
              {item.poNumber ? (
                <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant, textAlign }}>
                  #{item.poNumber}
                </Text>
              ) : null}
            </View>
            <View style={[styles.statusBadge, { backgroundColor: withAlpha(color, 0.094) }]}>
              <MaterialCommunityIcons name={icon as any} size={13} color={color} />
              <Text variant="labelSmall" style={{ color, fontWeight: '600', fontSize: 11 }}>
                {item.status === 'draft' ? 'טיוטה' : item.status === 'ordered' ? 'הוזמן' : item.status === 'partial' ? 'חלקי' : item.status === 'received' ? 'התקבל' : item.status === 'cancelled' ? 'בוטל' : item.status}
              </Text>
            </View>
          </View>

          <Divider style={{ marginVertical: 8, backgroundColor: theme.colors.outlineVariant }} />

          <View style={[styles.cardMeta, { flexDirection }]}>
            {item.createdOn ? (
              <View style={[styles.metaRow, { flexDirection }]}>
                <MaterialCommunityIcons name="calendar-outline" size={13} color={theme.colors.onSurfaceVariant} />
                <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                  {formatDate(item.createdOn)}
                </Text>
              </View>
            ) : null}
            {item.expectedDate ? (
              <View style={[styles.metaRow, { flexDirection }]}>
                <MaterialCommunityIcons name="truck-delivery-outline" size={13} color={theme.colors.onSurfaceVariant} />
                <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                  {formatDate(item.expectedDate)}
                </Text>
              </View>
            ) : null}
            {item.total != null && item.total > 0 ? (
              <Text variant="titleSmall" style={{ color: BRAND_COLOR, fontWeight: '700' }}>
                {item.currency || '₪'}{Number(item.total).toFixed(2)}
              </Text>
            ) : null}
          </View>

          {item.notes ? (
            <Text variant="bodySmall" numberOfLines={1} style={{ color: theme.colors.onSurfaceVariant, marginTop: 4, textAlign }}>
              {item.notes}
            </Text>
          ) : null}
        </View>
      </Pressable>
    );
  }, [theme, flexDirection, textAlign, t, handleStatusChange, handleDelete]);

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
        <Appbar.Content title={t('more.purchasing') || 'רכש'} titleStyle={{ color: '#FFF', fontWeight: '700', fontSize: 18 }} />
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
            placeholder={t('purchasing.search')}
            value={searchQuery}
            onChangeText={setSearchQuery}
            style={[styles.searchbar, { backgroundColor: theme.colors.surfaceVariant }]}
            inputStyle={{ fontSize: 14, textAlign: isRTL ? 'right' : 'left' }}
            iconColor={theme.colors.onSurfaceVariant}
            autoFocus
          />
        </View>
      )}

      {/* Status filter chips */}
      <View style={[styles.filtersRow, { backgroundColor: theme.colors.surface, borderBottomColor: theme.colors.outline }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.filtersScroll, { flexDirection }]}>
          {STATUS_FILTERS.map((f) => {
            const chipColor = f === 'all' ? BRAND_COLOR : (STATUS_COLORS[f] || BRAND_COLOR);
            const isActive = statusFilter === f;
            const label = f === 'all' ? t('common.all') : f === 'draft' ? t('purchasing.statusDraft') : f === 'ordered' ? t('purchasing.statusOrdered') : f === 'partial' ? t('purchasing.statusPartial') : f === 'received' ? t('purchasing.statusReceived') : t('purchasing.statusCancelled');
            return (
              <Chip
                key={f}
                selected={isActive}
                onPress={() => setStatusFilter(f)}
                compact
                style={[styles.filterChip, isActive ? { backgroundColor: `${chipColor}20`, borderColor: chipColor, borderWidth: 1 } : { backgroundColor: theme.colors.surfaceVariant }]}
                textStyle={[{ fontSize: 12 }, isActive && { color: chipColor, fontWeight: '600' }]}
              >
                {label}
              </Chip>
            );
          })}
        </ScrollView>
      </View>

      {error ? (
        <Pressable onPress={fetchOrders} style={[styles.errorBanner, { backgroundColor: theme.colors.errorContainer }]}>
          <MaterialCommunityIcons name="alert-circle" size={18} color={theme.colors.error} />
          <Text variant="bodySmall" style={{ flex: 1, color: theme.colors.error }} numberOfLines={1}>{error}</Text>
          <Text variant="labelSmall" style={{ color: theme.colors.error, fontWeight: '600' }}>{t('common.retry')}</Text>
        </Pressable>
      ) : null}

      <FlatList
        data={filtered}
        renderItem={renderCard}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[BRAND_COLOR]} tintColor={BRAND_COLOR} />}
        contentContainerStyle={[styles.listContent, filtered.length === 0 && styles.listContentEmpty]}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          loading ? null : (
            <View style={styles.emptyContainer}>
              <MaterialCommunityIcons name="cart-arrow-down" size={72} color={theme.colors.onSurfaceVariant} style={{ opacity: 0.3 }} />
              <Text variant="titleMedium" style={{ color: theme.colors.onSurface, fontWeight: '600', marginTop: 12 }}>
                {t('purchasing.noPOs')}
              </Text>
            </View>
          )
        }
      />

      <FAB
        icon="plus"
        label={t('purchasing.newPO')}
        onPress={() => setCreateVisible(true)}
        style={[styles.fab, { backgroundColor: BRAND_COLOR, bottom: insets.bottom + 16, left: isRTL ? 16 : undefined, right: isRTL ? undefined : 16 }]}
        color="#FFF"
      />

      <Portal>
        <Modal
          visible={createVisible}
          onDismiss={() => { setCreateVisible(false); resetForm(); }}
          contentContainerStyle={[styles.modal, { backgroundColor: theme.colors.surface }]}
        >
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <View style={[styles.modalHeader, { flexDirection }]}>
                <Text variant="titleLarge" style={{ color: theme.colors.onSurface, fontWeight: '700' }}>
                  {t('purchasing.newPO')}
                </Text>
                <IconButton icon="close" size={22} onPress={() => { setCreateVisible(false); resetForm(); }} />
              </View>

              {/* ── Supplier Picker ── */}
              <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 6, textAlign }}>
                ספק <Text style={{ color: theme.colors.error }}>*</Text>
              </Text>
              {selectedSupplier ? (
                <TouchableOpacity
                  onPress={() => setSelectedSupplier(null)}
                  style={[styles.selectedSupplier, { backgroundColor: BRAND_COLOR + '12', borderColor: BRAND_COLOR + '40' }]}
                >
                  <View style={[styles.supplierAvatar, { backgroundColor: BRAND_COLOR }]}>
                    <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>
                      {(selectedSupplier.name || '?').charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text variant="bodyMedium" style={{ color: theme.colors.onSurface, fontWeight: '600' }}>
                      {selectedSupplier.name}
                    </Text>
                    {(selectedSupplier.contactPerson || selectedSupplier.phone) ? (
                      <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                        {selectedSupplier.contactPerson ? `${selectedSupplier.contactPerson}` : ''}{selectedSupplier.phone ? ` · ${selectedSupplier.phone}` : ''}
                      </Text>
                    ) : null}
                  </View>
                  <MaterialCommunityIcons name="close-circle" size={18} color={theme.colors.onSurfaceVariant} />
                </TouchableOpacity>
              ) : (
                <View style={{ marginBottom: 4, zIndex: 10 }}>
                  <TextInput
                    label="חפש ספק..."
                    value={supplierSearch}
                    onChangeText={(text) => {
                      setSupplierSearch(text);
                      setSupplierDropdownOpen(true);
                    }}
                    onFocus={() => { loadSuppliers(); setSupplierDropdownOpen(true); }}
                    mode="outlined"
                    style={[styles.input, { textAlign, marginBottom: 0 }]}
                    activeOutlineColor={BRAND_COLOR}
                    right={suppliersLoading
                      ? <TextInput.Icon icon="loading" />
                      : <TextInput.Icon icon="store-search-outline" />}
                  />
                  {supplierDropdownOpen && filteredSuppliers.length > 0 && (
                    <View style={[styles.supplierDropdown, { backgroundColor: theme.colors.surface, borderColor: theme.colors.outlineVariant }]}>
                      {filteredSuppliers.slice(0, 8).map((s, i) => (
                        <React.Fragment key={s.id || i}>
                          {i > 0 && <Divider />}
                          <TouchableOpacity
                            style={styles.supplierRow}
                            onPress={() => { setSelectedSupplier(s); setSupplierSearch(''); setSupplierDropdownOpen(false); }}
                          >
                            <View style={[styles.supplierAvatarSm, { backgroundColor: BRAND_COLOR + '20' }]}>
                              <Text style={{ color: BRAND_COLOR, fontWeight: '700', fontSize: 13 }}>
                                {(s.name || '?').charAt(0).toUpperCase()}
                              </Text>
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text variant="bodySmall" style={{ fontWeight: '600', color: theme.colors.onSurface }}>{s.name}</Text>
                              {s.phone ? <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>{s.phone}</Text> : null}
                            </View>
                          </TouchableOpacity>
                        </React.Fragment>
                      ))}
                    </View>
                  )}
                  {supplierDropdownOpen && !suppliersLoading && suppliers.length === 0 && (
                    <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, paddingHorizontal: 4, marginTop: 4 }}>
                      אין ספקים — הוסף ספקים דרך מערכת הספקים
                    </Text>
                  )}
                </View>
              )}

              <View style={{ height: 14 }} />

              <TextInput
                label={t('purchasing.expectedDate')}
                value={formExpectedDate}
                onChangeText={setFormExpectedDate}
                mode="outlined"
                placeholder="YYYY-MM-DD"
                style={[styles.input, { textAlign }]}
                activeOutlineColor={BRAND_COLOR}
                right={<TextInput.Icon icon="calendar-outline" />}
              />
              <TextInput
                label={t('purchasing.notes')}
                value={formNotes}
                onChangeText={setFormNotes}
                mode="outlined"
                multiline
                numberOfLines={3}
                style={[styles.input, { textAlign }]}
                activeOutlineColor={BRAND_COLOR}
              />

              <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 12, textAlign }}>
                {t('purchasing.addItemsAfterCreate')}
              </Text>

              <View style={[styles.modalActions, { flexDirection }]}>
                <Button mode="outlined" onPress={() => { setCreateVisible(false); resetForm(); }} style={styles.modalBtn}>
                  {t('common.cancel')}
                </Button>
                <Button
                  mode="contained"
                  onPress={handleCreate}
                  loading={creating}
                  disabled={creating || !selectedSupplier}
                  style={[styles.modalBtn, { backgroundColor: BRAND_COLOR }]}
                  textColor="#FFF"
                >
                  {t('common.create')}
                </Button>
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
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
  cardBody: { flex: 1, padding: 14, gap: 4 },
  cardHeader: { alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  statusBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12, gap: 4 },
  cardMeta: { alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  metaRow: { alignItems: 'center', gap: 4 },
  errorBanner: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  emptyContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80, paddingHorizontal: 40 },
  fab: { position: 'absolute', borderRadius: 16 },
  modal: { marginHorizontal: 20, borderRadius: 16, padding: 20, maxHeight: '90%' },
  modalHeader: { alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  input: { marginBottom: 12 },
  modalActions: { gap: 10, justifyContent: 'flex-end', marginTop: 8 },
  modalBtn: { minWidth: 100, borderRadius: 10 },
  selectedSupplier: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    padding: 10,
    marginBottom: 4,
    gap: 10,
  },
  supplierAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  supplierAvatarSm: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  supplierDropdown: {
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 2,
    marginBottom: 8,
    overflow: 'hidden',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
  },
  supplierRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10,
  },
});
