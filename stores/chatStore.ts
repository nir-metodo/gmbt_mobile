import { create } from 'zustand';
import type { Chat, Message } from '../types';
import { chatsApi } from '../services/api/chats';
import { contactsApi } from '../services/api/contacts';

interface ChatState {
  chats: Chat[];
  currentMessages: Message[];
  currentPhoneNumber: string | null;
  isLoadingChats: boolean;
  isLoadingMessages: boolean;
  isSending: boolean;
  searchQuery: string;
  filter: string;
  unreadCount: number;
  categoryFilter: string;
  ownerFilter: string;

  loadChats: (organization: string, userId?: string, dataVisibility?: string) => Promise<void>;
  setChats: (chats: Chat[]) => void;
  addOrUpdateChat: (chat: Chat) => void;
  setSearchQuery: (query: string) => void;
  setFilter: (filter: string) => void;
  setCategoryFilter: (category: string) => void;
  setOwnerFilter: (owner: string) => void;

  loadMessages: (organization: string, phoneNumber: string) => Promise<void>;
  sendMessage: (organization: string, to: string, message: string, senderName?: string, userId?: string, replyToMessageId?: string) => Promise<void>;
  sendInternalMessage: (organization: string, phoneNumber: string, message: string, senderName: string, sentById?: string, mentionedUsers?: { userId: string; userName: string }[]) => Promise<void>;
  markAsRead: (organization: string, phoneNumber: string) => Promise<void>;
  toggleStarred: (organization: string, messageId: string, phoneNumber: string, isStarred: boolean) => Promise<void>;
  addMessage: (message: Message) => void;
  updateMessage: (messageId: string, updates: Partial<Message>) => void;
  updateMessageStatus: (messageId: string, status: Message['status']) => void;
  clearCurrentChat: () => void;
  updateUnreadCount: (count: number) => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  chats: [],
  currentMessages: [],
  currentPhoneNumber: null,
  isLoadingChats: false,
  isLoadingMessages: false,
  isSending: false,
  searchQuery: '',
  filter: 'all',
  unreadCount: 0,
  categoryFilter: 'all',
  ownerFilter: 'all',

  loadChats: async (organization, userId?, dataVisibility?) => {
    set({ isLoadingChats: true });
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
          status: c.lastConversationStatus || c.conversationStatus || 'Open',
          lastConversationStatus: c.lastConversationStatus || '',
          lastMessageDirection: c.lastMessageDirection || '',
          ownerId: c.ownerId || '',
          ownerName: c.ownerName || '',
          keys: c.keys,
          tags: Array.isArray(c.keys) ? c.keys : [],
        }));
      chatList.sort((a, b) =>
        new Date(b.lastMessageTime || 0).getTime() - new Date(a.lastMessageTime || 0).getTime()
      );
      const totalUnread = chatList.filter((c) => c.isRead === false).length;
      set({ chats: chatList, isLoadingChats: false, unreadCount: totalUnread });
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
    set({ isLoadingMessages: true, currentPhoneNumber: phoneNumber, currentMessages: [] });
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
      set({ currentMessages: messages, isLoadingMessages: false });
    } catch {
      set({ isLoadingMessages: false, currentMessages: [] });
    }
  },

  sendMessage: async (organization, to, message, senderName, userId, replyToMessageId?) => {
    set({ isSending: true });
    const tempId = `temp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
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
      contextMessageId: replyToMessageId,
    } as Message;
    set((state) => ({
      currentMessages: [...state.currentMessages, optimisticMsg],
    }));
    try {
      await chatsApi.sendMessage(organization, to, message, senderName, userId, replyToMessageId);
      set((state) => ({
        currentMessages: state.currentMessages.map((m) =>
          m.messageId === tempId ? { ...m, status: 'sent' as const } : m
        ),
      }));
    } catch (err) {
      set((state) => ({
        currentMessages: state.currentMessages.map((m) =>
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
      isSending: true,
    }));
    try {
      await chatsApi.sendInternalMessage(organization, phoneNumber, message, senderName, sentById, mentionedUsers);
    } catch (err) {
      set((state) => ({
        currentMessages: state.currentMessages.filter((m) => m.messageId !== tempId),
      }));
      throw err;
    } finally {
      set({ isSending: false });
    }
  },

  markAsRead: async (organization, phoneNumber) => {
    try {
      await chatsApi.markAsRead(organization, phoneNumber);
      set((state) => ({
        chats: state.chats.map((c) =>
          c.phoneNumber === phoneNumber ? { ...c, unreadCount: 0, isRead: true } : c
        ),
      }));
    } catch {}
  },

  toggleStarred: async (organization, messageId, phoneNumber, isStarred) => {
    try {
      await chatsApi.toggleStarred(organization, messageId, phoneNumber, isStarred);
      set((state) => ({
        currentMessages: state.currentMessages.map((m) =>
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
      return { currentMessages: [...state.currentMessages, message] };
    });
  },

  updateMessage: (messageId, updates) => {
    set((state) => ({
      currentMessages: state.currentMessages.map((m) =>
        m.messageId === messageId ? { ...m, ...updates } : m
      ),
    }));
  },

  updateMessageStatus: (messageId, status) => {
    set((state) => ({
      currentMessages: state.currentMessages.map((m) =>
        m.messageId === messageId ? { ...m, status } : m
      ),
    }));
  },

  clearCurrentChat: () => {
    set({ currentMessages: [], currentPhoneNumber: null });
  },

  updateUnreadCount: (count) => set({ unreadCount: count }),
}));
