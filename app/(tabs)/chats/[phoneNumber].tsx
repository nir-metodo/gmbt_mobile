import React, {
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo,
  forwardRef,
  useImperativeHandle,
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
  TouchableOpacity,
  InteractionManager,
  Dimensions,
} from 'react-native';
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
import GambotDateTimePicker from '../../../components/GambotDateTimePicker';
import { useChatStore } from '../../../stores/chatStore';
import { useAuthStore } from '../../../stores/authStore';
import { useContactStore } from '../../../stores/contactStore';
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
import ForwardMessageSheet from '../../../components/chat/ForwardMessageSheet';
import AddTaskSheet from '../../../components/AddTaskSheet';
import ZoomableImage from '../../../components/ZoomableImage';
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

// Self-contained 24h-window countdown badge. It owns its own 1-second interval so the
// parent chat screen (and the message FlashList) do NOT re-render every second — which is
// the main cause of flicker in large conversations with media.
const ConversationCountdownBadge = React.memo(function ConversationCountdownBadge({
  expiresAt,
}: {
  expiresAt: string;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const diff = new Date(expiresAt).getTime() - now;
  if (isNaN(diff) || diff <= 0) return null;
  const hours = Math.floor(diff / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  const secs = Math.floor((diff % 60000) / 1000);
  const color = diff < 3600000 ? '#FFA500' : '#90EE90';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 10, paddingHorizontal: 6, paddingVertical: 2, marginEnd: 2 }}>
      <MaterialCommunityIcons name="clock-outline" size={13} color={color} />
      <Text style={{ color, fontSize: 11, fontWeight: '600', marginStart: 3 }}>
        {hours}:{mins.toString().padStart(2, '0')}:{secs.toString().padStart(2, '0')}
      </Text>
    </View>
  );
});

// Scroll-to-bottom FAB isolated into its own component. The visibility flag changes on
// nearly every scroll frame; if it lived as state on the chat screen it would re-render the
// entire screen (and the message FlashList) constantly while scrolling. Here it owns its own
// `visible` state and exposes an imperative `setVisible`, so a scroll only re-renders this
// ~38px button instead of the whole conversation.
export type ScrollToBottomHandle = { setVisible: (v: boolean) => void };

const ScrollToBottomButton = forwardRef<
  ScrollToBottomHandle,
  { onPress: () => void; style: any; backgroundColor: string; iconColor: string }
>(({ onPress, style, backgroundColor, iconColor }, ref) => {
  const [visible, setVisible] = useState(false);
  useImperativeHandle(
    ref,
    () => ({
      setVisible: (v: boolean) => setVisible((prev) => (prev === v ? prev : v)),
    }),
    [],
  );
  if (!visible) return null;
  return (
    <Pressable onPress={onPress} style={[style, { backgroundColor }]}>
      <MaterialCommunityIcons name="chevron-down" size={22} color={iconColor} />
    </Pressable>
  );
});

// Build a human-readable line for a chat timeline/activity entry (mirrors the web
// ChatTimelineMessage.buildTimelineMessage). Action events (tasks, status changes,
// assignments, etc.) don't carry a `note`/`text`, so without this they render blank.
function buildTimelineText(entry: any, isHe: boolean): string {
  const type = (entry?.timelineType || entry?.TimelineType || entry?.type || '').toLowerCase();
  const by = entry?.createdByName || entry?.CreatedByName || entry?.sentByName || entry?.addedByName || (isHe ? 'לא ידוע' : 'Unknown');
  const taskTitle = entry?.taskTitle || entry?.title || (isHe ? 'משימה' : 'Task');
  const note = entry?.note || entry?.activityText || entry?.text || '';
  const assignedTo = entry?.assignedToName || entry?.assignToName || '';
  const priority = entry?.priority || 'medium';
  switch (type) {
    case 'task_created':
      return isHe
        ? `📋 נוצרה משימה: "${taskTitle}"${assignedTo ? ` · שויך ל-${assignedTo}` : ''} · עדיפות: ${priority} · ע"י ${by}`
        : `📋 Task created: "${taskTitle}"${assignedTo ? ` · Assigned to ${assignedTo}` : ''} · Priority: ${priority} · by ${by}`;
    case 'task_status_change':
      return `📋 ${taskTitle} — ${note || (isHe ? 'שינוי סטטוס' : 'Status changed')}`;
    case 'task_assigned':
      return `📋 ${taskTitle} — ${note || (isHe ? 'הוקצתה מחדש' : 'Reassigned')}`;
    case 'task_priority_change':
      return `📋 ${taskTitle} — ${note || (isHe ? 'שינוי עדיפות' : 'Priority changed')}`;
    case 'task_due_date_change':
      return `📋 ${taskTitle} — ${note || (isHe ? 'שינוי תאריך יעד' : 'Due date changed')}`;
    case 'task_completed':
      return `📋 ${taskTitle} — ${isHe ? 'הושלמה' : 'Completed'}`;
    case 'assign':
      return isHe ? `שויך ל-${assignedTo || by}` : `Assigned to ${assignedTo || by}`;
    case 'open conversation':
      return isHe ? `השיחה נפתחה ע"י ${by}` : `Conversation opened by ${by}`;
    case 'close':
      return isHe ? `השיחה נסגרה ע"י ${by}` : `Conversation closed by ${by}`;
    case 'status change':
    case 'category change':
    case 'lead stage change':
    case 'case stage change':
      return `${note || ''}${by ? (isHe ? ` · ${by}` : ` · by ${by}`) : ''}`;
    case 'campaign message sent':
      return isHe ? `הודעת קמפיין נשלחה: ${note}` : `Campaign message sent: ${note}`;
    case 'botomation send message':
      return isHe ? `הודעת בוטומיישן נשלחה (${note})` : `Botomation message sent (${note})`;
    case 'start conversation manually':
      return isHe ? `שיחה נפתחה ידנית · תבנית: ${note}` : `Conversation started manually · template: ${note}`;
    case 'outbound_phone_call_initiated':
      return isHe ? `📞 שיחה יוצאת התחילה${by ? ` · ${by}` : ''}` : `📞 Outbound call started${by ? ` · by ${by}` : ''}`;
    case 'outbound_phone_call_completed': {
      const dur = entry?.duration ? `${entry.duration}s` : '';
      const st = entry?.status || (isHe ? 'הסתיימה' : 'completed');
      return isHe ? `📞 שיחה הסתיימה (${st})${dur ? ` · ${dur}` : ''}` : `📞 Call ended (${st})${dur ? ` · ${dur}` : ''}`;
    }
    case 'lead_created':
      return isHe ? `נוצר ליד: ${entry?.title || note}` : `Lead created: ${entry?.title || note}`;
    case 'case_created':
      return isHe ? `נוצרה פנייה: ${entry?.title || note}` : `Case created: ${entry?.title || note}`;
    case 'bot_action':
      return note || (isHe ? 'פעולת בוט' : 'Bot action');
    default:
      return note || '';
  }
}

