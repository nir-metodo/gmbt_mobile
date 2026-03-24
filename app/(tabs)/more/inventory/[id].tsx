import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Alert,
} from 'react-native';
import {
  Text,
  ActivityIndicator,
  Appbar,
  Divider,
  Button,
  Portal,
  Modal,
  TextInput,
  IconButton,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../../../stores/authStore';
import { useAppTheme } from '../../../../hooks/useAppTheme';
import { useRTL } from '../../../../hooks/useRTL';
import { inventoryApi, InventoryItem, StockMovement } from '../../../../services/api/inventory';
import { formatDate, withAlpha } from '../../../../utils/formatters';
import { borderRadius } from '../../../../constants/theme';

const BRAND_COLOR = '#2e6155';
const LOW_STOCK_THRESHOLD = 5;

function getStockColor(quantity: number, minQuantity?: number): string {
  if (quantity <= 0) return '#F44336';
  const min = minQuantity ?? LOW_STOCK_THRESHOLD;
  if (quantity <= min) return '#FF9800';
  return '#4CAF50';
}

export default function InventoryDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useAppTheme();
  const { flexDirection, textAlign } = useRTL();
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);

  const [item, setItem] = useState<InventoryItem | null>(null);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [movementsLoading, setMovementsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [adjustModalVisible, setAdjustModalVisible] = useState(false);
  const [adjustQty, setAdjustQty] = useState('');
  const [adjustNote, setAdjustNote] = useState('');
  const [adjusting, setAdjusting] = useState(false);

  const fetchItem = useCallback(async () => {
    if (!user?.organization || !id) { setLoading(false); return; }
    try {
      setError(null);
      const data = await inventoryApi.getById(user.organization, id);
      setItem(data);
    } catch (err: any) {
      setError(err.message || t('errors.generic'));
    } finally {
      setLoading(false);
    }
  }, [user?.organization, id, t]);

  const fetchMovements = useCallback(async () => {
    if (!user?.organization || !id) return;
    setMovementsLoading(true);
    try {
      const data = await inventoryApi.getMovements(user.organization, id);
      setMovements(data);
    } catch {
      // non-critical
    } finally {
      setMovementsLoading(false);
    }
  }, [user?.organization, id]);

  useEffect(() => {
    fetchItem();
    fetchMovements();
  }, [fetchItem, fetchMovements]);

  const handleAdjust = useCallback(async () => {
    if (!user?.organization || !id || !adjustQty.trim()) return;
    const qty = parseInt(adjustQty, 10);
    if (isNaN(qty)) return;

    setAdjusting(true);
    try {
      await inventoryApi.adjustStock(user.organization, id, qty, adjustNote.trim() || undefined, user.uID || user.userId);
      setAdjustModalVisible(false);
      setAdjustQty('');
      setAdjustNote('');
      await fetchItem();
      await fetchMovements();
    } catch (err: any) {
      Alert.alert(t('common.error'), err.message || t('errors.generic'));
    } finally {
      setAdjusting(false);
    }
  }, [user?.organization, id, adjustQty, adjustNote, user?.uID, user?.userId, fetchItem, fetchMovements, t]);

  if (loading) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator size="large" color={BRAND_COLOR} />
      </View>
    );
  }

  const stockColor = item ? getStockColor(item.quantity, item.minQuantity) : '#9E9E9E';

  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
      <Appbar.Header style={{ backgroundColor: BRAND_COLOR }} mode="center-aligned">
        <Appbar.BackAction onPress={() => router.back()} color="#FFF" />
        <Appbar.Content
          title={item?.productName || t('inventory.item')}
          titleStyle={{ color: '#FFF', fontWeight: '700', fontSize: 17 }}
          subtitle={item?.sku ? `SKU: ${item.sku}` : undefined}
          subtitleStyle={{ color: 'rgba(255,255,255,0.75)', fontSize: 12 }}
        />
      </Appbar.Header>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {item ? (
          <>
            {/* Stock Level Card */}
            <View style={[styles.stockCard, { backgroundColor: `${stockColor}12`, borderColor: `${stockColor}30` }]}>
              <View style={{ alignItems: 'center', gap: 4 }}>
                <MaterialCommunityIcons name="package-variant" size={36} color={stockColor} />
                <Text style={[styles.stockNumber, { color: stockColor }]}>{item.quantity}</Text>
                <Text variant="bodyMedium" style={{ color: stockColor, fontWeight: '600' }}>
                  {item.quantity <= 0
                    ? t('inventory.outOfStock')
                    : item.quantity <= (item.minQuantity ?? LOW_STOCK_THRESHOLD)
                    ? t('inventory.lowStock')
                    : t('inventory.inStock')}
                </Text>
              </View>

              {item.minQuantity != null ? (
                <View style={styles.stockLimits}>
                  <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                    {t('inventory.minStock')}: {item.minQuantity}
                  </Text>
                  {item.maxQuantity != null ? (
                    <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                      {t('inventory.maxStock')}: {item.maxQuantity}
                    </Text>
                  ) : null}
                </View>
              ) : null}
            </View>

            {/* Adjust Stock Button */}
            <Pressable
              onPress={() => setAdjustModalVisible(true)}
              style={[styles.adjustButton, { backgroundColor: BRAND_COLOR }]}
            >
              <MaterialCommunityIcons name="plus-minus" size={20} color="#fff" />
              <Text variant="bodyMedium" style={{ color: '#fff', fontWeight: '700' }}>
                {t('inventory.adjustStock')}
              </Text>
            </Pressable>

            {/* Product Details */}
            <View style={[styles.section, { backgroundColor: theme.colors.surface }]}>
              <Text variant="titleSmall" style={[styles.sectionTitle, { color: theme.colors.onSurface }]}>
                {t('inventory.details')}
              </Text>
              <Divider style={{ marginBottom: 12 }} />

              {[
                { icon: 'tag-outline', label: t('inventory.productName'), value: item.productName },
                item.sku ? { icon: 'barcode-scan', label: 'SKU', value: item.sku } : null,
                item.category ? { icon: 'shape-outline', label: t('inventory.category'), value: item.category } : null,
                item.location ? { icon: 'map-marker-outline', label: t('inventory.location'), value: item.location } : null,
                item.price != null ? { icon: 'cash-multiple', label: t('inventory.price'), value: `${item.currency || '₪'}${Number(item.price).toFixed(2)}` } : null,
                item.cost != null ? { icon: 'cash-minus', label: t('inventory.cost'), value: `${item.currency || '₪'}${Number(item.cost).toFixed(2)}` } : null,
                item.lastUpdated ? { icon: 'update', label: t('inventory.lastUpdated'), value: formatDate(item.lastUpdated) } : null,
              ].filter(Boolean).map((row: any, idx) => (
                <View key={idx} style={[styles.infoRow, { flexDirection }]}>
                  <View style={[styles.infoLabel, { flexDirection, alignItems: 'center', gap: 6 }]}>
                    <MaterialCommunityIcons name={row.icon} size={15} color={theme.colors.onSurfaceVariant} />
                    <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant }}>{row.label}</Text>
                  </View>
                  <Text variant="bodyMedium" style={[styles.infoValue, { color: theme.colors.onSurface, textAlign }]}>
                    {row.value}
                  </Text>
                </View>
              ))}

              {item.description ? (
                <>
                  <Divider style={{ marginVertical: 10 }} />
                  <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 6 }}>
                    {t('inventory.description')}
                  </Text>
                  <Text variant="bodyMedium" style={{ color: theme.colors.onSurface, lineHeight: 22 }}>
                    {item.description}
                  </Text>
                </>
              ) : null}
            </View>

            {/* Stock Movements */}
            <View style={[styles.section, { backgroundColor: theme.colors.surface }]}>
              <Text variant="titleSmall" style={[styles.sectionTitle, { color: theme.colors.onSurface }]}>
                {t('inventory.movements')}
              </Text>
              <Divider style={{ marginBottom: 12 }} />

              {movementsLoading ? (
                <ActivityIndicator size="small" color={BRAND_COLOR} style={{ marginVertical: 16 }} />
              ) : movements.length === 0 ? (
                <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center', paddingVertical: 16 }}>
                  {t('inventory.noMovements')}
                </Text>
              ) : (
                movements.slice(0, 20).map((mv, idx) => {
                  const isPositive = mv.quantity > 0;
                  const color = isPositive ? '#4CAF50' : '#F44336';
                  return (
                    <View key={mv.id || idx} style={[styles.movementRow, { borderBottomColor: theme.colors.outlineVariant }]}>
                      <View style={[styles.movementIcon, { backgroundColor: withAlpha(color, 0.082) }]}>
                        <MaterialCommunityIcons
                          name={isPositive ? 'arrow-up' : 'arrow-down'}
                          size={16}
                          color={color}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text variant="bodySmall" style={{ color: theme.colors.onSurface, fontWeight: '600' }}>
                          {mv.type || (isPositive ? t('inventory.stockIn') : t('inventory.stockOut'))}
                        </Text>
                        {mv.note ? (
                          <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }} numberOfLines={1}>
                            {mv.note}
                          </Text>
                        ) : null}
                        {mv.createdAt ? (
                          <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                            {formatDate(mv.createdAt)}
                          </Text>
                        ) : null}
                      </View>
                      <Text variant="titleSmall" style={{ color, fontWeight: '700' }}>
                        {isPositive ? '+' : ''}{mv.quantity}
                      </Text>
                    </View>
                  );
                })
              )}
            </View>
          </>
        ) : (
          <View style={styles.centered}>
            <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>{error || t('inventory.notFound')}</Text>
            <Button onPress={fetchItem} textColor={BRAND_COLOR}>{t('common.retry')}</Button>
          </View>
        )}
      </ScrollView>

      {/* Adjust Stock Modal */}
      <Portal>
        <Modal
          visible={adjustModalVisible}
          onDismiss={() => { setAdjustModalVisible(false); setAdjustQty(''); setAdjustNote(''); }}
          contentContainerStyle={[styles.modal, { backgroundColor: theme.colors.surface }]}
        >
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={[styles.modalHeader, { flexDirection }]}>
              <Text variant="titleMedium" style={{ color: theme.colors.onSurface, fontWeight: '700' }}>
                {t('inventory.adjustStock')}
              </Text>
              <IconButton icon="close" size={20} onPress={() => { setAdjustModalVisible(false); setAdjustQty(''); setAdjustNote(''); }} />
            </View>

            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 16 }}>
              {t('inventory.adjustHint')}
            </Text>

            <TextInput
              mode="outlined"
              label={t('inventory.quantityChange')}
              value={adjustQty}
              onChangeText={setAdjustQty}
              keyboardType="numbers-and-punctuation"
              style={styles.formInput}
              outlineColor={theme.colors.outline}
              activeOutlineColor={BRAND_COLOR}
              placeholder="+10 / -5"
              autoFocus
            />

            <TextInput
              mode="outlined"
              label={t('inventory.reason')}
              value={adjustNote}
              onChangeText={setAdjustNote}
              style={styles.formInput}
              outlineColor={theme.colors.outline}
              activeOutlineColor={BRAND_COLOR}
              placeholder={t('inventory.reasonPlaceholder')}
            />

            <View style={[styles.modalActions, { flexDirection }]}>
              <Button mode="outlined" onPress={() => { setAdjustModalVisible(false); setAdjustQty(''); setAdjustNote(''); }} style={styles.modalBtn} textColor={theme.colors.onSurface}>
                {t('common.cancel')}
              </Button>
              <Button
                mode="contained"
                onPress={handleAdjust}
                loading={adjusting}
                disabled={!adjustQty.trim() || adjusting}
                style={[styles.modalBtn, { backgroundColor: BRAND_COLOR }]}
                textColor="#fff"
              >
                {t('common.save')}
              </Button>
            </View>
          </KeyboardAvoidingView>
        </Modal>
      </Portal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  scrollContent: { padding: 16, gap: 12, paddingBottom: 40 },
  stockCard: {
    borderRadius: borderRadius.xl,
    borderWidth: 1.5,
    padding: 20,
    alignItems: 'center',
    gap: 12,
  },
  stockNumber: { fontSize: 48, fontWeight: '800', lineHeight: 54 },
  stockLimits: { flexDirection: 'row', gap: 16, marginTop: 4 },
  adjustButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 14,
    borderRadius: borderRadius.lg,
  },
  section: {
    borderRadius: borderRadius.lg,
    padding: 16,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
  },
  sectionTitle: { fontWeight: '700', marginBottom: 8 },
  infoRow: {
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 10,
    gap: 8,
  },
  infoLabel: { minWidth: 120 },
  infoValue: { flex: 1 },
  movementRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  movementIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modal: {
    marginHorizontal: 20,
    borderRadius: borderRadius.xl,
    padding: 20,
  },
  modalHeader: {
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  formInput: { marginBottom: 14 },
  modalActions: { gap: 12, justifyContent: 'flex-end', marginTop: 4 },
  modalBtn: { minWidth: 100, borderRadius: borderRadius.md },
});
