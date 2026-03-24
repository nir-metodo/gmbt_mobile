import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
  TouchableOpacity,
  Pressable,
  FlatList,
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
  Searchbar,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../../../stores/authStore';
import { useAppTheme } from '../../../../hooks/useAppTheme';
import { useRTL } from '../../../../hooks/useRTL';
import {
  invoicesApi,
  Invoice,
  InvoiceItem,
  DOCUMENT_TYPES,
  INVOICE_STATUSES,
} from '../../../../services/api/invoices';
import { contactsApi } from '../../../../services/api/contacts';
import type { Contact } from '../../../../types';
import { borderRadius } from '../../../../constants/theme';
import { formatDate } from '../../../../utils/formatters';

const BRAND_COLOR = '#2e6155';

const PAYMENT_METHODS = [
  { key: 'bank_transfer', label: 'העברה בנקאית' },
  { key: 'credit_card',   label: 'כרטיס אשראי' },
  { key: 'cash',          label: 'מזומן' },
  { key: 'check',         label: "צ'ק" },
  { key: 'other',         label: 'אחר' },
];

const emptyItem = (): InvoiceItem => ({ description: '', quantity: 1, unitPrice: 0 });

function calcTotals(items: InvoiceItem[], discount = 0, vatRate = 18) {
  const subtotalBeforeDiscount = items.reduce((s, it) => s + (it.unitPrice || 0) * (it.quantity || 0), 0);
  const subtotal = Math.max(0, subtotalBeforeDiscount - (discount || 0));
  const vatAmount = subtotal * ((vatRate || 0) / 100);
  const total = subtotal + vatAmount;
  return { subtotal: subtotalBeforeDiscount, subtotalAfterDiscount: subtotal, vatAmount, total };
}

