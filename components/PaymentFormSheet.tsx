import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, View, Alert, Pressable, ScrollView, Linking, ActivityIndicator, Switch } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useRTL } from '../hooks/useRTL';
import { paymentsApi } from '../services/api/payments';
import { contactsApi } from '../services/api/contacts';
import { leadsApi } from '../services/api/leads';
import { ordersApi } from '../services/api/orders';
import { casesApi } from '../services/api/cases';
import { catalogApi, type CatalogItem } from '../services/api/catalog';
import { sendDocAndAlert } from '../utils/sendDocAlert';
import {
  TaskFormFrame,
  TaskFormHeader,
  TaskFormBody,
  TaskFormSubmitBar,
  FormTextField,
  FormSectionLabel,
  ChoiceChips,
} from './tasks/TaskFormParts';

const BRAND = '#2e6155';
const VAT_RATE = 18;

export interface PaymentItem {
  name: string;
  unitPrice: number;
  quantity: number;
  sku?: string;
  image?: string;
}

type LinkType = 'contact' | 'lead' | 'order' | 'case';

interface LinkedRecord {
  type: LinkType | string;
  id: string;
  name: string;
  phone: string;
  email: string;
}

interface Props {
  visible: boolean;
  onDismiss: () => void;
  /** Called after a payment link was created (so the caller can refresh its list). */
  onDone?: () => void;
  user: any;
  /** The record the sheet was opened from (lead / quote / order / case / contact). Prefills the "link to" field. */
  entityType?: string;
  entityId?: string;
  amount?: string | number;
  description?: string;
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  /** Prefilled line items (lead's products, quote lines, order lines). The amount follows their total. */
  items?: PaymentItem[];
  /** Pins the VAT switch (e.g. a quote's total already includes its tax). Otherwise the org default is used. */
  forceVatInclusive?: boolean;
}

const digits = (v?: string) => (v || '').replace(/\D/g, '');
const itemsTotal = (items: PaymentItem[]) => items.reduce((s, it) => s + (Number(it.unitPrice) || 0) * (Number(it.quantity) || 1), 0);

/**
 * "New payment" — same as the web payment modal (Payment link tab):
 *  • who the payment belongs to (contact / lead / order / case — prefilled when opened from a record),
 *  • whether the amount includes VAT (default = the org's clearing setting; when off, VAT is added to the amount),
 *  • items (from the catalog or typed in; prefilled from a lead's products / a quote's lines) — the amount follows their total.
 */
