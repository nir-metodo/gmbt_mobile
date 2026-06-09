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
  FlatList,
  ScrollView,
  Pressable,
  Modal,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
  Linking,
  TextInput,
  BackHandler,
  Keyboard,
  AppState,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Text, IconButton, Menu, Avatar, Button, Divider } from 'react-native-paper';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import {
  useRouter,
  useLocalSearchParams,
  Stack,
  useFocusEffect,
} from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
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
import {
  getChatConversationStatus,
  conversationStatusLabel,
  conversationStatusColors,
} from '../../../utils/conversationStatus';

import WebSocketService from '../../../services/websocket';
import { MessageBubble } from '../../../components/chat/MessageBubble';
import { ChatInput, ChatInputRef, ReplyPreview } from '../../../components/chat/ChatInput';
import { MediaPanel } from '../../../components/chat/MediaPanel';
import { ContactInfoSheet } from '../../../components/chat/ContactInfoSheet';
import { chatsApi } from '../../../services/api/chats';
import { contactsApi } from '../../../services/api/contacts';
import { usersApi } from '../../../services/api/users';
import { tasksApi } from '../../../services/api/tasks';
import { phoneCallsApi } from '../../../services/api/phoneCalls';
import { makeGambotCall } from '../../../utils/phoneCall';
import { prefetchMediaList } from '../../../services/mediaPrefetcher';
import axiosInstance from '../../../services/api/axiosInstance';
import { ENDPOINTS } from '../../../constants/api';
import type { MediaType } from '../../../services/mediaCache';
import type { Message, Template, QuickMessage, WabaNumberInfo } from '../../../types';

type ListItem =
  | {
      kind: 'message';
      data: Message;
      isOutbound: boolean;
      showTail: boolean;
    }
  | { kind: 'separator'; date: string; id: string }
  | { kind: 'timeline'; data: any; id: string };

