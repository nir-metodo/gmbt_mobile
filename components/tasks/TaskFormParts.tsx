import React, { useEffect, useState } from 'react';
import {
  View,
  StyleSheet,
  Pressable,
  ScrollView,
  KeyboardAvoidingView,
  Keyboard,
  Platform,
  ActivityIndicator,
  TextInput as RNTextInput,
} from 'react-native';
import { Text, TextInput, Switch } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useRTL } from '../../hooks/useRTL';
import { withAlpha, getInitials } from '../../utils/formatters';
import GambotDateTimePicker from '../GambotDateTimePicker';

/**
 * Shared building blocks for the "create task" UIs (the AddTaskSheet bottom sheet and the
 * new-task modal on the Tasks screen) so both look and behave the same.
 */

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

// Same palette the tasks list uses for priorities.
export const TASK_PRIORITY_COLORS: Record<string, string> = {
  low: '#4CAF50',
  medium: '#FF9800',
  high: '#FF5722',
  urgent: '#F44336',
};

const MIN_TOUCH = 44;

// ─────────────────────────────── helpers ───────────────────────────────

const pad2 = (n: number) => n.toString().padStart(2, '0');

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function withDay(base: Date, day: Date): Date {
  const n = new Date(base);
  n.setFullYear(day.getFullYear(), day.getMonth(), day.getDate());
  return n;
}

function isValidDate(d: Date | null | undefined): d is Date {
  return !!d && !isNaN(d.getTime());
}

