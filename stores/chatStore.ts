import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Chat, Message } from '../types';
import { chatsApi } from '../services/api/chats';
import { contactsApi } from '../services/api/contacts';

const CHATS_CACHE_KEY = 'gambot_chats_cache';
const PAGE_SIZE = 50;
let messagesRequestSeq = 0;

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

  loadChats: (organization: string, userId?: string, dataVisibility?: string) => Promise<void>;
  setChats: (chats: Chat[]) => void;
  addOrUpdateChat: (chat: Chat) => void;
  setSearchQuery: (query: string) => void;
  setFilter: (filter: string) => void;
  setCategoryFilter: (category: string) => void;
  setOwnerFilter: (owner: string) => void;

  loadMessages: (organization: string, phoneNumber: string) => Promise<void>;
  loadOlderMessages: () => void;
  sendMessage: (organization: string, to: string, message: string, senderName?: string, userId?: string, replyToMessageId?: string, wabaNumber?: string, senderEmail?: string) => Promise<void>;
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
}

const messageIdSet = new Set<string>();

// How many messages we last requested from the server, and whether the server returned a
// full page (meaning older history likely exists). Used for real server-side pagination:
// when the user scrolls past everything we've fetched, we grow the limit and re-fetch.
let currentServerLimit = PAGE_SIZE * 4;
let serverMayHaveMore = false;
let currentOrg = '';

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
            const totalUnread = parsed.filter((c) => c.isRead === false).length;
            set({ chats: parsed, isLoadingChats: false, unreadCount: totalUnread });
          }
        }
      } catch {}
    }

    try {
      const contacts = await contactsApi.getAll(organization, { userId, dataVisibility });
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
        }));
      chatList.sort((a, b) =>
        new Date(b.lastMessageTime || 0).getTime() - new Date(a.lastMessageTime || 0).getTime()
      );
      const totalUnread = chatList.filter((c) => c.isRead === false).length;
      set({ chats: chatList, isLoadingChats: false, unreadCount: totalUnread });
      AsyncStorage.setItem(`${CHATS_CACHE_KEY}_${organization}`, JSON.stringify(chatList.slice(0, 100))).catch(() => {});
    } catch {
      set({ isLoadingChats: false });
    }
  },

  setChats: (chats) => {
    const totalUnread = chats.reduce((acc, c) => acc + (c.unreadCount || 0), 0);
    set({ chats, unreadCount: totalUnread });
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

      // Insert at correct position (sorted by lastMessageTime desc) using binary search
      const chatTime = new Date(updatedChat.lastMessageTime || 0).getTime();
      let lo = 0, hi = newChats.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (new Date(newChats[mid].lastMessageTime || 0).getTime() >= chatTime) lo = mid + 1;
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
    currentServerLimit = PAGE_SIZE * 4;
    currentOrg = organization;
    try {
      const raw = await chatsApi.getMessages(organization, phoneNumber, currentServerLimit);
      const rawCount = Array.isArray(raw) ? raw.length : 0;
      // Server returned a full page → older history likely exists beyond what we fetched.
      serverMayHaveMore = rawCount >= currentServerLimit;

      const deduped = normalizeAndDedupeMessages(raw);

      if (requestId !== messagesRequestSeq) return;
      if (get().currentPhoneNumber !== phoneNumber) return;

      const displayed = deduped.slice(-PAGE_SIZE);
      messageIdSet.clear();
      deduped.forEach((m: any) => { if (m.messageId) messageIdSet.add(m.messageId); });
      set({
        allMessages: deduped,
        currentMessages: displayed,
        displayedCount: PAGE_SIZE,
        hasMoreMessages: deduped.length > PAGE_SIZE || serverMayHaveMore,
        isLoadingMessages: false,
      });
    } catch {
      if (requestId !== messagesRequestSeq) return;
      if (get().currentPhoneNumber !== phoneNumber) return;
      messageIdSet.clear();
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

    // Case 2: local cache exhausted but the server has more → fetch a bigger batch.
    if (serverMayHaveMore && currentPhoneNumber && currentOrg) {
      const org = currentOrg;
      set({ isLoadingOlderMessages: true });
      const phoneAtRequest = currentPhoneNumber;
      try {
        const nextLimit = currentServerLimit + PAGE_SIZE * 4;
        const raw = await chatsApi.getMessages(org, phoneAtRequest, nextLimit);
        if (get().currentPhoneNumber !== phoneAtRequest) return;
        const rawCount = Array.isArray(raw) ? raw.length : 0;
        serverMayHaveMore = rawCount >= nextLimit;
        currentServerLimit = nextLimit;
        const deduped = normalizeAndDedupeMessages(raw);
        deduped.forEach((m: any) => { if (m.messageId) messageIdSet.add(m.messageId); });
        const revealed = Math.min(newCount, deduped.length);
        set({
          allMessages: deduped,
          currentMessages: deduped.slice(-revealed),
          displayedCount: revealed,
          hasMoreMessages: deduped.length > revealed || serverMayHaveMore,
          isLoadingOlderMessages: false,
        });
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

  sendMessage: async (organization, to, message, senderName, userId, replyToMessageId?, wabaNumber?, senderEmail?) => {
    set({ isSending: true });
    const tempId = `temp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const fromNumber = wabaNumber || get().activeWabaNumber || '';
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
    } as Message;
    set((state) => ({
      currentMessages: [...state.currentMessages, optimisticMsg],
      allMessages: [...state.allMessages, optimisticMsg],
    }));
    try {
      console.log('[sendMessage] Sending:', { organization, to, message: message.substring(0, 50), from: fromNumber, senderName, userId, senderEmail });
      await chatsApi.sendMessage(organization, to, message, senderName, userId, replyToMessageId, fromNumber, senderEmail);
      set((state) => ({
        currentMessages: state.currentMessages.map((m) =>
          m.messageId === tempId ? { ...m, status: 'sent' as const } : m
        ),
        allMessages: state.allMessages.map((m) =>
          m.messageId === tempId ? { ...m, status: 'sent' as const } : m
        ),
      }));
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

  markAsRead: async (organization, phoneNumber, userId, userName) => {
    set((state) => ({
      chats: state.chats.map((c) =>
        c.phoneNumber === phoneNumber ? { ...c, unreadCount: 0, isRead: true } : c
      ),
    }));
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

    // Content-based duplicate check: same text + direction within 2s window
    const msgText = message.text || (message as any).body || '';
    if (msgText) {
      const msgTs = new Date(message.createdOn || message.timestamp || '').getTime();
      const isDuplicate = currentMessages.some((m) => {
        if (m.direction !== message.direction) return false;
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

    // Replace optimistic temp message if this is the server-confirmed version
    const dir = (message.direction || '').toLowerCase();
    if (dir === 'outbound' || message.sentFromApp) {
      const tempIdx = currentMessages.findIndex(
        (m) => m.messageId?.startsWith('temp_') && m.to === message.to &&
          m.text === (message.text || message.body || '') && m.status !== 'failed'
      );
      if (tempIdx !== -1) {
        messageIdSet.add(message.messageId);
        set({
          currentMessages: currentMessages.map((m, i) => i === tempIdx ? message : m),
          allMessages: allMessages.map((m) =>
            m.messageId === currentMessages[tempIdx].messageId ? message : m
          ),
        });
        return;
      }
    }

    messageIdSet.add(message.messageId);
    set({
      currentMessages: [...currentMessages, message],
      allMessages: [...allMessages, message],
    });
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
    messageIdSet.clear();
    set({ currentMessages: [], allMessages: [], currentPhoneNumber: null, displayedCount: PAGE_SIZE, hasMoreMessages: false });
  },

  updateUnreadCount: (count) => set({ unreadCount: count }),

  setActiveWabaNumber: (number) => set({ activeWabaNumber: number }),
}));
