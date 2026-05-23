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
  Alert,
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
import { getDataVisibility } from '../../../constants/permissions';
import { ENDPOINTS } from '../../../constants/api';
import axiosInstance from '../../../services/api/axiosInstance';
import type { Chat } from '../../../types';

const FILTER_OPTIONS = ['all', 'unread', 'open', 'closed', 'myChats', 'internal'] as const;

interface SavedView {
  id: string;
  Name: string;
  ViewData: { filters?: any; searchTerm?: string };
  IsPinned?: boolean;
  Visibility?: string;
  UserId?: string;
}

const ChatDivider = () => <Divider style={{ marginStart: 78 }} />;
const chatKeyExtractor = (item: Chat) => item.phoneNumber;

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
  const storeSetSearchQuery = useChatStore((s) => s.setSearchQuery);
  const filter = useChatStore((s) => s.filter);
  const setFilter = useChatStore((s) => s.setFilter);
  const categoryFilter = useChatStore((s) => s.categoryFilter);
  const setCategoryFilter = useChatStore((s) => s.setCategoryFilter);
  const ownerFilter = useChatStore((s) => s.ownerFilter);
  const setOwnerFilter = useChatStore((s) => s.setOwnerFilter);
  const loadChats = useChatStore((s) => s.loadChats);
  const setChats = useChatStore((s) => s.setChats);
  const addOrUpdateChat = useChatStore((s) => s.addOrUpdateChat);

  const chatsDV = getDataVisibility(user?.DataVisibility, user?.SecurityRole, 'chats');
  const currentUserId = user?.uID || user?.userId || '';
  const userIsAdmin = user?.SecurityRole === 'admin' || user?.SecurityRole === 'Admin';

  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchInput), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const [categoryMenuVisible, setCategoryMenuVisible] = useState(false);
  const [ownerMenuVisible, setOwnerMenuVisible] = useState(false);
  const [groupMenuVisible, setGroupMenuVisible] = useState(false);
  const [leadStageMenuVisible, setLeadStageMenuVisible] = useState(false);
  const [newChatVisible, setNewChatVisible] = useState(false);
  const [newChatPhone, setNewChatPhone] = useState('');

  const [refreshing, setRefreshing] = useState(false);
  const [searchVisible, setSearchVisible] = useState(false);
  const searchAnim = useRef(new Animated.Value(0)).current;
  const wsRef = useRef<WebSocketService | null>(null);

  // Saved Views
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [activeViewId, setActiveViewId] = useState<string>('__all__');
  const [showSaveViewModal, setShowSaveViewModal] = useState(false);
  const [newViewName, setNewViewName] = useState('');
  const [saveViewVisibility, setSaveViewVisibility] = useState<'personal' | 'shared'>('personal');

  // Advanced filters
  const [groupFilter, setGroupFilter] = useState<string[]>([]);
  const [leadStageFilter, setLeadStageFilter] = useState<string[]>([]);
  const [contactGroups, setContactGroups] = useState<string[]>([]);
  const [leadStages, setLeadStages] = useState<{ id: string; name: string; color?: string }[]>([]);

  // Lead/case stage map for chat list badges
  const [contactLeadMap, setContactLeadMap] = useState<Record<string, { stageName: string; stageColor: string }>>({});

  // Load saved views
  useEffect(() => {
    if (!user?.organization) return;
    axiosInstance.post(ENDPOINTS.GET_USER_VIEWS, {
      organization: user.organization,
      userId: user.uID || user.userId,
      viewType: 'sidebar',
    }).then((res) => {
      const data = res.data;
      if (data?.Success && data?.Data?.views) {
        setSavedViews(data.Data.views);
      } else if (Array.isArray(data)) {
        setSavedViews(data);
      }
    }).catch(() => {});
  }, [user?.organization, user?.uID, user?.userId]);

  // Load contact groups and lead stages
  useEffect(() => {
    if (!user?.organization) return;
    axiosInstance.post(ENDPOINTS.GET_ALL_KEYS, { organization: user.organization })
      .then((res) => {
        const raw = res.data;
        const keys = Array.isArray(raw) ? raw : raw?.Data || raw?.data || [];
        setContactGroups(keys.map((k: any) => typeof k === 'string' ? k : k.name || k.Name || '').filter(Boolean));
      }).catch(() => {});

    axiosInstance.post(ENDPOINTS.GET_PIPELINE_SETTINGS, { organization: user.organization })
      .then((res) => {
        const raw = res.data;
        const stages = raw?.stages || raw?.Data?.stages || raw?.pipelines?.[0]?.stages || [];
        const stageArr = Array.isArray(stages) ? stages : [];
        setLeadStages(stageArr.map((s: any) => ({ id: s.id || s.Id, name: s.name || s.Name || s.stageName, color: s.color })));

        // Build contact→lead stage map
        axiosInstance.post(ENDPOINTS.GET_LEADS, { organization: user.organization, pageSize: 500 })
          .then((leadsRes) => {
            const leads = leadsRes.data?.Data || leadsRes.data?.data || leadsRes.data || [];
            if (!Array.isArray(leads)) return;
            const stageMap: Record<string, any> = {};
            stageArr.forEach((s: any) => { stageMap[s.id || s.Id] = s; });
            const map: Record<string, { stageName: string; stageColor: string }> = {};
            leads.forEach((lead: any) => {
              const phone = (lead.contactPhone || lead.phoneNumber || '').replace(/\D/g, '');
              if (phone && lead.stageId) {
                const stageInfo = stageMap[lead.stageId];
                const name = stageInfo?.name || stageInfo?.Name || lead.stageName;
                if (!name) return;
                map[phone] = { stageName: name, stageColor: stageInfo?.color || '#7c3aed' };
              }
            });
            setContactLeadMap(map);
          }).catch(() => {});
      }).catch(() => {});
  }, [user?.organization]);

  const loadSavedView = useCallback((view: SavedView) => {
    const viewData = view.ViewData || {};
    const filters = viewData.filters || {};
    setActiveViewId(view.id);
    setFilter(filters.myConversations ? 'myChats' : filters.unread ? 'unread' : filters.openConversations ? 'open' : 'all');
    setCategoryFilter(filters.category || 'all');
    setOwnerFilter(filters.owner || 'all');
    setGroupFilter(filters.contactGroup || []);
    setLeadStageFilter(filters.leadStage || []);
    if (viewData.searchTerm) {
      setSearchInput(viewData.searchTerm);
    }
  }, [setFilter, setCategoryFilter, setOwnerFilter]);

  const clearAllFilters = useCallback(() => {
    setActiveViewId('__all__');
    setFilter('all');
    setCategoryFilter('all');
    setOwnerFilter('all');
    setGroupFilter([]);
    setLeadStageFilter([]);
    setSearchInput('');
    setDebouncedSearch('');
    storeSetSearchQuery('');
  }, [setFilter, setCategoryFilter, setOwnerFilter, storeSetSearchQuery]);

  const saveCurrentView = useCallback(async () => {
    if (!newViewName.trim() || !user?.organization) return;
    try {
      const viewData = {
        filters: {
          myConversations: filter === 'myChats',
          unread: filter === 'unread',
          openConversations: filter === 'open',
          category: categoryFilter !== 'all' ? categoryFilter : '',
          owner: ownerFilter !== 'all' ? ownerFilter : '',
          contactGroup: groupFilter,
          leadStage: leadStageFilter,
        },
        searchTerm: searchInput,
      };
      const res = await axiosInstance.post(ENDPOINTS.SAVE_USER_VIEW, {
        organization: user.organization,
        userId: user.uID || user.userId,
        viewType: 'sidebar',
        name: newViewName.trim(),
        isPinned: false,
        viewData,
        visibility: userIsAdmin ? saveViewVisibility : 'personal',
      });
      if (res.data?.Success) {
        const newView: SavedView = {
          id: res.data.Data?.id || Date.now().toString(),
          Name: newViewName.trim(),
          ViewData: viewData,
          IsPinned: false,
          Visibility: userIsAdmin ? saveViewVisibility : 'personal',
          UserId: user.uID || user.userId,
        };
        setSavedViews((prev) => [...prev, newView]);
      }
    } catch {}
    setShowSaveViewModal(false);
    setNewViewName('');
    setSaveViewVisibility('personal');
  }, [newViewName, user, filter, categoryFilter, ownerFilter, groupFilter, leadStageFilter, searchInput, userIsAdmin, saveViewVisibility]);

  const deleteSavedView = useCallback(async (viewId: string) => {
    if (!user?.organization) return;
    try {
      await axiosInstance.post(ENDPOINTS.DELETE_USER_VIEW, {
        organization: user.organization,
        userId: user.uID || user.userId,
        viewId,
      });
      setSavedViews((prev) => prev.filter((v) => v.id !== viewId));
      if (activeViewId === viewId) clearAllFilters();
    } catch {}
  }, [user, activeViewId, clearAllFilters]);

  useEffect(() => {
    if (user?.organization) {
      loadChats(
        user.organization,
        chatsDV === 'own' ? currentUserId : '',
        chatsDV === 'own' ? 'own' : 'all',
      );
    }
  }, [user?.organization, chatsDV, currentUserId]);

  // Polling fallback: refresh chat list every 60s to catch messages missed by WebSocket
  useEffect(() => {
    if (!user?.organization) return;
    const interval = setInterval(() => {
      loadChats(
        user.organization,
        chatsDV === 'own' ? currentUserId : '',
        chatsDV === 'own' ? 'own' : 'all',
      );
    }, 60000);
    return () => clearInterval(interval);
  }, [user?.organization, loadChats, chatsDV, currentUserId]);

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
        setSearchInput('');
        setDebouncedSearch('');
        storeSetSearchQuery('');
      });
    }
  }, [searchVisible, searchAnim, storeSetSearchQuery]);

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

    if (groupFilter.length > 0) {
      result = result.filter((c) => {
        const keys = (c as any).keys || (c as any).searchKeys || [];
        return groupFilter.some((g) => keys.includes(g));
      });
    }

    if (leadStageFilter.length > 0) {
      result = result.filter((c) => {
        const phoneNorm = (c.phoneNumber || '').replace(/\D/g, '');
        const leadInfo = contactLeadMap[phoneNorm];
        const stageId = (c as any).leadStageId || (c as any).leadStage;
        return (stageId && leadStageFilter.includes(stageId)) || (leadInfo && leadStages.some(s => leadStageFilter.includes(s.id) && s.name === leadInfo.stageName));
      });
    }

    if (debouncedSearch.trim()) {
      const q = debouncedSearch.trim().toLowerCase();
      result = result.filter(
        (c) =>
          c.contactName?.toLowerCase().includes(q) ||
          c.phoneNumber?.includes(q) ||
          c.lastMessage?.toLowerCase().includes(q),
      );
    }

    return result;
  }, [chats, filter, debouncedSearch, categoryFilter, ownerFilter, groupFilter, leadStageFilter, user, contactLeadMap, leadStages]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    if (user?.organization) {
      await loadChats(
        user.organization,
        chatsDV === 'own' ? currentUserId : '',
        chatsDV === 'own' ? 'own' : 'all',
      );
    }
    setRefreshing(false);
  }, [user?.organization, loadChats, chatsDV, currentUserId]);

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
      const phoneNorm = (item.phoneNumber || '').replace(/\D/g, '');
      const leadInfo = contactLeadMap[phoneNorm];
      const displayLeadStage = item.leadStageName || leadInfo?.stageName || '';
      const displayLeadColor = item.leadStageColor || leadInfo?.stageColor || '#7c3aed';

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

            {/* Badges row: status, lead stage, case stage, CTWA */}
            {(item.lastConversationStatus || displayLeadStage || item.caseStageName || item.isCTWA) && (
              <View style={[styles.badgesRow, { flexDirection }]}>
                {!!item.lastConversationStatus && (
                  <View style={[styles.badge, {
                    backgroundColor: item.lastConversationStatus === 'Open' ? '#dcfce7' :
                      item.lastConversationStatus === 'In Process' ? '#fef9c3' : '#f1f5f9',
                  }]}>
                    <Text style={[styles.badgeText, {
                      color: item.lastConversationStatus === 'Open' ? '#16a34a' :
                        item.lastConversationStatus === 'In Process' ? '#ca8a04' : '#64748b',
                    }]}>
                      {item.lastConversationStatus === 'Open' ? t('chats.open') :
                        item.lastConversationStatus === 'Closed' ? t('chats.closed') : item.lastConversationStatus}
                    </Text>
                  </View>
                )}
                {!!displayLeadStage && (
                  <View style={[styles.badge, { backgroundColor: displayLeadColor + '20' }]}>
                    <Text style={[styles.badgeText, { color: displayLeadColor }]}>
                      {displayLeadStage}
                    </Text>
                  </View>
                )}
                {!!item.caseStageName && (
                  <View style={[styles.badge, { backgroundColor: (item.caseStageColor || '#0891b2') + '20' }]}>
                    <Text style={[styles.badgeText, { color: item.caseStageColor || '#0891b2' }]}>
                      {item.caseStageName}
                    </Text>
                  </View>
                )}
                {item.isCTWA && (
                  <View style={[styles.badge, { backgroundColor: '#dbeafe' }]}>
                    <MaterialCommunityIcons name="cursor-default-click" size={10} color="#2563eb" style={{ marginEnd: 2 }} />
                    <Text style={[styles.badgeText, { color: '#2563eb' }]}>CTWA</Text>
                  </View>
                )}
              </View>
            )}

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
    [theme, openChat, flexDirection, textAlign, isRTL, lang, contactLeadMap, t],
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
            value={searchInput}
            onChangeText={setSearchInput}
            returnKeyType="search"
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

      {/* Saved Views Tabs */}
      <View style={[styles.viewsRow, { backgroundColor: theme.colors.surface, borderBottomColor: theme.colors.outline }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.filtersScroll, { flexDirection }]}>
          <Pressable
            onPress={clearAllFilters}
            style={[styles.viewTab, activeViewId === '__all__' && { borderBottomColor: theme.colors.primary, borderBottomWidth: 2 }]}
          >
            <Text style={[styles.viewTabText, { color: activeViewId === '__all__' ? theme.colors.primary : theme.colors.onSurfaceVariant }]}>
              {t('sidebar.allConversations', 'הכל')}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => { setActiveViewId('__mine__'); setFilter('myChats'); }}
            style={[styles.viewTab, activeViewId === '__mine__' && { borderBottomColor: theme.colors.primary, borderBottomWidth: 2 }]}
          >
            <Text style={[styles.viewTabText, { color: activeViewId === '__mine__' ? theme.colors.primary : theme.colors.onSurfaceVariant }]}>
              {t('sidebar.myConversations', 'שלי')}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => { setActiveViewId('__unread__'); setFilter('unread'); }}
            style={[styles.viewTab, activeViewId === '__unread__' && { borderBottomColor: theme.colors.primary, borderBottomWidth: 2 }]}
          >
            <Text style={[styles.viewTabText, { color: activeViewId === '__unread__' ? theme.colors.primary : theme.colors.onSurfaceVariant }]}>
              {t('sidebar.unread', 'לא נקרא')}
            </Text>
          </Pressable>
          {savedViews.filter((v) => {
            const vis = v.Visibility || 'personal';
            if (vis === 'shared') return true;
            return (v.UserId || '') === (user?.uID || user?.userId || '');
          }).map((view) => (
            <Pressable
              key={view.id}
              onPress={() => loadSavedView(view)}
              onLongPress={() => {
                Alert.alert(
                  view.Name,
                  t('sidebar.deleteViewConfirm', 'למחוק תצוגה זו?'),
                  [
                    { text: t('common.cancel'), style: 'cancel' },
                    { text: t('common.delete', 'מחק'), style: 'destructive', onPress: () => deleteSavedView(view.id) },
                  ],
                );
              }}
              style={[styles.viewTab, activeViewId === view.id && { borderBottomColor: theme.colors.primary, borderBottomWidth: 2 }]}
            >
              <Text style={[styles.viewTabText, { color: activeViewId === view.id ? theme.colors.primary : theme.colors.onSurfaceVariant }]} numberOfLines={1}>
                {(view.Visibility === 'shared' ? '👥 ' : '') + view.Name}
              </Text>
            </Pressable>
          ))}
          <Pressable onPress={() => setShowSaveViewModal(true)} style={styles.viewTab}>
            <MaterialCommunityIcons name="plus" size={18} color={theme.colors.primary} />
          </Pressable>
        </ScrollView>
      </View>

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
              onPress={() => { setFilter(f); setActiveViewId(''); }}
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

          {contactGroups.length > 0 && (
            <Menu
              visible={groupMenuVisible}
              onDismiss={() => setGroupMenuVisible(false)}
              anchor={
                <Chip
                  icon="account-multiple-outline"
                  onPress={() => setGroupMenuVisible(true)}
                  compact
                  style={[
                    styles.filterChip,
                    groupFilter.length > 0
                      ? { backgroundColor: theme.colors.primaryContainer }
                      : { backgroundColor: theme.colors.surfaceVariant },
                  ]}
                  textStyle={[
                    styles.filterChipText,
                    groupFilter.length > 0 && { color: theme.colors.primary, fontWeight: '600' },
                  ]}
                >
                  {groupFilter.length > 0 ? `${t('chats.groups', 'קבוצות')} (${groupFilter.length})` : t('chats.groups', 'קבוצות')}
                </Chip>
              }
            >
              <Menu.Item
                title={t('common.all')}
                onPress={() => { setGroupFilter([]); setGroupMenuVisible(false); }}
                leadingIcon={groupFilter.length === 0 ? 'check' : undefined}
              />
              {contactGroups.map((g) => (
                <Menu.Item
                  key={g}
                  title={g}
                  onPress={() => {
                    setGroupFilter((prev) => prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g]);
                  }}
                  leadingIcon={groupFilter.includes(g) ? 'check' : undefined}
                />
              ))}
            </Menu>
          )}

          {leadStages.length > 0 && (
            <Menu
              visible={leadStageMenuVisible}
              onDismiss={() => setLeadStageMenuVisible(false)}
              anchor={
                <Chip
                  icon="trending-up"
                  onPress={() => setLeadStageMenuVisible(true)}
                  compact
                  style={[
                    styles.filterChip,
                    leadStageFilter.length > 0
                      ? { backgroundColor: theme.colors.primaryContainer }
                      : { backgroundColor: theme.colors.surfaceVariant },
                  ]}
                  textStyle={[
                    styles.filterChipText,
                    leadStageFilter.length > 0 && { color: theme.colors.primary, fontWeight: '600' },
                  ]}
                >
                  {leadStageFilter.length > 0 ? `${t('chats.leadStage', 'שלב ליד')} (${leadStageFilter.length})` : t('chats.leadStage', 'שלב ליד')}
                </Chip>
              }
            >
              <Menu.Item
                title={t('common.all')}
                onPress={() => { setLeadStageFilter([]); setLeadStageMenuVisible(false); }}
                leadingIcon={leadStageFilter.length === 0 ? 'check' : undefined}
              />
              {leadStages.map((s) => (
                <Menu.Item
                  key={s.id}
                  title={s.name}
                  onPress={() => {
                    setLeadStageFilter((prev) => prev.includes(s.id) ? prev.filter((x) => x !== s.id) : [...prev, s.id]);
                  }}
                  leadingIcon={leadStageFilter.includes(s.id) ? 'check' : undefined}
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
        keyExtractor={chatKeyExtractor}
        ItemSeparatorComponent={ChatDivider}
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
            refreshing={refreshing}
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

        {/* Save View Modal */}
        <Modal
          visible={showSaveViewModal}
          onDismiss={() => { setShowSaveViewModal(false); setNewViewName(''); }}
          contentContainerStyle={[styles.newChatModal, { backgroundColor: theme.colors.surface }]}
        >
          <Text variant="titleMedium" style={{ color: theme.colors.onSurface, marginBottom: 16 }}>
            {t('sidebar.saveCurrentView', 'שמור תצוגה נוכחית')}
          </Text>
          <PaperInput
            label={t('sidebar.viewName', 'שם התצוגה')}
            value={newViewName}
            onChangeText={setNewViewName}
            mode="outlined"
            style={{ marginBottom: 12 }}
          />
          {userIsAdmin && (
            <View style={{ flexDirection: isRTL ? 'row-reverse' : 'row', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              <Chip
                selected={saveViewVisibility === 'personal'}
                onPress={() => setSaveViewVisibility('personal')}
                compact
                style={{ backgroundColor: saveViewVisibility === 'personal' ? theme.colors.primaryContainer : theme.colors.surfaceVariant }}
              >
                {t('sidebar.onlyMe', 'רק לי')}
              </Chip>
              <Chip
                selected={saveViewVisibility === 'shared'}
                onPress={() => setSaveViewVisibility('shared')}
                compact
                style={{ backgroundColor: saveViewVisibility === 'shared' ? theme.colors.primaryContainer : theme.colors.surfaceVariant }}
              >
                {t('sidebar.everyone', 'לכולם')}
              </Chip>
            </View>
          )}
          <View style={{ flexDirection: isRTL ? 'row-reverse' : 'row', justifyContent: 'flex-end', gap: 8 }}>
            <Button mode="outlined" onPress={() => { setShowSaveViewModal(false); setNewViewName(''); }}>
              {t('common.cancel')}
            </Button>
            <Button mode="contained" disabled={!newViewName.trim()} onPress={saveCurrentView}>
              {t('common.save', 'שמור')}
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
  viewsRow: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingTop: 4,
  },
  viewTab: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginBottom: -1,
  },
  viewTabText: {
    fontSize: 13,
    fontWeight: '600',
    maxWidth: 100,
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
  badgesRow: {
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 2,
    marginBottom: 1,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
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