// Crash-proof date/time formatter. On Android (Hermes) `Date.toLocaleString(locale, { dateStyle, timeStyle })`
// can throw when full ICU/Intl isn't bundled, which closes the whole app in a release build.
export function formatDateTimeSafe(value: Date | string | null | undefined, lang: string): string {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return typeof value === 'string' ? value : '';
  try {
    return d.toLocaleString(lang === 'he' ? 'he-IL' : 'en-US', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }
}

function formatDayShort(d: Date, lang: string): string {
  try {
    return d.toLocaleDateString(lang === 'he' ? 'he-IL' : 'en-US', { weekday: 'short', day: 'numeric', month: 'short' });
  } catch {
    return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}`;
  }
}

const formatTime = (d: Date) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const s = Keyboard.addListener(showEvt, () => setVisible(true));
    const h = Keyboard.addListener(hideEvt, () => setVisible(false));
    return () => {
      s.remove();
      h.remove();
    };
  }, []);
  return visible;
}

// ─────────────────────────────── layout ───────────────────────────────

interface FrameProps {
  children: React.ReactNode;
  onBackdropPress?: () => void;
  /** Draw the dim backdrop (not needed when the host modal already dims the screen). */
  dim?: boolean;
}

/**
 * Bottom-sheet frame: full-size keyboard-avoiding container with the sheet pinned to the bottom.
 * The KeyboardAvoidingView is full-screen (not the sheet) so the sheet always rises above the keyboard
 * on both iOS (padding) and Android (height).
 */
export function TaskFormFrame({ children, onBackdropPress, dim = false }: FrameProps) {
  const theme = useAppTheme();
  return (
    <KeyboardAvoidingView style={styles.frame} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <Pressable
        style={[StyleSheet.absoluteFill, dim ? { backgroundColor: 'rgba(0,0,0,0.45)' } : null]}
        onPress={onBackdropPress}
        accessibilityRole="button"
      />
      <View style={[styles.sheet, { backgroundColor: theme.colors.surface }]}>{children}</View>
    </KeyboardAvoidingView>
  );
}

export function TaskFormHeader({ title, onClose }: { title: string; onClose: () => void }) {
  const theme = useAppTheme();
  const { flexDirection, textAlign } = useRTL();
  return (
    <View style={styles.headerWrap}>
      <View style={[styles.grabber, { backgroundColor: withAlpha(theme.colors.onSurface, 0.18) }]} />
      <View style={[styles.headerRow, { flexDirection }]}>
        <Text
          variant="titleLarge"
          numberOfLines={1}
          style={{ flex: 1, color: theme.colors.onSurface, fontWeight: '700', textAlign }}
        >
          {title}
        </Text>
        <Pressable
          onPress={onClose}
          hitSlop={8}
          accessibilityRole="button"
          style={[styles.closeBtn, { backgroundColor: withAlpha(theme.colors.onSurface, 0.06) }]}
        >
          <MaterialCommunityIcons name="close" size={20} color={theme.colors.onSurfaceVariant} />
        </Pressable>
      </View>
    </View>
  );
}

export function TaskFormBody({ children }: { children: React.ReactNode }) {
  return (
    <ScrollView
      style={styles.body}
      contentContainerStyle={styles.bodyContent}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  );
}

interface SubmitBarProps {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  accent?: string;
}

/** Full-width primary action pinned to the bottom of the sheet (respects the safe area). */
export function TaskFormSubmitBar({ label, onPress, loading, disabled, accent }: SubmitBarProps) {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const keyboardVisible = useKeyboardVisible();
  const color = accent || theme.colors.primary;
  const inactive = !!disabled || !!loading;
  return (
    <View
      style={[
        styles.submitBar,
        {
          borderTopColor: withAlpha(theme.colors.onSurface, 0.08),
          backgroundColor: theme.colors.surface,
          paddingBottom: (keyboardVisible ? 0 : insets.bottom) + 12,
        },
      ]}
    >
      <Pressable
        onPress={onPress}
        disabled={inactive}
        accessibilityRole="button"
        accessibilityLabel={label}
        android_ripple={{ color: 'rgba(255,255,255,0.25)' }}
        style={({ pressed }) => [
          styles.submitBtn,
          { backgroundColor: color, opacity: disabled ? 0.45 : pressed ? 0.88 : 1 },
        ]}
      >
        {loading ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <>
            <MaterialCommunityIcons name="check" size={20} color="#FFFFFF" />
            <Text style={styles.submitText}>{label}</Text>
          </>
        )}
      </Pressable>
    </View>
  );
}

// ─────────────────────────────── fields ───────────────────────────────

export function FormSectionLabel({ children, icon }: { children: React.ReactNode; icon?: IconName }) {
  const theme = useAppTheme();
  const { flexDirection, textAlign } = useRTL();
  return (
    <View style={[styles.sectionLabelRow, { flexDirection }]}>
      {icon ? <MaterialCommunityIcons name={icon} size={15} color={theme.colors.onSurfaceVariant} /> : null}
      <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 12, fontWeight: '700', textAlign }}>
        {children}
      </Text>
    </View>
  );
}

interface TitleInputProps {
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  hint?: string;
  hintTone?: 'error' | 'info';
  autoFocus?: boolean;
  accent?: string;
}

/** Big, borderless, multiline-friendly title input with an accent underline. */
export function TaskTitleInput({
  value,
  onChangeText,
  placeholder,
  hint,
  hintTone = 'info',
  autoFocus = true,
  accent,
}: TitleInputProps) {
  const theme = useAppTheme();
  const { textAlign, writingDirection } = useRTL();
  const [focused, setFocused] = useState(false);
  const color = accent || theme.colors.primary;
  const isError = hintTone === 'error' && !!hint;
  const lineColor = isError ? theme.colors.error : focused ? color : withAlpha(theme.colors.onSurface, 0.15);
  return (
    <View style={{ marginBottom: 20 }}>
      <RNTextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={withAlpha(theme.colors.onSurface, 0.35)}
        autoFocus={autoFocus}
        multiline
        scrollEnabled={false}
        textAlignVertical="top"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        selectionColor={color}
        style={[
          styles.titleInput,
          { color: theme.colors.onSurface, textAlign, writingDirection },
        ]}
      />
      <View style={[styles.titleLine, { backgroundColor: lineColor, height: focused || isError ? 2 : StyleSheet.hairlineWidth * 2 }]} />
      {hint ? (
        <Text
          style={{
            marginTop: 6,
            fontSize: 12,
            textAlign,
            color: isError ? theme.colors.error : theme.colors.onSurfaceVariant,
          }}
        >
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

/** Outlined paper text field with the sheet's rounded look. */
export function FormTextField(props: React.ComponentProps<typeof TextInput>) {
  const theme = useAppTheme();
  const { textAlign } = useRTL();
  const { style, ...rest } = props;
  return (
    <TextInput
      mode="outlined"
      outlineColor={withAlpha(theme.colors.onSurface, 0.18)}
      activeOutlineColor={theme.colors.primary}
      outlineStyle={{ borderRadius: 14 }}
      style={[{ textAlign, marginBottom: 14, backgroundColor: theme.colors.surface }, style]}
      {...rest}
    />
  );
}

// ─────────────────────────────── chips ───────────────────────────────

function Pill({
  label,
  icon,
  active,
  color,
  onPress,
  dot,
}: {
  label: string;
  icon?: IconName;
  active?: boolean;
  color: string;
  onPress: () => void;
  dot?: boolean;
}) {
  const theme = useAppTheme();
  const { flexDirection } = useRTL();
  const fg = active ? color : theme.colors.onSurfaceVariant;
  return (
    <Pressable
      onPress={onPress}
      hitSlop={{ top: 2, bottom: 2 }}
      accessibilityRole="button"
      accessibilityState={{ selected: !!active }}
      style={[
        styles.pill,
        { flexDirection },
        active
          ? { backgroundColor: withAlpha(color, 0.14), borderColor: color }
          : { backgroundColor: withAlpha(theme.colors.onSurface, 0.04), borderColor: withAlpha(theme.colors.onSurface, 0.1) },
      ]}
    >
      {dot ? <View style={[styles.dot, { backgroundColor: color }]} /> : null}
      {icon ? <MaterialCommunityIcons name={icon} size={16} color={fg} /> : null}
      <Text numberOfLines={1} style={{ color: active ? color : theme.colors.onSurface, fontSize: 13, fontWeight: active ? '700' : '500' }}>
        {label}
      </Text>
    </Pressable>
  );
}

export interface ChoiceOption {
  key: string;
  label: string;
  color?: string;
  icon?: IconName;
}

interface ChoiceChipsProps {
  options: ChoiceOption[];
  value: string;
  onChange: (key: string) => void;
  /** Equal-width chips filling the row (used for priority). Otherwise chips wrap. */
  segmented?: boolean;
  accent?: string;
}

export function ChoiceChips({ options, value, onChange, segmented, accent }: ChoiceChipsProps) {
  const theme = useAppTheme();
  const { flexDirection } = useRTL();
  const fallback = accent || theme.colors.primary;

  if (segmented) {
    return (
      <View style={[styles.segmented, { flexDirection, backgroundColor: withAlpha(theme.colors.onSurface, 0.05) }]}>
        {options.map((o) => {
          const c = o.color || fallback;
          const active = value === o.key;
          return (
            <Pressable
              key={o.key}
              onPress={() => onChange(o.key)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              style={[
                styles.segment,
                { flexDirection },
                active ? { backgroundColor: withAlpha(c, 0.16), borderColor: c } : { borderColor: 'transparent' },
              ]}
            >
              <View style={[styles.dot, { backgroundColor: c, opacity: active ? 1 : 0.55 }]} />
              <Text numberOfLines={1} style={{ color: active ? c : theme.colors.onSurfaceVariant, fontSize: 13, fontWeight: active ? '700' : '600' }}>
                {o.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    );
  }

  return (
    <View style={[styles.wrapRow, { flexDirection }]}>
      {options.map((o) => (
        <Pill
          key={o.key}
          label={o.label}
          icon={o.icon}
          color={o.color || fallback}
          active={value === o.key}
          onPress={() => onChange(o.key)}
        />
      ))}
    </View>
  );
}

// ─────────────────────────────── due date ───────────────────────────────

interface DueProps {
  value: Date | null;
  onChange: (d: Date) => void;
  /** When provided, the date can be cleared (tapping the active quick chip clears it, picker shows "Clear"). */
  onClear?: () => void;
  title?: string;
  accent?: string;
}

/**
 * Quick-pick due date: Today / Tomorrow / Next week / custom date + a compact time chip.
 * Custom picks reuse GambotDateTimePicker. Quick picks keep the current time of day.
 */
export function DueQuickPicks({ value, onChange, onClear, title, accent }: DueProps) {
  const theme = useAppTheme();
  const { flexDirection, isRTL } = useRTL();
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const [picker, setPicker] = useState<null | 'datetime' | 'time'>(null);
  const color = accent || theme.colors.primary;
  const tr = (he: string, en: string) => (isRTL ? he : en);

  const valid = isValidDate(value) ? value : null;
  const base = valid ?? (() => { const d = new Date(); d.setHours(9, 0, 0, 0); return d; })();
  const today = new Date();
  const quick = [
    { key: 'today', label: tr('היום', 'Today'), day: today },
    { key: 'tomorrow', label: tr('מחר', 'Tomorrow'), day: addDays(today, 1) },
    { key: 'week', label: tr('בעוד שבוע', 'Next week'), day: addDays(today, 7) },
  ];
  const activeKey = valid ? quick.find((q) => sameDay(valid, q.day))?.key : undefined;
  const isCustom = !!valid && !activeKey;

  return (
    <View>
      <View style={[styles.wrapRow, { flexDirection }]}>
        {quick.map((q) => (
          <Pill
            key={q.key}
            label={q.label}
            color={color}
            active={activeKey === q.key}
            onPress={() => {
              if (activeKey === q.key && onClear) onClear();
              else onChange(withDay(base, q.day));
            }}
          />
        ))}
        <Pill
          label={isCustom && valid ? formatDayShort(valid, lang) : tr('בחר תאריך…', 'Pick date…')}
          icon="calendar-month-outline"
          color={color}
          active={isCustom}
          onPress={() => setPicker('datetime')}
        />
        {valid ? (
          <Pill
            label={formatTime(valid)}
            icon="clock-outline"
            color={color}
            active
            onPress={() => setPicker('time')}
          />
        ) : null}
      </View>

      <GambotDateTimePicker
        visible={picker === 'datetime'}
        value={valid ?? base}
        title={title}
        allowClear={!!onClear}
        onConfirm={(d) => onChange(d)}
        onClear={onClear}
        onDismiss={() => setPicker(null)}
      />
      <GambotDateTimePicker
        visible={picker === 'time'}
        mode="time"
        value={valid ?? base}
        title={tr('שעה', 'Time')}
        onConfirm={(d) => {
          const n = new Date(base);
          n.setHours(d.getHours(), d.getMinutes(), 0, 0);
          onChange(n);
        }}
        onDismiss={() => setPicker(null)}
      />
    </View>
  );
}

// ─────────────────────────────── rows ───────────────────────────────

interface FormRowProps {
  label: string;
  value?: string;
  placeholder?: string;
  icon?: IconName;
  /** When set, an initials avatar is shown instead of the icon. */
  avatarText?: string;
  onPress?: () => void;
  /** Shows a clear (x) button instead of the chevron when there is a value. */
  onClear?: () => void;
  chevron?: 'side' | 'down' | 'up' | 'none';
  accent?: string;
}

/** Compact tappable row: leading avatar/icon, small label + value, trailing chevron. */
export function FormRow({
  label,
  value,
  placeholder,
  icon,
  avatarText,
  onPress,
  onClear,
  chevron = 'side',
  accent,
}: FormRowProps) {
  const theme = useAppTheme();
  const { flexDirection, textAlign, isRTL } = useRTL();
  const color = accent || theme.colors.primary;
  const hasValue = !!value;
  const chevronName: IconName | null =
    chevron === 'none'
      ? null
      : chevron === 'down'
        ? 'chevron-down'
        : chevron === 'up'
          ? 'chevron-up'
          : isRTL
            ? 'chevron-left'
            : 'chevron-right';

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      style={({ pressed }) => [
        styles.row,
        {
          flexDirection,
          backgroundColor: withAlpha(theme.colors.onSurface, pressed ? 0.08 : 0.04),
          borderColor: withAlpha(theme.colors.onSurface, 0.08),
        },
      ]}
    >
      <View style={[styles.rowAvatar, { backgroundColor: withAlpha(color, 0.14) }]}>
        {avatarText ? (
          <Text style={{ color, fontSize: 13, fontWeight: '800' }}>{getInitials(avatarText)}</Text>
        ) : (
          <MaterialCommunityIcons name={icon || 'account'} size={20} color={color} />
        )}
      </View>
      <View style={styles.rowTextWrap}>
        <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 11, fontWeight: '600', textAlign }}>{label}</Text>
        <Text
          numberOfLines={1}
          style={{
            color: hasValue ? theme.colors.onSurface : theme.colors.onSurfaceVariant,
            fontSize: 15,
            fontWeight: hasValue ? '600' : '400',
            textAlign,
          }}
        >
          {hasValue ? value : placeholder}
        </Text>
      </View>
      {onClear && hasValue ? (
        <Pressable onPress={onClear} hitSlop={10} style={styles.rowTrailing} accessibilityRole="button">
          <MaterialCommunityIcons name="close-circle" size={20} color={theme.colors.onSurfaceVariant} />
        </Pressable>
      ) : chevronName ? (
        <MaterialCommunityIcons name={chevronName} size={22} color={theme.colors.onSurfaceVariant} />
      ) : null}
    </Pressable>
  );
}

interface UserPickerListProps {
  users: Array<{ id: string; name: string }>;
  selectedId: string;
  onSelect: (id: string, name: string) => void;
  loading?: boolean;
  /** When provided an extra "none" entry is shown first. */
  noneLabel?: string;
  onSelectNone?: () => void;
  accent?: string;
}

export function UserPickerList({ users, selectedId, onSelect, loading, noneLabel, onSelectNone, accent }: UserPickerListProps) {
  const theme = useAppTheme();
  const { flexDirection, textAlign, isRTL } = useRTL();
  const { t } = useTranslation();
  const color = accent || theme.colors.primary;
  return (
    <View style={[styles.userList, { borderColor: withAlpha(theme.colors.onSurface, 0.1) }]}>
      <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled" style={{ maxHeight: 224 }}>
        {loading && users.length === 0 ? (
          <Text style={{ color: theme.colors.onSurfaceVariant, padding: 14, textAlign }}>
            {t('common.loading', isRTL ? 'טוען...' : 'Loading...')}
          </Text>
        ) : null}
        {noneLabel && onSelectNone ? (
          <Pressable onPress={onSelectNone} style={[styles.userRow, { flexDirection }]}>
            <View style={[styles.userAvatar, { backgroundColor: withAlpha(theme.colors.onSurface, 0.08) }]}>
              <MaterialCommunityIcons name="account-off-outline" size={16} color={theme.colors.onSurfaceVariant} />
            </View>
            <Text style={{ flex: 1, textAlign, color: theme.colors.onSurfaceVariant }}>{noneLabel}</Text>
          </Pressable>
        ) : null}
        {users.map((u) => {
          const active = u.id === selectedId;
          return (
            <Pressable
              key={u.id}
              onPress={() => onSelect(u.id, u.name)}
              style={[styles.userRow, { flexDirection }, active ? { backgroundColor: withAlpha(color, 0.1) } : null]}
            >
              <View style={[styles.userAvatar, { backgroundColor: withAlpha(color, active ? 0.2 : 0.1) }]}>
                <Text style={{ color, fontSize: 11, fontWeight: '800' }}>{getInitials(u.name)}</Text>
              </View>
              <Text
                numberOfLines={1}
                style={{ flex: 1, textAlign, color: active ? color : theme.colors.onSurface, fontWeight: active ? '700' : '500' }}
              >
                {u.name}
              </Text>
              {active ? <MaterialCommunityIcons name="check" size={18} color={color} /> : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

// ─────────────────────────────── details / reminder ───────────────────────────────

interface MoreToggleProps {
  expanded: boolean;
  onToggle: () => void;
  /** Short text shown while collapsed (e.g. "Reminder on"). */
  summary?: string;
  accent?: string;
}

export function MoreDetailsToggle({ expanded, onToggle, summary, accent }: MoreToggleProps) {
  const theme = useAppTheme();
  const { flexDirection, textAlign, isRTL } = useRTL();
  const color = accent || theme.colors.primary;
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      style={[styles.moreToggle, { flexDirection, borderTopColor: withAlpha(theme.colors.onSurface, 0.08) }]}
    >
      <MaterialCommunityIcons name="tune-variant" size={18} color={color} />
      <View style={{ flex: 1 }}>
        <Text style={{ color, fontWeight: '700', fontSize: 14, textAlign }}>
          {isRTL ? 'פרטים נוספים' : 'More details'}
        </Text>
        {!expanded && summary ? (
          <Text numberOfLines={1} style={{ color: theme.colors.onSurfaceVariant, fontSize: 12, textAlign }}>
            {summary}
          </Text>
        ) : null}
      </View>
      <MaterialCommunityIcons name={expanded ? 'chevron-up' : 'chevron-down'} size={22} color={color} />
    </Pressable>
  );
}

interface ReminderProps {
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  value: Date;
  onChange: (d: Date) => void;
  accent?: string;
}

/** Reminder switch with a compact date/time chip (opens GambotDateTimePicker). */
export function ReminderRow({ enabled, onToggle, value, onChange, accent }: ReminderProps) {
  const theme = useAppTheme();
  const { flexDirection, textAlign, isRTL } = useRTL();
  const { t, i18n } = useTranslation();
  const [showPicker, setShowPicker] = useState(false);
  const color = accent || theme.colors.primary;
  return (
    <View
      style={[
        styles.reminderCard,
        { backgroundColor: withAlpha(theme.colors.onSurface, 0.04), borderColor: withAlpha(theme.colors.onSurface, 0.08) },
      ]}
    >
      <View style={[styles.reminderTop, { flexDirection }]}>
        <View style={[styles.rowAvatar, { backgroundColor: withAlpha(color, 0.14) }]}>
          <MaterialCommunityIcons name="bell-outline" size={20} color={color} />
        </View>
        <Text style={{ flex: 1, color: theme.colors.onSurface, fontWeight: '600', fontSize: 15, textAlign }}>
          {t('tasks.reminder', isRTL ? 'תזכורת' : 'Reminder')}
        </Text>
        <Switch value={enabled} onValueChange={onToggle} color={color} />
      </View>
      {enabled ? (
        <View style={[styles.wrapRow, { flexDirection, marginTop: 10 }]}>
          <Pill
            label={formatDateTimeSafe(value, i18n.language)}
            icon="bell-ring-outline"
            color={color}
            active
            onPress={() => setShowPicker(true)}
          />
        </View>
      ) : null}
      <GambotDateTimePicker
        visible={showPicker}
        value={value}
        title={t('tasks.reminderDateTime', isRTL ? 'תאריך ושעת תזכורת' : 'Reminder date & time')}
        onConfirm={(d) => onChange(d)}
        onDismiss={() => setShowPicker(false)}
      />
    </View>
  );
}

// ─────────────────────────────── styles ───────────────────────────────

const styles = StyleSheet.create({
  frame: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '94%',
    overflow: 'hidden',
  },
  headerWrap: { paddingTop: 8, paddingHorizontal: 20, paddingBottom: 4 },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginBottom: 8 },
  headerRow: { alignItems: 'center', gap: 12, minHeight: MIN_TOUCH },
  closeBtn: { width: MIN_TOUCH - 4, height: MIN_TOUCH - 4, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  body: { flexGrow: 0, flexShrink: 1 },
  bodyContent: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16 },
  submitBar: { paddingHorizontal: 20, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
  submitBtn: {
    height: 54,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  submitText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  sectionLabelRow: { alignItems: 'center', gap: 6, marginBottom: 8 },
  titleInput: { fontSize: 22, fontWeight: '700', minHeight: 52, paddingVertical: 8, paddingHorizontal: 0 },
  titleLine: { borderRadius: 1 },
  wrapRow: { flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  pill: {
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  segmented: { borderRadius: 16, padding: 4, gap: 4 },
  segment: {
    flex: 1,
    minHeight: MIN_TOUCH,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 4,
  },
  row: {
    minHeight: 60,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth * 2,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: 'center',
    gap: 12,
  },
  rowAvatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  rowTextWrap: { flex: 1, justifyContent: 'center' },
  rowTrailing: { width: MIN_TOUCH - 8, height: MIN_TOUCH - 8, alignItems: 'center', justifyContent: 'center' },
  userList: { borderWidth: 1, borderRadius: 14, marginTop: 8, overflow: 'hidden' },
  userRow: { minHeight: 48, alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 12 },
  userAvatar: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  moreToggle: {
    minHeight: 56,
    alignItems: 'center',
    gap: 10,
    borderTopWidth: StyleSheet.hairlineWidth * 2,
    marginTop: 8,
  },
  reminderCard: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth * 2, padding: 12, marginBottom: 14 },
  reminderTop: { alignItems: 'center', gap: 12 },
});
