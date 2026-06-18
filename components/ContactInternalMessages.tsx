import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, StyleSheet, Pressable, TextInput } from 'react-native';
import { Text, ActivityIndicator, IconButton } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../hooks/useAppTheme';
import { useRTL } from '../hooks/useRTL';
import { useAuthStore } from '../stores/authStore';
import { chatsApi } from '../services/api/chats';
import { usersApi } from '../services/api/users';

interface InternalMessage {
  messageId?: string;
  messageText?: string;
  sentByName?: string;
  createdOn?: string;
  isReadForMe?: boolean;
  mentionedUserIds?: string[];
  mentionedUsers?: any[];
}

interface Props {
  contactPhone: string;
}

const getUserName = (u: any) =>
  u?.userName || u?.UserName || u?.fullname || u?.FullName || u?.name || u?.email || u?.Email || '';
const getUserId = (u: any) => u?.userId || u?.uID || u?.uid || u?.id || '';

export default function ContactInternalMessages({ contactPhone }: Props) {
  const theme = useAppTheme();
  const { isRTL, textAlign } = useRTL();
  const { t } = useTranslation();

  const user = useAuthStore((s) => s.user);
  const organization = user?.organization ?? '';
  const currentUserId = user?.uID || user?.userId || '';
  const canViewAll = user?.SecurityRole === 'Admin';
  const isHe = (user as any)?.language !== 'en';

  const [messages, setMessages] = useState<InternalMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<any[]>([]);

  const [composerText, setComposerText] = useState('');
  const [composerMentions, setComposerMentions] = useState<{ userId: string; userName: string }[]>([]);
  const [sending, setSending] = useState(false);
  const [mentionAtIdx, setMentionAtIdx] = useState<number | null>(null);
  const [mentionOptions, setMentionOptions] = useState<any[]>([]);
  const caretRef = useRef(0);

  useEffect(() => {
    if (!organization) return;
    usersApi.getAll(organization).then(setUsers).catch(() => {});
  }, [organization]);

  const fetchMessages = useCallback(async () => {
    if (!organization || !contactPhone) {
      // Don't spin forever when there is no phone yet — show the empty state instead.
      setMessages([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const list = await chatsApi.getInternalMessagesHub({
        organization,
        scope: 'contact',
        contactId: contactPhone,
        currentUserId,
        canViewAll,
        limit: 100,
      });
      setMessages(list);
    } catch (err) {
      console.error('[ContactInternalMessages] fetch error', err);
      setMessages([]);
    } finally {
      setLoading(false);
    }
  }, [organization, contactPhone, currentUserId, canViewAll]);

  useEffect(() => {
    fetchMessages();
  }, [fetchMessages]);

  const handleComposerChange = (val: string) => {
    setComposerText(val);
    // The selection (caret) updates AFTER onChangeText, so caretRef is stale for the first
    // character typed. When it's stale/out of range, assume the user is typing at the end so
    // typing "@" opens the mention list immediately.
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
      await chatsApi.createInternalMessage({
        organization,
        messageText: composerText,
        mentionedUsers: composerMentions,
        relatedContactPhone: contactPhone,
        generalLabel: isHe ? 'הודעה כללית' : 'General',
        sentById: currentUserId,
        sentByName: getUserName(user) || 'Agent',
      });
      setComposerText('');
      setComposerMentions([]);
      setTimeout(fetchMessages, 400);
    } catch (err) {
      console.error('[ContactInternalMessages] send error', err);
    } finally {
      setSending(false);
    }
  };

  const handleTapMessage = async (msg: InternalMessage) => {
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
  };

  const renderMentionNames = (msg: InternalMessage) => {
    const m = msg.mentionedUsers;
    if (Array.isArray(m) && m.length > 0) {
      const names = m.map((u) => (typeof u === 'string' ? u : u?.userName || u?.name)).filter(Boolean);
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

  return (
    <View style={styles.container}>
      {/* Composer */}
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
            placeholder={t('internalMessages.composerPlaceholder', isHe ? 'כתוב הודעה... הקלד @ לתיוג משתמשים' : 'Write a message... type @ to tag users')}
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
          {composerMentions.length === 0 ? (
            <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant, flex: 1 }}>
              {t('internalMessages.tagAtLeastOne', isHe ? 'יש לתייג לפחות משתמש אחד (@) כדי לשלוח.' : 'Tag at least one user (@) to send.')}
            </Text>
          ) : (
            <View style={{ flex: 1 }} />
          )}
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
      </View>

      {/* Feed */}
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="small" color={theme.colors.primary} />
        </View>
      ) : messages.length === 0 ? (
        <View style={styles.centered}>
          <Text style={{ fontSize: 36 }}>💬</Text>
          <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center', marginTop: 8 }}>
            {t('internalMessages.emptyForContact', isHe ? 'אין הודעות פנימיות לאיש קשר זה' : 'No internal messages for this contact')}
          </Text>
        </View>
      ) : (
        messages.map((item, idx) => {
          const isUnreadForMe = !item.isReadForMe && (item.mentionedUserIds || []).includes(currentUserId);
          return (
            <Pressable
              key={item.messageId || String(idx)}
              onPress={() => handleTapMessage(item)}
              style={[
                styles.card,
                { backgroundColor: theme.colors.surface, borderColor: theme.colors.outline },
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
              </View>
            </Pressable>
          );
        })
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 16, paddingTop: 16 },
  composer: { padding: 12, borderRadius: 12, borderWidth: 1, marginBottom: 14 },
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
    minHeight: 60,
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
  centered: { alignItems: 'center', justifyContent: 'center', paddingVertical: 32 },
  card: { borderRadius: 12, borderWidth: 1, padding: 12, marginBottom: 10 },
  cardHeader: { alignItems: 'center', gap: 8 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { fontSize: 11, fontWeight: '700' },
  newBadge: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 1 },
  newBadgeText: { color: '#FFF', fontSize: 11, fontWeight: '700' },
  cardFooter: { alignItems: 'center', gap: 4, marginTop: 8 },
});
