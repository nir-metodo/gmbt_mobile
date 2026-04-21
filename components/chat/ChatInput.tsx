import React, {
  useState,
  useRef,
  useCallback,
  useEffect,
  forwardRef,
  useImperativeHandle,
} from 'react';
import {
  View,
  StyleSheet,
  TextInput,
  Pressable,
  Platform,
  Alert,
  Animated,
} from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Audio } from 'expo-av';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useRTL } from '../../hooks/useRTL';

export interface ChatInputRef {
  insertText: (text: string) => void;
  focus: () => void;
  clear: () => void;
}

export interface ReplyPreview {
  text: string;
  senderName: string;
}

interface MentionedUser {
  userId: string;
  userName: string;
}

interface ChatInputProps {
  onSend: (text: string) => void;
  onAttachmentPress: () => void;
  isInternalNote: boolean;
  onToggleInternalNote: () => void;
  onQuickMessagePress?: () => void;
  onVoiceMessage?: (uri: string, durationMs: number) => void;
  mentionedUsers?: MentionedUser[];
  onRemoveMention?: (userId: string) => void;
  isSending?: boolean;
  disabled?: boolean;
  replyTo?: ReplyPreview | null;
  onCancelReply?: () => void;
  onTextChange?: (text: string) => void;
}

function formatRecordingTime(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

export const ChatInput = forwardRef<ChatInputRef, ChatInputProps>(({
  onSend,
  onAttachmentPress,
  isInternalNote,
  onToggleInternalNote,
  onQuickMessagePress,
  onVoiceMessage,
  mentionedUsers,
  onRemoveMention,
  isSending,
  disabled,
  replyTo,
  onCancelReply,
  onTextChange,
}, ref) => {
  const [text, setText] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordingStartMs, setRecordingStartMs] = useState(0);

  const inputRef = useRef<TextInput>(null);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  const theme = useAppTheme();
  const { isRTL, writingDirection } = useRTL();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  useImperativeHandle(ref, () => ({
    insertText: (t: string) => {
      setText(t);
      setTimeout(() => inputRef.current?.focus(), 50);
    },
    focus: () => inputRef.current?.focus(),
    clear: () => setText(''),
  }));

  // Pulse animation while recording
  useEffect(() => {
    if (isRecording) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.4, duration: 600, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
        ]),
      );
      loop.start();
      return () => loop.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [isRecording, pulseAnim]);

  const hasText = text.trim().length > 0;

  const handleChangeText = useCallback((val: string) => {
    setText(val);
    onTextChange?.(val);
  }, [onTextChange]);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || isSending) return;
    onSend(trimmed);
    setText('');
  }, [text, isSending, onSend]);

  const startRecording = useCallback(async () => {
    if (!onVoiceMessage) return;
    try {
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          t('common.permissionDenied', 'הרשאה נדרשת'),
          t('chats.micPermission', 'יש לאפשר גישה למיקרופון בהגדרות'),
        );
        return;
      }
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });
      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY,
      );
      recordingRef.current = recording;
      const startMs = Date.now();
      setRecordingStartMs(startMs);
      setRecordingSeconds(0);
      setIsRecording(true);
      timerRef.current = setInterval(() => {
        setRecordingSeconds((s) => s + 1);
      }, 1000);
    } catch {
      Alert.alert(t('common.error'), t('chats.recordFailed', 'ההקלטה נכשלה'));
    }
  }, [onVoiceMessage, t]);

  const stopRecording = useCallback(async (cancelled = false) => {
    if (!recordingRef.current) return;
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setIsRecording(false);
    const durationMs = Date.now() - recordingStartMs;
    try {
      await recordingRef.current.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
      if (!cancelled) {
        const uri = recordingRef.current.getURI();
        if (uri && durationMs > 500) {
          onVoiceMessage?.(uri, durationMs);
        }
      }
    } catch {
      // ignore cleanup errors
    } finally {
      recordingRef.current = null;
      setRecordingSeconds(0);
    }
  }, [recordingStartMs, onVoiceMessage]);

  const containerBg = isInternalNote
    ? theme.dark ? '#3E3500' : '#FFF9C4'
    : theme.dark ? theme.custom.inputBackground : '#F0F2F5';

  const containerBorder = isInternalNote
    ? theme.dark ? '#FFE082' : '#FFB300'
    : 'transparent';

  return (
    <View
      style={[
        styles.outerContainer,
        {
          backgroundColor: theme.colors.surface,
          borderTopColor: theme.colors.outline,
          paddingBottom: Math.max(insets.bottom, Platform.OS === 'ios' ? 4 : 6),
        },
      ]}
    >
      {/* Reply preview */}
      {replyTo ? (
        <View style={[styles.replyPreview, { backgroundColor: theme.dark ? '#1e3a2a' : '#e8f5e9', borderLeftColor: '#2e6155' }]}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.replyName, { color: '#2e6155' }]} numberOfLines={1}>
              {replyTo.senderName}
            </Text>
            <Text style={[styles.replyText, { color: theme.colors.onSurfaceVariant }]} numberOfLines={2}>
              {replyTo.text}
            </Text>
          </View>
          <Pressable onPress={onCancelReply} hitSlop={8}>
            <MaterialCommunityIcons name="close" size={18} color={theme.colors.onSurfaceVariant} />
          </Pressable>
        </View>
      ) : null}

      {/* Internal note banner + mention pills */}
      {isInternalNote && (
        <View style={[styles.noteBannerWrap, { backgroundColor: theme.dark ? '#2A1F00' : '#FFF8E1' }]}>
          {/* Top row: label + close */}
          <View style={styles.noteBanner}>
            <MaterialCommunityIcons name="note-text" size={14} color={theme.dark ? '#FFE082' : '#E65100'} />
            <Text style={[styles.noteBannerText, { color: theme.dark ? '#FFE082' : '#E65100' }]}>
              {t('chats.internalNote', 'הערה פנימית')}
            </Text>
            <Text style={[styles.noteBannerHint, { color: theme.dark ? '#FFD54F' : '#BF6900' }]}>
              {t('chats.mentionHint', 'כתוב @ להזכיר משתמש')}
            </Text>
            <Pressable onPress={onToggleInternalNote} hitSlop={8} style={styles.noteBannerClose}>
              <MaterialCommunityIcons name="close" size={16} color={theme.dark ? '#FFE082' : '#E65100'} />
            </Pressable>
          </View>

          {/* Mentioned user pills */}
          {mentionedUsers && mentionedUsers.length > 0 && (
            <View style={styles.pillsRow}>
              {mentionedUsers.map((u) => (
                <View
                  key={u.userId}
                  style={[styles.pill, { backgroundColor: theme.dark ? '#5C4800' : '#FFE0B2' }]}
                >
                  <MaterialCommunityIcons name="account" size={12} color={theme.dark ? '#FFE082' : '#E65100'} />
                  <Text style={[styles.pillText, { color: theme.dark ? '#FFE082' : '#BF6900' }]} numberOfLines={1}>
                    {u.userName}
                  </Text>
                  <Pressable onPress={() => onRemoveMention?.(u.userId)} hitSlop={6}>
                    <MaterialCommunityIcons name="close" size={12} color={theme.dark ? '#FFE082' : '#E65100'} />
                  </Pressable>
                </View>
              ))}
            </View>
          )}
        </View>
      )}

      {/* Recording overlay */}
      {isRecording && (
        <View style={[styles.recordingBar, { backgroundColor: theme.dark ? '#1a0000' : '#fff3f3' }]}>
          <Animated.View style={[styles.recordingDot, { transform: [{ scale: pulseAnim }] }]} />
          <Text style={[styles.recordingTimer, { color: theme.colors.onSurface }]}>
            {formatRecordingTime(recordingSeconds)}
          </Text>
          <Text style={[styles.recordingHint, { color: theme.colors.onSurfaceVariant }]}>
            {t('chats.recording', 'מקליט...')}
          </Text>
          <Pressable
            onPress={() => stopRecording(true)}
            hitSlop={8}
            style={[styles.cancelRecordBtn, { borderColor: theme.colors.outline }]}
          >
            <MaterialCommunityIcons name="trash-can-outline" size={18} color={theme.colors.error} />
          </Pressable>
        </View>
      )}

      <View style={styles.row}>
        {/* Note toggle — hidden while recording */}
        {!isRecording && (
          <Pressable
            onPress={onToggleInternalNote}
            hitSlop={6}
            style={({ pressed }) => [
              styles.noteToggle,
              isInternalNote && { backgroundColor: theme.dark ? '#5C4800' : '#FFE0B2' },
              pressed && { opacity: 0.7 },
            ]}
          >
            <MaterialCommunityIcons
              name={isInternalNote ? 'note-text' : 'note-text-outline'}
              size={20}
              color={isInternalNote ? '#FF8F00' : theme.colors.onSurfaceVariant}
            />
          </Pressable>
        )}

        {/* Input container — hidden while recording */}
        {!isRecording ? (
          <View
            style={[
              styles.inputContainer,
              { backgroundColor: containerBg, borderColor: containerBorder },
            ]}
          >
            <Pressable
              onPress={onAttachmentPress}
              disabled={disabled}
              hitSlop={4}
              style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.6 }]}
            >
              <MaterialCommunityIcons
                name="attachment"
                size={22}
                color={theme.colors.onSurfaceVariant}
                style={{ transform: [{ rotate: '-45deg' }] }}
              />
            </Pressable>

            <TextInput
              ref={inputRef}
              value={text}
              onChangeText={handleChangeText}
              placeholder={isInternalNote ? t('chats.internalNote') : t('chats.typeMessage')}
              placeholderTextColor={theme.custom.placeholder}
              multiline
              maxLength={4096}
              editable={!disabled}
              style={[
                styles.input,
                {
                  color: theme.colors.onSurface,
                  textAlign: isRTL ? 'right' : 'left',
                  writingDirection,
                },
              ]}
              textAlignVertical="center"
            />

            {onQuickMessagePress && !hasText && (
              <Pressable
                onPress={onQuickMessagePress}
                hitSlop={4}
                style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.6 }]}
              >
                <MaterialCommunityIcons name="lightning-bolt" size={20} color={theme.colors.onSurfaceVariant} />
              </Pressable>
            )}
          </View>
        ) : (
          // Spacer so mic button stays on the right while recording
          <View style={{ flex: 1 }} />
        )}

        {/* Send / Mic button */}
        {hasText ? (
          <Pressable
            onPress={handleSend}
            disabled={isSending || disabled}
            style={({ pressed }) => [
              styles.sendBtn,
              { backgroundColor: theme.colors.primary, opacity: pressed ? 0.8 : 1 },
            ]}
          >
            <MaterialCommunityIcons name="send" size={20} color="#FFFFFF" />
          </Pressable>
        ) : (
          <Pressable
            onLongPress={startRecording}
            onPressOut={() => { if (isRecording) stopRecording(false); }}
            delayLongPress={200}
            disabled={disabled}
            style={({ pressed }) => [
              styles.sendBtn,
              {
                backgroundColor: isRecording
                  ? '#E53935'
                  : pressed
                  ? theme.colors.surfaceVariant
                  : theme.colors.surfaceVariant,
                transform: [{ scale: isRecording ? 1.15 : 1 }],
              },
            ]}
          >
            <MaterialCommunityIcons
              name={isRecording ? 'send' : 'microphone'}
              size={22}
              color={isRecording ? '#fff' : theme.colors.onSurfaceVariant}
            />
          </Pressable>
        )}
      </View>
    </View>
  );
});

