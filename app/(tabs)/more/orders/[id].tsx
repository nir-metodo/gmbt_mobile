import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Alert,
  TouchableOpacity,
} from 'react-native';
import {
  Text,
  ActivityIndicator,
  Appbar,
  Divider,
  Chip,
  Portal,
  Modal,
  TextInput,
  Button,
  IconButton,
  Menu,
  Switch,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../../../stores/authStore';
import { useAppTheme } from '../../../../hooks/useAppTheme';
import { useRTL } from '../../../../hooks/useRTL';
import { ordersApi, Order } from '../../../../services/api/orders';
import { contactsApi } from '../../../../services/api/contacts';
import { quotesApi } from '../../../../services/api/quotes';
import { formatDate } from '../../../../utils/formatters';
import { borderRadius } from '../../../../constants/theme';
import {
  DynamicFieldsSectionView,
  DynamicFieldsSectionForm,
  type DynamicSection,
} from '../../../../components/DynamicFieldsSection';
import type { Contact } from '../../../../types';
import { appCache } from '../../../../services/cache';

const BRAND_COLOR = '#2e6155';

const ORDER_STATUSES = ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'];

const STATUS_COLORS: Record<string, string> = {
  pending: '#FF9800',
  confirmed: '#2196F3',
  processing: '#9C27B0',
  shipped: '#00BCD4',
  delivered: '#4CAF50',
  cancelled: '#9E9E9E',
  refunded: '#F44336',
};

interface FormItem {
  name: string;
  sku: string;
  quantity: number;
  price: number;
}

const emptyItem = (): FormItem => ({ name: '', sku: '', quantity: 1, price: 0 });

function calcTotals(items: FormItem[], discount = 0, taxPct = 0) {
  const subtotal = items.reduce((s, i) => s + (i.price || 0) * (i.quantity || 0), 0);
  const afterDiscount = Math.max(0, subtotal - (discount || 0));
  const taxAmount = afterDiscount * ((taxPct || 0) / 100);
  const total = afterDiscount + taxAmount;
  return { subtotal, total };
}

interface InfoRowProps {
  icon: string;
  label: string;
  value: string;
  flexDirection: any;
  textAlign: any;
  theme: any;
}

function InfoRow({ icon, label, value, flexDirection, textAlign, theme }: InfoRowProps) {
  return (
    <View style={[styles.infoRow, { flexDirection }]}>
      <View style={[styles.infoLabel, { flexDirection, alignItems: 'center', gap: 6 }]}>
        <MaterialCommunityIcons name={icon as any} size={16} color={theme.colors.onSurfaceVariant} />
        <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant }}>{label}</Text>
      </View>
      <Text variant="bodyMedium" style={[styles.infoValue, { color: theme.colors.onSurface, textAlign }]}>
        {value}
      </Text>
    </View>
  );
}

