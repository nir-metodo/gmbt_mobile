import React, { memo, useCallback, useState, useRef } from 'react';
import { View, StyleSheet, Pressable, Dimensions, I18nManager, Modal, ActivityIndicator, Linking } from 'react-native';
import { Image } from 'expo-image';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Audio, Video, ResizeMode } from 'expo-av';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import type { Message } from '../../types';
import type { AppTheme } from '../../constants/theme';
import { formatMessageTime } from '../../utils/formatters';
import { useCachedMedia } from '../../hooks/useCachedMedia';
import type { MediaType } from '../../services/mediaCache';

const SCREEN_WIDTH = Dimensions.get('window').width;
const MAX_BUBBLE_WIDTH = SCREEN_WIDTH * 0.78;
const MEDIA_WIDTH = MAX_BUBBLE_WIDTH - 18;

interface MessageBubbleProps {
  message: Message;
  isOutbound: boolean;
  showTail: boolean;
  theme: AppTheme;
  onLongPress?: (message: Message) => void;
}

function MessageBubbleInner({
  message,
  isOutbound,
  showTail,
  theme,
  onLongPress,
}: MessageBubbleProps) {
  const { t } = useTranslation();
  const isInternal = message.type === 'internal';
  const isDark = theme.dark;

  const [imageViewerVisible, setImageViewerVisible] = useState(false);
  const [videoFullscreen, setVideoFullscreen] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [audioDuration, setAudioDuration] = useState(0);
  const [audioPosition, setAudioPosition] = useState(0);
  const audioRef = useRef<Audio.Sound | null>(null);

  const handleLongPress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onLongPress?.(message);
  }, [message, onLongPress]);

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

  const displaySenderName = isInternal
    ? (message.createdByName || message.sentByName || message.senderName)
    : isOutbound
      ? (message.sentFromApp ? `${message.sentByName ? message.sentByName + ' · ' : ''}APP` : (message.sentByName || null))
      : (message.senderName || message.sentByName || null);

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

  const mediaUrl = message.mediaUrl || message.MediaUrl || message.media_url;
  const msgType = (message.type || message.messageType) as MediaType | string;
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
          if (mediaLoading) {
            return (
              <View style={[styles.mediaPlaceholder, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)' }]}>
                <ActivityIndicator size="small" color={theme.colors.primary} />
              </View>
            );
          }
          return (
            <>
              <Pressable onPress={() => setImageViewerVisible(true)}>
                <Image
                  source={{ uri: effectiveMediaUrl! }}
                  style={styles.mediaImage}
                  contentFit="cover"
                  cachePolicy="disk"
                  recyclingKey={mediaUrl}
                  onError={() => setImageError(true)}
                />
              </Pressable>
              <Modal visible={imageViewerVisible} transparent animationType="fade" onRequestClose={() => setImageViewerVisible(false)}>
                <View style={styles.imageViewerOverlay}>
                  <Pressable style={styles.imageViewerClose} onPress={() => setImageViewerVisible(false)}>
                    <MaterialCommunityIcons name="close" size={28} color="#fff" />
                  </Pressable>
                  <Image
                    source={{ uri: effectiveMediaUrl! }}
                    style={styles.imageViewerImage}
                    contentFit="contain"
                    cachePolicy="disk"
                  />
                </View>
              </Modal>
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
          if (mediaLoading) {
            return (
              <View style={[styles.mediaPlaceholder, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)' }]}>
                <ActivityIndicator size="small" color={theme.colors.primary} />
                <Text variant="labelSmall" style={{ color: isDark ? '#8696a0' : '#667781', marginTop: 6 }}>
                  {t('chats.downloading', 'מוריד...')}
                </Text>
              </View>
            );
          }
          if (videoFullscreen) {
            return (
              <>
                <Pressable onPress={() => setVideoFullscreen(true)} style={styles.videoThumb}>
                  <View style={[styles.mediaPlaceholder, { backgroundColor: isDark ? '#111' : '#000' }]}>
                    <Video
                      source={{ uri: effectiveMediaUrl! }}
                      style={{ width: MEDIA_WIDTH, height: 180, borderRadius: 8 }}
                      resizeMode={ResizeMode.CONTAIN}
                      useNativeControls
                      shouldPlay
                    />
                  </View>
                </Pressable>
                <Modal visible={videoFullscreen} transparent animationType="fade" onRequestClose={() => setVideoFullscreen(false)}>
                  <View style={styles.imageViewerOverlay}>
                    <Pressable style={styles.imageViewerClose} onPress={() => setVideoFullscreen(false)}>
                      <MaterialCommunityIcons name="close" size={28} color="#fff" />
                    </Pressable>
                    <Video
                      source={{ uri: effectiveMediaUrl! }}
                      style={{ width: '100%', height: '80%' }}
                      resizeMode={ResizeMode.CONTAIN}
                      useNativeControls
                      shouldPlay
                    />
                  </View>
                </Modal>
              </>
            );
          }
          return (
            <Pressable onPress={() => setVideoFullscreen(true)}>
              <View style={[styles.mediaPlaceholder, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)' }]}>
                <MaterialCommunityIcons name="play-circle" size={52} color="#fff" style={{ opacity: 0.9 }} />
                <Text variant="labelSmall" style={{ color: isDark ? '#8696a0' : '#667781', marginTop: 4 }}>
                  {t('chats.tapToPlay', 'לחץ להפעלה')}
                </Text>
              </View>
            </Pressable>
          );
        }
        return (
          <View style={[styles.mediaPlaceholder, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)' }]}>
            <MaterialCommunityIcons name="play-circle-outline" size={44} color={theme.colors.onSurfaceVariant} />
          </View>
        );

      case 'document':
        return (
          <Pressable onPress={() => { if (effectiveMediaUrl) { const { Linking } = require('react-native'); Linking.openURL(effectiveMediaUrl).catch(() => {}); } }} disabled={!effectiveMediaUrl}>
            <View style={[styles.docContainer, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : '#f0f4f0' }]}>
              <View style={styles.docIconWrap}>
                <MaterialCommunityIcons name="file-document-outline" size={24} color={theme.colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="bodySmall" numberOfLines={1} style={{ color: textColor, fontWeight: '600' }}>
                  {message.fileName || t('chats.attachFile')}
                </Text>
                <Text variant="labelSmall" style={{ color: timeColor, marginTop: 1 }}>
                  {mediaLoading ? t('chats.downloading', 'מוריד...') : 'PDF · הורדה'}
                </Text>
              </View>
              {mediaLoading ? (
                <ActivityIndicator size="small" color={theme.colors.primary} />
              ) : (
                <MaterialCommunityIcons name="download" size={20} color={theme.colors.primary} />
              )}
            </View>
          </Pressable>
        );

      case 'audio':
        const progress = audioDuration > 0 ? audioPosition / audioDuration : 0;
        const durationSec = Math.round((audioDuration || 0) / 1000);
        const positionSec = Math.round(audioPosition / 1000);
        const formatSec = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
        return (
          <View style={styles.audioContainer}>
            <Pressable onPress={handleAudioPlay} disabled={mediaLoading} style={styles.audioPlayBtn}>
              {mediaLoading ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <MaterialCommunityIcons
                  name={audioPlaying ? 'pause' : 'play'}
                  size={24}
                  color="#fff"
                />
              )}
            </Pressable>
            <View style={styles.audioTrackWrap}>
              <View style={styles.audioTrack}>
                <View style={[styles.audioTrackFill, { width: `${progress * 100}%`, backgroundColor: isOutbound ? '#075e54' : '#2e6155' }]} />
              </View>
              <Text style={[styles.audioDuration, { color: timeColor }]}>
                {audioPlaying ? formatSec(positionSec) : formatSec(durationSec)}
              </Text>
            </View>
          </View>
        );

      default:
        return null;
    }
  };

  const renderLinkedText = (text: string, _color: string) => {
    const urlPattern = /(https?:\/\/[^\s<>]+|www\.[^\s<>]+)/gi;
    const parts = text.split(urlPattern);
    if (parts.length === 1) return text;

    return parts.map((part, index) => {
      if (index % 2 === 1) {
        const href = part.startsWith('http') ? part : `https://${part}`;
        return (
          <Text
            key={index}
            style={{ color: '#1a73e8', textDecorationLine: 'underline' }}
            onPress={() => Linking.openURL(href).catch(() => {})}
          >
            {part}
          </Text>
        );
      }
      return part;
    });
  };

  const isRTL = I18nManager.isRTL;

  return (
    <View
      style={[
        styles.wrapper,
        {
          alignItems: isOutbound
            ? (isRTL ? 'flex-start' : 'flex-end')
            : (isRTL ? 'flex-end' : 'flex-start'),
        },
        showTail && styles.tailSpacing,
      ]}
    >
      <Pressable
        onLongPress={handleLongPress}
        delayLongPress={250}
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
                    [isRTL ? 'left' : 'right']: -6,
                    borderLeftWidth: isRTL ? 0 : 6,
                    borderLeftColor: isRTL ? 'transparent' : bubbleColor,
                    borderRightWidth: isRTL ? 6 : 0,
                    borderRightColor: isRTL ? bubbleColor : 'transparent',
                  }
                : {
                    [isRTL ? 'right' : 'left']: -6,
                    borderRightWidth: isRTL ? 0 : 6,
                    borderRightColor: isRTL ? 'transparent' : bubbleColor,
                    borderLeftWidth: isRTL ? 6 : 0,
                    borderLeftColor: isRTL ? bubbleColor : 'transparent',
                  },
            ]}
          />
        )}

        {isInternal && (
          <View style={styles.internalBadge}>
            <MaterialCommunityIcons name="note-text-outline" size={11} color={isDark ? '#FFE082' : '#E65100'} />
            <Text style={[styles.internalLabel, { color: isDark ? '#FFE082' : '#E65100' }]}>
              {t('chats.internalNote')}
            </Text>
          </View>
        )}

        {displaySenderName ? (
          <Text style={[styles.senderName, { color: isOutbound ? '#075e54' : '#6366f1' }]}>
            {displaySenderName}
          </Text>
        ) : null}

        {renderMedia()}

        {(message.text || message.body) ? (
          <Text style={[styles.body, { color: textColor }]}>
            {renderLinkedText(message.text || message.body || '', textColor)}
          </Text>
        ) : null}

        <View style={[styles.meta, { justifyContent: isOutbound ? 'flex-end' : 'flex-start' }]}>
          {message.isStarred && (
            <MaterialCommunityIcons name="star" size={11} color="#FFB300" style={{ marginRight: 3 }} />
          )}
          <Text style={[styles.time, { color: timeColor }]}>
            {formatMessageTime(message.createdOn || message.timestamp)}
          </Text>
          {renderStatus()}
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    paddingHorizontal: 8,
    marginVertical: 1,
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
    fontSize: 12.5,
    fontWeight: '700',
    marginBottom: 2,
  },
  body: {
    fontSize: 15,
    lineHeight: 20,
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
    gap: 2,
  },
  audioTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(128,128,128,0.25)',
    overflow: 'hidden',
  },
  audioTrackFill: {
    height: '100%',
    borderRadius: 2,
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
});

export const MessageBubble = memo(MessageBubbleInner);
