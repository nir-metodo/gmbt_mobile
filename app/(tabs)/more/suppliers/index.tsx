import React, { useState, useCallback, useEffect, useMemo } from 'react';
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
  Linking,
} from 'react-native';
import {
  Text,
  Searchbar,
  ActivityIndicator,
  Appbar,
  FAB,
  Portal,
  Modal,
  TextInput,
  Button,
  IconButton,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../../../stores/authStore';
import { useAppTheme } from '../../../../hooks/useAppTheme';
import { useRTL } from '../../../../hooks/useRTL';
import { suppliersApi, Supplier } from '../../../../services/api/suppliers';
import { borderRadius } from '../../../../constants/theme';
import { appCache } from '../../../../services/cache';

const BRAND_COLOR = '#7C3AED';

export default function SuppliersScreen() {
  const insets = useSafeAreaInsets();
  const theme = useAppTheme();
  const { isRTL, flexDirection, textAlign } = useRTL();
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);

  const CACHE_KEY = `suppliers_${user?.organization}`;

  const [suppliers, setSuppliers] = useState<Supplier[]>(() => appCache.get<Supplier[]>(CACHE_KEY) ?? []);
  const [loading, setLoading] = useState(!appCache.get<Supplier[]>(CACHE_KEY));
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchVisible, setSearchVisible] = useState(false);

  const [modalVisible, setModalVisible] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [saving, setSaving] = useState(false);

  const [formName, setFormName] = useState('');
  const [formContactPerson, setFormContactPerson] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formAddress, setFormAddress] = useState('');
  const [formWebsite, setFormWebsite] = useState('');
  const [formNotes, setFormNotes] = useState('');

  const fetchSuppliers = useCallback(async () => {
    if (!user?.organization) { setLoading(false); return; }
    try {
      setError(null);
      const data = await suppliersApi.getAll(user.organization);
      appCache.set(CACHE_KEY, data);
      setSuppliers(data);
    } catch (err: any) {
      setError(err.message || t('errors.generic'));
    } finally {
      setLoading(false);
    }
  }, [user?.organization, t, CACHE_KEY]);

  useEffect(() => { fetchSuppliers(); }, [fetchSuppliers]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchSuppliers();
    setRefreshing(false);
  }, [fetchSuppliers]);

  const filteredSuppliers = useMemo(() => {
    if (!searchQuery.trim()) return suppliers;
    const q = searchQuery.toLowerCase();
    return suppliers.filter(
      (s) =>
        s.name?.toLowerCase().includes(q) ||
        s.contactPerson?.toLowerCase().includes(q) ||
        s.phone?.includes(q) ||
        s.email?.toLowerCase().includes(q)
    );
  }, [suppliers, searchQuery]);

  const resetForm = () => {
    setFormName(''); setFormContactPerson(''); setFormPhone('');
    setFormEmail(''); setFormAddress(''); setFormWebsite(''); setFormNotes('');
    setEditingSupplier(null);
  };

  const openCreate = () => {
    resetForm();
    setModalVisible(true);
  };

  const openEdit = (supplier: Supplier) => {
    setEditingSupplier(supplier);
    setFormName(supplier.name || '');
    setFormContactPerson(supplier.contactPerson || '');
    setFormPhone(supplier.phone || '');
    setFormEmail(supplier.email || '');
    setFormAddress(supplier.address || '');
    setFormWebsite(supplier.website || '');
    setFormNotes(supplier.notes || '');
    setModalVisible(true);
  };

  const handleSave = async () => {
    if (!formName.trim()) {
      Alert.alert(t('common.error'), t('common.required'));
      return;
    }
    setSaving(true);
    try {
      const payload: Partial<Supplier> = {
        name: formName.trim(),
        contactPerson: formContactPerson.trim() || undefined,
        phone: formPhone.trim() || undefined,
        email: formEmail.trim() || undefined,
        address: formAddress.trim() || undefined,
        website: formWebsite.trim() || undefined,
        notes: formNotes.trim() || undefined,
      };
      if (editingSupplier) {
        await suppliersApi.update(user!.organization, editingSupplier.id, payload);
      } else {
        await suppliersApi.create(user!.organization, payload);
      }
      setModalVisible(false);
      resetForm();
      fetchSuppliers();
    } catch (err: any) {
      Alert.alert(t('common.error'), err.message || t('errors.generic'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (supplier: Supplier) => {
    Alert.alert(
      t('common.confirm'),
      `${t('common.delete')} ${supplier.name}?`,
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              await suppliersApi.delete(user!.organization, supplier.id);
              fetchSuppliers();
            } catch (err: any) {
              Alert.alert(t('common.error'), err.message || t('errors.generic'));
            }
          },
        },
      ]
    );
  };

  const renderSupplier = useCallback(({ item }: { item: Supplier }) => (
    <Pressable
      style={[styles.card, { backgroundColor: theme.colors.surface }]}
      onPress={() => openEdit(item)}
    >
      <View style={[styles.cardHeader, { flexDirection }]}>
        <View style={styles.cardIcon}>
          <MaterialCommunityIcons name="store-outline" size={24} color={BRAND_COLOR} />
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="titleSmall" style={{ textAlign, fontWeight: '600' }}>{item.name}</Text>
          {item.contactPerson ? (
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, textAlign }}>
              {item.contactPerson}
            </Text>
          ) : null}
        </View>
        <IconButton icon="delete-outline" size={20} onPress={() => handleDelete(item)} iconColor="#F44336" />
      </View>
      {(item.phone || item.email) && (
        <View style={[styles.cardDetails, { flexDirection }]}>
          {item.phone ? (
            <Pressable onPress={() => Linking.openURL(`tel:${item.phone}`)} style={[styles.detailChip, { flexDirection }]}>
              <MaterialCommunityIcons name="phone-outline" size={14} color={theme.colors.onSurfaceVariant} />
              <Text variant="bodySmall" style={{ marginHorizontal: 4, color: theme.colors.primary }}>{item.phone}</Text>
            </Pressable>
          ) : null}
          {item.email ? (
            <Pressable onPress={() => Linking.openURL(`mailto:${item.email}`)} style={[styles.detailChip, { flexDirection }]}>
              <MaterialCommunityIcons name="email-outline" size={14} color={theme.colors.onSurfaceVariant} />
              <Text variant="bodySmall" style={{ marginHorizontal: 4, color: theme.colors.primary }}>{item.email}</Text>
            </Pressable>
          ) : null}
        </View>
      )}
    </Pressable>
  ), [theme, flexDirection, textAlign, t]);

  if (loading && suppliers.length === 0) {
    return (
      <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
        <Appbar.Header style={{ backgroundColor: BRAND_COLOR }} mode="center-aligned">
          <Appbar.Content title={t('more.suppliers')} titleStyle={styles.headerTitle} />
        </Appbar.Header>
        <View style={styles.centered}><ActivityIndicator size="large" color={BRAND_COLOR} /></View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Appbar.Header style={{ backgroundColor: BRAND_COLOR }} mode="center-aligned">
        {searchVisible ? (
          <Searchbar
            placeholder={t('common.search')}
            value={searchQuery}
            onChangeText={setSearchQuery}
            style={styles.searchBar}
            autoFocus
            onIconPress={() => { setSearchVisible(false); setSearchQuery(''); }}
          />
        ) : (
          <>
            <Appbar.Content title={t('more.suppliers')} titleStyle={styles.headerTitle} />
            <Appbar.Action icon="magnify" color="#fff" onPress={() => setSearchVisible(true)} />
          </>
        )}
      </Appbar.Header>

      {error ? (
        <View style={styles.centered}>
          <Text style={{ color: '#F44336', marginBottom: 12 }}>{error}</Text>
          <Button mode="outlined" onPress={fetchSuppliers}>{t('common.retry')}</Button>
        </View>
      ) : (
        <FlatList
          data={filteredSuppliers}
          keyExtractor={(item) => item.id}
          renderItem={renderSupplier}
          contentContainerStyle={{ padding: 16, paddingBottom: 80 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[BRAND_COLOR]} />}
          ListEmptyComponent={
            <View style={styles.centered}>
              <MaterialCommunityIcons name="store-off-outline" size={48} color={theme.colors.onSurfaceVariant} />
              <Text style={{ marginTop: 12, color: theme.colors.onSurfaceVariant }}>{t('common.noResults')}</Text>
            </View>
          }
        />
      )}

      <FAB icon="plus" style={[styles.fab, { bottom: insets.bottom + 16 }]} color="#fff" onPress={openCreate} />

      <Portal>
        <Modal visible={modalVisible} onDismiss={() => setModalVisible(false)} contentContainerStyle={[styles.modal, { backgroundColor: theme.colors.surface }]}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScrollView>
              <Text variant="titleMedium" style={{ textAlign, marginBottom: 16, fontWeight: '700' }}>
                {editingSupplier ? t('common.edit') : t('common.add')} {t('more.suppliers')}
              </Text>
              <TextInput
                label={t('common.name') || 'Name'}
                value={formName}
                onChangeText={setFormName}
                mode="outlined"
                style={styles.input}
              />
              <TextInput
                label={t('suppliers.contactPerson') || 'Contact Person'}
                value={formContactPerson}
                onChangeText={setFormContactPerson}
                mode="outlined"
                style={styles.input}
              />
              <TextInput
                label={t('common.phone') || 'Phone'}
                value={formPhone}
                onChangeText={setFormPhone}
                mode="outlined"
                keyboardType="phone-pad"
                style={styles.input}
              />
              <TextInput
                label={t('common.email') || 'Email'}
                value={formEmail}
                onChangeText={setFormEmail}
                mode="outlined"
                keyboardType="email-address"
                style={styles.input}
              />
              <TextInput
                label={t('suppliers.address') || 'Address'}
                value={formAddress}
                onChangeText={setFormAddress}
                mode="outlined"
                style={styles.input}
              />
              <TextInput
                label={t('suppliers.website') || 'Website'}
                value={formWebsite}
                onChangeText={setFormWebsite}
                mode="outlined"
                keyboardType="url"
                style={styles.input}
              />
              <TextInput
                label={t('suppliers.notes') || 'Notes'}
                value={formNotes}
                onChangeText={setFormNotes}
                mode="outlined"
                multiline
                numberOfLines={3}
                style={styles.input}
              />
              <View style={[{ flexDirection }, styles.modalActions]}>
                <Button mode="outlined" onPress={() => setModalVisible(false)} style={{ flex: 1, marginEnd: 8 }}>
                  {t('common.cancel')}
                </Button>
                <Button mode="contained" onPress={handleSave} loading={saving} disabled={saving} style={{ flex: 1 }} buttonColor={BRAND_COLOR}>
                  {t('common.save')}
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
  headerTitle: { color: '#fff', fontWeight: '700', fontSize: 18 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  searchBar: { flex: 1, marginHorizontal: 8, height: 40 },
  card: {
    borderRadius: borderRadius.md,
    padding: 16,
    marginBottom: 12,
    elevation: 1,
  },
  cardHeader: { alignItems: 'center', gap: 12 },
  cardIcon: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: BRAND_COLOR + '15',
    justifyContent: 'center', alignItems: 'center',
  },
  cardDetails: { marginTop: 8, gap: 12, flexWrap: 'wrap' },
  detailChip: { alignItems: 'center', gap: 2 },
  fab: { position: 'absolute', right: 16, backgroundColor: BRAND_COLOR },
  modal: { margin: 24, padding: 24, borderRadius: borderRadius.lg, maxHeight: '80%' },
  input: { marginBottom: 12 },
  modalActions: { marginTop: 16, gap: 8 },
});
