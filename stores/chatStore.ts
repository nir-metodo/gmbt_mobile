import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Chat, Message } from '../types';
import { chatsApi } from '../services/api/chats';
import { contactsApi } from '../services/api/contacts';
import { queryPage, upsertMany } from '../services/db/repository';
import { MESSAGES_TABLE, makeMessageMapper } from '../services/db/messagesTable';

const CHATS_CACHE_KEY = 'gambot_chats_cache';
const PAGE_SIZE = 50;
// How many most-recent messages we keep on disk per chat for instant cold-open.
const DB_CACHE_LIMIT = 100;
// Hard cap on how many messages we REVEAL when (re)opening a chat, regardless of how
// far the user had scrolled up in a previous session. The full history still lives in
// `allMessages` (scroll-up reveals more), but rendering thousands of bubbles + rebuilding
// listData synchronously on open is what makes heavy chats janky/unresponsive.
const MAX_INITIAL_DISPLAYED = PAGE_SIZE * 2;
let messagesRequestSeq = 0;

// Read the last N messages of a chat straight from SQLite (oldest->newest), for an instant
// render on cold open before the network responds. Returns [] if nothing is cached yet.
async function loadMessagesFromDb(phone: string): Promise<any[]> {
  try {
    const rows = await queryPage<any>(MESSAGES_TABLE, {
      where: 'chatPhone = ?',
      params: [phone],
      orderBy: 'createdOnMs DESC',
      limit: DB_CACHE_LIMIT,
    });
    return rows.reverse();
  } catch {
    return [];
  }
}

// Persist a chat's messages to SQLite (fire-and-forget). Optimistic temp_ rows are skipped by
// the mapper so the on-disk cache only ever holds server-confirmed messages.
function persistMessages(phone: string, msgs: any[]): void {
  if (!phone || !msgs || msgs.length === 0) return;
  upsertMany(MESSAGES_TABLE, msgs, makeMessageMapper(phone)).catch(() => {});
}

interface ChatState {
  chats: Chat[];
  allMessages: Message[];
  currentMessages: Message[];
  currentPhoneNumber: string | null;
  isLoadingChats: boolean;
  isLoadingMessages: boolean;
  isLoadingOlderMessages: boolean;
  isSending: boolean;
  searchQuery: string;
  filter: string;
  unreadCount: number;
  categoryFilter: string;
  ownerFilter: string;
  displayedCount: number;
  hasMoreMessages: boolean;
  activeWabaNumber: string | null;
  // Set when a conversation is opened from a push notification (possibly before the full chat list
  // has loaded, e.g. cold start). The list screen consumes this on focus to force a full reload so
  // that pressing Back never leaves the list showing only the push-opened contact.
  pendingListReload: boolean;

  loadChats: (organization: string, userId?: string, dataVisibility?: string) => Promise<void>;
  refreshRecentChats: (organization: string, userId?: string, dataVisibility?: string) => Promise<void>;
  setChats: (chats: Chat[]) => void;
  addOrUpdateChat: (chat: Chat) => void;
  setSearchQuery: (query: string) => void;
  setFilter: (filter: string) => void;
  setCategoryFilter: (category: string) => void;
  setOwnerFilter: (owner: string) => void;

  loadMessages: (organization: string, phoneNumber: string) => Promise<void>;
  loadOlderMessages: () => void;
  sendMessage: (organization: string, to: string, message: string, senderName?: string, userId?: string, replyToMessageId?: string, wabaNumber?: string, senderEmail?: string, fromNumberId?: string) => Promise<void>;
  addOptimisticMedia: (params: { localUri: string; mediaType: string; fileName?: string; caption?: string }) => string;
  sendInternalMessage: (organization: string, phoneNumber: string, message: string, senderName: string, sentById?: string, mentionedUsers?: { userId: string; userName: string }[]) => Promise<void>;
  markAsRead: (organization: string, phoneNumber: string, userId?: string, userName?: string) => Promise<void>;
  markAsUnread: (organization: string, phoneNumber: string) => Promise<void>;
  toggleStarred: (organization: string, messageId: string, phoneNumber: string, isStarred: boolean) => Promise<void>;
  addMessage: (message: Message) => void;
  updateMessage: (messageId: string, updates: Partial<Message>) => void;
  updateMessageStatus: (messageId: string, status: Message['status']) => void;
  clearCurrentChat: () => void;
  updateUnreadCount: (count: number) => void;
  setActiveWabaNumber: (number: string | null) => void;
  requestListReload: () => void;
  clearListReload: () => void;
}

// Milliseconds of a chat's last activity, used to keep the list sorted newest-first.
// Guards against empty/invalid timestamps: `new Date('').getTime()` / `new Date('garbage')`
// return NaN, and every comparison with NaN is false — which made the binary-search insert
// below drift rows to the top and progressively scramble the order (the "list re-sorts wrong
// after entering a chat and coming back" / "opens on a stale top" bugs).
function chatTimeMs(chat: Chat): number {
  const t = new Date((chat && chat.lastMessageTime) || 0).getTime();
  return Number.isFinite(t) ? t : 0;
}

function sortChatsDesc(list: Chat[]): Chat[] {
  return [...list].sort((a, b) => chatTimeMs(b) - chatTimeMs(a));
}

const messageIdSet = new Set<string>();

// Guards against the SAME outbound message being POSTed twice (which creates two real rows in
// the DB). Double-fires happen on mobile from rapid taps across the async gap, re-renders, or
// gesture/press races — the web client doesn't hit this. We key by recipient+text and block an
// identical send that arrives within a short window of the previous one. The window is small
// enough that a human re-typing the same word is never blocked (that takes far longer than this),
// but tight enough to absorb accidental double dispatches.
const recentSendSignatures = new Map<string, number>();
const DUPLICATE_SEND_WINDOW_MS = 1500;
function isDuplicateSend(to: string, text: string): boolean {
  const sig = `${(to || '').replace(/\D/g, '')}|${(text || '').trim()}`;
  const now = Date.now();
  // Opportunistic cleanup so the map can't grow unbounded.
  for (const [k, t] of recentSendSignatures) {
    if (now - t > DUPLICATE_SEND_WINDOW_MS) recentSendSignatures.delete(k);
  }
  const last = recentSendSignatures.get(sig);
  if (last !== undefined && now - last < DUPLICATE_SEND_WINDOW_MS) return true;
  recentSendSignatures.set(sig, now);
  return false;
}

