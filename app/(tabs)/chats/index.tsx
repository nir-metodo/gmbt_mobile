import React, {
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo,
} from 'react';
import {
  View,
  StyleSheet,
  Pressable,
  RefreshControl,
  Animated,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import {
  Text,
  Searchbar,
  Chip,
  FAB,
  Avatar,
  Divider,
  Menu,
  Badge,
  Portal,
  Modal,
  Button,
  TextInput as PaperInput,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useChatStore } from '../../../stores/chatStore';
import { useAuthStore } from '../../../stores/authStore';
import { useAppTheme } from '../../../hooks/useAppTheme';
import { useRTL } from '../../../hooks/useRTL';
import { formatChatTime, getInitials } from '../../../utils/formatters';
import WebSocketService from '../../../services/websocket';
import type { Chat } from '../../../types';

const FILTER_OPTIONS = ['all', 'unread', 'open', 'closed', 'myChats', 'internal'] as const;

export default function ChatsListScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useAppTheme();
  const { isRTL, flexDirection, textAlign } = useRTL();
  const { t, i18n } = useTranslation();
  const lang = i18n.language as 'en' | 'he';

  const user = useAuthStore((s) => s.user);
  const chats = useChatStore((s) => s.chats);
  const isLoadingChats = useChatStore((s) => s.isLoadingChats);
  const searchQuery = useChatStore((s) => s.searchQuery);
  const setSearchQuery = useChatStore((s) => s.setSearchQuery);
  const filter = useChatStore((s) => s.filter);
  const setFilter = useChatStore((s) => s.setFilter);
  const categoryFilter = useChatStore((s) => s.categoryFilter);
  const setCategoryFilter = useChatStore((s) => s.setCategoryFilter);
  const ownerFilter = useChatStore((s) => s.ownerFilter);
  const setOwnerFilter = useChatStore((s) => s.setOwnerFilter);
  const loadChats = useChatStore((s) => s.loadChats);
  const setChats = useChatStore((s) => s.setChats);
  const addOrUpdateChat = useChatStore((s) => s.addOrUpdateChat);

  const [categoryMenuVisible, setCategoryMenuVisible] = useState(false);
  const [ownerMenuVisible, setOwnerMenuVisible] = useState(false);
  const [newChatVisible, setNewChatVisible] = useState(false);
  const [newChatPhone, setNewChatPhone] = useState('');

  const [refreshing, setRefreshing] = useState(false);
  const [searchVisible, setSearchVisible] = useState(false);
  const searchAnim = useRef(new Animated.Value(0)).current;
  const wsRef = useRef<WebSocketService | null>(null);

  useEffect(() => {
    if (user?.organization) {
      loadChats(user.organization);
    }
  }, [user?.organization]);

  // Polling fallback: refresh chat list every 15s to catch messages missed by WebSocket
  useEffect(() => {
    if (!user?.organization) return;
    const interval = setInterval(() => {
      loadChats(user.organization);
    }, 15000);
    return () => clearInterval(interval);
  }, [user?.organization, loadChats]);

  useEffect(() => {
    if (!user?.organization) return;

    const ws = WebSocketService.getInstance(user.organization, null, 'message');

    ws.on('any', ({ data }) => {
      if (!data) return;
      if (data.type === 'new_message' || data.type === 'message') {
        const msg = data.message || data;
        if (msg.phoneNumber || msg.from) {
          addOrUpdateChat({
            id: msg.phoneNumber || msg.from,
            phoneNumber: msg.phoneNumber || msg.from,
            contactName:
              msg.contactName ||
              msg.senderName ||
              msg.phoneNumber ||
              msg.from,
            lastMessage: msg.body || msg.message || '',
            lastMessageTime: msg.timestamp || new Date().toISOString(),
            unreadCount: (msg.unreadCount ?? 0) + 1,
            isOnline: msg.isOnline,
            profilePicture: msg.profilePicture,
            status: msg.status,
          });
        }
      }
      if (data.type === 'chat_list' || data.type === 'chats') {
        if (Array.isArray(data.chats)) {
          setChats(data.chats);
        }
      }
      // Reload full list on any WS event so ordering stays fresh
      if (data.type === 'new_message' || data.type === 'message') {
        loadChats(user.organization);
      }
    });

    wsRef.current = ws;
    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [user?.organization, addOrUpdateChat, setChats, loadChats]);

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

  const categories = useMemo(() => {
    const cats = new Set<string>();
    chats.forEach((c) => {
      if (c.category) cats.add(c.category);
    });
    return ['all', ...Array.from(cats)];
  }, [chats]);

  const owners = useMemo(() => {
    const ownerSet = new Set<string>();
    chats.forEach((c) => {
      if (c.ownerName) ownerSet.add(c.ownerName);
    });
    return ['all', ...Array.from(ownerSet)];
  }, [chats]);

  const filteredChats = useMemo(() => {
    let result = chats;

    if (filter === 'unread') {
      result = result.filter((c) => c.unreadCount > 0 || c.isRead === false);
    } else if (filter === 'open') {
      result = result.filter((c) => {
        const s = (c.status || c.lastConversationStatus || '').toLowerCase();
        return s !== 'closed';
      });
    } else if (filter === 'closed') {
      result = result.filter((c) => {
        const s = (c.status || c.lastConversationStatus || '').toLowerCase();
        return s === 'closed';
      });
    } else if (filter === 'myChats') {
      const userId = user?.uID || user?.userId;
      result = result.filter((c) => c.ownerId === userId);
    } else if (filter === 'internal') {
      result = result.filter((c) => (c as any).usersWithUnreadInternalMessages?.includes(user?.uID || user?.userId));
    }

    if (categoryFilter !== 'all') {
      result = result.filter((c) => c.category === categoryFilter);
    }

    if (ownerFilter !== 'all') {
      result = result.filter((c) => c.ownerName === ownerFilter);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (c) =>
          c.contactName?.toLowerCase().includes(q) ||
          c.phoneNumber?.includes(q) ||
          c.lastMessage?.toLowerCase().includes(q),
      );
    }

    return result;
  }, [chats, filter, searchQuery, categoryFilter, ownerFilter, user]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    if (user?.organization) await loadChats(user.organization);
    setRefreshing(false);
  }, [user?.organization, loadChats]);

  const openChat = useCallback(
    (chat: Chat) => {
      router.push({
        pathname: '/(tabs)/chats/[phoneNumber]',
        params: { phoneNumber: chat.phoneNumber },
      });
    },
    [router],
  );

  const renderChatItem = useCallback(
    ({ item }: { item: Chat }) => {
      const hasUnread = item.unreadCount > 0;

      return (
        <Pressable
          onPress={() => openChat(item)}
          android_ripple={{ color: theme.colors.surfaceVariant }}
          style={({ pressed }) => [
            styles.chatItem,
            {
              backgroundColor: pressed
                ? theme.colors.surfaceVariant
                : theme.colors.surface,
              flexDirection,
            },
          ]}
        >
          <View style={styles.avatarWrap}>
            {item.profilePicture ? (
              <Avatar.Image
                size={52}
                source={{ uri: item.profilePicture }}
              />
            ) : (
              <Avatar.Text
                size={52}
                label={getInitials(item.contactName)}
                style={{ backgroundColor: theme.colors.primaryContainer }}
                labelStyle={{
                  color: theme.colors.primary,
                  fontWeight: '700',
                }}
              />
            )}
            {item.isOnline && (
              <View
                style={[
                  styles.onlineDot,
                  { borderColor: theme.colors.surface },
                ]}
              />
            )}
          </View>

          <View style={[styles.chatContent, { alignItems: isRTL ? 'flex-end' : 'flex-start' }]}>
            <View style={[styles.chatTopRow, { flexDirection }]}>
              <Text
                variant="titleMedium"
                numberOfLines={1}
                style={[
                  styles.contactName,
                  hasUnread && styles.contactNameUnread,
                  { color: theme.colors.onSurface, textAlign },
                ]}
              >
                {item.contactName || item.phoneNumber}
              </Text>
              <Text
                variant="labelSmall"
                style={[
                  styles.chatTime,
                  {
                    color: hasUnread
                      ? theme.colors.primary
                      : theme.colors.onSurfaceVariant,
                  },
                ]}
              >
                {formatChatTime(item.lastMessageTime, lang)}
              </Text>
            </View>

            <View style={[styles.chatBottomRow, { flexDirection }]}>
              <Text
                variant="bodyMedium"
                numberOfLines={1}
                style={[
                  styles.lastMessage,
                  { color: theme.colors.onSurfaceVariant, textAlign },
                ]}
              >
                {item.lastMessage}
              </Text>
              {hasUnread && (
                <View
                  style={[
                    styles.unreadBadge,
                    { backgroundColor: theme.custom.unreadBadge },
                  ]}
                >
                  <Text style={styles.unreadText}>
                    {item.unreadCount > 99 ? '99+' : item.unreadCount}
                  </Text>
                </View>
              )}
            </View>
          </View>
        </Pressable>
      );
    },
    [theme, openChat, flexDirection, textAlign, isRTL, lang],
  );

  const renderEmpty = useCallback(
    () => (
      <View style={styles.emptyContainer}>
        <MaterialCommunityIcons
          name="chat-outline"
          size={72}
          color={theme.colors.onSurfaceVariant}
          style={{ opacity: 0.4 }}
        />
        <Text
          variant="titleMedium"
          style={[styles.emptyTitle, { color: theme.colors.onSurface }]}
        >
          {t('chats.noChats')}
        </Text>
        <Text
          variant="bodyMedium"
          style={{
            color: theme.colors.onSurfaceVariant,
            textAlign: 'center',
          }}
        >
          {t(
            'chats.startConversation',
            'Tap the button below to start a new conversation',
          )}
        </Text>
      </View>
    ),
    [theme, t],
  );

  const searchHeightInterp = searchAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 56],
  });

  return (
    <View
      style={[styles.screen, { backgroundColor: theme.colors.background }]}
    >
      {/* Header */}
      <View
        style={[
          styles.header,
          {
            backgroundColor: theme.custom.headerBackground,
            paddingTop: insets.top + 8,
          },
        ]}
      >
        <Text style={styles.headerTitle}>{t('chats.title')}</Text>
        <Pressable
          onPress={toggleSearch}
          hitSlop={8}
          style={({ pressed }) => [
            styles.headerIcon,
            pressed && { opacity: 0.7 },
          ]}
        >
          <MaterialCommunityIcons
            name={searchVisible ? 'close' : 'magnify'}
            size={24}
            color={theme.custom.headerText}
          />
        </Pressable>
      </View>

      {/* Search bar */}
      {searchVisible && (
        <Animated.View
          style={[
            styles.searchWrap,
            {
              height: searchHeightInterp,
              opacity: searchAnim,
              backgroundColor: theme.custom.headerBackground,
            },
          ]}
        >
          <Searchbar
            placeholder={t('chats.searchPlaceholder')}
            value={searchQuery}
            onChangeText={setSearchQuery}
            style={[
              styles.searchbar,
              { backgroundColor: theme.colors.surface },
            ]}
            inputStyle={{
              fontSize: 14,
              textAlign: isRTL ? 'right' : 'left',
            }}
            iconColor={theme.colors.onSurfaceVariant}
            autoFocus
          />
        </Animated.View>
      )}

      {/* Filter chips */}
      <View
        style={[
          styles.filtersRow,
          {
            backgroundColor: theme.colors.surface,
            borderBottomColor: theme.colors.outline,
          },
        ]}
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={[styles.filtersScroll, { flexDirection }]}
        >
          {FILTER_OPTIONS.map((f) => (
            <Chip
              key={f}
              selected={filter === f}
              onPress={() => setFilter(f)}
              showSelectedOverlay
              compact
              style={[
                styles.filterChip,
                filter === f
                  ? { backgroundColor: theme.colors.primaryContainer }
                  : { backgroundColor: theme.colors.surfaceVariant },
              ]}
              textStyle={[
                styles.filterChipText,
                filter === f && {
                  color: theme.colors.primary,
                  fontWeight: '600',
                },
              ]}
            >
              {t(`chats.${f}`)}
            </Chip>
          ))}

          {categories.length > 1 && (
            <Menu
              visible={categoryMenuVisible}
              onDismiss={() => setCategoryMenuVisible(false)}
              anchor={
                <Chip
                  icon="tag-outline"
                  onPress={() => setCategoryMenuVisible(true)}
                  compact
                  style={[
                    styles.filterChip,
                    categoryFilter !== 'all'
                      ? { backgroundColor: theme.colors.primaryContainer }
                      : { backgroundColor: theme.colors.surfaceVariant },
                  ]}
                  textStyle={[
                    styles.filterChipText,
                    categoryFilter !== 'all' && { color: theme.colors.primary, fontWeight: '600' },
                  ]}
                >
                  {categoryFilter === 'all' ? t('chats.category') : categoryFilter}
                </Chip>
              }
            >
              {categories.map((c) => (
                <Menu.Item
                  key={c}
                  title={c === 'all' ? t('common.all') : c}
                  onPress={() => { setCategoryFilter(c); setCategoryMenuVisible(false); }}
                  leadingIcon={categoryFilter === c ? 'check' : undefined}
                />
              ))}
            </Menu>
          )}

          {owners.length > 1 && (
            <Menu
              visible={ownerMenuVisible}
              onDismiss={() => setOwnerMenuVisible(false)}
              anchor={
                <Chip
                  icon="account-outline"
                  onPress={() => setOwnerMenuVisible(true)}
                  compact
                  style={[
                    styles.filterChip,
                    ownerFilter !== 'all'
                      ? { backgroundColor: theme.colors.primaryContainer }
                      : { backgroundColor: theme.colors.surfaceVariant },
                  ]}
                  textStyle={[
                    styles.filterChipText,
                    ownerFilter !== 'all' && { color: theme.colors.primary, fontWeight: '600' },
                  ]}
                >
                  {ownerFilter === 'all' ? t('chats.owner') : ownerFilter}
                </Chip>
              }
            >
              {owners.map((o) => (
                <Menu.Item
                  key={o}
                  title={o === 'all' ? t('common.all') : o}
                  onPress={() => { setOwnerFilter(o); setOwnerMenuVisible(false); }}
                  leadingIcon={ownerFilter === o ? 'check' : undefined}
                />
              ))}
            </Menu>
          )}
        </ScrollView>
      </View>

      {/* Chat list */}
      <FlashList
        data={filteredChats}
        renderItem={renderChatItem}
        keyExtractor={(item) => item.phoneNumber}
        ItemSeparatorComponent={() => (
          <Divider style={{ marginStart: 78 }} />
        )}
        ListEmptyComponent={
          isLoadingChats && chats.length === 0 ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={theme.colors.primary} />
              <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant, marginTop: 12 }}>
                {t('common.loading')}
              </Text>
            </View>
          ) : (
            renderEmpty()
          )
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing || isLoadingChats}
            onRefresh={onRefresh}
            colors={[theme.colors.primary]}
            tintColor={theme.colors.primary}
          />
        }
        contentContainerStyle={styles.listContent}
      />

      <FAB
        icon="message-plus"
        onPress={() => setNewChatVisible(true)}
        style={[
          styles.fab,
          {
            backgroundColor: theme.colors.primary,
            bottom: insets.bottom + 16,
            left: isRTL ? 16 : undefined,
            right: isRTL ? undefined : 16,
          },
        ]}
        color="#FFFFFF"
      />

      <Portal>
        <Modal
          visible={newChatVisible}
          onDismiss={() => { setNewChatVisible(false); setNewChatPhone(''); }}
          contentContainerStyle={[styles.newChatModal, { backgroundColor: theme.colors.surface }]}
        >
          <Text variant="titleMedium" style={{ color: theme.colors.onSurface, marginBottom: 16 }}>
            {t('chats.newChat', 'New Chat')}
          </Text>
          <PaperInput
            label={t('chats.phoneNumber', 'Phone Number')}
            value={newChatPhone}
            onChangeText={setNewChatPhone}
            keyboardType="phone-pad"
            mode="outlined"
            style={{ marginBottom: 16 }}
          />
          <View style={{ flexDirection: isRTL ? 'row-reverse' : 'row', justifyContent: 'flex-end', gap: 8 }}>
            <Button mode="outlined" onPress={() => { setNewChatVisible(false); setNewChatPhone(''); }}>
              {t('common.cancel')}
            </Button>
            <Button
              mode="contained"
              disabled={!newChatPhone.trim()}
              onPress={() => {
                const phone = newChatPhone.trim().replace(/\D/g, '');
                if (phone) {
                  setNewChatVisible(false);
                  setNewChatPhone('');
                  router.push(`/(tabs)/chats/${phone}`);
                }
              }}
            >
              {t('chats.startChat', 'Start Chat')}
            </Button>
          </View>
        </Modal>
      </Portal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingBottom: 12,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  headerIcon: {
    padding: 4,
  },
  searchWrap: {
    paddingHorizontal: 14,
    overflow: 'hidden',
    justifyContent: 'center',
    paddingBottom: 8,
  },
  searchbar: {
    height: 40,
    borderRadius: 20,
    elevation: 0,
  },
  filtersRow: {
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  filtersScroll: {
    paddingHorizontal: 14,
    gap: 8,
    alignItems: 'center',
  },
  filterChip: {
    height: 32,
  },
  filterChipText: {
    fontSize: 13,
  },
  listContent: {
    paddingBottom: 100,
  },
  chatItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  avatarWrap: {
    position: 'relative',
    marginRight: 14,
  },
  onlineDot: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 13,
    height: 13,
    borderRadius: 7,
    backgroundColor: '#4CAF50',
    borderWidth: 2,
  },
  chatContent: {
    flex: 1,
    justifyContent: 'center',
  },
  chatTopRow: {
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 3,
  },
  contactName: {
    flex: 1,
    fontSize: 16,
    marginRight: 8,
  },
  contactNameUnread: {
    fontWeight: '700',
  },
  chatTime: {
    fontSize: 12,
  },
  chatBottomRow: {
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  lastMessage: {
    flex: 1,
    fontSize: 14,
    marginRight: 8,
  },
  unreadBadge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  unreadText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 120,
    paddingHorizontal: 40,
    gap: 12,
  },
  emptyTitle: {
    fontWeight: '600',
    marginTop: 8,
  },
  fab: {
    position: 'absolute',
    borderRadius: 16,
  },
  newChatModal: {
    margin: 24,
    padding: 24,
    borderRadius: 16,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 120,
  },
});
