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
  Linking,
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
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../../../stores/authStore';
import { useAppTheme } from '../../../../hooks/useAppTheme';
import { useRTL } from '../../../../hooks/useRTL';
import { catalogApi, CatalogItem, CatalogCustomColumn, CatalogFieldsConfig, CatalogSelection } from '../../../../services/api/catalog';
import { useDebouncedValue, useWindowedList } from '../../../../hooks/useWindowedList';
import { ListPaginationFooter } from '../../../../components/ListPaginationFooter';
import { appCache } from '../../../../services/cache';
import axiosInstance from '../../../../services/api/axiosInstance';
import { ENDPOINTS, WEB_APP_BASE_URL } from '../../../../constants/api';

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

  // Public catalog sharing + customer selections
  const [sharing, setSharing] = useState(false);
  const [selectionsVisible, setSelectionsVisible] = useState(false);
  const [selections, setSelections] = useState<CatalogSelection[]>([]);
  const [selectionsLoading, setSelectionsLoading] = useState(false);

  // Form modal
  const [modalVisible, setModalVisible] = useState(false);
  const [editingItem, setEditingItem] = useState<CatalogItem | null>(null);
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formPrice, setFormPrice] = useState('');
  const [formSku, setFormSku] = useState('');
  const [formCategory, setFormCategory] = useState('');
  const [formLink, setFormLink] = useState('');
  const [formImageUrl, setFormImageUrl] = useState('');
  const [formCustomFields, setFormCustomFields] = useState<Record<string, any>>({});
  const [uploading, setUploading] = useState(false);

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

  const setCustomField = useCallback((key: string, value: any) => {
    setFormCustomFields((p) => ({ ...p, [key]: value }));
  }, []);

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
        result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
      }
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      setUploading(true);
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
      const url = files[0]?.url || res.data?.Url || res.data?.url || res.data?.MediaUrl || '';
      if (url) {
        setFormImageUrl(url);
      } else {
        Alert.alert(t('common.error'), isRTL ? 'שגיאה בהעלאה - לא התקבל קישור' : 'Upload failed - no URL received');
      }
    } catch (err: any) {
      Alert.alert(t('common.error'), err?.message || (isRTL ? 'שגיאה בהעלאת התמונה' : 'Image upload failed'));
    } finally {
      setUploading(false);
    }
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

  // Opens the full read-only selection page (the same view the seller gets via the WhatsApp link).
  const openSelectionLink = useCallback((sel: CatalogSelection) => {
    if (!user?.organization) return;
    const url = `${WEB_APP_BASE_URL}/catalog/${encodeURIComponent(user.organization)}/r/${sel.id}`;
    Linking.openURL(url).catch(() => {});
  }, [user?.organization]);

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

  const categories = useMemo(() => {
    const cats = new Set<string>();
    items.forEach((item) => {
      if (item.category) cats.add(item.category);
    });
    return ['all', ...Array.from(cats).sort()];
  }, [items]);

  // Debounce search so the list re-filters once typing pauses (no per-keystroke flicker).
  const debouncedSearch = useDebouncedValue(searchQuery, 350);

  const filteredItems = useMemo(() => {
    let result = items;
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
  }, [items, categoryFilter, debouncedSearch, fieldsConfig, customColumns]);

  // Client-side pagination over the filtered list (search still spans everything).
  const { visible: visibleItems, hasMore: itemsHasMore, loadMore: itemsLoadMore, loadAll: itemsLoadAll, count: itemsCount } = useWindowedList(filteredItems, {
    pageSize: 30,
    resetKey: `${categoryFilter}|${debouncedSearch}`,
  });

  const resetForm = useCallback(() => {
    setFormName('');
    setFormDescription('');
    setFormPrice('');
    setFormSku('');
    setFormCategory('');
    setFormLink('');
    setFormImageUrl('');
    setFormCustomFields({});
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
    setFormImageUrl(item.images?.[0] || '');
    setFormCustomFields(item.customFields || {});
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
        // Empty => persist an empty array (image was removed). Falling back to the old images
        // here would silently re-save a deleted image, so the removal never "sticks".
        images: formImageUrl.trim() ? [formImageUrl.trim()] : [],
        // Merge so any keys not surfaced as columns on this device are preserved.
        customFields: { ...(editingItem?.customFields || {}), ...formCustomFields },
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
  }, [formName, formDescription, formPrice, formSku, formCategory, formLink, formImageUrl, formCustomFields, editingItem, items, customColumns, user?.organization, resetForm, fieldsConfig, isRTL]);

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
    return (
      <Pressable
        style={[styles.card, { backgroundColor: theme.colors.surface }]}
        onPress={() => openEditModal(item)}
        onLongPress={() => handleDelete(item)}
      >
        <View style={[styles.cardRow, { flexDirection }]}>
          {hasImage ? (
            <Image source={{ uri: item.images[0] }} style={styles.cardImage} contentFit="cover" />
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
            <View style={[styles.cardMeta, { flexDirection }]}>
              {item.unitPrice > 0 && (
                <Text variant="labelMedium" style={{ color: BRAND_COLOR, fontWeight: '700' }}>
                  ₪{item.unitPrice.toLocaleString()}
                </Text>
              )}
              {item.sku ? (
                <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant, marginHorizontal: 8 }}>
                  {item.sku}
                </Text>
              ) : null}
              {item.category ? (
                <View style={[styles.categoryBadge, { backgroundColor: BRAND_COLOR + '18' }]}>
                  <Text variant="labelSmall" style={{ color: BRAND_COLOR, fontSize: 10 }}>
                    {item.category}
                  </Text>
                </View>
              ) : null}
            </View>
            {/* Custom column values (shows the columns added in the web Catalog settings,
                in the display order configured there). */}
            {orderedCustomColumns.length > 0 && (() => {
              const filled = orderedCustomColumns
                .filter((c) => c.key !== titleKey)
                .map((c) => ({ label: c.label, val: cf[c.key] }))
                .filter((x) => hasVal(x.val));
              if (!filled.length) return null;
              return (
                <View style={[styles.cardMeta, { flexDirection, flexWrap: 'wrap' }]}>
                  {filled.slice(0, 4).map((x, i) => (
                    <View key={i} style={[styles.customBadge, { backgroundColor: theme.colors.onSurfaceVariant + '14' }]}>
                      <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant, fontSize: 10 }}>
                        {x.label}: {formatCustomValue(x.val, isRTL)}
                      </Text>
                    </View>
                  ))}
                </View>
              );
            })()}
          </View>
          <IconButton
            icon="pencil-outline"
            size={18}
            iconColor={theme.colors.onSurfaceVariant}
            onPress={() => openEditModal(item)}
          />
        </View>
      </Pressable>
    );
  }, [theme, flexDirection, textAlign, openEditModal, handleDelete, customColumns, orderedCustomColumns, isRTL, fieldsConfig]);

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
        <Appbar.Action icon="inbox-arrow-down" color="#fff" onPress={openSelections} />
        <Appbar.Action icon={sharing ? 'loading' : 'share-variant'} color="#fff" disabled={sharing} onPress={handleShareCatalog} />
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

      {/* FAB */}
      <FAB
        icon="plus"
        style={[styles.fab, { backgroundColor: BRAND_COLOR }]}
        color="#fff"
        onPress={openAddModal}
      />

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

              <TextInput
                label={isRTL ? 'קישור לתמונה' : 'Image URL'}
                value={formImageUrl}
                onChangeText={setFormImageUrl}
                mode="outlined"
                style={styles.input}
                keyboardType="url"
                autoCapitalize="none"
                outlineColor={BRAND_COLOR + '40'}
                activeOutlineColor={BRAND_COLOR}
              />

              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
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
                  icon="image"
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

              {formImageUrl.trim() ? (
                <View style={{ position: 'relative', marginBottom: 12 }}>
                  <Image source={{ uri: formImageUrl.trim() }} style={styles.previewImage} contentFit="cover" />
                  <IconButton
                    icon="close-circle"
                    size={22}
                    iconColor="#ef4444"
                    style={{ position: 'absolute', top: -4, right: -4, backgroundColor: 'white' }}
                    onPress={() => setFormImageUrl('')}
                  />
                </View>
              ) : null}

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
          ) : (
            <ScrollView style={{ maxHeight: 460 }} showsVerticalScrollIndicator={false}>
              {selections.map((sel) => (
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '700', color: '#fff' },
  searchRow: { paddingHorizontal: 12, paddingVertical: 8 },
  searchbar: { borderRadius: 10, elevation: 0 },
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
  cardContent: { flex: 1, marginHorizontal: 12 },
  cardMeta: { marginTop: 4, alignItems: 'center', flexWrap: 'wrap' },
  categoryBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  customBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, marginEnd: 4, marginTop: 2 },
  fab: { position: 'absolute', bottom: 24, right: 16, borderRadius: 16 },
  modal: { marginHorizontal: 16, borderRadius: 16, padding: 20, maxHeight: '85%' },
  modalTitle: { fontSize: 18, fontWeight: '700', marginBottom: 16 },
  input: { marginBottom: 12 },
  formRow: { gap: 0 },
  previewImage: { width: '100%', height: 140, borderRadius: 10, marginBottom: 12 },
  modalActions: { marginTop: 8, gap: 10, justifyContent: 'flex-end' },
  actionBtn: { borderRadius: 8 },
  selCard: { borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 10 },
  purposeBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
});
