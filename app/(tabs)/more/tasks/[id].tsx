import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import {
  Text,
  Chip,
  Avatar,
  ActivityIndicator,
  Portal,
  Modal,
  TextInput,
  Button,
  IconButton,
  Divider,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../../../stores/authStore';
import { useAppTheme } from '../../../../hooks/useAppTheme';
import { useRTL } from '../../../../hooks/useRTL';
import { tasksApi } from '../../../../services/api/tasks';
import { formatDate, formatRelativeTime, getInitials } from '../../../../utils/formatters';
import { spacing, borderRadius } from '../../../../constants/theme';
import ContactLookup from '../../../../components/ContactLookup';
import type { Task } from '../../../../types';

const BRAND_COLOR = '#2e6155';
const PRIORITY_COLORS: Record<string, string> = {
  low: '#4CAF50',
  medium: '#FF9800',
  high: '#FF5722',
  urgent: '#F44336',
};

const STATUS_COLORS: Record<string, string> = {
  open: '#2196F3',
  pending: '#9E9E9E',
  in_progress: '#2196F3',
  completed: '#4CAF50',
  cancelled: '#757575',
};

const STATUSES = ['open', 'pending', 'in_progress', 'completed', 'cancelled'] as const;
const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
const TASK_TYPES = ['phone_call', 'follow_up', 'meeting', 'general', 'other'] as const;

const PRIORITY_ICONS: Record<string, string> = {
  low: 'chevron-down',
  medium: 'minus',
  high: 'chevron-up',
  urgent: 'chevron-double-up',
};

function isOverdue(task: Task): boolean {
  if (!task.dueDate || task.status === 'completed' || task.status === 'cancelled') return false;
  return new Date(task.dueDate) < new Date();
}

function getRelatedEntityDisplay(task: Task): { label: string; name: string; entityId?: string; type?: string } | null {
  if (task.relatedTo?.entityName) {
    const typeLabel =
      task.relatedTo.type === 'contact'
        ? 'tasks.relatedContact'
        : task.relatedTo.type === 'lead'
          ? 'tasks.relatedLead'
          : task.relatedTo.type === 'case'
            ? 'tasks.relatedCase'
            : 'tasks.relatedEntity';
    return {
      label: typeLabel,
      name: task.relatedTo.entityName,
      entityId: task.relatedTo.entityId,
      type: task.relatedTo.type,
    };
  }
  if ((task as any).relatedContactName) {
    return {
      label: 'tasks.relatedContact',
      name: (task as any).relatedContactName,
      entityId: (task as any).relatedContactId,
      type: 'contact',
    };
  }
  if ((task as any).relatedLeadName) {
    return {
      label: 'tasks.relatedLead',
      name: (task as any).relatedLeadName,
      entityId: (task as any).relatedLeadId,
      type: 'lead',
    };
  }
  if ((task as any).relatedCaseName) {
    return {
      label: 'tasks.relatedCase',
      name: (task as any).relatedCaseName,
      entityId: (task as any).relatedCaseId,
      type: 'case',
    };
  }
  return null;
}

export default function TaskDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const theme = useAppTheme();
  const { isRTL, flexDirection, textAlign } = useRTL();
  const { t, i18n } = useTranslation();
  const lang = i18n.language as 'en' | 'he';

  const user = useAuthStore((s) => s.user);

  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [formTitle, setFormTitle] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formStatus, setFormStatus] = useState<string>('open');
  const [formPriority, setFormPriority] = useState<string>('medium');
  const [formTaskType, setFormTaskType] = useState<string>('general');
  const [formDueDate, setFormDueDate] = useState('');
  const [formAssignedTo, setFormAssignedTo] = useState('');
  const [formRelatedContactName, setFormRelatedContactName] = useState('');
  const [formRelatedContactPhone, setFormRelatedContactPhone] = useState('');
  const [formRelatedContactId, setFormRelatedContactId] = useState('');
  const [contactLookupVisible, setContactLookupVisible] = useState(false);

  const fetchTask = useCallback(async () => {
    if (!user?.organization || !id) return;
    try {
      setError(null);
      const tasks = await tasksApi.getAll(
        user.organization,
        user.uID || user.userId,
        'seeAll',
      );
      const found = tasks.find((t) => t.id === id);
      if (found) {
        setTask(found);
      } else {
        setError(t('common.noResults'));
      }
    } catch (err: any) {
      setError(err.message || t('errors.generic'));
    } finally {
      setLoading(false);
    }
  }, [user?.organization, user?.uID, user?.userId, id, t]);

  useEffect(() => {
    fetchTask();
  }, [fetchTask]);

  const openEditModal = useCallback(() => {
    if (!task) return;
    setFormTitle(task.title);
    setFormDescription(task.description || '');
    setFormStatus(task.status);
    setFormPriority((task as any).priority || task.priority || 'medium');
    setFormTaskType(task.taskType || 'general');
    setFormDueDate(task.dueDate || '');
    setFormAssignedTo((task as any).assignedTo || task.assignedToId || '');
    const related = getRelatedEntityDisplay(task);
    if (related?.type === 'contact') {
      setFormRelatedContactName(related.name);
      setFormRelatedContactId(related.entityId || '');
      setFormRelatedContactPhone((task as any).relatedContactPhone || '');
    } else {
      setFormRelatedContactName('');
      setFormRelatedContactId('');
      setFormRelatedContactPhone('');
    }
    setEditModalVisible(true);
  }, [task]);

  const handleSave = useCallback(async () => {
    if (!user?.organization || !task || !formTitle.trim()) return;
    setSaving(true);
    try {
      const payload: any = {
        id: task.id,
        title: formTitle.trim(),
        description: formDescription.trim() || undefined,
        status: formStatus as Task['status'],
        priority: formPriority as any,
        taskType: formTaskType as Task['taskType'],
        dueDate: formDueDate.trim() || undefined,
        assignedTo: formAssignedTo.trim() || undefined,
      };
      if (formRelatedContactId) {
        payload.relatedTo = {
          type: 'contact',
          entityId: formRelatedContactId,
          entityName: formRelatedContactName,
        };
      }
      await tasksApi.update(user.organization, payload);
      setEditModalVisible(false);
      await fetchTask();
    } catch (err: any) {
      Alert.alert(t('common.error'), err.message || t('errors.generic'));
    } finally {
      setSaving(false);
    }
  }, [user?.organization, task, formTitle, formDescription, formStatus, formPriority, formTaskType, formDueDate, formAssignedTo, formRelatedContactId, formRelatedContactName, fetchTask, t]);

  const handleDelete = useCallback(() => {
    Alert.alert(
      t('common.delete'),
      t('tasks.deleteConfirm'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            if (!user?.organization || !task) return;
            setDeleting(true);
            try {
              await tasksApi.delete(user.organization, task.id);
              router.back();
            } catch (err: any) {
              Alert.alert(t('common.error'), err.message || t('errors.generic'));
              setDeleting(false);
            }
          },
        },
      ],
    );
  }, [user?.organization, task, router, t]);

  const handleStatusChange = useCallback(
    async (newStatus: string) => {
      if (!user?.organization || !task) return;
      try {
        await tasksApi.update(user.organization, {
          id: task.id,
          status: newStatus as Task['status'],
          ...(newStatus === 'completed' ? { completedAt: new Date().toISOString() } : {}),
        } as any);
        await fetchTask();
      } catch (err: any) {
        Alert.alert(t('common.error'), err.message || t('errors.generic'));
      }
    },
    [user?.organization, task, fetchTask, t],
  );

  const handleComplete = useCallback(() => {
    handleStatusChange('completed');
  }, [handleStatusChange]);

  const navigateToRelated = useCallback(
    (entityType: string, entityId?: string) => {
      if (!entityId) return;
      if (entityType === 'contact') {
        router.push({ pathname: '/(tabs)/contacts', params: { contactId: entityId } });
      } else if (entityType === 'lead') {
        router.push({ pathname: '/(tabs)/leads', params: { leadId: entityId } });
      } else if (entityType === 'case') {
        router.push(`/(tabs)/more/cases/${entityId}`);
      }
    },
    [router],
  );

  if (loading) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator size="large" color={BRAND_COLOR} />
      </View>
    );
  }

  if (error || !task) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.colors.background }]}>
        <View style={[styles.errorHeader, { paddingTop: insets.top + 8 }]}>
          <IconButton icon={isRTL ? 'arrow-right' : 'arrow-left'} iconColor="#FFFFFF" onPress={() => router.back()} />
        </View>
        <MaterialCommunityIcons
          name="alert-circle-outline"
          size={64}
          color={theme.colors.onSurfaceVariant}
          style={{ opacity: 0.4 }}
        />
        <Text
          variant="titleMedium"
          style={{ color: theme.colors.onSurface, marginTop: 12 }}
        >
          {error || t('common.noResults')}
        </Text>
        <Button mode="text" onPress={fetchTask} style={{ marginTop: 8 }}>
          {t('common.retry')}
        </Button>
      </View>
    );
  }

  const overdue = isOverdue(task);
  const priorityColor = PRIORITY_COLORS[(task as any).priority || task.priority] || PRIORITY_COLORS.medium;
  const statusColor = STATUS_COLORS[task.status] || STATUS_COLORS.pending;
  const completed = task.status === 'completed';
  const relatedEntity = getRelatedEntityDisplay(task);
  const createdDate = task.createdAt || task.createdOn;

  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
      {/* Header */}
      <View
        style={[
          styles.header,
          { backgroundColor: BRAND_COLOR, paddingTop: insets.top + 4 },
        ]}
      >
        <View style={[styles.headerRow, { flexDirection }]}>
          <IconButton
            icon={isRTL ? 'arrow-right' : 'arrow-left'}
            iconColor="#FFFFFF"
            size={24}
            onPress={() => router.back()}
          />
          <Text
            variant="titleMedium"
            numberOfLines={1}
            style={[styles.headerTitleText, { flex: 1, textAlign }]}
          >
            {task.title}
          </Text>
          <IconButton
            icon="pencil"
            iconColor="#FFFFFF"
            size={22}
            onPress={openEditModal}
          />
          <IconButton
            icon="delete-outline"
            iconColor="#FFFFFF"
            size={22}
            onPress={handleDelete}
            loading={deleting}
          />
        </View>
      </View>

      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Priority & Status banner */}
        <View
          style={[
            styles.bannerCard,
            { backgroundColor: theme.custom.cardBackground, borderColor: theme.colors.outlineVariant },
          ]}
        >
          <View style={[styles.bannerRow, { flexDirection }]}>
            <View style={[styles.bannerItem, { alignItems: isRTL ? 'flex-end' : 'flex-start' }]}>
              <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                {t('tasks.priority')}
              </Text>
              <View style={[styles.priorityBadge, { backgroundColor: `${priorityColor}18` }]}>
                <MaterialCommunityIcons
                  name={PRIORITY_ICONS[(task as any).priority || task.priority] as any}
                  size={16}
                  color={priorityColor}
                />
                <Text style={[styles.priorityBadgeText, { color: priorityColor }]}>
                  {t(`tasks.${(task as any).priority || task.priority}`)}
                </Text>
              </View>
            </View>

            <View style={[styles.bannerItem, { alignItems: isRTL ? 'flex-end' : 'flex-start' }]}>
              <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                {t('tasks.status')}
              </Text>
              <Chip
                compact
                textStyle={[styles.statusChipText, { color: statusColor }]}
                style={[styles.statusChip, { backgroundColor: `${statusColor}18` }]}
              >
                {t(`tasks.${task.status}`)}
              </Chip>
            </View>
          </View>

          {task.taskType ? (
            <View style={[styles.bannerItem, { marginTop: 12, alignItems: isRTL ? 'flex-end' : 'flex-start' }]}>
              <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                {t('tasks.taskType')}
              </Text>
              <Text variant="bodyMedium" style={{ color: theme.colors.onSurface, fontWeight: '500' }}>
                {t(`tasks.${task.taskType}`)}
              </Text>
            </View>
          ) : null}

          {overdue && (
            <View style={styles.overdueBanner}>
              <MaterialCommunityIcons name="alert" size={16} color="#F44336" />
              <Text style={styles.overdueText}>{t('tasks.overdue')}</Text>
            </View>
          )}
        </View>

        {/* Status selector */}
        <View
          style={[
            styles.sectionCard,
            { backgroundColor: theme.custom.cardBackground, borderColor: theme.colors.outlineVariant },
          ]}
        >
          <Text variant="labelLarge" style={[styles.sectionLabel, { color: theme.colors.onSurface, textAlign }]}>
            {t('tasks.status')}
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={[styles.statusRow, { flexDirection }]}>
              {STATUSES.map((s) => {
                const sc = STATUS_COLORS[s];
                const active = task.status === s;
                return (
                  <Chip
                    key={s}
                    selected={active}
                    onPress={() => handleStatusChange(s)}
                    compact
                    style={[
                      styles.statusSelectChip,
                      active
                        ? { backgroundColor: `${sc}20`, borderColor: sc, borderWidth: 1.5 }
                        : { backgroundColor: theme.colors.surfaceVariant, borderWidth: 1.5, borderColor: 'transparent' },
                    ]}
                    textStyle={[
                      { fontSize: 12 },
                      active && { color: sc, fontWeight: '700' },
                    ]}
                    icon={active ? 'check' : undefined}
                  >
                    {t(`tasks.${s}`)}
                  </Chip>
                );
              })}
            </View>
          </ScrollView>
        </View>

        {/* Description */}
        {task.description ? (
          <View
            style={[
              styles.sectionCard,
              { backgroundColor: theme.custom.cardBackground, borderColor: theme.colors.outlineVariant },
            ]}
          >
            <Text variant="labelLarge" style={[styles.sectionLabel, { color: theme.colors.onSurface, textAlign }]}>
              {t('tasks.description')}
            </Text>
            <Text
              variant="bodyMedium"
              style={[
                { color: theme.colors.onSurface, lineHeight: 22, textAlign },
                completed && { opacity: 0.5 },
              ]}
            >
              {task.description}
            </Text>
          </View>
        ) : null}

        {/* Detail fields */}
        <View
          style={[
            styles.sectionCard,
            { backgroundColor: theme.custom.cardBackground, borderColor: theme.colors.outlineVariant },
          ]}
        >
          {/* Due date */}
          {task.dueDate ? (
            <View style={styles.detailRow}>
              <View style={[styles.detailIcon, { backgroundColor: overdue ? '#F4433618' : `${theme.colors.primary}18` }]}>
                <MaterialCommunityIcons
                  name="calendar-clock"
                  size={20}
                  color={overdue ? '#F44336' : theme.colors.primary}
                />
              </View>
              <View style={[styles.detailContent, { alignItems: isRTL ? 'flex-end' : 'flex-start' }]}>
                <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                  {t('tasks.dueDate')}
                </Text>
                <Text
                  variant="bodyMedium"
                  style={[
                    { color: overdue ? '#F44336' : theme.colors.onSurface, fontWeight: '500' },
                    overdue && { fontWeight: '700' },
                  ]}
                >
                  {formatDate(task.dueDate)} • {formatRelativeTime(task.dueDate, lang)}
                </Text>
              </View>
            </View>
          ) : null}

          {task.dueDate && (task.assignedToName || relatedEntity) ? (
            <Divider style={{ marginVertical: 10 }} />
          ) : null}

          {/* Assigned to */}
          {task.assignedToName ? (
            <View style={styles.detailRow}>
              <Avatar.Text
                size={36}
                label={getInitials(task.assignedToName)}
                style={{ backgroundColor: theme.colors.primaryContainer }}
                labelStyle={{ fontSize: 13, color: theme.colors.primary, fontWeight: '700' }}
              />
              <View style={[styles.detailContent, { alignItems: isRTL ? 'flex-end' : 'flex-start' }]}>
                <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                  {t('tasks.assignedTo')}
                </Text>
                <Text variant="bodyMedium" style={{ color: theme.colors.onSurface, fontWeight: '500' }}>
                  {task.assignedToName}
                </Text>
              </View>
            </View>
          ) : null}

          {task.assignedToName && relatedEntity ? (
            <Divider style={{ marginVertical: 10 }} />
          ) : null}

          {/* Related entity (contact/lead/case) */}
          {relatedEntity ? (
            <Pressable
              onPress={() => relatedEntity.entityId && navigateToRelated(relatedEntity.type || '', relatedEntity.entityId)}
              style={styles.detailRow}
            >
              <View style={[styles.detailIcon, { backgroundColor: `${theme.colors.secondary}18` }]}>
                <MaterialCommunityIcons
                  name={
                    relatedEntity.type === 'contact'
                      ? 'account'
                      : relatedEntity.type === 'lead'
                        ? 'trending-up'
                        : 'briefcase'
                  }
                  size={20}
                  color={theme.colors.secondary}
                />
              </View>
              <View style={[styles.detailContent, { alignItems: isRTL ? 'flex-end' : 'flex-start' }]}>
                <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                  {t(relatedEntity.label)}
                </Text>
                <Text variant="bodyMedium" style={{ color: theme.colors.primary, fontWeight: '500' }}>
                  {relatedEntity.name}
                </Text>
              </View>
              {relatedEntity.entityId && (
                <MaterialCommunityIcons
                  name={isRTL ? 'chevron-left' : 'chevron-right'}
                  size={20}
                  color={theme.colors.onSurfaceVariant}
                />
              )}
            </Pressable>
          ) : null}
        </View>

        {/* Timestamps */}
        {createdDate && (
          <View
            style={[
              styles.sectionCard,
              { backgroundColor: theme.custom.cardBackground, borderColor: theme.colors.outlineVariant },
            ]}
          >
            <View style={[styles.timestampRow, { flexDirection }]}>
              <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                {t('tasks.created')}:
              </Text>
              <Text variant="labelSmall" style={{ color: theme.colors.onSurface }}>
                {formatDate(createdDate)} • {formatRelativeTime(createdDate, lang)}
              </Text>
            </View>
            {task.updatedAt || task.modifiedOn ? (
              <View style={[styles.timestampRow, { flexDirection, marginTop: 4 }]}>
                <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                  {t('tasks.edited')}:
                </Text>
                <Text variant="labelSmall" style={{ color: theme.colors.onSurface }}>
                  {formatDate(task.updatedAt || task.modifiedOn!)} • {formatRelativeTime(task.updatedAt || task.modifiedOn!, lang)}
                </Text>
              </View>
            ) : null}
            {task.completedAt ? (
              <View style={[styles.timestampRow, { flexDirection, marginTop: 4 }]}>
                <Text variant="labelSmall" style={{ color: '#4CAF50' }}>
                  {t('tasks.completed')}:
                </Text>
                <Text variant="labelSmall" style={{ color: '#4CAF50' }}>
                  {formatDate(task.completedAt)} • {formatRelativeTime(task.completedAt, lang)}
                </Text>
              </View>
            ) : null}
          </View>
        )}

        {/* Complete button */}
        {task.status !== 'completed' && (
          <Button
            mode="contained"
            icon="check-circle"
            onPress={handleComplete}
            style={[styles.completeButton, { backgroundColor: '#4CAF50' }]}
            contentStyle={styles.completeButtonContent}
            labelStyle={styles.completeButtonLabel}
            textColor="#FFFFFF"
          >
            {t('tasks.markComplete')}
          </Button>
        )}

        <View style={{ height: insets.bottom + 24 }} />
      </ScrollView>

      <ContactLookup
        visible={contactLookupVisible}
        organization={user?.organization || ''}
        onSelect={(contact) => {
          setFormRelatedContactName(contact.name);
          setFormRelatedContactPhone(contact.phoneNumber);
          setFormRelatedContactId(contact.id);
          setContactLookupVisible(false);
        }}
        onDismiss={() => setContactLookupVisible(false)}
      />

      {/* Edit Modal */}
      <Portal>
        <Modal
          visible={editModalVisible}
          onDismiss={() => setEditModalVisible(false)}
          contentContainerStyle={[
            styles.modalContainer,
            { backgroundColor: theme.colors.surface },
          ]}
        >
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={[styles.modalHeader, { flexDirection }]}>
                <Text variant="titleLarge" style={{ color: theme.colors.onSurface, fontWeight: '700' }}>
                  {t('tasks.editTask')}
                </Text>
                <IconButton icon="close" size={22} onPress={() => setEditModalVisible(false)} />
              </View>

              <TextInput
                label={t('tasks.taskTitle')}
                value={formTitle}
                onChangeText={setFormTitle}
                mode="outlined"
                style={[styles.formInput, { textAlign }]}
                outlineColor={theme.colors.outline}
                activeOutlineColor={BRAND_COLOR}
              />

              <TextInput
                label={t('tasks.description')}
                value={formDescription}
                onChangeText={setFormDescription}
                mode="outlined"
                multiline
                numberOfLines={3}
                style={[styles.formInput, { textAlign }]}
                outlineColor={theme.colors.outline}
                activeOutlineColor={BRAND_COLOR}
              />

              <Text variant="labelLarge" style={[styles.formLabel, { color: theme.colors.onSurface }]}>
                {t('tasks.status')}
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }}>
                <View style={[styles.chipsRow, { flexDirection }]}>
                  {STATUSES.map((s) => {
                    const sc = STATUS_COLORS[s];
                    const active = formStatus === s;
                    return (
                      <Chip
                        key={s}
                        selected={active}
                        onPress={() => setFormStatus(s)}
                        compact
                        style={[
                          styles.formChip,
                          active
                            ? { backgroundColor: `${sc}20`, borderColor: sc, borderWidth: 1.5 }
                            : { backgroundColor: theme.colors.surfaceVariant, borderWidth: 1.5, borderColor: 'transparent' },
                        ]}
                        textStyle={[
                          { fontSize: 12 },
                          active && { color: sc, fontWeight: '700' },
                        ]}
                      >
                        {t(`tasks.${s}`)}
                      </Chip>
                    );
                  })}
                </View>
              </ScrollView>

              <Text variant="labelLarge" style={[styles.formLabel, { color: theme.colors.onSurface }]}>
                {t('tasks.priority')}
              </Text>
              <View style={[styles.chipsRow, { flexDirection, marginBottom: 14 }]}>
                {PRIORITIES.map((p) => {
                  const pc = PRIORITY_COLORS[p];
                  const active = formPriority === p;
                  return (
                    <Chip
                      key={p}
                      selected={active}
                      onPress={() => setFormPriority(p)}
                      compact
                      style={[
                        styles.formChip,
                        active
                          ? { backgroundColor: `${pc}20`, borderColor: pc, borderWidth: 1.5 }
                          : { backgroundColor: theme.colors.surfaceVariant, borderWidth: 1.5, borderColor: 'transparent' },
                      ]}
                      textStyle={[
                        { fontSize: 12 },
                        active && { color: pc, fontWeight: '700' },
                      ]}
                    >
                      {t(`tasks.${p}`)}
                    </Chip>
                  );
                })}
              </View>

              <Text variant="labelLarge" style={[styles.formLabel, { color: theme.colors.onSurface }]}>
                {t('tasks.taskType')}
              </Text>
              <View style={[styles.chipsRow, { flexDirection, marginBottom: 14 }]}>
                {TASK_TYPES.map((tt) => {
                  const active = formTaskType === tt;
                  return (
                    <Chip
                      key={tt}
                      selected={active}
                      onPress={() => setFormTaskType(tt)}
                      compact
                      style={[
                        styles.formChip,
                        active
                          ? { backgroundColor: `${BRAND_COLOR}20`, borderColor: BRAND_COLOR, borderWidth: 1.5 }
                          : { backgroundColor: theme.colors.surfaceVariant, borderWidth: 1.5, borderColor: 'transparent' },
                      ]}
                      textStyle={[
                        { fontSize: 12 },
                        active && { color: BRAND_COLOR, fontWeight: '700' },
                      ]}
                    >
                      {t(`tasks.${tt}`)}
                    </Chip>
                  );
                })}
              </View>

              <TextInput
                label={t('tasks.dueDate')}
                value={formDueDate}
                onChangeText={setFormDueDate}
                mode="outlined"
                placeholder="YYYY-MM-DD"
                style={[styles.formInput, { textAlign }]}
                outlineColor={theme.colors.outline}
                activeOutlineColor={BRAND_COLOR}
                left={<TextInput.Icon icon="calendar" />}
              />

              <TextInput
                label={t('tasks.assignedTo')}
                value={formAssignedTo}
                onChangeText={setFormAssignedTo}
                mode="outlined"
                style={[styles.formInput, { textAlign }]}
                outlineColor={theme.colors.outline}
                activeOutlineColor={BRAND_COLOR}
                left={<TextInput.Icon icon="account" />}
              />

              <Text variant="labelLarge" style={[styles.formLabel, { color: theme.colors.onSurface }]}>
                {t('tasks.relatedContact')}
              </Text>
              <Pressable
                onPress={() => setContactLookupVisible(true)}
                style={[
                  styles.contactLookupField,
                  {
                    backgroundColor: theme.colors.surfaceVariant,
                    borderColor: theme.colors.outline,
                    flexDirection,
                  },
                ]}
              >
                <View style={{ flex: 1 }}>
                  <Text
                    style={{
                      color: formRelatedContactName ? theme.colors.onSurface : theme.colors.onSurfaceVariant,
                      fontSize: 15,
                      textAlign,
                    }}
                    numberOfLines={1}
                  >
                    {formRelatedContactName
                      ? `${formRelatedContactName}${formRelatedContactPhone ? `  •  ${formRelatedContactPhone}` : ''}`
                      : t('common.selectContact')}
                  </Text>
                </View>
                <MaterialCommunityIcons
                  name="account-search"
                  size={20}
                  color={theme.colors.onSurfaceVariant}
                />
              </Pressable>

              <View style={[styles.modalActions, { flexDirection }]}>
                <Button
                  mode="outlined"
                  onPress={() => setEditModalVisible(false)}
                  style={styles.modalButton}
                  textColor={theme.colors.onSurface}
                >
                  {t('common.cancel')}
                </Button>
                <Button
                  mode="contained"
                  onPress={handleSave}
                  loading={saving}
                  disabled={!formTitle.trim() || saving}
                  style={[styles.modalButton, { backgroundColor: BRAND_COLOR }]}
                  textColor="#FFFFFF"
                >
                  {t('common.save')}
                </Button>
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
        </Modal>
      </Portal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: BRAND_COLOR,
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: 8,
  },
  header: {
    paddingBottom: 4,
  },
  headerRow: {
    alignItems: 'center',
  },
  headerTitleText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 17,
  },
  body: { flex: 1 },
  bodyContent: {
    padding: 16,
    gap: 12,
  },
  bannerCard: {
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    padding: 16,
  },
  bannerRow: {
    alignItems: 'flex-start',
    justifyContent: 'space-around',
    gap: 16,
  },
  bannerItem: {
    gap: 6,
  },
  priorityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  priorityBadgeText: {
    fontSize: 13,
    fontWeight: '700',
  },
  statusChip: {
    height: 28,
    borderRadius: 14,
  },
  statusChipText: {
    fontSize: 12,
    fontWeight: '600',
  },
  overdueBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#F4433630',
  },
  overdueText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#F44336',
  },
  sectionCard: {
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    padding: 16,
  },
  sectionLabel: {
    fontWeight: '600',
    marginBottom: 10,
  },
  statusRow: {
    gap: 8,
    alignItems: 'center',
  },
  statusSelectChip: {
    height: 32,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 2,
  },
  detailIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailContent: {
    flex: 1,
    gap: 2,
  },
  timestampRow: {
    alignItems: 'center',
    gap: 6,
  },
  completeButton: {
    borderRadius: borderRadius.lg,
    marginTop: 4,
    elevation: 2,
  },
  completeButtonContent: {
    paddingVertical: 6,
  },
  completeButtonLabel: {
    fontSize: 16,
    fontWeight: '700',
  },
  modalContainer: {
    marginHorizontal: 20,
    borderRadius: borderRadius.xl,
    maxHeight: '85%',
    padding: 20,
  },
  modalHeader: {
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  formInput: {
    marginBottom: 14,
  },
  contactLookupField: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 14,
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
  },
  formLabel: {
    fontWeight: '600',
    marginBottom: 8,
  },
  chipsRow: {
    gap: 8,
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  formChip: {
    height: 32,
  },
  modalActions: {
    gap: 12,
    justifyContent: 'flex-end',
    marginTop: 8,
  },
  modalButton: {
    minWidth: 100,
    borderRadius: borderRadius.md,
  },
});