function parseTimestamp(raw: any): number {
  if (!raw) return 0;
  if (typeof raw === 'number') return raw > 1e12 ? raw : raw * 1000;
  if (typeof raw === 'object' && raw._seconds) return raw._seconds * 1000;
  if (typeof raw === 'object' && raw.seconds) return raw.seconds * 1000;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

function getTs(msg: Message): string {
  const raw = (msg as any).createdOn || (msg as any).timestamp || '';
  if (typeof raw === 'object') {
    const ms = parseTimestamp(raw);
    return ms > 0 ? new Date(ms).toISOString() : '';
  }
  return raw;
}

function getDateKey(timestamp?: string): string {
  if (!timestamp) return '';
  try {
    if (typeof timestamp === 'object') {
      const ms = parseTimestamp(timestamp);
      return ms > 0 ? new Date(ms).toISOString().split('T')[0] : '';
    }
    const d = new Date(timestamp);
    if (isNaN(d.getTime())) return '';
    return d.toISOString().split('T')[0];
  } catch {
    return '';
  }
}

export default function ChatConversationScreen() {
  const { phoneNumber, defaultWabaNumber } = useLocalSearchParams<{
    phoneNumber: string;
    defaultWabaNumber?: string;
  }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useAppTheme();
  const { isRTL } = useRTL();
  const { t, i18n } = useTranslation();
  const lang = i18n.language as 'en' | 'he';

  const user = useAuthStore((s) => s.user);
  const chat = useChatStore((s) =>
    s.chats.find((c) => (c.phoneNumber || '').replace(/\D/g, '') === (String(phoneNumber || '')).replace(/\D/g, '')),
  );
  const currentMessages = useChatStore((s) => s.currentMessages);
  const isLoadingMessages = useChatStore((s) => s.isLoadingMessages);
  const isLoadingOlderMessages = useChatStore((s) => s.isLoadingOlderMessages);
  const hasMoreMessages = useChatStore((s) => s.hasMoreMessages);
  const isSending = useChatStore((s) => s.isSending);
  const loadMessages = useChatStore((s) => s.loadMessages);
  const loadOlderMessages = useChatStore((s) => s.loadOlderMessages);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const sendInternalMessage = useChatStore(
    (s) => s.sendInternalMessage,
  );
  const markAsRead = useChatStore((s) => s.markAsRead);
  const toggleStarred = useChatStore((s) => s.toggleStarred);
  const addMessage = useChatStore((s) => s.addMessage);
  const updateMessage = useChatStore((s) => s.updateMessage);
  const clearCurrentChat = useChatStore((s) => s.clearCurrentChat);
  const addOrUpdateChat = useChatStore((s) => s.addOrUpdateChat);
  const activeWabaNumber = useChatStore((s) => s.activeWabaNumber);
  const setActiveWabaNumber = useChatStore((s) => s.setActiveWabaNumber);

  const [isInternalNote, setIsInternalNote] = useState(false);
  const [messageMode, setMessageMode] = useState<'regular' | 'internal'>('regular');
  const [menuVisible, setMenuVisible] = useState(false);
  const [mediaPanelVisible, setMediaPanelVisible] = useState(false);
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
  // Quick / Manual tab state inside template modal
  const [templateActiveTab, setTemplateActiveTab] = useState<'quick' | 'manual'>('quick');
  const [quickTemplateSearch, setQuickTemplateSearch] = useState('');
  const [quickOpenVarValues, setQuickOpenVarValues] = useState<Record<string, string>>({});
  const flatListRef = useRef<FlashList<ListItem>>(null);
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

  // Outbound calling
  const [isInitiatingCall, setIsInitiatingCall] = useState(false);
  const [telSettings, setTelSettings] = useState<{ phoneNumbers?: any[]; defaultCallerId?: string } | null>(null);

  // Media gallery viewer
  const [galleryVisible, setGalleryVisible] = useState(false);
  const [galleryIndex, setGalleryIndex] = useState(0);

  // Contact Info sheet (category, status, lead stage, tags, timeline)
  const [showContactInfoSheet, setShowContactInfoSheet] = useState(false);

  // Attachment sheet
  const [showAttachSheet, setShowAttachSheet] = useState(false);

  // Quick Actions sheet
  const [showQuickActionsSheet, setShowQuickActionsSheet] = useState(false);

  // Add Note modal
  const [showAddNoteModal, setShowAddNoteModal] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  // Inline tag input
  const [showAddTagInline, setShowAddTagInline] = useState(false);
  const [newTagText, setNewTagText] = useState('');

  // Assign Owner modal
  const [showAssignOwnerModal, setShowAssignOwnerModal] = useState(false);
  const [availableOwners, setAvailableOwners] = useState<any[]>([]);
  const [isLoadingOwners, setIsLoadingOwners] = useState(false);
  const [assigningOwner, setAssigningOwner] = useState(false);

  // Create Task from chat
  const [showCreateTaskModal, setShowCreateTaskModal] = useState(false);
  const [createTaskTitle, setCreateTaskTitle] = useState('');
  const [createTaskDueDate, setCreateTaskDueDate] = useState('');
  const [createTaskPriority, setCreateTaskPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [isCreatingTask, setIsCreatingTask] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

  const contactName = chat?.contactName || phoneNumber || '';

  const [orgWabaNumbers, setOrgWabaNumbers] = useState<WabaNumberInfo[]>([]);
  const assignedNums = user?.assignedWhatsAppNumbers || [];

  // Fetch org numbers from API
  useEffect(() => {
    if (!user?.organization) return;
    axiosInstance.get(ENDPOINTS.GET_WHATSAPP_NUMBERS, { params: { organization: user.organization } })
      .then((res) => {
        const nums: WabaNumberInfo[] = res.data?.Numbers || res.data?.numbers || [];
        if (Array.isArray(nums) && nums.length > 0) {
          setOrgWabaNumbers(nums);
        }
      }).catch(() => {});
  }, [user?.organization]);

  const allWabaNumbers: WabaNumberInfo[] = orgWabaNumbers.length > 0
    ? orgWabaNumbers
    : (user?.wabaNumbers || (user?.wabaNumber ? [{ PhoneNumberId: user.wabaNumber, DisplayNumber: user.wabaNumber }] : []));

  // If user has assigned numbers, restrict wabaNumbers to only those they have access to
  const wabaNumbers = useMemo((): WabaNumberInfo[] => {
    if (assignedNums.length === 0) return allWabaNumbers;
    return allWabaNumbers.filter((n) => {
      const id = n.PhoneNumberId || n.phoneNumberId || '';
      return assignedNums.includes(id);
    });
  }, [allWabaNumbers, assignedNums]);

  useEffect(() => {
    if (defaultWabaNumber && wabaNumbers.some((n) => (n.PhoneNumberId || n.phoneNumberId) === defaultWabaNumber)) {
      setActiveWabaNumber(defaultWabaNumber);
    } else if (!activeWabaNumber) {
      if (assignedNums.length > 0) {
        setActiveWabaNumber(assignedNums[0]);
      } else if (wabaNumbers.length > 0) {
        setActiveWabaNumber(wabaNumbers[0].PhoneNumberId || wabaNumbers[0].phoneNumberId || user?.wabaNumber || '');
      } else if (user?.wabaNumber) {
        setActiveWabaNumber(user.wabaNumber);
      }
    }
  }, [user?.wabaNumber, activeWabaNumber, setActiveWabaNumber, wabaNumbers, defaultWabaNumber]);

  const [conversationLive, setConversationLive] = useState<boolean | null>(null);
  const [recipientReplied24h, setRecipientReplied24h] = useState<boolean | null>(null);
  const [conversationExpiresAt, setConversationExpiresAt] = useState<string | null>(null);
  const [isFreeEntryPoint, setIsFreeEntryPoint] = useState(false);
  const [freeWindowExpiresAt, setFreeWindowExpiresAt] = useState<string | null>(null);
  const [countdownNow, setCountdownNow] = useState(Date.now());
  const [chatStatus, setChatStatus] = useState<string>('');
  const [chatCategory, setChatCategory] = useState<string>('');
  const [orgCategories, setOrgCategories] = useState<string[]>([]);
  const [showStatusMenu, setShowStatusMenu] = useState(false);
  const [showCategoryMenu, setShowCategoryMenu] = useState(false);

  // Lead / Case (פנייה) CRM — surfaced inline in the meta bar (mirrors the web chat header)
  const [contactLeads, setContactLeads] = useState<any[]>([]);
  const [contactCases, setContactCases] = useState<any[]>([]);
  const [pipelineStages, setPipelineStages] = useState<any[]>([]);
  const [caseStages, setCaseStages] = useState<any[]>([]);
  const [showLeadStageMenu, setShowLeadStageMenu] = useState(false);
  const [showCaseStageMenu, setShowCaseStageMenu] = useState(false);

  const statusRequestIdRef = useRef(0);

  const fetchConversationStatus = useCallback(() => {
    if (!user?.organization || !phoneNumber) return;
    const requestId = ++statusRequestIdRef.current;
    chatsApi.getConversationStatus(user.organization, phoneNumber as string, activeWabaNumber || undefined).then((res) => {
      if (requestId !== statusRequestIdRef.current) return; // ignore stale responses
      const live = res?.IsConversationLive ?? res?.IsConversationLiveByPhoneNumber ?? res?.isConversationLive ?? res?.isLive;
      setConversationLive(live === true || live === 'true');
      const replied = res?.IsRecipientReplyLast24Hours ?? res?.isRecipientReplyLast24Hours;
      setRecipientReplied24h(replied === true || replied === 'true');
      const expires = res?.ConversationExpiresAt ?? res?.conversationExpiresAt;
      setConversationExpiresAt(expires || null);
      const freeEntry = res?.IsFreeEntryPoint ?? res?.isFreeEntryPoint;
      setIsFreeEntryPoint(freeEntry === true || freeEntry === 'true');
      const freeExpires = res?.FreeWindowExpiresAt ?? res?.freeWindowExpiresAt;
      setFreeWindowExpiresAt(freeExpires || null);
      const cat = res?.Category ?? res?.category ?? '';
      if (cat) setChatCategory(cat);
    }).catch(() => {
      if (requestId !== statusRequestIdRef.current) return;
      // On network/auth error, preserve any previously-known live state rather than
      // defaulting to closed — a transient failure should not kill the chat window.
      setConversationLive((prev) => (prev !== null ? prev : false));
      setRecipientReplied24h((prev) => (prev !== null ? prev : false));
    });
  }, [user?.organization, phoneNumber, activeWabaNumber]);

  useEffect(() => {
    fetchConversationStatus();
  }, [fetchConversationStatus]);

  // Reset all conversation state when switching to a different chat.
  // Pre-fill from the store immediately so the UI shows the last known state
  // instead of flickering blank/closed while the API call is in flight.
  useEffect(() => {
    setChatStatus(chat?.lastConversationStatus || '');
    setChatCategory(chat?.lastConversationCategory || '');
    setConversationLive(null);
    setRecipientReplied24h(null);
    setConversationExpiresAt(null);
    setIsFreeEntryPoint(false);
    setFreeWindowExpiresAt(null);
  }, [phoneNumber]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-sync status/category when the store updates (e.g. after WS push or refetch).
  // No !chatStatus guard — always apply so switching between chats is correct.
  useEffect(() => {
    if (chat?.lastConversationStatus) setChatStatus(chat.lastConversationStatus);
    if (chat?.lastConversationCategory) setChatCategory(chat.lastConversationCategory);
  }, [chat?.lastConversationStatus, chat?.lastConversationCategory, phoneNumber]);

  // Also reset WS-derived state when WABA number changes (multi-number orgs)
  useEffect(() => {
    setConversationLive(null);
    setRecipientReplied24h(null);
    setConversationExpiresAt(null);
    setIsFreeEntryPoint(false);
    setFreeWindowExpiresAt(null);
  }, [activeWabaNumber]);

  // Tick countdown every second while conversation is live
  useEffect(() => {
    if (!conversationLive || !conversationExpiresAt) return;
    const interval = setInterval(() => setCountdownNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [conversationLive, conversationExpiresAt]);

  useEffect(() => {
    if (!user?.organization) return;
    chatsApi.getConversationCategories(user.organization)
      .then((cats) => setOrgCategories(cats))
      .catch(() => {});
  }, [user?.organization]);

  const handleChangeStatus = useCallback(async (newStatus: string) => {
    if (!user?.organization || !phoneNumber) return;
    setShowStatusMenu(false);
    setChatStatus(newStatus);
    addOrUpdateChat({ phoneNumber: phoneNumber as string, lastConversationStatus: newStatus, status: newStatus } as any);
    try {
      await chatsApi.updateConversationStatus(user.organization, phoneNumber as string, newStatus, user.uID || user.userId);
    } catch { }
  }, [user?.organization, phoneNumber, user?.uID, user?.userId, addOrUpdateChat]);

  const handleChangeCategory = useCallback(async (newCategory: string) => {
    if (!user?.organization || !phoneNumber) return;
    setShowCategoryMenu(false);
    setChatCategory(newCategory);
    addOrUpdateChat({ phoneNumber: phoneNumber as string, lastConversationCategory: newCategory, category: newCategory } as any);
    try {
      await chatsApi.updateConversationCategory(user.organization, phoneNumber as string, newCategory);
    } catch { }
  }, [user?.organization, phoneNumber, addOrUpdateChat]);

  // ── Lead / Case (פנייה) records for this contact ──────────────────────
  const loadCrmRecords = useCallback(async () => {
    if (!user?.organization || !phoneNumber) return;
    const organization = user.organization;
    const [leadsRes, stagesRes, casesRes, caseSettingsRes] = await Promise.allSettled([
      axiosInstance.post(ENDPOINTS.GET_LEADS_BY_CONTACT, { organization, phoneNumber }),
      axiosInstance.post(ENDPOINTS.GET_PIPELINE_SETTINGS, { organization }),
      axiosInstance.post(ENDPOINTS.GET_CASES_BY_CONTACT, { organization, phoneNumber }),
      axiosInstance.post(ENDPOINTS.GET_CASE_SETTINGS, { organization }),
    ]);
    if (leadsRes.status === 'fulfilled') {
      const raw = leadsRes.value.data;
      setContactLeads(Array.isArray(raw) ? raw : raw?.Data || raw?.data || []);
    }
    if (stagesRes.status === 'fulfilled') {
      const raw = stagesRes.value.data;
      const stages = raw?.stages || raw?.Data?.stages || raw?.Stages || [];
      setPipelineStages(Array.isArray(stages) ? stages : []);
    }
    if (casesRes.status === 'fulfilled') {
      const raw = casesRes.value.data;
      setContactCases(Array.isArray(raw) ? raw : raw?.Data || raw?.data || []);
    }
    if (caseSettingsRes.status === 'fulfilled') {
      const raw = caseSettingsRes.value.data;
      const stages = raw?.stages || raw?.Data?.stages || raw?.Stages || [];
      setCaseStages(Array.isArray(stages) ? stages : []);
    }
  }, [user?.organization, phoneNumber]);

  useEffect(() => {
    setContactLeads([]);
    setContactCases([]);
    loadCrmRecords();
  }, [loadCrmRecords]);

  // First lead/case is the "active" one shown inline (matches web behavior).
  const activeLead = contactLeads[0] || null;
  const activeCase = contactCases[0] || null;

  const handleMoveLeadStage = useCallback(async (stage: any) => {
    setShowLeadStageMenu(false);
    if (!user?.organization || !activeLead) return;
    const stageId = stage.id || stage.Id;
    const stageName = stage.name || stage.Name || stage.stageName;
    setContactLeads((prev) => prev.map((l) => (l.id === activeLead.id ? { ...l, stageId, stageName } : l)));
    try {
      await axiosInstance.post(ENDPOINTS.MOVE_LEAD_STAGE, {
        organization: user.organization, leadId: activeLead.id, stageId, stageName,
      });
    } catch { }
  }, [user?.organization, activeLead]);

  const handleMoveCaseStage = useCallback(async (stage: any) => {
    setShowCaseStageMenu(false);
    if (!user?.organization || !activeCase) return;
    const stageId = stage.id || stage.Id;
    const stageName = stage.name || stage.Name || stage.stageName;
    setContactCases((prev) => prev.map((c) => (c.id === activeCase.id ? { ...c, stageId, stageName } : c)));
    try {
      await axiosInstance.post(ENDPOINTS.UPDATE_CASE, {
        organization: user.organization, caseId: activeCase.id, stageId, stageName,
      });
    } catch { }
  }, [user?.organization, activeCase]);

  const openLeadRecord = useCallback(() => {
    if (!activeLead?.id) return;
    setShowLeadStageMenu(false);
    router.push({ pathname: '/(tabs)/leads/[id]', params: { id: activeLead.id } } as any);
  }, [activeLead, router]);

  const openCaseRecord = useCallback(() => {
    if (!activeCase?.id) return;
    setShowCaseStageMenu(false);
    router.push({ pathname: '/(tabs)/more/cases/[id]', params: { id: activeCase.id } } as any);
  }, [activeCase, router]);

  const handleAddTag = useCallback(async (tag: string) => {
    if (!user?.organization || !phoneNumber || !tag.trim()) return;
    const trimmedTag = tag.trim();
    const currentTags = chat?.tags || [];
    if (currentTags.includes(trimmedTag)) return;
    const newTags = [...currentTags, trimmedTag];
    addOrUpdateChat({ phoneNumber: phoneNumber as string, tags: newTags } as any);
    setNewTagText('');
    setShowAddTagInline(false);
    try {
      const { contactsApi } = require('../../../services/api');
      await contactsApi.update(user.organization, { phoneNumber: phoneNumber as string, tags: newTags }, user.uID || user.userId, user.fullname);
    } catch (e) {
      console.warn('Failed to add tag:', e);
    }
  }, [user?.organization, phoneNumber, chat?.tags, addOrUpdateChat, user?.uID, user?.userId, user?.fullname]);

  // Load telephony settings for outbound calling
  useEffect(() => {
    if (!user?.organization) return;
    phoneCallsApi.getTelephonySettings(user.organization)
      .then((data) => { if (data?.phoneNumbers?.length) setTelSettings(data); })
      .catch(() => {});
  }, [user?.organization]);

  const handleInitiateCall = useCallback(async () => {
    if (!user?.organization || !phoneNumber || isInitiatingCall) return;

    const agentPhone = (user as any)?.phoneNumber || (user as any)?.PhoneNumber || (user as any)?.phone;
    const fromNumber = telSettings?.defaultCallerId || telSettings?.phoneNumbers?.[0]?.number;

    if (!agentPhone) {
      Alert.alert(
        t('phoneCalls.gambotCallTitle', 'Gambot Call'),
        t('phoneCalls.noAgentPhone', 'No phone number configured for your account. Go to settings to add one.'),
      );
      return;
    }
    if (!fromNumber) {
      Linking.openURL(`tel:${phoneNumber}`);
      return;
    }

    setIsInitiatingCall(true);
    try {
      const result = await makeGambotCall({
        phoneNumber: phoneNumber as string,
        organization: user.organization,
        agentPhone,
        fromPhoneNumber: fromNumber,
        agentId: user.uID || user.userId || '',
        agentName: user.fullname || user.FullName || '',
        customerName: contactName,
      });

      if (result.success) {
        Alert.alert(
          t('phoneCalls.gambotCallTitle', 'Gambot Call'),
          t('phoneCalls.callInitiated', 'Call initiated. Your phone will ring shortly.'),
        );
      } else {
        Alert.alert(t('common.error'), t('phoneCalls.gambotCallFailed', 'Failed to initiate call'));
      }
    } catch {
      Alert.alert(t('common.error'), t('phoneCalls.gambotCallFailed', 'Failed to initiate call'));
    } finally {
      setIsInitiatingCall(false);
    }
  }, [user, phoneNumber, isInitiatingCall, telSettings, contactName, t]);

  // Load timeline entries
  useEffect(() => {
    if (!user?.organization || !phoneNumber) return;
    setTimelineEntries([]);
    chatsApi.getChatTimeline(user.organization, phoneNumber as string)
      .then(setTimelineEntries)
      .catch(() => setTimelineEntries([]));
  }, [user?.organization, phoneNumber]);

  // Save note to timeline
  const handleSaveNote = useCallback(async () => {
    if (!noteText.trim() || !user?.organization || !phoneNumber) return;
    setSavingNote(true);
    try {
      const { contactsApi } = await import('../../../services/api/contacts');
      await contactsApi.addTimelineEntry(
        user.organization,
        phoneNumber as string,
        noteText.trim(),
        user.userId || user.uid || '',
        user.fullname || user.displayName || ''
      );
      setNoteText('');
      setShowAddNoteModal(false);
      chatsApi.getChatTimeline(user.organization, phoneNumber as string)
        .then(setTimelineEntries)
        .catch(() => {});
    } catch (e) {
      Alert.alert(isRTL ? 'שגיאה' : 'Error', isRTL ? 'שמירת ההערה נכשלה' : 'Failed to save note');
    } finally {
      setSavingNote(false);
    }
  }, [noteText, user, phoneNumber, isRTL]);

  // Load available owners for assign
  const handleOpenAssignOwner = useCallback(async () => {
    if (!user?.organization) return;
    setIsLoadingOwners(true);
    try {
      const users = await usersApi.getAll(user.organization);
      setAvailableOwners(Array.isArray(users) ? users : []);
    } catch {
      setAvailableOwners([]);
    } finally {
      setIsLoadingOwners(false);
    }
  }, [user?.organization]);

  useEffect(() => {
    if (showAssignOwnerModal) handleOpenAssignOwner();
  }, [showAssignOwnerModal, handleOpenAssignOwner]);

  const handleAssignOwner = useCallback(async (ownerId: string, ownerName: string) => {
    if (!user?.organization || !phoneNumber) return;
    setAssigningOwner(true);
    try {
      await contactsApi.updateOwner(user.organization, phoneNumber as string, ownerId, user.fullname || user.displayName || 'system');
      setShowAssignOwnerModal(false);
      Alert.alert('✅', isRTL ? `בעלות שויכה ל-${ownerName}` : `Assigned to ${ownerName}`);
    } catch {
      Alert.alert(isRTL ? 'שגיאה' : 'Error', isRTL ? 'שיוך הבעלות נכשל' : 'Failed to assign owner');
    } finally {
      setAssigningOwner(false);
    }
  }, [user?.organization, phoneNumber, isRTL]);

  const isStatusLoading = conversationLive === null;

  // Match web ChatContainer: free text only when customer replied in 24h AND window is open AND conversation is live
  const canSendFreeText = useMemo(() => {
    if (isStatusLoading) return false;
    if (conversationLive !== true) return false;
    if (recipientReplied24h !== true) return false;
    if (conversationExpiresAt) {
      const now = new Date();
      const expiresAt = new Date(conversationExpiresAt);
      if (now >= expiresAt) return false;
    }
    return true;
  }, [isStatusLoading, conversationLive, recipientReplied24h, conversationExpiresAt]);

  const isFreeWindowActive = useMemo(() => {
    if (!freeWindowExpiresAt) return false;
    return new Date() < new Date(freeWindowExpiresAt);
  }, [freeWindowExpiresAt, countdownNow]);

  const showFreeTemplateWindow = !canSendFreeText && isFreeEntryPoint && isFreeWindowActive;

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

  const handleSendDefaultTemplate = useCallback(async () => {
    if (!user?.organization || !phoneNumber || isSendingTemplate) return;
    setIsSendingTemplate(true);
    setShowTemplateSelector(false);
    try {
      let templateId = '';
      if (activeWabaNumber && allWabaNumbers.length > 1) {
        const selectedNum = allWabaNumbers.find((n) => (n.PhoneNumberId || n.phoneNumberId) === activeWabaNumber);
        if (selectedNum?.DefaultTemplateId || selectedNum?.defaultTemplateId) {
          templateId = selectedNum.DefaultTemplateId || selectedNum.defaultTemplateId || '';
        }
      }

      let savedMappings: any[] = [];
      if (!templateId) {
        const defRes = await axiosInstance.post(ENDPOINTS.GET_DEFAULT_MESSAGE_TEMPLATES, { organization: user.organization });
        const tplAssignment = defRes.data?.Data?.templates?.openConversation;
        templateId = Array.isArray(tplAssignment?.templateId)
          ? (tplAssignment.templateId[0] || '')
          : (tplAssignment?.templateId || '');
        savedMappings = Array.isArray(tplAssignment?.varMappings)
          ? tplAssignment.varMappings.filter((m: any) => !Array.isArray(m.index) && m.index != null)
          : [];
      }

      if (!templateId) {
        Alert.alert(t('common.error'), t('chats.noDefaultTemplate', 'לא הוגדרה תבנית ברירת מחדל'));
        return;
      }

      // Resolve template variables like the web does
      const resolveVarValue = (source: string, hardcodedValue?: string) => {
        if (source === 'hardcoded') return hardcodedValue || '';
        if (source === 'contact.firstName') return chat?.contactName || (phoneNumber as string) || '';
        if (source === 'contact.lastName') return '';
        if (source === 'contact.name') return chat?.contactName || (phoneNumber as string) || '';
        if (source === 'contact.email') return chat?.email || '';
        if (source === 'contact.phoneNumber') return (phoneNumber as string) || '';
        if (source === 'user.organization') return user?.organization || '';
        if (source === 'user.UserName') return user?.fullname || user?.displayName || '';
        return '';
      };

      const makeVarEntry = (idx: number, value: string, label?: string) => ({
        index: idx,
        bodyVarIndex: idx,
        Variable: `dynamic_var${idx}`,
        variableLabel: label || `{{${idx}}}`,
        dataSource1: 'data_source1_HardCoded',
        dataSource2: '',
        conditionOperator: '',
        parameters_hardCoded_Text: value,
        field1: [],
        field2: [],
        table1: '',
        table2: '',
        retrieveFields: [],
      });

      let templateVariableQuery: any[];
      if (savedMappings.length > 0) {
        templateVariableQuery = savedMappings.map((m: any) =>
          makeVarEntry(m.index, resolveVarValue(m.source, m.hardcodedValue), m.label || `{{${m.index}}}`)
        );
      } else {
        templateVariableQuery = [
          makeVarEntry(1, chat?.contactName || (phoneNumber as string) || '', 'שם לקוח'),
          makeVarEntry(2, user?.fullname || user?.displayName || user?.organization || '', 'שם משתמש'),
        ];
      }

      const result = await chatsApi.sendTemplateMessage(
        user.organization,
        phoneNumber as string,
        templateId,
        user.userId,
        templateVariableQuery,
        activeWabaNumber || user.wabaNumber || '',
      );
      if (result?.Success === false) {
        const rawMsg = result?.Message || '';
        const friendlyMsg = rawMsg.includes('BadRequest')
          ? (isRTL ? 'התבנית טרם אושרה על ידי Meta — המתן לאישור ונסה שוב' : 'Template not yet approved by Meta')
          : rawMsg || t('chats.templateSendError');
        throw new Error(friendlyMsg);
      }
      loadMessages(user.organization, phoneNumber as string);
      // Don't call fetchConversationStatus - template send does NOT open the conversation window
      // Only inbound messages from the customer open the window
      setConversationLive(true);
      setRecipientReplied24h(false); // Waiting for customer reply
    } catch (err: any) {
      const msg = err?.response?.data?.Message || err?.message || t('chats.templateSendError');
      Alert.alert(t('common.error'), msg);
    } finally {
      setIsSendingTemplate(false);
    }
  }, [user, phoneNumber, isSendingTemplate, activeWabaNumber, allWabaNumbers, chat, loadMessages, isRTL, t]);

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
          activeWabaNumber || user.wabaNumber || '',
        );
        if (result?.Success === false) {
          throw new Error(result?.Message || t('chats.templateSendError'));
        }
        setSelectedTemplateForVars(null);
        setTemplateVariableValues({});
        loadMessages(user.organization, phoneNumber);
        // Template send does NOT open conversation - set waiting for reply state
        setConversationLive(true);
        setRecipientReplied24h(false);
      } catch (err: any) {
        const msg = err?.response?.data?.Message || err?.message || t('chats.templateSendError');
        Alert.alert(t('common.error'), msg);
      } finally {
        setIsSendingTemplate(false);
      }
    },
    [user, phoneNumber, loadMessages, t, fetchConversationStatus, activeWabaNumber],
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

  // Quick send helpers
  const resolveQuickVar = useCallback((entity: string, field: string): string => {
    if (!entity || entity === 'open') return '';

    if (entity === 'contact') {
      if (field === 'name')       return chat?.contactName || (phoneNumber as string) || '';
      if (field === 'firstName')  return (chat?.contactName || '').split(' ')[0] || '';
      if (field === 'lastName')   return (chat?.contactName || '').split(' ').slice(1).join(' ') || '';
      if (field === 'phone')      return (phoneNumber as string) || '';
      if (field === 'email')      return (chat as any)?.email || '';
      if (field === 'city')       return (chat as any)?.city || '';
      if (field === 'address')    return (chat as any)?.address || '';
      if (field === 'company')    return (chat as any)?.company || '';
      return (chat as any)?.[field] || '';
    }

    if (entity === 'user') {
      if (field === 'name' || field === 'displayName') return user?.fullname || user?.displayName || '';
      if (field === 'email')   return (user as any)?.email || '';
      if (field === 'phone')   return (user as any)?.phone || '';
      if (field === 'role')    return (user as any)?.role || '';
      return '';
    }

    if (entity === 'org') {
      if (field === 'name')    return user?.organization || '';
      if (field === 'phone')   return (user as any)?.orgPhone || '';
      if (field === 'email')   return (user as any)?.orgEmail || '';
      if (field === 'website') return (user as any)?.orgWebsite || '';
      return '';
    }

    // Server-side entities — return marker for preview
    const serverLabels: Record<string, Record<string, string>> = {
      lead:          { price: 'מחיר ליד', status: 'סטטוס ליד', notes: 'הערות', source: 'מקור', title: 'כותרת', assignedTo: 'שויך', pipelineStage: 'שלב' },
      case:          { subject: 'נושא', status: 'סטטוס', priority: 'עדיפות', category: 'קטגוריה', description: 'תיאור', assignedTo: 'שויך', notes: 'הערות' },
      quote:         { number: 'מס׳ הצעה', total: 'סה"כ', status: 'סטטוס', expiryDate: 'תפוגה', notes: 'הערות', title: 'כותרת' },
      dynamic_table: {},
    };
    if (serverLabels[entity]) {
      return `[${serverLabels[entity][field] || field}]`;
    }

    return '';
  }, [chat, phoneNumber, user]);

  const quickTemplates = useMemo(() =>
    templates.filter(t => t.showInQuickSend),
  [templates]);

  const handleQuickTemplateSend = useCallback((template: Template) => {
    let mapping: Array<{index: number; entity: string; field: string}> = [];
    try { mapping = JSON.parse(template.variableMappingJson || '[]'); } catch {}

    const bodyComp = (template.components || []).find((c: any) => c.type === 'BODY');
    const bodyText = bodyComp?.text || '';
    const varMatches = [...bodyText.matchAll(/\{\{(\d+)\}\}/g)];
    const varIndices = [...new Set(varMatches.map((m: RegExpMatchArray) => parseInt(m[1])))].sort((a, b) => a - b) as number[];

    const hasOpenVars = varIndices.some(idx => {
      const mapEntry = mapping.find(m => m.index === idx);
      return !mapEntry || mapEntry.entity === 'open';
    });

    if (hasOpenVars) {
      // Show variable inputs for open vars
      setQuickOpenVarValues({});
      setSelectedTemplateForVars({ ...template, _quickMode: true } as any);
      return;
    }

    const templateVariableQuery = varIndices.map((idx, i) => {
      const mapEntry = mapping.find(m => m.index === idx);
      const entity = mapEntry?.entity || 'open';
      const field  = mapEntry?.field  || '';
      return {
        index: i,
        Variable: `{{${idx}}}`,
        dataSource1: 'data_source1_HardCoded',
        parameters_hardCoded_Text: resolveQuickVar(entity, field),
      };
    });

    doSendTemplate(template, templateVariableQuery);
  }, [resolveQuickVar, doSendTemplate]);

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
        activeWabaNumber || user.wabaNumber || '',
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
  }, [user, phoneNumber, scheduleText, scheduledDateTime, scheduleDate, scheduleTime, t, activeWabaNumber]);

  // Tab bar is hidden by the layout via useSegments detection

  // Handle hardware back button
  useEffect(() => {
    const onBackPress = () => {
      if (showAttachSheet) { setShowAttachSheet(false); return true; }
      if (menuVisible) { setMenuVisible(false); return true; }
      if (searchVisible) { setSearchVisible(false); setSearchQuery(''); return true; }
      if (showContactInfoSheet) { setShowContactInfoSheet(false); return true; }
      if (mediaPanelVisible) { setMediaPanelVisible(false); return true; }
      if (showQuickActionsSheet) { setShowQuickActionsSheet(false); return true; }
      if (showInlineQuickMessages) { setShowInlineQuickMessages(false); return true; }
      if (showMentionPicker) { setShowMentionPicker(false); return true; }
      if (starredFilter) { setStarredFilter(false); return true; }
      if (replyToMessage) { setReplyToMessage(null); return true; }
      Keyboard.dismiss();
      router.back();
      return true;
    };
    const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => subscription.remove();
  }, [showAttachSheet, menuVisible, searchVisible, showContactInfoSheet, mediaPanelVisible, showQuickActionsSheet, showInlineQuickMessages, showMentionPicker, starredFilter, replyToMessage, router]);

  // Load messages & mark as read
  useEffect(() => {
    if (!user?.organization || !phoneNumber) return;
    prevMessageCount.current = 0;
    setTimelineEntries([]);
    loadMessages(user.organization, phoneNumber);
    markAsRead(user.organization, phoneNumber, user.uID || user.userId, user.fullname || user.displayName || '');
    return () => {
      clearCurrentChat();
    };
  }, [user?.organization, phoneNumber]);

  // Reload messages + conversation status when app returns from background
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState === 'active' && user?.organization && phoneNumber) {
        WebSocketService.reconnectAll();
        loadMessages(user.organization, phoneNumber);
        fetchConversationStatus();
      }
    });
    return () => subscription.remove();
  }, [user?.organization, phoneNumber, loadMessages, fetchConversationStatus]);

  // Reload messages + conversation status whenever the screen gains focus
  // (navigating back from another screen, opening from push notification, etc.)
  useFocusEffect(
    useCallback(() => {
      if (user?.organization && phoneNumber) {
        loadMessages(user.organization, phoneNumber);
        fetchConversationStatus();
      }
    }, [user?.organization, phoneNumber, loadMessages, fetchConversationStatus])
  );

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
        let raw = data.data ?? data.message ?? data;
        if (typeof raw === 'string') {
          try { raw = JSON.parse(raw); } catch { raw = null; }
        }
        const msgs: any[] = Array.isArray(raw) ? raw : (raw ? [raw] : []);

        let hasInbound = false;
        msgs.forEach((msg) => {
          const normalizedId = msg.messageId || msg.id || msg.Id || '';
          if (!normalizedId) return;
          msg.messageId = normalizedId;

          // Reactions: update original message instead of adding as separate bubble
          if (msg.type === 'reaction') {
            const targetId = msg.contextMessageId || msg.ContextMessageId || msg.reactionMessageId;
            if (targetId) {
              const emoji = msg.text || msg.body || msg.emoji || '';
              const from = msg.from || '';
              updateMessage(targetId, {
                reactions: { [from]: emoji },
              });
            }
            return;
          }

          addMessage({
            ...msg,
            text: msg.text || msg.body || '',
            timestamp: msg.timestamp || msg.createdOn || '',
            createdOn: msg.createdOn || msg.timestamp || '',
          });
          const dir = (msg.direction || '').toLowerCase();
          if (dir === 'inbound' || msg.from === phoneNumber) {
            hasInbound = true;
          }
        });
        if (msgs.length > 0) {
          markAsRead(user.organization, phoneNumber, user.uID || user.userId, user.fullname || user.displayName || '');
        }
        if (hasInbound) {
          // Only update conversation status if message is for the currently active number
          const msgFromNumberId = msgs[0]?.fromNumberId || msgs[0]?.wabaPhoneNumberId || msgs[0]?.phoneNumberId || '';
          if (!activeWabaNumber || !msgFromNumberId || msgFromNumberId === activeWabaNumber) {
            setConversationLive(true);
            setRecipientReplied24h(true);
            const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
            setConversationExpiresAt(expires);
          }
        }
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

  const scrollToBottom = useCallback((animated = false) => {
    requestAnimationFrame(() => {
      flatListRef.current?.scrollToEnd({ animated });
    });
  }, []);

  // Auto-scroll to bottom (newest) on new messages or initial load
  useEffect(() => {
    if (currentMessages.length > prevMessageCount.current) {
      const isInitialLoad = prevMessageCount.current === 0;
      const addedCount = currentMessages.length - prevMessageCount.current;
      if (isInitialLoad) {
        scrollToBottom(false);
      } else if (!isLoadingOlderMessages && !loadingOlderRef.current && addedCount <= 3) {
        scrollToBottom(true);
      }
    }
    prevMessageCount.current = currentMessages.length;
  }, [currentMessages.length, isLoadingOlderMessages, scrollToBottom]);

  // Pre-cache media from ALL messages in the background (without blocking message rendering)
  const allMessages = useChatStore((s) => s.allMessages);
  const prefetchedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (allMessages.length === 0) return;
    const mediaItems: Array<{ url: string; type: MediaType }> = [];
    for (const msg of allMessages) {
      const url = (msg as any).gmbt_mediaUrl || msg.mediaUrl || (msg as any).MediaUrl || (msg as any).media_url;
      if (!url || prefetchedRef.current.has(url)) continue;
      prefetchedRef.current.add(url);
      const rawT = ((msg.type || (msg as any).messageType) || '').toLowerCase();
      let mediaType: MediaType = 'image';
      if (rawT === 'image' || rawT.startsWith('image/')) mediaType = 'image';
      else if (rawT === 'video' || rawT.startsWith('video/')) mediaType = 'video';
      else if (rawT === 'audio' || rawT.startsWith('audio/')) mediaType = 'audio';
      else if (rawT === 'document' || rawT.startsWith('application/') || rawT === 'file') mediaType = 'document';
      else {
        const ext = (url.split('?')[0].split('.').pop() || '').toLowerCase();
        if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic'].includes(ext)) mediaType = 'image';
        else if (['mp4', 'mov', 'avi', 'webm', '3gp'].includes(ext)) mediaType = 'video';
        else if (['mp3', 'ogg', 'opus', 'wav', 'aac', 'm4a', 'amr'].includes(ext)) mediaType = 'audio';
        else if (['pdf', 'doc', 'docx', 'xls', 'xlsx'].includes(ext)) mediaType = 'document';
      }
      mediaItems.push({ url, type: mediaType });
    }
    if (mediaItems.length > 0) {
      prefetchMediaList(mediaItems);
    }
  }, [allMessages]);

  // Collect all visual media messages for the gallery viewer
  const mediaMessages = useMemo(() => {
    return currentMessages
      .filter((m) => {
        const t = (m.type || m.mediaType || '').toLowerCase();
        const url = m.gmbt_mediaUrl || m.mediaUrl || (m as any).MediaUrl || (m as any).media_url || '';
        if (!url) return false;
        if (t === 'image' || t === 'video') return true;
        const ext = (url.split('?')[0].split('.').pop() || '').toLowerCase();
        return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'mp4', 'mov', 'avi', 'webm', '3gp'].includes(ext);
      })
      .sort((a, b) => new Date(getTs(b)).getTime() - new Date(getTs(a)).getTime());
  }, [currentMessages]);

  const handleMediaPress = useCallback((message: Message) => {
    const idx = mediaMessages.findIndex((m) => m.messageId === message.messageId);
    if (idx >= 0) {
      setGalleryIndex(idx);
      setGalleryVisible(true);
    }
  }, [mediaMessages]);

  // Build list data with date separators + timeline entries (newest first for inverted list)
  const listData = useMemo<ListItem[]>(() => {
    let msgs = currentMessages;
    if (messageMode === 'internal') {
      msgs = msgs.filter((m) => m.type === 'internal' || (m as any).isInternalMessage === true);
    } else {
      msgs = msgs.filter((m) => m.type !== 'internal' && (m as any).isInternalMessage !== true && m.type !== 'reaction');
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

    // Build a combined list sorted oldest first (non-inverted: data[0] = oldest = top of screen)
    type Combined =
      | { ts: number; idx: number; kind: 'message'; msg: Message }
      | { ts: number; idx: number; kind: 'timeline'; entry: any };

    const combined: Combined[] = [
      ...msgs.map((msg, idx) => ({
        ts: parseTimestamp((msg as any).createdOn || (msg as any).timestamp),
        idx,
        kind: 'message' as const,
        msg,
      })),
      ...timelineEntries.map((entry: any, idx: number) => {
        return {
          ts: parseTimestamp(entry.createdOn || entry.timestamp || entry.CreatedOn),
          idx: msgs.length + idx,
          kind: 'timeline' as const,
          entry,
        };
      }),
    ].sort((a, b) => {
      if (a.ts !== b.ts) return a.ts - b.ts;
      return a.idx - b.idx;
    });

    const items: ListItem[] = [];
    const orgNumber = user?.wabaNumber || '';

    let lastDateKey: string | null = null;

    for (let i = 0; i < combined.length; i++) {
      const c = combined[i];

      if (c.kind === 'timeline') {
        const entryTs = c.entry.createdOn || c.entry.timestamp || c.entry.CreatedOn || '';
        const dateKey = getDateKey(entryTs);
        if (dateKey && dateKey !== lastDateKey) {
          items.push({ kind: 'separator', date: formatMessageDateSeparator(entryTs, lang), id: `sep-${dateKey}` });
          lastDateKey = dateKey;
        }
        items.push({ kind: 'timeline', data: c.entry, id: `tl-${c.entry.timelineEntryId || c.entry.id || i}` });
        continue;
      }

      const msg = c.msg;
      const dir = msg.direction?.toLowerCase();
      const isOutbound =
        (orgNumber && msg.from === orgNumber) ||
        dir === 'outbound' ||
        msg.sentFromApp === true ||
        msg.to === phoneNumber;

      const currentDate = getDateKey(getTs(msg));
      if (currentDate && currentDate !== lastDateKey) {
        items.push({ kind: 'separator', date: formatMessageDateSeparator(getTs(msg), lang), id: `sep-${currentDate}` });
        lastDateKey = currentDate;
      }

      const prevC = combined[i - 1];
      const prevMsg = prevC?.kind === 'message' ? prevC.msg : null;
      const showTail =
        !prevMsg ||
        prevMsg.direction !== msg.direction ||
        getDateKey(getTs(msg)) !== (prevMsg ? getDateKey(getTs(prevMsg)) : '');

      items.push({ kind: 'message', data: msg, isOutbound, showTail });
    }

    return items;
  }, [currentMessages, timelineEntries, lang, messageMode, starredFilter, searchQuery, user, phoneNumber]);

  const handleQuotedPress = useCallback((contextMessageId: string) => {
    const idx = listData.findIndex(
      (item) => item.kind === 'message' && (item.data.messageId === contextMessageId || item.data.id === contextMessageId),
    );
    if (idx >= 0) {
      flatListRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.5 });
    }
  }, [listData]);

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
            activeWabaNumber || user.wabaNumber || '',
            user.email || user.Email || '',
          );
        }
        setReplyToMessage(null);
      } catch {
        Alert.alert(t('common.error'), t('chats.sendFailed', 'שליחת ההודעה נכשלה'));
      }
    },
    [user, phoneNumber, isInternalNote, sendMessage, sendInternalMessage, replyToMessage, mentionedUsers, t, activeWabaNumber],
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
        activeWabaNumber || user.wabaNumber || '',
      );
    } catch {
      Alert.alert(t('common.error'), t('chats.sendFailed', 'Failed to send media'));
    }
  }, [user?.organization, phoneNumber, user?.uID, user?.userId, t, activeWabaNumber]);

  const handleAttachment = useCallback(() => {
    setShowAttachSheet(true);
  }, []);

  const handlePickCamera = useCallback(async () => {
    setShowAttachSheet(false);
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(t('common.permissionDenied', 'הרשאה נדרשת'), t('chats.cameraPermission', 'יש לאפשר גישה למצלמה בהגדרות האפליקציה'));
      return;
    }
    try {
      const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'] as any, quality: 0.8 });
      if (!result.canceled && result.assets?.[0]) {
        const asset = result.assets[0];
        sendPickedMedia(asset.uri, asset.fileName || `photo_${Date.now()}.jpg`, asset.mimeType || 'image/jpeg', asset.fileSize);
      }
    } catch (err: any) {
      Alert.alert(t('common.error'), err?.message || t('errors.generic', 'אירעה שגיאה'));
    }
  }, [t, sendPickedMedia]);

  const handlePickGallery = useCallback(async () => {
    setShowAttachSheet(false);
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(t('common.permissionDenied', 'הרשאה נדרשת'), t('chats.galleryPermission', 'יש לאפשר גישה לגלריה בהגדרות האפליקציה'));
      return;
    }
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'] as any, quality: 0.8 });
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
  }, [t, sendPickedMedia]);

  const handlePickDocument = useCallback(async () => {
    setShowAttachSheet(false);
    try {
      const DocumentPicker = require('expo-document-picker');
      const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, type: '*/*' });
      if (!result.canceled && result.assets?.[0]) {
        const doc = result.assets[0];
        sendPickedMedia(doc.uri, doc.name, doc.mimeType || 'application/octet-stream', doc.size);
      }
    } catch (err: any) {
      Alert.alert(t('common.error'), err?.message || t('errors.generic', 'אירעה שגיאה'));
    }
  }, [t, sendPickedMedia]);

  const handleVoiceMessage = useCallback(async (uri: string, durationMs: number) => {
    if (!user?.organization || !phoneNumber) return;
    const fileName = `voice_${Date.now()}.mp4`;
    const mimeType = 'audio/mp4';
    let fileSize = 0;
    try {
      const FileSystem = require('expo-file-system');
      const fileInfo = await FileSystem.getInfoAsync(uri, { size: true });
      if (fileInfo.exists && fileInfo.size) fileSize = fileInfo.size;
    } catch {}
    try {
      await chatsApi.sendMediaMessage(
        user.organization,
        phoneNumber as string,
        { uri, name: fileName, type: mimeType, size: fileSize },
        '',
        user?.uID || user?.userId || '',
        activeWabaNumber || user.wabaNumber || '',
      );
    } catch {
      Alert.alert(t('common.error'), t('chats.sendFailed', 'שליחת ההקלטה נכשלה'));
    }
  }, [user?.organization, user?.uID, user?.userId, phoneNumber, t, activeWabaNumber]);

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

  const handleSwipeToReply = useCallback((message: Message) => {
    setReplyToMessage(message);
  }, []);

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

  const loadingOlderRef = useRef(false);
  const prevListLengthRef = useRef(0);

  // Maintain scroll position after loading older messages
  useEffect(() => {
    if (isLoadingOlderMessages) {
      prevListLengthRef.current = listData.length;
    }
  }, [isLoadingOlderMessages]);

  useEffect(() => {
    if (!isLoadingOlderMessages && loadingOlderRef.current && prevListLengthRef.current > 0) {
      const addedCount = listData.length - prevListLengthRef.current;
      if (addedCount > 0) {
        setTimeout(() => {
          try {
            flatListRef.current?.scrollToIndex({ index: addedCount, animated: false });
          } catch {}
        }, 50);
      }
      prevListLengthRef.current = 0;
    }
  }, [listData.length, isLoadingOlderMessages]);

  const handleScroll = useCallback((e: any) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const distanceFromBottom = contentSize.height - layoutMeasurement.height - contentOffset.y;
    setShowScrollBtn(distanceFromBottom > 400);
    if (contentOffset.y < 150 && hasMoreMessages && !isLoadingOlderMessages && !loadingOlderRef.current) {
      loadingOlderRef.current = true;
      loadOlderMessages();
      setTimeout(() => { loadingOlderRef.current = false; }, 1000);
    }
  }, [hasMoreMessages, isLoadingOlderMessages, loadOlderMessages]);

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
                    ? 'rgba(255,255,255,0.1)'
                    : '#ffffffcc',
                },
              ]}
            >
              <Text
                variant="labelSmall"
                style={[
                  styles.separatorText,
                  {
                    color: theme.dark ? '#8696a0' : '#54656f',
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
          tag_added: 'tag-outline',
          tag_removed: 'tag-off-outline',
          owner_changed: 'account-switch-outline',
          internal_mention: 'robot-outline',
          lead_created: 'account-plus-outline',
          case_created: 'ticket-outline',
          bot_action: 'robot-outline',
          calendar_event: 'calendar-check-outline',
        };
        const colorMap: Record<string, string> = {
          note: '#795548',
          call: '#4CAF50',
          email: '#2196F3',
          task: '#FF9800',
          meeting: '#009688',
          status_change: '#607D8B',
          tag_added: '#009688',
          tag_removed: '#F44336',
          owner_changed: '#3F51B5',
          internal_mention: '#7C4DFF',
          lead_created: '#4CAF50',
          case_created: '#9C27B0',
          bot_action: '#7C4DFF',
          calendar_event: '#009688',
        };
        const entryType = (entry.timelineType || entry.TimelineType || entry.type || 'note').toLowerCase();
        const icon = iconMap[entryType] || 'information-outline';
        const iconColor = colorMap[entryType] || '#2e6155';
        const entryText = entry.note || entry.text || entry.description || entry.Note || entry.content || '';
        const entryBy = entry.createdByName || entry.CreatedByName || entry.addedByName || '';
        const entryTs = entry.createdOn || entry.timestamp || entry.CreatedOn || '';
        return (
          <View style={[styles.timelineItem, { backgroundColor: theme.dark ? 'rgba(255,255,255,0.05)' : '#f0f4f8', borderColor: theme.colors.outline }]}>
            <View style={[styles.timelineIconWrap, { backgroundColor: `${iconColor}15` }]}>
              <MaterialCommunityIcons name={icon as any} size={16} color={iconColor} />
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
          organization={user?.organization}
          onLongPress={handleMessageLongPress}
          onMediaPress={handleMediaPress}
          onQuotedPress={handleQuotedPress}
          onSwipeToReply={handleSwipeToReply}
          wabaNumbers={wabaNumbers.length > 1 ? wabaNumbers : undefined}
        />
      );
    },
    [theme, handleMessageLongPress, handleMediaPress, handleQuotedPress, handleSwipeToReply, wabaNumbers, user?.organization],
  );

  const keyExtractor = useCallback((item: ListItem) => {
    if (item.kind === 'separator') return item.id;
    if (item.kind === 'timeline') return item.id;
    return item.data.messageId;
  }, []);

  const getItemType = useCallback((item: ListItem) => {
    return item.kind;
  }, []);

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />

      <KeyboardAvoidingView
        style={[
          styles.screen,
          { backgroundColor: theme.custom.chatBackground },
        ]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 56 : 0}
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
                <Text style={[styles.headerStatus, { writingDirection: 'ltr', textAlign: 'left' }]}>
                  {phoneNumber}
                </Text>
              </View>
            </Pressable>

            <View style={styles.headerActions}>
              {conversationExpiresAt && conversationLive && (() => {
                const diff = new Date(conversationExpiresAt).getTime() - countdownNow;
                if (diff <= 0) return null;
                const hours = Math.floor(diff / 3600000);
                const mins = Math.floor((diff % 3600000) / 60000);
                const secs = Math.floor((diff % 60000) / 1000);
                return (
                  <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 10, paddingHorizontal: 6, paddingVertical: 2, marginEnd: 2 }}>
                    <MaterialCommunityIcons name="clock-outline" size={13} color={diff < 3600000 ? '#FFA500' : '#90EE90'} />
                    <Text style={{ color: diff < 3600000 ? '#FFA500' : '#90EE90', fontSize: 11, fontWeight: '600', marginStart: 3 }}>
                      {hours}:{mins.toString().padStart(2, '0')}:{secs.toString().padStart(2, '0')}
                    </Text>
                  </View>
                );
              })()}

              {/* Tag / Note / Assign are all in the meta bar below — header is clean */}

              <Menu
                visible={menuVisible}
                onDismiss={() => setMenuVisible(false)}
                anchor={
                  <IconButton
                    icon="dots-vertical"
                    size={20}
                    iconColor={theme.custom.headerText}
                    onPress={() => setMenuVisible(true)}
                  />
                }
                contentStyle={{ backgroundColor: theme.colors.surface }}
              >
                <Menu.Item
                  leadingIcon="magnify"
                  onPress={() => { setMenuVisible(false); setSearchVisible((v) => !v); if (searchVisible) setSearchQuery(''); }}
                  title={t('chats.search', 'חיפוש')}
                />
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
                  leadingIcon="lightning-bolt"
                  onPress={() => { setMenuVisible(false); handleQuickActionsPress(); }}
                  title={t('chats.quickActions', 'פעולות מהירות')}
                />
                <Menu.Item
                  leadingIcon="information-outline"
                  onPress={() => {
                    setMenuVisible(false);
                    setShowContactInfoSheet(true);
                  }}
                  title={t('chats.contactInfo', 'פרטי שיחה')}
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

        {/* Message mode indicator - removed internal notes UI per user request */}

        {/* Status / Category bar */}
        <View style={[styles.chatMetaBar, { backgroundColor: theme.colors.surface, borderBottomColor: theme.colors.outlineVariant || 'rgba(0,0,0,0.06)' }]}>
          <Menu
            visible={showStatusMenu}
            onDismiss={() => setShowStatusMenu(false)}
            anchor={
              <Pressable onPress={() => setShowStatusMenu(true)} style={[styles.metaChip, { backgroundColor: conversationStatusColors(getChatConversationStatus({ lastConversationStatus: chatStatus })).bg }]}>
                <MaterialCommunityIcons name="circle" size={8} color={conversationStatusColors(getChatConversationStatus({ lastConversationStatus: chatStatus })).fg} />
                <Text style={{ fontSize: 11, fontWeight: '600', color: conversationStatusColors(getChatConversationStatus({ lastConversationStatus: chatStatus })).fg, marginStart: 4 }}>
                  {conversationStatusLabel(getChatConversationStatus({ lastConversationStatus: chatStatus }), t)}
                </Text>
                <MaterialCommunityIcons name="chevron-down" size={14} color="#64748b" style={{ marginStart: 2 }} />
              </Pressable>
            }
            contentStyle={{ backgroundColor: theme.colors.surface }}
          >
            <Menu.Item title={t('chats.open', 'פתוח')} leadingIcon={chatStatus === 'Open' ? 'check' : undefined} onPress={() => handleChangeStatus('Open')} />
            <Menu.Item title={t('chats.inProcess', 'בטיפול')} leadingIcon={chatStatus === 'In Process' ? 'check' : undefined} onPress={() => handleChangeStatus('In Process')} />
            <Menu.Item title={t('chats.closed', 'סגור')} leadingIcon={chatStatus === 'Closed' ? 'check' : undefined} onPress={() => handleChangeStatus('Closed')} />
          </Menu>

          <Menu
            visible={showCategoryMenu}
            onDismiss={() => setShowCategoryMenu(false)}
            anchor={
              <Pressable onPress={() => setShowCategoryMenu(true)} style={[styles.metaChip, { backgroundColor: chatCategory ? '#e0e7ff' : '#f1f5f9' }]}>
                <MaterialCommunityIcons name="tag-outline" size={12} color={chatCategory ? '#4f46e5' : '#64748b'} />
                <Text style={{ fontSize: 11, fontWeight: '600', color: chatCategory ? '#4f46e5' : '#64748b', marginStart: 4 }} numberOfLines={1}>
                  {chatCategory || t('chats.category', 'קטגוריה')}
                </Text>
                <MaterialCommunityIcons name="chevron-down" size={14} color="#64748b" style={{ marginStart: 2 }} />
              </Pressable>
            }
            contentStyle={{ backgroundColor: theme.colors.surface }}
          >
            <Menu.Item title={t('chats.noCategory', 'ללא קטגוריה')} leadingIcon={!chatCategory ? 'check' : undefined} onPress={() => handleChangeCategory('')} />
            {orgCategories.map((cat) => (
              <Menu.Item key={cat} title={cat} leadingIcon={chatCategory === cat ? 'check' : undefined} onPress={() => handleChangeCategory(cat)} />
            ))}
          </Menu>

          {/* Lead stage chip — change stage inline, or open the lead record */}
          {activeLead && (
            <Menu
              visible={showLeadStageMenu}
              onDismiss={() => setShowLeadStageMenu(false)}
              anchor={
                <Pressable onPress={() => setShowLeadStageMenu(true)} style={[styles.metaChip, { backgroundColor: '#dcfce7', maxWidth: 150 }]}>
                  <MaterialCommunityIcons name="account-star-outline" size={12} color="#16a34a" />
                  <Text style={{ fontSize: 11, fontWeight: '600', color: '#16a34a', marginStart: 4 }} numberOfLines={1}>
                    {activeLead.stageName || activeLead.stage || (isRTL ? 'ליד' : 'Lead')}
                  </Text>
                  <MaterialCommunityIcons name="chevron-down" size={14} color="#16a34a" style={{ marginStart: 2 }} />
                </Pressable>
              }
              contentStyle={{ backgroundColor: theme.colors.surface }}
            >
              {pipelineStages.map((stage: any) => (
                <Menu.Item
                  key={stage.id || stage.Id}
                  title={stage.name || stage.Name || stage.stageName}
                  leadingIcon={activeLead.stageId === (stage.id || stage.Id) ? 'check' : undefined}
                  onPress={() => handleMoveLeadStage(stage)}
                />
              ))}
              <Divider />
              <Menu.Item leadingIcon="open-in-new" title={isRTL ? 'פתח רשומת ליד' : 'Open lead'} onPress={openLeadRecord} />
            </Menu>
          )}

          {/* Case (פנייה) stage chip — change stage inline, or open the case record */}
          {activeCase && (
            <Menu
              visible={showCaseStageMenu}
              onDismiss={() => setShowCaseStageMenu(false)}
              anchor={
                <Pressable onPress={() => setShowCaseStageMenu(true)} style={[styles.metaChip, { backgroundColor: '#f3e8ff', maxWidth: 150 }]}>
                  <MaterialCommunityIcons name="ticket-outline" size={12} color="#9333ea" />
                  <Text style={{ fontSize: 11, fontWeight: '600', color: '#9333ea', marginStart: 4 }} numberOfLines={1}>
                    {activeCase.stageName || activeCase.stage || (isRTL ? 'פנייה' : 'Case')}
                  </Text>
                  <MaterialCommunityIcons name="chevron-down" size={14} color="#9333ea" style={{ marginStart: 2 }} />
                </Pressable>
              }
              contentStyle={{ backgroundColor: theme.colors.surface }}
            >
              {caseStages.map((stage: any) => (
                <Menu.Item
                  key={stage.id || stage.Id}
                  title={stage.name || stage.Name || stage.stageName}
                  leadingIcon={activeCase.stageId === (stage.id || stage.Id) ? 'check' : undefined}
                  onPress={() => handleMoveCaseStage(stage)}
                />
              ))}
              <Divider />
              <Menu.Item leadingIcon="open-in-new" title={isRTL ? 'פתח רשומת פנייה' : 'Open case'} onPress={openCaseRecord} />
            </Menu>
          )}

          {/* Tags row — horizontal chips + "add tag" chip */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginStart: 4, flexShrink: 1 }} contentContainerStyle={{ alignItems: 'center', gap: 4 }}>
            {(chat?.tags || []).map((tag) => (
              <Pressable
                key={tag}
                onLongPress={() => {
                  const newTags = (chat?.tags || []).filter((t) => t !== tag);
                  addOrUpdateChat({ phoneNumber: phoneNumber as string, tags: newTags } as any);
                  const { contactsApi } = require('../../../services/api');
                  contactsApi.update(user?.organization, { phoneNumber: phoneNumber as string, tags: newTags }, user?.uID || user?.userId, user?.fullname).catch(() => {});
                }}
                style={[styles.metaChip, { backgroundColor: '#fef3c7' }]}
              >
                <Text style={{ fontSize: 10, fontWeight: '600', color: '#92400e' }}>{tag}</Text>
              </Pressable>
            ))}
            {/* + Tag chip — clicking opens the inline input row below */}
            <Pressable onPress={() => setShowAddTagInline(true)} style={[styles.metaChip, { backgroundColor: '#e0f2f1' }]}>
              <MaterialCommunityIcons name="plus" size={12} color="#009688" />
              <Text style={{ fontSize: 10, fontWeight: '600', color: '#009688', marginStart: 2 }}>{isRTL ? 'הוסף תיוג' : 'Add Tag'}</Text>
            </Pressable>
          </ScrollView>
          {/* Note / Assign moved to the Quick Actions sheet (⚡) to remove header duplicates */}
        </View>

        {/* Inline tag entry — full-width row below meta bar */}
        {showAddTagInline && (
          <View style={{
            flexDirection: isRTL ? 'row-reverse' : 'row',
            alignItems: 'center',
            backgroundColor: '#f0fdf4',
            borderBottomWidth: 1,
            borderBottomColor: '#86efac',
            paddingHorizontal: 12,
            paddingVertical: 6,
            gap: 8,
          }}>
            <MaterialCommunityIcons name="tag-plus-outline" size={18} color="#16a34a" />
            <TextInput
              value={newTagText}
              onChangeText={setNewTagText}
              onSubmitEditing={() => { if (newTagText.trim()) handleAddTag(newTagText); else setShowAddTagInline(false); }}
              placeholder={isRTL ? 'הקלד שם תיוג ולחץ ✓ לסיום' : 'Type tag name and press ✓ to confirm'}
              placeholderTextColor="#86efac"
              style={{
                flex: 1,
                fontSize: 13,
                color: theme.colors.onSurface,
                padding: 0,
                textAlign: isRTL ? 'right' : 'left',
              }}
              autoFocus
              returnKeyType="done"
              blurOnSubmit={false}
            />
            {newTagText.trim().length > 0 && (
              <Pressable
                onPress={() => handleAddTag(newTagText)}
                hitSlop={8}
                style={{ backgroundColor: '#16a34a', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4 }}
              >
                <Text style={{ color: 'white', fontSize: 12, fontWeight: '700' }}>
                  {isRTL ? 'הוסף' : 'Add'}
                </Text>
              </Pressable>
            )}
            <Pressable onPress={() => { setShowAddTagInline(false); setNewTagText(''); }} hitSlop={8}>
              <MaterialCommunityIcons name="close" size={18} color="#64748b" />
            </Pressable>
          </View>
        )}

        {/* Messages */}
        {isLoadingMessages && listData.length === 0 ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator
              size="large"
              color={theme.colors.primary}
            />
          </View>
        ) : (
          <FlashList
            key={String(phoneNumber)}
            ref={flatListRef}
            data={listData}
            renderItem={renderItem}
            keyExtractor={keyExtractor}
            getItemType={getItemType}
            onScroll={handleScroll}
            scrollEventThrottle={200}
            onEndReachedThreshold={0.3}
            contentContainerStyle={styles.messagesContent}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            estimatedItemSize={120}
            drawDistance={500}
            overrideItemLayout={(layout, item) => {
              if (item.kind === 'separator') {
                layout.size = 36;
                return;
              }
              if (item.kind === 'timeline') {
                layout.size = 88;
                return;
              }
              const msg = item.data;
              const rawType = ((msg.type || (msg as any).messageType) || '').toLowerCase();
              const hasMedia = !!(msg.mediaUrl || (msg as any).gmbt_mediaUrl || (msg as any).MediaUrl);
              if (rawType.includes('image') || rawType.includes('video') || hasMedia) {
                layout.size = 240;
              } else if (rawType.includes('audio') || rawType.includes('document')) {
                layout.size = 120;
              } else {
                layout.size = 84;
              }
            }}
            ListHeaderComponent={
              isLoadingOlderMessages ? (
                <View style={styles.olderMsgsLoader}>
                  <ActivityIndicator size="small" color={theme.colors.primary} />
                  <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: 4 }}>
                    טוען הודעות ישנות...
                  </Text>
                </View>
              ) : null
            }
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
              flatListRef.current?.scrollToEnd({ animated: true })
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

        {/* Template send banner — shown whenever free-text input is not allowed (matches web) */}
        {!canSendFreeText ? (
          <>
            {showFreeTemplateWindow && (
              <View style={{
                backgroundColor: theme.dark ? '#064e3b' : '#ecfdf5',
                borderTopWidth: 1,
                borderTopColor: theme.dark ? '#065f46' : '#6ee7b7',
                paddingHorizontal: 16,
                paddingVertical: 10,
              }}>
                <Text style={{ color: theme.dark ? '#6ee7b7' : '#059669', fontWeight: '700', fontSize: 14, textAlign: 'center' }}>
                  {isRTL ? '📣 ליד ממודעה — חלון תבניות חינם ל-72 שעות!' : '📣 Lead from Ad — Free 72h template window!'}
                </Text>
                <Text style={{ color: theme.dark ? '#a7f3d0' : '#047857', fontSize: 12, textAlign: 'center', marginTop: 4 }}>
                  {isRTL ? 'ניתן לשלוח תבניות בחינם. הודעות חופשיות חסומות עד תגובת הלקוח.' : 'Templates are free. Free-form messages blocked until customer replies.'}
                </Text>
              </View>
            )}
            {/* Number switcher must remain accessible even when window closed */}
            {wabaNumbers.length > 1 && (
              <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6, backgroundColor: theme.dark ? '#1a1a2e' : '#f9fafb' }}>
                <MaterialCommunityIcons name="phone-outline" size={14} color={theme.colors.primary} />
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginStart: 6 }}>
                  {wabaNumbers.map((num) => {
                    const id = num.PhoneNumberId || num.phoneNumberId || '';
                    const numLabel = num.Label || num.label || num.DisplayNumber || num.displayNumber || id.slice(-4);
                    const isActive = id === activeWabaNumber;
                    return (
                      <Pressable
                        key={id}
                        onPress={() => setActiveWabaNumber(id)}
                        style={{ paddingHorizontal: 10, paddingVertical: 4, marginEnd: 6, borderRadius: 12, backgroundColor: isActive ? (theme.dark ? '#1e3a32' : '#d1fae5') : (theme.dark ? '#334155' : '#e2e8f0') }}
                      >
                        <Text style={{ fontSize: 11, fontWeight: isActive ? '700' : '400', color: isActive ? theme.colors.primary : theme.colors.onSurface }}>{numLabel}</Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>
            )}
            <View style={[
              styles.closedInlineBanner,
              {
                backgroundColor: theme.dark ? '#1a1a2e' : '#fff8e1',
                gap: 8,
                opacity: isStatusLoading ? 0.5 : 1,
                paddingBottom: Math.max(insets.bottom, 8) + 4,
              },
            ]}>
              {/* ⚡ Send default template */}
              <Pressable
                onPress={handleSendDefaultTemplate}
                disabled={isSendingTemplate || isStatusLoading}
                style={({ pressed }) => ({
                  flex: 1,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 5,
                  backgroundColor: pressed ? '#1a7a5e' : '#25D366',
                  paddingVertical: 11,
                  borderRadius: 10,
                  opacity: (isSendingTemplate || isStatusLoading) ? 0.6 : 1,
                })}
              >
                {isSendingTemplate
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <MaterialCommunityIcons name="lightning-bolt" size={18} color="#fff" />}
                <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>
                  {isRTL ? 'ברירת מחדל' : 'Default'}
                </Text>
              </Pressable>

              {/* 📄 Choose template (opens modal with Quick/Manual) */}
              <Pressable
                onPress={handleOpenConversation}
                disabled={isStatusLoading}
                style={({ pressed }) => ({
                  flex: 1,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 5,
                  backgroundColor: pressed ? '#1d4ed8' : '#2563eb',
                  paddingVertical: 11,
                  borderRadius: 10,
                  opacity: isStatusLoading ? 0.6 : 1,
                })}
              >
                <MaterialCommunityIcons name="card-text-outline" size={18} color="#fff" />
                <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>
                  {isRTL ? 'בחר תבנית' : 'Template'}
                </Text>
              </Pressable>

              {/* 🕐 Schedule message */}
              <Pressable
                onPress={handleOpenSchedule}
                disabled={isStatusLoading}
                style={({ pressed }) => ({
                  flex: 1,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 5,
                  backgroundColor: pressed ? '#6d28d9' : '#7c3aed',
                  paddingVertical: 11,
                  borderRadius: 10,
                  opacity: isStatusLoading ? 0.6 : 1,
                })}
              >
                <MaterialCommunityIcons name="clock-outline" size={18} color="#fff" />
                <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>
                  {isRTL ? 'תזמן' : 'Schedule'}
                </Text>
              </Pressable>
            </View>
          </>
        ) : (
          <>
            {/* Chat Input - visible only when customer replied (24h window open) */}
            <ChatInput
              ref={chatInputRef}
              onSend={handleSend}
              onAttachmentPress={handleAttachment}
              isInternalNote={false}
              onToggleInternalNote={() => {}}
              onQuickMessagePress={handleQuickMessagePress}
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
              activeWabaNumber={activeWabaNumber}
              wabaNumbers={wabaNumbers.length > 1 ? wabaNumbers : undefined}
              onChangeWabaNumber={setActiveWabaNumber}
            />
          </>
        )}

        {/* Template Selector Modal — Quick / Manual tabs */}
        <Modal
          visible={showTemplateSelector}
          transparent
          animationType="slide"
          onRequestClose={() => { setShowTemplateSelector(false); setQuickTemplateSearch(''); setQuickOpenVarValues({}); }}
        >
          <View style={styles.modalOverlay}>
            <View style={[styles.templateSheet, { backgroundColor: theme.colors.surface, paddingBottom: insets.bottom + 12 }]}>
              <View style={styles.actionSheetHandle} />

              {/* Header */}
              <View style={styles.templateSheetHeader}>
                <Text variant="titleMedium" style={{ fontWeight: '700', color: theme.colors.onSurface, flex: 1 }}>
                  {isRTL ? 'שלח תבנית' : 'Send Template'}
                </Text>
                <IconButton icon="close" size={20} onPress={() => { setShowTemplateSelector(false); setQuickTemplateSearch(''); setQuickOpenVarValues({}); }} />
              </View>

              {/* Tab bar */}
              <View style={{ flexDirection: 'row', borderBottomWidth: 1.5, borderBottomColor: theme.colors.outlineVariant || '#e5e7eb', marginHorizontal: 12, marginBottom: 8 }}>
                {([
                  { key: 'quick',  label: isRTL ? '⚡ מהיר'  : '⚡ Quick'  },
                  { key: 'manual', label: isRTL ? '✏️ ידני' : '✏️ Manual' },
                ] as const).map(tab => (
                  <Pressable
                    key={tab.key}
                    onPress={() => { setTemplateActiveTab(tab.key); setQuickTemplateSearch(''); setQuickOpenVarValues({}); }}
                    style={{
                      paddingVertical: 10, paddingHorizontal: 18,
                      borderBottomWidth: 2.5,
                      borderBottomColor: templateActiveTab === tab.key ? '#6c63ff' : 'transparent',
                      marginBottom: -1.5,
                    }}
                  >
                    <Text style={{ fontSize: 14, fontWeight: templateActiveTab === tab.key ? '700' : '400', color: templateActiveTab === tab.key ? '#6c63ff' : theme.colors.onSurfaceVariant }}>
                      {tab.label}
                    </Text>
                  </Pressable>
                ))}
              </View>

              {isLoadingTemplates ? (
                <View style={[styles.loadingContainer, { minHeight: 140 }]}>
                  <ActivityIndicator size="large" color={theme.colors.primary} />
                </View>
              ) : templateActiveTab === 'quick' ? (
                /* ── Quick tab ── */
                <>
                  <View style={[styles.templateSearchWrap, { backgroundColor: theme.dark ? 'rgba(255,255,255,0.06)' : '#f3f4f6', borderColor: theme.colors.outline, marginHorizontal: 12, marginBottom: 6 }]}>
                    <MaterialCommunityIcons name="magnify" size={18} color={theme.colors.onSurfaceVariant} />
                    <TextInput
                      placeholder={isRTL ? 'חפש לפי שם ידידותי...' : 'Search by friendly name...'}
                      placeholderTextColor={theme.colors.onSurfaceVariant}
                      style={[styles.templateSearchInput, { color: theme.colors.onSurface }]}
                      value={quickTemplateSearch}
                      onChangeText={setQuickTemplateSearch}
                    />
                  </View>
                  {quickTemplates.length === 0 ? (
                    <View style={[styles.emptyTemplates, { minHeight: 100 }]}>
                      <MaterialCommunityIcons name="lightning-bolt-outline" size={36} color={theme.colors.onSurfaceVariant} style={{ opacity: 0.35 }} />
                      <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: 8, textAlign: 'center' }}>
                        {isRTL ? 'אין תבניות מהירות.\nסמן ⚡ בהגדרות תבניות.' : 'No Quick templates.\nMark ⚡ in template settings.'}
                      </Text>
                    </View>
                  ) : (
                    <FlatList
                      data={quickTemplateSearch.trim()
                        ? quickTemplates.filter(t =>
                            (t.friendlyName || '').toLowerCase().includes(quickTemplateSearch.toLowerCase()) ||
                            (t.usageType || '').toLowerCase().includes(quickTemplateSearch.toLowerCase()) ||
                            (t.name || '').toLowerCase().includes(quickTemplateSearch.toLowerCase()))
                        : quickTemplates}
                      keyExtractor={(item, i) => item.id || item.templateId || `q-${i}`}
                      style={{ maxHeight: 380 }}
                      renderItem={({ item }) => {
                        let mapping: Array<{index: number; entity: string; field: string}> = [];
                        try { mapping = JSON.parse(item.variableMappingJson || '[]'); } catch {}
                        const bodyComp = (item.components || []).find((c: any) => c.type === 'BODY');
                        const bodyText = bodyComp?.text || '';
                        const varMatches = [...bodyText.matchAll(/\{\{(\d+)\}\}/g)];
                        const varIndices = [...new Set(varMatches.map((m: any) => parseInt(m[1])))].sort((a, b) => a - b) as number[];
                        const openVars = varIndices.filter(idx => {
                          const me = mapping.find(m => m.index === idx);
                          return !me || me.entity === 'open';
                        });
                        return (
                          <View style={[styles.templateItem, { flexDirection: 'column', alignItems: 'stretch', gap: 8 }]}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                              <View style={{ flex: 1 }}>
                                <Text style={{ fontWeight: '700', color: theme.colors.onSurface, fontSize: 14 }}>
                                  {item.friendlyName || item.name}
                                </Text>
                                {item.usageType && (
                                  <Text style={{ fontSize: 11, color: '#6c63ff', marginTop: 1 }}>{item.usageType}</Text>
                                )}
                                <Text numberOfLines={1} style={{ color: theme.colors.onSurfaceVariant, fontSize: 12, marginTop: 2 }}>
                                  {getTemplateBodyText(item)}
                                </Text>
                              </View>
                            </View>
                            {/* Open variable inputs */}
                            {openVars.map(idx => (
                              <View key={idx} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                <Text style={{ fontSize: 12, color: '#6c63ff', minWidth: 30 }}>{`{{${idx}}}`}</Text>
                                <TextInput
                                  placeholder={isRTL ? 'הזן ערך...' : 'Enter value...'}
                                  placeholderTextColor={theme.colors.onSurfaceVariant}
                                  value={quickOpenVarValues[`${item.id}_${idx}`] || ''}
                                  onChangeText={v => setQuickOpenVarValues(prev => ({ ...prev, [`${item.id}_${idx}`]: v }))}
                                  style={{ flex: 1, borderWidth: 1, borderColor: theme.colors.outline, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, fontSize: 13, color: theme.colors.onSurface, backgroundColor: theme.colors.background }}
                                />
                              </View>
                            ))}
                            <Pressable
                              onPress={() => {
                                const templateVariableQuery = varIndices.map((idx, i) => {
                                  const mapEntry = mapping.find(m => m.index === idx);
                                  const entity = mapEntry?.entity || 'open';
                                  const field  = mapEntry?.field  || '';
                                  const isOpen = entity === 'open';
                                  const val = isOpen
                                    ? (quickOpenVarValues[`${item.id}_${idx}`] || '')
                                    : resolveQuickVar(entity, field);
                                  return { index: i, Variable: `{{${idx}}}`, dataSource1: 'data_source1_HardCoded', parameters_hardCoded_Text: val };
                                });
                                setShowTemplateSelector(false);
                                doSendTemplate(item, templateVariableQuery);
                              }}
                              disabled={isSendingTemplate || openVars.some(idx => !quickOpenVarValues[`${item.id}_${idx}`]?.trim())}
                              style={({ pressed }) => ({
                                flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
                                backgroundColor: pressed ? '#1a7a5e' : '#25D366',
                                paddingVertical: 9, borderRadius: 8,
                                opacity: (isSendingTemplate || openVars.some(idx => !quickOpenVarValues[`${item.id}_${idx}`]?.trim())) ? 0.5 : 1,
                              })}
                            >
                              <MaterialCommunityIcons name="send" size={16} color="#fff" />
                              <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>
                                {isRTL ? 'שלח' : 'Send'}
                              </Text>
                            </Pressable>
                          </View>
                        );
                      }}
                    />
                  )}
                </>
              ) : (
                /* ── Manual tab ── */
                <>
                  {templates.length > 3 && (
                    <View style={[styles.templateSearchWrap, { backgroundColor: theme.dark ? 'rgba(255,255,255,0.06)' : '#f3f4f6', borderColor: theme.colors.outline, marginHorizontal: 12, marginBottom: 6 }]}>
                      <MaterialCommunityIcons name="magnify" size={18} color={theme.colors.onSurfaceVariant} />
                      <TextInput
                        placeholder={t('chats.searchTemplates', 'חיפוש תבנית...')}
                        placeholderTextColor={theme.colors.onSurfaceVariant}
                        style={[styles.templateSearchInput, { color: theme.colors.onSurface }]}
                        value={searchQuery}
                        onChangeText={setSearchQuery}
                      />
                    </View>
                  )}
                  {templates.length === 0 ? (
                    <View style={styles.emptyTemplates}>
                      <MaterialCommunityIcons name="file-document-outline" size={48} color={theme.colors.onSurfaceVariant} style={{ opacity: 0.4 }} />
                      <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant, marginTop: 12 }}>
                        {t('chats.noTemplatesAvailable')}
                      </Text>
                    </View>
                  ) : (
                    <FlatList
                      data={searchQuery.trim()
                        ? templates.filter(tpl => (tpl.name || '').toLowerCase().includes(searchQuery.toLowerCase()) || (tpl.friendlyName || '').toLowerCase().includes(searchQuery.toLowerCase()) || (getTemplateBodyText(tpl) || '').toLowerCase().includes(searchQuery.toLowerCase()))
                        : templates}
                      keyExtractor={(item, index) => item.id || item.templateId || `${item.name}-${index}`}
                      style={{ maxHeight: 400 }}
                      renderItem={({ item }) => (
                        <Pressable
                          onPress={() => handleSendTemplate(item)}
                          disabled={isSendingTemplate}
                          style={({ pressed }) => [styles.templateItem, { backgroundColor: pressed ? theme.colors.surfaceVariant : 'transparent', opacity: isSendingTemplate ? 0.6 : 1 }]}
                        >
                          <View style={{ flex: 1 }}>
                            <Text variant="bodyLarge" style={{ fontWeight: '600', color: theme.colors.onSurface }}>
                              {item.friendlyName || item.name}
                            </Text>
                            {item.friendlyName && (
                              <Text style={{ fontSize: 11, color: theme.colors.onSurfaceVariant }}>{item.name}</Text>
                            )}
                            <Text variant="bodySmall" numberOfLines={2} style={{ color: theme.colors.onSurfaceVariant, marginTop: 2 }}>
                              {getTemplateBodyText(item) || `${item.language} · ${item.category}`}
                            </Text>
                          </View>
                          <MaterialCommunityIcons name="send" size={20} color={theme.colors.primary} />
                        </Pressable>
                      )}
                    />
                  )}
                </>
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
          <Pressable style={styles.modalOverlay} onPress={() => setShowScheduleModal(false)}>
            <Pressable
              onPress={(e) => e.stopPropagation()}
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
                {!canSendFreeText && (
                  <View style={{
                    backgroundColor: theme.dark ? '#422006' : '#fff7ed',
                    borderRadius: 8,
                    padding: 10,
                    marginBottom: 10,
                    borderWidth: 1,
                    borderColor: theme.dark ? '#78350f' : '#fed7aa',
                  }}>
                    <Text style={{ color: theme.dark ? '#fdba74' : '#9a3412', fontSize: 13, lineHeight: 18 }}>
                      {isRTL
                        ? 'שיחה סגורה: הודעה רגילה לא תפתח את השיחה. לפתיחה מחדש שלח תבנית וחכה לתגובת הלקוח.'
                        : 'Conversation closed: a regular message will not reopen the chat. Send a template and wait for a reply to continue.'}
                    </Text>
                  </View>
                )}
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
                <View style={{ flexDirection: 'row', gap: 10 }}>
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
            </Pressable>
          </Pressable>
        </Modal>

        {/* Attachment Sheet - WhatsApp style */}
        <Modal
          visible={showAttachSheet}
          transparent
          animationType="fade"
          onRequestClose={() => setShowAttachSheet(false)}
        >
          <Pressable style={styles.modalOverlay} onPress={() => setShowAttachSheet(false)}>
            <Pressable
              onPress={(e) => e.stopPropagation()}
              style={[styles.attachSheet, { backgroundColor: theme.colors.surface, paddingBottom: insets.bottom + 12 }]}
            >
              <View style={styles.actionSheetHandle} />
              <View style={styles.attachGrid}>
                <Pressable onPress={handlePickCamera} style={({ pressed }) => [styles.attachOption, pressed && { opacity: 0.7 }]}>
                  <View style={[styles.attachOptionIcon, { backgroundColor: '#E91E63' }]}>
                    <MaterialCommunityIcons name="camera" size={24} color="#fff" />
                  </View>
                  <Text style={[styles.attachOptionLabel, { color: theme.colors.onSurface }]}>{t('chats.takePhoto', 'מצלמה')}</Text>
                </Pressable>
                <Pressable onPress={handlePickGallery} style={({ pressed }) => [styles.attachOption, pressed && { opacity: 0.7 }]}>
                  <View style={[styles.attachOptionIcon, { backgroundColor: '#7C4DFF' }]}>
                    <MaterialCommunityIcons name="image-multiple" size={24} color="#fff" />
                  </View>
                  <Text style={[styles.attachOptionLabel, { color: theme.colors.onSurface }]}>{t('chats.gallery', 'גלריה')}</Text>
                </Pressable>
                <Pressable onPress={handlePickDocument} style={({ pressed }) => [styles.attachOption, pressed && { opacity: 0.7 }]}>
                  <View style={[styles.attachOptionIcon, { backgroundColor: '#0091EA' }]}>
                    <MaterialCommunityIcons name="file-document-outline" size={24} color="#fff" />
                  </View>
                  <Text style={[styles.attachOptionLabel, { color: theme.colors.onSurface }]}>{t('chats.document', 'מסמך')}</Text>
                </Pressable>
                <Pressable onPress={() => { setShowAttachSheet(false); handleOpenConversation(); }} style={({ pressed }) => [styles.attachOption, pressed && { opacity: 0.7 }]}>
                  <View style={[styles.attachOptionIcon, { backgroundColor: '#00BFA5' }]}>
                    <MaterialCommunityIcons name="file-document-edit-outline" size={24} color="#fff" />
                  </View>
                  <Text style={[styles.attachOptionLabel, { color: theme.colors.onSurface }]}>{t('chats.template', 'תבנית')}</Text>
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
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
          <Pressable style={styles.modalOverlay} onPress={() => setShowQuickActionsSheet(false)}>
            <Pressable style={[styles.templateSheet, { backgroundColor: theme.colors.surface, paddingBottom: insets.bottom + 12 }]} onPress={(e) => e.stopPropagation()}>
              <View style={styles.actionSheetHandle} />
              <View style={styles.templateSheetHeader}>
                <Text variant="titleMedium" style={{ fontWeight: '700', color: theme.colors.onSurface, flex: 1 }}>
                  {t('chats.quickActions', 'פעולות מהירות')}
                </Text>
                <IconButton icon="close" size={20} onPress={() => setShowQuickActionsSheet(false)} />
              </View>
              {[
                { icon: 'note-edit-outline', label: isRTL ? 'הוסף הערה לציר זמן' : 'Add Timeline Note', color: '#795548', action: () => { setShowQuickActionsSheet(false); setShowAddNoteModal(true); } },
                { icon: 'account-switch-outline', label: isRTL ? 'שייך בעלים' : 'Assign Owner', color: '#3F51B5', action: () => { setShowQuickActionsSheet(false); setShowAssignOwnerModal(true); } },
                { icon: 'clock-outline', label: t('chats.scheduleMessage', 'תזמן הודעה'), color: '#607D8B', action: () => { setShowQuickActionsSheet(false); setShowScheduleModal(true); } },
                { icon: 'clipboard-check-outline', label: t('tasks.addTask'), color: '#2196F3', action: () => { setShowQuickActionsSheet(false); setCreateTaskTitle(''); setCreateTaskDueDate(''); setCreateTaskPriority('medium'); setSelectedDate(null); setShowCreateTaskModal(true); } },
                { icon: 'image-multiple', label: isRTL ? 'מדיה' : 'Media', color: '#7C4DFF', action: () => { setShowQuickActionsSheet(false); setMediaPanelVisible(true); } },
                { icon: 'account-plus-outline', label: t('leads.createLead', 'צור ליד'), color: '#4CAF50', action: () => { setShowQuickActionsSheet(false); router.push({ pathname: '/(tabs)/leads/[id]', params: { id: 'new', contactPhone: phoneNumber as string, prefillContactName: contactName } } as any); } },
                { icon: 'ticket-outline', label: t('cases.createCase', 'צור פנייה'), color: '#9C27B0', action: () => { setShowQuickActionsSheet(false); router.push({ pathname: '/(tabs)/more/cases/[id]', params: { id: 'new', contactPhone: phoneNumber as string, prefillContactName: contactName } } as any); } },
              ].map((item) => (
                <Pressable
                  key={item.label}
                  onPress={item.action}
                  style={({ pressed }) => [
                    styles.templateItem,
                    { flexDirection: 'row', alignItems: 'center' },
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
            </Pressable>
          </Pressable>
        </Modal>

        {/* Assign Owner Modal */}
        <Modal
          visible={showAssignOwnerModal}
          transparent
          animationType="slide"
          onRequestClose={() => setShowAssignOwnerModal(false)}
        >
          <Pressable style={styles.modalOverlay} onPress={() => setShowAssignOwnerModal(false)}>
            <Pressable style={[styles.templateSheet, { backgroundColor: theme.colors.surface, paddingBottom: insets.bottom + 12 }]} onPress={(e) => e.stopPropagation()}>
              <View style={styles.actionSheetHandle} />
              <View style={styles.templateSheetHeader}>
                <Text variant="titleMedium" style={{ fontWeight: '700', color: theme.colors.onSurface, flex: 1 }}>
                  {isRTL ? 'שייך בעלים' : 'Assign Owner'}
                </Text>
                <IconButton icon="close" size={20} onPress={() => setShowAssignOwnerModal(false)} />
              </View>
              {isLoadingOwners ? (
                <ActivityIndicator style={{ marginVertical: 20 }} />
              ) : (
                <ScrollView style={{ maxHeight: 350 }}>
                  {availableOwners.map((owner) => {
                    const ownerId = owner.uID || owner.userId || owner.id || '';
                    const ownerName = owner.UserName || owner.fullname || owner.displayName || owner.email || ownerId;
                    return (
                      <Pressable
                        key={ownerId}
                        onPress={() => handleAssignOwner(ownerId, ownerName)}
                        disabled={assigningOwner}
                        style={({ pressed }) => [
                          styles.templateItem,
                          { flexDirection: 'row', alignItems: 'center' },
                          pressed && { backgroundColor: theme.colors.surfaceVariant },
                        ]}
                      >
                        <Avatar.Text
                          size={36}
                          label={getInitials(ownerName)}
                          style={{ backgroundColor: theme.colors.primaryContainer }}
                          labelStyle={{ fontSize: 14, color: theme.colors.onPrimaryContainer }}
                        />
                        <Text variant="bodyMedium" style={{ color: theme.colors.onSurface, fontWeight: '600', marginStart: 12 }}>
                          {ownerName}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              )}
            </Pressable>
          </Pressable>
        </Modal>

        {/* Create Task Modal */}
        <Modal
          visible={showCreateTaskModal}
          transparent
          animationType="slide"
          onRequestClose={() => setShowCreateTaskModal(false)}
        >
          <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
            <Pressable style={styles.modalOverlay} onPress={() => setShowCreateTaskModal(false)}>
              <Pressable style={[styles.templateSheet, { backgroundColor: theme.colors.surface, paddingBottom: insets.bottom + 12 }]} onPress={(e) => e.stopPropagation()}>
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
                  <View style={{ flexDirection: 'row', gap: 8, marginBottom: 4 }}>
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
              </Pressable>
            </Pressable>
          </KeyboardAvoidingView>
        </Modal>

        {/* Add Note Modal — keyboard-safe bottom sheet */}
        <Modal
          visible={showAddNoteModal}
          transparent
          animationType="slide"
          onRequestClose={() => { Keyboard.dismiss(); setShowAddNoteModal(false); }}
        >
          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top : 0}
          >
            <Pressable
              style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}
              onPress={() => { Keyboard.dismiss(); setShowAddNoteModal(false); }}
            >
              <Pressable
                style={{
                  backgroundColor: theme.colors.surface,
                  borderTopLeftRadius: 16,
                  borderTopRightRadius: 16,
                  paddingBottom: Math.max(insets.bottom, 16),
                }}
                onPress={() => {}}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 20, paddingBottom: 12 }}>
                  <Text variant="titleMedium" style={{ fontWeight: '700', color: theme.colors.onSurface }}>
                    {isRTL ? '📝 הוסף הערה' : '📝 Add Note'}
                  </Text>
                  <IconButton icon="close" size={20} onPress={() => { Keyboard.dismiss(); setShowAddNoteModal(false); }} />
                </View>

                <TextInput
                  value={noteText}
                  onChangeText={setNoteText}
                  placeholder={isRTL ? 'כתוב הערה...' : 'Write a note...'}
                  placeholderTextColor={theme.colors.onSurfaceVariant}
                  multiline
                  autoFocus
                  style={{
                    borderWidth: 1,
                    borderColor: theme.colors.outline,
                    borderRadius: 10,
                    padding: 12,
                    minHeight: 100,
                    maxHeight: 160,
                    fontSize: 14,
                    color: theme.colors.onSurface,
                    textAlignVertical: 'top',
                    direction: isRTL ? 'rtl' : 'ltr',
                    textAlign: isRTL ? 'right' : 'left',
                    marginHorizontal: 20,
                  }}
                />

                <Button
                  mode="contained"
                  onPress={() => { Keyboard.dismiss(); handleSaveNote(); }}
                  loading={savingNote}
                  disabled={savingNote || !noteText.trim()}
                  buttonColor="#795548"
                  textColor="white"
                  style={{ marginHorizontal: 20, marginTop: 12, marginBottom: 8, borderRadius: 8 }}
                >
                  {isRTL ? 'שמור הערה' : 'Save Note'}
                </Button>
              </Pressable>
            </Pressable>
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

      <MediaPanel
        visible={mediaPanelVisible}
        onClose={() => setMediaPanelVisible(false)}
        contactPhone={phoneNumber || ''}
        organization={user?.organization || ''}
        messages={currentMessages}
        wabaNumbers={wabaNumbers.length > 1 ? wabaNumbers : undefined}
      />

      {/* Media Gallery Viewer (opened from message bubble tap) */}
      {galleryVisible && mediaMessages.length > 0 && (
        <Modal visible animationType="fade" transparent onRequestClose={() => setGalleryVisible(false)}>
          <View style={styles.galleryOverlay}>
            <View style={styles.galleryHeader}>
              <IconButton icon="close" size={28} iconColor="#fff" onPress={() => setGalleryVisible(false)} />
              <Text style={styles.galleryCounter}>
                {galleryIndex + 1} / {mediaMessages.length}
              </Text>
              <IconButton
                icon="download"
                size={28}
                iconColor="#fff"
                onPress={() => {
                  const m = mediaMessages[galleryIndex];
                  const url = m?.gmbt_mediaUrl || m?.mediaUrl || (m as any)?.MediaUrl || '';
                  if (url) Linking.openURL(url).catch(() => {});
                }}
              />
            </View>
            <View style={styles.galleryContent}>
              {galleryIndex > 0 && (
                <Pressable style={[styles.galleryNavBtn, { left: 8 }]} onPress={() => setGalleryIndex((i) => i - 1)}>
                  <MaterialCommunityIcons name="chevron-left" size={36} color="#fff" />
                </Pressable>
              )}
              {galleryIndex < mediaMessages.length - 1 && (
                <Pressable style={[styles.galleryNavBtn, { right: 8 }]} onPress={() => setGalleryIndex((i) => i + 1)}>
                  <MaterialCommunityIcons name="chevron-right" size={36} color="#fff" />
                </Pressable>
              )}
              {(() => {
                const m = mediaMessages[galleryIndex];
                const url = m?.gmbt_mediaUrl || m?.mediaUrl || (m as any)?.MediaUrl || '';
                const tp = (m?.type || m?.mediaType || '').toLowerCase();
                const isVideo = tp === 'video' || /\.(mp4|mov|avi|webm|3gp)(\?|$)/i.test(url);
                if (isVideo) {
                  const VideoComp = require('expo-av').Video;
                  const RM = require('expo-av').ResizeMode;
                  return <VideoComp source={{ uri: url }} style={styles.galleryVideo} useNativeControls resizeMode={RM.CONTAIN} shouldPlay />;
                }
                return (
                  <Image
                    source={{ uri: url }}
                    style={styles.galleryImage}
                    contentFit="contain"
                  />
                );
              })()}
            </View>
            <View style={styles.galleryFooter}>
              <Text style={styles.galleryCaption} numberOfLines={2}>
                {mediaMessages[galleryIndex]?.text || mediaMessages[galleryIndex]?.body || mediaMessages[galleryIndex]?.caption || ''}
              </Text>
              <Text style={styles.galleryTime}>
                {formatMessageTime(getTs(mediaMessages[galleryIndex]))}
              </Text>
            </View>
          </View>
        </Modal>
      )}

      <ContactInfoSheet
        visible={showContactInfoSheet}
        onDismiss={() => setShowContactInfoSheet(false)}
        organization={user?.organization || ''}
        phoneNumber={phoneNumber as string}
        userId={user?.uID || user?.userId || ''}
        contactData={chat}
        onUpdate={() => {
          if (user?.organization && phoneNumber) {
            loadMessages(user.organization, phoneNumber as string);
          }
        }}
      />
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
    paddingHorizontal: 2,
  },
  olderMsgsLoader: {
    alignItems: 'center',
    paddingVertical: 16,
  },
  emptyMessages: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  separatorWrap: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  separatorPill: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 0.5 },
    shadowOpacity: 0.06,
    shadowRadius: 1,
  },
  separatorText: {
    fontSize: 12,
    fontWeight: '600',
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
  closedInlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.05)',
  },
  chatMetaBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  metaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
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
  defaultTemplateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 16,
    marginBottom: 12,
    paddingVertical: 12,
    borderRadius: 10,
    gap: 8,
  },
  defaultTemplateBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
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
  scheduleActions: {
    flexDirection: 'row',
    gap: 10,
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
  templateSearchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  templateSearchInput: {
    flex: 1,
    fontSize: 14,
    paddingVertical: 0,
  },
  attachSheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 8,
    paddingHorizontal: 16,
    width: '100%',
  },
  attachGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-around',
    paddingVertical: 20,
    gap: 16,
  },
  attachOption: {
    alignItems: 'center',
    width: 70,
  },
  attachOptionIcon: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  attachOptionLabel: {
    fontSize: 12,
    fontWeight: '500',
    textAlign: 'center',
  },
  galleryOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.95)',
  },
  galleryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Platform.OS === 'ios' ? 54 : 36,
    paddingHorizontal: 4,
  },
  galleryCounter: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 15,
    fontWeight: '500',
  },
  galleryContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  galleryNavBtn: {
    position: 'absolute',
    top: '45%',
    zIndex: 10,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 28,
    padding: 6,
  },
  galleryImage: {
    width: '100%',
    height: '100%',
  },
  galleryVideo: {
    width: '100%',
    height: '80%',
  },
  galleryFooter: {
    paddingHorizontal: 20,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
    paddingTop: 10,
    alignItems: 'center',
  },
  galleryCaption: {
    color: '#fff',
    fontSize: 14,
    textAlign: 'center',
  },
  galleryTime: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
    marginTop: 4,
  },
});
