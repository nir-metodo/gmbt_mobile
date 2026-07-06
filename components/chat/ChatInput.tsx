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
import type { WabaNumberInfo } from '../../types';

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
  activeWabaNumber?: string | null;
  wabaNumbers?: WabaNumberInfo[];
  onChangeWabaNumber?: (num: string) => void;
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
  activeWabaNumber,
  wabaNumbers,
  onChangeWabaNumber,
}, ref) => {
  const [text, setText] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordingStartMs, setRecordingStartMs] = useState(0);
  const [showNumberPicker, setShowNumberPicker] = useState(false);
  // Recorded-but-not-yet-sent voice clip (WhatsApp-style listen-before-send).
  const [recordedUri, setRecordedUri] = useState<string | null>(null);
  const [recordedDurationMs, setRecordedDurationMs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackPosMs, setPlaybackPosMs] = useState(0);

  const inputRef = useRef<TextInput>(null);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);
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

  const permissionGrantedRef = useRef(false);

  useEffect(() => {
    Audio.requestPermissionsAsync().then(({ status }) => {
      permissionGrantedRef.current = status === 'granted';
    });
  }, []);

  const startRecording = useCallback(async () => {
    if (!onVoiceMessage) return;
    try {
      if (!permissionGrantedRef.current) {
        const { status } = await Audio.requestPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert(
            t('common.permissionDenied', 'הרשאה נדרשת'),
            t('chats.micPermission', 'יש לאפשר גישה למיקרופון בהגדרות'),
          );
          return;
        }
        permissionGrantedRef.current = true;
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
          // Don't auto-send — surface a preview so the user can listen, delete, or send.
          setRecordedUri(uri);
          setRecordedDurationMs(durationMs);
        }
      }
    } catch {
    } finally {
      recordingRef.current = null;
      setRecordingSeconds(0);
    }
  }, [recordingStartMs]);

  const unloadSound = useCallback(async () => {
    if (soundRef.current) {
      try { await soundRef.current.unloadAsync(); } catch { /* ignore */ }
      soundRef.current = null;
    }
    setIsPlaying(false);
    setPlaybackPosMs(0);
  }, []);

  // Play / pause the recorded preview clip.
  const togglePlayback = useCallback(async () => {
    if (!recordedUri) return;
    try {
      if (soundRef.current) {
        const status = await soundRef.current.getStatusAsync();
        if (status.isLoaded) {
          if (status.isPlaying) {
            await soundRef.current.pauseAsync();
            setIsPlaying(false);
          } else {
            // Replay from start if it already finished.
            if ((status.positionMillis || 0) >= (status.durationMillis || recordedDurationMs) - 50) {
              await soundRef.current.playFromPositionAsync(0);
            } else {
              await soundRef.current.playAsync();
            }
            setIsPlaying(true);
          }
          return;
        }
      }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
      const { sound } = await Audio.Sound.createAsync({ uri: recordedUri }, { shouldPlay: true });
      soundRef.current = sound;
      setIsPlaying(true);
      sound.setOnPlaybackStatusUpdate((status) => {
        if (!status.isLoaded) return;
        setPlaybackPosMs(status.positionMillis || 0);
        if (status.didJustFinish) {
          setIsPlaying(false);
          setPlaybackPosMs(0);
        }
      });
    } catch { /* ignore playback errors */ }
  }, [recordedUri, recordedDurationMs]);

  const discardRecorded = useCallback(async () => {
    await unloadSound();
    setRecordedUri(null);
    setRecordedDurationMs(0);
  }, [unloadSound]);

  const sendRecorded = useCallback(async () => {
    if (!recordedUri) return;
    await unloadSound();
    const uri = recordedUri;
    const dur = recordedDurationMs;
    setRecordedUri(null);
    setRecordedDurationMs(0);
    onVoiceMessage?.(uri, dur);
  }, [recordedUri, recordedDurationMs, unloadSound, onVoiceMessage]);

  useEffect(() => () => { if (soundRef.current) { soundRef.current.unloadAsync().catch(() => {}); } }, []);

  const hasRecorded = !!recordedUri;

  const hasMultipleNumbers = wabaNumbers && wabaNumbers.length > 1;
  const activeNumInfo = wabaNumbers?.find((n) => (n.PhoneNumberId || n.phoneNumberId) === activeWabaNumber);
  const displayNumber = activeNumInfo?.Label || activeNumInfo?.label || activeNumInfo?.DisplayNumber || activeNumInfo?.displayNumber || (activeWabaNumber ? activeWabaNumber.slice(-4) : '');

  return (
    <View
      style={[
        styles.outerContainer,
        {
          backgroundColor: theme.dark ? '#1e293b' : '#f0ebe3',
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

      {/* Internal note banner removed per UX cleanup */}

      {/* Multi-number selector chip */}
      {hasMultipleNumbers && !isRecording && (
        <View style={styles.numberSelectorRow}>
          <Pressable
            onPress={() => setShowNumberPicker(!showNumberPicker)}
            style={[styles.numberChip, { backgroundColor: theme.dark ? '#334155' : '#e2e8f0' }]}
          >
            <MaterialCommunityIcons name="sim-outline" size={13} color={theme.colors.primary} />
            <Text style={{ fontSize: 11, color: theme.colors.primary, fontWeight: '600' }}>
              {displayNumber || t('chats.selectNumber', 'בחר מספר')}
            </Text>
            <MaterialCommunityIcons name="chevron-down" size={14} color={theme.colors.primary} />
          </Pressable>
          {showNumberPicker && (
            <View style={[styles.numberDropdown, { backgroundColor: theme.colors.surface, borderColor: theme.colors.outline }]}>
              {wabaNumbers!.map((num) => {
                const id = num.PhoneNumberId || num.phoneNumberId || '';
                const numLabel = num.Label || num.label || num.DisplayNumber || num.displayNumber || id;
                return (
                  <Pressable
                    key={id}
                    onPress={() => { onChangeWabaNumber?.(id); setShowNumberPicker(false); }}
                    style={({ pressed }) => [styles.numberDropdownItem, pressed && { backgroundColor: theme.colors.surfaceVariant }, id === activeWabaNumber && { backgroundColor: theme.dark ? '#1e3a32' : '#d1fae5' }]}
                  >
                    <MaterialCommunityIcons name={id === activeWabaNumber ? 'check-circle' : 'circle-outline'} size={16} color={theme.colors.primary} />
                    <Text style={{ fontSize: 13, color: theme.colors.onSurface, marginStart: 8 }}>{numLabel}</Text>
                  </Pressable>
                );
              })}
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
            <MaterialCommunityIcons name="trash-can-outline" size={18} color="#ef4444" />
          </Pressable>
        </View>
      )}

      <View style={[styles.row, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
        {/* Note toggle removed — timeline note accessible from header */}

        {/* Input container — WhatsApp style rounded */}
        {isRecording ? (
          <View style={{ flex: 1 }} />
        ) : hasRecorded ? (
          <View style={[styles.previewBar, { backgroundColor: theme.dark ? '#0f2a22' : '#eafaf1', flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
            <Pressable
              onPress={discardRecorded}
              hitSlop={8}
              style={[styles.cancelRecordBtn, { borderColor: theme.colors.outline }]}
            >
              <MaterialCommunityIcons name="trash-can-outline" size={18} color="#ef4444" />
            </Pressable>
            <Pressable onPress={togglePlayback} style={styles.playBtn}>
              <MaterialCommunityIcons name={isPlaying ? 'pause' : 'play'} size={20} color="#fff" style={{ marginStart: isPlaying ? 0 : 1 }} />
            </Pressable>
            <Text style={[styles.recordingTimer, { color: theme.colors.onSurface }]}>
              {formatRecordingTime(Math.round((isPlaying || playbackPosMs > 0 ? playbackPosMs : recordedDurationMs) / 1000))}
            </Text>
            <Text style={[styles.recordingHint, { color: theme.colors.onSurfaceVariant }]} numberOfLines={1}>
              {t('chats.voicePreview', 'האזן, מחק או שלח')}
            </Text>
          </View>
        ) : (
          <View
            style={[
              styles.inputContainer,
              {
                flexDirection: isRTL ? 'row-reverse' : 'row',
                backgroundColor: isInternalNote
                  ? (theme.dark ? '#3E3500' : '#FFF9C4')
                  : (theme.dark ? '#2a3942' : '#FFFFFF'),
                borderColor: isInternalNote
                  ? (theme.dark ? '#FFE082' : '#FFB300')
                  : 'transparent',
              },
            ]}
          >
            <Pressable
              onPress={onAttachmentPress}
              disabled={disabled}
              hitSlop={4}
              style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.6 }]}
            >
              <MaterialCommunityIcons
                name="plus"
                size={24}
                color={theme.dark ? '#8696a0' : '#54656f'}
              />
            </Pressable>

            <TextInput
              ref={inputRef}
              value={text}
              onChangeText={handleChangeText}
              placeholder={isInternalNote ? (isRTL ? 'הקלד @ לאזכורים...' : 'Type @ to mention...') : (isRTL ? 'הקלד @ לאזכורים, / להודעות מהירות...' : 'Type @ to mention, / for quick messages...')}
              placeholderTextColor={theme.dark ? '#8696a0' : '#667781'}
              multiline
              maxLength={4096}
              editable={!disabled}
              blurOnSubmit={false}
              returnKeyType="default"
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
                <MaterialCommunityIcons name="lightning-bolt" size={20} color={theme.dark ? '#8696a0' : '#54656f'} />
              </Pressable>
            )}
          </View>
        )}

        {/* Send / Mic button — circular WhatsApp style */}
        {hasText ? (
          <Pressable
            onPress={handleSend}
            disabled={isSending || disabled}
            style={({ pressed }) => [
              styles.sendBtn,
              { backgroundColor: pressed ? '#1a7a5e' : '#2e6155', opacity: isSending ? 0.6 : 1 },
            ]}
          >
            <MaterialCommunityIcons name="send" size={20} color="#FFFFFF" style={{ transform: [{ scaleX: isRTL ? -1 : 1 }] }} />
          </Pressable>
        ) : isRecording ? (
          <Pressable
            onPress={() => stopRecording(false)}
            style={[styles.sendBtn, { backgroundColor: '#E53935', transform: [{ scale: 1.15 }] }]}
          >
            <MaterialCommunityIcons name="stop" size={24} color="#fff" />
          </Pressable>
        ) : hasRecorded ? (
          <Pressable
            onPress={sendRecorded}
            disabled={isSending || disabled}
            style={({ pressed }) => [
              styles.sendBtn,
              { backgroundColor: pressed ? '#1a7a5e' : '#2e6155', opacity: isSending ? 0.6 : 1 },
            ]}
          >
            <MaterialCommunityIcons name="send" size={20} color="#FFFFFF" style={{ transform: [{ scaleX: isRTL ? -1 : 1 }] }} />
          </Pressable>
        ) : (
          <Pressable
            onPress={startRecording}
            disabled={disabled}
            style={({ pressed }) => [
              styles.sendBtn,
              { backgroundColor: pressed ? '#1a7a5e' : '#2e6155' },
            ]}
          >
            <MaterialCommunityIcons name="microphone" size={22} color="#FFFFFF" />
          </Pressable>
        )}
      </View>
    </View>
  );
});

ChatInput.displayName = 'ChatInput';

const styles = StyleSheet.create({
  outerContainer: {
    paddingTop: 4,
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
  numberSelectorRow: {
    paddingHorizontal: 12,
    paddingTop: 4,
    paddingBottom: 2,
  },
  numberChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
  },
  numberDropdown: {
    position: 'absolute',
    bottom: 36,
    left: 12,
    borderRadius: 10,
    borderWidth: 1,
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    zIndex: 100,
    minWidth: 180,
  },
  numberDropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(128,128,128,0.15)',
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
  previewBar: {
    flex: 1,
    alignItems: 'center',
    gap: 10,
    borderRadius: 24,
    paddingHorizontal: 8,
    minHeight: 44,
  },
  playBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#2e6155',
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
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
    alignItems: 'flex-end',
    borderRadius: 24,
    borderWidth: 1.5,
    paddingHorizontal: 4,
    minHeight: 44,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 0.5 },
    shadowOpacity: 0.04,
    shadowRadius: 1,
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
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
});
