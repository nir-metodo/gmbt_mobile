import React, {
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo,
  useLayoutEffect,
} from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  ScrollView,
  Pressable,
  Modal,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
  Linking,
  Share,
  TextInput,
} from 'react-native';
import { Text, IconButton, Menu, Avatar, Button } from 'react-native-paper';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import {
  useRouter,
  useLocalSearchParams,
  useNavigation,
  Stack,
} from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useChatStore } from '../../../stores/chatStore';
import { useAuthStore } from '../../../stores/authStore';
import { useAppTheme } from '../../../hooks/useAppTheme';
import { useRTL } from '../../../hooks/useRTL';
import {
  formatMessageTime,
  formatMessageDateSeparator,
  getInitials,
} from '../../../utils/formatters';
import WebSocketService from '../../../services/websocket';
import { MessageBubble } from '../../../components/chat/MessageBubble';
import { ChatInput, ChatInputRef, ReplyPreview } from '../../../components/chat/ChatInput';
import { chatsApi } from '../../../services/api/chats';
import { usersApi } from '../../../services/api/users';
import { tasksApi } from '../../../services/api/tasks';
import type { Message, Template, QuickMessage } from '../../../types';

type ListItem =
  | {
      kind: 'message';
      data: Message;
      isOutbound: boolean;
      showTail: boolean;
    }
  | { kind: 'separator'; date: string; id: string }
  | { kind: 'timeline'; data: any; id: string };

function getDateKey(timestamp?: string): string {
  if (!timestamp) return '';
  try {
    return timestamp.split('T')[0];
  } catch {
    return '';
  }
}

function getTs(msg: Message): string {
  return msg.createdOn || msg.timestamp || '';
}

