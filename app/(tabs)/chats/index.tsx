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
import AsyncStorage from '@react-native-async-storage/async-storage';
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

// Built-in views mirror the web Sidebar exactly (same IDs + order): הכל / לטיפול / שלי /
// לא משויך / לא נקרא. The mobile app lets the user create, hide, reorder, or delete (own
// views only), and — for admins — persist the order org-wide ("שמור לארגון") like the web.
const BUILT_IN_VIEWS: { id: string; labelKey: string; fallback: string }[] = [
  { id: '__all__', labelKey: 'sidebar.allConversations', fallback: 'הכל' },
  { id: '__toHandle__', labelKey: 'sidebar.toHandle', fallback: 'לטיפול' },
  { id: '__mine__', labelKey: 'sidebar.myConversations', fallback: 'שלי' },
  { id: '__unassigned__', labelKey: 'sidebar.unassigned', fallback: 'לא משויך' },
  { id: '__unread__', labelKey: 'sidebar.unread', fallback: 'לא נקרא' },
];

type ViewTab = {
  id: string;
  label: string;
  kind: 'builtin' | 'saved';
  view?: SavedView;
  shared: boolean;
  deletable: boolean;
};

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
  // Bulk send message (free text OR approved template) + extra bulk actions (category, mark read).
  const [showBulkSendModal, setShowBulkSendModal] = useState(false);
  const [bulkSendMode, setBulkSendMode] = useState<'text' | 'template'>('text');
  const [bulkText, setBulkText] = useState('');
  const [bulkTemplates, setBulkTemplates] = useState<any[]>([]);
  const [bulkTemplateId, setBulkTemplateId] = useState('');
  const [loadingBulkTemplates, setLoadingBulkTemplates] = useState(false);
  const [bulkSendProgress, setBulkSendProgress] = useState<{ done: number; total: number } | null>(null);
  const [showBulkCategoryModal, setShowBulkCategoryModal] = useState(false);
  const [bulkCategories, setBulkCategories] = useState<string[]>([]);
  const [showBulkMoreMenu, setShowBulkMoreMenu] = useState(false);

  // Per-row quick actions (swipe → "…") — mirrors the web sidebar right-click menu.
  const [rowActionChat, setRowActionChat] = useState<Chat | null>(null);
  const [rowActionKind, setRowActionKind] = useState<null | 'menu' | 'owner' | 'status' | 'category' | 'tags'>(null);
  const [rowActionBusy, setRowActionBusy] = useState(false);
  const [rowOwners, setRowOwners] = useState<any[]>([]);
  const [rowCategories, setRowCategories] = useState<string[]>([]);
  const [rowTagInput, setRowTagInput] = useState('');

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

  // Tracks the last SUCCESSFUL full chat-list resync so re-entering the app can refresh without
  // doing a heavy full read on every quick tab toggle. Only stamped on success (see below).
  const lastFullLoadRef = useRef(0);
  // Concurrency guard so mount + focus + foreground firing together don't launch several full
  // reads at once. Replaces the old "stamp at start" trick, which had a nasty side effect: a
  // FAILED load (e.g. auth token not ready yet on a cold start) still marked the list as "fresh",
  // so every later focus/foreground check skipped refreshing — leaving the user stuck on the
  // previous session's cached list until they pulled to refresh by hand (the reported bug).
  const fullLoadInFlightRef = useRef(false);

  // Full resync of the chat list (same fetch as pull-to-refresh). Shows the top refresh spinner
  // even when a stale list is already on screen, so the user gets a clear indication that the app
  // is fetching the current chats instead of silently sitting on old data.
  const refreshChatsFull = useCallback(async (showIndicator = true) => {
    if (!user?.organization) return;
    if (fullLoadInFlightRef.current) return; // a full load is already running — don't double-fetch
    fullLoadInFlightRef.current = true;
    if (showIndicator) setRefreshing(true);
    try {
      await loadChats(user.organization, currentUserId, chatsDV || 'all');
      // Stamp ONLY on success. A failed fetch leaves the clock stale so the next focus/foreground
      // retries automatically instead of trusting a load that never delivered fresh data.
      lastFullLoadRef.current = Date.now();
    } finally {
      fullLoadInFlightRef.current = false;
      if (showIndicator) setRefreshing(false);
    }
  }, [user?.organization, loadChats, currentUserId, chatsDV]);

  // Cheap "catch me up" refresh for every entry into the tab/app: pulls only the most-recent
  // conversations and upserts them, so returning to the list always reflects the current state
  // without waiting on a manual pull-to-refresh — and without the heavy full-collection read.
  const refreshChatsIncremental = useCallback(() => {
    if (!user?.organization) return;
    refreshRecentChats(user.organization, currentUserId, chatsDV || 'all');
  }, [user?.organization, refreshRecentChats, currentUserId, chatsDV]);

  // How long the full list may sit untouched before an entry triggers a fresh FULL resync.
  const FULL_RESYNC_STALE_MS = 30000;

  // Saved Views (view-only on mobile — created on the web)
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [activeViewId, setActiveViewId] = useState<string>('__all__');
  // View management (per-org, local): manual order + hidden tabs, plus the settings sheet.
  // Mirrors the web Sidebar: tab order and hidden views are a purely client-side preference
  // (localStorage on the web → AsyncStorage here), keyed by organization. Only the saved-view
  // definitions themselves live on the server.
  const [showViewsSettings, setShowViewsSettings] = useState(false);
  const [viewOrder, setViewOrder] = useState<string[]>([]);
  const [hiddenViewIds, setHiddenViewIds] = useState<string[]>([]);
  const [viewPrefsLoaded, setViewPrefsLoaded] = useState(false);
  // Org-wide view configuration (set by an admin on the web / here) — mirrors the web Sidebar:
  //  • sidebarViewOrder (shared) → the default tab ORDER every user sees
  //  • sidebarOrgDefault         → the default LANDING tab (fallback: __toHandle__, like web)
  // A user who reorders locally gets a PERSONAL override (hasPersonalOrder) that wins over the org
  // order until they reset it. Persisted org order can be saved by admins via "שמור לארגון".
  const [orgViewOrder, setOrgViewOrder] = useState<string[]>([]);
  const [orgViewOrderDocId, setOrgViewOrderDocId] = useState<string>('');
  const [orgDefaultViewId, setOrgDefaultViewId] = useState<string>('');
  const [hasPersonalOrder, setHasPersonalOrder] = useState(false);
  const [savingOrgOrder, setSavingOrgOrder] = useState(false);
  const [orgConfigLoaded, setOrgConfigLoaded] = useState(false);
  const orgDefaultAppliedRef = useRef(false);

  // Save-view modal (create a new view from the current filters)
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

  // Time filter (סינון לפי זמן) — mirrors the web Sidebar "filter by time" section.
  // '' = off | 'active7' / 'active30' = last message within N days | 'inactive7' / 'inactive30'
  // = no activity for more than N days.
  const [activityFilter, setActivityFilter] = useState<string>('');
  const [activityMenuVisible, setActivityMenuVisible] = useState(false);

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

  // Per-org AsyncStorage keys for the local view preferences (order + hidden tabs).
  const org = user?.organization || '';
  const viewOrderKey = `chats_view_order_${org}`;
  const hiddenViewsKey = `chats_hidden_views_${org}`;
  const personalOrderKey = `chats_view_order_personal_${org}`;

  // Restore the saved order / hidden set for this org. `viewPrefsLoaded` guards the persist
  // effects below so we don't overwrite storage with the empty initial state before load.
  useEffect(() => {
    if (!org) return;
    let cancelled = false;
    setViewPrefsLoaded(false);
    (async () => {
      try {
        const [orderRaw, hiddenRaw, personalRaw] = await Promise.all([
          AsyncStorage.getItem(viewOrderKey),
          AsyncStorage.getItem(hiddenViewsKey),
          AsyncStorage.getItem(personalOrderKey),
        ]);
        if (cancelled) return;
        setViewOrder(orderRaw ? JSON.parse(orderRaw) : []);
        setHiddenViewIds(hiddenRaw ? JSON.parse(hiddenRaw) : []);
        setHasPersonalOrder(personalRaw === 'true');
      } catch {
        if (!cancelled) { setViewOrder([]); setHiddenViewIds([]); setHasPersonalOrder(false); }
      } finally {
        if (!cancelled) setViewPrefsLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [org]);

  // Load the org-wide view ORDER (shared) and DEFAULT landing view configured on the web, so the
  // app shows the organization's default views exactly as an admin defined them.
  useEffect(() => {
    if (!org) return;
    let cancelled = false;
    setOrgConfigLoaded(false);
    const uid = user?.uID || user?.userId;
    // Org default view order (a single shared doc under viewType 'sidebarViewOrder').
    const pOrder = axiosInstance.post(ENDPOINTS.GET_USER_VIEWS, { organization: org, userId: uid, viewType: 'sidebarViewOrder' })
      .then((res) => {
        if (cancelled) return;
        const views = res.data?.Data?.views || (Array.isArray(res.data) ? res.data : []);
        const shared = (views || []).find((v: any) => (v.Visibility || v.visibility) === 'shared') || views?.[0];
        const order = shared?.ViewData?.order || shared?.viewData?.order;
        if (Array.isArray(order)) setOrgViewOrder(order);
        if (shared?.id) setOrgViewOrderDocId(shared.id);
      }).catch(() => {});
    // Org default landing view.
    const pDefault = axiosInstance.post(ENDPOINTS.GET_USER_VIEWS, { organization: org, userId: uid, viewType: 'sidebarOrgDefault' })
      .then((res) => {
        if (cancelled) return;
        const views = res.data?.Data?.views || (Array.isArray(res.data) ? res.data : []);
        const shared = (views || []).find((v: any) => (v.Visibility || v.visibility) === 'shared') || views?.[0];
        const def = shared?.ViewData?.defaultViewId || shared?.viewData?.defaultViewId;
        if (def) setOrgDefaultViewId(def);
      }).catch(() => {});
    Promise.allSettled([pOrder, pDefault]).then(() => { if (!cancelled) setOrgConfigLoaded(true); });
    return () => { cancelled = true; };
  }, [org, user?.uID, user?.userId]);

  // Always holds the latest fully-ordered tab id list (built-ins + saved). Lets moveViewTab /
  // saveOrgViewOrder reorder against the real displayed order without a forward reference.
  const orderedIdsRef = useRef<string[]>([]);

  const persistViewOrder = useCallback((next: string[]) => {
    setViewOrder(next);
    AsyncStorage.setItem(viewOrderKey, JSON.stringify(next)).catch(() => {});
  }, [viewOrderKey]);

  const markPersonalOrder = useCallback(() => {
    setHasPersonalOrder(true);
    AsyncStorage.setItem(personalOrderKey, 'true').catch(() => {});
  }, [personalOrderKey]);

  // Reset back to the organization's default order (drops the personal override).
  const resetToOrgViewOrder = useCallback(() => {
    setHasPersonalOrder(false);
    AsyncStorage.removeItem(personalOrderKey).catch(() => {});
  }, [personalOrderKey]);

  const persistHiddenViews = useCallback((next: string[]) => {
    setHiddenViewIds(next);
    AsyncStorage.setItem(hiddenViewsKey, JSON.stringify(next)).catch(() => {});
  }, [hiddenViewsKey]);

  // Swap a tab one slot up (-1) or down (+1). Mirrors the web ▲/▼ arrows. Reordering creates a
  // PERSONAL override that wins over the org default order until the user resets it. We reorder
  // against the currently displayed order (effective org/personal order + any extras), not the
  // raw personal cache, so the first drag behaves intuitively even on the org default order.
  const moveViewTab = useCallback((tabId: string, direction: -1 | 1) => {
    const base = (orderedIdsRef.current && orderedIdsRef.current.length)
      ? [...orderedIdsRef.current]
      : [...viewOrder];
    const idx = base.indexOf(tabId);
    if (idx === -1) return;
    const swap = idx + direction;
    if (swap < 0 || swap >= base.length) return;
    [base[idx], base[swap]] = [base[swap], base[idx]];
    persistViewOrder(base);
    markPersonalOrder();
  }, [viewOrder, persistViewOrder, markPersonalOrder]);

  // Admin: persist the current tab order org-wide ("שמור לארגון") — every user then sees this
  // order by default (unless they set a personal one). Uses the same UserViews doc as the web.
  const saveOrgViewOrder = useCallback(async () => {
    if (!user?.organization || !userIsAdmin) return;
    const order = (orderedIdsRef.current && orderedIdsRef.current.length)
      ? [...orderedIdsRef.current]
      : [...viewOrder];
    if (order.length === 0) return;
    setSavingOrgOrder(true);
    try {
      const res = await axiosInstance.post(ENDPOINTS.SAVE_USER_VIEW, {
        organization: user.organization,
        userId: user.uID || user.userId,
        viewType: 'sidebarViewOrder',
        name: 'orgViewOrder',
        isPinned: true,
        viewData: { order },
        visibility: 'shared',
        ...(orgViewOrderDocId ? { existingId: orgViewOrderDocId } : {}),
      });
      if (res.data?.Data?.id) setOrgViewOrderDocId(res.data.Data.id);
      setOrgViewOrder(order);
      // The admin just defined the org order — drop their personal override so they see it too.
      resetToOrgViewOrder();
      Alert.alert('✅', isRTL ? 'סדר התצוגות נשמר לכל הארגון' : 'View order saved for the whole organization');
    } catch {
      Alert.alert(isRTL ? 'שגיאה' : 'Error', isRTL ? 'שמירת הסדר נכשלה' : 'Failed to save order');
    } finally {
      setSavingOrgOrder(false);
    }
  }, [user, userIsAdmin, viewOrder, orgViewOrderDocId, resetToOrgViewOrder, isRTL]);

  // Hide/show a tab. Built-in tabs and shared (organization) views can only be hidden, never
  // deleted — hiding is a local preference so it never affects other users.
  const toggleHideView = useCallback((viewId: string) => {
    setHiddenViewIds((prev) => {
      const next = prev.includes(viewId) ? prev.filter((id) => id !== viewId) : [...prev, viewId];
      AsyncStorage.setItem(hiddenViewsKey, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, [hiddenViewsKey]);

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
    setActivityFilter(filters.activityFilter || '');
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
    setActivityFilter('');
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
          activityFilter,
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
  }, [newViewName, user, filter, categoryFilter, ownerFilter, groupFilter, leadStageFilter, caseStageFilter, activityFilter, searchInput, userIsAdmin, saveViewVisibility]);

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

  // The full tab set (built-in + the saved views this user is allowed to see), before ordering
  // or hiding. Shared views are visible to everyone; personal views only to their owner.
  const allViewTabs = useMemo<ViewTab[]>(() => {
    const builtins: ViewTab[] = BUILT_IN_VIEWS.map((b) => ({
      id: b.id,
      label: t(b.labelKey, b.fallback),
      kind: 'builtin',
      shared: false,
      deletable: false,
    }));
    const saved: ViewTab[] = savedViews
      .filter((v) => {
        const vis = v.Visibility || 'personal';
        if (vis === 'shared') return true;
        return (v.UserId || '') === currentUserId;
      })
      .map((v) => {
        const shared = (v.Visibility || 'personal') === 'shared';
        return {
          id: v.id,
          label: v.Name,
          kind: 'saved' as const,
          view: v,
          shared,
          // Only a PERSONAL view you own can be deleted. Shared (organization) views can only
          // be hidden locally — deleting them would affect the whole org.
          deletable: !shared && (v.UserId || '') === currentUserId,
        };
      });
    return [...builtins, ...saved];
  }, [savedViews, currentUserId, t]);

  // Once prefs are loaded, append any tab IDs that aren't in the persisted order yet (newly
  // created views, or first run). We never remove IDs — a view that disappears just drops out
  // of the render map below, but its slot is remembered if it ever comes back.
  useEffect(() => {
    if (!viewPrefsLoaded || !org) return;
    const known = new Set(viewOrder);
    const missing = allViewTabs.map((tb) => tb.id).filter((id) => !known.has(id));
    if (missing.length > 0) persistViewOrder([...viewOrder, ...missing]);
  }, [viewPrefsLoaded, org, allViewTabs, viewOrder, persistViewOrder]);

  // Effective order precedence (mirrors the web Sidebar): a PERSONAL reorder wins, else the
  // org-wide default order, else the natural (built-in + appended) order.
  const effectiveOrder = useMemo<string[]>(() => {
    if (hasPersonalOrder && viewOrder.length) return viewOrder;
    if (orgViewOrder.length) return orgViewOrder;
    return viewOrder;
  }, [hasPersonalOrder, viewOrder, orgViewOrder]);

  // Ordered tabs for the settings sheet (includes hidden ones so they can be restored)...
  const orderedViewTabs = useMemo<ViewTab[]>(() => {
    if (effectiveOrder.length === 0) return allViewTabs;
    const byId = new Map(allViewTabs.map((tb) => [tb.id, tb]));
    const ordered = effectiveOrder.map((id) => byId.get(id)).filter(Boolean) as ViewTab[];
    const known = new Set(effectiveOrder);
    const extras = allViewTabs.filter((tb) => !known.has(tb.id));
    return [...ordered, ...extras];
  }, [allViewTabs, effectiveOrder]);

  // Keep the ref in sync so moveViewTab / saveOrgViewOrder reorder against the real displayed order.
  useEffect(() => {
    orderedIdsRef.current = orderedViewTabs.map((tb) => tb.id);
  }, [orderedViewTabs]);

  // ...and the subset actually shown as tabs above the list (hidden tabs removed).
  const visibleViewTabs = useMemo<ViewTab[]>(
    () => orderedViewTabs.filter((tb) => !hiddenViewIds.includes(tb.id)),
    [orderedViewTabs, hiddenViewIds],
  );

  // Apply the organization's DEFAULT landing view once, after views + org config have loaded —
  // mirrors the web precedence: org default → fallback __toHandle__. We only do this on first
  // load (guarded by a ref) so it never fights the user's own tab selection afterwards.
  useEffect(() => {
    if (!viewPrefsLoaded || !orgConfigLoaded || orgDefaultAppliedRef.current) return;
    // Wait until saved views are available if an org default points at one.
    const wantId = orgDefaultViewId || '__toHandle__';
    const target = visibleViewTabs.find((tb) => tb.id === wantId)
      || visibleViewTabs.find((tb) => tb.id === '__toHandle__')
      || visibleViewTabs.find((tb) => tb.id === '__all__');
    // If the org default is a saved view that hasn't loaded yet, defer (don't consume the guard).
    if (orgDefaultViewId && !target) return;
    orgDefaultAppliedRef.current = true;
    if (target && target.id !== '__all__') applyViewTab(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewPrefsLoaded, orgConfigLoaded, orgDefaultViewId, visibleViewTabs]);

  // Apply a tab by its id (built-in tabs map to a store filter; saved views restore their filters).
  const applyViewTab = useCallback((tab: ViewTab) => {
    if (tab.kind === 'saved' && tab.view) { loadSavedView(tab.view); return; }
    switch (tab.id) {
      case '__all__': clearAllFilters(); break;
      case '__toHandle__': setActiveViewId('__toHandle__'); setFilter('toHandle'); break;
      case '__mine__': setActiveViewId('__mine__'); setFilter('myChats'); break;
      case '__unassigned__': setActiveViewId('__unassigned__'); setFilter('unassigned'); break;
      case '__unread__': setActiveViewId('__unread__'); setFilter('unread'); break;
      default: break;
    }
  }, [loadSavedView, clearAllFilters, setFilter]);

  useEffect(() => {
    if (user?.organization) {
      // Full load on mount. When the list is empty (true cold start) the empty-state spinner
      // covers it; when a cached list from the previous session is ALREADY on screen, show the
      // top refresh spinner so the user gets a clear "fetching the current chats" cue instead of
      // silently staring at yesterday's snapshot.
      const hasStaleCache = useChatStore.getState().chats.length > 0;
      refreshChatsFull(hasStaleCache);
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
        // The list often looks stale after the app was in the background (WebSocket may have missed
        // events). If it's been a while, do a FULL resync (with the refresh indicator) so the user
        // immediately sees the current chats instead of the state from when they left. For quick
        // in-and-out switches, the cheap incremental refresh is enough and avoids a full read.
        const stale = Date.now() - lastFullLoadRef.current > FULL_RESYNC_STALE_MS;
        if (stale) {
          refreshChatsFull(true);
        } else {
          refreshChatsIncremental();
        }
        // Returning to the app should land the user on the newest chats, not the stale offset
        // they left the list at.
        InteractionManager.runAfterInteractions(() => scrollChatsToTop(false));
      }
    });
    return () => subscription.remove();
  }, [user?.organization, refreshChatsIncremental, refreshChatsFull, chatsDV, currentUserId, scrollChatsToTop]);

  // Snap to the top whenever the chats tab regains focus, and resync the list if it's gone stale
  // (e.g. coming back from a conversation or another tab after a while) so it never keeps showing
  // an old snapshot from a previous session.
  useFocusEffect(
    useCallback(() => {
      if (user?.organization) {
        const { pendingListReload, clearListReload } = useChatStore.getState();
        if (pendingListReload) {
          // We just came back from a conversation that was opened via a push notification. The list
          // may have been left showing only that one contact (cold-start / partial-list race), so
          // force a full reload and drop any transient search so the complete list is shown.
          clearListReload();
          setSearchInput('');
          setDebouncedSearch('');
          setSearchVisible(false);
          refreshChatsFull(true);
        } else if (Date.now() - lastFullLoadRef.current > FULL_RESYNC_STALE_MS) {
          // List has gone stale → full resync with the visible refresh spinner.
          refreshChatsFull(true);
        } else if (!fullLoadInFlightRef.current) {
          // Recently loaded but the user is re-entering the tab — do a cheap incremental catch-up
          // so any conversation that changed elsewhere (web/other agent) shows up without a manual
          // pull-to-refresh. Skipped while a full load is already running to avoid a double fetch.
          refreshChatsIncremental();
        }
      }
      InteractionManager.runAfterInteractions(() => scrollChatsToTop(false));
    }, [user?.organization, refreshChatsFull, refreshChatsIncremental, scrollChatsToTop])
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
    } else if (filter === 'toHandle') {
      // Mirrors the web "לטיפול" built-in: conversations that are mine OR not assigned to a
      // human (unassigned / bot-owned) — i.e. everything that still needs a human to handle it.
      const userId = user?.uID || user?.userId;
      result = result.filter((c) => c.ownerId === userId || !c.ownerId);
    } else if (filter === 'myChats') {
      const userId = user?.uID || user?.userId;
      result = result.filter((c) => c.ownerId === userId);
    } else if (filter === 'unassigned') {
      result = result.filter((c) => !c.ownerId);
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

    if (activityFilter) {
      const now = Date.now();
      const DAY = 86400000;
      result = result.filter((c) => {
        const ms = chatActivityMs(c);
        // A chat with no valid last-activity timestamp counts as inactive.
        if (!ms) return activityFilter.startsWith('inactive');
        const ageDays = (now - ms) / DAY;
        switch (activityFilter) {
          case 'active7': return ageDays <= 7;
          case 'active30': return ageDays <= 30;
          case 'inactive7': return ageDays > 7;
          case 'inactive30': return ageDays > 30;
          default: return true;
        }
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
  }, [chats, filter, debouncedSearch, categoryFilter, ownerFilter, groupFilter, leadStageFilter, caseStageFilter, numberFilter, activityFilter, user, contactLeadMap, contactCaseMap, leadStages]);

  // When searching, show all results; otherwise paginate for smooth scrolling
  const displayedChats = useMemo(() => {
    if (debouncedSearch.trim()) return filteredChats;
    return filteredChats.slice(0, displayLimit);
  }, [filteredChats, displayLimit, debouncedSearch]);

  const hasMoreChats = !debouncedSearch.trim() && displayLimit < filteredChats.length;

  // Any non-default filter active → surfaces the "נקה סינון" (clear) chip, mirroring the web panel.
  const hasActiveFilters =
    filter !== 'all' ||
    categoryFilter !== 'all' ||
    ownerFilter !== 'all' ||
    groupFilter.length > 0 ||
    leadStageFilter.length > 0 ||
    caseStageFilter.length > 0 ||
    !!numberFilter ||
    !!activityFilter ||
    !!debouncedSearch.trim();

  const ACTIVITY_OPTIONS: { id: string; label: string }[] = [
    { id: 'active7', label: t('sidebar.active7', 'פעיל ב-7 ימים') },
    { id: 'active30', label: t('sidebar.active30', 'פעיל ב-30 יום') },
    { id: 'inactive7', label: t('sidebar.inactive7', 'לא פעיל מעל 7 ימים') },
    { id: 'inactive30', label: t('sidebar.inactive30', 'לא פעיל מעל 30 יום') },
  ];
  const activityLabel = ACTIVITY_OPTIONS.find((o) => o.id === activityFilter)?.label;

  const onEndReachedChats = useCallback(() => {
    if (!hasMoreChats) return;
    setDisplayLimit((prev) => prev + CHATS_PAGE_SIZE);
  }, [hasMoreChats]);

  // Reset display limit when filters change
  useEffect(() => {
    setDisplayLimit(CHATS_PAGE_SIZE);
  }, [filter, categoryFilter, ownerFilter, groupFilter, leadStageFilter, caseStageFilter, numberFilter, activityFilter]);

  const onRefresh = useCallback(async () => {
    await refreshChatsFull(true);
  }, [refreshChatsFull]);

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

  // ---- Bulk: resolve the WABA number to send FROM ----
  // Prefer the number the list is currently filtered on, else the first number available to this
  // user, else the user's default WABA number (single-number orgs). Returns display + PhoneNumberId.
  const resolveBulkFromNumber = useCallback((): { from: string; fromNumberId: string } => {
    if (numberFilter) {
      const m = availableNumbers.find((n) => (n.PhoneNumberId || n.phoneNumberId) === numberFilter);
      if (m) return { from: m.DisplayNumber || m.displayNumber || m.Label || m.label || (user as any)?.wabaNumber || '', fromNumberId: numberFilter };
    }
    const first = availableNumbers[0];
    if (first) return {
      from: first.DisplayNumber || first.displayNumber || first.Label || first.label || (user as any)?.wabaNumber || '',
      fromNumberId: first.PhoneNumberId || first.phoneNumberId || '',
    };
    return { from: (user as any)?.wabaNumber || '', fromNumberId: '' };
  }, [numberFilter, availableNumbers, user]);

  // ---- Bulk: open send modal (loads approved templates lazily) ----
  const openBulkSend = useCallback(async () => {
    setShowBulkMoreMenu(false);
    setShowBulkSendModal(true);
    if (!user?.organization || bulkTemplates.length > 0) return;
    setLoadingBulkTemplates(true);
    try {
      const tpls = await chatsApi.getTemplates(user.organization);
      setBulkTemplates(Array.isArray(tpls) ? tpls : []);
    } catch {
      setBulkTemplates([]);
    } finally {
      setLoadingBulkTemplates(false);
    }
  }, [user?.organization, bulkTemplates.length]);

  const closeBulkSend = useCallback(() => {
    setShowBulkSendModal(false);
    setBulkText('');
    setBulkTemplateId('');
    setBulkSendProgress(null);
  }, []);

  // ---- Bulk: send a message (free text or template) to every selected chat, sequentially ----
  const handleBulkSend = useCallback(async () => {
    if (!user?.organization || selectedPhones.length === 0) return;
    if (bulkSendMode === 'text' && !bulkText.trim()) return;
    if (bulkSendMode === 'template' && !bulkTemplateId) return;
    const { from, fromNumberId } = resolveBulkFromNumber();
    const senderName = user.fullname || (user as any).name || 'system';
    const uid = user.uID || user.userId;
    setBulkBusy(true);
    let ok = 0;
    let failed = 0;
    setBulkSendProgress({ done: 0, total: selectedPhones.length });
    try {
      for (let i = 0; i < selectedPhones.length; i++) {
        const phone = selectedPhones[i];
        try {
          if (bulkSendMode === 'template') {
            await chatsApi.sendTemplateMessage(user.organization, phone, bulkTemplateId, uid, [], fromNumberId || undefined);
          } else {
            await chatsApi.sendMessage(user.organization, phone, bulkText.trim(), senderName, uid, undefined, from, (user as any)?.email || '', fromNumberId || undefined);
          }
          ok++;
        } catch {
          failed++;
        }
        setBulkSendProgress({ done: i + 1, total: selectedPhones.length });
      }
      Alert.alert(
        '✅',
        isRTL
          ? `נשלחו ${ok} הודעות${failed ? `, ${failed} נכשלו (ייתכן מחוץ לחלון 24 שעות)` : ''}`
          : `Sent ${ok}${failed ? `, ${failed} failed (may be outside the 24h window)` : ''}`,
      );
    } finally {
      setBulkBusy(false);
      closeBulkSend();
      exitSelection();
    }
  }, [user, selectedPhones, bulkSendMode, bulkText, bulkTemplateId, resolveBulkFromNumber, isRTL, closeBulkSend, exitSelection]);

  // ---- Bulk: update conversation category ----
  const openBulkCategory = useCallback(async () => {
    setShowBulkMoreMenu(false);
    setShowBulkCategoryModal(true);
    if (!user?.organization) return;
    try {
      const cats = await chatsApi.getConversationCategories(user.organization);
      setBulkCategories(Array.isArray(cats) && cats.length > 0 ? cats : categories.filter((c) => c !== 'all'));
    } catch {
      setBulkCategories(categories.filter((c) => c !== 'all'));
    }
  }, [user?.organization, categories]);

  const handleBulkCategory = useCallback(async (category: string) => {
    if (!user?.organization || selectedPhones.length === 0) return;
    setBulkBusy(true);
    try {
      for (const phone of selectedPhones) {
        await chatsApi.updateConversationCategory(user.organization, phone, category);
        addOrUpdateChat({ phoneNumber: phone, category, lastConversationCategory: category } as any);
      }
    } finally {
      setBulkBusy(false);
      setShowBulkCategoryModal(false);
      exitSelection();
    }
  }, [user?.organization, selectedPhones, addOrUpdateChat, exitSelection]);

  // ---- Bulk: mark as read ----
  const handleBulkMarkRead = useCallback(async () => {
    setShowBulkMoreMenu(false);
    if (!user?.organization || selectedPhones.length === 0) return;
    setBulkBusy(true);
    try {
      const uid = user.uID || user.userId;
      const uname = user.fullname || (user as any).name || '';
      for (const phone of selectedPhones) {
        await chatsApi.markAsRead(user.organization, phone, uid, uname);
        addOrUpdateChat({ phoneNumber: phone, unreadCount: 0, isRead: true } as any);
      }
    } finally {
      setBulkBusy(false);
      exitSelection();
    }
  }, [user, selectedPhones, addOrUpdateChat, exitSelection]);

  // ---- Per-row quick actions (swipe → "…") ----
  const openRowActions = useCallback((chat: Chat) => {
    swipeableRefs.get(chat.phoneNumber)?.close();
    setRowActionChat(chat);
    setRowActionKind('menu');
  }, [swipeableRefs]);

  const closeRowActions = useCallback(() => {
    setRowActionChat(null);
    setRowActionKind(null);
    setRowTagInput('');
  }, []);

  const rowTakeOwnership = useCallback(async () => {
    if (!user?.organization || !rowActionChat) return;
    const myId = user.uID || user.userId || '';
    const myName = user.fullname || user.name || 'system';
    setRowActionBusy(true);
    try {
      await contactsApi.updateOwner(user.organization, rowActionChat.phoneNumber, myId, myName);
      addOrUpdateChat({ phoneNumber: rowActionChat.phoneNumber, ownerId: myId, ownerName: myName } as any);
      Alert.alert('✅', isRTL ? 'לקחת בעלות על השיחה' : 'You took ownership');
    } catch {
      Alert.alert(isRTL ? 'שגיאה' : 'Error', isRTL ? 'הפעולה נכשלה' : 'Action failed');
    } finally {
      setRowActionBusy(false);
      closeRowActions();
    }
  }, [user, rowActionChat, addOrUpdateChat, isRTL, closeRowActions]);

  const openRowOwner = useCallback(async () => {
    setRowActionKind('owner');
    if (!user?.organization) return;
    try {
      const users = await usersApi.getAll(user.organization);
      setRowOwners(Array.isArray(users) ? users : []);
    } catch {
      setRowOwners([]);
    }
  }, [user?.organization]);

  const rowAssignOwner = useCallback(async (ownerId: string, ownerName: string) => {
    if (!user?.organization || !rowActionChat) return;
    setRowActionBusy(true);
    try {
      await contactsApi.updateOwner(user.organization, rowActionChat.phoneNumber, ownerId, user.fullname || 'system');
      addOrUpdateChat({ phoneNumber: rowActionChat.phoneNumber, ownerId, ownerName } as any);
      Alert.alert('✅', isRTL ? `הבעלות שויכה ל-${ownerName}` : `Assigned to ${ownerName}`);
    } catch {
      Alert.alert(isRTL ? 'שגיאה' : 'Error', isRTL ? 'שיוך הבעלות נכשל' : 'Failed to assign owner');
    } finally {
      setRowActionBusy(false);
      closeRowActions();
    }
  }, [user, rowActionChat, addOrUpdateChat, isRTL, closeRowActions]);

  const rowSetStatus = useCallback(async (status: string) => {
    if (!user?.organization || !rowActionChat) return;
    setRowActionBusy(true);
    try {
      await chatsApi.updateConversationStatus(user.organization, rowActionChat.phoneNumber, status, user.uID || user.userId);
      addOrUpdateChat({ phoneNumber: rowActionChat.phoneNumber, status, lastConversationStatus: status } as any);
    } finally {
      setRowActionBusy(false);
      closeRowActions();
    }
  }, [user, rowActionChat, addOrUpdateChat, closeRowActions]);

  const openRowCategory = useCallback(async () => {
    setRowActionKind('category');
    if (!user?.organization) return;
    try {
      const cats = await chatsApi.getConversationCategories(user.organization);
      setRowCategories(Array.isArray(cats) ? cats : []);
    } catch {
      // Fall back to categories derived from the loaded chats.
      setRowCategories(categories.filter((c) => c !== 'all'));
    }
  }, [user?.organization, categories]);

  const rowSetCategory = useCallback(async (category: string) => {
    if (!user?.organization || !rowActionChat) return;
    setRowActionBusy(true);
    try {
      await chatsApi.updateConversationCategory(user.organization, rowActionChat.phoneNumber, category);
      addOrUpdateChat({ phoneNumber: rowActionChat.phoneNumber, category, lastConversationCategory: category } as any);
    } finally {
      setRowActionBusy(false);
      closeRowActions();
    }
  }, [user, rowActionChat, addOrUpdateChat, closeRowActions]);

  const rowCurrentTags = useMemo(() => {
    const raw = rowActionChat?.tags || rowActionChat?.keys;
    if (Array.isArray(raw)) return raw;
    if (typeof raw === 'string' && raw) return raw.split(',').map((s) => s.trim()).filter(Boolean);
    return [] as string[];
  }, [rowActionChat]);

  const rowSaveTags = useCallback(async (nextTags: string[]) => {
    if (!user?.organization || !rowActionChat) return;
    setRowActionBusy(true);
    try {
      await contactsApi.update(
        user.organization,
        { phoneNumber: rowActionChat.phoneNumber, keys: nextTags } as any,
        user.uID || user.userId,
        user.fullname,
      );
      addOrUpdateChat({ phoneNumber: rowActionChat.phoneNumber, tags: nextTags, keys: nextTags } as any);
      setRowActionChat((prev) => (prev ? ({ ...prev, tags: nextTags, keys: nextTags } as Chat) : prev));
    } finally {
      setRowActionBusy(false);
    }
  }, [user, rowActionChat, addOrUpdateChat]);

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

      // Owner badge (mirrors the web sidebar): show the human owner's name, or an
      // "unassigned" indicator when the chat has no human owner (empty / AI-owned).
      const ownerNameRaw = ((item as any).ownerName || (item as any).OwnerName || '').toString().trim();
      const ownerIdLc = ((item as any).ownerId || (item as any).OwnerId || '').toString().trim().toLowerCase();
      const isUnassigned = !ownerNameRaw && (!ownerIdLc || ownerIdLc === 'gambot' || ownerIdLc === 'gambot-ai');
      const ownerNameShort = ownerNameRaw.length > 18 ? ownerNameRaw.slice(0, 17).trimEnd() + '…' : ownerNameRaw;

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

            {/* Badges row: owner, status, lead stage, case stage, CTWA */}
            {(!!ownerNameRaw || isUnassigned || getChatConversationStatus(item) !== 'unknown' || displayLeadStage || displayCaseStages.length > 0 || item.isCTWA) && (
              <View style={[styles.badgesRow, { flexDirection }]}>
                {!!ownerNameRaw && (
                  <View style={[styles.badge, { backgroundColor: withAlpha('#2e6155', 0.12) }]}>
                    <MaterialCommunityIcons name="account" size={10} color="#2e6155" style={{ marginEnd: 2 }} />
                    <Text style={[styles.badgeText, { color: '#2e6155' }]} numberOfLines={1}>
                      {ownerNameShort}
                    </Text>
                  </View>
                )}
                {isUnassigned && (
                  <View style={[styles.badge, { backgroundColor: '#fef3c7', borderWidth: 1, borderColor: '#f59e0b' }]}>
                    <MaterialCommunityIcons name="account-outline" size={10} color="#b45309" style={{ marginEnd: 2 }} />
                    <Text style={[styles.badgeText, { color: '#b45309' }]} numberOfLines={1}>
                      {t('sidebar.unassigned', 'לא משויך')}
                    </Text>
                  </View>
                )}
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
            <View style={{ flexDirection: 'row' }}>
              <Pressable
                onPress={() => handleSingleMarkUnread(item)}
                style={[styles.swipeUnreadBtn, { backgroundColor: theme.colors.primary }]}
              >
                <MaterialCommunityIcons name="email-mark-as-unread" size={22} color="#FFF" />
                <Text style={styles.swipeUnreadLabel}>{t('chats.markUnread', 'לא נקרא')}</Text>
              </Pressable>
              <Pressable
                onPress={() => openRowActions(item)}
                style={[styles.swipeUnreadBtn, { backgroundColor: '#475569' }]}
              >
                <MaterialCommunityIcons name="dots-horizontal" size={22} color="#FFF" />
                <Text style={styles.swipeUnreadLabel}>{t('common.more', 'עוד')}</Text>
              </Pressable>
            </View>
          )}
          overshootRight={false}
          friction={2}
        >
          {row}
        </Swipeable>
      );
    },
    [theme, openChat, flexDirection, textAlign, isRTL, lang, contactLeadMap, contactCaseMap, availableNumbers, t, selectionMode, selectedPhones, toggleSelect, enterSelection, handleSingleMarkUnread, openRowActions, swipeableRefs, currentUserId],
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

      {/* Saved Views Tabs — order & visibility mirror the web Sidebar (user-configurable, per-org) */}
      <View style={[styles.viewsRow, { backgroundColor: theme.colors.surface, borderBottomColor: theme.colors.outline }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.filtersScroll, { flexDirection }]}>
          {visibleViewTabs.map((tab) => {
            const active = activeViewId === tab.id;
            return (
              <Pressable
                key={tab.id}
                onPress={() => applyViewTab(tab)}
                onLongPress={() => {
                  const options: any[] = [{ text: t('common.cancel'), style: 'cancel' }];
                  options.push({
                    text: t('sidebar.hideView', 'הסתר תצוגה'),
                    onPress: () => toggleHideView(tab.id),
                  });
                  if (tab.deletable) {
                    options.push({
                      text: t('common.delete', 'מחק'),
                      style: 'destructive',
                      onPress: () => deleteSavedView(tab.id),
                    });
                  }
                  Alert.alert(tab.label, t('sidebar.viewActions', 'פעולות תצוגה'), options);
                }}
                style={[styles.viewTab, active && { borderBottomColor: theme.colors.primary, borderBottomWidth: 2 }]}
              >
                <Text
                  style={[styles.viewTabText, { color: active ? theme.colors.primary : theme.colors.onSurfaceVariant }]}
                  numberOfLines={1}
                >
                  {(tab.shared ? '👥 ' : '') + tab.label}
                </Text>
              </Pressable>
            );
          })}
          <Pressable onPress={() => setShowSaveViewModal(true)} style={styles.viewTab}>
            <MaterialCommunityIcons name="plus" size={18} color={theme.colors.primary} />
          </Pressable>
          <Pressable onPress={() => setShowViewsSettings(true)} style={styles.viewTab}>
            <MaterialCommunityIcons name="cog-outline" size={18} color={theme.colors.onSurfaceVariant} />
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
          {hasActiveFilters && (
            <Chip
              icon="filter-remove-outline"
              onPress={clearAllFilters}
              compact
              style={[styles.filterChip, { backgroundColor: theme.colors.errorContainer }]}
              textStyle={[styles.filterChipText, { color: theme.colors.error, fontWeight: '600' }]}
            >
              {t('sidebar.clearFilters', 'נקה סינון')}
            </Chip>
          )}
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

          <Menu
            visible={activityMenuVisible}
            onDismiss={() => setActivityMenuVisible(false)}
            anchor={
              <Chip
                icon="clock-outline"
                onPress={() => setActivityMenuVisible(true)}
                compact
                style={[
                  styles.filterChip,
                  activityFilter
                    ? { backgroundColor: theme.colors.primaryContainer }
                    : { backgroundColor: theme.colors.surfaceVariant },
                ]}
                textStyle={[
                  styles.filterChipText,
                  activityFilter && { color: theme.colors.primary, fontWeight: '600' },
                ]}
              >
                {activityFilter ? activityLabel : t('sidebar.filterByTime', 'סינון לפי זמן')}
              </Chip>
            }
          >
            <Menu.Item
              title={t('common.all', 'הכל')}
              onPress={() => { setActivityFilter(''); setActivityMenuVisible(false); }}
              leadingIcon={!activityFilter ? 'check' : undefined}
            />
            {ACTIVITY_OPTIONS.map((o) => (
              <Menu.Item
                key={o.id}
                title={o.label}
                onPress={() => { setActivityFilter(o.id); setActivityMenuVisible(false); }}
                leadingIcon={activityFilter === o.id ? 'check' : undefined}
              />
            ))}
          </Menu>

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

      {/* Bulk action bar (multi-select mode) — mirrors the web sidebar bulk toolbar */}
      {selectionMode && selectedPhones.length > 0 && (
        <View
          style={[
            styles.bulkBar,
            { backgroundColor: theme.colors.surface, paddingBottom: insets.bottom + 8, borderTopColor: theme.colors.outlineVariant },
          ]}
        >
          <Pressable style={styles.bulkBtn} onPress={openBulkSend} disabled={bulkBusy}>
            <MaterialCommunityIcons name="send" size={22} color={theme.colors.primary} />
            <Text style={[styles.bulkBtnLabel, { color: theme.colors.onSurface }]}>{t('sidebar.sendMessage', 'שלח הודעה')}</Text>
          </Pressable>
          <Pressable style={styles.bulkBtn} onPress={openBulkOwner} disabled={bulkBusy}>
            <MaterialCommunityIcons name="account-switch-outline" size={22} color={theme.colors.primary} />
            <Text style={[styles.bulkBtnLabel, { color: theme.colors.onSurface }]}>{t('sidebar.assignOwner', 'שיוך נציג')}</Text>
          </Pressable>
          <Pressable style={styles.bulkBtn} onPress={() => setShowBulkStatusModal(true)} disabled={bulkBusy}>
            <MaterialCommunityIcons name="swap-horizontal" size={22} color={theme.colors.primary} />
            <Text style={[styles.bulkBtnLabel, { color: theme.colors.onSurface }]}>{t('chats.status', 'סטטוס')}</Text>
          </Pressable>
          <Menu
            visible={showBulkMoreMenu}
            onDismiss={() => setShowBulkMoreMenu(false)}
            anchor={
              <Pressable style={styles.bulkBtn} onPress={() => setShowBulkMoreMenu(true)} disabled={bulkBusy}>
                <MaterialCommunityIcons name="dots-horizontal" size={22} color={theme.colors.primary} />
                <Text style={[styles.bulkBtnLabel, { color: theme.colors.onSurface }]}>{t('common.more', 'עוד')}</Text>
              </Pressable>
            }
          >
            <Menu.Item leadingIcon="tag-outline" onPress={openBulkCategory} title={t('chats.category', 'קטגוריה')} />
            <Menu.Item leadingIcon="email-check-outline" onPress={handleBulkMarkRead} title={t('chats.markRead', 'סמן כנקרא')} />
            <Menu.Item leadingIcon="email-mark-as-unread" onPress={() => { setShowBulkMoreMenu(false); handleBulkMarkUnread(); }} title={t('chats.markUnread', 'סמן כלא נקרא')} />
          </Menu>
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

        {/* Views Settings — reorder, hide/show, and delete (personal only) */}
        <Modal
          visible={showViewsSettings}
          onDismiss={() => setShowViewsSettings(false)}
          contentContainerStyle={[styles.newChatModal, { backgroundColor: theme.colors.surface, maxHeight: '80%' }]}
        >
          <Text variant="titleMedium" style={{ color: theme.colors.onSurface, marginBottom: 4, fontWeight: '700', textAlign }}>
            {t('sidebar.manageViews', 'ניהול תצוגות')}
          </Text>
          <Text style={{ color: theme.colors.onSurfaceVariant, marginBottom: 12, fontSize: 12, textAlign }}>
            {t('sidebar.manageViewsHint', 'שנה סדר, הסתר או הצג תצוגות. תצוגות ארגון ניתן רק להסתיר.')}
          </Text>
          <ScrollView style={{ maxHeight: 420 }}>
            {orderedViewTabs.map((tab, idx) => {
              const hidden = hiddenViewIds.includes(tab.id);
              return (
                <View
                  key={tab.id}
                  style={[
                    { flexDirection, alignItems: 'center', paddingVertical: 8, gap: 4 },
                    idx > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.outline },
                  ]}
                >
                  <View style={{ flexDirection: 'column' }}>
                    <IconButton
                      icon="chevron-up"
                      size={20}
                      disabled={idx === 0}
                      onPress={() => moveViewTab(tab.id, -1)}
                      style={{ margin: 0, height: 22 }}
                    />
                    <IconButton
                      icon="chevron-down"
                      size={20}
                      disabled={idx === orderedViewTabs.length - 1}
                      onPress={() => moveViewTab(tab.id, 1)}
                      style={{ margin: 0, height: 22 }}
                    />
                  </View>
                  <Text
                    style={{
                      flex: 1,
                      color: hidden ? theme.colors.onSurfaceVariant : theme.colors.onSurface,
                      textAlign,
                      opacity: hidden ? 0.5 : 1,
                    }}
                    numberOfLines={1}
                  >
                    {(tab.shared ? '👥 ' : '') + tab.label}
                    {tab.kind === 'builtin' || tab.shared
                      ? `  ·  ${t('sidebar.organizationView', 'ארגון')}`
                      : ''}
                  </Text>
                  <IconButton
                    icon={hidden ? 'eye-off-outline' : 'eye-outline'}
                    size={20}
                    iconColor={hidden ? theme.colors.onSurfaceVariant : theme.colors.primary}
                    onPress={() => toggleHideView(tab.id)}
                    style={{ margin: 0 }}
                  />
                  {tab.deletable && (
                    <IconButton
                      icon="trash-can-outline"
                      size={20}
                      iconColor={theme.colors.error}
                      onPress={() => {
                        Alert.alert(
                          tab.label,
                          t('sidebar.deleteViewConfirm', 'למחוק תצוגה זו?'),
                          [
                            { text: t('common.cancel'), style: 'cancel' },
                            { text: t('common.delete', 'מחק'), style: 'destructive', onPress: () => deleteSavedView(tab.id) },
                          ],
                        );
                      }}
                      style={{ margin: 0 }}
                    />
                  )}
                </View>
              );
            })}
          </ScrollView>
          {/* Personal override indicator + reset to the org default order */}
          {hasPersonalOrder && (
            <View style={{ flexDirection, alignItems: 'center', marginTop: 8, gap: 6 }}>
              <MaterialCommunityIcons name="account-cog-outline" size={16} color={theme.colors.onSurfaceVariant} />
              <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 12, flex: 1, textAlign }}>
                {t('sidebar.personalOrderActive', 'הסדר שלך גובר על סדר הארגון')}
              </Text>
              <Button mode="text" compact onPress={resetToOrgViewOrder}>
                {t('sidebar.resetToOrgOrder', 'אפס לסדר הארגון')}
              </Button>
            </View>
          )}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, gap: 8 }}>
            {userIsAdmin ? (
              <Button
                mode="outlined"
                icon="office-building-outline"
                loading={savingOrgOrder}
                disabled={savingOrgOrder}
                onPress={saveOrgViewOrder}
                style={{ flex: 1 }}
              >
                {t('sidebar.saveForOrg', 'שמור לארגון')}
              </Button>
            ) : <View style={{ flex: 1 }} />}
            <Button mode="contained" onPress={() => setShowViewsSettings(false)}>
              {t('common.done', 'סיום')}
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

        {/* Bulk: Send message (free text or approved template) */}
        <Modal
          visible={showBulkSendModal}
          onDismiss={closeBulkSend}
          contentContainerStyle={[styles.newChatModal, { backgroundColor: theme.colors.surface, maxHeight: '80%' }]}
        >
          <Text variant="titleMedium" style={{ color: theme.colors.onSurface, marginBottom: 4, fontWeight: '700', textAlign }}>
            {t('sidebar.sendMessage', 'שלח הודעה')} ({selectedPhones.length})
          </Text>
          <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 12, marginBottom: 12, textAlign }}>
            {bulkSendMode === 'text'
              ? t('sidebar.bulkTextHint', 'טקסט חופשי נשלח רק לשיחות בתוך חלון 24 השעות.')
              : t('sidebar.bulkTemplateHint', 'תבנית מאושרת נשלחת גם מחוץ לחלון 24 השעות.')}
          </Text>
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
            <Chip
              selected={bulkSendMode === 'text'}
              onPress={() => setBulkSendMode('text')}
              compact
              style={{ backgroundColor: bulkSendMode === 'text' ? theme.colors.primaryContainer : theme.colors.surfaceVariant }}
            >
              {t('sidebar.freeText', 'טקסט חופשי')}
            </Chip>
            <Chip
              selected={bulkSendMode === 'template'}
              onPress={() => setBulkSendMode('template')}
              compact
              style={{ backgroundColor: bulkSendMode === 'template' ? theme.colors.primaryContainer : theme.colors.surfaceVariant }}
            >
              {t('sidebar.template', 'תבנית')}
            </Chip>
          </View>

          {bulkSendMode === 'text' ? (
            <PaperInput
              mode="outlined"
              multiline
              numberOfLines={4}
              value={bulkText}
              onChangeText={setBulkText}
              placeholder={t('sidebar.messageText', 'תוכן ההודעה…')}
              style={{ marginBottom: 12, maxHeight: 160 }}
            />
          ) : (
            <ScrollView style={{ maxHeight: 260, marginBottom: 12 }}>
              {loadingBulkTemplates ? (
                <ActivityIndicator style={{ marginVertical: 20 }} color={theme.colors.primary} />
              ) : bulkTemplates.length === 0 ? (
                <Text style={{ color: theme.colors.onSurfaceVariant, textAlign, paddingVertical: 12 }}>
                  {t('sidebar.noTemplates', 'אין תבניות מאושרות')}
                </Text>
              ) : (
                bulkTemplates.map((tpl) => {
                  const id = tpl.id || tpl.Id || tpl.templateId || tpl.name || tpl.Name;
                  const name = tpl.friendlyName || tpl.FriendlyName || tpl.name || tpl.Name || id;
                  const selected = bulkTemplateId === id;
                  return (
                    <Pressable
                      key={id}
                      onPress={() => setBulkTemplateId(id)}
                      style={({ pressed }) => [
                        { flexDirection, alignItems: 'center', paddingVertical: 12, paddingHorizontal: 8, gap: 10, borderRadius: 8 },
                        selected && { backgroundColor: theme.colors.primaryContainer },
                        pressed && { backgroundColor: theme.colors.surfaceVariant },
                      ]}
                    >
                      <MaterialCommunityIcons
                        name={selected ? 'radiobox-marked' : 'radiobox-blank'}
                        size={20}
                        color={selected ? theme.colors.primary : theme.colors.onSurfaceVariant}
                      />
                      <Text style={{ color: theme.colors.onSurface, flex: 1, textAlign }} numberOfLines={2}>{name}</Text>
                    </Pressable>
                  );
                })
              )}
            </ScrollView>
          )}

          {bulkSendProgress && (
            <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 12, marginBottom: 8, textAlign }}>
              {t('sidebar.sending', 'שולח')} {bulkSendProgress.done}/{bulkSendProgress.total}…
            </Text>
          )}
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}>
            <Button mode="outlined" onPress={closeBulkSend} disabled={bulkBusy}>
              {t('common.cancel')}
            </Button>
            <Button
              mode="contained"
              icon="send"
              loading={bulkBusy}
              disabled={bulkBusy || (bulkSendMode === 'text' ? !bulkText.trim() : !bulkTemplateId)}
              onPress={handleBulkSend}
            >
              {t('sidebar.send', 'שלח')}
            </Button>
          </View>
        </Modal>

        {/* Bulk: Update category */}
        <Modal
          visible={showBulkCategoryModal}
          onDismiss={() => setShowBulkCategoryModal(false)}
          contentContainerStyle={[styles.newChatModal, { backgroundColor: theme.colors.surface, maxHeight: '70%' }]}
        >
          <Text variant="titleMedium" style={{ color: theme.colors.onSurface, marginBottom: 12, fontWeight: '700', textAlign }}>
            {t('chats.category', 'קטגוריה')} ({selectedPhones.length})
          </Text>
          <ScrollView style={{ maxHeight: 360 }}>
            <Pressable
              onPress={() => handleBulkCategory('')}
              disabled={bulkBusy}
              style={({ pressed }) => [{ paddingVertical: 12, paddingHorizontal: 8, borderRadius: 8 }, pressed && { backgroundColor: theme.colors.surfaceVariant }]}
            >
              <Text variant="bodyLarge" style={{ color: theme.colors.onSurfaceVariant, textAlign }}>{isRTL ? 'ללא קטגוריה' : 'No category'}</Text>
            </Pressable>
            {bulkCategories.map((cat) => (
              <Pressable
                key={cat}
                onPress={() => handleBulkCategory(cat)}
                disabled={bulkBusy}
                style={({ pressed }) => [{ paddingVertical: 12, paddingHorizontal: 8, borderRadius: 8 }, pressed && { backgroundColor: theme.colors.surfaceVariant }]}
              >
                <Text variant="bodyLarge" style={{ color: theme.colors.onSurface, textAlign }}>{cat}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </Modal>

        {/* Per-row quick actions (swipe → "…") */}
        <Modal
          visible={!!rowActionChat && rowActionKind === 'menu'}
          onDismiss={closeRowActions}
          contentContainerStyle={[styles.newChatModal, { backgroundColor: theme.colors.surface }]}
        >
          <Text variant="titleMedium" style={{ color: theme.colors.onSurface, marginBottom: 4, fontWeight: '700', textAlign }} numberOfLines={1}>
            {rowActionChat?.contactName || rowActionChat?.phoneNumber}
          </Text>
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 12, textAlign }}>
            {rowActionChat?.phoneNumber}
          </Text>
          {[
            { icon: 'account-check-outline', label: isRTL ? 'קח בעלות' : 'Take ownership', onPress: rowTakeOwnership },
            { icon: 'account-switch-outline', label: isRTL ? 'שייך בעלים' : 'Assign owner', onPress: openRowOwner },
            { icon: 'label-outline', label: isRTL ? 'עריכת תגיות' : 'Edit tags', onPress: () => setRowActionKind('tags') },
            { icon: 'circle-outline', label: isRTL ? 'עריכת סטטוס' : 'Edit status', onPress: () => setRowActionKind('status') },
            { icon: 'tag-outline', label: isRTL ? 'עריכת קטגוריה' : 'Edit category', onPress: openRowCategory },
          ].map((a) => (
            <Pressable
              key={a.label}
              onPress={a.onPress}
              disabled={rowActionBusy}
              style={({ pressed }) => [
                { flexDirection, alignItems: 'center', paddingVertical: 12, paddingHorizontal: 8, gap: 14, borderRadius: 8 },
                pressed && { backgroundColor: theme.colors.surfaceVariant },
              ]}
            >
              <MaterialCommunityIcons name={a.icon as any} size={22} color="#2e6155" />
              <Text variant="bodyLarge" style={{ color: theme.colors.onSurface, flex: 1, textAlign }}>{a.label}</Text>
            </Pressable>
          ))}
          {rowActionBusy && <ActivityIndicator style={{ marginTop: 8 }} color={theme.colors.primary} />}
        </Modal>

        {/* Row: assign owner */}
        <Modal
          visible={!!rowActionChat && rowActionKind === 'owner'}
          onDismiss={closeRowActions}
          contentContainerStyle={[styles.newChatModal, { backgroundColor: theme.colors.surface, maxHeight: '70%' }]}
        >
          <Text variant="titleMedium" style={{ color: theme.colors.onSurface, marginBottom: 12, fontWeight: '700', textAlign }}>
            {t('sidebar.assignOwner', 'שיוך נציג')}
          </Text>
          <ScrollView style={{ maxHeight: 360 }}>
            {rowOwners.map((owner) => {
              const ownerId = owner.uID || owner.userId || owner.id || '';
              const ownerName = owner.UserName || owner.fullname || owner.displayName || owner.email || ownerId;
              return (
                <Pressable
                  key={ownerId}
                  onPress={() => rowAssignOwner(ownerId, ownerName)}
                  disabled={rowActionBusy}
                  style={({ pressed }) => [
                    { flexDirection, alignItems: 'center', paddingVertical: 12, paddingHorizontal: 8, gap: 12, borderRadius: 8 },
                    pressed && { backgroundColor: theme.colors.surfaceVariant },
                  ]}
                >
                  <Avatar.Text size={36} label={getInitials(ownerName)} style={{ backgroundColor: theme.colors.primaryContainer }} labelStyle={{ fontSize: 14, color: theme.colors.primary }} />
                  <Text variant="bodyMedium" style={{ color: theme.colors.onSurface, fontWeight: '600', flex: 1, textAlign }}>{ownerName}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </Modal>

        {/* Row: status */}
        <Modal
          visible={!!rowActionChat && rowActionKind === 'status'}
          onDismiss={closeRowActions}
          contentContainerStyle={[styles.newChatModal, { backgroundColor: theme.colors.surface }]}
        >
          <Text variant="titleMedium" style={{ color: theme.colors.onSurface, marginBottom: 12, fontWeight: '700', textAlign }}>
            {t('chats.status', 'סטטוס')}
          </Text>
          {BULK_STATUS_OPTIONS.map((status) => {
            const normalized = normalizeConversationStatus(status);
            const colors = conversationStatusColors(normalized);
            return (
              <Pressable
                key={status}
                onPress={() => rowSetStatus(status)}
                disabled={rowActionBusy}
                style={({ pressed }) => [
                  { flexDirection, alignItems: 'center', paddingVertical: 12, paddingHorizontal: 8, gap: 12, borderRadius: 8 },
                  pressed && { backgroundColor: theme.colors.surfaceVariant },
                ]}
              >
                <View style={[styles.badge, { backgroundColor: colors.bg }]}>
                  <Text style={[styles.badgeText, { color: colors.fg }]}>{conversationStatusLabel(normalized, t)}</Text>
                </View>
              </Pressable>
            );
          })}
        </Modal>

        {/* Row: category */}
        <Modal
          visible={!!rowActionChat && rowActionKind === 'category'}
          onDismiss={closeRowActions}
          contentContainerStyle={[styles.newChatModal, { backgroundColor: theme.colors.surface, maxHeight: '70%' }]}
        >
          <Text variant="titleMedium" style={{ color: theme.colors.onSurface, marginBottom: 12, fontWeight: '700', textAlign }}>
            {t('chats.category', 'קטגוריה')}
          </Text>
          <ScrollView style={{ maxHeight: 360 }}>
            <Pressable
              onPress={() => rowSetCategory('')}
              disabled={rowActionBusy}
              style={({ pressed }) => [{ paddingVertical: 12, paddingHorizontal: 8, borderRadius: 8 }, pressed && { backgroundColor: theme.colors.surfaceVariant }]}
            >
              <Text variant="bodyLarge" style={{ color: theme.colors.onSurfaceVariant, textAlign }}>{isRTL ? 'ללא קטגוריה' : 'No category'}</Text>
            </Pressable>
            {rowCategories.map((cat) => (
              <Pressable
                key={cat}
                onPress={() => rowSetCategory(cat)}
                disabled={rowActionBusy}
                style={({ pressed }) => [{ paddingVertical: 12, paddingHorizontal: 8, borderRadius: 8 }, pressed && { backgroundColor: theme.colors.surfaceVariant }]}
              >
                <Text variant="bodyLarge" style={{ color: theme.colors.onSurface, textAlign }}>{cat}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </Modal>

        {/* Row: tags */}
        <Modal
          visible={!!rowActionChat && rowActionKind === 'tags'}
          onDismiss={closeRowActions}
          contentContainerStyle={[styles.newChatModal, { backgroundColor: theme.colors.surface }]}
        >
          <Text variant="titleMedium" style={{ color: theme.colors.onSurface, marginBottom: 12, fontWeight: '700', textAlign }}>
            {isRTL ? 'עריכת תגיות' : 'Edit tags'}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
            {rowCurrentTags.length === 0 ? (
              <Text style={{ color: theme.colors.onSurfaceVariant }}>{isRTL ? 'אין תגיות' : 'No tags'}</Text>
            ) : (
              rowCurrentTags.map((tag) => (
                <Chip
                  key={tag}
                  onClose={() => rowSaveTags(rowCurrentTags.filter((x) => x !== tag))}
                  disabled={rowActionBusy}
                  compact
                >
                  {tag}
                </Chip>
              ))
            )}
          </View>
          <View style={{ flexDirection: isRTL ? 'row-reverse' : 'row', alignItems: 'center', gap: 8 }}>
            <PaperInput
              mode="outlined"
              dense
              value={rowTagInput}
              onChangeText={setRowTagInput}
              placeholder={isRTL ? 'תגית חדשה…' : 'New tag…'}
              style={{ flex: 1 }}
              onSubmitEditing={() => {
                const v = rowTagInput.trim();
                if (v && !rowCurrentTags.includes(v)) rowSaveTags([...rowCurrentTags, v]);
                setRowTagInput('');
              }}
            />
            <Button
              mode="contained"
              disabled={rowActionBusy || !rowTagInput.trim()}
              onPress={() => {
                const v = rowTagInput.trim();
                if (v && !rowCurrentTags.includes(v)) rowSaveTags([...rowCurrentTags, v]);
                setRowTagInput('');
              }}
            >
              {isRTL ? 'הוסף' : 'Add'}
            </Button>
          </View>
          <Button mode="text" onPress={closeRowActions} style={{ marginTop: 12 }}>
            {isRTL ? 'סגור' : 'Close'}
          </Button>
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
