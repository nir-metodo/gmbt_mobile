import React, { memo, useCallback, useState, useRef, useEffect } from 'react';
import { View, StyleSheet, Pressable, Dimensions, I18nManager, Modal, ActivityIndicator, Linking } from 'react-native';
import { Image } from 'expo-image';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Audio, Video, ResizeMode } from 'expo-av';
import * as Haptics from 'expo-haptics';
import * as WebBrowser from 'expo-web-browser';
import { useTranslation } from 'react-i18next';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import type { Message, WabaNumberInfo } from '../../types';
import type { AppTheme } from '../../constants/theme';
import { formatMessageTime } from '../../utils/formatters';
import { useCachedMedia } from '../../hooks/useCachedMedia';
import type { MediaType } from '../../services/mediaCache';

const SCREEN_WIDTH = Dimensions.get('window').width;
const MAX_BUBBLE_WIDTH = SCREEN_WIDTH * 0.78;
const MEDIA_WIDTH = MAX_BUBBLE_WIDTH - 18;
const STICKER_SIZE = SCREEN_WIDTH * 0.38;

const templateFetchCache = new Map<string, any>();
// Session cache of resolved voice-note durations (keyed by media URL). FlashList recycles bubbles
// constantly while scrolling, and without this every recycle of an audio row would spin up a native
// Audio.Sound just to read its duration — heavy bridge work that stutters scrolling in voice-heavy
// chats. Resolve each URL once, then reuse.
const audioDurationCache = new Map<string, number>();

function renderFormattedText(text: string, color: string): React.ReactNode[] {
  const segments: React.ReactNode[] = [];
  const pattern = /(\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~|```[^`]+```|`[^`\n]+`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push(text.slice(lastIndex, match.index));
    }
    const raw = match[0];
    if (raw.startsWith('```') && raw.endsWith('```')) {
      segments.push(
        <Text key={match.index} style={{ fontFamily: 'monospace', fontSize: 13, backgroundColor: 'rgba(0,0,0,0.06)', color }}>
          {raw.slice(3, -3)}
        </Text>
      );
    } else if (raw.startsWith('`') && raw.endsWith('`')) {
      segments.push(
        <Text key={match.index} style={{ fontFamily: 'monospace', fontSize: 13, backgroundColor: 'rgba(0,0,0,0.06)', color }}>
          {raw.slice(1, -1)}
        </Text>
      );
    } else if (raw.startsWith('*') && raw.endsWith('*')) {
      segments.push(<Text key={match.index} style={{ fontWeight: '700', color }}>{raw.slice(1, -1)}</Text>);
    } else if (raw.startsWith('_') && raw.endsWith('_')) {
      segments.push(<Text key={match.index} style={{ fontStyle: 'italic', color }}>{raw.slice(1, -1)}</Text>);
    } else if (raw.startsWith('~') && raw.endsWith('~')) {
      segments.push(<Text key={match.index} style={{ textDecorationLine: 'line-through', color }}>{raw.slice(1, -1)}</Text>);
    }
    lastIndex = match.index + raw.length;
  }
  if (lastIndex < text.length) {
    segments.push(text.slice(lastIndex));
  }
  return segments;
}

interface MessageBubbleProps {
  message: Message;
  isOutbound: boolean;
  showTail: boolean;
  theme: AppTheme;
  organization?: string;
  onLongPress?: (message: Message) => void;
  onMediaPress?: (message: Message) => void;
  onQuotedPress?: (contextMessageId: string) => void;
  onSwipeToReply?: (message: Message) => void;
  wabaNumbers?: WabaNumberInfo[];
  onCancelScheduled?: (scheduledMessageId: string) => void;
}

const SWIPE_THRESHOLD = 60;

