import React, { useState, useCallback, useEffect, useMemo } from 'react';
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
} from 'react-native';
import {
  Text,
  Searchbar,
  ActivityIndicator,
  Appbar,
  Chip,
  FAB,
  Portal,
  Modal,
  TextInput,
  Button,
  IconButton,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../../../stores/authStore';
import { useAppTheme } from '../../../../hooks/useAppTheme';
import { useRTL } from '../../../../hooks/useRTL';
import { inventoryApi, InventoryItem } from '../../../../services/api/inventory';
import { borderRadius } from '../../../../constants/theme';
import { appCache } from '../../../../services/cache';

const BRAND_COLOR = '#2e6155';
const LOW_STOCK_THRESHOLD = 5;

function getStockColor(item: InventoryItem): string {
  if (item.quantity <= 0) return '#F44336';
  const min = item.minQuantity ?? LOW_STOCK_THRESHOLD;
  if (item.quantity <= min) return '#FF9800';
  return '#4CAF50';
}

function getStockLabel(item: InventoryItem, t: any): string {
  if (item.quantity <= 0) return t('inventory.outOfStock');
  const min = item.minQuantity ?? LOW_STOCK_THRESHOLD;
  if (item.quantity <= min) return t('inventory.lowStock');
  return t('inventory.inStock');
}

export default function InventoryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useAppTheme();
  const { isRTL, flexDirection, textAlign } = useRTL();
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);

  const CACHE_KEY = `inventory_${user?.organization}`;

  const [items, setItems] = useState<InventoryItem[]>(() => appCache.get<InventoryItem[]>(CACHE_KEY) ?? []);
  const [loading, setLoading] = useState(!appCache.get<InventoryItem[]>(CACHE_KEY));
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchVisible, setSearchVisible] = useState(false);
  const [stockFilter, setStockFilter] = useState<'all' | 'low' | 'out'>('all');

  // Create modal
  const [createVisible, setCreateVisible] = useState(false);
  const [creating, setCreating] = useState(false);
  const [formName, setFormName] = useState('');
  const [formSku, setFormSku] = useState('');
  const [formQty, setFormQty] = useState('0');
  const [formPrice, setFormPrice] = useState('');
  const [formCategory, setFormCategory] = useState('');
  const [formMinQty, setFormMinQty] = useState('5');

  const fetchInventory = useCallback(async () => {
    if (!user?.organization) { setLoading(false); return; }
    try {
      setError(null);
      const data = await inventoryApi.getAll(user.organization);
      appCache.set(CACHE_KEY, data);
      setItems(data);
    } catch (err: any) {
      setError(err.message || t('errors.generic'));
    } finally {
      setLoading(false);
    }
  }, [user?.organization, t, CACHE_KEY]);

  useEffect(() => {
    fetchInventory();
  }, [fetchInventory]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchInventory();
    setRefreshing(false);
  }, [fetchInventory]);

  const resetForm = () => {
    setFormName(''); setFormSku(''); setFormQty('0');
    setFormPrice(''); setFormCategory(''); setFormMinQty('5');
  };

  const handleCreate = useCallback(async () => {
    if (!user?.organization || !formName.trim() || !formSku.trim()) return;
    setCreating(true);
    try {
      await inventoryApi.createItem(user.organization, {
        productName: formName.trim(),
        sku: formSku.trim(),
        quantity: parseInt(formQty) || 0,
        price: parseFloat(formPrice) || undefined,
        category: formCategory.trim() || undefined,
        minQuantity: parseInt(formMinQty) || 5,
      });
      setCreateVisible(false);
      resetForm();
      appCache.invalidate(CACHE_KEY);
      await fetchInventory();
    } catch (err: any) {
      Alert.alert(t('common.error'), err.message || t('errors.generic'));
    } finally {
      setCreating(false);
    }
  }, [user?.organization, formName, formSku, formQty, formPrice, formCategory, formMinQty, fetchInventory, CACHE_KEY, t]);

  const filteredItems = useMemo(() => {
    let result = Array.isArray(items) ? items : [];

    if (stockFilter === 'out') {
      result = result.filter((i) => i.quantity <= 0);
    } else if (stockFilter === 'low') {
      result = result.filter((i) => i.quantity > 0 && i.quantity <= (i.minQuantity ?? LOW_STOCK_THRESHOLD));
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (i) =>
          i.productName?.toLowerCase().includes(q) ||
          i.sku?.toLowerCase().includes(q) ||
          i.category?.toLowerCase().includes(q),
      );
    }

    return result.sort((a, b) => a.productName.localeCompare(b.productName));
  }, [items, stockFilter, searchQuery]);

  const renderItem = useCallback(
    ({ item }: { item: InventoryItem }) => {
      const stockColor = getStockColor(item);
      const stockLabel = getStockLabel(item, t);

      return (
        <Pressable
          onPress={() => router.push({ pathname: '/(tabs)/more/inventory/[id]', params: { id: item.id } })}
          android_ripple={{ color: theme.colors.surfaceVariant }}
          style={({ pressed }) => [
            styles.card,
            {
              backgroundColor: pressed ? theme.colors.surfaceVariant : theme.custom?.cardBackground || theme.colors.surface,
              borderColor: theme.colors.outlineVariant,
            },
          ]}
        >
          <View style={[styles.cardContent, { flexDirection }]}>
            {/* Stock quantity circle */}
            <View style={[styles.quantityCircle, { backgroundColor: `${stockColor}15`, borderColor: `${stockColor}40`, borderWidth: 2 }]}>
              <Text style={[styles.quantityText, { color: stockColor }]}>{item.quantity}</Text>
              <Text style={[styles.quantityUnit, { color: stockColor }]}>{t('inventory.units')}</Text>
            </View>

            <View style={{ flex: 1, gap: 4 }}>
              <Text variant="titleSmall" style={[styles.productName, { color: theme.colors.onSurface, textAlign }]} numberOfLines={2}>
                {item.productName}
              </Text>

              <View style={[styles.metaRow, { flexDirection }]}>
                {item.sku ? (
                  <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                    SKU: {item.sku}
                  </Text>
                ) : null}
                {item.category ? (
                  <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                    • {item.category}
                  </Text>
                ) : null}
              </View>

              <View style={[styles.bottomRow, { flexDirection }]}>
                <Chip
                  compact
                  style={[styles.stockChip, { backgroundColor: `${stockColor}15` }]}
                  textStyle={{ color: stockColor, fontSize: 11, fontWeight: '600' }}
                >
                  {stockLabel}
                </Chip>

                {item.price != null ? (
                  <Text variant="titleSmall" style={{ color: BRAND_COLOR, fontWeight: '700' }}>
                    {item.currency || '₪'}{Number(item.price).toFixed(2)}
                  </Text>
                ) : null}
              </View>
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
        <MaterialCommunityIcons name="package-variant-closed" size={72} color={theme.colors.onSurfaceVariant} style={{ opacity: 0.3 }} />
        <Text variant="titleMedium" style={[styles.emptyTitle, { color: theme.colors.onSurface }]}>
          {t('inventory.noItems')}
        </Text>
      </View>
    );
  }, [loading, theme, t]);

  if (loading && items.length === 0) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator size="large" color={BRAND_COLOR} />
      </View>
    );
  }

  const lowStockCount = items.filter((i) => i.quantity > 0 && i.quantity <= (i.minQuantity ?? LOW_STOCK_THRESHOLD)).length;
  const outOfStockCount = items.filter((i) => i.quantity <= 0).length;

  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
      <Appbar.Header style={{ backgroundColor: BRAND_COLOR }} mode="center-aligned">
        <Appbar.BackAction onPress={() => router.back()} color="#FFF" />
        <Appbar.Content title={t('inventory.title')} titleStyle={{ color: '#FFF', fontWeight: '700', fontSize: 18 }} />
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
            placeholder={t('inventory.searchPlaceholder')}
            value={searchQuery}
            onChangeText={setSearchQuery}
            style={[styles.searchbar, { backgroundColor: theme.colors.surfaceVariant }]}
            inputStyle={{ fontSize: 14, textAlign: isRTL ? 'right' : 'left' }}
            iconColor={theme.colors.onSurfaceVariant}
            autoFocus
          />
        </View>
      )}

      {/* Summary banner */}
      {(lowStockCount > 0 || outOfStockCount > 0) && !searchVisible && (
        <View style={[styles.alertBanner, { flexDirection, backgroundColor: theme.colors.surface, borderBottomColor: theme.colors.outlineVariant }]}>
          {outOfStockCount > 0 ? (
            <Pressable onPress={() => setStockFilter('out')} style={[styles.alertItem, { backgroundColor: '#F4433618' }]}>
              <MaterialCommunityIcons name="alert-circle" size={16} color="#F44336" />
              <Text variant="labelSmall" style={{ color: '#F44336', fontWeight: '700' }}>
                {outOfStockCount} {t('inventory.outOfStock')}
              </Text>
            </Pressable>
          ) : null}
          {lowStockCount > 0 ? (
            <Pressable onPress={() => setStockFilter('low')} style={[styles.alertItem, { backgroundColor: '#FF980018' }]}>
              <MaterialCommunityIcons name="alert" size={16} color="#FF9800" />
              <Text variant="labelSmall" style={{ color: '#FF9800', fontWeight: '700' }}>
                {lowStockCount} {t('inventory.lowStock')}
              </Text>
            </Pressable>
          ) : null}
          {stockFilter !== 'all' && (
            <Pressable onPress={() => setStockFilter('all')} style={[styles.alertItem, { backgroundColor: theme.colors.surfaceVariant }]}>
              <MaterialCommunityIcons name="close" size={14} color={theme.colors.onSurfaceVariant} />
              <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>{t('common.all')}</Text>
            </Pressable>
          )}
        </View>
      )}

      {error ? (
        <Pressable onPress={fetchInventory} style={[styles.errorBanner, { backgroundColor: theme.colors.errorContainer }]}>
          <MaterialCommunityIcons name="alert-circle" size={18} color={theme.colors.error} />
          <Text variant="bodySmall" style={[styles.errorText, { color: theme.colors.error }]} numberOfLines={1}>{error}</Text>
          <Text variant="labelSmall" style={{ color: theme.colors.error, fontWeight: '600' }}>{t('common.retry')}</Text>
        </Pressable>
      ) : null}

      <FlatList
        data={filteredItems}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={renderEmpty}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[BRAND_COLOR]} tintColor={BRAND_COLOR} />}
        contentContainerStyle={[styles.listContent, filteredItems.length === 0 && styles.listContentEmpty]}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        showsVerticalScrollIndicator={false}
      />

      <FAB
        icon="plus"
        label={t('inventory.addItem')}
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
            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={[styles.modalHeader, { flexDirection }]}>
                <Text variant="titleLarge" style={{ color: theme.colors.onSurface, fontWeight: '700' }}>
                  {t('inventory.addItem')}
                </Text>
                <IconButton icon="close" size={22} onPress={() => { setCreateVisible(false); resetForm(); }} />
              </View>

              <TextInput
                label={`${t('inventory.productName')} *`}
                value={formName}
                onChangeText={setFormName}
                mode="outlined"
                style={[styles.input, { textAlign }]}
                activeOutlineColor={BRAND_COLOR}
              />
              <TextInput
                label={`SKU *`}
                value={formSku}
                onChangeText={setFormSku}
                mode="outlined"
                autoCapitalize="characters"
                style={[styles.input, { textAlign }]}
                activeOutlineColor={BRAND_COLOR}
              />
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <TextInput
                  label={t('inventory.quantity')}
                  value={formQty}
                  onChangeText={setFormQty}
                  keyboardType="numeric"
                  mode="outlined"
                  style={[styles.input, { flex: 1, textAlign }]}
                  activeOutlineColor={BRAND_COLOR}
                />
                <TextInput
                  label={t('inventory.minQuantity')}
                  value={formMinQty}
                  onChangeText={setFormMinQty}
                  keyboardType="numeric"
                  mode="outlined"
                  style={[styles.input, { flex: 1, textAlign }]}
                  activeOutlineColor={BRAND_COLOR}
                />
              </View>
              <TextInput
                label={t('inventory.price')}
                value={formPrice}
                onChangeText={setFormPrice}
                keyboardType="decimal-pad"
                mode="outlined"
                style={[styles.input, { textAlign }]}
                activeOutlineColor={BRAND_COLOR}
                left={<TextInput.Affix text="₪" />}
              />
              <TextInput
                label={t('inventory.category')}
                value={formCategory}
                onChangeText={setFormCategory}
                mode="outlined"
                style={[styles.input, { textAlign }]}
                activeOutlineColor={BRAND_COLOR}
              />

              <View style={[styles.modalActions, { flexDirection }]}>
                <Button mode="outlined" onPress={() => { setCreateVisible(false); resetForm(); }} style={styles.modalBtn}>
                  {t('common.cancel')}
                </Button>
                <Button
                  mode="contained"
                  onPress={handleCreate}
                  loading={creating}
                  disabled={!formName.trim() || !formSku.trim() || creating}
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
  alertBanner: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexWrap: 'wrap',
  },
  alertItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
  },
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
  cardContent: {
    padding: 14,
    gap: 14,
    alignItems: 'center',
  },
  quantityCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quantityText: { fontSize: 18, fontWeight: '800', lineHeight: 22 },
  quantityUnit: { fontSize: 10, fontWeight: '600', opacity: 0.8 },
  productName: { fontWeight: '600', fontSize: 15 },
  metaRow: { gap: 4, flexWrap: 'wrap' },
  bottomRow: {
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  stockChip: { height: 24 },
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
  modal: { marginHorizontal: 20, borderRadius: 16, padding: 20, maxHeight: '90%' },
  modalHeader: { alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  input: { marginBottom: 12 },
  modalActions: { gap: 10, justifyContent: 'flex-end', marginTop: 8 },
  modalBtn: { minWidth: 100, borderRadius: 10 },
});
