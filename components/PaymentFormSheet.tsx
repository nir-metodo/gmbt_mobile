import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, View, Alert, Pressable, ScrollView, Linking, ActivityIndicator, Switch, Share, TextInput as RNTextInput } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useRTL } from '../hooks/useRTL';
import { useAppTheme } from '../hooks/useAppTheme';
import { withAlpha } from '../utils/formatters';
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

  // Looks the contact up by phone (last 9 digits must match exactly) and fills the email (and the name when asked) if still empty.
  const fillEmailFromContact = useCallback(async (phone: string, alsoName = false) => {
    const key = digits(phone).slice(-9);
    if (!organization || key.length < 9) return;
    try {
      const rows: any[] = await contactsApi.search(organization, key, 10);
      const hit = rows.find((c: any) => digits(c.phoneNumber || c.PhoneNumber || c.id).slice(-9) === key);
      if (!hit) return;
      const email = String(hit.email || hit.Email || '').trim();
      if (email) setCustEmail((prev) => prev || email);
      const nm = String(hit.name || hit.fullName || hit.Name || '').trim();
      if (alsoName && nm) setCustName((prev) => prev || nm);
    } catch { /* the email can still be typed in */ }
  }, [organization]);

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
    // The email lives on the contact, not on the lead / quote — pull it in like the web does.
    if (!customerEmail && customerPhone) fillEmailFromContact(customerPhone, !customerName);
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
    if (!rec.email && rec.phone) fillEmailFromContact(rec.phone);
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

  const theme = useAppTheme();
  const ink = theme.colors.onSurface;
  const sub = theme.colors.onSurfaceVariant;
  const hairline = withAlpha(ink, 0.12);
  const cardBg = withAlpha(ink, 0.035);
  const rowDir = isRTL ? 'row-reverse' : 'row';
  const align = isRTL ? 'right' : 'left';
  const [copied, setCopied] = useState(false);
  const [amountFocused, setAmountFocused] = useState(false);

  const pill = (active: boolean) => ({
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1,
    borderColor: active ? BRAND : hairline, backgroundColor: active ? withAlpha(BRAND, 0.12) : 'transparent',
  } as const);

  // A titled section card (plain function, not a component — keeps the inputs inside from losing focus on re-render).
  const card = (title: string, icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'], children: React.ReactNode) => (
    <View style={{ borderWidth: 1, borderColor: hairline, backgroundColor: cardBg, borderRadius: 18, padding: 14, marginBottom: 14, gap: 4 }}>
      <View style={{ flexDirection: rowDir, alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: withAlpha(BRAND, 0.12), alignItems: 'center', justifyContent: 'center' }}>
          <MaterialCommunityIcons name={icon} size={16} color={BRAND} />
        </View>
        <Text style={{ fontSize: 14, fontWeight: '700', color: ink, textAlign: align }}>{title}</Text>
      </View>
      {children}
    </View>
  );

  const copyLink = async () => {
    if (!result) return;
    await Clipboard.setStringAsync(result.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const shareLink = async () => {
    if (!result) return;
    const amountTxt = result.amount.toFixed(2);
    try {
      await Share.share({
        message: `${custName ? `שלום ${custName},\n` : ''}קישור לתשלום על סך ₪${amountTxt}:\n${result.url}`,
      });
    } catch { /* user dismissed */ }
  };

  const renderResult = () => (
    <View style={{ alignItems: 'stretch', paddingVertical: 8, gap: 14 }}>
      <View style={{ alignItems: 'center', gap: 6 }}>
        <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: withAlpha('#16a34a', 0.14), alignItems: 'center', justifyContent: 'center' }}>
          <MaterialCommunityIcons name="check-bold" size={38} color="#16a34a" />
        </View>
        <Text style={{ fontSize: 20, fontWeight: '800', color: ink }}>{tr('קישור התשלום מוכן', 'Payment link is ready')}</Text>
        <Text style={{ fontSize: 30, fontWeight: '800', color: BRAND }}>₪{result!.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Text>
        {custName ? <Text style={{ fontSize: 13, color: sub }}>{custName}</Text> : null}
      </View>

      {/* the link */}
      <Pressable onPress={copyLink} style={{ flexDirection: rowDir, alignItems: 'center', gap: 10, borderWidth: 1, borderColor: hairline, backgroundColor: cardBg, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 12 }}>
        <MaterialCommunityIcons name="link-variant" size={20} color={BRAND} />
        <Text numberOfLines={1} selectable style={{ flex: 1, fontSize: 13, color: ink, textAlign: 'left', writingDirection: 'ltr' }}>{result!.url}</Text>
        <MaterialCommunityIcons name={copied ? 'check' : 'content-copy'} size={18} color={copied ? '#16a34a' : sub} />
      </Pressable>

      {/* send by WhatsApp — the number can be typed here if the record has none */}
      {!custPhone ? (
        <FormTextField
          label={tr('טלפון לשליחה בוואטסאפ', 'Phone to send on WhatsApp')}
          value={custPhone}
          onChangeText={setCustPhone}
          keyboardType="phone-pad"
          style={{ marginBottom: 0 }}
        />
      ) : null}
      <Pressable
        disabled={sendingWa || !custPhone}
        onPress={sendWhatsApp}
        style={({ pressed }) => ({ opacity: !custPhone ? 0.45 : sendingWa ? 0.6 : pressed ? 0.88 : 1, height: 52, borderRadius: 16, backgroundColor: '#25D366', flexDirection: rowDir, gap: 10, alignItems: 'center', justifyContent: 'center' })}
      >
        {sendingWa ? <ActivityIndicator color="#fff" /> : <MaterialCommunityIcons name="whatsapp" size={22} color="#fff" />}
        <Text style={{ fontSize: 16, color: '#fff', fontWeight: '700' }}>
          {custPhone ? tr(`שלח בוואטסאפ ל${custName || custPhone}`, `Send on WhatsApp to ${custName || custPhone}`) : tr('שלח בוואטסאפ', 'Send on WhatsApp')}
        </Text>
      </Pressable>

      <View style={{ flexDirection: rowDir, gap: 10 }}>
        {([
          { key: 'copy', icon: copied ? 'check' : 'content-copy', label: copied ? tr('הועתק', 'Copied') : tr('העתק קישור', 'Copy link'), color: copied ? '#16a34a' : BRAND, onPress: copyLink },
          { key: 'share', icon: 'share-variant', label: tr('שתף', 'Share'), color: BRAND, onPress: shareLink },
          { key: 'open', icon: 'open-in-new', label: tr('פתח', 'Open'), color: BRAND, onPress: () => Linking.openURL(result!.url) },
        ] as const).map((b) => (
          <Pressable
            key={b.key}
            onPress={b.onPress}
            style={({ pressed }) => ({ flex: 1, height: 70, borderRadius: 16, borderWidth: 1, borderColor: hairline, backgroundColor: pressed ? withAlpha(BRAND, 0.1) : cardBg, alignItems: 'center', justifyContent: 'center', gap: 4 })}
          >
            <MaterialCommunityIcons name={b.icon} size={22} color={b.color} />
            <Text style={{ fontSize: 12, fontWeight: '600', color: b.color }}>{b.label}</Text>
          </Pressable>
        ))}
      </View>

      <Pressable onPress={() => setResult(null)} style={{ alignSelf: 'center', paddingVertical: 8 }}>
        <Text style={{ color: sub, fontSize: 14, fontWeight: '600' }}>{tr('+ תשלום נוסף', '+ New payment')}</Text>
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
              {/* ── Amount ── */}
              <View style={{ alignItems: 'center', paddingVertical: 14, marginBottom: 14, borderRadius: 20, backgroundColor: withAlpha(BRAND, 0.07), borderWidth: 1.5, borderColor: amountFocused ? BRAND : withAlpha(BRAND, 0.18) }}>
                <Text style={{ fontSize: 12, fontWeight: '700', color: sub, marginBottom: 2 }}>{tr('סכום לתשלום', 'Amount to charge')}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                  <Text style={{ fontSize: 30, fontWeight: '800', color: BRAND }}>₪</Text>
                  <RNTextInput
                    value={amount}
                    onChangeText={setAmount}
                    keyboardType="decimal-pad"
                    placeholder="0"
                    placeholderTextColor={withAlpha(ink, 0.25)}
                    onFocus={() => setAmountFocused(true)}
                    onBlur={() => setAmountFocused(false)}
                    selectionColor={BRAND}
                    style={{ minWidth: 90, fontSize: 40, fontWeight: '800', color: BRAND, textAlign: 'center', paddingVertical: 2 }}
                  />
                </View>
                <View style={{ flexDirection: rowDir, alignItems: 'center', gap: 8, marginTop: 4 }}>
                  <Switch value={vatInclusive} onValueChange={setVatInclusive} trackColor={{ true: BRAND }} />
                  <Text style={{ color: sub, fontSize: 13 }}>{tr('הסכום כולל מע"מ', 'Amount includes VAT')}</Text>
                </View>
                {!vatInclusive && baseAmount > 0 ? (
                  <Text style={{ marginTop: 6, color: '#dc2626', fontWeight: '700', fontSize: 13 }}>
                    {`+${VAT_RATE}% ${tr('מע"מ', 'VAT')}  →  ${tr('ללקוח יחויב', 'Customer pays')} ₪${amountWithVat.toFixed(2)}`}
                  </Text>
                ) : null}
              </View>

              {/* ── Customer ── */}
              {card(tr('לקוח', 'Customer'), 'account-outline', (
                <>
                  {linked ? (
                    <View style={{ flexDirection: rowDir, alignItems: 'center', gap: 8, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: withAlpha('#16a34a', 0.35), backgroundColor: withAlpha('#16a34a', 0.08), marginBottom: 10 }}>
                      <MaterialCommunityIcons name="link-variant" size={18} color={BRAND} />
                      <View style={{ flex: 1 }}>
                        <Text numberOfLines={1} style={{ fontWeight: '700', color: ink, textAlign: align }}>{linked.name || custName || tr('רשומה ללא שם', 'Unnamed record')}</Text>
                        <Text numberOfLines={1} style={{ fontSize: 12, color: sub, textAlign: align }}>
                          {tr('משויך ל', 'Linked to')}{linkTypeLabel(linked.type)}{(linked.phone || custPhone) ? ` • ${linked.phone || custPhone}` : ''}
                        </Text>
                      </View>
                      <Pressable onPress={clearLinked} hitSlop={8}>
                        <MaterialCommunityIcons name="close-circle" size={20} color={sub} />
                      </Pressable>
                    </View>
                  ) : !pickerOpen ? (
                    <Pressable onPress={() => setPickerOpen(true)} style={{ flexDirection: rowDir, alignItems: 'center', gap: 8, padding: 12, borderRadius: 12, borderWidth: 1, borderStyle: 'dashed', borderColor: hairline, marginBottom: 10 }}>
                      <MaterialCommunityIcons name="account-search-outline" size={18} color={sub} />
                      <Text style={{ color: sub, flex: 1, textAlign: align }}>{tr('שייך לאיש קשר / ליד / הזמנה / פנייה', 'Link to a contact / lead / order / case')}</Text>
                    </Pressable>
                  ) : null}
                  {!linked && pickerOpen ? (
                    <View style={{ borderWidth: 1, borderColor: hairline, borderRadius: 12, padding: 10, gap: 8, marginBottom: 10 }}>
                      <View style={{ flexDirection: rowDir, gap: 6, flexWrap: 'wrap' }}>
                        {(['contact', 'lead', 'order', 'case'] as LinkType[]).map((lt) => (
                          <Pressable key={lt} onPress={() => { setLinkType(lt); setLinkSearch(''); setLinkRecords([]); }} style={pill(linkType === lt)}>
                            <Text style={{ fontSize: 13, color: linkType === lt ? BRAND : sub, fontWeight: linkType === lt ? '700' : '400' }}>{linkTypeLabel(lt)}</Text>
                          </Pressable>
                        ))}
                      </View>
                      <FormTextField label={tr('חיפוש לפי שם / טלפון', 'Search by name / phone')} value={linkSearch} onChangeText={setLinkSearch} style={{ marginBottom: 0 }} />
                      <View style={{ maxHeight: 190, borderWidth: 1, borderColor: hairline, borderRadius: 10 }}>
                        {linkLoading ? (
                          <View style={{ padding: 14, alignItems: 'center' }}><ActivityIndicator color={BRAND} /></View>
                        ) : linkRecords.length === 0 ? (
                          <Text style={{ padding: 14, textAlign: 'center', color: sub }}>{tr('לא נמצאו רשומות', 'No records found')}</Text>
                        ) : (
                          <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled">
                            {linkRecords.map((r, i) => (
                              <Pressable key={`${r.id}_${i}`} onPress={() => pickRecord(r)} style={{ flexDirection: rowDir, alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: hairline }}>
                                <Text numberOfLines={1} style={{ flex: 1, color: ink, textAlign: align }}>{r.name || tr('(ללא שם)', '(no name)')}</Text>
                                {r.phone ? <Text style={{ fontSize: 12, color: sub }}>{r.phone}</Text> : null}
                              </Pressable>
                            ))}
                          </ScrollView>
                        )}
                      </View>
                      <Pressable onPress={() => setPickerOpen(false)}><Text style={{ color: sub, fontSize: 13 }}>{tr('ביטול', 'Cancel')}</Text></Pressable>
                    </View>
                  ) : null}
                  <FormTextField label={tr('שם הלקוח', 'Customer name')} value={custName} onChangeText={setCustName} style={{ marginBottom: 10 }} />
                  <View style={{ flexDirection: rowDir, gap: 10 }}>
                    <FormTextField label={tr('טלפון', 'Phone')} value={custPhone} onChangeText={setCustPhone} keyboardType="phone-pad" style={{ flex: 1, marginBottom: 10 }} />
                    <FormTextField label={tr('אימייל', 'Email')} value={custEmail} onChangeText={setCustEmail} keyboardType="email-address" autoCapitalize="none" style={{ flex: 1.3, marginBottom: 10 }} />
                  </View>
                </>
              ))}

              {/* ── Details ── */}
              {card(tr('פרטי התשלום', 'Payment details'), 'text-box-outline', (
                <>
                  <FormTextField label={tr('תיאור (יופיע ללקוח)', 'Description (shown to the customer)')} value={description} onChangeText={setDescription} style={{ marginBottom: 10 }} />
                  <FormSectionLabel icon="credit-card-multiple-outline">{tr('מספר תשלומים', 'Installments')}</FormSectionLabel>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, flexDirection: rowDir, paddingBottom: 2 }}>
                    {['1', '2', '3', '4', '5', '6', '8', '10', '12'].map((n) => (
                      <Pressable key={n} onPress={() => setInstallments(n)} style={[pill(installments === n), { minWidth: 46, alignItems: 'center' }]}>
                        <Text style={{ fontSize: 14, color: installments === n ? BRAND : sub, fontWeight: installments === n ? '800' : '500' }}>{n}</Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                  {parseInt(installments, 10) > 1 && amountWithVat > 0 ? (
                    <Text style={{ marginTop: 8, fontSize: 12, color: sub, textAlign: align }}>
                      {`${installments} × ₪${(amountWithVat / parseInt(installments, 10)).toFixed(2)}`}
                    </Text>
                  ) : null}
                </>
              ))}

              {/* ── Items ── */}
              {card(`${tr('פריטים', 'Items')}${items.length > 0 ? ` (${items.length})` : ''}`, 'cart-outline', (
                <>
                  {!itemsOpen ? (
                    <Pressable
                      onPress={() => { setItemsOpen(true); setCatalogOpen(true); loadCatalog(); }}
                      style={{ flexDirection: rowDir, alignItems: 'center', gap: 8, padding: 12, borderRadius: 12, borderWidth: 1, borderStyle: 'dashed', borderColor: hairline }}
                    >
                      <MaterialCommunityIcons name="plus-circle-outline" size={18} color={BRAND} />
                      <Text style={{ color: BRAND, fontWeight: '600', flex: 1, textAlign: align }}>{tr('הוסף פריטים / מוצרים (הסכום יתעדכן לפי הפריטים)', 'Add items / products (the amount follows them)')}</Text>
                    </Pressable>
                  ) : (
                    <View style={{ gap: 10 }}>
                      <View style={{ flexDirection: rowDir, gap: 8 }}>
                        <Pressable onPress={() => { const n = !catalogOpen; setCatalogOpen(n); if (n) loadCatalog(); }} style={pill(catalogOpen)}>
                          <Text style={{ fontSize: 13, color: catalogOpen ? BRAND : sub, fontWeight: '600' }}>{tr('מהקטלוג', 'From catalog')}</Text>
                        </Pressable>
                        <Pressable onPress={() => setItems((p) => [...p, { name: '', unitPrice: 0, quantity: 1 }])} style={pill(false)}>
                          <Text style={{ fontSize: 13, color: sub, fontWeight: '600' }}>{tr('+ פריט ידני', '+ Manual item')}</Text>
                        </Pressable>
                        <View style={{ flex: 1 }} />
                        <Pressable onPress={() => { setItems([]); setItemsOpen(false); setCatalogOpen(false); }} hitSlop={8} style={{ justifyContent: 'center' }}>
                          <Text style={{ fontSize: 12, color: sub }}>{tr('הסר פריטים', 'Remove items')}</Text>
                        </Pressable>
                      </View>
                      {catalogOpen ? (
                        <View style={{ gap: 6 }}>
                          <FormTextField label={tr('חיפוש מוצר', 'Search product')} value={catalogSearch} onChangeText={setCatalogSearch} style={{ marginBottom: 0 }} />
                          <View style={{ maxHeight: 180, borderWidth: 1, borderColor: hairline, borderRadius: 12 }}>
                            {catalogLoading ? (
                              <View style={{ padding: 14, alignItems: 'center' }}><ActivityIndicator color={BRAND} /></View>
                            ) : filteredCatalog.length === 0 ? (
                              <Text style={{ padding: 14, textAlign: 'center', color: sub }}>{tr('לא נמצאו מוצרים בקטלוג', 'No catalog products found')}</Text>
                            ) : (
                              <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled">
                                {filteredCatalog.map((ci, i) => (
                                  <Pressable key={ci.id || i} onPress={() => addCatalogItem(ci)} style={{ flexDirection: rowDir, alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: hairline }}>
                                    <Text numberOfLines={1} style={{ flex: 1, color: ink, textAlign: align }}>{ci.name || ci.description}{ci.sku ? ` (${ci.sku})` : ''}</Text>
                                    <Text style={{ color: BRAND, fontWeight: '700' }}>₪{Number(ci.unitPrice) || 0}</Text>
                                    <MaterialCommunityIcons name="plus-circle-outline" size={18} color={BRAND} />
                                  </Pressable>
                                ))}
                              </ScrollView>
                            )}
                          </View>
                        </View>
                      ) : null}
                      {items.map((it, idx) => (
                        <View key={idx} style={{ borderWidth: 1, borderColor: hairline, borderRadius: 14, padding: 10, backgroundColor: theme.colors.surface }}>
                          <View style={{ flexDirection: rowDir, alignItems: 'center', gap: 6 }}>
                            <View style={{ flex: 1 }}>
                              <FormTextField label={tr('שם פריט', 'Item name')} value={it.name} onChangeText={(v) => updateItem(idx, { name: v })} style={{ marginBottom: 8 }} dense />
                            </View>
                            <Pressable onPress={() => removeItem(idx)} hitSlop={8} style={{ marginBottom: 8 }}>
                              <MaterialCommunityIcons name="trash-can-outline" size={22} color="#ef4444" />
                            </Pressable>
                          </View>
                          <View style={{ flexDirection: rowDir, alignItems: 'center', gap: 8 }}>
                            <FormTextField label={tr('מחיר ליחידה', 'Unit price')} value={it.unitPrice ? String(it.unitPrice) : ''} keyboardType="decimal-pad" onChangeText={(v) => updateItem(idx, { unitPrice: parseFloat(v.replace(',', '.')) || 0 })} style={{ flex: 1, marginBottom: 0 }} dense />
                            <FormTextField label={tr('כמות', 'Qty')} value={String(it.quantity ?? 1)} keyboardType="number-pad" onChangeText={(v) => updateItem(idx, { quantity: parseInt(v, 10) || 1 })} style={{ width: 76, marginBottom: 0 }} dense />
                            <Text style={{ minWidth: 76, textAlign: 'center', fontWeight: '800', color: BRAND, fontSize: 15 }}>
                              ₪{((Number(it.unitPrice) || 0) * (Number(it.quantity) || 1)).toLocaleString()}
                            </Text>
                          </View>
                        </View>
                      ))}
                      {items.length > 0 ? (
                        <View style={{ flexDirection: rowDir, justifyContent: 'space-between', paddingTop: 4 }}>
                          <Text style={{ fontWeight: '700', color: sub }}>{tr('סה"כ פריטים', 'Items total')}</Text>
                          <Text style={{ fontWeight: '800', color: ink, fontSize: 16 }}>₪{itemsTotal(items).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Text>
                        </View>
                      ) : null}
                    </View>
                  )}
                </>
              ))}
            </>
          )}
        </TaskFormBody>
        {!result ? (
          <TaskFormSubmitBar
            label={amountWithVat > 0 ? `${tr('צור לינק תשלום', 'Create payment link')} · ₪${amountWithVat.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : tr('צור לינק תשלום', 'Create payment link')}
            onPress={submit}
            loading={busy}
            accent={BRAND}
          />
        ) : null}
      </TaskFormFrame>
    </Modal>
  );
}
