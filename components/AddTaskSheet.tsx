import React, { useEffect, useState } from 'react';
import { View, StyleSheet, Modal, Pressable, ScrollView, Platform, Alert } from 'react-native';
import { Text, TextInput, Chip, Button, Switch } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import DateTimePicker, { DateTimePickerAndroid, DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../hooks/useAppTheme';
import { useRTL } from '../hooks/useRTL';
import { tasksApi } from '../services/api/tasks';

// Crash-proof date/time formatter. On Android (Hermes) `Date.toLocaleString(locale, { dateStyle, timeStyle })`
// can throw when full ICU/Intl isn't bundled, which closes the whole app in a release build (no error
// boundary). Try the rich formatter, fall back to a manual one.
function formatDateTimeSafe(value: Date | string | null | undefined, lang: string): string {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return typeof value === 'string' ? value : '';
  try {
    return d.toLocaleString(lang === 'he' ? 'he-IL' : 'en-US', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
}

export interface TaskRelatedTo {
  type: 'contact' | 'lead' | 'order' | 'case' | 'quote' | 'invoice' | string;
  entityId: string;
  entityName?: string;
}

interface Props {
  visible: boolean;
  onDismiss: () => void;
  onCreated?: () => void;
  organization: string;
  /** The acting / default assignee (current user). */
  user: any;
  relatedTo?: TaskRelatedTo;
  defaultTitle?: string;
  /** Phone of the related contact, if any (helps linking + reminders). */
  relatedPhone?: string;
}

/**
 * Reusable "Add Task" bottom sheet shared by contacts, orders, cases, leads, etc.
 * Defaults: assignee = current user, due = tomorrow 09:00, reminder ON aligned to due date,
 * and the task is auto-linked to the originating entity via `relatedTo`.
 */
export default function AddTaskSheet({
  visible,
  onDismiss,
  onCreated,
  organization,
  user,
  relatedTo,
  defaultTitle,
  relatedPhone,
}: Props) {
  const theme = useAppTheme();
  const { flexDirection, textAlign, isRTL } = useRTL();
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const insets = useSafeAreaInsets();

  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [dueObj, setDueObj] = useState<Date>(new Date());
  const [dueIso, setDueIso] = useState('');
  const [showDuePicker, setShowDuePicker] = useState(false);
  const [showDueTimePicker, setShowDueTimePicker] = useState(false);
  const [reminderEnabled, setReminderEnabled] = useState(true);
  const [reminderObj, setReminderObj] = useState<Date>(new Date());
  const [showReminderPicker, setShowReminderPicker] = useState(false);
  const [showReminderTimePicker, setShowReminderTimePicker] = useState(false);
  const [creating, setCreating] = useState(false);

  // Reset sensible defaults each time the sheet opens.
  useEffect(() => {
    if (!visible) return;
    const due = new Date();
    due.setDate(due.getDate() + 1);
    due.setHours(9, 0, 0, 0);
    setDueObj(due);
    setDueIso(due.toISOString());
    setReminderObj(new Date(due));
    setReminderEnabled(true);
    setTitle(defaultTitle ?? '');
    setPriority('medium');
  }, [visible, defaultTitle]);

  // ⚠️ ANDROID CRASH FIX: NEVER render <DateTimePicker> inside a React Native <Modal> on Android.
  // The native date/time dialog clashes with the modal host and the chained date→time flow throws
  // "IllegalStateException: Fragment already added", which closes the whole app. On Android we open
  // the pickers imperatively (date, then time); iOS keeps the inline spinner via the show* flags.
  const pickDateTimeAndroid = (current: Date, onPicked: (d: Date) => void) => {
    const base = current && !isNaN(current.getTime()) ? new Date(current) : new Date();
    try {
      DateTimePickerAndroid.open({
        value: base,
        mode: 'date',
        onChange: (e: DateTimePickerEvent, dateVal?: Date) => {
          if (e.type !== 'set' || !dateVal) return;
          const merged = new Date(base);
          merged.setFullYear(dateVal.getFullYear(), dateVal.getMonth(), dateVal.getDate());
          // Defer the time picker so it doesn't open while the date dialog's fragment is still attached
          // ("Fragment already added" -> app crash on some Android versions).
          setTimeout(() => {
            try {
              DateTimePickerAndroid.open({
                value: merged,
                mode: 'time',
                is24Hour: true,
                onChange: (e2: DateTimePickerEvent, timeVal?: Date) => {
                  if (e2.type !== 'set' || !timeVal) return;
                  merged.setHours(timeVal.getHours(), timeVal.getMinutes(), 0, 0);
                  onPicked(merged);
                },
              });
            } catch {
              onPicked(merged);
            }
          }, 150);
        },
      });
    } catch {
      // Picker unavailable — fail silently rather than crash.
    }
  };

  const handleCreate = async () => {
    if (!organization) return;
    const finalTitle = title.trim() || defaultTitle || t('tasks.task', 'משימה');
    const reminderIso = reminderEnabled
      ? (reminderObj?.toISOString() || dueIso || new Date().toISOString())
      : null;
    setCreating(true);
    try {
      await tasksApi.create(
        organization,
        {
          title: finalTitle,
          taskType: relatedTo?.type === 'contact' || relatedTo?.type === 'lead' ? 'phone_call' : 'general',
          status: 'open',
          priority,
          dueDate: dueIso || undefined,
          assignedToId: user?.uID || user?.userId || '',
          assignedToName: user?.fullname || user?.name || '',
          reminderEnabled: reminderEnabled || undefined,
          reminderDate: reminderIso,
          reminderDateUTC: reminderIso,
          reminderRecipientType: reminderEnabled ? 'assigned_user' : undefined,
          ...(relatedPhone ? { relatedContactPhone: relatedPhone } : {}),
          ...(relatedTo ? { relatedTo } : {}),
        } as any,
        user?.uID || user?.userId || '',
        user?.fullname || user?.name || 'Gambot',
      );
      onDismiss();
      onCreated?.();
      Alert.alert(t('tasks.taskCreated', 'המשימה נוצרה'));
    } catch {
      Alert.alert(t('common.error'));
    } finally {
      setCreating(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <Pressable style={styles.overlay} onPress={onDismiss}>
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={[styles.sheet, { backgroundColor: theme.colors.surface, paddingBottom: insets.bottom + 16 }]}
        >
          <Text variant="titleMedium" style={{ color: theme.colors.onSurface, fontWeight: '700', marginBottom: 12, textAlign }}>
            {t('tasks.addTask', 'הוסף משימה')}
          </Text>
          <ScrollView style={{ maxHeight: 440 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <TextInput
              label={t('tasks.taskTitle', 'כותרת')}
              value={title}
              onChangeText={setTitle}
              mode="outlined"
              placeholder={defaultTitle}
              style={{ marginBottom: 14, textAlign }}
              outlineColor={theme.colors.outline}
              activeOutlineColor={theme.colors.primary}
            />

            <Text variant="labelLarge" style={{ color: theme.colors.onSurface, marginBottom: 6, textAlign }}>
              {t('tasks.priority', 'עדיפות')}
            </Text>
            <View style={[styles.chipsRow, { flexDirection, marginBottom: 14 }]}>
              {(['low', 'medium', 'high'] as const).map((p) => {
                const pc = p === 'high' ? '#EF4444' : p === 'medium' ? '#F59E0B' : '#10B981';
                const active = priority === p;
                return (
                  <Chip
                    key={p}
                    selected={active}
                    onPress={() => setPriority(p)}
                    compact
                    style={[
                      styles.chip,
                      active
                        ? { backgroundColor: `${pc}20`, borderColor: pc, borderWidth: 1.5 }
                        : { backgroundColor: theme.colors.surfaceVariant, borderWidth: 1.5, borderColor: 'transparent' },
                    ]}
                    textStyle={[{ fontSize: 12 }, active ? { color: pc, fontWeight: '700' } : null]}
                  >
                    {t(`tasks.${p}`)}
                  </Chip>
                );
              })}
            </View>

            <Pressable
              onPress={() => {
                const d = dueIso ? new Date(dueIso) : new Date();
                const base = !isNaN(d.getTime()) ? d : new Date();
                setDueObj(base);
                if (Platform.OS === 'android') {
                  pickDateTimeAndroid(base, (picked) => {
                    setDueObj(picked);
                    setDueIso(picked.toISOString());
                  });
                } else {
                  setShowDuePicker(true);
                }
              }}
            >
              <View pointerEvents="none">
                <TextInput
                  label={t('tasks.dueDate', 'תאריך יעד')}
                  value={dueIso ? formatDateTimeSafe(dueIso, lang) : ''}
                  mode="outlined"
                  editable={false}
                  placeholder={t('tasks.selectDueDate', 'בחר תאריך ושעה')}
                  style={{ marginBottom: 14, textAlign }}
                  outlineColor={theme.colors.outline}
                  activeOutlineColor={theme.colors.primary}
                  right={<TextInput.Icon icon="calendar" />}
                />
              </View>
            </Pressable>

            {Platform.OS === 'ios' && showDuePicker && (
              <DateTimePicker
                value={dueObj}
                mode="date"
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                onChange={(_: DateTimePickerEvent, d?: Date) => {
                  setShowDuePicker(false);
                  if (d) {
                    const merged = new Date(dueObj);
                    merged.setFullYear(d.getFullYear(), d.getMonth(), d.getDate());
                    setDueObj(merged);
                    setShowDueTimePicker(true);
                  }
                }}
              />
            )}
            {Platform.OS === 'ios' && showDueTimePicker && (
              <DateTimePicker
                value={dueObj}
                mode="time"
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                onChange={(_: DateTimePickerEvent, d?: Date) => {
                  setShowDueTimePicker(false);
                  if (d) {
                    const merged = new Date(dueObj);
                    merged.setHours(d.getHours(), d.getMinutes());
                    setDueObj(merged);
                    setDueIso(merged.toISOString());
                  }
                }}
              />
            )}

            <View style={[styles.reminderRow, { flexDirection }]}>
              <View style={[{ alignItems: 'center', gap: 8, flexDirection }]}>
                <MaterialCommunityIcons name="bell-outline" size={20} color={theme.colors.primary} />
                <Text style={{ color: theme.colors.onSurface, fontWeight: '600' }}>{t('tasks.reminder', 'תזכורת')}</Text>
              </View>
              <Switch
                value={reminderEnabled}
                onValueChange={(val) => {
                  setReminderEnabled(val);
                  if (val && dueIso) {
                    const d = new Date(dueIso);
                    if (!isNaN(d.getTime())) setReminderObj(d);
                  }
                }}
                color={theme.colors.primary}
              />
            </View>

            {reminderEnabled && (
              <>
                <Pressable onPress={() => {
                  if (Platform.OS === 'android') {
                    pickDateTimeAndroid(reminderObj, (picked) => setReminderObj(picked));
                  } else {
                    setShowReminderPicker(true);
                  }
                }}>
                  <View pointerEvents="none">
                    <TextInput
                      label={t('tasks.reminderDateTime', 'תאריך ושעת תזכורת')}
                      value={formatDateTimeSafe(reminderObj, lang)}
                      mode="outlined"
                      editable={false}
                      style={{ marginBottom: 14, textAlign }}
                      outlineColor={theme.colors.outline}
                      activeOutlineColor={theme.colors.primary}
                      right={<TextInput.Icon icon="bell-ring-outline" />}
                    />
                  </View>
                </Pressable>
                {Platform.OS === 'ios' && showReminderPicker && (
                  <DateTimePicker
                    value={reminderObj}
                    mode="date"
                    display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                    onChange={(_: DateTimePickerEvent, d?: Date) => {
                      setShowReminderPicker(false);
                      if (d) {
                        const merged = new Date(reminderObj);
                        merged.setFullYear(d.getFullYear(), d.getMonth(), d.getDate());
                        setReminderObj(merged);
                        setShowReminderTimePicker(true);
                      }
                    }}
                  />
                )}
                {Platform.OS === 'ios' && showReminderTimePicker && (
                  <DateTimePicker
                    value={reminderObj}
                    mode="time"
                    display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                    onChange={(_: DateTimePickerEvent, d?: Date) => {
                      setShowReminderTimePicker(false);
                      if (d) {
                        const merged = new Date(reminderObj);
                        merged.setHours(d.getHours(), d.getMinutes());
                        setReminderObj(merged);
                      }
                    }}
                  />
                )}
              </>
            )}
          </ScrollView>

          <View style={[styles.actions, { flexDirection }]}>
            <Button mode="outlined" onPress={onDismiss} style={{ flex: 1 }} textColor={theme.colors.onSurfaceVariant}>
              {t('common.cancel')}
            </Button>
            <Button mode="contained" onPress={handleCreate} loading={creating} disabled={creating} style={{ flex: 1 }}>
              {t('common.save')}
            </Button>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 20, paddingTop: 18 },
  chipsRow: { gap: 8, flexWrap: 'wrap' },
  chip: { borderRadius: 18 },
  reminderRow: { alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  actions: { gap: 12, marginTop: 12 },
});
