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
  AppState,
  TextInput,
  InteractionManager,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Swipeable } from 'react-native-gesture-handler';
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
  IconButton,
  TextInput as PaperInput,
  HelperText,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useChatStore } from '../../../stores/chatStore';
import { useAuthStore } from '../../../stores/authStore';
import { useAppTheme } from '../../../hooks/useAppTheme';
import { useRTL } from '../../../hooks/useRTL';
import { formatChatTime, getInitials, withAlpha } from '../../../utils/formatters';
import {
  getChatConversationStatus,
  isChatClosed,
  isChatOpen,
  conversationStatusLabel,
  conversationStatusColors,
  normalizeConversationStatus,
} from '../../../utils/conversationStatus';
import WebSocketService from '../../../services/websocket';
import { notificationSound } from '../../../services/notificationSound';
import { getDataVisibility, hasPermission, getLandingRoute } from '../../../constants/permissions';
import { ENDPOINTS } from '../../../constants/api';
import axiosInstance from '../../../services/api/axiosInstance';
import { usersApi } from '../../../services/api/users';
import { contactsApi } from '../../../services/api/contacts';
import { chatsApi } from '../../../services/api/chats';
import { cleanPhoneNumber, DEFAULT_COUNTRY } from '../../../utils/phoneNumber';
import type { Chat, WabaNumberInfo } from '../../../types';

// A typed query is treated as a phone number (rather than a name search) when it
// contains only digits and phone punctuation (spaces, dashes, parens, an optional
// leading "+") — and has at least 6 digits. Anything with letters is a name search.
function looksLikePhoneQuery(raw: string): boolean {
  const s = (raw || '').trim();
  if (!s) return false;
  if (!/^\+?[\d\s\-()]+$/.test(s)) return false;
  return s.replace(/\D/g, '').length >= 6;
}

// A normalized WhatsApp number is digits only, full international (no "+"),
// e.g. "972505278310". E.164 allows up to 15 digits.
function isValidNormalizedPhone(digits: string): boolean {
  return /^\d{10,15}$/.test(digits);
}

// Milliseconds of a chat's last activity. NaN-safe (an empty/invalid timestamp becomes 0 rather
// than NaN, which would make every comparison false and scramble the order).
function chatActivityMs(c: Chat): number {
  const t = new Date((c && c.lastMessageTime) || 0).getTime();
  return Number.isFinite(t) ? t : 0;
}

const BULK_STATUS_OPTIONS = ['Open', 'In Process', 'Closed'] as const;

