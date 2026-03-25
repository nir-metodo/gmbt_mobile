import React, { memo, useCallback, useState } from 'react';
import { View, StyleSheet, Pressable, Dimensions, I18nManager, Image, Linking } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import type { Message } from '../../types';
import type { AppTheme } from '../../constants/theme';
import { formatMessageTime } from '../../utils/formatters';

const SCREEN_WIDTH = Dimensions.get('window').width;
const MAX_BUBBLE_WIDTH = SCREEN_WIDTH * 0.78;

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

  const handleLongPress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onLongPress?.(message);
  }, [message, onLongPress]);

  const bubbleColor = isInternal
    ? isDark
      ? '#3E3500'
      : '#FFF9C4'
    : isOutbound
      ? theme.custom.chatBubbleOut
      : theme.custom.chatBubbleIn;

  const textColor = isInternal
    ? isDark
      ? '#FFE082'
      : '#5D4037'
    : theme.colors.onSurface;

  const timeColor = isInternal
    ? isDark
      ? '#BCAA5A'
      : '#8D6E63'
    : theme.colors.onSurfaceVariant;

  const displaySenderName = isInternal
    ? (message.createdByName || message.sentByName || message.senderName)
    : isOutbound
      ? (message.sentFromApp ? `${message.sentByName ? message.sentByName + ' · ' : ''}APP` : (message.sentByName || null))
      : (message.senderName || message.sentByName || null);

  const renderStatus = () => {
    if (!isOutbound) return null;
    const size = 14;
    switch (message.status) {
      case 'pending':
        return (
          <MaterialCommunityIcons
            name="clock-outline"
            size={size}
            color={timeColor}
          />
        );
      case 'sent':
        return (
          <MaterialCommunityIcons
            name="check"
            size={size}
            color={theme.custom.statusSent}
          />
        );
      case 'delivered':
        return (
          <MaterialCommunityIcons
            name="check-all"
            size={size}
            color={theme.custom.statusDelivered}
          />
        );
      case 'read':
        return (
          <MaterialCommunityIcons
            name="check-all"
            size={size}
            color={theme.custom.statusRead}
          />
        );
      case 'failed':
        return (
          <MaterialCommunityIcons
            name="alert-circle-outline"
            size={size}
            color={theme.colors.error}
          />
        );
      default:
        return null;
    }
  };

  const [imageError, setImageError] = useState(false);
  const mediaUrl = message.mediaUrl || message.MediaUrl || message.media_url;

  const handleOpenMedia = useCallback((url?: string) => {
    if (url) Linking.openURL(url).catch(() => {});
  }, []);

  const renderMedia = () => {
    const msgType = message.type || message.messageType;
    switch (msgType) {
      case 'image':
        if (mediaUrl && !imageError) {
          return (
            <Pressable onPress={() => handleOpenMedia(mediaUrl)}>
              <Image
                source={{ uri: mediaUrl }}
                style={styles.mediaImage}
                resizeMode="cover"
                onError={() => setImageError(true)}
              />
            </Pressable>
          );
        }
        return (
          <View
            style={[
              styles.mediaPlaceholder,
              { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)' },
            ]}
          >
            <MaterialCommunityIcons name="image" size={40} color={theme.colors.onSurfaceVariant} />
          </View>
        );

      case 'video':
        if (mediaUrl) {
          return (
            <Pressable onPress={() => handleOpenMedia(mediaUrl)}>
              <View
                style={[
                  styles.mediaPlaceholder,
                  { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)' },
                ]}
              >
                <MaterialCommunityIcons name="play-circle" size={48} color={theme.colors.primary} />
                <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: 4 }}>
                  {t('chats.tapToPlay', 'Tap to play')}
                </Text>
              </View>
            </Pressable>
          );
        }
        return (
          <View
            style={[
              styles.mediaPlaceholder,
              { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)' },
            ]}
          >
            <MaterialCommunityIcons name="play-circle-outline" size={44} color={theme.colors.onSurfaceVariant} />
          </View>
        );

      case 'document':
        return (
          <Pressable onPress={() => handleOpenMedia(mediaUrl)} disabled={!mediaUrl}>
            <View
              style={[
                styles.docContainer,
                { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' },
              ]}
            >
              <MaterialCommunityIcons name="file-document-outline" size={28} color={theme.colors.primary} />
              <Text
                variant="bodySmall"
                numberOfLines={1}
                style={{ flex: 1, marginStart: 8, color: textColor }}
              >
                {message.fileName || t('chats.attachFile')}
              </Text>
              {mediaUrl ? (
                <MaterialCommunityIcons name="download" size={20} color={theme.colors.primary} />
              ) : (
                <MaterialCommunityIcons name="download" size={20} color={theme.colors.onSurfaceVariant} />
              )}
            </View>
          </Pressable>
        );

      case 'audio':
        return (
          <Pressable onPress={() => handleOpenMedia(mediaUrl)} disabled={!mediaUrl}>
            <View style={styles.audioContainer}>
              <MaterialCommunityIcons name="play-circle" size={36} color={theme.colors.primary} />
              <View style={styles.audioWaveformTrack}>
                <View
                  style={[styles.audioWaveformFill, { backgroundColor: theme.colors.primary }]}
                />
              </View>
            </View>
          </Pressable>
        );

      default:
        return null;
    }
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
            ? { [isRTL ? 'borderTopLeftRadius' : 'borderTopRightRadius']: showTail ? 4 : 12 }
            : { [isRTL ? 'borderTopRightRadius' : 'borderTopLeftRadius']: showTail ? 4 : 12 },
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
            <MaterialCommunityIcons
              name="note-text-outline"
              size={11}
              color={isDark ? '#FFE082' : '#E65100'}
            />
            <Text
              style={[
                styles.internalLabel,
                { color: isDark ? '#FFE082' : '#E65100' },
              ]}
            >
              {t('chats.internalNote')}
            </Text>
          </View>
        )}

        {displaySenderName ? (
          <Text
            style={[
              styles.senderName,
              {
                color: message.sentFromApp
                  ? '#128C7E'
                  : isOutbound
                    ? '#6366f1'
                    : theme.colors.primary,
              },
            ]}
          >
            {displaySenderName}
          </Text>
        ) : null}

        {renderMedia()}

        {(message.text || message.body) ? (
          <Text style={[styles.body, { color: textColor }]}>
            {message.text || message.body}
            {'   \u200B'}
          </Text>
        ) : null}

        <View style={styles.meta}>
          {message.isStarred && (
            <MaterialCommunityIcons
              name="star"
              size={11}
              color="#FFB300"
              style={{ marginRight: 3 }}
            />
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
    paddingHorizontal: 10,
    marginVertical: 1,
  },
  wrapperOut: {
    alignItems: 'flex-end',
  },
  wrapperIn: {
    alignItems: 'flex-start',
  },
  tailSpacing: {
    marginTop: 6,
  },
  bubble: {
    paddingHorizontal: 9,
    paddingTop: 5,
    paddingBottom: 5,
    borderRadius: 12,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 0.5 },
    shadowOpacity: 0.06,
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
    marginBottom: 1,
  },
  body: {
    fontSize: 15,
    lineHeight: 20,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: -2,
    gap: 3,
  },
  time: {
    fontSize: 11,
  },
  mediaImage: {
    width: 220,
    height: 180,
    borderRadius: 8,
    marginBottom: 4,
  },
  mediaPlaceholder: {
    width: 220,
    height: 160,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
    overflow: 'hidden',
  },
  docContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 8,
    marginBottom: 4,
    minWidth: 200,
  },
  audioContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
    minWidth: 200,
  },
  audioWaveformTrack: {
    flex: 1,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: 'rgba(128,128,128,0.25)',
    overflow: 'hidden',
  },
  audioWaveformFill: {
    width: '35%',
    height: '100%',
    borderRadius: 1.5,
  },
});

export const MessageBubble = memo(MessageBubbleInner);
