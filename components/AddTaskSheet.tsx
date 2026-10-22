import React, { useEffect, useState } from 'react';
import { View, StyleSheet, Modal, Alert } from 'react-native';
import { Chip, TextInput } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../hooks/useAppTheme';
import { useRTL } from '../hooks/useRTL';
import { tasksApi } from '../services/api/tasks';
import { usersApi } from '../services/api/users';
import type { OrgUser } from '../types';
import {
  TASK_PRIORITY_COLORS,
  TaskFormFrame,
  TaskFormHeader,
  TaskFormBody,
  TaskFormSubmitBar,
  TaskTitleInput,
  FormSectionLabel,
  FormTextField,
  ChoiceChips,
  DueQuickPicks,
  FormRow,
  UserPickerList,
  MoreDetailsToggle,
  ReminderRow,
  formatDateTimeSafe,
} from './tasks/TaskFormParts';

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

const RELATED_META: Record<string, { icon: any; he: string; en: string }> = {
  contact: { icon: 'account-outline', he: 'איש קשר', en: 'Contact' },
  lead: { icon: 'chart-line', he: 'ליד', en: 'Lead' },
  order: { icon: 'package-variant-closed', he: 'הזמנה', en: 'Order' },
  case: { icon: 'briefcase-outline', he: 'פנייה', en: 'Case' },
  quote: { icon: 'file-document-outline', he: 'הצעת מחיר', en: 'Quote' },
  invoice: { icon: 'receipt', he: 'חשבונית', en: 'Invoice' },
};

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
  const { isRTL } = useRTL();
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const tr = (he: string, en: string) => (isRTL ? he : en);

  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [dueObj, setDueObj] = useState<Date>(new Date());
  const [dueIso, setDueIso] = useState('');
  const [reminderEnabled, setReminderEnabled] = useState(true);
  const [reminderObj, setReminderObj] = useState<Date>(new Date());
  const [creating, setCreating] = useState(false);

  // Assignee (responsible user) — defaults to the current user, changeable from a picker.
  const [assignedToId, setAssignedToId] = useState('');
  const [assignedToName, setAssignedToName] = useState('');
  const [orgUsers, setOrgUsers] = useState<OrgUser[]>([]);
  const [userPickerExpanded, setUserPickerExpanded] = useState(false);

  // "More details" — collapsed by default, mirroring the web TaskForm. Holds the reminder and the
  // optional description / task type / category / tags so the default view stays minimal.
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [description, setDescription] = useState('');
  const [taskType, setTaskType] = useState<string>('general');
  const [category, setCategory] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');

  const TASK_TYPES: Array<{ key: string; he: string; en: string; icon: string }> = [
    { key: 'phone_call', he: 'שיחת טלפון', en: 'Phone call', icon: 'phone-outline' },
    { key: 'follow_up', he: 'מעקב', en: 'Follow up', icon: 'email-outline' },
    { key: 'meeting', he: 'פגישה', en: 'Meeting', icon: 'handshake-outline' },
    { key: 'general', he: 'כללי', en: 'General', icon: 'note-text-outline' },
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

  const relatedMeta = relatedTo ? RELATED_META[relatedTo.type] : undefined;
  const detailsSummary = [
    reminderEnabled ? `${tr('תזכורת', 'Reminder')}: ${formatDateTimeSafe(reminderObj, lang)}` : tr('ללא תזכורת', 'No reminder'),
    tr('תיאור, סוג, תיוגים', 'Description, type, tags'),
  ].join(' · ');

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss} statusBarTranslucent>
      <TaskFormFrame dim onBackdropPress={onDismiss}>
        <TaskFormHeader title={t('tasks.addTask', 'הוסף משימה')} onClose={onDismiss} />

        <TaskFormBody>
          <TaskTitleInput
            value={title}
            onChangeText={setTitle}
            placeholder={defaultTitle || tr('מה צריך לעשות?', 'What needs to be done?')}
            hint={title.trim() || defaultTitle ? undefined : tr('ללא כותרת המשימה תיקרא "משימה"', 'Without a title the task will be named "Task"')}
          />

          <FormSectionLabel icon="calendar-clock">{t('tasks.dueDate', 'תאריך יעד')}</FormSectionLabel>
          <View style={styles.section}>
            <DueQuickPicks
              value={dueIso ? dueObj : null}
              onChange={(d) => applyDueChange(d, dueObj)}
              title={t('tasks.dueDate', 'תאריך יעד')}
            />
          </View>

          <FormSectionLabel icon="flag-outline">{t('tasks.priority', 'עדיפות')}</FormSectionLabel>
          <View style={styles.section}>
            <ChoiceChips
              segmented
              value={priority}
              onChange={(k) => setPriority(k as 'low' | 'medium' | 'high')}
              options={(['low', 'medium', 'high'] as const).map((p) => ({
                key: p,
                label: t(`tasks.${p}`),
                color: TASK_PRIORITY_COLORS[p],
              }))}
            />
          </View>

          {/* Assignee / responsible user — defaults to the current user, tap to change. */}
          <View style={styles.section}>
            <FormRow
              label={t('tasks.assignedTo', 'אחראי')}
              value={assignedToName}
              placeholder={t('tasks.unassigned', 'ללא')}
              avatarText={assignedToName || undefined}
              icon="account"
              chevron={userPickerExpanded ? 'up' : 'down'}
              onPress={() => setUserPickerExpanded((v) => !v)}
            />
            {userPickerExpanded && (
              <UserPickerList
                loading={orgUsers.length === 0}
                selectedId={assignedToId}
                users={orgUsers.map((u) => {
                  const id = u.uID || u.userId || '';
                  return { id, name: u.fullname || u.name || u.userName || u.email || id };
                })}
                onSelect={(id, name) => {
                  setAssignedToId(id);
                  setAssignedToName(name);
                  setUserPickerExpanded(false);
                }}
              />
            )}
          </View>

          {/* Linked record (read-only — set by the screen that opened the sheet). */}
          {relatedTo ? (
            <View style={styles.section}>
              <FormRow
                label={tr('קשור ל', 'Related to')}
                value={relatedTo.entityName ? `${relatedMeta ? tr(relatedMeta.he, relatedMeta.en) + ' · ' : ''}${relatedTo.entityName}` : (relatedMeta ? tr(relatedMeta.he, relatedMeta.en) : relatedTo.type)}
                icon={relatedMeta?.icon || 'link-variant'}
                chevron="none"
              />
            </View>
          ) : null}

          {/* More details — collapsed by default (mirrors the web TaskForm). */}
          <MoreDetailsToggle
            expanded={detailsExpanded}
            onToggle={() => setDetailsExpanded((v) => !v)}
            summary={detailsSummary}
          />

          {detailsExpanded && (
            <View style={{ paddingTop: 8 }}>
              <ReminderRow
                enabled={reminderEnabled}
                onToggle={(val) => {
                  setReminderEnabled(val);
                  if (val && dueIso) {
                    const d = new Date(dueIso);
                    if (!isNaN(d.getTime())) setReminderObj(d);
                  }
                }}
                value={reminderObj}
                onChange={setReminderObj}
              />

              <FormTextField
                label={tr('תיאור', 'Description')}
                value={description}
                onChangeText={setDescription}
                multiline
                numberOfLines={3}
              />

              <FormSectionLabel icon="shape-outline">{tr('סוג משימה', 'Task type')}</FormSectionLabel>
              <View style={styles.section}>
                <ChoiceChips
                  value={taskType}
                  onChange={setTaskType}
                  options={TASK_TYPES.map((tt) => ({
                    key: tt.key,
                    label: isRTL ? tt.he : tt.en,
                    icon: tt.icon as any,
                  }))}
                />
              </View>

              <FormTextField label={tr('קטגוריה', 'Category')} value={category} onChangeText={setCategory} />

              <FormSectionLabel icon="tag-outline">{tr('תיוגים', 'Tags')}</FormSectionLabel>
              <FormTextField
                value={tagInput}
                onChangeText={setTagInput}
                onSubmitEditing={addTag}
                blurOnSubmit={false}
                returnKeyType="done"
                placeholder={tr('הקלד תיוג והוסף...', 'Type a tag and add...')}
                style={{ marginBottom: tags.length > 0 ? 8 : 14 }}
                right={<FormTagAdd onPress={addTag} />}
              />
              {tags.length > 0 && (
                <View style={[styles.tagsRow, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
                  {tags.map((tag) => (
                    <Chip
                      key={tag}
                      compact
                      onClose={() => removeTag(tag)}
                      style={{ backgroundColor: theme.colors.surfaceVariant, borderRadius: 18 }}
                      textStyle={{ fontSize: 12 }}
                    >
                      {tag}
                    </Chip>
                  ))}
                </View>
              )}
            </View>
          )}
        </TaskFormBody>

        <TaskFormSubmitBar
          label={tr('צור משימה', 'Create task')}
          onPress={handleCreate}
          loading={creating}
        />
      </TaskFormFrame>
    </Modal>
  );
}

// Trailing "+" action for the tag field.
function FormTagAdd({ onPress }: { onPress: () => void }) {
  return <TextInput.Icon icon="plus" onPress={onPress} />;
}

const styles = StyleSheet.create({
  section: { marginBottom: 18 },
  tagsRow: { gap: 8, flexWrap: 'wrap', marginBottom: 14 },
});