// Crash-proof date/time formatter. On Android (Hermes) `Date.toLocaleString(locale, { dateStyle,
// timeStyle })` can throw when full ICU/Intl isn't bundled, which closes the whole app in a release
// build. Mirrors the helper used by the shared AddTaskSheet so scheduling matches the task due-date UX.
function formatScheduleDateTime(value: Date | null | undefined, lang: string): string {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return '';
  try {
    return d.toLocaleString(lang === 'he' ? 'he-IL' : 'en-US', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
}

// Build a full template variable-query entry matching the web SendTemplateMessage payload.
// Backend maps variables by `index` + `bodyVarIndex`; minimal entries cause unresolved {{n}}
// placeholders and Meta rejects the send. Keep this identical across all send/schedule paths.
function buildTemplateVarEntry(bodyVarIndex: number, value: string, queryIndex: number, label?: string) {
  return {
    index: queryIndex,
    bodyVarIndex,
    Variable: `dynamic_var${bodyVarIndex}`,
    variableLabel: label || `{{${bodyVarIndex}}}`,
    dataSource1: 'data_source1_HardCoded',
    dataSource2: '',
    conditionOperator: '',
    parameters_hardCoded_Text: value,
    field1: [],
    field2: [],
    table1: '',
    table2: '',
    retrieveFields: [],
  };
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
  const updateMessageStatus = useChatStore((s) => s.updateMessageStatus);
  const addOptimisticMedia = useChatStore((s) => s.addOptimisticMedia);
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
  const [showTemplateSelector, setShowTemplateSelector] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(false);
  const [isSendingTemplate, setIsSendingTemplate] = useState(false);
  // Whether a default ("open conversation") template is configured for this org / selected number.
  // null = not yet checked; false = none configured → the quick-send button is shown disabled/greyed
  // so it doesn't confuse the user, and tapping it explains how to set one in Settings.
  const [hasDefaultTemplate, setHasDefaultTemplate] = useState<boolean | null>(null);
  // Synchronous guard against double template sends. `isSendingTemplate` is React state and
  // updates asynchronously, so two fast taps can both pass the check and send the template
  // twice to the customer. A ref flips immediately and blocks the second call.
  const sendingTemplateRef = useRef(false);
  const [scheduleText, setScheduleText] = useState('');
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleTime, setScheduleTime] = useState('');
  const [isScheduling, setIsScheduling] = useState(false);
  const [scheduledDateTime, setScheduledDateTime] = useState<Date | null>(null);
  const [showScheduleDatePicker, setShowScheduleDatePicker] = useState(false);
  const [showScheduleTimePicker, setShowScheduleTimePicker] = useState(false);
  // Schedule: choose between a regular (free-text) message or a template.
  const [scheduleMessageType, setScheduleMessageType] = useState<'text' | 'template'>('text');
  const [scheduleTemplate, setScheduleTemplate] = useState<Template | null>(null);
  const [scheduleVarValues, setScheduleVarValues] = useState<Record<number, string>>({});
  const [selectedTemplateForVars, setSelectedTemplateForVars] = useState<Template | null>(null);
  const [templateVariableValues, setTemplateVariableValues] = useState<Record<number, string>>({});
  // Quick / Manual tab state inside template modal
  const [templateActiveTab, setTemplateActiveTab] = useState<'quick' | 'manual'>('quick');
  const [quickTemplateSearch, setQuickTemplateSearch] = useState('');
  const [quickOpenVarValues, setQuickOpenVarValues] = useState<Record<string, string>>({});
  const flatListRef = useRef<FlatList<ListItem>>(null);
  const scrollBtnRef = useRef<ScrollToBottomHandle>(null);
  const chatInputRef = useRef<ChatInputRef>(null);
  const wsRef = useRef<WebSocketService | null>(null);
  // Timestamp of the last messages fetch for this chat. Used to throttle the
  // AppState->active reload so foregrounding the app doesn't trigger a redundant
  // getMessages (and the visual churn that comes with it) right after open.
  const lastMessagesFetchAtRef = useRef(0);

  // Keeps the message list invisible until FlashList has finished its first layout. With
  // maintainVisibleContentPosition.startRenderingFromBottom the list opens already pinned to the
  // newest message, but the variable-height rows can visibly "travel" into place for a moment.
  // Revealing only after onLoad means the chat appears already locked on the last message.
  const [listReady, setListReady] = useState(false);
  // FlatList has no onLoad; reveal the list the moment it first has measurable content. Inverted
  // lists open at offset 0 (newest) instantly, so there's nothing to wait for beyond first layout.
  const handleContentSizeChange = useCallback(() => setListReady(true), []);

  // Imperative "snap to newest". The list is INVERTED (mirrors the web's column-reverse), so the
  // newest message sits at the visual bottom == scroll offset 0. scrollToOffset(0) is the rock-solid
  // way to jump to it (scrollToEnd on an inverted list goes to the OLDEST message).
  const scrollToNewest = useCallback((animated = true) => {
    try { flatListRef.current?.scrollToOffset({ offset: 0, animated }); } catch {}
  }, []);

  // Re-hide on chat switch (the list remounts via key={phoneNumber}). An inverted FlatList opens
  // already pinned to the newest message (offset 0) with no "travel", so we reveal it as soon as it
  // has content (onContentSizeChange) — a timeout fallback guarantees it's always shown.
  useEffect(() => {
    setListReady(false);
    const t = setTimeout(() => setListReady(true), 1200);
    return () => clearTimeout(t);
  }, [phoneNumber]);

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
  const [orgUsersLoading, setOrgUsersLoading] = useState(false);
  const [showMentionPicker, setShowMentionPicker] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionedUsers, setMentionedUsers] = useState<{ userId: string; userName: string }[]>([]);
  // Measured height of the bottom input bar (composer / closed-window buttons). The @mention and
  // "/" quick-message pickers anchor exactly on top of it. A previous fixed 70px offset hid the
  // pickers behind the input on devices with a gesture-nav safe-area inset (taller input bar).
  const [inputBarHeight, setInputBarHeight] = useState(72);
  // Live keyboard height. On iOS the screen uses KeyboardAvoidingView behavior="padding", which does
  // NOT shift absolutely-positioned overlays — so the "/" and "@" pickers (anchored with `bottom`)
  // ended up hidden BEHIND the keyboard. We track the keyboard height and add it to the pickers'
  // bottom offset so they always float directly above the input bar while the keyboard is open.
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  // @mentions for the timeline note composer (Add-Note modal + timeline sheet). When a note has
  // mentions we send it as an internal message (mirrors web) so the tagged users get notified.
  const [showNoteMentionPicker, setShowNoteMentionPicker] = useState(false);
  const [noteMentionQuery, setNoteMentionQuery] = useState('');
  const [noteMentions, setNoteMentions] = useState<{ userId: string; userName: string }[]>([]);

  // Prefetch org users so the @-mention list appears instantly the moment "@" is typed.
  const loadOrgUsers = useCallback(() => {
    if (!user?.organization) return;
    setOrgUsersLoading(true);
    usersApi.getAll(user.organization)
      .then((users) => setOrgUsers(Array.isArray(users) ? users : []))
      .catch(() => {})
      .finally(() => setOrgUsersLoading(false));
  }, [user?.organization]);

  useEffect(() => {
    if (user?.organization && orgUsers.length === 0) {
      loadOrgUsers();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.organization]);

  // Keep keyboardHeight in sync. iOS fires *Will* events (smoother, matches the padding animation);
  // Android only reliably fires *Did* events. Height resets to 0 on hide so the pickers drop back to
  // sitting directly on top of the input bar.
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvt, (e: any) => {
      setKeyboardHeight(e?.endCoordinates?.height || 0);
    });
    const hideSub = Keyboard.addListener(hideEvt, () => setKeyboardHeight(0));
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);

  // / slash → inline quick messages
  const [quickSlashFilter, setQuickSlashFilter] = useState('');
  const [showInlineQuickMessages, setShowInlineQuickMessages] = useState(false);

  // Timeline entries
  const [timelineEntries, setTimelineEntries] = useState<any[]>([]);
  // Optimistic, client-side timeline entries so status/category/lead-stage/note changes made from
  // the chat show in the conversation timeline INSTANTLY (before the server round-trip, and even for
  // events the backend doesn't log to the chat timeline, e.g. lead-stage moves).
  const [localTimeline, setLocalTimeline] = useState<any[]>([]);
  // Dedicated timeline sheet (full notes + activity view, like the web "ציר זמן" tab)
  const [showTimelineSheet, setShowTimelineSheet] = useState(false);
  const [timelineFilter, setTimelineFilter] = useState<'all' | 'notes'>('all');

  // Outbound calling
  const [isInitiatingCall, setIsInitiatingCall] = useState(false);
  const [telSettings, setTelSettings] = useState<{ phoneNumbers?: any[]; defaultCallerId?: string } | null>(null);

  // Media gallery viewer
  const [galleryVisible, setGalleryVisible] = useState(false);
  const [galleryIndex, setGalleryIndex] = useState(0);
  // Hide the prev/next arrows while an image is pinch-zoomed so panning doesn't fight navigation.
  const [galleryZoomed, setGalleryZoomed] = useState(false);
  // Media grid — a WhatsApp-style "shared media" overview opened from the header.
  const [mediaGridVisible, setMediaGridVisible] = useState(false);

  // Contact Info sheet (category, status, lead stage, tags, timeline)
  const [showContactInfoSheet, setShowContactInfoSheet] = useState(false);
  // Which tab the Contact Info sheet opens on ('internal' = internal-message composer, used from
  // the closed-window banner where the inline @-mention composer isn't available).
  const [contactInfoInitialTab, setContactInfoInitialTab] = useState<'details' | 'internal'>('details');

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

  // Forward message sheet
  const [showForwardSheet, setShowForwardSheet] = useState(false);
  const [forwardMessage, setForwardMessage] = useState<Message | null>(null);

  // Assign Owner modal
  const [showAssignOwnerModal, setShowAssignOwnerModal] = useState(false);
  const [availableOwners, setAvailableOwners] = useState<any[]>([]);
  const [isLoadingOwners, setIsLoadingOwners] = useState(false);
  const [assigningOwner, setAssigningOwner] = useState(false);

  // Create Task from chat
  // Create-task from chat now reuses the shared AddTaskSheet (same bottom sheet as the Lead flow),
  // so we only need a visibility flag here — title/time/reminder/assignee are handled inside the sheet.
  const [showCreateTaskModal, setShowCreateTaskModal] = useState(false);

  // Name resolved from the contacts API when the chat isn't in the store yet (opened via push /
  // deep link before the chat list loaded) or when the store only has the phone number. Prevents
  // the header from being stuck showing the raw phone number.
  const [resolvedContactName, setResolvedContactName] = useState('');

  const phoneDigits = String(phoneNumber || '').replace(/\D/g, '');
  const storeContactName =
    chat?.contactName && chat.contactName.replace(/\D/g, '') !== phoneDigits
      ? chat.contactName
      : '';
  const contactName = storeContactName || resolvedContactName || phoneNumber || '';

  useEffect(() => {
    // Only resolve when we don't already have a real (non-phone) name.
    if (storeContactName || resolvedContactName) return;
    if (!user?.organization || !phoneNumber) return;
    let cancelled = false;
    (async () => {
      try {
        const c: any = await contactsApi.getById(user.organization, phoneNumber as string);
        if (cancelled || !c) return;
        const name =
          c.name || c.Name || c.fullName || c.FullName ||
          [c.firstName || c.FirstName, c.lastName || c.LastName].filter(Boolean).join(' ').trim() ||
          c.contactName || c.ContactName || '';
        if (name && name.replace(/\D/g, '') !== phoneDigits) {
          setResolvedContactName(name);
        }
      } catch {
        // best-effort — header falls back to the phone number
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.organization, phoneNumber, storeContactName]);

  const [orgWabaNumbers, setOrgWabaNumbers] = useState<WabaNumberInfo[]>([]);
  // Memoize so the reference is stable across renders. `|| []` would otherwise produce a NEW empty
  // array every render, which propagates through `wabaNumbers` → `renderItem` and forces the entire
  // message list to re-render on every parent render (countdown tick, isSending, store updates…).
  const assignedNums = useMemo(() => user?.assignedWhatsAppNumbers || [], [user?.assignedWhatsAppNumbers]);

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

  // Memoized for referential stability (see assignedNums note) — feeds the `wabaNumbers` memo and,
  // through it, the message list's `renderItem`.
  const allWabaNumbers = useMemo<WabaNumberInfo[]>(() => (
    orgWabaNumbers.length > 0
      ? orgWabaNumbers
      : (user?.wabaNumbers || (user?.wabaNumber ? [{ PhoneNumberId: user.wabaNumber, DisplayNumber: user.wabaNumber }] : []))
  ), [orgWabaNumbers, user?.wabaNumbers, user?.wabaNumber]);

  // If user has assigned numbers, restrict wabaNumbers to only those they have access to
  const wabaNumbers = useMemo((): WabaNumberInfo[] => {
    if (assignedNums.length === 0) return allWabaNumbers;
    return allWabaNumbers.filter((n) => {
      const id = n.PhoneNumberId || n.phoneNumberId || '';
      return assignedNums.includes(id);
    });
  }, [allWabaNumbers, assignedNums]);

  // Fallback: derive the conversation's WABA number from the loaded messages.
  // Used when the chat isn't in the store yet (e.g. opened directly from a push
  // notification before the chat list has loaded). A single thread always belongs to
  // exactly one WABA number, so the most recent message carrying a number is reliable.
  const messagesWabaId = useMemo(() => {
    for (let i = currentMessages.length - 1; i >= 0; i--) {
      const m: any = currentMessages[i];
      const id = m?.fromNumberId || m?.wabaPhoneNumberId || m?.phoneNumberId;
      if (id) return String(id);
    }
    return '';
  }, [currentMessages]);

  // The WABA number this specific contact's conversation belongs to.
  const contactWabaId = chat?.lastFromNumberId || chat?.wabaPhoneNumberId || messagesWabaId || '';

  // fromNumberId to use when sending/scheduling templates. Mirrors the web: only send an
  // explicit PhoneNumberId for multi-number orgs (and only when it's a real, resolvable id).
  // For single-number orgs we send empty so the backend uses the default WABA settings —
  // passing a display number (user.wabaNumber) here makes GetOrgWabaSettingsByPhoneNumberId
  // return null and the template send fails with "WhatsApp settings not configured".
  const sendFromNumberId = useMemo(() => {
    if (
      allWabaNumbers.length > 1 &&
      activeWabaNumber &&
      allWabaNumbers.some((n) => (n.PhoneNumberId || n.phoneNumberId) === activeWabaNumber)
    ) {
      return activeWabaNumber;
    }
    return '';
  }, [allWabaNumbers, activeWabaNumber]);

  useEffect(() => {
    // 1. Explicit number passed via navigation (e.g. from a number-filtered list).
    if (defaultWabaNumber && wabaNumbers.some((n) => (n.PhoneNumberId || n.phoneNumberId) === defaultWabaNumber)) {
      setActiveWabaNumber(defaultWabaNumber);
      return;
    }
    // 2. Auto-detect THIS contact's associated number (mirrors web ChatContainer).
    //    Critical: without this the global activeWabaNumber stays stuck on the previous
    //    contact's number, so the conversation-status query is sent with the wrong
    //    fromNumberId and the backend replies "not live" → every chat shows as closed.
    if (contactWabaId && wabaNumbers.some((n) => (n.PhoneNumberId || n.phoneNumberId) === contactWabaId)) {
      if (contactWabaId !== activeWabaNumber) setActiveWabaNumber(contactWabaId);
      return;
    }
    // 3. Fall back to the user's assigned / first number only when nothing is selected yet.
    if (!activeWabaNumber) {
      if (assignedNums.length > 0) {
        setActiveWabaNumber(assignedNums[0]);
      } else if (wabaNumbers.length > 0) {
        setActiveWabaNumber(wabaNumbers[0].PhoneNumberId || wabaNumbers[0].phoneNumberId || user?.wabaNumber || '');
      } else if (user?.wabaNumber) {
        setActiveWabaNumber(user.wabaNumber);
      }
    }
  }, [user?.wabaNumber, activeWabaNumber, setActiveWabaNumber, wabaNumbers, defaultWabaNumber, contactWabaId]);

  const [conversationLive, setConversationLive] = useState<boolean | null>(null);
  const [recipientReplied24h, setRecipientReplied24h] = useState<boolean | null>(null);
  const [conversationExpiresAt, setConversationExpiresAt] = useState<string | null>(null);
  const [isFreeEntryPoint, setIsFreeEntryPoint] = useState(false);
  const [freeWindowExpiresAt, setFreeWindowExpiresAt] = useState<string | null>(null);
  const [countdownNow, setCountdownNow] = useState(Date.now());
  // Which inline timeline notes are expanded ("view more"). Keyed by the list item id so many
  // can be open at once across the recycling list.
  const [expandedNotes, setExpandedNotes] = useState<Set<string>>(() => new Set());
  const toggleNoteExpanded = useCallback((id: string) => {
    setExpandedNotes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);
  const [chatStatus, setChatStatus] = useState<string>('');
  const [chatCategory, setChatCategory] = useState<string>('');
  const [orgCategories, setOrgCategories] = useState<string[]>([]);
  const [showStatusMenu, setShowStatusMenu] = useState(false);
  const [showCategoryMenu, setShowCategoryMenu] = useState(false);

  // ── Synchronous reset on chat switch (fixes "every chat first shows open") ──
  // This screen instance is REUSED when navigating between chats: only the route
  // param changes, React keeps the same component + state. The reset useEffect below
  // runs AFTER the first paint, so the *previous* chat's live/open flags would flash
  // on the new chat until the API responds — making a closed chat briefly look open
  // (and, combined with the WABA leak, then look closed). Resetting here (during
  // render, guarded by a ref) guarantees the new chat starts from a clean
  // "loading → closed" state on its very first render, exactly like the web.
  const phoneTrackRef = useRef(phoneNumber);
  if (phoneTrackRef.current !== phoneNumber) {
    phoneTrackRef.current = phoneNumber;
    setConversationLive(null);
    setRecipientReplied24h(null);
    setConversationExpiresAt(null);
    setIsFreeEntryPoint(false);
    setFreeWindowExpiresAt(null);
  }

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
    // Mirror web: only scope the query to a specific number for multi-number orgs.
    // Single-number orgs let the backend resolve the number, avoiding a wrong fromNumberId.
    // Prefer THIS contact's own WABA number (contactWabaId) over the global
    // activeWabaNumber — the latter is a shared Zustand value that can still hold the
    // PREVIOUS chat's number, which makes the backend filter inbound messages by the
    // wrong number and reply "not live" for every chat (the "all chats closed" bug).
    // Only ever scope the query to THIS contact's own resolved number (contactWabaId).
    // Never fall back to the global activeWabaNumber here: while switching chats it can still
    // hold the PREVIOUS chat's number, which makes the backend filter by the wrong number and
    // reply "not live" → the composer wrongly flips to template buttons until a refetch fixes
    // it (the intermittent "shows template buttons on an open chat" bug). When contactWabaId
    // isn't resolved yet we send undefined and let the backend resolve by phone (same as the
    // single-number path), then refetch once contactWabaId loads (it's in this cb's deps).
    const fromNumberId = wabaNumbers.length > 1
      ? (contactWabaId || undefined)
      : undefined;
    chatsApi.getConversationStatus(user.organization, phoneNumber as string, fromNumberId).then((res) => {
      if (requestId !== statusRequestIdRef.current) return; // ignore stale responses
      const live = res?.IsConversationLive ?? res?.IsConversationLiveByPhoneNumber ?? res?.isConversationLive ?? res?.isLive;
      setConversationLive(live === true || live === 'true');
      const replied = res?.IsRecipientReplyLast24Hours ?? res?.isRecipientReplyLast24Hours;
      setRecipientReplied24h(replied === true || replied === 'true');
      const expires = res?.ConversationExpiresAt ?? res?.conversationExpiresAt;
      // Don't let a missing/empty expiry from a periodic refetch slam an otherwise-open window
      // shut (which flips the composer to template buttons and wipes what the user was typing).
      // If the server returns no expiry but we already have one that's still in the future, keep
      // it; only clear when the conversation is genuinely not live.
      setConversationExpiresAt((prev) => {
        if (expires) return expires;
        if (prev && new Date(prev).getTime() > Date.now() && (live === true || live === 'true')) return prev;
        return null;
      });
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
  }, [user?.organization, phoneNumber, activeWabaNumber, contactWabaId, wabaNumbers.length]);

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

  // NOTE: do NOT reset conversation state when the global activeWabaNumber changes.
  // activeWabaNumber is a shared Zustand value that gets auto-synced to this contact's number
  // (and can change from WS pushes / returning to the list) WHILE the chat is open. Nulling the
  // state here made isStatusLoading=true → canSendFreeText=false, which unmounted the text input,
  // flashed the template buttons on a legitimately-open chat, and wiped what the user was typing.
  // fetchConversationStatus already re-runs on activeWabaNumber/contactWabaId changes (its deps),
  // so the values refresh without a destructive null reset. Chat switches are handled by the
  // phoneNumber-keyed reset effect above.

  // Coarse tick (30s) only to re-evaluate whether a 24h / free window has expired.
  // The visible per-second countdown is isolated in <ConversationCountdownBadge> so the
  // whole screen + message list don't re-render every second.
  useEffect(() => {
    const interval = setInterval(() => setCountdownNow(Date.now()), 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!user?.organization) return;
    // Non-critical for first paint — defer until after the chat opens so messages render first.
    const task = InteractionManager.runAfterInteractions(() => {
      chatsApi.getConversationCategories(user.organization)
        .then((cats) => setOrgCategories(cats))
        .catch(() => {});
    });
    return () => task.cancel();
  }, [user?.organization]);

  // Prepend an optimistic timeline entry so a change made from the chat appears in the conversation
  // timeline immediately. `kind` drives dedup against the server timeline once it refreshes.
  const pushLocalTimeline = useCallback((kind: string, note: string, extra?: any) => {
    const now = new Date().toISOString();
    setLocalTimeline((prev) => [
      ...prev,
      {
        id: `local_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        _local: true,
        _kind: kind,
        timelineType:
          kind === 'status' ? 'status change'
          : kind === 'category' ? 'category change'
          : kind === 'leadstage' ? 'lead stage change'
          : kind === 'casestage' ? 'case stage change'
          : 'note',
        note,
        createdByName: user?.fullname || (user as any)?.FullName || (user as any)?.displayName || '',
        createdOn: now,
        timestamp: now,
        ...extra,
      },
    ]);
  }, [user?.fullname]);

  // Refetch the canonical server timeline (used after a change so other users' entries + the
  // server's own record of this change come through). Local optimistic entries are deduped at render.
  const refreshTimeline = useCallback(() => {
    if (!user?.organization || !phoneNumber) return;
    chatsApi.getChatTimeline(user.organization, phoneNumber as string)
      .then(setTimelineEntries)
      .catch(() => {});
  }, [user?.organization, phoneNumber]);

  const handleChangeStatus = useCallback(async (newStatus: string) => {
    if (!user?.organization || !phoneNumber) return;
    setShowStatusMenu(false);
    setChatStatus(newStatus);
    addOrUpdateChat({ phoneNumber: phoneNumber as string, lastConversationStatus: newStatus, status: newStatus } as any);
    const label = conversationStatusLabel(getChatConversationStatus({ lastConversationStatus: newStatus }), t);
    pushLocalTimeline('status', isRTL ? `סטטוס שונה ל: ${label}` : `Status changed to ${label}`);
    try {
      await chatsApi.updateConversationStatus(user.organization, phoneNumber as string, newStatus, user.uID || user.userId);
      setTimeout(refreshTimeline, 1200);
    } catch { }
  }, [user?.organization, phoneNumber, user?.uID, user?.userId, addOrUpdateChat, pushLocalTimeline, refreshTimeline, isRTL, t]);

  const handleChangeCategory = useCallback(async (newCategory: string) => {
    if (!user?.organization || !phoneNumber) return;
    setShowCategoryMenu(false);
    setChatCategory(newCategory);
    addOrUpdateChat({ phoneNumber: phoneNumber as string, lastConversationCategory: newCategory, category: newCategory } as any);
    pushLocalTimeline('category', isRTL
      ? `קטגוריה שונתה ל: ${newCategory || 'ללא קטגוריה'}`
      : `Category changed to ${newCategory || 'None'}`);
    try {
      await chatsApi.updateConversationCategory(user.organization, phoneNumber as string, newCategory);
      setTimeout(refreshTimeline, 1200);
    } catch { }
  }, [user?.organization, phoneNumber, addOrUpdateChat, pushLocalTimeline, refreshTimeline, isRTL]);

  // ── Lead / Case (פנייה) records for this contact ──────────────────────
  const loadCrmRecords = useCallback(async () => {
    if (!user?.organization || !phoneNumber) return;
    const organization = user.organization;
    // Backend GetLeadsByContact requires `contactPhone` (digits only). Send both keys + the
    // digits-only number so the lookup works regardless of which field the endpoint reads.
    const digits = String(phoneNumber).replace(/\D/g, '');
    const [leadsRes, stagesRes, casesRes, caseSettingsRes] = await Promise.allSettled([
      axiosInstance.post(ENDPOINTS.GET_LEADS_BY_CONTACT, { organization, contactPhone: digits, phoneNumber: digits }),
      axiosInstance.post(ENDPOINTS.GET_PIPELINE_SETTINGS, { organization }),
      axiosInstance.post(ENDPOINTS.GET_CASES_BY_CONTACT, { organization, contactPhone: digits, phoneNumber: digits }),
      axiosInstance.post(ENDPOINTS.GET_CASE_SETTINGS, { organization }),
    ]);
    if (leadsRes.status === 'fulfilled') {
      const raw = leadsRes.value.data;
      setContactLeads(Array.isArray(raw) ? raw : raw?.Data || raw?.data || []);
    }
    if (stagesRes.status === 'fulfilled') {
      const raw = stagesRes.value.data;
      // GetPipelineSettings returns the stages under pipelines[0].stages (same as web + the chat-list
      // screen + leadsApi.getPipelineSettings). Omitting that path left pipelineStages empty, so the
      // lead-stage dropdown had no options to pick from ("שלבי לידים לבחירה" didn't show).
      const stages = raw?.pipelines?.[0]?.stages || raw?.stages || raw?.Data?.stages || raw?.Stages || [];
      setPipelineStages(Array.isArray(stages) ? stages : []);
    }
    if (casesRes.status === 'fulfilled') {
      const raw = casesRes.value.data;
      setContactCases(Array.isArray(raw) ? raw : raw?.Data || raw?.data || []);
    }
    if (caseSettingsRes.status === 'fulfilled') {
      const raw = caseSettingsRes.value.data;
      // Same shape as the pipeline settings: case stages live under pipelines[0].stages.
      const stages = raw?.pipelines?.[0]?.stages || raw?.stages || raw?.Data?.stages || raw?.Stages || [];
      setCaseStages(Array.isArray(stages) ? stages : []);
    }
  }, [user?.organization, phoneNumber]);

  useEffect(() => {
    setContactLeads([]);
    setContactCases([]);
    // CRM chips (leads/cases/pipeline) are secondary to the conversation — load them after
    // the screen has settled so opening a chat isn't blocked behind 4 extra requests.
    const task = InteractionManager.runAfterInteractions(() => { loadCrmRecords(); });
    return () => task.cancel();
  }, [loadCrmRecords]);

  // Active lead = first still-open lead (skip won/lost), else the first one — matches web.
  const activeLead = contactLeads.find((l) => {
    const s = (l.stageId || l.StageId || '').toString().toLowerCase();
    return s !== 'won' && s !== 'lost' && s !== 'closed_won' && s !== 'closed_lost';
  }) || contactLeads[0] || null;
  const activeCase = contactCases[0] || null;

  const handleMoveLeadStage = useCallback(async (stage: any) => {
    setShowLeadStageMenu(false);
    if (!user?.organization || !activeLead) return;
    const stageId = stage.id || stage.Id;
    const stageName = stage.name || stage.Name || stage.stageName;
    const stageColor = stage.color || stage.Color || '';
    if (activeLead.stageId === stageId) return;
    const movedAtIso = new Date().toISOString();
    setContactLeads((prev) => prev.map((l) => (l.id === activeLead.id ? { ...l, stageId, stageName, modifiedOn: movedAtIso, updatedOn: movedAtIso } : l)));
    // Push the new stage into the chats store so the list badge updates immediately when the user
    // goes back — without this the lead-stage change only showed up after re-opening the app.
    addOrUpdateChat({ phoneNumber: phoneNumber as string, leadStageName: stageName, ...(stageColor ? { leadStageColor: stageColor } : {}) } as any);
    pushLocalTimeline('leadstage', isRTL ? `שלב הליד עודכן ל: ${stageName}` : `Lead stage → ${stageName}`);
    try {
      await axiosInstance.post(ENDPOINTS.MOVE_LEAD_STAGE, {
        organization: user.organization, leadId: activeLead.id, stageId, stageName,
      });
      setTimeout(refreshTimeline, 1200);
    } catch { }
  }, [user?.organization, activeLead, phoneNumber, addOrUpdateChat, pushLocalTimeline, refreshTimeline, isRTL]);

  const handleMoveCaseStage = useCallback(async (stage: any) => {
    setShowCaseStageMenu(false);
    if (!user?.organization || !activeCase) return;
    const stageId = stage.id || stage.Id;
    const stageName = stage.name || stage.Name || stage.stageName;
    const stageColor = stage.color || stage.Color || '';
    if (activeCase.stageId === stageId) return;
    setContactCases((prev) => prev.map((c) => (c.id === activeCase.id ? { ...c, stageId, stageName } : c)));
    // Reflect the case-stage change in the chats list badge immediately (same reason as leads above).
    addOrUpdateChat({ phoneNumber: phoneNumber as string, caseStageName: stageName, ...(stageColor ? { caseStageColor: stageColor } : {}) } as any);
    pushLocalTimeline('casestage', isRTL ? `שלב הפנייה עודכן ל: ${stageName}` : `Case stage → ${stageName}`);
    try {
      await axiosInstance.post(ENDPOINTS.UPDATE_CASE, {
        organization: user.organization, caseId: activeCase.id, stageId, stageName,
      });
      setTimeout(refreshTimeline, 1200);
    } catch { }
  }, [user?.organization, activeCase, phoneNumber, addOrUpdateChat, pushLocalTimeline, refreshTimeline, isRTL]);

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

  // Tag autocomplete: suggest existing org tags (from the whole DB, via the contact store facets)
  // that match what the user typed, excluding tags already on this chat. Matches web behaviour.
  const allOrgTags = useContactStore((s) => s.facets.tags);
  const ensureContactFacets = useContactStore((s) => s.ensureFacets);
  useEffect(() => {
    if (showAddTagInline && user?.organization) ensureContactFacets?.(user.organization);
  }, [showAddTagInline, ensureContactFacets, user?.organization]);
  const tagSuggestions = useMemo(() => {
    const q = newTagText.trim().toLowerCase();
    if (!q) return [];
    const current = chat?.tags || [];
    const pool = (allOrgTags || []).filter((tg) => tg && !current.includes(tg));
    const starts = pool.filter((tg) => tg.toLowerCase().startsWith(q));
    const contains = pool.filter((tg) => !tg.toLowerCase().startsWith(q) && tg.toLowerCase().includes(q));
    return [...starts, ...contains].slice(0, 8);
  }, [newTagText, allOrgTags, chat?.tags]);

  const handleAddTag = useCallback(async (tag: string) => {
    if (!user?.organization || !phoneNumber || !tag.trim()) return;
    const trimmedTag = tag.trim();
    const currentTags = chat?.tags || [];
    if (currentTags.includes(trimmedTag)) return;
    const newTags = [...currentTags, trimmedTag];
    addOrUpdateChat({ phoneNumber: phoneNumber as string, tags: newTags } as any);
    pushLocalTimeline('note', isRTL ? `תיוג נוסף: ${trimmedTag}` : `Tag added: ${trimmedTag}`);
    setNewTagText('');
    setShowAddTagInline(false);
    try {
      const { contactsApi } = require('../../../services/api');
      await contactsApi.update(user.organization, { phoneNumber: phoneNumber as string, tags: newTags }, user.uID || user.userId, user.fullname);
    } catch (e) {
      console.warn('Failed to add tag:', e);
    }
  }, [user?.organization, phoneNumber, chat?.tags, addOrUpdateChat, user?.uID, user?.userId, user?.fullname, pushLocalTimeline, isRTL]);

  // Load telephony settings for outbound calling (deferred — only needed when placing a call).
  useEffect(() => {
    if (!user?.organization) return;
    const task = InteractionManager.runAfterInteractions(() => {
      phoneCallsApi.getTelephonySettings(user.organization)
        .then((data) => { if (data?.phoneNumbers?.length) setTelSettings(data); })
        .catch(() => {});
    });
    return () => task.cancel();
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
        contactId: phoneNumber as string,
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
    setLocalTimeline([]);
    // Timeline shows in a sheet/interleaved entries — defer so it doesn't compete with the
    // initial message load on chat open.
    const task = InteractionManager.runAfterInteractions(() => {
      chatsApi.getChatTimeline(user.organization, phoneNumber as string)
        .then(setTimelineEntries)
        .catch(() => setTimelineEntries([]));
    });
    return () => task.cancel();
  }, [user?.organization, phoneNumber]);

  // Save note to timeline
  const handleSaveNote = useCallback(async () => {
    if (!noteText.trim() || !user?.organization || !phoneNumber) return;
    setSavingNote(true);
    try {
      const senderName = user.fullname || (user as any).displayName || '';
      const senderId = (user as any).userId || (user as any).uID || (user as any).uid || '';
      // A note that tags users becomes an internal message (mirrors web) so the mentioned
      // users get notified; otherwise it's a plain timeline note.
      if (noteMentions.length > 0) {
        await sendInternalMessage(
          user.organization,
          phoneNumber as string,
          noteText.trim(),
          senderName,
          senderId,
          noteMentions,
        );
      } else {
        const { contactsApi } = await import('../../../services/api/contacts');
        const saveRes = await contactsApi.addTimelineEntry(
          user.organization,
          phoneNumber as string,
          noteText.trim(),
          senderId,
          senderName
        );
        if (saveRes && (saveRes.Success === false || saveRes.success === false)) {
          throw new Error(saveRes.Message || saveRes.message || 'save failed');
        }
      }
      pushLocalTimeline('note', noteText.trim());
      setNoteText('');
      setNoteMentions([]);
      setShowNoteMentionPicker(false);
      setNoteMentionQuery('');
      setShowAddNoteModal(false);
      setTimeout(refreshTimeline, 1200);
    } catch (e) {
      Alert.alert(isRTL ? 'שגיאה' : 'Error', isRTL ? 'שמירת ההערה נכשלה' : 'Failed to save note');
    } finally {
      setSavingNote(false);
    }
  }, [noteText, noteMentions, user, phoneNumber, isRTL, pushLocalTimeline, refreshTimeline, sendInternalMessage]);

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
      addOrUpdateChat({ phoneNumber: phoneNumber as string, ownerId, ownerName } as any);
      setShowAssignOwnerModal(false);
      Alert.alert('✅', isRTL ? `בעלות שויכה ל-${ownerName}` : `Assigned to ${ownerName}`);
    } catch {
      Alert.alert(isRTL ? 'שגיאה' : 'Error', isRTL ? 'שיוך הבעלות נכשל' : 'Failed to assign owner');
    } finally {
      setAssigningOwner(false);
    }
  }, [user?.organization, phoneNumber, isRTL, addOrUpdateChat]);

  const isStatusLoading = conversationLive === null;

  // Mirror the web ChatContainer EXACTLY. Free text is allowed ONLY when:
  //   1. the customer replied in the last 24h (recipientReplied24h), AND
  //   2. the 24h window is still open (conversationExpiresAt exists AND is in the future), AND
  //   3. the conversation is live.
  // A template WE sent does NOT open free text — the window only opens on a customer reply.
  // (No message-derived heuristics here; the backend flags are the single source of truth,
  // identical to the web, which the user confirmed works correctly.)
  const canSendFreeText = useMemo(() => {
    if (isStatusLoading) return false;
    const expiresAt = conversationExpiresAt ? new Date(conversationExpiresAt).getTime() : null;
    const isWindowOpen = expiresAt != null && countdownNow < expiresAt;
    return recipientReplied24h === true && isWindowOpen && conversationLive === true;
  }, [isStatusLoading, recipientReplied24h, conversationExpiresAt, conversationLive, countdownNow]);

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

  // Resolve the default ("open conversation") template id for the current org / selected number.
  // Shared by both the quick-send handler and the "is a default configured?" detection effect so
  // the greyed-out state and the actual send path always agree on what counts as "configured".
  const resolveDefaultTemplate = useCallback(async (): Promise<{ templateId: string; savedMappings: any[] }> => {
    let templateId = '';
    if (activeWabaNumber && allWabaNumbers.length > 1) {
      const selectedNum = allWabaNumbers.find((n) => (n.PhoneNumberId || n.phoneNumberId) === activeWabaNumber);
      if (selectedNum?.DefaultTemplateId || selectedNum?.defaultTemplateId) {
        templateId = selectedNum.DefaultTemplateId || selectedNum.defaultTemplateId || '';
      }
    }
    let savedMappings: any[] = [];
    if (!templateId && user?.organization) {
      const defRes = await axiosInstance.post(ENDPOINTS.GET_DEFAULT_MESSAGE_TEMPLATES, { organization: user.organization });
      // Tolerate both wrapped ({ Data: { templates } }) and unwrapped ({ templates }) shapes.
      const root = defRes.data?.Data ?? defRes.data;
      const tplAssignment = root?.templates?.openConversation;
      templateId = Array.isArray(tplAssignment?.templateId)
        ? (tplAssignment.templateId[0] || '')
        : (tplAssignment?.templateId || '');
      savedMappings = Array.isArray(tplAssignment?.varMappings)
        ? tplAssignment.varMappings.filter((m: any) => !Array.isArray(m.index) && m.index != null)
        : [];
    }
    return { templateId, savedMappings };
  }, [activeWabaNumber, allWabaNumbers, user]);

  // Guidance shown when no default template is configured — points the user to where to set one.
  const noDefaultTemplateMessage = isRTL
    ? 'לא הוגדרה תבנית ברירת מחדל. כדי להשתמש בשליחה מהירה, היכנס להגדרות ← הודעות ברירת מחדל וצור או בחר תבנית פתיחת שיחה.'
    : 'No default template is set. To use quick-send, go to Settings → Default Messages and create or select an open-conversation template.';

  const handleSendDefaultTemplate = useCallback(async () => {
    if (!user?.organization || !phoneNumber || isSendingTemplate) return;
    if (sendingTemplateRef.current) return; // already sending — block double tap
    // No default configured → don't silently fail; explain how to set one (matches web).
    if (hasDefaultTemplate === false) {
      Alert.alert(t('chats.noDefaultTemplate', 'תבנית ברירת מחדל'), noDefaultTemplateMessage);
      return;
    }
    sendingTemplateRef.current = true;
    setIsSendingTemplate(true);
    setShowTemplateSelector(false);
    try {
      const { templateId, savedMappings } = await resolveDefaultTemplate();

      if (!templateId) {
        setHasDefaultTemplate(false);
        Alert.alert(t('chats.noDefaultTemplate', 'תבנית ברירת מחדל'), noDefaultTemplateMessage);
        return;
      }

      // Resolve template variables like the web does
      const fullName = chat?.contactName || '';
      const resolveVarValue = (source: string, hardcodedValue?: string) => {
        if (source === 'hardcoded') return hardcodedValue || '';
        if (source === 'contact.firstName') return fullName.split(' ')[0] || fullName || (phoneNumber as string) || '';
        if (source === 'contact.lastName') return fullName.split(' ').slice(1).join(' ') || '';
        if (source === 'contact.name') return fullName || (phoneNumber as string) || '';
        if (source === 'contact.email') return (chat as any)?.email || '';
        if (source === 'contact.phoneNumber') return (phoneNumber as string) || '';
        if (source === 'user.organization') return user?.organization || '';
        if (source === 'user.UserName') return user?.fullname || user?.displayName || '';
        return hardcodedValue || '';
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
          user.uID || user.userId,
          templateVariableQuery,
          sendFromNumberId,
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
      sendingTemplateRef.current = false;
      setIsSendingTemplate(false);
    }
  }, [user, phoneNumber, isSendingTemplate, hasDefaultTemplate, noDefaultTemplateMessage, resolveDefaultTemplate, chat, loadMessages, isRTL, t, sendFromNumberId]);

  // Detect whether a default template exists once the conversation is known to be closed (the
  // template banner is shown). Drives the greyed-out / disabled state of the quick-send button so
  // the user isn't offered an action that can't work. Re-checks when the selected WABA number
  // changes (per-number defaults) and resets on chat switch.
  useEffect(() => {
    if (canSendFreeText || isStatusLoading || !user?.organization || !phoneNumber) {
      setHasDefaultTemplate(null);
      return;
    }
    let cancelled = false;
    setHasDefaultTemplate(null);
    resolveDefaultTemplate()
      .then(({ templateId }) => { if (!cancelled) setHasDefaultTemplate(!!templateId); })
      .catch(() => { if (!cancelled) setHasDefaultTemplate(false); });
    return () => { cancelled = true; };
  }, [canSendFreeText, isStatusLoading, user?.organization, phoneNumber, activeWabaNumber, resolveDefaultTemplate]);

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
      if (sendingTemplateRef.current) return; // already sending — block double tap
      const templateId = template.id || template.templateId || template.Id || '';
      if (!templateId) {
        Alert.alert(t('common.error'), t('chats.templateSendError'));
        return;
      }
      sendingTemplateRef.current = true;
      setIsSendingTemplate(true);
      try {
        const result = await chatsApi.sendTemplateMessage(
          user.organization,
          phoneNumber,
          templateId,
          user.uID || user.userId,
          templateVariableQuery,
          sendFromNumberId,
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
        sendingTemplateRef.current = false;
        setIsSendingTemplate(false);
      }
    },
    [user, phoneNumber, loadMessages, t, fetchConversationStatus, sendFromNumberId],
  );

  const handleSendTemplateWithVariables = useCallback(() => {
    if (!selectedTemplateForVars) return;
    const indices = getTemplateVariableIndices(selectedTemplateForVars);
    const templateVariableQuery = indices.map((idx, i) =>
      buildTemplateVarEntry(idx, templateVariableValues[idx] ?? '', i + 1),
    );
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
      return buildTemplateVarEntry(idx, resolveQuickVar(entity, field), i + 1);
    });

    doSendTemplate(template, templateVariableQuery);
  }, [resolveQuickVar, doSendTemplate]);

  const handleOpenSchedule = useCallback(() => {
    setScheduleText('');
    setScheduleDate('');
    setScheduleTime('');
    setScheduleMessageType('text');
    setScheduleTemplate(null);
    setScheduleVarValues({});
    loadTemplates();
    setShowScheduleModal(true);
  }, [loadTemplates]);

  // Pre-fill a scheduled template's variables from its saved auto-mapping (variableMappingJson),
  // exactly like the Quick template flow — the user can still edit any value manually.
  const handleSelectScheduleTemplate = useCallback((template: Template) => {
    setScheduleTemplate(template);
    let mapping: Array<{ index: number; entity: string; field: string }> = [];
    try { mapping = JSON.parse((template as any).variableMappingJson || '[]'); } catch {}
    const initial: Record<number, string> = {};
    getTemplateVariableIndices(template).forEach((idx) => {
      const me = mapping.find((m) => m.index === idx);
      initial[idx] = me && me.entity !== 'open' ? resolveQuickVar(me.entity, me.field) : '';
    });
    setScheduleVarValues(initial);
  }, [getTemplateVariableIndices, resolveQuickVar]);

  const scheduleIsFarFuture = useMemo(() => {
    if (!scheduledDateTime) return false;
    return scheduledDateTime.getTime() - Date.now() > 23 * 60 * 60 * 1000;
  }, [scheduledDateTime]);

  const handleScheduleSubmit = useCallback(async () => {
    if (!user?.organization || !phoneNumber) return;
    const scheduledTime = scheduledDateTime ? scheduledDateTime.toISOString() : '';
    if (!scheduledTime) {
      Alert.alert(t('common.error'), t('chats.pickDateTime', 'בחר תאריך ושעה'));
      return;
    }
    // Messages scheduled more than 23h ahead MUST be a template (WhatsApp 24h-window rule,
    // enforced by the backend). Guide the user instead of letting the request fail.
    if (scheduleMessageType === 'text' && scheduleIsFarFuture) {
      Alert.alert(
        t('common.error'),
        isRTL
          ? 'הודעה שמתוזמנת מעבר ל-23 שעות חייבת להיות תבנית. בחר "תבנית".'
          : 'A message scheduled more than 23h ahead must be a template. Pick "Template".',
      );
      return;
    }

    const fromNumberId = sendFromNumberId;
    setIsScheduling(true);
    try {
      if (scheduleMessageType === 'template') {
        if (!scheduleTemplate) {
          Alert.alert(t('common.error'), isRTL ? 'בחר תבנית' : 'Select a template');
          setIsScheduling(false);
          return;
        }
        const indices = getTemplateVariableIndices(scheduleTemplate);
        const templateVariableQuery = indices.map((idx, i) =>
          buildTemplateVarEntry(idx, scheduleVarValues[idx] || '', i + 1),
        );
        const templateConfig = {
          templateId: (scheduleTemplate as any).Id || scheduleTemplate.id,
          templateVariableQuery,
          locationDetails: {},
          fromNumberId,
        };
        await chatsApi.scheduleMessage(user.organization, phoneNumber, scheduledTime, {
          messageType: 'template',
          templateConfig,
          fromNumberId,
        });
      } else {
        if (!scheduleText.trim()) {
          Alert.alert(t('common.error'), t('chats.enterMessage', 'הזן הודעה'));
          setIsScheduling(false);
          return;
        }
        await chatsApi.scheduleMessage(user.organization, phoneNumber, scheduledTime, {
          messageType: 'text',
          text: scheduleText.trim(),
          fromNumberId,
        });
      }
      setShowScheduleModal(false);
      setScheduleText('');
      setScheduledDateTime(null);
      setScheduleTemplate(null);
      setScheduleVarValues({});
      // Refresh so the pending "scheduled" bubble appears in the thread (like web).
      await loadMessages(user.organization, phoneNumber as string);
      Alert.alert(t('common.success'), t('chats.scheduleSuccess', 'ההודעה תוזמנה בהצלחה'));
    } catch (err: any) {
      const msg = err?.response?.data?.Message || err?.message || t('chats.scheduleError', 'תזמון ההודעה נכשל');
      Alert.alert(t('common.error'), msg);
    } finally {
      setIsScheduling(false);
    }
  }, [user, phoneNumber, scheduledDateTime, scheduleMessageType, scheduleIsFarFuture, scheduleTemplate, scheduleVarValues, scheduleText, getTemplateVariableIndices, t, isRTL, sendFromNumberId, loadMessages]);

  // Cancel a pending scheduled message from its bubble (matches web behavior).
  const handleCancelScheduled = useCallback(async (scheduledMessageId: string) => {
    if (!user?.organization || !scheduledMessageId) return;
    try {
      await chatsApi.cancelScheduledMessage(user.organization, scheduledMessageId);
      await loadMessages(user.organization, phoneNumber as string);
      Alert.alert(t('common.success'), t('chats.scheduledCancelled', 'ההודעה המתוזמנת בוטלה'));
    } catch (err: any) {
      const msg = err?.response?.data?.Message || err?.message || t('chats.scheduledCancelError', 'ביטול ההודעה נכשל');
      Alert.alert(t('common.error'), msg);
    }
  }, [user, phoneNumber, loadMessages, t]);

  const confirmCancelScheduled = useCallback((scheduledMessageId: string) => {
    Alert.alert(
      t('chats.cancelScheduledTitle', 'ביטול הודעה מתוזמנת'),
      t('chats.cancelScheduledConfirm', 'האם לבטל את ההודעה המתוזמנת?'),
      [
        { text: t('common.no', 'לא'), style: 'cancel' },
        { text: t('common.yes', 'כן'), style: 'destructive', onPress: () => handleCancelScheduled(scheduledMessageId) },
      ],
    );
  }, [handleCancelScheduled, t]);

  // Tab bar is hidden by the layout via useSegments detection

  // Handle hardware back button
  useEffect(() => {
    const onBackPress = () => {
      if (showTimelineSheet) { setShowTimelineSheet(false); return true; }
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
  }, [showTimelineSheet, showAttachSheet, menuVisible, searchVisible, showContactInfoSheet, mediaPanelVisible, showQuickActionsSheet, showInlineQuickMessages, showMentionPicker, starredFilter, replyToMessage, router]);

  // Load messages & mark as read
  useEffect(() => {
    if (!user?.organization || !phoneNumber) return;
    setTimelineEntries([]);
    lastMessagesFetchAtRef.current = Date.now();
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
        // Throttle: skip the reload if we already fetched this chat within the last 15s.
        // Live updates arrive over WebSocket (reconnected just above), so a fresh getMessages
        // right after open is redundant and only adds visual churn.
        const sinceLastFetch = Date.now() - lastMessagesFetchAtRef.current;
        if (sinceLastFetch > 15000) {
          lastMessagesFetchAtRef.current = Date.now();
          loadMessages(user.organization, phoneNumber);
        }
        fetchConversationStatus();
      }
    });
    return () => subscription.remove();
  }, [user?.organization, phoneNumber, loadMessages, fetchConversationStatus]);

  // Refresh conversation status when the screen gains focus (returning from a sub-screen,
  // push notification, etc.). Messages are NOT reloaded here — the mount effect above already
  // loads them (instantly from cache when available), and live updates arrive over WebSocket.
  // Reloading here too caused a duplicate getMessages on every chat open.
  const didInitialFocus = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!didInitialFocus.current) {
        // Skip the first focus — it coincides with mount, which already fetched status.
        didInitialFocus.current = true;
        return;
      }
      if (user?.organization && phoneNumber) {
        fetchConversationStatus();
      }
    }, [user?.organization, phoneNumber, fetchConversationStatus])
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
        let latestInboundTime = 0;
        msgs.forEach((msg) => {
          const normalizedId = msg.messageId || msg.id || msg.Id || '';
          if (!normalizedId) return;
          msg.messageId = normalizedId;

          // Reactions: update original message instead of adding as separate bubble
          if (msg.type === 'reaction') {
            const targetId = msg.contextMessageId || msg.ContextMessageId || msg.reactedMessageId || msg.reactionMessageId;
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
          // Only count as "new inbound" if it arrived within the last 24h. The WebSocket
          // can replay historical messages when a chat first opens; without this guard an
          // old inbound message would incorrectly mark a closed conversation as live
          // (this is what made the first opened chat always look "open"). Mirrors web.
          const msgTimeRaw = msg.createdOn || msg.timestamp;
          const msgTime = msgTimeRaw ? new Date(msgTimeRaw).getTime() : 0;
          const isRecentInbound = msgTime > Date.now() - 24 * 60 * 60 * 1000;
          // Match web's strict inbound test: the message must be FROM this customer
          // (normalized phone compare, not a raw string ==) AND flagged inbound. The old
          // loose `msg.from === phoneNumber` could miss differently-formatted numbers, and
          // a bare `dir === 'inbound'` could mark the wrong conversation live.
          const fromNorm = String(msg.from || '').replace(/\D/g, '');
          const phoneNorm = String(phoneNumber || '').replace(/\D/g, '');
          const fromMatches = !!fromNorm && !!phoneNorm &&
            (fromNorm === phoneNorm || fromNorm.endsWith(phoneNorm.slice(-9)) || phoneNorm.endsWith(fromNorm.slice(-9)));
          if (dir === 'inbound' && fromMatches && isRecentInbound) {
            hasInbound = true;
            if (msgTime > latestInboundTime) latestInboundTime = msgTime;
          }
        });
        if (msgs.length > 0) {
          markAsRead(user.organization, phoneNumber, user.uID || user.userId, user.fullname || user.displayName || '');
        }
        if (hasInbound) {
          // Only update conversation status if the inbound message belongs to THIS
          // contact's number. Prefer contactWabaId (the conversation's own number) over
          // the global activeWabaNumber, which may still hold the previous chat's value.
          const msgFromNumberId = msgs[0]?.fromNumberId || msgs[0]?.wabaPhoneNumberId || msgs[0]?.phoneNumberId || '';
          const expectedWaba = contactWabaId || activeWabaNumber;
          if (!expectedWaba || !msgFromNumberId || msgFromNumberId === expectedWaba) {
            // Invalidate any in-flight status request so a slower API response can't
            // override this confirmed-live state with stale data (mirrors web).
            statusRequestIdRef.current++;
            setConversationLive(true);
            setRecipientReplied24h(true);
            // The 24h window ends 24h after the customer's ACTUAL inbound time — not 24h from
            // when we received the WS event. Using Date.now() here reset the countdown to ~24:00
            // every time the chat opened / replayed history. Never shrink an existing later expiry.
            const inboundBase = latestInboundTime > 0 ? latestInboundTime : Date.now();
            const newExpiryMs = inboundBase + 24 * 60 * 60 * 1000;
            setConversationExpiresAt((prev) => {
              const prevMs = prev ? new Date(prev).getTime() : 0;
              return new Date(Math.max(prevMs, newExpiryMs)).toISOString();
            });
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
  }, [user?.organization, phoneNumber, addMessage, updateMessage, markAsRead, activeWabaNumber, contactWabaId]);

  // Tracks whether the viewport is currently pinned near the newest message. Used only to
  // decide when to reveal the scroll-to-bottom FAB. Auto-scrolling on new messages is handled
  // entirely by FlashList v2's maintainVisibleContentPosition (autoscrollToBottomThreshold) —
  // a manual scrollToEnd here fought MVCP and produced the "jumps to old messages and back"
  // flicker, so it has been removed.
  const isNearBottomRef = useRef(true);

  // Pre-cache media from ALL messages in the background (without blocking message rendering)
  const allMessages = useChatStore((s) => s.allMessages);
  const prefetchedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (allMessages.length === 0) return;
    // Only prefetch media for the most-recent slice (what the user actually sees first), and defer
    // it until after interactions so opening a heavy chat doesn't scan the whole history on the JS
    // thread and block the first paint / button taps. Older media still caches lazily when rendered.
    const PREFETCH_WINDOW = 60;
    const recent = allMessages.length > PREFETCH_WINDOW ? allMessages.slice(-PREFETCH_WINDOW) : allMessages;
    const task = InteractionManager.runAfterInteractions(() => {
    const mediaItems: Array<{ url: string; type: MediaType }> = [];
    for (const msg of recent) {
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
      // Only prefetch what useCachedMedia actually serves from the file cache: audio & docs.
      // Images use expo-image's own disk cache, and videos load on demand (poster in the row),
      // so prefetching them here only double-downloads and starves visible images on the network.
      if (mediaType !== 'audio' && mediaType !== 'document') continue;
      mediaItems.push({ url, type: mediaType });
    }
    if (mediaItems.length > 0) {
      prefetchMediaList(mediaItems);
    }
    });
    return () => task.cancel();
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

  // Keep the latest gallery list in a ref so handleMediaPress can stay referentially STABLE.
  // If this callback changed identity whenever messages change, every memoized MessageBubble
  // would re-render (and reload its media) on each new message / status tick — the root of the
  // "flicker / list won't stop scrolling / messages disappear" loop on heavy chats.
  const mediaMessagesRef = useRef(mediaMessages);
  mediaMessagesRef.current = mediaMessages;
  const handleMediaPress = useCallback((message: Message) => {
    const idx = mediaMessagesRef.current.findIndex((m) => m.messageId === message.messageId);
    if (idx >= 0) {
      setGalleryIndex(idx);
      setGalleryVisible(true);
    }
  }, []);

  // Server timeline + optimistic local entries. A local entry is dropped once the server timeline
  // carries an equivalent one (same kind within a 2-minute window; notes/tags also match on text) so
  // a change made from the chat shows instantly and doesn't duplicate after the server refresh.
  const mergedTimeline = useMemo(() => {
    if (localTimeline.length === 0) return timelineEntries;
    const ts = (e: any) => parseTimestamp(e?.createdOn || e?.timestamp || e?.CreatedOn);
    const serverKind = (e: any) => {
      const tp = (e?.timelineType || e?.TimelineType || e?.type || '').toLowerCase();
      if (tp.includes('status')) return 'status';
      if (tp.includes('categor')) return 'category';
      if (tp.includes('stage') && tp.includes('case')) return 'casestage';
      if (tp.includes('stage')) return 'leadstage';
      return 'note';
    };
    const noteText = (e: any) => (e?.note || e?.text || e?.description || e?.Note || e?.content || '').trim();
    const extras = localTimeline.filter((local) => {
      const lk = local._kind;
      const lts = ts(local);
      return !timelineEntries.some((srv) => {
        if (serverKind(srv) !== lk) return false;
        if (Math.abs(ts(srv) - lts) > 120000) return false;
        if (lk === 'note') return noteText(srv) === noteText(local);
        return true;
      });
    });
    return extras.length ? [...timelineEntries, ...extras] : timelineEntries;
  }, [timelineEntries, localTimeline]);

  // Build list data with date separators + timeline entries, oldest→newest (data[0] = top). The
  // view is pinned to the newest message by maintainVisibleContentPosition.startRenderingFromBottom.
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

    // Guaranteed anti-duplicate: collapse an optimistic `temp_` bubble whenever its
    // server-confirmed twin (same direction + identical text) is already present. This is the
    // last line of defense so a just-sent message can never render twice (optimistic + WS echo)
    // while the chat is open, regardless of any reconciliation race in the store.
    // A temp_ row is ALWAYS our own optimistic outbound message, so collapse it whenever a
    // server-confirmed (non-temp) message with the same text exists. We deliberately key by text
    // only (not direction+text): the WS echo's `direction` casing/presence frequently differs from
    // the optimistic temp's 'Outbound', and a direction-sensitive key let both bubbles survive
    // until reload. Confirmed inbound messages are excluded so an inbound message that happens to
    // share text can never swallow our outbound temp.
    const confirmedOutboundTexts = new Set<string>();
    for (const m of msgs) {
      const id = String((m as any).messageId || '');
      if (id && !id.startsWith('temp_') && (m.direction || '').toLowerCase() !== 'inbound') {
        const txt = (m.text || (m as any).body || '').trim();
        if (txt) confirmedOutboundTexts.add(txt);
      }
    }
    if (confirmedOutboundTexts.size > 0) {
      msgs = msgs.filter((m) => {
        const id = String((m as any).messageId || '');
        if (!id.startsWith('temp_')) return true;
        const txt = (m.text || (m as any).body || '').trim();
        if (!txt) return true; // media/voice temps are reconciled in the store
        return !confirmedOutboundTexts.has(txt);
      });
    }

    // Build a combined list sorted oldest first (non-inverted: data[0] = oldest = top of screen)
    type Combined =
      | { ts: number; idx: number; kind: 'message'; msg: Message }
      | { ts: number; idx: number; kind: 'timeline'; entry: any };

    // The timeline endpoint returns the ENTIRE history. Rendering all of it ignores message
    // pagination and floods a long chat with hundreds of extra rows on open (the "timeline shows
    // first, messages trickle in" effect). Bound timeline entries to the currently-displayed
    // message window: only entries at/after the oldest visible message are shown. As the user
    // scrolls up and older messages page in, the matching older timeline entries appear too.
    const oldestMsgTs = msgs.length > 0
      ? msgs.reduce(
          (min, m) => Math.min(min, parseTimestamp((m as any).createdOn || (m as any).timestamp)),
          Infinity,
        )
      : 0;
    const visibleTimeline = msgs.length === 0
      ? mergedTimeline
      : mergedTimeline.filter((entry: any) =>
          parseTimestamp(entry.createdOn || entry.timestamp || entry.CreatedOn) >= oldestMsgTs,
        );

    const combined: Combined[] = [
      ...msgs.map((msg, idx) => ({
        ts: parseTimestamp((msg as any).createdOn || (msg as any).timestamp),
        idx,
        kind: 'message' as const,
        msg,
      })),
      ...visibleTimeline.map((entry: any, idx: number) => {
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

    // Return NEWEST-FIRST for the INVERTED FlatList (data[0] = newest = visual bottom). This is the
    // exact RN equivalent of the web's column-reverse chat container, and the single most stable
    // chat-list pattern: the list auto-pins to the bottom, new messages prepend at index 0 without
    // shifting the viewport, and older messages append at the end (loaded via onEndReached) without
    // any maintainVisibleContentPosition math to corrupt. Reversing the already-built items array
    // (separators + messages) keeps every date separator correctly placed above its day's group once
    // rendered bottom-up by the inverted list.
    items.reverse();
    return items;
  }, [currentMessages, mergedTimeline, lang, messageMode, starredFilter, searchQuery, user, phoneNumber]);

  // Stable via ref (see handleMediaPress note) — a listData-dependent callback here would change
  // on every message change and re-render the whole list through renderItem.
  const listDataRef = useRef(listData);
  listDataRef.current = listData;
  const handleQuotedPress = useCallback((contextMessageId: string) => {
    const idx = listDataRef.current.findIndex(
      (item) => item.kind === 'message' && (item.data.messageId === contextMessageId || item.data.id === contextMessageId),
    );
    if (idx >= 0) {
      flatListRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.5 });
    }
  }, []);

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

  const handleSelectQuickMessage = useCallback((msg: QuickMessage) => {
    setShowQuickMessages(false);
    const text = (msg as any).messageText || (msg as any).text || (msg as any).message || (msg as any).body || '';
    if (text) {
      chatInputRef.current?.insertText(text);
    }
  }, []);

  // Send handler
  // When a brand-new conversation is started by typing a raw phone number (chats → new chat),
  // no contact record exists yet. On the first outbound WhatsApp message, create a contact named
  // by the phone number so the conversation is properly saved/searchable — mirroring the intent
  // of the "start chat by number" flow. Best-effort and idempotent (checked once per screen).
  const ensuredContactRef = useRef(false);
  const ensureContactExists = useCallback(async () => {
    if (ensuredContactRef.current) return;
    if (!user?.organization || !phoneNumber) return;
    ensuredContactRef.current = true;
    try {
      const existing = await contactsApi.getById(user.organization, phoneNumber as string);
      const hasContact = !!(existing && (existing.id || existing.phoneNumber));
      const existingName = (existing?.name || (existing as any)?.fullName || (existing as any)?.contactName || '').trim();
      if (!hasContact) {
        const myId = user.uID || user.userId || '';
        const myName = user.fullname || user.name || '';
        await contactsApi.create(
          user.organization,
          { phoneNumber: phoneNumber as string, name: phoneNumber as string, ownerId: myId, ownerName: myName } as any,
          myId,
          myName,
        );
        // Reflect ownership immediately in the conversation header + chat list (creator = owner).
        addOrUpdateChat({ phoneNumber: phoneNumber as string, ownerId: myId, ownerName: myName } as any);
      } else if (!existingName) {
        // A record exists but has no name (e.g. auto-created) — label it with the phone number.
        await contactsApi.update(
          user.organization,
          { id: existing!.id || (phoneNumber as string), phoneNumber: phoneNumber as string, name: phoneNumber as string },
          user.uID || user.userId,
          user.fullname,
        );
      }
    } catch {
      // Allow a retry on the next send if this failed.
      ensuredContactRef.current = false;
    }
  }, [user, phoneNumber, addOrUpdateChat]);

  const handleSend = useCallback(
    async (text: string) => {
      if (!user?.organization || !phoneNumber) return;
      // Sending is an explicit user action — always snap to the newest message so they see it.
      isNearBottomRef.current = true;
      scrollToNewest(false);
      try {
        // Internal note vs WhatsApp message is decided by whether the agent actually @-mentioned
        // teammates (mirrors web). Keying off the sticky `isInternalNote` flag was a bug: it was
        // set true on the first `@` and never reset, so every later regular message silently
        // became an internal note and never reached the customer.
        if (mentionedUsers.length > 0) {
          await sendInternalMessage(
            user.organization,
            phoneNumber,
            text,
            user.fullname,
            user.uID || user.userId || '',
            mentionedUsers,
          );
          setMentionedUsers([]);
          setIsInternalNote(false);
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
            sendFromNumberId,
          );
          // Ensure a contact exists for this number after the first real message (fire-and-forget).
          ensureContactExists();
        }
        setReplyToMessage(null);
      } catch {
        Alert.alert(t('common.error'), t('chats.sendFailed', 'שליחת ההודעה נכשלה'));
      }
    },
    [user, phoneNumber, isInternalNote, sendMessage, sendInternalMessage, replyToMessage, mentionedUsers, t, activeWabaNumber, sendFromNumberId, scrollToNewest, ensureContactExists],
  );

  const sendPickedMedia = useCallback(async (uri: string, fileName: string, mimeType: string, fileSize?: number) => {
    if (!user?.organization || !phoneNumber) return;
    isNearBottomRef.current = true;
    scrollToNewest(false);
    const mt = (mimeType || '').toLowerCase();
    const mediaType = mt.startsWith('video') ? 'video' : mt.startsWith('audio') ? 'audio' : mt.startsWith('image') ? 'image' : 'document';
    // Show the bubble immediately (optimistic); the WS echo replaces this temp.
    const tempId = addOptimisticMedia({ localUri: uri, mediaType, fileName });
    try {
      await chatsApi.sendMediaMessage(
        user.organization,
        phoneNumber as string,
        { uri, name: fileName, type: mimeType, size: fileSize },
        '',
        user?.uID || user?.userId || '',
        // Mirror the template logic: only pass a PhoneNumberId for multi-number orgs. Passing a
        // display number here for single-number orgs makes the backend fail to resolve settings.
        sendFromNumberId,
      );
    } catch {
      updateMessageStatus(tempId, 'failed');
      Alert.alert(t('common.error'), t('chats.sendFailed', 'Failed to send media'));
    }
  }, [user?.organization, phoneNumber, user?.uID, user?.userId, t, sendFromNumberId, addOptimisticMedia, updateMessageStatus, scrollToNewest]);

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
    isNearBottomRef.current = true;
    scrollToNewest(false);
    const fileName = `voice_${Date.now()}.mp4`;
    const mimeType = 'audio/mp4';
    let fileSize = 0;
    try {
      const FileSystem = require('expo-file-system');
      const fileInfo = await FileSystem.getInfoAsync(uri, { size: true });
      if (fileInfo.exists && fileInfo.size) fileSize = fileInfo.size;
    } catch {}
    const tempId = addOptimisticMedia({ localUri: uri, mediaType: 'audio', fileName });
    try {
      await chatsApi.sendMediaMessage(
        user.organization,
        phoneNumber as string,
        { uri, name: fileName, type: mimeType, size: fileSize },
        '',
        user?.uID || user?.userId || '',
        sendFromNumberId,
      );
    } catch {
      updateMessageStatus(tempId, 'failed');
      Alert.alert(t('common.error'), t('chats.sendFailed', 'שליחת ההקלטה נכשלה'));
    }
  }, [user?.organization, user?.uID, user?.userId, phoneNumber, t, sendFromNumberId, addOptimisticMedia, updateMessageStatus, scrollToNewest]);

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

  // Links contained in the selected message's text (http/https or www.).
  const selectedMessageUrls = useMemo(() => {
    const msgText = (selectedMessage?.text || selectedMessage?.body || '') as string;
    if (!msgText) return [] as string[];
    const matches = msgText.match(/(https?:\/\/[^\s<>]+|www\.[^\s<>]+)/gi) || [];
    return matches.map((u) => u.replace(/[.,;:!?)\]}>"']+$/, '').trim()).filter(Boolean);
  }, [selectedMessage]);

  const handleCopyLink = useCallback(async () => {
    if (selectedMessageUrls.length === 0) return;
    await Clipboard.setStringAsync(selectedMessageUrls.join('\n'));
    setSelectedMessage(null);
  }, [selectedMessageUrls]);

  const handleReply = useCallback(() => {
    if (!selectedMessage) return;
    setReplyToMessage(selectedMessage);
    setSelectedMessage(null);
  }, [selectedMessage]);

  const handleSwipeToReply = useCallback((message: Message) => {
    setReplyToMessage(message);
  }, []);

  const handleForward = useCallback(() => {
    if (!selectedMessage) return;
    setForwardMessage(selectedMessage);
    setSelectedMessage(null);
    setShowReactions(false);
    setShowForwardSheet(true);
  }, [selectedMessage]);

  const handleSendReaction = useCallback(async (emoji: string) => {
    if (!user?.organization || !selectedMessage || !phoneNumber) return;
    const targetId = selectedMessage.messageId;
    setSelectedMessage(null);
    setShowReactions(false);
    try {
      await chatsApi.sendReaction(
        user.organization,
        targetId,
        phoneNumber,
        emoji,
      );
      // Reflect our own reaction on the bubble immediately. Unlike inbound reactions there is no
      // WebSocket echo for a reaction WE send, and (unlike web) there is no full re-fetch here — so
      // update the local message directly. An empty emoji clears the reaction.
      if (targetId) {
        updateMessage(targetId, { reactions: emoji ? { me: emoji } : {} } as Partial<Message>);
      }
    } catch {
      Alert.alert(t('common.error'), t('chats.reactionFailed', 'שליחת הריאקציה נכשלה'));
    }
  }, [user?.organization, selectedMessage, phoneNumber, t, updateMessage]);

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
      // A '.' means the token is an email/domain ("gmail.com"), never a mention.
      if (!afterAt.includes(' ') && !afterAt.includes('\n') && !afterAt.includes('.')) {
        if (!isInternalNote) setIsInternalNote(true);
        const query = afterAt.toLowerCase();
        setMentionQuery(query);
        setShowMentionPicker(true);
        if (orgUsers.length === 0 && !orgUsersLoading && user?.organization) {
          loadOrgUsers();
        }
        return;
      }
    }
    setShowMentionPicker(false);
    // Drop internal-note mode once the agent is no longer composing an @mention and none are
    // attached, so the next plain message routes to the customer (and the picker stays hidden).
    if (isInternalNote && mentionedUsers.length === 0) setIsInternalNote(false);
  }, [isInternalNote, mentionedUsers.length, showInlineQuickMessages, showMentionPicker, orgUsers.length, orgUsersLoading, loadOrgUsers, quickMessages.length, isLoadingQuickMessages, user?.organization]);

  const getMentionUserName = (u: any) =>
    u.UserName || u.FullName || u.userName || u.fullname || u.name || u.Email || u.email || '';

  const filteredMentionUsers = useMemo(() => {
    if (!mentionQuery) return orgUsers.slice(0, 8);
    return orgUsers
      .filter((u: any) =>
        getMentionUserName(u).toLowerCase().includes(mentionQuery) ||
        (u.Email || u.email || '').toLowerCase().includes(mentionQuery),
      )
      .slice(0, 8);
  }, [orgUsers, mentionQuery]);

  const handleSelectMention = useCallback((mentionUser: any) => {
    const name = getMentionUserName(mentionUser);
    const uid = mentionUser.userId || mentionUser.uID || mentionUser.uid || mentionUser.id || '';
    // Add to mentioned users (deduped)
    setMentionedUsers((prev) =>
      prev.some((u) => u.userId === uid)
        ? prev
        : [...prev, { userId: uid, userName: name }],
    );
    // Replace only the trailing "@query" with "@name " so text typed before the mention is kept
    // (insertText replaced the whole composer, silently wiping the message being written).
    chatInputRef.current?.insertMention(name);
    setShowMentionPicker(false);
    setMentionQuery('');
  }, []);

  // --- Timeline note @-mention (Add-Note modal + timeline sheet) ---
  const handleNoteTextChange = useCallback((text: string) => {
    setNoteText(text);
    const atIdx = text.lastIndexOf('@');
    if (atIdx >= 0 && (atIdx === 0 || /\s/.test(text[atIdx - 1]))) {
      const afterAt = text.slice(atIdx + 1);
      // A '.' means the token is an email/domain ("gmail.com"), never a mention.
      if (!afterAt.includes(' ') && !afterAt.includes('\n') && !afterAt.includes('.')) {
        setNoteMentionQuery(afterAt.toLowerCase());
        setShowNoteMentionPicker(true);
        if (orgUsers.length === 0 && !orgUsersLoading && user?.organization) loadOrgUsers();
        return;
      }
    }
    setShowNoteMentionPicker(false);
  }, [orgUsers.length, orgUsersLoading, loadOrgUsers, user?.organization]);

  const filteredNoteMentionUsers = useMemo(() => {
    if (!noteMentionQuery) return orgUsers.slice(0, 8);
    return orgUsers
      .filter((u: any) =>
        getMentionUserName(u).toLowerCase().includes(noteMentionQuery) ||
        (u.Email || u.email || '').toLowerCase().includes(noteMentionQuery),
      )
      .slice(0, 8);
  }, [orgUsers, noteMentionQuery]);

  const handleSelectNoteMention = useCallback((mentionUser: any) => {
    const name = getMentionUserName(mentionUser);
    const uid = mentionUser.userId || mentionUser.uID || mentionUser.uid || mentionUser.id || '';
    setNoteMentions((prev) =>
      prev.some((u) => u.userId === uid) ? prev : [...prev, { userId: uid, userName: name }],
    );
    // Replace the trailing "@query" with "@name ".
    setNoteText((prev) => {
      const atIdx = prev.lastIndexOf('@');
      return (atIdx >= 0 ? prev.slice(0, atIdx) : prev) + `@${name} `;
    });
    setShowNoteMentionPicker(false);
    setNoteMentionQuery('');
  }, []);

  const loadingOlderRef = useRef(false);
  // Blocks pagination right after a chat opens. On a short chat that fits entirely on screen the
  // far (oldest) edge is within onEndReached's threshold immediately, so without this guard the list
  // would fetch the FULL server history and append hundreds of rows on open. Older history should
  // only load when the user has deliberately scrolled UP toward the oldest message.
  const initialPaginationGuardRef = useRef(true);

  // onScroll only tracks UI affordances: near-bottom (for the FAB + the pagination guard below).
  // The list is INVERTED, so the visual bottom (newest) is scroll offset 0.
  const handleScroll = useCallback((e: any) => {
    const { contentOffset } = e.nativeEvent;
    const distanceFromBottom = contentOffset.y; // inverted: 0 == pinned to newest
    isNearBottomRef.current = distanceFromBottom < 120;
    // Update the FAB via its imperative handle so toggling it does NOT re-render the screen.
    scrollBtnRef.current?.setVisible(distanceFromBottom > 400);
  }, []);

  // Load older messages when the user scrolls toward the oldest message. On an INVERTED list the
  // oldest message is at the END of the data, so "reached the top" maps to onEndReached — which is
  // well-behaved (no transient open-time fires like FlashList's onStartReached).
  const handleEndReached = useCallback(() => {
    if (initialPaginationGuardRef.current) return;
    // Never auto-load history while still pinned to the newest message (covers short chats where the
    // oldest edge is permanently within the onEndReached threshold).
    if (isNearBottomRef.current) return;
    if (!hasMoreMessages || isLoadingOlderMessages || loadingOlderRef.current) return;
    loadingOlderRef.current = true;
    loadOlderMessages();
    // Short debounce only: revealing locally-cached pages is instant, so a tight cooldown lets the
    // next page stream in as the user keeps scrolling up (no need to lift the finger and tap). A
    // real server fetch is separately guarded by isLoadingOlderMessages, so this can't double-fetch.
    setTimeout(() => { loadingOlderRef.current = false; }, 250);
  }, [hasMoreMessages, isLoadingOlderMessages, loadOlderMessages]);

  // Explicit tap on the "Load older messages" header button. Unlike the auto onStartReached path,
  // this is a deliberate user action, so it bypasses both the open-time guard and the
  // pinned-to-bottom guard (on a short chat the header can be visible while still at the bottom).
  const handleLoadOlderPress = useCallback(() => {
    if (!hasMoreMessages || isLoadingOlderMessages || loadingOlderRef.current) return;
    loadingOlderRef.current = true;
    loadOlderMessages();
    setTimeout(() => { loadingOlderRef.current = false; }, 800);
  }, [hasMoreMessages, isLoadingOlderMessages, loadOlderMessages]);

  // Release the pagination guard only once the freshly-opened chat has finished its initial load,
  // the list has actually laid out (listReady), and it has had a moment to settle at the bottom.
  // Re-armed on every chat switch (phoneNumber) and on every load — including instant cache renders
  // where isLoadingMessages never flips to true. Gating on listReady (not a fixed delay that can be
  // too short on a heavy chat) keeps history pagination from firing during the open-time settle.
  useEffect(() => {
    initialPaginationGuardRef.current = true;
    if (isLoadingMessages || !listReady) return;
    const id = setTimeout(() => {
      initialPaginationGuardRef.current = false;
    }, 900);
    return () => clearTimeout(id);
  }, [isLoadingMessages, phoneNumber, listReady]);

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
          task_created: 'clipboard-plus-outline',
          task_status_change: 'clipboard-check-outline',
          task_assigned: 'clipboard-account-outline',
          task_priority_change: 'clipboard-alert-outline',
          task_due_date_change: 'clipboard-text-clock-outline',
          task_completed: 'clipboard-check',
          assign: 'account-switch-outline',
          'open conversation': 'lock-open-variant-outline',
          close: 'lock-outline',
          'status change': 'swap-horizontal',
          'category change': 'shape-outline',
          'campaign message sent': 'bullhorn-outline',
          'botomation send message': 'robot-outline',
          'start conversation manually': 'message-plus-outline',
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
        const entryText = (entry.note || entry.text || entry.description || entry.Note || entry.content || '') || buildTimelineText(entry, lang === 'he');
        const entryBy = entry.createdByName || entry.CreatedByName || entry.addedByName || '';
        const entryTs = entry.createdOn || entry.timestamp || entry.CreatedOn || '';
        const taskId = entry.taskId || entry.TaskId || (entryType.startsWith('task') ? (entry.entityId || entry.relatedId) : '');
        const isTaskEntry = entryType.startsWith('task') && !!taskId;
        const noteExpanded = expandedNotes.has(item.id);
        // Heuristic for "is this long enough to need a 'view more'": ~3 lines worth of text or
        // several explicit line breaks. Avoids fragile onTextLayout measurement inside FlashList.
        const isLongNote = !!entryText && (entryText.length > 140 || (entryText.match(/\n/g)?.length || 0) >= 3);
        return (
          <View style={[styles.timelineItem, { backgroundColor: theme.dark ? 'rgba(255,255,255,0.05)' : '#f0f4f8', borderColor: theme.colors.outline }]}>
            <View style={[styles.timelineIconWrap, { backgroundColor: `${iconColor}15` }]}>
              <MaterialCommunityIcons name={icon as any} size={16} color={iconColor} />
            </View>
            <View style={{ flex: 1 }}>
              {entryText ? (
                <Text style={{ fontSize: 13, color: theme.colors.onSurface }} numberOfLines={noteExpanded ? undefined : 3}>{entryText}</Text>
              ) : null}
              {isLongNote ? (
                <TouchableOpacity onPress={() => toggleNoteExpanded(item.id)} hitSlop={8} style={{ marginTop: 3, alignSelf: lang === 'he' ? 'flex-end' : 'flex-start' }}>
                  <Text style={{ fontSize: 12, fontWeight: '600', color: '#2e6155' }}>
                    {noteExpanded ? (lang === 'he' ? 'צפה פחות' : 'View less') : (lang === 'he' ? 'צפה עוד' : 'View more')}
                  </Text>
                </TouchableOpacity>
              ) : null}
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2, gap: 6 }}>
                {entryBy ? (
                  <Text style={{ fontSize: 11, color: theme.colors.onSurfaceVariant }}>{entryBy}</Text>
                ) : null}
                {entryTs ? (
                  <Text style={{ fontSize: 11, color: theme.colors.onSurfaceVariant }}>{formatMessageTime(entryTs)}</Text>
                ) : null}
              </View>
              {isTaskEntry ? (
                <TouchableOpacity
                  onPress={() => router.push({ pathname: '/(tabs)/tasks/[id]', params: { id: String(taskId) } } as any)}
                  style={{ marginTop: 6, alignSelf: lang === 'he' ? 'flex-end' : 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#2e6155', paddingVertical: 5, paddingHorizontal: 10, borderRadius: 14 }}
                >
                  <MaterialCommunityIcons name="clipboard-text-outline" size={13} color="#fff" />
                  <Text style={{ color: '#fff', fontSize: 12, fontWeight: '600' }}>{lang === 'he' ? 'צפה במשימה' : 'View task'}</Text>
                </TouchableOpacity>
              ) : null}
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
          onCancelScheduled={confirmCancelScheduled}
        />
      );
    },
    [theme, handleMessageLongPress, handleMediaPress, handleQuotedPress, handleSwipeToReply, wabaNumbers, user?.organization, lang, router, confirmCancelScheduled, expandedNotes, toggleNoteExpanded],
  );

  const keyExtractor = useCallback((item: ListItem) => {
    if (item.kind === 'separator') return item.id;
    if (item.kind === 'timeline') return item.id;
    // A missing/duplicate messageId yields colliding React keys, which is a classic cause of
    // FlashList "flicker / jump to old messages" on long chats. Fall back to a stable composite.
    const id = String((item.data as any).messageId || '');
    if (id) return id;
    return `msg-${getTs(item.data)}-${(item.data.text || (item.data as any).body || '').slice(0, 24)}`;
  }, []);

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Full-screen view with no native header (headerShown:false) → keyboardVerticalOffset
          must be 0. With behavior="padding" RN pads by keyboardHeight + offset, so any
          non-zero offset here leaves a dead gap between the input and the keyboard. */}
      <KeyboardAvoidingView
        style={[
          styles.screen,
          { backgroundColor: theme.custom.chatBackground },
        ]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
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
                  pathname: '/(tabs)/chats/contact/[id]',
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
              {conversationExpiresAt && conversationLive && (
                <ConversationCountdownBadge expiresAt={conversationExpiresAt} />
              )}

              {/* Tag / Note / Assign are all in the meta bar below — header is clean */}

              <IconButton
                icon="image-multiple-outline"
                size={20}
                iconColor={theme.custom.headerText}
                onPress={() => setMediaGridVisible(true)}
                accessibilityLabel={isRTL ? 'מדיה משותפת' : 'Shared media'}
              />

              <IconButton
                icon="timeline-text-outline"
                size={20}
                iconColor={theme.custom.headerText}
                onPress={() => setShowTimelineSheet(true)}
                accessibilityLabel={isRTL ? 'ציר זמן' : 'Timeline'}
              />

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
                  leadingIcon={isInitiatingCall ? 'phone-in-talk' : 'phone'}
                  disabled={isInitiatingCall}
                  onPress={() => { setMenuVisible(false); handleInitiateCall(); }}
                  title={isRTL ? 'התקשר' : 'Call'}
                />
                <Menu.Item
                  leadingIcon="information-outline"
                  onPress={() => {
                    setMenuVisible(false);
                    setContactInfoInitialTab('details');
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
          {/* Owner chip — shows the conversation owner (or "unassigned"); tap to assign */}
          <Pressable
            onPress={() => setShowAssignOwnerModal(true)}
            style={[styles.metaChip, { backgroundColor: chat?.ownerName ? 'rgba(46,97,85,0.12)' : '#fef3c7' }]}
          >
            <MaterialCommunityIcons name="account" size={12} color={chat?.ownerName ? '#2e6155' : '#b45309'} />
            <Text style={{ fontSize: 11, fontWeight: '600', color: chat?.ownerName ? '#2e6155' : '#b45309', marginStart: 4 }} numberOfLines={1}>
              {chat?.ownerName || (isRTL ? 'לא משויך' : 'Unassigned')}
            </Text>
            <MaterialCommunityIcons name="chevron-down" size={14} color={chat?.ownerName ? '#2e6155' : '#b45309'} style={{ marginStart: 2 }} />
          </Pressable>

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
          <>
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
              placeholder={isRTL ? 'הקלד שם תיוג...' : 'Type a tag name...'}
              placeholderTextColor="#4b9e6b"
              style={{
                flex: 1,
                fontSize: 14,
                // The row background is a fixed light green, so the text must always be dark —
                // theme.colors.onSurface turns near-white in dark mode and became invisible here.
                color: '#111827',
                fontWeight: '600',
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
          {tagSuggestions.length > 0 && (
            <ScrollView
              horizontal
              keyboardShouldPersistTaps="always"
              showsHorizontalScrollIndicator={false}
              style={{ backgroundColor: '#f0fdf4', borderBottomWidth: 1, borderBottomColor: '#86efac' }}
              contentContainerStyle={{ flexDirection: isRTL ? 'row-reverse' : 'row', gap: 8, paddingHorizontal: 12, paddingVertical: 6 }}
            >
              {tagSuggestions.map((tg) => (
                <Pressable
                  key={`sugg-${tg}`}
                  onPress={() => handleAddTag(tg)}
                  style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#dcfce7', borderColor: '#86efac', borderWidth: 1, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 4, gap: 4 }}
                >
                  <MaterialCommunityIcons name="tag-outline" size={12} color="#16a34a" />
                  <Text style={{ fontSize: 12, color: '#166534', fontWeight: '600' }}>{tg}</Text>
                </Pressable>
              ))}
            </ScrollView>
          )}
          </>
        )}

        {/* Messages — wrapped in a flex:1 region so the list (not the input) shrinks when
            the keyboard opens, keeping the send button visible above the keyboard. */}
        <View style={styles.messagesRegion}>
        {isLoadingMessages && listData.length === 0 ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator
              size="large"
              color={theme.colors.primary}
            />
          </View>
        ) : (
          <View style={{ flex: 1 }}>
          <View style={{ flex: 1, opacity: listReady ? 1 : 0 }}>
          <FlatList
            key={String(phoneNumber)}
            ref={flatListRef}
            data={listData}
            renderItem={renderItem}
            keyExtractor={keyExtractor}
            inverted
            onScroll={handleScroll}
            scrollEventThrottle={16}
            onEndReached={handleEndReached}
            onEndReachedThreshold={1.5}
            onContentSizeChange={handleContentSizeChange}
            contentContainerStyle={styles.messagesContent}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            removeClippedSubviews={false}
            windowSize={11}
            maxToRenderPerBatch={10}
            initialNumToRender={15}
            updateCellsBatchingPeriod={50}
            ListFooterComponent={
              isLoadingOlderMessages ? (
                <View style={styles.olderMsgsLoader}>
                  <ActivityIndicator size="small" color={theme.colors.primary} />
                  <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: 4 }}>
                    טוען הודעות ישנות...
                  </Text>
                </View>
              ) : hasMoreMessages ? (
                <Pressable onPress={handleLoadOlderPress} style={styles.olderMsgsLoader} hitSlop={8}>
                  <Text variant="labelMedium" style={{ color: theme.colors.primary, fontWeight: '600' }}>
                    {isRTL ? '⬆️ טען הודעות ישנות יותר' : '⬆️ Load older messages'}
                  </Text>
                </Pressable>
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
          </View>
          {!listReady && (
            <View style={[styles.loadingContainer, StyleSheet.absoluteFill]} pointerEvents="none">
              <ActivityIndicator size="large" color={theme.colors.primary} />
            </View>
          )}
          </View>
        )}

        {/* Scroll to bottom — isolated component, toggled imperatively so scrolling does
            not re-render the whole screen. */}
        <ScrollToBottomButton
          ref={scrollBtnRef}
          onPress={() => scrollToNewest(true)}
          backgroundColor={theme.colors.surface}
          iconColor={theme.colors.primary}
          style={[styles.scrollDownBtn, { bottom: 16 }]}
        />
        </View>

        {/* Template send banner — shown whenever free-text input is not allowed (matches web) */}
        {/* Measure the input-bar height so the @mention / quick-message pickers can anchor exactly
            above it (a fixed bottom offset hid them behind the input on devices with a nav-bar inset). */}
        <View onLayout={(e) => setInputBarHeight(e.nativeEvent.layout.height)}>
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
            {/* 💬 Internal message — always available, even when the WhatsApp window is CLOSED.
                The inline @-mention composer lives in ChatInput (open-window only), so when closed we
                route to the contact's internal-messages composer (works regardless of window state). */}
            <Pressable
              onPress={() => { setContactInfoInitialTab('internal'); setShowContactInfoSheet(true); }}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                marginHorizontal: 12,
                marginTop: 8,
                paddingVertical: 9,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: '#7c3aed',
                backgroundColor: pressed ? (theme.dark ? '#2e1065' : '#f5f3ff') : 'transparent',
              })}
            >
              <MaterialCommunityIcons name="message-badge-outline" size={17} color="#7c3aed" />
              <Text style={{ color: '#7c3aed', fontSize: 13, fontWeight: '700' }}>
                {isRTL ? '💬 הודעה פנימית לצוות' : '💬 Internal message'}
              </Text>
            </Pressable>

            <View style={[
              styles.closedInlineBanner,
              {
                backgroundColor: theme.dark ? '#1a1a2e' : '#fff8e1',
                gap: 8,
                paddingBottom: Math.max(insets.bottom, 8) + 4,
              },
            ]}>
              {/* ⚡ Send default template — greyed out when no default template is configured. We keep
                  onPress active in that case (only block sending) so tapping it explains how to set one. */}
              <Pressable
                onPress={handleSendDefaultTemplate}
                disabled={isSendingTemplate || isStatusLoading}
                style={({ pressed }) => {
                  const noDefault = hasDefaultTemplate === false;
                  return {
                    flex: 1,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 5,
                    backgroundColor: noDefault
                      ? (theme.dark ? '#3f3f46' : '#d1d5db')
                      : (pressed ? '#d97706' : '#f59e0b'),
                    paddingVertical: 11,
                    borderRadius: 10,
                    opacity: (isSendingTemplate || isStatusLoading) ? 0.6 : (noDefault ? 0.7 : 1),
                  };
                }}
              >
                {isSendingTemplate
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <MaterialCommunityIcons name="lightning-bolt" size={18} color={hasDefaultTemplate === false ? (theme.dark ? '#a1a1aa' : '#6b7280') : '#fff'} />}
                <Text style={{ color: hasDefaultTemplate === false ? (theme.dark ? '#a1a1aa' : '#6b7280') : '#fff', fontSize: 13, fontWeight: '700' }}>
                  {isSendingTemplate
                    ? (isRTL ? 'שולח...' : 'Sending...')
                    : (isRTL ? 'ברירת מחדל' : 'Default')}
                </Text>
              </Pressable>

              {/* 📄 Choose template (opens modal with Quick/Manual) — available immediately,
                  independent of the conversation-status fetch, so the user can start composing fast. */}
              <Pressable
                onPress={handleOpenConversation}
                style={({ pressed }) => ({
                  flex: 1,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 5,
                  backgroundColor: pressed ? '#245049' : '#2e6155',
                  paddingVertical: 11,
                  borderRadius: 10,
                })}
              >
                <MaterialCommunityIcons name="card-text-outline" size={18} color="#fff" />
                <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>
                  {isRTL ? 'התחל שיחה' : 'Start Chat'}
                </Text>
              </Pressable>

              {/* 🕐 Schedule message — available immediately, independent of conversation-status fetch. */}
              <Pressable
                onPress={handleOpenSchedule}
                style={({ pressed }) => ({
                  flex: 1,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 5,
                  // Match web: schedule is an outline/white button (transparent bg, grey border+text).
                  backgroundColor: pressed ? (theme.dark ? 'rgba(255,255,255,0.06)' : '#f3f4f6') : 'transparent',
                  borderWidth: 1.5,
                  borderColor: theme.dark ? '#52525b' : '#d1d5db',
                  paddingVertical: 11,
                  borderRadius: 10,
                })}
              >
                <MaterialCommunityIcons name="clock-outline" size={18} color={theme.dark ? '#a1a1aa' : '#6b7280'} />
                <Text style={{ color: theme.dark ? '#a1a1aa' : '#6b7280', fontSize: 13, fontWeight: '700' }}>
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
        </View>

        {/* Template Selector Modal — Quick / Manual tabs */}
        <Modal
          visible={showTemplateSelector}
          transparent
          animationType="slide"
          onRequestClose={() => { Keyboard.dismiss(); setShowTemplateSelector(false); setQuickTemplateSearch(''); setQuickOpenVarValues({}); }}
        >
          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top : 0}
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
                        // Auto-resolved default per variable from the saved mapping. Empty for
                        // "open" (manual) variables. The user can override any value below.
                        const autoValueFor = (idx: number) => {
                          const me = mapping.find(m => m.index === idx);
                          if (!me || me.entity === 'open') return '';
                          return resolveQuickVar(me.entity, me.field);
                        };
                        const effValue = (idx: number) => {
                          const key = `${item.id}_${idx}`;
                          return quickOpenVarValues[key] !== undefined ? quickOpenVarValues[key] : autoValueFor(idx);
                        };
                        const isAutoMapped = (idx: number) => {
                          const me = mapping.find(m => m.index === idx);
                          return !!me && me.entity !== 'open';
                        };
                        const missing = varIndices.some(idx => !effValue(idx).trim());
                        return (
                          <View style={[styles.templateItem, { flexDirection: 'column', alignItems: 'stretch', gap: 8 }]}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                              <View style={{ flex: 1 }}>
                                <Text style={{ fontWeight: '700', color: theme.colors.onSurface, fontSize: 14 }}>
                                  {item.friendlyName || item.name}
                                </Text>
                                {item.friendlyName && item.name && item.friendlyName !== item.name && (
                                  <Text style={{ fontSize: 11, color: theme.colors.onSurfaceVariant, marginTop: 1 }} numberOfLines={1}>{item.name}</Text>
                                )}
                                {item.usageType && (
                                  <Text style={{ fontSize: 11, color: '#6c63ff', marginTop: 1 }}>{item.usageType}</Text>
                                )}
                                <Text numberOfLines={1} style={{ color: theme.colors.onSurfaceVariant, fontSize: 12, marginTop: 2 }}>
                                  {getTemplateBodyText(item)}
                                </Text>
                              </View>
                            </View>
                            {/* All variable inputs — auto-mapped values are pre-filled and editable */}
                            {varIndices.map(idx => (
                              <View key={idx} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                <Text style={{ fontSize: 12, color: '#6c63ff', minWidth: 30 }}>{`{{${idx}}}`}</Text>
                                <TextInput
                                  placeholder={isRTL ? 'הזן ערך...' : 'Enter value...'}
                                  placeholderTextColor={theme.colors.onSurfaceVariant}
                                  value={effValue(idx)}
                                  onChangeText={v => setQuickOpenVarValues(prev => ({ ...prev, [`${item.id}_${idx}`]: v }))}
                                  style={{ flex: 1, borderWidth: 1, borderColor: isAutoMapped(idx) ? '#6c63ff' : theme.colors.outline, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, fontSize: 13, color: theme.colors.onSurface, backgroundColor: theme.colors.background }}
                                />
                                {isAutoMapped(idx) && (
                                  <Text style={{ fontSize: 10, color: '#6c63ff', fontWeight: '700' }}>{isRTL ? 'אוטו' : 'AUTO'}</Text>
                                )}
                              </View>
                            ))}
                            <Pressable
                              onPress={() => {
                                const templateVariableQuery = varIndices.map((idx, i) =>
                                  buildTemplateVarEntry(idx, effValue(idx), i + 1)
                                );
                                setShowTemplateSelector(false);
                                doSendTemplate(item, templateVariableQuery);
                              }}
                              disabled={isSendingTemplate || missing}
                              style={({ pressed }) => ({
                                flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
                                backgroundColor: pressed ? '#1a7a5e' : '#25D366',
                                paddingVertical: 9, borderRadius: 8,
                                opacity: (isSendingTemplate || missing) ? 0.5 : 1,
                              })}
                            >
                              <MaterialCommunityIcons name="send" size={16} color="#fff" />
                              <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>
                                {isRTL ? 'התחל שיחה' : 'Start Chat'}
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
          </KeyboardAvoidingView>
        </Modal>

        {/* Template Variables Modal - when template has {{1}}, {{2}}, etc. */}
        <Modal
          visible={!!selectedTemplateForVars}
          transparent
          animationType="slide"
          onRequestClose={() => {
            Keyboard.dismiss();
            setSelectedTemplateForVars(null);
            setTemplateVariableValues({});
          }}
        >
          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top : 0}
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
                    {isSendingTemplate ? t('common.sending') : (isRTL ? 'התחל שיחה' : 'Start Chat')}
                  </Button>
                </ScrollView>
              )}
            </View>
          </View>
          </KeyboardAvoidingView>
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
                {/* Message type selector: regular free-text vs. template */}
                <View style={{ flexDirection: 'row', backgroundColor: theme.dark ? 'rgba(255,255,255,0.06)' : '#f1f5f9', borderRadius: 10, padding: 3, marginBottom: 12 }}>
                  {([
                    { key: 'text', label: isRTL ? 'הודעה רגילה' : 'Regular', icon: 'message-text-outline' },
                    { key: 'template', label: isRTL ? 'תבנית' : 'Template', icon: 'card-text-outline' },
                  ] as const).map((opt) => {
                    const active = scheduleMessageType === opt.key;
                    return (
                      <Pressable
                        key={opt.key}
                        onPress={() => setScheduleMessageType(opt.key)}
                        style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 8, borderRadius: 8, backgroundColor: active ? '#6c63ff' : 'transparent' }}
                      >
                        <MaterialCommunityIcons name={opt.icon as any} size={16} color={active ? '#fff' : theme.colors.onSurfaceVariant} />
                        <Text style={{ fontSize: 13, fontWeight: active ? '700' : '500', color: active ? '#fff' : theme.colors.onSurfaceVariant }}>{opt.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>

                {scheduleMessageType === 'text' ? (
                  <>
                    <Text
                      variant="labelMedium"
                      style={{ color: theme.colors.onSurfaceVariant, marginBottom: 6 }}
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
                          borderColor: theme.dark ? 'rgba(255,255,255,0.15)' : '#d1d5db',
                          backgroundColor: theme.dark ? 'rgba(255,255,255,0.05)' : '#f9fafb',
                          color: theme.colors.onSurface,
                          fontSize: 15,
                          minHeight: 60,
                          textAlignVertical: 'top',
                          writingDirection: isRTL ? 'rtl' : 'ltr',
                        },
                      ]}
                    />
                  </>
                ) : (
                  <>
                    <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 6 }}>
                      {isRTL ? 'בחר תבנית' : 'Select template'}
                    </Text>
                    {isLoadingTemplates ? (
                      <ActivityIndicator size="small" color={theme.colors.primary} style={{ marginVertical: 8 }} />
                    ) : (
                      <ScrollView style={{ maxHeight: 150 }} keyboardShouldPersistTaps="handled">
                        {templates.length === 0 ? (
                          <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 13, paddingVertical: 8 }}>
                            {isRTL ? 'אין תבניות מאושרות' : 'No approved templates'}
                          </Text>
                        ) : (
                          templates.map((tpl) => {
                            const id = (tpl as any).Id || tpl.id;
                            const active = scheduleTemplate && ((scheduleTemplate as any).Id || scheduleTemplate.id) === id;
                            return (
                              <Pressable
                                key={id}
                                onPress={() => handleSelectScheduleTemplate(tpl)}
                                style={{ paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8, marginBottom: 4, backgroundColor: active ? (theme.dark ? '#312e81' : '#eef2ff') : (theme.dark ? 'rgba(255,255,255,0.04)' : '#f9fafb'), borderWidth: 1, borderColor: active ? '#6c63ff' : 'transparent' }}
                              >
                                <Text style={{ fontWeight: '600', fontSize: 13, color: theme.colors.onSurface }} numberOfLines={1}>
                                  {tpl.friendlyName || tpl.name}
                                </Text>
                                {tpl.friendlyName && tpl.name && tpl.friendlyName !== tpl.name && (
                                  <Text style={{ fontSize: 11, color: theme.colors.onSurfaceVariant }} numberOfLines={1}>{tpl.name}</Text>
                                )}
                                <Text style={{ fontSize: 11, color: theme.colors.onSurfaceVariant }} numberOfLines={1}>
                                  {getTemplateBodyText(tpl)}
                                </Text>
                              </Pressable>
                            );
                          })
                        )}
                      </ScrollView>
                    )}
                    {scheduleTemplate && getTemplateVariableIndices(scheduleTemplate).length > 0 && (() => {
                      let schedMapping: Array<{ index: number; entity: string; field: string }> = [];
                      try { schedMapping = JSON.parse((scheduleTemplate as any).variableMappingJson || '[]'); } catch {}
                      const isAutoMapped = (idx: number) => {
                        const me = schedMapping.find((m) => m.index === idx);
                        return !!me && me.entity !== 'open';
                      };
                      return (
                        <View style={{ marginTop: 8, gap: 6 }}>
                          <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant }}>
                            {isRTL ? 'משתנים' : 'Variables'}
                          </Text>
                          {getTemplateVariableIndices(scheduleTemplate).map((idx) => {
                            const auto = isAutoMapped(idx);
                            return (
                              <View key={idx} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                <Text style={{ fontSize: 12, color: '#6c63ff', minWidth: 32 }}>{`{{${idx}}}`}</Text>
                                <TextInput
                                  value={scheduleVarValues[idx] || ''}
                                  onChangeText={(v) => setScheduleVarValues((prev) => ({ ...prev, [idx]: v }))}
                                  placeholder={isRTL ? 'ערך...' : 'Value...'}
                                  placeholderTextColor={theme.colors.onSurfaceVariant}
                                  style={{ flex: 1, borderWidth: 1, borderColor: auto ? '#6c63ff' : (theme.dark ? 'rgba(255,255,255,0.15)' : '#d1d5db'), borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, fontSize: 13, color: theme.colors.onSurface, backgroundColor: theme.dark ? 'rgba(255,255,255,0.05)' : '#f9fafb' }}
                                />
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                                  <MaterialCommunityIcons name={auto ? 'flash' : 'pencil'} size={12} color={auto ? '#6c63ff' : theme.colors.onSurfaceVariant} />
                                  <Text style={{ fontSize: 10, color: auto ? '#6c63ff' : theme.colors.onSurfaceVariant }}>
                                    {auto ? (isRTL ? 'אוטומטי' : 'Auto') : (isRTL ? 'ידני' : 'Manual')}
                                  </Text>
                                </View>
                              </View>
                            );
                          })}
                        </View>
                      );
                    })()}
                  </>
                )}
                <Text
                  variant="labelMedium"
                  style={{ color: theme.colors.onSurfaceVariant, marginTop: 12, marginBottom: 6 }}
                >
                  {t('chats.pickDateTime', 'תאריך ושעה')}
                </Text>
                {/* Single combined date+time field — unified GambotDateTimePicker (native wheel + Save). */}
                <Pressable
                  onPress={() => setShowScheduleDatePicker(true)}
                  style={[styles.scheduleInput, { borderColor: theme.dark ? 'rgba(255,255,255,0.15)' : '#d1d5db', backgroundColor: theme.dark ? 'rgba(255,255,255,0.05)' : '#f9fafb', flexDirection: isRTL ? 'row-reverse' : 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10 }]}
                >
                  <MaterialCommunityIcons name="calendar-clock" size={18} color={theme.colors.onSurfaceVariant} />
                  <Text style={{ flex: 1, color: scheduledDateTime ? theme.colors.onSurface : theme.colors.onSurfaceVariant, fontSize: 14, textAlign: isRTL ? 'right' : 'left' }}>
                    {scheduledDateTime
                      ? formatScheduleDateTime(scheduledDateTime, i18n.language)
                      : t('tasks.selectDueDate', 'בחר תאריך ושעה')}
                  </Text>
                </Pressable>
                <GambotDateTimePicker
                  visible={showScheduleDatePicker}
                  mode="datetime"
                  value={scheduledDateTime || new Date()}
                  minimumDate={new Date()}
                  title={t('chats.pickDateTime', 'תאריך ושעה')}
                  onConfirm={(d) => setScheduledDateTime(d)}
                  onDismiss={() => setShowScheduleDatePicker(false)}
                />
                {scheduleMessageType === 'text' && scheduleIsFarFuture && (
                  <Text style={{ color: theme.dark ? '#fdba74' : '#9a3412', fontSize: 12, marginTop: 8 }}>
                    {isRTL
                      ? '⚠️ מעבר ל-23 שעות חובה לבחור תבנית.'
                      : '⚠️ More than 23h ahead requires a template.'}
                  </Text>
                )}
                {(() => {
                  const invalid = !scheduledDateTime || isScheduling
                    || (scheduleMessageType === 'text' && (!scheduleText.trim() || scheduleIsFarFuture))
                    || (scheduleMessageType === 'template' && !scheduleTemplate);
                  return (
                <Pressable
                  onPress={handleScheduleSubmit}
                  style={({ pressed }) => [
                    styles.scheduleSubmitBtn,
                    {
                      backgroundColor: pressed ? '#1a7a5e' : '#25D366',
                      opacity: invalid ? 0.5 : 1,
                    },
                  ]}
                  disabled={invalid}
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
                  );
                })()}
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

              {selectedMessageUrls.length > 0 && (
                <Pressable
                  onPress={handleCopyLink}
                  style={({ pressed }) => [
                    styles.actionItem,
                    pressed && {
                      backgroundColor: theme.colors.surfaceVariant,
                    },
                  ]}
                >
                  <MaterialCommunityIcons
                    name="link-variant"
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
                    {selectedMessageUrls.length > 1
                      ? t('chats.copyLinks', 'העתק קישורים')
                      : t('chats.copyLink', 'העתק קישור')}
                  </Text>
                </Pressable>
              )}

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

              <Pressable
                onPress={handleForward}
                style={({ pressed }) => [
                  styles.actionItem,
                  pressed && { backgroundColor: theme.colors.surfaceVariant },
                ]}
              >
                <MaterialCommunityIcons name="share" size={22} color={theme.colors.onSurface} />
                <Text variant="bodyLarge" style={{ marginStart: 16, color: theme.colors.onSurface }}>
                  {t('chats.forward', 'העבר')}
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

        {/* Forward message sheet */}
        <ForwardMessageSheet
          visible={showForwardSheet}
          sourceMessage={forwardMessage}
          onClose={() => { setShowForwardSheet(false); setForwardMessage(null); }}
        />

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
                { icon: 'clipboard-check-outline', label: t('tasks.addTask'), color: '#2196F3', action: () => { setShowQuickActionsSheet(false); setShowCreateTaskModal(true); } },
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

        {/* Create Task — shared lightweight sheet (same UX as the Lead flow): title auto-fills to
            "שיחת טלפון - {contact}", due date + reminder default to now, assignee = current user,
            and the task auto-links to this contact. Bottom sheet, not a centered modal. */}
        <AddTaskSheet
          visible={showCreateTaskModal}
          onDismiss={() => setShowCreateTaskModal(false)}
          organization={user?.organization || ''}
          user={user}
          relatedPhone={phoneNumber as string}
          relatedTo={{
            type: 'contact',
            entityId: phoneNumber as string,
            entityName: contactName,
          }}
          defaultTitle={contactName ? `${t('contacts.phoneCall', 'שיחת טלפון')} - ${contactName}` : undefined}
        />

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
                  onChangeText={handleNoteTextChange}
                  placeholder={isRTL ? 'כתוב הערה... (@ לאזכור)' : 'Write a note... (@ to mention)'}
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

                {showNoteMentionPicker && (
                  <View style={{ marginHorizontal: 20, marginTop: 8, borderWidth: 1, borderColor: theme.colors.outline, borderRadius: 10, maxHeight: 180, backgroundColor: theme.colors.surface, overflow: 'hidden' }}>
                    <ScrollView keyboardShouldPersistTaps="handled">
                      {filteredNoteMentionUsers.length > 0 ? (
                        filteredNoteMentionUsers.map((u: any, idx: number) => (
                          <Pressable
                            key={u.userId || u.uID || idx}
                            onPress={() => handleSelectNoteMention(u)}
                            style={({ pressed }) => [styles.mentionItem, pressed && { backgroundColor: theme.colors.surfaceVariant }]}
                          >
                            <MaterialCommunityIcons name="account-circle-outline" size={18} color={theme.colors.primary} />
                            <Text variant="bodyMedium" style={{ color: theme.colors.onSurface, marginStart: 8 }}>{getMentionUserName(u)}</Text>
                          </Pressable>
                        ))
                      ) : orgUsersLoading ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', padding: 14, gap: 8 }}>
                          <ActivityIndicator size="small" color={theme.colors.primary} />
                          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>{isRTL ? 'טוען משתמשים...' : 'Loading users...'}</Text>
                        </View>
                      ) : (
                        <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, padding: 14 }}>{isRTL ? 'לא נמצאו משתמשים תואמים' : 'No matching users'}</Text>
                      )}
                    </ScrollView>
                  </View>
                )}

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

        {/* Timeline sheet — full notes + activity view (like the web "ציר זמן" tab) */}
        <Modal
          visible={showTimelineSheet}
          transparent
          animationType="slide"
          onRequestClose={() => { Keyboard.dismiss(); setShowTimelineSheet(false); }}
        >
          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top : 0}
          >
            <Pressable
              style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}
              onPress={() => { Keyboard.dismiss(); setShowTimelineSheet(false); }}
            >
              <Pressable
                style={{
                  backgroundColor: theme.colors.surface,
                  borderTopLeftRadius: 16,
                  borderTopRightRadius: 16,
                  height: '82%',
                  paddingBottom: Math.max(insets.bottom, 12),
                }}
                onPress={() => {}}
              >
                {/* Header */}
                <View style={{ flexDirection: isRTL ? 'row-reverse' : 'row', alignItems: 'center', justifyContent: 'space-between', paddingStart: 20, paddingEnd: 8, paddingTop: 16, paddingBottom: 8 }}>
                  <View style={{ flexDirection: isRTL ? 'row-reverse' : 'row', alignItems: 'center', gap: 8 }}>
                    <MaterialCommunityIcons name="timeline-text-outline" size={22} color="#2e6155" />
                    <Text variant="titleMedium" style={{ fontWeight: '700', color: theme.colors.onSurface }}>
                      {isRTL ? 'ציר זמן' : 'Timeline'}
                    </Text>
                  </View>
                  <IconButton icon="close" size={22} onPress={() => setShowTimelineSheet(false)} />
                </View>

                {/* Filter chips */}
                <View style={{ flexDirection: isRTL ? 'row-reverse' : 'row', gap: 8, paddingHorizontal: 20, paddingBottom: 8 }}>
                  {([['all', isRTL ? 'הכל' : 'All'], ['notes', isRTL ? 'הערות' : 'Notes']] as const).map(([key, label]) => {
                    const sel = timelineFilter === key;
                    return (
                      <Pressable
                        key={key}
                        onPress={() => setTimelineFilter(key)}
                        style={{
                          paddingVertical: 6,
                          paddingHorizontal: 16,
                          borderRadius: 16,
                          backgroundColor: sel ? '#2e6155' : theme.colors.surfaceVariant,
                        }}
                      >
                        <Text style={{ fontSize: 13, fontWeight: '600', color: sel ? '#fff' : theme.colors.onSurfaceVariant }}>{label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                <Divider />

                {/* List (newest first) */}
                <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 8 }} keyboardShouldPersistTaps="handled">
                  {(() => {
                    const isNoteEntry = (e: any) => {
                      const ty = (e?.timelineType || e?.TimelineType || e?.type || '').toLowerCase();
                      return ty === 'note' || ty === 'internal_mention' || (!ty && !!(e?.note || e?.text));
                    };
                    const entries = [...mergedTimeline]
                      .filter((e) => (timelineFilter === 'notes' ? isNoteEntry(e) : true))
                      .sort((a, b) => {
                        const ta = new Date(a.createdOn || a.timestamp || a.CreatedOn || 0).getTime();
                        const tb = new Date(b.createdOn || b.timestamp || b.CreatedOn || 0).getTime();
                        return tb - ta;
                      });
                    if (entries.length === 0) {
                      return (
                        <View style={{ alignItems: 'center', paddingVertical: 48 }}>
                          <MaterialCommunityIcons name="timeline-outline" size={40} color={theme.colors.onSurfaceVariant} />
                          <Text style={{ color: theme.colors.onSurfaceVariant, marginTop: 8 }}>
                            {timelineFilter === 'notes' ? (isRTL ? 'אין הערות עדיין' : 'No notes yet') : (isRTL ? 'אין פעילות עדיין' : 'No activity yet')}
                          </Text>
                        </View>
                      );
                    }
                    const tlIcon: Record<string, string> = {
                      note: 'note-text-outline', internal_mention: 'at',
                      task_created: 'clipboard-plus-outline', task_status_change: 'clipboard-check-outline',
                      task_assigned: 'clipboard-account-outline', task_completed: 'clipboard-check',
                      assign: 'account-switch-outline', 'open conversation': 'lock-open-variant-outline',
                      close: 'lock-outline', 'status change': 'swap-horizontal', 'category change': 'shape-outline',
                      'campaign message sent': 'bullhorn-outline', 'botomation send message': 'robot-outline',
                    };
                    return entries.map((entry, idx) => {
                      const ty = (entry.timelineType || entry.TimelineType || entry.type || 'note').toLowerCase();
                      const text = entry.note || entry.text || entry.description || buildTimelineText(entry, isRTL);
                      const by = entry.createdByName || entry.CreatedByName || entry.addedByName || '';
                      const ts = entry.createdOn || entry.timestamp || entry.CreatedOn || '';
                      const taskId = entry.taskId || entry.TaskId || (ty.startsWith('task') ? (entry.entityId || entry.relatedId) : '');
                      const isTask = ty.startsWith('task') && !!taskId;
                      const isNote = ty === 'note' || ty === 'internal_mention';
                      return (
                        <View key={entry.timelineEntryId || entry.id || idx} style={{ flexDirection: isRTL ? 'row-reverse' : 'row', marginBottom: 14, gap: 10 }}>
                          <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: isNote ? '#fff3e0' : '#e8f0ee', alignItems: 'center', justifyContent: 'center' }}>
                            <MaterialCommunityIcons name={(tlIcon[ty] || 'information-outline') as any} size={16} color={isNote ? '#795548' : '#2e6155'} />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={{ color: theme.colors.onSurface, fontSize: 14, lineHeight: 20, textAlign: isRTL ? 'right' : 'left' }}>{text}</Text>
                            <View style={{ flexDirection: isRTL ? 'row-reverse' : 'row', alignItems: 'center', gap: 8, marginTop: 2 }}>
                              {by ? <Text style={{ fontSize: 11, color: theme.colors.onSurfaceVariant }}>{by}</Text> : null}
                              {ts ? <Text style={{ fontSize: 11, color: theme.colors.onSurfaceVariant }}>{formatMessageTime(ts)}</Text> : null}
                            </View>
                            {isTask ? (
                              <Pressable
                                onPress={() => { setShowTimelineSheet(false); router.push({ pathname: '/(tabs)/tasks/[id]', params: { id: String(taskId) } } as any); }}
                                style={{ marginTop: 6, alignSelf: isRTL ? 'flex-end' : 'flex-start', flexDirection: isRTL ? 'row-reverse' : 'row', alignItems: 'center', gap: 4, backgroundColor: '#2e6155', paddingVertical: 5, paddingHorizontal: 10, borderRadius: 14 }}
                              >
                                <MaterialCommunityIcons name="clipboard-text-outline" size={13} color="#fff" />
                                <Text style={{ color: '#fff', fontSize: 12, fontWeight: '600' }}>{isRTL ? 'צפה במשימה' : 'View task'}</Text>
                              </Pressable>
                            ) : null}
                          </View>
                        </View>
                      );
                    });
                  })()}
                </ScrollView>

                {/* Add-note composer pinned at the bottom */}
                <Divider />
                {showNoteMentionPicker && (
                  <View style={{ marginHorizontal: 16, marginBottom: 4, borderWidth: 1, borderColor: theme.colors.outline, borderRadius: 10, maxHeight: 160, backgroundColor: theme.colors.surface, overflow: 'hidden' }}>
                    <ScrollView keyboardShouldPersistTaps="handled">
                      {filteredNoteMentionUsers.length > 0 ? (
                        filteredNoteMentionUsers.map((u: any, idx: number) => (
                          <Pressable
                            key={u.userId || u.uID || idx}
                            onPress={() => handleSelectNoteMention(u)}
                            style={({ pressed }) => [styles.mentionItem, pressed && { backgroundColor: theme.colors.surfaceVariant }]}
                          >
                            <MaterialCommunityIcons name="account-circle-outline" size={18} color={theme.colors.primary} />
                            <Text variant="bodyMedium" style={{ color: theme.colors.onSurface, marginStart: 8 }}>{getMentionUserName(u)}</Text>
                          </Pressable>
                        ))
                      ) : orgUsersLoading ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', padding: 14, gap: 8 }}>
                          <ActivityIndicator size="small" color={theme.colors.primary} />
                          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>{isRTL ? 'טוען משתמשים...' : 'Loading users...'}</Text>
                        </View>
                      ) : (
                        <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, padding: 14 }}>{isRTL ? 'לא נמצאו משתמשים תואמים' : 'No matching users'}</Text>
                      )}
                    </ScrollView>
                  </View>
                )}
                <View style={{ flexDirection: isRTL ? 'row-reverse' : 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingTop: 8 }}>
                  <TextInput
                    value={noteText}
                    onChangeText={handleNoteTextChange}
                    placeholder={isRTL ? 'הוסף הערה לציר הזמן... (@ לאזכור)' : 'Add a note... (@ to mention)'}
                    placeholderTextColor={theme.colors.onSurfaceVariant}
                    multiline
                    style={{
                      flex: 1,
                      borderWidth: 1,
                      borderColor: theme.colors.outline,
                      borderRadius: 20,
                      paddingHorizontal: 14,
                      paddingTop: 10,
                      paddingBottom: 10,
                      maxHeight: 100,
                      fontSize: 14,
                      color: theme.colors.onSurface,
                      textAlign: isRTL ? 'right' : 'left',
                    }}
                  />
                  <IconButton
                    icon="send"
                    size={22}
                    mode="contained"
                    containerColor="#2e6155"
                    iconColor="#fff"
                    disabled={savingNote || !noteText.trim()}
                    onPress={() => { Keyboard.dismiss(); handleSaveNote(); }}
                  />
                </View>
              </Pressable>
            </Pressable>
          </KeyboardAvoidingView>
        </Modal>

        {/* / inline quick messages */}
        {showInlineQuickMessages && (() => {
          const filtered = quickMessages.filter((qm: any) => {
            if (!quickSlashFilter) return true;
            const needle = quickSlashFilter.toLowerCase();
            const sc = (qm.shortcut || qm.title || qm.name || '').toLowerCase();
            const content = (qm.messageText || qm.text || qm.message || qm.body || '').toLowerCase();
            return sc.includes(needle) || content.includes(needle);
          });
          // Always render the picker (even with zero results) so the user gets visible feedback
          // instead of a silent nothing — either "no quick messages defined" or "no match".
          const isEmpty = filtered.length === 0 && !isLoadingQuickMessages;
          const noneDefined = quickMessages.length === 0;
          return (
            <View style={[styles.mentionPicker, { backgroundColor: theme.colors.surface, borderColor: theme.colors.outline, maxHeight: 220, bottom: inputBarHeight + (Platform.OS === 'ios' ? keyboardHeight : 0), zIndex: 1000 }]}>
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
                ) : isEmpty ? (
                  <View style={{ paddingHorizontal: 14, paddingVertical: 16, alignItems: 'center', gap: 4 }}>
                    <MaterialCommunityIcons name="lightning-bolt-outline" size={22} color={theme.colors.onSurfaceVariant} />
                    <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center' }}>
                      {noneDefined
                        ? t('chats.noQuickMessages', 'אין הודעות מהירות מוגדרות')
                        : (isRTL ? 'לא נמצאו הודעות מהירות תואמות' : 'No matching quick messages')}
                    </Text>
                    {noneDefined && (
                      <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center', opacity: 0.8 }}>
                        {isRTL ? 'ניתן להגדיר הודעות מהירות בהגדרות' : 'You can define quick messages in settings'}
                      </Text>
                    )}
                  </View>
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
                      {qm.messageText || qm.text || qm.message || qm.body || ''}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          );
        })()}

        {/* @mention picker — visibility is driven solely by showMentionPicker (set when an
            @mention is being composed). We always render a state (list / loading / empty) so the
            user gets feedback instead of a silent nothing when users haven't loaded yet. */}
        {showMentionPicker && (
          <View style={[styles.mentionPicker, { backgroundColor: theme.colors.surface, borderColor: theme.colors.outline, maxHeight: 220, bottom: inputBarHeight + (Platform.OS === 'ios' ? keyboardHeight : 0), zIndex: 1000 }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.outline }}>
              <MaterialCommunityIcons name="at" size={16} color={theme.colors.primary} />
              <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant, marginStart: 6 }}>
                {isRTL ? 'אזכור משתמש' : 'Mention a user'}
              </Text>
              <Pressable onPress={() => setShowMentionPicker(false)} hitSlop={8} style={{ marginStart: 'auto' }}>
                <MaterialCommunityIcons name="close" size={16} color={theme.colors.onSurfaceVariant} />
              </Pressable>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled">
              {filteredMentionUsers.length > 0 ? (
                filteredMentionUsers.map((u: any, idx: number) => (
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
                      {getMentionUserName(u)}
                    </Text>
                  </Pressable>
                ))
              ) : orgUsersLoading ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', padding: 14, gap: 8 }}>
                  <ActivityIndicator size="small" color={theme.colors.primary} />
                  <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                    {isRTL ? 'טוען משתמשים...' : 'Loading users...'}
                  </Text>
                </View>
              ) : (
                <Pressable onPress={loadOrgUsers} style={styles.mentionItem}>
                  <MaterialCommunityIcons name="refresh" size={18} color={theme.colors.primary} />
                  <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginStart: 8 }}>
                    {mentionQuery
                      ? (isRTL ? 'לא נמצאו משתמשים תואמים' : 'No matching users')
                      : (isRTL ? 'לא נטענו משתמשים — הקש לניסיון חוזר' : 'No users loaded — tap to retry')}
                  </Text>
                </Pressable>
              )}
            </ScrollView>
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

      {/* Shared-media grid (opened from the header) — a WhatsApp-style overview of every photo/video
          exchanged with this contact. Tapping a tile opens the existing full-screen viewer. */}
      {mediaGridVisible && (
        <Modal visible animationType="slide" onRequestClose={() => setMediaGridVisible(false)}>
          <View style={{ flex: 1, backgroundColor: theme.colors.background, paddingTop: insets.top }}>
            <View style={{
              flexDirection: isRTL ? 'row-reverse' : 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingHorizontal: 8,
              paddingVertical: 6,
              borderBottomWidth: 1,
              borderBottomColor: theme.colors.outlineVariant || 'rgba(0,0,0,0.08)',
            }}>
              <IconButton icon={isRTL ? 'arrow-right' : 'arrow-left'} size={24} iconColor={theme.colors.onSurface} onPress={() => setMediaGridVisible(false)} />
              <Text style={{ fontSize: 16, fontWeight: '700', color: theme.colors.onSurface }}>
                {isRTL ? 'מדיה משותפת' : 'Shared media'}
              </Text>
              <View style={{ width: 48 }} />
            </View>
            {mediaMessages.length === 0 ? (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 }}>
                <MaterialCommunityIcons name="image-off-outline" size={48} color={theme.colors.onSurfaceVariant} />
                <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 14 }}>
                  {isRTL ? 'אין עדיין מדיה בשיחה זו' : 'No media in this chat yet'}
                </Text>
              </View>
            ) : (
              (() => {
                const NUM_COLS = 3;
                const GAP = 2;
                const tile = Math.floor((Dimensions.get('window').width - GAP * (NUM_COLS - 1)) / NUM_COLS);
                return (
                  <FlatList
                    data={mediaMessages}
                    key={`media-grid-${NUM_COLS}`}
                    numColumns={NUM_COLS}
                    keyExtractor={(m, i) => m.messageId || `media-${i}`}
                    contentContainerStyle={{ paddingBottom: insets.bottom + 12 }}
                    columnWrapperStyle={{ gap: GAP, marginBottom: GAP }}
                    renderItem={({ item, index }) => {
                      const url = (item as any).gmbt_mediaUrl || item.mediaUrl || (item as any).MediaUrl || (item as any).media_url || '';
                      const tp = (item.type || item.mediaType || '').toLowerCase();
                      const isVideo = tp === 'video' || /\.(mp4|mov|avi|webm|3gp)(\?|$)/i.test(url);
                      return (
                        <Pressable
                          onPress={() => { setGalleryIndex(index); setMediaGridVisible(false); setGalleryVisible(true); }}
                          style={{ width: tile, height: tile, backgroundColor: theme.dark ? '#1f1f22' : '#e5e7eb' }}
                        >
                          <Image source={{ uri: url }} style={{ width: '100%', height: '100%' }} contentFit="cover" transition={120} />
                          {isVideo && (
                            <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.15)' }}>
                              <MaterialCommunityIcons name="play-circle" size={30} color="rgba(255,255,255,0.95)" />
                            </View>
                          )}
                        </Pressable>
                      );
                    }}
                  />
                );
              })()
            )}
          </View>
        </Modal>
      )}

      {/* Media Gallery Viewer (opened from message bubble tap) */}
      {galleryVisible && mediaMessages.length > 0 && (
        <Modal visible animationType="fade" transparent onRequestClose={() => { setGalleryZoomed(false); setGalleryVisible(false); }}>
          <View style={styles.galleryOverlay}>
            <View style={styles.galleryHeader}>
              <IconButton icon="close" size={28} iconColor="#fff" onPress={() => { setGalleryZoomed(false); setGalleryVisible(false); }} />
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
              {!galleryZoomed && galleryIndex > 0 && (
                <Pressable style={[styles.galleryNavBtn, { left: 8 }]} onPress={() => setGalleryIndex((i) => i - 1)}>
                  <MaterialCommunityIcons name="chevron-left" size={36} color="#fff" />
                </Pressable>
              )}
              {!galleryZoomed && galleryIndex < mediaMessages.length - 1 && (
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
                  <ZoomableImage
                    uri={url}
                    resetKey={galleryIndex}
                    onZoomChange={setGalleryZoomed}
                    onHorizontalSwipe={(dir) => {
                      // Swipe right → next media, swipe left → previous (clamped to bounds).
                      setGalleryIndex((i) => {
                        const next = dir > 0 ? i + 1 : i - 1;
                        if (next < 0 || next >= mediaMessages.length) return i;
                        return next;
                      });
                    }}
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
        initialTab={contactInfoInitialTab}
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
  messagesRegion: {
    flex: 1,
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
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    elevation: 16,
    zIndex: 1000,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
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
  scheduleIosPickerWrap: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 8,
    marginTop: 10,
    alignItems: 'stretch',
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
