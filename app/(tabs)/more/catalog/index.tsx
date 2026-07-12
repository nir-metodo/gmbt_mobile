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
  TextInput as RNTextInput,
  Share,
  Modal as RNModal,
  Linking,
  Keyboard,
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
  Switch,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import GambotDateTimePicker from '../../../../components/GambotDateTimePicker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../../../stores/authStore';
import { useAppTheme } from '../../../../hooks/useAppTheme';
import { useRTL } from '../../../../hooks/useRTL';
import { catalogApi, CatalogItem, CatalogCustomColumn, CatalogFieldsConfig, CatalogSelection, PublicCatalogConfig } from '../../../../services/api/catalog';
import { useDebouncedValue, useWindowedList } from '../../../../hooks/useWindowedList';
import { ListPaginationFooter } from '../../../../components/ListPaginationFooter';
import { appCache } from '../../../../services/cache';
import axiosInstance from '../../../../services/api/axiosInstance';
import { ENDPOINTS, WEB_APP_BASE_URL } from '../../../../constants/api';
import PhoneNumberInput from '../../../../components/PhoneNumberInput';
import { cleanPhoneNumber } from '../../../../utils/phoneNumber';

const BRAND_COLOR = '#059669';

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// Select options may be an array (mobile) or a comma-separated string (how the web Catalog stores them).
function getColumnOptions(col: CatalogCustomColumn): string[] {
  const raw = col.options as unknown;
  if (Array.isArray(raw)) return raw.map((o) => String(o).trim()).filter(Boolean);
  if (typeof raw === 'string') return raw.split(',').map((o) => o.trim()).filter(Boolean);
  return [];
}

function formatCustomValue(v: any, isRTL: boolean): string {
  if (typeof v === 'boolean') return v ? (isRTL ? 'כן' : 'Yes') : (isRTL ? 'לא' : 'No');
  return String(v);
}

// Parse a value to a number, returning null when there's no parseable number so range filters can
// skip non-numeric values. Mirrors the web CatalogManager `toNumeric`.
function toNumeric(v: any): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^\d.-]/g, ''));
  return isNaN(n) ? null : n;
}

// Canonical reorderable table-column tokens (mirrors the web CatalogManager). The order set in the
// web Catalog → Columns settings is honored on the app cards + form via `resolveColumnOrder`.
const TABLE_BASE_TOKENS = ['image', 'name', 'category', 'sku', 'unitPrice', 'stock'];

function resolveColumnOrder(savedOrder: any, customCols: CatalogCustomColumn[]): string[] {
  const customTokens = (customCols || []).map((c) => `custom:${c.id}`);
  const natural = [...TABLE_BASE_TOKENS, ...customTokens, 'link'];
  const saved = Array.isArray(savedOrder) ? savedOrder.filter((tok: string) => natural.includes(tok)) : [];
  return [...saved, ...natural.filter((tok) => !saved.includes(tok))];
}

