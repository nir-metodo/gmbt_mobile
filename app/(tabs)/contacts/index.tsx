import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  View,
  StyleSheet,
  Pressable,
  RefreshControl,
  Animated,
  Linking,
  Alert,
  ScrollView,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Text, Searchbar, Chip, FAB, Avatar, Divider, Portal, Modal, Button, ActivityIndicator } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Swipeable } from 'react-native-gesture-handler';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useContactStore } from '../../../stores/contactStore';
import { useAuthStore } from '../../../stores/authStore';
import { useAppTheme } from '../../../hooks/useAppTheme';
import { useRTL } from '../../../hooks/useRTL';
import { formatPhoneNumber, getInitials } from '../../../utils/formatters';
import { spacing, borderRadius, fontSize as fs } from '../../../constants/theme';
import type { Contact } from '../../../types';

type ContactFilterMode = 'all' | 'myContacts' | 'recent';

function extractContactTags(keys: string[] | string | undefined): string[] {
  if (!keys) return [];
  if (Array.isArray(keys)) return keys.filter(Boolean);
  if (typeof keys === 'string') {
    return keys.split('#').filter((t: string) => t.trim()).map((t: string) => t.trim());
  }
  return [];
}

export default function ContactsListScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useAppTheme();
  const { isRTL, flexDirection, textAlign } = useRTL();
  const { t } = useTranslation();

  const user = useAuthStore((s) => s.user);
  const organization = user?.organization ?? '';
  const currentUserId = user?.uID || user?.userId || '';

  const contacts = useContactStore((s) => s.contacts);
  const isLoading = useContactStore((s) => s.isLoading);
  const searchQuery = useContactStore((s) => s.searchQuery);
  const setSearchQuery = useContactStore((s) => s.setSearchQuery);
  const loadContacts = useContactStore((s) => s.loadContacts);
  const deleteContact = useContactStore((s) => s.deleteContact);
  const getFilteredContacts = useContactStore((s) => s.getFilteredContacts);

  const [refreshing, setRefreshing] = useState(false);
  const [searchVisible, setSearchVisible] = useState(true);
  const [filterMode, setFilterMode] = useState<ContactFilterMode>('all');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [advancedFilterVisible, setAdvancedFilterVisible] = useState(false);
  const [filterOwner, setFilterOwner] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'createdOn' | 'modifiedOn' | ''>('');
  const searchAnim = useRef(new Animated.Value(1)).current;
  const swipeableRefs = useRef(new Map<string, Swipeable>()).current;

  useEffect(() => {
    if (organization) loadContacts(organization);
  }, [organization, loadContacts]);

  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    contacts.forEach((c) => {
      extractContactTags(c.keys).forEach((tag) => tagSet.add(tag));
    });
    return Array.from(tagSet).sort();
  }, [contacts]);

  const allOwners = useMemo(() => {
    const ownerSet = new Set<string>();
    contacts.forEach((c) => {
      if (c.ownerName?.trim()) ownerSet.add(c.ownerName.trim());
    });
    return Array.from(ownerSet).sort();
  }, [contacts]);

  const allStatuses = useMemo(() => {
    const statusSet = new Set<string>();
    contacts.forEach((c) => {
      if (c.lastConversationStatus?.trim()) statusSet.add(c.lastConversationStatus.trim());
    });
    return Array.from(statusSet).sort();
  }, [contacts]);

  const filteredContacts = useMemo(() => {
    let result = getFilteredContacts();

    if (filterMode === 'myContacts') {
      result = result.filter((c) => c.ownerId === currentUserId);
    } else if (filterMode === 'recent') {
      result = [...result].sort((a, b) => {
        const dateA = a.modifiedOn || a.createdOn || '';
        const dateB = b.modifiedOn || b.createdOn || '';
        return dateB.localeCompare(dateA);
      });
    }

    if (selectedTag) {
      result = result.filter((c) => {
        const tags = extractContactTags(c.keys);
        return tags.includes(selectedTag);
      });
    }

    if (filterOwner) {
      result = result.filter((c) => c.ownerName?.trim() === filterOwner);
    }

    if (filterStatus) {
      result = result.filter((c) =>
        c.lastConversationStatus?.toLowerCase() === filterStatus.toLowerCase(),
      );
    }

    if (sortBy === 'name') {
      result = [...result].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    } else if (sortBy === 'createdOn') {
      result = [...result].sort((a, b) => (b.createdOn || '').localeCompare(a.createdOn || ''));
    } else if (sortBy === 'modifiedOn') {
      result = [...result].sort((a, b) => (b.modifiedOn || '').localeCompare(a.modifiedOn || ''));
    }

    return result;
  }, [contacts, searchQuery, getFilteredContacts, filterMode, currentUserId, selectedTag, filterOwner, filterStatus, sortBy]);

  const toggleSearch = useCallback(() => {
    const willShow = !searchVisible;
    if (willShow) {
      setSearchVisible(true);
      Animated.timing(searchAnim, {
        toValue: 1,
        duration: 220,
        useNativeDriver: false,
      }).start();
    } else {
      Animated.timing(searchAnim, {
        toValue: 0,
        duration: 180,
        useNativeDriver: false,
      }).start(() => {
        setSearchVisible(false);
        setSearchQuery('');
      });
    }
  }, [searchVisible, searchAnim, setSearchQuery]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    if (organization) await loadContacts(organization);
    setRefreshing(false);
  }, [organization, loadContacts]);

  const handleCall = useCallback(
    (contact: Contact) => {
      swipeableRefs.get(contact.id)?.close();
      if (contact.phoneNumber) Linking.openURL(`tel:${contact.phoneNumber}`);
    },
    [swipeableRefs],
  );

  const handleMessage = useCallback(
    (contact: Contact) => {
      swipeableRefs.get(contact.id)?.close();
      if (contact.phoneNumber) {
        Linking.openURL(`https://wa.me/${contact.phoneNumber.replace(/\D/g, '')}`);
      }
    },
    [swipeableRefs],
  );

  const handleDelete = useCallback(
    (contact: Contact) => {
      swipeableRefs.get(contact.id)?.close();
      const fullName = contact.name || contact.phoneNumber || '';
      Alert.alert(fullName, t('contacts.deleteConfirm'), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: () => {
            if (organization) deleteContact(organization, contact.id);
          },
        },
      ]);
    },
    [organization, deleteContact, t, swipeableRefs],
  );

  const openContact = useCallback(
    (contact: Contact) => {
      router.push({
        pathname: '/(tabs)/contacts/[id]',
        params: { id: contact.id },
      });
    },
    [router],
  );

  const renderSwipeActions = useCallback(
    (contact: Contact) => (
      <View style={styles.swipeActions}>
        <Pressable
          style={[styles.swipeBtn, { backgroundColor: theme.colors.primary }]}
          onPress={() => handleCall(contact)}
        >
          <MaterialCommunityIcons name="phone" size={22} color="#FFF" />
          <Text style={styles.swipeBtnLabel}>{t('common.call')}</Text>
        </Pressable>
        <Pressable
          style={[styles.swipeBtn, { backgroundColor: '#25D366' }]}
          onPress={() => handleMessage(contact)}
        >
          <MaterialCommunityIcons name="whatsapp" size={22} color="#FFF" />
          <Text style={styles.swipeBtnLabel}>{t('contacts.sendMessage')}</Text>
        </Pressable>
        <Pressable
          style={[styles.swipeBtn, { backgroundColor: theme.colors.error }]}
          onPress={() => handleDelete(contact)}
        >
          <MaterialCommunityIcons name="delete-outline" size={22} color="#FFF" />
          <Text style={styles.swipeBtnLabel}>{t('common.delete')}</Text>
        </Pressable>
      </View>
    ),
    [theme, t, handleCall, handleMessage, handleDelete],
  );

  const renderContactItem = useCallback(
    ({ item }: { item: Contact }) => {
      const contactName = item.name || item.phoneNumber || '';
      const tags = extractContactTags(item.keys);

      return (
        <Swipeable
          ref={(ref) => {
            if (ref) swipeableRefs.set(item.id, ref);
            else swipeableRefs.delete(item.id);
          }}
          renderRightActions={() => renderSwipeActions(item)}
          overshootRight={false}
          friction={2}
        >
          <Pressable
            onPress={() => openContact(item)}
            android_ripple={{ color: theme.colors.surfaceVariant }}
            style={({ pressed }) => [
              styles.contactRow,
              {
                backgroundColor: pressed
                  ? theme.colors.surfaceVariant
                  : theme.colors.surface,
                flexDirection,
              },
            ]}
          >
            <View style={[styles.avatarWrap, { marginEnd: spacing.md }]}>
              {item.photoURL ? (
                <Avatar.Image size={48} source={{ uri: item.photoURL }} />
              ) : (
                <Avatar.Text
                  size={48}
                  label={getInitials(contactName)}
                  style={{ backgroundColor: theme.colors.primaryContainer }}
                  labelStyle={{ color: theme.colors.primary, fontWeight: '700' }}
                />
              )}
            </View>

            <View style={[styles.contactBody, { alignItems: isRTL ? 'flex-end' : 'flex-start', minWidth: 0 }]}>
              <Text
                variant="titleMedium"
                numberOfLines={1}
                style={{ color: theme.colors.onSurface, textAlign, fontWeight: '600', width: '100%' }}
              >
                {contactName}
              </Text>

              <View style={[styles.metaRow, { flexDirection }]}>
                {item.phoneNumber ? (
                  <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, textAlign }}>
                    {formatPhoneNumber(item.phoneNumber)}
                  </Text>
                ) : null}
                {item.email ? (
                  <>
                    <Text style={{ color: theme.colors.onSurfaceVariant, marginHorizontal: 6 }}>
                      •
                    </Text>
                    <Text
                      variant="bodySmall"
                      numberOfLines={1}
                      style={{ color: theme.colors.onSurfaceVariant, flexShrink: 1, textAlign }}
                    >
                      {item.email}
                    </Text>
                  </>
                ) : null}
              </View>

              {tags.length > 0 ? (
                <View style={[styles.tagsRow, { flexDirection, flexWrap: 'wrap', justifyContent: isRTL ? 'flex-end' : 'flex-start', width: '100%' }]}>
                  {tags.slice(0, 3).map((tag) => (
                    <Chip
                      key={tag}
                      compact
                      textStyle={[styles.tagText, { color: theme.colors.onPrimaryContainer }]}
                      style={[styles.tagChip, { backgroundColor: theme.colors.primaryContainer }]}
                    >
                      #{tag}
                    </Chip>
                  ))}
                  {tags.length > 3 ? (
                    <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant, textAlign }}>
                      +{tags.length - 3}
                    </Text>
                  ) : null}
                </View>
              ) : null}
            </View>

            <MaterialCommunityIcons
              name={isRTL ? 'chevron-left' : 'chevron-right'}
              size={20}
              color={theme.colors.onSurfaceVariant}
              style={{ opacity: 0.4, marginStart: 8, flexShrink: 0 }}
            />
          </Pressable>
        </Swipeable>
      );
    },
    [theme, isRTL, textAlign, flexDirection, openContact, renderSwipeActions, swipeableRefs],
  );

  const renderEmpty = useCallback(
    () => (
      <View style={styles.emptyWrap}>
        <MaterialCommunityIcons
          name="account-group-outline"
          size={72}
          color={theme.colors.onSurfaceVariant}
          style={{ opacity: 0.35 }}
        />
        <Text variant="titleMedium" style={{ color: theme.colors.onSurface, fontWeight: '600', marginTop: 12 }}>
          {t('contacts.noContacts')}
        </Text>
        <Text
          variant="bodyMedium"
          style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center', marginTop: 4 }}
        >
          {t('contacts.addContact')}
        </Text>
      </View>
    ),
    [theme, t],
  );

  const searchHeight = searchAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 56],
  });

  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
      <View
        style={[
          styles.header,
          { backgroundColor: theme.custom.headerBackground, paddingTop: insets.top + 8 },
        ]}
      >
        <Text style={styles.headerTitle}>{t('contacts.title')}</Text>
        <View style={{ flexDirection: 'row', gap: 4 }}>
          <Pressable
            onPress={() => setAdvancedFilterVisible(true)}
            hitSlop={8}
            style={({ pressed }) => [styles.headerBtn, pressed && { opacity: 0.7 }]}
          >
            <MaterialCommunityIcons
              name="filter-variant"
              size={24}
              color={theme.custom.headerText}
            />
          </Pressable>
          <Pressable
            onPress={toggleSearch}
            hitSlop={8}
            style={({ pressed }) => [styles.headerBtn, pressed && { opacity: 0.7 }]}
          >
            <MaterialCommunityIcons
              name={searchVisible ? 'close' : 'magnify'}
              size={24}
              color={theme.custom.headerText}
            />
          </Pressable>
        </View>
      </View>

      {searchVisible ? (
        <Animated.View
          style={[
            styles.searchWrap,
            {
              height: searchHeight,
              opacity: searchAnim,
              backgroundColor: theme.custom.headerBackground,
            },
          ]}
        >
          <Searchbar
            placeholder={t('contacts.searchPlaceholder')}
            value={searchQuery}
            onChangeText={setSearchQuery}
            style={[styles.searchbar, { backgroundColor: theme.colors.surface }]}
            inputStyle={{ fontSize: 14, textAlign: isRTL ? 'right' : 'left' }}
            iconColor={theme.colors.onSurfaceVariant}
            autoFocus
          />
        </Animated.View>
      ) : null}

      {/* Filter chips */}
      <View style={[styles.filtersContainer, { backgroundColor: theme.colors.surface, borderBottomColor: theme.colors.outline }]}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={[styles.filterChips, { flexDirection, paddingStart: 18, paddingEnd: 18 }]}
        >
          <Chip
            selected={filterMode === 'all' && !selectedTag}
            onPress={() => { setFilterMode('all'); setSelectedTag(null); }}
            showSelectedOverlay
            compact
            style={[
              styles.filterChip,
              filterMode === 'all' && !selectedTag
                ? { backgroundColor: theme.colors.primaryContainer }
                : { backgroundColor: theme.colors.surfaceVariant },
            ]}
            textStyle={[
              styles.filterChipText,
              filterMode === 'all' && !selectedTag && { color: theme.colors.primary, fontWeight: '600' },
            ]}
          >
            {t('common.all')}
          </Chip>
          <Chip
            selected={filterMode === 'myContacts'}
            onPress={() => { setFilterMode(filterMode === 'myContacts' ? 'all' : 'myContacts'); setSelectedTag(null); }}
            showSelectedOverlay
            compact
            style={[
              styles.filterChip,
              filterMode === 'myContacts'
                ? { backgroundColor: theme.colors.primaryContainer }
                : { backgroundColor: theme.colors.surfaceVariant },
            ]}
            textStyle={[
              styles.filterChipText,
              filterMode === 'myContacts' && { color: theme.colors.primary, fontWeight: '600' },
            ]}
          >
            {t('contacts.myContacts')}
          </Chip>
          <Chip
            selected={filterMode === 'recent'}
            onPress={() => { setFilterMode(filterMode === 'recent' ? 'all' : 'recent'); setSelectedTag(null); }}
            showSelectedOverlay
            compact
            style={[
              styles.filterChip,
              filterMode === 'recent'
                ? { backgroundColor: theme.colors.primaryContainer }
                : { backgroundColor: theme.colors.surfaceVariant },
            ]}
            textStyle={[
              styles.filterChipText,
              filterMode === 'recent' && { color: theme.colors.primary, fontWeight: '600' },
            ]}
          >
            {t('contacts.recent')}
          </Chip>
        </ScrollView>
        {allTags.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={[styles.tagFilterChips, { flexDirection, paddingStart: 18, paddingEnd: 18 }]}
          >
            {allTags.map((tag) => {
              const isActive = selectedTag === tag;
              return (
                <Chip
                  key={tag}
                  selected={isActive}
                  onPress={() => setSelectedTag(isActive ? null : tag)}
                  showSelectedOverlay
                  compact
                  icon={isActive ? 'check' : 'tag-outline'}
                  style={[
                    styles.tagFilterChip,
                    isActive
                      ? { backgroundColor: theme.colors.primaryContainer }
                      : { backgroundColor: theme.colors.surfaceVariant },
                  ]}
                  textStyle={[
                    styles.filterChipText,
                    { color: isActive ? theme.colors.onPrimaryContainer : theme.colors.onSurfaceVariant },
                    isActive && { fontWeight: '600' },
                  ]}
                >
                  {tag}
                </Chip>
              );
            })}
          </ScrollView>
        ) : null}
      </View>

      {isLoading && contacts.length === 0 ? (
        <View style={[styles.centered, { flex: 1 }]}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      ) : (
        <>
          <FlashList
            data={filteredContacts}
            renderItem={renderContactItem}
            keyExtractor={(item) => item.id}
            ItemSeparatorComponent={() => (
              <Divider style={{ marginStart: 78 }} />
            )}
            ListEmptyComponent={renderEmpty}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                colors={[theme.colors.primary]}
                tintColor={theme.colors.primary}
              />
            }
            contentContainerStyle={styles.listContent}
          />

          <FAB
        icon="account-plus"
        onPress={() => router.push({ pathname: '/(tabs)/contacts/[id]', params: { id: 'new' } })}
        style={[styles.fab, { backgroundColor: theme.colors.primary, bottom: insets.bottom + 16 }]}
        color="#FFF"
      />

      <Portal>
        <Modal
          visible={advancedFilterVisible}
          onDismiss={() => setAdvancedFilterVisible(false)}
          contentContainerStyle={[
            styles.advancedFilterModal,
            { backgroundColor: theme.colors.surface },
          ]}
        >
          <ScrollView showsVerticalScrollIndicator={false}>
            <Text variant="titleLarge" style={{ color: theme.colors.onSurface, fontWeight: '700', marginBottom: 16, textAlign }}>
              {t('contacts.advancedFilter', 'Advanced Filter')}
            </Text>

            {allOwners.length > 0 && (
              <>
                <Text variant="labelLarge" style={{ color: theme.colors.onSurface, fontWeight: '600', marginBottom: 8, textAlign }}>
                  {t('contacts.owner')}
                </Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
                  <View style={{ flexDirection: isRTL ? 'row-reverse' : 'row', gap: 6 }}>
                    {allOwners.map((owner) => {
                      const active = filterOwner === owner;
                      return (
                        <Chip
                          key={owner}
                          selected={active}
                          onPress={() => setFilterOwner(active ? '' : owner)}
                          compact
                          style={{ backgroundColor: active ? theme.colors.primaryContainer : theme.colors.surfaceVariant }}
                          textStyle={{ color: active ? theme.colors.onPrimaryContainer : theme.colors.onSurfaceVariant, fontSize: 12 }}
                        >
                          {owner}
                        </Chip>
                      );
                    })}
                  </View>
                </ScrollView>
              </>
            )}

            {allStatuses.length > 0 && (
              <>
                <Text variant="labelLarge" style={{ color: theme.colors.onSurface, fontWeight: '600', marginBottom: 8, textAlign }}>
                  {t('contacts.status', 'Status')}
                </Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
                  <View style={{ flexDirection: isRTL ? 'row-reverse' : 'row', gap: 6 }}>
                    {allStatuses.map((status) => {
                      const active = filterStatus === status;
                      return (
                        <Chip
                          key={status}
                          selected={active}
                          onPress={() => setFilterStatus(active ? '' : status)}
                          compact
                          style={{ backgroundColor: active ? theme.colors.primaryContainer : theme.colors.surfaceVariant }}
                          textStyle={{ color: active ? theme.colors.onPrimaryContainer : theme.colors.onSurfaceVariant, fontSize: 12 }}
                        >
                          {status}
                        </Chip>
                      );
                    })}
                  </View>
                </ScrollView>
              </>
            )}

            <Text variant="labelLarge" style={{ color: theme.colors.onSurface, fontWeight: '600', marginBottom: 8, textAlign }}>
              {t('contacts.tags')}
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
              <View style={{ flexDirection: isRTL ? 'row-reverse' : 'row', gap: 6 }}>
                {allTags.map((tag) => {
                  const active = selectedTag === tag;
                  return (
                    <Chip
                      key={tag}
                      selected={active}
                      onPress={() => setSelectedTag(active ? null : tag)}
                      compact
                      style={{ backgroundColor: active ? theme.colors.primaryContainer : theme.colors.surfaceVariant }}
                      textStyle={{ color: active ? theme.colors.onPrimaryContainer : theme.colors.onSurfaceVariant, fontSize: 12 }}
                    >
                      #{tag}
                    </Chip>
                  );
                })}
              </View>
            </ScrollView>

            <Text variant="labelLarge" style={{ color: theme.colors.onSurface, fontWeight: '600', marginBottom: 8, textAlign }}>
              {t('contacts.sortBy', 'Sort By')}
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
              <View style={{ flexDirection: isRTL ? 'row-reverse' : 'row', gap: 6 }}>
                {([
                  { key: 'name' as const, label: t('contacts.name', 'Name') },
                  { key: 'createdOn' as const, label: t('contacts.createdAt', 'Created') },
                  { key: 'modifiedOn' as const, label: t('contacts.updatedAt', 'Updated') },
                ]).map(({ key, label }) => {
                  const active = sortBy === key;
                  return (
                    <Chip
                      key={key}
                      selected={active}
                      onPress={() => setSortBy(active ? '' : key)}
                      compact
                      icon={active ? 'check' : 'sort'}
                      style={{ backgroundColor: active ? theme.colors.primaryContainer : theme.colors.surfaceVariant }}
                      textStyle={{ color: active ? theme.colors.onPrimaryContainer : theme.colors.onSurfaceVariant, fontSize: 12 }}
                    >
                      {label}
                    </Chip>
                  );
                })}
              </View>
            </ScrollView>

            <View style={{ flexDirection: isRTL ? 'row-reverse' : 'row', gap: 12, justifyContent: 'flex-end' }}>
              <Button
                mode="outlined"
                onPress={() => {
                  setFilterOwner('');
                  setFilterStatus('');
                  setSelectedTag(null);
                  setFilterMode('all');
                  setSortBy('');
                }}
                textColor={theme.colors.onSurface}
              >
                {t('common.refresh', 'Clear')}
              </Button>
              <Button
                mode="contained"
                onPress={() => setAdvancedFilterVisible(false)}
                buttonColor={theme.colors.primary}
                textColor="#FFF"
              >
                {t('common.confirm', 'Apply')}
              </Button>
            </View>
          </ScrollView>
        </Modal>
      </Portal>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingBottom: 12,
  },
  headerTitle: { fontSize: 22, fontWeight: '700', color: '#FFF' },
  headerBtn: { padding: 4 },
  searchWrap: {
    paddingHorizontal: 14,
    overflow: 'hidden',
    justifyContent: 'center',
    paddingBottom: 8,
  },
  searchbar: { height: 40, borderRadius: 20, elevation: 0 },
  filtersContainer: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
  },
  filterChips: {
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  filterChip: { height: 28 },
  filterChipText: { fontSize: 12 },
  tagFilterChips: {
    gap: 6,
    paddingBottom: 6,
    paddingHorizontal: 4,
  },
  tagFilterChip: { height: 26 },
  listContent: { paddingBottom: 100 },
  contactRow: {
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  avatarWrap: { position: 'relative' },
  contactBody: { flex: 1, justifyContent: 'center', gap: 2 },
  metaRow: { alignItems: 'center', marginTop: 2 },
  tagsRow: { alignItems: 'center', gap: 6, marginTop: 4 },
  tagChip: { height: 24 },
  tagText: { fontSize: 11 },
  swipeActions: { flexDirection: 'row', alignItems: 'stretch' },
  swipeBtn: {
    width: 72,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
  },
  swipeBtnLabel: { color: '#FFF', fontSize: 11, fontWeight: '600' },
  emptyWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 140,
    paddingHorizontal: 40,
  },
  fab: { position: 'absolute', end: 16, borderRadius: 16 },
  advancedFilterModal: {
    marginHorizontal: 20,
    borderRadius: 16,
    padding: 20,
    maxHeight: '80%',
  },
});