export default function ChatConversationScreen() {
  const { phoneNumber } = useLocalSearchParams<{
    phoneNumber: string;
  }>();
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const theme = useAppTheme();
  const { isRTL } = useRTL();
  const { t, i18n } = useTranslation();
  const lang = i18n.language as 'en' | 'he';

  const user = useAuthStore((s) => s.user);
  const chat = useChatStore((s) =>
    s.chats.find((c) => c.phoneNumber === phoneNumber),
  );
  const currentMessages = useChatStore((s) => s.currentMessages);
  const isLoadingMessages = useChatStore((s) => s.isLoadingMessages);
  const isSending = useChatStore((s) => s.isSending);
  const loadMessages = useChatStore((s) => s.loadMessages);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const sendInternalMessage = useChatStore(
    (s) => s.sendInternalMessage,
  );
  const markAsRead = useChatStore((s) => s.markAsRead);
  const toggleStarred = useChatStore((s) => s.toggleStarred);
  const addMessage = useChatStore((s) => s.addMessage);
  const updateMessage = useChatStore((s) => s.updateMessage);
  const clearCurrentChat = useChatStore((s) => s.clearCurrentChat);

  const [isInternalNote, setIsInternalNote] = useState(false);
  const [messageMode, setMessageMode] = useState<'regular' | 'internal'>('regular');
  const [menuVisible, setMenuVisible] = useState(false);
  const [selectedMessage, setSelectedMessage] =
    useState<Message | null>(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [showTemplateSelector, setShowTemplateSelector] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(false);
  const [isSendingTemplate, setIsSendingTemplate] = useState(false);
  const [scheduleText, setScheduleText] = useState('');
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleTime, setScheduleTime] = useState('');
  const [isScheduling, setIsScheduling] = useState(false);
  const [scheduledDateTime, setScheduledDateTime] = useState<Date | null>(null);
  const [showScheduleDatePicker, setShowScheduleDatePicker] = useState(false);
  const [showScheduleTimePicker, setShowScheduleTimePicker] = useState(false);
  const [selectedTemplateForVars, setSelectedTemplateForVars] = useState<Template | null>(null);
  const [templateVariableValues, setTemplateVariableValues] = useState<Record<number, string>>({});
  const flatListRef = useRef<FlatList>(null);
  const chatInputRef = useRef<ChatInputRef>(null);
  const wsRef = useRef<WebSocketService | null>(null);
  const prevMessageCount = useRef(0);

  // Search
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Starred filter
  const [starredFilter, setStarredFilter] = useState(false);

  // Quick messages
  const [quickMessages, setQuickMessages] = useState<QuickMessage[]>([]);
  const [showQuickMessages, setShowQuickMessages] = useState(false);
  const [isLoadingQuickMessages, setIsLoadingQuickMessages] = useState(false);

  // Reply
  const [replyToMessage, setReplyToMessage] = useState<Message | null>(null);

  // Reactions
  const [showReactions, setShowReactions] = useState(false);

  // @mentions
  const [orgUsers, setOrgUsers] = useState<any[]>([]);
  const [showMentionPicker, setShowMentionPicker] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionedUsers, setMentionedUsers] = useState<{ userId: string; userName: string }[]>([]);

  // / slash → inline quick messages
  const [quickSlashFilter, setQuickSlashFilter] = useState('');
  const [showInlineQuickMessages, setShowInlineQuickMessages] = useState(false);

  // Timeline entries
  const [timelineEntries, setTimelineEntries] = useState<any[]>([]);

  // Quick Actions sheet
  const [showQuickActionsSheet, setShowQuickActionsSheet] = useState(false);

  // Create Task from chat
  const [showCreateTaskModal, setShowCreateTaskModal] = useState(false);
  const [createTaskTitle, setCreateTaskTitle] = useState('');
  const [createTaskDueDate, setCreateTaskDueDate] = useState('');
  const [createTaskPriority, setCreateTaskPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [isCreatingTask, setIsCreatingTask] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

  const contactName = chat?.contactName || phoneNumber || '';

  const [conversationLive, setConversationLive] = useState<boolean | null>(null);
  const [recipientReplied24h, setRecipientReplied24h] = useState<boolean | null>(null);

  const fetchConversationStatus = useCallback(() => {
    if (!user?.organization || !phoneNumber) return;
    chatsApi.getConversationStatus(user.organization, phoneNumber as string).then((res) => {
      const live = res?.IsConversationLive ?? res?.IsConversationLiveByPhoneNumber ?? res?.isConversationLive ?? res?.isLive;
      setConversationLive(live === true || live === 'true');
      const replied = res?.IsRecipientReplyLast24Hours ?? res?.isRecipientReplyLast24Hours;
      if (replied !== undefined && replied !== null) {
        setRecipientReplied24h(replied === true || replied === 'true');
      }
    }).catch(() => {
      setConversationLive(null);
      setRecipientReplied24h(null);
    });
  }, [user?.organization, phoneNumber]);

  useEffect(() => {
    fetchConversationStatus();
  }, [fetchConversationStatus]);

  // Load timeline entries
  useEffect(() => {
    if (!user?.organization || !phoneNumber) return;
    chatsApi.getChatTimeline(user.organization, phoneNumber as string)
      .then(setTimelineEntries)
      .catch(() => setTimelineEntries([]));
  }, [user?.organization, phoneNumber]);

  // Window closed: conversation is not live at all
  const isWindowClosed = useMemo(() => {
    if (conversationLive === true) return false;
    if (conversationLive === false) return true;
    if (!chat) return false;
    const status = chat.lastConversationStatus?.toLowerCase() || '';
    return !status || status === 'closed' || status === 'expired';
  }, [conversationLive, chat?.lastConversationStatus]);

  // Waiting for reply: window is open but user hasn't replied in last 24h
  const isWaitingForReply = useMemo(() => {
    if (isWindowClosed) return false;
    if (recipientReplied24h === false) return true;
    return false;
  }, [isWindowClosed, recipientReplied24h]);

  const loadTemplates = useCallback(async () => {
    if (!user?.organization || isLoadingTemplates) return;
    setIsLoadingTemplates(true);
    try {
      const result = await chatsApi.getTemplates(user.organization);
      setTemplates(result);
    } catch {
      setTemplates([]);
    } finally {
      setIsLoadingTemplates(false);
    }
  }, [user?.organization]);

  const handleOpenConversation = useCallback(() => {
    loadTemplates();
    setShowTemplateSelector(true);
  }, [loadTemplates]);

  const getTemplateBodyText = useCallback((template: Template) => {
    const body = template.components?.find(
      (c: any) => c.type === 'BODY',
    );
    return body?.text || '';
  }, []);

  const getTemplateVariableIndices = useCallback((template: Template): number[] => {
    const text = getTemplateBodyText(template);
    const matches = text.match(/\{\{(\d+)\}\}/g);
    if (!matches) return [];
    const indices = [...new Set(matches.map((m) => parseInt(m.replace(/\{\{|\}\}/g, ''), 10)))].sort((a, b) => a - b);
    return indices;
  }, [getTemplateBodyText]);

  const handleSendTemplate = useCallback(
    async (template: Template) => {
      if (!user?.organization || !phoneNumber || isSendingTemplate) return;
      const indices = getTemplateVariableIndices(template);
      if (indices.length > 0) {
        // Close template selector first — two modals open simultaneously blocks the second on iOS
        setShowTemplateSelector(false);
        setSelectedTemplateForVars(template);
        setTemplateVariableValues(
          Object.fromEntries(indices.map((i) => [i, ''])),
        );
        return;
      }
      setShowTemplateSelector(false);
      await doSendTemplate(template, []);
    },
    [user, phoneNumber, isSendingTemplate, getTemplateVariableIndices],
  );

  const doSendTemplate = useCallback(
    async (template: Template, templateVariableQuery: any[]) => {
      if (!user?.organization || !phoneNumber) return;
      const templateId = template.id || template.templateId || template.Id || '';
      if (!templateId) {
        Alert.alert(t('common.error'), t('chats.templateSendError'));
        return;
      }
      setIsSendingTemplate(true);
      try {
        const result = await chatsApi.sendTemplateMessage(
          user.organization,
          phoneNumber,
          templateId,
          user.userId,
          templateVariableQuery,
        );
        if (result?.Success === false) {
          throw new Error(result?.Message || t('chats.templateSendError'));
        }
        setSelectedTemplateForVars(null);
        setTemplateVariableValues({});
        loadMessages(user.organization, phoneNumber);
        // After template sent, re-check conversation status (still waiting for reply)
        fetchConversationStatus();
        Alert.alert(t('common.success'), t('chats.templateSent'));
      } catch (err: any) {
        const msg = err?.response?.data?.Message || err?.message || t('chats.templateSendError');
        Alert.alert(t('common.error'), msg);
      } finally {
        setIsSendingTemplate(false);
      }
    },
    [user, phoneNumber, loadMessages, t, fetchConversationStatus],
  );

  const handleSendTemplateWithVariables = useCallback(() => {
    if (!selectedTemplateForVars) return;
    const indices = getTemplateVariableIndices(selectedTemplateForVars);
    const templateVariableQuery = indices.map((idx, i) => ({
      index: i + 1,
      Variable: `dynamic_var${idx}`,
      dataSource1: 'data_source1_HardCoded',
      parameters_hardCoded_Text: templateVariableValues[idx] ?? '',
    }));
    doSendTemplate(selectedTemplateForVars, templateVariableQuery);
  }, [selectedTemplateForVars, getTemplateVariableIndices, templateVariableValues, doSendTemplate]);

  const handleOpenSchedule = useCallback(() => {
    setScheduleText('');
    setScheduleDate('');
    setScheduleTime('');
    setShowScheduleModal(true);
  }, []);

  const handleScheduleSubmit = useCallback(async () => {
    if (!user?.organization || !phoneNumber || !scheduleText.trim()) return;
    let scheduledTime = '';
    if (scheduledDateTime) {
      scheduledTime = scheduledDateTime.toISOString();
    } else if (scheduleDate && scheduleTime) {
      scheduledTime = `${scheduleDate}T${scheduleTime}:00`;
    }
    if (!scheduledTime) {
      Alert.alert(t('common.error'), t('chats.pickDateTime', 'בחר תאריך ושעה'));
      return;
    }
    setIsScheduling(true);
    try {
      await chatsApi.scheduleMessage(
        user.organization,
        phoneNumber,
        scheduleText.trim(),
        scheduledTime,
      );
      Alert.alert(t('common.success'), t('chats.scheduleSuccess', 'ההודעה תוזמנה בהצלחה'));
      setShowScheduleModal(false);
      setScheduleText('');
      setScheduledDateTime(null);
    } catch {
      Alert.alert(t('common.error'), t('chats.scheduleError', 'תזמון ההודעה נכשל'));
    } finally {
      setIsScheduling(false);
    }
  }, [user, phoneNumber, scheduleText, scheduledDateTime, scheduleDate, scheduleTime, t]);

  // Hide tab bar in conversation
  useLayoutEffect(() => {
    const parent = navigation.getParent();
    parent?.setOptions({ tabBarStyle: { display: 'none' } });
    return () => {
      parent?.setOptions({ tabBarStyle: undefined });
    };
  }, [navigation]);

  // Load messages & mark as read
  useEffect(() => {
    if (user?.organization && phoneNumber) {
      loadMessages(user.organization, phoneNumber);
      markAsRead(user.organization, phoneNumber);
    }
    return () => {
      clearCurrentChat();
    };
  }, [user?.organization, phoneNumber]);

  // WebSocket for live messages
  useEffect(() => {
    if (!user?.organization || !phoneNumber) return;

    const ws = WebSocketService.getInstance(
      user.organization,
      phoneNumber,
      'message',
    );

    ws.on('any', ({ data }) => {
      if (!data) return;

      if (
        data.type === 'messages' ||
        data.type === 'new_message' ||
        data.type === 'message'
      ) {
        // Server sends { type: 'messages', data: <json string or array> }
        let raw = data.data ?? data.message ?? data;
        if (typeof raw === 'string') {
          try { raw = JSON.parse(raw); } catch { raw = null; }
        }
        const msgs: any[] = Array.isArray(raw) ? raw : (raw ? [raw] : []);

        msgs.forEach((msg) => {
          if (!msg?.messageId) return;
          addMessage({
            ...msg,
            text: msg.text || msg.body || '',
            timestamp: msg.timestamp || msg.createdOn || '',
            createdOn: msg.createdOn || msg.timestamp || '',
          });
          markAsRead(user.organization, phoneNumber);
          const dir = (msg.direction || '').toLowerCase();
          if (dir === 'inbound' || msg.from === phoneNumber) {
            setConversationLive(true);
            setRecipientReplied24h(true);
          }
        });
      }

      if (data.type === 'message_updated') {
        let raw = data.data ?? data;
        if (typeof raw === 'string') {
          try { raw = JSON.parse(raw); } catch { raw = null; }
        }
        const updated = Array.isArray(raw) ? raw[0] : raw;
        if (updated?.messageId) {
          updateMessage(updated.messageId, updated);
        }
      }
    });

    wsRef.current = ws;
    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [user?.organization, phoneNumber, addMessage, updateMessage, markAsRead]);

  // Auto-scroll on new messages
  useEffect(() => {
    if (currentMessages.length > prevMessageCount.current) {
      setTimeout(() => {
        flatListRef.current?.scrollToOffset({
          offset: 0,
          animated: true,
        });
      }, 100);
    }
    prevMessageCount.current = currentMessages.length;
  }, [currentMessages.length]);

  // Build list data with date separators + timeline entries (newest first for inverted list)
  const listData = useMemo<ListItem[]>(() => {
    let msgs = currentMessages;
    if (messageMode === 'internal') {
      msgs = msgs.filter((m) => m.type === 'internal' || (m as any).isInternalMessage === true);
    } else {
      msgs = msgs.filter((m) => m.type !== 'internal' && (m as any).isInternalMessage !== true);
    }
    if (starredFilter) {
      msgs = msgs.filter((m) => m.isStarred === true);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      msgs = msgs.filter((m) =>
        (m.text || m.body || '').toLowerCase().includes(q)
      );
    }

    // Build a combined list of messages + timeline entries sorted by timestamp
    type Combined =
      | { ts: number; kind: 'message'; msg: Message }
      | { ts: number; kind: 'timeline'; entry: any };

    const combined: Combined[] = [
      ...msgs.map((msg) => ({
        ts: new Date(getTs(msg)).getTime() || 0,
        kind: 'message' as const,
        msg,
      })),
      ...timelineEntries.map((entry: any) => {
        const entryTs = entry.createdOn || entry.timestamp || entry.CreatedOn || '';
        return {
          ts: new Date(entryTs).getTime() || 0,
          kind: 'timeline' as const,
          entry,
        };
      }),
    ].sort((a, b) => b.ts - a.ts);

    const items: ListItem[] = [];
    const orgNumber = user?.wabaNumber || '';
    let lastDateKey = '';

    for (let i = 0; i < combined.length; i++) {
      const c = combined[i];

      if (c.kind === 'timeline') {
        const entryTs = c.entry.createdOn || c.entry.timestamp || c.entry.CreatedOn || '';
        const dateKey = getDateKey(entryTs);
        items.push({ kind: 'timeline', data: c.entry, id: `tl-${c.entry.timelineEntryId || c.entry.id || i}` });

        const nextC = combined[i + 1];
        const nextDateKey = nextC
          ? getDateKey(nextC.kind === 'message' ? getTs(nextC.msg) : (nextC.entry.createdOn || nextC.entry.CreatedOn || ''))
          : null;
        if (dateKey !== nextDateKey && dateKey && !lastDateKey.includes(dateKey)) {
          lastDateKey = dateKey;
          items.push({ kind: 'separator', date: formatMessageDateSeparator(entryTs, lang), id: `sep-${dateKey}-tl` });
        }
        continue;
      }

      const msg = c.msg;
      const dir = msg.direction?.toLowerCase();
      const isOutbound =
        (orgNumber && msg.from === orgNumber) ||
        dir === 'outbound' ||
        msg.sentFromApp === true ||
        msg.to === phoneNumber;

      const nextC = combined[i + 1];
      const nextMsg = nextC?.kind === 'message' ? nextC.msg : null;
      const showTail =
        !nextMsg ||
        nextMsg.direction !== msg.direction ||
        getDateKey(getTs(msg)) !== getDateKey(getTs(nextMsg));

      items.push({ kind: 'message', data: msg, isOutbound, showTail });

      const currentDate = getDateKey(getTs(msg));
      const nextDateKey = nextC
        ? getDateKey(nextC.kind === 'message' ? getTs(nextC.msg) : (nextC.entry.createdOn || nextC.entry.CreatedOn || ''))
        : null;
      if (currentDate !== nextDateKey && currentDate) {
        items.push({ kind: 'separator', date: formatMessageDateSeparator(getTs(msg), lang), id: `sep-${currentDate}` });
      }
    }

    return items;
  }, [currentMessages, timelineEntries, lang, messageMode, starredFilter, searchQuery, user, phoneNumber]);

  // Quick Actions sheet
  const handleQuickActionsPress = useCallback(() => {
    setShowQuickActionsSheet(true);
  }, []);

  // Quick messages loader (called from inside the quick actions sheet)
  const handleQuickMessagePress = useCallback(async () => {
    if (!user?.organization) return;
    setIsLoadingQuickMessages(true);
    setShowQuickMessages(true);
    try {
      const data = await chatsApi.getQuickMessages(user.organization);
      setQuickMessages(data);
    } catch {
      setQuickMessages([]);
    } finally {
      setIsLoadingQuickMessages(false);
    }
  }, [user?.organization]);

  // Create task from chat
  const handleCreateTaskInChat = useCallback(async () => {
    if (!user?.organization || !createTaskTitle.trim()) return;
    setIsCreatingTask(true);
    try {
      await tasksApi.create(
        user.organization,
        {
          title: createTaskTitle.trim(),
          dueDate: createTaskDueDate || undefined,
          priority: createTaskPriority,
          relatedTo: {
            type: 'contact',
            entityId: phoneNumber as string,
            entityName: contactName,
          },
          assignedToId: user.uID || user.userId || '',
          assignedTo: user.uID || user.userId || '',
          assignedToName: user.fullname || '',
          status: 'open',
          source: 'chat',
        } as any,
        user.uID || user.userId || '',
        user.fullname || '',
      );
      setShowCreateTaskModal(false);
      setCreateTaskTitle('');
      setCreateTaskDueDate('');
      setCreateTaskPriority('medium');
      setSelectedDate(null);
      Alert.alert(t('common.success'), t('tasks.taskCreated', 'המשימה נוצרה'));
    } catch (err: any) {
      Alert.alert(t('common.error'), err.message || t('errors.generic'));
    } finally {
      setIsCreatingTask(false);
    }
  }, [user, phoneNumber, contactName, createTaskTitle, createTaskDueDate, createTaskPriority, t]);

  const handleSelectQuickMessage = useCallback((msg: QuickMessage) => {
    setShowQuickMessages(false);
    const text = (msg as any).text || (msg as any).message || (msg as any).body || '';
    if (text) {
      chatInputRef.current?.insertText(text);
    }
  }, []);

  // Send handler
  const handleSend = useCallback(
    async (text: string) => {
      if (!user?.organization || !phoneNumber) return;
      try {
        if (isInternalNote) {
          await sendInternalMessage(
            user.organization,
            phoneNumber,
            text,
            user.fullname,
            user.uID || user.userId || '',
            mentionedUsers.length > 0 ? mentionedUsers : undefined,
          );
          setMentionedUsers([]);
        } else {
          await sendMessage(
            user.organization,
            phoneNumber,
            text,
            user.fullname,
            user.uID || user.userId || '',
            replyToMessage?.messageId,
          );
        }
        setReplyToMessage(null);
      } catch {
        Alert.alert(t('common.error'), t('chats.sendFailed', 'שליחת ההודעה נכשלה'));
      }
    },
    [user, phoneNumber, isInternalNote, sendMessage, sendInternalMessage, replyToMessage, mentionedUsers, t],
  );

  const sendPickedMedia = useCallback(async (uri: string, fileName: string, mimeType: string, fileSize?: number) => {
    if (!user?.organization || !phoneNumber) return;
    try {
      await chatsApi.sendMediaMessage(
        user.organization,
        phoneNumber as string,
        { uri, name: fileName, type: mimeType, size: fileSize },
        '',
        user?.uID || user?.userId || '',
      );
    } catch {
      Alert.alert(t('common.error'), t('chats.sendFailed', 'Failed to send media'));
    }
  }, [user?.organization, phoneNumber, user?.uID, user?.userId, t]);

  const handleAttachment = useCallback(() => {
    Alert.alert(
      t('chats.attachFile'),
      undefined,
      [
        {
          text: t('chats.takePhoto'),
          onPress: async () => {
            const { status } = await ImagePicker.requestCameraPermissionsAsync();
            if (status !== 'granted') {
              Alert.alert(
                t('common.permissionDenied', 'הרשאה נדרשת'),
                t('chats.cameraPermission', 'יש לאפשר גישה למצלמה בהגדרות האפליקציה'),
              );
              return;
            }
            try {
              const result = await ImagePicker.launchCameraAsync({
                mediaTypes: ImagePicker.MediaTypeOptions.Images,
                quality: 0.8,
              });
              if (!result.canceled && result.assets?.[0]) {
                const asset = result.assets[0];
                sendPickedMedia(asset.uri, asset.fileName || `photo_${Date.now()}.jpg`, asset.mimeType || 'image/jpeg', asset.fileSize);
              }
            } catch (err: any) {
              Alert.alert(t('common.error'), err?.message || t('errors.generic', 'אירעה שגיאה'));
            }
          },
        },
        {
          text: t('chats.gallery', 'גלריה'),
          onPress: async () => {
            const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (status !== 'granted') {
              Alert.alert(
                t('common.permissionDenied', 'הרשאה נדרשת'),
                t('chats.galleryPermission', 'יש לאפשר גישה לגלריה בהגדרות האפליקציה'),
              );
              return;
            }
            try {
              const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ImagePicker.MediaTypeOptions.All,
                quality: 0.8,
              });
              if (!result.canceled && result.assets?.[0]) {
                const asset = result.assets[0];
                const isVideo = asset.type === 'video' || asset.mimeType?.startsWith('video');
                const ext = isVideo ? 'mp4' : 'jpg';
                const mime = asset.mimeType || (isVideo ? 'video/mp4' : 'image/jpeg');
                sendPickedMedia(asset.uri, asset.fileName || `media_${Date.now()}.${ext}`, mime, asset.fileSize);
              }
            } catch (err: any) {
              Alert.alert(t('common.error'), err?.message || t('errors.generic', 'אירעה שגיאה'));
            }
          },
        },
        {
          text: t('chats.document', 'מסמך'),
          onPress: async () => {
            try {
              const DocumentPicker = require('expo-document-picker');
              const result = await DocumentPicker.getDocumentAsync({
                copyToCacheDirectory: true,
                type: '*/*',
              });
              if (!result.canceled && result.assets?.[0]) {
                const doc = result.assets[0];
                sendPickedMedia(doc.uri, doc.name, doc.mimeType || 'application/octet-stream', doc.size);
              }
            } catch (err: any) {
              Alert.alert(t('common.error'), err?.message || t('errors.generic', 'אירעה שגיאה'));
            }
          },
        },
        {
          text: t('common.cancel', 'ביטול'),
          style: 'cancel',
        },
      ],
      { cancelable: true },
    );
  }, [t, sendPickedMedia]);

  const handleVoiceMessage = useCallback(async (uri: string, durationMs: number) => {
    if (!user?.organization || !phoneNumber) return;
    const ext = Platform.OS === 'ios' ? 'm4a' : 'mp4';
    const fileName = `voice_${Date.now()}.${ext}`;
    const mimeType = Platform.OS === 'ios' ? 'audio/m4a' : 'audio/mp4';
    try {
      await chatsApi.sendMediaMessage(
        user.organization,
        phoneNumber as string,
        { uri, name: fileName, type: mimeType },
        '',
        user?.uID || user?.userId || '',
      );
    } catch {
      Alert.alert(t('common.error'), t('chats.sendFailed', 'שליחת ההקלטה נכשלה'));
    }
  }, [user?.organization, user?.uID, user?.userId, phoneNumber, t]);

  // Long press context actions
  const handleMessageLongPress = useCallback(
    (message: Message) => {
      setSelectedMessage(message);
    },
    [],
  );

  const handleStar = useCallback(async () => {
    if (
      !selectedMessage ||
      !user?.organization ||
      !phoneNumber
    )
      return;
    await toggleStarred(
      user.organization,
      selectedMessage.messageId,
      phoneNumber,
      !selectedMessage.isStarred,
    );
    setSelectedMessage(null);
  }, [selectedMessage, user, phoneNumber, toggleStarred]);

  const handleCopy = useCallback(async () => {
    const msgText = selectedMessage?.text || selectedMessage?.body || '';
    if (!msgText) return;
    await Clipboard.setStringAsync(msgText);
    setSelectedMessage(null);
  }, [selectedMessage]);

  const handleReply = useCallback(() => {
    if (!selectedMessage) return;
    setReplyToMessage(selectedMessage);
    setSelectedMessage(null);
  }, [selectedMessage]);

  const handleSendReaction = useCallback(async (emoji: string) => {
    if (!user?.organization || !selectedMessage || !phoneNumber) return;
    setSelectedMessage(null);
    setShowReactions(false);
    try {
      await chatsApi.sendReaction(
        user.organization,
        selectedMessage.messageId,
        phoneNumber,
        emoji,
      );
    } catch {
      Alert.alert(t('common.error'), t('chats.reactionFailed', 'שליחת הריאקציה נכשלה'));
    }
  }, [user?.organization, selectedMessage, phoneNumber, t]);

  // text change: detect / for quick messages, @ for mentions/internal note
  const handleTextChange = useCallback((text: string) => {
    // / at start → inline quick messages
    if (text.startsWith('/')) {
      const filter = text.slice(1);
      setQuickSlashFilter(filter);
      setShowInlineQuickMessages(true);
      setShowMentionPicker(false);
      if (quickMessages.length === 0 && !isLoadingQuickMessages && user?.organization) {
        setIsLoadingQuickMessages(true);
        chatsApi.getQuickMessages(user.organization)
          .then(setQuickMessages)
          .catch(() => {})
          .finally(() => setIsLoadingQuickMessages(false));
      }
      return;
    }
    if (showInlineQuickMessages) {
      setShowInlineQuickMessages(false);
      setQuickSlashFilter('');
    }

    // @ mention → auto-switch to internal note + show picker
    const atIdx = text.lastIndexOf('@');
    if (atIdx >= 0 && (atIdx === 0 || /\s/.test(text[atIdx - 1]))) {
      const afterAt = text.slice(atIdx + 1);
      if (!afterAt.includes(' ') && !afterAt.includes('\n')) {
        if (!isInternalNote) setIsInternalNote(true);
        const query = afterAt.toLowerCase();
        setMentionQuery(query);
        setShowMentionPicker(true);
        if (orgUsers.length === 0 && user?.organization) {
          usersApi.getAll(user.organization).then(setOrgUsers).catch(() => {});
        }
        return;
      }
    }
    setShowMentionPicker(false);
  }, [isInternalNote, showInlineQuickMessages, showMentionPicker, orgUsers.length, quickMessages.length, isLoadingQuickMessages, user?.organization]);

  const filteredMentionUsers = useMemo(() => {
    if (!mentionQuery) return orgUsers.slice(0, 8);
    return orgUsers
      .filter((u: any) => (u.fullname || u.name || '').toLowerCase().includes(mentionQuery))
      .slice(0, 8);
  }, [orgUsers, mentionQuery]);

  const handleSelectMention = useCallback((mentionUser: any) => {
    const name = mentionUser.fullname || mentionUser.name || '';
    const uid = mentionUser.userId || mentionUser.uID || mentionUser.id || '';
    // Add to mentioned users (deduped)
    setMentionedUsers((prev) =>
      prev.some((u) => u.userId === uid)
        ? prev
        : [...prev, { userId: uid, userName: name }],
    );
    // Remove the @query from input and insert @name
    chatInputRef.current?.insertText(`@${name} `);
    setShowMentionPicker(false);
    setMentionQuery('');
  }, []);

  const handleScroll = useCallback((e: any) => {
    setShowScrollBtn(
      e.nativeEvent.contentOffset.y > 400,
    );
  }, []);

  // Render each list item
  const renderItem = useCallback(
    ({ item }: { item: ListItem }) => {
      if (item.kind === 'separator') {
        return (
          <View style={styles.separatorWrap}>
            <View
              style={[
                styles.separatorPill,
                {
                  backgroundColor: theme.dark
                    ? 'rgba(255,255,255,0.08)'
                    : 'rgba(0,0,0,0.06)',
                },
              ]}
            >
              <Text
                variant="labelSmall"
                style={[
                  styles.separatorText,
                  {
                    color: theme.colors.onSurfaceVariant,
                  },
                ]}
              >
                {item.date}
              </Text>
            </View>
          </View>
        );
      }

      if (item.kind === 'timeline') {
        const entry = item.data;
        const iconMap: Record<string, string> = {
          note: 'note-text-outline',
          call: 'phone-outline',
          email: 'email-outline',
          task: 'clipboard-check-outline',
          meeting: 'calendar-outline',
          status_change: 'swap-horizontal',
        };
        const entryType = (entry.timelineType || entry.TimelineType || entry.type || 'note').toLowerCase();
        const icon = iconMap[entryType] || 'information-outline';
        const entryText = entry.note || entry.text || entry.description || entry.Note || entry.content || '';
        const entryBy = entry.createdByName || entry.CreatedByName || entry.addedByName || '';
        const entryTs = entry.createdOn || entry.timestamp || entry.CreatedOn || '';
        return (
          <View style={[styles.timelineItem, { backgroundColor: theme.dark ? 'rgba(255,255,255,0.05)' : '#f0f4f8', borderColor: theme.colors.outline }]}>
            <View style={[styles.timelineIconWrap, { backgroundColor: theme.dark ? 'rgba(46,97,85,0.3)' : '#2e615520' }]}>
              <MaterialCommunityIcons name={icon as any} size={16} color="#2e6155" />
            </View>
            <View style={{ flex: 1 }}>
              {entryText ? (
                <Text style={{ fontSize: 13, color: theme.colors.onSurface }} numberOfLines={3}>{entryText}</Text>
              ) : null}
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2, gap: 6 }}>
                {entryBy ? (
                  <Text style={{ fontSize: 11, color: theme.colors.onSurfaceVariant }}>{entryBy}</Text>
                ) : null}
                {entryTs ? (
                  <Text style={{ fontSize: 11, color: theme.colors.onSurfaceVariant }}>{formatMessageTime(entryTs)}</Text>
                ) : null}
              </View>
            </View>
          </View>
        );
      }

      return (
        <MessageBubble
          message={item.data}
          isOutbound={item.isOutbound}
          showTail={item.showTail}
          theme={theme}
          onLongPress={handleMessageLongPress}
        />
      );
    },
    [theme, handleMessageLongPress],
  );

  const keyExtractor = useCallback((item: ListItem) => {
    if (item.kind === 'separator') return item.id;
    if (item.kind === 'timeline') return item.id;
    return item.data.messageId;
  }, []);

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />

      <KeyboardAvoidingView
        style={[
          styles.screen,
          { backgroundColor: theme.custom.chatBackground },
        ]}
        behavior={
          Platform.OS === 'ios' ? 'padding' : undefined
        }
        keyboardVerticalOffset={0}
      >
        {/* Header */}
        <View
          style={[
            styles.header,
            {
              backgroundColor:
                theme.custom.headerBackground,
              paddingTop: insets.top,
            },
          ]}
        >
          <View style={styles.headerContent}>
            <Pressable
              onPress={() => router.back()}
              hitSlop={8}
              style={({ pressed }) => [
                styles.backBtn,
                pressed && { opacity: 0.7 },
              ]}
            >
              <MaterialCommunityIcons
                name={
                  isRTL ? 'arrow-right' : 'arrow-left'
                }
                size={24}
                color={theme.custom.headerText}
              />
            </Pressable>

            <Pressable
              style={styles.headerProfile}
              onPress={() =>
                router.push({
                  pathname: '/(tabs)/contacts/[id]',
                  params: { id: phoneNumber as string },
                } as any)
              }
            >
              {chat?.profilePicture ? (
                <Avatar.Image
                  size={38}
                  source={{
                    uri: chat.profilePicture,
                  }}
                />
              ) : (
                <Avatar.Text
                  size={38}
                  label={getInitials(contactName)}
                  style={{
                    backgroundColor:
                      'rgba(255,255,255,0.2)',
                  }}
                  labelStyle={{
                    color: '#FFFFFF',
                    fontWeight: '700',
                    fontSize: 14,
                  }}
                />
              )}

              <View style={styles.headerInfo}>
                <Text
                  numberOfLines={1}
                  style={styles.headerName}
                >
                  {contactName}
                </Text>
                <Text style={styles.headerStatus}>
                  {chat?.isOnline
                    ? t('chats.online')
                    : t('chats.offline')}
                </Text>
              </View>
            </Pressable>

            <View style={styles.headerActions}>
              <IconButton
                icon={({ size, color }) => (
                  <Ionicons
                    name="call-outline"
                    size={size}
                    color={color}
                  />
                )}
                size={20}
                iconColor={theme.custom.headerText}
                onPress={() => {
                  if (phoneNumber) Linking.openURL(`tel:${phoneNumber}`);
                }}
              />
              <IconButton
                icon={messageMode === 'internal' ? 'note-text' : 'note-text-outline'}
                size={20}
                iconColor={messageMode === 'internal' ? '#FFB300' : theme.custom.headerText}
                onPress={() => setMessageMode(messageMode === 'internal' ? 'regular' : 'internal')}
              />
              <Menu
                visible={menuVisible}
                onDismiss={() => setMenuVisible(false)}
                anchor={
                  <IconButton
                    icon="dots-vertical"
                    size={20}
                    iconColor={
                      theme.custom.headerText
                    }
                    onPress={() =>
                      setMenuVisible(true)
                    }
                  />
                }
                contentStyle={{
                  backgroundColor:
                    theme.colors.surface,
                }}
              >
                <Menu.Item
                  leadingIcon={starredFilter ? 'star' : 'star-outline'}
                  onPress={() => {
                    setMenuVisible(false);
                    setStarredFilter((v) => !v);
                    setSearchVisible(false);
                    setSearchQuery('');
                  }}
                  title={starredFilter ? t('chats.allMessages', 'All Messages') : t('chats.starredMessages')}
                />
                <Menu.Item
                  leadingIcon="magnify"
                  onPress={() => {
                    setMenuVisible(false);
                    setSearchVisible((v) => !v);
                    if (searchVisible) setSearchQuery('');
                    setStarredFilter(false);
                  }}
                  title={t('chats.searchPlaceholder')}
                />
                <Menu.Item
                  leadingIcon="lightning-bolt"
                  onPress={() => {
                    setMenuVisible(false);
                    handleQuickActionsPress();
                  }}
                  title={t('chats.quickActions', 'פעולות מהירות')}
                />
                <Menu.Item
                  leadingIcon="export-variant"
                  onPress={async () => {
                    setMenuVisible(false);
                    const messages = currentMessages
                      .sort((a, b) => new Date(getTs(a)).getTime() - new Date(getTs(b)).getTime())
                      .map((m) => {
                        const time = formatMessageTime(m.createdOn || m.timestamp);
                        const sender = m.direction?.toLowerCase() === 'outbound' ? t('chats.you') : (m.senderName || contactName);
                        const text = m.text || m.body || `[${m.type}]`;
                        return `[${time}] ${sender}: ${text}`;
                      })
                      .join('\n');
                    try {
                      await Share.share({
                        message: `${t('chats.export')} - ${contactName}\n\n${messages}`,
                        title: `${contactName} - Chat Export`,
                      });
                    } catch {}
                  }}
                  title={t('chats.export')}
                />
              </Menu>
            </View>
          </View>
        </View>

        {/* Search bar */}
        {searchVisible && (
          <View style={[styles.searchBarContainer, { backgroundColor: theme.colors.surface, borderBottomColor: theme.colors.outline }]}>
            <MaterialCommunityIcons name="magnify" size={20} color={theme.colors.onSurfaceVariant} />
            <TextInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder={t('chats.searchPlaceholder')}
              placeholderTextColor={theme.custom?.placeholder || theme.colors.onSurfaceVariant}
              style={[styles.searchBarInput, { color: theme.colors.onSurface }]}
              autoFocus
              clearButtonMode="while-editing"
            />
            <Pressable onPress={() => { setSearchVisible(false); setSearchQuery(''); }} hitSlop={8}>
              <MaterialCommunityIcons name="close" size={20} color={theme.colors.onSurfaceVariant} />
            </Pressable>
          </View>
        )}

        {/* Starred filter banner */}
        {starredFilter && !searchVisible && (
          <Pressable
            onPress={() => setStarredFilter(false)}
            style={[styles.modeBanner, { backgroundColor: theme.dark ? '#3a2e00' : '#FFF8E1' }]}
          >
            <MaterialCommunityIcons name="star" size={16} color="#FFB300" />
            <Text style={[styles.modeBannerText, { color: '#FF8F00' }]}>
              {t('chats.starredMessages')}
            </Text>
            <MaterialCommunityIcons name="close" size={16} color="#FF8F00" />
          </Pressable>
        )}

        {/* Message mode indicator */}
        {messageMode === 'internal' && (
          <Pressable
            onPress={() => setMessageMode('regular')}
            style={[
              styles.modeBanner,
              { backgroundColor: theme.dark ? '#3E3500' : '#FFF3E0' },
            ]}
          >
            <MaterialCommunityIcons
              name="note-text"
              size={16}
              color={theme.dark ? '#FFE082' : '#E65100'}
            />
            <Text
              style={[
                styles.modeBannerText,
                { color: theme.dark ? '#FFE082' : '#E65100' },
              ]}
            >
              {t('chats.internalMessages')}
            </Text>
            <MaterialCommunityIcons
              name="close"
              size={16}
              color={theme.dark ? '#FFE082' : '#E65100'}
            />
          </Pressable>
        )}

        {/* Messages */}
        {isLoadingMessages ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator
              size="large"
              color={theme.colors.primary}
            />
          </View>
        ) : (
          <FlatList
            ref={flatListRef}
            data={listData}
            renderItem={renderItem}
            keyExtractor={keyExtractor}
            inverted
            onScroll={handleScroll}
            scrollEventThrottle={200}
            contentContainerStyle={styles.messagesContent}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              <View style={styles.emptyMessages}>
                <MaterialCommunityIcons
                  name="message-text-outline"
                  size={56}
                  color={
                    theme.colors.onSurfaceVariant
                  }
                  style={{ opacity: 0.35 }}
                />
                <Text
                  variant="bodyMedium"
                  style={{
                    color:
                      theme.colors.onSurfaceVariant,
                    marginTop: 12,
                  }}
                >
                  {t('chats.noMessages')}
                </Text>
              </View>
            }
          />
        )}

        {/* Scroll to bottom */}
        {showScrollBtn && (
          <Pressable
            onPress={() =>
              flatListRef.current?.scrollToOffset({
                offset: 0,
                animated: true,
              })
            }
            style={[
              styles.scrollDownBtn,
              {
                backgroundColor: theme.colors.surface,
                bottom: 80,
              },
            ]}
          >
            <MaterialCommunityIcons
              name="chevron-down"
              size={22}
              color={theme.colors.primary}
            />
          </Pressable>
        )}

        {/* Input / Conversation Closed Banner */}
        {isWindowClosed ? (
          <View
            style={[
              styles.closedBanner,
              {
                backgroundColor: theme.dark ? '#1a1a2e' : '#f8f9fa',
                borderTopColor: theme.dark
                  ? 'rgba(255,255,255,0.1)'
                  : '#e2e8f0',
                paddingBottom: Math.max(insets.bottom, 8),
              },
            ]}
          >
            <View style={styles.closedBannerHeader}>
              <MaterialCommunityIcons
                name="lock-clock"
                size={20}
                color={theme.dark ? '#94a3b8' : '#64748b'}
              />
              <Text
                variant="bodyMedium"
                style={{
                  color: theme.dark ? '#94a3b8' : '#64748b',
                  fontWeight: '600',
                  flex: 1,
                  textAlign: isRTL ? 'right' : 'left',
                }}
              >
                {t('chats.conversationWindowClosed')}
              </Text>
            </View>
            <View style={styles.closedBannerActions}>
              <Pressable
                onPress={handleOpenConversation}
                style={({ pressed }) => [
                  styles.closedBannerBtn,
                  {
                    backgroundColor: pressed
                      ? '#1a7a5e'
                      : '#25D366',
                  },
                ]}
              >
                <MaterialCommunityIcons
                  name="message-text-outline"
                  size={18}
                  color="#fff"
                />
                <Text style={styles.closedBannerBtnText}>
                  {t('chats.openConversation')}
                </Text>
              </Pressable>
              <Pressable
                onPress={handleOpenSchedule}
                style={({ pressed }) => [
                  styles.closedBannerBtn,
                  {
                    backgroundColor: pressed
                      ? '#5b6370'
                      : '#6b7280',
                  },
                ]}
              >
                <MaterialCommunityIcons
                  name="clock-outline"
                  size={18}
                  color="#fff"
                />
                <Text style={styles.closedBannerBtnText}>
                  {t('chats.scheduleMessage')}
                </Text>
              </Pressable>
            </View>
          </View>
        ) : isWaitingForReply ? (
          /* Waiting for user reply — 24h window is open but user hasn't replied yet */
          <View
            style={[
              styles.closedBanner,
              {
                backgroundColor: theme.dark ? '#1a1f2e' : '#f8fafc',
                borderTopColor: theme.dark ? 'rgba(255,255,255,0.08)' : '#e2e8f0',
                paddingBottom: Math.max(insets.bottom, 8),
              },
            ]}
          >
            <View style={[styles.closedBannerHeader, { justifyContent: 'flex-start', gap: 10 }]}>
              <Text style={{ fontSize: 24 }}>⏳</Text>
              <View style={{ flex: 1 }}>
                <Text
                  variant="bodyMedium"
                  style={{
                    color: theme.dark ? '#94a3b8' : '#64748b',
                    fontWeight: '600',
                    textAlign: isRTL ? 'right' : 'left',
                  }}
                >
                  {t('chats.waitingForReply') || 'ממתין לתגובת הלקוח'}
                </Text>
                <Text
                  variant="bodySmall"
                  style={{
                    color: theme.dark ? '#64748b' : '#94a3b8',
                    textAlign: isRTL ? 'right' : 'left',
                    marginTop: 2,
                  }}
                >
                  {t('chats.waitingForReplyDesc') || 'חלון ה-24 שעות יפתח לאחר שהלקוח יענה'}
                </Text>
              </View>
            </View>
            <View style={styles.closedBannerActions}>
              <Pressable
                onPress={handleOpenSchedule}
                style={({ pressed }) => [
                  styles.closedBannerBtn,
                  { backgroundColor: pressed ? '#5b6370' : '#6b7280' },
                ]}
              >
                <MaterialCommunityIcons name="clock-outline" size={18} color="#fff" />
                <Text style={styles.closedBannerBtnText}>
                  {t('chats.scheduleMessage')}
                </Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <ChatInput
            ref={chatInputRef}
            onSend={handleSend}
            onAttachmentPress={handleAttachment}
            isInternalNote={isInternalNote}
            onToggleInternalNote={() => {
              setIsInternalNote((v) => !v);
              setMentionedUsers([]);
            }}
            onQuickMessagePress={handleQuickActionsPress}
            onVoiceMessage={handleVoiceMessage}
            mentionedUsers={mentionedUsers}
            onRemoveMention={(uid) => setMentionedUsers((prev) => prev.filter((u) => u.userId !== uid))}
            isSending={isSending}
            replyTo={replyToMessage ? {
              text: replyToMessage.text || replyToMessage.body || '',
              senderName: replyToMessage.senderName || replyToMessage.sentByName || (replyToMessage.direction?.toLowerCase() === 'outbound' ? (user?.fullname || '') : contactName),
            } : null}
            onCancelReply={() => setReplyToMessage(null)}
            onTextChange={handleTextChange}
          />
        )}

        {/* Template Selector Modal */}
        <Modal
          visible={showTemplateSelector}
          transparent
          animationType="slide"
          onRequestClose={() => setShowTemplateSelector(false)}
        >
          <View style={styles.modalOverlay}>
            <View
              style={[
                styles.templateSheet,
                {
                  backgroundColor: theme.colors.surface,
                  paddingBottom: insets.bottom + 12,
                },
              ]}
            >
              <View style={styles.actionSheetHandle} />
              <View style={styles.templateSheetHeader}>
                <Text
                  variant="titleMedium"
                  style={{
                    fontWeight: '700',
                    color: theme.colors.onSurface,
                    flex: 1,
                  }}
                >
                  {t('chats.selectTemplate')}
                </Text>
                <IconButton
                  icon="close"
                  size={20}
                  onPress={() => setShowTemplateSelector(false)}
                />
              </View>

              {isLoadingTemplates ? (
                <View style={styles.loadingContainer}>
                  <ActivityIndicator
                    size="large"
                    color={theme.colors.primary}
                  />
                </View>
              ) : templates.length === 0 ? (
                <View style={styles.emptyTemplates}>
                  <MaterialCommunityIcons
                    name="file-document-outline"
                    size={48}
                    color={theme.colors.onSurfaceVariant}
                    style={{ opacity: 0.4 }}
                  />
                  <Text
                    variant="bodyMedium"
                    style={{
                      color: theme.colors.onSurfaceVariant,
                      marginTop: 12,
                    }}
                  >
                    {t('chats.noTemplatesAvailable')}
                  </Text>
                </View>
              ) : (
                <FlatList
                  data={templates}
                  keyExtractor={(item, index) =>
                    item.id || item.templateId || `${item.name}-${index}`
                  }
                  style={{ maxHeight: 400 }}
                  renderItem={({ item }) => (
                    <Pressable
                      onPress={() => handleSendTemplate(item)}
                      disabled={isSendingTemplate}
                      style={({ pressed }) => [
                        styles.templateItem,
                        {
                          backgroundColor: pressed
                            ? theme.colors.surfaceVariant
                            : 'transparent',
                          opacity: isSendingTemplate ? 0.6 : 1,
                        },
                      ]}
                    >
                      <View style={{ flex: 1 }}>
                        <Text
                          variant="bodyLarge"
                          style={{
                            fontWeight: '600',
                            color: theme.colors.onSurface,
                          }}
                        >
                          {item.name}
                        </Text>
                        <Text
                          variant="bodySmall"
                          numberOfLines={2}
                          style={{
                            color: theme.colors.onSurfaceVariant,
                            marginTop: 2,
                          }}
                        >
                          {getTemplateBodyText(item) ||
                            `${item.language} · ${item.category}`}
                        </Text>
                      </View>
                      <MaterialCommunityIcons
                        name="send"
                        size={20}
                        color={theme.colors.primary}
                      />
                    </Pressable>
                  )}
                />
              )}
            </View>
          </View>
        </Modal>

        {/* Template Variables Modal - when template has {{1}}, {{2}}, etc. */}
        <Modal
          visible={!!selectedTemplateForVars}
          transparent
          animationType="slide"
          onRequestClose={() => {
            setSelectedTemplateForVars(null);
            setTemplateVariableValues({});
          }}
        >
          <View style={styles.modalOverlay}>
            <View
              style={[
                styles.templateSheet,
                {
                  backgroundColor: theme.colors.surface,
                  paddingBottom: insets.bottom + 12,
                },
              ]}
            >
              <View style={styles.actionSheetHandle} />
              <View style={styles.templateSheetHeader}>
                <Text
                  variant="titleMedium"
                  style={{
                    fontWeight: '700',
                    color: theme.colors.onSurface,
                    flex: 1,
                  }}
                >
                  {selectedTemplateForVars?.name || t('chats.fillTemplateVariables')}
                </Text>
                <IconButton
                  icon="close"
                  size={20}
                  onPress={() => {
                    setSelectedTemplateForVars(null);
                    setTemplateVariableValues({});
                  }}
                />
              </View>
              {selectedTemplateForVars && (
                <ScrollView style={{ maxHeight: 360 }} contentContainerStyle={{ padding: 16 }}>
                  {(getTemplateVariableIndices(selectedTemplateForVars)).map((idx) => (
                    <View key={idx} style={{ marginBottom: 12 }}>
                      <Text
                        variant="labelMedium"
                        style={{
                          color: theme.colors.onSurfaceVariant,
                          marginBottom: 6,
                        }}
                      >
                        {`{{${idx}}}`}
                      </Text>
                      <TextInput
                        value={templateVariableValues[idx] ?? ''}
                        onChangeText={(v) =>
                          setTemplateVariableValues((prev) => ({ ...prev, [idx]: v }))
                        }
                        placeholder={t('chats.enterValue')}
                        placeholderTextColor={theme.colors.onSurfaceVariant}
                        style={[
                          styles.scheduleInput,
                          {
                            borderColor: theme.dark ? 'rgba(255,255,255,0.15)' : '#d1d5db',
                            backgroundColor: theme.dark ? 'rgba(255,255,255,0.05)' : '#f9fafb',
                            color: theme.colors.onSurface,
                            fontSize: 15,
                            writingDirection: isRTL ? 'rtl' : 'ltr',
                          },
                        ]}
                      />
                    </View>
                  ))}
                  <Button
                    mode="contained"
                    onPress={handleSendTemplateWithVariables}
                    disabled={isSendingTemplate}
                    style={{ marginTop: 8 }}
                  >
                    {isSendingTemplate ? t('common.sending') : t('chats.send')}
                  </Button>
                </ScrollView>
              )}
            </View>
          </View>
        </Modal>

        {/* Schedule Message Modal */}
        <Modal
          visible={showScheduleModal}
          transparent
          animationType="slide"
          onRequestClose={() => setShowScheduleModal(false)}
        >
          <View style={styles.modalOverlay}>
            <View
              style={[
                styles.templateSheet,
                {
                  backgroundColor: theme.colors.surface,
                  paddingBottom: insets.bottom + 12,
                },
              ]}
            >
              <View style={styles.actionSheetHandle} />
              <View style={styles.templateSheetHeader}>
                <Text
                  variant="titleMedium"
                  style={{
                    fontWeight: '700',
                    color: theme.colors.onSurface,
                    flex: 1,
                  }}
                >
                  {t('chats.scheduleMessage')}
                </Text>
                <IconButton
                  icon="close"
                  size={20}
                  onPress={() => setShowScheduleModal(false)}
                />
              </View>

              <View style={styles.scheduleForm}>
                <Text
                  variant="labelMedium"
                  style={{
                    color: theme.colors.onSurfaceVariant,
                    marginBottom: 6,
                  }}
                >
                  {t('chats.enterMessage')}
                </Text>
                <TextInput
                  value={scheduleText}
                  onChangeText={setScheduleText}
                  placeholder={t('chats.typeMessage')}
                  placeholderTextColor={theme.colors.onSurfaceVariant}
                  multiline
                  style={[
                    styles.scheduleInput,
                    {
                      borderColor: theme.dark
                        ? 'rgba(255,255,255,0.15)'
                        : '#d1d5db',
                      backgroundColor: theme.dark
                        ? 'rgba(255,255,255,0.05)'
                        : '#f9fafb',
                      color: theme.colors.onSurface,
                      fontSize: 15,
                      minHeight: 60,
                      textAlignVertical: 'top',
                      writingDirection: isRTL ? 'rtl' : 'ltr',
                    },
                  ]}
                />
                <Text
                  variant="labelMedium"
                  style={{ color: theme.colors.onSurfaceVariant, marginTop: 12, marginBottom: 6 }}
                >
                  {t('chats.pickDateTime', 'תאריך ושעה')}
                </Text>
                <View style={{ flexDirection: isRTL ? 'row-reverse' : 'row', gap: 10 }}>
                  {/* Date picker */}
                  <Pressable
                    onPress={() => setShowScheduleDatePicker(true)}
                    style={[styles.scheduleInput, { flex: 1, borderColor: theme.dark ? 'rgba(255,255,255,0.15)' : '#d1d5db', backgroundColor: theme.dark ? 'rgba(255,255,255,0.05)' : '#f9fafb', flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10 }]}
                  >
                    <MaterialCommunityIcons name="calendar" size={18} color={theme.colors.onSurfaceVariant} />
                    <Text style={{ flex: 1, color: scheduledDateTime ? theme.colors.onSurface : theme.colors.onSurfaceVariant, fontSize: 14 }}>
                      {scheduledDateTime
                        ? scheduledDateTime.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' })
                        : 'בחר תאריך'}
                    </Text>
                  </Pressable>
                  {/* Time picker */}
                  <Pressable
                    onPress={() => setShowScheduleTimePicker(true)}
                    style={[styles.scheduleInput, { flex: 1, borderColor: theme.dark ? 'rgba(255,255,255,0.15)' : '#d1d5db', backgroundColor: theme.dark ? 'rgba(255,255,255,0.05)' : '#f9fafb', flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10 }]}
                  >
                    <MaterialCommunityIcons name="clock-outline" size={18} color={theme.colors.onSurfaceVariant} />
                    <Text style={{ flex: 1, color: scheduledDateTime ? theme.colors.onSurface : theme.colors.onSurfaceVariant, fontSize: 14 }}>
                      {scheduledDateTime
                        ? scheduledDateTime.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
                        : 'בחר שעה'}
                    </Text>
                  </Pressable>
                </View>
                {showScheduleDatePicker && (
                  <DateTimePicker
                    value={scheduledDateTime || new Date()}
                    mode="date"
                    display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                    minimumDate={new Date()}
                    onChange={(_, date) => {
                      setShowScheduleDatePicker(Platform.OS === 'ios');
                      if (date) {
                        const prev = scheduledDateTime || new Date();
                        const merged = new Date(date);
                        merged.setHours(prev.getHours(), prev.getMinutes(), 0, 0);
                        setScheduledDateTime(merged);
                      }
                    }}
                  />
                )}
                {showScheduleTimePicker && (
                  <DateTimePicker
                    value={scheduledDateTime || new Date()}
                    mode="time"
                    display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                    onChange={(_, date) => {
                      setShowScheduleTimePicker(Platform.OS === 'ios');
                      if (date) {
                        const prev = scheduledDateTime || new Date();
                        const merged = new Date(prev);
                        merged.setHours(date.getHours(), date.getMinutes(), 0, 0);
                        setScheduledDateTime(merged);
                      }
                    }}
                  />
                )}
                <Pressable
                  onPress={handleScheduleSubmit}
                  style={({ pressed }) => [
                    styles.scheduleSubmitBtn,
                    {
                      backgroundColor: pressed ? '#1a7a5e' : '#25D366',
                      opacity: !scheduleText.trim() || !scheduledDateTime || isScheduling ? 0.5 : 1,
                    },
                  ]}
                  disabled={!scheduleText.trim() || !scheduledDateTime || isScheduling}
                >
                  {isScheduling ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <MaterialCommunityIcons name="clock-check-outline" size={20} color="#fff" />
                  )}
                  <Text style={styles.closedBannerBtnText}>
                    {t('chats.scheduleMessage')}
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>

        {/* Message actions bottom sheet */}
        <Modal
          visible={!!selectedMessage}
          transparent
          animationType="fade"
          onRequestClose={() =>
            setSelectedMessage(null)
          }
        >
          <Pressable
            style={styles.modalOverlay}
            onPress={() => setSelectedMessage(null)}
          >
            <View
              style={[
                styles.actionSheet,
                {
                  backgroundColor:
                    theme.colors.surface,
                  paddingBottom: insets.bottom + 12,
                },
              ]}
            >
              <View style={styles.actionSheetHandle} />

              <Pressable
                onPress={handleStar}
                style={({ pressed }) => [
                  styles.actionItem,
                  pressed && {
                    backgroundColor:
                      theme.colors.surfaceVariant,
                  },
                ]}
              >
                <MaterialCommunityIcons
                  name={
                    selectedMessage?.isStarred
                      ? 'star-off-outline'
                      : 'star-outline'
                  }
                  size={22}
                  color={theme.colors.onSurface}
                />
                <Text
                  variant="bodyLarge"
                  style={{
                    marginStart: 16,
                    color: theme.colors.onSurface,
                  }}
                >
                  {selectedMessage?.isStarred
                    ? t('chats.unstar', 'Unstar')
                    : t('chats.star', 'Star')}
                </Text>
              </Pressable>

              <Pressable
                onPress={handleCopy}
                style={({ pressed }) => [
                  styles.actionItem,
                  pressed && {
                    backgroundColor:
                      theme.colors.surfaceVariant,
                  },
                ]}
              >
                <MaterialCommunityIcons
                  name="content-copy"
                  size={22}
                  color={theme.colors.onSurface}
                />
                <Text
                  variant="bodyLarge"
                  style={{
                    marginStart: 16,
                    color: theme.colors.onSurface,
                  }}
                >
                  {t('chats.copy', 'Copy')}
                </Text>
              </Pressable>

              <Pressable
                onPress={handleReply}
                style={({ pressed }) => [
                  styles.actionItem,
                  pressed && { backgroundColor: theme.colors.surfaceVariant },
                ]}
              >
                <MaterialCommunityIcons name="reply" size={22} color={theme.colors.onSurface} />
                <Text variant="bodyLarge" style={{ marginStart: 16, color: theme.colors.onSurface }}>
                  {t('chats.reply', 'Reply')}
                </Text>
              </Pressable>

              {/* Reactions row */}
              <View style={styles.reactionsRow}>
                {['👍', '❤️', '😂', '😮', '😢', '🙏', '✅', '🔥'].map((emoji) => (
                  <Pressable
                    key={emoji}
                    onPress={() => handleSendReaction(emoji)}
                    style={({ pressed }) => [styles.emojiBtn, pressed && { opacity: 0.6 }]}
                  >
                    <Text style={styles.emojiText}>{emoji}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          </Pressable>
        </Modal>

        {/* Quick Messages Bottom Sheet */}
        <Modal
          visible={showQuickMessages}
          transparent
          animationType="slide"
          onRequestClose={() => setShowQuickMessages(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={[styles.templateSheet, { backgroundColor: theme.colors.surface, paddingBottom: insets.bottom + 12 }]}>
              <View style={styles.actionSheetHandle} />
              <View style={styles.templateSheetHeader}>
                <Text variant="titleMedium" style={{ fontWeight: '700', color: theme.colors.onSurface, flex: 1 }}>
                  {t('chats.quickMessages')}
                </Text>
                <IconButton icon="close" size={20} onPress={() => setShowQuickMessages(false)} />
              </View>
              {isLoadingQuickMessages ? (
                <View style={styles.loadingContainer}>
                  <ActivityIndicator size="large" color={theme.colors.primary} />
                </View>
              ) : quickMessages.length === 0 ? (
                <View style={styles.emptyTemplates}>
                  <MaterialCommunityIcons name="lightning-bolt-outline" size={48} color={theme.colors.onSurfaceVariant} style={{ opacity: 0.4 }} />
                  <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant, marginTop: 12, textAlign: 'center' }}>
                    {t('chats.noQuickMessages', 'אין הודעות מהירות מוגדרות')}
                  </Text>
                </View>
              ) : (
                <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
                  {quickMessages.map((qm: any, idx: number) => (
                    <Pressable
                      key={qm.id || idx}
                      onPress={() => handleSelectQuickMessage(qm)}
                      style={({ pressed }) => [
                        styles.templateItem,
                        pressed && { backgroundColor: theme.colors.surfaceVariant },
                      ]}
                    >
                      <Text variant="bodyMedium" style={{ color: theme.colors.onSurface, fontWeight: '600' }} numberOfLines={1}>
                        {qm.title || qm.name || qm.shortcut || ''}
                      </Text>
                      <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: 2 }} numberOfLines={2}>
                        {qm.text || qm.message || qm.body || ''}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>
              )}
            </View>
          </View>
        </Modal>

        {/* Quick Actions Bottom Sheet */}
        <Modal
          visible={showQuickActionsSheet}
          transparent
          animationType="slide"
          onRequestClose={() => setShowQuickActionsSheet(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={[styles.templateSheet, { backgroundColor: theme.colors.surface, paddingBottom: insets.bottom + 12 }]}>
              <View style={styles.actionSheetHandle} />
              <View style={styles.templateSheetHeader}>
                <Text variant="titleMedium" style={{ fontWeight: '700', color: theme.colors.onSurface, flex: 1 }}>
                  {t('chats.quickActions', 'פעולות מהירות')}
                </Text>
                <IconButton icon="close" size={20} onPress={() => setShowQuickActionsSheet(false)} />
              </View>
              {[
                { icon: 'lightning-bolt', label: t('chats.quickMessages'), color: '#FF9800', action: () => { setShowQuickActionsSheet(false); handleQuickMessagePress(); } },
                { icon: 'clock-outline', label: t('chats.scheduleMessage', 'תזמן הודעה'), color: '#607D8B', action: () => { setShowQuickActionsSheet(false); setShowScheduleModal(true); } },
                { icon: 'clipboard-check-outline', label: t('tasks.addTask'), color: '#2196F3', action: () => { setShowQuickActionsSheet(false); setCreateTaskTitle(''); setCreateTaskDueDate(''); setCreateTaskPriority('medium'); setSelectedDate(null); setShowCreateTaskModal(true); } },
                { icon: 'account-plus-outline', label: t('leads.createLead', 'צור ליד'), color: '#4CAF50', action: () => { setShowQuickActionsSheet(false); router.push({ pathname: '/(tabs)/leads/[id]', params: { id: 'new', contactPhone: phoneNumber as string, prefillContactName: contactName } } as any); } },
                { icon: 'ticket-outline', label: t('cases.createCase', 'צור פנייה'), color: '#9C27B0', action: () => { setShowQuickActionsSheet(false); router.push({ pathname: '/(tabs)/more/cases/[id]', params: { id: 'new', contactPhone: phoneNumber as string, prefillContactName: contactName } } as any); } },
              ].map((item) => (
                <Pressable
                  key={item.label}
                  onPress={item.action}
                  style={({ pressed }) => [
                    styles.templateItem,
                    { flexDirection: isRTL ? 'row-reverse' : 'row', alignItems: 'center' },
                    pressed && { backgroundColor: theme.colors.surfaceVariant },
                  ]}
                >
                  <View style={[styles.quickActionIcon, { backgroundColor: `${item.color}20` }]}>
                    <MaterialCommunityIcons name={item.icon as any} size={22} color={item.color} />
                  </View>
                  <Text variant="bodyMedium" style={{ color: theme.colors.onSurface, fontWeight: '600', marginStart: 12 }}>
                    {item.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        </Modal>

        {/* Create Task Modal */}
        <Modal
          visible={showCreateTaskModal}
          transparent
          animationType="slide"
          onRequestClose={() => setShowCreateTaskModal(false)}
        >
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
            <View style={styles.modalOverlay}>
              <View style={[styles.templateSheet, { backgroundColor: theme.colors.surface, paddingBottom: insets.bottom + 12 }]}>
                <View style={styles.actionSheetHandle} />
                <View style={styles.templateSheetHeader}>
                  <Text variant="titleMedium" style={{ fontWeight: '700', color: theme.colors.onSurface, flex: 1 }}>
                    {t('tasks.addTask', 'הוסף משימה')}
                  </Text>
                  <IconButton icon="close" size={20} onPress={() => setShowCreateTaskModal(false)} />
                </View>
                <ScrollView style={{ paddingHorizontal: 16 }} contentContainerStyle={{ gap: 12, paddingBottom: 8 }} keyboardShouldPersistTaps="handled">
                  <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                    {t('tasks.taskTitle', 'כותרת')} *
                  </Text>
                  <TextInput
                    value={createTaskTitle}
                    onChangeText={setCreateTaskTitle}
                    placeholder={t('tasks.taskTitle', 'כותרת משימה')}
                    style={[styles.scheduleInput, { backgroundColor: theme.colors.surfaceVariant, color: theme.colors.onSurface, borderColor: theme.colors.outline }]}
                    placeholderTextColor={theme.colors.onSurfaceVariant}
                    autoFocus
                  />
                  <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                    {t('tasks.dueDate', 'תאריך יעד')}
                  </Text>
                  <Pressable
                    onPress={() => setShowDatePicker(true)}
                    style={[
                      styles.scheduleInput,
                      {
                        backgroundColor: theme.colors.surfaceVariant,
                        borderColor: theme.colors.outline,
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        paddingVertical: 12,
                      },
                    ]}
                  >
                    <Text style={{ color: selectedDate ? theme.colors.onSurface : theme.colors.onSurfaceVariant, fontSize: 14 }}>
                      {selectedDate
                        ? selectedDate.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' })
                        : t('tasks.selectDate', 'בחר תאריך')}
                    </Text>
                    <MaterialCommunityIcons name="calendar" size={18} color={theme.colors.onSurfaceVariant} />
                  </Pressable>
                  {showDatePicker && (
                    <DateTimePicker
                      value={selectedDate || new Date()}
                      mode="date"
                      display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                      minimumDate={new Date()}
                      onChange={(_, date) => {
                        setShowDatePicker(Platform.OS === 'ios');
                        if (date) {
                          setSelectedDate(date);
                          const iso = date.toISOString().split('T')[0];
                          setCreateTaskDueDate(iso);
                        }
                      }}
                    />
                  )}
                  <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                    {t('tasks.priority', 'עדיפות')}
                  </Text>
                  <View style={{ flexDirection: isRTL ? 'row-reverse' : 'row', gap: 8, marginBottom: 4 }}>
                    {(['low', 'medium', 'high'] as const).map((p) => (
                      <Pressable
                        key={p}
                        onPress={() => setCreateTaskPriority(p)}
                        style={[
                          styles.priorityChip,
                          createTaskPriority === p && { backgroundColor: '#2e615520', borderColor: '#2e6155', borderWidth: 1.5 },
                        ]}
                      >
                        <Text style={{ fontSize: 12, color: createTaskPriority === p ? '#2e6155' : theme.colors.onSurfaceVariant, fontWeight: createTaskPriority === p ? '700' : '400' }}>
                          {t(`tasks.${p}`, p)}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  {contactName ? (
                    <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                      {t('tasks.for', 'עבור')}: {contactName}
                    </Text>
                  ) : null}
                </ScrollView>
                <View style={[styles.scheduleActions, { paddingHorizontal: 16, marginTop: 12 }]}>
                  <Button mode="outlined" onPress={() => setShowCreateTaskModal(false)} style={{ flex: 1 }}>
                    {t('common.cancel', 'ביטול')}
                  </Button>
                  <Button
                    mode="contained"
                    onPress={handleCreateTaskInChat}
                    style={{ flex: 1 }}
                    buttonColor="#2e6155"
                    textColor="#fff"
                    loading={isCreatingTask}
                    disabled={isCreatingTask || !createTaskTitle.trim()}
                  >
                    {t('tasks.addTask', 'הוסף')}
                  </Button>
                </View>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>

        {/* / inline quick messages */}
        {showInlineQuickMessages && (() => {
          const filtered = quickMessages.filter((qm: any) => {
            if (!quickSlashFilter) return true;
            const sc = (qm.shortcut || qm.title || qm.name || '').toLowerCase();
            return sc.includes(quickSlashFilter.toLowerCase());
          });
          if (filtered.length === 0 && !isLoadingQuickMessages) return null;
          return (
            <View style={[styles.mentionPicker, { backgroundColor: theme.colors.surface, borderColor: theme.colors.outline, maxHeight: 220 }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.outline }}>
                <MaterialCommunityIcons name="lightning-bolt" size={16} color="#FF9800" />
                <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant, marginStart: 6 }}>
                  {t('chats.quickMessages')}
                </Text>
                <Pressable onPress={() => setShowInlineQuickMessages(false)} hitSlop={8} style={{ marginStart: 'auto' }}>
                  <MaterialCommunityIcons name="close" size={16} color={theme.colors.onSurfaceVariant} />
                </Pressable>
              </View>
              <ScrollView keyboardShouldPersistTaps="handled">
                {isLoadingQuickMessages ? (
                  <ActivityIndicator size="small" style={{ padding: 12 }} />
                ) : filtered.map((qm: any, idx: number) => (
                  <Pressable
                    key={qm.id || idx}
                    onPress={() => {
                      handleSelectQuickMessage(qm);
                      setShowInlineQuickMessages(false);
                      setQuickSlashFilter('');
                    }}
                    style={({ pressed }) => [styles.mentionItem, pressed && { backgroundColor: theme.colors.surfaceVariant }]}
                  >
                    <Text variant="bodySmall" style={{ color: '#FF9800', fontWeight: '700', minWidth: 60 }} numberOfLines={1}>
                      /{qm.shortcut || qm.title || qm.name || ''}
                    </Text>
                    <Text variant="bodySmall" style={{ color: theme.colors.onSurface, flex: 1, marginStart: 8 }} numberOfLines={1}>
                      {qm.text || qm.message || qm.body || ''}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          );
        })()}

        {/* @mention picker */}
        {showMentionPicker && isInternalNote && filteredMentionUsers.length > 0 && (
          <View style={[styles.mentionPicker, { backgroundColor: theme.colors.surface, borderColor: theme.colors.outline }]}>
            {filteredMentionUsers.map((u: any, idx: number) => (
              <Pressable
                key={u.userId || u.uID || idx}
                onPress={() => handleSelectMention(u)}
                style={({ pressed }) => [
                  styles.mentionItem,
                  pressed && { backgroundColor: theme.colors.surfaceVariant },
                ]}
              >
                <MaterialCommunityIcons name="account-circle-outline" size={18} color={theme.colors.primary} />
                <Text variant="bodyMedium" style={{ color: theme.colors.onSurface, marginStart: 8 }}>
                  {u.fullname || u.name || ''}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  header: {
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    zIndex: 10,
  },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 56,
    paddingRight: 4,
  },
  backBtn: {
    paddingHorizontal: 12,
    height: 56,
    justifyContent: 'center',
  },
  headerProfile: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerInfo: {
    flex: 1,
  },
  headerName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  headerStatus: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.75)',
    marginTop: 1,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  messagesContent: {
    paddingVertical: 8,
  },
  emptyMessages: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    transform: [{ scaleY: -1 }],
  },
  separatorWrap: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  separatorPill: {
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 12,
  },
  separatorText: {
    fontSize: 12,
    fontWeight: '500',
  },
  scrollDownBtn: {
    position: 'absolute',
    right: 14,
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 3,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  actionSheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 8,
  },
  actionSheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(128,128,128,0.3)',
    alignSelf: 'center',
    marginBottom: 8,
  },
  actionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  modeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 6,
  },
  modeBannerText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
  },
  closedBanner: {
    paddingHorizontal: 16,
    paddingTop: 14,
    borderTopWidth: 1,
    gap: 12,
  },
  closedBannerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  closedBannerActions: {
    flexDirection: 'row',
    gap: 10,
  },
  closedBannerBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 10,
  },
  closedBannerBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  templateSheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 8,
    maxHeight: '80%',
  },
  templateSheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  emptyTemplates: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  templateItem: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(128,128,128,0.15)',
  },
  reactionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(128,128,128,0.2)',
  },
  emojiBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
  },
  emojiText: {
    fontSize: 24,
  },
  searchBarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  searchBarInput: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 4,
  },
  mentionPicker: {
    position: 'absolute',
    bottom: 70,
    left: 0,
    right: 0,
    maxHeight: 200,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  mentionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(128,128,128,0.15)',
  },
  scheduleForm: {
    paddingHorizontal: 16,
    paddingTop: 4,
  },
  scheduleInput: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    minHeight: 44,
  },
  scheduleSubmitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 10,
    marginTop: 16,
  },
  quickActionIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  priorityChip: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  timelineItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginHorizontal: 12,
    marginVertical: 3,
    padding: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  timelineIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
});
