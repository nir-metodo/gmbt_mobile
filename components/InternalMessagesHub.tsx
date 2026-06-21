import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View,
  StyleSheet,
  Pressable,
  TextInput,
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
  Switch,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '../hooks/useAppTheme';
import { useRTL } from '../hooks/useRTL';
import { useAuthStore } from '../stores/authStore';
import { chatsApi } from '../services/api/chats';
import { usersApi } from '../services/api/users';

type Scope = 'org' | 'user' | 'contact';

interface InternalMessage {
  messageId?: string;
  messageText?: string;
  sentByName?: string;
  createdOn?: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
  relatedEntityName?: string;
  isReadForMe?: boolean;
  mentionedUserIds?: string[];
  mentionedUsers?: any[];
}

interface Props {
  visible: boolean;
  onClose: () => void;
}

const getUserName = (u: any) =>
  u?.userName || u?.UserName || u?.fullname || u?.FullName || u?.name || u?.email || u?.Email || '';
const getUserId = (u: any) => u?.userId || u?.uID || u?.uid || u?.id || '';

export default function InternalMessagesHub({ visible, onClose }: Props) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useAppTheme();
  const { isRTL, textAlign } = useRTL();
  const { t } = useTranslation();

  const user = useAuthStore((s) => s.user);
  const organization = user?.organization ?? '';
  const currentUserId = user?.uID || user?.userId || '';
  const canViewAll = user?.SecurityRole === 'Admin';

  const [messages, setMessages] = useState<InternalMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [scope, setScope] = useState<Scope>('org');
  const [targetUserId, setTargetUserId] = useState('');
  const [contactId, setContactId] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [users, setUsers] = useState<any[]>([]);

  // Composer
  const [showComposer, setShowComposer] = useState(false);
  const [composerText, setComposerText] = useState('');
  const [composerMentions, setComposerMentions] = useState<{ userId: string; userName: string }[]>([]);
  const [composerContact, setComposerContact] = useState('');
  const [sending, setSending] = useState(false);
  const [mentionAtIdx, setMentionAtIdx] = useState<number | null>(null);
  const [mentionOptions, setMentionOptions] = useState<any[]>([]);
  const caretRef = useRef(0);

  const isHe = (user as any)?.language !== 'en';

  useEffect(() => {
    if (!visible || !organization) return;
    usersApi.getAll(organization).then(setUsers).catch(() => {});
  }, [visible, organization]);

  const fetchMessages = useCallback(async () => {
    if (!organization) return;
    setLoading(true);
    try {
      const list = await chatsApi.getInternalMessagesHub({
        organization,
        scope,
        targetUserId: scope === 'user' ? targetUserId || currentUserId : null,
        contactId: scope === 'contact' ? contactId : null,
        searchTerm: appliedSearch || null,
        currentUserId,
        canViewAll,
        limit: 150,
      });
      setMessages(list);
    } catch (err) {
      console.error('[InternalMessagesHub] fetch error', err);
      setMessages([]);
    } finally {
      setLoading(false);
    }
  }, [organization, scope, targetUserId, contactId, appliedSearch, currentUserId, canViewAll]);

  useEffect(() => {
    if (!visible) return;
    if (scope === 'contact' && !contactId.trim()) {
      setMessages([]);
      return;
    }
    fetchMessages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, scope, targetUserId, appliedSearch]);

  const visibleMessages = useMemo(
    () =>
      unreadOnly
        ? messages.filter(
            (m) => !m.isReadForMe && (m.mentionedUserIds || []).includes(currentUserId),
          )
        : messages,
    [unreadOnly, messages, currentUserId],
  );

  // ── Composer mention handling ──
  const handleComposerChange = (val: string) => {
    setComposerText(val);
    // Selection updates after onChangeText, so caretRef is stale for the first char typed.
    // Fall back to end-of-text so typing "@" opens the mention list immediately.
    const caret = (caretRef.current > 0 && caretRef.current <= val.length) ? caretRef.current : val.length;
    const before = val.substring(0, caret);
    const atIdx = before.lastIndexOf('@');
    if (atIdx !== -1) {
      const charBeforeAt = atIdx > 0 ? before[atIdx - 1] : '';
      const ok = atIdx === 0 || /\s/.test(charBeforeAt);
      const afterAt = before.substring(atIdx + 1);
      if (ok && !afterAt.includes(' ') && !afterAt.includes('\n')) {
        const q = afterAt.toLowerCase();
        const matches = users
          .filter((u) => !q || getUserName(u).toLowerCase().includes(q) || (u.email || u.Email || '').toLowerCase().includes(q))
          .slice(0, 8);
        setMentionAtIdx(atIdx);
        setMentionOptions(matches);
        return;
      }
    }
    setMentionAtIdx(null);
    setMentionOptions([]);
  };

  const pickMention = (option: any | '__ALL__') => {
    if (option === '__ALL__') {
      const all = users
        .map((u) => ({ userId: getUserId(u), userName: getUserName(u) }))
        .filter((u) => u.userId && u.userId !== currentUserId);
      setComposerMentions(all);
    } else {
      const m = { userId: getUserId(option), userName: getUserName(option) };
      setComposerMentions((prev) => (prev.find((x) => x.userId === m.userId) ? prev : [...prev, m]));
    }
    // Strip the "@query" fragment that triggered the dropdown.
    if (mentionAtIdx !== null) {
      const caret = caretRef.current ?? composerText.length;
      const next = composerText.substring(0, mentionAtIdx) + composerText.substring(caret);
      setComposerText(next);
    }
    setMentionAtIdx(null);
    setMentionOptions([]);
  };

  const removeMention = (userId: string) =>
    setComposerMentions((prev) => prev.filter((m) => m.userId !== userId));

  const handleSend = async () => {
    if (!composerText.trim() || composerMentions.length === 0) return;
    setSending(true);
    try {
      const senderName = getUserName(user) || 'Agent';
      await chatsApi.createInternalMessage({
        organization,
        messageText: composerText,
        mentionedUsers: composerMentions,
        relatedContactPhone: composerContact.trim() || undefined,
        generalLabel: isHe ? 'הודעה כללית' : 'General',
        sentById: currentUserId,
        sentByName: senderName,
      });
      setComposerText('');
      setComposerMentions([]);
      setComposerContact('');
      setShowComposer(false);
      setTimeout(fetchMessages, 400);
    } catch (err) {
      console.error('[InternalMessagesHub] send error', err);
    } finally {
      setSending(false);
    }
  };

  const openMessage = async (msg: InternalMessage) => {
    const isUnreadForMe = !msg.isReadForMe && (msg.mentionedUserIds || []).includes(currentUserId);
    if (isUnreadForMe && msg.messageId) {
      try {
        await chatsApi.markMentionAsRead(organization, msg.messageId, currentUserId);
        setMessages((prev) =>
          prev.map((m) => (m.messageId === msg.messageId ? { ...m, isReadForMe: true } : m)),
        );
      } catch {
        /* non-fatal */
      }
    }
    if (msg.relatedEntityType === 'contact' && msg.relatedEntityId) {
      onClose();
      router.push({
        pathname: '/(tabs)/chats/[phoneNumber]',
        params: { phoneNumber: msg.relatedEntityId },
      });
    }
  };

  const renderMentionNames = (msg: InternalMessage) => {
    const m = msg.mentionedUsers;
    if (Array.isArray(m) && m.length > 0) {
      const names = m
        .map((u) => (typeof u === 'string' ? u : u?.userName || u?.name))
        .filter(Boolean);
      if (names.length > 0) return names.join(', ');
    }
    return isHe ? 'הצוות' : 'team';
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

  const SCOPES: { value: Scope; icon: string; label: string }[] = [
    { value: 'org', icon: 'office-building', label: t('internalMessages.scopeOrg', isHe ? 'כל הארגון' : 'Organization') },
    { value: 'user', icon: 'account-group', label: t('internalMessages.scopeUser', isHe ? 'לפי משתמש' : 'By user') },
    { value: 'contact', icon: 'account', label: t('internalMessages.scopeContact', isHe ? 'לפי איש קשר' : 'By contact') },
  ];

  const renderItem = useCallback(
    ({ item }: { item: InternalMessage }) => {
      const isUnreadForMe = !item.isReadForMe && (item.mentionedUserIds || []).includes(currentUserId);
      const clickable = item.relatedEntityType === 'contact' && !!item.relatedEntityId;
      return (
        <Pressable
          onPress={() => openMessage(item)}
          disabled={!clickable && !isUnreadForMe}
          style={({ pressed }) => [
            styles.card,
            {
              backgroundColor: pressed ? theme.colors.surfaceVariant : theme.colors.surface,
              borderColor: theme.colors.outline,
            },
            isUnreadForMe && { borderStartWidth: 4, borderStartColor: '#9333ea' },
          ]}
        >
          <View style={[styles.cardHeader, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
            <View style={[styles.badge, { backgroundColor: 'rgba(147,51,234,0.12)' }]}>
              <MaterialCommunityIcons name="message-text" size={12} color="#9333ea" />
              <Text style={[styles.badgeText, { color: '#9333ea' }]}>
                {t('internalMessages.internal', isHe ? 'פנימית' : 'Internal')}
              </Text>
            </View>
            {item.relatedEntityName ? (
              <Text variant="bodySmall" numberOfLines={1} style={{ color: theme.colors.onSurfaceVariant, flexShrink: 1 }}>
                {clickable ? '👤 ' : ''}{item.relatedEntityName}
              </Text>
            ) : null}
            {isUnreadForMe ? (
              <View style={[styles.newBadge, { backgroundColor: '#9333ea' }]}>
                <Text style={styles.newBadgeText}>{t('internalMessages.new', isHe ? 'חדש' : 'New')}</Text>
              </View>
            ) : null}
            <View style={{ flex: 1 }} />
            <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
              {formatDate(item.createdOn)}
            </Text>
          </View>

          <Text variant="bodyMedium" style={{ color: theme.colors.onSurface, marginTop: 6, textAlign }}>
            {item.messageText || ''}
          </Text>

          <View style={[styles.cardFooter, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
            <MaterialCommunityIcons name="account" size={13} color={theme.colors.onSurfaceVariant} />
            <Text variant="labelSmall" numberOfLines={1} style={{ color: theme.colors.onSurfaceVariant, flexShrink: 1 }}>
              {item.sentByName || (isHe ? 'לא ידוע' : 'Unknown')} • @{renderMentionNames(item)}
            </Text>
            {clickable ? (
              <MaterialCommunityIcons
                name="open-in-new"
                size={14}
                color={theme.colors.primary}
                style={{ marginStart: 6 }}
              />
            ) : null}
          </View>
        </Pressable>
      );
    },
    [theme, isRTL, textAlign, currentUserId, isHe, t],
  );

  return (
    <Portal>
      <Modal
        visible={visible}
        onDismiss={onClose}
        contentContainerStyle={[styles.modal, { backgroundColor: theme.colors.background }]}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}
        >
          {/* Header */}
          <View style={[styles.header, { backgroundColor: theme.custom.headerBackground, paddingTop: insets.top + 8 }]}>
            <Text style={styles.headerTitle}>💬 {t('internalMessages.title', isHe ? 'הודעות פנימיות' : 'Internal Messages')}</Text>
            <IconButton icon="close" iconColor={theme.custom.headerText} size={24} onPress={onClose} />
          </View>

          {/* Toolbar: unread-only + new message */}
          <View style={[styles.toolbar, { borderBottomColor: theme.colors.outline, flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
            <View style={[styles.unreadToggle, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
              <Switch value={unreadOnly} onValueChange={setUnreadOnly} color={theme.colors.primary} />
              <Text variant="bodySmall" style={{ color: theme.colors.onSurface, marginHorizontal: 6 }}>
                {t('internalMessages.unreadOnly', isHe ? 'לא נקראו בלבד' : 'Unread only')}
              </Text>
            </View>
            <View style={{ flex: 1 }} />
            <Chip
              icon={showComposer ? 'close' : 'plus'}
              selected={showComposer}
              onPress={() => setShowComposer((v) => !v)}
              compact
              style={{ backgroundColor: showComposer ? theme.colors.primaryContainer : theme.colors.surfaceVariant }}
              textStyle={{ fontSize: 12 }}
            >
              {t('internalMessages.newMessage', isHe ? 'הודעה חדשה' : 'New message')}
            </Chip>
          </View>

          {/* Composer */}
          {showComposer ? (
            <View style={[styles.composer, { backgroundColor: theme.colors.surface, borderColor: theme.colors.outline }]}>
              {composerMentions.length > 0 ? (
                <View style={styles.mentionChips}>
                  {composerMentions.map((m) => (
                    <Pressable key={m.userId} onPress={() => removeMention(m.userId)} style={styles.mentionChip}>
                      <Text style={styles.mentionChipText}>@{m.userName}</Text>
                      <MaterialCommunityIcons name="close" size={13} color="#6d28d9" />
                    </Pressable>
                  ))}
                </View>
              ) : null}

              <View style={{ position: 'relative' }}>
                <TextInput
                  value={composerText}
                  onChangeText={handleComposerChange}
                  onSelectionChange={(e) => { caretRef.current = e.nativeEvent.selection.start; }}
                  placeholder={t(
                    'internalMessages.composerPlaceholder',
                    isHe ? 'כתוב הודעה... הקלד @ לתיוג משתמשים' : 'Write a message... type @ to tag users',
                  )}
                  placeholderTextColor={theme.colors.onSurfaceVariant}
                  multiline
                  style={[styles.composerInput, { color: theme.colors.onSurface, borderColor: theme.colors.outline, textAlign }]}
                />
                {mentionAtIdx !== null ? (
                  <View style={[styles.mentionDropdown, { backgroundColor: theme.colors.surface, borderColor: theme.colors.outline }]}>
                    <Pressable onPress={() => pickMention('__ALL__')} style={[styles.mentionRow, { backgroundColor: 'rgba(147,51,234,0.08)' }]}>
                      <MaterialCommunityIcons name="account-multiple" size={16} color="#6d28d9" />
                      <Text style={{ color: '#6d28d9', fontWeight: '700', marginStart: 8 }}>
                        ALL — {t('internalMessages.tagEveryone', isHe ? 'תייג את כולם' : 'tag everyone')}
                      </Text>
                    </Pressable>
                    {mentionOptions.map((u) => (
                      <Pressable key={getUserId(u)} onPress={() => pickMention(u)} style={styles.mentionRow}>
                        <MaterialCommunityIcons name="account-circle-outline" size={16} color={theme.colors.primary} />
                        <Text style={{ color: theme.colors.onSurface, marginStart: 8 }}>{getUserName(u)}</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
              </View>

              <View style={[styles.composerActions, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
                <TextInput
                  value={composerContact}
                  onChangeText={setComposerContact}
                  placeholder={t('internalMessages.relateContact', isHe ? 'קשר לאיש קשר (טלפון, אופציונלי)' : 'Relate to contact (optional)')}
                  placeholderTextColor={theme.colors.onSurfaceVariant}
                  keyboardType="phone-pad"
                  style={[styles.contactInput, { color: theme.colors.onSurface, borderColor: theme.colors.outline, textAlign }]}
                />
                <IconButton
                  icon={sending ? 'loading' : 'send'}
                  mode="contained"
                  containerColor={theme.colors.primary}
                  iconColor="#FFF"
                  size={20}
                  disabled={sending || !composerText.trim() || composerMentions.length === 0}
                  onPress={handleSend}
                />
              </View>
              {composerMentions.length === 0 ? (
                <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: 2 }}>
                  {t('internalMessages.tagAtLeastOne', isHe ? 'יש לתייג לפחות משתמש אחד (@) כדי לשלוח.' : 'Tag at least one user (@) to send.')}
                </Text>
              ) : null}
            </View>
          ) : null}

          {/* Scope pills */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.pillsScroll}
            contentContainerStyle={[styles.scopePills, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}
          >
            {SCOPES.map((s) => {
              const active = scope === s.value;
              return (
                <Chip
                  key={s.value}
                  icon={s.icon}
                  selected={active}
                  onPress={() => setScope(s.value)}
                  compact
                  style={{ backgroundColor: active ? theme.colors.primaryContainer : theme.colors.surfaceVariant }}
                  textStyle={{ fontSize: 12, color: active ? theme.colors.onPrimaryContainer : theme.colors.onSurfaceVariant }}
                >
                  {s.label}
                </Chip>
              );
            })}
          </ScrollView>

          {/* Scope-specific controls */}
          {scope === 'user' ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.pillsScroll}
              contentContainerStyle={[styles.userPills, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}
            >
              <Chip
                selected={!targetUserId}
                onPress={() => setTargetUserId('')}
                compact
                style={{ backgroundColor: !targetUserId ? theme.colors.primaryContainer : theme.colors.surfaceVariant }}
                textStyle={{ fontSize: 12 }}
              >
                {t('internalMessages.me', isHe ? 'אני' : 'Me')}
              </Chip>
              {users.map((u) => {
                const uid = getUserId(u);
                const active = targetUserId === uid;
                return (
                  <Chip
                    key={uid}
                    selected={active}
                    onPress={() => setTargetUserId(uid)}
                    compact
                    style={{ backgroundColor: active ? theme.colors.primaryContainer : theme.colors.surfaceVariant }}
                    textStyle={{ fontSize: 12 }}
                  >
                    {getUserName(u)}
                  </Chip>
                );
              })}
            </ScrollView>
          ) : null}

          {scope === 'contact' ? (
            <View style={styles.contactSearchRow}>
              <Searchbar
                placeholder={t('internalMessages.contactPhone', isHe ? 'מספר טלפון מלא...' : 'Full phone number...')}
                value={contactId}
                onChangeText={setContactId}
                onSubmitEditing={fetchMessages}
                onIconPress={fetchMessages}
                keyboardType="phone-pad"
                style={[styles.searchbar, { backgroundColor: theme.colors.surface }]}
                inputStyle={{ fontSize: 14, textAlign: isRTL ? 'right' : 'left' }}
              />
            </View>
          ) : null}

          {/* Free-text search */}
          <View style={styles.searchRow}>
            <Searchbar
              placeholder={t('internalMessages.searchPlaceholder', isHe ? 'חיפוש בהודעות פנימיות...' : 'Search internal messages...')}
              value={searchInput}
              onChangeText={setSearchInput}
              onSubmitEditing={() => setAppliedSearch(searchInput.trim())}
              onIconPress={() => setAppliedSearch(searchInput.trim())}
              onClearIconPress={() => { setSearchInput(''); setAppliedSearch(''); }}
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
            ) : visibleMessages.length === 0 ? (
              <View style={styles.centered}>
                <Text style={{ fontSize: 40 }}>💬</Text>
                <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center', marginTop: 8, paddingHorizontal: 32 }}>
                  {scope === 'contact' && !contactId.trim()
                    ? t('internalMessages.enterContact', isHe ? 'הזן מספר איש קשר כדי לראות את ההודעות הפנימיות שלו' : 'Enter a contact phone to see its internal messages')
                    : t('internalMessages.empty', isHe ? 'לא נמצאו הודעות פנימיות' : 'No internal messages found')}
                </Text>
              </View>
            ) : (
              <FlashList
                data={visibleMessages}
                renderItem={renderItem}
                keyExtractor={(item, idx) => item.messageId || String(idx)}
                contentContainerStyle={{ padding: 12, paddingBottom: insets.bottom + 24 }}
              />
            )}
          </View>
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
  },
  unreadToggle: { alignItems: 'center' },
  composer: {
    margin: 12,
    marginBottom: 0,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  mentionChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  mentionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#ede9fe',
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  mentionChipText: { color: '#6d28d9', fontSize: 12, fontWeight: '600' },
  composerInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 8,
    minHeight: 64,
    fontSize: 14,
    textAlignVertical: 'top',
  },
  mentionDropdown: {
    position: 'absolute',
    top: '100%',
    insetInlineStart: 4,
    marginTop: 4,
    minWidth: 220,
    maxHeight: 240,
    borderWidth: 1,
    borderRadius: 10,
    zIndex: 50,
    elevation: 6,
    overflow: 'hidden',
  },
  mentionRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 12 },
  composerActions: { alignItems: 'center', gap: 8, marginTop: 10 },
  contactInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
  },
  // flexGrow:0 stops the horizontal ScrollView from expanding to fill the column's free vertical
  // space (which stretched the pills into tall full-height cards and pushed the list down).
  pillsScroll: { flexGrow: 0, flexShrink: 0 },
  // alignItems:'center' keeps each chip at its intrinsic (text + small padding) height instead of
  // the horizontal ScrollView's default cross-axis 'stretch', which blew them up vertically.
  scopePills: { gap: 8, paddingHorizontal: 14, paddingVertical: 8, alignItems: 'center' },
  userPills: { gap: 6, paddingHorizontal: 14, paddingBottom: 8, alignItems: 'center' },
  contactSearchRow: { paddingHorizontal: 12, paddingBottom: 6 },
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
  newBadge: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 1 },
  newBadgeText: { color: '#FFF', fontSize: 11, fontWeight: '700' },
  cardFooter: { alignItems: 'center', gap: 4, marginTop: 8 },
});
