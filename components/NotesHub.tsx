import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  StyleSheet,
  Pressable,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import {
  Text,
  Modal,
  Portal,
  Chip,
  Searchbar,
  ActivityIndicator,
  IconButton,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '../hooks/useAppTheme';
import { useRTL } from '../hooks/useRTL';
import { useAuthStore } from '../stores/authStore';
import { usersApi } from '../services/api/users';
import axiosInstance from '../services/api/axiosInstance';
import { ENDPOINTS } from '../constants/api';

type Source = 'all' | 'contact' | 'lead' | 'case' | 'order' | 'task' | 'general';

interface Note {
  id?: string;
  entityType?: string;
  entityId?: string;
  entityName?: string;
  contactId?: string;
  contactName?: string;
  note?: string;
  text?: string;
  createdOn?: string;
  createdByName?: string;
  userName?: string;
}

interface Props {
  visible: boolean;
  onClose: () => void;
}

const PAGE_SIZE = 30;

// Module-level cache so reopening the hub (or flipping back to a filter you
// already viewed) renders instantly while fresh data loads in the background,
// instead of showing a full-screen spinner every time.
const notesCache = new Map<string, { notes: Note[]; total: number }>();
const buildCacheKey = (p: {
  organization: string;
  page: number;
  source: Source;
  dateFrom: string;
  dateTo: string;
  userFilter: string;
  appliedSearch: string;
}) =>
  [p.organization, p.page, p.source, p.dateFrom, p.dateTo, p.userFilter, p.appliedSearch.trim()].join('|');

const getUserName = (u: any) =>
  u?.userName || u?.UserName || u?.fullname || u?.FullName || u?.name || u?.email || u?.Email || '';
const getUserId = (u: any) => u?.userId || u?.uID || u?.uid || u?.id || '';

const isoDay = (d: Date) => d.toISOString().split('T')[0];

export default function NotesHub({ visible, onClose }: Props) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useAppTheme();
  const { isRTL, textAlign } = useRTL();
  const { t } = useTranslation();

  const user = useAuthStore((s) => s.user);
  const organization = user?.organization ?? '';
  const isHe = (user as any)?.language !== 'en';
  const flexDirection = isRTL ? ('row-reverse' as const) : ('row' as const);

  const [notes, setNotes] = useState<Note[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);

  const [source, setSource] = useState<Source>('all');
  const [searchInput, setSearchInput] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [userFilter, setUserFilter] = useState('');
  const [users, setUsers] = useState<any[]>([]);

  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return isoDay(d);
  });
  const [dateTo, setDateTo] = useState(() => isoDay(new Date()));
  const [activeRange, setActiveRange] = useState<'7' | '30' | '90'>('30');
  const [showFilters, setShowFilters] = useState(false);

  const SOURCES: { value: Source; icon: string; label: string }[] = [
    { value: 'all', icon: 'format-list-bulleted', label: t('notesHub.sourceAll', isHe ? 'הכל' : 'All') },
    { value: 'contact', icon: 'account', label: t('notesHub.sourceContact', isHe ? 'אנשי קשר' : 'Contacts') },
    { value: 'lead', icon: 'account-convert', label: t('notesHub.sourceLead', isHe ? 'לידים' : 'Leads') },
    { value: 'case', icon: 'briefcase-outline', label: t('notesHub.sourceCase', isHe ? 'פניות' : 'Cases') },
    { value: 'order', icon: 'cart-outline', label: t('notesHub.sourceOrder', isHe ? 'הזמנות' : 'Orders') },
    { value: 'task', icon: 'clipboard-check-outline', label: t('notesHub.sourceTask', isHe ? 'משימות' : 'Tasks') },
    { value: 'general', icon: 'note-text-outline', label: t('notesHub.sourceGeneral', isHe ? 'כללי' : 'General') },
  ];

  const SOURCE_ICON: Record<string, string> = {
    contact: 'account',
    lead: 'account-convert',
    case: 'briefcase-outline',
    order: 'cart-outline',
    task: 'clipboard-check-outline',
    general: 'note-text-outline',
  };

  useEffect(() => {
    if (!visible || !organization) return;
    usersApi.getAll(organization).then(setUsers).catch(() => {});
  }, [visible, organization]);

  const fetchNotes = useCallback(async () => {
    if (!organization) return;

    // Serve cached results instantly; only block with a spinner on a cold load.
    const key = buildCacheKey({ organization, page, source, dateFrom, dateTo, userFilter, appliedSearch });
    const cached = notesCache.get(key);
    if (cached) {
      setNotes(cached.notes);
      setTotal(cached.total);
      setLoading(false);
    } else {
      setLoading(true);
    }

    try {
      const res = await axiosInstance.post(ENDPOINTS.GET_ALL_NOTES_FOR_ORGANIZATION, {
        organization,
        page,
        pageSize: PAGE_SIZE,
        sourceFilter: source === 'all' ? null : source,
        dateFrom,
        dateTo,
        userFilter: userFilter || null,
        searchTerm: appliedSearch.trim() || null,
      });
      const data = res.data;
      const list = data?.Data || data?.data || [];
      const safeList = Array.isArray(list) ? list : [];
      const safeTotal = data?.Total ?? data?.total ?? safeList.length;
      setNotes(safeList);
      setTotal(safeTotal);
      notesCache.set(key, { notes: safeList, total: safeTotal });
    } catch (err) {
      console.error('[NotesHub] fetch error', err);
      if (!cached) {
        setNotes([]);
        setTotal(0);
      }
    } finally {
      setLoading(false);
    }
  }, [organization, page, source, dateFrom, dateTo, userFilter, appliedSearch]);

  useEffect(() => {
    if (!visible) return;
    fetchNotes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, page, source, dateFrom, dateTo, userFilter, appliedSearch]);

  const applyQuickRange = (range: '7' | '30' | '90') => {
    const to = new Date();
    const from = new Date();
    if (range === '7') from.setDate(from.getDate() - 7);
    else if (range === '30') from.setMonth(from.getMonth() - 1);
    else from.setMonth(from.getMonth() - 3);
    setDateFrom(isoDay(from));
    setDateTo(isoDay(to));
    setActiveRange(range);
    setPage(1);
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const navigateToEntity = (note: Note) => {
    const type = note.entityType;
    if (type === 'contact') {
      const phone = note.contactId || note.entityId;
      if (phone) {
        onClose();
        router.push({ pathname: '/(tabs)/chats/[phoneNumber]', params: { phoneNumber: phone } });
      }
      return;
    }
    if (type === 'lead' && note.entityId) {
      onClose();
      router.push({ pathname: '/(tabs)/leads/[id]', params: { id: note.entityId } } as any);
    } else if (type === 'case' && note.entityId) {
      onClose();
      router.push({ pathname: '/(tabs)/more/cases/[id]', params: { id: note.entityId } } as any);
    } else if (type === 'order' && note.entityId) {
      onClose();
      router.push({ pathname: '/(tabs)/more/orders/[id]', params: { id: note.entityId } } as any);
    } else if (type === 'task' && note.entityId) {
      onClose();
      router.push({ pathname: '/(tabs)/more/tasks/[id]', params: { id: note.entityId } } as any);
    }
  };

  const formatDate = (iso?: string) => {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleDateString(isHe ? 'he-IL' : 'en-US', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '';
    }
  };

  const sourceLabel = (type?: string) =>
    SOURCES.find((s) => s.value === type)?.label || SOURCES[6].label;

  const renderItem = useCallback(
    ({ item }: { item: Note }) => {
      const type = item.entityType || 'general';
      const clickable = ['contact', 'lead', 'case', 'order', 'task'].includes(type) && !!(item.entityId || item.contactId);
      return (
        <Pressable
          onPress={() => navigateToEntity(item)}
          disabled={!clickable}
          style={({ pressed }) => [
            styles.card,
            {
              backgroundColor: pressed ? theme.colors.surfaceVariant : theme.colors.surface,
              borderColor: theme.colors.outline,
            },
          ]}
        >
          <View style={[styles.cardHeader, { flexDirection }]}>
            <View style={[styles.badge, { backgroundColor: 'rgba(46,97,85,0.12)' }]}>
              <MaterialCommunityIcons name={(SOURCE_ICON[type] || 'note-text-outline') as any} size={12} color="#2e6155" />
              <Text style={[styles.badgeText, { color: '#2e6155' }]}>{sourceLabel(type)}</Text>
            </View>
            {item.contactName ? (
              <Text variant="bodySmall" numberOfLines={1} style={{ color: theme.colors.onSurfaceVariant, flexShrink: 1 }}>
                👤 {item.contactName}
              </Text>
            ) : item.entityName ? (
              <Text variant="bodySmall" numberOfLines={1} style={{ color: theme.colors.onSurfaceVariant, flexShrink: 1 }}>
                {item.entityName}
              </Text>
            ) : null}
            <View style={{ flex: 1 }} />
            <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
              {formatDate(item.createdOn)}
            </Text>
          </View>

          <Text variant="bodyMedium" style={{ color: theme.colors.onSurface, marginTop: 6, textAlign }}>
            {item.note || item.text || ''}
          </Text>

          <View style={[styles.cardFooter, { flexDirection }]}>
            <MaterialCommunityIcons name="account" size={13} color={theme.colors.onSurfaceVariant} />
            <Text variant="labelSmall" numberOfLines={1} style={{ color: theme.colors.onSurfaceVariant, flexShrink: 1 }}>
              {item.createdByName || item.userName || (isHe ? 'לא ידוע' : 'Unknown')}
            </Text>
            {clickable ? (
              <MaterialCommunityIcons name="open-in-new" size={14} color={theme.colors.primary} style={{ marginStart: 6 }} />
            ) : null}
          </View>
        </Pressable>
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [theme, flexDirection, textAlign, isHe],
  );

  const rangeBadge = useMemo(() => {
    try {
      const f = new Date(dateFrom).toLocaleDateString(isHe ? 'he-IL' : 'en-US', { day: 'numeric', month: 'short' });
      const tt = new Date(dateTo).toLocaleDateString(isHe ? 'he-IL' : 'en-US', { day: 'numeric', month: 'short' });
      return `📅 ${f} - ${tt}`;
    } catch {
      return '';
    }
  }, [dateFrom, dateTo, isHe]);

  return (
    <Portal>
      <Modal
        visible={visible}
        onDismiss={onClose}
        contentContainerStyle={[styles.modal, { backgroundColor: theme.colors.background }]}
      >
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          {/* Header */}
          <View style={[styles.header, { backgroundColor: theme.custom.headerBackground, paddingTop: insets.top + 8 }]}>
            <Text style={styles.headerTitle}>📝 {t('notesHub.title', isHe ? 'מרכז הערות' : 'Notes Hub')}</Text>
            <IconButton icon="close" iconColor={theme.custom.headerText} size={24} onPress={onClose} />
          </View>

          {/* Toolbar */}
          <View style={[styles.toolbar, { borderBottomColor: theme.colors.outline, flexDirection }]}>
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, flex: 1 }}>
              {total.toLocaleString()} {isHe ? 'הערות' : 'notes'}  ·  {rangeBadge}
            </Text>
            <Chip
              icon="filter-variant"
              selected={showFilters}
              onPress={() => setShowFilters((v) => !v)}
              compact
              style={{ backgroundColor: showFilters ? theme.colors.primaryContainer : theme.colors.surfaceVariant }}
              textStyle={{ fontSize: 12 }}
            >
              {t('notesHub.filters', isHe ? 'סינון' : 'Filters')}
            </Chip>
          </View>

          {/* Filters: date quick-range + user */}
          {showFilters ? (
            <View style={[styles.filtersPanel, { borderBottomColor: theme.colors.outline }]}>
              <View style={[styles.quickRangeRow, { flexDirection }]}>
                {(['7', '30', '90'] as const).map((r) => (
                  <Chip
                    key={r}
                    selected={activeRange === r}
                    onPress={() => applyQuickRange(r)}
                    compact
                    style={{ backgroundColor: activeRange === r ? theme.colors.primaryContainer : theme.colors.surfaceVariant }}
                    textStyle={{ fontSize: 12 }}
                  >
                    {r === '7' ? (isHe ? 'שבוע' : '7d') : r === '30' ? (isHe ? 'חודש' : '30d') : isHe ? '3 חודשים' : '90d'}
                  </Chip>
                ))}
              </View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.pillsScroll}
                contentContainerStyle={[styles.userPills, { flexDirection }]}
              >
                <Chip
                  selected={!userFilter}
                  onPress={() => { setUserFilter(''); setPage(1); }}
                  compact
                  style={{ backgroundColor: !userFilter ? theme.colors.primaryContainer : theme.colors.surfaceVariant }}
                  textStyle={{ fontSize: 12 }}
                >
                  {isHe ? 'כל המשתמשים' : 'All users'}
                </Chip>
                {users.map((u) => {
                  const uid = getUserId(u);
                  const active = userFilter === uid;
                  return (
                    <Chip
                      key={uid}
                      selected={active}
                      onPress={() => { setUserFilter(uid); setPage(1); }}
                      compact
                      style={{ backgroundColor: active ? theme.colors.primaryContainer : theme.colors.surfaceVariant }}
                      textStyle={{ fontSize: 12 }}
                    >
                      {getUserName(u)}
                    </Chip>
                  );
                })}
              </ScrollView>
            </View>
          ) : null}

          {/* Source pills */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.pillsScroll}
            contentContainerStyle={[styles.sourcePills, { flexDirection }]}
          >
            {SOURCES.map((s) => {
              const active = source === s.value;
              return (
                <Chip
                  key={s.value}
                  icon={s.icon}
                  selected={active}
                  onPress={() => { setSource(s.value); setPage(1); }}
                  compact
                  style={{ backgroundColor: active ? theme.colors.primaryContainer : theme.colors.surfaceVariant }}
                  textStyle={{ fontSize: 12, color: active ? theme.colors.onPrimaryContainer : theme.colors.onSurfaceVariant }}
                >
                  {s.label}
                </Chip>
              );
            })}
          </ScrollView>

          {/* Search */}
          <View style={styles.searchRow}>
            <Searchbar
              placeholder={t('notesHub.searchPlaceholder', isHe ? 'חיפוש חופשי בהערות...' : 'Search notes...')}
              value={searchInput}
              onChangeText={setSearchInput}
              onSubmitEditing={() => { setPage(1); setAppliedSearch(searchInput.trim()); }}
              onIconPress={() => { setPage(1); setAppliedSearch(searchInput.trim()); }}
              onClearIconPress={() => { setSearchInput(''); setAppliedSearch(''); setPage(1); }}
              style={[styles.searchbar, { backgroundColor: theme.colors.surface }]}
              inputStyle={{ fontSize: 14, textAlign: isRTL ? 'right' : 'left' }}
            />
          </View>

          {/* Feed */}
          <View style={{ flex: 1 }}>
            {loading ? (
              <View style={styles.centered}>
                <ActivityIndicator size="large" color={theme.colors.primary} />
              </View>
            ) : notes.length === 0 ? (
              <View style={styles.centered}>
                <Text style={{ fontSize: 40 }}>📝</Text>
                <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center', marginTop: 8, paddingHorizontal: 32 }}>
                  {t('notesHub.empty', isHe ? 'לא נמצאו הערות בטווח שנבחר' : 'No notes found in the selected range')}
                </Text>
              </View>
            ) : (
              <FlashList
                data={notes}
                renderItem={renderItem}
                keyExtractor={(item, idx) => item.id || String(idx)}
                contentContainerStyle={{ padding: 12, paddingBottom: insets.bottom + 24 }}
              />
            )}
          </View>

          {/* Pagination */}
          {totalPages > 1 ? (
            <View style={[styles.pagination, { flexDirection, borderTopColor: theme.colors.outline, paddingBottom: insets.bottom + 8 }]}>
              <IconButton
                icon={isRTL ? 'chevron-right' : 'chevron-left'}
                size={22}
                disabled={page <= 1}
                onPress={() => setPage((p) => Math.max(1, p - 1))}
              />
              <Text variant="bodySmall" style={{ color: theme.colors.onSurface }}>
                {isHe ? `עמוד ${page} מתוך ${totalPages}` : `Page ${page} of ${totalPages}`}
              </Text>
              <IconButton
                icon={isRTL ? 'chevron-left' : 'chevron-right'}
                size={22}
                disabled={page >= totalPages}
                onPress={() => setPage((p) => Math.min(totalPages, p + 1))}
              />
            </View>
          ) : null}
        </KeyboardAvoidingView>
      </Modal>
    </Portal>
  );
}

