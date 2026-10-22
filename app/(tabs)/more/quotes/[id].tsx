import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Share,
  TouchableOpacity,
  FlatList,
  BackHandler,
} from 'react-native';
import {
  Text,
  Chip,
  ActivityIndicator,
  Portal,
  Modal,
  TextInput,
  Button,
  IconButton,
  Divider,
  SegmentedButtons,
  Menu,
  Searchbar,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import * as Clipboard from 'expo-clipboard';
import { useAuthStore } from '../../../../stores/authStore';
import { useAppTheme } from '../../../../hooks/useAppTheme';
import { useRTL } from '../../../../hooks/useRTL';
import { quotesApi } from '../../../../services/api/quotes';
import { catalogApi, type CatalogCustomColumn, type CatalogFieldsConfig } from '../../../../services/api/catalog';
import { cacheEntity, getCachedEntity } from '../../../../services/entityCache';
import { chatsApi } from '../../../../services/api/chats';
import { contactsApi } from '../../../../services/api/contacts';
import { usersApi } from '../../../../services/api/users';
import { formatDate, formatCurrency, getInitials } from '../../../../utils/formatters';
import { placeSmartCall } from '../../../../utils/phoneCall';
import { getInvoiceParamsForStage } from '../../../../utils/quoteInvoiceStage';
import { borderRadius } from '../../../../constants/theme';
import type { Quote, QuoteItem, Contact, OrgUser } from '../../../../types';
import { useDirtyTracker } from '../../../../hooks/useDirtyTracker';
import { ScreenHeader } from '../../../../components/ScreenHeader';
import { HeaderMenu } from '../../../../components/HeaderMenu';
import { StatusFilterBar } from '../../../../components/StatusFilterBar';
import { StickySaveBar } from '../../../../components/StickySaveBar';
import { PrimaryActionBar } from '../../../../components/PrimaryActionBar';
import { CollapsibleSection } from '../../../../components/CollapsibleSection';

const STATUS_COLORS: Record<string, string> = {
  draft: '#9E9E9E',
  sent: '#2196F3',
  accepted: '#4CAF50',
  awaiting_payment: '#FF9800',
  paid: '#388E3C',
  rejected: '#F44336',
  expired: '#795548',
};

const STATUS_ICONS: Record<string, string> = {
  draft: 'file-edit-outline',
  sent: 'send-check',
  accepted: 'check-circle',
  awaiting_payment: 'clock-outline',
  paid: 'cash-check',
  rejected: 'close-circle',
  expired: 'clock-alert-outline',
};

const ALL_STATUSES = ['draft', 'sent', 'accepted', 'awaiting_payment', 'paid', 'rejected', 'expired'] as const;
const CURRENCIES = [
  { code: 'ILS', symbol: '₪', label: 'ILS (₪)' },
  { code: 'USD', symbol: '$', label: 'USD ($)' },
  { code: 'EUR', symbol: '€', label: 'EUR (€)' },
  { code: 'GBP', symbol: '£', label: 'GBP (£)' },
] as const;

function getStatusColor(status: string): string {
  return STATUS_COLORS[status] || '#9E9E9E';
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

// Full ordered token list (base + custom + link) honoring the web-configured column order.
function catResolveColumnOrder(savedOrder: any, customCols: CatalogCustomColumn[]): string[] {
  const customTokens = (customCols || []).map((c) => `custom:${c.id}`);
  const natural = [...CATALOG_BASE_TOKENS, ...customTokens, 'link'];
  const saved = Array.isArray(savedOrder) ? savedOrder.filter((tok: string) => natural.includes(tok)) : [];
  return [...saved, ...natural.filter((tok) => !saved.includes(tok))];
}

// The item's display title — prefer base fields, then the configured required (possibly custom)
// field, then the first filled custom column, so a catalog whose data lives only in custom fields
// (e.g. a car catalog) never renders a blank row.
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

function getCurrencySymbol(currency: string): string {
  const found = CURRENCIES.find((c) => c.code === currency);
  return found?.symbol || currency || '₪';
}

function createEmptyItem(): QuoteItem {
  return {
    id: `item_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    name: '',
    description: '',
    quantity: 1,
    unitPrice: 0,
    discount: 0,
    total: 0,
  };
}

export default function QuoteDetailScreen() {
  const router = useRouter();
  const { id, prefillContactName, prefillContactPhone, prefillTitle, prefillLeadId } = useLocalSearchParams<{
    id: string;
    prefillContactName?: string;
    prefillContactPhone?: string;
    prefillTitle?: string;
    prefillLeadId?: string;
  }>();
  const insets = useSafeAreaInsets();
  const theme = useAppTheme();
  const { isRTL, flexDirection, textAlign } = useRTL();
  const { t } = useTranslation();

  const user = useAuthStore((s) => s.user);

  // Show the quote we already loaded in the list immediately, then refresh in the
  // background — avoids the long full-screen spinner on a slow `getById` round-trip.
  const cachedQuote = id && id !== 'new' ? getCachedEntity<Quote>('quotes', id) : undefined;
  const [quote, setQuote] = useState<Quote | null>(cachedQuote ?? null);
  const [loading, setLoading] = useState(!cachedQuote);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [sending, setSending] = useState(false);

  const [saving, setSaving] = useState(false);
  const [statusSaving, setStatusSaving] = useState(false);
  const [formTitle, setFormTitle] = useState('');
  const [formContactName, setFormContactName] = useState('');
  const [formContactPhone, setFormContactPhone] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [formTerms, setFormTerms] = useState('');
  const [formDate, setFormDate] = useState('');
  const [formValidUntil, setFormValidUntil] = useState('');
  const [formDiscount, setFormDiscount] = useState('0');
  const [formDiscountType, setFormDiscountType] = useState<'percent' | 'fixed'>('fixed');
  const [formTax, setFormTax] = useState('18');
  const [formCurrency, setFormCurrency] = useState('ILS');
  const [formStatus, setFormStatus] = useState<string>('draft');
  const [formSalesperson, setFormSalesperson] = useState('');
  const [formSalespersonId, setFormSalespersonId] = useState('');
  const [formContactId, setFormContactId] = useState('');
  const [formItems, setFormItems] = useState<QuoteItem[]>([]);
  const [currencyMenuVisible, setCurrencyMenuVisible] = useState(false);
  const [statusMenuVisible, setStatusMenuVisible] = useState(false);
  const [previewVisible, setPreviewVisible] = useState(false);

  // Dirty tracking: a single contextual Save bar appears only when something changed (no "Edit" mode).
  // Status is saved on its own (one tap), so it is intentionally not part of the snapshot.
  const formSnapshot = useMemo(
    () =>
      JSON.stringify({
        t: formTitle,
        cn: formContactName,
        cp: formContactPhone,
        ci: formContactId,
        n: formNotes,
        tr: formTerms,
        d: formDate,
        vu: formValidUntil,
        di: formDiscount,
        dt: formDiscountType,
        tx: formTax,
        cu: formCurrency,
        sp: formSalespersonId || formSalesperson,
        it: formItems
          .filter((i) => (i.name || '').trim())
          .map((i) => [i.name, i.description || '', i.quantity, i.unitPrice, i.discount || 0]),
      }),
    [formTitle, formContactName, formContactPhone, formContactId, formNotes, formTerms, formDate, formValidUntil, formDiscount, formDiscountType, formTax, formCurrency, formSalesperson, formSalespersonId, formItems],
  );
  const { dirty, markClean } = useDirtyTracker(formSnapshot);
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;

  // Timeline (change history) — mirrors leads/cases so quote edits are documented & visible.
  const [timelineEvents, setTimelineEvents] = useState<any[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);

  // Contact picker modal
  const [contactPickerVisible, setContactPickerVisible] = useState(false);
  const [contactSearch, setContactSearch] = useState('');
  const [contactResults, setContactResults] = useState<Contact[]>([]);
  const [contactSearching, setContactSearching] = useState(false);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const contactDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // User picker
  const [orgUsers, setOrgUsers] = useState<OrgUser[]>([]);
  const [orgUsersLoading, setOrgUsersLoading] = useState(false);
  const [userPickerVisible, setUserPickerVisible] = useState(false);
  const [userSearch, setUserSearch] = useState('');

  // Catalog picker (from quote branding)
  const [inventoryVisible, setInventoryVisible] = useState(false);
  const [inventoryItems, setInventoryItems] = useState<any[]>([]);
  const [inventorySearch, setInventorySearch] = useState('');
  const [debouncedInventorySearch, setDebouncedInventorySearch] = useState('');
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [catalogColumns, setCatalogColumns] = useState<CatalogCustomColumn[]>([]);
  const [catalogFieldsConfig, setCatalogFieldsConfig] = useState<CatalogFieldsConfig>({});

  // Debounce the catalog search so filtering a large catalog (hundreds of items) stays snappy.
  useEffect(() => {
    const h = setTimeout(() => setDebouncedInventorySearch(inventorySearch), 200);
    return () => clearTimeout(h);
  }, [inventorySearch]);

  // Put a quote from the server into state and (unless the user has unsaved edits) into the form.
  const applyServerQuote = useCallback((q: Quote) => {
    setQuote(q);
    if (!dirtyRef.current) {
      openEditModeWithQuote(q);
      markClean();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchQuote = useCallback(async () => {
    if (!user?.organization || !id) return;
    try {
      setError(null);
      if (id === 'new') {
        let defaultNotes = '';
        let defaultTerms = '';
        let defaultTax = 18;
        let defaultCurrency = 'ILS';
        try {
          const branding = await quotesApi.getBranding(user.organization);
          if (branding) {
            defaultNotes = branding.defaultNotes || '';
            defaultTerms = branding.defaultTerms || '';
            defaultTax = branding.defaultTax ?? 18;
            defaultCurrency = branding.defaultCurrency || 'ILS';
          }
        } catch { /* use defaults */ }
        const newQuote: Quote = {
          id: 'new',
          title: prefillTitle || '',
          contactName: prefillContactName || '',
          contactPhone: prefillContactPhone || '',
          currency: defaultCurrency,
          items: [],
          status: 'draft',
          subtotal: 0,
          discount: 0,
          tax: defaultTax,
          total: 0,
          notes: defaultNotes,
          terms: defaultTerms,
          leadId: prefillLeadId || undefined,
        };
        setQuote(newQuote);
        openEditModeWithQuote(newQuote);
        markClean();
        setLoading(false);
        return;
      }
      const result = await quotesApi.getById(user.organization, id);
      if (result) {
        applyServerQuote(result);
        cacheEntity('quotes', result);
      } else {
        const allResult = await quotesApi.getAll(user.organization);
        const list = Array.isArray(allResult.data) ? allResult.data : [];
        const found = list.find((q) => q.id === id);
        if (found) {
          applyServerQuote(found);
        } else {
          setError(t('common.noResults'));
        }
      }
    } catch (err: any) {
      try {
        const allResult = await quotesApi.getAll(user.organization);
        const list = Array.isArray(allResult.data) ? allResult.data : [];
        const found = list.find((q) => q.id === id);
        if (found) {
          applyServerQuote(found);
        } else {
          setError(err.message || t('errors.generic'));
        }
      } catch {
        setError(err.message || t('errors.generic'));
      }
    } finally {
      setLoading(false);
    }
  }, [user?.organization, id, t]);

  useEffect(() => {
    fetchQuote();
  }, [fetchQuote]);

  // Load the quote's change history (created / updated / status changes) written by the backend.
  const fetchQuoteTimeline = useCallback(async () => {
    if (!user?.organization || !id || id === 'new') return;
    setTimelineLoading(true);
    try {
      const data = await contactsApi.getTimeline(user.organization, `quote_${id}`).catch(() => []);
      const arr = Array.isArray(data) ? data : [];
      arr.sort((a: any, b: any) => {
        const ta = new Date(a.createdOn || a.CreateDateTimeUTC || a.timestamp || 0).getTime();
        const tb = new Date(b.createdOn || b.CreateDateTimeUTC || b.timestamp || 0).getTime();
        return tb - ta;
      });
      setTimelineEvents(arr);
    } catch {
      setTimelineEvents([]);
    } finally {
      setTimelineLoading(false);
    }
  }, [user?.organization, id]);

  useEffect(() => {
    fetchQuoteTimeline();
  }, [fetchQuoteTimeline]);

  const openEditModeWithQuote = useCallback((q: Quote) => {
    setFormTitle(q.title || '');
    setFormContactName(q.contactName || '');
    setFormContactPhone(q.contactPhone || q.phoneNumber || '');
    setFormNotes(q.notes || '');
    setFormTerms(q.terms || '');
    setFormDate(q.date ? formatDate(q.date, 'yyyy-MM-dd') : '');
    setFormValidUntil(q.validUntil ? formatDate(q.validUntil, 'yyyy-MM-dd') : '');
    setFormDiscount(String(q.discount || 0));
    setFormDiscountType(q.discountType || 'fixed');
    setFormTax(String(q.tax ?? 18));
    setFormCurrency(q.currency || 'ILS');
    setFormStatus(q.status || 'draft');
    setFormSalesperson(q.salespersonName || '');
    setFormSalespersonId((q as any).salespersonId || '');
    setFormContactId((q as any).contactId || '');
    setFormItems(q.items && q.items.length > 0 ? q.items.map((i) => ({ ...i })) : [createEmptyItem()]);
  }, []);

  // Cached list item → fill the form instantly (the background refresh below only overwrites a clean form).
  useEffect(() => {
    if (cachedQuote) {
      openEditModeWithQuote(cachedQuote);
      markClean();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Throw away unsaved edits and restore the form from the saved quote.
  const discardChanges = useCallback(() => {
    if (!quote) return;
    openEditModeWithQuote(quote);
    setSelectedContact(null);
    markClean();
  }, [quote, openEditModeWithQuote, markClean]);

  const leaveScreen = useCallback(() => {
    if (id === 'new' && prefillLeadId) {
      router.replace({ pathname: '/(tabs)/leads/[id]', params: { id: prefillLeadId } });
    } else if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)/more/quotes');
    }
  }, [id, router, prefillLeadId]);

  // Back never silently drops edits: ask once, only when something actually changed.
  const handleBack = useCallback(() => {
    if (!dirty) {
      leaveScreen();
      return;
    }
    Alert.alert(
      t('docs.unsavedTitle', 'שינויים שלא נשמרו'),
      t('docs.unsavedMessage', 'לצאת בלי לשמור את השינויים?'),
      [
        { text: t('docs.keepEditing', 'המשך עריכה'), style: 'cancel' },
        { text: t('docs.exitWithoutSaving', 'צא בלי לשמור'), style: 'destructive', onPress: leaveScreen },
      ],
    );
  }, [dirty, leaveScreen, t]);

  useEffect(() => {
    if (!dirty) return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      handleBack();
      return true;
    });
    return () => sub.remove();
  }, [dirty, handleBack]);

  const calculatedTotals = useMemo(() => {
    const subtotal = formItems.reduce((sum, item) => {
      const itemTotal = item.quantity * item.unitPrice;
      const discounted = itemTotal - (item.discount || 0);
      return sum + Math.max(discounted, 0);
    }, 0);
    const discountValue = parseFloat(formDiscount) || 0;
    const discountAmount = formDiscountType === 'percent'
      ? subtotal * (discountValue / 100)
      : discountValue;
    const taxRate = parseFloat(formTax) || 0;
    const afterDiscount = Math.max(subtotal - discountAmount, 0);
    const taxAmount = afterDiscount * (taxRate / 100);
    const total = afterDiscount + taxAmount;
    return { subtotal, discountAmount, afterDiscount, taxAmount, total };
  }, [formItems, formDiscount, formDiscountType, formTax]);

  const updateItem = useCallback((index: number, field: keyof QuoteItem, value: any) => {
    setFormItems((prev) => {
      const updated = [...prev];
      const item = { ...updated[index], [field]: value };
      if (field === 'quantity' || field === 'unitPrice' || field === 'discount') {
        const raw = item.quantity * item.unitPrice;
        item.total = Math.max(raw - (item.discount || 0), 0);
      }
      updated[index] = item;
      return updated;
    });
  }, []);

  const addItem = useCallback(() => {
    setFormItems((prev) => [...prev, createEmptyItem()]);
  }, []);

  const removeItem = useCallback((index: number) => {
    setFormItems((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  // ── Contact lookup ────────────────────────────────────────────────
  const handleContactSearch = useCallback((text: string) => {
    setContactSearch(text);
    if (contactDebounceRef.current) clearTimeout(contactDebounceRef.current);
    setContactSearching(true);
    contactDebounceRef.current = setTimeout(async () => {
      try {
        const results = await contactsApi.search(user?.organization || '', text.trim() || ' ', 30);
        setContactResults(results);
      } catch { setContactResults([]); }
      finally { setContactSearching(false); }
    }, 300);
  }, [user?.organization]);

  const openContactPicker = useCallback(() => {
    setContactPickerVisible(true);
    setContactSearch('');
    setContactResults([]);
    setContactSearching(true);
    contactsApi.search(user?.organization || '', ' ', 30)
      .then((r) => setContactResults(r))
      .catch(() => setContactResults([]))
      .finally(() => setContactSearching(false));
  }, [user?.organization]);

  const handleSelectContact = useCallback((contact: Contact) => {
    setSelectedContact(contact);
    setFormContactId(contact.id || (contact as any).contactId || '');
    setFormContactName(contact.fullName || contact.name || '');
    setFormContactPhone(contact.phoneNumber || (contact as any).phone || '');
    setContactSearch('');
    setContactResults([]);
    setContactPickerVisible(false);
  }, []);

  const clearContact = useCallback(() => {
    setSelectedContact(null);
    setFormContactId('');
    setFormContactName('');
    setFormContactPhone('');
  }, []);

  // ── User picker ───────────────────────────────────────────────────
  const loadOrgUsers = useCallback(async () => {
    if (orgUsers.length > 0) return;
    setOrgUsersLoading(true);
    try {
      const users = await usersApi.getAll(user?.organization || '');
      setOrgUsers(users);
    } catch { setOrgUsers([]); }
    finally { setOrgUsersLoading(false); }
  }, [user?.organization, orgUsers.length]);

  const handleOpenUserPicker = useCallback(() => {
    setUserSearch('');
    setUserPickerVisible(true);
    loadOrgUsers();
  }, [loadOrgUsers]);

  // ── Catalog picker ───────────────────────────────────────────────
  // Load the FULL catalog (items + the custom columns and field config set in the web
  // Catalog → Columns settings) so the picker renders the same title + columns as the catalog
  // screen. Using branding.catalogItems alone left car-style catalogs (data only in custom fields)
  // showing blank rows.
  const openInventoryPicker = useCallback(async () => {
    setInventoryVisible(true);
    if (inventoryItems.length === 0) {
      setInventoryLoading(true);
      try {
        const data = await catalogApi.getAll(user?.organization || '');
        setInventoryItems(Array.isArray(data.catalogItems) ? data.catalogItems : []);
        setCatalogColumns(Array.isArray(data.catalogCustomColumns) ? data.catalogCustomColumns : []);
        setCatalogFieldsConfig(data.catalogFieldsConfig || {});
      } catch { setInventoryItems([]); }
      finally { setInventoryLoading(false); }
    }
  }, [user?.organization, inventoryItems.length]);

  // Column tokens in the web-configured order, and a visibility check honoring the web toggles.
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

  const filteredInventory = useMemo(() => {
    const q = debouncedInventorySearch.trim().toLowerCase();
    if (!q) return inventoryItems;
    // Search base fields (per config) plus any custom columns marked searchable — matching the
    // catalog screen — so a user can find an item by any meaningful column, not just its name.
    const sb = catalogFieldsConfig.searchBaseFields || { name: true, description: true, sku: true };
    const searchableCols = catalogColumns.filter((c) => c.searchable);
    return inventoryItems.filter((i) => {
      const baseHit =
        (sb.name !== false && (i.name || '').toLowerCase().includes(q)) ||
        (sb.description && (i.description || '').toLowerCase().includes(q)) ||
        (sb.sku && (i.sku || '').toLowerCase().includes(q)) ||
        (sb.category && (i.category || '').toLowerCase().includes(q)) ||
        (sb.unitPrice && String(i.unitPrice ?? '').toLowerCase().includes(q));
      if (baseHit) return true;
      const cf = i.customFields;
      if (cf) {
        if (searchableCols.length > 0) {
          for (const col of searchableCols) {
            const val = cf[col.key];
            if (val != null && String(val).toLowerCase().includes(q)) return true;
          }
        } else {
          // No column is explicitly flagged searchable → still let the user match any custom value.
          for (const key of Object.keys(cf)) {
            const val = cf[key];
            if (val != null && String(val).toLowerCase().includes(q)) return true;
          }
        }
      }
      return false;
    });
  }, [inventoryItems, debouncedInventorySearch, catalogFieldsConfig, catalogColumns]);

  const filteredUsers = useMemo(() => {
    if (!userSearch.trim()) return orgUsers;
    const q = userSearch.toLowerCase();
    return orgUsers.filter((u) => (u.userName || u.fullname || u.name || '').toLowerCase().includes(q));
  }, [orgUsers, userSearch]);

  const addFromInventory = useCallback((item: any) => {
    const price = parseFloat(item.unitPrice) || parseFloat(item.price) || 0;
    const { title, titleKey } = catBuildTitle(item, catalogColumns, catalogFieldsConfig, isRTL);
    // Build a compact description from the visible custom columns so the quote line keeps the
    // catalog context (e.g. year / mileage / ownership) even when the item has no plain description.
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
    const newItem: QuoteItem = {
      id: `item_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      name: title === '—' ? '' : title,
      description,
      quantity: 1,
      unitPrice: price,
      discount: 0,
      total: price,
    };
    setFormItems((prev) => [...prev, newItem]);
    setInventoryVisible(false);
    setInventorySearch('');
  }, [catalogColumns, catalogFieldsConfig, catalogColumnTokens, isCatalogTokenVisible, isRTL]);

  const handleSave = useCallback(async () => {
    if (!user?.organization || !formTitle.trim()) return;
    setSaving(true);
    try {
      const validItems = formItems
        .filter((item) => item.name.trim())
        .map((item) => ({
          ...item,
          total: Math.max(item.quantity * item.unitPrice - (item.discount || 0), 0),
        }));

      const quoteData: Partial<Quote> & { id: string } = {
        id: id === 'new' ? '' : (quote?.id || ''),
        title: formTitle.trim(),
        contactName: formContactName.trim() || undefined,
        contactPhone: formContactPhone.trim() || undefined,
        contactId: formContactId || undefined,
        salespersonId: formSalespersonId || undefined,
        notes: formNotes.trim() || undefined,
        terms: formTerms.trim() || undefined,
        date: formDate || undefined,
        validUntil: formValidUntil || undefined,
        items: validItems,
        subtotal: calculatedTotals.subtotal,
        discount: parseFloat(formDiscount) || 0,
        discountType: formDiscountType,
        discountAmount: calculatedTotals.discountAmount,
        afterDiscount: calculatedTotals.afterDiscount,
        tax: parseFloat(formTax) || 0,
        taxAmount: calculatedTotals.taxAmount,
        total: calculatedTotals.total,
        currency: formCurrency,
        status: (id === 'new' ? 'draft' : (quote?.status || 'draft')) as Quote['status'],
        salespersonName: formSalesperson.trim() || undefined,
      };

      if (id === 'new') {
        await quotesApi.create(
          user.organization,
          quoteData,
          user.uID || user.userId,
          user.fullname,
        );
        markClean();
        leaveScreen();
      } else {
        await quotesApi.update(
          user.organization,
          quoteData,
          user.uID || user.userId,
          user.fullname,
        );
        // Saved: the form is now the baseline, then pull the server-calculated values back in.
        markClean();
        await fetchQuote();
        fetchQuoteTimeline();
      }
    } catch (err: any) {
      Alert.alert(t('common.error'), err.message || t('errors.generic'));
    } finally {
      setSaving(false);
    }
  }, [user, quote, id, formTitle, formContactName, formContactPhone, formContactId, formNotes, formTerms, formDate, formValidUntil, formItems, calculatedTotals, formDiscount, formDiscountType, formTax, formCurrency, formSalesperson, formSalespersonId, fetchQuote, fetchQuoteTimeline, leaveScreen, markClean, t]);

  // One-tap status change (chips / primary button). Saved immediately, rolled back on failure.
  const handleChangeStatus = useCallback(async (newStatus: string) => {
    if (!user?.organization || !quote || id === 'new' || newStatus === quote.status) return;
    const prevStatus = quote.status;
    setQuote((q) => (q ? { ...q, status: newStatus as Quote['status'] } : q));
    setStatusSaving(true);
    try {
      await quotesApi.update(
        user.organization,
        { id: quote.id, status: newStatus as any },
        user.uID || user.userId,
        user.fullname,
      );
      cacheEntity('quotes', { ...quote, status: newStatus as Quote['status'] });
      fetchQuoteTimeline();
      // Quote Settings → "invoice from stage": open a pre-filled invoice draft for the new stage.
      const invoiceParams = await getInvoiceParamsForStage(user.organization, quote, newStatus);
      if (invoiceParams) router.push({ pathname: '/(tabs)/more/invoices/[id]', params: invoiceParams as any });
    } catch (err: any) {
      setQuote((q) => (q ? { ...q, status: prevStatus } : q));
      Alert.alert(t('common.error'), err.message || t('errors.generic'));
    } finally {
      setStatusSaving(false);
    }
  }, [user, quote, id, fetchQuoteTimeline, router, t]);

  const handleDelete = useCallback(() => {
    Alert.alert(
      t('common.delete'),
      t('quotes.deleteConfirm'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            if (!user?.organization || !quote) return;
            setDeleting(true);
            try {
              await quotesApi.delete(user.organization, quote.id);
              Alert.alert(t('common.success', 'הצלחה'), t('quotes.deleteSuccess', 'נמחק בהצלחה'));
              if (router.canGoBack()) {
                router.back();
              } else {
                router.replace('/(tabs)/more/quotes');
              }
            } catch (err: any) {
              Alert.alert(t('common.error'), err.message || t('errors.generic'));
              setDeleting(false);
            }
          },
        },
      ],
    );
  }, [user?.organization, quote, router, t]);

  const handleSendWhatsApp = useCallback(async () => {
    const phone = quote?.phoneNumber || quote?.contactPhone;
    if (!phone) {
      Alert.alert(t('common.error'), t('quotes.noPhoneNumber'));
      return;
    }
    if (!user?.organization) return;
    setSending(true);
    try {
      if (quote!.status === 'draft') {
        await quotesApi.update(user.organization, { id: quote!.id, status: 'sent' }, user?.uID || user?.userId, user?.fullname);
      }

      const publicUrl = `https://www.gambot.co.il/quote?org=${encodeURIComponent(user.organization)}&id=${encodeURIComponent(quote!.id || '')}`;
      const currSymbol = getCurrencySymbol(quote!.currency);

      let isLive = false;
      try {
        const expStr = await chatsApi.getConversationExpiration(user.organization, phone);
        if (expStr) {
          const expDate = new Date(expStr);
          isLive = !isNaN(expDate.getTime()) && expDate > new Date();
        }
      } catch { /* treat as closed */ }

      if (isLive) {
        const text = `שלום ${quote!.contactName || ''},\nהצעת המחיר "${quote!.title}" מוכנה עבורך 📄\n${t('quotes.quoteNumber')}: ${quote!.quoteNumber}\n${t('quotes.total')}: ${formatCurrency(quote!.total || 0, currSymbol)}\n\n${publicUrl}`;
        await chatsApi.sendMessage(
          user.organization,
          phone,
          text,
          user.fullname,
          user.uID || user.userId,
          undefined,
          user.wabaNumber || undefined,
          user.email || undefined,
        );
      } else {
        const defRes = await chatsApi.getDefaultMessageTemplates(user.organization);
        const tplAssignment = defRes?.Data?.templates?.sendQuote;
        const templateId = Array.isArray(tplAssignment?.templateId)
          ? (tplAssignment.templateId[0] || '')
          : (tplAssignment?.templateId || '');

        if (!templateId) {
          Alert.alert(t('common.error'), 'לא הוגדרה תבנית לשליחת הצעת מחיר. יש להגדיר תבנית ברירת מחדל בהגדרות.');
          return;
        }

        const mkEntry = (idx: number, val: string, label: string) => ({
          index: idx, bodyVarIndex: idx, Variable: `dynamic_var${idx}`,
          variableLabel: label, dataSource1: 'data_source1_HardCoded', dataSource2: '',
          conditionOperator: '', parameters_hardCoded_Text: val,
          field1: [], field2: [], table1: '', table2: '', retrieveFields: [],
        });

        await chatsApi.sendTemplateMessage(
          user.organization,
          phone,
          templateId,
          user.uID || user.userId,
          [
            mkEntry(1, quote!.contactName || '', 'שם לקוח'),
            mkEntry(2, quote!.title || '', 'כותרת הצעת מחיר'),
          ],
        );
      }

      Alert.alert('נשלח בהצלחה', isLive ? 'הצעת המחיר נשלחה בוואטסאפ' : 'תבנית הצעת מחיר נשלחה בוואטסאפ');
      await fetchQuote();
    } catch (err: any) {
      Alert.alert(t('common.error'), err.message || t('errors.generic'));
    } finally {
      setSending(false);
    }
  }, [quote, user, fetchQuote, t]);

  const handleShare = useCallback(async () => {
    if (!quote) return;
    const currSymbol = getCurrencySymbol(quote.currency);
    const publicUrl = `https://www.gambot.co.il/quote?org=${encodeURIComponent(user?.organization || '')}&id=${encodeURIComponent(quote.id || '')}`;
    try {
      await Share.share({
        message: `${quote.title}\n${t('quotes.quoteNumber')}: ${quote.quoteNumber}\n${t('quotes.total')}: ${formatCurrency(quote.total || 0, currSymbol)}\n\n${publicUrl}`,
      });
    } catch {
      // User cancelled
    }
  }, [quote, user?.organization, t]);

  const handleCopyLink = useCallback(async () => {
    if (!quote) return;
    const publicUrl = `https://www.gambot.co.il/quote?org=${encodeURIComponent(user?.organization || '')}&id=${encodeURIComponent(quote.id || '')}`;
    await Clipboard.setStringAsync(publicUrl);
    Alert.alert('הקישור הועתק', 'קישור לצפייה בהצעת המחיר הועתק ללוח');
  }, [quote, user?.organization]);

  const handleSendESignature = useCallback(() => {
    if (!quote) return;
    router.push({
      pathname: '/(tabs)/more/esignature/[id]',
      params: {
        id: 'new',
        quoteId: quote.id,
        quoteTitle: quote.title,
        contactName: quote.contactName || '',
        contactPhone: quote.contactPhone || quote.phoneNumber || '',
      },
    });
  }, [quote, router]);

  const handleCall = useCallback(async () => {
    const phone = quote?.contactPhone || quote?.phoneNumber;
    if (!phone) {
      Alert.alert(t('common.error'), t('quotes.noPhoneNumber'));
      return;
    }
    const relatedTo = (quote as any)?.leadId
      ? { type: 'lead' as const, entityId: (quote as any).leadId, entityName: quote?.contactName }
      : ((quote as any)?.contactId
        ? { type: 'contact' as const, entityId: (quote as any).contactId, entityName: quote?.contactName }
        : undefined);
    await placeSmartCall({
      phoneNumber: phone,
      organization: user?.organization || '',
      user,
      relatedTo,
      contactId: (quote as any)?.contactId,
      leadId: (quote as any)?.leadId,
      customerName: quote?.contactName,
    });
  }, [quote, user, t]);

  const handleWhatsAppChat = useCallback(() => {
    const phone = quote?.contactPhone || quote?.phoneNumber;
    if (!phone) {
      Alert.alert(t('common.error'), t('quotes.noPhoneNumber'));
      return;
    }
    const cleanPhone = phone.replace(/\D/g, '');
    router.push(`/(tabs)/chats/${cleanPhone}`);
  }, [quote, router, t]);

  if (loading) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  if (error || !quote) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.colors.background }]}>
        <View style={[styles.errorHeader, { paddingTop: insets.top + 8 }]}>
          <IconButton icon={isRTL ? 'arrow-right' : 'arrow-left'} iconColor="#FFFFFF" onPress={() => router.back()} />
        </View>
        <MaterialCommunityIcons
          name="alert-circle-outline"
          size={64}
          color={theme.colors.onSurfaceVariant}
          style={{ opacity: 0.4 }}
        />
        <Text variant="titleMedium" style={{ color: theme.colors.onSurface, marginTop: 12 }}>
          {error || t('common.noResults')}
        </Text>
        <Button mode="text" onPress={fetchQuote} style={{ marginTop: 8 }}>
          {t('common.retry')}
        </Button>
      </View>
    );
  }

  const currSymbol = getCurrencySymbol(quote.currency);
  const isNewQuote = id === 'new';
  const editCurrSymbol = getCurrencySymbol(formCurrency);
  const quotePhone = quote.contactPhone || quote.phoneNumber;

  const handleCreateInvoice = () => {
    router.push({
      pathname: '/(tabs)/more/invoices/[id]',
      params: {
        id: 'new',
        prefillContactName: quote.contactName || '',
        prefillContactPhone: quote.contactPhone || '',
        prefillRelatedQuoteId: quote.id || '',
      },
    });
  };

  // ONE prominent "next step", chosen by the quote's status. Everything else is in the "..." menu.
  let primaryAction: { label: string; icon: string; color: string; run: () => void; loading?: boolean } | null = null;
  if (!isNewQuote) {
    switch (quote.status) {
      case 'draft':
        primaryAction = { label: t('quotes.sendViaWhatsApp'), icon: 'whatsapp', color: '#25D366', run: handleSendWhatsApp, loading: sending };
        break;
      case 'sent':
        primaryAction = { label: t('docs.markAccepted', 'סמן כאושרה'), icon: 'check-circle', color: STATUS_COLORS.accepted, run: () => handleChangeStatus('accepted'), loading: statusSaving };
        break;
      case 'accepted':
      case 'paid':
        primaryAction = { label: t('invoices.generateFromQuote', 'הפק חשבונית מהצעה'), icon: 'file-document-check-outline', color: '#0891b2', run: handleCreateInvoice };
        break;
      case 'awaiting_payment':
        primaryAction = { label: t('docs.markPaid', 'סמן כשולם'), icon: 'cash-check', color: STATUS_COLORS.paid, run: () => handleChangeStatus('paid'), loading: statusSaving };
        break;
      default:
        primaryAction = { label: t('docs.backToDraft', 'החזר לטיוטה'), icon: 'file-edit-outline', color: STATUS_COLORS.draft, run: () => handleChangeStatus('draft'), loading: statusSaving };
    }
  }

  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
      <ScreenHeader
        title={isNewQuote ? t('quotes.addQuote') : quote.title}
        subtitle={!isNewQuote && quote.quoteNumber ? `#${quote.quoteNumber}` : undefined}
        onBack={handleBack}
        actions={
          !isNewQuote ? (
            <>
              <IconButton icon="eye-outline" iconColor={theme.custom.headerText} size={22} onPress={() => setPreviewVisible(true)} />
              <HeaderMenu
                items={[
                  { key: 'send', title: t('quotes.sendViaWhatsApp'), icon: 'whatsapp', onPress: handleSendWhatsApp, hidden: quote.status === 'draft' },
                  { key: 'share', title: t('quotes.share'), icon: 'share-variant', onPress: handleShare },
                  { key: 'link', title: t('docs.copyLink', 'העתק קישור'), icon: 'link-variant', onPress: handleCopyLink },
                  { key: 'esign', title: t('quotes.sendForESignature'), icon: 'draw-pen', onPress: handleSendESignature },
                  { key: 'invoice', title: t('invoices.generateFromQuote', 'הפק חשבונית מהצעה'), icon: 'file-document-check-outline', onPress: handleCreateInvoice },
                  { key: 'call', title: t('common.call'), icon: 'phone', onPress: handleCall, hidden: !quotePhone, dividerBefore: true },
                  { key: 'chat', title: t('quotes.openChat', 'פתח צ\'אט'), icon: 'whatsapp', onPress: handleWhatsAppChat, hidden: !quotePhone },
                  { key: 'delete', title: t('common.delete'), icon: 'delete-outline', onPress: handleDelete, destructive: true, disabled: deleting, dividerBefore: true },
                ]}
              />
            </>
          ) : null
        }
      />

      {/* One-tap status: tap a chip, it is saved immediately */}
      {!isNewQuote ? (
        <StatusFilterBar
          options={ALL_STATUSES.map((s) => ({ key: s, label: t('quotes.' + s), color: getStatusColor(s) }))}
          value={quote.status}
          onChange={handleChangeStatus}
        />
      ) : null}

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior="padding"
      >
        <ScrollView
          style={styles.body}
          contentContainerStyle={[styles.editContent, { paddingBottom: 120 + insets.bottom }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Basic Info */}
          <View
            style={[
              styles.sectionCard,
              { backgroundColor: theme.custom.cardBackground, borderColor: theme.colors.outlineVariant },
            ]}
          >
            <TextInput
              label={t('quotes.quoteTitle')}
              value={formTitle}
              onChangeText={setFormTitle}
              mode="outlined"
              style={styles.formInput}
              contentStyle={{ textAlign }}
              outlineColor={theme.colors.outline}
              activeOutlineColor={theme.colors.primary}
            />


            {/* Contact Picker */}
            {selectedContact ? (
              <Pressable
                onPress={openContactPicker}
                style={[styles.selectedContactCard, { backgroundColor: theme.colors.primaryContainer, borderColor: theme.colors.primary }]}
              >
                <View style={[styles.selectedContactRow, { flexDirection }]}>
                  <View style={[styles.contactAvatarSm, { backgroundColor: theme.colors.primary }]}>
                    <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>
                      {getInitials(selectedContact.fullName || selectedContact.name || '')}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text variant="bodyMedium" style={{ color: theme.colors.primary, fontWeight: '700', textAlign }}>
                      {selectedContact.fullName || selectedContact.name}
                    </Text>
                    {(selectedContact.phoneNumber || (selectedContact as any).phone) ? (
                      <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant, textAlign }}>
                        {selectedContact.phoneNumber || (selectedContact as any).phone}
                      </Text>
                    ) : null}
                  </View>
                  <TouchableOpacity onPress={clearContact} hitSlop={8}>
                    <MaterialCommunityIcons name="close-circle" size={20} color={theme.colors.primary} />
                  </TouchableOpacity>
                </View>
              </Pressable>
            ) : (
              <Pressable
                onPress={openContactPicker}
                style={[
                  styles.pickerButton,
                  { borderColor: theme.colors.outline, backgroundColor: theme.colors.surface },
                ]}
              >
                <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                  {t('quotes.contact')}
                </Text>
                <View style={[styles.pickerValueRow, { flexDirection }]}>
                  <MaterialCommunityIcons name="account-search" size={16} color={theme.colors.onSurfaceVariant} />
                  <Text variant="bodyMedium" style={{ color: formContactName ? theme.colors.onSurface : theme.colors.onSurfaceVariant, flex: 1, textAlign }}>
                    {formContactName || t('quotes.searchContact')}
                  </Text>
                  <MaterialCommunityIcons name="chevron-down" size={18} color={theme.colors.onSurfaceVariant} />
                </View>
              </Pressable>
            )}

            <TextInput
              label={t('quotes.contactPhone')}
              value={formContactPhone}
              onChangeText={setFormContactPhone}
              mode="outlined"
              style={styles.formInput}
              contentStyle={{ textAlign }}
              outlineColor={theme.colors.outline}
              activeOutlineColor={theme.colors.primary}
              keyboardType="phone-pad"
              right={<TextInput.Icon icon="phone" />}
            />
          </View>

          {/* Items */}
          <View
            style={[
              styles.sectionCard,
              { backgroundColor: theme.custom.cardBackground, borderColor: theme.colors.outlineVariant },
            ]}
          >
            <View style={[styles.sectionTitleRow, { flexDirection }]}>
              <Text variant="titleSmall" style={{ color: theme.colors.onSurface, fontWeight: '700' }}>
                {t('quotes.items')}
              </Text>
              <View style={[{ flexDirection }, { alignItems: 'center' }]}>
                <Button
                  mode="text"
                  compact
                  icon="package-variant"
                  onPress={openInventoryPicker}
                  textColor={theme.colors.secondary}
                  labelStyle={{ fontSize: 12 }}
                >
                  {t('quotes.fromCatalog') || 'מהקטלוג'}
                </Button>
                <IconButton
                  icon="plus-circle"
                  iconColor={theme.colors.primary}
                  size={24}
                  onPress={addItem}
                />
              </View>
            </View>

            {formItems.map((item, index) => (
              <View key={item.id || index}>
                {index > 0 && <Divider style={{ marginVertical: 12, backgroundColor: theme.colors.outlineVariant }} />}
                <View style={[styles.itemEditHeader, { flexDirection }]}>
                  <Text variant="labelLarge" style={{ color: theme.colors.onSurfaceVariant, fontWeight: '600' }}>
                    {t('quotes.items')} #{index + 1}
                  </Text>
                  {formItems.length > 1 && (
                    <IconButton
                      icon="delete-outline"
                      iconColor={theme.colors.error}
                      size={20}
                      onPress={() => removeItem(index)}
                    />
                  )}
                </View>
                <TextInput
                  label={t('quotes.itemDescription')}
                  value={item.name}
                  onChangeText={(v) => updateItem(index, 'name', v)}
                  mode="outlined"
                  dense
                  style={[styles.formInputDense, { textAlign }]}
                  outlineColor={theme.colors.outline}
                  activeOutlineColor={theme.colors.primary}
                />
                <View style={[styles.itemFieldsRow, { flexDirection }]}>
                  <TextInput
                    label={t('quotes.quantity')}
                    value={String(item.quantity)}
                    onChangeText={(v) => updateItem(index, 'quantity', parseInt(v) || 0)}
                    mode="outlined"
                    dense
                    keyboardType="numeric"
                    style={[styles.formInputDense, { flex: 1, textAlign }]}
                    outlineColor={theme.colors.outline}
                    activeOutlineColor={theme.colors.primary}
                  />
                  <TextInput
                    label={t('quotes.unitPrice')}
                    value={String(item.unitPrice)}
                    onChangeText={(v) => updateItem(index, 'unitPrice', parseFloat(v) || 0)}
                    mode="outlined"
                    dense
                    keyboardType="numeric"
                    style={[styles.formInputDense, { flex: 1, textAlign }]}
                    outlineColor={theme.colors.outline}
                    activeOutlineColor={theme.colors.primary}
                  />
                  <TextInput
                    label={t('quotes.discount')}
                    value={String(item.discount || 0)}
                    onChangeText={(v) => updateItem(index, 'discount', parseFloat(v) || 0)}
                    mode="outlined"
                    dense
                    keyboardType="numeric"
                    style={[styles.formInputDense, { flex: 1, textAlign }]}
                    outlineColor={theme.colors.outline}
                    activeOutlineColor={theme.colors.primary}
                  />
                </View>
                <Text
                  variant="labelMedium"
                  style={{ color: theme.colors.primary, fontWeight: '600', textAlign, marginTop: 4 }}
                >
                  {t('quotes.total')}: {formatCurrency(
                    Math.max(item.quantity * item.unitPrice - (item.discount || 0), 0),
                    editCurrSymbol,
                  )}
                </Text>
              </View>
            ))}
          </View>

          {/* Financials */}
          <View
            style={[
              styles.sectionCard,
              { backgroundColor: theme.custom.cardBackground, borderColor: theme.colors.outlineVariant },
            ]}
          >
            <Text variant="titleSmall" style={{ color: theme.colors.onSurface, fontWeight: '700', marginBottom: 12 }}>
              {t('quotes.financialSummary')}
            </Text>

            <View style={[styles.itemFieldsRow, { flexDirection }]}>
              <TextInput
                label={formDiscountType === 'percent' ? t('quotes.discountPercent') : t('quotes.discountFixed')}
                value={formDiscount}
                onChangeText={setFormDiscount}
                mode="outlined"
                dense
                keyboardType="numeric"
                style={[styles.formInputDense, { flex: 1, textAlign }]}
                outlineColor={theme.colors.outline}
                activeOutlineColor={theme.colors.primary}
              />
              <TextInput
                label={t('quotes.taxPercent')}
                value={formTax}
                onChangeText={setFormTax}
                mode="outlined"
                dense
                keyboardType="numeric"
                style={[styles.formInputDense, { flex: 1, textAlign }]}
                outlineColor={theme.colors.outline}
                activeOutlineColor={theme.colors.primary}
              />
            </View>

            <SegmentedButtons
              value={formDiscountType}
              onValueChange={(v) => setFormDiscountType(v as 'percent' | 'fixed')}
              buttons={[
                { value: 'percent', label: t('quotes.percent'), icon: 'percent' },
                { value: 'fixed', label: t('quotes.fixed'), icon: 'cash' },
              ]}
              style={{ marginBottom: 12 }}
            />

            <Divider style={{ marginVertical: 8, backgroundColor: theme.colors.outlineVariant }} />

            <View style={styles.summaryRow}>
              <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
                {t('quotes.subtotal')}
              </Text>
              <Text variant="bodyMedium" style={{ color: theme.colors.onSurface }}>
                {formatCurrency(calculatedTotals.subtotal, editCurrSymbol)}
              </Text>
            </View>
            {calculatedTotals.discountAmount > 0 && (
              <View style={styles.summaryRow}>
                <Text variant="bodyMedium" style={{ color: '#F44336' }}>
                  {t('quotes.discount')} {formDiscountType === 'percent' ? `(${formDiscount}%)` : ''}
                </Text>
                <Text variant="bodyMedium" style={{ color: '#F44336' }}>
                  -{formatCurrency(calculatedTotals.discountAmount, editCurrSymbol)}
                </Text>
              </View>
            )}
            {calculatedTotals.taxAmount > 0 && (
              <View style={styles.summaryRow}>
                <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
                  {t('quotes.tax')} ({formTax}%)
                </Text>
                <Text variant="bodyMedium" style={{ color: theme.colors.onSurface }}>
                  {formatCurrency(calculatedTotals.taxAmount, editCurrSymbol)}
                </Text>
              </View>
            )}
            <Divider style={{ marginVertical: 8, backgroundColor: theme.colors.outlineVariant }} />
            <View style={styles.summaryRow}>
              <Text variant="titleMedium" style={{ color: theme.colors.onSurface, fontWeight: '700' }}>
                {t('quotes.total')}
              </Text>
              <Text variant="titleLarge" style={{ color: theme.colors.primary, fontWeight: '800' }}>
                {formatCurrency(calculatedTotals.total, editCurrSymbol)}
              </Text>
            </View>
          </View>

          {/* Rarely used fields live behind ONE collapsed row */}
          <CollapsibleSection
            hint={[t('quotes.date'), t('quotes.validUntil'), t('quotes.currency'), t('quotes.salesperson'), t('quotes.notes'), t('quotes.terms')].join(' · ')}
          >
            {quote.quoteNumber ? (
              <TextInput
                label={t('quotes.quoteNumber')}
                value={`#${quote.quoteNumber}`}
                mode="outlined"
                disabled
                style={[styles.formInput, { textAlign }]}
                outlineColor={theme.colors.outline}
                right={<TextInput.Icon icon="pound" />}
              />
            ) : null}
            <View style={[styles.itemFieldsRow, { flexDirection }]}>
              <TextInput
                label={t('quotes.date')}
                value={formDate}
                onChangeText={setFormDate}
                mode="outlined"
                placeholder="YYYY-MM-DD"
                style={[styles.formInput, { flex: 1, textAlign }]}
                outlineColor={theme.colors.outline}
                activeOutlineColor={theme.colors.primary}
                right={<TextInput.Icon icon="calendar" />}
              />
              <TextInput
                label={t('quotes.validUntil')}
                value={formValidUntil}
                onChangeText={setFormValidUntil}
                mode="outlined"
                placeholder="YYYY-MM-DD"
                style={[styles.formInput, { flex: 1, textAlign }]}
                outlineColor={theme.colors.outline}
                activeOutlineColor={theme.colors.primary}
                right={<TextInput.Icon icon="calendar-clock" />}
              />
            </View>
            <View style={[styles.itemFieldsRow, { flexDirection }]}>
              <Menu
                visible={currencyMenuVisible}
                onDismiss={() => setCurrencyMenuVisible(false)}
                anchor={
                  <Pressable
                    onPress={() => setCurrencyMenuVisible(true)}
                    style={[
                      styles.pickerButton,
                      { flex: 1, borderColor: theme.colors.outline, backgroundColor: theme.colors.surface },
                    ]}
                  >
                    <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                      {t('quotes.currency')}
                    </Text>
                    <View style={[styles.pickerValueRow, { flexDirection }]}>
                      <Text variant="bodyMedium" style={{ color: theme.colors.onSurface, fontWeight: '600' }}>
                        {CURRENCIES.find((c) => c.code === formCurrency)?.label || formCurrency}
                      </Text>
                      <MaterialCommunityIcons name="chevron-down" size={18} color={theme.colors.onSurfaceVariant} />
                    </View>
                  </Pressable>
                }
                contentStyle={{ backgroundColor: theme.colors.surface }}
              >
                {CURRENCIES.map((c) => (
                  <Menu.Item
                    key={c.code}
                    onPress={() => { setFormCurrency(c.code); setCurrencyMenuVisible(false); }}
                    title={c.label}
                    titleStyle={formCurrency === c.code ? { color: theme.colors.primary, fontWeight: '600' } : undefined}
                  />
                ))}
              </Menu>
            </View>

            {/* Salesperson picker button */}
            <Pressable
              onPress={handleOpenUserPicker}
              style={[
                styles.pickerButton,
                { borderColor: theme.colors.outline, backgroundColor: theme.colors.surface },
              ]}
            >
              <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                {t('quotes.salesperson')}
              </Text>
              <View style={[styles.pickerValueRow, { flexDirection }]}>
                {orgUsersLoading ? (
                  <ActivityIndicator size={14} color={theme.colors.primary} />
                ) : (
                  <>
                    <MaterialCommunityIcons name="account-tie" size={16} color={theme.colors.onSurfaceVariant} />
                    <Text variant="bodyMedium" style={{ color: formSalesperson ? theme.colors.onSurface : theme.colors.onSurfaceVariant, fontWeight: formSalesperson ? '600' : '400', flex: 1, textAlign }}>
                      {formSalesperson || t('quotes.selectSalesperson')}
                    </Text>
                    <MaterialCommunityIcons name="chevron-down" size={18} color={theme.colors.onSurfaceVariant} />
                  </>
                )}
              </View>
            </Pressable>

            <TextInput
              label={t('quotes.notes')}
              value={formNotes}
              onChangeText={setFormNotes}
              mode="outlined"
              multiline
              numberOfLines={3}
              style={[styles.formInput, { textAlign }]}
              outlineColor={theme.colors.outline}
              activeOutlineColor={theme.colors.primary}
            />
            <TextInput
              label={t('quotes.terms')}
              value={formTerms}
              onChangeText={setFormTerms}
              mode="outlined"
              multiline
              numberOfLines={3}
              style={[styles.formInput, { textAlign }]}
              outlineColor={theme.colors.outline}
              activeOutlineColor={theme.colors.primary}
            />

            {quote.showShipping && quote.shipping && (quote.shipping.address || quote.shipping.city || quote.shipping.notes) ? (
              <View style={[styles.infoBox, { backgroundColor: '#f0f9ff', borderColor: '#bae6fd' }]}>
                <Text variant="titleSmall" style={{ color: '#0284c7', fontWeight: '700', textAlign }}>
                  🚚 {t('quotes.shippingDetails', 'פרטי משלוח')}
                </Text>
                {(quote.shipping.address || quote.shipping.city) ? (
                  <Text variant="bodyMedium" style={{ color: '#1f2937', textAlign }}>
                    {[quote.shipping.address, quote.shipping.city].filter(Boolean).join(', ')}
                    {quote.shipping.floor ? `\nקומה: ${quote.shipping.floor}` : ''}
                    {quote.shipping.elevator ? ' (מעלית זמינה)' : ''}
                  </Text>
                ) : null}
                {quote.shipping.notes ? (
                  <Text variant="bodySmall" style={{ color: '#64748b', textAlign }}>{quote.shipping.notes}</Text>
                ) : null}
              </View>
            ) : null}

            {quote.showBankDetails && quote.bankDetails && (quote.bankDetails.bankName || quote.bankDetails.accountNumber) ? (
              <View style={[styles.infoBox, { backgroundColor: '#f0fdf4', borderColor: '#bbf7d0' }]}>
                <Text variant="titleSmall" style={{ color: '#16a34a', fontWeight: '700', textAlign }}>
                  🏦 {t('quotes.bankDetails', 'פרטי בנק לתשלום')}
                </Text>
                {[
                  ['שם הבנק', quote.bankDetails.bankName],
                  ['מספר סניף', quote.bankDetails.branchNumber],
                  ['מספר חשבון', quote.bankDetails.accountNumber],
                  ['על שם', quote.bankDetails.accountName],
                ].filter(([, v]) => !!v).map(([label, value]) => (
                  <View key={label as string} style={{ flexDirection, justifyContent: 'space-between' }}>
                    <Text variant="bodyMedium" style={{ fontWeight: '600', color: '#374151' }}>{label}:</Text>
                    <Text variant="bodyMedium" style={{ color: '#1f2937' }}>{value as string}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </CollapsibleSection>

          {/* Change history (existing quotes only) */}
          {!isNewQuote ? (
            <CollapsibleSection
              icon="history"
              title={t('docs.changeHistory', 'היסטוריית שינויים')}
              hint={quote.sentAt ? `${t('quotes.sentDate')}: ${formatDate(quote.sentAt)}` : `${t('quotes.createdDate')}: ${formatDate(quote.createdOn || quote.createdAt || '')}`}
            >
              <View style={[styles.timestampRow, { flexDirection }]}>
                <MaterialCommunityIcons name="clock-outline" size={14} color={theme.colors.onSurfaceVariant} />
                <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>{t('quotes.createdDate')}:</Text>
                <Text variant="labelSmall" style={{ color: theme.colors.onSurface }}>{formatDate(quote.createdOn || quote.createdAt || '')}</Text>
              </View>
              {quote.sentAt ? (
                <View style={[styles.timestampRow, { flexDirection, marginBottom: 6 }]}>
                  <MaterialCommunityIcons name="send-check" size={14} color="#2196F3" />
                  <Text variant="labelSmall" style={{ color: '#2196F3' }}>{t('quotes.sentDate')}:</Text>
                  <Text variant="labelSmall" style={{ color: '#2196F3' }}>{formatDate(quote.sentAt)}</Text>
                </View>
              ) : null}
              {timelineLoading && timelineEvents.length === 0 ? (
                <ActivityIndicator size="small" color={theme.colors.primary} />
              ) : timelineEvents.length === 0 ? (
                <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, textAlign }}>
                  {isRTL ? 'אין עדיין תיעוד שינויים' : 'No change history yet'}
                </Text>
              ) : (
                timelineEvents.map((ev: any, idx: number) => {
                  const type = (ev.TimelineType || ev.timelineType || ev.type || '').toLowerCase();
                  const creator = ev.createdByName || ev.CreatedByName || '';
                  const ts = ev.createdOn || ev.CreateDateTimeUTC || ev.timestamp || '';
                  const note = ev.note || ev.Note || ev.notes || ev.description || '';
                  let icon = 'circle-small';
                  let color = theme.colors.primary;
                  let label = isRTL ? 'עדכון' : 'Update';
                  if (type === 'quote_created') { icon = 'file-plus-outline'; color = '#2e6155'; label = isRTL ? 'הצעה נוצרה' : 'Quote created'; }
                  else if (type === 'quote_status_change') { icon = 'swap-horizontal'; color = '#8b5cf6'; label = isRTL ? 'סטטוס שונה' : 'Status changed'; }
                  else if (type === 'quote_updated') { icon = 'pencil-outline'; color = '#d97706'; label = isRTL ? 'הצעה עודכנה' : 'Quote updated'; }
                  else if (type === 'note') { icon = 'note-text-outline'; color = '#0891b2'; label = isRTL ? 'הערה' : 'Note'; }
                  return (
                    <View key={ev.TimelineId || ev.timelineId || idx} style={{ flexDirection, gap: 10, marginBottom: 12, alignItems: 'flex-start' }}>
                      <MaterialCommunityIcons name={icon as any} size={18} color={color} style={{ marginTop: 2 }} />
                      <View style={{ flex: 1 }}>
                        <Text variant="labelMedium" style={{ color: theme.colors.onSurface, fontWeight: '700', textAlign }}>
                          {label}
                        </Text>
                        {note ? (
                          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, textAlign, writingDirection: isRTL ? 'rtl' : 'ltr' }}>
                            {note}
                          </Text>
                        ) : null}
                        <View style={{ flexDirection, gap: 6, marginTop: 2 }}>
                          {creator && creator.toLowerCase() !== 'system' ? (
                            <Text variant="labelSmall" style={{ color: theme.colors.primary }}>{creator}</Text>
                          ) : null}
                          {ts ? (
                            <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                              {formatDate(ts, 'dd/MM/yyyy HH:mm')}
                            </Text>
                          ) : null}
                        </View>
                      </View>
                    </View>
                  );
                })
              )}
            </CollapsibleSection>
          ) : null}
        </ScrollView>

        {/* Bottom: Save bar only when something changed, otherwise the ONE next-step button */}
        <StickySaveBar
          visible={dirty || isNewQuote}
          saving={saving}
          disabled={!formTitle.trim()}
          onSave={handleSave}
          onDiscard={!isNewQuote && dirty ? discardChanges : undefined}
          saveLabel={isNewQuote ? t('docs.createQuote', 'צור הצעת מחיר') : undefined}
        />
        {!dirty && primaryAction ? (
          <PrimaryActionBar
            label={primaryAction.label}
            icon={primaryAction.icon}
            color={primaryAction.color}
            loading={primaryAction.loading}
            onPress={primaryAction.run}
          />
        ) : null}
      </KeyboardAvoidingView>

      {/* Contact picker Modal */}
      <Portal>
        <Modal
          visible={contactPickerVisible}
          onDismiss={() => { setContactPickerVisible(false); setContactSearch(''); setContactResults([]); }}
          contentContainerStyle={[styles.inventoryModal, { backgroundColor: theme.colors.surface }]}
        >
          <View style={[styles.inventoryHeader, { flexDirection }]}>
            <Text variant="titleMedium" style={{ color: theme.colors.onSurface, fontWeight: '700', flex: 1, textAlign }}>
              {t('quotes.contact')}
            </Text>
            <IconButton icon="close" size={20} onPress={() => { setContactPickerVisible(false); setContactSearch(''); setContactResults([]); }} />
          </View>
          <Searchbar
            placeholder={t('quotes.searchContact')}
            value={contactSearch}
            onChangeText={handleContactSearch}
            style={{ marginHorizontal: 12, marginBottom: 8 }}
            autoFocus
            loading={contactSearching}
          />
          <FlatList
            data={contactResults}
            keyExtractor={(item) => item.id || (item as any).contactId || String(Math.random())}
            style={{ maxHeight: 380 }}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[styles.inventoryRow, { flexDirection, borderBottomColor: theme.colors.outlineVariant }]}
                onPress={() => handleSelectContact(item)}
              >
                <View style={[styles.contactAvatarSm, { backgroundColor: theme.colors.primaryContainer }]}>
                  <Text style={{ color: theme.colors.primary, fontWeight: '700', fontSize: 12 }}>
                    {getInitials(item.fullName || item.name || '')}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text variant="bodyMedium" style={{ color: theme.colors.onSurface, fontWeight: '600', textAlign }}>
                    {item.fullName || item.name}
                  </Text>
                  {(item.phoneNumber || (item as any).phone) ? (
                    <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant, textAlign }}>
                      {item.phoneNumber || (item as any).phone}
                    </Text>
                  ) : null}
                </View>
              </TouchableOpacity>
            )}
            ListEmptyComponent={
              <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center', margin: 24 }}>
                {contactSearching ? t('common.loading', 'טוען...') : t('common.noResults')}
              </Text>
            }
          />
        </Modal>
      </Portal>

      {/* Salesperson picker Modal */}
      <Portal>
        <Modal
          visible={userPickerVisible}
          onDismiss={() => { setUserPickerVisible(false); setUserSearch(''); }}
          contentContainerStyle={[styles.inventoryModal, { backgroundColor: theme.colors.surface }]}
        >
          <View style={[styles.inventoryHeader, { flexDirection }]}>
            <Text variant="titleMedium" style={{ color: theme.colors.onSurface, fontWeight: '700', flex: 1, textAlign }}>
              {t('quotes.salesperson')}
            </Text>
            <IconButton icon="close" size={20} onPress={() => { setUserPickerVisible(false); setUserSearch(''); }} />
          </View>
          <Searchbar
            placeholder={t('common.search')}
            value={userSearch}
            onChangeText={setUserSearch}
            style={{ marginHorizontal: 12, marginBottom: 8 }}
          />
          {orgUsersLoading ? (
            <ActivityIndicator size="large" color={theme.colors.primary} style={{ marginVertical: 32 }} />
          ) : (
            <FlatList
              data={filteredUsers}
              keyExtractor={(item) => item.uID || item.userId || String(Math.random())}
              style={{ maxHeight: 380 }}
              keyboardShouldPersistTaps="handled"
              ListHeaderComponent={
                <TouchableOpacity
                  style={[styles.inventoryRow, { flexDirection, borderBottomColor: theme.colors.outlineVariant }]}
                  onPress={() => { setFormSalesperson(''); setFormSalespersonId(''); setUserPickerVisible(false); setUserSearch(''); }}
                >
                  <MaterialCommunityIcons name="close-circle-outline" size={20} color={theme.colors.onSurfaceVariant} style={{ marginEnd: 8 }} />
                  <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
                    {t('common.none') || 'ללא'}
                  </Text>
                </TouchableOpacity>
              }
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.inventoryRow, { flexDirection, borderBottomColor: theme.colors.outlineVariant }]}
                  onPress={() => {
                    setFormSalesperson(item.userName || item.fullname || item.name || '');
                    setFormSalespersonId(item.uID || item.userId || item.id || '');
                    setUserPickerVisible(false);
                    setUserSearch('');
                  }}
                >
                  <View style={[styles.contactAvatarSm, { backgroundColor: theme.colors.primaryContainer }]}>
                    <Text style={{ color: theme.colors.primary, fontWeight: '700', fontSize: 12 }}>
                      {getInitials(item.userName || item.fullname || item.name || '')}
                    </Text>
                  </View>
                  <Text
                    variant="bodyMedium"
                    style={{
                      color: formSalespersonId === (item.uID || item.userId || item.id) ? theme.colors.primary : theme.colors.onSurface,
                      fontWeight: formSalespersonId === (item.uID || item.userId || item.id) ? '700' : '400',
                      flex: 1,
                      textAlign,
                    }}
                  >
                    {item.userName || item.fullname || item.name || ''}
                  </Text>
                  {formSalespersonId === (item.uID || item.userId) && (
                    <MaterialCommunityIcons name="check" size={18} color={theme.colors.primary} />
                  )}
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center', margin: 24 }}>
                  {t('common.noResults')}
                </Text>
              }
            />
          )}
        </Modal>
      </Portal>

      {/* Inventory picker - available in edit mode */}
      <Portal>
        <Modal
          visible={inventoryVisible}
          onDismiss={() => { setInventoryVisible(false); setInventorySearch(''); }}
          contentContainerStyle={[styles.inventoryModal, { backgroundColor: theme.colors.surface }]}
        >
          <View style={[styles.inventoryHeader, { flexDirection }]}>
            <Text variant="titleMedium" style={{ color: theme.colors.onSurface, fontWeight: '700', flex: 1, textAlign }}>
              {t('quotes.fromCatalog') || 'בחר מהקטלוג'}
            </Text>
            <IconButton icon="close" size={20} onPress={() => { setInventoryVisible(false); setInventorySearch(''); }} />
          </View>
          <Searchbar
            placeholder={t('common.search')}
            value={inventorySearch}
            onChangeText={setInventorySearch}
            style={{ marginHorizontal: 12, marginBottom: 8 }}
          />
          {inventoryLoading ? (
            <ActivityIndicator size="large" color={theme.colors.primary} style={{ marginVertical: 32 }} />
          ) : (
            <FlatList
              data={filteredInventory}
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
                // Meta chips for every visible column (base + custom) in the web-configured order.
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
                    onPress={() => addFromInventory(item)}
                  >
                    {hasImage ? (
                      <Image source={{ uri: item.images.filter(Boolean)[0] }} style={styles.inventoryThumb} contentFit="cover" />
                    ) : (
                      <View style={[styles.inventoryThumb, styles.inventoryThumbPlaceholder, { backgroundColor: theme.colors.primary + '15' }]}>
                        <MaterialCommunityIcons name="package-variant" size={20} color={theme.colors.primary} />
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
                        <View style={[styles.inventoryChips, { flexDirection, flexWrap: 'wrap' }]}>
                          {chips.slice(0, 6).map((c) => (
                            <View key={c.key} style={[styles.inventoryChip, { backgroundColor: theme.colors.onSurfaceVariant + '14' }]}>
                              <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 10 }} numberOfLines={1}>{c.label}</Text>
                            </View>
                          ))}
                        </View>
                      )}
                    </View>
                    <Text variant="bodyMedium" style={{ color: theme.colors.primary, fontWeight: '700', marginTop: 2 }}>
                      {price > 0 ? `₪${price.toLocaleString()}` : ''}
                    </Text>
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={
                <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center', margin: 24 }}>
                  {t('common.noResults')}
                </Text>
              }
            />
          )}
        </Modal>
      </Portal>
      {/* ─── Quote Preview Modal ─── */}
      <Portal>
        <Modal
          visible={previewVisible}
          onDismiss={() => setPreviewVisible(false)}
          contentContainerStyle={[styles.previewModal, { backgroundColor: '#fff' }]}
        >
          <View style={styles.previewHeader}>
            <Text style={styles.previewHeaderTitle}>{t('quotes.preview') || 'תצוגה מקדימה'}</Text>
            <IconButton icon="close" size={22} onPress={() => setPreviewVisible(false)} style={{ margin: 0 }} />
          </View>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.previewContent}>
            {/* Company banner */}
            <View style={[styles.previewDocHeader, { backgroundColor: '#2e6155' }]}>
              <Text style={styles.previewDocSubtitle}>{t('quotes.quote', 'הצעת מחיר')}{quote.quoteNumber ? ` #${quote.quoteNumber}` : ''}</Text>
              <Text style={styles.previewDocTitle}>{quote.title}</Text>
              <View style={{ marginTop: 6, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.2)' }}>
                <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>{t('quotes.' + quote.status, quote.status)}</Text>
              </View>
            </View>

            {/* Info grid */}
            <View style={styles.previewInfoGrid}>
              <View style={styles.previewInfoCol}>
                {quote.contactName ? (
                  <View style={styles.previewInfoRow}>
                    <Text style={styles.previewInfoLabel}>{t('quotes.contact') || 'לקוח'}</Text>
                    <Text style={styles.previewInfoValue}>{quote.contactName}</Text>
                  </View>
                ) : null}
                {quote.contactPhone ? (
                  <View style={styles.previewInfoRow}>
                    <Text style={styles.previewInfoLabel}>{t('common.phone') || 'טלפון'}</Text>
                    <Text style={styles.previewInfoValue}>{quote.contactPhone}</Text>
                  </View>
                ) : null}
              </View>
              <View style={styles.previewInfoCol}>
                <View style={styles.previewInfoRow}>
                  <Text style={styles.previewInfoLabel}>{t('quotes.createdDate') || 'תאריך'}</Text>
                  <Text style={styles.previewInfoValue}>{formatDate(quote.createdOn || quote.createdAt || '')}</Text>
                </View>
                {quote.validUntil ? (
                  <View style={styles.previewInfoRow}>
                    <Text style={styles.previewInfoLabel}>{t('quotes.validUntil') || 'בתוקף עד'}</Text>
                    <Text style={styles.previewInfoValue}>{formatDate(quote.validUntil)}</Text>
                  </View>
                ) : null}
              </View>
            </View>

            <Divider style={{ marginVertical: 12 }} />

            {/* Items table */}
            <View style={styles.previewTable}>
              <View style={[styles.previewTableRow, styles.previewTableHead]}>
                <Text style={[styles.previewTableCell, { flex: 3, fontWeight: '700' }]}>{t('quotes.item') || 'פריט'}</Text>
                <Text style={[styles.previewTableCell, { flex: 1, textAlign: 'center', fontWeight: '700' }]}>{t('quotes.qty') || 'כמות'}</Text>
                <Text style={[styles.previewTableCell, { flex: 1.5, textAlign: 'right', fontWeight: '700' }]}>{t('quotes.price') || 'מחיר'}</Text>
                <Text style={[styles.previewTableCell, { flex: 1.5, textAlign: 'right', fontWeight: '700' }]}>{t('quotes.total') || 'סה"כ'}</Text>
              </View>
              {(quote.items || []).filter(item => item.name?.trim()).map((item, idx) => (
                <View key={item.id || idx} style={[styles.previewTableRow, idx % 2 === 0 ? { backgroundColor: '#f9fafb' } : {}]}>
                  <View style={{ flex: 3 }}>
                    <Text style={styles.previewTableCell} numberOfLines={2}>{item.name}</Text>
                    {item.description ? (
                      <Text style={[styles.previewTableCell, { fontSize: 11, color: '#6b7280' }]} numberOfLines={1}>{item.description}</Text>
                    ) : null}
                  </View>
                  <Text style={[styles.previewTableCell, { flex: 1, textAlign: 'center' }]}>{item.quantity}</Text>
                  <Text style={[styles.previewTableCell, { flex: 1.5, textAlign: 'right' }]}>{formatCurrency(item.unitPrice, currSymbol)}</Text>
                  <Text style={[styles.previewTableCell, { flex: 1.5, textAlign: 'right', fontWeight: '600' }]}>{formatCurrency(item.total || item.quantity * item.unitPrice, currSymbol)}</Text>
                </View>
              ))}
            </View>

            <Divider style={{ marginVertical: 12 }} />

            {/* Totals */}
            <View style={styles.previewTotals}>
              <View style={styles.previewTotalRow}>
                <Text style={styles.previewTotalLabel}>{t('quotes.subtotal') || 'סכום ביניים'}</Text>
                <Text style={styles.previewTotalValue}>{formatCurrency(quote.subtotal || 0, currSymbol)}</Text>
              </View>
              {(quote.discountAmount || 0) > 0 ? (
                <View style={styles.previewTotalRow}>
                  <Text style={[styles.previewTotalLabel, { color: '#22c55e' }]}>{t('quotes.discount') || 'הנחה'}</Text>
                  <Text style={[styles.previewTotalValue, { color: '#22c55e' }]}>-{formatCurrency(quote.discountAmount || 0, currSymbol)}</Text>
                </View>
              ) : null}
              {(quote.taxAmount || 0) > 0 ? (
                <View style={styles.previewTotalRow}>
                  <Text style={styles.previewTotalLabel}>{t('quotes.tax') || 'מע"מ'} ({quote.tax || 0}%)</Text>
                  <Text style={styles.previewTotalValue}>{formatCurrency(quote.taxAmount || 0, currSymbol)}</Text>
                </View>
              ) : null}
              <View style={[styles.previewTotalRow, styles.previewGrandTotal]}>
                <Text style={styles.previewGrandTotalLabel}>{t('quotes.total') || 'סה"כ לתשלום'}</Text>
                <Text style={[styles.previewGrandTotalValue, { color: '#2e6155' }]}>{formatCurrency(quote.total || 0, currSymbol)}</Text>
              </View>
            </View>

            {/* Notes */}
            {quote.notes ? (
              <>
                <Divider style={{ marginVertical: 12 }} />
                <Text style={styles.previewSectionLabel}>{t('quotes.notes') || 'הערות'}</Text>
                <Text style={styles.previewNoteText}>{quote.notes}</Text>
              </>
            ) : null}

            {/* Terms */}
            {quote.terms ? (
              <>
                <Divider style={{ marginVertical: 12 }} />
                <Text style={styles.previewSectionLabel}>{t('quotes.terms') || 'תנאים'}</Text>
                <Text style={styles.previewNoteText}>{quote.terms}</Text>
              </>
            ) : null}

            {/* Shipping Details */}
            {quote.showShipping && quote.shipping && (quote.shipping.address || quote.shipping.city || quote.shipping.notes) ? (
              <>
                <Divider style={{ marginVertical: 12 }} />
                <Text style={[styles.previewSectionLabel, { color: '#0284c7' }]}>🚚 {t('quotes.shippingDetails', 'פרטי משלוח')}</Text>
                {(quote.shipping.address || quote.shipping.city) ? (
                  <Text style={styles.previewNoteText}>
                    {[quote.shipping.address, quote.shipping.city].filter(Boolean).join(', ')}
                    {quote.shipping.floor ? `\nקומה: ${quote.shipping.floor}` : ''}
                    {quote.shipping.elevator ? ' (מעלית זמינה)' : ''}
                  </Text>
                ) : null}
                {quote.shipping.notes ? (
                  <Text style={[styles.previewNoteText, { color: '#64748b', marginTop: 4 }]}>{quote.shipping.notes}</Text>
                ) : null}
              </>
            ) : null}

            {/* Bank Details */}
            {quote.showBankDetails && quote.bankDetails && (quote.bankDetails.bankName || quote.bankDetails.accountNumber) ? (
              <>
                <Divider style={{ marginVertical: 12 }} />
                <Text style={[styles.previewSectionLabel, { color: '#16a34a' }]}>🏦 {t('quotes.bankDetails', 'פרטי בנק לתשלום')}</Text>
                {quote.bankDetails.bankName ? (
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 }}>
                    <Text style={{ fontWeight: '600', fontSize: 13, color: '#374151' }}>שם הבנק:</Text>
                    <Text style={{ fontSize: 13, color: '#1f2937' }}>{quote.bankDetails.bankName}</Text>
                  </View>
                ) : null}
                {quote.bankDetails.branchNumber ? (
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 }}>
                    <Text style={{ fontWeight: '600', fontSize: 13, color: '#374151' }}>מספר סניף:</Text>
                    <Text style={{ fontSize: 13, color: '#1f2937' }}>{quote.bankDetails.branchNumber}</Text>
                  </View>
                ) : null}
                {quote.bankDetails.accountNumber ? (
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 }}>
                    <Text style={{ fontWeight: '600', fontSize: 13, color: '#374151' }}>מספר חשבון:</Text>
                    <Text style={{ fontWeight: '700', fontSize: 13, color: '#1f2937' }}>{quote.bankDetails.accountNumber}</Text>
                  </View>
                ) : null}
                {quote.bankDetails.accountName ? (
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 }}>
                    <Text style={{ fontWeight: '600', fontSize: 13, color: '#374151' }}>על שם:</Text>
                    <Text style={{ fontSize: 13, color: '#1f2937' }}>{quote.bankDetails.accountName}</Text>
                  </View>
                ) : null}
              </>
            ) : null}

            <View style={{ height: 24 }} />
          </ScrollView>

          {/* Action buttons */}
          <View style={[styles.previewFooter, { borderTopColor: '#e5e7eb' }]}>
            <Button
              mode="outlined"
              icon="whatsapp"
              onPress={() => { setPreviewVisible(false); handleSendWhatsApp(); }}
              style={{ flex: 1, borderRadius: 10, borderColor: '#25D366' }}
              textColor="#25D366"
            >
              {t('quotes.sendViaWhatsApp')}
            </Button>
            <Button
              mode="contained"
              icon="draw-pen"
              onPress={() => { setPreviewVisible(false); handleSendESignature(); }}
              style={{ flex: 1, borderRadius: 10, backgroundColor: '#00A86B' }}
              textColor="#fff"
            >
              {t('quotes.sendForESignature')}
            </Button>
          </View>
        </Modal>
      </Portal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: '#2e6155',
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: 8,
  },
  header: {
    paddingBottom: 4,
  },
  headerRow: {
    alignItems: 'center',
  },
  headerTitleText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 17,
  },
  body: { flex: 1 },
  bodyContent: {
    padding: 16,
    gap: 12,
  },
  editContent: {
    padding: 16,
    gap: 12,
  },
  statusBanner: {
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    padding: 16,
  },
  statusBannerInner: {
    alignItems: 'center',
    gap: 12,
  },
  statusIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusBadge: {
    height: 32,
    borderRadius: 16,
  },
  statusBadgeText: {
    fontSize: 13,
    fontWeight: '700',
  },
  sectionCard: {
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    padding: 16,
  },
  sectionLabel: {
    fontWeight: '600',
    marginBottom: 10,
  },
  sectionTitleRow: {
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  contactAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tableHeader: {
    borderRadius: borderRadius.sm,
    paddingVertical: 8,
    paddingHorizontal: 8,
    marginBottom: 4,
  },
  tableHeaderCell: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  tableBody: {
    maxHeight: 300,
  },
  tableRow: {
    paddingVertical: 10,
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  tableCell: {
    fontSize: 13,
    textAlign: 'center',
  },
  tableItemName: { flex: 3 },
  tableItemQty: { flex: 1, textAlign: 'center' },
  tableItemPrice: { flex: 1.5, textAlign: 'center' },
  tableItemTotal: { flex: 1.5, textAlign: 'center' },
  noItems: {
    alignItems: 'center',
    paddingVertical: 20,
    gap: 8,
  },
  financialCard: {
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    padding: 16,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  detailRow: {
    alignItems: 'center',
    gap: 12,
    paddingVertical: 2,
  },
  detailIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailContent: {
    flex: 1,
    gap: 2,
  },
  timestampRow: {
    alignItems: 'center',
    gap: 6,
  },
  infoBox: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    gap: 4,
    marginBottom: 12,
  },
  actionsContainer: {
    gap: 10,
  },
  actionButton: {
    borderRadius: borderRadius.md,
    elevation: 2,
  },
  actionButtonHalf: {
    flex: 1,
    borderRadius: borderRadius.md,
  },
  actionButtonContent: {
    paddingVertical: 6,
  },
  actionRow: {
    gap: 10,
  },
  formInput: {
    marginBottom: 14,
  },
  formInputDense: {
    marginBottom: 8,
  },
  itemEditHeader: {
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  itemFieldsRow: {
    gap: 8,
    marginBottom: 4,
  },
  pickerButton: {
    borderWidth: 1,
    borderRadius: borderRadius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 4,
    marginBottom: 14,
  },
  pickerValueRow: {
    alignItems: 'center',
    gap: 4,
  },
  // Preview modal styles
  previewModal: {
    marginHorizontal: 12,
    borderRadius: 16,
    maxHeight: '92%',
    overflow: 'hidden',
  },
  previewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    backgroundColor: '#fff',
  },
  previewHeaderTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#111827',
  },
  previewContent: { padding: 16 },
  previewDocHeader: {
    borderRadius: 10,
    padding: 16,
    marginBottom: 16,
    alignItems: 'center',
    gap: 4,
  },
  previewDocTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#fff',
    textAlign: 'center',
  },
  previewDocSubtitle: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.85)',
    textAlign: 'center',
  },
  previewInfoGrid: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 4,
  },
  previewInfoCol: { flex: 1, gap: 6 },
  previewInfoRow: { gap: 1 },
  previewInfoLabel: { fontSize: 11, color: '#6b7280', fontWeight: '500' },
  previewInfoValue: { fontSize: 13, color: '#111827', fontWeight: '600' },
  previewTable: { gap: 2 },
  previewTableHead: { backgroundColor: '#f3f4f6', borderRadius: 6 },
  previewTableRow: {
    flexDirection: 'row',
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderRadius: 4,
    alignItems: 'center',
  },
  previewTableCell: { fontSize: 12, color: '#374151' },
  previewTotals: { gap: 6 },
  previewTotalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  previewTotalLabel: { fontSize: 13, color: '#6b7280' },
  previewTotalValue: { fontSize: 13, color: '#374151', fontWeight: '500' },
  previewGrandTotal: {
    backgroundColor: '#f9fafb',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginTop: 4,
  },
  previewGrandTotalLabel: { fontSize: 15, fontWeight: '700', color: '#111827' },
  previewGrandTotalValue: { fontSize: 18, fontWeight: '800' },
  previewSectionLabel: { fontSize: 13, fontWeight: '700', color: '#374151', marginBottom: 6 },
  previewNoteText: { fontSize: 13, color: '#6b7280', lineHeight: 20 },
  previewFooter: {
    flexDirection: 'row',
    gap: 10,
    padding: 16,
    borderTopWidth: 1,
    backgroundColor: '#fff',
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  lookupWrapper: {
    position: 'relative',
    zIndex: 10,
    marginBottom: 0,
  },
  contactDropdown: {
    borderWidth: 1,
    borderRadius: borderRadius.md,
    marginTop: -8,
    marginBottom: 14,
    overflow: 'hidden',
  },
  contactRow: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignItems: 'center',
    gap: 10,
  },
  contactAvatarSm: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectedContactCard: {
    borderWidth: 1.5,
    borderRadius: borderRadius.md,
    padding: 10,
    marginBottom: 14,
  },
  selectedContactRow: {
    alignItems: 'center',
    gap: 10,
  },
  inventoryModal: {
    marginHorizontal: 16,
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
    paddingBottom: 12,
  },
  inventoryHeader: {
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 4,
  },
  inventoryRow: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: 'center',
    gap: 10,
    borderBottomWidth: 1,
  },
  inventoryThumb: {
    width: 46,
    height: 46,
    borderRadius: 8,
  },
  inventoryThumbPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  inventoryChips: {
    marginTop: 4,
    gap: 4,
    alignItems: 'center',
  },
  inventoryChip: {
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginEnd: 4,
    marginTop: 2,
    maxWidth: 200,
  },
});
