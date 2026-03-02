import React, { useState, useRef, useCallback } from 'react';
import {
  View,
  StyleSheet,
  TextInput,
  Pressable,
  Platform,
} from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useRTL } from '../../hooks/useRTL';

interface ChatInputProps {
  onSend: (text: string) => void;
  onAttachmentPress: () => void;
  isInternalNote: boolean;
  onToggleInternalNote: () => void;
  onQuickMessagePress?: () => void;
  isSending?: boolean;
  disabled?: boolean;
}

export function ChatInput({
  onSend,
  onAttachmentPress,
  isInternalNote,
  onToggleInternalNote,
  onQuickMessagePress,
  isSending,
  disabled,
}: ChatInputProps) {
  const [text, setText] = useState('');
  const inputRef = useRef<TextInput>(null);
  const theme = useAppTheme();
  const { isRTL, writingDirection } = useRTL();
  const { t } = useTranslation();

  const hasText = text.trim().length > 0;

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || isSending) return;
    onSend(trimmed);
    setText('');
  }, [text, isSending, onSend]);

  const containerBg = isInternalNote
    ? theme.dark
      ? '#3E3500'
      : '#FFF9C4'
    : theme.dark
      ? theme.custom.inputBackground
      : '#F0F2F5';

  const containerBorder = isInternalNote
    ? theme.dark
      ? '#FFE082'
      : '#FFB300'
    : 'transparent';

  return (
    <View
      style={[
        styles.outerContainer,
        {
          backgroundColor: theme.colors.surface,
          borderTopColor: theme.colors.outline,
        },
      ]}
    >
      {isInternalNote && (
        <View
          style={[
            styles.noteBanner,
            {
              backgroundColor: theme.dark ? '#3E3500' : '#FFF3E0',
            },
          ]}
        >
          <MaterialCommunityIcons
            name="note-text"
            size={14}
            color={theme.dark ? '#FFE082' : '#E65100'}
          />
          <Text
            style={[
              styles.noteBannerText,
              { color: theme.dark ? '#FFE082' : '#E65100' },
            ]}
          >
            {t('chats.internalNote')}
          </Text>
          <Pressable
            onPress={onToggleInternalNote}
            hitSlop={8}
            style={styles.noteBannerClose}
          >
            <MaterialCommunityIcons
              name="close"
              size={16}
              color={theme.dark ? '#FFE082' : '#E65100'}
            />
          </Pressable>
        </View>
      )}

      <View style={styles.row}>
        <Pressable
          onPress={onToggleInternalNote}
          hitSlop={6}
          style={({ pressed }) => [
            styles.noteToggle,
            isInternalNote && {
              backgroundColor: theme.dark ? '#5C4800' : '#FFE0B2',
            },
            pressed && { opacity: 0.7 },
          ]}
        >
          <MaterialCommunityIcons
            name={isInternalNote ? 'note-text' : 'note-text-outline'}
            size={20}
            color={
              isInternalNote ? '#FF8F00' : theme.colors.onSurfaceVariant
            }
          />
        </Pressable>

        <View
          style={[
            styles.inputContainer,
            {
              backgroundColor: containerBg,
              borderColor: containerBorder,
            },
          ]}
        >
          <Pressable
            onPress={onAttachmentPress}
            disabled={disabled}
            hitSlop={4}
            style={({ pressed }) => [
              styles.iconBtn,
              pressed && { opacity: 0.6 },
            ]}
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
            onChangeText={setText}
            placeholder={
              isInternalNote
                ? t('chats.internalNote')
                : t('chats.typeMessage')
            }
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

          {onQuickMessagePress && (
            <Pressable
              onPress={onQuickMessagePress}
              hitSlop={4}
              style={({ pressed }) => [
                styles.iconBtn,
                pressed && { opacity: 0.6 },
              ]}
            >
              <MaterialCommunityIcons
                name="lightning-bolt"
                size={20}
                color={theme.colors.onSurfaceVariant}
              />
            </Pressable>
          )}
        </View>

        <Pressable
          onPress={hasText ? handleSend : undefined}
          disabled={isSending || disabled || !hasText}
          style={({ pressed }) => [
            styles.sendBtn,
            {
              backgroundColor: hasText
                ? theme.colors.primary
                : theme.colors.surfaceVariant,
              opacity: pressed && hasText ? 0.8 : 1,
            },
          ]}
        >
          <MaterialCommunityIcons
            name={hasText ? 'send' : 'microphone'}
            size={20}
            color={hasText ? '#FFFFFF' : theme.colors.onSurfaceVariant}
          />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outerContainer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingBottom: Platform.OS === 'ios' ? 4 : 6,
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
    flex: 1,
  },
  noteBannerClose: {
    padding: 2,
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
    marginBottom: 0,
  },
});
