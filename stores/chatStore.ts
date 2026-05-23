import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Chat, Message } from '../types';
import { chatsApi } from '../services/api/chats';
import { contactsApi } from '../services/api/contacts';

const CHATS_CACHE_KEY = 'gambot_chats_cache';
const PAGE_SIZE = 50;

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
  toggleStarred: (organization: string, messageId: string, phoneNumber: string, isStarred: boolean) => Promise<void>;
  addMessage: (message: Message) => void;
  updateMessage: (messageId: string, updates: Partial<Message>) => void;
  updateMessageStatus: (messageId: string, status: Message['status']) => void;
  clearCurrentChat: () => void;
  updateUnreadCount: (count: number) => void;
  setActiveWabaNumber: (number: string | null) => void;
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
          lastConversationStatus: c.lastConversationStatus || '',
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
      const index = state.chats.findIndex((c) => c.phoneNumber === chat.phoneNumber);
      let newChats: Chat[];
      if (index >= 0) {
        newChats = [...state.chats];
        newChats[index] = { ...newChats[index], ...chat };
      } else {
        newChats = [chat, ...state.chats];
      }
      newChats.sort((a, b) =>
        new Date(b.lastMessageTime).getTime() - new Date(a.lastMessageTime).getTime()
      );
      const totalUnread = newChats.reduce((acc, c) => acc + (c.unreadCount || 0), 0);
      return { chats: newChats, unreadCount: totalUnread };
    });
  },

  setSearchQuery: (query) => set({ searchQuery: query }),
  setFilter: (filter) => set({ filter }),
  setCategoryFilter: (category) => set({ categoryFilter: category }),
  setOwnerFilter: (owner) => set({ ownerFilter: owner }),

  loadMessages: async (organization, phoneNumber) => {
    set({ isLoadingMessages: true, currentPhoneNumber: phoneNumber, currentMessages: [], allMessages: [], displayedCount: PAGE_SIZE });
    try {
      const raw = await chatsApi.getMessages(organization, phoneNumber);
      const messages = (Array.isArray(raw) ? raw : []).map((m: any) => ({
        ...m,
        timestamp: m.timestamp || m.createdOn || '',
        createdOn: m.createdOn || m.timestamp || '',
        text: m.text || m.body || '',
        messageId: m.messageId || m.id || m.Id || '',
        direction: m.direction || (m.sentFromApp ? 'Outbound' : ''),
      }));
      const displayed = messages.slice(-PAGE_SIZE);
      set({
        allMessages: messages,
        currentMessages: displayed,
        displayedCount: PAGE_SIZE,
        hasMoreMessages: messages.length > PAGE_SIZE,
        isLoadingMessages: false,
      });
    } catch {
      set({ isLoadingMessages: false, currentMessages: [], allMessages: [] });
    }
  },

  loadOlderMessages: () => {
    const { allMessages, displayedCount, hasMoreMessages } = get();
    if (!hasMoreMessages) return;

    set({ isLoadingOlderMessages: true });

    const newCount = displayedCount + PAGE_SIZE;
    const displayed = allMessages.slice(-newCount);
    set({
      currentMessages: displayed,
      displayedCount: newCount,
      hasMoreMessages: allMessages.length > newCount,
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
      await chatsApi.sendInternalMessage(organization, phoneNumber, message, senderName, sentById, mentionedUsers);
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
    set((state) => {
      const exists = state.currentMessages.some(
        (m) => m.messageId === message.messageId
      );
      if (exists) return state;
      return {
        currentMessages: [...state.currentMessages, message],
        allMessages: [...state.allMessages, message],
      };
    });
  },

  updateMessage: (messageId, updates) => {
    set((state) => ({
      currentMessages: state.currentMessages.map((m) =>
        m.messageId === messageId ? { ...m, ...updates } : m
      ),
      allMessages: state.allMessages.map((m) =>
        m.messageId === messageId ? { ...m, ...updates } : m
      ),
    }));
  },

  updateMessageStatus: (messageId, status) => {
    set((state) => ({
      currentMessages: state.currentMessages.map((m) =>
        m.messageId === messageId ? { ...m, status } : m
      ),
      allMessages: state.allMessages.map((m) =>
        m.messageId === messageId ? { ...m, status } : m
      ),
    }));
  },

  clearCurrentChat: () => {
    set({ currentMessages: [], allMessages: [], currentPhoneNumber: null, displayedCount: PAGE_SIZE, hasMoreMessages: false });
  },

  updateUnreadCount: (count) => set({ unreadCount: count }),

  setActiveWabaNumber: (number) => set({ activeWabaNumber: number }),
}));
