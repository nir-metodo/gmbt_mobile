import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  View,
  StyleSheet,
  Pressable,
  RefreshControl,
  Linking,
  Alert,
  ScrollView,
  BackHandler,
} from 'react-native';
import * as Haptics from 'expo-haptics';
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
  Snackbar,
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
import { formatPhoneNumber, formatRelativeTime, getInitials, withAlpha } from '../../../utils/formatters';
import { useMultiSelect, SelectCheck, SelectionHeader, BulkActionBar, type BulkAction } from '../../../components/MultiSelect';
import { BulkTagsSheet, BulkStatusSheet, BulkOwnerSheet, BulkSendSheet } from '../../../components/contacts/ContactBulkSheets';
import { contactsApi } from '../../../services/api/contacts';
import { chatsApi } from '../../../services/api/chats';
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
  makeDateFilter,
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

const ContactDivider = () => <Divider style={{ marginStart: 70 }} />;

const BUILTIN_ORDER: BuiltInViewId[] = ['__all', '__mine', '__unassigned', '__new', '__unread', '__optedout'];

const OWNER_COLORS = ['#2e6155', '#3b82f6', '#8b5cf6', '#f97316', '#0891b2', '#db2777', '#65a30d', '#d97706'];

const STATUS_META: Record<string, { color: string; he: string; en: string }> = {
  Open: { color: '#16a34a', he: 'פתוח', en: 'Open' },
  'In Process': { color: '#f59e0b', he: 'בטיפול', en: 'In process' },
  Closed: { color: '#6b7280', he: 'סגור', en: 'Closed' },
};

function normalizeStatus(raw: any): '' | 'Open' | 'In Process' | 'Closed' {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return '';
  if (s === 'open') return 'Open';
  if (s === 'in process') return 'In Process';
  return 'Closed';
}

// Small coloured owner initials bubble (same idea as the leads list).
function OwnerBubble({ name, size = 22 }: { name?: string; size?: number }) {
  const n = (name || '').trim();
  if (!n) return null;
  let hash = 0;
  for (let i = 0; i < n.length; i++) hash = (hash * 31 + n.charCodeAt(i)) >>> 0;
  return (
    <Avatar.Text
      size={size}
      label={getInitials(n)}
      style={{ backgroundColor: OWNER_COLORS[hash % OWNER_COLORS.length] }}
      labelStyle={{ fontSize: size * 0.42, lineHeight: size * 0.5, color: '#fff' }}
    />
  );
}

