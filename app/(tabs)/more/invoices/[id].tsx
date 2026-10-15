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
  Share,
  Linking,
  BackHandler,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
import { cacheEntity, getCachedEntity } from '../../../../services/entityCache';
import { contactsApi } from '../../../../services/api/contacts';
import { quotesApi } from '../../../../services/api/quotes';
import { catalogApi, type CatalogCustomColumn, type CatalogFieldsConfig } from '../../../../services/api/catalog';
import { Image } from 'expo-image';
import type { Contact } from '../../../../types';
import { borderRadius } from '../../../../constants/theme';
import { formatDate, formatCurrency } from '../../../../utils/formatters';
import { currencySymbol } from '../../../../utils/currency';
import * as Clipboard from 'expo-clipboard';
import { useDirtyTracker } from '../../../../hooks/useDirtyTracker';
import { ScreenHeader } from '../../../../components/ScreenHeader';
import { HeaderMenu } from '../../../../components/HeaderMenu';
import { StickySaveBar } from '../../../../components/StickySaveBar';
import { PrimaryActionBar } from '../../../../components/PrimaryActionBar';
import { InvoicePreviewModal } from '../../../../components/InvoicePreviewModal';
import { CollapsibleSection } from '../../../../components/CollapsibleSection';

const BRAND_COLOR = '#2e6155';

/** Unpaid balance of an issued tax invoice / tax-invoice-receipt (mirrors the web's getOpenBalance). */
function getOpenBalance(inv: Invoice): number {
  if (!inv.isLocked) return 0;
  if (inv.type !== 'tax_invoice' && inv.type !== 'combined') return 0;
  if (inv.status === 'cancelled') return 0;
  const total = Number(inv.total) || 0;
  const balance = inv.balanceDue != null
    ? Number(inv.balanceDue)
    : total - (Number(inv.paidAmount) || 0) - (Number(inv.creditedAmount) || 0);
  return balance > 0.001 ? balance : 0;
}

// ── Catalog picker helpers (mirror the Catalog screen so the "from catalog" picker shows the same
// title + columns configured in the web Catalog → Columns settings) ─────────────────────────────
const CATALOG_BASE_TOKENS = ['image', 'name', 'category', 'sku', 'unitPrice', 'stock'];