export default function InvoiceDetailScreen() {
  const router = useRouter();
  const { id, prefillContactName, prefillContactPhone, prefillRelatedQuoteId } =
    useLocalSearchParams<{
      id: string;
      prefillContactName?: string;
      prefillContactPhone?: string;
      prefillRelatedQuoteId?: string;
    }>();
  const theme = useAppTheme();
  const { flexDirection, textAlign, isRTL } = useRTL();
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);

  const isNew = id === 'new';

  // ── View mode state ───────────────────────────────────────────────
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [error, setError] = useState<string | null>(null);

  // ── Create/edit mode state ────────────────────────────────────────
  const today = new Date().toISOString().split('T')[0];
  const due30 = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];

  const [formType, setFormType] = useState('tax_invoice');
  const [formContactName, setFormContactName] = useState(prefillContactName || '');
  const [formContactPhone, setFormContactPhone] = useState(prefillContactPhone || '');
  const [formContactEmail, setFormContactEmail] = useState('');
  const [formContactCompany, setFormContactCompany] = useState('');
  const [formDate, setFormDate] = useState(today);
  const [formDueDate, setFormDueDate] = useState(due30);
  const [formCurrency, setFormCurrency] = useState('ILS');
  const [formVatRate, setFormVatRate] = useState('18');
  const [formItems, setFormItems] = useState<InvoiceItem[]>([emptyItem()]);
  const [formDiscount, setFormDiscount] = useState('0');
  const [formPaymentMethod, setFormPaymentMethod] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [saving, setSaving] = useState(false);

  // Type/payment menus
  const [typeMenuVisible, setTypeMenuVisible] = useState(false);
  const [paymentMenuVisible, setPaymentMenuVisible] = useState(false);

  // Contact search / picker
  const [contactPickerVisible, setContactPickerVisible] = useState(false);
  const [contactSearch, setContactSearch] = useState('');
  const [contactResults, setContactResults] = useState<Contact[]>([]);
  const [contactSearching, setContactSearching] = useState(false);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const contactDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Inventory picker
  const [catalogVisible, setCatalogVisible] = useState(false);
  const [catalogItems, setCatalogItems] = useState<any[]>([]);
  const [catalogSearch, setCatalogSearch] = useState('');
  const [catalogLoading, setCatalogLoading] = useState(false);

  const totals = useMemo(
    () => calcTotals(formItems, parseFloat(formDiscount) || 0, parseFloat(formVatRate) || 0),
    [formItems, formDiscount, formVatRate],
  );

  const getDocLabel = (type: string) => DOCUMENT_TYPES.find((d) => d.key === type)?.labelHe || type;
  const getDocColor = (type: string) => DOCUMENT_TYPES.find((d) => d.key === type)?.color || BRAND_COLOR;
  const getStatusLabel = (status: string) => INVOICE_STATUSES.find((s) => s.key === status)?.labelHe || status;
  const getStatusColor = (status: string) => INVOICE_STATUSES.find((s) => s.key === status)?.color || '#9E9E9E';

  // ── Fetch invoice ─────────────────────────────────────────────────
  const fetchInvoice = useCallback(async () => {
    if (!user?.organization || isNew) { setLoading(false); return; }
    try {
      setError(null);
      const data = await invoicesApi.getById(user.organization, id);
      setInvoice(data);
    } catch (err: any) {
      setError(err.message || t('errors.generic'));
    } finally {
      setLoading(false);
    }
  }, [user?.organization, id, isNew, t]);

  useEffect(() => {
    fetchInvoice();
  }, [fetchInvoice]);

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
    setFormContactName(contact.fullName || contact.name || '');
    setFormContactPhone(contact.phoneNumber || contact.phone || '');
    setFormContactEmail(contact.email || '');
    setContactPickerVisible(false);
  }, []);

  // ── Catalog picker (from invoice branding) ────────────────────────
  const openCatalogPicker = useCallback(async () => {
    setCatalogVisible(true);
    if (catalogItems.length === 0) {
      setCatalogLoading(true);
      try {
        const branding = await invoicesApi.getBranding(user?.organization || '');
        setCatalogItems(Array.isArray(branding?.catalogItems) ? branding.catalogItems : []);
      } catch { setCatalogItems([]); }
      finally { setCatalogLoading(false); }
    }
  }, [user?.organization, catalogItems.length]);

  const filteredCatalog = useMemo(() => {
    if (!catalogSearch.trim()) return catalogItems;
    const q = catalogSearch.toLowerCase();
    return catalogItems.filter(
      (p) => (p.name || p.description || '').toLowerCase().includes(q),
    );
  }, [catalogItems, catalogSearch]);

  const addFromCatalog = useCallback((item: any) => {
    setFormItems((prev) => [...prev, {
      description: item.name || item.description || '',
      quantity: 1,
      unitPrice: parseFloat(item.unitPrice) || parseFloat(item.price) || 0,
    }]);
    setCatalogVisible(false);
    setCatalogSearch('');
  }, []);

  // ── Items management ──────────────────────────────────────────────
  const addItem = () => setFormItems((prev) => [...prev, emptyItem()]);
  const removeItem = (idx: number) => setFormItems((prev) => prev.filter((_, i) => i !== idx));
  const updateItem = (idx: number, field: keyof InvoiceItem, value: string | number) =>
    setFormItems((prev) => prev.map((it, i) => (i === idx ? { ...it, [field]: value } : it)));

  // ── Save invoice ──────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!user?.organization) return;
    if (!formContactName.trim() && !formContactPhone.trim()) {
      Alert.alert(t('common.error'), 'יש להזין שם לקוח או טלפון');
      return;
    }
    setSaving(true);
    try {
      const payload: Partial<Invoice> = {
        type: formType,
        status: 'draft',
        date: formDate,
        dueDate: formDueDate,
        currency: formCurrency,
        vatRate: parseFloat(formVatRate) || 18,
        contactName: formContactName.trim(),
        contactPhone: formContactPhone.trim(),
        contactEmail: formContactEmail.trim(),
        contactCompany: formContactCompany.trim(),
        items: formItems,
        subtotal: totals.subtotalAfterDiscount,
        vatAmount: totals.vatAmount,
        total: totals.total,
        discount: parseFloat(formDiscount) || 0,
        paymentMethod: formPaymentMethod,
        notes: formNotes.trim(),
        relatedQuoteId: prefillRelatedQuoteId || undefined,
      };
      const result = await invoicesApi.create(user.organization, payload, user.uID || user.userId, user.fullname);
      const newId = result?.invoice?.id || result?.id || result?.invoiceId;
      if (newId) {
        router.replace({ pathname: '/(tabs)/more/invoices/[id]', params: { id: newId } });
      } else {
        router.back();
      }
    } catch (err: any) {
      Alert.alert(t('common.error'), err.message || t('errors.generic'));
    } finally {
      setSaving(false);
    }
  }, [
    user, formType, formDate, formDueDate, formCurrency, formVatRate, formContactName,
    formContactPhone, formContactEmail, formContactCompany, formItems, formDiscount,
    formPaymentMethod, formNotes, totals, prefillRelatedQuoteId, router, t,
  ]);

  // ══ Loading / Error ═══════════════════════════════════════════════
  if (loading) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator size="large" color={BRAND_COLOR} />
      </View>
    );
  }

  if (error && !invoice) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.colors.background }]}>
        <Appbar.Header style={{ backgroundColor: BRAND_COLOR, width: '100%', position: 'absolute', top: 0 }}>
          <Appbar.BackAction onPress={() => router.back()} color="#FFF" />
          <Appbar.Content title="חשבוניות" titleStyle={{ color: '#FFF' }} />
        </Appbar.Header>
        <MaterialCommunityIcons name="alert-circle-outline" size={48} color={theme.colors.error} style={{ opacity: 0.7 }} />
        <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant, marginTop: 12 }}>{error}</Text>
        <Button onPress={fetchInvoice} textColor={BRAND_COLOR}>{t('common.retry')}</Button>
      </View>
    );
  }

  // ══ CREATE MODE ═══════════════════════════════════════════════════
  if (isNew) {
    const docColor = getDocColor(formType);
    return (
      <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
        <Appbar.Header style={{ backgroundColor: docColor }} mode="center-aligned">
          <Appbar.BackAction onPress={() => router.back()} color="#FFF" />
          <Appbar.Content title="חשבונית חדשה" titleStyle={{ color: '#FFF', fontWeight: '700', fontSize: 17 }} />
          <Appbar.Action icon="content-save-outline" color="#FFF" onPress={handleSave} disabled={saving} />
        </Appbar.Header>

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.createScroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

            {/* ── סוג מסמך ── */}
            <View style={[styles.section, { backgroundColor: theme.colors.surface }]}>
              <Text variant="titleSmall" style={[styles.sectionTitle, { color: theme.colors.onSurface, textAlign }]}>
                📄 סוג מסמך
              </Text>
              <Divider style={{ marginBottom: 14 }} />
              <Menu
                visible={typeMenuVisible}
                onDismiss={() => setTypeMenuVisible(false)}
                anchor={
                  <Pressable
                    onPress={() => setTypeMenuVisible(true)}
                    style={[styles.selectorBtn, { borderColor: docColor, backgroundColor: `${docColor}10`, flexDirection }]}
                  >
                    <View style={[styles.colorDot, { backgroundColor: docColor }]} />
                    <Text style={{ color: docColor, fontWeight: '700', flex: 1, fontSize: 15 }}>{getDocLabel(formType)}</Text>
                    <MaterialCommunityIcons name="chevron-down" size={20} color={docColor} />
                  </Pressable>
                }
              >
                {DOCUMENT_TYPES.map((dt) => (
                  <Menu.Item
                    key={dt.key}
                    title={dt.labelHe}
                    onPress={() => { setFormType(dt.key); setTypeMenuVisible(false); }}
                    leadingIcon={formType === dt.key ? 'check' : undefined}
                  />
                ))}
              </Menu>
            </View>

            {/* ── פרטי לקוח ── */}
            <View style={[styles.section, { backgroundColor: theme.colors.surface }]}>
              <Text variant="titleSmall" style={[styles.sectionTitle, { color: theme.colors.onSurface, textAlign }]}>
                👤 פרטי לקוח
              </Text>
              <Divider style={{ marginBottom: 14 }} />

              {/* Contact lookup */}
              {selectedContact ? (
                <TouchableOpacity
                  onPress={() => { setSelectedContact(null); setFormContactName(''); setFormContactPhone(''); setFormContactEmail(''); }}
                  style={[styles.selectedContact, { backgroundColor: BRAND_COLOR + '12', borderColor: BRAND_COLOR + '40' }]}
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
                <Pressable
                  onPress={() => setContactPickerVisible(true)}
                  style={[styles.formInput, {
                    borderWidth: 1, borderRadius: 4,
                    borderColor: theme.colors.outline,
                    paddingHorizontal: 12, paddingVertical: 10,
                    backgroundColor: theme.colors.surface,
                  }]}
                >
                  <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 2 }}>חפש איש קשר</Text>
                  <View style={[{ flexDirection, alignItems: 'center', gap: 8 }]}>
                    <MaterialCommunityIcons name="account-search-outline" size={16} color={theme.colors.onSurfaceVariant} />
                    <Text variant="bodyMedium" style={{ flex: 1, color: formContactName ? theme.colors.onSurface : theme.colors.onSurfaceVariant, textAlign }}>
                      {formContactName || 'חפש איש קשר...'}
                    </Text>
                    <MaterialCommunityIcons name="chevron-down" size={18} color={theme.colors.onSurfaceVariant} />
                  </View>
                </Pressable>
              )}

              <TextInput label="שם לקוח" value={formContactName} onChangeText={setFormContactName}
                mode="outlined" style={[styles.formInput, { textAlign }]} activeOutlineColor={BRAND_COLOR}
                right={<TextInput.Icon icon="account-outline" />} />
              <TextInput label="טלפון" value={formContactPhone} onChangeText={setFormContactPhone}
                mode="outlined" keyboardType="phone-pad" style={[styles.formInput, { textAlign }]} activeOutlineColor={BRAND_COLOR}
                right={<TextInput.Icon icon="phone-outline" />} />
              <TextInput label="אימייל" value={formContactEmail} onChangeText={setFormContactEmail}
                mode="outlined" keyboardType="email-address" autoCapitalize="none" style={[styles.formInput, { textAlign }]} activeOutlineColor={BRAND_COLOR}
                right={<TextInput.Icon icon="email-outline" />} />
              <TextInput label="חברה / עסק" value={formContactCompany} onChangeText={setFormContactCompany}
                mode="outlined" style={[styles.formInput, { textAlign }]} activeOutlineColor={BRAND_COLOR}
                right={<TextInput.Icon icon="domain" />} />
            </View>

            {/* ── פרטי מסמך ── */}
            <View style={[styles.section, { backgroundColor: theme.colors.surface }]}>
              <Text variant="titleSmall" style={[styles.sectionTitle, { color: theme.colors.onSurface, textAlign }]}>
                📋 פרטי מסמך
              </Text>
              <Divider style={{ marginBottom: 14 }} />
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <TextInput label="תאריך" value={formDate} onChangeText={setFormDate}
                  mode="outlined" style={[styles.formInput, { flex: 1, textAlign }]} activeOutlineColor={BRAND_COLOR}
                  placeholder="YYYY-MM-DD" />
                <TextInput label="תאריך פירעון" value={formDueDate} onChangeText={setFormDueDate}
                  mode="outlined" style={[styles.formInput, { flex: 1, textAlign }]} activeOutlineColor={BRAND_COLOR}
                  placeholder="YYYY-MM-DD" />
              </View>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <TextInput label='מע"מ %' value={formVatRate} onChangeText={setFormVatRate}
                  mode="outlined" keyboardType="decimal-pad" style={[styles.formInput, { flex: 1, textAlign }]} activeOutlineColor={BRAND_COLOR} />
                <TextInput label="מטבע" value={formCurrency} onChangeText={setFormCurrency}
                  mode="outlined" style={[styles.formInput, { flex: 1, textAlign }]} activeOutlineColor={BRAND_COLOR} />
              </View>
              <Menu
                visible={paymentMenuVisible}
                onDismiss={() => setPaymentMenuVisible(false)}
                anchor={
                  <Pressable
                    onPress={() => setPaymentMenuVisible(true)}
                    style={[styles.selectorBtn, { borderColor: theme.colors.outline, backgroundColor: theme.colors.surface, flexDirection }]}
                  >
                    <MaterialCommunityIcons name="credit-card-outline" size={18} color={theme.colors.onSurfaceVariant} />
                    <Text style={{ color: formPaymentMethod ? theme.colors.onSurface : theme.colors.onSurfaceVariant, flex: 1 }}>
                      {formPaymentMethod ? PAYMENT_METHODS.find((p) => p.key === formPaymentMethod)?.label || formPaymentMethod : 'שיטת תשלום (אופציונלי)'}
                    </Text>
                    <MaterialCommunityIcons name="chevron-down" size={20} color={theme.colors.onSurfaceVariant} />
                  </Pressable>
                }
              >
                {PAYMENT_METHODS.map((p) => (
                  <Menu.Item
                    key={p.key}
                    title={p.label}
                    onPress={() => { setFormPaymentMethod(p.key); setPaymentMenuVisible(false); }}
                    leadingIcon={formPaymentMethod === p.key ? 'check' : undefined}
                  />
                ))}
              </Menu>
            </View>

            {/* ── פריטים ── */}
            <View style={[styles.section, { backgroundColor: theme.colors.surface }]}>
              <View style={[{ flexDirection, justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }]}>
                <Text variant="titleSmall" style={[styles.sectionTitle, { color: theme.colors.onSurface, marginBottom: 0 }]}>
                  🛒 פריטים ({formItems.length})
                </Text>
                <View style={[{ flexDirection, gap: 8 }]}>
                  <Pressable
                    onPress={openCatalogPicker}
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
                    <Text style={{ color: BRAND_COLOR, fontSize: 12, fontWeight: '600' }}>הוסף</Text>
                  </Pressable>
                </View>
              </View>
              <Divider style={{ marginBottom: 14 }} />

              {formItems.map((item, idx) => (
                <View key={idx} style={[styles.itemCard, { backgroundColor: theme.colors.background, borderColor: theme.colors.outlineVariant }]}>
                  <View style={[{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }]}>
                    <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>שורה {idx + 1}</Text>
                    {formItems.length > 1 && (
                      <Pressable onPress={() => removeItem(idx)} hitSlop={8}>
                        <MaterialCommunityIcons name="trash-can-outline" size={18} color={theme.colors.error} />
                      </Pressable>
                    )}
                  </View>
                  <TextInput label="תיאור" value={item.description} onChangeText={(v) => updateItem(idx, 'description', v)}
                    mode="outlined" style={[styles.itemInput, { textAlign }]} activeOutlineColor={BRAND_COLOR} dense />
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <TextInput label="כמות" value={String(item.quantity)} onChangeText={(v) => updateItem(idx, 'quantity', parseFloat(v) || 1)}
                      mode="outlined" style={[styles.itemInput, { flex: 1, textAlign }]} activeOutlineColor={BRAND_COLOR}
                      keyboardType="decimal-pad" dense />
                    <TextInput label="מחיר ליחידה" value={String(item.unitPrice)} onChangeText={(v) => updateItem(idx, 'unitPrice', parseFloat(v) || 0)}
                      mode="outlined" style={[styles.itemInput, { flex: 2, textAlign }]} activeOutlineColor={BRAND_COLOR}
                      keyboardType="decimal-pad" dense />
                  </View>
                  <View style={[{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 4 }]}>
                    <Text variant="labelMedium" style={{ color: BRAND_COLOR, fontWeight: '700' }}>
                      ₪{((item.unitPrice || 0) * (item.quantity || 0)).toFixed(2)}
                    </Text>
                  </View>
                </View>
              ))}

              {/* Totals */}
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
                  <Text style={{ color: theme.colors.onSurfaceVariant }}>מע"מ ({formVatRate}%)</Text>
                  <Text style={{ color: theme.colors.onSurface }}>₪{totals.vatAmount.toFixed(2)}</Text>
                </View>
                <Divider style={{ marginVertical: 6 }} />
                <View style={[styles.totalRow, { flexDirection }]}>
                  <Text style={{ color: theme.colors.onSurface, fontWeight: '700', fontSize: 15 }}>סה"כ לתשלום</Text>
                  <Text style={{ color: docColor, fontWeight: '700', fontSize: 15 }}>₪{totals.total.toFixed(2)}</Text>
                </View>
              </View>
            </View>

            {/* ── הערות ── */}
            <View style={[styles.section, { backgroundColor: theme.colors.surface }]}>
              <Text variant="titleSmall" style={[styles.sectionTitle, { color: theme.colors.onSurface, textAlign }]}>
                📝 הערות
              </Text>
              <Divider style={{ marginBottom: 14 }} />
              <TextInput label="הערות לחשבונית..." value={formNotes} onChangeText={setFormNotes}
                mode="outlined" multiline numberOfLines={3} style={[styles.formInput, { textAlign }]}
                activeOutlineColor={BRAND_COLOR} />
            </View>

            <Button
              mode="contained"
              onPress={handleSave}
              loading={saving}
              disabled={saving}
              style={[styles.saveButton, { backgroundColor: docColor }]}
              textColor="#FFF"
              contentStyle={{ paddingVertical: 6 }}
              icon="content-save-outline"
            >
              שמור חשבונית
            </Button>
          </ScrollView>
        </KeyboardAvoidingView>

        {/* Contact Picker Modal */}
        <Portal>
          <Modal
            visible={contactPickerVisible}
            onDismiss={() => { setContactPickerVisible(false); setContactSearch(''); setContactResults([]); }}
            contentContainerStyle={[styles.inventoryModal, { backgroundColor: theme.colors.surface }]}
          >
            <View style={[styles.inventoryHeader, { flexDirection }]}>
              <Text variant="titleMedium" style={{ color: theme.colors.onSurface, fontWeight: '700', flex: 1, textAlign }}>
                חפש איש קשר
              </Text>
              <IconButton icon="close" size={20} onPress={() => { setContactPickerVisible(false); setContactSearch(''); setContactResults([]); }} />
            </View>
            <Searchbar
              placeholder="חפש לפי שם או טלפון..."
              value={contactSearch}
              onChangeText={handleContactSearch}
              style={{ marginHorizontal: 12, marginBottom: 8 }}
              autoFocus
              loading={contactSearching}
            />
            <FlatList
              data={contactResults}
              keyExtractor={(item) => item.id || item.phoneNumber || String(Math.random())}
              style={{ maxHeight: 380 }}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.contactRow, { flexDirection, borderBottomWidth: 1, borderBottomColor: theme.colors.outlineVariant }]}
                  onPress={() => handleSelectContact(item)}
                >
                  <View style={[styles.contactAvatarSm, { backgroundColor: BRAND_COLOR + '20' }]}>
                    <Text style={{ color: BRAND_COLOR, fontWeight: '700', fontSize: 13 }}>
                      {(item.fullName || item.name || '?').charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text variant="bodyMedium" style={{ color: theme.colors.onSurface, fontWeight: '600', textAlign }}>
                      {item.fullName || item.name}
                    </Text>
                    {(item.phoneNumber || item.phone) ? (
                      <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant, textAlign }}>
                        {item.phoneNumber || item.phone}
                      </Text>
                    ) : null}
                  </View>
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center', margin: 24 }}>
                  {contactSearch.length >= 2 && !contactSearching ? 'לא נמצאו תוצאות' : 'הקלד לחיפוש...'}
                </Text>
              }
            />
          </Modal>
        </Portal>

        {/* Catalog Picker Modal */}
        <Portal>
          <Modal
            visible={catalogVisible}
            onDismiss={() => { setCatalogVisible(false); setCatalogSearch(''); }}
            contentContainerStyle={[styles.inventoryModal, { backgroundColor: theme.colors.surface }]}
          >
            <View style={[styles.modalHeader, { flexDirection }]}>
              <Text variant="titleMedium" style={{ color: theme.colors.onSurface, fontWeight: '700' }}>בחר מקטלוג</Text>
              <IconButton icon="close" size={20} onPress={() => { setCatalogVisible(false); setCatalogSearch(''); }} />
            </View>
            <TextInput
              label="חפש פריט..."
              value={catalogSearch}
              onChangeText={setCatalogSearch}
              mode="outlined"
              dense
              style={{ marginBottom: 10 }}
              activeOutlineColor={BRAND_COLOR}
              right={<TextInput.Icon icon="magnify" />}
            />
            <ScrollView style={{ maxHeight: 350 }} keyboardShouldPersistTaps="handled">
              {catalogLoading && <ActivityIndicator size="small" color={BRAND_COLOR} style={{ marginVertical: 20 }} />}
              {!catalogLoading && filteredCatalog.length === 0 && (
                <Text style={{ textAlign: 'center', color: theme.colors.onSurfaceVariant, padding: 20 }}>לא נמצאו פריטים בקטלוג</Text>
              )}
              {filteredCatalog.map((item, i) => (
                <React.Fragment key={i}>
                  {i > 0 && <Divider />}
                  <TouchableOpacity onPress={() => addFromCatalog(item)} style={styles.inventoryRow}>
                    <View style={{ flex: 1 }}>
                      <Text variant="bodySmall" style={{ fontWeight: '600', color: theme.colors.onSurface }}>
                        {item.name || item.description || ''}
                      </Text>
                      {item.description && item.name && (
                        <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>{item.description}</Text>
                      )}
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
  if (!invoice) return null;

  const docColor = getDocColor(invoice.type);
  const statusColor = getStatusColor(invoice.status);

  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
      <Appbar.Header style={{ backgroundColor: docColor }} mode="center-aligned">
        <Appbar.BackAction onPress={() => router.back()} color="#FFF" />
        <Appbar.Content
          title={`${getDocLabel(invoice.type)}${invoice.documentNumber ? ` #${invoice.documentNumber}` : ''}`}
          titleStyle={{ color: '#FFF', fontWeight: '700', fontSize: 16 }}
        />
      </Appbar.Header>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Status */}
        <View style={[styles.section, { backgroundColor: theme.colors.surface }]}>
          <View style={[{ flexDirection, justifyContent: 'space-between', alignItems: 'center' }]}>
            <View>
              <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>סטטוס</Text>
              <Chip style={{ backgroundColor: `${statusColor}15`, marginTop: 4, alignSelf: 'flex-start' }}
                textStyle={{ color: statusColor, fontWeight: '700' }}>
                {getStatusLabel(invoice.status)}
              </Chip>
            </View>
            <Chip style={{ backgroundColor: `${docColor}15` }} textStyle={{ color: docColor, fontWeight: '600', fontSize: 11 }}>
              {getDocLabel(invoice.type)}
            </Chip>
          </View>
        </View>

        {/* Client Info */}
        <Pressable
          style={[styles.section, { backgroundColor: theme.colors.surface }]}
          onPress={() => {
            const cid = invoice.contactId;
            const phone = invoice.contactPhone;
            if (cid) {
              router.push({ pathname: '/(tabs)/contacts/[id]', params: { id: cid } });
            } else if (phone) {
              router.push({ pathname: '/(tabs)/chats/[phoneNumber]', params: { phoneNumber: phone.replace(/\D/g, '') } });
            }
          }}
          disabled={!invoice.contactId && !invoice.contactPhone}
        >
          <View style={[{ flexDirection, alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }]}>
            <Text variant="titleSmall" style={[styles.sectionTitle, { color: theme.colors.onSurface, marginBottom: 0 }]}>לקוח</Text>
            {(invoice.contactId || invoice.contactPhone) ? (
              <MaterialCommunityIcons name={isRTL ? 'chevron-left' : 'chevron-right'} size={18} color={BRAND_COLOR} />
            ) : null}
          </View>
          <Divider style={{ marginBottom: 12 }} />
          {invoice.contactName ? (
            <View style={[{ flexDirection, alignItems: 'center', marginBottom: 8, gap: 8 }]}>
              <MaterialCommunityIcons name="account-outline" size={16} color={theme.colors.onSurfaceVariant} />
              <Text variant="bodyMedium" style={{ color: invoice.contactId ? BRAND_COLOR : theme.colors.onSurface, fontWeight: invoice.contactId ? '600' : '400' }}>
                {invoice.contactName}
              </Text>
            </View>
          ) : null}
          {invoice.contactPhone ? (
            <View style={[{ flexDirection, alignItems: 'center', marginBottom: 8, gap: 8 }]}>
              <MaterialCommunityIcons name="phone-outline" size={16} color={theme.colors.onSurfaceVariant} />
              <Text variant="bodyMedium" style={{ color: theme.colors.onSurface }}>{invoice.contactPhone}</Text>
            </View>
          ) : null}
          {invoice.contactEmail ? (
            <View style={[{ flexDirection, alignItems: 'center', marginBottom: 8, gap: 8 }]}>
              <MaterialCommunityIcons name="email-outline" size={16} color={theme.colors.onSurfaceVariant} />
              <Text variant="bodyMedium" style={{ color: theme.colors.onSurface }}>{invoice.contactEmail}</Text>
            </View>
          ) : null}
          {invoice.contactCompany ? (
            <View style={[{ flexDirection, alignItems: 'center', marginBottom: 8, gap: 8 }]}>
              <MaterialCommunityIcons name="domain" size={16} color={theme.colors.onSurfaceVariant} />
              <Text variant="bodyMedium" style={{ color: theme.colors.onSurface }}>{invoice.contactCompany}</Text>
            </View>
          ) : null}
        </Pressable>

        {/* Dates */}
        <View style={[styles.section, { backgroundColor: theme.colors.surface }]}>
          <Text variant="titleSmall" style={[styles.sectionTitle, { color: theme.colors.onSurface }]}>תאריכים</Text>
          <Divider style={{ marginBottom: 12 }} />
          {invoice.date ? (
            <View style={[{ flexDirection, justifyContent: 'space-between', marginBottom: 8 }]}>
              <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>תאריך הוצאה</Text>
              <Text variant="bodySmall" style={{ color: theme.colors.onSurface }}>{formatDate(invoice.date)}</Text>
            </View>
          ) : null}
          {invoice.dueDate ? (
            <View style={[{ flexDirection, justifyContent: 'space-between', marginBottom: 8 }]}>
              <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>תאריך פירעון</Text>
              <Text variant="bodySmall" style={{ color: theme.colors.onSurface }}>{formatDate(invoice.dueDate)}</Text>
            </View>
          ) : null}
        </View>

        {/* Items */}
        {invoice.items && invoice.items.length > 0 ? (
          <View style={[styles.section, { backgroundColor: theme.colors.surface }]}>
            <Text variant="titleSmall" style={[styles.sectionTitle, { color: theme.colors.onSurface }]}>
              פריטים ({invoice.items.length})
            </Text>
            <Divider style={{ marginBottom: 12 }} />
            {invoice.items.map((item, idx) => (
              <View key={idx} style={[{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: idx < invoice.items!.length - 1 ? StyleSheet.hairlineWidth : 0, borderBottomColor: theme.colors.outlineVariant }]}>
                <View style={{ flex: 1 }}>
                  <Text variant="bodySmall" style={{ color: theme.colors.onSurface, fontWeight: '600' }}>{item.description}</Text>
                  <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>×{item.quantity}</Text>
                </View>
                <Text variant="bodyMedium" style={{ color: docColor, fontWeight: '700' }}>
                  ₪{((item.unitPrice || 0) * (item.quantity || 0)).toFixed(2)}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        {/* Totals */}
        {invoice.total != null ? (
          <View style={[styles.section, { backgroundColor: theme.colors.surface }]}>
            <Text variant="titleSmall" style={[styles.sectionTitle, { color: theme.colors.onSurface }]}>סיכום</Text>
            <Divider style={{ marginBottom: 12 }} />
            {invoice.subtotal != null && (
              <View style={[{ flexDirection, justifyContent: 'space-between', marginBottom: 6 }]}>
                <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>ביניים</Text>
                <Text variant="bodySmall" style={{ color: theme.colors.onSurface }}>₪{Number(invoice.subtotal).toFixed(2)}</Text>
              </View>
            )}
            {invoice.vatAmount != null && (
              <View style={[{ flexDirection, justifyContent: 'space-between', marginBottom: 6 }]}>
                <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>מע"מ ({invoice.vatRate || 18}%)</Text>
                <Text variant="bodySmall" style={{ color: theme.colors.onSurface }}>₪{Number(invoice.vatAmount).toFixed(2)}</Text>
              </View>
            )}
            <Divider style={{ marginVertical: 8 }} />
            <View style={[{ flexDirection, justifyContent: 'space-between' }]}>
              <Text variant="titleSmall" style={{ color: theme.colors.onSurface, fontWeight: '700' }}>סה"כ</Text>
              <Text variant="titleSmall" style={{ color: docColor, fontWeight: '700' }}>₪{Number(invoice.total).toFixed(2)}</Text>
            </View>
          </View>
        ) : null}

        {/* Notes */}
        {invoice.notes ? (
          <View style={[styles.section, { backgroundColor: theme.colors.surface }]}>
            <Text variant="titleSmall" style={[styles.sectionTitle, { color: theme.colors.onSurface }]}>הערות</Text>
            <Divider style={{ marginBottom: 12 }} />
            <Text variant="bodyMedium" style={{ color: theme.colors.onSurface, lineHeight: 22 }}>{invoice.notes}</Text>
          </View>
        ) : null}
      </ScrollView>
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
  selectorBtn: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    alignItems: 'center',
    gap: 10,
    marginBottom: 4,
  },
  colorDot: { width: 12, height: 12, borderRadius: 6 },
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
  saveButton: { borderRadius: 12, marginTop: 8 },
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
  inventoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 8,
  },
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
    width: 30,
    height: 30,
    borderRadius: 15,
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
});