const styles = StyleSheet.create({
  modal: { flex: 1, margin: 0 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  headerTitle: { fontSize: 18, fontWeight: '700', color: '#FFF', marginStart: 6 },
  toolbar: {
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  filtersPanel: {
    paddingTop: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  quickRangeRow: { gap: 8, paddingHorizontal: 14, paddingBottom: 8, alignItems: 'center' },
  // flexGrow:0 stops the horizontal ScrollView from expanding to fill the column,
  // and alignItems:center keeps the chips at their natural height (instead of the
  // default `stretch` blowing them up into tall empty columns).
  pillsScroll: { flexGrow: 0, flexShrink: 0 },
  userPills: { gap: 6, paddingHorizontal: 14, paddingBottom: 10, alignItems: 'center' },
  sourcePills: { gap: 8, paddingHorizontal: 14, paddingVertical: 10, alignItems: 'center' },
  searchRow: { paddingHorizontal: 12, paddingBottom: 8 },
  searchbar: { height: 44, borderRadius: 22, elevation: 0 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    marginBottom: 10,
  },
  cardHeader: { alignItems: 'center', gap: 8 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { fontSize: 11, fontWeight: '700' },
  cardFooter: { alignItems: 'center', gap: 4, marginTop: 8 },
  pagination: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
