import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  View,
  StyleSheet,
  Pressable,
  RefreshControl,
  Linking,
  Alert,
  ScrollView,
} from 'react-native';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import {
  Text,
  Searchbar,
  Chip,
  FAB,
  Avatar,
  Divider,
  Portal,
  Modal,
  Button,
  ActivityIndicator,
  Menu,
  TextInput,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Swipeable } from 'react-native-gesture-handler';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useContactStore } from '../../../stores/contactStore';
import { useAuthStore } from '../../../stores/authStore';
import { useAppTheme } from '../../../hooks/useAppTheme';
import { useRTL } from '../../../hooks/useRTL';
import { formatPhoneNumber, getInitials } from '../../../utils/formatters';
import { placeSmartCall } from '../../../utils/phoneCall';
import { getDataVisibility } from '../../../constants/permissions';
import InternalMessagesHub from '../../../components/InternalMessagesHub';
import NotesHub from '../../../components/NotesHub';
import ContactFiltersSheet from '../../../components/contacts/ContactFiltersSheet';
import HighlightText, { phoneMatchRanges, textMatchRanges } from '../../../components/contacts/HighlightText';
import { useContactViews, useRecentSearches } from '../../../components/contacts/useContactViews';
import {
  BUILTIN_VIEW_FILTERS,
  EMPTY_FILTERS,
  countActiveFilterGroups,
  filtersEqual,
  fromWebViewFilters,
  parsePhoneQuery,
  searchTokens,
  type BuiltInViewId,
  type ContactFilterState,
  type ContactSort,
  type DateFilter,
} from '../../../services/contactFilters';
import type { ContactView } from '../../../services/api/contacts';
import type { Contact } from '../../../types';

function extractContactTags(keys: string[] | string | undefined): string[] {
  if (!keys) return [];
  if (Array.isArray(keys)) return keys.filter(Boolean);
  if (typeof keys === 'string') {
    return keys.split('#').filter((t: string) => t.trim()).map((t: string) => t.trim());
  }
  return [];
}

const ContactDivider = () => <Divider style={{ marginStart: 78 }} />;

const BUILTIN_ORDER: BuiltInViewId[] = ['__all', '__mine', '__unassigned', '__new', '__unread', '__optedout'];