// How many messages we last requested from the server, and whether the server returned a
// full page (meaning older history likely exists). Used for real server-side pagination:
// when the user scrolls past everything we've fetched, we grow the limit and re-fetch.
// Kept deliberately small (100) so opening a heavy chat is fast and shows the last page
// instantly — scrolling up reveals the next 50 locally, then fetches more from the server.
let currentServerLimit = PAGE_SIZE * 2;
let serverMayHaveMore = false;
let currentOrg = '';

// In-memory per-chat message cache (LRU). Re-opening a recently visited chat renders its
// messages instantly from here while a fresh copy is fetched in the background — this is
// what makes chat → list → chat navigation feel instant instead of showing a spinner and
// waiting on the network every time.
type MessageCacheEntry = {
  allMessages: any[];
  displayedCount: number;
  hasMoreMessages: boolean;
  serverLimit: number;
  serverMayHaveMore: boolean;
};
const messageCache = new Map<string, MessageCacheEntry>();
const MESSAGE_CACHE_MAX = 25;

function setMessageCache(phone: string, entry: MessageCacheEntry): void {
  if (!phone) return;
  if (messageCache.has(phone)) messageCache.delete(phone); // refresh LRU recency
  messageCache.set(phone, entry);
  while (messageCache.size > MESSAGE_CACHE_MAX) {
    const oldest = messageCache.keys().next().value;
    if (oldest === undefined) break;
    messageCache.delete(oldest);
  }
}

// Normalize, dedupe (by id + content signature), sort oldest→newest, and resolve quoted
// messages. Shared by the initial load and the "load older" deeper fetch.
function normalizeAndDedupeMessages(raw: any): any[] {
  const normalizeTs = (val: any): string => {
    if (!val) return '';
    if (typeof val === 'string') return val;
    if (typeof val === 'number') return new Date(val > 1e12 ? val : val * 1000).toISOString();
    if (typeof val === 'object' && val._seconds) return new Date(val._seconds * 1000).toISOString();
    if (typeof val === 'object' && val.seconds) return new Date(val.seconds * 1000).toISOString();
    return '';
  };
  const messages = (Array.isArray(raw) ? raw : []).map((m: any) => ({
    ...m,
    timestamp: normalizeTs(m.timestamp || m.createdOn),
    createdOn: normalizeTs(m.createdOn || m.timestamp),
    text: m.text || m.body || '',
    messageId: m.messageId || m.id || m.Id || '',
    direction: m.direction || (m.sentFromApp ? 'Outbound' : ''),
  }));

  const seenIds = new Set<string>();
  const seenSigs = new Set<string>();
  const deduped: typeof messages = [];
  for (const m of messages) {
    const id = m.messageId;
    if (id && seenIds.has(id)) continue;
    const ts = new Date(m.createdOn || m.timestamp || '').getTime();
    const sig = `${(m.text || '').slice(0, 50)}|${m.direction || ''}|${Math.floor(ts / 2000)}`;
    if (m.text && sig && seenSigs.has(sig)) continue;
    if (id) seenIds.add(id);
    if (m.text) seenSigs.add(sig);
    deduped.push(m);
  }

  const parseTs = (r: any): number => {
    if (!r) return 0;
    if (typeof r === 'number') return r > 1e12 ? r : r * 1000;
    if (typeof r === 'object' && r._seconds) return r._seconds * 1000;
    if (typeof r === 'object' && r.seconds) return r.seconds * 1000;
    const d = new Date(r);
    return isNaN(d.getTime()) ? 0 : d.getTime();
  };
  deduped.sort((a: any, b: any) => parseTs(a.createdOn || a.timestamp) - parseTs(b.createdOn || b.timestamp));

  const msgMap = new Map(deduped.map((m: any) => [m.messageId, m]));
  for (const msg of deduped) {
    if (!msg.quotedMessage) {
      const ctxId = msg.contextMessageId || msg.ContextMessageId;
      if (ctxId && msgMap.has(ctxId)) msg.quotedMessage = msgMap.get(ctxId);
    }
  }
  return deduped;
}