// Order matters — chips render left-to-right (RTL-aware) in this order, and the Category dropdown
// follows immediately after. 'notReviewedByHuman' is placed LAST so it sits right next to Category
// (more accessible); 'internal' takes its former slot.
const FILTER_OPTIONS = ['all', 'unread', 'internal', 'open', 'closed', 'myChats', 'notReviewedByHuman'] as const;

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

  // Defense-in-depth: if the user has no chats permission, never show this screen
  // (handles deep links / push taps that bypass the hidden tab).
  const canViewChats = hasPermission(user?.Permissions, user?.SecurityRole, 'chats');
  useEffect(() => {
    if (user && !canViewChats) {
      router.replace(getLandingRoute(user.Permissions, user.SecurityRole) as any);
    }
  }, [user, canViewChats]);

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
  const refreshRecentChats = useChatStore((s) => s.refreshRecentChats);
  const setChats = useChatStore((s) => s.setChats);
  const addOrUpdateChat = useChatStore((s) => s.addOrUpdateChat);
  const markAsUnread = useChatStore((s) => s.markAsUnread);

  // Multi-select / bulk actions (mirrors the web sidebar bulk toolbar).
  const swipeableRefs = useRef(new Map<string, Swipeable>()).current;
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedPhones, setSelectedPhones] = useState<string[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [showBulkOwnerModal, setShowBulkOwnerModal] = useState(false);
  const [showBulkStatusModal, setShowBulkStatusModal] = useState(false);
  const [bulkOwners, setBulkOwners] = useState<any[]>([]);
  const [loadingBulkOwners, setLoadingBulkOwners] = useState(false);

  const chatsDV = getDataVisibility(user?.DataVisibility, user?.SecurityRole, 'chats');
  const currentUserId = user?.uID || user?.userId || '';
  const userIsAdmin = user?.SecurityRole === 'Admin';

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

  // New-chat number handling: keep the input dual-purpose (search a contact by name
  // OR type a number). When the text looks like a phone number, normalize it to the
  // WhatsApp format (e.g. 972505278310) and validate before allowing "Start chat".
  const newChatIsPhoneMode = useMemo(() => looksLikePhoneQuery(newChatPhone), [newChatPhone]);
  const newChatNormalizedPhone = useMemo(
    () => (newChatIsPhoneMode ? cleanPhoneNumber(newChatPhone, DEFAULT_COUNTRY.dial) : ''),
    [newChatIsPhoneMode, newChatPhone]
  );
  const newChatPhoneValid = useMemo(
    () => newChatIsPhoneMode && isValidNormalizedPhone(newChatNormalizedPhone),
    [newChatIsPhoneMode, newChatNormalizedPhone]
  );

  const [refreshing, setRefreshing] = useState(false);
  const [searchVisible, setSearchVisible] = useState(false);
  const searchAnim = useRef(new Animated.Value(0)).current;
  const wsRef = useRef<WebSocketService | null>(null);
  const listRef = useRef<FlashList<any> | null>(null);

  // The chat list is sorted newest-first, so "the top" is always the freshest conversations.
  // Snap back to the top whenever the screen regains focus or the app returns from background,
  // so the user never has to scroll up to find new chats after leaving and coming back.
  const scrollChatsToTop = useCallback((animated = false) => {
    try { listRef.current?.scrollToOffset({ offset: 0, animated }); } catch { /* list not ready */ }
  }, []);

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

  // WhatsApp number filter
  const [wabaNumbersList, setWabaNumbersList] = useState<WabaNumberInfo[]>([]);
  const [numberFilter, setNumberFilter] = useState<string>('');
  const [numberMenuVisible, setNumberMenuVisible] = useState(false);
  const [numberSearchQuery, setNumberSearchQuery] = useState('');

  // Case stage filter
  const [caseStages, setCaseStages] = useState<{ id: string; name: string; color?: string }[]>([]);
  const [caseStageFilter, setCaseStageFilter] = useState<string[]>([]);
  const [caseStageMenuVisible, setCaseStageMenuVisible] = useState(false);
  const [contactCaseMap, setContactCaseMap] = useState<Record<string, { stageName: string; stageColor: string; stageId: string }[]>>({});

  // Lead/case stage map for chat list badges
  const [contactLeadMap, setContactLeadMap] = useState<Record<string, { stageName: string; stageColor: string; stageId: string }>>({});

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

  // Load contact groups and lead stages.
  // Building the contact→lead-stage map pulls EVERY lead in the org and is only used for the small
  // stage badges on chat rows, so we defer it past the first interaction. This lets the chat list
  // paint and scroll immediately instead of blocking the JS thread on a large leads payload.
  useEffect(() => {
    if (!user?.organization) return;
    const task = InteractionManager.runAfterInteractions(() => {
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
        axiosInstance.post('/api/Webhooks/GetAllLeads', {
          organization: user.organization,
          userId: user.uID || user.userId,
          dataVisibility: 'all',
        })
          .then((leadsRes) => {
            const leads = leadsRes.data?.Data || leadsRes.data?.data || leadsRes.data || [];
            if (!Array.isArray(leads)) return;
            const stageMap: Record<string, any> = {};
            stageArr.forEach((s: any) => { stageMap[s.id || s.Id] = s; });
            const map: Record<string, { stageName: string; stageColor: string; stageId: string }> = {};
            leads.forEach((lead: any) => {
              const phone = (lead.contactPhone || lead.phoneNumber || '').replace(/\D/g, '');
              if (phone && lead.stageId) {
                const stageInfo = stageMap[lead.stageId];
                const name = stageInfo?.name || stageInfo?.Name || lead.stageName;
                if (!name) return;
                map[phone] = { stageName: name, stageColor: stageInfo?.color || '#7c3aed', stageId: lead.stageId };
              }
            });
            setContactLeadMap(map);
          }).catch(() => {});
      }).catch(() => {});
    });
    return () => task.cancel();
  }, [user?.organization]);

  // Load case stages and contact→case map.
  // Deferred like the lead-stage map above: it fetches up to 500 cases just to render the small case
  // badges, so it shouldn't compete with the first paint / scroll of the chat list.
  useEffect(() => {
    if (!user?.organization) return;
    const task = InteractionManager.runAfterInteractions(() => {
    axiosInstance.post(ENDPOINTS.GET_CASE_SETTINGS, { organization: user.organization })
      .then((res) => {
        const raw = res.data;
        const stages = raw?.stages || raw?.Data?.stages || raw?.pipelines?.[0]?.stages || [];
        const stageArr = Array.isArray(stages) ? stages : [];
        if (stageArr.length === 0) return;
        setCaseStages(stageArr.map((s: any) => ({ id: s.id || s.Id, name: s.name || s.Name || s.stageName, color: s.color })));

        const stageMap: Record<string, any> = {};
        stageArr.forEach((s: any) => { stageMap[s.id || s.Id] = s; });

        axiosInstance.post(ENDPOINTS.GET_CASES, { organization: user.organization, pageNumber: 1, pageSize: 500 })
          .then((casesRes) => {
            const cases = casesRes.data?.Data || casesRes.data?.data || casesRes.data || [];
            if (!Array.isArray(cases)) return;
            const map: Record<string, { stageName: string; stageColor: string; stageId: string }[]> = {};
            cases.forEach((c: any) => {
              const phone = (c.contactPhone || c.phoneNumber || '').replace(/\D/g, '');
              if (phone && c.stageId) {
                const stageInfo = stageMap[c.stageId];
                const name = stageInfo?.name || stageInfo?.Name || c.stageName;
                if (!name) return;
                if (!map[phone]) map[phone] = [];
                if (!map[phone].some(e => e.stageId === c.stageId)) {
                  map[phone].push({ stageName: name, stageColor: stageInfo?.color || '#0891b2', stageId: c.stageId });
                }
              }
            });
            setContactCaseMap(map);
          }).catch(() => {});
      }).catch(() => {});
    });
    return () => task.cancel();
  }, [user?.organization]);

  // Fetch WhatsApp numbers for the organization
  useEffect(() => {
    if (!user?.organization) return;
    axiosInstance.get(ENDPOINTS.GET_WHATSAPP_NUMBERS, { params: { organization: user.organization } })
      .then((res) => {
        const nums: WabaNumberInfo[] = res.data?.Numbers || res.data?.numbers || [];
        if (Array.isArray(nums) && nums.length > 0) {
          setWabaNumbersList(nums);
        }
      }).catch(() => {});
  }, [user?.organization]);

  // Determine which numbers are available to this user
  const availableNumbers = useMemo(() => {
    const assigned = user?.assignedWhatsAppNumbers || [];
    if (assigned.length > 0) {
      return wabaNumbersList.filter((n) => {
        const id = n.PhoneNumberId || n.phoneNumberId || '';
        return assigned.includes(id);
      });
    }
    return wabaNumbersList;
  }, [wabaNumbersList, user?.assignedWhatsAppNumbers]);

  const loadSavedView = useCallback((view: SavedView) => {
    const viewData = view.ViewData || {};
    const filters = viewData.filters || {};
    setActiveViewId(view.id);
    setFilter(filters.myConversations ? 'myChats' : filters.unread ? 'unread' : filters.openConversations ? 'open' : 'all');
    setCategoryFilter(filters.category || 'all');
    setOwnerFilter(filters.owner || 'all');
    setGroupFilter(filters.contactGroup || []);
    setLeadStageFilter(filters.leadStage || []);
    setCaseStageFilter(filters.caseStage || []);
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
    setCaseStageFilter([]);
    setNumberFilter('');
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
          caseStage: caseStageFilter,
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
        currentUserId,
        chatsDV || 'all',
      );
    }
  }, [user?.organization, chatsDV, currentUserId]);

  // Polling fallback: catch messages missed by WebSocket. This used to re-read the ENTIRE
  // contacts collection (pageSize 9999) every 60s regardless of whether the app was even in the
  // foreground — the single biggest Firestore read amplifier in the product. Now we (1) only poll
  // while the app is actually active, (2) poll less often, and (3) do a cheap incremental refresh
  // of just the most-recent conversations instead of the whole collection.
  useEffect(() => {
    if (!user?.organization) return;
    const interval = setInterval(() => {
      if (AppState.currentState !== 'active') return;
      refreshRecentChats(user.organization, currentUserId, chatsDV || 'all');
    }, 120000);
    return () => clearInterval(interval);
  }, [user?.organization, refreshRecentChats, chatsDV, currentUserId]);

  // Refresh chat list when app returns from background. A lightweight incremental refresh is enough
  // here (the full list is already cached from the initial load) and avoids a full-collection read
  // on every single foreground event.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState === 'active' && user?.organization) {
        WebSocketService.reconnectAll();
        refreshRecentChats(user.organization, currentUserId, chatsDV || 'all');
        // Returning to the app should land the user on the newest chats, not the stale offset
        // they left the list at.
        InteractionManager.runAfterInteractions(() => scrollChatsToTop(false));
      }
    });
    return () => subscription.remove();
  }, [user?.organization, refreshRecentChats, chatsDV, currentUserId, scrollChatsToTop]);

  // Also snap to the top whenever the chats tab regains focus (e.g. switching back from another tab).
  useFocusEffect(
    useCallback(() => {
      InteractionManager.runAfterInteractions(() => scrollChatsToTop(false));
    }, [scrollChatsToTop])
  );

  useEffect(() => {
    if (!user?.organization) return;

    const ws = WebSocketService.getInstance(user.organization, null, 'message');

    ws.on('any', ({ data }) => {
      if (!data) return;
      if (data.type === 'new_message' || data.type === 'message') {
        const msg = data.message || data;
        // Skip reactions - don't update chat list with reaction text
        if (msg.type === 'reaction') return;
        if (msg.phoneNumber || msg.from) {
          const dir = (msg.direction || '').toLowerCase();
          const isOutbound = dir === 'outbound' || !!msg.sentFromApp;
          const base: any = {
            id: msg.phoneNumber || msg.from,
            phoneNumber: msg.phoneNumber || msg.from,
            contactName:
              msg.contactName ||
              msg.senderName ||
              msg.phoneNumber ||
              msg.from,
            lastMessage: msg.body || msg.message || msg.text || '',
            lastMessageTime: msg.timestamp || new Date().toISOString(),
            isOnline: msg.isOnline,
            profilePicture: msg.profilePicture,
          };
          // Only inbound messages bump the unread badge. For outbound (sent from app/web by
          // any agent) we omit unreadCount so addOrUpdateChat preserves the existing value
          // instead of falsely marking the row unread (mirrors web).
          if (!isOutbound) {
            base.unreadCount = (msg.unreadCount ?? 0) + 1;
            base.isRead = false;
          }
          addOrUpdateChat(base);
          if (dir === 'inbound' || (!msg.sentFromApp && msg.from !== user?.wabaNumber)) {
            notificationSound.playMessageSound();
          }
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

  const CHATS_PAGE_SIZE = 50;
  const [displayLimit, setDisplayLimit] = useState(CHATS_PAGE_SIZE);

  const filteredChats = useMemo(() => {
    let result = chats;

    // Auto-filter by assignedWhatsAppNumbers when DataVisibility is 'byPhone' or user has assigned numbers
    const assignedNums = user?.assignedWhatsAppNumbers || [];
    if (assignedNums.length > 0 && !numberFilter) {
      result = result.filter((c) => {
        const fromId = (c as any).lastFromNumberId || (c as any).wabaPhoneNumberId || '';
        const ids = (c as any).wabaPhoneNumberIds;
        if (Array.isArray(ids) && ids.length > 0) return ids.some((id: string) => assignedNums.includes(id));
        if (fromId) return assignedNums.includes(fromId);
        return true;
      });
    }

    if (filter === 'unread') {
      result = result.filter((c) => c.unreadCount > 0 || c.isRead === false);
    } else if (filter === 'notReviewedByHuman') {
      // Mirrors web: only conversations explicitly flagged humanReviewed === false
      // (undefined/true means a human has already reviewed it).
      result = result.filter((c) => c.humanReviewed === false);
    } else if (filter === 'open') {
      result = result.filter((c) => isChatOpen(c));
    } else if (filter === 'closed') {
      result = result.filter((c) => isChatClosed(c));
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
        const stageId = (c as any).leadStageId || (c as any).leadStage || leadInfo?.stageId || '';
        return stageId ? leadStageFilter.includes(stageId) : false;
      });
    }

    if (caseStageFilter.length > 0) {
      result = result.filter((c) => {
        const phoneNorm = (c.phoneNumber || '').replace(/\D/g, '');
        const caseInfoArr = contactCaseMap[phoneNorm];
        if (!caseInfoArr || caseInfoArr.length === 0) return false;
        return caseInfoArr.some(ci => caseStageFilter.includes(ci.stageId));
      });
    }

    if (numberFilter) {
      result = result.filter((c) => {
        const fromId = (c as any).lastFromNumberId || (c as any).wabaPhoneNumberId || '';
        return fromId === numberFilter;
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

    // Always present newest-first, regardless of the store's internal ordering. The store keeps
    // its array sorted via a binary-search insert, but a single out-of-order update (e.g. a live
    // message using a "now" fallback timestamp, or an entry loaded with a differently-formatted
    // time) would otherwise linger visibly out of place until a full reload — this was the
    // "list re-sorts wrong after entering a chat and coming back" report. Sorting the (already
    // filtered) copy here makes the displayed order correct no matter what.
    return [...result].sort((a, b) => chatActivityMs(b) - chatActivityMs(a));
  }, [chats, filter, debouncedSearch, categoryFilter, ownerFilter, groupFilter, leadStageFilter, caseStageFilter, numberFilter, user, contactLeadMap, contactCaseMap, leadStages]);

  // When searching, show all results; otherwise paginate for smooth scrolling
  const displayedChats = useMemo(() => {
    if (debouncedSearch.trim()) return filteredChats;
    return filteredChats.slice(0, displayLimit);
  }, [filteredChats, displayLimit, debouncedSearch]);

  const hasMoreChats = !debouncedSearch.trim() && displayLimit < filteredChats.length;

  const onEndReachedChats = useCallback(() => {
    if (!hasMoreChats) return;
    setDisplayLimit((prev) => prev + CHATS_PAGE_SIZE);
  }, [hasMoreChats]);

  // Reset display limit when filters change
  useEffect(() => {
    setDisplayLimit(CHATS_PAGE_SIZE);
  }, [filter, categoryFilter, ownerFilter, groupFilter, leadStageFilter, numberFilter]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    if (user?.organization) {
      await loadChats(
        user.organization,
        currentUserId,
        chatsDV || 'all',
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

  // ---- Multi-select helpers ----
  const enterSelection = useCallback((phone: string) => {
    setSelectionMode(true);
    setSelectedPhones((prev) => (prev.includes(phone) ? prev : [...prev, phone]));
  }, []);

  const toggleSelect = useCallback((phone: string) => {
    setSelectedPhones((prev) =>
      prev.includes(phone) ? prev.filter((p) => p !== phone) : [...prev, phone],
    );
  }, []);

  const exitSelection = useCallback(() => {
    setSelectionMode(false);
    setSelectedPhones([]);
  }, []);

  // ---- Single-row mark as unread (swipe action) ----
  const handleSingleMarkUnread = useCallback(
    (chat: Chat) => {
      swipeableRefs.get(chat.phoneNumber)?.close();
      if (user?.organization) markAsUnread(user.organization, chat.phoneNumber);
    },
    [user?.organization, markAsUnread, swipeableRefs],
  );

  // ---- Bulk: mark unread ----
  const handleBulkMarkUnread = useCallback(async () => {
    if (!user?.organization || selectedPhones.length === 0) return;
    setBulkBusy(true);
    try {
      for (const phone of selectedPhones) {
        await markAsUnread(user.organization, phone);
      }
    } finally {
      setBulkBusy(false);
      exitSelection();
    }
  }, [user?.organization, selectedPhones, markAsUnread, exitSelection]);

  // ---- Bulk: assign owner ----
  const openBulkOwner = useCallback(async () => {
    setShowBulkOwnerModal(true);
    if (!user?.organization) return;
    setLoadingBulkOwners(true);
    try {
      const users = await usersApi.getAll(user.organization);
      setBulkOwners(Array.isArray(users) ? users : []);
    } catch {
      setBulkOwners([]);
    } finally {
      setLoadingBulkOwners(false);
    }
  }, [user?.organization]);

  const handleBulkAssignOwner = useCallback(
    async (ownerId: string, ownerName: string) => {
      if (!user?.organization || selectedPhones.length === 0) return;
      setBulkBusy(true);
      try {
        for (const phone of selectedPhones) {
          await contactsApi.updateOwner(
            user.organization,
            phone,
            ownerId,
            user.fullname || 'system',
          );
          addOrUpdateChat({ phoneNumber: phone, ownerId, ownerName } as any);
        }
        Alert.alert('✅', isRTL ? `הבעלות שויכה ל-${ownerName}` : `Assigned to ${ownerName}`);
      } catch {
        Alert.alert(isRTL ? 'שגיאה' : 'Error', isRTL ? 'שיוך הבעלות נכשל' : 'Failed to assign owner');
      } finally {
        setBulkBusy(false);
        setShowBulkOwnerModal(false);
        exitSelection();
      }
    },
    [user?.organization, selectedPhones, addOrUpdateChat, isRTL, exitSelection],
  );

  // ---- Bulk: update conversation status ----
  const handleBulkStatus = useCallback(
    async (status: string) => {
      if (!user?.organization || selectedPhones.length === 0) return;
      setBulkBusy(true);
      try {
        for (const phone of selectedPhones) {
          await chatsApi.updateConversationStatus(
            user.organization,
            phone,
            status,
            user.uID || user.userId,
          );
          addOrUpdateChat({ phoneNumber: phone, status, lastConversationStatus: status } as any);
        }
      } finally {
        setBulkBusy(false);
        setShowBulkStatusModal(false);
        exitSelection();
      }
    },
    [user?.organization, selectedPhones, addOrUpdateChat, exitSelection],
  );

  const allSelected = displayedChats.length > 0 && selectedPhones.length === displayedChats.length;
  const toggleSelectAll = useCallback(() => {
    setSelectedPhones((prev) =>
      prev.length === displayedChats.length ? [] : displayedChats.map((c) => c.phoneNumber),
    );
  }, [displayedChats]);

  const renderChatItem = useCallback(
    ({ item }: { item: Chat }) => {
      const hasUnread = item.unreadCount > 0;
      // Unread INTERNAL message (@-mention) directed at me — shown as a distinct purple badge,
      // separate from the regular red WhatsApp unread badge/bold.
      const hasUnreadInternal = !!currentUserId && (item.usersWithUnreadInternalMessages || []).includes(currentUserId);
      const phoneNorm = (item.phoneNumber || '').replace(/\D/g, '');
      const leadInfo = contactLeadMap[phoneNorm];
      const displayLeadStage = item.leadStageName || leadInfo?.stageName || '';
      const displayLeadColor = item.leadStageColor || leadInfo?.stageColor || '#7c3aed';
      const caseInfoArr = contactCaseMap[phoneNorm] || [];
      const displayCaseStages = caseInfoArr.length > 0
        ? caseInfoArr.slice(0, 2)
        : (item.caseStageName ? [{ stageName: item.caseStageName, stageColor: item.caseStageColor || '#0891b2', stageId: '' }] : []);

      const chatNumberId = (item as any).lastFromNumberId || (item as any).wabaPhoneNumberId || '';
      const chatNumberIds = new Set<string>();
      if (chatNumberId) chatNumberIds.add(chatNumberId);
      if ((item as any).wabaPhoneNumberId && (item as any).wabaPhoneNumberId !== chatNumberId) chatNumberIds.add((item as any).wabaPhoneNumberId);
      const chatNumberBadges = [...chatNumberIds]
        .map(id => availableNumbers.find((n) => (n.PhoneNumberId || n.phoneNumberId) === id))
        .filter(Boolean)
        .slice(0, 2);
      const extraNumberCount = chatNumberIds.size > 2 ? chatNumberIds.size - 2 : 0;
      const isSelected = selectedPhones.includes(item.phoneNumber);

      const row = (
        <Pressable
          onPress={() => (selectionMode ? toggleSelect(item.phoneNumber) : openChat(item))}
          onLongPress={() => enterSelection(item.phoneNumber)}
          delayLongPress={250}
          android_ripple={{ color: theme.colors.surfaceVariant }}
          style={({ pressed }) => [
            styles.chatItem,
            {
              backgroundColor: isSelected
                ? withAlpha(theme.colors.primary, 0.14)
                : pressed
                ? theme.colors.surfaceVariant
                : theme.colors.surface,
              flexDirection,
            },
          ]}
        >
          {selectionMode && (
            <View style={styles.selectCheck}>
              <MaterialCommunityIcons
                name={isSelected ? 'check-circle' : 'checkbox-blank-circle-outline'}
                size={24}
                color={isSelected ? theme.colors.primary : theme.colors.onSurfaceVariant}
              />
            </View>
          )}
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
              <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, gap: 6 }}>
                <Text
                  variant="titleMedium"
                  numberOfLines={1}
                  style={[
                    styles.contactName,
                    hasUnread && styles.contactNameUnread,
                    { color: theme.colors.onSurface, textAlign, flexShrink: 1 },
                  ]}
                >
                  {item.contactName || item.phoneNumber}
                </Text>
                {hasUnreadInternal && (
                  <View style={styles.internalMentionBadge}>
                    <Text style={styles.internalMentionBadgeText}>💬 @</Text>
                  </View>
                )}
                {availableNumbers.length > 1 && chatNumberBadges.length > 0 ? (
                  <View style={{ flexDirection: 'row', gap: 3, alignItems: 'center' }}>
                    {chatNumberBadges.map((num) => {
                      const label = num!.Label || num!.label || num!.DisplayNumber || num!.displayNumber || '';
                      const color = num!.Color || num!.color || '#2e6155';
                      return (
                        <View key={num!.PhoneNumberId || num!.phoneNumberId} style={[styles.numberBadge, { backgroundColor: withAlpha(color, 0.12) }]}>
                          <Text style={{ fontSize: 9, fontWeight: '700', color }} numberOfLines={1}>
                            {label}
                          </Text>
                        </View>
                      );
                    })}
                    {extraNumberCount > 0 && (
                      <Text style={{ fontSize: 9, color: theme.colors.onSurfaceVariant }}>+{extraNumberCount}</Text>
                    )}
                  </View>
                ) : null}
              </View>
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
            {(getChatConversationStatus(item) !== 'unknown' || displayLeadStage || displayCaseStages.length > 0 || item.isCTWA) && (
              <View style={[styles.badgesRow, { flexDirection }]}>
                {(() => {
                  const convStatus = getChatConversationStatus(item);
                  if (convStatus === 'unknown') return null;
                  const colors = conversationStatusColors(convStatus);
                  return (
                  <View style={[styles.badge, { backgroundColor: colors.bg }]}>
                    <Text style={[styles.badgeText, { color: colors.fg }]}>
                      {/* CRM conversation status label */}
                      {conversationStatusLabel(convStatus, t)}
                    </Text>
                  </View>
                  );
                })()}
                {!!displayLeadStage && (
                  <View style={[styles.badge, { backgroundColor: withAlpha(displayLeadColor, 0.12) }]}>
                    <Text style={[styles.badgeText, { color: displayLeadColor }]}>
                      {displayLeadStage}
                    </Text>
                  </View>
                )}
                {displayCaseStages.map((cs, idx) => (
                  <View key={`case-${idx}`} style={[styles.badge, { backgroundColor: withAlpha(cs.stageColor || '#0891b2', 0.12) }]}>
                    <Text style={[styles.badgeText, { color: cs.stageColor || '#0891b2' }]}>
                      {cs.stageName}
                    </Text>
                  </View>
                ))}
                {caseInfoArr.length > 2 && (
                  <Text style={{ fontSize: 9, color: theme.colors.onSurfaceVariant }}>+{caseInfoArr.length - 2}</Text>
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
                {(() => {
                  const msg = (item.lastMessage || '').trim();
                  if (!msg) return '';
                  const lm = msg.toLowerCase();
                  if (/^reacted with\s/i.test(lm)) return '👍 ' + t('chats.reaction', 'הגיב/ה');
                  if (/^(תמונה|image|photo)$/i.test(lm)) return '📷 ' + t('chats.photo', 'תמונה');
                  if (/^(סרטון|וידאו|video)$/i.test(lm)) return '🎬 ' + t('chats.videoMsg', 'סרטון');
                  if (/^(אודיו|audio|voice|הקלטה)$/i.test(lm)) return '🎤 ' + t('chats.audioMsg', 'הודעה קולית');
                  if (/^(מסמך|קובץ|document|file)$/i.test(lm)) return '📄 ' + t('chats.documentMsg', 'מסמך');
                  if (/^(sticker|מדבקה)$/i.test(lm)) return '🏷️ ' + t('chats.sticker', 'מדבקה');
                  if (/^(מיקום|location)$/i.test(lm)) return '📍 ' + t('chats.location', 'מיקום');
                  if (/^(איש קשר|contact)$/i.test(lm)) return '👤 ' + t('chats.contact', 'איש קשר');
                  return msg;
                })()}
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

      // In selection mode, disable swipe so taps toggle selection cleanly.
      if (selectionMode) return row;

      return (
        <Swipeable
          ref={(ref) => {
            if (ref) swipeableRefs.set(item.phoneNumber, ref);
            else swipeableRefs.delete(item.phoneNumber);
          }}
          renderRightActions={() => (
            <Pressable
              onPress={() => handleSingleMarkUnread(item)}
              style={[styles.swipeUnreadBtn, { backgroundColor: theme.colors.primary }]}
            >
              <MaterialCommunityIcons name="email-mark-as-unread" size={22} color="#FFF" />
              <Text style={styles.swipeUnreadLabel}>{t('chats.markUnread', 'לא נקרא')}</Text>
            </Pressable>
          )}
          overshootRight={false}
          friction={2}
        >
          {row}
        </Swipeable>
      );
    },
    [theme, openChat, flexDirection, textAlign, isRTL, lang, contactLeadMap, contactCaseMap, availableNumbers, t, selectionMode, selectedPhones, toggleSelect, enterSelection, handleSingleMarkUnread, swipeableRefs, currentUserId],
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

          {caseStages.length > 0 && (
            <Menu
              visible={caseStageMenuVisible}
              onDismiss={() => setCaseStageMenuVisible(false)}
              anchor={
                <Chip
                  icon="folder-outline"
                  onPress={() => setCaseStageMenuVisible(true)}
                  compact
                  style={[
                    styles.filterChip,
                    caseStageFilter.length > 0
                      ? { backgroundColor: theme.colors.primaryContainer }
                      : { backgroundColor: theme.colors.surfaceVariant },
                  ]}
                  textStyle={[
                    styles.filterChipText,
                    caseStageFilter.length > 0 && { color: theme.colors.primary, fontWeight: '600' },
                  ]}
                >
                  {caseStageFilter.length > 0 ? `${t('chats.caseStage', 'שלב פנייה')} (${caseStageFilter.length})` : t('chats.caseStage', 'שלב פנייה')}
                </Chip>
              }
            >
              <Menu.Item
                title={t('common.all')}
                onPress={() => { setCaseStageFilter([]); setCaseStageMenuVisible(false); }}
                leadingIcon={caseStageFilter.length === 0 ? 'check' : undefined}
              />
              {caseStages.map((s) => (
                <Menu.Item
                  key={s.id}
                  title={s.name}
                  onPress={() => {
                    setCaseStageFilter((prev) => prev.includes(s.id) ? prev.filter((x) => x !== s.id) : [...prev, s.id]);
                  }}
                  leadingIcon={caseStageFilter.includes(s.id) ? 'check' : undefined}
                />
              ))}
            </Menu>
          )}

          {availableNumbers.length > 1 && (
            <Menu
              visible={numberMenuVisible}
              onDismiss={() => { setNumberMenuVisible(false); setNumberSearchQuery(''); }}
              anchor={
                <Chip
                  icon="phone-outline"
                  onPress={() => setNumberMenuVisible(true)}
                  compact
                  style={[
                    styles.filterChip,
                    numberFilter
                      ? { backgroundColor: theme.colors.primaryContainer }
                      : { backgroundColor: theme.colors.surfaceVariant },
                  ]}
                  textStyle={[
                    styles.filterChipText,
                    numberFilter ? { color: theme.colors.primary, fontWeight: '600' } : undefined,
                  ]}
                >
                  {numberFilter
                    ? (() => {
                        const matched = availableNumbers.find((n) => (n.PhoneNumberId || n.phoneNumberId) === numberFilter);
                        return matched?.Label || matched?.label || matched?.DisplayNumber || matched?.displayNumber || numberFilter.slice(-4);
                      })()
                    : t('chats.phoneNumber', 'מספר')}
                </Chip>
              }
              contentStyle={{ maxHeight: 300 }}
            >
              {availableNumbers.length > 3 && (
                <View style={{ paddingHorizontal: 12, paddingBottom: 6 }}>
                  <TextInput
                    placeholder={t('common.search', 'חיפוש...')}
                    value={numberSearchQuery}
                    onChangeText={setNumberSearchQuery}
                    style={{ fontSize: 13, padding: 6, borderBottomWidth: 1, borderColor: theme.colors.outline }}
                  />
                </View>
              )}
              <ScrollView style={{ maxHeight: 240 }}>
                <Menu.Item
                  title={t('common.all', 'הכל')}
                  onPress={() => { setNumberFilter(''); setNumberMenuVisible(false); setNumberSearchQuery(''); }}
                  leadingIcon={!numberFilter ? 'check' : undefined}
                />
                {availableNumbers
                  .filter((num) => {
                    if (!numberSearchQuery.trim()) return true;
                    const q = numberSearchQuery.toLowerCase();
                    const display = (num.Label || num.label || num.DisplayNumber || num.displayNumber || '').toLowerCase();
                    const id = (num.PhoneNumberId || num.phoneNumberId || '').toLowerCase();
                    return display.includes(q) || id.includes(q);
                  })
                  .map((num) => {
                    const id = num.PhoneNumberId || num.phoneNumberId || '';
                    const display = num.Label || num.label || num.DisplayNumber || num.displayNumber || id;
                    return (
                      <Menu.Item
                        key={id}
                        title={display}
                        onPress={() => { setNumberFilter(id); setNumberMenuVisible(false); setNumberSearchQuery(''); }}
                        leadingIcon={numberFilter === id ? 'check' : undefined}
                      />
                    );
                  })}
              </ScrollView>
            </Menu>
          )}
        </ScrollView>
      </View>

      {/* Selection header (multi-select mode) */}
      {selectionMode && (
        <View style={[styles.selectionBar, { backgroundColor: theme.colors.primary, flexDirection }]}>
          <IconButton icon="close" size={22} iconColor="#FFF" onPress={exitSelection} style={{ margin: 0 }} />
          <Text style={styles.selectionCount}>
            {selectedPhones.length} {t('sidebar.selected', 'נבחרו')}
          </Text>
          <View style={{ flex: 1 }} />
          <Pressable onPress={toggleSelectAll} style={styles.selectAllBtn}>
            <MaterialCommunityIcons
              name={allSelected ? 'checkbox-multiple-marked' : 'checkbox-multiple-blank-outline'}
              size={20}
              color="#FFF"
            />
            <Text style={styles.selectAllLabel}>{t('sidebar.selectAll', 'בחר הכל')}</Text>
          </Pressable>
        </View>
      )}

      {/* Chat list */}
      <FlashList
        ref={listRef}
        data={displayedChats}
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
        ListFooterComponent={
          hasMoreChats ? (
            <ActivityIndicator size="small" color={theme.colors.primary} style={{ marginVertical: 12 }} />
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
        onEndReached={onEndReachedChats}
        onEndReachedThreshold={0.4}
        contentContainerStyle={styles.listContent}
      />

      {!selectionMode && (
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
      )}

      {/* Bulk action bar (multi-select mode) */}
      {selectionMode && selectedPhones.length > 0 && (
        <View
          style={[
            styles.bulkBar,
            { backgroundColor: theme.colors.surface, paddingBottom: insets.bottom + 8, borderTopColor: theme.colors.outlineVariant },
          ]}
        >
          <Pressable style={styles.bulkBtn} onPress={handleBulkMarkUnread} disabled={bulkBusy}>
            <MaterialCommunityIcons name="email-mark-as-unread" size={22} color={theme.colors.primary} />
            <Text style={[styles.bulkBtnLabel, { color: theme.colors.onSurface }]}>{t('chats.markUnread', 'לא נקרא')}</Text>
          </Pressable>
          <Pressable style={styles.bulkBtn} onPress={openBulkOwner} disabled={bulkBusy}>
            <MaterialCommunityIcons name="account-switch-outline" size={22} color={theme.colors.primary} />
            <Text style={[styles.bulkBtnLabel, { color: theme.colors.onSurface }]}>{t('sidebar.assignOwner', 'שיוך נציג')}</Text>
          </Pressable>
          <Pressable style={styles.bulkBtn} onPress={() => setShowBulkStatusModal(true)} disabled={bulkBusy}>
            <MaterialCommunityIcons name="swap-horizontal" size={22} color={theme.colors.primary} />
            <Text style={[styles.bulkBtnLabel, { color: theme.colors.onSurface }]}>{t('chats.status', 'סטטוס')}</Text>
          </Pressable>
          {bulkBusy && <ActivityIndicator size="small" color={theme.colors.primary} style={{ marginStart: 8 }} />}
        </View>
      )}

      <Portal>
        <Modal
          visible={newChatVisible}
          onDismiss={() => { setNewChatVisible(false); setNewChatPhone(''); }}
          contentContainerStyle={[styles.newChatModal, { backgroundColor: theme.colors.surface, maxHeight: '80%' }]}
        >
          <Text variant="titleMedium" style={{ color: theme.colors.onSurface, marginBottom: 12, fontWeight: '700' }}>
            {t('chats.newChat', 'שיחה חדשה')}
          </Text>
          <PaperInput
            label={t('chats.searchOrPhone', 'חפש איש קשר או הקלד מספר')}
            value={newChatPhone}
            onChangeText={setNewChatPhone}
            mode="outlined"
            left={<PaperInput.Icon icon={newChatIsPhoneMode ? 'phone' : 'magnify'} />}
            error={newChatIsPhoneMode && !newChatPhoneValid}
            style={{ marginBottom: 0 }}
          />
          {newChatIsPhoneMode ? (
            <HelperText type={newChatPhoneValid ? 'info' : 'error'} visible>
              {newChatPhoneValid
                ? t('chats.willSendTo', { number: newChatNormalizedPhone, defaultValue: `יישלח אל: ${newChatNormalizedPhone}` })
                : t('chats.invalidPhone', 'מספר לא תקין. הזן מספר מלא כולל קידומת מדינה, לדוגמה 972505278310')}
            </HelperText>
          ) : (
            <View style={{ marginBottom: 8 }} />
          )}
          {/* Contact suggestions from existing chats */}
          {newChatPhone.trim().length >= 2 && (
            <ScrollView style={{ maxHeight: 200, marginBottom: 12 }}>
              {chats
                .filter(c => {
                  const q = newChatPhone.trim().toLowerCase();
                  return (c.contactName || '').toLowerCase().includes(q) ||
                    (c.phoneNumber || '').includes(q);
                })
                .slice(0, 10)
                .map(c => (
                  <Pressable
                    key={c.phoneNumber}
                    onPress={() => {
                      setNewChatVisible(false);
                      setNewChatPhone('');
                      router.push({ pathname: `/(tabs)/chats/${c.phoneNumber}`, params: numberFilter ? { defaultWabaNumber: numberFilter } : undefined });
                    }}
                    style={{ flexDirection, alignItems: 'center', paddingVertical: 10, paddingHorizontal: 8, gap: 10, borderBottomWidth: 0.5, borderBottomColor: theme.colors.outlineVariant }}
                  >
                    <Avatar.Text size={36} label={getInitials(c.contactName)} style={{ backgroundColor: theme.colors.primaryContainer }} labelStyle={{ color: theme.colors.primary, fontSize: 14 }} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: theme.colors.onSurface, fontWeight: '600', textAlign }}>{c.contactName || c.phoneNumber}</Text>
                      <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 12, textAlign }}>{c.phoneNumber}</Text>
                    </View>
                  </Pressable>
                ))}
            </ScrollView>
          )}
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}>
            <Button mode="outlined" onPress={() => { setNewChatVisible(false); setNewChatPhone(''); }}>
              {t('common.cancel')}
            </Button>
            <Button
              mode="contained"
              disabled={!newChatPhoneValid}
              onPress={() => {
                const phone = cleanPhoneNumber(newChatPhone, DEFAULT_COUNTRY.dial);
                if (isValidNormalizedPhone(phone)) {
                  setNewChatVisible(false);
                  setNewChatPhone('');
                  router.push(`/(tabs)/chats/${phone}`);
                }
              }}
            >
              {t('chats.startChat', 'התחל שיחה')}
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
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 }}>
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
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}>
            <Button mode="outlined" onPress={() => { setShowSaveViewModal(false); setNewViewName(''); }}>
              {t('common.cancel')}
            </Button>
            <Button mode="contained" disabled={!newViewName.trim()} onPress={saveCurrentView}>
              {t('common.save', 'שמור')}
            </Button>
          </View>
        </Modal>

        {/* Bulk: Assign Owner */}
        <Modal
          visible={showBulkOwnerModal}
          onDismiss={() => setShowBulkOwnerModal(false)}
          contentContainerStyle={[styles.newChatModal, { backgroundColor: theme.colors.surface, maxHeight: '70%' }]}
        >
          <Text variant="titleMedium" style={{ color: theme.colors.onSurface, marginBottom: 12, fontWeight: '700', textAlign }}>
            {t('sidebar.assignOwner', 'שיוך נציג')} ({selectedPhones.length})
          </Text>
          {loadingBulkOwners ? (
            <ActivityIndicator style={{ marginVertical: 20 }} color={theme.colors.primary} />
          ) : (
            <ScrollView style={{ maxHeight: 360 }}>
              {bulkOwners.map((owner) => {
                const ownerId = owner.uID || owner.userId || owner.id || '';
                const ownerName = owner.UserName || owner.fullname || owner.displayName || owner.email || ownerId;
                return (
                  <Pressable
                    key={ownerId}
                    onPress={() => handleBulkAssignOwner(ownerId, ownerName)}
                    disabled={bulkBusy}
                    style={({ pressed }) => [
                      { flexDirection, alignItems: 'center', paddingVertical: 12, paddingHorizontal: 8, gap: 12, borderRadius: 8 },
                      pressed && { backgroundColor: theme.colors.surfaceVariant },
                    ]}
                  >
                    <Avatar.Text
                      size={36}
                      label={getInitials(ownerName)}
                      style={{ backgroundColor: theme.colors.primaryContainer }}
                      labelStyle={{ fontSize: 14, color: theme.colors.primary }}
                    />
                    <Text variant="bodyMedium" style={{ color: theme.colors.onSurface, fontWeight: '600', flex: 1, textAlign }}>
                      {ownerName}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}
        </Modal>

        {/* Bulk: Update Status */}
        <Modal
          visible={showBulkStatusModal}
          onDismiss={() => setShowBulkStatusModal(false)}
          contentContainerStyle={[styles.newChatModal, { backgroundColor: theme.colors.surface }]}
        >
          <Text variant="titleMedium" style={{ color: theme.colors.onSurface, marginBottom: 12, fontWeight: '700', textAlign }}>
            {t('chats.status', 'סטטוס')} ({selectedPhones.length})
          </Text>
          {BULK_STATUS_OPTIONS.map((status) => {
            const normalized = normalizeConversationStatus(status);
            const colors = conversationStatusColors(normalized);
            return (
              <Pressable
                key={status}
                onPress={() => handleBulkStatus(status)}
                disabled={bulkBusy}
                style={({ pressed }) => [
                  { flexDirection, alignItems: 'center', paddingVertical: 12, paddingHorizontal: 8, gap: 12, borderRadius: 8 },
                  pressed && { backgroundColor: theme.colors.surfaceVariant },
                ]}
              >
                <View style={[styles.badge, { backgroundColor: colors.bg }]}>
                  <Text style={[styles.badgeText, { color: colors.fg }]}>
                    {conversationStatusLabel(normalized, t)}
                  </Text>
                </View>
              </Pressable>
            );
          })}
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
    gap: 14,
  },
  selectCheck: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  swipeUnreadBtn: {
    justifyContent: 'center',
    alignItems: 'center',
    width: 88,
    gap: 4,
  },
  swipeUnreadLabel: {
    color: '#FFF',
    fontSize: 11,
    fontWeight: '700',
  },
  selectionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 6,
    gap: 4,
  },
  selectionCount: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '700',
  },
  selectAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  selectAllLabel: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '600',
  },
  bulkBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingTop: 10,
    paddingHorizontal: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    elevation: 8,
  },
  bulkBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
    paddingHorizontal: 10,
    gap: 3,
  },
  bulkBtnLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  avatarWrap: {
    position: 'relative',
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
    gap: 8,
  },
  contactName: {
    flex: 1,
    fontSize: 16,
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
  numberBadge: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
    maxWidth: 80,
  },
  chatBottomRow: {
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  lastMessage: {
    flex: 1,
    fontSize: 14,
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
  internalMentionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#7c3aed',
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  internalMentionBadgeText: {
    color: '#FFFFFF',
    fontSize: 9,
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
