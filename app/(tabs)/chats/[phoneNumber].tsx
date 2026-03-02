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
import { ChatInput } from '../../../components/chat/ChatInput';
import { chatsApi } from '../../../services/api/chats';
import type { Message, Template } from '../../../types';

type ListItem =
  | {
      kind: 'message';
      data: Message;
      isOutbound: boolean;
      showTail: boolean;
    }
  | { kind: 'separator'; date: string; id: string };

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
  const [selectedTemplateForVars, setSelectedTemplateForVars] = useState<Template | null>(null);
  const [templateVariableValues, setTemplateVariableValues] = useState<Record<number, string>>({});
  const flatListRef = useRef<FlatList>(null);
  const wsRef = useRef<WebSocketService | null>(null);
  const prevMessageCount = useRef(0);

  const contactName = chat?.contactName || phoneNumber || '';

  const [conversationLive, setConversationLive] = useState<boolean | null>(null);

  useEffect(() => {
    if (!user?.organization || !phoneNumber) return;
    chatsApi.getConversationStatus(user.organization, phoneNumber as string).then((res) => {
      const live = res?.IsConversationLiveByPhoneNumber ?? res?.isConversationLive ?? res?.isLive;
      setConversationLive(live === true || live === 'true');
    }).catch(() => {
      setConversationLive(null);
    });
  }, [user?.organization, phoneNumber]);

  const isWindowClosed = useMemo(() => {
    if (conversationLive === true) return false;
    if (conversationLive === false) return true;
    if (!chat) return false;
    const status = chat.lastConversationStatus?.toLowerCase() || '';
    return !status || status === 'closed' || status === 'expired';
  }, [conversationLive, chat?.lastConversationStatus]);

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
        setSelectedTemplateForVars(template);
        setTemplateVariableValues(
          Object.fromEntries(indices.map((i) => [i, ''])),
        );
        return;
      }
      await doSendTemplate(template, []);
    },
    [user, phoneNumber, isSendingTemplate, getTemplateVariableIndices],
  );

  const doSendTemplate = useCallback(
    async (template: Template, templateVariableQuery: any[]) => {
      if (!user?.organization || !phoneNumber) return;
      setIsSendingTemplate(true);
      try {
        await chatsApi.sendTemplateMessage(
          user.organization,
          phoneNumber,
          template.id || template.templateId || template.Id || '',
          user.userId,
          templateVariableQuery,
        );
        Alert.alert(t('common.success'), t('chats.templateSent'));
        setShowTemplateSelector(false);
        setSelectedTemplateForVars(null);
        setTemplateVariableValues({});
        loadMessages(user.organization, phoneNumber);
      } catch {
        Alert.alert(t('common.error'), t('chats.templateSendError'));
      } finally {
        setIsSendingTemplate(false);
      }
    },
    [user, phoneNumber, loadMessages, t],
  );

  const handleSendTemplateWithVariables = useCallback(() => {
    if (!selectedTemplateForVars) return;
    const indices = getTemplateVariableIndices(selectedTemplateForVars);
    const templateVariableQuery = indices.map((idx, i) => ({
      index: i + 1,
      Variable: `{{${idx}}}`,
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
    const scheduledTime = scheduleDate && scheduleTime
      ? `${scheduleDate}T${scheduleTime}:00`
      : '';
    if (!scheduledTime) {
      Alert.alert(t('common.error'), t('chats.pickDateTime'));
      return;
    }
    try {
      await chatsApi.scheduleMessage(
        user.organization,
        phoneNumber,
        scheduleText.trim(),
        scheduledTime,
      );
      Alert.alert(t('common.success'), t('chats.scheduleSuccess'));
      setShowScheduleModal(false);
    } catch {
      Alert.alert(t('common.error'), t('chats.scheduleError'));
    }
  }, [user, phoneNumber, scheduleText, scheduleDate, scheduleTime, t]);

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
        data.type === 'new_message' ||
        data.type === 'message'
      ) {
        const msg = data.message || data;
        if (msg.messageId) {
          addMessage(msg);
          markAsRead(user.organization, phoneNumber);
        }
      }
    });

    wsRef.current = ws;
    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [user?.organization, phoneNumber, addMessage, markAsRead]);

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

  // Build list data with date separators (newest first for inverted list)
  const listData = useMemo<ListItem[]>(() => {
    let msgs = currentMessages;
    if (messageMode === 'internal') {
      msgs = msgs.filter((m) => m.type === 'internal' || (m as any).isInternalMessage === true);
    } else {
      msgs = msgs.filter((m) => m.type !== 'internal' && (m as any).isInternalMessage !== true);
    }

    const sorted = [...msgs].sort(
      (a, b) =>
        new Date(getTs(b)).getTime() -
        new Date(getTs(a)).getTime(),
    );

    const items: ListItem[] = [];

    const orgNumber = user?.wabaNumber || '';

    for (let i = 0; i < sorted.length; i++) {
      const msg = sorted[i];
      const dir = msg.direction?.toLowerCase();
      const isOutbound =
        (orgNumber && msg.from === orgNumber) ||
        dir === 'outbound' ||
        msg.sentFromApp === true ||
        msg.to === phoneNumber;
      const nextMsg = sorted[i + 1];

      const showTail =
        !nextMsg ||
        nextMsg.direction !== msg.direction ||
        getDateKey(getTs(msg)) !==
          getDateKey(getTs(nextMsg));

      items.push({
        kind: 'message',
        data: msg,
        isOutbound,
        showTail,
      });

      const currentDate = getDateKey(getTs(msg));
      const nextDate = nextMsg
        ? getDateKey(getTs(nextMsg))
        : null;

      if (currentDate !== nextDate) {
        items.push({
          kind: 'separator',
          date: formatMessageDateSeparator(
            getTs(msg),
            lang,
          ),
          id: `sep-${currentDate}`,
        });
      }
    }

    return items;
  }, [currentMessages, lang, messageMode]);

  // Send handler
  const handleSend = useCallback(
    async (text: string) => {
      if (!user?.organization || !phoneNumber) return;
      if (isInternalNote) {
        await sendInternalMessage(
          user.organization,
          phoneNumber,
          text,
          user.fullname,
        );
      } else {
        await sendMessage(
          user.organization,
          phoneNumber,
          text,
          user.fullname,
        );
      }
    },
    [
      user,
      phoneNumber,
      isInternalNote,
      sendMessage,
      sendInternalMessage,
    ],
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
            const result = await ImagePicker.launchCameraAsync({
              mediaTypes: 'images',
              quality: 0.8,
            });
            if (!result.canceled && result.assets?.[0]) {
              const asset = result.assets[0];
              sendPickedMedia(asset.uri, asset.fileName || `photo_${Date.now()}.jpg`, asset.mimeType || 'image/jpeg', asset.fileSize);
            }
          },
        },
        {
          text: t('chats.gallery', 'Gallery'),
          onPress: async () => {
            const result = await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ['images', 'videos'],
              quality: 0.8,
            });
            if (!result.canceled && result.assets?.[0]) {
              const asset = result.assets[0];
              const isVideo = asset.type === 'video' || asset.mimeType?.startsWith('video');
              const ext = isVideo ? 'mp4' : 'jpg';
              const mime = asset.mimeType || (isVideo ? 'video/mp4' : 'image/jpeg');
              sendPickedMedia(asset.uri, asset.fileName || `media_${Date.now()}.${ext}`, mime, asset.fileSize);
            }
          },
        },
        {
          text: t('chats.document', 'Document'),
          onPress: async () => {
            try {
              const DocumentPicker = require('expo-document-picker');
              const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
              if (!result.canceled && result.assets?.[0]) {
                const doc = result.assets[0];
                sendPickedMedia(doc.uri, doc.name, doc.mimeType || 'application/octet-stream', doc.size);
              }
            } catch {}
          },
        },
        {
          text: t('common.cancel', 'Cancel'),
          style: 'cancel',
        },
      ],
      { cancelable: true },
    );
  }, [t, sendPickedMedia]);

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

            <Pressable style={styles.headerProfile}>
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
                  leadingIcon="star-outline"
                  onPress={() => setMenuVisible(false)}
                  title={t('chats.starredMessages')}
                />
                <Menu.Item
                  leadingIcon="magnify"
                  onPress={() => setMenuVisible(false)}
                  title={t(
                    'chats.searchPlaceholder',
                  )}
                />
                <Menu.Item
                  leadingIcon="lightning-bolt"
                  onPress={() => setMenuVisible(false)}
                  title={t('chats.quickMessages')}
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
        ) : (
          <ChatInput
            onSend={handleSend}
            onAttachmentPress={handleAttachment}
            isInternalNote={isInternalNote}
            onToggleInternalNote={() =>
              setIsInternalNote((v) => !v)
            }
            onQuickMessagePress={() => {}}
            isSending={isSending}
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
                  keyExtractor={(item) =>
                    item.id || item.templateId || item.name
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
                {/* Using a simple approach: text inputs for date and time */}
                <Text
                  variant="labelMedium"
                  style={{
                    color: theme.colors.onSurfaceVariant,
                    marginTop: 12,
                    marginBottom: 6,
                  }}
                >
                  {t('chats.pickDateTime')}
                </Text>
                <View
                  style={{
                    flexDirection: isRTL ? 'row-reverse' : 'row',
                    gap: 10,
                  }}
                >
                  <View
                    style={[
                      styles.scheduleInput,
                      {
                        flex: 1,
                        borderColor: theme.dark
                          ? 'rgba(255,255,255,0.15)'
                          : '#d1d5db',
                        backgroundColor: theme.dark
                          ? 'rgba(255,255,255,0.05)'
                          : '#f9fafb',
                        flexDirection: isRTL
                          ? 'row-reverse'
                          : 'row',
                        alignItems: 'center',
                        gap: 6,
                        paddingHorizontal: 10,
                      },
                    ]}
                  >
                    <MaterialCommunityIcons
                      name="calendar"
                      size={18}
                      color={theme.colors.onSurfaceVariant}
                    />
                    <TextInput
                      value={scheduleDate}
                      onChangeText={setScheduleDate}
                      placeholder="YYYY-MM-DD"
                      placeholderTextColor={theme.colors.onSurfaceVariant}
                      style={{
                        flex: 1,
                        color: theme.colors.onSurface,
                        fontSize: 14,
                        paddingVertical: 8,
                      }}
                      keyboardType="numbers-and-punctuation"
                    />
                  </View>
                  <View
                    style={[
                      styles.scheduleInput,
                      {
                        flex: 1,
                        borderColor: theme.dark
                          ? 'rgba(255,255,255,0.15)'
                          : '#d1d5db',
                        backgroundColor: theme.dark
                          ? 'rgba(255,255,255,0.05)'
                          : '#f9fafb',
                        flexDirection: isRTL
                          ? 'row-reverse'
                          : 'row',
                        alignItems: 'center',
                        gap: 6,
                        paddingHorizontal: 10,
                      },
                    ]}
                  >
                    <MaterialCommunityIcons
                      name="clock-outline"
                      size={18}
                      color={theme.colors.onSurfaceVariant}
                    />
                    <TextInput
                      value={scheduleTime}
                      onChangeText={setScheduleTime}
                      placeholder="HH:MM"
                      placeholderTextColor={theme.colors.onSurfaceVariant}
                      style={{
                        flex: 1,
                        color: theme.colors.onSurface,
                        fontSize: 14,
                        paddingVertical: 8,
                      }}
                      keyboardType="numbers-and-punctuation"
                    />
                  </View>
                </View>
                <Text
                  variant="bodySmall"
                  style={{
                    color: theme.colors.onSurfaceVariant,
                    marginTop: 8,
                    fontStyle: 'italic',
                  }}
                >
                  {t('chats.scheduleNote')}
                </Text>
                <Pressable
                  onPress={handleScheduleSubmit}
                  style={({ pressed }) => [
                    styles.scheduleSubmitBtn,
                    {
                      backgroundColor: pressed
                        ? '#1a7a5e'
                        : '#25D366',
                      opacity:
                        !scheduleText.trim() ||
                        !scheduleDate ||
                        !scheduleTime
                          ? 0.5
                          : 1,
                    },
                  ]}
                  disabled={
                    !scheduleText.trim() ||
                    !scheduleDate ||
                    !scheduleTime
                  }
                >
                  <MaterialCommunityIcons
                    name="clock-check-outline"
                    size={20}
                    color="#fff"
                  />
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
                onPress={() =>
                  setSelectedMessage(null)
                }
                style={({ pressed }) => [
                  styles.actionItem,
                  pressed && {
                    backgroundColor:
                      theme.colors.surfaceVariant,
                  },
                ]}
              >
                <MaterialCommunityIcons
                  name="reply"
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
                  {t('chats.reply', 'Reply')}
                </Text>
              </Pressable>
            </View>
          </Pressable>
        </Modal>
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
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    gap: 12,
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
});