export default function CatalogScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useAppTheme();
  const { isRTL, flexDirection, textAlign } = useRTL();
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);

  const CACHE_KEY = `catalog_${user?.organization}`;
  const COLS_CACHE_KEY = `catalog_cols_${user?.organization}`;
  const CFG_CACHE_KEY = `catalog_cfg_${user?.organization}`;

  const [items, setItems] = useState<CatalogItem[]>(() => appCache.get<CatalogItem[]>(CACHE_KEY) ?? []);
  // Hydrate column definitions + field config from cache so custom fields render immediately and
  // survive a transient fetch failure (otherwise a dropped refresh would blank the custom fields).
  const [customColumns, setCustomColumns] = useState<CatalogCustomColumn[]>(() => appCache.get<CatalogCustomColumn[]>(COLS_CACHE_KEY) ?? []);
  const [fieldsConfig, setFieldsConfig] = useState<CatalogFieldsConfig>(() => appCache.get<CatalogFieldsConfig>(CFG_CACHE_KEY) ?? { description: true, unitPrice: true, sku: true, category: true, link: true });
  const [loading, setLoading] = useState(!appCache.get<CatalogItem[]>(CACHE_KEY));
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchVisible, setSearchVisible] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [saving, setSaving] = useState(false);

  // Advanced toolbar filters (mirrors the web catalog): price range + per-column range/select/boolean.
  const [filtersVisible, setFiltersVisible] = useState(false);
  const [priceMin, setPriceMin] = useState('');
  const [priceMax, setPriceMax] = useState('');
  const [colFilters, setColFilters] = useState<Record<string, any>>({});
  // Filter by whether the item has at least one image.
  const [imageFilter, setImageFilter] = useState<'all' | 'with' | 'without'>('all');
  // Which date-range filter edge is currently being picked (opens GambotDateTimePicker).
  const [datePickerFor, setDatePickerFor] = useState<{ key: string; edge: 'from' | 'to' } | null>(null);

  // Multi-select mode → build a per-contact personalized share link from the chosen items.
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [shareLinkVisible, setShareLinkVisible] = useState(false);
  const [slName, setSlName] = useState('');
  const [slPhone, setSlPhone] = useState('');
  const [slScope, setSlScope] = useState<'selected' | 'all'>('selected');
  const [slPurpose, setSlPurpose] = useState<string>('browse');
  const [slCreating, setSlCreating] = useState(false);
  const [slUrl, setSlUrl] = useState('');
  const [slCopied, setSlCopied] = useState(false);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const exitSelection = useCallback(() => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }, []);

  // Public catalog sharing + customer selections
  const [sharing, setSharing] = useState(false);
  // Share-settings sheet (enable + shareMode all/marked + share link)
  const [shareModalVisible, setShareModalVisible] = useState(false);
  const [shareCfg, setShareCfg] = useState<PublicCatalogConfig>({});
  const [shareCfgLoading, setShareCfgLoading] = useState(false);
  const [shareSaving, setShareSaving] = useState(false);
  const [selectionsVisible, setSelectionsVisible] = useState(false);
  const [selections, setSelections] = useState<CatalogSelection[]>([]);
  const [selectionsLoading, setSelectionsLoading] = useState(false);
  // Search + sort for the catalog inquiries (selections) list.
  const [selectionSearch, setSelectionSearch] = useState('');
  const [selectionSort, setSelectionSort] = useState<'date' | 'price'>('date');

  // Form modal
  const [modalVisible, setModalVisible] = useState(false);
  const [editingItem, setEditingItem] = useState<CatalogItem | null>(null);
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formPrice, setFormPrice] = useState('');
  const [formSku, setFormSku] = useState('');
  const [formCategory, setFormCategory] = useState('');
  const [formLink, setFormLink] = useState('');
  // Multiple images per item (mirrors the web catalog which stores an `images` array).
  const [formImages, setFormImages] = useState<string[]>([]);
  const [imageUrlInput, setImageUrlInput] = useState('');
  const [formCustomFields, setFormCustomFields] = useState<Record<string, any>>({});
  const [formIsPublic, setFormIsPublic] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Full-screen image viewer (lightbox) with left/right navigation.
  const [viewerImages, setViewerImages] = useState<string[]>([]);
  const [viewerIndex, setViewerIndex] = useState(0);
  const [viewerVisible, setViewerVisible] = useState(false);

  const openImageViewer = useCallback((imgs: string[], index = 0) => {
    const list = (imgs || []).filter(Boolean);
    if (!list.length) return;
    setViewerImages(list);
    setViewerIndex(Math.min(Math.max(index, 0), list.length - 1));
    setViewerVisible(true);
  }, []);

  // Honor the display order configured in the web Catalog → Columns settings.
  // `columnOrder` holds tokens like `custom:<id>`; we use it to order the custom
  // columns shown on cards and in the edit form. Any column missing from the saved
  // order keeps its natural position at the end.
  const orderedCustomColumns = useMemo(() => {
    const order = Array.isArray(fieldsConfig.columnOrder) ? fieldsConfig.columnOrder : [];
    if (!order.length || !customColumns.length) return customColumns;
    const rank = new Map<string, number>();
    order.forEach((tok, i) => {
      if (typeof tok === 'string' && tok.startsWith('custom:')) rank.set(tok.slice(7), i);
    });
    return [...customColumns]
      .map((col, i) => ({ col, i }))
      .sort((a, b) => {
        const ra = rank.has(a.col.id) ? (rank.get(a.col.id) as number) : Number.MAX_SAFE_INTEGER;
        const rb = rank.has(b.col.id) ? (rank.get(b.col.id) as number) : Number.MAX_SAFE_INTEGER;
        return ra === rb ? a.i - b.i : ra - rb;
      })
      .map((x) => x.col);
  }, [customColumns, fieldsConfig.columnOrder]);

  // Full ordered token list (base + custom + link) honoring the web-configured column order, used to
  // lay out the catalog cards in the same order as the web table.
  const orderedColumnTokens = useMemo(
    () => resolveColumnOrder(fieldsConfig.columnOrder, customColumns),
    [fieldsConfig.columnOrder, customColumns],
  );

  // Whether a base/custom token is shown in the list (respects web visibility toggles).
  const isColumnTokenVisible = useCallback((tok: string): boolean => {
    if (tok === 'name') return true;
    if (tok.startsWith('custom:')) {
      const col = customColumns.find((c) => `custom:${c.id}` === tok);
      return col ? col.showInTable !== false : false;
    }
    const tc = fieldsConfig.tableColumns || {};
    return tc[tok] !== false;
  }, [customColumns, fieldsConfig.tableColumns]);

  // Columns that expose a dedicated toolbar filter (range / select / boolean), from the web config.
  const priceRangeEnabled = fieldsConfig.priceRangeFilter === true;
  const filterCols = useMemo(
    () => customColumns.filter((c) => ['range', 'select', 'boolean', 'text', 'date'].includes(c.filterType as string)),
    [customColumns],
  );

  const selectOptionsForFilter = useCallback((col: CatalogCustomColumn): string[] => {
    const opts = getColumnOptions(col);
    if (opts.length) return opts;
    return [...new Set(items.map((i) => String(i.customFields?.[col.key] ?? '').trim()).filter(Boolean))].sort();
  }, [items]);

  const hasActiveFilters = useMemo(() => {
    if (imageFilter !== 'all') return true;
    if (priceRangeEnabled && (priceMin !== '' || priceMax !== '')) return true;
    return filterCols.some((c) => {
      const v = colFilters[c.key];
      if (!v) return false;
      if (c.filterType === 'range') return v.min !== '' || v.max !== '';
      if (c.filterType === 'date') return v.from !== '' || v.to !== '';
      return v !== '';
    });
  }, [imageFilter, priceRangeEnabled, priceMin, priceMax, filterCols, colFilters]);

  const clearFilters = useCallback(() => {
    setPriceMin('');
    setPriceMax('');
    setColFilters({});
    setImageFilter('all');
  }, []);

  const setCustomField = useCallback((key: string, value: any) => {
    setFormCustomFields((p) => ({ ...p, [key]: value }));
  }, []);

  const uploadAsset = async (asset: ImagePicker.ImagePickerAsset): Promise<string> => {
    const formData = new FormData();
    formData.append('organization', user?.organization || '');
    formData.append('file', {
      uri: asset.uri,
      name: asset.fileName || `photo_${Date.now()}.jpg`,
      type: asset.mimeType || 'image/jpeg',
    } as any);
    const res = await axiosInstance.post(ENDPOINTS.UPLOAD_MEDIA_FILE, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    const files = res.data?.files || [];
    return files[0]?.url || res.data?.Url || res.data?.url || res.data?.MediaUrl || '';
  };

  const pickImage = async (source: 'camera' | 'library') => {
    try {
      let result: ImagePicker.ImagePickerResult;
      if (source === 'camera') {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          Alert.alert(t('common.error'), isRTL ? 'נדרשת הרשאת מצלמה' : 'Camera permission required');
          return;
        }
        result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 });
      } else {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) {
          Alert.alert(t('common.error'), isRTL ? 'נדרשת הרשאת גלריה' : 'Gallery permission required');
          return;
        }
        // Allow selecting several images at once — they all get added to the item.
        result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8, allowsMultipleSelection: true });
      }
      if (result.canceled || !result.assets?.length) return;
      setUploading(true);
      const uploaded: string[] = [];
      for (const asset of result.assets) {
        try {
          const url = await uploadAsset(asset);
          if (url) uploaded.push(url);
        } catch { /* skip a single failed upload, keep the rest */ }
      }
      if (uploaded.length) {
        setFormImages((prev) => [...prev, ...uploaded]);
      } else {
        Alert.alert(t('common.error'), isRTL ? 'שגיאה בהעלאה - לא התקבל קישור' : 'Upload failed - no URL received');
      }
    } catch (err: any) {
      Alert.alert(t('common.error'), err?.message || (isRTL ? 'שגיאה בהעלאת התמונה' : 'Image upload failed'));
    } finally {
      setUploading(false);
    }
  };

  const addImageUrl = () => {
    const url = imageUrlInput.trim();
    if (!url) return;
    setFormImages((prev) => (prev.includes(url) ? prev : [...prev, url]));
    setImageUrlInput('');
  };

  const removeImageAt = (idx: number) => {
    setFormImages((prev) => prev.filter((_, i) => i !== idx));
  };

  const moveImage = (idx: number, dir: -1 | 1) => {
    setFormImages((prev) => {
      const arr = [...prev];
      const j = idx + dir;
      if (j < 0 || j >= arr.length) return prev;
      [arr[idx], arr[j]] = [arr[j], arr[idx]];
      return arr;
    });
  };

  const fetchData = useCallback(async () => {
    if (!user?.organization) return;
    try {
      const data = await catalogApi.getAll(user.organization);
      setItems(data.catalogItems);
      setCustomColumns(data.catalogCustomColumns);
      appCache.set(COLS_CACHE_KEY, data.catalogCustomColumns);
      if (data.catalogFieldsConfig) {
        setFieldsConfig(prev => {
          const merged = { ...prev, ...data.catalogFieldsConfig };
          appCache.set(CFG_CACHE_KEY, merged);
          return merged;
        });
      }
      appCache.set(CACHE_KEY, data.catalogItems);
    } catch {
      if (items.length === 0) {
        Alert.alert(t('common.error'), t('errors.generic'));
      }
    }
  }, [user?.organization]);

  useEffect(() => {
    setLoading(true);
    fetchData().finally(() => setLoading(false));
  }, [fetchData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  }, [fetchData]);

  // Share the public catalog link — enabling public sharing on the fly if it isn't enabled yet.
  const handleShareCatalog = useCallback(async () => {
    if (!user?.organization) return;
    setSharing(true);
    try {
      let cfg = await catalogApi.getPublicConfig(user.organization);
      if (!cfg?.enabled || !cfg?.slug) {
        cfg = await catalogApi.enablePublicCatalog(user.organization);
      }
      const url = `${WEB_APP_BASE_URL}/catalog/${encodeURIComponent(user.organization)}?t=${cfg.slug}`;
      await Share.share({
        message: isRTL ? `הקטלוג שלנו:\n${url}` : `Our catalog:\n${url}`,
        url,
      });
    } catch {
      Alert.alert(t('common.error'), isRTL ? 'שגיאה בשיתוף הקטלוג' : 'Failed to share catalog');
    } finally {
      setSharing(false);
    }
  }, [user?.organization, isRTL, t]);

  // Share a single catalog item (name, price, key details, image + public catalog link).
  const handleShareItem = useCallback(async (item: CatalogItem) => {
    if (!user?.organization) return;
    try {
      const lines: string[] = [];
      lines.push(`*${item.name || (isRTL ? 'פריט' : 'Item')}*`);
      if (item.unitPrice > 0) lines.push(`${isRTL ? 'מחיר' : 'Price'}: ₪${item.unitPrice.toLocaleString()}`);
      if (item.description) lines.push(item.description);
      if (item.sku) lines.push(`${isRTL ? 'מק״ט' : 'SKU'}: ${item.sku}`);
      if (item.category) lines.push(`${isRTL ? 'קטגוריה' : 'Category'}: ${item.category}`);
      // Include any custom fields that have a value (in the configured column order).
      const cf = item.customFields || {};
      orderedCustomColumns.forEach((col) => {
        const v = cf[col.key];
        if (v !== undefined && v !== null && v !== '') lines.push(`${col.label}: ${formatCustomValue(v, isRTL)}`);
      });
      if (item.link) lines.push(item.link);
      if (item.images?.[0]) lines.push(item.images[0]);

      // Append the public catalog link (enabling public sharing on the fly if needed) so the
      // recipient can browse the full catalog too.
      try {
        let cfg = await catalogApi.getPublicConfig(user.organization);
        if (!cfg?.enabled || !cfg?.slug) cfg = await catalogApi.enablePublicCatalog(user.organization);
        if (cfg?.slug) {
          const url = `${WEB_APP_BASE_URL}/catalog/${encodeURIComponent(user.organization)}?t=${cfg.slug}`;
          lines.push('');
          lines.push(isRTL ? `לצפייה בקטלוג המלא:\n${url}` : `View the full catalog:\n${url}`);
        }
      } catch { /* sharing the item details without the link is still useful */ }

      await Share.share({ message: lines.join('\n') });
    } catch {
      Alert.alert(t('common.error'), isRTL ? 'שגיאה בשיתוף הפריט' : 'Failed to share item');
    }
  }, [user?.organization, isRTL, t, orderedCustomColumns]);

  // How many items are marked for the public catalog (used by the share settings sheet).
  const markedCount = useMemo(() => items.filter((i) => i.isPublic).length, [items]);

  // Quick per-item toggle of public-catalog visibility (persists immediately).
  const toggleItemPublic = useCallback(async (item: CatalogItem) => {
    if (!user?.organization) return;
    const next = items.map((i) => (i.id === item.id ? { ...i, isPublic: !i.isPublic } : i));
    setItems(next);
    appCache.set(CACHE_KEY, next);
    try {
      await catalogApi.save(user.organization, next, customColumns);
    } catch {
      // Roll back on failure so the UI reflects the persisted state.
      setItems(items);
      appCache.set(CACHE_KEY, items);
      Alert.alert(t('common.error'), t('errors.generic'));
    }
  }, [items, customColumns, user?.organization, CACHE_KEY, t]);

  // Bulk add/remove the selected items to/from the DEFAULT public catalog (mirrors the web
  // "הסר מהקטלוג" / "החזר לקטלוג" bulk actions). This is the public catalog everyone sees —
  // NOT a personal customer link. Persists immediately.
  const bulkSetPublic = useCallback(async (isPublic: boolean) => {
    if (!user?.organization || selectedIds.size === 0) return;
    const prev = items;
    const next = items.map((i) => (selectedIds.has(i.id) ? { ...i, isPublic } : i));
    setItems(next);
    appCache.set(CACHE_KEY, next);
    try {
      await catalogApi.save(user.organization, next, customColumns);
      exitSelection();
      Alert.alert(
        isRTL ? 'בוצע' : 'Done',
        isPublic
          ? (isRTL ? 'הפריטים הוחזרו לקטלוג הפומבי' : 'Items returned to the public catalog')
          : (isRTL ? 'הפריטים הוסרו מהקטלוג הפומבי' : 'Items removed from the public catalog'),
      );
    } catch {
      setItems(prev);
      appCache.set(CACHE_KEY, prev);
      Alert.alert(t('common.error'), t('errors.generic'));
    }
  }, [items, customColumns, user?.organization, selectedIds, CACHE_KEY, isRTL, t, exitSelection]);

  // Public-catalog state of the current selection → drives which bulk buttons make sense.
  const selectionPublicStats = useMemo(() => {
    let inCatalog = 0;
    let removed = 0;
    items.forEach((i) => {
      if (!selectedIds.has(i.id)) return;
      if (i.isPublic) inCatalog += 1; else removed += 1;
    });
    return { inCatalog, removed };
  }, [items, selectedIds]);

  // Open the share-settings sheet, loading the current public-catalog config.
  const openShareSettings = useCallback(async () => {
    if (!user?.organization) return;
    setShareModalVisible(true);
    setShareCfgLoading(true);
    try {
      const cfg = await catalogApi.getPublicConfig(user.organization);
      setShareCfg(cfg || {});
    } catch {
      setShareCfg({});
    } finally {
      setShareCfgLoading(false);
    }
  }, [user?.organization]);

  // Persist the share config (enabled + shareMode) together with the current item marks.
  const saveShareSettings = useCallback(async () => {
    if (!user?.organization) return;
    setShareSaving(true);
    try {
      const cfg: PublicCatalogConfig = {
        purpose: shareCfg.purpose || 'lead',
        whatsappShare: shareCfg.whatsappShare !== false,
        requireContact: shareCfg.requireContact !== false,
        allowQuantity: shareCfg.allowQuantity || false,
        columns: shareCfg.columns && Object.keys(shareCfg.columns).length ? shareCfg.columns : { image: true, description: true, unitPrice: true, category: true },
        title: shareCfg.title || '',
        whatsappNumber: shareCfg.whatsappNumber || '',
        ...shareCfg,
        enabled: shareCfg.enabled !== false,
        slug: shareCfg.slug || (Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6)),
        shareMode: shareCfg.shareMode || 'all',
      };
      await catalogApi.savePublicConfig(user.organization, cfg, items);
      setShareCfg(cfg);
      Alert.alert(isRTL ? 'נשמר' : 'Saved', isRTL ? 'הגדרות השיתוף נשמרו' : 'Share settings saved');
    } catch {
      Alert.alert(t('common.error'), t('errors.generic'));
    } finally {
      setShareSaving(false);
    }
  }, [user?.organization, shareCfg, items, isRTL, t]);

  // Open the "personal customer link" sheet, seeding defaults from the current share config.
  const openShareLink = useCallback(() => {
    setSlName('');
    setSlPhone('');
    setSlScope('selected');
    setSlPurpose(shareCfg.purpose || 'browse');
    setSlUrl('');
    setSlCopied(false);
    setShareLinkVisible(true);
  }, [shareCfg.purpose]);

  // Create the personalized share link (item allowlist = the selected items, or whole catalog).
  const createCustomerLink = useCallback(async () => {
    if (!user?.organization) return;
    setSlCreating(true);
    try {
      const ids = slScope === 'selected' ? Array.from(selectedIds) : [];
      const { token } = await catalogApi.createShareLink(user.organization, {
        itemIds: ids,
        contactName: slName.trim(),
        contactPhone: slPhone,
        title: slName.trim() ? (isRTL ? `קטלוג עבור ${slName.trim()}` : `Catalog for ${slName.trim()}`) : '',
        purpose: slPurpose,
        createdBy: (user as any)?.fullname || (user as any)?.displayName || '',
        createdById: (user as any)?.uID || (user as any)?.userId || '',
      });
      setSlUrl(`${WEB_APP_BASE_URL}/catalog/${encodeURIComponent(user.organization)}?p=${token}`);
    } catch {
      Alert.alert(t('common.error'), isRTL ? 'יצירת הקישור נכשלה' : 'Failed to create link');
    } finally {
      setSlCreating(false);
    }
  }, [user, slScope, selectedIds, slName, slPhone, slPurpose, isRTL, t]);

  const copyCustomerLink = useCallback(async () => {
    if (!slUrl) return;
    try { await Clipboard.setStringAsync(slUrl); setSlCopied(true); setTimeout(() => setSlCopied(false), 2000); } catch { /* noop */ }
  }, [slUrl]);

  const sendCustomerLinkWhatsApp = useCallback(() => {
    // Normalize to a full international number (e.g. "0501234567" → "972501234567"), otherwise
    // WhatsApp rejects the local-format number and the link "can't be opened".
    const phone = cleanPhoneNumber(slPhone);
    const text = `${slName ? slName + ', ' : ''}${isRTL ? 'הכנתי עבורך קטלוג אישי 🛍️' : 'I prepared a personal catalog for you 🛍️'}\n${slUrl}`;
    const wa = phone ? `whatsapp://send?phone=${phone}&text=${encodeURIComponent(text)}` : `https://wa.me/?text=${encodeURIComponent(text)}`;
    Linking.openURL(wa).catch(() => { Share.share({ message: text }); });
  }, [slPhone, slName, slUrl, isRTL]);

  const loadSelections = useCallback(async () => {
    if (!user?.organization) return;
    setSelectionsLoading(true);
    try {
      const data = await catalogApi.getSelections(user.organization);
      setSelections(data);
    } catch {
      Alert.alert(t('common.error'), isRTL ? 'שגיאה בטעינת הפניות' : 'Failed to load selections');
    } finally {
      setSelectionsLoading(false);
    }
  }, [user?.organization, isRTL, t]);

  const openSelections = useCallback(() => {
    setSelectionsVisible(true);
    loadSelections();
  }, [loadSelections]);

  // Opens the selection in a native in-app detail screen. Previously this opened an external web URL
  // (`/catalog/{org}/r/{id}`) which 404s, so we now render the full selection inside the app. The
  // selection is already fully loaded here, so it's passed through as a param for instant render.
  const openSelectionLink = useCallback((sel: CatalogSelection) => {
    setSelectionsVisible(false);
    router.push({
      pathname: '/(tabs)/more/catalog/[selectionId]',
      // Pass the custom column definitions too, so the detail page can label each item's custom
      // fields exactly like the web selection view (otherwise it would only have raw keys).
      params: { selectionId: sel.id, data: JSON.stringify(sel), cols: JSON.stringify(customColumns) },
    });
  }, [router, customColumns]);

  const fmtSelDate = useCallback((iso?: string) => {
    if (!iso) return '';
    try { return new Date(iso).toLocaleString(isRTL ? 'he-IL' : 'en-US'); } catch { return iso; }
  }, [isRTL]);

  const selItemsSummary = useCallback((sel: CatalogSelection) => {
    const its = Array.isArray(sel.items) ? sel.items : [];
    if (its.length === 0) return '—';
    return its.map((it) => `${it.name || ''}${(it.quantity && it.quantity > 1) ? ` ×${it.quantity}` : ''}`).join(', ');
  }, []);

  const purposeLabel = useCallback((p?: string) => {
    if (isRTL) return ({ order: 'הזמנה', lead: 'ליד', inquiry: 'התעניינות', browse: 'צפייה' } as Record<string, string>)[p || ''] || p || '—';
    return ({ order: 'Order', lead: 'Lead', inquiry: 'Inquiry', browse: 'Browse' } as Record<string, string>)[p || ''] || p || '—';
  }, [isRTL]);

  // Inquiries (selections) filtered by name/phone and sorted by date (default, newest first) or total.
  const filteredSortedSelections = useMemo(() => {
    const q = selectionSearch.trim().toLowerCase();
    let list = selections;
    if (q) {
      list = list.filter((s) =>
        (s.contactName || '').toLowerCase().includes(q) ||
        (s.contactPhone || '').toLowerCase().includes(q),
      );
    }
    const arr = [...list];
    if (selectionSort === 'price') {
      arr.sort((a, b) => (Number(b.total) || 0) - (Number(a.total) || 0));
    } else {
      arr.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
    }
    return arr;
  }, [selections, selectionSearch, selectionSort]);

  const categories = useMemo(() => {
    const cats = new Set<string>();
    items.forEach((item) => {
      if (item.category) cats.add(item.category);
    });
    return ['all', ...Array.from(cats).sort()];
  }, [items]);

  // Debounce search so the list re-filters once typing pauses (no per-keystroke flicker).
  const debouncedSearch = useDebouncedValue(searchQuery, 350);

  // Advanced filters: image presence + price range + per-column range/select/boolean.
  const passesAdvancedFilters = useCallback((i: CatalogItem): boolean => {
    if (imageFilter !== 'all') {
      const has = Array.isArray(i.images) && i.images.some(Boolean);
      if (imageFilter === 'with' && !has) return false;
      if (imageFilter === 'without' && has) return false;
    }
    if (priceRangeEnabled && (priceMin !== '' || priceMax !== '')) {
      const p = toNumeric(i.unitPrice);
      const min = toNumeric(priceMin);
      const max = toNumeric(priceMax);
      if (min !== null && (p === null || p < min)) return false;
      if (max !== null && (p === null || p > max)) return false;
    }
    for (const col of filterCols) {
      const v = colFilters[col.key];
      if (!v) continue;
      const raw = i.customFields?.[col.key];
      if (col.filterType === 'range') {
        if (v.min === '' && v.max === '') continue;
        const val = toNumeric(raw);
        const min = toNumeric(v.min);
        const max = toNumeric(v.max);
        if (min !== null && (val === null || val < min)) return false;
        if (max !== null && (val === null || val > max)) return false;
      } else if (col.filterType === 'select') {
        if (v === '') continue;
        if (String(raw ?? '').trim() !== v) return false;
      } else if (col.filterType === 'boolean') {
        if (v === '') continue;
        const truthy = raw === true || /^(כן|yes|true|1)$/i.test(String(raw ?? '').trim());
        if (v === 'yes' && !truthy) return false;
        if (v === 'no' && truthy) return false;
      } else if (col.filterType === 'text') {
        if (String(v).trim() === '') continue;
        if (!String(raw ?? '').toLowerCase().includes(String(v).toLowerCase())) return false;
      } else if (col.filterType === 'date') {
        if ((v.from ?? '') === '' && (v.to ?? '') === '') continue;
        const val = String(raw ?? '').slice(0, 10);
        if (!val) return false;
        if (v.from && val < v.from) return false;
        if (v.to && val > v.to) return false;
      }
    }
    return true;
  }, [imageFilter, priceRangeEnabled, priceMin, priceMax, filterCols, colFilters]);

  const filteredItems = useMemo(() => {
    let result = items;
    result = result.filter(passesAdvancedFilters);
    if (categoryFilter !== 'all') {
      result = result.filter((i) => i.category === categoryFilter);
    }
    if (debouncedSearch.trim()) {
      const q = debouncedSearch.toLowerCase();
      const sb = fieldsConfig.searchBaseFields || { name: true, description: true, sku: true };
      const searchableCols = customColumns.filter((c) => c.searchable);
      result = result.filter((i) => {
        const baseHit =
          (sb.name && i.name?.toLowerCase().includes(q)) ||
          (sb.description && i.description?.toLowerCase().includes(q)) ||
          (sb.sku && i.sku?.toLowerCase().includes(q)) ||
          (sb.category && i.category?.toLowerCase().includes(q)) ||
          (sb.link && i.link?.toLowerCase().includes(q)) ||
          (sb.unitPrice && String(i.unitPrice ?? '').toLowerCase().includes(q));
        if (baseHit) return true;
        if (searchableCols.length > 0 && i.customFields) {
          for (const col of searchableCols) {
            const val = i.customFields[col.key];
            if (val && String(val).toLowerCase().includes(q)) return true;
          }
        }
        return false;
      });
    }
    return result;
  }, [items, categoryFilter, debouncedSearch, fieldsConfig, customColumns, passesAdvancedFilters]);

  // Client-side pagination over the filtered list (search still spans everything).
  const { visible: visibleItems, hasMore: itemsHasMore, loadMore: itemsLoadMore, loadAll: itemsLoadAll, count: itemsCount } = useWindowedList(filteredItems, {
    pageSize: 30,
    resetKey: `${categoryFilter}|${debouncedSearch}|${imageFilter}|${priceMin}|${priceMax}|${JSON.stringify(colFilters)}`,
  });

  const resetForm = useCallback(() => {
    setFormName('');
    setFormDescription('');
    setFormPrice('');
    setFormSku('');
    setFormCategory('');
    setFormLink('');
    setFormImages([]);
    setImageUrlInput('');
    setFormCustomFields({});
    setFormIsPublic(false);
    setEditingItem(null);
  }, []);

  const openAddModal = useCallback(() => {
    resetForm();
    setModalVisible(true);
  }, [resetForm]);

  const openEditModal = useCallback((item: CatalogItem) => {
    setEditingItem(item);
    setFormName(item.name);
    setFormDescription(item.description || '');
    setFormPrice(item.unitPrice > 0 ? String(item.unitPrice) : '');
    setFormSku(item.sku || '');
    setFormCategory(item.category || '');
    setFormLink(item.link || '');
    setFormImages(Array.isArray(item.images) ? item.images.filter(Boolean) : []);
    setImageUrlInput('');
    setFormCustomFields(item.customFields || {});
    setFormIsPublic(!!item.isPublic);
    setModalVisible(true);
  }, []);

  const handleSave = useCallback(async () => {
    const reqField = fieldsConfig.requiredField || 'name';
    const baseVals: Record<string, string> = {
      name: formName, description: formDescription, unitPrice: formPrice,
      sku: formSku, category: formCategory, link: formLink,
    };
    const reqFilled = Object.prototype.hasOwnProperty.call(baseVals, reqField)
      ? baseVals[reqField].trim() !== ''
      : true;
    if (!reqFilled) {
      Alert.alert(t('common.error'), isRTL ? 'יש למלא את שדה החובה' : 'Please fill the required field');
      return;
    }
    if (!user?.organization) return;

    setSaving(true);
    try {
      const newItem: CatalogItem = {
        id: editingItem?.id || generateId(),
        name: formName.trim(),
        description: formDescription.trim(),
        unitPrice: parseFloat(formPrice) || 0,
        sku: formSku.trim(),
        category: formCategory.trim(),
        link: formLink.trim(),
        // Persist the full images array (empty => image(s) removed). Falling back to the old images
        // here would silently re-save deleted images, so the removal never "sticks".
        images: formImages.map((u) => u.trim()).filter(Boolean),
        // Merge so any keys not surfaced as columns on this device are preserved.
        customFields: { ...(editingItem?.customFields || {}), ...formCustomFields },
        isPublic: formIsPublic,
      };

      let newItems: CatalogItem[];
      if (editingItem) {
        newItems = items.map((i) => (i.id === editingItem.id ? newItem : i));
      } else {
        newItems = [...items, newItem];
      }

      await catalogApi.save(user.organization, newItems, customColumns);
      setItems(newItems);
      appCache.set(CACHE_KEY, newItems);
      setModalVisible(false);
      resetForm();
    } catch {
      Alert.alert(t('common.error'), t('errors.generic'));
    } finally {
      setSaving(false);
    }
  }, [formName, formDescription, formPrice, formSku, formCategory, formLink, formImages, formCustomFields, formIsPublic, editingItem, items, customColumns, user?.organization, resetForm, fieldsConfig, isRTL]);

  const handleDelete = useCallback((item: CatalogItem) => {
    Alert.alert(
      'מחיקת פריט',
      `למחוק את "${item.name}"?`,
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            if (!user?.organization) return;
            try {
              const updated = await catalogApi.deleteItem(user.organization, item.id, items);
              setItems(updated);
              appCache.set(CACHE_KEY, updated);
            } catch {
              Alert.alert(t('common.error'), t('errors.generic'));
            }
          },
        },
      ]
    );
  }, [items, customColumns, user?.organization]);

  const renderItem = useCallback(({ item }: { item: CatalogItem }) => {
    const hasImage = item.images && item.images.length > 0 && item.images[0];
    const cf = item.customFields || {};
    const hasVal = (v: any) => v !== undefined && v !== null && v !== '';
    // Title: prefer base fields, then the configured required (possibly custom) field,
    // then the first filled custom column — so an item with only dynamic fields isn't blank.
    let titleKey: string | null = null;
    let displayTitle = item.name || item.sku || item.category || '';
    if (!displayTitle) {
      const reqKey = fieldsConfig.requiredField;
      if (reqKey && hasVal(cf[reqKey])) {
        titleKey = reqKey;
        displayTitle = formatCustomValue(cf[reqKey], isRTL);
      } else {
        const firstFilled = customColumns.find((c) => hasVal(cf[c.key]));
        if (firstFilled) {
          titleKey = firstFilled.key;
          displayTitle = formatCustomValue(cf[firstFilled.key], isRTL);
        }
      }
    }
    if (!displayTitle) displayTitle = '—';
    const isChecked = selectedIds.has(item.id);
    return (
      <Pressable
        style={[styles.card, { backgroundColor: theme.colors.surface }, selectionMode && isChecked && { borderWidth: 1.5, borderColor: BRAND_COLOR }]}
        onPress={() => (selectionMode ? toggleSelect(item.id) : openEditModal(item))}
        onLongPress={() => (selectionMode ? undefined : handleDelete(item))}
      >
        <View style={[styles.cardRow, { flexDirection }]}>
          {selectionMode && (
            <MaterialCommunityIcons
              name={isChecked ? 'checkbox-marked-circle' : 'checkbox-blank-circle-outline'}
              size={24}
              color={isChecked ? BRAND_COLOR : theme.colors.onSurfaceVariant}
              style={{ marginEnd: 8 }}
            />
          )}
          {hasImage ? (
            <Pressable onPress={() => openImageViewer(item.images, 0)}>
              <Image source={{ uri: item.images[0] }} style={styles.cardImage} contentFit="cover" />
              {item.images.filter(Boolean).length > 1 && (
                <View style={styles.imageCountBadge}>
                  <MaterialCommunityIcons name="image-multiple" size={10} color="#fff" />
                  <Text style={styles.imageCountText}>{item.images.filter(Boolean).length}</Text>
                </View>
              )}
            </Pressable>
          ) : (
            <View style={[styles.cardImagePlaceholder, { backgroundColor: BRAND_COLOR + '15' }]}>
              <MaterialCommunityIcons name="package-variant" size={28} color={BRAND_COLOR} />
            </View>
          )}
          <View style={styles.cardContent}>
            <Text variant="titleSmall" style={{ color: theme.colors.onSurface, textAlign }} numberOfLines={1}>
              {displayTitle}
            </Text>
            {item.description ? (
              <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, textAlign, marginTop: 2 }} numberOfLines={2}>
                {item.description}
              </Text>
            ) : null}
            {/* Meta chips rendered in the web-configured column order, honoring per-column
                visibility (tableColumns / showInTable). This keeps the app catalog in sync with
                the column ordering + visibility set on the web. */}
            {(() => {
              type Chip = { key: string; node: React.ReactNode };
              const chips: Chip[] = [];
              for (const tok of orderedColumnTokens) {
                if (tok === 'image' || tok === 'name') continue;
                if (!isColumnTokenVisible(tok)) continue;
                if (tok === 'unitPrice') {
                  if (item.unitPrice > 0) chips.push({ key: tok, node: (
                    <Text variant="labelMedium" style={{ color: BRAND_COLOR, fontWeight: '700', marginEnd: 8 }}>₪{item.unitPrice.toLocaleString()}</Text>
                  ) });
                } else if (tok === 'sku') {
                  if (item.sku) chips.push({ key: tok, node: (
                    <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant, marginEnd: 8 }}>{item.sku}</Text>
                  ) });
                } else if (tok === 'category') {
                  if (item.category) chips.push({ key: tok, node: (
                    <View style={[styles.categoryBadge, { backgroundColor: BRAND_COLOR + '18', marginEnd: 4, marginTop: 2 }]}>
                      <Text variant="labelSmall" style={{ color: BRAND_COLOR, fontSize: 10 }}>{item.category}</Text>
                    </View>
                  ) });
                } else if (tok === 'link') {
                  if (item.link) chips.push({ key: tok, node: (
                    <MaterialCommunityIcons name="link-variant" size={13} color={theme.colors.onSurfaceVariant} style={{ marginEnd: 6 }} />
                  ) });
                } else if (tok.startsWith('custom:')) {
                  const col = customColumns.find((c) => `custom:${c.id}` === tok);
                  if (col && col.key !== titleKey && hasVal(cf[col.key])) chips.push({ key: tok, node: (
                    <View style={[styles.customBadge, { backgroundColor: theme.colors.onSurfaceVariant + '14' }]}>
                      <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant, fontSize: 10 }}>{col.label}: {formatCustomValue(cf[col.key], isRTL)}</Text>
                    </View>
                  ) });
                }
              }
              if (!chips.length) return null;
              return (
                <View style={[styles.cardMeta, { flexDirection, flexWrap: 'wrap', alignItems: 'center' }]}>
                  {chips.slice(0, 6).map((c) => <React.Fragment key={c.key}>{c.node}</React.Fragment>)}
                </View>
              );
            })()}
          </View>
          {!selectionMode && (
          <View>
            <IconButton
              icon={item.isPublic ? 'link-variant' : 'link-variant-off'}
              size={18}
              iconColor={item.isPublic ? BRAND_COLOR : theme.colors.onSurfaceVariant}
              onPress={() => toggleItemPublic(item)}
            />
            <IconButton
              icon="pencil-outline"
              size={18}
              iconColor={theme.colors.onSurfaceVariant}
              onPress={() => openEditModal(item)}
            />
            <IconButton
              icon="share-variant"
              size={18}
              iconColor={BRAND_COLOR}
              onPress={() => handleShareItem(item)}
            />
          </View>
          )}
        </View>
        {item.isPublic ? (
          <View style={[styles.publicBadge, { [isRTL ? 'left' : 'right']: 8 }]}>
            <MaterialCommunityIcons name="link-variant" size={10} color="#fff" />
            <Text style={styles.publicBadgeText}>{isRTL ? 'בקטלוג הפומבי' : 'Public'}</Text>
          </View>
        ) : null}
      </Pressable>
    );
  }, [theme, flexDirection, textAlign, openEditModal, handleDelete, handleShareItem, toggleItemPublic, openImageViewer, customColumns, orderedColumnTokens, isColumnTokenVisible, isRTL, fieldsConfig, selectionMode, selectedIds, toggleSelect]);

  // Configurable mandatory field (defaults to name). On mobile only base fields are editable,
  // so if the required field is a custom column we don't block the save here.
  const requiredField = fieldsConfig.requiredField || 'name';
  const baseFormValues: Record<string, string> = {
    name: formName,
    description: formDescription,
    unitPrice: formPrice,
    sku: formSku,
    category: formCategory,
    link: formLink,
  };
  const requiredIsBase = Object.prototype.hasOwnProperty.call(baseFormValues, requiredField);
  const requiredFilled = requiredIsBase ? baseFormValues[requiredField].trim() !== '' : true;
  const star = (key: string) => (requiredField === key ? ' *' : '');

  if (loading && items.length === 0) {
    return (
      <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
        <Appbar.Header style={{ backgroundColor: BRAND_COLOR }} statusBarHeight={insets.top}>
          <Appbar.BackAction onPress={() => router.back()} color="#fff" />
          <Appbar.Content title={t('more.catalog')} titleStyle={styles.headerTitle} color="#fff" />
        </Appbar.Header>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={BRAND_COLOR} />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {/* Header */}
      <Appbar.Header style={{ backgroundColor: BRAND_COLOR }} statusBarHeight={insets.top}>
        <Appbar.BackAction onPress={() => router.back()} color="#fff" />
        <Appbar.Content
          title={t('more.catalog')}
          titleStyle={styles.headerTitle}
          color="#fff"
        />
        <Appbar.Action
          icon={selectionMode ? 'close' : 'checkbox-multiple-marked-outline'}
          color="#fff"
          onPress={() => { if (selectionMode) exitSelection(); else setSelectionMode(true); }}
        />
        <Appbar.Action icon="inbox-arrow-down" color="#fff" onPress={openSelections} />
        <Appbar.Action icon={sharing ? 'loading' : 'share-variant'} color="#fff" disabled={sharing} onPress={openShareSettings} />
        <Appbar.Action
          icon={hasActiveFilters ? 'filter' : 'filter-outline'}
          color="#fff"
          onPress={() => setFiltersVisible((v) => !v)}
        />
        <Appbar.Action icon="magnify" color="#fff" onPress={() => setSearchVisible(!searchVisible)} />
      </Appbar.Header>

      {/* Search */}
      {searchVisible && (
        <View style={[styles.searchRow, { backgroundColor: theme.colors.surface }]}>
          <Searchbar
            placeholder="חיפוש פריטים..."
            value={searchQuery}
            onChangeText={setSearchQuery}
            style={styles.searchbar}
            inputStyle={{ textAlign: isRTL ? 'right' : 'left' }}
          />
        </View>
      )}

      {/* Advanced filters panel — mirrors the web catalog toolbar (price range + per-column filters) */}
      {filtersVisible && (
        <View style={[styles.filtersPanel, { backgroundColor: theme.colors.surface, borderBottomColor: theme.colors.outlineVariant }]}>
          {/* Image presence filter */}
          <View style={{ marginBottom: 10 }}>
            <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 4, textAlign }}>
              {isRTL ? 'תמונה' : 'Image'}
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {([['all', isRTL ? 'הכל' : 'All'], ['with', isRTL ? 'עם תמונה' : 'With image'], ['without', isRTL ? 'ללא תמונה' : 'No image']] as const).map(([val, label]) => (
                <Chip
                  key={val}
                  selected={imageFilter === val}
                  onPress={() => setImageFilter(val)}
                  style={imageFilter === val ? { backgroundColor: BRAND_COLOR + '20' } : undefined}
                  textStyle={imageFilter === val ? { color: BRAND_COLOR } : undefined}
                >
                  {label}
                </Chip>
              ))}
            </View>
          </View>

          {priceRangeEnabled && (
            <View style={{ marginBottom: 10 }}>
              <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 4, textAlign }}>
                {isRTL ? 'טווח מחיר (₪)' : 'Price range (₪)'}
              </Text>
              <View style={{ flexDirection, gap: 8 }}>
                <RNTextInput
                  value={priceMin}
                  onChangeText={setPriceMin}
                  placeholder={isRTL ? 'מ-' : 'From'}
                  placeholderTextColor={theme.colors.onSurfaceVariant}
                  keyboardType="numeric"
                  style={[styles.filterInput, { color: theme.colors.onSurface, borderColor: theme.colors.outlineVariant, textAlign }]}
                />
                <RNTextInput
                  value={priceMax}
                  onChangeText={setPriceMax}
                  placeholder={isRTL ? 'עד' : 'To'}
                  placeholderTextColor={theme.colors.onSurfaceVariant}
                  keyboardType="numeric"
                  style={[styles.filterInput, { color: theme.colors.onSurface, borderColor: theme.colors.outlineVariant, textAlign }]}
                />
              </View>
            </View>
          )}

          {filterCols.map((col) => (
            <View key={col.id} style={{ marginBottom: 10 }}>
              <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 4, textAlign }}>
                {col.label}
              </Text>
              {col.filterType === 'range' ? (
                <View style={{ flexDirection, gap: 8 }}>
                  <RNTextInput
                    value={colFilters[col.key]?.min ?? ''}
                    onChangeText={(v) => setColFilters((p) => ({ ...p, [col.key]: { ...(p[col.key] || {}), min: v } }))}
                    placeholder={isRTL ? 'מ-' : 'From'}
                    placeholderTextColor={theme.colors.onSurfaceVariant}
                    keyboardType="numeric"
                    style={[styles.filterInput, { color: theme.colors.onSurface, borderColor: theme.colors.outlineVariant, textAlign }]}
                  />
                  <RNTextInput
                    value={colFilters[col.key]?.max ?? ''}
                    onChangeText={(v) => setColFilters((p) => ({ ...p, [col.key]: { ...(p[col.key] || {}), max: v } }))}
                    placeholder={isRTL ? 'עד' : 'To'}
                    placeholderTextColor={theme.colors.onSurfaceVariant}
                    keyboardType="numeric"
                    style={[styles.filterInput, { color: theme.colors.onSurface, borderColor: theme.colors.outlineVariant, textAlign }]}
                  />
                </View>
              ) : col.filterType === 'boolean' ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {([['', isRTL ? 'הכל' : 'All'], ['yes', isRTL ? 'כן' : 'Yes'], ['no', isRTL ? 'לא' : 'No']] as const).map(([val, label]) => (
                    <Chip
                      key={val}
                      selected={(colFilters[col.key] ?? '') === val}
                      onPress={() => setColFilters((p) => ({ ...p, [col.key]: val }))}
                      style={(colFilters[col.key] ?? '') === val ? { backgroundColor: BRAND_COLOR + '20' } : undefined}
                      textStyle={(colFilters[col.key] ?? '') === val ? { color: BRAND_COLOR } : undefined}
                    >
                      {label}
                    </Chip>
                  ))}
                </View>
              ) : col.filterType === 'text' ? (
                <RNTextInput
                  value={colFilters[col.key] ?? ''}
                  onChangeText={(v) => setColFilters((p) => ({ ...p, [col.key]: v }))}
                  placeholder={isRTL ? 'חיפוש...' : 'Search...'}
                  placeholderTextColor={theme.colors.onSurfaceVariant}
                  style={[styles.filterInput, { color: theme.colors.onSurface, borderColor: theme.colors.outlineVariant, textAlign }]}
                />
              ) : col.filterType === 'date' ? (
                <View style={{ flexDirection, gap: 8 }}>
                  <Pressable
                    onPress={() => setDatePickerFor({ key: col.key, edge: 'from' })}
                    style={[styles.filterInput, { borderColor: theme.colors.outlineVariant, justifyContent: 'center' }]}
                  >
                    <Text style={{ color: colFilters[col.key]?.from ? theme.colors.onSurface : theme.colors.onSurfaceVariant, textAlign }}>
                      {colFilters[col.key]?.from || (isRTL ? 'מ-' : 'From')}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setDatePickerFor({ key: col.key, edge: 'to' })}
                    style={[styles.filterInput, { borderColor: theme.colors.outlineVariant, justifyContent: 'center' }]}
                  >
                    <Text style={{ color: colFilters[col.key]?.to ? theme.colors.onSurface : theme.colors.onSurfaceVariant, textAlign }}>
                      {colFilters[col.key]?.to || (isRTL ? 'עד' : 'To')}
                    </Text>
                  </Pressable>
                </View>
              ) : (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                  <Chip
                    selected={!colFilters[col.key]}
                    onPress={() => setColFilters((p) => ({ ...p, [col.key]: '' }))}
                    style={!colFilters[col.key] ? { backgroundColor: BRAND_COLOR + '20' } : undefined}
                    textStyle={!colFilters[col.key] ? { color: BRAND_COLOR } : undefined}
                  >
                    {isRTL ? 'הכל' : 'All'}
                  </Chip>
                  {selectOptionsForFilter(col).map((opt) => (
                    <Chip
                      key={opt}
                      selected={colFilters[col.key] === opt}
                      onPress={() => setColFilters((p) => ({ ...p, [col.key]: p[col.key] === opt ? '' : opt }))}
                      style={colFilters[col.key] === opt ? { backgroundColor: BRAND_COLOR + '20' } : undefined}
                      textStyle={colFilters[col.key] === opt ? { color: BRAND_COLOR } : undefined}
                    >
                      {opt}
                    </Chip>
                  ))}
                </ScrollView>
              )}
            </View>
          ))}

          {hasActiveFilters && (
            <Button mode="text" onPress={clearFilters} textColor={BRAND_COLOR} compact style={{ alignSelf: isRTL ? 'flex-start' : 'flex-end' }}>
              {isRTL ? 'נקה מסננים' : 'Clear filters'}
            </Button>
          )}
        </View>
      )}

      {/* Category chips */}
      {categories.length > 2 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsRow}
          style={{ flexGrow: 0 }}
        >
          {categories.map((cat) => (
            <Chip
              key={cat}
              selected={categoryFilter === cat}
              onPress={() => setCategoryFilter(cat)}
              style={[
                styles.chip,
                categoryFilter === cat && { backgroundColor: BRAND_COLOR + '20' },
              ]}
              textStyle={categoryFilter === cat ? { color: BRAND_COLOR } : undefined}
            >
              {cat === 'all' ? 'הכל' : cat}
            </Chip>
          ))}
        </ScrollView>
      )}

      {/* Stats bar */}
      <View style={[styles.statsBar, { flexDirection }]}>
        <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant }}>
          {filteredItems.length} פריטים
        </Text>
      </View>

      {/* Items list */}
      <FlatList
        data={visibleItems}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={[styles.list, filteredItems.length === 0 && styles.emptyList]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[BRAND_COLOR]} />}
        ListFooterComponent={
          <ListPaginationFooter
            count={itemsCount}
            total={filteredItems.length}
            hasMore={itemsHasMore}
            onLoadMore={itemsLoadMore}
            onLoadAll={itemsLoadAll}
          />
        }
        onEndReached={itemsHasMore ? itemsLoadMore : undefined}
        onEndReachedThreshold={0.4}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <MaterialCommunityIcons name="package-variant" size={64} color={BRAND_COLOR} style={{ opacity: 0.3 }} />
            <Text variant="bodyLarge" style={{ color: theme.colors.onSurfaceVariant, marginTop: 16 }}>
              {searchQuery ? 'לא נמצאו פריטים' : 'הקטלוג ריק'}
            </Text>
            {!searchQuery && (
              <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: 4 }}>
                לחצו על + להוספת פריט ראשון
              </Text>
            )}
          </View>
        }
      />

      {/* FAB (hidden while selecting items for a customer link) */}
      {!selectionMode && (
        <FAB
          icon="plus"
          style={[styles.fab, { backgroundColor: BRAND_COLOR }]}
          color="#fff"
          onPress={openAddModal}
        />
      )}

      {/* Selection action bar — build a per-contact share link from the chosen items, or bulk
          add/remove them to/from the DEFAULT public catalog (like the web catalog). */}
      {selectionMode && (
        <View style={[styles.selectionBar, { backgroundColor: theme.colors.surface, borderTopColor: theme.colors.outlineVariant, paddingBottom: insets.bottom + 10 }]}>
          <View style={{ flexDirection, alignItems: 'center', width: '100%' }}>
            <Text style={{ color: theme.colors.onSurface, fontWeight: '700', flex: 1, textAlign }}>
              {selectedIds.size} {isRTL ? 'נבחרו' : 'selected'}
            </Text>
            <Button mode="text" onPress={exitSelection} textColor={theme.colors.onSurfaceVariant} compact>
              {isRTL ? 'בטל' : 'Cancel'}
            </Button>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, width: '100%', justifyContent: 'center' }}>
            {/* Remove from the public catalog — shown when any selected item is currently public. */}
            {selectionPublicStats.inCatalog > 0 && (
              <Button
                mode="outlined"
                icon="link-variant-off"
                onPress={() => bulkSetPublic(false)}
                textColor={theme.colors.error}
                style={{ borderColor: theme.colors.error }}
                compact
              >
                {isRTL ? 'הסר מהקטלוג' : 'Remove from catalog'}
              </Button>
            )}
            {/* Return to the public catalog — shown when any selected item was removed. */}
            {selectionPublicStats.removed > 0 && (
              <Button
                mode="outlined"
                icon="link-variant"
                onPress={() => bulkSetPublic(true)}
                textColor={BRAND_COLOR}
                style={{ borderColor: BRAND_COLOR }}
                compact
              >
                {isRTL ? 'החזר לקטלוג' : 'Return to catalog'}
              </Button>
            )}
            <Button
              mode="contained"
              icon="account-arrow-right"
              disabled={selectedIds.size === 0}
              onPress={openShareLink}
              buttonColor={BRAND_COLOR}
              textColor="#fff"
              compact
            >
              {isRTL ? 'קישור ללקוח' : 'Customer link'}
            </Button>
          </View>
        </View>
      )}

      {/* Add/Edit Modal */}
      <Portal>
        <Modal
          visible={modalVisible}
          onDismiss={() => { setModalVisible(false); resetForm(); }}
          contentContainerStyle={[styles.modal, { backgroundColor: theme.colors.surface }]}
        >
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text variant="titleMedium" style={[styles.modalTitle, { color: theme.colors.onSurface, textAlign }]}>
                {editingItem ? 'עריכת פריט' : 'פריט חדש'}
              </Text>

              {fieldsConfig.name !== false && (
              <TextInput
                label={`שם${star('name')}`}
                value={formName}
                onChangeText={setFormName}
                mode="outlined"
                style={styles.input}
                outlineColor={BRAND_COLOR + '40'}
                activeOutlineColor={BRAND_COLOR}
              />
              )}

              {fieldsConfig.description !== false && (
              <TextInput
                label={`תיאור${star('description')}`}
                value={formDescription}
                onChangeText={setFormDescription}
                mode="outlined"
                style={styles.input}
                multiline
                numberOfLines={3}
                outlineColor={BRAND_COLOR + '40'}
                activeOutlineColor={BRAND_COLOR}
              />
              )}

              <View style={[styles.formRow, { flexDirection }]}>
                {fieldsConfig.unitPrice !== false && (
                <TextInput
                  label={`מחיר${star('unitPrice')}`}
                  value={formPrice}
                  onChangeText={setFormPrice}
                  mode="outlined"
                  style={[styles.input, { flex: 1 }]}
                  keyboardType="numeric"
                  outlineColor={BRAND_COLOR + '40'}
                  activeOutlineColor={BRAND_COLOR}
                />
                )}
                {fieldsConfig.unitPrice !== false && fieldsConfig.sku !== false && <View style={{ width: 12 }} />}
                {fieldsConfig.sku !== false && (
                <TextInput
                  label={`מק״ט${star('sku')}`}
                  value={formSku}
                  onChangeText={setFormSku}
                  mode="outlined"
                  style={[styles.input, { flex: 1 }]}
                  outlineColor={BRAND_COLOR + '40'}
                  activeOutlineColor={BRAND_COLOR}
                />
                )}
              </View>

              {fieldsConfig.category !== false && (
              <TextInput
                label={`קטגוריה${star('category')}`}
                value={formCategory}
                onChangeText={setFormCategory}
                mode="outlined"
                style={styles.input}
                outlineColor={BRAND_COLOR + '40'}
                activeOutlineColor={BRAND_COLOR}
              />
              )}

              {fieldsConfig.link !== false && (
              <TextInput
                label={`קישור (URL)${star('link')}`}
                value={formLink}
                onChangeText={setFormLink}
                mode="outlined"
                style={styles.input}
                keyboardType="url"
                autoCapitalize="none"
                outlineColor={BRAND_COLOR + '40'}
                activeOutlineColor={BRAND_COLOR}
              />
              )}

              {/* Images (multiple per item) — camera / gallery / URL. Tap a thumbnail to enlarge. */}
              <Text variant="labelLarge" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 6, textAlign }}>
                {isRTL ? `תמונות${formImages.length ? ` (${formImages.length})` : ''}` : `Images${formImages.length ? ` (${formImages.length})` : ''}`}
              </Text>

              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
                <Button
                  mode="outlined"
                  icon="camera"
                  onPress={() => pickImage('camera')}
                  loading={uploading}
                  disabled={uploading}
                  style={{ flex: 1, borderColor: BRAND_COLOR }}
                  textColor={BRAND_COLOR}
                  compact
                >
                  {isRTL ? 'צלם' : 'Camera'}
                </Button>
                <Button
                  mode="outlined"
                  icon="image-multiple"
                  onPress={() => pickImage('library')}
                  loading={uploading}
                  disabled={uploading}
                  style={{ flex: 1, borderColor: BRAND_COLOR }}
                  textColor={BRAND_COLOR}
                  compact
                >
                  {isRTL ? 'גלריה' : 'Gallery'}
                </Button>
              </View>

              {/* URL fallback */}
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10, alignItems: 'center' }}>
                <TextInput
                  label={isRTL ? 'הדבק קישור לתמונה' : 'Paste image URL'}
                  value={imageUrlInput}
                  onChangeText={setImageUrlInput}
                  onSubmitEditing={addImageUrl}
                  mode="outlined"
                  style={[styles.input, { flex: 1, marginBottom: 0 }]}
                  keyboardType="url"
                  autoCapitalize="none"
                  outlineColor={BRAND_COLOR + '40'}
                  activeOutlineColor={BRAND_COLOR}
                />
                <IconButton icon="plus-circle" size={26} iconColor={BRAND_COLOR} disabled={!imageUrlInput.trim()} onPress={addImageUrl} />
              </View>

              {formImages.length > 0 && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }} contentContainerStyle={{ gap: 8 }}>
                  {formImages.map((img, idx) => (
                    <View key={`${img}_${idx}`} style={styles.formThumbWrap}>
                      <Pressable onPress={() => openImageViewer(formImages, idx)}>
                        <Image source={{ uri: img }} style={styles.formThumb} contentFit="cover" />
                      </Pressable>
                      {idx === 0 && (
                        <View style={styles.formThumbMainBadge}>
                          <Text style={{ color: '#fff', fontSize: 9, fontWeight: '700' }}>{isRTL ? 'ראשית' : 'Main'}</Text>
                        </View>
                      )}
                      <IconButton
                        icon="close-circle"
                        size={18}
                        iconColor="#ef4444"
                        style={styles.formThumbRemove}
                        onPress={() => removeImageAt(idx)}
                      />
                      <View style={styles.formThumbMoveRow}>
                        {idx > 0 && (
                          <Pressable onPress={() => moveImage(idx, -1)} style={styles.formThumbMoveBtn} hitSlop={6}>
                            <MaterialCommunityIcons name="chevron-left" size={16} color="#fff" />
                          </Pressable>
                        )}
                        {idx < formImages.length - 1 && (
                          <Pressable onPress={() => moveImage(idx, 1)} style={styles.formThumbMoveBtn} hitSlop={6}>
                            <MaterialCommunityIcons name="chevron-right" size={16} color="#fff" />
                          </Pressable>
                        )}
                      </View>
                    </View>
                  ))}
                </ScrollView>
              )}

              {/* Custom columns (defined in the web Catalog → Columns settings) — editable here too,
                  rendered in the same display order configured on the web. */}
              {orderedCustomColumns.length > 0 && (
                <>
                  <Text variant="labelLarge" style={{ color: theme.colors.onSurfaceVariant, marginTop: 4, marginBottom: 8, textAlign }}>
                    {isRTL ? 'שדות מותאמים' : 'Custom fields'}
                  </Text>
                  {orderedCustomColumns.map((col) => {
                    const val = formCustomFields[col.key];
                    if (col.type === 'boolean') {
                      const on = val === true || val === 'true' || val === 'כן' || val === 'Yes';
                      return (
                        <View key={col.id} style={{ flexDirection, alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                          <Text style={{ color: theme.colors.onSurface, flex: 1 }}>{col.label}</Text>
                          <Switch value={on} onValueChange={(v) => setCustomField(col.key, v)} color={BRAND_COLOR} />
                        </View>
                      );
                    }
                    const selectOptions = col.type === 'select' ? getColumnOptions(col) : [];
                    if (col.type === 'select' && selectOptions.length > 0) {
                      return (
                        <View key={col.id} style={{ marginBottom: 12 }}>
                          <Text style={{ color: theme.colors.onSurfaceVariant, marginBottom: 4, textAlign }}>{col.label}</Text>
                          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                            {selectOptions.map((opt) => (
                              <Chip
                                key={opt}
                                selected={val === opt}
                                onPress={() => setCustomField(col.key, val === opt ? '' : opt)}
                                style={val === opt ? { backgroundColor: BRAND_COLOR + '20' } : undefined}
                                textStyle={val === opt ? { color: BRAND_COLOR } : undefined}
                              >
                                {opt}
                              </Chip>
                            ))}
                          </View>
                        </View>
                      );
                    }
                    return (
                      <TextInput
                        key={col.id}
                        label={col.label}
                        value={val === undefined || val === null ? '' : String(val)}
                        onChangeText={(txt) => setCustomField(col.key, txt)}
                        mode="outlined"
                        style={styles.input}
                        keyboardType={col.type === 'number' ? 'numeric' : 'default'}
                        outlineColor={BRAND_COLOR + '40'}
                        activeOutlineColor={BRAND_COLOR}
                      />
                    );
                  })}
                </>
              )}

              {/* Public catalog visibility (used when share mode = "marked items only") */}
              <View style={[styles.publicToggleRow, { flexDirection, borderColor: theme.colors.outlineVariant }]}>
                <View style={{ flex: 1 }}>
                  <Text variant="bodyMedium" style={{ color: theme.colors.onSurface, textAlign }}>
                    {isRTL ? 'הצג בקטלוג הפומבי' : 'Show in public catalog'}
                  </Text>
                  <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, textAlign }}>
                    {isRTL ? 'במצב "רק פריטים מסומנים"' : 'When sharing marked items only'}
                  </Text>
                </View>
                <Switch value={formIsPublic} onValueChange={setFormIsPublic} color={BRAND_COLOR} />
              </View>

              {editingItem && (
                <Button
                  mode="outlined"
                  icon="share-variant"
                  onPress={() => handleShareItem(editingItem)}
                  style={[styles.actionBtn, { borderColor: BRAND_COLOR, marginBottom: 8 }]}
                  textColor={BRAND_COLOR}
                >
                  {isRTL ? 'שתף פריט' : 'Share item'}
                </Button>
              )}

              <View style={[styles.modalActions, { flexDirection }]}>
                <Button
                  mode="outlined"
                  onPress={() => { setModalVisible(false); resetForm(); }}
                  style={styles.actionBtn}
                  textColor={theme.colors.onSurfaceVariant}
                >
                  ביטול
                </Button>
                <Button
                  mode="contained"
                  onPress={handleSave}
                  loading={saving}
                  disabled={saving || !requiredFilled}
                  style={[styles.actionBtn, { backgroundColor: BRAND_COLOR }]}
                  textColor="#fff"
                >
                  {editingItem ? 'שמור' : 'הוסף'}
                </Button>
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
        </Modal>

        {/* Share settings — enable public catalog + choose all vs. marked items */}
        <Modal
          visible={shareModalVisible}
          onDismiss={() => setShareModalVisible(false)}
          contentContainerStyle={[styles.modal, { backgroundColor: theme.colors.surface }]}
        >
          <View style={{ flexDirection, alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <Text variant="titleMedium" style={{ color: theme.colors.onSurface }}>
              {isRTL ? 'שיתוף קטלוג פומבי' : 'Share public catalog'}
            </Text>
            <IconButton icon="close" size={20} onPress={() => setShareModalVisible(false)} />
          </View>

          {shareCfgLoading ? (
            <View style={{ paddingVertical: 24 }}><ActivityIndicator color={BRAND_COLOR} /></View>
          ) : (
            <ScrollView keyboardShouldPersistTaps="handled">
              <View style={[styles.publicToggleRow, { flexDirection, borderColor: theme.colors.outlineVariant }]}>
                <Text variant="bodyMedium" style={{ color: theme.colors.onSurface, flex: 1, textAlign }}>
                  {isRTL ? 'הפעל דף קטלוג פומבי' : 'Enable public catalog page'}
                </Text>
                <Switch
                  value={shareCfg.enabled !== false}
                  onValueChange={(v) => setShareCfg((p) => ({ ...p, enabled: v }))}
                  color={BRAND_COLOR}
                />
              </View>

              <Text variant="bodyMedium" style={{ color: theme.colors.onSurface, marginTop: 12, marginBottom: 6, textAlign }}>
                {isRTL ? 'אילו מוצרים לשתף:' : 'Which items to share:'}
              </Text>
              <Pressable
                style={[styles.shareModeRow, { flexDirection, borderColor: (shareCfg.shareMode || 'all') === 'all' ? BRAND_COLOR : theme.colors.outlineVariant }]}
                onPress={() => setShareCfg((p) => ({ ...p, shareMode: 'all' }))}
              >
                <MaterialCommunityIcons
                  name={(shareCfg.shareMode || 'all') === 'all' ? 'radiobox-marked' : 'radiobox-blank'}
                  size={20}
                  color={(shareCfg.shareMode || 'all') === 'all' ? BRAND_COLOR : theme.colors.onSurfaceVariant}
                />
                <Text variant="bodyMedium" style={{ color: theme.colors.onSurface, marginHorizontal: 10, flex: 1, textAlign }}>
                  {isRTL ? `כל הקטלוג (${items.length} מוצרים)` : `All catalog (${items.length} items)`}
                </Text>
              </Pressable>
              <Pressable
                style={[styles.shareModeRow, { flexDirection, borderColor: shareCfg.shareMode === 'marked' ? BRAND_COLOR : theme.colors.outlineVariant }]}
                onPress={() => setShareCfg((p) => ({ ...p, shareMode: 'marked' }))}
              >
                <MaterialCommunityIcons
                  name={shareCfg.shareMode === 'marked' ? 'radiobox-marked' : 'radiobox-blank'}
                  size={20}
                  color={shareCfg.shareMode === 'marked' ? BRAND_COLOR : theme.colors.onSurfaceVariant}
                />
                <Text variant="bodyMedium" style={{ color: theme.colors.onSurface, marginHorizontal: 10, flex: 1, textAlign }}>
                  {isRTL ? `רק פריטים מסומנים (${markedCount} מסומנים)` : `Marked items only (${markedCount} marked)`}
                </Text>
              </Pressable>

              {shareCfg.shareMode === 'marked' && (
                <Text variant="bodySmall" style={{ color: markedCount === 0 ? theme.colors.error : theme.colors.onSurfaceVariant, marginTop: 6, textAlign }}>
                  {markedCount === 0
                    ? (isRTL ? '⚠️ לא סומנו מוצרים — סמן פריטים בעזרת אייקון הקישור בכרטיס, אחרת הדף יהיה ריק.' : '⚠️ No items marked — tap the link icon on a card to mark items, otherwise the page will be empty.')
                    : (isRTL ? 'רק המוצרים שסימנת יופיעו בדף הפומבי.' : 'Only the items you marked will appear on the public page.')}
                </Text>
              )}

              <View style={[styles.modalActions, { flexDirection, marginTop: 16 }]}>
                <Button
                  mode="outlined"
                  icon="share-variant"
                  onPress={handleShareCatalog}
                  disabled={sharing}
                  loading={sharing}
                  style={[styles.actionBtn, { borderColor: BRAND_COLOR }]}
                  textColor={BRAND_COLOR}
                >
                  {isRTL ? 'שתף קישור' : 'Share link'}
                </Button>
                <Button
                  mode="contained"
                  onPress={saveShareSettings}
                  loading={shareSaving}
                  disabled={shareSaving}
                  style={[styles.actionBtn, { backgroundColor: BRAND_COLOR }]}
                  textColor="#fff"
                >
                  {isRTL ? 'שמור' : 'Save'}
                </Button>
              </View>
            </ScrollView>
          )}
        </Modal>

        {/* Per-contact personalized share link (from the selected items) */}
        <Modal
          visible={shareLinkVisible}
          onDismiss={() => setShareLinkVisible(false)}
          contentContainerStyle={[styles.modal, styles.modalTall, { backgroundColor: theme.colors.surface }]}
        >
          <View style={{ flexDirection, alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <Text variant="titleMedium" style={{ color: theme.colors.onSurface }}>
              {isRTL ? '🔗 קישור אישי ללקוח' : '🔗 Personal customer link'}
            </Text>
            <IconButton icon="close" size={20} onPress={() => setShareLinkVisible(false)} />
          </View>

          {!slUrl ? (
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
              <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 4 }}>
                <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 10, textAlign }}>
                  {isRTL ? 'צור קישור שמציג ללקוח הזה בדיוק את המוצרים שבחרת.' : 'Create a link that shows this customer exactly the items you picked.'}
                </Text>

                <Pressable
                  style={[styles.shareModeRowCompact, { flexDirection, borderColor: slScope === 'selected' ? BRAND_COLOR : theme.colors.outlineVariant }]}
                  onPress={() => setSlScope('selected')}
                >
                  <MaterialCommunityIcons name={slScope === 'selected' ? 'radiobox-marked' : 'radiobox-blank'} size={20} color={slScope === 'selected' ? BRAND_COLOR : theme.colors.onSurfaceVariant} />
                  <Text variant="bodyMedium" style={{ color: theme.colors.onSurface, marginHorizontal: 10, flex: 1, textAlign }}>
                    {isRTL ? `רק המוצרים שנבחרו (${selectedIds.size})` : `Only selected items (${selectedIds.size})`}
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.shareModeRowCompact, { flexDirection, borderColor: slScope === 'all' ? BRAND_COLOR : theme.colors.outlineVariant }]}
                  onPress={() => setSlScope('all')}
                >
                  <MaterialCommunityIcons name={slScope === 'all' ? 'radiobox-marked' : 'radiobox-blank'} size={20} color={slScope === 'all' ? BRAND_COLOR : theme.colors.onSurfaceVariant} />
                  <Text variant="bodyMedium" style={{ color: theme.colors.onSurface, marginHorizontal: 10, flex: 1, textAlign }}>
                    {isRTL ? 'כל הקטלוג' : 'Whole catalog'}
                  </Text>
                </Pressable>

                <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant, marginTop: 8, marginBottom: 6, textAlign }}>
                  {isRTL ? 'מה הלקוח יכול לעשות' : 'What the customer can do'}
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                  {([['browse', isRTL ? 'צפייה' : 'Browse'], ['order', isRTL ? 'הזמנה' : 'Order'], ['lead', isRTL ? 'ליד' : 'Lead'], ['inquiry', isRTL ? 'התעניינות' : 'Inquiry']] as const).map(([val, label]) => (
                    <Chip
                      key={val}
                      selected={slPurpose === val}
                      onPress={() => setSlPurpose(val)}
                      style={slPurpose === val ? { backgroundColor: BRAND_COLOR + '20' } : undefined}
                      textStyle={slPurpose === val ? { color: BRAND_COLOR } : undefined}
                    >
                      {label}
                    </Chip>
                  ))}
                </View>

                <TextInput
                  label={isRTL ? 'שם הלקוח (לא חובה)' : 'Customer name (optional)'}
                  value={slName}
                  onChangeText={setSlName}
                  mode="outlined"
                  dense
                  style={styles.input}
                  outlineColor={BRAND_COLOR + '40'}
                  activeOutlineColor={BRAND_COLOR}
                />

                {/* Country-code phone input (default Israel) so the number is stored in the correct
                    international format (e.g. 972…) and the WhatsApp send always works. */}
                <PhoneNumberInput
                  label={isRTL ? 'טלפון (לשליחה בוואטסאפ)' : 'Phone (for WhatsApp)'}
                  value={slPhone}
                  onChangeNumber={setSlPhone}
                  theme={theme}
                  placeholder={isRTL ? '050-0000000' : '50-0000000'}
                  onBlurNormalized={() => Keyboard.dismiss()}
                />

                <Button
                  mode="contained"
                  icon="link-variant"
                  onPress={() => { Keyboard.dismiss(); createCustomerLink(); }}
                  loading={slCreating}
                  disabled={slCreating || (slScope === 'selected' && selectedIds.size === 0)}
                  style={[styles.actionBtn, { backgroundColor: BRAND_COLOR, marginTop: 16 }]}
                  textColor="#fff"
                >
                  {isRTL ? 'צור קישור' : 'Create link'}
                </Button>
              </ScrollView>
            </KeyboardAvoidingView>
          ) : (
            <View>
              <Text variant="bodyMedium" style={{ color: BRAND_COLOR, fontWeight: '700', marginBottom: 10, textAlign }}>
                {isRTL ? '✓ הקישור מוכן!' : '✓ Link ready!'}
              </Text>
              <Text selectable style={{ color: theme.colors.onSurface, backgroundColor: theme.colors.surfaceVariant, padding: 10, borderRadius: 8, marginBottom: 12, writingDirection: 'ltr' }}>
                {slUrl}
              </Text>
              <View style={{ flexDirection, gap: 8 }}>
                <Button mode="outlined" icon="content-copy" onPress={copyCustomerLink} style={[styles.actionBtn, { flex: 1, borderColor: BRAND_COLOR }]} textColor={BRAND_COLOR}>
                  {slCopied ? (isRTL ? 'הועתק ✓' : 'Copied ✓') : (isRTL ? 'העתק' : 'Copy')}
                </Button>
                <Button mode="contained" icon="whatsapp" onPress={sendCustomerLinkWhatsApp} style={[styles.actionBtn, { flex: 1, backgroundColor: BRAND_COLOR }]} textColor="#fff">
                  {isRTL ? 'שלח בוואטסאפ' : 'Send on WhatsApp'}
                </Button>
              </View>
              <Button mode="text" onPress={() => { setShareLinkVisible(false); exitSelection(); }} textColor={theme.colors.onSurfaceVariant} style={{ marginTop: 8 }}>
                {isRTL ? 'סיום' : 'Done'}
              </Button>
            </View>
          )}
        </Modal>

        {/* Catalog selections (customer inquiries from the public catalog) */}
        <Modal
          visible={selectionsVisible}
          onDismiss={() => setSelectionsVisible(false)}
          contentContainerStyle={[styles.modal, { backgroundColor: theme.colors.surface }]}
        >
          <View style={{ flexDirection, alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <Text variant="titleMedium" style={{ color: theme.colors.onSurface }}>
              {isRTL ? 'פניות מהקטלוג' : 'Catalog inquiries'}
            </Text>
            <IconButton icon="refresh" size={20} onPress={loadSelections} iconColor={theme.colors.onSurfaceVariant} />
          </View>

          {/* Search by name/phone + sort (default: date, or by total) */}
          {selections.length > 0 && (
            <>
              <RNTextInput
                value={selectionSearch}
                onChangeText={setSelectionSearch}
                placeholder={isRTL ? 'חיפוש לפי שם או טלפון...' : 'Search by name or phone...'}
                placeholderTextColor={theme.colors.onSurfaceVariant}
                style={[styles.filterInput, { color: theme.colors.onSurface, borderColor: theme.colors.outlineVariant, textAlign, marginBottom: 8 }]}
              />
              <View style={{ flexDirection: 'row', gap: 6, marginBottom: 8 }}>
                {([['date', isRTL ? 'תאריך' : 'Date'], ['price', isRTL ? 'סכום' : 'Total']] as const).map(([key, label]) => (
                  <Chip
                    key={key}
                    selected={selectionSort === key}
                    onPress={() => setSelectionSort(key)}
                    style={selectionSort === key ? { backgroundColor: BRAND_COLOR + '20' } : undefined}
                    textStyle={selectionSort === key ? { color: BRAND_COLOR } : undefined}
                    icon={selectionSort === key ? 'sort' : undefined}
                  >
                    {label}
                  </Chip>
                ))}
              </View>
            </>
          )}

          {selectionsLoading ? (
            <View style={{ paddingVertical: 30 }}>
              <ActivityIndicator color={BRAND_COLOR} />
            </View>
          ) : selections.length === 0 ? (
            <View style={{ paddingVertical: 30, alignItems: 'center' }}>
              <MaterialCommunityIcons name="inbox-outline" size={48} color={theme.colors.onSurfaceVariant} style={{ opacity: 0.4 }} />
              <Text style={{ color: theme.colors.onSurfaceVariant, marginTop: 8 }}>
                {isRTL ? 'אין עדיין פניות מהקטלוג' : 'No catalog inquiries yet'}
              </Text>
            </View>
          ) : filteredSortedSelections.length === 0 ? (
            <View style={{ paddingVertical: 30, alignItems: 'center' }}>
              <MaterialCommunityIcons name="magnify-close" size={48} color={theme.colors.onSurfaceVariant} style={{ opacity: 0.4 }} />
              <Text style={{ color: theme.colors.onSurfaceVariant, marginTop: 8 }}>
                {isRTL ? 'לא נמצאו פניות' : 'No matching inquiries'}
              </Text>
            </View>
          ) : (
            <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
              {filteredSortedSelections.map((sel) => (
                <Pressable
                  key={sel.id}
                  onPress={() => openSelectionLink(sel)}
                  style={[styles.selCard, { borderColor: theme.colors.outlineVariant }]}
                >
                  <View style={{ flexDirection, justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text variant="titleSmall" style={{ color: theme.colors.onSurface }}>
                      {sel.contactName || (isRTL ? 'ללא שם' : 'No name')}
                    </Text>
                    <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                      {fmtSelDate(sel.createdAt)}
                    </Text>
                  </View>
                  {sel.contactPhone ? (
                    <Text style={{ color: theme.colors.onSurfaceVariant, marginTop: 2, writingDirection: 'ltr' }}>{sel.contactPhone}</Text>
                  ) : null}
                  <Text style={{ color: theme.colors.onSurfaceVariant, marginTop: 4 }} numberOfLines={2}>
                    🛍️ {selItemsSummary(sel)}
                  </Text>
                  {sel.note ? (
                    <Text style={{ color: theme.colors.onSurfaceVariant, marginTop: 4, fontStyle: 'italic' }} numberOfLines={2}>
                      📝 {sel.note}
                    </Text>
                  ) : null}
                  <View style={{ flexDirection, justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
                    <View style={[styles.purposeBadge, { backgroundColor: BRAND_COLOR + '18' }]}>
                      <Text variant="labelSmall" style={{ color: BRAND_COLOR }}>
                        {purposeLabel(sel.purpose)}{sel.total ? ` · ₪${Number(sel.total).toLocaleString()}` : ''}
                      </Text>
                    </View>
                    <Text variant="labelSmall" style={{ color: BRAND_COLOR }}>
                      {isRTL ? 'צפה בבחירה ›' : 'View ›'}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </ScrollView>
          )}

          <Button
            mode="text"
            onPress={() => setSelectionsVisible(false)}
            textColor={theme.colors.onSurfaceVariant}
            style={{ marginTop: 8 }}
          >
            {isRTL ? 'סגור' : 'Close'}
          </Button>
        </Modal>
      </Portal>

      {/* Full-screen image viewer (lightbox) with left/right navigation */}
      {viewerVisible && viewerImages.length > 0 && (
        <RNModal visible animationType="fade" transparent onRequestClose={() => setViewerVisible(false)}>
          <View style={styles.viewerOverlay}>
            <View style={styles.viewerHeader}>
              <IconButton icon="close" size={28} iconColor="#fff" onPress={() => setViewerVisible(false)} />
              {viewerImages.length > 1 && (
                <Text style={styles.viewerCounter}>{viewerIndex + 1} / {viewerImages.length}</Text>
              )}
              <View style={{ width: 48 }} />
            </View>
            <View style={styles.viewerContent}>
              {viewerIndex > 0 && (
                <Pressable style={[styles.viewerNavBtn, { left: 8 }]} onPress={() => setViewerIndex((i) => i - 1)}>
                  <MaterialCommunityIcons name="chevron-left" size={40} color="#fff" />
                </Pressable>
              )}
              {viewerIndex < viewerImages.length - 1 && (
                <Pressable style={[styles.viewerNavBtn, { right: 8 }]} onPress={() => setViewerIndex((i) => i + 1)}>
                  <MaterialCommunityIcons name="chevron-right" size={40} color="#fff" />
                </Pressable>
              )}
              <Image source={{ uri: viewerImages[viewerIndex] }} style={styles.viewerImage} contentFit="contain" />
            </View>
            {viewerImages.length > 1 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.viewerThumbs} contentContainerStyle={{ gap: 6, paddingHorizontal: 12 }}>
                {viewerImages.map((img, idx) => (
                  <Pressable key={`${img}_${idx}`} onPress={() => setViewerIndex(idx)}>
                    <Image
                      source={{ uri: img }}
                      style={[styles.viewerThumb, idx === viewerIndex && { borderColor: '#fff', borderWidth: 2 }]}
                      contentFit="cover"
                    />
                  </Pressable>
                ))}
              </ScrollView>
            )}
          </View>
        </RNModal>
      )}

      {/* Date-range filter picker (per-column 'date' filterType) */}
      {datePickerFor && (
        <GambotDateTimePicker
          visible
          mode="date"
          value={colFilters[datePickerFor.key]?.[datePickerFor.edge] || null}
          allowClear
          onConfirm={(d) => {
            const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            setColFilters((p) => ({ ...p, [datePickerFor.key]: { ...(p[datePickerFor.key] || {}), [datePickerFor.edge]: iso } }));
            setDatePickerFor(null);
          }}
          onClear={() => {
            setColFilters((p) => ({ ...p, [datePickerFor.key]: { ...(p[datePickerFor.key] || {}), [datePickerFor.edge]: '' } }));
            setDatePickerFor(null);
          }}
          onDismiss={() => setDatePickerFor(null)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '700', color: '#fff' },
  searchRow: { paddingHorizontal: 12, paddingVertical: 8 },
  searchbar: { borderRadius: 10, elevation: 0 },
  filtersPanel: { paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  filterInput: { flex: 1, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14 },
  chipsRow: { paddingHorizontal: 12, paddingVertical: 8, gap: 6 },
  chip: { marginEnd: 4 },
  statsBar: { paddingHorizontal: 16, paddingVertical: 6, alignItems: 'center', justifyContent: 'space-between' },
  list: { paddingHorizontal: 12, paddingBottom: 100 },
  emptyList: { flex: 1 },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80 },
  card: {
    marginBottom: 8,
    borderRadius: 12,
    padding: 12,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
  },
  cardRow: { alignItems: 'center' },
  cardImage: { width: 56, height: 56, borderRadius: 8 },
  cardImagePlaceholder: { width: 56, height: 56, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  imageCountBadge: { position: 'absolute', bottom: 2, right: 2, flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 8, paddingHorizontal: 4, paddingVertical: 1, gap: 2 },
  imageCountText: { color: '#fff', fontSize: 9, fontWeight: '700' },
  formThumbWrap: { width: 96, height: 96, borderRadius: 10, overflow: 'hidden', position: 'relative', backgroundColor: 'rgba(0,0,0,0.05)' },
  formThumb: { width: 96, height: 96, borderRadius: 10 },
  formThumbMainBadge: { position: 'absolute', top: 4, left: 4, backgroundColor: BRAND_COLOR, borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1 },
  formThumbRemove: { position: 'absolute', top: -6, right: -6, backgroundColor: 'white', margin: 0 },
  formThumbMoveRow: { position: 'absolute', bottom: 2, left: 2, right: 2, flexDirection: 'row', justifyContent: 'space-between' },
  formThumbMoveBtn: { backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 10, width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  viewerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)' },
  viewerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 40, paddingHorizontal: 8 },
  viewerCounter: { color: '#fff', fontSize: 15, fontWeight: '600' },
  viewerContent: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  viewerImage: { width: '100%', height: '100%' },
  viewerNavBtn: { position: 'absolute', top: '45%', zIndex: 2, backgroundColor: 'rgba(0,0,0,0.4)', borderRadius: 24, padding: 4 },
  viewerThumbs: { flexGrow: 0, paddingVertical: 12 },
  viewerThumb: { width: 56, height: 56, borderRadius: 8, opacity: 0.85 },
  cardContent: { flex: 1, marginHorizontal: 12 },
  cardMeta: { marginTop: 4, alignItems: 'center', flexWrap: 'wrap' },
  categoryBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  customBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, marginEnd: 4, marginTop: 2 },
  fab: { position: 'absolute', bottom: 24, right: 16, borderRadius: 16 },
  modal: { marginHorizontal: 16, borderRadius: 16, padding: 20, maxHeight: '85%' },
  // Taller variant for the personal-link sheet so the whole form (incl. "Create link") fits
  // without scrolling on most devices.
  modalTall: { maxHeight: '92%', padding: 18 },
  modalTitle: { fontSize: 18, fontWeight: '700', marginBottom: 16 },
  input: { marginBottom: 12 },
  formRow: { gap: 0 },
  modalActions: { marginTop: 8, gap: 10, justifyContent: 'flex-end' },
  actionBtn: { borderRadius: 8 },
  publicBadge: { position: 'absolute', top: 6, flexDirection: 'row', alignItems: 'center', backgroundColor: BRAND_COLOR, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2, gap: 3 },
  publicBadgeText: { color: '#fff', fontSize: 9, fontWeight: '700' },
  publicToggleRow: { alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 4, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, marginBottom: 8 },
  shareModeRow: { alignItems: 'center', borderWidth: 1.5, borderRadius: 10, padding: 12, marginBottom: 8 },
  shareModeRowCompact: { alignItems: 'center', borderWidth: 1.5, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12, marginBottom: 6 },
  selectionBar: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, elevation: 8 },
  selCard: { borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 10 },
  purposeBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
});