// One-tap filter pill used by the quick-filter row (mirrors the leads screen).
function QuickChip({
  theme,
  icon,
  label,
  color,
  active,
  onPress,
  count,
  caret,
}: {
  theme: any;
  icon: string;
  label: string;
  color: string;
  active?: boolean;
  onPress: () => void;
  count?: number;
  caret?: boolean;
}) {
  const fg = active ? color : theme.colors.onSurfaceVariant;
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.quickChip,
        {
          backgroundColor: active ? withAlpha(color, 0.14) : theme.colors.surfaceVariant,
          borderColor: active ? color : 'transparent',
        },
      ]}
    >
      <MaterialCommunityIcons name={icon as any} size={14} color={fg} />
      <Text style={{ fontSize: 12, fontWeight: active ? '700' : '500', color: fg }} numberOfLines={1}>
        {label}
      </Text>
      {count != null && count > 0 ? (
        <View style={{ backgroundColor: color, borderRadius: 8, minWidth: 16, paddingHorizontal: 4, alignItems: 'center' }}>
          <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>{count > 999 ? '999+' : count}</Text>
        </View>
      ) : null}
      {caret ? <MaterialCommunityIcons name="chevron-down" size={14} color={fg} /> : null}
    </Pressable>
  );
}

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
  const addOrUpdateContact = useContactStore((s) => s.addOrUpdateContact);

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

  // ── Multi-select (long-press a row) ─────────────────────────────────────────────────────────
  const sel = useMultiSelect();
  const clearSelection = sel.clear;
  const [bulkSheet, setBulkSheet] = useState<null | 'tags' | 'status' | 'owner' | 'send'>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  const [snack, setSnack] = useState('');
  // Keeps the selected Contact objects even if the visible window changes (search / filter / paging).
  const selectedCacheRef = useRef(new Map<string, Contact>());

  // Selection never survives leaving the screen.
  useFocusEffect(useCallback(() => () => clearSelection(), [clearSelection]));

  // Android back button exits selection first.
  useEffect(() => {
    if (!sel.active) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      clearSelection();
      return true;
    });
    return () => subscription.remove();
  }, [sel.active, clearSelection]);

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
  // The "New this week" tab is one self-explanatory filter, so the badge only counts "extra" filters.
  const isCustom = activeGroups > 0 && activeBuiltIn !== '__new';
  const filterBadge = isCustom ? activeGroups : 0;
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

  // ── Bulk actions ────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const cache = selectedCacheRef.current;
    const ids = new Set(sel.ids);
    Array.from(cache.keys()).forEach((k) => {
      if (!ids.has(k)) cache.delete(k);
    });
    contacts.forEach((c) => {
      if (ids.has(c.id)) cache.set(c.id, c);
    });
  }, [sel.ids, contacts]);

  const getSelectedContacts = useCallback((): Contact[] => {
    const byId = new Map(contacts.map((c) => [c.id, c] as const));
    return sel.ids
      .map((id) => byId.get(id) ?? selectedCacheRef.current.get(id))
      .filter((c): c is Contact => !!c);
  }, [contacts, sel.ids]);

  const userName = user?.fullname || (user as any)?.name || '';

  // Runs `fn` for every selected contact (4 at a time), shows progress, then a summary, and clears
  // the selection. `fn` must throw on failure.
  const runBulk = useCallback(
    async (doneText: (n: number) => string, fn: (c: Contact) => Promise<void>) => {
      const targets = getSelectedContacts();
      if (targets.length === 0) {
        clearSelection();
        return;
      }
      setBulkBusy(true);
      setBulkProgress({ done: 0, total: targets.length });
      let ok = 0;
      let failed = 0;
      const queue = [...targets];
      const worker = async () => {
        while (queue.length > 0) {
          const c = queue.shift()!;
          try {
            await fn(c);
            ok++;
          } catch {
            failed++;
          }
          setBulkProgress({ done: ok + failed, total: targets.length });
        }
      };
      await Promise.all(Array.from({ length: Math.min(4, targets.length) }, worker));
      setBulkBusy(false);
      setBulkProgress(null);
      clearSelection();
      const st = useContactStore.getState();
      st.refreshViewCounts();
      st.refreshFacets();
      if (failed > 0) {
        Alert.alert(doneText(ok), L(`${failed} אנשי קשר נכשלו`, `${failed} contacts failed`));
      } else {
        setSnack(doneText(ok));
      }
    },
    [getSelectedContacts, clearSelection, L],
  );

  const bulkApplyTags = useCallback(
    (op: 'add' | 'remove', tags: string[]) => {
      setBulkSheet(null);
      if (!organization || tags.length === 0) return;
      runBulk(
        (n) => L(`עודכנו ${n} אנשי קשר`, `${n} contacts updated`),
        async (c) => {
          const current = extractContactTags(c.keys);
          const next =
            op === 'add' ? Array.from(new Set([...current, ...tags])) : current.filter((x) => !tags.includes(x));
          if (next.length === current.length && next.every((x, i) => x === current[i])) return;
          // Same format the contact form saves ("a#b#c").
          const updated = { ...c, keys: next.join('#') } as Contact;
          await contactsApi.update(organization, updated, currentUserId, userName);
          addOrUpdateContact(updated);
        },
      );
    },
    [organization, runBulk, L, currentUserId, userName, addOrUpdateContact],
  );

  const bulkApplyStatus = useCallback(
    (status: string) => {
      setBulkSheet(null);
      if (!organization) return;
      runBulk(
        (n) => L(`עודכנו ${n} אנשי קשר`, `${n} contacts updated`),
        async (c) => {
          await chatsApi.updateConversationStatus(organization, c.phoneNumber || c.id, status, currentUserId);
          addOrUpdateContact({ ...c, lastConversationStatus: status } as Contact);
        },
      );
    },
    [organization, runBulk, L, currentUserId, addOrUpdateContact],
  );

  const bulkApplyOwner = useCallback(
    (ownerId: string, ownerName: string) => {
      setBulkSheet(null);
      if (!organization) return;
      runBulk(
        (n) => L(`עודכנו ${n} אנשי קשר`, `${n} contacts updated`),
        async (c) => {
          const res = await contactsApi.updateOwner(organization, c.phoneNumber || c.id, ownerId, userName);
          if (res === false || res?.success === false || res?.Success === false) throw new Error('owner update failed');
          addOrUpdateContact({ ...c, ownerId, ownerName } as Contact);
        },
      );
    },
    [organization, runBulk, L, userName, addOrUpdateContact],
  );

  const bulkDelete = useCallback(() => {
    if (!organization || !userIsAdmin) return;
    const n = sel.count;
    Alert.alert(
      L('מחיקת אנשי קשר', 'Delete contacts'),
      L(`להעביר ${n} אנשי קשר לסל המחזור?`, `Move ${n} contacts to the recycle bin?`),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: () =>
            runBulk(
              (cnt) => L(`נמחקו ${cnt} אנשי קשר`, `${cnt} contacts deleted`),
              async (c) => {
                await deleteContact(organization, c.id);
              },
            ),
        },
      ],
    );
  }, [organization, userIsAdmin, sel.count, L, t, runBulk, deleteContact]);

  const onSendDone = useCallback(
    (ok: number, failed: number) => {
      setBulkSheet(null);
      clearSelection();
      if (failed > 0) {
        Alert.alert(
          L(`נשלחו ${ok} הודעות`, `${ok} messages sent`),
          L(`${failed} נכשלו (ייתכן מחוץ לחלון 24 שעות או ללא מספר טלפון)`, `${failed} failed (maybe outside the 24h window or no phone)`),
        );
      } else {
        setSnack(L(`נשלחו ${ok} הודעות`, `${ok} messages sent`));
      }
    },
    [clearSelection, L],
  );

  const bulkActions = useMemo<BulkAction[]>(() => {
    const actions: BulkAction[] = [
      { key: 'tags', icon: 'tag-multiple-outline', label: L('תגית', 'Tag'), onPress: () => setBulkSheet('tags') },
      { key: 'status', icon: 'swap-horizontal', label: L('סטטוס', 'Status'), onPress: () => setBulkSheet('status') },
      { key: 'send', icon: 'whatsapp', label: L('שלח הודעה', 'Send'), onPress: () => setBulkSheet('send'), color: '#25D366' },
    ];
    if (!ownScope) {
      actions.push({ key: 'owner', icon: 'account-arrow-left-outline', label: L('בעלים', 'Owner'), onPress: () => setBulkSheet('owner') });
    }
    if (userIsAdmin) {
      actions.push({ key: 'delete', icon: 'delete-outline', label: L('מחק', 'Delete'), onPress: bulkDelete, color: '#ef4444' });
    }
    return actions;
  }, [L, ownScope, userIsAdmin, bulkDelete]);

  const tagsOnSelected = useMemo(() => {
    if (bulkSheet !== 'tags') return [] as string[];
    const set = new Set<string>();
    getSelectedContacts().forEach((c) => extractContactTags(c.keys).forEach((x) => set.add(x)));
    return Array.from(set);
  }, [bulkSheet, getSelectedContacts]);

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
      const ownerName = ((item as any).ownerName || '').trim();
      const unread = (item as any).isRead === false;
      const status = normalizeStatus((item as any).lastConversationStatus || (item as any).conversationStatus);
      const statusMeta = status ? STATUS_META[status] : null;
      const stripeColor = isSpam
        ? '#DC2626'
        : notAgreed
          ? '#D97706'
          : statusMeta
            ? statusMeta.color
            : withAlpha(theme.colors.outline, 0.45);

      const selecting = sel.active;
      const checked = selecting && sel.isSelected(item.id);

      const formattedPhone = item.phoneNumber ? formatPhoneNumber(item.phoneNumber) : '';
      const phoneRanges = phoneQuery ? phoneMatchRanges(formattedPhone, phoneQuery.national) : [];
      const company = String((item as any).companyName || (item as any).company || '').trim();
      const email = String(item.email || '').trim();
      // Secondary text next to the phone: the e-mail when the search matched it (so the hit is
      // never hidden), otherwise the company, otherwise the e-mail.
      const emailMatched = tokens.length > 0 && textMatchRanges(email, tokens).length > 0;
      const secondary = emailMatched || !company ? email : company;
      // Show the owner line only when the search matched the owner (otherwise it would be noise).
      const ownerMatched = tokens.length > 0 && textMatchRanges(ownerName, tokens).length > 0;
      if (tokens.length > 0 && tags.length > 2) {
        // Surface matching tags first so a tag hit is never hidden behind "+N".
        const lowered = tokens.map((x) => x.toLowerCase());
        tags = [...tags].sort(
          (a, b) =>
            Number(lowered.some((x) => b.toLowerCase().includes(x))) -
            Number(lowered.some((x) => a.toLowerCase().includes(x))),
        );
      }

      let activity = '';
      const ts = (item as any).lastMessageTime || item.modifiedOn || item.createdOn;
      if (ts) {
        try {
          activity = formatRelativeTime(String(ts), isRTL ? 'he' : 'en');
        } catch {
          activity = '';
        }
      }
      const lastMessage = unread ? String((item as any).lastMessage || '').trim() : '';

      const rowBg = checked
        ? withAlpha(theme.colors.primary, 0.12)
        : isSpam
          ? theme.dark ? 'rgba(220,38,38,0.14)' : '#FFF5F5'
          : theme.colors.surface;

      const rowContent = (
        <Pressable
          onPress={() => (selecting ? sel.toggle(item.id) : openContact(item))}
          onLongPress={() => {
            if (selecting) return;
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
            swipeableRefs.get(item.id)?.close();
            sel.start(item.id);
          }}
          delayLongPress={400}
          android_ripple={{ color: theme.colors.surfaceVariant }}
          style={({ pressed }) => [
            styles.contactRow,
            { backgroundColor: pressed && !checked ? theme.colors.surfaceVariant : rowBg, flexDirection },
          ]}
        >
          <View style={[styles.stripe, { backgroundColor: stripeColor }]} />

          {selecting ? (
            <View style={{ alignSelf: 'center' }}>
              <SelectCheck checked={checked} />
            </View>
          ) : null}

          <View style={styles.avatarWrap}>
            {item.photoURL ? (
              <Avatar.Image size={44} source={{ uri: item.photoURL }} />
            ) : (
              <Avatar.Text
                size={44}
                label={getInitials(contactName)}
                style={{ backgroundColor: theme.colors.primaryContainer }}
                labelStyle={{ color: theme.colors.primary, fontWeight: '700' }}
              />
            )}
          </View>

          <View style={styles.contactBody}>
            {/* Row 1: name + last activity */}
            <View style={[styles.rowLine, { flexDirection }]}>
              {unread ? <View style={styles.unreadDot} /> : null}
              <HighlightText
                variant="titleSmall"
                numberOfLines={1}
                text={contactName}
                tokens={tokens}
                highlightColor={hlColor}
                style={{ color: theme.colors.onSurface, textAlign, fontWeight: '700', flex: 1 }}
              />
              {activity ? (
                <Text style={{ fontSize: 11, color: unread ? theme.colors.primary : theme.colors.onSurfaceVariant, fontWeight: unread ? '700' : '400' }} numberOfLines={1}>
                  {activity}
                </Text>
              ) : null}
            </View>

            {/* Row 2: phone · company / e-mail */}
            {formattedPhone || secondary ? (
              <View style={[styles.rowLine, { flexDirection }]}>
                {formattedPhone ? (
                  <HighlightText
                    variant="bodySmall"
                    text={formattedPhone}
                    ranges={phoneRanges}
                    highlightColor={hlColor}
                    style={{ color: theme.colors.onSurfaceVariant, textAlign }}
                  />
                ) : null}
                {formattedPhone && secondary ? (
                  <Text style={{ color: theme.colors.onSurfaceVariant }}>·</Text>
                ) : null}
                {secondary ? (
                  <HighlightText
                    variant="bodySmall"
                    numberOfLines={1}
                    text={secondary}
                    tokens={tokens}
                    highlightColor={hlColor}
                    style={{ color: theme.colors.onSurfaceVariant, flexShrink: 1, textAlign }}
                  />
                ) : null}
              </View>
            ) : null}

            {lastMessage ? (
              <Text variant="bodySmall" numberOfLines={1} style={{ color: theme.colors.onSurface, textAlign, opacity: 0.8 }}>
                {lastMessage}
              </Text>
            ) : null}

            {ownerMatched ? (
              <View style={[styles.rowLine, { flexDirection }]}>
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

            {/* Row 3: status · flags · tags · owner */}
            <View style={[styles.rowBottom, { flexDirection }]}>
              {statusMeta ? (
                <View style={[styles.pill, { backgroundColor: withAlpha(statusMeta.color, 0.16) }]}>
                  <Text style={{ fontSize: 11, fontWeight: '600', color: statusMeta.color }} numberOfLines={1}>
                    {L(statusMeta.he, statusMeta.en)}
                  </Text>
                </View>
              ) : null}
              {isSpam ? (
                <View style={[styles.pill, { backgroundColor: '#DC2626' }]}>
                  <Text style={{ color: '#FFF', fontSize: 10, fontWeight: '700' }}>{t('contacts.possibleSpam', 'ספאם')}</Text>
                </View>
              ) : null}
              {!isSpam && notAgreed ? (
                <View style={[styles.pill, { backgroundColor: '#FEF3C7', flexDirection: 'row', alignItems: 'center', gap: 2 }]}>
                  <MaterialCommunityIcons name="cancel" size={11} color="#D97706" />
                  <Text style={{ color: '#D97706', fontSize: 10, fontWeight: '700' }}>{t('contacts.consentNotAgreed', 'לא הסכים')}</Text>
                </View>
              ) : null}
              {tags.slice(0, 2).map((tag) => (
                <Pressable key={tag} onPress={() => (selecting ? sel.toggle(item.id) : filterByTag(tag))} hitSlop={4} style={styles.tagBadge}>
                  <HighlightText
                    text={`#${tag}`}
                    tokens={tokens}
                    highlightColor={hlColor}
                    numberOfLines={1}
                    style={styles.tagBadgeText}
                  />
                </Pressable>
              ))}
              {tags.length > 2 ? (
                <Text style={{ fontSize: 11, fontWeight: '600', color: theme.colors.onSurfaceVariant }}>+{tags.length - 2}</Text>
              ) : null}
              <View style={{ flex: 1 }} />
              <OwnerBubble name={ownerName} />
            </View>
          </View>

          {!selecting && item.phoneNumber ? (
            <Pressable
              onPress={() => handleCall(item)}
              hitSlop={6}
              accessibilityLabel={t('common.call')}
              style={[styles.callBtn, { backgroundColor: withAlpha(theme.colors.primary, 0.1) }]}
            >
              <MaterialCommunityIcons name="phone-outline" size={18} color={theme.colors.primary} />
            </Pressable>
          ) : null}
        </Pressable>
      );

      return (
        <Swipeable
          ref={(ref) => {
            if (ref) swipeableRefs.set(item.id, ref);
            else swipeableRefs.delete(item.id);
          }}
          enabled={!selecting}
          renderRightActions={() => renderSwipeActions(item)}
          overshootRight={false}
          friction={2}
        >
          {rowContent}
        </Swipeable>
      );
    },
    [
      theme, isRTL, textAlign, flexDirection, openContact, renderSwipeActions, swipeableRefs, t, L, tokens, phoneQuery,
      hlColor, filterByTag, handleCall, sel.active, sel.isSelected, sel.toggle, sel.start,
    ],
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

  // Tabs: All · New this week · saved views. Mine / Unassigned / Unread / Opted-out are one-tap quick
  // chips below (they combine with each other and with the tabs) instead of duplicate tabs.
  const builtInTabs = useMemo<BuiltInViewId[]>(
    () => (['__all', '__new'] as BuiltInViewId[]).filter((id) => id === '__all' || id === activeBuiltIn || viewCounts[id] > 0),
    [activeBuiltIn, viewCounts],
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
  const headerIcon = theme.custom.headerText;

  // ── One-tap quick filters (combine with the tabs, the filters sheet and each other) ─────────
  const toggleQuick = useCallback(
    (patch: Partial<ContactFilterState>) => {
      setLastViewId(null);
      setStoreFilters(patch);
    },
    [setStoreFilters],
  );
  const optedOutActive = filters.consent.length === 1 && filters.consent[0] === 'notAgreed';
  const activityTodayActive = filters.activity?.operator === 'is_today';
  const inactive30Active = filters.activity?.operator === 'not_in_last_x_days' && filters.activity.daysValue === '30';

  // Removable chips for active filters that have no quick chip of their own.
  const extraChips = useMemo(
    () =>
      filterChips.filter((c) => {
        if (c.key === 'unread' || c.key === 'conv') return false;
        if (c.key === 'owner') return filters.owners.length > 0;
        if (c.key === 'consent') return !optedOutActive;
        if (c.key === 'activity') return !activityTodayActive && !inactive30Active;
        return true;
      }),
    [filterChips, filters.owners.length, optedOutActive, activityTodayActive, inactive30Active],
  );

  const [sortMenuVisible, setSortMenuVisible] = useState(false);
  const sortOptions: { key: ContactSort; icon: string }[] = [
    { key: '', icon: 'clock-outline' },
    { key: 'name', icon: 'sort-alphabetical-ascending' },
    { key: 'createdOn', icon: 'calendar-plus' },
  ];

  const bulkContacts = bulkSheet === 'send' ? getSelectedContacts() : [];

  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
      {sel.active ? (
        <SelectionHeader
          count={sel.count}
          total={filteredContacts.length}
          onClose={clearSelection}
          onSelectAll={() => sel.selectAll(filteredContacts.map((c) => c.id))}
          label={L('נבחרו', 'selected')}
        />
      ) : (
        <>
          {/* Header: title + filters + one overflow menu */}
          <View
            style={[
              styles.header,
              { backgroundColor: theme.custom.headerBackground, paddingTop: insets.top + 8, flexDirection },
            ]}
          >
            <Text style={styles.headerTitle}>{t('contacts.title')}</Text>
            <View style={{ flexDirection, gap: 4, alignItems: 'center' }}>
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
                  title={L('הודעות פנימיות', 'Internal messages')}
                  leadingIcon="message-text-outline"
                  onPress={() => { setMenuVisible(false); setInternalHubVisible(true); }}
                />
                <Menu.Item
                  title={L('הערות', 'Notes')}
                  leadingIcon="note-text-outline"
                  onPress={() => { setMenuVisible(false); setNotesHubVisible(true); }}
                />
                <Menu.Item
                  title={L('רענן', 'Refresh')}
                  leadingIcon="refresh"
                  onPress={() => { setMenuVisible(false); onRefresh(); }}
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
                contentContainerStyle={[styles.recentChips, { flexDirection }]}
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

          {/* Views: All · New this week · saved views (synced with the web) · save current */}
          <View style={[styles.viewsRow, { backgroundColor: theme.colors.surface, borderBottomColor: theme.colors.outline }]}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={[styles.viewsScroll, { flexDirection }]}
            >
              {builtInTabs.map((id) => {
                const active = activeBuiltIn === id;
                const count = id === '__all' ? 0 : viewCounts[id];
                return (
                  <Pressable
                    key={id}
                    onPress={() => applyBuiltIn(id)}
                    style={[styles.viewTab, active && { borderBottomColor: theme.colors.primary, borderBottomWidth: 2 }]}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <Text style={[styles.viewTabText, { color: active ? theme.colors.primary : theme.colors.onSurfaceVariant }]}>
                        {builtInLabel(id)}
                      </Text>
                      {count > 0 ? (
                        <View style={{ backgroundColor: theme.colors.primary, borderRadius: 9, minWidth: 18, paddingHorizontal: 4, paddingVertical: 1, alignItems: 'center' }}>
                          <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>{count > 999 ? '999+' : count}</Text>
                        </View>
                      ) : null}
                    </View>
                  </Pressable>
                );
              })}
              {parsedViews.map(({ view }) => {
                const active = activeSaved?.id === view.id;
                return (
                  <Pressable
                    key={view.id}
                    onPress={() => applySaved(view)}
                    onLongPress={() => onViewLongPress(view)}
                    style={[styles.viewTab, active && { borderBottomColor: theme.colors.primary, borderBottomWidth: 2 }]}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <MaterialCommunityIcons
                        name={view.visibility === 'personal' ? 'bookmark-outline' : 'account-group-outline'}
                        size={14}
                        color={active ? theme.colors.primary : theme.colors.onSurfaceVariant}
                      />
                      <Text
                        style={[styles.viewTabText, { color: active ? theme.colors.primary : theme.colors.onSurfaceVariant }]}
                        numberOfLines={1}
                      >
                        {view.name}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
              {isCustom || filters.sortBy ? (
                <Pressable onPress={openSaveDialog} style={[styles.viewTab, { flexDirection: 'row', alignItems: 'center', gap: 4 }]}>
                  <MaterialCommunityIcons name="bookmark-plus-outline" size={18} color={theme.colors.primary} />
                  <Text style={[styles.viewTabText, { color: theme.colors.primary }]}>{L('שמור תצוגה', 'Save view')}</Text>
                </Pressable>
              ) : null}
            </ScrollView>
          </View>

          {/* One-tap quick filters */}
          <View
            style={{
              backgroundColor: theme.colors.surface,
              borderBottomColor: theme.colors.outline,
              borderBottomWidth: StyleSheet.hairlineWidth,
            }}
          >
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={[styles.quickRow, { flexDirection }]}
            >
              {activeGroups > 0 ? (
                <QuickChip
                  theme={theme}
                  icon="close-circle"
                  label={`${L('נקה', 'Clear')} (${activeGroups})`}
                  color="#ef4444"
                  active
                  onPress={clearFilters}
                />
              ) : null}
              {!ownScope && currentUserId ? (
                <QuickChip
                  theme={theme}
                  icon="account-check-outline"
                  label={t('contacts.myContacts', L('שלי', 'Mine'))}
                  color={theme.colors.primary}
                  active={filters.mine}
                  onPress={() => toggleQuick({ mine: !filters.mine, unassigned: false })}
                />
              ) : null}
              {!ownScope ? (
                <QuickChip
                  theme={theme}
                  icon="account-off-outline"
                  label={L('ללא אחראי', 'Unassigned')}
                  color="#8b5cf6"
                  active={filters.unassigned}
                  count={viewCounts.__unassigned}
                  onPress={() => toggleQuick({ unassigned: !filters.unassigned, mine: false })}
                />
              ) : null}
              <QuickChip
                theme={theme}
                icon="message-badge-outline"
                label={L('לא נקראו', 'Unread')}
                color="#ef4444"
                active={filters.unread}
                count={viewCounts.__unread}
                onPress={() => toggleQuick({ unread: !filters.unread })}
              />
              {(['Open', 'In Process', 'Closed'] as const).map((b) => (
                <QuickChip
                  key={b}
                  theme={theme}
                  icon="circle-medium"
                  label={L(STATUS_META[b].he, STATUS_META[b].en)}
                  color={STATUS_META[b].color}
                  active={filters.convStatus.includes(b)}
                  onPress={() =>
                    toggleQuick({
                      convStatus: filters.convStatus.includes(b)
                        ? filters.convStatus.filter((x) => x !== b)
                        : [...filters.convStatus, b],
                    })
                  }
                />
              ))}
              <QuickChip
                theme={theme}
                icon="calendar-today"
                label={L('פעילות היום', 'Active today')}
                color="#3b82f6"
                active={activityTodayActive}
                onPress={() => toggleQuick({ activity: activityTodayActive ? null : makeDateFilter('is_today') })}
              />
              <QuickChip
                theme={theme}
                icon="clock-alert-outline"
                label={L('לא פעילים 30 יום', 'Inactive 30d')}
                color="#f97316"
                active={inactive30Active}
                onPress={() => toggleQuick({ activity: inactive30Active ? null : makeDateFilter('not_in_last_x_days', '30') })}
              />
              <QuickChip
                theme={theme}
                icon="cancel"
                label={L('לא הסכימו', 'Opted out')}
                color="#d97706"
                active={optedOutActive}
                count={viewCounts.__optedout}
                onPress={() => toggleQuick({ consent: optedOutActive ? [] : ['notAgreed'] })}
              />
              <QuickChip
                theme={theme}
                icon="tag-outline"
                label={filters.tags.length > 0 ? L(`תגיות (${filters.tags.length})`, `Tags (${filters.tags.length})`) : L('תגית', 'Tag')}
                color={theme.colors.primary}
                active={filters.tags.length > 0}
                caret
                onPress={() => setAdvancedFilterVisible(true)}
              />
            </ScrollView>

            {/* Remaining active filters as removable chips */}
            {extraChips.length > 0 ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={[styles.extraChips, { flexDirection }]}
              >
                {extraChips.map((c) => (
                  <Chip
                    key={c.key}
                    compact
                    onPress={() => setAdvancedFilterVisible(true)}
                    onClose={() => {
                      setStoreFilters(c.clear);
                    }}
                    style={[styles.extraChip, { backgroundColor: theme.colors.primaryContainer }]}
                    textStyle={[styles.filterChipText, { color: theme.colors.onPrimaryContainer, lineHeight: 16 }]}
                  >
                    {c.label}
                  </Chip>
                ))}
              </ScrollView>
            ) : null}
          </View>

          {/* Summary line: count  +  sort */}
          <View style={[styles.summaryRow, { flexDirection, backgroundColor: theme.colors.surface, borderBottomColor: theme.colors.outline }]}>
            <Text style={{ fontSize: 12, color: theme.colors.onSurfaceVariant, flexShrink: 1 }} numberOfLines={1}>
              <Text style={{ fontWeight: '700', color: theme.colors.onSurface }}>
                {countShown.toLocaleString()}
                {assignedNums.length > 0 && hasMore ? '+' : ''}
              </Text>
              {` ${countShown === 1 ? L('איש קשר', 'contact') : L('אנשי קשר', 'contacts')}`}
            </Text>
            <View style={{ flex: 1 }} />
            <Menu
              visible={sortMenuVisible}
              onDismiss={() => setSortMenuVisible(false)}
              anchor={
                <Pressable onPress={() => setSortMenuVisible(true)} hitSlop={6} style={[styles.sortBtn, { flexDirection }]}>
                  <MaterialCommunityIcons name="sort" size={16} color={theme.colors.primary} />
                  <Text style={{ fontSize: 12, color: theme.colors.primary, fontWeight: '600' }}>{sortLabel(filters.sortBy)}</Text>
                  <MaterialCommunityIcons name="chevron-down" size={14} color={theme.colors.primary} />
                </Pressable>
              }
            >
              {sortOptions.map((opt) => (
                <Menu.Item
                  key={opt.key || 'activity'}
                  leadingIcon={opt.icon}
                  trailingIcon={filters.sortBy === opt.key ? 'check' : undefined}
                  title={sortLabel(opt.key)}
                  titleStyle={filters.sortBy === opt.key ? { color: theme.colors.primary, fontWeight: '700' } : undefined}
                  onPress={() => {
                    setSortMenuVisible(false);
                    setStoreFilters({ sortBy: opt.key });
                  }}
                />
              ))}
            </Menu>
          </View>
        </>
      )}

      {isLoading && contacts.length === 0 ? (
        <View style={[styles.centered, { flex: 1 }]}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      ) : (
        <FlashList
          ref={listRef}
          data={filteredContacts}
          extraData={sel.selected}
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
          contentContainerStyle={{ paddingTop: 4, paddingBottom: sel.active ? 110 + insets.bottom : 100 }}
        />
      )}

      {sel.active ? (
        <>
          {bulkProgress ? (
            <View
              pointerEvents="none"
              style={[
                styles.progressPill,
                { backgroundColor: theme.colors.inverseSurface, bottom: 96 + insets.bottom },
              ]}
            >
              <ActivityIndicator size={14} color={theme.colors.inverseOnSurface} />
              <Text style={{ color: theme.colors.inverseOnSurface, fontSize: 12, fontWeight: '700' }}>
                {L('מעדכן', 'Updating')} {bulkProgress.done} / {bulkProgress.total}
              </Text>
            </View>
          ) : null}
          <BulkActionBar actions={bulkActions} busy={bulkBusy} />
        </>
      ) : (
        <FAB
          icon="account-plus"
          onPress={() => router.push({ pathname: '/(tabs)/contacts/[id]', params: { id: 'new' } })}
          style={[styles.fab, { backgroundColor: theme.colors.primary, bottom: insets.bottom + 16, left: isRTL ? 16 : undefined, right: isRTL ? undefined : 16 }]}
          color="#FFF"
        />
      )}

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

      {/* Bulk action sheets */}
      <BulkTagsSheet
        visible={bulkSheet === 'tags'}
        onDismiss={() => setBulkSheet(null)}
        count={sel.count}
        allTags={allTags}
        tagsOnSelected={tagsOnSelected}
        onApply={bulkApplyTags}
        tr={L}
      />
      <BulkStatusSheet
        visible={bulkSheet === 'status'}
        onDismiss={() => setBulkSheet(null)}
        count={sel.count}
        onApply={bulkApplyStatus}
        tr={L}
      />
      <BulkOwnerSheet
        visible={bulkSheet === 'owner'}
        onDismiss={() => setBulkSheet(null)}
        count={sel.count}
        organization={organization}
        currentUserId={currentUserId}
        onApply={bulkApplyOwner}
        tr={L}
      />
      <BulkSendSheet
        visible={bulkSheet === 'send'}
        onDismiss={() => setBulkSheet(null)}
        contacts={bulkContacts}
        organization={organization}
        user={user}
        onDone={onSendDone}
        tr={L}
      />

      <Snackbar visible={!!snack} onDismiss={() => setSnack('')} duration={2500} style={{ marginBottom: 70 }}>
        {snack}
      </Snackbar>

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
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingBottom: 4,
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
    justifyContent: 'center',
    paddingTop: 4,
    paddingBottom: 10,
  },
  searchbar: { height: 40, borderRadius: 20, elevation: 0, justifyContent: 'center' },
  recentWrap: { borderBottomWidth: StyleSheet.hairlineWidth, paddingBottom: 2 },
  recentChips: { gap: 6, paddingVertical: 6, paddingHorizontal: 18 },
  filterChipText: { fontSize: 12, lineHeight: 16 },
  viewsRow: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingTop: 4,
  },
  viewsScroll: {
    paddingHorizontal: 14,
    gap: 8,
    alignItems: 'center',
  },
  viewTab: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginBottom: -1,
  },
  viewTabText: {
    fontSize: 13,
    fontWeight: '600',
    maxWidth: 120,
  },
  quickRow: { paddingHorizontal: 14, paddingVertical: 8, gap: 6, alignItems: 'center' },
  quickChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
  },
  extraChips: { gap: 6, paddingBottom: 8, paddingHorizontal: 14, alignItems: 'center' },
  extraChip: { minHeight: 30 },
  summaryRow: {
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 6,
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sortBtn: { alignItems: 'center', gap: 4, paddingVertical: 2 },
  contactRow: {
    alignItems: 'stretch',
    paddingVertical: 8,
    paddingEnd: 12,
    gap: 10,
    overflow: 'hidden',
  },
  stripe: {
    width: 4,
    borderTopRightRadius: 2,
    borderBottomRightRadius: 2,
  },
  avatarWrap: { alignSelf: 'center' },
  contactBody: { flex: 1, minWidth: 0, gap: 3, justifyContent: 'center' },
  rowLine: { alignItems: 'center', gap: 6 },
  rowBottom: { alignItems: 'center', gap: 6, marginTop: 2 },
  unreadDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#ef4444' },
  pill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, maxWidth: 140 },
  callBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' },
  tagBadge: {
    backgroundColor: 'rgba(46,97,85,0.15)',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
    maxWidth: 110,
    flexShrink: 1,
  },
  tagBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#2e6155',
  },
  progressPill: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
    elevation: 14,
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
