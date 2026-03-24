import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  FlatList,
  StyleSheet,
  RefreshControl,
  Pressable,
  LayoutAnimation,
  Platform,
  UIManager,
  ScrollView,
  KeyboardAvoidingView,
} from 'react-native';
import {
  Appbar,
  Surface,
  Text,
  Avatar,
  Chip,
  FAB,
  Portal,
  Modal,
  Dialog,
  Button,
  TextInput,
  Switch,
  Divider,
  ActivityIndicator,
  IconButton,
  Searchbar,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { usersApi } from '../../../../services/api/users';
import { useAppTheme } from '../../../../hooks/useAppTheme';
import { useRTL } from '../../../../hooks/useRTL';
import { useAuthStore } from '../../../../stores/authStore';
import { OrgUser } from '../../../../types';
import { getInitials } from '../../../../utils/formatters';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const BRAND_COLOR = '#2e6155';

type UserRole = 'Admin' | 'Chat' | 'Basic' | 'Custom';

const ROLE_CONFIG: Record<UserRole, { color: string; icon: string }> = {
  Admin: { color: '#E63946', icon: 'shield-crown' },
  Chat: { color: '#2A9D8F', icon: 'chat' },
  Basic: { color: '#6C757D', icon: 'account' },
  Custom: { color: '#7B2D8E', icon: 'tune-variant' },
};

const PERMISSION_KEYS = [
  'chats',
  'phoneCalls',
  'contacts',
  'leads',
  'tasks',
  'cases',
  'quotes',
  'esignature',
  'mediaManager',
  'reports',
  'dashboard',
  'users',
  'settings',
] as const;

const DATA_VISIBILITY_KEYS = [
  'chats',
  'phoneCalls',
  'contacts',
  'leads',
  'tasks',
  'quotes',
  'cases',
  'reports',
  'mediaManager',
] as const;

const LANGUAGE_OPTIONS = ['en', 'he'] as const;
const TIMEZONE_OPTIONS = ['UTC', 'Asia/Jerusalem', 'America/New_York', 'Europe/London'] as const;

const EMPTY_USER: Omit<OrgUser, 'id'> = {
  userName: '',
  email: '',
  phoneNumber: '',
  securityRole: 'Basic',
  permissions: {},
  dataVisibility: {},
  isActive: true,
  language: 'en',
  timeZone: 'UTC',
};

export default function UsersScreen() {
  const theme = useAppTheme();
  const { isRTL, textAlign } = useRTL();
  const { t } = useTranslation();
  const router = useRouter();

  const [users, setUsers] = useState<OrgUser[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingUser, setEditingUser] = useState<Partial<OrgUser> | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<OrgUser | null>(null);
  const [saving, setSaving] = useState(false);

  const organization = useAuthStore((s) => s.user?.organization || '');

  const filteredUsers = useMemo(() => {
    if (!searchQuery.trim()) return users;
    const q = searchQuery.toLowerCase();
    return users.filter(
      (u) =>
        (u.userName || '').toLowerCase().includes(q) ||
        (u.email || '').toLowerCase().includes(q),
    );
  }, [users, searchQuery]);

  const fetchUsers = useCallback(async () => {
    try {
      const data = await usersApi.getAll(organization);
      setUsers(data);
    } catch {
      // error handled by empty state UI
    }
  }, [organization]);

  const loadData = useCallback(async () => {
    setLoading(true);
    await fetchUsers();
    setLoading(false);
  }, [fetchUsers]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchUsers();
    setRefreshing(false);
  }, [fetchUsers]);

  const openAddUser = useCallback(() => {
    setEditingUser({ ...EMPTY_USER });
    setModalVisible(true);
  }, []);

  const openEditUser = useCallback((user: OrgUser) => {
    setEditingUser({ ...user });
    setModalVisible(true);
  }, []);

  const handleSaveUser = useCallback(async () => {
    if (!editingUser) return;
    setSaving(true);
    try {
      if (editingUser.id) {
        const updated = await usersApi.update(organization, editingUser);
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setUsers((prev) => prev.map((u) => (u.id === editingUser.id ? updated : u)));
      } else {
        const created = await usersApi.create(organization, { ...editingUser, password: '' } as any);
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setUsers((prev) => [...prev, created]);
      }
      setModalVisible(false);
      setEditingUser(null);
    } catch {
      // save failed — user will see no change
    } finally {
      setSaving(false);
    }
  }, [editingUser, organization]);

  const handleDeleteUser = useCallback(async () => {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      await usersApi.delete(organization, deleteTarget.id);
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setUsers((prev) => prev.filter((u) => u.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch {
      // delete failed
    } finally {
      setSaving(false);
    }
  }, [deleteTarget, organization]);

  const updateField = useCallback((field: string, value: unknown) => {
    setEditingUser((prev: Partial<OrgUser> | null) => (prev ? { ...prev, [field]: value } : prev));
  }, []);

  const updatePermission = useCallback((key: string, value: boolean) => {
    setEditingUser((prev: Partial<OrgUser> | null) =>
      prev ? { ...prev, permissions: { ...prev.permissions, [key]: value } } : prev,
    );
  }, []);

  const updateDataVisibility = useCallback((key: string, value: 'all' | 'own') => {
    setEditingUser((prev: Partial<OrgUser> | null) =>
      prev
        ? {
            ...prev,
            dataVisibility: { ...prev.dataVisibility, [key]: value },
          }
        : prev,
    );
  }, []);

  // ── Renderers ──

  const renderUserItem = useCallback(
    ({ item }: { item: OrgUser }) => {
      const roleCfg = ROLE_CONFIG[item.securityRole as UserRole] || ROLE_CONFIG.Basic;

      return (
        <Surface style={[s.userCard, { backgroundColor: theme.colors.surface }]} elevation={1}>
          <Pressable
            onPress={() => openEditUser(item)}
            style={[s.userRow, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}
          >
            {item.profilePicture ? (
              <Avatar.Image size={46} source={{ uri: item.profilePicture }} />
            ) : (
              <Avatar.Text
                size={46}
                label={getInitials(item.userName)}
                style={{ backgroundColor: roleCfg.color + '20' }}
                labelStyle={{ color: roleCfg.color, fontWeight: '700' }}
              />
            )}

            <View style={[s.userInfo, { alignItems: isRTL ? 'flex-end' : 'flex-start' }]}>
              <View style={[s.nameRow, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
                <Text variant="titleSmall" style={{ color: theme.colors.onSurface }}>
                  {item.userName}
                </Text>
                <View style={[s.activeDot, { backgroundColor: item.isActive ? '#2A9D8F' : '#CCC' }]} />
              </View>
              <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                {item.email}
              </Text>
            </View>

            <Chip
              compact
              mode="flat"
              icon={() => <MaterialCommunityIcons name={roleCfg.icon as any} size={14} color={roleCfg.color} />}
              style={{ backgroundColor: roleCfg.color + '15' }}
              textStyle={{ color: roleCfg.color, fontSize: 11, fontWeight: '600' }}
            >
              {t(`users.role_${item.securityRole}`)}
            </Chip>
          </Pressable>
        </Surface>
      );
    },
    [isRTL, t, theme.colors, openEditUser],
  );

  const keyExtractor = useCallback((item: OrgUser) => item.id, []);

  const EmptyState = () => (
    <View style={s.empty}>
      <MaterialCommunityIcons name="account-group-outline" size={64} color={theme.colors.onSurfaceVariant + '50'} />
      <Text variant="titleMedium" style={{ color: theme.colors.onSurfaceVariant, marginTop: 16 }}>
        {t('users.noUsers')}
      </Text>
      <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant + '80', marginTop: 4, textAlign: 'center' }}>
        {t('users.noUsersDesc')}
      </Text>
      <Button mode="contained" onPress={openAddUser} style={{ marginTop: 20, borderRadius: 12 }} buttonColor={BRAND_COLOR}>
        {t('users.addUser')}
      </Button>
    </View>
  );

  if (loading) {
    return (
      <View style={[s.container, s.center, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator size="large" color={BRAND_COLOR} />
      </View>
    );
  }

  return (
    <View style={[s.container, { backgroundColor: theme.colors.background }]}>
      {/* Header */}
      <Appbar.Header style={{ backgroundColor: BRAND_COLOR }} mode="center-aligned">
        <Appbar.BackAction onPress={() => router.back()} color="#FFF" />
        <Appbar.Content title={t('users.title')} titleStyle={s.headerTitle} />
      </Appbar.Header>

      {/* Search bar */}
      <Searchbar
        placeholder={t('users.searchPlaceholder')}
        value={searchQuery}
        onChangeText={setSearchQuery}
        style={[s.searchBar, { backgroundColor: theme.colors.surface }]}
        inputStyle={{ textAlign: isRTL ? 'right' : 'left' }}
      />

      {/* User List */}
      <FlatList
        data={filteredUsers}
        renderItem={renderUserItem}
        keyExtractor={keyExtractor}
        contentContainerStyle={s.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[BRAND_COLOR]} tintColor={BRAND_COLOR} />
        }
        ListEmptyComponent={<EmptyState />}
      />

      {/* FAB */}
      <FAB
        icon="account-plus"
        label={t('users.addUser')}
        onPress={openAddUser}
        style={[s.fab, { backgroundColor: BRAND_COLOR }]}
        color="#FFF"
      />

      {/* ── Edit / Add User Modal ── */}
      <Portal>
        <Modal
          visible={modalVisible}
          onDismiss={() => { setModalVisible(false); setEditingUser(null); }}
          contentContainerStyle={[s.modal, { backgroundColor: theme.colors.surface }]}
        >
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ maxHeight: '100%' }}>
          <ScrollView showsVerticalScrollIndicator={false}>
            <View style={[s.modalHeader, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
              <Text variant="titleLarge" style={{ color: theme.colors.onSurface, flex: 1, textAlign: isRTL ? 'right' : 'left', fontWeight: '700' }}>
                {editingUser?.id ? t('users.editUser') : t('users.addUser')}
              </Text>
              <IconButton icon="close" size={22} onPress={() => { setModalVisible(false); setEditingUser(null); }} />
            </View>

            <TextInput
              label={t('users.name')}
              value={editingUser?.userName || ''}
              onChangeText={(v) => updateField('userName', v)}
              mode="outlined"
              style={s.input}
              outlineColor={BRAND_COLOR + '40'}
              activeOutlineColor={BRAND_COLOR}
              textAlign={isRTL ? 'right' : 'left'}
            />

            <TextInput
              label={t('users.email')}
              value={editingUser?.email || ''}
              onChangeText={(v) => updateField('email', v)}
              mode="outlined"
              keyboardType="email-address"
              autoCapitalize="none"
              style={s.input}
              outlineColor={BRAND_COLOR + '40'}
              activeOutlineColor={BRAND_COLOR}
              textAlign={isRTL ? 'right' : 'left'}
            />

            <TextInput
              label={t('users.phone')}
              value={editingUser?.phoneNumber || ''}
              onChangeText={(v) => updateField('phoneNumber', v)}
              mode="outlined"
              keyboardType="phone-pad"
              style={s.input}
              outlineColor={BRAND_COLOR + '40'}
              activeOutlineColor={BRAND_COLOR}
              textAlign={isRTL ? 'right' : 'left'}
            />

            {/* Role Selector */}
            <Text variant="labelLarge" style={[s.sectionLabel, { color: BRAND_COLOR, textAlign: isRTL ? 'right' : 'left' }]}>
              {t('users.role')}
            </Text>
            <View style={s.roleGrid}>
              {(Object.keys(ROLE_CONFIG) as UserRole[]).map((role) => {
                const cfg = ROLE_CONFIG[role];
                const selected = editingUser?.securityRole === role;
                return (
                  <Pressable
                    key={role}
                    onPress={() => updateField('securityRole', role)}
                    style={[
                      s.roleItem,
                      { borderColor: selected ? cfg.color : theme.colors.outlineVariant },
                      selected && { backgroundColor: cfg.color + '10' },
                    ]}
                  >
                    <MaterialCommunityIcons name={cfg.icon as any} size={20} color={selected ? cfg.color : theme.colors.onSurfaceVariant} />
                    <Text
                      variant="labelMedium"
                      style={{ color: selected ? cfg.color : theme.colors.onSurfaceVariant, fontWeight: selected ? '700' : '400', marginTop: 4 }}
                    >
                      {t(`users.role_${role}`)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Custom Permissions */}
            {editingUser?.securityRole === 'Custom' && (
              <>
                <Text variant="labelLarge" style={[s.sectionLabel, { color: BRAND_COLOR, textAlign: isRTL ? 'right' : 'left' }]}>
                  {t('users.permissions')}
                </Text>
                {PERMISSION_KEYS.map((key) => (
                  <View key={key} style={[s.permRow, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
                    <Text variant="bodyMedium" style={{ flex: 1, color: theme.colors.onSurface, textAlign: isRTL ? 'right' : 'left' }}>
                      {t(`users.perm_${key}`)}
                    </Text>
                    <Switch
                      value={!!editingUser.permissions?.[key]}
                      onValueChange={(v) => updatePermission(key, v)}
                      color={BRAND_COLOR}
                    />
                  </View>
                ))}
              </>
            )}

            <Divider style={{ marginVertical: 16 }} />

            {/* Data Visibility (all/own per module) */}
            <Text variant="labelLarge" style={[s.sectionLabel, { color: BRAND_COLOR, textAlign: isRTL ? 'right' : 'left' }]}>
              {t('users.dataVisibility')}
            </Text>
            {DATA_VISIBILITY_KEYS.map((key) => {
              const current = editingUser?.dataVisibility?.[key] || 'all';
              return (
                <View key={key} style={[s.permRow, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
                  <Text variant="bodyMedium" style={{ flex: 1, color: theme.colors.onSurface, textAlign: isRTL ? 'right' : 'left' }}>
                    {t(`users.perm_${key}`)}
                  </Text>
                  <View style={[s.visibilityChips, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
                    <Chip
                      selected={current === 'all'}
                      onPress={() => updateDataVisibility(key, 'all')}
                      compact
                      style={[s.visibilityChip, current === 'all' && { backgroundColor: BRAND_COLOR + '20' }]}
                      textStyle={current === 'all' ? { color: BRAND_COLOR, fontWeight: '600' } : {}}
                    >
                      {t('users.visibility_all')}
                    </Chip>
                    <Chip
                      selected={current === 'own'}
                      onPress={() => updateDataVisibility(key, 'own')}
                      compact
                      style={[s.visibilityChip, current === 'own' && { backgroundColor: BRAND_COLOR + '20' }]}
                      textStyle={current === 'own' ? { color: BRAND_COLOR, fontWeight: '600' } : {}}
                    >
                      {t('users.visibility_own')}
                    </Chip>
                  </View>
                </View>
              );
            })}

            <Divider style={{ marginVertical: 16 }} />

            {/* Language */}
            <Text variant="labelLarge" style={[s.sectionLabel, { color: BRAND_COLOR, textAlign: isRTL ? 'right' : 'left' }]}>
              {t('users.language')}
            </Text>
            <View style={[s.roleGrid, { marginBottom: 12 }]}>
              {LANGUAGE_OPTIONS.map((lang) => {
                const selected = (editingUser?.language || 'en') === lang;
                return (
                  <Pressable
                    key={lang}
                    onPress={() => updateField('language', lang)}
                    style={[
                      s.roleItem,
                      { borderColor: selected ? BRAND_COLOR : theme.colors.outlineVariant },
                      selected && { backgroundColor: BRAND_COLOR + '10' },
                    ]}
                  >
                    <Text variant="labelMedium" style={{ color: selected ? BRAND_COLOR : theme.colors.onSurfaceVariant, fontWeight: selected ? '700' : '400' }}>
                      {lang === 'en' ? t('settings.english') : t('settings.hebrew')}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Timezone */}
            <Text variant="labelLarge" style={[s.sectionLabel, { color: BRAND_COLOR, textAlign: isRTL ? 'right' : 'left' }]}>
              {t('users.timezone')}
            </Text>
            <TextInput
              label={t('users.timezone')}
              value={editingUser?.timeZone || ''}
              onChangeText={(v) => updateField('timeZone', v)}
              mode="outlined"
              placeholder="UTC"
              style={[s.input, { textAlign: isRTL ? 'right' : 'left' }]}
              outlineColor={BRAND_COLOR + '40'}
              activeOutlineColor={BRAND_COLOR}
            />

            {/* Status (Active/Inactive) */}
            <Text variant="labelLarge" style={[s.sectionLabel, { color: BRAND_COLOR, textAlign: isRTL ? 'right' : 'left' }]}>
              {t('users.status')}
            </Text>
            <View style={[s.permRow, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
              <Text variant="bodyMedium" style={{ flex: 1, color: theme.colors.onSurface, textAlign: isRTL ? 'right' : 'left' }}>
                {editingUser?.isActive !== false ? t('users.active') : t('users.inactive')}
              </Text>
              <Switch
                value={editingUser?.isActive ?? true}
                onValueChange={(v) => updateField('isActive', v)}
                color="#2A9D8F"
              />
            </View>

            {/* Footer Buttons */}
            <View style={[s.modalFooter, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
              {editingUser?.id && (
                <Button
                  mode="outlined"
                  textColor="#E63946"
                  style={[s.footerBtn, { borderColor: '#E6394640' }]}
                  icon="delete-outline"
                  onPress={() => { setModalVisible(false); setDeleteTarget(editingUser as OrgUser); }}
                >
                  {t('users.delete')}
                </Button>
              )}
              <View style={{ flex: 1 }} />
              <Button mode="outlined" onPress={() => { setModalVisible(false); setEditingUser(null); }} style={s.footerBtn} textColor={theme.colors.onSurfaceVariant}>
                {t('common.cancel')}
              </Button>
              <Button mode="contained" onPress={handleSaveUser} loading={saving} style={s.footerBtn} buttonColor={BRAND_COLOR}>
                {t('common.save')}
              </Button>
            </View>
          </ScrollView>
          </KeyboardAvoidingView>
        </Modal>
      </Portal>

      {/* ── Delete Confirmation Dialog ── */}
      <Portal>
        <Dialog visible={!!deleteTarget} onDismiss={() => setDeleteTarget(null)} style={{ borderRadius: 20 }}>
          <Dialog.Icon icon="alert-circle-outline" color="#E63946" size={40} />
          <Dialog.Title style={{ textAlign: 'center' }}>{t('users.deleteConfirmTitle')}</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium" style={{ textAlign: 'center', color: theme.colors.onSurfaceVariant }}>
              {t('users.deleteConfirmMessage', { name: deleteTarget?.userName || '' })}
            </Text>
          </Dialog.Content>
          <Dialog.Actions style={{ justifyContent: 'center', gap: 12 }}>
            <Button onPress={() => setDeleteTarget(null)} textColor={theme.colors.onSurfaceVariant}>
              {t('common.cancel')}
            </Button>
            <Button onPress={handleDeleteUser} loading={saving} textColor="#E63946" mode="contained" buttonColor="#E6394615">
              {t('users.delete')}
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: '#FFF', fontWeight: '700', fontSize: 18 },
  searchBar: { marginHorizontal: 16, marginVertical: 8, borderRadius: 12 },
  list: { paddingVertical: 8, paddingBottom: 100 },
  userCard: { borderRadius: 14, marginHorizontal: 16, marginVertical: 5, overflow: 'hidden' },
  userRow: { padding: 14, alignItems: 'center' },
  userInfo: { flex: 1, marginHorizontal: 12 },
  nameRow: { alignItems: 'center', gap: 6 },
  activeDot: { width: 8, height: 8, borderRadius: 4 },
  fab: { position: 'absolute', bottom: 24, end: 20, borderRadius: 28 },
  modal: { margin: 16, borderRadius: 24, padding: 24, maxHeight: '90%' },
  modalHeader: { alignItems: 'center', marginBottom: 16 },
  input: { marginBottom: 12 },
  sectionLabel: { fontWeight: '700', marginTop: 12, marginBottom: 10 },
  roleGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  roleItem: {
    width: '47%',
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1.5,
  },
  permRow: { alignItems: 'center', paddingVertical: 8 },
  visibilityChips: { gap: 8 },
  visibilityChip: { height: 28 },
  modalFooter: { marginTop: 20, gap: 8, alignItems: 'center' },
  footerBtn: { borderRadius: 12 },
  empty: { alignItems: 'center', justifyContent: 'center', paddingTop: 100, paddingHorizontal: 32 },
});