export default function PaymentFormSheet({
  visible, onDismiss, onDone, user,
  entityType, entityId, amount: initialAmount, description: initialDescription,
  customerName, customerPhone, customerEmail, items: initialItems, forceVatInclusive,
}: Props) {
  const { isRTL } = useRTL();
  const tr = (he: string, en: string) => (isRTL ? he : en);
  const organization: string = user?.organization || '';

  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [installments, setInstallments] = useState('1');
  const [vatInclusive, setVatInclusive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ url: string; amount: number } | null>(null);
  const [sendingWa, setSendingWa] = useState(false);

  // who the payment belongs to
  const [custName, setCustName] = useState('');
  const [custPhone, setCustPhone] = useState('');
  const [custEmail, setCustEmail] = useState('');
  const [linked, setLinked] = useState<LinkedRecord | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [linkType, setLinkType] = useState<LinkType>('contact');
  const [linkSearch, setLinkSearch] = useState('');
  const [linkRecords, setLinkRecords] = useState<LinkedRecord[]>([]);
  const [linkLoading, setLinkLoading] = useState(false);
  const linkSeq = useRef(0);

  // items
  const [items, setItems] = useState<PaymentItem[]>([]);
  const [itemsOpen, setItemsOpen] = useState(false);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [catalogLoaded, setCatalogLoaded] = useState(false);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [catalogSearch, setCatalogSearch] = useState('');

  // ── reset every time the sheet opens ──
  useEffect(() => {
    if (!visible) return;
    const startItems = (initialItems || []).filter((it) => it && (it.name || it.unitPrice));
    setItems(startItems);
    setItemsOpen(startItems.length > 0);
    setCatalogOpen(false);
    setCatalogSearch('');
    setAmount(startItems.length > 0 ? String(itemsTotal(startItems)) : (initialAmount !== undefined && initialAmount !== null && initialAmount !== '' ? String(initialAmount) : ''));
    setDescription(initialDescription || '');
    setInstallments('1');
    setBusy(false);
    setResult(null);
    setSendingWa(false);
    setCustName(customerName || '');
    setCustPhone(customerPhone || '');
    setCustEmail(customerEmail || '');
    setPickerOpen(false);
    setLinkSearch('');
    setLinkRecords([]);
    if (entityType && entityId) {
      setLinked({ type: entityType, id: entityId, name: customerName || '', phone: customerPhone || '', email: customerEmail || '' });
      setLinkType((['contact', 'lead', 'order', 'case'] as string[]).includes(entityType) ? (entityType as LinkType) : 'contact');
    } else {
      setLinked(null);
      setLinkType('contact');
    }
    // VAT default comes from the org's clearing settings, exactly like the web
    setVatInclusive(forceVatInclusive !== undefined ? forceVatInclusive : true);
    if (organization) {
      paymentsApi.getClearingSettings(organization)
        .then((s) => {
          if (forceVatInclusive !== undefined) { setVatInclusive(forceVatInclusive); return; }
          if (s && s.defaultVatInclusive !== undefined) setVatInclusive(!!s.defaultVatInclusive);
        })
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // The amount follows the items' total while there are items (as on the web)
  useEffect(() => {
    if (itemsOpen && items.length > 0) {
      const total = itemsTotal(items);
      if (total > 0) setAmount(String(Math.round(total * 100) / 100));
    }
  }, [items, itemsOpen]);

  // ── "link to" records ──
  const loadLinkRecords = useCallback(async (type: LinkType, search: string) => {
    if (!organization) return;
    const seq = ++linkSeq.current;
    setLinkLoading(true);
    try {
      let list: LinkedRecord[] = [];
      const term = search.trim();
      if (type === 'contact') {
        const rows: any[] = await contactsApi.searchForForward(organization, { search: term, pageSize: 40, userId: user?.uID || user?.userId || '', dataVisibility: user?.dataVisibility || 'all' });
        list = rows.map((c: any) => {
          const phone = c.phoneNumber || c.PhoneNumber || c.id || '';
          return { type, id: digits(phone), name: c.name || c.fullName || c.Name || '', phone, email: c.email || c.Email || '' };
        });
      } else if (type === 'lead') {
        const res = await leadsApi.getAll(organization, { page: 1, pageSize: 40, filters: { searchTerm: term }, userId: user?.uID || user?.userId || '', dataVisibility: user?.dataVisibility || 'seeAll' });
        list = (res.data as any[]).map((l: any) => ({
          type, id: l.id, name: l.contactName || l.title || '', phone: l.contactPhone || l.phoneNumber || '', email: l.contactEmail || l.email || '',
        }));
      } else if (type === 'order') {
        const rows: any[] = await ordersApi.getAll(organization);
        const q = term.toLowerCase();
        list = rows
          .map((o: any) => ({
            type, id: o.id, name: o.customerName || `#${o.orderNumber || o.id}`, phone: o.customerPhone || '', email: o.customerEmail || '',
          }))
          .filter((r) => !q || r.name.toLowerCase().includes(q) || r.phone.includes(q))
          .slice(0, 60);
      } else if (type === 'case') {
        const res = await casesApi.getAll(organization, { page: 1, pageSize: 40, filters: { searchTerm: term }, userId: user?.uID || user?.userId || '', dataVisibility: user?.dataVisibility || 'seeAll' });
        list = (res.data as any[]).map((c: any) => ({
          type, id: c.id, name: c.subject || c.title || c.contactName || `#${c.id}`, phone: c.contactPhone || c.phoneNumber || '', email: c.contactEmail || c.email || '',
        }));
      }
      if (seq === linkSeq.current) setLinkRecords(list);
    } catch {
      if (seq === linkSeq.current) setLinkRecords([]);
    } finally {
      if (seq === linkSeq.current) setLinkLoading(false);
    }
  }, [organization, user]);

  // search as you type (debounced) while the picker is open
  useEffect(() => {
    if (!visible || !pickerOpen) return;
    const h = setTimeout(() => { loadLinkRecords(linkType, linkSearch); }, linkSearch ? 350 : 0);
    return () => clearTimeout(h);
  }, [visible, pickerOpen, linkType, linkSearch, loadLinkRecords]);

  const pickRecord = (rec: LinkedRecord) => {
    setLinked({ ...rec, type: linkType });
    if (rec.name) setCustName(rec.name);
    if (rec.phone) setCustPhone(rec.phone);
    setCustEmail(rec.email || '');
    setPickerOpen(false);
    setLinkSearch('');
  };

  const clearLinked = () => {
    setLinked(null);
    setPickerOpen(true);
  };

  const linkTypeLabel = (type: string) =>
    ({ contact: tr('איש קשר', 'Contact'), lead: tr('ליד', 'Lead'), order: tr('הזמנה', 'Order'), case: tr('פנייה', 'Case'), quote: tr('הצעת מחיר', 'Quote') } as Record<string, string>)[type] || type;

  // ── items ──
  const loadCatalog = useCallback(async () => {
    if (catalogLoaded || catalogLoading || !organization) return;
    setCatalogLoading(true);
    try {
      const data = await catalogApi.getAll(organization);
      setCatalog(data.catalogItems || []);
    } catch { /* ignore */ }
    setCatalogLoaded(true);
    setCatalogLoading(false);
  }, [catalogLoaded, catalogLoading, organization]);

  const filteredCatalog = useMemo(() => {
    const q = catalogSearch.trim().toLowerCase();
    const list = q ? catalog.filter((c) => (c.name || '').toLowerCase().includes(q) || (c.sku || '').toLowerCase().includes(q)) : catalog;
    return list.slice(0, 40);
  }, [catalog, catalogSearch]);

  const addCatalogItem = (ci: CatalogItem) => {
    setItemsOpen(true);
    setItems((prev) => [...prev, { name: ci.name || ci.description || '', unitPrice: Number(ci.unitPrice) || 0, quantity: 1, sku: ci.sku || '', image: Array.isArray(ci.images) ? (ci.images[0] || '') : '' }]);
  };
  const updateItem = (idx: number, patch: Partial<PaymentItem>) => setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  const removeItem = (idx: number) => setItems((prev) => prev.filter((_, i) => i !== idx));

  // ── submit (same association logic as the web's buildAssociation) ──
  const buildAssociation = () => {
    let aEntityType = entityType || '';
    let aEntityId = entityId || '';
    let aLinkedType = '';
    let aLinkedId = '';
    let aLinkedName = custName || '';
    if (linked && linked.type) {
      if (linked.type === 'contact') {
        aLinkedType = 'contact';
        aLinkedId = linked.id || '';
        aLinkedName = linked.name || custName || '';
        if (!entityType || entityType === 'contact') { aEntityType = ''; aEntityId = ''; }
      } else {
        aEntityType = linked.type;
        aEntityId = linked.id || '';
        if (linked.type === 'lead') {
          aLinkedType = 'lead';
          aLinkedId = linked.id || '';
          aLinkedName = linked.name || custName || '';
        }
      }
    }
    return { aEntityType, aEntityId, aLinkedType, aLinkedId, aLinkedName };
  };

  const baseAmount = parseFloat(String(amount).replace(',', '.')) || 0;
  const amountWithVat = vatInclusive ? baseAmount : Math.round(baseAmount * (1 + VAT_RATE / 100) * 100) / 100;

  const submit = async () => {
    if (!baseAmount || baseAmount <= 0) {
      Alert.alert(tr('שגיאה', 'Error'), tr('נא להזין סכום תקין', 'Please enter a valid amount'));
      return;
    }
    setBusy(true);
    try {
      const { aEntityType, aEntityId, aLinkedType, aLinkedId, aLinkedName } = buildAssociation();
      const cleanItems = itemsOpen ? items.filter((it) => it.name?.trim() || it.unitPrice) : [];
      const res = await paymentsApi.createPaymentLink(organization, {
        amount: amountWithVat,
        description: description.trim(),
        customerName: custName || '',
        customerPhone: custPhone || '',
        customerEmail: custEmail.trim(),
        entityType: aEntityType,
        entityId: aEntityId,
        payments: parseInt(installments, 10) || 1,
        items: cleanItems,
        vatInclusive,
        linkedRecordType: aLinkedType,
        linkedRecordId: aLinkedId,
        linkedRecordName: aLinkedName,
      });
      const url = res?.gambotPaymentUrl || res?.paymentUrl;
      if (!res?.success || !url) {
        Alert.alert(tr('שגיאה', 'Error'), res?.error || tr('יצירת קישור התשלום נכשלה', 'Could not create the payment link'));
        return;
      }
      setResult({ url, amount: amountWithVat });
      onDone?.();
    } catch (e: any) {
      Alert.alert(tr('שגיאה', 'Error'), e?.message || tr('יצירת קישור התשלום נכשלה', 'Could not create the payment link'));
    } finally {
      setBusy(false);
    }
  };

  const sendWhatsApp = async () => {
    if (!result || !custPhone) return;
    setSendingWa(true);
    const amountTxt = result.amount.toFixed(2);
    await sendDocAndAlert({
      organization,
      phone: custPhone,
      role: 'sendPaymentLink',
      user,
      customerName: custName || '',
      docLabel: description.trim() ? `${description.trim()} - ₪${amountTxt}` : `תשלום על סך ₪${amountTxt}`,
      url: result.url,
      liveText: `שלום ${custName || ''},\nקישור לתשלום על סך ₪${amountTxt}${description.trim() ? ` (${description.trim()})` : ''}:`,
    });
    setSendingWa(false);
  };

  const chip = (active: boolean) => ({
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1,
    borderColor: active ? BRAND : '#d1d5db', backgroundColor: active ? '#e8f5f0' : '#fff',
  } as const);
  const rowDir = isRTL ? 'row-reverse' : 'row';
  const align = isRTL ? 'right' : 'left';

  const renderResult = () => (
    <View style={{ alignItems: 'center', paddingVertical: 12, gap: 10 }}>
      <MaterialCommunityIcons name="check-circle" size={56} color="#16a34a" />
      <Text variant="titleMedium" style={{ color: '#16a34a', fontWeight: '700' }}>{tr('לינק תשלום נוצר!', 'Payment link created!')}</Text>
      <Text variant="bodySmall" style={{ color: '#64748b' }}>{tr('סכום', 'Amount')}: ₪{result!.amount.toFixed(2)}</Text>
      <View style={{ backgroundColor: '#f8fafc', borderColor: '#e2e8f0', borderWidth: 1, borderRadius: 10, padding: 10, alignSelf: 'stretch' }}>
        <Text selectable style={{ fontSize: 12, color: '#334155', textAlign: 'center' }}>{result!.url}</Text>
      </View>
      <View style={{ flexDirection: rowDir, gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
        <Pressable onPress={() => { Clipboard.setStringAsync(result!.url); Alert.alert(tr('הועתק', 'Copied')); }} style={[chip(false), { flexDirection: rowDir, gap: 6, alignItems: 'center' }]}>
          <MaterialCommunityIcons name="content-copy" size={15} color="#475569" />
          <Text style={{ fontSize: 13, color: '#475569' }}>{tr('העתק', 'Copy')}</Text>
        </Pressable>
        <Pressable onPress={() => Linking.openURL(result!.url)} style={[chip(false), { flexDirection: rowDir, gap: 6, alignItems: 'center' }]}>
          <MaterialCommunityIcons name="open-in-new" size={15} color={BRAND} />
          <Text style={{ fontSize: 13, color: BRAND }}>{tr('פתח', 'Open')}</Text>
        </Pressable>
        {custPhone ? (
          <Pressable disabled={sendingWa} onPress={sendWhatsApp} style={{ opacity: sendingWa ? 0.6 : 1, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, backgroundColor: '#25D366', flexDirection: rowDir, gap: 6, alignItems: 'center' }}>
            <MaterialCommunityIcons name="whatsapp" size={16} color="#fff" />
            <Text style={{ fontSize: 13, color: '#fff', fontWeight: '600' }}>{tr('שלח בוואטסאפ', 'Send on WhatsApp')}</Text>
          </Pressable>
        ) : null}
      </View>
      <Pressable onPress={() => setResult(null)} style={{ marginTop: 6 }}>
        <Text style={{ color: '#64748b', fontSize: 13 }}>{tr('תשלום נוסף', 'New payment')}</Text>
      </Pressable>
    </View>
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss} statusBarTranslucent>
      <TaskFormFrame dim onBackdropPress={onDismiss}>
        <TaskFormHeader title={tr('סליקה ותשלומים', 'Payments')} onClose={onDismiss} />
        <TaskFormBody>
          {result ? renderResult() : (
            <>
              {/* Who the payment belongs to */}
              <FormSectionLabel icon="link-variant">{tr('שיוך לרשומה', 'Link to record')}</FormSectionLabel>
              {linked ? (
                <View style={{ flexDirection: rowDir, alignItems: 'center', gap: 8, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: '#bbf7d0', backgroundColor: '#f0fdf4' }}>
                  <MaterialCommunityIcons name="link-variant" size={18} color={BRAND} />
                  <View style={{ flex: 1 }}>
                    <Text numberOfLines={1} style={{ fontWeight: '700', color: '#166534', textAlign: align }}>{linked.name || custName || tr('רשומה ללא שם', 'Unnamed record')}</Text>
                    <Text numberOfLines={1} style={{ fontSize: 12, color: '#15803d', textAlign: align }}>
                      {linkTypeLabel(linked.type)}{(linked.phone || custPhone) ? ` • ${linked.phone || custPhone}` : ''}
                    </Text>
                  </View>
                  <Pressable onPress={clearLinked} hitSlop={8}>
                    <MaterialCommunityIcons name="close-circle" size={20} color="#64748b" />
                  </Pressable>
                </View>
              ) : !pickerOpen ? (
                <Pressable onPress={() => setPickerOpen(true)} style={{ flexDirection: rowDir, alignItems: 'center', gap: 8, padding: 12, borderRadius: 10, borderWidth: 1, borderStyle: 'dashed', borderColor: '#cbd5e1' }}>
                  <MaterialCommunityIcons name="account-search-outline" size={18} color="#94a3b8" />
                  <Text style={{ color: '#475569', flex: 1, textAlign: align }}>{tr('שייך לאיש קשר / ליד / הזמנה / פנייה', 'Link to a contact / lead / order / case')}</Text>
                </Pressable>
              ) : null}
              {!linked && pickerOpen ? (
                <View style={{ borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 10, padding: 10, backgroundColor: '#f8fafc', gap: 8 }}>
                  <View style={{ flexDirection: rowDir, gap: 6, flexWrap: 'wrap' }}>
                    {(['contact', 'lead', 'order', 'case'] as LinkType[]).map((lt) => (
                      <Pressable key={lt} onPress={() => { setLinkType(lt); setLinkSearch(''); setLinkRecords([]); }} style={chip(linkType === lt)}>
                        <Text style={{ fontSize: 13, color: linkType === lt ? BRAND : '#475569', fontWeight: linkType === lt ? '700' : '400' }}>{linkTypeLabel(lt)}</Text>
                      </Pressable>
                    ))}
                  </View>
                  <FormTextField label={tr('חיפוש לפי שם / טלפון', 'Search by name / phone')} value={linkSearch} onChangeText={setLinkSearch} />
                  <View style={{ maxHeight: 190, borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8, backgroundColor: '#fff' }}>
                    {linkLoading ? (
                      <View style={{ padding: 14, alignItems: 'center' }}><ActivityIndicator color={BRAND} /></View>
                    ) : linkRecords.length === 0 ? (
                      <Text style={{ padding: 14, textAlign: 'center', color: '#94a3b8' }}>{tr('לא נמצאו רשומות', 'No records found')}</Text>
                    ) : (
                      <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled">
                        {linkRecords.map((r, i) => (
                          <Pressable key={`${r.id}_${i}`} onPress={() => pickRecord(r)} style={{ flexDirection: rowDir, alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' }}>
                            <Text numberOfLines={1} style={{ flex: 1, color: '#334155', textAlign: align }}>{r.name || tr('(ללא שם)', '(no name)')}</Text>
                            {r.phone ? <Text style={{ fontSize: 12, color: '#94a3b8' }}>{r.phone}</Text> : null}
                          </Pressable>
                        ))}
                      </ScrollView>
                    )}
                  </View>
                  <Pressable onPress={() => setPickerOpen(false)}><Text style={{ color: '#64748b', fontSize: 13 }}>{tr('ביטול', 'Cancel')}</Text></Pressable>
                </View>
              ) : null}

              {/* Amount + VAT */}
              <FormTextField
                label={`${tr('סכום', 'Amount')} (₪)`}
                value={amount}
                onChangeText={setAmount}
                keyboardType="decimal-pad"
              />
              <View style={{ flexDirection: rowDir, alignItems: 'center', gap: 8, marginTop: 2 }}>
                <Switch value={vatInclusive} onValueChange={setVatInclusive} trackColor={{ true: BRAND }} />
                <Text style={{ color: '#475569', flex: 1, textAlign: align }}>
                  {tr('כולל מע"מ', 'VAT inclusive')}
                  {!vatInclusive && baseAmount > 0 ? <Text style={{ color: '#dc2626', fontWeight: '600' }}>{`  (+${VAT_RATE}% ${tr('מע"מ', 'VAT')} = ₪${amountWithVat.toFixed(2)})`}</Text> : null}
                </Text>
              </View>

              <FormTextField label={tr('תיאור', 'Description')} value={description} onChangeText={setDescription} />

              {/* Items */}
              <Pressable
                onPress={() => { const next = !itemsOpen; setItemsOpen(next); if (next) { setCatalogOpen(true); loadCatalog(); } }}
                style={{ flexDirection: rowDir, alignItems: 'center', gap: 6, paddingVertical: 6 }}
              >
                <MaterialCommunityIcons name="cart-outline" size={18} color={BRAND} />
                <Text style={{ color: BRAND, fontWeight: '600' }}>
                  {itemsOpen ? tr('הסתר פריטים', 'Hide items') : tr('הוסף פריטים / מוצרים', 'Add items / products')}
                  {items.length > 0 ? `  (${items.length})` : ''}
                </Text>
              </Pressable>
              {itemsOpen ? (
                <View style={{ borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 10, padding: 10, backgroundColor: '#f8fafc', gap: 8 }}>
                  <View style={{ flexDirection: rowDir, gap: 8 }}>
                    <Pressable onPress={() => { const n = !catalogOpen; setCatalogOpen(n); if (n) loadCatalog(); }} style={chip(catalogOpen)}>
                      <Text style={{ fontSize: 13, color: catalogOpen ? BRAND : '#475569' }}>{tr('בחר מהקטלוג', 'From catalog')}</Text>
                    </Pressable>
                    <Pressable onPress={() => setItems((p) => [...p, { name: '', unitPrice: 0, quantity: 1 }])} style={chip(false)}>
                      <Text style={{ fontSize: 13, color: '#475569' }}>{tr('פריט ידני', 'Manual item')}</Text>
                    </Pressable>
                  </View>
                  {catalogOpen ? (
                    <View style={{ gap: 6 }}>
                      <FormTextField label={tr('חיפוש מוצר', 'Search product')} value={catalogSearch} onChangeText={setCatalogSearch} />
                      <View style={{ maxHeight: 170, borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8, backgroundColor: '#fff' }}>
                        {catalogLoading ? (
                          <View style={{ padding: 14, alignItems: 'center' }}><ActivityIndicator color={BRAND} /></View>
                        ) : filteredCatalog.length === 0 ? (
                          <Text style={{ padding: 14, textAlign: 'center', color: '#94a3b8' }}>{tr('לא נמצאו מוצרים בקטלוג', 'No catalog products found')}</Text>
                        ) : (
                          <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled">
                            {filteredCatalog.map((ci, i) => (
                              <Pressable key={ci.id || i} onPress={() => addCatalogItem(ci)} style={{ flexDirection: rowDir, alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' }}>
                                <Text numberOfLines={1} style={{ flex: 1, color: '#334155', textAlign: align }}>{ci.name || ci.description}{ci.sku ? ` (${ci.sku})` : ''}</Text>
                                <Text style={{ color: BRAND, fontWeight: '600' }}>₪{Number(ci.unitPrice) || 0}</Text>
                                <MaterialCommunityIcons name="plus-circle-outline" size={18} color={BRAND} />
                              </Pressable>
                            ))}
                          </ScrollView>
                        )}
                      </View>
                    </View>
                  ) : null}
                  {items.map((it, idx) => (
                    <View key={idx} style={{ flexDirection: rowDir, alignItems: 'center', gap: 6 }}>
                      <View style={{ flex: 1 }}>
                        <FormTextField label={tr('שם פריט', 'Item name')} value={it.name} onChangeText={(v) => updateItem(idx, { name: v })} />
                      </View>
                      <View style={{ width: 78 }}>
                        <FormTextField label={tr('מחיר', 'Price')} value={it.unitPrice ? String(it.unitPrice) : ''} keyboardType="decimal-pad" onChangeText={(v) => updateItem(idx, { unitPrice: parseFloat(v.replace(',', '.')) || 0 })} />
                      </View>
                      <View style={{ width: 56 }}>
                        <FormTextField label={tr('כמות', 'Qty')} value={String(it.quantity ?? 1)} keyboardType="number-pad" onChangeText={(v) => updateItem(idx, { quantity: parseInt(v, 10) || 1 })} />
                      </View>
                      <Pressable onPress={() => removeItem(idx)} hitSlop={8}>
                        <MaterialCommunityIcons name="trash-can-outline" size={20} color="#ef4444" />
                      </Pressable>
                    </View>
                  ))}
                  {items.length > 0 ? (
                    <Text style={{ fontWeight: '700', color: '#334155', textAlign: isRTL ? 'left' : 'right' }}>
                      {tr('סה"כ', 'Total')}: ₪{itemsTotal(items).toFixed(2)}
                    </Text>
                  ) : null}
                </View>
              ) : null}

              {/* Installments + email */}
              <FormSectionLabel icon="credit-card-multiple-outline">{tr('מספר תשלומים', 'Installments')}</FormSectionLabel>
              <ChoiceChips
                value={installments}
                onChange={setInstallments}
                options={['1', '2', '3', '4', '5', '6', '8', '10', '12'].map((n) => ({ key: n, label: n }))}
              />
              <FormTextField
                label={tr('אימייל הלקוח', 'Customer email')}
                value={custEmail}
                onChangeText={setCustEmail}
                keyboardType="email-address"
                autoCapitalize="none"
              />
            </>
          )}
        </TaskFormBody>
        {!result ? <TaskFormSubmitBar label={tr('צור לינק תשלום', 'Create payment link')} onPress={submit} loading={busy} /> : null}
      </TaskFormFrame>
    </Modal>
  );
}
