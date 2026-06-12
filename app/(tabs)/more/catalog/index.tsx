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
import { catalogApi, CatalogItem, CatalogCustomColumn, CatalogFieldsConfig } from '../../../../services/api/catalog';
import { appCache } from '../../../../services/cache';
import axiosInstance from '../../../../services/api/axiosInstance';
import { ENDPOINTS } from '../../../../constants/api';

const BRAND_COLOR = '#059669';

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export default function CatalogScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useAppTheme();
  const { isRTL, flexDirection, textAlign } = useRTL();
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);

  const CACHE_KEY = `catalog_${user?.organization}`;

  const [items, setItems] = useState<CatalogItem[]>(() => appCache.get<CatalogItem[]>(CACHE_KEY) ?? []);
  const [customColumns, setCustomColumns] = useState<CatalogCustomColumn[]>([]);
  const [fieldsConfig, setFieldsConfig] = useState<CatalogFieldsConfig>({ description: true, unitPrice: true, sku: true, category: true, link: true });
  const [loading, setLoading] = useState(!appCache.get<CatalogItem[]>(CACHE_KEY));
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchVisible, setSearchVisible] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [saving, setSaving] = useState(false);

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
  const [uploading, setUploading] = useState(false);

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
      if (data.catalogFieldsConfig) setFieldsConfig(prev => ({ ...prev, ...data.catalogFieldsConfig }));
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

  const categories = useMemo(() => {
    const cats = new Set<string>();
    items.forEach((item) => {
      if (item.category) cats.add(item.category);
    });
    return ['all', ...Array.from(cats).sort()];
  }, [items]);

  const filteredItems = useMemo(() => {
    let result = items;
    if (categoryFilter !== 'all') {
      result = result.filter((i) => i.category === categoryFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
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
  }, [items, categoryFilter, searchQuery, fieldsConfig, customColumns]);

  const resetForm = useCallback(() => {
    setFormName('');
    setFormDescription('');
    setFormPrice('');
    setFormSku('');
    setFormCategory('');
    setFormLink('');
    setFormImageUrl('');
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
        images: formImageUrl.trim() ? [formImageUrl.trim()] : (editingItem?.images || []),
        customFields: editingItem?.customFields || {},
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
  }, [formName, formDescription, formPrice, formSku, formCategory, formLink, formImageUrl, editingItem, items, customColumns, user?.organization, resetForm, fieldsConfig, isRTL]);

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
              const updated = await catalogApi.deleteItem(user.organization, item.id, items, customColumns);
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
              {item.name || item.sku || item.category || '—'}
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
  }, [theme, flexDirection, textAlign, openEditModal, handleDelete]);

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
        data={filteredItems}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={[styles.list, filteredItems.length === 0 && styles.emptyList]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[BRAND_COLOR]} />}
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
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
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
  fab: { position: 'absolute', bottom: 24, right: 16, borderRadius: 16 },
  modal: { marginHorizontal: 16, borderRadius: 16, padding: 20, maxHeight: '85%' },
  modalTitle: { fontSize: 18, fontWeight: '700', marginBottom: 16 },
  input: { marginBottom: 12 },
  formRow: { gap: 0 },
  previewImage: { width: '100%', height: 140, borderRadius: 10, marginBottom: 12 },
  modalActions: { marginTop: 8, gap: 10, justifyContent: 'flex-end' },
  actionBtn: { borderRadius: 8 },
});