function catFormatValue(v: any, isRTL: boolean): string {
  if (typeof v === 'boolean') return v ? (isRTL ? 'כן' : 'Yes') : (isRTL ? 'לא' : 'No');
  return String(v);
}
function catHasVal(v: any): boolean {
  return v !== undefined && v !== null && v !== '';
}
function catResolveColumnOrder(savedOrder: any, customCols: CatalogCustomColumn[]): string[] {
  const customTokens = (customCols || []).map((c) => `custom:${c.id}`);
  const natural = [...CATALOG_BASE_TOKENS, ...customTokens, 'link'];
  const saved = Array.isArray(savedOrder) ? savedOrder.filter((tok: string) => natural.includes(tok)) : [];
  return [...saved, ...natural.filter((tok) => !saved.includes(tok))];
}
function catBuildTitle(item: any, columns: CatalogCustomColumn[], cfg: CatalogFieldsConfig, isRTL: boolean): { title: string; titleKey: string | null } {
  const cf = item.customFields || {};
  let titleKey: string | null = null;
  let title = item.name || item.sku || item.category || '';
  if (!title) {
    const reqKey = cfg?.requiredField;
    if (reqKey && catHasVal(cf[reqKey])) {
      titleKey = reqKey;
      title = catFormatValue(cf[reqKey], isRTL);
    } else {
      const firstFilled = (columns || []).find((c) => catHasVal(cf[c.key]));
      if (firstFilled) {
        titleKey = firstFilled.key;
        title = catFormatValue(cf[firstFilled.key], isRTL);
      }
    }
  }
  return { title: title || '—', titleKey };
}

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
  const { id, prefillContactName, prefillContactPhone, prefillRelatedQuoteId, prefillType } =
    useLocalSearchParams<{
      id: string;
      prefillContactName?: string;
      prefillContactPhone?: string;
      prefillRelatedQuoteId?: string;
      /** Document type from Quote Settings → "invoice from stage" (tax_invoice / combined / receipt / transaction). */
      prefillType?: string;
    }>();
  const theme = useAppTheme();
  const { flexDirection, textAlign, isRTL } = useRTL();
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const insets = useSafeAreaInsets();

  const isNew = id === 'new';

  // ── View mode state ───────────────────────────────────────────────
  // Render instantly from the list cache, then refresh in the background.
  const cachedInvoice = !isNew ? getCachedEntity<Invoice>('invoices', id) : undefined;
  const [invoice, setInvoice] = useState<Invoice | null>(cachedInvoice ?? null);
  const [loading, setLoading] = useState(!isNew && !cachedInvoice);
  const [error, setError] = useState<string | null>(null);

  // ── Create/edit mode state ────────────────────────────────────────
  const today = new Date().toISOString().split('T')[0];
  const due30 = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];

  const [formType, setFormType] = useState(
    prefillType && DOCUMENT_TYPES.some((d) => d.key === prefillType) ? prefillType : 'tax_invoice',
  );
  // Source quote (set while prefilling) → the backend marks the quote as "invoice generated" on issue.
  const [sourceQuote, setSourceQuote] = useState<{ id: string; number: string; leadId?: string; leadTitle?: string } | null>(null);
  const [branding, setBranding] = useState<any>(null);
  const [previewVisible, setPreviewVisible] = useState(false);
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
  const [issuing, setIssuing] = useState(false);
  const [creatingReceipt, setCreatingReceipt] = useState(false);

  // Type/payment menus
  const [typeMenuVisible, setTypeMenuVisible] = useState(false);
  const [paymentMenuVisible, setPaymentMenuVisible] = useState(false);
  const [headerMenuVisible, setHeaderMenuVisible] = useState(false);

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
  const [debouncedCatalogSearch, setDebouncedCatalogSearch] = useState('');
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogColumns, setCatalogColumns] = useState<CatalogCustomColumn[]>([]);
  const [catalogFieldsConfig, setCatalogFieldsConfig] = useState<CatalogFieldsConfig>({});

  // Debounce the catalog search so filtering a large catalog stays snappy.
  useEffect(() => {
    const h = setTimeout(() => setDebouncedCatalogSearch(catalogSearch), 200);
    return () => clearTimeout(h);
  }, [catalogSearch]);

  const totals = useMemo(
    () => calcTotals(formItems, parseFloat(formDiscount) || 0, parseFloat(formVatRate) || 0),
    [formItems, formDiscount, formVatRate],
  );

  const getDocLabel = (type: string) => DOCUMENT_TYPES.find((d) => d.key === type)?.labelHe || type;
  const getDocColor = (type: string) => DOCUMENT_TYPES.find((d) => d.key === type)?.color || BRAND_COLOR;
  const getStatusLabel = (status: string) => INVOICE_STATUSES.find((s) => s.key === status)?.labelHe || status;
  const getStatusColor = (status: string) => INVOICE_STATUSES.find((s) => s.key === status)?.color || '#9E9E9E';

  // Dirty tracking: the Save bar appears only when a draft actually changed (no "Edit" button).
  const formSnapshot = useMemo(
    () =>
      JSON.stringify({
        ty: formType, cn: formContactName, cp: formContactPhone, ce: formContactEmail, cc: formContactCompany,
        d: formDate, dd: formDueDate, cu: formCurrency, v: formVatRate, di: formDiscount, pm: formPaymentMethod, n: formNotes,
        it: formItems.map((i) => [i.description, i.quantity, i.unitPrice]),
      }),
    [formType, formContactName, formContactPhone, formContactEmail, formContactCompany, formDate, formDueDate, formCurrency, formVatRate, formDiscount, formPaymentMethod, formNotes, formItems],
  );
  const { dirty, markClean } = useDirtyTracker(formSnapshot);
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;

  // Fill the editable form from a saved draft.
  const loadInvoiceIntoForm = useCallback((inv: Invoice) => {
    setFormType(inv.type || 'tax_invoice');
    setFormContactName(inv.contactName || '');
    setFormContactPhone(inv.contactPhone || '');
    setFormContactEmail(inv.contactEmail || '');
    setFormContactCompany(inv.contactCompany || '');
    setFormDate(inv.date ? String(inv.date).slice(0, 10) : today);
    setFormDueDate(inv.dueDate ? String(inv.dueDate).slice(0, 10) : due30);
    setFormCurrency(inv.currency || 'ILS');
    setFormVatRate(String(inv.vatRate ?? 18));
    setFormDiscount(String(inv.discount ?? 0));
    setFormPaymentMethod(inv.paymentMethod || '');
    setFormNotes(inv.notes || '');
    setFormItems(inv.items && inv.items.length > 0 ? inv.items.map((it) => ({ ...it })) : [emptyItem()]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Put a server invoice into state and (for a draft with no unsaved edits) into the form.
  const applyServerInvoice = useCallback((inv: Invoice) => {
    setInvoice(inv);
    if (!inv.isLocked && !dirtyRef.current) {
      loadInvoiceIntoForm(inv);
      markClean();
    }
  }, [loadInvoiceIntoForm, markClean]);

  // ── Fetch invoice ─────────────────────────────────────────────────
  const fetchInvoice = useCallback(async () => {
    if (!user?.organization || isNew) { setLoading(false); return; }
    try {
      setError(null);
      const data = await invoicesApi.getById(user.organization, id);
      if (data) applyServerInvoice(data);
      cacheEntity('invoices', data);
    } catch (err: any) {
      setError(err.message || t('errors.generic'));
    } finally {
      setLoading(false);
    }
  }, [user?.organization, id, isNew, t, applyServerInvoice]);

  useEffect(() => {
    fetchInvoice();
  }, [fetchInvoice]);

  // Cached list item → fill the draft form instantly.
  useEffect(() => {
    if (cachedInvoice && !cachedInvoice.isLocked) {
      loadInvoiceIntoForm(cachedInvoice);
      markClean();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Prefill from source quote ──────────────────────────────────────
  useEffect(() => {
    if (!isNew || !prefillRelatedQuoteId || !user?.organization) return;
    (async () => {
      try {
        const quoteData = await quotesApi.getById(user.organization, prefillRelatedQuoteId);
        if (quoteData) {
          // One invoice per quote: if it was already issued, offer the existing one instead of a duplicate.
          if (quoteData.invoiceGeneratedId) {
            const existingNum = quoteData.invoiceDocumentNumber || quoteData.invoiceGeneratedId;
            Alert.alert(
              t('invoices.alreadyGeneratedTitle', 'כבר הופקה חשבונית'),
              `${t('invoices.alreadyGenerated', 'כבר הופקה חשבונית מהצעת מחיר זו')} (${existingNum})`,
              [
                { text: t('common.cancel'), style: 'cancel', onPress: () => router.back() },
                {
                  text: t('invoices.openExisting', 'פתח את הקיימת'),
                  onPress: () => router.replace({ pathname: '/(tabs)/more/invoices/[id]', params: { id: quoteData.invoiceGeneratedId as string } }),
                },
              ],
              { cancelable: false },
            );
            return;
          }
          setSourceQuote({ id: prefillRelatedQuoteId, number: quoteData.quoteNumber || '', leadId: quoteData.leadId, leadTitle: quoteData.leadTitle });
          if (quoteData.contactName) setFormContactName(quoteData.contactName);
          if (quoteData.contactPhone) setFormContactPhone(quoteData.contactPhone);
          if (quoteData.contactEmail) setFormContactEmail(quoteData.contactEmail);
          if (quoteData.contactCompany) setFormContactCompany(quoteData.contactCompany);
          if (quoteData.currency) setFormCurrency(quoteData.currency);
          if (quoteData.tax != null) setFormVatRate(String(quoteData.tax));
          // The invoice form uses a fixed discount; a percent discount on the quote is carried over as its computed amount.
          const quoteDiscount = quoteData.discountType === 'percent' ? quoteData.discountAmount : (quoteData.discountAmount ?? quoteData.discount);
          if (quoteDiscount != null) setFormDiscount(String(quoteDiscount));
          if (quoteData.notes) setFormNotes(quoteData.notes);
          if (Array.isArray(quoteData.items) && quoteData.items.length > 0) {
            setFormItems(quoteData.items.map((it: any) => ({
              description: it.description || it.name || '',
              quantity: it.quantity || 1,
              unitPrice: it.unitPrice || 0,
            })));
          }
        }
      } catch (err) {
        console.warn('Failed to prefill from quote:', err);
      }
    })();
  }, [isNew, prefillRelatedQuoteId, user?.organization, router, t]);

  // Company branding (logo, name, colour, bank details) for the document preview.
  useEffect(() => {
    if (!user?.organization) return;
    invoicesApi.getBranding(user.organization).then(setBranding).catch(() => {});
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
    setFormContactName(contact.fullName || contact.name || '');
    setFormContactPhone(contact.phoneNumber || contact.phone || '');
    setFormContactEmail(contact.email || '');
    setContactPickerVisible(false);
  }, []);

  // ── Catalog picker ────────────────────────────────────────────────
  // Load the FULL catalog (items + custom columns + field config from the web Catalog → Columns
  // settings) so the picker renders the same title + columns as the catalog screen. Previously only
  // name/description were used, so catalogs whose data lives in custom fields showed blank rows.
  const openCatalogPicker = useCallback(async () => {
    setCatalogVisible(true);
    if (catalogItems.length === 0) {
      setCatalogLoading(true);
      try {
        const data = await catalogApi.getAll(user?.organization || '');
        setCatalogItems(Array.isArray(data.catalogItems) ? data.catalogItems : []);
        setCatalogColumns(Array.isArray(data.catalogCustomColumns) ? data.catalogCustomColumns : []);
        setCatalogFieldsConfig(data.catalogFieldsConfig || {});
      } catch { setCatalogItems([]); }
      finally { setCatalogLoading(false); }
    }
  }, [user?.organization, catalogItems.length]);

  const catalogColumnTokens = useMemo(
    () => catResolveColumnOrder(catalogFieldsConfig.columnOrder, catalogColumns),
    [catalogFieldsConfig.columnOrder, catalogColumns],
  );
  const isCatalogTokenVisible = useCallback((tok: string): boolean => {
    if (tok === 'name') return true;
    if (tok.startsWith('custom:')) {
      const col = catalogColumns.find((c) => `custom:${c.id}` === tok);
      return col ? col.showInTable !== false : false;
    }
    const tc = catalogFieldsConfig.tableColumns || {};
    return tc[tok] !== false;
  }, [catalogColumns, catalogFieldsConfig.tableColumns]);

  const filteredCatalog = useMemo(() => {
    const q = debouncedCatalogSearch.trim().toLowerCase();
    if (!q) return catalogItems;
    const sb = catalogFieldsConfig.searchBaseFields || { name: true, description: true, sku: true };
    const searchableCols = catalogColumns.filter((c) => c.searchable);
    return catalogItems.filter((i) => {
      const baseHit =
        (sb.name !== false && (i.name || '').toLowerCase().includes(q)) ||
        (sb.description && (i.description || '').toLowerCase().includes(q)) ||
        (sb.sku && (i.sku || '').toLowerCase().includes(q)) ||
        (sb.category && (i.category || '').toLowerCase().includes(q)) ||
        (sb.unitPrice && String(i.unitPrice ?? '').toLowerCase().includes(q));
      if (baseHit) return true;
      const cf = i.customFields;
      if (cf) {
        const cols = searchableCols.length > 0 ? searchableCols.map((c) => c.key) : Object.keys(cf);
        for (const key of cols) {
          const val = cf[key];
          if (val != null && String(val).toLowerCase().includes(q)) return true;
        }
      }
      return false;
    });
  }, [catalogItems, debouncedCatalogSearch, catalogFieldsConfig, catalogColumns]);

  const addFromCatalog = useCallback((item: any) => {
    const { title, titleKey } = catBuildTitle(item, catalogColumns, catalogFieldsConfig, isRTL);
    let description = item.description || '';
    if (!description) {
      const cf = item.customFields || {};
      const parts: string[] = [];
      for (const tok of catalogColumnTokens) {
        if (!tok.startsWith('custom:') || !isCatalogTokenVisible(tok)) continue;
        const col = catalogColumns.find((c) => `custom:${c.id}` === tok);
        if (col && col.key !== titleKey && catHasVal(cf[col.key])) {
          parts.push(`${col.label}: ${catFormatValue(cf[col.key], isRTL)}`);
        }
        if (parts.length >= 4) break;
      }
      description = parts.join(' · ');
    }
    // Invoice line items store their label in `description`, so combine the title with the summary.
    const label = title === '—' ? (description || '') : (description ? `${title} — ${description}` : title);
    setFormItems((prev) => [...prev, {
      description: label,
      quantity: 1,
      unitPrice: parseFloat(item.unitPrice) || parseFloat(item.price) || 0,
    }]);
    setCatalogVisible(false);
    setCatalogSearch('');
  }, [catalogColumns, catalogFieldsConfig, catalogColumnTokens, isCatalogTokenVisible, isRTL]);

  // ── Items management ──────────────────────────────────────────────
  const addItem = () => setFormItems((prev) => [...prev, emptyItem()]);
  const removeItem = (idx: number) => setFormItems((prev) => prev.filter((_, i) => i !== idx));
  const updateItem = (idx: number, field: keyof InvoiceItem, value: string | number) =>
    setFormItems((prev) => prev.map((it, i) => (i === idx ? { ...it, [field]: value } : it)));

  const leaveScreen = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/more/invoices');
  }, [router]);

  // ── Save (create a draft, or update the draft in place) ───────────
  const handleSave = useCallback(async () => {
    if (!user?.organization) return;
    if (!formContactName.trim() && !formContactPhone.trim()) {
      Alert.alert(t('common.error'), t('invoices.customerRequired', 'יש להזין שם לקוח או טלפון'));
      return;
    }
    setSaving(true);
    try {
      const discountValue = parseFloat(formDiscount) || 0;
      const payload: Partial<Invoice> & Record<string, any> = {
        type: formType,
        date: formDate,
        dueDate: formDueDate,
        currency: formCurrency,
        // 0% (VAT-exempt) must stay 0 — `|| 18` silently turned it into 18 on the saved document.
        vatRate: Number.isFinite(parseFloat(formVatRate)) ? parseFloat(formVatRate) : 18,
        contactName: formContactName.trim(),
        contactPhone: formContactPhone.trim(),
        contactEmail: formContactEmail.trim(),
        contactCompany: formContactCompany.trim(),
        items: formItems,
        // Same field semantics as the web form (subtotal before discount; fixed discount in currency).
        subtotal: totals.subtotal,
        discount: discountValue,
        discountType: 'fixed',
        discountAmount: discountValue,
        afterDiscount: totals.subtotalAfterDiscount,
        vatAmount: totals.vatAmount,
        taxAmount: totals.vatAmount,
        total: totals.total,
        paymentMethod: formPaymentMethod,
        notes: formNotes.trim(),
      };
      if (isNew) {
        const result = await invoicesApi.create(
          user.organization,
          {
            ...payload,
            status: 'draft',
            // Same link the web form saves: on issue the backend stamps invoiceGeneratedId on the source quote.
            ...(sourceQuote
              ? {
                  sourceDocumentId: sourceQuote.id,
                  sourceDocumentType: 'quote',
                  sourceDocumentNumber: sourceQuote.number,
                  // Keep the CRM link so the invoice stays associated with the lead.
                  ...(sourceQuote.leadId ? { leadId: sourceQuote.leadId, leadTitle: sourceQuote.leadTitle } : {}),
                }
              : {}),
          },
          user.uID || user.userId,
          user.fullname,
        );
        const newId = result?.invoice?.id || result?.id || result?.invoiceId || (result?.success ? result?.message : undefined);
        if (result && result.success === false) throw new Error(result.message || 'save_failed');
        if (newId) {
          router.replace({ pathname: '/(tabs)/more/invoices/[id]', params: { id: newId } });
        } else {
          leaveScreen();
        }
      } else if (invoice) {
        const result = await invoicesApi.update(
          user.organization,
          id,
          { ...invoice, ...payload, status: invoice.status },
          user.uID || user.userId,
          user.fullname,
        );
        const ok = result?.Success ?? result?.success ?? true;
        if (ok === false) throw new Error(result?.Message || result?.message || 'save_failed');
        markClean();
        await fetchInvoice();
      }
    } catch (err: any) {
      Alert.alert(t('common.error'), err.message || t('errors.generic'));
    } finally {
      setSaving(false);
    }
  }, [
    user, isNew, invoice, id, formType, formDate, formDueDate, formCurrency, formVatRate, formContactName,
    formContactPhone, formContactEmail, formContactCompany, formItems, formDiscount,
    formPaymentMethod, formNotes, totals, sourceQuote, router, leaveScreen, markClean, fetchInvoice, t,
  ]);

  // Throw away unsaved edits and restore the draft from the server copy.
  const discardChanges = useCallback(() => {
    if (!invoice) return;
    loadInvoiceIntoForm(invoice);
    setSelectedContact(null);
    markClean();
  }, [invoice, loadInvoiceIntoForm, markClean]);

  // ── Issue the draft (finalize + lock) — same endpoint & rules as the web "Issue" button ──
  const handleIssue = useCallback(() => {
    if (!user?.organization || !invoice || !id) return;
    const hasRealItems = (invoice.items || []).some((it) => (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0) !== 0);
    if (!hasRealItems) {
      Alert.alert(t('common.error'), t('invoices.needItems', 'לא ניתן להפיק מסמך ללא פריטים. הוסיפו לפחות פריט אחד עם סכום.'));
      return;
    }
    Alert.alert(
      t('invoices.issue', 'הפק מסמך'),
      t('invoices.issueConfirm', 'להפיק את המסמך? לאחר הפקה לא ניתן לערוך.'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('invoices.issue', 'הפק מסמך'),
          onPress: async () => {
            setIssuing(true);
            try {
              const res = await invoicesApi.issue(user.organization, id, user.uID || user.userId, user.fullname);
              const ok = res?.Success ?? res?.success;
              const msg = res?.Message ?? res?.message;
              if (ok) {
                const alloc = res?.allocation;
                if (alloc && !alloc.approved) {
                  Alert.alert(
                    t('invoices.issuedTitle', 'המסמך הופק'),
                    t('invoices.noAllocation', 'המסמך הופק, אך רשות המסים לא החזירה מספר הקצאה. ניתן לבקש מספר הקצאה מהמחשב.'),
                  );
                }
                await fetchInvoice();
              } else if (res?.notConnected) {
                Alert.alert(
                  t('common.error'),
                  t('invoices.notConnected', 'נדרש חיבור לרשות המסים לקבלת מספר הקצאה. חברו את העסק בהגדרות החשבוניות.'),
                );
              } else {
                Alert.alert(t('common.error'), msg || t('errors.generic'));
              }
            } catch (err: any) {
              Alert.alert(t('common.error'), err.message || t('errors.generic'));
            } finally {
              setIssuing(false);
            }
          },
        },
      ],
    );
  }, [user, invoice, id, fetchInvoice, t]);

  // ── Share / copy the public link (issued documents) ────────────────
  const publicInvoiceUrl = invoice
    ? `https://www.gambot.co.il/invoice?org=${encodeURIComponent(user?.organization || '')}&id=${encodeURIComponent(invoice.id || '')}`
    : '';

  const handleShare = useCallback(async () => {
    if (!invoice) return;
    const label = `${DOCUMENT_TYPES.find((d) => d.key === invoice.type)?.labelHe || invoice.type}${invoice.documentNumber ? ` #${invoice.documentNumber}` : ''}`;
    try {
      await Share.share({
        message: `${label}\n${invoice.contactName ? `${t('invoices.customer', 'לקוח')}: ${invoice.contactName}\n` : ''}${t('invoices.total', 'סה"כ')}: ${formatCurrency(Number(invoice.total || 0), currencySymbol(invoice.currency))}\n\n${publicInvoiceUrl}`,
      });
    } catch { /* user cancelled */ }
  }, [invoice, publicInvoiceUrl, t]);

  const handleCopyLink = useCallback(async () => {
    if (!invoice) return;
    await Clipboard.setStringAsync(publicInvoiceUrl);
    Alert.alert(t('docs.linkCopied', 'הקישור הועתק'), t('invoices.linkCopiedDesc', 'קישור לצפייה בחשבונית הועתק ללוח'));
  }, [invoice, publicInvoiceUrl, t]);

  // ── "Mark paid" = issue a receipt for the open balance (legal way to record a payment) ──
  const handleMarkPaid = useCallback(() => {
    if (!user?.organization || !invoice || !id) return;
    const balance = getOpenBalance(invoice);
    Alert.alert(
      t('invoices.markPaid', 'סמן כשולם (הפק קבלה)'),
      `${t('invoices.receiptConfirm', 'ייווצרת קבלה כטיוטה על יתרת החשבונית')}: ${formatCurrency(balance, currencySymbol(invoice.currency))}`,
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.confirm'),
          onPress: async () => {
            setCreatingReceipt(true);
            try {
              const res = await invoicesApi.createDocumentFrom(user.organization, id, 'receipt', 0, user.uID || user.userId, user.fullname);
              if (res?.success && res?.message) {
                router.push({ pathname: '/(tabs)/more/invoices/[id]', params: { id: res.message } });
              } else {
                Alert.alert(t('common.error'), res?.error || res?.message || t('errors.generic'));
              }
            } catch (err: any) {
              Alert.alert(t('common.error'), err.message || t('errors.generic'));
            } finally {
              setCreatingReceipt(false);
            }
          },
        },
      ],
    );
  }, [user, invoice, id, router, t]);

  // ── Leaving the screen never silently drops edits ─────────────────
  const hasUnsavedNew = isNew && (!!formContactName.trim() || !!formContactPhone.trim() || formItems.some((i) => (i.description || '').trim()));
  const handleBack = useCallback(() => {
    if (!dirty && !hasUnsavedNew) { leaveScreen(); return; }
    Alert.alert(
      t('docs.unsavedTitle', 'שינויים שלא נשמרו'),
      t('docs.unsavedMessage', 'לצאת בלי לשמור את השינויים?'),
      [
        { text: t('docs.keepEditing', 'המשך עריכה'), style: 'cancel' },
        { text: t('docs.exitWithoutSaving', 'צא בלי לשמור'), style: 'destructive', onPress: leaveScreen },
      ],
    );
  }, [dirty, hasUnsavedNew, leaveScreen, t]);

  useEffect(() => {
    if (!dirty && !hasUnsavedNew) return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { handleBack(); return true; });
    return () => sub.remove();
  }, [dirty, hasUnsavedNew, handleBack]);

  // ══ Delete (drafts only — mirrors web isLocked gating) ════════════
  const handleDelete = useCallback(() => {
    setHeaderMenuVisible(false);
    if (!user?.organization || !id) return;
    Alert.alert(
      t('common.delete'),
      t('invoices.confirmDelete', 'האם למחוק את הטיוטה?'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              await invoicesApi.delete(user.organization, id);
              Alert.alert(t('common.success', 'הצלחה'), t('invoices.deleteSuccess', 'הטיוטה נמחקה'));
              if (router.canGoBack()) router.back();
              else router.replace('/(tabs)/more/invoices');
            } catch (err: any) {
              Alert.alert(t('common.error'), err.message || t('errors.generic'));
            }
          },
        },
      ],
    );
  }, [user?.organization, id, router, t]);

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
          <Appbar.Action icon={isRTL ? 'arrow-right' : 'arrow-left'} onPress={() => router.back()} color="#FFF" />
          <Appbar.Content title="חשבוניות" titleStyle={{ color: '#FFF' }} />
        </Appbar.Header>
        <MaterialCommunityIcons name="alert-circle-outline" size={48} color={theme.colors.error} style={{ opacity: 0.7 }} />
        <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant, marginTop: 12 }}>{error}</Text>
        <Button onPress={fetchInvoice} textColor={BRAND_COLOR}>{t('common.retry')}</Button>
      </View>
    );
  }

  // ══ NEW / DRAFT: one editable screen — no separate "Edit" mode ═══════
  const editable = isNew || (!!invoice && !invoice.isLocked);
  if (editable) {
    const docColor = getDocColor(formType);
    return (
      <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
        <ScreenHeader
          color={docColor}
          title={isNew ? t('invoices.newInvoice', 'חשבונית חדשה') : `${getDocLabel(formType)} · ${t('invoices.draft', 'טיוטה')}`}
          onBack={handleBack}
          actions={
            <>
              <IconButton icon="eye-outline" iconColor={theme.custom.headerText} size={22} onPress={() => setPreviewVisible(true)} />
              {!isNew ? (
                <HeaderMenu
                  items={[{ key: 'delete', title: t('common.delete'), icon: 'delete-outline', onPress: handleDelete, destructive: true }]}
                />
              ) : null}
            </>
          }
        />

        <InvoicePreviewModal
          visible={previewVisible}
          onDismiss={() => setPreviewVisible(false)}
          branding={branding}
          doc={{
            type: formType,
            status: 'draft',
            isDraft: true,
            documentNumber: invoice?.documentNumber,
            date: formDate,
            dueDate: formDueDate,
            currency: formCurrency,
            vatRate: Number.isFinite(parseFloat(formVatRate)) ? parseFloat(formVatRate) : 18,
            contactName: formContactName,
            contactPhone: formContactPhone,
            contactEmail: formContactEmail,
            contactCompany: formContactCompany,
            items: formItems,
            subtotal: totals.subtotal,
            discountAmount: parseFloat(formDiscount) || 0,
            vatAmount: totals.vatAmount,
            total: totals.total,
            notes: formNotes,
          }}
        />

        <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
          <ScrollView
            contentContainerStyle={[styles.createScroll, { paddingBottom: 120 + insets.bottom }]}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* Customer (+ document type) */}
            <View style={[styles.section, { backgroundColor: theme.colors.surface }]}>
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

            {/* Everything else, behind ONE collapsed row */}
            <CollapsibleSection hint={t('invoices.moreHint', 'תאריכים, מע"מ, מטבע, תשלום, הערות, אימייל')}>
              <TextInput label="אימייל" value={formContactEmail} onChangeText={setFormContactEmail}
                mode="outlined" keyboardType="email-address" autoCapitalize="none" style={[styles.formInput, { textAlign }]} activeOutlineColor={BRAND_COLOR}
                right={<TextInput.Icon icon="email-outline" />} />
              <TextInput label="חברה / עסק" value={formContactCompany} onChangeText={setFormContactCompany}
                mode="outlined" style={[styles.formInput, { textAlign }]} activeOutlineColor={BRAND_COLOR}
                right={<TextInput.Icon icon="domain" />} />
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
              <TextInput label="הערות לחשבונית..." value={formNotes} onChangeText={setFormNotes}
                mode="outlined" multiline numberOfLines={3} style={[styles.formInput, { textAlign }]}
                activeOutlineColor={BRAND_COLOR} />
            </CollapsibleSection>
          </ScrollView>

          <StickySaveBar
            visible={isNew || dirty}
            saving={saving}
            onSave={handleSave}
            onDiscard={!isNew && dirty ? discardChanges : undefined}
            saveLabel={isNew ? t('invoices.saveDraft', 'שמור טיוטה') : undefined}
            color={docColor}
          />
          {!isNew && !dirty ? (
            <PrimaryActionBar
              label={t('invoices.issue', 'הפק מסמך')}
              icon="check-decagram"
              color={docColor}
              loading={issuing}
              onPress={handleIssue}
            />
          ) : null}
        </KeyboardAvoidingView>

        {/* Contact Picker Modal */}
        <Portal>
          <Modal
            visible={contactPickerVisible}
            onDismiss={() => { setContactPickerVisible(false); setContactSearch(''); setContactResults([]); }}
            contentContainerStyle={[styles.inventoryModal, { backgroundColor: theme.colors.surface }]}
          >
            <View style={[styles.modalHeader, { flexDirection }]}>
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
            <Searchbar
              placeholder="חפש פריט..."
              value={catalogSearch}
              onChangeText={setCatalogSearch}
              style={{ marginHorizontal: 12, marginBottom: 8 }}
            />
            {catalogLoading ? (
              <ActivityIndicator size="large" color={BRAND_COLOR} style={{ marginVertical: 32 }} />
            ) : (
              <FlatList
                data={filteredCatalog}
                keyExtractor={(item, i) => String(item?.id ?? i)}
                style={{ maxHeight: 460 }}
                keyboardShouldPersistTaps="handled"
                initialNumToRender={12}
                maxToRenderPerBatch={16}
                windowSize={7}
                removeClippedSubviews
                renderItem={({ item }) => {
                  const cf = item.customFields || {};
                  const { title, titleKey } = catBuildTitle(item, catalogColumns, catalogFieldsConfig, isRTL);
                  const hasImage = Array.isArray(item.images) && item.images.filter(Boolean).length > 0;
                  const chips: { key: string; label: string }[] = [];
                  for (const tok of catalogColumnTokens) {
                    if (tok === 'image' || tok === 'name' || tok === 'unitPrice') continue;
                    if (!isCatalogTokenVisible(tok)) continue;
                    if (tok === 'sku') {
                      if (item.sku) chips.push({ key: tok, label: String(item.sku) });
                    } else if (tok === 'category') {
                      if (item.category) chips.push({ key: tok, label: String(item.category) });
                    } else if (tok.startsWith('custom:')) {
                      const col = catalogColumns.find((c) => `custom:${c.id}` === tok);
                      if (col && col.key !== titleKey && catHasVal(cf[col.key])) {
                        chips.push({ key: tok, label: `${col.label}: ${catFormatValue(cf[col.key], isRTL)}` });
                      }
                    }
                  }
                  const price = Number(item.unitPrice || item.price || 0);
                  return (
                    <TouchableOpacity
                      style={[styles.inventoryRow, { flexDirection, borderBottomColor: theme.colors.outlineVariant, alignItems: 'flex-start' }]}
                      onPress={() => addFromCatalog(item)}
                    >
                      {hasImage ? (
                        <Image source={{ uri: item.images.filter(Boolean)[0] }} style={styles.catalogThumb} contentFit="cover" />
                      ) : (
                        <View style={[styles.catalogThumb, styles.catalogThumbPlaceholder, { backgroundColor: BRAND_COLOR + '15' }]}>
                          <MaterialCommunityIcons name="package-variant" size={20} color={BRAND_COLOR} />
                        </View>
                      )}
                      <View style={{ flex: 1, marginHorizontal: 10 }}>
                        <Text variant="bodyMedium" style={{ color: theme.colors.onSurface, fontWeight: '600', textAlign }} numberOfLines={1}>
                          {title}
                        </Text>
                        {item.description ? (
                          <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant, textAlign, marginTop: 1 }} numberOfLines={1}>
                            {item.description}
                          </Text>
                        ) : null}
                        {chips.length > 0 && (
                          <View style={[styles.catalogChips, { flexDirection, flexWrap: 'wrap' }]}>
                            {chips.slice(0, 6).map((c) => (
                              <View key={c.key} style={[styles.catalogChip, { backgroundColor: theme.colors.onSurfaceVariant + '14' }]}>
                                <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 10 }} numberOfLines={1}>{c.label}</Text>
                              </View>
                            ))}
                          </View>
                        )}
                      </View>
                      <Text variant="bodyMedium" style={{ color: BRAND_COLOR, fontWeight: '700', marginTop: 2 }}>
                        {price > 0 ? `₪${price.toLocaleString()}` : ''}
                      </Text>
                    </TouchableOpacity>
                  );
                }}
                ListEmptyComponent={
                  <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center', margin: 24 }}>
                    לא נמצאו פריטים בקטלוג
                  </Text>
                }
              />
            )}
          </Modal>
        </Portal>
      </View>
    );
  }

  // ══ ISSUED DOCUMENT: read-only (legally locked) with ONE next-step button ══
  if (!invoice) return null;

  const docColor = getDocColor(invoice.type);
  const statusColor = getStatusColor(invoice.status);
  const sym = currencySymbol(invoice.currency);
  const money = (n: number | undefined | null) => formatCurrency(Number(n || 0), sym);
  const openBalance = getOpenBalance(invoice);
  const overdue = invoice.status === 'overdue';

  let primary: { label: string; icon: string; color: string; run: () => void; loading?: boolean } | null = null;
  if (invoice.status === 'issued') {
    primary = { label: t('invoices.sendToCustomer', 'שלח ללקוח'), icon: 'send', color: docColor, run: handleShare };
  } else if ((invoice.status === 'sent' || overdue) && openBalance > 0) {
    primary = { label: t('invoices.markPaid', 'סמן כשולם (הפק קבלה)'), icon: 'cash-check', color: '#16a34a', run: handleMarkPaid, loading: creatingReceipt };
  } else if (invoice.status === 'paid') {
    primary = { label: t('invoices.share', 'שתף'), icon: 'share-variant', color: docColor, run: handleShare };
  }

  const discountAmount = Number((invoice as any).discountAmount ?? 0);

  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
      <ScreenHeader
        color={docColor}
        title={`${getDocLabel(invoice.type)}${invoice.documentNumber ? ` #${invoice.documentNumber}` : ''}`}
        onBack={() => router.back()}
        actions={
          <>
          <IconButton icon="eye-outline" iconColor={theme.custom.headerText} size={22} onPress={() => setPreviewVisible(true)} />
          <HeaderMenu
            items={[
              { key: 'share', title: t('invoices.share', 'שתף'), icon: 'share-variant', onPress: handleShare },
              { key: 'link', title: t('docs.copyLink', 'העתק קישור'), icon: 'link-variant', onPress: handleCopyLink },
              { key: 'receipt', title: t('invoices.markPaid', 'סמן כשולם (הפק קבלה)'), icon: 'cash-check', onPress: handleMarkPaid, hidden: openBalance <= 0 || primary?.icon === 'cash-check' },
            ]}
          />
          </>
        }
      />

      <InvoicePreviewModal
        visible={previewVisible}
        onDismiss={() => setPreviewVisible(false)}
        branding={branding}
        doc={{
          type: invoice.type,
          status: invoice.status,
          documentNumber: invoice.documentNumber,
          date: invoice.date,
          dueDate: invoice.dueDate,
          currency: invoice.currency,
          vatRate: invoice.vatRate,
          contactName: invoice.contactName,
          contactPhone: invoice.contactPhone,
          contactEmail: invoice.contactEmail,
          contactCompany: invoice.contactCompany,
          items: invoice.items || [],
          subtotal: invoice.subtotal,
          discountAmount,
          vatAmount: invoice.vatAmount,
          total: invoice.total,
          notes: invoice.notes,
          allocationNumber: invoice.allocationNumber,
        }}
      />

      <ScrollView contentContainerStyle={[styles.scrollContent, { paddingBottom: 120 + insets.bottom }]} showsVerticalScrollIndicator={false}>
        {/* Amount + status at a glance */}
        <View style={[styles.section, { backgroundColor: theme.colors.surface, alignItems: 'center', gap: 6 }]}>
          <Text style={{ color: docColor, fontSize: 30, fontWeight: '800' }}>{money(invoice.total)}</Text>
          <View style={{ backgroundColor: `${statusColor}20`, paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12 }}>
            <Text style={{ color: statusColor, fontWeight: '700', fontSize: 12 }}>{getStatusLabel(invoice.status)}</Text>
          </View>
          {openBalance > 0 ? (
            <Text variant="bodyMedium" style={{ color: overdue ? '#dc2626' : theme.colors.onSurface, fontWeight: '600' }}>
              {t('invoices.balanceDue', 'יתרה לתשלום')}: {money(openBalance)}
            </Text>
          ) : null}
          <View style={{ flexDirection, gap: 16, marginTop: 2 }}>
            {invoice.date ? (
              <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant }}>
                {t('invoices.issueDate', 'הוצאה')}: {formatDate(invoice.date)}
              </Text>
            ) : null}
            {invoice.dueDate ? (
              <Text variant="labelMedium" style={{ color: overdue ? '#dc2626' : theme.colors.onSurfaceVariant, fontWeight: overdue ? '700' : '400' }}>
                {t('invoices.dueDate', 'פירעון')}: {formatDate(invoice.dueDate)}
              </Text>
            ) : null}
          </View>
        </View>

        {/* Customer */}
        {(invoice.contactName || invoice.contactPhone || invoice.contactEmail || invoice.contactCompany) ? (
          <Pressable
            style={[styles.section, { backgroundColor: theme.colors.surface, gap: 8 }]}
            onPress={() => {
              const navId = invoice.contactId || invoice.contactPhone;
              if (navId) router.push({ pathname: '/(tabs)/contacts/[id]', params: { id: navId } });
            }}
            disabled={!invoice.contactId && !invoice.contactPhone}
          >
            {[
              { icon: 'account-outline', value: invoice.contactName, strong: true },
              { icon: 'phone-outline', value: invoice.contactPhone },
              { icon: 'email-outline', value: invoice.contactEmail },
              { icon: 'domain', value: invoice.contactCompany },
            ].filter((r) => !!r.value).map((r) => (
              <View key={r.icon} style={{ flexDirection, alignItems: 'center', gap: 8 }}>
                <MaterialCommunityIcons name={r.icon as any} size={16} color={theme.colors.onSurfaceVariant} />
                <Text variant="bodyMedium" style={{ flex: 1, textAlign, color: r.strong && invoice.contactId ? BRAND_COLOR : theme.colors.onSurface, fontWeight: r.strong ? '600' : '400' }}>
                  {r.value}
                </Text>
              </View>
            ))}
          </Pressable>
        ) : null}

        {/* Items + totals */}
        {invoice.items && invoice.items.length > 0 ? (
          <View style={[styles.section, { backgroundColor: theme.colors.surface }]}>
            <Text variant="titleSmall" style={[styles.sectionTitle, { color: theme.colors.onSurface, textAlign }]}>
              {t('invoices.items', 'פריטים')} ({invoice.items.length})
            </Text>
            {invoice.items.map((item, idx) => (
              <View
                key={idx}
                style={{ flexDirection, justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderTopWidth: idx > 0 ? StyleSheet.hairlineWidth : 0, borderTopColor: theme.colors.outlineVariant }}
              >
                <View style={{ flex: 1 }}>
                  <Text variant="bodySmall" style={{ color: theme.colors.onSurface, fontWeight: '600', textAlign }}>{item.description}</Text>
                  <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant, textAlign }}>×{item.quantity}</Text>
                </View>
                <Text variant="bodyMedium" style={{ color: docColor, fontWeight: '700' }}>
                  {money((item.unitPrice || 0) * (item.quantity || 0))}
                </Text>
              </View>
            ))}
            <Divider style={{ marginVertical: 8 }} />
            {invoice.subtotal != null ? (
              <View style={[styles.totalRow, { flexDirection }]}>
                <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>{t('invoices.subtotal', 'ביניים')}</Text>
                <Text variant="bodySmall" style={{ color: theme.colors.onSurface }}>{money(invoice.subtotal)}</Text>
              </View>
            ) : null}
            {discountAmount > 0 ? (
              <View style={[styles.totalRow, { flexDirection }]}>
                <Text variant="bodySmall" style={{ color: '#dc2626' }}>{t('invoices.discount', 'הנחה')}</Text>
                <Text variant="bodySmall" style={{ color: '#dc2626' }}>-{money(discountAmount)}</Text>
              </View>
            ) : null}
            {invoice.vatAmount != null ? (
              <View style={[styles.totalRow, { flexDirection }]}>
                <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>{t('invoices.vat', 'מע"מ')} ({invoice.vatRate ?? 18}%)</Text>
                <Text variant="bodySmall" style={{ color: theme.colors.onSurface }}>{money(invoice.vatAmount)}</Text>
              </View>
            ) : null}
            <View style={[styles.totalRow, { flexDirection, marginTop: 4 }]}>
              <Text variant="titleSmall" style={{ color: theme.colors.onSurface, fontWeight: '700' }}>{t('invoices.total', 'סה"כ')}</Text>
              <Text variant="titleSmall" style={{ color: docColor, fontWeight: '700' }}>{money(invoice.total)}</Text>
            </View>
          </View>
        ) : null}

        {invoice.notes ? (
          <View style={[styles.section, { backgroundColor: theme.colors.surface }]}>
            <Text variant="titleSmall" style={[styles.sectionTitle, { color: theme.colors.onSurface, textAlign }]}>{t('invoices.notes', 'הערות')}</Text>
            <Text variant="bodyMedium" style={{ color: theme.colors.onSurface, lineHeight: 22, textAlign }}>{invoice.notes}</Text>
          </View>
        ) : null}
      </ScrollView>

      {primary ? (
        <PrimaryActionBar label={primary.label} icon={primary.icon} color={primary.color} loading={primary.loading} onPress={primary.run} />
      ) : null}
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
    borderBottomWidth: 1,
  },
  catalogThumb: {
    width: 46,
    height: 46,
    borderRadius: 8,
  },
  catalogThumbPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  catalogChips: {
    marginTop: 4,
    gap: 4,
    alignItems: 'center',
  },
  catalogChip: {
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginEnd: 4,
    marginTop: 2,
    maxWidth: 200,
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