function MessageBubbleInner({
  message,
  isOutbound,
  showTail,
  theme,
  organization,
  onLongPress,
  onMediaPress,
  onQuotedPress,
  onSwipeToReply,
  wabaNumbers,
  onCancelScheduled,
}: MessageBubbleProps) {
  const { t } = useTranslation();
  const isInternal = message.type === 'internal';
  const isDark = theme.dark;

  const m = message as any;
  const isScheduled =
    m.isScheduledMessage === true ||
    m.status === 'scheduled' ||
    (!m.isStarred && !!(m.scheduledFor || m.scheduledDateTime) && m.status !== 'sent' && m.status !== 'delivered' && m.status !== 'read');
  const scheduledForRaw = m.scheduledFor || m.sendAt || m.scheduledTime || m.scheduledDateTime;
  const scheduledMessageId = m.scheduledMessageId || m.scheduledId || m.id || m.messageId;
  const formatScheduledTime = (val: any): string => {
    if (!val) return '';
    let d: Date;
    if (typeof val === 'object' && (val._seconds || val.seconds)) {
      d = new Date((val._seconds || val.seconds) * 1000);
    } else {
      d = new Date(val);
    }
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString([], { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  };

  const [imageViewerVisible, setImageViewerVisible] = useState(false);
  const [videoFullscreen, setVideoFullscreen] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [audioDuration, setAudioDuration] = useState(0);
  const [audioPosition, setAudioPosition] = useState(0);
  const audioRef = useRef<Audio.Sound | null>(null);
  const durationLoaded = useRef(false);

  const translateX = useSharedValue(0);
  const swipeTriggered = useRef(false);

  const triggerReply = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onSwipeToReply?.(message);
  }, [message, onSwipeToReply]);

  const isRTL = I18nManager.isRTL;
  const swipeDirection = isRTL ? -1 : 1;

  const panGesture = Gesture.Pan()
    .activeOffsetX([-20, 20])
    .failOffsetY([-10, 10])
    .runOnJS(true)
    .onUpdate((e) => {
      const tx = e.translationX * swipeDirection;
      if (tx > 0) {
        translateX.value = Math.min(tx * 0.6, 80);
        if (tx > SWIPE_THRESHOLD && !swipeTriggered.current) {
          swipeTriggered.current = true;
          triggerReply();
        }
      }
    })
    .onEnd(() => {
      translateX.value = withSpring(0, { damping: 20, stiffness: 200 });
      swipeTriggered.current = false;
    });

  const longPressGesture = Gesture.LongPress()
    .minDuration(300)
    .runOnJS(true)
    .onStart(() => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      onLongPress?.(message);
    });

  const composedGesture = Gesture.Race(longPressGesture, panGesture);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value * swipeDirection }],
  }));

  const replyIconStyle = useAnimatedStyle(() => ({
    opacity: Math.min(translateX.value / SWIPE_THRESHOLD, 1),
    transform: [{ scale: Math.min(translateX.value / SWIPE_THRESHOLD, 1) }],
  }));

  // Long press is handled via composedGesture (Gesture.LongPress + Gesture.Pan)

  // Pre-load audio duration from message metadata or by loading the file header
  useEffect(() => {
    if (durationLoaded.current) return;
    const rawMsg = message as any;
    const metaDuration = rawMsg.audioDuration || rawMsg.duration || rawMsg.mediaDuration;
    if (metaDuration && Number(metaDuration) > 0) {
      setAudioDuration(Number(metaDuration) * (Number(metaDuration) < 600 ? 1000 : 1));
      durationLoaded.current = true;
      return;
    }
    const url = (rawMsg.gmbt_mediaUrl || message.mediaUrl || message.MediaUrl || message.media_url);
    const msgType = (message.type || message.messageType || '').toLowerCase();
    if (!url || (msgType !== 'audio' && !msgType.startsWith('audio/'))) return;
    // Already resolved this URL earlier this session → reuse, skip the native load entirely.
    const cachedDuration = audioDurationCache.get(url);
    if (cachedDuration && cachedDuration > 0) {
      setAudioDuration(cachedDuration);
      durationLoaded.current = true;
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { sound, status } = await Audio.Sound.createAsync(
          { uri: url },
          { shouldPlay: false },
        );
        if (!cancelled && status.isLoaded && status.durationMillis) {
          audioDurationCache.set(url, status.durationMillis);
          setAudioDuration(status.durationMillis);
          durationLoaded.current = true;
        }
        await sound.unloadAsync();
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [message]);

  // Fetch template data by templateId if not already available in templateConfig
  const [fetchedTemplateData, setFetchedTemplateData] = useState<any>(null);
  const [fetchedMediaUrl, setFetchedMediaUrl] = useState<string>('');

  // FlashList recycles this component instance to render different messages. Local UI state
  // (broken-image flag, fetched template data, audio/play state) would otherwise carry over
  // to the next message — showing a broken placeholder on a valid image, a stale template,
  // or a wrong audio duration. Reset it synchronously when the underlying message changes.
  const currentMessageId = message.messageId || (message as any).id || '';
  const prevMessageIdRef = useRef(currentMessageId);
  if (prevMessageIdRef.current !== currentMessageId) {
    prevMessageIdRef.current = currentMessageId;
    setImageError(false);
    setImageViewerVisible(false);
    setVideoFullscreen(false);
    setAudioPlaying(false);
    setAudioPosition(0);
    setAudioDuration(0);
    setFetchedTemplateData(null);
    setFetchedMediaUrl('');
    durationLoaded.current = false;
  }

  // Release any playing voice note when the row is recycled to another message or unmounts,
  // so audio never keeps playing in the background after scrolling away.
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.unloadAsync().catch(() => {});
        audioRef.current = null;
      }
    };
  }, [currentMessageId]);

  useEffect(() => {
    const msgType = (message.type || (message as any).messageType || '').toLowerCase();
    if (msgType !== 'template') return;
    const templateId = (message as any).templateId || (message as any).TemplateId;
    if (!templateId) return;
    const rawConfig = (message as any).templateConfig;
    const tpl = rawConfig?.template || rawConfig;
    const components = tpl?.components || rawConfig?.components || [];

    let cancelled = false;
    const org = organization || (message as any).organization || (message as any).Organization || '';
    if (!org) return;

    // A URL we can display right now (never a raw Meta "4::" header_handle).
    const isHttp = (u: any) => typeof u === 'string' && /^https?:\/\//i.test(u);
    const knownUrl =
      (isHttp(rawConfig?.header?.mediaUrl) && rawConfig.header.mediaUrl) ||
      (isHttp((message as any).gmbt_mediaUrl) && (message as any).gmbt_mediaUrl) ||
      (isHttp(message.mediaUrl) && message.mediaUrl) ||
      (isHttp((message as any).MediaUrl) && (message as any).MediaUrl) ||
      '';

    const headerFromConfig = Array.isArray(components) ? components.find((c: any) => c.type === 'HEADER') : null;
    const headerFmtConfig = (headerFromConfig?.format || '').toUpperCase();
    const headerIsMediaConfig = headerFmtConfig === 'IMAGE' || headerFmtConfig === 'VIDEO' || headerFmtConfig === 'DOCUMENT';

    (async () => {
      try {
        const { chatsApi } = await import('../../services/api/chats');
        const cacheKey = `${org}_${templateId}`;

        // Resolve the header media to a real https URL via the API. Needed even when the message
        // already carries templateConfig.components (web-optimistic sends) — those components only
        // contain a Meta header_handle ("4::..."), which is NOT displayable. Mirrors the web app.
        const resolveMedia = async () => {
          if (knownUrl) { if (!cancelled) setFetchedMediaUrl(knownUrl); return; }
          const mediaCacheKey = `${cacheKey}_media`;
          const cachedMedia = templateFetchCache.get(mediaCacheKey);
          if (cachedMedia) { if (!cancelled) setFetchedMediaUrl(cachedMedia); return; }
          const url = await chatsApi.getMediaByTemplateId(org, templateId);
          if (url && !cancelled) {
            templateFetchCache.set(mediaCacheKey, url);
            setFetchedMediaUrl(url);
          }
        };

        // Case 1: message already has component definitions — only the header media needs resolving.
        if (Array.isArray(components) && components.length > 0) {
          if (headerIsMediaConfig) await resolveMedia();
          return;
        }

        // Case 2: no components on the message → fetch the full template definition (for
        // body/footer/buttons), then resolve header media if the header is a media type.
        const cached = templateFetchCache.get(cacheKey);
        const template = cached || await chatsApi.getTemplateById(org, templateId);
        if (!template || cancelled) return;
        if (!cached) templateFetchCache.set(cacheKey, template);
        setFetchedTemplateData(template);
        const header = template.components?.find((c: any) => c.type === 'HEADER');
        const hf = (header?.format || '').toUpperCase();
        if (hf === 'IMAGE' || hf === 'VIDEO' || hf === 'DOCUMENT') await resolveMedia();
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [(message as any).templateId, message.type, (message as any).messageType, organization]);

  const bubbleColor = isInternal
    ? isDark ? '#3E3500' : '#FFF9C4'
    : isOutbound
      ? isDark ? '#005c4b' : '#dcf8c6'
      : isDark ? '#202c33' : '#FFFFFF';

  const textColor = isInternal
    ? isDark ? '#FFE082' : '#5D4037'
    : isDark ? '#e2e8f0' : '#111b21';

  const timeColor = isInternal
    ? isDark ? '#BCAA5A' : '#8D6E63'
    : isDark ? '#8696a0' : '#667781';

  const displaySenderName = (() => {
    if (isInternal) return message.createdByName || message.sentByName || message.senderName || 'Internal';
    if (isOutbound) {
      const name = message.sentByName || (message as any).createdByName || '';
      if (message.sentFromApp) return name ? `${name} · APP` : 'APP';
      if ((message as any).gambotAiModelId) return name ? `${name} · AI` : 'Gambot AI';
      return name || null;
    }
    return message.senderName || message.sentByName || message.from || null;
  })();

  const isSentFromApp = isOutbound && message.sentFromApp === true;

  const renderStatus = () => {
    if (!isOutbound || isInternal) return null;
    const size = 14;
    switch (message.status) {
      case 'pending':
        return <MaterialCommunityIcons name="clock-outline" size={size} color={timeColor} />;
      case 'sent':
        return <MaterialCommunityIcons name="check" size={size} color={isDark ? '#8696a0' : '#9ca3af'} />;
      case 'delivered':
        return <MaterialCommunityIcons name="check-all" size={size} color={isDark ? '#8696a0' : '#9ca3af'} />;
      case 'read':
        return <MaterialCommunityIcons name="check-all" size={size} color="#53bdeb" />;
      case 'failed':
        return <MaterialCommunityIcons name="alert-circle-outline" size={size} color="#ef4444" />;
      default:
        return null;
    }
  };

  const mediaUrl = (message as any).gmbt_mediaUrl || message.mediaUrl || message.MediaUrl || message.media_url;
  const videoPoster = (message as any).thumbnailUrl || (message as any).ThumbnailUrl || (message as any).thumbnail || (message as any).previewUrl || undefined;
  const rawType = (message.type || message.messageType || '') as string;
  const DOC_EXTS = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv', 'zip', 'rtf'];
  const resolvedType = (() => {
    const t = rawType.toLowerCase();
    if (t === 'image' || t.startsWith('image/')) return 'image';
    if (t === 'video' || t.startsWith('video/')) return 'video';
    if (t === 'audio' || t.startsWith('audio/')) return 'audio';
    if (t === 'document' || t.startsWith('application/') || t === 'file') return 'document';
    if (t === 'sticker') return 'image';
    if ((t === 'media' || t === 'text' || t === '') && mediaUrl) {
      const ext = (mediaUrl.split('?')[0].split('.').pop() || '').toLowerCase();
      if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic'].includes(ext)) return 'image';
      if (['mp4', 'mov', 'avi', 'webm', '3gp'].includes(ext)) return 'video';
      if (['mp3', 'ogg', 'opus', 'wav', 'aac', 'm4a', 'amr'].includes(ext)) return 'audio';
      if (DOC_EXTS.includes(ext)) return 'document';
      // mediaType hint — PDFs/office docs sent from the app or campaigns often arrive as
      // type:"media" with mediaType:"application/pdf" and NO extension on the URL. Without this
      // they fell through to the image default and rendered as a broken image ("can't see it").
      const mt = (message.mediaType || '').toLowerCase();
      if (mt.startsWith('image')) return 'image';
      if (mt.startsWith('video')) return 'video';
      if (mt.startsWith('audio')) return 'audio';
      if (mt.startsWith('application') || mt.includes('pdf') || mt.includes('document') || mt === 'file') return 'document';
      // fileName extension hint (the URL may be a signed link with no extension).
      const fext = ((message.fileName || '').split('.').pop() || '').toLowerCase();
      if (DOC_EXTS.includes(fext)) return 'document';
      // A named attachment with no image/video/audio hint is far more likely a document.
      if (message.fileName) return 'document';
      return 'image';
    }
    return t;
  })();
  const msgType = resolvedType as MediaType | string;
  const cacheType: MediaType = (['image', 'video', 'audio', 'document'].includes(msgType) ? msgType : 'image') as MediaType;
  const { uri: cachedMediaUri, isLoading: mediaLoading } = useCachedMedia(mediaUrl, cacheType);
  const effectiveMediaUrl = cachedMediaUri || mediaUrl;

  // Audio playback
  const handleAudioPlay = useCallback(async () => {
    if (!effectiveMediaUrl) return;
    try {
      if (audioRef.current) {
        if (audioPlaying) {
          await audioRef.current.pauseAsync();
          setAudioPlaying(false);
        } else {
          await audioRef.current.playAsync();
          setAudioPlaying(true);
        }
        return;
      }
      await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
      const { sound } = await Audio.Sound.createAsync(
        { uri: effectiveMediaUrl },
        { shouldPlay: true },
        (status) => {
          if (status.isLoaded) {
            setAudioPosition(status.positionMillis || 0);
            setAudioDuration(status.durationMillis || 0);
            if (status.didJustFinish) {
              setAudioPlaying(false);
              setAudioPosition(0);
              audioRef.current?.setPositionAsync(0);
            }
          }
        }
      );
      audioRef.current = sound;
      setAudioPlaying(true);
    } catch (err) {
      console.error('[Audio] playback error:', err);
    }
  }, [effectiveMediaUrl, audioPlaying]);

  const renderMedia = () => {
    switch (msgType) {
      case 'image':
        if (mediaUrl && !imageError) {
          const imageSource = effectiveMediaUrl || mediaUrl;
          return (
            <>
              <Pressable onPress={() => onMediaPress ? onMediaPress(message) : setImageViewerVisible(true)}>
                <View style={{ position: 'relative' }}>
                  <Image
                    source={{ uri: imageSource }}
                    style={styles.mediaImage}
                    contentFit="cover"
                    cachePolicy="disk"
                    recyclingKey={mediaUrl}
                    onError={() => setImageError(true)}
                  />
                  {mediaLoading && (
                    <View style={[styles.mediaPlaceholder, { position: 'absolute', top: 0, left: 0, backgroundColor: isDark ? 'rgba(0,0,0,0.4)' : 'rgba(255,255,255,0.4)' }]}>
                      <ActivityIndicator size="small" color={theme.colors.primary} />
                    </View>
                  )}
                </View>
              </Pressable>
              {!onMediaPress && (
                <Modal visible={imageViewerVisible} transparent animationType="fade" onRequestClose={() => setImageViewerVisible(false)}>
                  <View style={styles.imageViewerOverlay}>
                    <Pressable style={styles.imageViewerClose} onPress={() => setImageViewerVisible(false)}>
                      <MaterialCommunityIcons name="close" size={28} color="#fff" />
                    </Pressable>
                    <Image
                      source={{ uri: imageSource }}
                      style={styles.imageViewerImage}
                      contentFit="contain"
                      cachePolicy="disk"
                    />
                  </View>
                </Modal>
              )}
            </>
          );
        }
        return (
          <View style={[styles.mediaPlaceholder, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)' }]}>
            <MaterialCommunityIcons name="image" size={40} color={theme.colors.onSurfaceVariant} />
          </View>
        );

      case 'video':
        if (mediaUrl) {
          const videoSource = effectiveMediaUrl || mediaUrl;
          return (
            <>
              {/* Lightweight poster in the list row (tap to play). Mounting a live <Video>
                  with native controls in every recycled FlashList row caused flicker and
                  blank frames when scrolling chats with many videos. */}
              <Pressable onPress={() => onMediaPress ? onMediaPress(message) : setVideoFullscreen(true)} style={styles.videoThumb}>
                <View style={[styles.mediaPlaceholder, { backgroundColor: isDark ? '#111' : '#000' }]}>
                  {videoPoster ? (
                    <Image
                      source={{ uri: videoPoster }}
                      style={{ width: MEDIA_WIDTH, height: 180, borderRadius: 8 }}
                      contentFit="cover"
                      cachePolicy="disk"
                      recyclingKey={mediaUrl}
                    />
                  ) : null}
                  <View style={{ position: 'absolute', alignItems: 'center', justifyContent: 'center' }}>
                    {mediaLoading ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <MaterialCommunityIcons name="play-circle" size={52} color="rgba(255,255,255,0.92)" />
                    )}
                  </View>
                </View>
              </Pressable>
              {!onMediaPress && (
                <Modal visible={videoFullscreen} transparent animationType="fade" onRequestClose={() => setVideoFullscreen(false)}>
                  <View style={styles.imageViewerOverlay}>
                    <Pressable style={styles.imageViewerClose} onPress={() => setVideoFullscreen(false)}>
                      <MaterialCommunityIcons name="close" size={28} color="#fff" />
                    </Pressable>
                    <Video
                      source={{ uri: videoSource }}
                      style={{ width: '100%', height: '80%' }}
                      resizeMode={ResizeMode.CONTAIN}
                      useNativeControls
                      shouldPlay
                    />
                  </View>
                </Modal>
              )}
            </>
          );
        }
        return (
          <View style={[styles.mediaPlaceholder, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)' }]}>
            <MaterialCommunityIcons name="play-circle-outline" size={44} color={theme.colors.onSurfaceVariant} />
          </View>
        );

      case 'document': {
        const docName = message.fileName || t('chats.attachFile');
        const docExt = (docName.split('.').pop() || '').toLowerCase();
        const urlExt = (mediaUrl ? (mediaUrl.split('?')[0].split('.').pop() || '') : '').toLowerCase();
        const mt = (message.mediaType || '').toLowerCase();
        const isPdf = docExt === 'pdf' || urlExt === 'pdf' || mt.includes('pdf');
        const isWord = ['doc', 'docx'].includes(docExt) || mt.includes('word');
        const isExcel = ['xls', 'xlsx', 'csv'].includes(docExt) || mt.includes('sheet') || mt.includes('excel');
        const docIcon = isPdf ? 'file-pdf-box' : isWord ? 'file-word-box' : isExcel ? 'file-excel-box' : 'file-document-outline';
        const docIconColor = isPdf ? '#e53935' : isWord ? '#2563eb' : isExcel ? '#16a34a' : theme.colors.primary;
        const docSubtitle = isPdf ? 'PDF' : (docExt ? docExt.toUpperCase() : 'DOC');
        const openDoc = () => {
          const url = effectiveMediaUrl || mediaUrl;
          if (url) {
            WebBrowser.openBrowserAsync(url, { presentationStyle: WebBrowser.WebBrowserPresentationStyle.FULL_SCREEN }).catch(() => {
              Linking.openURL(url).catch(() => {});
            });
          }
        };
        return (
          <Pressable onPress={openDoc} disabled={(!effectiveMediaUrl && !mediaUrl) || mediaLoading}>
            <View style={[styles.docContainer, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : '#f0f4f0' }]}>
              <View style={styles.docIconWrap}>
                <MaterialCommunityIcons name={docIcon as any} size={26} color={docIconColor} />
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="bodySmall" numberOfLines={1} style={{ color: textColor, fontWeight: '600' }}>
                  {docName}
                </Text>
                <Text variant="labelSmall" style={{ color: timeColor, marginTop: 1 }}>
                  {mediaLoading ? t('chats.downloading', 'מוריד...') : `${docSubtitle} · ${t('chats.tapToOpen', isRTL ? 'הקש לפתיחה' : 'Tap to open')}`}
                </Text>
              </View>
              {mediaLoading ? (
                <ActivityIndicator size="small" color={theme.colors.primary} />
              ) : (
                <MaterialCommunityIcons name="open-in-new" size={20} color={theme.colors.primary} />
              )}
            </View>
          </Pressable>
        );
      }

      case 'audio':
        const progress = audioDuration > 0 ? audioPosition / audioDuration : 0;
        const durationSec = Math.round((audioDuration || 0) / 1000);
        const positionSec = Math.round(audioPosition / 1000);
        const formatSec = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
        const waveColor = isOutbound ? (isDark ? '#b4dfc9' : '#075e54') : (isDark ? '#8696a0' : '#2e6155');
        const waveActiveColor = isOutbound ? '#25D366' : '#2e6155';
        const WAVE_BARS = 28;
        return (
          <View style={styles.audioContainer}>
            <Pressable onPress={handleAudioPlay} disabled={mediaLoading} style={[styles.audioPlayBtn, { backgroundColor: isOutbound ? '#075e54' : '#2e6155' }]}>
              {mediaLoading ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <MaterialCommunityIcons
                  name={audioPlaying ? 'pause' : 'play'}
                  size={22}
                  color="#fff"
                />
              )}
            </Pressable>
            <View style={styles.audioTrackWrap}>
              <View style={styles.waveformRow}>
                {Array.from({ length: WAVE_BARS }).map((_, i) => {
                  const barProgress = i / WAVE_BARS;
                  const isActive = barProgress < progress;
                  const heights = [4, 7, 12, 8, 15, 10, 6, 14, 9, 5, 11, 16, 7, 13, 8, 4, 10, 15, 6, 12, 9, 7, 14, 5, 11, 8, 13, 6];
                  const h = heights[i % heights.length];
                  return (
                    <View
                      key={i}
                      style={{
                        width: 3,
                        height: h,
                        borderRadius: 1.5,
                        backgroundColor: isActive ? waveActiveColor : (isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.15)'),
                      }}
                    />
                  );
                })}
              </View>
              <Text style={[styles.audioDuration, { color: timeColor }]}>
                {audioPlaying ? formatSec(positionSec) : (durationSec > 0 ? formatSec(durationSec) : '···')}
              </Text>
            </View>
          </View>
        );

      default:
        return null;
    }
  };

  const renderTemplate = () => {
    const rawConfig = message.templateConfig;
    const tpl = rawConfig?.template || rawConfig;
    // Use fetchedTemplateData as fallback if rawConfig has no components
    const configComponents: any[] = tpl?.components || rawConfig?.components || [];
    const components: any[] = configComponents.length > 0 ? configComponents : (fetchedTemplateData?.components || []);

    const headerComp = components.find((c: any) => c.type === 'HEADER');
    const bodyComp = components.find((c: any) => c.type === 'BODY');
    const footerComp = components.find((c: any) => c.type === 'FOOTER');
    const buttonsComp = components.find((c: any) => c.type === 'BUTTONS');

    const bodyText = message.text || message.body || bodyComp?.text || rawConfig?.body?.text || tpl?.body || fetchedTemplateData?.body || '';
    if (!rawConfig && !message.templateName && !bodyText && !fetchedTemplateData) return null;

    // ⚠️ A template HEADER's example.header_handle is usually a Meta resumable-upload handle
    // ("4::...") — NOT a displayable URL. Using it directly is exactly why media was missing on
    // mobile. Prefer real https URLs (resolved via GetMediaByTemplateId → fetchedMediaUrl, the
    // config's header.mediaUrl, or the message's own mediaUrl). Only fall back to header_handle
    // if it happens to already be an http(s) URL. This mirrors the web app + backend Waba.cs.
    const isHttpUrl = (u: any) => typeof u === 'string' && /^https?:\/\//i.test(u);
    const rawHandle = headerComp?.example?.header_handle?.[0];
    const headerMedia =
      (isHttpUrl(rawConfig?.header?.mediaUrl) ? rawConfig.header.mediaUrl : '') ||
      (fetchedMediaUrl || '') ||
      (isHttpUrl(mediaUrl) ? mediaUrl : '') ||
      (isHttpUrl(rawHandle) ? rawHandle : '');
    const headerType = (headerComp?.format || headerComp?.type || rawConfig?.header?.type || rawConfig?.header?.format || '').toUpperCase();
    const footerText = footerComp?.text || rawConfig?.footer?.text || rawConfig?.footer || '';
    const buttons = buttonsComp?.buttons || rawConfig?.buttons || [];

    return (
      <View style={[styles.templateContainer, {
        backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.98)',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: isDark ? 0.3 : 0.08,
        shadowRadius: 8,
        elevation: 3,
        borderWidth: isDark ? 0 : 1,
        borderColor: 'rgba(226,232,240,0.5)',
      }]}>
        {message.templateName && (
          <View style={styles.templateBadge}>
            <MaterialCommunityIcons name="file-document-outline" size={13} color={isDark ? '#4ade80' : '#047857'} />
            <Text style={[styles.templateBadgeText, { color: isDark ? '#4ade80' : '#047857' }]}>
              {message.templateName}
            </Text>
          </View>
        )}
        {headerType === 'IMAGE' && headerMedia && (
          <Pressable onPress={() => setImageViewerVisible(true)}>
            <Image
              source={{ uri: headerMedia }}
              style={styles.templateHeaderImage}
              contentFit="cover"
              cachePolicy="disk"
            />
          </Pressable>
        )}
        {headerType === 'VIDEO' && headerMedia && (
          <Video
            source={{ uri: headerMedia }}
            style={styles.templateHeaderVideo}
            resizeMode={ResizeMode.CONTAIN}
            useNativeControls
          />
        )}
        {headerType === 'DOCUMENT' && headerMedia && (
          <Pressable onPress={() => headerMedia && Linking.openURL(headerMedia).catch(() => {})}>
            <View style={[styles.docContainer, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : '#f0f4f0' }]}>
              <MaterialCommunityIcons name="file-document-outline" size={22} color={theme.colors.primary} />
              <Text style={{ color: textColor, fontSize: 13, flex: 1 }}>{message.fileName || 'Document'}</Text>
              <MaterialCommunityIcons name="download" size={18} color={theme.colors.primary} />
            </View>
          </Pressable>
        )}
        {bodyText ? (
          <Text style={[styles.templateBody, { color: isDark ? '#e2e8f0' : '#374151' }]}>
            {renderFormattedText(bodyText.replace(/\\n/g, '\n'), isDark ? '#e2e8f0' : '#374151')}
          </Text>
        ) : null}
        {footerText ? (
          <Text style={[styles.templateFooter, { color: isDark ? '#8696a0' : '#64748b' }]}>
            {typeof footerText === 'string' ? footerText : ''}
          </Text>
        ) : null}
        {buttons.length > 0 && (
          <View style={styles.templateButtons}>
            {buttons.map((btn: any, idx: number) => (
              <Pressable
                key={idx}
                onPress={() => {
                  if (btn.type === 'URL' && btn.url) {
                    WebBrowser.openBrowserAsync(btn.url).catch(() => {});
                  } else if (btn.type === 'PHONE_NUMBER' && btn.phone_number) {
                    Linking.openURL(`tel:${btn.phone_number}`).catch(() => {});
                  }
                }}
                style={({ pressed }) => [
                  styles.templateButton,
                  {
                    backgroundColor: isDark
                      ? pressed ? 'rgba(46,97,85,0.5)' : 'rgba(46,97,85,0.3)'
                      : pressed ? '#1d5549' : '#2e6155',
                  },
                ]}
              >
                <Text style={styles.templateButtonText}>
                  {btn.type === 'URL' ? '🔗 ' : btn.type === 'PHONE_NUMBER' ? '📞 ' : '↩ '}
                  {btn.text || btn.label || ''}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>
    );
  };

  const renderWabaNumberBadge = () => {
    if (!wabaNumbers || wabaNumbers.length <= 1) return null;
    const fromId = (message as any).fromNumberId;
    const msgFrom = message.from;
    const msgTo = message.to;

    const ourNumberField = isOutbound ? msgFrom : msgTo;

    let match: WabaNumberInfo | undefined;
    if (fromId) {
      match = wabaNumbers.find(n => (n.PhoneNumberId || n.phoneNumberId) === fromId);
    }
    if (!match && ourNumberField) {
      const norm = ourNumberField.replace(/[\s\-+]/g, '');
      match = wabaNumbers.find(n => {
        const d = (n.DisplayNumber || n.displayNumber || '').replace(/[\s\-+]/g, '');
        return d && (d === norm || norm.endsWith(d) || d.endsWith(norm));
      });
    }
    if (!match) return null;

    const display = match.Label || match.label || match.DisplayNumber || match.displayNumber || '';
    const numColor = match.Color || match.color || '';
    if (!display) return null;

    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
        <MaterialCommunityIcons name={isOutbound ? 'arrow-left' : 'arrow-right'} size={10} color={numColor || (isDark ? '#8696a0' : '#6b7280')} />
        <Text style={[styles.wabaBadge, { color: numColor || (isDark ? '#8696a0' : '#6b7280') }]}>
          {display}
        </Text>
      </View>
    );
  };

  const renderLinkedText = (text: string, _color: string) => {
    // Match: http(s)://, www., or domain patterns like bit.ly/x, example.com/path
    const urlPattern = /(https?:\/\/[^\s<>]+|www\.[^\s<>]+|[a-zA-Z0-9][-a-zA-Z0-9]*\.[a-zA-Z]{2,}(?:\/[^\s<>]*)?)/gi;
    const parts = text.split(urlPattern);
    if (parts.length === 1) {
      return renderFormattedText(text, _color);
    }

    return parts.map((part, index) => {
      if (index % 2 === 1) {
        // Validate it looks like a real URL (has a known TLD or path)
        const hasPath = part.includes('/');
        const hasTLD = /\.(com|co\.il|net|org|io|dev|app|me|info|biz|ly|gl|link|il|uk|de|fr|ai|cc|tv|co|xyz|shop|store|online)(\b|\/|$)/i.test(part);
        if (!part.startsWith('http') && !part.startsWith('www.') && !hasPath && !hasTLD) {
          const formatted = renderFormattedText(part, _color);
          return formatted.length === 1 && typeof formatted[0] === 'string' ? formatted[0] : <Text key={index}>{formatted}</Text>;
        }
        // Strip trailing punctuation that's not part of the URL
        let cleanUrl = part.replace(/[.,;:!?)\]}>]+$/, '');
        const trailingChars = part.slice(cleanUrl.length);
        const href = cleanUrl.startsWith('http') ? cleanUrl : `https://${cleanUrl}`;
        return (
          <React.Fragment key={index}>
            <Text
              style={{ color: '#1a73e8', textDecorationLine: 'underline' }}
              onPress={() => Linking.openURL(href).catch(() => {})}
            >
              {cleanUrl}
            </Text>
            {trailingChars ? <Text style={{ color: _color }}>{trailingChars}</Text> : null}
          </React.Fragment>
        );
      }
      const formatted = renderFormattedText(part, _color);
      return formatted.length === 1 && typeof formatted[0] === 'string' ? formatted[0] : <Text key={index}>{formatted}</Text>;
    });
  };

  const renderQuotedMessage = () => {
    const quoted = message.quotedMessage;
    if (!quoted) return null;

    const quotedText = (quoted.text || quoted.body || '').replace(/\\n/g, '\n').trim();
    const quotedSender = quoted.senderName || quoted.sentByName || '';
    const quotedMediaUrl = (quoted as any).gmbt_mediaUrl || quoted.mediaUrl || quoted.MediaUrl || '';
    const quotedType = (quoted.type || quoted.messageType || '').toLowerCase();
    const isQuotedMedia = ['image', 'video', 'audio', 'document', 'sticker'].includes(quotedType) || !!quotedMediaUrl;

    const accentColor = isOutbound ? '#06cf9c' : '#7c3aed';
    const contextId = message.ContextMessageId || message.contextMessageId || quoted.messageId || quoted.id;

    const handleQuotedTap = () => {
      if (contextId && onQuotedPress) {
        onQuotedPress(contextId);
      }
    };

    return (
      <Pressable onPress={handleQuotedTap} disabled={!contextId || !onQuotedPress}>
        <View style={[styles.quotedContainer, { borderLeftColor: accentColor, backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }]}>
          {quotedSender ? (
            <Text style={[styles.quotedSender, { color: accentColor }]} numberOfLines={1}>
              {quotedSender}
            </Text>
          ) : null}
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={[styles.quotedText, { color: isDark ? '#8696a0' : '#667781' }]} numberOfLines={2}>
              {isQuotedMedia && !quotedText ? (
                <>
                  <MaterialCommunityIcons name={quotedType === 'video' ? 'video' : quotedType === 'audio' ? 'microphone' : quotedType === 'document' ? 'file-document-outline' : 'image'} size={13} color={isDark ? '#8696a0' : '#667781'} />
                  {' '}{quotedType === 'image' ? 'Photo' : quotedType === 'video' ? 'Video' : quotedType === 'audio' ? 'Audio' : 'Document'}
                </>
              ) : quotedText}
            </Text>
            {isQuotedMedia && quotedMediaUrl && quotedType === 'image' && (
              <Image source={{ uri: quotedMediaUrl }} style={styles.quotedThumb} contentFit="cover" cachePolicy="disk" />
            )}
          </View>
        </View>
      </Pressable>
    );
  };

  const renderLocation = () => {
    const loc = message.location || (message as any).locationData;
    if (!loc) return null;
    const { latitude, longitude, name, address } = loc;
    const mapUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${latitude},${longitude}&zoom=15&size=300x150&markers=color:red%7C${latitude},${longitude}&key=AIzaSyBwXDO&style=feature:all`;
    const mapsLink = `https://maps.google.com/?q=${latitude},${longitude}`;

    return (
      <Pressable onPress={() => Linking.openURL(mapsLink).catch(() => {})}>
        <View style={[styles.locationContainer, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : '#f0f9f4' }]}>
          <View style={styles.locationMapPlaceholder}>
            <MaterialCommunityIcons name="map-marker" size={32} color="#E53935" />
            <View style={styles.locationPinCircle}>
              <MaterialCommunityIcons name="google-maps" size={18} color="#4285F4" />
            </View>
          </View>
          {(name || address) && (
            <View style={styles.locationInfo}>
              {name ? <Text style={[styles.locationName, { color: textColor }]} numberOfLines={1}>{name}</Text> : null}
              {address ? <Text style={[styles.locationAddress, { color: timeColor }]} numberOfLines={2}>{address}</Text> : null}
            </View>
          )}
          {!name && !address && (
            <View style={styles.locationInfo}>
              <Text style={[styles.locationName, { color: textColor }]}>{t('chats.location', 'מיקום')}</Text>
              <Text style={[styles.locationAddress, { color: timeColor }]}>{`${latitude.toFixed(5)}, ${longitude.toFixed(5)}`}</Text>
            </View>
          )}
        </View>
      </Pressable>
    );
  };

  const renderContacts = () => {
    const contacts = message.contacts || (message as any).contactsList;
    if (!contacts || contacts.length === 0) return null;

    return (
      <View style={[styles.contactCardContainer, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : '#f8fafc' }]}>
        {contacts.map((contact: any, idx: number) => {
          const name = contact.name?.formatted_name || `${contact.name?.first_name || ''} ${contact.name?.last_name || ''}`.trim() || t('chats.contact', 'Contact');
          const phone = contact.phones?.[0]?.phone || '';
          return (
            <Pressable key={idx} onPress={() => { if (phone) Linking.openURL(`tel:${phone}`).catch(() => {}); }} style={styles.contactCardItem}>
              <View style={[styles.contactCardAvatar, { backgroundColor: isDark ? '#2e6155' : '#d1fae5' }]}>
                <MaterialCommunityIcons name="account" size={22} color={isDark ? '#fff' : '#065f46'} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.contactCardName, { color: textColor }]} numberOfLines={1}>{name}</Text>
                {phone ? <Text style={[styles.contactCardPhone, { color: timeColor }]}>{phone}</Text> : null}
              </View>
              {phone ? <MaterialCommunityIcons name="message-text-outline" size={18} color={theme.colors.primary} /> : null}
            </Pressable>
          );
        })}
      </View>
    );
  };

  const isSticker = rawType.toLowerCase() === 'sticker';

  const bubbleAlign = isRTL
    ? (isOutbound ? 'flex-start' : 'flex-end')
    : (isOutbound ? 'flex-end' : 'flex-start');

  if (isSticker && mediaUrl) {
    return (
      <View
        style={[
          styles.wrapper,
          { alignItems: bubbleAlign },
          showTail && styles.tailSpacing,
        ]}
      >
        <Pressable style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1 }]}>
          {mediaLoading ? (
            <View style={[styles.stickerPlaceholder]}>
              <ActivityIndicator size="small" color={theme.colors.primary} />
            </View>
          ) : (
            <Image
              source={{ uri: effectiveMediaUrl || mediaUrl }}
              style={styles.stickerImage}
              contentFit="contain"
              cachePolicy="disk"
              recyclingKey={mediaUrl}
            />
          )}
          <View style={[styles.stickerMeta, { alignSelf: bubbleAlign }]}>
            {message.isStarred && (
              <MaterialCommunityIcons name="star" size={11} color="#FFB300" style={{ marginRight: 3 }} />
            )}
            <Text style={[styles.time, { color: isDark ? '#8696a0' : '#667781' }]}>
              {formatMessageTime(message.createdOn || message.timestamp)}
            </Text>
            {renderStatus()}
          </View>
        </Pressable>
        {(() => {
          const reactions = message.reactions;
          if (!reactions) return null;
          let emojiList: { key: string; emoji: string }[] = [];
          if (Array.isArray(reactions)) {
            emojiList = reactions.map((r, i) => ({ key: `${i}`, emoji: r.emoji }));
          } else if (typeof reactions === 'object') {
            emojiList = Object.entries(reactions).map(([phone, emoji]) => ({ key: phone, emoji: emoji as string }));
          }
          if (emojiList.length === 0) return null;
          const uniqueEmojis = [...new Set(emojiList.map(e => e.emoji))];
          return (
            <View style={[styles.reactionsContainer, { alignSelf: bubbleAlign, backgroundColor: isDark ? '#1f2c34' : '#ffffff' }]}>
              {uniqueEmojis.map((emoji, i) => (<Text key={i} style={styles.reactionEmoji}>{emoji}</Text>))}
              {emojiList.length > 1 && <Text style={[styles.reactionCount, { color: isDark ? '#8696a0' : '#667781' }]}>{emojiList.length}</Text>}
            </View>
          );
        })()}
      </View>
    );
  }

  return (
    <GestureDetector gesture={composedGesture}>
    <View
      style={[
        styles.wrapper,
        {
          alignItems: bubbleAlign,
        },
        showTail && styles.tailSpacing,
      ]}
    >
      {/* Reply icon that appears during swipe */}
      <Animated.View style={[styles.swipeReplyIcon, isRTL ? { right: -30 } : { left: -30 }, replyIconStyle]} pointerEvents="none">
        <MaterialCommunityIcons name="reply" size={20} color={isDark ? '#8696a0' : '#667781'} />
      </Animated.View>
      <Animated.View style={animatedStyle}>
      <Pressable
        style={({ pressed }) => [
          styles.bubble,
          {
            backgroundColor: bubbleColor,
            maxWidth: MAX_BUBBLE_WIDTH,
            opacity: pressed ? 0.85 : 1,
          },
          isOutbound
            ? {
                borderTopLeftRadius: 18,
                borderTopRightRadius: showTail ? 4 : 18,
                borderBottomLeftRadius: 18,
                borderBottomRightRadius: 18,
              }
            : {
                borderTopLeftRadius: showTail ? 4 : 18,
                borderTopRightRadius: 18,
                borderBottomLeftRadius: 18,
                borderBottomRightRadius: 18,
              },
        ]}
      >
        {showTail && (
          <View
            style={[
              styles.tail,
              isOutbound
                ? {
                    right: -6,
                    borderLeftWidth: 6,
                    borderLeftColor: bubbleColor,
                  }
                : {
                    left: -6,
                    borderRightWidth: 6,
                    borderRightColor: bubbleColor,
                  },
            ]}
          />
        )}

        {/* Forwarded indicator */}
        {(message.isForwarded || (message as any).forwarded) && (
          <View style={styles.forwardedBadge}>
            <MaterialCommunityIcons name="share" size={11} color={isDark ? '#8696a0' : '#667781'} style={{ transform: [{ scaleX: -1 }] }} />
            <Text style={[styles.forwardedText, { color: isDark ? '#8696a0' : '#667781' }]}>
              {t('chats.forwarded', 'Forwarded')}
            </Text>
          </View>
        )}

        {isInternal && (
          <View style={styles.internalBadge}>
            <MaterialCommunityIcons name="note-text-outline" size={11} color={isDark ? '#FFE082' : '#E65100'} />
            <Text style={[styles.internalLabel, { color: isDark ? '#FFE082' : '#E65100' }]}>
              {t('chats.internalNote')}
            </Text>
          </View>
        )}

        {(displaySenderName || (wabaNumbers && wabaNumbers.length > 1)) ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
            {displaySenderName ? (
              <Text style={[styles.senderName, {
                color: isSentFromApp
                  ? (isDark ? '#4ade80' : '#128C7E')
                  : isOutbound
                    ? (isDark ? '#a7f3d0' : '#075e54')
                    : (isDark ? '#a5b4fc' : '#6366f1'),
                letterSpacing: isSentFromApp ? 0.5 : 0,
              }]}>
                {displaySenderName}
              </Text>
            ) : null}
            {renderWabaNumberBadge()}
          </View>
        ) : null}

        {/* Quoted/Reply message */}
        {renderQuotedMessage()}

        {(message.type === 'template' || (message as any).messageType === 'template') ? (
          renderTemplate()
        ) : msgType === 'location' ? (
          renderLocation()
        ) : (message.contacts || (message as any).contactsList) ? (
          renderContacts()
        ) : (
          <>
            {renderMedia()}
            {(message.text || message.body || message.caption) ? (() => {
              const txt = (message.caption || message.text || message.body || '').replace(/\\n/g, '\n').trim();
              const isMediaPlaceholder = ['image', 'video', 'audio', 'document'].includes(msgType) && mediaUrl &&
                /^(תמונה|סרטון|וידאו|אודיו|מסמך|קובץ|image|video|audio|document|photo|sticker|file)$/i.test(txt);
              if (isMediaPlaceholder) return null;
              return (
                <Text style={[styles.body, { color: textColor }]}>
                  {renderLinkedText(txt, textColor)}
                </Text>
              );
            })() : null}
          </>
        )}

        {isScheduled && isOutbound && (
          <View style={[styles.scheduledBanner, { backgroundColor: isDark ? 'rgba(245,158,11,0.18)' : '#FFF7ED', borderColor: isDark ? 'rgba(245,158,11,0.4)' : '#FCD9A5' }]}>
            <MaterialCommunityIcons name="clock-outline" size={13} color={isDark ? '#FBBF24' : '#B45309'} />
            <Text style={[styles.scheduledText, { color: isDark ? '#FBBF24' : '#B45309' }]} numberOfLines={1}>
              {t('chats.scheduledFor', 'תישלח')}{scheduledForRaw ? ` · ${formatScheduledTime(scheduledForRaw)}` : ''}
            </Text>
            {onCancelScheduled && scheduledMessageId ? (
              <Pressable onPress={() => onCancelScheduled(String(scheduledMessageId))} hitSlop={8} style={styles.scheduledCancelBtn}>
                <MaterialCommunityIcons name="close-circle" size={15} color={isDark ? '#FCA5A5' : '#DC2626'} />
                <Text style={[styles.scheduledCancelText, { color: isDark ? '#FCA5A5' : '#DC2626' }]}>
                  {t('common.cancel', 'בטל')}
                </Text>
              </Pressable>
            ) : null}
          </View>
        )}

        <View style={[styles.meta, { justifyContent: isOutbound ? 'flex-end' : 'flex-start' }]}>
          {message.isStarred && (
            <MaterialCommunityIcons name="star" size={11} color="#FFB300" style={{ marginRight: 3 }} />
          )}
          <Text style={[styles.time, { color: timeColor }]}>
            {isScheduled ? formatScheduledTime(scheduledForRaw) || formatMessageTime(message.createdOn || message.timestamp) : formatMessageTime(message.createdOn || message.timestamp)}
          </Text>
          {!isScheduled && renderStatus()}
        </View>
      </Pressable>

      {/* Reactions - WhatsApp style floating pill */}
      {(() => {
        const reactions = message.reactions;
        if (!reactions) return null;
        let emojiList: { key: string; emoji: string }[] = [];
        if (Array.isArray(reactions)) {
          emojiList = reactions.map((r, i) => ({ key: `${i}`, emoji: r.emoji }));
        } else if (typeof reactions === 'object') {
          emojiList = Object.entries(reactions).map(([phone, emoji]) => ({ key: phone, emoji: emoji as string }));
        }
        if (emojiList.length === 0) return null;

        const uniqueEmojis = [...new Set(emojiList.map(e => e.emoji))];
        const count = emojiList.length;

        return (
          <View style={[
            styles.reactionsContainer,
            {
              alignSelf: bubbleAlign,
              backgroundColor: isDark ? '#1f2c34' : '#ffffff',
            },
          ]}>
            {uniqueEmojis.map((emoji, i) => (
              <Text key={i} style={styles.reactionEmoji}>{emoji}</Text>
            ))}
            {count > 1 && (
              <Text style={[styles.reactionCount, { color: isDark ? '#8696a0' : '#667781' }]}>{count}</Text>
            )}
          </View>
        );
      })()}
      </Animated.View>
    </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    paddingHorizontal: 8,
    marginVertical: 1,
    position: 'relative',
  },
  swipeReplyIcon: {
    position: 'absolute',
    top: 12,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tailSpacing: {
    marginTop: 6,
  },
  bubble: {
    paddingHorizontal: 9,
    paddingTop: 6,
    paddingBottom: 6,
    borderRadius: 18,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 0.5 },
    shadowOpacity: 0.04,
    shadowRadius: 1,
    position: 'relative',
    minWidth: 80,
  },
  tail: {
    position: 'absolute',
    top: 0,
    width: 0,
    height: 0,
    borderTopWidth: 8,
    borderTopColor: 'transparent',
  },
  internalBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 3,
  },
  internalLabel: {
    fontSize: 11,
    fontWeight: '600',
    marginStart: 3,
  },
  senderName: {
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 2,
  },
  body: {
    fontSize: 15,
    lineHeight: 20,
  },
  scheduledBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 6,
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  scheduledText: {
    fontSize: 11,
    fontWeight: '600',
    flexShrink: 1,
  },
  scheduledCancelBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginStart: 'auto',
  },
  scheduledCancelText: {
    fontSize: 11,
    fontWeight: '700',
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
    gap: 3,
  },
  time: {
    fontSize: 11,
  },
  mediaImage: {
    width: MEDIA_WIDTH,
    height: 200,
    borderRadius: 10,
    marginBottom: 4,
    marginTop: 2,
  },
  mediaPlaceholder: {
    width: MEDIA_WIDTH,
    height: 180,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
    marginTop: 2,
    overflow: 'hidden',
  },
  videoThumb: {
    marginTop: 2,
    marginBottom: 4,
  },
  docContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 10,
    marginBottom: 4,
    marginTop: 2,
    minWidth: 200,
    gap: 10,
  },
  docIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: 'rgba(46,97,85,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  audioContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    minWidth: 200,
  },
  audioPlayBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#2e6155',
    alignItems: 'center',
    justifyContent: 'center',
  },
  audioTrackWrap: {
    flex: 1,
    gap: 4,
  },
  waveformRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 1.5,
    height: 20,
  },
  audioDuration: {
    fontSize: 11,
    marginTop: 1,
  },
  imageViewerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.95)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  imageViewerClose: {
    position: 'absolute',
    top: 50,
    right: 20,
    zIndex: 10,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageViewerImage: {
    width: '100%',
    height: '80%',
  },
  templateContainer: {
    borderRadius: 12,
    padding: 12,
    marginTop: 2,
    marginBottom: 2,
    overflow: 'hidden',
  },
  templateBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 8,
    paddingBottom: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,0,0,0.06)',
  },
  templateBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  templateHeaderImage: {
    width: MEDIA_WIDTH - 10,
    height: 160,
    borderRadius: 10,
    marginBottom: 8,
  },
  templateHeaderVideo: {
    width: MEDIA_WIDTH - 10,
    height: 160,
    borderRadius: 10,
    marginBottom: 8,
  },
  templateBody: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 4,
  },
  templateFooter: {
    fontSize: 12,
    marginTop: 6,
    fontStyle: 'italic',
  },
  templateButtons: {
    marginTop: 10,
    gap: 6,
  },
  templateButton: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignItems: 'center',
    borderRadius: 8,
  },
  templateButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  wabaBadge: {
    fontSize: 10.5,
    marginStart: 4,
    fontWeight: '500',
    fontStyle: 'italic',
  },
  reactionsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 12,
    marginTop: -6,
    marginHorizontal: 12,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    gap: 2,
  },
  reactionEmoji: {
    fontSize: 16,
  },
  reactionCount: {
    fontSize: 11,
    fontWeight: '600',
    marginStart: 2,
  },
  forwardedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginBottom: 2,
  },
  forwardedText: {
    fontSize: 11,
    fontStyle: 'italic',
    fontWeight: '400',
  },
  quotedContainer: {
    borderLeftWidth: 3,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
    marginBottom: 4,
    marginTop: 2,
  },
  quotedSender: {
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 2,
  },
  quotedText: {
    fontSize: 13,
    lineHeight: 17,
    flex: 1,
  },
  quotedThumb: {
    width: 42,
    height: 42,
    borderRadius: 4,
    marginStart: 8,
  },
  stickerImage: {
    width: STICKER_SIZE,
    height: STICKER_SIZE,
  },
  stickerPlaceholder: {
    width: STICKER_SIZE,
    height: STICKER_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stickerMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginTop: 2,
  },
  locationContainer: {
    borderRadius: 10,
    overflow: 'hidden',
    marginTop: 2,
    marginBottom: 4,
    minWidth: 200,
  },
  locationMapPlaceholder: {
    height: 100,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(46,97,85,0.08)',
    position: 'relative',
  },
  locationPinCircle: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  locationInfo: {
    padding: 8,
  },
  locationName: {
    fontSize: 14,
    fontWeight: '600',
  },
  locationAddress: {
    fontSize: 12,
    marginTop: 2,
  },
  contactCardContainer: {
    borderRadius: 10,
    overflow: 'hidden',
    marginTop: 2,
    marginBottom: 4,
    minWidth: 200,
  },
  contactCardItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    gap: 10,
  },
  contactCardAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contactCardName: {
    fontSize: 14,
    fontWeight: '600',
  },
  contactCardPhone: {
    fontSize: 12,
    marginTop: 1,
  },
});

export const MessageBubble = memo(MessageBubbleInner);