ChatInput.displayName = 'ChatInput';

const styles = StyleSheet.create({
  outerContainer: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  replyPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderLeftWidth: 3,
    gap: 10,
  },
  replyName: { fontSize: 12, fontWeight: '700', marginBottom: 2 },
  replyText: { fontSize: 13, lineHeight: 17 },
  noteBannerWrap: {
    paddingBottom: 6,
  },
  noteBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  noteBannerText: {
    fontSize: 12,
    fontWeight: '600',
    marginStart: 6,
  },
  noteBannerHint: {
    fontSize: 11,
    marginStart: 8,
    flex: 1,
    fontStyle: 'italic',
  },
  noteBannerClose: { padding: 2 },
  pillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 12,
    gap: 6,
    paddingBottom: 2,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    paddingHorizontal: 8,
    paddingVertical: 4,
    gap: 4,
    maxWidth: 140,
  },
  pillText: {
    fontSize: 12,
    fontWeight: '600',
    flexShrink: 1,
  },
  recordingBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 10,
  },
  recordingDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#E53935',
  },
  recordingTimer: {
    fontSize: 16,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    minWidth: 44,
  },
  recordingHint: {
    flex: 1,
    fontSize: 13,
  },
  cancelRecordBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 6,
    paddingTop: 6,
    gap: 6,
  },
  noteToggle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  inputContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    borderRadius: 24,
    borderWidth: 1.5,
    paddingHorizontal: 4,
    minHeight: 44,
  },
  iconBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    flex: 1,
    fontSize: 15,
    lineHeight: 20,
    maxHeight: 108,
    paddingTop: Platform.OS === 'ios' ? 10 : 8,
    paddingBottom: Platform.OS === 'ios' ? 10 : 8,
    paddingHorizontal: 4,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