export const useChatStore = create<ChatState>((set, get) => ({
  chats: [],
  allMessages: [],
  currentMessages: [],
  currentPhoneNumber: null,
  isLoadingChats: false,
  isLoadingMessages: false,
  isLoadingOlderMessages: false,
  isSending: false,
  searchQuery: '',
  filter: 'all',
  unreadCount: 0,
  categoryFilter: 'all',
  ownerFilter: 'all',
  displayedCount: PAGE_SIZE,
  hasMoreMessages: false,
  activeWabaNumber: null,
  pendingListReload: false,

  loadChats: async (organization, userId?, dataVisibility?) => {
    const { chats: existingChats } = get();
    const isFirstLoad = existingChats.length === 0;

    if (isFirstLoad) {
      set({ isLoadingChats: true });
      try {
        const cached = await AsyncStorage.getItem(`${CHATS_CACHE_KEY}_${organization}`);
        if (cached) {
          const parsed = JSON.parse(cached) as Chat[];
          if (parsed.length > 0) {
            // Sort defensively so a cold start always opens on the freshest conversations,
            // even if an older cache was written before the ordering fix.
            const sorted = sortChatsDesc(parsed);
            const totalUnread = sorted.filter((c) => c.isRead === false).length;
            set({ chats: sorted, isLoadingChats: false, unreadCount: totalUnread });
          }
        }
      } catch {}
    }

    try {
      // Load the full contact set (mirrors web's chat page, which pages by 9999) so the chat
      // list and search cover every conversation, not just the first 100. FlashList only
      // renders what's visible, so holding the array in memory is cheap.
      const contacts = await contactsApi.getAll(organization, { userId, dataVisibility, pageSize: 9999 });
      const chatList: Chat[] = (contacts || [])
        .filter((c: any) => c.phoneNumber || c.PhoneNumber)
        .map((c: any) => ({
          id: c.id || c.Id || c.phoneNumber || c.PhoneNumber,
          phoneNumber: c.phoneNumber || c.PhoneNumber || '',
          contactName: c.name || c.Name || c.phoneNumber || c.PhoneNumber || '',
          lastMessage: c.lastMessage || c.LastMessage || '',
          lastMessageTime: c.lastMessageTime || c.LastMessageTime || c.time || c.modifiedOn || '',
          unreadCount: c.isRead === false ? 1 : 0,
          isRead: c.isRead,
          profilePicture: c.photoURL || c.ProfilePicture || null,
          isOnline: false,
          category: c.lastConversationCategory || c.category || '',
          status: c.lastConversationStatus || c.conversationStatus || 'Open',
          lastConversationStatus: c.lastConversationStatus || c.conversationStatus || 'Open',
          lastConversationCategory: c.lastConversationCategory || '',
          lastMessageDirection: c.lastMessageDirection || '',
          ownerId: c.ownerId || '',
          ownerName: c.ownerName || '',
          keys: c.keys,
          tags: Array.isArray(c.keys) ? c.keys : [],
          leadStageName: c.leadStageName || c.leadStage?.stageName || '',
          leadStageColor: c.leadStageColor || c.leadStage?.stageColor || c.leadStage?.color || '',
          caseStageName: c.caseStageName || c.caseStage?.stageName || '',
          caseStageColor: c.caseStageColor || c.caseStage?.stageColor || c.caseStage?.color || '',
          isCTWA: !!(c.ctwaClid || c.adSourceId),
          lastFromNumberId: c.lastFromNumberId || c.wabaPhoneNumberId || '',
          wabaPhoneNumberId: c.wabaPhoneNumberId || c.lastFromNumberId || '',
          humanReviewed: c.humanReviewed,
          usersWithUnreadInternalMessages: c.usersWithUnreadInternalMessages || [],
        }));
      chatList.sort((a, b) => chatTimeMs(b) - chatTimeMs(a));
      const totalUnread = chatList.filter((c) => c.isRead === false).length;
      set({ chats: chatList, isLoadingChats: false, unreadCount: totalUnread });
      AsyncStorage.setItem(`${CHATS_CACHE_KEY}_${organization}`, JSON.stringify(chatList.slice(0, 100))).catch(() => {});
    } catch {
      set({ isLoadingChats: false });
    }
  },

  // Cheap incremental refresh used by the polling fallback + app-foreground handler.
  // Instead of re-reading the ENTIRE contacts collection (pageSize 9999) every 60s — which was
  // the single biggest Firestore read amplifier in the whole product — we fetch only the most
  // recently active contacts and merge them into the existing list. Messages missed by the
  // WebSocket are by definition recent, so a small top-N-by-lastMessage window covers them.
  // The full list from the initial loadChats() stays intact (upsert never removes rows).
  refreshRecentChats: async (organization, userId?, dataVisibility?) => {
    try {
      const contacts = await contactsApi.getAll(organization, {
        userId,
        dataVisibility,
        pageSize: 150,
      });
      const { addOrUpdateChat } = get();
      (contacts || [])
        .filter((c: any) => c.phoneNumber || c.PhoneNumber)
        .forEach((c: any) => {
          addOrUpdateChat({
            id: c.id || c.Id || c.phoneNumber || c.PhoneNumber,
            phoneNumber: c.phoneNumber || c.PhoneNumber || '',
            contactName: c.name || c.Name || c.phoneNumber || c.PhoneNumber || '',
            lastMessage: c.lastMessage || c.LastMessage || '',
            lastMessageTime: c.lastMessageTime || c.LastMessageTime || c.time || c.modifiedOn || '',
            unreadCount: c.isRead === false ? 1 : 0,
            isRead: c.isRead,
            profilePicture: c.photoURL || c.ProfilePicture || null,
            isOnline: false,
            category: c.lastConversationCategory || c.category || '',
            status: c.lastConversationStatus || c.conversationStatus || 'Open',
            lastConversationStatus: c.lastConversationStatus || c.conversationStatus || 'Open',
            lastConversationCategory: c.lastConversationCategory || '',
            lastMessageDirection: c.lastMessageDirection || '',
            ownerId: c.ownerId || '',
            ownerName: c.ownerName || '',
            keys: c.keys,
            tags: Array.isArray(c.keys) ? c.keys : [],
            leadStageName: c.leadStageName || c.leadStage?.stageName || '',
            leadStageColor: c.leadStageColor || c.leadStage?.stageColor || c.leadStage?.color || '',
            caseStageName: c.caseStageName || c.caseStage?.stageName || '',
            caseStageColor: c.caseStageColor || c.caseStage?.stageColor || c.caseStage?.color || '',
            isCTWA: !!(c.ctwaClid || c.adSourceId),
            lastFromNumberId: c.lastFromNumberId || c.wabaPhoneNumberId || '',
            wabaPhoneNumberId: c.wabaPhoneNumberId || c.lastFromNumberId || '',
            humanReviewed: c.humanReviewed,
            usersWithUnreadInternalMessages: c.usersWithUnreadInternalMessages || [],
          } as Chat);
        });
    } catch {
      // Non-fatal: WebSocket remains the primary realtime path.
    }
  },

  setChats: (chats) => {
    // Always keep newest-first. A WebSocket `chat_list`/`chats` payload arrives in server
    // order, and setting it as-is broke the sorted invariant that addOrUpdateChat's
    // binary-search insert relies on — which then scrambled the list on the next update.
    const sorted = sortChatsDesc(chats);
    const totalUnread = sorted.reduce((acc, c) => acc + (c.unreadCount || 0), 0);
    set({ chats: sorted, unreadCount: totalUnread });
  },

  addOrUpdateChat: (chat) => {
    set((state) => {
      // Normalize phone numbers before comparing to handle format differences (0505... vs 972505...)
      const phoneNorm = (chat.phoneNumber || '').replace(/\D/g, '');
      const index = state.chats.findIndex((c) => (c.phoneNumber || '').replace(/\D/g, '') === phoneNorm);
      let updatedChat: Chat;
      let newChats: Chat[];

      if (index >= 0) {
        updatedChat = { ...state.chats[index], ...chat };
        newChats = state.chats.filter((_, i) => i !== index);
      } else {
        updatedChat = chat;
        newChats = [...state.chats];
      }

      // Insert at correct position (sorted by lastMessageTime desc) using binary search.
      // Uses NaN-safe timestamps so an empty/invalid lastMessageTime can't drift rows to the top.
      const chatTime = chatTimeMs(updatedChat);
      let lo = 0, hi = newChats.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (chatTimeMs(newChats[mid]) >= chatTime) lo = mid + 1;
        else hi = mid;
      }
      newChats.splice(lo, 0, updatedChat);

      const totalUnread = newChats.reduce((acc, c) => acc + (c.unreadCount || 0), 0);
      return { chats: newChats, unreadCount: totalUnread };
    });
  },

  setSearchQuery: (query) => set({ searchQuery: query }),
  setFilter: (filter) => set({ filter }),
  setCategoryFilter: (category) => set({ categoryFilter: category }),
  setOwnerFilter: (owner) => set({ ownerFilter: owner }),

  loadMessages: async (organization, phoneNumber) => {
    const requestId = ++messagesRequestSeq;
    const switchingChat = get().currentPhoneNumber !== phoneNumber;
    const cached = switchingChat ? messageCache.get(phoneNumber) : null;
    currentOrg = organization;

    if (switchingChat && cached) {
      // Instant render from cache — no spinner, no empty flash. We still refresh below.
      messageIdSet.clear();
      cached.allMessages.forEach((m: any) => { if (m.messageId) messageIdSet.add(m.messageId); });
      currentServerLimit = cached.serverLimit;
      serverMayHaveMore = cached.serverMayHaveMore;
      // Reopen always starts at the newest messages, so only reveal the last page-ish even if
      // the user had previously scrolled up to the full history. Keeps the open fast on heavy chats.
      const initialDisplayed = Math.min(cached.displayedCount || PAGE_SIZE, MAX_INITIAL_DISPLAYED);
      set({
        currentPhoneNumber: phoneNumber,
        allMessages: cached.allMessages,
        currentMessages: cached.allMessages.slice(-initialDisplayed),
        displayedCount: initialDisplayed,
        hasMoreMessages: cached.hasMoreMessages || cached.allMessages.length > initialDisplayed,
        isLoadingMessages: false,
      });
    } else {
      set({
        isLoadingMessages: switchingChat || get().currentMessages.length === 0,
        currentPhoneNumber: phoneNumber,
        displayedCount: PAGE_SIZE,
        ...(switchingChat ? {
          currentMessages: [],
          allMessages: [],
          hasMoreMessages: false,
        } : {}),
      });
      currentServerLimit = PAGE_SIZE * 2;

      // Cold open with no in-memory cache (e.g. first open after an app restart): render the
      // last messages straight from SQLite so the chat appears instantly instead of showing a
      // spinner while we wait on the network. The server fetch below then merges in-place.
      if (switchingChat) {
        const diskMsgs = await loadMessagesFromDb(phoneNumber);
        if (
          diskMsgs.length > 0 &&
          requestId === messagesRequestSeq &&
          get().currentPhoneNumber === phoneNumber &&
          get().allMessages.length === 0
        ) {
          messageIdSet.clear();
          diskMsgs.forEach((m: any) => { if (m.messageId) messageIdSet.add(m.messageId); });
          const displayed = diskMsgs.slice(-PAGE_SIZE);
          set({
            allMessages: diskMsgs,
            currentMessages: displayed,
            displayedCount: Math.min(PAGE_SIZE, diskMsgs.length) || PAGE_SIZE,
            hasMoreMessages: true,
            isLoadingMessages: false,
          });
        }
      }
    }

    try {
      const limit = currentServerLimit;
      const raw = await chatsApi.getMessages(organization, phoneNumber, limit);
      const rawCount = Array.isArray(raw) ? raw.length : 0;
      // Server returned a full page → older history likely exists beyond what we fetched.
      serverMayHaveMore = rawCount >= limit;

      const deduped = normalizeAndDedupeMessages(raw);

      if (requestId !== messagesRequestSeq) return;
      if (get().currentPhoneNumber !== phoneNumber) return;

      // In-place merge: reuse the object reference of every message we already hold whose
      // visible fields are unchanged, so FlashList does NOT re-diff/remeasure unchanged rows
      // on refresh (foreground reload, cache->API). Replacing the whole array with brand-new
      // objects was the main cause of the "flicker / jump to old messages and back" churn.
      const existingForMerge = get().allMessages;
      const mergeById = new Map(existingForMerge.map((m: any) => [m.messageId, m]));
      const merged = deduped.map((m: any) => {
        const prev = mergeById.get(m.messageId);
        if (!prev) return m;
        const sameStatus = (prev.status || '') === (m.status || '');
        const sameText = (prev.text || '') === (m.text || '');
        const sameReactions =
          JSON.stringify(prev.reactions || null) === JSON.stringify(m.reactions || null);
        if (sameStatus && sameText && sameReactions) return prev;
        return { ...prev, ...m };
      });
      // Carry over optimistic/local messages (temp_*) the server doesn't know about yet,
      // so a refresh mid-send doesn't make the pending bubble disappear. BUT drop any temp whose
      // real server twin is already present in this fetch — otherwise a refresh that lands after
      // the message persisted (but before the WS echo replaced the temp) leaves BOTH the temp and
      // the real message on screen, and the later WS echo can't fix it (its id is already known).
      const serverIds = new Set(deduped.map((m: any) => m.messageId));
      const hasServerTwin = (temp: any) => {
        const tText = (temp.text || temp.body || '').trim();
        const tMedia = temp.gmbt_mediaUrl || temp.mediaUrl || temp.MediaUrl || '';
        const tDir = (temp.direction || '').toLowerCase();
        const tTs = new Date(temp.createdOn || temp.timestamp || '').getTime() || 0;
        return deduped.some((s: any) => {
          if (s.messageId?.startsWith('temp_')) return false;
          const sDir = (s.direction || '').toLowerCase();
          if (tDir && sDir && tDir !== sDir) return false;
          const sTs = new Date(s.createdOn || s.timestamp || '').getTime() || 0;
          if (tTs && sTs && Math.abs(sTs - tTs) > 120000) return false;
          const sText = (s.text || s.body || '').trim();
          if (tText) return sText === tText;
          // No text → reconcile media temps by type proximity (local optimistic uri can't equal
          // the server url), otherwise keep the temp.
          if (tMedia) {
            const tType = String(temp.type || temp.messageType || '').toLowerCase();
            const sType = String(s.type || s.messageType || '').toLowerCase();
            return !!sTs && (!tType || !sType || tType === sType);
          }
          return false;
        });
      };
      const pendingExtras = existingForMerge.filter(
        (m: any) => m.messageId?.startsWith('temp_') && !serverIds.has(m.messageId) && !hasServerTwin(m),
      );
      if (pendingExtras.length > 0) merged.push(...pendingExtras);

      // Preserve how many messages are currently revealed (e.g. user scrolled up) when
      // refreshing a cached chat; otherwise start at one page.
      const desiredCount = Math.max(PAGE_SIZE, get().displayedCount || PAGE_SIZE);
      const displayed = merged.slice(-desiredCount);
      const newDisplayedCount = Math.min(desiredCount, merged.length) || PAGE_SIZE;
      const newHasMore = merged.length > desiredCount || serverMayHaveMore;
      messageIdSet.clear();
      merged.forEach((m: any) => { if (m.messageId) messageIdSet.add(m.messageId); });

      // Anti-flicker: when the refresh (cache -> API, AppState foreground, etc.) yields the
      // exact same visible messages (same ids + statuses in the same order), keep the previous
      // object references so FlashList does NOT re-diff/remeasure the whole list. This is the
      // main cause of the "flicker / jump to old messages and back" on chats with many messages.
      const prevVisible = get().currentMessages;
      const sameVisibleList =
        prevVisible.length === displayed.length &&
        prevVisible.every((m: any, i: number) =>
          m.messageId === displayed[i].messageId &&
          (m.status || '') === (displayed[i].status || '') &&
          (m.text || '') === (displayed[i].text || '')
        );

      set({
        allMessages: merged,
        currentMessages: sameVisibleList ? prevVisible : displayed,
        displayedCount: newDisplayedCount,
        hasMoreMessages: newHasMore,
        isLoadingMessages: false,
      });
      setMessageCache(phoneNumber, {
        allMessages: merged,
        displayedCount: newDisplayedCount,
        hasMoreMessages: newHasMore,
        serverLimit: limit,
        serverMayHaveMore,
      });
      persistMessages(phoneNumber, merged);
    } catch {
      if (requestId !== messagesRequestSeq) return;
      if (get().currentPhoneNumber !== phoneNumber) return;
      // On failure keep whatever we already showed (cache); just stop the spinner.
      set({ isLoadingMessages: false });
    }
  },

  loadOlderMessages: async () => {
    const { allMessages, displayedCount, hasMoreMessages, currentPhoneNumber, isLoadingOlderMessages } = get();
    if (!hasMoreMessages || isLoadingOlderMessages) return;

    const newCount = displayedCount + PAGE_SIZE;

    // Case 1: we still have locally-cached messages to reveal — just show more.
    if (newCount <= allMessages.length) {
      const displayed = allMessages.slice(-newCount);
      set({
        currentMessages: displayed,
        displayedCount: newCount,
        hasMoreMessages: allMessages.length > newCount || serverMayHaveMore,
        isLoadingOlderMessages: false,
      });
      return;
    }

    // Case 2: local cache exhausted but the server has more → fetch the FULL history once.
    if (serverMayHaveMore && currentPhoneNumber && currentOrg) {
      const org = currentOrg;
      set({ isLoadingOlderMessages: true });
      const phoneAtRequest = currentPhoneNumber;
      try {
        // Re-fetching an ever-growing window on every scroll-up replaced every message object
        // on every page. FlashList v2's maintainVisibleContentPosition then loses its anchor and
        // the list visibly JUMPS. Instead we fetch all remaining history a single time (no limit),
        // merge it while PRESERVING the identity of messages we already hold, and reveal it
        // locally page-by-page via Case 1 — which is a pure prepend that MVCP handles smoothly.
        const raw = await chatsApi.getMessages(org, phoneAtRequest);
        if (get().currentPhoneNumber !== phoneAtRequest) return;
        const dedupedAll = normalizeAndDedupeMessages(raw);

        // Reuse existing object refs for messages we already rendered so their rows don't
        // re-diff/remeasure; only the older rows are new objects, prepended at the front.
        const existing = get().allMessages;
        const byId = new Map(existing.map((m: any) => [m.messageId, m]));
        const merged = dedupedAll.map((m: any) => byId.get(m.messageId) || m);
        // Carry over optimistic/local messages (temp_*) that the server doesn't know about yet.
        const allIds = new Set(dedupedAll.map((m: any) => m.messageId));
        const extras = existing.filter((m: any) => !allIds.has(m.messageId));
        if (extras.length > 0) merged.push(...extras);

        merged.forEach((m: any) => { if (m.messageId) messageIdSet.add(m.messageId); });
        serverMayHaveMore = false;
        currentServerLimit = merged.length;
        const revealed = Math.min(newCount, merged.length);
        const newHasMore = merged.length > revealed;
        set({
          allMessages: merged,
          currentMessages: merged.slice(-revealed),
          displayedCount: revealed,
          hasMoreMessages: newHasMore,
          isLoadingOlderMessages: false,
        });
        setMessageCache(phoneAtRequest, {
          allMessages: merged,
          displayedCount: revealed,
          hasMoreMessages: newHasMore,
          serverLimit: currentServerLimit,
          serverMayHaveMore: false,
        });
        persistMessages(phoneAtRequest, merged);
      } catch {
        set({ isLoadingOlderMessages: false });
      }
      return;
    }

    // Case 3: nothing more to load anywhere.
    set({
      currentMessages: allMessages,
      displayedCount: allMessages.length,
      hasMoreMessages: false,
      isLoadingOlderMessages: false,
    });
  },

  sendMessage: async (organization, to, message, senderName, userId, replyToMessageId?, wabaNumber?, senderEmail?, fromNumberId?) => {
    // Absorb accidental double dispatches so the same text never creates two DB rows.
    if (isDuplicateSend(to, message)) {
      return;
    }
    set({ isSending: true });
    const tempId = `temp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const fromNumber = wabaNumber || get().activeWabaNumber || '';
    // Resolve the replied-to message so the optimistic bubble renders the reply quote
    // immediately (mirrors web). Without this the just-sent bubble looks like a regular
    // message until the WS echo / refetch lands and re-attaches the quote.
    const quotedMessage = replyToMessageId
      ? get().allMessages.find((m) => m.messageId === replyToMessageId)
      : undefined;
    const optimisticMsg: Message = {
      messageId: tempId,
      text: message,
      body: message,
      direction: 'Outbound',
      timestamp: new Date().toISOString(),
      createdOn: new Date().toISOString(),
      status: 'pending',
      sentByName: senderName || '',
      sentFromApp: true,
      type: 'text',
      from: fromNumber,
      to,
      contextMessageId: replyToMessageId,
      ContextMessageId: replyToMessageId,
      quotedMessage,
    } as Message;
    set((state) => ({
      currentMessages: [...state.currentMessages, optimisticMsg],
      allMessages: [...state.allMessages, optimisticMsg],
    }));
    try {
      console.log('[sendMessage] Sending:', { organization, to, message: message.substring(0, 50), from: fromNumber, fromNumberId, senderName, userId, senderEmail });
      await chatsApi.sendMessage(organization, to, message, senderName, userId, replyToMessageId, fromNumber, senderEmail, fromNumberId);
      set((state) => ({
        currentMessages: state.currentMessages.map((m) =>
          m.messageId === tempId ? { ...m, status: 'sent' as const } : m
        ),
        allMessages: state.allMessages.map((m) =>
          m.messageId === tempId ? { ...m, status: 'sent' as const } : m
        ),
      }));
      // Optimistically reflect the sent message in the chats list so it shows immediately when the
      // user navigates back — without waiting for the WS echo / 60s polling. Preserves the existing
      // contact name (falls back to the phone number for a brand-new conversation).
      const toNorm = (to || '').replace(/\D/g, '');
      const existingChat = get().chats.find((c) => (c.phoneNumber || '').replace(/\D/g, '') === toNorm);
      get().addOrUpdateChat({
        ...(existingChat || {}),
        phoneNumber: to,
        contactName: existingChat?.contactName || to,
        lastMessage: message,
        lastMessageTime: new Date().toISOString(),
        lastMessageDirection: 'Outbound',
        isRead: true,
        unreadCount: 0,
      } as Chat);
    } catch (err) {
      console.error('[sendMessage] Failed:', err);
      set((state) => ({
        currentMessages: state.currentMessages.map((m) =>
          m.messageId === tempId ? { ...m, status: 'failed' as const } : m
        ),
        allMessages: state.allMessages.map((m) =>
          m.messageId === tempId ? { ...m, status: 'failed' as const } : m
        ),
      }));
      throw err;
    } finally {
      set({ isSending: false });
    }
  },

  sendInternalMessage: async (organization, phoneNumber, message, senderName, sentById?, mentionedUsers?) => {
    set({ isSending: true });
    const tempId = `temp_internal_${Date.now()}`;
    const optimisticMsg: Message = {
      messageId: tempId,
      text: message,
      body: message,
      direction: 'Outbound',
      timestamp: new Date().toISOString(),
      createdOn: new Date().toISOString(),
      status: 'sent',
      sentByName: senderName || '',
      sentFromApp: true,
      type: 'internal',
      isInternal: true,
    } as Message;
    set((state) => ({
      currentMessages: [...state.currentMessages, optimisticMsg],
      allMessages: [...state.allMessages, optimisticMsg],
      isSending: true,
    }));
    try {
      const result = await chatsApi.sendInternalMessage(organization, phoneNumber, message, senderName, sentById, mentionedUsers);
      const realId = result?.messageId || result?.id || result?.Id;
      if (realId) {
        messageIdSet.add(realId);
        set((state) => ({
          currentMessages: state.currentMessages.map((m) =>
            m.messageId === tempId ? { ...m, messageId: realId } : m
          ),
          allMessages: state.allMessages.map((m) =>
            m.messageId === tempId ? { ...m, messageId: realId } : m
          ),
        }));
      }
    } catch (err) {
      set((state) => ({
        currentMessages: state.currentMessages.filter((m) => m.messageId !== tempId),
        allMessages: state.allMessages.filter((m) => m.messageId !== tempId),
      }));
      throw err;
    } finally {
      set({ isSending: false });
    }
  },

  // Optimistically show a media/voice message the instant the user sends it (mirrors web),
  // so the bubble doesn't pop in only after the WS echo / refetch. Returns the temp id so the
  // caller can mark it failed on error. The local file:// uri is matched against the server
  // echo in addMessage (which can't compare URLs, so it matches a recent local-uri temp).
  addOptimisticMedia: ({ localUri, mediaType, fileName, caption }) => {
    const tempId = `temp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const now = new Date().toISOString();
    const optimisticMsg: any = {
      messageId: tempId,
      text: caption || '',
      body: caption || '',
      caption: caption || '',
      direction: 'Outbound',
      timestamp: now,
      createdOn: now,
      status: 'pending',
      sentFromApp: true,
      type: mediaType,
      messageType: mediaType,
      mediaUrl: localUri,
      gmbt_mediaUrl: localUri,
      fileName: fileName || '',
    };
    set((state) => ({
      currentMessages: [...state.currentMessages, optimisticMsg],
      allMessages: [...state.allMessages, optimisticMsg],
    }));
    return tempId;
  },

  markAsRead: async (organization, phoneNumber, userId, userName) => {
    // Normalize digits so 050… vs 972… formats still match the list row (otherwise the
    // unread badge wasn't clearing when returning from a chat opened via a different format).
    const target = (phoneNumber || '').replace(/\D/g, '');
    const matches = (p?: string) => {
      const n = (p || '').replace(/\D/g, '');
      if (!n || !target) return false;
      const core = (x: string) => (x.startsWith('972') ? x.slice(3) : x.replace(/^0/, ''));
      return n === target || core(n) === core(target);
    };
    set((state) => {
      const chats = state.chats.map((c) =>
        matches(c.phoneNumber)
          ? {
              ...c,
              unreadCount: 0,
              isRead: true,
              // Opening a chat loads its messages via GetMessagesByPhoneNumber, which clears this
              // user from usersWithUnreadInternalMessages server-side. Strip it locally too so the
              // internal-mention badge disappears immediately.
              usersWithUnreadInternalMessages: userId
                ? (c.usersWithUnreadInternalMessages || []).filter((u) => u !== userId)
                : c.usersWithUnreadInternalMessages,
            }
          : c
      );
      return { chats, unreadCount: chats.filter((c) => c.isRead === false).length };
    });
    try {
      await chatsApi.markAsRead(organization, phoneNumber, userId, userName);
    } catch {}
  },

  // Inverse of markAsRead: flip a conversation back to unread so it resurfaces in
  // the unread filter and tab badge. Optimistic; recomputes the unread badge from
  // the updated list so the tab count stays accurate.
  markAsUnread: async (organization, phoneNumber) => {
    let prevChats: Chat[] = [];
    set((state) => {
      prevChats = state.chats;
      const chats = state.chats.map((c) =>
        c.phoneNumber === phoneNumber ? { ...c, unreadCount: c.unreadCount > 0 ? c.unreadCount : 1, isRead: false } : c
      );
      return { chats, unreadCount: chats.filter((c) => c.isRead === false).length };
    });
    try {
      await chatsApi.markAsUnread(organization, phoneNumber);
    } catch {
      // Revert on failure.
      set({ chats: prevChats, unreadCount: prevChats.filter((c) => c.isRead === false).length });
    }
  },

  toggleStarred: async (organization, messageId, phoneNumber, isStarred) => {
    try {
      await chatsApi.toggleStarred(organization, messageId, phoneNumber, isStarred);
      set((state) => ({
        currentMessages: state.currentMessages.map((m) =>
          m.messageId === messageId ? { ...m, isStarred } : m
        ),
        allMessages: state.allMessages.map((m) =>
          m.messageId === messageId ? { ...m, isStarred } : m
        ),
      }));
    } catch {}
  },

  addMessage: (message) => {
    if (!message.messageId) return;
    if (messageIdSet.has(message.messageId)) return;
    const { currentMessages, allMessages, currentPhoneNumber } = get();
    if (!currentPhoneNumber) return;
    const normalizePhone = (p: string) => p.replace(/\D/g, '');
    const samePhone = (a: string, b: string) => {
      const na = normalizePhone(a);
      const nb = normalizePhone(b);
      if (!na || !nb) return false;
      if (na === nb) return true;
      const core = (n: string) => (n.startsWith('972') ? n.slice(3) : n.replace(/^0/, ''));
      return core(na) === core(nb);
    };
    const relatedPhones = [(message as any).phoneNumber, message.from, message.to].filter(Boolean) as string[];
    if (relatedPhones.length > 0 && !relatedPhones.some((p) => samePhone(p, currentPhoneNumber))) return;
    if (allMessages.some((m) => m.messageId === message.messageId)) return;
    if (currentMessages.some((m) => m.messageId === message.messageId)) return;

    // Content-based duplicate check: same text + direction within 2s window. Skip optimistic
    // temp_ rows here — those are reconciled by the temp-replacement step below. If we treated a
    // matching temp as a "duplicate" and dropped the echo, the temp would linger with its temp id
    // (never picking up the real messageId/status), and any direction-casing mismatch downstream
    // could then surface BOTH the temp and a later refetch of the real message as two bubbles.
    const msgText = message.text || (message as any).body || '';
    if (msgText) {
      const msgTs = new Date(message.createdOn || message.timestamp || '').getTime();
      const isDuplicate = currentMessages.some((m) => {
        if (m.messageId?.startsWith('temp_')) return false;
        if ((m.direction || '').toLowerCase() !== (message.direction || '').toLowerCase()) return false;
        const mText = m.text || (m as any).body || '';
        if (mText !== msgText) return false;
        const mTs = new Date(m.createdOn || m.timestamp || '').getTime();
        return Math.abs(mTs - msgTs) < 2000;
      });
      if (isDuplicate) return;
    }

    if (!message.quotedMessage) {
      const ctxId = message.contextMessageId || (message as any).ContextMessageId;
      if (ctxId) {
        const quoted = allMessages.find((m) => m.messageId === ctxId);
        if (quoted) {
          message = { ...message, quotedMessage: quoted };
        }
      }
    }

    // Replace optimistic temp message if this is the server-confirmed version.
    // We already gated to the current chat above, so we match the pending temp by content +
    // outbound (NOT by an exact `to` string — phone formats from the WS echo frequently differ
    // from what we sent, which used to leave both the optimistic and the echo on screen).
    // Optimistic temps are ALWAYS our own outbound messages, so we attempt reconciliation for any
    // echo that isn't explicitly inbound. Requiring dir === 'outbound' was a bug: a WS echo with a
    // missing/lowercase direction skipped replacement and got appended as a second bubble.
    const dir = (message.direction || '').toLowerCase();
    if (dir !== 'inbound') {
      const incomingText = (message.text || (message as any).body || '').trim();
      const incomingMedia = (message as any).gmbt_mediaUrl || (message as any).mediaUrl || (message as any).MediaUrl || '';
      const incomingType = String((message as any).type || (message as any).messageType || '').toLowerCase();
      const isLocalUri = (u: string) => /^(file:|content:|ph:|assets-library:)/i.test(u);
      const isReconcilableTemp = (m: any) =>
        m.messageId?.startsWith('temp_') && !m.messageId.startsWith('temp_internal_') && m.status !== 'failed';
      let tempIdx = currentMessages.findIndex((m) => {
        if (!isReconcilableTemp(m)) return false;
        const mText = (m.text || (m as any).body || '').trim();
        const mMedia = (m as any).gmbt_mediaUrl || (m as any).mediaUrl || (m as any).MediaUrl || '';
        const mType = String((m as any).type || (m as any).messageType || '').toLowerCase();
        // Match on text when present, otherwise on media URL (covers media/template sends).
        if (incomingText) return mText === incomingText;
        if (incomingMedia) {
          if (mMedia && mMedia === incomingMedia) return true;
          // Optimistic media holds a *local* uri that can never equal the server URL, so fall
          // back to matching a recent local-uri temp of the same media type (mirrors web's
          // time/type proximity dedup) — otherwise both the optimistic and echo bubbles show.
          if (mMedia && isLocalUri(mMedia) && (!incomingType || !mType || incomingType === mType)) return true;
          return false;
        }
        return mText === '' && !mMedia;
      });
      // Time-proximity fallback (mirrors web): an OUTBOUND echo always corresponds to one of our
      // pending optimistic temps. If the exact text/media match above missed (e.g. the server
      // normalized the text, returned it in a different field, or used different phone/url
      // formatting), reconcile against the OLDEST pending non-failed temp created within the last
      // 60s. Without this, the echo gets appended as a 2nd bubble that the WS path can never clean
      // up later (the real id lands in messageIdSet, so a re-delivery short-circuits) — exactly the
      // "message shows twice only right after sending" report.
      if (tempIdx === -1) {
        const echoTs = new Date(message.createdOn || message.timestamp || Date.now()).getTime();
        let bestTs = Infinity;
        currentMessages.forEach((m, i) => {
          if (!isReconcilableTemp(m)) return;
          const mTs = new Date(m.createdOn || (m as any).timestamp || '').getTime() || 0;
          if (Math.abs(echoTs - mTs) > 60000) return;
          if (mTs < bestTs) { bestTs = mTs; tempIdx = i; }
        });
      }
      if (tempIdx !== -1) {
        messageIdSet.add(message.messageId);
        set({
          currentMessages: currentMessages.map((m, i) => i === tempIdx ? message : m),
          allMessages: allMessages.map((m) =>
            m.messageId === currentMessages[tempIdx].messageId ? message : m
          ),
        });
        persistMessages(currentPhoneNumber, [message]);
        return;
      }
    }

    messageIdSet.add(message.messageId);
    set({
      currentMessages: [...currentMessages, message],
      allMessages: [...allMessages, message],
    });
    persistMessages(currentPhoneNumber, [message]);
  },

  updateMessage: (messageId, updates) => {
    set((state) => {
      const merge = (msg: any) => {
        if (msg.messageId !== messageId) return msg;
        const merged = { ...msg, ...updates };
        // Merge reactions instead of replacing
        if (updates.reactions && msg.reactions) {
          merged.reactions = { ...(typeof msg.reactions === 'object' && !Array.isArray(msg.reactions) ? msg.reactions : {}), ...updates.reactions };
        }
        return merged;
      };
      return {
        currentMessages: state.currentMessages.map(merge),
        allMessages: state.allMessages.map(merge),
      };
    });
  },

  updateMessageStatus: (messageId, status) => {
    const { currentMessages, allMessages } = get();
    const idx = currentMessages.findIndex((m) => m.messageId === messageId);
    if (idx === -1) return;
    if (currentMessages[idx].status === status) return;

    const newCurrent = [...currentMessages];
    newCurrent[idx] = { ...newCurrent[idx], status };

    const allIdx = allMessages.findIndex((m) => m.messageId === messageId);
    const newAll = allIdx >= 0 ? [...allMessages] : allMessages;
    if (allIdx >= 0) newAll[allIdx] = { ...newAll[allIdx], status };

    set({ currentMessages: newCurrent, allMessages: newAll });
  },

  clearCurrentChat: () => {
    // Snapshot the chat we're leaving into the LRU cache so re-opening it is instant
    // (including any messages received live while it was open).
    const { currentPhoneNumber, allMessages, displayedCount, hasMoreMessages } = get();
    if (currentPhoneNumber && allMessages.length > 0) {
      setMessageCache(currentPhoneNumber, {
        allMessages,
        displayedCount: displayedCount || PAGE_SIZE,
        hasMoreMessages,
        serverLimit: currentServerLimit,
        serverMayHaveMore,
      });
    }
    messageIdSet.clear();
    set({ currentMessages: [], allMessages: [], currentPhoneNumber: null, displayedCount: PAGE_SIZE, hasMoreMessages: false });
  },

  updateUnreadCount: (count) => set({ unreadCount: count }),

  setActiveWabaNumber: (number) => set({ activeWabaNumber: number }),

  requestListReload: () => set({ pendingListReload: true }),
  clearListReload: () => set({ pendingListReload: false }),
}));