export default function ContactsListScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useAppTheme();
  const { isRTL, flexDirection, textAlign } = useRTL();
  const { t, i18n } = useTranslation();
  // New strings: Hebrew for every language except English (i18n files are owned elsewhere).
  const L = useCallback((he: string, en: string) => (i18n.language === 'en' ? en : he), [i18n.language]);

  const user = useAuthStore((s) => s.user);
  const organization = user?.organization ?? '';
  const currentUserId = user?.uID || user?.userId || '';
  const userIsAdmin = String(user?.SecurityRole ?? '').toLowerCase() === 'admin';

  const contacts = useContactStore((s) => s.contacts);
  const isLoading = useContactStore((s) => s.isLoading);
  const isLoadingMore = useContactStore((s) => s.isLoadingMore);
  const hasMore = useContactStore((s) => s.hasMore);
  const totalCount = useContactStore((s) => s.totalCount);
  const viewCounts = useContactStore((s) => s.viewCounts);
  const facets = useContactStore((s) => s.facets);
  const filters = useContactStore((s) => s.filters);
  const storeSetSearchQuery = useContactStore((s) => s.setSearchQuery);
  const setStoreFilters = useContactStore((s) => s.setFilters);
  const replaceFilters = useContactStore((s) => s.replaceFilters);
  const setCurrentUserId = useContactStore((s) => s.setCurrentUserId);
  const loadContacts = useContactStore((s) => s.loadContacts);
  const loadMore = useContactStore((s) => s.loadMore);
  const deleteContact = useContactStore((s) => s.deleteContact);

  // ── Search (always visible; runs as SQL against the local cache) ─────────────────────────────
  const [searchInput, setSearchInput] = useState(() => useContactStore.getState().searchQuery);
  const [debouncedSearch, setDebouncedSearch] = useState(searchInput);
  const [searchFocused, setSearchFocused] = useState(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { recent, add: addRecent, clear: clearRecent, remove: removeRecent } = useRecentSearches(organization);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchInput), 150);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    storeSetSearchQuery(debouncedSearch.trim());
  }, [debouncedSearch, storeSetSearchQuery]);

  useEffect(
    () => () => {
      if (blurTimer.current) clearTimeout(blurTimer.current);
    },
    [],
  );

  const [refreshing, setRefreshing] = useState(false);
  const [advancedFilterVisible, setAdvancedFilterVisible] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);
  const [internalHubVisible, setInternalHubVisible] = useState(false);
  const [notesHubVisible, setNotesHubVisible] = useState(false);
  const swipeableRefs = useRef(new Map<string, Swipeable>()).current;
  const listRef = useRef<FlashListRef<Contact>>(null);

  const contactsDV = getDataVisibility(user?.DataVisibility, user?.SecurityRole, 'contacts');
  const ownScope = contactsDV === 'own';

  // ── Saved views (server-synced with the web) ────────────────────────────────────────────────
  const { views, refresh: refreshViews, saveView, updateView, deleteView, canEdit } = useContactViews(
    organization,
    currentUserId,
    userIsAdmin,
  );
  const [lastViewId, setLastViewId] = useState<string | null>(null);
  const [saveDialogVisible, setSaveDialogVisible] = useState(false);
  const [newViewName, setNewViewName] = useState('');
  const [newViewVisibility, setNewViewVisibility] = useState<'personal' | 'shared'>('personal');
  const [savingView, setSavingView] = useState(false);

  const parsedViews = useMemo(
    () => views.map((v) => ({ view: v, state: fromWebViewFilters(v.filters) })),
    [views],
  );

  useEffect(() => {
    if (currentUserId) setCurrentUserId(currentUserId);
  }, [currentUserId, setCurrentUserId]);

  useEffect(() => {
    if (organization) {
      loadContacts(organization, ownScope ? currentUserId : '', ownScope ? 'own' : 'all');
    }
  }, [organization, loadContacts, ownScope, currentUserId]);

  const didMountRef = useRef(false);
  const lastFocusSyncRef = useRef(0);
  useFocusEffect(
    useCallback(() => {
      if (!didMountRef.current) {
        didMountRef.current = true;
        lastFocusSyncRef.current = Date.now();
        return;
      }
      // Re-syncing the whole contacts collection on EVERY tab focus was a major read amplifier.
      // The list is already backed by the on-device SQLite cache + realtime WS updates, so only
      // do a fresh server pull if it's been a while since the last one.
      const STALE_MS = 5 * 60 * 1000;
      if (organization && Date.now() - lastFocusSyncRef.current > STALE_MS) {
        lastFocusSyncRef.current = Date.now();
        loadContacts(organization, ownScope ? currentUserId : '', ownScope ? 'own' : 'all');
        refreshViews();
      }
    }, [organization, loadContacts, ownScope, currentUserId, refreshViews]),
  );

  // Facets (tags/owners) come from the store, which derives them from the whole DB rather than
  // only the rows currently loaded into the window.
  const allTags = facets.tags;
  const allOwners = facets.owners;

  // Search + filters + sort are applied at the DB level inside the store; `contacts` is the
  // already-filtered window. The only remaining client-side pass is the assignedWhatsAppNumbers
  // visibility rule (an org-level config not modeled as an indexed column), applied over the
  // small visible window.
  const assignedNums = user?.assignedWhatsAppNumbers || [];
  const filteredContacts = useMemo(() => {
    if (assignedNums.length === 0) return contacts;
    return contacts.filter((c: any) => {
      const ids = c.wabaPhoneNumberIds;
      if (Array.isArray(ids) && ids.length > 0) return ids.some((id: string) => assignedNums.includes(id));
      if (typeof ids === 'string' && ids) return assignedNums.includes(ids);
      if (c.wabaPhoneNumberId) return assignedNums.includes(c.wabaPhoneNumberId);
      if (c.lastFromNumberId) return assignedNums.includes(c.lastFromNumberId);
      return true; // contacts without number association are visible to all
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contacts, user?.assignedWhatsAppNumbers]);

  // ── Active view / filters ───────────────────────────────────────────────────────────────────
  const activeBuiltIn = useMemo(
    () => BUILTIN_ORDER.find((id) => filtersEqual(filters, BUILTIN_VIEW_FILTERS[id], false)) ?? null,
    [filters],
  );
  const activeSaved = useMemo(
    () => parsedViews.find((pv) => filtersEqual(pv.state, filters, false))?.view ?? null,
    [parsedViews, filters],
  );
  const activeGroups = countActiveFilterGroups(filters);
  // A built-in view is one self-explanatory filter, so the badge only counts "extra" filters.
  const filterBadge = activeBuiltIn ? 0 : activeGroups;
  const isCustom = activeGroups > 0 && !activeBuiltIn;
  const hasSearch = debouncedSearch.trim().length > 0;
  const lastView = lastViewId ? views.find((v) => v.id === lastViewId) ?? null : null;
  const canUpdateLastView = !!lastView && !activeSaved && isCustom && canEdit(lastView);

  const tokens = useMemo(() => (hasSearch ? searchTokens(debouncedSearch) : []), [hasSearch, debouncedSearch]);
  const phoneQuery = useMemo(() => (hasSearch ? parsePhoneQuery(debouncedSearch) : null), [hasSearch, debouncedSearch]);

  // Back to the top whenever the result set changes underneath the user.
  const queryKey = `${debouncedSearch.trim()}|${JSON.stringify(filters)}`;
  useEffect(() => {
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, [queryKey]);

  const applyBuiltIn = useCallback(
    (id: BuiltInViewId) => {
      setLastViewId(null);
      replaceFilters({ ...BUILTIN_VIEW_FILTERS[id], sortBy: useContactStore.getState().filters.sortBy });
    },
    [replaceFilters],
  );

  const applySaved = useCallback(
    (v: ContactView) => {
      setLastViewId(v.id);
      replaceFilters(fromWebViewFilters(v.filters));
    },
    [replaceFilters],
  );

  const clearFilters = useCallback(() => {
    setLastViewId(null);
    replaceFilters({ ...EMPTY_FILTERS, sortBy: useContactStore.getState().filters.sortBy });
  }, [replaceFilters]);

  const openSaveDialog = useCallback(() => {
    setMenuVisible(false);
    setAdvancedFilterVisible(false);
    setNewViewName('');
    setNewViewVisibility('personal');
    setSaveDialogVisible(true);
  }, []);

  const confirmSaveView = useCallback(async () => {
    const name = newViewName.trim();
    if (!name || savingView) return;
    setSavingView(true);
    try {
      const created = await saveView(name, useContactStore.getState().filters, newViewVisibility);
      setLastViewId(created.id);
      setSaveDialogVisible(false);
    } catch {
      Alert.alert(L('השמירה נכשלה', 'Could not save view'), L('נסה שוב בעוד רגע.', 'Please try again.'));
    } finally {
      setSavingView(false);
    }
  }, [newViewName, savingView, saveView, newViewVisibility, L]);

  const updateLastView = useCallback(async () => {
    if (!lastView) return;
    setMenuVisible(false);
    try {
      await updateView(lastView.id, useContactStore.getState().filters);
    } catch {
      Alert.alert(L('העדכון נכשל', 'Could not update view'));
    }
  }, [lastView, updateView, L]);

  const onViewLongPress = useCallback(
    (v: ContactView) => {
      if (!canEdit(v)) return;
      const buttons: { text: string; style?: 'cancel' | 'destructive'; onPress?: () => void }[] = [];
      const matches = activeSaved?.id === v.id;
      if (!matches) {
        buttons.push({
          text: L('עדכן לפי הסינון הנוכחי', 'Update to current filters'),
          onPress: () => {
            updateView(v.id, useContactStore.getState().filters).catch(() =>
              Alert.alert(L('העדכון נכשל', 'Could not update view')),
            );
          },
        });
      }
      buttons.push({
        text: L('מחק תצוגה', 'Delete view'),
        style: 'destructive',
        onPress: () => {
          Alert.alert(v.name, L('למחוק את התצוגה? היא תימחק גם באתר.', 'Delete this view? It is removed on the web too.'), [
            { text: t('common.cancel'), style: 'cancel' },
            {
              text: t('common.delete'),
              style: 'destructive',
              onPress: () => {
                deleteView(v.id)
                  .then(() => {
                    if (lastViewId === v.id) setLastViewId(null);
                  })
                  .catch(() => Alert.alert(L('המחיקה נכשלה', 'Could not delete view')));
              },
            },
          ]);
        },
      });
      buttons.push({ text: t('common.cancel'), style: 'cancel' });
      Alert.alert(v.name, undefined, buttons);
    },
    [canEdit, activeSaved, updateView, deleteView, lastViewId, L, t],
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    if (organization) {
      await loadContacts(organization, ownScope ? currentUserId : '', ownScope ? 'own' : 'all');
      refreshViews();
    }
    setRefreshing(false);
  }, [organization, loadContacts, ownScope, currentUserId, refreshViews]);

  const handleCall = useCallback(
    (contact: Contact) => {
      swipeableRefs.get(contact.id)?.close();
      if (contact.phoneNumber) {
        placeSmartCall({
          phoneNumber: contact.phoneNumber,
          organization,
          user,
          relatedTo: { type: 'contact', entityId: contact.id, entityName: contact.name },
          contactId: contact.id,
          customerName: contact.name,
        });
      }
    },
    [swipeableRefs, organization, user],
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

  const searchRef = useRef(debouncedSearch);
  searchRef.current = debouncedSearch;
  const openContact = useCallback(
    (contact: Contact) => {
      // Opening a contact from a search = that search was useful: remember it.
      if (searchRef.current.trim().length >= 2) addRecent(searchRef.current);
      router.push({
        pathname: '/(tabs)/contacts/[id]',
        params: { id: contact.id },
      });
    },
    [router, addRecent],
  );

  // Tap a tag badge on a row to filter by it (CRM-style quick filter).
  const filterByTag = useCallback(
    (tag: string) => {
      const cur = useContactStore.getState().filters;
      if (cur.tags.includes(tag)) return;
      setLastViewId(null);
      setStoreFilters({ tags: [...cur.tags, tag] });
    },
    [setStoreFilters],
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

  const hlColor = theme.dark ? 'rgba(250,204,21,0.35)' : '#FEF08A';

  const renderContactItem = useCallback(
    ({ item }: { item: Contact }) => {
      const contactName = item.name || item.phoneNumber || '';
      let tags = extractContactTags(item.keys);
      const isSpam = !!(item as any).isSpam;
      const notAgreed = (item as any).consent === false;
      const spamBase = theme.dark ? 'rgba(220,38,38,0.14)' : '#FFF5F5';
      const spamPressed = theme.dark ? 'rgba(220,38,38,0.22)' : '#FFE8E8';
      const ownerName = ((item as any).ownerName || '').trim();

      const formattedPhone = item.phoneNumber ? formatPhoneNumber(item.phoneNumber) : '';
      const phoneRanges = phoneQuery ? phoneMatchRanges(formattedPhone, phoneQuery.national) : [];
      // Show the owner line only when the search matched the owner (otherwise it would be noise).
      const ownerMatched = tokens.length > 0 && textMatchRanges(ownerName, tokens).length > 0;
      if (tokens.length > 0 && tags.length > 3) {
        // Surface matching tags first so a tag hit is never hidden behind "+N".
        const lowered = tokens.map((x) => x.toLowerCase());
        tags = [...tags].sort(
          (a, b) =>
            Number(lowered.some((x) => b.toLowerCase().includes(x))) -
            Number(lowered.some((x) => a.toLowerCase().includes(x))),
        );
      }

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
                backgroundColor: isSpam
                  ? (pressed ? spamPressed : spamBase)
                  : (pressed ? theme.colors.surfaceVariant : theme.colors.surface),
                flexDirection,
              },
              isSpam ? { borderStartWidth: 3, borderStartColor: '#DC2626' } : null,
            ]}
          >
            <View style={styles.avatarWrap}>
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
              <View style={{ flexDirection, alignItems: 'center', gap: 6, width: '100%' }}>
                <HighlightText
                  variant="titleMedium"
                  numberOfLines={1}
                  text={contactName}
                  tokens={tokens}
                  highlightColor={hlColor}
                  style={{ color: theme.colors.onSurface, textAlign, fontWeight: isSpam ? '700' : '600', flexShrink: 1 }}
                />
                {isSpam ? (
                  <View style={{ backgroundColor: '#DC2626', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 1 }}>
                    <Text style={{ color: '#FFF', fontSize: 10, fontWeight: '700', letterSpacing: 0.5 }}>
                      {t('contacts.possibleSpam', 'ספאם')}
                    </Text>
                  </View>
                ) : null}
                {!isSpam && notAgreed ? (
                  <View style={{ backgroundColor: '#FEF3C7', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 1, flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                    <MaterialCommunityIcons name="cancel" size={11} color="#D97706" />
                    <Text style={{ color: '#D97706', fontSize: 10, fontWeight: '700' }}>
                      {t('contacts.consentNotAgreed', 'לא הסכים')}
                    </Text>
                  </View>
                ) : null}
              </View>

              <View style={[styles.metaRow, { flexDirection }]}>
                {formattedPhone ? (
                  <HighlightText
                    variant="bodySmall"
                    text={formattedPhone}
                    ranges={phoneRanges}
                    highlightColor={hlColor}
                    style={{ color: theme.colors.onSurfaceVariant, textAlign }}
                  />
                ) : null}
                {item.email ? (
                  <>
                    <Text style={{ color: theme.colors.onSurfaceVariant, marginHorizontal: 6 }}>
                      •
                    </Text>
                    <HighlightText
                      variant="bodySmall"
                      numberOfLines={1}
                      text={item.email}
                      tokens={tokens}
                      highlightColor={hlColor}
                      style={{ color: theme.colors.onSurfaceVariant, flexShrink: 1, textAlign }}
                    />
                  </>
                ) : null}
              </View>

              {ownerMatched ? (
                <View style={[styles.metaRow, { flexDirection, gap: 4 }]}>
                  <MaterialCommunityIcons name="account-outline" size={13} color={theme.colors.onSurfaceVariant} />
                  <HighlightText
                    variant="bodySmall"
                    numberOfLines={1}
                    text={ownerName}
                    tokens={tokens}
                    highlightColor={hlColor}
                    style={{ color: theme.colors.onSurfaceVariant, textAlign }}
                  />
                </View>
              ) : null}

              {tags.length > 0 ? (
                <View style={[styles.tagsRow, { flexDirection, flexWrap: 'wrap', justifyContent: 'flex-start', width: '100%' }]}>
                  {tags.slice(0, 3).map((tag) => (
                    <Pressable key={tag} onPress={() => filterByTag(tag)} hitSlop={4} style={styles.tagBadge}>
                      <HighlightText
                        text={`#${tag}`}
                        tokens={tokens}
                        highlightColor={hlColor}
                        numberOfLines={1}
                        style={styles.tagBadgeText}
                      />
                    </Pressable>
                  ))}
                  {tags.length > 3 ? (
                    <View style={[styles.tagBadge, { backgroundColor: 'rgba(108,117,125,0.15)', borderColor: 'rgba(108,117,125,0.35)' }]}>
                      <Text style={[styles.tagBadgeText, { color: '#6c757d' }]}>+{tags.length - 3}</Text>
                    </View>
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
    [theme, isRTL, textAlign, flexDirection, openContact, renderSwipeActions, swipeableRefs, t, tokens, phoneQuery, hlColor, filterByTag],
  );

  const renderEmpty = useCallback(
    () => (
      <View style={styles.emptyWrap}>
        <MaterialCommunityIcons
          name={hasSearch || activeGroups > 0 ? 'magnify-close' : 'account-group-outline'}
          size={72}
          color={theme.colors.onSurfaceVariant}
          style={{ opacity: 0.35 }}
        />
        {hasSearch || activeGroups > 0 ? (
          <>
            <Text variant="titleMedium" style={{ color: theme.colors.onSurface, fontWeight: '600', marginTop: 12, textAlign: 'center' }}>
              {L('לא נמצאו אנשי קשר', 'No contacts found')}
            </Text>
            <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center', marginTop: 4 }}>
              {L('נסה לשנות את החיפוש או את הסינון', 'Try a different search or filter')}
            </Text>
            <Button
              mode="outlined"
              style={{ marginTop: 16 }}
              onPress={() => {
                setSearchInput('');
                clearFilters();
              }}
            >
              {L('נקה חיפוש וסינון', 'Clear search & filters')}
            </Button>
          </>
        ) : (
          <>
            <Text variant="titleMedium" style={{ color: theme.colors.onSurface, fontWeight: '600', marginTop: 12 }}>
              {t('contacts.noContacts')}
            </Text>
            <Text
              variant="bodyMedium"
              style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center', marginTop: 4 }}
            >
              {t('contacts.addContact')}
            </Text>
          </>
        )}
      </View>
    ),
    [theme, t, L, hasSearch, activeGroups, clearFilters],
  );

  // ── View tabs ───────────────────────────────────────────────────────────────────────────────
  const builtInLabel = useCallback(
    (id: BuiltInViewId) => {
      switch (id) {
        case '__all': return t('common.all');
        case '__mine': return t('contacts.myContacts');
        case '__unassigned': return L('ללא אחראי', 'Unassigned');
        case '__new': return L('חדשים השבוע', 'New this week');
        case '__unread': return L('לא נקראו', 'Unread');
        case '__optedout': return L('הוסרו / לא הסכימו', 'Opted out');
      }
    },
    [t, L],
  );

  // Show a built-in tab only when it can have data (and "Mine"/"Unassigned" only when the user
  // can see other people's contacts); the active one is always kept visible.
  const builtInTabs = useMemo(
    () =>
      BUILTIN_ORDER.filter((id) => {
        if (id === activeBuiltIn || id === '__all') return true;
        if (id === '__mine') return !ownScope && !!currentUserId;
        if (id === '__unassigned') return !ownScope && viewCounts.__unassigned > 0;
        return viewCounts[id] > 0;
      }),
    [activeBuiltIn, ownScope, currentUserId, viewCounts],
  );

  // ── Active-filter chips ─────────────────────────────────────────────────────────────────────
  const describeDate = useCallback(
    (d: DateFilter): string => {
      const n = d.daysValue;
      switch (d.operator) {
        case 'is_today': return L('היום', 'Today');
        case 'is_yesterday': return L('אתמול', 'Yesterday');
        case 'is_in_last_x_days': return L(`${n} ימים אחרונים`, `Last ${n} days`);
        case 'not_in_last_x_days': return L(`ללא פעילות ${n} ימים`, `Inactive ${n} days`);
        case 'x_days_ago': return L(`לפני ${n} ימים`, `${n} days ago`);
        case 'before': return L(`לפני ${d.startDate}`, `Before ${d.startDate}`);
        case 'after': return L(`אחרי ${d.startDate}`, `After ${d.startDate}`);
        case 'equals': return d.startDate;
        default: return `${d.startDate || '…'} → ${d.endDate || '…'}`;
      }
    },
    [L],
  );

  const filterChips = useMemo(() => {
    const chips: { key: string; label: string; clear: Partial<ContactFilterState> }[] = [];
    const f = filters;
    if (f.mine || f.unassigned || f.owners.length > 0) {
      const parts: string[] = [];
      if (f.mine) parts.push(L('שלי', 'Mine'));
      if (f.unassigned) parts.push(L('ללא אחראי', 'Unassigned'));
      if (f.owners.length === 1) parts.push(f.owners[0]);
      else if (f.owners.length > 1) parts.push(L(`${f.owners.length} אחראים`, `${f.owners.length} owners`));
      chips.push({ key: 'owner', label: parts.join(', '), clear: { mine: false, unassigned: false, owners: [] } });
    }
    if (f.tags.length > 0) {
      const sep = f.tagsOperator === 'all' ? ' + ' : ' | ';
      const body = f.tags.length <= 2 ? f.tags.map((x) => `#${x}`).join(sep) : L(`${f.tags.length} תגיות`, `${f.tags.length} tags`);
      chips.push({
        key: 'tags',
        label: (f.tagsOperator === 'none' ? L('ללא ', 'Not ') : '') + body,
        clear: { tags: [], tagsOperator: 'any' },
      });
    }
    if (f.consent.length > 0) chips.push({ key: 'consent', label: L(`הסכמה (${f.consent.length})`, `Consent (${f.consent.length})`), clear: { consent: [] } });
    if (f.convStatus.length > 0) chips.push({ key: 'conv', label: L(`סטטוס שיחה (${f.convStatus.length})`, `Conversation (${f.convStatus.length})`), clear: { convStatus: [] } });
    if (f.created) chips.push({ key: 'created', label: `${L('נוצר', 'Created')}: ${describeDate(f.created)}`, clear: { created: null } });
    if (f.activity) chips.push({ key: 'activity', label: `${L('פעילות', 'Activity')}: ${describeDate(f.activity)}`, clear: { activity: null } });
    if (f.hasEmail !== null) chips.push({ key: 'email', label: f.hasEmail ? L('יש אימייל', 'Has email') : L('ללא אימייל', 'No email'), clear: { hasEmail: null } });
    if (f.unread) chips.push({ key: 'unread', label: L('לא נקראו', 'Unread'), clear: { unread: false } });
    return chips;
  }, [filters, L, describeDate]);

  const sortLabel = useCallback(
    (s: ContactSort) =>
      s === 'name'
        ? t('contacts.name', L('שם', 'Name'))
        : s === 'createdOn'
          ? t('contacts.createdAt', L('תאריך יצירה', 'Created'))
          : L('פעילות אחרונה', 'Last activity'),
    [t, L],
  );

  const countShown = assignedNums.length > 0 ? filteredContacts.length : totalCount;
  const countLabel = `${countShown.toLocaleString()}${assignedNums.length > 0 && hasMore ? '+' : ''} ${
    countShown === 1 ? L('איש קשר', 'contact') : L('אנשי קשר', 'contacts')
  }`;

  const headerIcon = theme.custom.headerText;

  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
      {/* Header: title + filters + one overflow menu */}
      <View
        style={[
          styles.header,
          { backgroundColor: theme.custom.headerBackground, paddingTop: insets.top + 8 },
        ]}
      >
        <Text style={styles.headerTitle}>{t('contacts.title')}</Text>
        <View style={{ flexDirection: 'row', gap: 4, alignItems: 'center' }}>
          <Pressable
            onPress={() => setAdvancedFilterVisible(true)}
            hitSlop={8}
            accessibilityLabel={L('סינון', 'Filters')}
            style={({ pressed }) => [styles.headerBtn, pressed && { opacity: 0.7 }]}
          >
            <MaterialCommunityIcons name="filter-variant" size={24} color={headerIcon} />
            {filterBadge > 0 ? (
              <View style={[styles.badge, { backgroundColor: theme.colors.error }]}>
                <Text style={styles.badgeText}>{filterBadge}</Text>
              </View>
            ) : null}
          </Pressable>

          <Menu
            visible={menuVisible}
            onDismiss={() => setMenuVisible(false)}
            anchorPosition="bottom"
            anchor={
              <Pressable
                onPress={() => setMenuVisible(true)}
                hitSlop={8}
                accessibilityLabel={L('עוד פעולות', 'More')}
                style={({ pressed }) => [styles.headerBtn, pressed && { opacity: 0.7 }]}
              >
                <MaterialCommunityIcons name="dots-vertical" size={24} color={headerIcon} />
              </Pressable>
            }
          >
            <Menu.Item
              title={L('מיון: ', 'Sort: ') + sortLabel('')}
              leadingIcon={filters.sortBy === '' ? 'check' : 'sort'}
              onPress={() => { setMenuVisible(false); setStoreFilters({ sortBy: '' }); }}
            />
            <Menu.Item
              title={L('מיון: ', 'Sort: ') + sortLabel('name')}
              leadingIcon={filters.sortBy === 'name' ? 'check' : 'sort-alphabetical-ascending'}
              onPress={() => { setMenuVisible(false); setStoreFilters({ sortBy: 'name' }); }}
            />
            <Menu.Item
              title={L('מיון: ', 'Sort: ') + sortLabel('createdOn')}
              leadingIcon={filters.sortBy === 'createdOn' ? 'check' : 'calendar-plus'}
              onPress={() => { setMenuVisible(false); setStoreFilters({ sortBy: 'createdOn' }); }}
            />
            <Divider />
            <Menu.Item
              title={L('הודעות פנימיות', 'Internal messages')}
              leadingIcon="message-text-outline"
              onPress={() => { setMenuVisible(false); setInternalHubVisible(true); }}
            />
            <Menu.Item
              title={L('הערות', 'Notes')}
              leadingIcon="note-text-outline"
              onPress={() => { setMenuVisible(false); setNotesHubVisible(true); }}
            />
            {isCustom || filters.sortBy ? <Divider /> : null}
            {isCustom || filters.sortBy ? (
              <Menu.Item title={L('שמור כתצוגה', 'Save as view')} leadingIcon="content-save-outline" onPress={openSaveDialog} />
            ) : null}
            {canUpdateLastView && lastView ? (
              <Menu.Item
                title={L(`עדכן את "${lastView.name}"`, `Update "${lastView.name}"`)}
                leadingIcon="content-save-edit-outline"
                onPress={updateLastView}
              />
            ) : null}
            {activeGroups > 0 ? (
              <Menu.Item
                title={L('נקה סינון', 'Clear filters')}
                leadingIcon="filter-remove-outline"
                onPress={() => { setMenuVisible(false); clearFilters(); }}
              />
            ) : null}
          </Menu>
        </View>
      </View>

      {/* Always-visible search */}
      <View style={[styles.searchWrap, { backgroundColor: theme.custom.headerBackground }]}>
        <Searchbar
          placeholder={L('חיפוש שם, טלפון, אימייל, תגית...', 'Search name, phone, email, tag...')}
          value={searchInput}
          onChangeText={setSearchInput}
          returnKeyType="search"
          onSubmitEditing={() => addRecent(searchInput)}
          onFocus={() => {
            if (blurTimer.current) clearTimeout(blurTimer.current);
            setSearchFocused(true);
          }}
          onBlur={() => {
            if (blurTimer.current) clearTimeout(blurTimer.current);
            blurTimer.current = setTimeout(() => setSearchFocused(false), 200);
          }}
          style={[styles.searchbar, { backgroundColor: theme.colors.surface }]}
          inputStyle={{ fontSize: 14, textAlign: isRTL ? 'right' : 'left', paddingVertical: 0, alignSelf: 'center', minHeight: 0 }}
          iconColor={theme.colors.onSurfaceVariant}
        />
      </View>

      {/* Recent searches (focused + empty) */}
      {searchFocused && searchInput.length === 0 && recent.length > 0 ? (
        <View style={[styles.recentWrap, { backgroundColor: theme.colors.surface, borderBottomColor: theme.colors.outlineVariant }]}>
          <View style={{ flexDirection, alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingTop: 8 }}>
            <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 12, fontWeight: '600' }}>
              {L('חיפושים אחרונים', 'Recent searches')}
            </Text>
            <Pressable onPress={clearRecent} hitSlop={8}>
              <Text style={{ color: theme.colors.primary, fontSize: 12 }}>{L('נקה', 'Clear')}</Text>
            </Pressable>
          </View>
          <ScrollView
            horizontal
            keyboardShouldPersistTaps="always"
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={[styles.filterChips, { flexDirection, paddingStart: 18, paddingEnd: 18 }]}
          >
            {recent.map((term) => (
              <Chip
                key={term}
                compact
                icon="history"
                onPress={() => setSearchInput(term)}
                onClose={() => removeRecent(term)}
                style={{ backgroundColor: theme.colors.surfaceVariant }}
                textStyle={styles.filterChipText}
              >
                {term}
              </Chip>
            ))}
          </ScrollView>
        </View>
      ) : null}

      {/* Views as tabs: built-ins + saved views (synced with the web) */}
      <View style={[styles.filtersContainer, { backgroundColor: theme.colors.surface, borderBottomColor: theme.colors.outline }]}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[styles.filterChips, { flexDirection, paddingStart: 18, paddingEnd: 18 }]}
        >
          {builtInTabs.map((id) => {
            const active = activeBuiltIn === id;
            const count = viewCounts[id];
            return (
              <Chip
                key={id}
                selected={active}
                onPress={() => applyBuiltIn(id)}
                showSelectedOverlay
                compact
                style={[styles.filterChip, { backgroundColor: active ? theme.colors.primaryContainer : theme.colors.surfaceVariant }]}
                textStyle={[styles.filterChipText, active && { color: theme.colors.primary, fontWeight: '600' }]}
              >
                {builtInLabel(id)}
                {count > 0 ? `  ${count.toLocaleString()}` : ''}
              </Chip>
            );
          })}
          {parsedViews.map(({ view }) => {
            const active = activeSaved?.id === view.id;
            return (
              <Chip
                key={view.id}
                selected={active}
                icon={view.visibility === 'personal' ? 'bookmark-outline' : 'account-group-outline'}
                onPress={() => applySaved(view)}
                onLongPress={() => onViewLongPress(view)}
                showSelectedOverlay
                compact
                style={[styles.filterChip, { backgroundColor: active ? theme.colors.primaryContainer : theme.colors.surfaceVariant }]}
                textStyle={[styles.filterChipText, active && { color: theme.colors.primary, fontWeight: '600' }]}
              >
                {view.name}
              </Chip>
            );
          })}
        </ScrollView>

        {/* Result count + quick actions */}
        <View style={[styles.countRow, { flexDirection }]}>
          <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 12, fontWeight: '600', textAlign }}>
            {countLabel}
            {filters.sortBy ? `  ·  ${sortLabel(filters.sortBy)}` : ''}
          </Text>
          <View style={{ flexDirection, gap: 14, alignItems: 'center' }}>
            {isCustom ? (
              <Pressable onPress={openSaveDialog} hitSlop={8}>
                <Text style={{ color: theme.colors.primary, fontSize: 12, fontWeight: '600' }}>
                  {L('שמור תצוגה', 'Save view')}
                </Text>
              </Pressable>
            ) : null}
            {activeGroups > 0 ? (
              <Pressable onPress={clearFilters} hitSlop={8}>
                <Text style={{ color: theme.colors.error, fontSize: 12, fontWeight: '600' }}>
                  {L('נקה סינון', 'Clear')}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>

        {/* Active filters as removable chips */}
        {isCustom && filterChips.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={[styles.tagFilterChips, { flexDirection, paddingStart: 18, paddingEnd: 18 }]}
          >
            {filterChips.map((c) => (
              <Chip
                key={c.key}
                compact
                onPress={() => setAdvancedFilterVisible(true)}
                onClose={() => {
                  setStoreFilters(c.clear);
                }}
                style={[styles.tagFilterChip, { backgroundColor: theme.colors.primaryContainer }]}
                textStyle={[styles.filterChipText, { color: theme.colors.onPrimaryContainer, lineHeight: 16 }]}
              >
                {c.label}
              </Chip>
            ))}
          </ScrollView>
        ) : null}
      </View>

      {isLoading && contacts.length === 0 ? (
        <View style={[styles.centered, { flex: 1 }]}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      ) : (
        <FlashList
          ref={listRef}
          data={filteredContacts}
          renderItem={renderContactItem}
          keyExtractor={(item) => item.id}
          ItemSeparatorComponent={ContactDivider}
          ListEmptyComponent={renderEmpty}
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          ListFooterComponent={
            isLoadingMore ? (
              <View style={{ paddingVertical: 16 }}>
                <ActivityIndicator size="small" color={theme.colors.primary} />
              </View>
            ) : null
          }
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
      )}

      <FAB
        icon="account-plus"
        onPress={() => router.push({ pathname: '/(tabs)/contacts/[id]', params: { id: 'new' } })}
        style={[styles.fab, { backgroundColor: theme.colors.primary, bottom: insets.bottom + 16, left: isRTL ? 16 : undefined, right: isRTL ? undefined : 16 }]}
        color="#FFF"
      />

      <ContactFiltersSheet
        visible={advancedFilterVisible}
        onDismiss={() => setAdvancedFilterVisible(false)}
        filters={filters}
        onChange={setStoreFilters}
        onClearAll={clearFilters}
        onSaveView={openSaveDialog}
        resultCount={countShown}
        owners={allOwners}
        tags={allTags}
        showOwnerFilters={!ownScope}
        canFilterMine={!!currentUserId}
      />

      {/* Save-as-view dialog */}
      <Portal>
        <Modal
          visible={saveDialogVisible}
          onDismiss={() => setSaveDialogVisible(false)}
          contentContainerStyle={[styles.saveModal, { backgroundColor: theme.colors.surface }]}
        >
          <Text variant="titleMedium" style={{ color: theme.colors.onSurface, fontWeight: '700', textAlign, marginBottom: 12 }}>
            {L('שמירת תצוגה', 'Save view')}
          </Text>
          <TextInput
            mode="outlined"
            autoFocus
            value={newViewName}
            onChangeText={setNewViewName}
            placeholder={L('שם התצוגה', 'View name')}
            style={{ textAlign }}
            onSubmitEditing={confirmSaveView}
            returnKeyType="done"
          />
          {filterChips.length > 0 || filters.sortBy ? (
            <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 12, marginTop: 8, textAlign }}>
              {[...filterChips.map((c) => c.label), filters.sortBy ? `${L('מיון', 'Sort')}: ${sortLabel(filters.sortBy)}` : '']
                .filter(Boolean)
                .join('  ·  ')}
            </Text>
          ) : null}
          {userIsAdmin ? (
            <View style={{ flexDirection, gap: 8, marginTop: 12 }}>
              <Chip
                selected={newViewVisibility === 'personal'}
                showSelectedCheck={false}
                icon="lock-outline"
                compact
                onPress={() => setNewViewVisibility('personal')}
                style={{ backgroundColor: newViewVisibility === 'personal' ? theme.colors.primaryContainer : theme.colors.surfaceVariant }}
              >
                {L('אישי', 'Personal')}
              </Chip>
              <Chip
                selected={newViewVisibility === 'shared'}
                showSelectedCheck={false}
                icon="account-group-outline"
                compact
                onPress={() => setNewViewVisibility('shared')}
                style={{ backgroundColor: newViewVisibility === 'shared' ? theme.colors.primaryContainer : theme.colors.surfaceVariant }}
              >
                {L('משותף לכולם', 'Shared with everyone')}
              </Chip>
            </View>
          ) : null}
          <View style={{ flexDirection: 'row', gap: 12, justifyContent: 'flex-end', marginTop: 16 }}>
            <Button mode="text" onPress={() => setSaveDialogVisible(false)} textColor={theme.colors.onSurface}>
              {t('common.cancel')}
            </Button>
            <Button
              mode="contained"
              onPress={confirmSaveView}
              disabled={!newViewName.trim() || savingView}
              loading={savingView}
              buttonColor={theme.colors.primary}
              textColor="#FFF"
            >
              {L('שמור', 'Save')}
            </Button>
          </View>
        </Modal>
      </Portal>

      <InternalMessagesHub
        visible={internalHubVisible}
        onClose={() => setInternalHubVisible(false)}
      />

      <NotesHub
        visible={notesHubVisible}
        onClose={() => setNotesHubVisible(false)}
      />
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
    paddingBottom: 8,
  },
  headerTitle: { fontSize: 22, fontWeight: '700', color: '#FFF' },
  headerBtn: { padding: 4 },
  badge: {
    position: 'absolute',
    top: -2,
    end: -4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#FFF', fontSize: 10, fontWeight: '700' },
  searchWrap: {
    paddingHorizontal: 14,
    paddingBottom: 10,
    justifyContent: 'center',
  },
  searchbar: { height: 44, borderRadius: 22, elevation: 0, justifyContent: 'center' },
  recentWrap: { borderBottomWidth: StyleSheet.hairlineWidth, paddingBottom: 2 },
  filtersContainer: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
  },
  filterChips: {
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  filterChip: { minHeight: 30 },
  filterChipText: { fontSize: 12, lineHeight: 16 },
  countRow: {
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingBottom: 6,
  },
  tagFilterChips: {
    gap: 6,
    paddingBottom: 8,
    paddingHorizontal: 4,
    alignItems: 'center',
  },
  tagFilterChip: { minHeight: 30 },
  listContent: { paddingBottom: 100 },
  contactRow: {
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 14,
  },
  avatarWrap: { position: 'relative' },
  contactBody: { flex: 1, justifyContent: 'center', gap: 2 },
  metaRow: { alignItems: 'center', marginTop: 2 },
  tagsRow: { alignItems: 'center', gap: 5, marginTop: 5 },
  tagBadge: {
    backgroundColor: 'rgba(46,97,85,0.15)',
    borderColor: 'rgba(46,97,85,0.4)',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
    maxWidth: 130,
  },
  tagBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#2e6155',
  },
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
  fab: { position: 'absolute', borderRadius: 16 },
  saveModal: {
    marginHorizontal: 24,
    borderRadius: 16,
    padding: 20,
  },
});