export default function OrderDetailScreen() {
  const router = useRouter();
  const { id, prefillContactName, prefillContactPhone, prefillContactEmail } =
    useLocalSearchParams<{
      id: string;
      prefillContactName?: string;
      prefillContactPhone?: string;
      prefillContactEmail?: string;
    }>();
  const theme = useAppTheme();
  const { flexDirection, textAlign, isRTL } = useRTL();
  const { t, i18n } = useTranslation();
  const lang = i18n.language as 'en' | 'he';
  const user = useAuthStore((s) => s.user);

  const isNew = id === 'new';

  // ── View mode state ───────────────────────────────────────────────
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [error, setError] = useState<string | null>(null);
  const [orderFormSections, setOrderFormSections] = useState<DynamicSection[]>([]);
  const [orderFormLayout, setOrderFormLayout] = useState<string[]>([]);
  const [noteModalVisible, setNoteModalVisible] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [statusMenuVisible, setStatusMenuVisible] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);

  // ── Create mode state ─────────────────────────────────────────────
  const [formCustomerName, setFormCustomerName] = useState(prefillContactName || '');
  const [formCustomerPhone, setFormCustomerPhone] = useState(prefillContactPhone || '');
  const [formCustomerEmail, setFormCustomerEmail] = useState(prefillContactEmail || '');
  const [formShippingAddress, setFormShippingAddress] = useState('');
  const [formOrderNumber, setFormOrderNumber] = useState('');
  const [formStatus, setFormStatus] = useState('pending');
  const [formPaymentMethod, setFormPaymentMethod] = useState('');
  const [formIsPaid, setFormIsPaid] = useState(false);
  const [formItems, setFormItems] = useState<FormItem[]>([]);
  const [formDiscount, setFormDiscount] = useState('0');
  const [formTax, setFormTax] = useState('18');
  const [formNotes, setFormNotes] = useState('');
  const [dynamicData, setDynamicData] = useState<Record<string, any>>({});
  const [creating, setCreating] = useState(false);

  // Contact search
  const [contactSearch, setContactSearch] = useState('');
  const [contactResults, setContactResults] = useState<Contact[]>([]);
  const [contactSearching, setContactSearching] = useState(false);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const contactDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Catalog picker (from quote branding)
  const [inventoryVisible, setInventoryVisible] = useState(false);
  const [inventoryItems, setInventoryItems] = useState<any[]>([]);
  const [inventorySearch, setInventorySearch] = useState('');
  const [inventoryLoading, setInventoryLoading] = useState(false);

  // Status menu in create mode
  const [createStatusMenuVisible, setCreateStatusMenuVisible] = useState(false);

  const totals = useMemo(
    () => calcTotals(formItems, parseFloat(formDiscount) || 0, parseFloat(formTax) || 0),
    [formItems, formDiscount, formTax],
  );

  // ── Fetch (view mode) ─────────────────────────────────────────────
  const fetchOrder = useCallback(async () => {
    if (!user?.organization || !id || isNew) { setLoading(false); return; }
    try {
      setError(null);
      const data = await ordersApi.getById(user.organization, id);
      setOrder(data);
    } catch (err: any) {
      setError(err.message || t('errors.generic'));
    } finally {
      setLoading(false);
    }
  }, [user?.organization, id, isNew, t]);

  useEffect(() => {
    fetchOrder();
  }, [fetchOrder]);

  useEffect(() => {
    if (user?.organization) {
      ordersApi.getOrderFormSettings(user.organization)
        .then((res) => {
          setOrderFormSections(res.sections || []);
          setOrderFormLayout(res.formLayout || []);
        })
        .catch(() => {});
    }
  }, [user?.organization]);

  // ── Contact search ────────────────────────────────────────────────
  const handleContactSearch = useCallback((text: string) => {
    setContactSearch(text);
    setSelectedContact(null);
    if (contactDebounceRef.current) clearTimeout(contactDebounceRef.current);
    if (!text.trim() || text.length < 2) { setContactResults([]); return; }
    setContactSearching(true);
    contactDebounceRef.current = setTimeout(async () => {
      try {
        const results = await contactsApi.search(user?.organization || '', text, 20);
        setContactResults(results);
      } catch { setContactResults([]); }
      finally { setContactSearching(false); }
    }, 350);
  }, [user?.organization]);

  const handleSelectContact = useCallback((contact: Contact) => {
    setSelectedContact(contact);
    setContactSearch('');
    setContactResults([]);
    setFormCustomerName(contact.fullName || contact.name || '');
    setFormCustomerPhone(contact.phoneNumber || contact.phone || '');
    setFormCustomerEmail(contact.email || '');
  }, []);

  // ── Catalog picker (from quote branding) ─────────────────────────
  const openInventoryPicker = useCallback(async () => {
    setInventoryVisible(true);
    if (inventoryItems.length === 0) {
      setInventoryLoading(true);
      try {
        const branding = await quotesApi.getBranding(user?.organization || '');
        setInventoryItems(Array.isArray(branding?.catalogItems) ? branding.catalogItems : []);
      } catch { setInventoryItems([]); }
      finally { setInventoryLoading(false); }
    }
  }, [user?.organization, inventoryItems.length]);

  const filteredInventory = useMemo(() => {
    if (!inventorySearch.trim()) return inventoryItems;
    const q = inventorySearch.toLowerCase();
    return inventoryItems.filter(
      (p) => (p.name || p.description || '').toLowerCase().includes(q),
    );
  }, [inventoryItems, inventorySearch]);

  const addFromInventory = useCallback((item: any) => {
    setFormItems((prev) => [
      ...prev,
      {
        name: item.name || item.description || '',
        sku: '',
        quantity: 1,
        price: parseFloat(item.unitPrice) || parseFloat(item.price) || 0,
      },
    ]);
    setInventoryVisible(false);
    setInventorySearch('');
  }, []);

  // ── Items management ──────────────────────────────────────────────
  const addItem = () => setFormItems((prev) => [...prev, emptyItem()]);
  const removeItem = (idx: number) => setFormItems((prev) => prev.filter((_, i) => i !== idx));
  const updateItem = (idx: number, field: keyof FormItem, value: string | number) =>
    setFormItems((prev) => prev.map((it, i) => (i === idx ? { ...it, [field]: value } : it)));

  // ── Status update (view mode) ─────────────────────────────────────
  const handleUpdateStatus = useCallback(async (newStatus: string) => {
    if (!user?.organization || !id) return;
    setStatusMenuVisible(false);
    setUpdatingStatus(true);
    try {
      await ordersApi.updateStatus(user.organization, id, newStatus);
      setOrder((prev) => prev ? { ...prev, status: newStatus } : prev);
    } catch (err: any) {
      Alert.alert(t('common.error'), err.message || t('errors.generic'));
    } finally {
      setUpdatingStatus(false);
    }
  }, [user?.organization, id, t]);

  // ── Save note (view mode) ─────────────────────────────────────────
  const handleSaveNote = useCallback(async () => {
    if (!user?.organization || !id || !noteText.trim()) return;
    setSavingNote(true);
    try {
      await ordersApi.addNote(user.organization, id, noteText.trim(), user.uID || user.userId);
      setNoteModalVisible(false);
      setNoteText('');
      await fetchOrder();
    } catch (err: any) {
      Alert.alert(t('common.error'), err.message || t('errors.generic'));
    } finally {
      setSavingNote(false);
    }
  }, [user?.organization, id, noteText, user?.uID, user?.userId, fetchOrder, t]);

  // ── Create order ──────────────────────────────────────────────────
  const handleCreate = useCallback(async () => {
    if (!user?.organization) return;
    if (!formCustomerName.trim() && !formCustomerPhone.trim()) {
      Alert.alert(t('common.error'), 'יש להזין שם לקוח או טלפון');
      return;
    }
    setCreating(true);
    try {
      const result = await ordersApi.create(
        user.organization,
        {
          customerName: formCustomerName.trim(),
          customerPhone: formCustomerPhone.trim(),
          customerEmail: formCustomerEmail.trim(),
          contactId: selectedContact?.id || selectedContact?.contactId || undefined,
          shippingAddress: formShippingAddress.trim(),
          status: formStatus,
          paymentMethod: formPaymentMethod.trim(),
          isPaid: formIsPaid,
          orderNumber: formOrderNumber.trim(),
          notes: formNotes.trim(),
          items: formItems.map((it) => ({
            productName: it.name,
            sku: it.sku,
            quantity: it.quantity,
            price: it.price,
          })) as any,
          currency: 'ILS',
          subtotal: totals.subtotal,
          discount: parseFloat(formDiscount) || 0,
          tax: parseFloat(formTax) || 0,
          totalAmount: totals.total,
          dynamicData,
        } as any,
        user.uID || user.userId,
        user.fullname,
      );
      const newId = result?.order?.id || result?.id || result?.orderId;
      appCache.invalidate(`orders_${user.organization}`);
      if (newId) {
        router.replace({ pathname: '/(tabs)/more/orders/[id]', params: { id: newId } });
      } else {
        router.back();
      }
    } catch (err: any) {
      Alert.alert(t('common.error'), err.message || t('errors.generic'));
    } finally {
      setCreating(false);
    }
  }, [
    user, formCustomerName, formCustomerPhone, formCustomerEmail, formShippingAddress,
    formStatus, formPaymentMethod, formIsPaid, formOrderNumber, formNotes,
    formItems, formDiscount, formTax, totals, router, t, dynamicData, selectedContact,
  ]);

  // ══ Loading / Error screens ═══════════════════════════════════════
  if (loading) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator size="large" color={BRAND_COLOR} />
      </View>
    );
  }

  if (error && !order) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.colors.background }]}>
        <Appbar.Header style={{ backgroundColor: BRAND_COLOR, width: '100%', position: 'absolute', top: 0 }} mode="center-aligned">
          <Appbar.BackAction onPress={() => router.back()} color="#FFF" />
          <Appbar.Content title={t('orders.title')} titleStyle={{ color: '#FFF', fontWeight: '700' }} />
        </Appbar.Header>
        <MaterialCommunityIcons name="alert-circle-outline" size={48} color={theme.colors.error} style={{ opacity: 0.7 }} />
        <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant, marginTop: 12 }}>{error}</Text>
        <Button onPress={fetchOrder} textColor={BRAND_COLOR}>{t('common.retry')}</Button>
      </View>
    );
  }

  // ══ CREATE MODE ═══════════════════════════════════════════════════
  if (isNew) {
    return (
      <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
        <Appbar.Header style={{ backgroundColor: BRAND_COLOR }} mode="center-aligned">
          <Appbar.BackAction onPress={() => router.back()} color="#FFF" />
          <Appbar.Content title="הזמנה חדשה" titleStyle={{ color: '#FFF', fontWeight: '700', fontSize: 17 }} />
          <Appbar.Action
            icon="content-save-outline"
            color="#FFF"
            onPress={handleCreate}
            disabled={creating}
          />
        </Appbar.Header>

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.createScroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

            {/* ── פרטי לקוח ── */}
            <View style={[styles.section, { backgroundColor: theme.colors.surface }]}>
              <Text variant="titleSmall" style={[styles.sectionTitle, { color: theme.colors.onSurface, textAlign }]}>
                👤 פרטי לקוח
              </Text>
              <Divider style={{ marginBottom: 14 }} />

              {/* Contact lookup */}
              {selectedContact ? (
                <TouchableOpacity
                  onPress={() => { setSelectedContact(null); setFormCustomerName(''); setFormCustomerPhone(''); setFormCustomerEmail(''); }}
                  style={[styles.selectedContact, { backgroundColor: BRAND_COLOR + '15', borderColor: BRAND_COLOR + '40' }]}
                >
                  <View style={[styles.contactAvatar, { backgroundColor: BRAND_COLOR }]}>
                    <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>
                      {(selectedContact.fullName || selectedContact.name || '?').charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text variant="bodyMedium" style={{ color: theme.colors.onSurface, fontWeight: '600' }}>
                      {selectedContact.fullName || selectedContact.name}
                    </Text>
                    <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                      {selectedContact.phoneNumber || selectedContact.phone}
                    </Text>
                  </View>
                  <MaterialCommunityIcons name="close-circle" size={18} color={theme.colors.onSurfaceVariant} />
                </TouchableOpacity>
              ) : (
                <View style={{ marginBottom: 10, zIndex: 10 }}>
                  <TextInput
                    label="חפש איש קשר..."
                    value={contactSearch}
                    onChangeText={handleContactSearch}
                    mode="outlined"
                    style={[styles.formInput, { textAlign }]}
                    activeOutlineColor={BRAND_COLOR}
                    right={contactSearching
                      ? <TextInput.Icon icon="loading" />
                      : <TextInput.Icon icon="account-search-outline" />}
                  />
                  {contactResults.length > 0 && (
                    <View style={[styles.contactDropdown, { backgroundColor: theme.colors.surface, borderColor: theme.colors.outlineVariant }]}>
                      {contactResults.map((c, i) => (
                        <React.Fragment key={c.id || c.phoneNumber || i}>
                          {i > 0 && <Divider />}
                          <TouchableOpacity style={styles.contactRow} onPress={() => handleSelectContact(c)}>
                            <View style={[styles.contactAvatarSm, { backgroundColor: BRAND_COLOR + '20' }]}>
                              <Text style={{ color: BRAND_COLOR, fontWeight: '700', fontSize: 13 }}>
                                {(c.fullName || c.name || '?').charAt(0).toUpperCase()}
                              </Text>
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text variant="bodySmall" style={{ color: theme.colors.onSurface, fontWeight: '600' }}>
                                {c.fullName || c.name}
                              </Text>
                              <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                                {c.phoneNumber || c.phone}
                              </Text>
                            </View>
                          </TouchableOpacity>
                        </React.Fragment>
                      ))}
                    </View>
                  )}
                </View>
              )}

              <TextInput label="שם לקוח" value={formCustomerName} onChangeText={setFormCustomerName}
                mode="outlined" style={[styles.formInput, { textAlign }]} activeOutlineColor={BRAND_COLOR}
                right={<TextInput.Icon icon="account-outline" />} />
              <TextInput label="טלפון" value={formCustomerPhone} onChangeText={setFormCustomerPhone}
                mode="outlined" keyboardType="phone-pad" style={[styles.formInput, { textAlign }]} activeOutlineColor={BRAND_COLOR}
                right={<TextInput.Icon icon="phone-outline" />} />
              <TextInput label="אימייל" value={formCustomerEmail} onChangeText={setFormCustomerEmail}
                mode="outlined" keyboardType="email-address" autoCapitalize="none" style={[styles.formInput, { textAlign }]} activeOutlineColor={BRAND_COLOR}
                right={<TextInput.Icon icon="email-outline" />} />
              <TextInput label="כתובת משלוח" value={formShippingAddress} onChangeText={setFormShippingAddress}
                mode="outlined" style={[styles.formInput, { textAlign }]} activeOutlineColor={BRAND_COLOR}
                right={<TextInput.Icon icon="map-marker-outline" />} />
            </View>

            {/* ── פרטי הזמנה ── */}
            <View style={[styles.section, { backgroundColor: theme.colors.surface }]}>
              <Text variant="titleSmall" style={[styles.sectionTitle, { color: theme.colors.onSurface, textAlign }]}>
                📋 פרטי הזמנה
              </Text>
              <Divider style={{ marginBottom: 14 }} />

              <TextInput label='מספר הזמנה (אופציונלי)' value={formOrderNumber} onChangeText={setFormOrderNumber}
                mode="outlined" style={[styles.formInput, { textAlign }]} activeOutlineColor={BRAND_COLOR}
                right={<TextInput.Icon icon="pound" />} />

              <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 6, textAlign }}>סטטוס</Text>
              <Menu
                visible={createStatusMenuVisible}
                onDismiss={() => setCreateStatusMenuVisible(false)}
                anchor={
                  <Pressable
                    onPress={() => setCreateStatusMenuVisible(true)}
                    style={[styles.statusSelector, { borderColor: theme.colors.outline, backgroundColor: theme.colors.surface, flexDirection }]}
                  >
                    <View style={[styles.statusDot, { backgroundColor: STATUS_COLORS[formStatus] || '#999' }]} />
                    <Text style={{ color: theme.colors.onSurface, flex: 1, textAlign }}>
                      {t(`orders.status_${formStatus}`, { defaultValue: formStatus })}
                    </Text>
                    <MaterialCommunityIcons name="chevron-down" size={20} color={theme.colors.onSurfaceVariant} />
                  </Pressable>
                }
              >
                {ORDER_STATUSES.map((s) => (
                  <Menu.Item
                    key={s}
                    title={t(`orders.status_${s}`, { defaultValue: s })}
                    onPress={() => { setFormStatus(s); setCreateStatusMenuVisible(false); }}
                    leadingIcon={formStatus === s ? 'check' : undefined}
                  />
                ))}
              </Menu>

              <TextInput label="שיטת תשלום" value={formPaymentMethod} onChangeText={setFormPaymentMethod}
                mode="outlined" style={[styles.formInput, { textAlign, marginTop: 14 }]} activeOutlineColor={BRAND_COLOR}
                right={<TextInput.Icon icon="credit-card-outline" />} />

              <View style={[styles.switchRow, { flexDirection }]}>
                <Text variant="bodyMedium" style={{ color: theme.colors.onSurface }}>הזמנה שולמה ✓</Text>
                <Switch value={formIsPaid} onValueChange={setFormIsPaid} color={BRAND_COLOR} />
              </View>
            </View>

            {/* ── פריטים ── */}
            <View style={[styles.section, { backgroundColor: theme.colors.surface }]}>
              <View style={[{ flexDirection, justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }]}>
                <Text variant="titleSmall" style={[styles.sectionTitle, { color: theme.colors.onSurface, textAlign, marginBottom: 0 }]}>
                  🛒 פריטים ({formItems.length})
                </Text>
                <View style={[{ flexDirection, gap: 8 }]}>
                  <Pressable
                    onPress={openInventoryPicker}
                    style={[styles.addItemBtn, { borderColor: BRAND_COLOR, backgroundColor: BRAND_COLOR + '12' }]}
                  >
                    <MaterialCommunityIcons name="shape" size={14} color={BRAND_COLOR} />
                    <Text style={{ color: BRAND_COLOR, fontSize: 12, fontWeight: '600' }}>קטלוג</Text>
                  </Pressable>
                  <Pressable
                    onPress={addItem}
                    style={[styles.addItemBtn, { borderColor: BRAND_COLOR, backgroundColor: BRAND_COLOR + '12' }]}
                  >
                    <MaterialCommunityIcons name="plus" size={14} color={BRAND_COLOR} />
                    <Text style={{ color: BRAND_COLOR, fontSize: 12, fontWeight: '600' }}>הוסף ידנית</Text>
                  </Pressable>
                </View>
              </View>
              <Divider style={{ marginBottom: 14 }} />

              {formItems.length === 0 ? (
                <Text style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center', paddingVertical: 16, fontSize: 13 }}>
                  אין פריטים — הוסף ידנית או בחר מקטלוג
                </Text>
              ) : (
                formItems.map((item, idx) => (
                  <View key={idx} style={[styles.itemCard, { backgroundColor: theme.colors.background, borderColor: theme.colors.outlineVariant }]}>
                    <View style={[{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }]}>
                      <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>פריט {idx + 1}</Text>
                      <Pressable onPress={() => removeItem(idx)} hitSlop={8}>
                        <MaterialCommunityIcons name="trash-can-outline" size={18} color={theme.colors.error} />
                      </Pressable>
                    </View>
                    <TextInput label="שם מוצר" value={item.name} onChangeText={(v) => updateItem(idx, 'name', v)}
                      mode="outlined" style={[styles.itemInput, { textAlign }]} activeOutlineColor={BRAND_COLOR} dense />
                    <TextInput label='מק"ט (SKU)' value={item.sku} onChangeText={(v) => updateItem(idx, 'sku', v)}
                      mode="outlined" style={[styles.itemInput, { textAlign }]} activeOutlineColor={BRAND_COLOR} dense />
                    <View style={{ flexDirection: 'row', gap: 10 }}>
                      <TextInput label="כמות" value={String(item.quantity)} onChangeText={(v) => updateItem(idx, 'quantity', parseInt(v) || 1)}
                        mode="outlined" style={[styles.itemInput, { flex: 1, textAlign }]} activeOutlineColor={BRAND_COLOR}
                        keyboardType="number-pad" dense />
                      <TextInput label="מחיר ₪" value={String(item.price)} onChangeText={(v) => updateItem(idx, 'price', parseFloat(v) || 0)}
                        mode="outlined" style={[styles.itemInput, { flex: 2, textAlign }]} activeOutlineColor={BRAND_COLOR}
                        keyboardType="decimal-pad" dense />
                    </View>
                    <View style={[{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 4 }]}>
                      <Text variant="labelMedium" style={{ color: BRAND_COLOR, fontWeight: '700' }}>
                        סה"כ: ₪{((item.price || 0) * (item.quantity || 0)).toFixed(2)}
                      </Text>
                    </View>
                  </View>
                ))
              )}

              {/* Totals */}
              {formItems.length > 0 && (
                <View style={[styles.totalsBox, { borderColor: theme.colors.outlineVariant }]}>
                  <View style={[styles.totalRow, { flexDirection }]}>
                    <Text style={{ color: theme.colors.onSurfaceVariant }}>ביניים</Text>
                    <Text style={{ color: theme.colors.onSurface }}>₪{totals.subtotal.toFixed(2)}</Text>
                  </View>
                  <View style={[styles.totalRow, { flexDirection }]}>
                    <Text style={{ color: theme.colors.onSurfaceVariant }}>הנחה ₪</Text>
                    <TextInput value={formDiscount} onChangeText={setFormDiscount}
                      mode="flat" keyboardType="decimal-pad" dense
                      style={[styles.totalInput, { backgroundColor: 'transparent' }]}
                      activeUnderlineColor={BRAND_COLOR} />
                  </View>
                  <View style={[styles.totalRow, { flexDirection }]}>
                    <Text style={{ color: theme.colors.onSurfaceVariant }}>מע"מ %</Text>
                    <TextInput value={formTax} onChangeText={setFormTax}
                      mode="flat" keyboardType="decimal-pad" dense
                      style={[styles.totalInput, { backgroundColor: 'transparent' }]}
                      activeUnderlineColor={BRAND_COLOR} />
                  </View>
                  <Divider style={{ marginVertical: 6 }} />
                  <View style={[styles.totalRow, { flexDirection }]}>
                    <Text style={{ color: theme.colors.onSurface, fontWeight: '700', fontSize: 15 }}>סה"כ לתשלום</Text>
                    <Text style={{ color: BRAND_COLOR, fontWeight: '700', fontSize: 15 }}>₪{totals.total.toFixed(2)}</Text>
                  </View>
                </View>
              )}
            </View>

            {/* ── שדות דינמיים ── */}
            {orderFormSections.length > 0 && (
              <DynamicFieldsSectionForm
                sections={orderFormSections}
                data={dynamicData}
                onChange={(key, value) => setDynamicData((prev) => ({ ...prev, [key]: value }))}
                lang={lang}
                formLayout={orderFormLayout}
              />
            )}

            {/* ── הערות ── */}
            <View style={[styles.section, { backgroundColor: theme.colors.surface }]}>
              <Text variant="titleSmall" style={[styles.sectionTitle, { color: theme.colors.onSurface, textAlign }]}>
                📝 הערות
              </Text>
              <Divider style={{ marginBottom: 14 }} />
              <TextInput label="הערות פנימיות..." value={formNotes} onChangeText={setFormNotes}
                mode="outlined" multiline numberOfLines={3} style={[styles.formInput, { textAlign }]}
                activeOutlineColor={BRAND_COLOR} />
            </View>

            {/* ── כפתור שמירה ── */}
            <Button
              mode="contained"
              onPress={handleCreate}
              loading={creating}
              disabled={creating}
              style={[styles.saveButton, { backgroundColor: BRAND_COLOR }]}
              textColor="#FFF"
              contentStyle={{ paddingVertical: 6 }}
              icon="content-save-outline"
            >
              שמור הזמנה
            </Button>
          </ScrollView>
        </KeyboardAvoidingView>

        {/* ── Catalog Picker Modal ── */}
        <Portal>
          <Modal
            visible={inventoryVisible}
            onDismiss={() => { setInventoryVisible(false); setInventorySearch(''); }}
            contentContainerStyle={[styles.inventoryModal, { backgroundColor: theme.colors.surface }]}
          >
            <View style={[styles.modalHeader, { flexDirection }]}>
              <Text variant="titleMedium" style={{ color: theme.colors.onSurface, fontWeight: '700' }}>בחר מקטלוג</Text>
              <IconButton icon="close" size={20} onPress={() => { setInventoryVisible(false); setInventorySearch(''); }} />
            </View>
            <TextInput
              label="חפש פריט..."
              value={inventorySearch}
              onChangeText={setInventorySearch}
              mode="outlined"
              dense
              style={{ marginBottom: 10 }}
              activeOutlineColor={BRAND_COLOR}
              right={<TextInput.Icon icon="magnify" />}
            />
            <ScrollView style={{ maxHeight: 350 }} keyboardShouldPersistTaps="handled">
              {inventoryLoading && <ActivityIndicator size="small" color={BRAND_COLOR} style={{ marginVertical: 20 }} />}
              {!inventoryLoading && filteredInventory.length === 0 && (
                <Text style={{ textAlign: 'center', color: theme.colors.onSurfaceVariant, padding: 20 }}>לא נמצאו פריטים בקטלוג</Text>
              )}
              {filteredInventory.map((item, i) => (
                <React.Fragment key={i}>
                  {i > 0 && <Divider />}
                  <TouchableOpacity onPress={() => addFromInventory(item)} style={styles.inventoryRow}>
                    <View style={{ flex: 1 }}>
                      <Text variant="bodySmall" style={{ fontWeight: '600', color: theme.colors.onSurface }}>
                        {item.name || item.description || ''}
                      </Text>
                      {item.description && item.name ? (
                        <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>{item.description}</Text>
                      ) : null}
                    </View>
                    {(item.unitPrice || item.price) != null && (
                      <Text variant="bodySmall" style={{ color: BRAND_COLOR, fontWeight: '700' }}>
                        ₪{Number(item.unitPrice || item.price || 0).toFixed(2)}
                      </Text>
                    )}
                    <MaterialCommunityIcons name="plus-circle-outline" size={20} color={BRAND_COLOR} style={{ marginStart: 8 }} />
                  </TouchableOpacity>
                </React.Fragment>
              ))}
            </ScrollView>
          </Modal>
        </Portal>
      </View>
    );
  }

  // ══ VIEW MODE ═════════════════════════════════════════════════════
  const statusColor = order ? STATUS_COLORS[order.status] || '#9E9E9E' : '#9E9E9E';

  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
      <Appbar.Header style={{ backgroundColor: BRAND_COLOR }} mode="center-aligned">
        <Appbar.BackAction onPress={() => router.back()} color="#FFF" />
        <Appbar.Content
          title={order?.orderNumber ? `${t('orders.order')} #${order.orderNumber}` : t('orders.orderDetails')}
          titleStyle={{ color: '#FFF', fontWeight: '700', fontSize: 17 }}
        />
      </Appbar.Header>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {order ? (
          <>
            {/* Status Card */}
            <View style={[styles.section, { backgroundColor: theme.colors.surface }]}>
              <View style={[styles.statusRow, { flexDirection, justifyContent: 'space-between', alignItems: 'center' }]}>
                <View>
                  <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>{t('orders.status')}</Text>
                  <Chip
                    style={[styles.statusChip, { backgroundColor: `${statusColor}15` }]}
                    textStyle={{ color: statusColor, fontWeight: '700' }}
                  >
                    {t(`orders.status_${order.status}`, { defaultValue: order.status })}
                  </Chip>
                </View>

                <Menu
                  visible={statusMenuVisible}
                  onDismiss={() => setStatusMenuVisible(false)}
                  anchor={
                    <Button
                      mode="outlined"
                      onPress={() => setStatusMenuVisible(true)}
                      loading={updatingStatus}
                      style={{ borderColor: BRAND_COLOR, borderRadius: 8 }}
                      textColor={BRAND_COLOR}
                      icon="swap-horizontal"
                      compact
                    >
                      {t('orders.updateStatus')}
                    </Button>
                  }
                >
                  {ORDER_STATUSES.map((s) => (
                    <Menu.Item
                      key={s}
                      title={t(`orders.status_${s}`, { defaultValue: s })}
                      onPress={() => handleUpdateStatus(s)}
                      leadingIcon={order.status === s ? 'check' : undefined}
                    />
                  ))}
                </Menu>
              </View>
            </View>

            {/* Customer Info */}
            <Pressable
              style={[styles.section, { backgroundColor: theme.colors.surface }]}
              onPress={() => {
                const cid = (order as any).contactId;
                const phone = order.customerPhone;
                if (cid) {
                  router.push({ pathname: '/(tabs)/contacts/[id]', params: { id: cid } });
                } else if (phone) {
                  router.push({ pathname: '/(tabs)/chats/[phoneNumber]', params: { phoneNumber: phone.replace(/\D/g, '') } });
                }
              }}
              disabled={!(order as any).contactId && !order.customerPhone}
            >
              <View style={[{ flexDirection, alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }]}>
                <Text variant="titleSmall" style={[styles.sectionTitle, { color: theme.colors.onSurface, marginBottom: 0 }]}>
                  {t('orders.customer')}
                </Text>
                {((order as any).contactId || order.customerPhone) ? (
                  <MaterialCommunityIcons name={isRTL ? 'chevron-left' : 'chevron-right'} size={18} color={theme.colors.primary} />
                ) : null}
              </View>
              <Divider style={{ marginBottom: 12 }} />
              {order.customerName ? (
                <InfoRow icon="account-outline" label={t('orders.name')} value={order.customerName} flexDirection={flexDirection} textAlign={textAlign} theme={theme} />
              ) : null}
              {order.customerPhone ? (
                <InfoRow icon="phone-outline" label={t('orders.phone')} value={order.customerPhone} flexDirection={flexDirection} textAlign={textAlign} theme={theme} />
              ) : null}
              {order.customerEmail ? (
                <InfoRow icon="email-outline" label={t('orders.email')} value={order.customerEmail} flexDirection={flexDirection} textAlign={textAlign} theme={theme} />
              ) : null}
              {order.shippingAddress ? (
                <InfoRow icon="map-marker-outline" label={t('orders.address')} value={order.shippingAddress} flexDirection={flexDirection} textAlign={textAlign} theme={theme} />
              ) : null}
            </Pressable>

            {/* Order Items */}
            {order.items && order.items.length > 0 ? (
              <View style={[styles.section, { backgroundColor: theme.colors.surface }]}>
                <Text variant="titleSmall" style={[styles.sectionTitle, { color: theme.colors.onSurface }]}>
                  {t('orders.items')} ({order.items.length})
                </Text>
                <Divider style={{ marginBottom: 12 }} />
                {order.items.map((item, idx) => (
                  <View key={item.id || idx} style={[styles.itemRow, { borderBottomColor: theme.colors.outlineVariant }]}>
                    <View style={{ flex: 1 }}>
                      <Text variant="bodyMedium" style={{ color: theme.colors.onSurface, fontWeight: '600' }}>{item.productName}</Text>
                      {item.sku ? <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>SKU: {item.sku}</Text> : null}
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>×{item.quantity}</Text>
                      <Text variant="bodyMedium" style={{ color: BRAND_COLOR, fontWeight: '700' }}>
                        {order.currency || '₪'}{Number(item.price).toFixed(2)}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            ) : null}

            {/* Totals */}
            {order.totalAmount != null ? (
              <View style={[styles.section, { backgroundColor: theme.colors.surface }]}>
                <Text variant="titleSmall" style={[styles.sectionTitle, { color: theme.colors.onSurface }]}>
                  {t('orders.summary')}
                </Text>
                <Divider style={{ marginBottom: 12 }} />
                {order.subtotal != null ? (
                  <View style={[styles.summaryRow, { flexDirection }]}>
                    <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>{t('orders.subtotal')}</Text>
                    <Text variant="bodySmall" style={{ color: theme.colors.onSurface }}>
                      {order.currency || '₪'}{Number(order.subtotal).toFixed(2)}
                    </Text>
                  </View>
                ) : null}
                {order.tax != null ? (
                  <View style={[styles.summaryRow, { flexDirection }]}>
                    <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>{t('orders.tax')}</Text>
                    <Text variant="bodySmall" style={{ color: theme.colors.onSurface }}>
                      {order.currency || '₪'}{Number(order.tax).toFixed(2)}
                    </Text>
                  </View>
                ) : null}
                {order.shipping != null ? (
                  <View style={[styles.summaryRow, { flexDirection }]}>
                    <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>{t('orders.shipping')}</Text>
                    <Text variant="bodySmall" style={{ color: theme.colors.onSurface }}>
                      {order.currency || '₪'}{Number(order.shipping).toFixed(2)}
                    </Text>
                  </View>
                ) : null}
                <Divider style={{ marginVertical: 8 }} />
                <View style={[styles.summaryRow, { flexDirection }]}>
                  <Text variant="titleSmall" style={{ color: theme.colors.onSurface, fontWeight: '700' }}>{t('orders.total')}</Text>
                  <Text variant="titleSmall" style={{ color: BRAND_COLOR, fontWeight: '700' }}>
                    {order.currency || '₪'}{Number(order.totalAmount).toFixed(2)}
                  </Text>
                </View>
              </View>
            ) : null}

            {/* Additional Info */}
            <View style={[styles.section, { backgroundColor: theme.colors.surface }]}>
              <Text variant="titleSmall" style={[styles.sectionTitle, { color: theme.colors.onSurface }]}>
                {t('orders.details')}
              </Text>
              <Divider style={{ marginBottom: 12 }} />
              {order.source ? (
                <InfoRow icon="store-outline" label={t('orders.source')} value={order.source} flexDirection={flexDirection} textAlign={textAlign} theme={theme} />
              ) : null}
              {order.paymentMethod ? (
                <InfoRow icon="credit-card-outline" label={t('orders.payment')} value={order.paymentMethod} flexDirection={flexDirection} textAlign={textAlign} theme={theme} />
              ) : null}
              {order.createdAt ? (
                <InfoRow icon="calendar-plus" label={t('orders.createdAt')} value={formatDate(order.createdAt)} flexDirection={flexDirection} textAlign={textAlign} theme={theme} />
              ) : null}
            </View>

            {/* Dynamic custom fields */}
            <DynamicFieldsSectionView
              sections={orderFormSections}
              data={order as Record<string, any>}
              lang={lang}
              formLayout={orderFormLayout}
            />

            {/* Notes */}
            {order.notes ? (
              <View style={[styles.section, { backgroundColor: theme.colors.surface }]}>
                <Text variant="titleSmall" style={[styles.sectionTitle, { color: theme.colors.onSurface }]}>
                  {t('orders.notes')}
                </Text>
                <Divider style={{ marginBottom: 12 }} />
                <Text variant="bodyMedium" style={{ color: theme.colors.onSurface, lineHeight: 22 }}>
                  {order.notes}
                </Text>
              </View>
            ) : null}

            {/* Add Note Action */}
            <Pressable
              onPress={() => setNoteModalVisible(true)}
              style={[styles.addNoteButton, { backgroundColor: theme.colors.surface, borderColor: theme.colors.outlineVariant }]}
            >
              <MaterialCommunityIcons name="note-plus-outline" size={22} color={BRAND_COLOR} />
              <Text variant="bodyMedium" style={{ color: BRAND_COLOR, fontWeight: '600' }}>
                {t('orders.addNote')}
              </Text>
            </Pressable>
          </>
        ) : null}
      </ScrollView>

      {/* Note Modal */}
      <Portal>
        <Modal
          visible={noteModalVisible}
          onDismiss={() => { setNoteModalVisible(false); setNoteText(''); }}
          contentContainerStyle={[styles.modal, { backgroundColor: theme.colors.surface }]}
        >
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={[styles.modalHeader, { flexDirection }]}>
              <Text variant="titleMedium" style={{ color: theme.colors.onSurface, fontWeight: '700' }}>
                {t('orders.addNote')}
              </Text>
              <IconButton icon="close" size={20} onPress={() => { setNoteModalVisible(false); setNoteText(''); }} />
            </View>
            <TextInput
              mode="outlined"
              label={t('orders.note')}
              value={noteText}
              onChangeText={setNoteText}
              multiline
              numberOfLines={4}
              style={styles.noteInput}
              outlineColor={theme.colors.outline}
              activeOutlineColor={BRAND_COLOR}
              autoFocus
            />
            <View style={[styles.modalActions, { flexDirection }]}>
              <Button mode="outlined" onPress={() => { setNoteModalVisible(false); setNoteText(''); }} style={styles.modalBtn} textColor={theme.colors.onSurface}>
                {t('common.cancel')}
              </Button>
              <Button
                mode="contained"
                onPress={handleSaveNote}
                loading={savingNote}
                disabled={!noteText.trim() || savingNote}
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
  createScroll: { padding: 16, gap: 12, paddingBottom: 40 },
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
  formInput: { marginBottom: 12 },
  statusRow: { gap: 12 },
  statusChip: { marginTop: 6, alignSelf: 'flex-start' },
  statusSelector: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    alignItems: 'center',
    gap: 10,
    marginBottom: 4,
  },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  switchRow: {
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    marginTop: 4,
  },
  infoRow: {
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 10,
    gap: 8,
  },
  infoLabel: { minWidth: 120 },
  infoValue: { flex: 1 },
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  itemCard: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    marginBottom: 10,
    gap: 6,
  },
  itemInput: { marginBottom: 6 },
  addItemBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  totalsBox: {
    marginTop: 12,
    borderTopWidth: 1,
    paddingTop: 12,
    gap: 8,
  },
  totalRow: {
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  totalInput: {
    width: 80,
    fontSize: 14,
    height: 32,
    textAlign: 'right',
  },
  summaryRow: {
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  addNoteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 16,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  saveButton: {
    borderRadius: 12,
    marginTop: 8,
  },
  modal: {
    marginHorizontal: 20,
    borderRadius: borderRadius.xl,
    padding: 20,
  },
  inventoryModal: {
    marginHorizontal: 16,
    borderRadius: borderRadius.xl,
    padding: 20,
    maxHeight: '80%',
  },
  modalHeader: {
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  noteInput: { marginBottom: 16 },
  modalActions: { gap: 10, justifyContent: 'flex-end', marginTop: 8 },
  modalBtn: { minWidth: 100, borderRadius: 10 },
  selectedContact: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    padding: 10,
    marginBottom: 12,
    gap: 10,
  },
  contactAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contactAvatarSm: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contactDropdown: {
    borderRadius: 10,
    borderWidth: 1,
    marginTop: -8,
    marginBottom: 12,
    overflow: 'hidden',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10,
  },
  inventoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 8,
  },
});
