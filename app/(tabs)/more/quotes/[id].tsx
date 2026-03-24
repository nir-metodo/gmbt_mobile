import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Linking,
  Share,
  TouchableOpacity,
  FlatList,
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
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../../../stores/authStore';
import { useAppTheme } from '../../../../hooks/useAppTheme';
import { useRTL } from '../../../../hooks/useRTL';
import { quotesApi } from '../../../../services/api/quotes';
import { contactsApi } from '../../../../services/api/contacts';
import { usersApi } from '../../../../services/api/users';
import { formatDate, formatCurrency, getInitials } from '../../../../utils/formatters';
import { makeAppCall } from '../../../../utils/phoneCall';
import { borderRadius } from '../../../../constants/theme';
import type { Quote, QuoteItem, Contact, OrgUser } from '../../../../types';

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

  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [sending, setSending] = useState(false);

  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
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
  const [inventoryLoading, setInventoryLoading] = useState(false);

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
        setEditMode(true);
        openEditModeWithQuote(newQuote);
        setLoading(false);
        return;
      }
      const result = await quotesApi.getById(user.organization, id);
      if (result) {
        setQuote(result);
      } else {
        const allResult = await quotesApi.getAll(user.organization);
        const list = Array.isArray(allResult.data) ? allResult.data : [];
        const found = list.find((q) => q.id === id);
        if (found) {
          setQuote(found);
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
          setQuote(found);
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
    setFormTax(String(q.tax || 18));
    setFormCurrency(q.currency || 'ILS');
    setFormStatus(q.status || 'draft');
    setFormSalesperson(q.salespersonName || '');
    setFormSalespersonId((q as any).salespersonId || '');
    setFormContactId((q as any).contactId || '');
    setFormItems(q.items && q.items.length > 0 ? q.items.map((i) => ({ ...i })) : [createEmptyItem()]);
  }, []);

  const openEditMode = useCallback(() => {
    if (!quote) return;
    openEditModeWithQuote(quote);
    setEditMode(true);
  }, [quote, openEditModeWithQuote]);

  const closeEditMode = useCallback(() => {
    if (id === 'new') {
      router.back();
      return;
    }
    setEditMode(false);
  }, [id, router]);

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

  const filteredUsers = useMemo(() => {
    if (!userSearch.trim()) return orgUsers;
    const q = userSearch.toLowerCase();
    return orgUsers.filter((u) => (u.fullname || u.name || '').toLowerCase().includes(q));
  }, [orgUsers, userSearch]);

  const addFromInventory = useCallback((item: any) => {
    const price = parseFloat(item.unitPrice) || parseFloat(item.price) || 0;
    const newItem: QuoteItem = {
      id: `item_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      name: item.name || item.description || '',
      description: item.description && item.name ? item.description : '',
      quantity: 1,
      unitPrice: price,
      discount: 0,
      total: price,
    };
    setFormItems((prev) => [...prev, newItem]);
    setInventoryVisible(false);
    setInventorySearch('');
  }, []);

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
        status: formStatus as Quote['status'],
        salespersonName: formSalesperson.trim() || undefined,
      };

      if (id === 'new') {
        await quotesApi.create(
          user.organization,
          quoteData,
          user.uID || user.userId,
          user.fullname,
        );
        router.back();
      } else {
        await quotesApi.update(
          user.organization,
          quoteData,
          user.uID || user.userId,
          user.fullname,
        );
        setEditMode(false);
        await fetchQuote();
      }
    } catch (err: any) {
      Alert.alert(t('common.error'), err.message || t('errors.generic'));
    } finally {
      setSaving(false);
    }
  }, [user, quote, id, formTitle, formContactName, formContactPhone, formContactId, formNotes, formTerms, formDate, formValidUntil, formItems, calculatedTotals, formDiscount, formDiscountType, formTax, formCurrency, formStatus, formSalesperson, formSalespersonId, fetchQuote, router, t]);

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
              router.back();
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
    setSending(true);
    try {
      if (quote!.status === 'draft') {
        await quotesApi.update(user!.organization, { id: quote!.id, status: 'sent' }, user?.uID || user?.userId, user?.fullname);
      }
      const currSymbol = getCurrencySymbol(quote!.currency);
      const message = encodeURIComponent(
        `${t('quotes.title')}: ${quote!.title}\n${t('quotes.quoteNumber')}: ${quote!.quoteNumber}\n${t('quotes.total')}: ${formatCurrency(quote!.total || 0, currSymbol)} ${quote!.currency || ''}`.trim(),
      );
      const cleanPhone = phone.replace(/\D/g, '');
      await Linking.openURL(`whatsapp://send?phone=${cleanPhone}&text=${message}`);
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
    try {
      await Share.share({
        message: `${quote.title}\n${t('quotes.quoteNumber')}: ${quote.quoteNumber}\n${t('quotes.total')}: ${formatCurrency(quote.total || 0, currSymbol)}`,
      });
    } catch {
      // User cancelled
    }
  }, [quote, t]);

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
    await makeAppCall({
      phoneNumber: phone,
      organization: user?.organization || '',
      callerUserId: user?.uID || user?.userId,
      callerUserName: user?.fullname,
      contactName: quote?.contactName,
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

  const statusColor = getStatusColor(quote.status);
  const statusIcon = STATUS_ICONS[quote.status] || 'file-document';
  const currSymbol = getCurrencySymbol(quote.currency);

  // ─── EDIT MODE ───
  if (editMode) {
    const editCurrSymbol = getCurrencySymbol(formCurrency);
    return (
      <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
        <View
          style={[
            styles.header,
            { backgroundColor: theme.custom.headerBackground, paddingTop: insets.top + 4 },
          ]}
        >
          <View style={[styles.headerRow, { flexDirection }]}>
            <IconButton
              icon="close"
              iconColor={theme.custom.headerText}
              size={24}
              onPress={closeEditMode}
            />
            <Text
              variant="titleMedium"
              numberOfLines={1}
              style={[styles.headerTitleText, { flex: 1, textAlign }]}
            >
              {id === 'new' ? t('quotes.addQuote') : t('quotes.editQuote')}
            </Text>
            <Button
              mode="text"
              onPress={handleSave}
              loading={saving}
              disabled={!formTitle.trim() || saving}
              textColor={theme.custom.headerText}
              labelStyle={{ fontWeight: '700' }}
            >
              {t('common.save')}
            </Button>
          </View>
        </View>

        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.editContent}
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

              {quote.quoteNumber && id !== 'new' ? (
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

              {/* Currency + Status row */}
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

                <Menu
                  visible={statusMenuVisible}
                  onDismiss={() => setStatusMenuVisible(false)}
                  anchor={
                    <Pressable
                      onPress={() => setStatusMenuVisible(true)}
                      style={[
                        styles.pickerButton,
                        { flex: 1, borderColor: theme.colors.outline, backgroundColor: theme.colors.surface },
                      ]}
                    >
                      <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                        {t('quotes.status')}
                      </Text>
                      <View style={[styles.pickerValueRow, { flexDirection }]}>
                        <View style={[styles.statusDot, { backgroundColor: getStatusColor(formStatus) }]} />
                        <Text variant="bodyMedium" style={{ color: theme.colors.onSurface, fontWeight: '600' }}>
                          {t(`quotes.${formStatus}`)}
                        </Text>
                        <MaterialCommunityIcons name="chevron-down" size={18} color={theme.colors.onSurfaceVariant} />
                      </View>
                    </Pressable>
                  }
                  contentStyle={{ backgroundColor: theme.colors.surface }}
                >
                  {ALL_STATUSES.map((s) => (
                    <Menu.Item
                      key={s}
                      onPress={() => { setFormStatus(s); setStatusMenuVisible(false); }}
                      title={t(`quotes.${s}`)}
                      leadingIcon={() => <View style={[styles.statusDot, { backgroundColor: getStatusColor(s) }]} />}
                      titleStyle={formStatus === s ? { color: theme.colors.primary, fontWeight: '600' } : undefined}
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

            {/* Notes + Terms */}
            <View
              style={[
                styles.sectionCard,
                { backgroundColor: theme.custom.cardBackground, borderColor: theme.colors.outlineVariant },
              ]}
            >
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
            </View>

            <View style={{ height: insets.bottom + 24 }} />
          </ScrollView>
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
                      setFormSalesperson(item.fullname || item.name || '');
                      setFormSalespersonId(item.uID || item.userId || '');
                      setUserPickerVisible(false);
                      setUserSearch('');
                    }}
                  >
                    <View style={[styles.contactAvatarSm, { backgroundColor: theme.colors.primaryContainer }]}>
                      <Text style={{ color: theme.colors.primary, fontWeight: '700', fontSize: 12 }}>
                        {getInitials(item.fullname || item.name || '')}
                      </Text>
                    </View>
                    <Text
                      variant="bodyMedium"
                      style={{
                        color: formSalespersonId === (item.uID || item.userId) ? theme.colors.primary : theme.colors.onSurface,
                        fontWeight: formSalespersonId === (item.uID || item.userId) ? '700' : '400',
                        flex: 1,
                        textAlign,
                      }}
                    >
                      {item.fullname || item.name || ''}
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
                keyExtractor={(_item, i) => String(i)}
                style={{ maxHeight: 360 }}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={[styles.inventoryRow, { flexDirection, borderBottomColor: theme.colors.outlineVariant }]}
                    onPress={() => addFromInventory(item)}
                  >
                    <View style={{ flex: 1 }}>
                      <Text variant="bodyMedium" style={{ color: theme.colors.onSurface, fontWeight: '600', textAlign }}>
                        {item.name || item.description || ''}
                      </Text>
                      {item.description && item.name ? (
                        <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant, textAlign }}>
                          {item.description}
                        </Text>
                      ) : null}
                    </View>
                    <Text variant="bodyMedium" style={{ color: theme.colors.primary, fontWeight: '700' }}>
                      {(item.unitPrice || item.price) != null ? `₪${Number(item.unitPrice || item.price || 0).toFixed(2)}` : ''}
                    </Text>
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
      </View>
    );
  }

  // ─── VIEW MODE ───
  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
      {/* Header */}
      <View
        style={[
          styles.header,
          { backgroundColor: theme.custom.headerBackground, paddingTop: insets.top + 4 },
        ]}
      >
        <View style={[styles.headerRow, { flexDirection }]}>
          <IconButton
            icon={isRTL ? 'arrow-right' : 'arrow-left'}
            iconColor={theme.custom.headerText}
            size={24}
            onPress={() => router.back()}
          />
          <Text
            variant="titleMedium"
            numberOfLines={1}
            style={[styles.headerTitleText, { flex: 1, textAlign }]}
          >
            {quote.title}
          </Text>
          <IconButton
            icon="eye-outline"
            iconColor={theme.custom.headerText}
            size={22}
            onPress={() => setPreviewVisible(true)}
          />
          <IconButton
            icon="pencil"
            iconColor={theme.custom.headerText}
            size={22}
            onPress={openEditMode}
          />
          <IconButton
            icon="share-variant"
            iconColor={theme.custom.headerText}
            size={22}
            onPress={handleShare}
          />
          <IconButton
            icon="delete-outline"
            iconColor={theme.custom.headerText}
            size={22}
            onPress={handleDelete}
            disabled={deleting}
          />
        </View>
      </View>

      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Status Banner */}
        <View
          style={[
            styles.statusBanner,
            { backgroundColor: `${statusColor}12`, borderColor: `${statusColor}40` },
          ]}
        >
          <View style={[styles.statusBannerInner, { flexDirection }]}>
            <View style={[styles.statusIconWrap, { backgroundColor: `${statusColor}20` }]}>
              <MaterialCommunityIcons name={statusIcon as any} size={28} color={statusColor} />
            </View>
            <View style={{ flex: 1, gap: 4 }}>
              <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant, textAlign }}>
                {t('quotes.quoteNumber')}
              </Text>
              <Text variant="titleMedium" style={{ color: theme.colors.onSurface, fontWeight: '700', textAlign }}>
                #{quote.quoteNumber}
              </Text>
            </View>
            <Chip
              textStyle={[styles.statusBadgeText, { color: statusColor }]}
              style={[styles.statusBadge, { backgroundColor: `${statusColor}20` }]}
            >
              {t(`quotes.${quote.status}`)}
            </Chip>
          </View>
        </View>

        {/* Contact Info */}
        {quote.contactName ? (
          <Pressable
            onPress={() => {
              if (quote.contactId) {
                router.push({ pathname: '/(tabs)/contacts/[id]', params: { id: quote.contactId } });
              }
            }}
            style={[
              styles.sectionCard,
              { backgroundColor: theme.custom.cardBackground, borderColor: theme.colors.outlineVariant },
            ]}
          >
            <View style={[styles.contactRow, { flexDirection }]}>
              <View style={[styles.contactAvatar, { backgroundColor: theme.colors.primaryContainer }]}>
                <MaterialCommunityIcons name="account" size={24} color={theme.colors.primary} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant, textAlign }}>
                  {t('quotes.contact')}
                </Text>
                <Text variant="bodyLarge" style={{ color: theme.colors.primary, fontWeight: '600', textAlign }}>
                  {quote.contactName}
                </Text>
                {(quote.contactPhone || quote.phoneNumber) ? (
                  <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant, textAlign }}>
                    {quote.contactPhone || quote.phoneNumber}
                  </Text>
                ) : null}
              </View>
              {quote.contactId ? (
                <MaterialCommunityIcons
                  name={isRTL ? 'chevron-left' : 'chevron-right'}
                  size={22}
                  color={theme.colors.onSurfaceVariant}
                />
              ) : null}
            </View>
          </Pressable>
        ) : null}

        {/* Contact Action Buttons */}
        {(quote.contactPhone || quote.phoneNumber) ? (
          <View style={[styles.actionRow, { flexDirection }]}>
            <Button
              mode="outlined"
              icon="phone"
              onPress={handleCall}
              style={[styles.actionButtonHalf, { borderColor: '#4CAF50' }]}
              textColor="#4CAF50"
              contentStyle={styles.actionButtonContent}
            >
              {t('common.call')}
            </Button>
            <Button
              mode="outlined"
              icon="whatsapp"
              onPress={handleWhatsAppChat}
              style={[styles.actionButtonHalf, { borderColor: '#25D366' }]}
              textColor="#25D366"
              contentStyle={styles.actionButtonContent}
            >
              {t('chats.viewChat')}
            </Button>
          </View>
        ) : null}

        {/* Items Table */}
        <View
          style={[
            styles.sectionCard,
            { backgroundColor: theme.custom.cardBackground, borderColor: theme.colors.outlineVariant },
          ]}
        >
          <Text variant="titleSmall" style={[styles.sectionLabel, { color: theme.colors.onSurface, textAlign }]}>
            {t('quotes.items')} ({quote.items?.length ?? 0})
          </Text>

          <View style={[styles.tableHeader, { flexDirection, backgroundColor: theme.colors.surfaceVariant }]}>
            <Text style={[styles.tableHeaderCell, styles.tableItemName, { color: theme.colors.onSurfaceVariant, textAlign }]}>
              {t('quotes.itemDescription')}
            </Text>
            <Text style={[styles.tableHeaderCell, styles.tableItemQty, { color: theme.colors.onSurfaceVariant }]}>
              {t('quotes.quantity')}
            </Text>
            <Text style={[styles.tableHeaderCell, styles.tableItemPrice, { color: theme.colors.onSurfaceVariant }]}>
              {t('quotes.unitPrice')}
            </Text>
            <Text style={[styles.tableHeaderCell, styles.tableItemTotal, { color: theme.colors.onSurfaceVariant }]}>
              {t('quotes.total')}
            </Text>
          </View>

          <ScrollView nestedScrollEnabled style={styles.tableBody}>
            {quote.items.map((item, index) => (
              <View key={item.id || index}>
                <View style={[styles.tableRow, { flexDirection }]}>
                  <View style={styles.tableItemName}>
                    <Text variant="bodySmall" numberOfLines={2} style={{ color: theme.colors.onSurface, textAlign }}>
                      {item.name || item.description}
                    </Text>
                    {item.description && item.name ? (
                      <Text variant="labelSmall" numberOfLines={1} style={{ color: theme.colors.onSurfaceVariant, textAlign }}>
                        {item.description}
                      </Text>
                    ) : null}
                  </View>
                  <Text style={[styles.tableCell, styles.tableItemQty, { color: theme.colors.onSurface }]}>
                    {item.quantity}
                  </Text>
                  <Text style={[styles.tableCell, styles.tableItemPrice, { color: theme.colors.onSurface }]}>
                    {formatCurrency(item.unitPrice, currSymbol)}
                  </Text>
                  <Text style={[styles.tableCell, styles.tableItemTotal, { color: theme.colors.primary, fontWeight: '600' }]}>
                    {formatCurrency(item.total || item.quantity * item.unitPrice, currSymbol)}
                  </Text>
                </View>
                {index < (quote.items?.length ?? 0) - 1 && (
                  <Divider style={{ backgroundColor: theme.colors.outlineVariant }} />
                )}
              </View>
            ))}
          </ScrollView>

          {(quote.items?.length ?? 0) === 0 && (
            <View style={styles.noItems}>
              <MaterialCommunityIcons name="package-variant" size={32} color={theme.colors.onSurfaceVariant} style={{ opacity: 0.4 }} />
              <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                {t('quotes.noItemsYet')}
              </Text>
            </View>
          )}
        </View>

        {/* Financial Summary */}
        <View
          style={[
            styles.financialCard,
            { backgroundColor: theme.custom.cardBackground, borderColor: theme.colors.outlineVariant },
          ]}
        >
          <Text variant="titleSmall" style={[styles.sectionLabel, { color: theme.colors.onSurface, textAlign }]}>
            {t('quotes.financialSummary')}
          </Text>

          <View style={styles.summaryRow}>
            <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
              {t('quotes.subtotal')}
            </Text>
            <Text variant="bodyMedium" style={{ color: theme.colors.onSurface }}>
              {formatCurrency(quote.subtotal || 0, currSymbol)}
            </Text>
          </View>

          {(quote.discount || 0) > 0 && (
            <View style={styles.summaryRow}>
              <Text variant="bodyMedium" style={{ color: '#F44336' }}>
                {t('quotes.discount')} {quote.discountType === 'percent' ? `(${quote.discount}%)` : ''}
              </Text>
              <Text variant="bodyMedium" style={{ color: '#F44336' }}>
                -{formatCurrency(quote.discountAmount || quote.discount || 0, currSymbol)}
              </Text>
            </View>
          )}

          {(quote.tax || 0) > 0 && (
            <View style={styles.summaryRow}>
              <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
                {t('quotes.tax')} ({quote.tax}%)
              </Text>
              <Text variant="bodyMedium" style={{ color: theme.colors.onSurface }}>
                {formatCurrency(quote.taxAmount || 0, currSymbol)}
              </Text>
            </View>
          )}

          <Divider style={{ marginVertical: 10, backgroundColor: theme.colors.outlineVariant }} />

          <View style={styles.summaryRow}>
            <Text variant="titleMedium" style={{ color: theme.colors.onSurface, fontWeight: '700' }}>
              {t('quotes.total')}
            </Text>
            <Text variant="headlineSmall" style={{ color: theme.colors.primary, fontWeight: '800' }}>
              {formatCurrency(quote.total || 0, currSymbol)}
            </Text>
          </View>
        </View>

        {/* Valid Until */}
        {quote.validUntil ? (
          <View
            style={[
              styles.sectionCard,
              { backgroundColor: theme.custom.cardBackground, borderColor: theme.colors.outlineVariant },
            ]}
          >
            <View style={[styles.detailRow, { flexDirection }]}>
              <View style={[styles.detailIcon, { backgroundColor: '#FF980018' }]}>
                <MaterialCommunityIcons name="calendar-clock" size={20} color="#FF9800" />
              </View>
              <View style={[styles.detailContent, { alignItems: isRTL ? 'flex-end' : 'flex-start' }]}>
                <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                  {t('quotes.validUntil')}
                </Text>
                <Text
                  variant="bodyMedium"
                  style={{
                    color: new Date(quote.validUntil) < new Date() ? '#F44336' : theme.colors.onSurface,
                    fontWeight: '500',
                  }}
                >
                  {formatDate(quote.validUntil)}
                  {new Date(quote.validUntil) < new Date() ? ` (${t('quotes.expired')})` : ''}
                </Text>
              </View>
            </View>
          </View>
        ) : null}

        {/* Salesperson */}
        {quote.salespersonName ? (
          <View
            style={[
              styles.sectionCard,
              { backgroundColor: theme.custom.cardBackground, borderColor: theme.colors.outlineVariant },
            ]}
          >
            <View style={[styles.detailRow, { flexDirection }]}>
              <View style={[styles.detailIcon, { backgroundColor: '#2196F318' }]}>
                <MaterialCommunityIcons name="account-tie" size={20} color="#2196F3" />
              </View>
              <View style={[styles.detailContent, { alignItems: isRTL ? 'flex-end' : 'flex-start' }]}>
                <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                  {t('quotes.salesperson')}
                </Text>
                <Text variant="bodyMedium" style={{ color: theme.colors.onSurface, fontWeight: '500' }}>
                  {quote.salespersonName}
                </Text>
              </View>
            </View>
          </View>
        ) : null}

        {/* Dates */}
        <View
          style={[
            styles.sectionCard,
            { backgroundColor: theme.custom.cardBackground, borderColor: theme.colors.outlineVariant },
          ]}
        >
          <View style={[styles.timestampRow, { flexDirection }]}>
            <MaterialCommunityIcons name="clock-outline" size={14} color={theme.colors.onSurfaceVariant} />
            <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
              {t('quotes.createdDate')}:
            </Text>
            <Text variant="labelSmall" style={{ color: theme.colors.onSurface }}>
              {formatDate(quote.createdOn || quote.createdAt || '')}
            </Text>
          </View>
          {quote.sentAt ? (
            <View style={[styles.timestampRow, { flexDirection, marginTop: 6 }]}>
              <MaterialCommunityIcons name="send-check" size={14} color="#2196F3" />
              <Text variant="labelSmall" style={{ color: '#2196F3' }}>
                {t('quotes.sentDate')}:
              </Text>
              <Text variant="labelSmall" style={{ color: '#2196F3' }}>
                {formatDate(quote.sentAt)}
              </Text>
            </View>
          ) : null}
        </View>

        {/* Notes */}
        {quote.notes ? (
          <View
            style={[
              styles.sectionCard,
              { backgroundColor: theme.custom.cardBackground, borderColor: theme.colors.outlineVariant },
            ]}
          >
            <Text variant="titleSmall" style={[styles.sectionLabel, { color: theme.colors.onSurface, textAlign }]}>
              {t('quotes.notes')}
            </Text>
            <Text variant="bodyMedium" style={{ color: theme.colors.onSurface, lineHeight: 22, textAlign }}>
              {quote.notes}
            </Text>
          </View>
        ) : null}

        {/* Terms */}
        {quote.terms ? (
          <View
            style={[
              styles.sectionCard,
              { backgroundColor: theme.custom.cardBackground, borderColor: theme.colors.outlineVariant },
            ]}
          >
            <Text variant="titleSmall" style={[styles.sectionLabel, { color: theme.colors.onSurface, textAlign }]}>
              {t('quotes.terms')}
            </Text>
            <Text variant="bodyMedium" style={{ color: theme.colors.onSurface, lineHeight: 22, textAlign }}>
              {quote.terms}
            </Text>
          </View>
        ) : null}

        {/* Action Buttons */}
        <View style={styles.actionsContainer}>
          <Button
            mode="contained"
            icon="whatsapp"
            onPress={handleSendWhatsApp}
            loading={sending}
            style={[styles.actionButton, { backgroundColor: '#25D366' }]}
            textColor="#FFFFFF"
            contentStyle={styles.actionButtonContent}
          >
            {t('quotes.sendViaWhatsApp')}
          </Button>

          <View style={[styles.actionRow, { flexDirection }]}>
            <Button
              mode="outlined"
              icon="share-variant"
              onPress={handleShare}
              style={[styles.actionButtonHalf, { borderColor: theme.colors.outline }]}
              textColor={theme.colors.onSurface}
              contentStyle={styles.actionButtonContent}
            >
              {t('quotes.share')}
            </Button>
            <Button
              mode="outlined"
              icon="draw-pen"
              onPress={handleSendESignature}
              style={[styles.actionButtonHalf, { borderColor: theme.colors.primary }]}
              textColor={theme.colors.primary}
              contentStyle={styles.actionButtonContent}
            >
              {t('quotes.sendForESignature')}
            </Button>
          </View>

          <View style={[styles.actionRow, { flexDirection }]}>
            <Button
              mode="outlined"
              icon="pencil"
              onPress={openEditMode}
              style={[styles.actionButtonHalf, { borderColor: theme.colors.primary }]}
              textColor={theme.colors.primary}
              contentStyle={styles.actionButtonContent}
            >
              {t('common.edit')}
            </Button>
            <Button
              mode="outlined"
              icon="delete-outline"
              onPress={handleDelete}
              loading={deleting}
              style={[styles.actionButtonHalf, { borderColor: theme.colors.error }]}
              textColor={theme.colors.error}
              contentStyle={styles.actionButtonContent}
            >
              {t('common.delete')}
            </Button>
          </View>
        </View>

        <View style={{ height: insets.bottom + 24 }} />
      </ScrollView>

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
            <View style={[styles.previewDocHeader, { backgroundColor: getStatusColor(quote.status) }]}>
              <Text style={styles.previewDocTitle}>{quote.title}</Text>
              {quote.quoteNumber ? (
                <Text style={styles.previewDocSubtitle}>#{quote.quoteNumber}</Text>
              ) : null}
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
                <Text style={[styles.previewGrandTotalValue, { color: getStatusColor(quote.status) }]}>{formatCurrency(quote.total || 0, currSymbol)}</Text>
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
  contactRow: {
    alignItems: 'center',
    gap: 12,
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
});
