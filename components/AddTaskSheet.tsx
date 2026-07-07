import React, { useEffect, useState } from 'react';
import { View, StyleSheet, Modal, Pressable, ScrollView, Alert } from 'react-native';
import { Text, TextInput, Chip, Button, Switch } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../hooks/useAppTheme';
import { useRTL } from '../hooks/useRTL';
import { tasksApi } from '../services/api/tasks';
import { usersApi } from '../services/api/users';
import GambotDateTimePicker from './GambotDateTimePicker';
import type { OrgUser } from '../types';

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
 * Defaults: assignee = current user, due = now (current date & time), reminder ON aligned to due
 * date, and the task is auto-linked to the originating entity via `relatedTo`.
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
  const [reminderEnabled, setReminderEnabled] = useState(true);
  const [reminderObj, setReminderObj] = useState<Date>(new Date());
  const [showReminderPicker, setShowReminderPicker] = useState(false);
  const [creating, setCreating] = useState(false);

  // Assignee (responsible user) — defaults to the current user, changeable from a picker.
  const [assignedToId, setAssignedToId] = useState('');
  const [assignedToName, setAssignedToName] = useState('');
  const [orgUsers, setOrgUsers] = useState<OrgUser[]>([]);
  const [userPickerExpanded, setUserPickerExpanded] = useState(false);

  // "Additional details" — collapsed by default, mirroring the web TaskForm. Holds the optional
  // description / task type / category / tags so the default view stays minimal.
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [description, setDescription] = useState('');
  const [taskType, setTaskType] = useState<string>('general');
  const [category, setCategory] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');

  const TASK_TYPES: Array<{ key: string; he: string; en: string; icon: string }> = [
    { key: 'phone_call', he: 'שיחת טלפון', en: 'Phone call', icon: '📞' },
    { key: 'follow_up', he: 'מעקב', en: 'Follow up', icon: '📧' },
    { key: 'meeting', he: 'פגישה', en: 'Meeting', icon: '🤝' },
    { key: 'general', he: 'כללי', en: 'General', icon: '📝' },
  ];

  const addTag = () => {
    const v = tagInput.trim();
    if (v && !tags.includes(v)) setTags((prev) => [...prev, v]);
    setTagInput('');
  };
  const removeTag = (tag: string) => setTags((prev) => prev.filter((tg) => tg !== tag));

  // Reset sensible defaults each time the sheet opens.
  useEffect(() => {
    if (!visible) return;
    // Default due date + reminder to "now" (current date & time) so the user only nudges it to the
    // nearest convenient time instead of dialing back from some arbitrary future default.
    const due = new Date();
    setDueObj(due);
    setDueIso(due.toISOString());
    setReminderObj(new Date(due));
    setReminderEnabled(true);
    setTitle(defaultTitle ?? '');
    setPriority('medium');
    setShowDuePicker(false);
    setShowReminderPicker(false);
    setUserPickerExpanded(false);
    setAssignedToId(user?.uID || user?.userId || '');
    setAssignedToName(user?.fullname || user?.name || '');
    // Additional details reset to a clean, collapsed state.
    setDetailsExpanded(false);
    setDescription('');
    setCategory('');
    setTags([]);
    setTagInput('');
    setTaskType(relatedTo?.type === 'contact' || relatedTo?.type === 'lead' ? 'phone_call' : 'general');
  }, [visible, defaultTitle, user, relatedTo]);

  // Lazily load the org users so the assignee can be switched to a teammate.
  useEffect(() => {
    if (!visible || !organization || orgUsers.length > 0) return;
    usersApi.getAll(organization).then(setOrgUsers).catch(() => {});
  }, [visible, organization, orgUsers.length]);

  // Keep the reminder aligned with the due date: when the due date moves, shift the reminder by the
  // same amount so the gap the user chose is preserved (initially the gap is zero, so they match).
  // Editing the reminder alone leaves a deliberate gap, exactly as the user expects.
  const applyDueChange = (picked: Date, prevDue: Date) => {
    if (!picked || isNaN(picked.getTime())) return;
    const base = prevDue && !isNaN(prevDue.getTime()) ? prevDue : picked;
    const delta = picked.getTime() - base.getTime();
    setDueObj(picked);
    setDueIso(picked.toISOString());
    setReminderObj((prev) => {
      const ref = prev && !isNaN(prev.getTime()) ? prev : new Date(picked);
      const shifted = new Date(ref.getTime() + delta);
      return isNaN(shifted.getTime()) ? new Date(picked) : shifted;
    });
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
          taskType: taskType || (relatedTo?.type === 'contact' || relatedTo?.type === 'lead' ? 'phone_call' : 'general'),
          status: 'open',
          priority,
          dueDate: dueIso || undefined,
          assignedToId: assignedToId || user?.uID || user?.userId || '',
          assignedToName: assignedToName || user?.fullname || user?.name || '',
          reminderEnabled: reminderEnabled || undefined,
          reminderDate: reminderIso,
          reminderDateUTC: reminderIso,
          reminderRecipientType: reminderEnabled ? 'assigned_user' : undefined,
          // Optional "additional details" — only sent when filled.
          ...(description.trim() ? { description: description.trim() } : {}),
          ...(category.trim() ? { category: category.trim() } : {}),
          ...(tags.length > 0 ? { tags } : {}),
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

            {/* Assignee / responsible user — defaults to the current user, tap to change. */}
            <Text variant="labelLarge" style={{ color: theme.colors.onSurface, marginBottom: 6, textAlign }}>
              {t('tasks.assignedTo', 'אחראי')}
            </Text>
            <Pressable onPress={() => setUserPickerExpanded((v) => !v)}>
              <View pointerEvents="none">
                <TextInput
                  value={assignedToName || t('tasks.unassigned', 'ללא')}
                  mode="outlined"
                  editable={false}
                  style={{ marginBottom: userPickerExpanded ? 4 : 14, textAlign }}
                  outlineColor={theme.colors.outline}
                  activeOutlineColor={theme.colors.primary}
                  left={<TextInput.Icon icon="account" />}
                  right={<TextInput.Icon icon={userPickerExpanded ? 'chevron-up' : 'chevron-down'} />}
                />
              </View>
            </Pressable>
            {userPickerExpanded && (
              <View style={[styles.userList, { borderColor: theme.colors.outline, backgroundColor: theme.colors.surfaceVariant }]}>
                {orgUsers.length === 0 ? (
                  <Text style={{ color: theme.colors.onSurfaceVariant, padding: 12, textAlign }}>
                    {t('common.loading', 'טוען...')}
                  </Text>
                ) : (
                  orgUsers.map((u) => {
                    const id = u.uID || u.userId || '';
                    const name = u.fullname || u.name || u.userName || u.email || id;
                    const active = id === assignedToId;
                    return (
                      <Pressable
                        key={id}
                        onPress={() => {
                          setAssignedToId(id);
                          setAssignedToName(name);
                          setUserPickerExpanded(false);
                        }}
                        style={[styles.userRow, { flexDirection }, active ? { backgroundColor: `${theme.colors.primary}1A` } : null]}
                      >
                        <Text style={{ color: active ? theme.colors.primary : theme.colors.onSurface, fontWeight: active ? '700' : '500' }}>
                          {name}
                        </Text>
                        {active && <MaterialCommunityIcons name="check" size={18} color={theme.colors.primary} />}
                      </Pressable>
                    );
                  })
                )}
              </View>
            )}

            <Pressable
              onPress={() => {
                setShowReminderPicker(false);
                setShowDuePicker(true);
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
              <Pressable onPress={() => {
                setShowDuePicker(false);
                setShowReminderPicker(true);
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
            )}

            {/* Additional details — collapsed by default (mirrors the web TaskForm). */}
            <Pressable
              onPress={() => setDetailsExpanded((v) => !v)}
              style={[styles.detailsToggle, { flexDirection }]}
            >
              <MaterialCommunityIcons
                name={detailsExpanded ? 'chevron-down' : (isRTL ? 'chevron-left' : 'chevron-right')}
                size={20}
                color={theme.colors.primary}
              />
              <Text style={{ color: theme.colors.primary, fontWeight: '700' }}>
                {isRTL ? 'פרטים נוספים' : 'Additional details'}
              </Text>
            </Pressable>

            {detailsExpanded && (
              <View style={{ marginTop: 4 }}>
                {/* Description */}
                <TextInput
                  label={isRTL ? 'תיאור' : 'Description'}
                  value={description}
                  onChangeText={setDescription}
                  mode="outlined"
                  multiline
                  numberOfLines={3}
                  style={{ marginBottom: 14, textAlign }}
                  outlineColor={theme.colors.outline}
                  activeOutlineColor={theme.colors.primary}
                />

                {/* Task type */}
                <Text variant="labelLarge" style={{ color: theme.colors.onSurface, marginBottom: 6, textAlign }}>
                  {isRTL ? 'סוג משימה' : 'Task type'}
                </Text>
                <View style={[styles.chipsRow, { flexDirection, marginBottom: 14 }]}>
                  {TASK_TYPES.map((tt) => {
                    const active = taskType === tt.key;
                    return (
                      <Chip
                        key={tt.key}
                        selected={active}
                        onPress={() => setTaskType(tt.key)}
                        compact
                        style={[
                          styles.chip,
                          active
                            ? { backgroundColor: `${theme.colors.primary}20`, borderColor: theme.colors.primary, borderWidth: 1.5 }
                            : { backgroundColor: theme.colors.surfaceVariant, borderWidth: 1.5, borderColor: 'transparent' },
                        ]}
                        textStyle={[{ fontSize: 12 }, active ? { color: theme.colors.primary, fontWeight: '700' } : null]}
                      >
                        {`${tt.icon} ${isRTL ? tt.he : tt.en}`}
                      </Chip>
                    );
                  })}
                </View>

                {/* Category */}
                <TextInput
                  label={isRTL ? 'קטגוריה' : 'Category'}
                  value={category}
                  onChangeText={setCategory}
                  mode="outlined"
                  style={{ marginBottom: 14, textAlign }}
                  outlineColor={theme.colors.outline}
                  activeOutlineColor={theme.colors.primary}
                />

                {/* Tags */}
                <Text variant="labelLarge" style={{ color: theme.colors.onSurface, marginBottom: 6, textAlign }}>
                  {isRTL ? 'תיוגים' : 'Tags'}
                </Text>
                <TextInput
                  value={tagInput}
                  onChangeText={setTagInput}
                  onSubmitEditing={addTag}
                  blurOnSubmit={false}
                  returnKeyType="done"
                  mode="outlined"
                  placeholder={isRTL ? 'הקלד תיוג והוסף...' : 'Type a tag and add...'}
                  style={{ marginBottom: tags.length > 0 ? 8 : 14, textAlign }}
                  outlineColor={theme.colors.outline}
                  activeOutlineColor={theme.colors.primary}
                  right={<TextInput.Icon icon="plus" onPress={addTag} />}
                />
                {tags.length > 0 && (
                  <View style={[styles.chipsRow, { flexDirection, marginBottom: 14 }]}>
                    {tags.map((tag) => (
                      <Chip
                        key={tag}
                        compact
                        onClose={() => removeTag(tag)}
                        style={[styles.chip, { backgroundColor: theme.colors.surfaceVariant }]}
                        textStyle={{ fontSize: 12 }}
                      >
                        {tag}
                      </Chip>
                    ))}
                  </View>
                )}
              </View>
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

      <GambotDateTimePicker
        visible={showDuePicker}
        value={dueIso || dueObj}
        title={t('tasks.dueDate', 'תאריך יעד')}
        onConfirm={(d) => applyDueChange(d, dueObj)}
        onDismiss={() => setShowDuePicker(false)}
      />
      <GambotDateTimePicker
        visible={showReminderPicker}
        value={reminderObj}
        title={t('tasks.reminderDateTime', 'תאריך ושעת תזכורת')}
        onConfirm={(d) => setReminderObj(d)}
        onDismiss={() => setShowReminderPicker(false)}
      />
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
  userList: { borderWidth: 1, borderRadius: 10, marginBottom: 14, overflow: 'hidden' },
  userRow: { alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, paddingHorizontal: 14 },
  detailsToggle: { alignItems: 'center', gap: 6, paddingVertical: 10, marginBottom: 2 },
});
