import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
  KeyboardAvoidingView,
  Platform,
  FlatList,
  TouchableOpacity,
  useWindowDimensions,
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
  Searchbar,
  Switch,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../../stores/authStore';
import { useAppTheme } from '../../../hooks/useAppTheme';
import { useRTL } from '../../../hooks/useRTL';
import { tasksApi } from '../../../services/api/tasks';
import { cacheEntity, getCachedEntity } from '../../../services/entityCache';
import { usersApi } from '../../../services/api/users';
import { leadsApi } from '../../../services/api/leads';
import { getDataVisibility } from '../../../constants/permissions';
import { formatDate, formatRelativeTime, getInitials, withAlpha } from '../../../utils/formatters';
import { spacing, borderRadius } from '../../../constants/theme';
import ContactLookup from '../../../components/ContactLookup';
import GambotDateTimePicker from '../../../components/GambotDateTimePicker';
import type { Task, OrgUser } from '../../../types';

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
  const { height: windowHeight } = useWindowDimensions();
  const theme = useAppTheme();
  const { isRTL, flexDirection, textAlign } = useRTL();
  const { t, i18n } = useTranslation();
  const lang = i18n.language as 'en' | 'he';

  const user = useAuthStore((s) => s.user);

  // Render instantly from the list cache, then refresh in the background.
  // Memoized per id so the cache lookup keeps a stable identity across renders;
  // otherwise fetchTask (which depends on it) would be recreated every render and
  // re-trigger its effect in an infinite loop (re-fetching the task + activities).
  const cachedTask = useMemo(
    () => (id && id !== 'new' ? getCachedEntity<Task>('tasks', id) : undefined),
    [id]
  );
  const [task, setTask] = useState<Task | null>(cachedTask ?? null);
  const [loading, setLoading] = useState(!cachedTask);
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
  const [formAssignedToId, setFormAssignedToId] = useState('');
  const [orgUsers, setOrgUsers] = useState<OrgUser[]>([]);
  const [orgUsersLoading, setOrgUsersLoading] = useState(false);
  const [userPickerExpanded, setUserPickerExpanded] = useState(false);
  const [formRelatedEntityType, setFormRelatedEntityType] = useState<'' | 'contact' | 'lead'>('');
  const [formRelatedContactName, setFormRelatedContactName] = useState('');
  const [formRelatedContactPhone, setFormRelatedContactPhone] = useState('');
  const [formRelatedContactId, setFormRelatedContactId] = useState('');
  const [contactLookupVisible, setContactLookupVisible] = useState(false);
  const [formRelatedLeadName, setFormRelatedLeadName] = useState('');
  const [formRelatedLeadId, setFormRelatedLeadId] = useState('');
  const [leadPickerVisible, setLeadPickerVisible] = useState(false);
  const [leadSearch, setLeadSearch] = useState('');
  const [leadResults, setLeadResults] = useState<any[]>([]);
  const [leadSearching, setLeadSearching] = useState(false);
  const leadDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [showDueDatePicker, setShowDueDatePicker] = useState(false);
  const [dueDateObj, setDueDateObj] = useState<Date>(new Date());

  const [reminderEnabled, setReminderEnabled] = useState(false);
  const [showReminderDatePicker, setShowReminderDatePicker] = useState(false);
  const [reminderDateObj, setReminderDateObj] = useState<Date>(new Date());

  // Inline due-date editing straight from the task view (no need to open the full edit modal).
  const [inlineDueVisible, setInlineDueVisible] = useState(false);
  const [inlineDueSaving, setInlineDueSaving] = useState(false);

  const openDuePicker = () => {
    const d = formDueDate ? new Date(formDueDate) : new Date();
    setDueDateObj(!isNaN(d.getTime()) ? d : new Date());
    setShowDueDatePicker(true);
  };

  const openReminderPicker = () => setShowReminderDatePicker(true);

  const [activities, setActivities] = useState<any[]>([]);
  const [activitiesLoading, setActivitiesLoading] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [addingComment, setAddingComment] = useState(false);

  const tasksDV = getDataVisibility(user?.DataVisibility, user?.SecurityRole, 'tasks');

  const fetchTask = useCallback(async () => {
    if (!user?.organization || !id) { setLoading(false); return; }
    try {
      setError(null);
      // Try getById first for full data including relatedTo
      try {
        const found = await tasksApi.getById(user.organization, id);
        if (found && found.id) {
          // Merge over what we already have (list cache) so a field the detail endpoint
          // happens to omit/return empty (e.g. dueDate) never blanks a value we already showed.
          setTask((prev) => {
            if (!prev) return found;
            const merged = { ...prev, ...found } as Task;
            if (!found.dueDate && prev.dueDate) merged.dueDate = prev.dueDate;
            if (!(found as any).reminderDate && (prev as any).reminderDate) (merged as any).reminderDate = (prev as any).reminderDate;
            if (!found.assignedToName && prev.assignedToName) merged.assignedToName = prev.assignedToName;
            return merged;
          });
          cacheEntity('tasks', found);
          setLoading(false);
          return;
        }
      } catch {}
      // Fallback to getAll
      const tasks = await tasksApi.getAll(
        user.organization,
        user.uID || user.userId,
        // Backend filters only when dataVisibility === 'own' (not 'seeOwn').
        tasksDV === 'own' ? 'own' : 'all',
      );
      const found = tasks.find((t) => t.id === id);
      if (found) {
        setTask(found);
        cacheEntity('tasks', found);
      } else if (!cachedTask) {
        setError(t('common.noResults'));
      }
    } catch (err: any) {
      if (!cachedTask) setError(err.message || t('errors.generic'));
    } finally {
      setLoading(false);
    }
  }, [user?.organization, user?.uID, user?.userId, id, t, tasksDV, cachedTask]);

  useEffect(() => {
    fetchTask();
  }, [fetchTask]);

  const fetchActivities = useCallback(async () => {
    if (!user?.organization || !id) return;
    setActivitiesLoading(true);
    try {
      const taskId = task?.taskId || task?.id || id;
      const data = await tasksApi.getActivity(user.organization, taskId);
      setActivities(data);
    } catch {
      setActivities([]);
    } finally {
      setActivitiesLoading(false);
    }
  }, [user?.organization, id, task?.taskId, task?.id]);

  useEffect(() => {
    if (task) fetchActivities();
  }, [task, fetchActivities]);

  const handleAddComment = useCallback(async () => {
    if (!user?.organization || !newComment.trim() || !task) return;
    setAddingComment(true);
    try {
      const taskId = task.taskId || task.id;
      await tasksApi.addComment(
        user.organization,
        taskId,
        newComment.trim(),
        user.uID || user.userId || '',
        user.fullname || user.displayName || 'User',
      );
      setNewComment('');
      await fetchActivities();
    } catch {}
    setAddingComment(false);
  }, [user, task, newComment, fetchActivities]);

  const openEditModal = useCallback(() => {
    if (!task) return;
    try {
      setFormTitle(task.title);
      setFormDescription(task.description || '');
      setFormStatus(task.status);
      setFormPriority((task as any).priority || task.priority || 'medium');
      setFormTaskType(task.taskType || 'general');
      setFormDueDate(task.dueDate || '');
      const parsedDue = task.dueDate ? new Date(task.dueDate) : null;
      setDueDateObj(parsedDue && !isNaN(parsedDue.getTime()) ? parsedDue : new Date());
      setReminderEnabled(!!(task as any).reminderEnabled);
      const parsedReminder = (task as any).reminderDate ? new Date((task as any).reminderDate) : null;
      setReminderDateObj(parsedReminder && !isNaN(parsedReminder.getTime()) ? parsedReminder : new Date());
      setFormAssignedTo((task as any).assignedToName || task.assignedToId || '');
      setFormAssignedToId(task.assignedToId || '');
      const related = getRelatedEntityDisplay(task);
      if (related?.type === 'contact') {
        setFormRelatedEntityType('contact');
        setFormRelatedContactName(related.name);
        setFormRelatedContactId(related.entityId || '');
        setFormRelatedContactPhone((task as any).relatedContactPhone || '');
        setFormRelatedLeadName('');
        setFormRelatedLeadId('');
      } else if (related?.type === 'lead') {
        setFormRelatedEntityType('lead');
        setFormRelatedLeadName(related.name);
        setFormRelatedLeadId(related.entityId || '');
        setFormRelatedContactName('');
        setFormRelatedContactId('');
        setFormRelatedContactPhone('');
      } else {
        setFormRelatedEntityType('');
        setFormRelatedContactName('');
        setFormRelatedContactId('');
        setFormRelatedContactPhone('');
        setFormRelatedLeadName('');
        setFormRelatedLeadId('');
      }
      setUserPickerExpanded(false);
    } catch {}
    setEditModalVisible(true);
    if (orgUsers.length === 0) {
      setOrgUsersLoading(true);
      usersApi.getAll(user?.organization || '').then((u) => setOrgUsers(u)).catch(() => {}).finally(() => setOrgUsersLoading(false));
    }
  }, [task, user?.organization, orgUsers.length]);

  const handleSave = useCallback(async () => {
    if (!user?.organization || !task || !formTitle.trim()) return;
    setSaving(true);
    try {
      const payload: any = {
        id: task.id,
        taskId: task.taskId || task.id,
        title: formTitle.trim(),
        description: formDescription.trim() || undefined,
        status: formStatus as Task['status'],
        priority: formPriority as any,
        taskType: formTaskType as Task['taskType'],
        // Send the trimmed value (possibly empty) so clearing the due date actually clears it —
        // `undefined` would be dropped from the payload and the backend would keep the old date.
        dueDate: formDueDate.trim(),
        assignedToId: formAssignedToId || undefined,
        assignedTo: formAssignedToId || formAssignedTo.trim() || undefined,
        assignedToName: formAssignedTo.trim() || undefined,
        reminderEnabled: reminderEnabled || undefined,
        reminderDate: reminderEnabled ? reminderDateObj.toISOString() : null,
        reminderDateUTC: reminderEnabled ? reminderDateObj.toISOString() : null,
        reminderRecipientType: reminderEnabled ? 'assigned_user' : undefined,
      };
      if (formRelatedEntityType === 'contact' && formRelatedContactId) {
        payload.relatedTo = {
          type: 'contact',
          entityId: formRelatedContactId,
          entityName: formRelatedContactName,
        };
      } else if (formRelatedEntityType === 'lead' && formRelatedLeadId) {
        payload.relatedTo = {
          type: 'lead',
          entityId: formRelatedLeadId,
          entityName: formRelatedLeadName,
        };
      } else {
        payload.relatedTo = null;
      }
      await tasksApi.update(
        user.organization,
        payload,
        user.userId || user.uID || '',
        user.fullname || '',
      );
      setEditModalVisible(false);
      await fetchTask();
    } catch (err: any) {
      Alert.alert(t('common.error'), err.message || t('errors.generic'));
    } finally {
      setSaving(false);
    }
  }, [user?.organization, task, formTitle, formDescription, formStatus, formPriority, formTaskType, formDueDate, formAssignedTo, formAssignedToId, formRelatedEntityType, formRelatedContactId, formRelatedContactName, formRelatedLeadId, formRelatedLeadName, fetchTask, t]);

  const handleLeadSearch = useCallback((text: string) => {
    setLeadSearch(text);
    if (leadDebounceRef.current) clearTimeout(leadDebounceRef.current);
    setLeadSearching(true);
    leadDebounceRef.current = setTimeout(async () => {
      try {
        const result = await leadsApi.getAll(user?.organization || '', { filters: { searchTerm: text.trim() || undefined }, pageSize: 30 });
        setLeadResults(result.data || []);
      } catch { setLeadResults([]); }
      finally { setLeadSearching(false); }
    }, 300);
  }, [user?.organization]);

  const openLeadPicker = useCallback(() => {
    setLeadSearch('');
    setLeadResults([]);
    setLeadSearching(true);
    setLeadPickerVisible(true);
    leadsApi.getAll(user?.organization || '', { pageSize: 30 })
      .then((r) => setLeadResults(r.data || []))
      .catch(() => setLeadResults([]))
      .finally(() => setLeadSearching(false));
  }, [user?.organization]);

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
              Alert.alert(t('common.success', 'הצלחה'), t('tasks.deleteSuccess', 'נמחק בהצלחה'));
              if (router.canGoBack()) router.back();
              else router.replace('/(tabs)/tasks');
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
      const taskId = task.taskId || task.id;
      try {
        if (newStatus === 'completed') {
          // Use the dedicated CompleteTask endpoint so the backend stamps completedDate/by
          // exactly like the list one-tap action and the web TaskDetails screen.
          await tasksApi.complete(user.organization, taskId, user.userId || user.uID || '', user.fullname || '');
        } else {
          await tasksApi.update(user.organization, {
            id: task.id,
            taskId,
            status: newStatus as Task['status'],
          } as any, user.userId || user.uID || '', user.fullname || '');
        }
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

  // Persist just the due date from the inline picker on the task view (no full edit needed).
  const saveDueDateInline = useCallback(
    async (iso: string | null) => {
      if (!user?.organization || !task) return;
      const taskId = task.taskId || task.id;
      // Shift the reminder along with the due date so it keeps the same gap (same rule as the
      // edit form and AddTaskSheet). Only when a reminder is actually set on the task.
      let reminderPatch: { reminderDate?: string; reminderDateUTC?: string } = {};
      const prevDue = task.dueDate ? new Date(task.dueDate) : null;
      const newDue = iso ? new Date(iso) : null;
      const remDateRaw = (task as any).reminderDate;
      if ((task as any).reminderEnabled && remDateRaw && prevDue && newDue && !isNaN(prevDue.getTime()) && !isNaN(newDue.getTime())) {
        const remDate = new Date(remDateRaw);
        if (!isNaN(remDate.getTime())) {
          const shifted = new Date(remDate.getTime() + (newDue.getTime() - prevDue.getTime()));
          if (!isNaN(shifted.getTime())) {
            const shiftedIso = shifted.toISOString();
            reminderPatch = { reminderDate: shiftedIso, reminderDateUTC: shiftedIso };
          }
        }
      }
      // Optimistic update so the value shows immediately even before the refetch lands.
      setTask((prev) => (prev ? ({ ...prev, dueDate: iso || '', ...(reminderPatch.reminderDate ? { reminderDate: reminderPatch.reminderDate } : {}) } as Task) : prev));
      setInlineDueSaving(true);
      try {
        await tasksApi.update(
          user.organization,
          { id: task.id, taskId, dueDate: iso || '', ...reminderPatch } as any,
          user.userId || user.uID || '',
          user.fullname || '',
        );
        await fetchTask();
      } catch (err: any) {
        Alert.alert(t('common.error'), err.message || t('errors.generic'));
        await fetchTask();
      } finally {
        setInlineDueSaving(false);
      }
    },
    [user?.organization, user?.userId, user?.uID, user?.fullname, task, fetchTask, t],
  );

  // Close/exit the screen. When the task was opened with no navigation history (e.g. from a
  // push notification, reminder, or deep link), router.back() is a no-op and the user gets
  // stuck unable to leave — so fall back to replacing with the tasks list.
  const handleClose = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/tasks');
  }, [router]);

  const navigateToRelated = useCallback(
    (entityType: string, entityId?: string, entityPhone?: string) => {
      if (!entityId && !entityPhone) return;
      if (entityType === 'contact') {
        router.push({ pathname: '/(tabs)/contacts/[id]', params: { id: entityId || entityPhone || '' } });
      } else if (entityType === 'lead') {
        router.push({ pathname: '/(tabs)/leads/[id]', params: { id: entityId || '' } });
      } else if (entityType === 'case') {
        router.push({ pathname: '/(tabs)/more/cases/[id]', params: { id: entityId || '' } });
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
          <IconButton icon={isRTL ? 'arrow-right' : 'arrow-left'} iconColor="#FFFFFF" onPress={handleClose} />
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
            onPress={handleClose}
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
            <View style={[styles.bannerItem, { alignItems: 'flex-start' }]}>
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

            <View style={[styles.bannerItem, { alignItems: 'flex-start' }]}>
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
            <View style={[styles.bannerItem, { marginTop: 12, alignItems: 'flex-start' }]}>
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
          {/* Due date — tap to edit inline, no need to open the full edit modal. */}
          <Pressable
            style={styles.detailRow}
            onPress={() => {
              const d = task.dueDate ? new Date(task.dueDate) : new Date();
              setDueDateObj(!isNaN(d.getTime()) ? d : new Date());
              setInlineDueVisible(true);
            }}
          >
            <View style={[styles.detailIcon, { backgroundColor: task.dueDate && overdue ? withAlpha('#F44336', 0.094) : withAlpha(theme.colors.primary, 0.094) }]}>
              <MaterialCommunityIcons
                name="calendar-clock"
                size={20}
                color={task.dueDate && overdue ? '#F44336' : theme.colors.primary}
              />
            </View>
            <View style={[styles.detailContent, { alignItems: 'flex-start' }]}>
              <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                {t('tasks.dueDate')}
              </Text>
              <Text
                variant="bodyMedium"
                style={[
                  { color: task.dueDate ? (overdue ? '#F44336' : theme.colors.onSurface) : theme.colors.onSurfaceVariant, fontWeight: '500' },
                  task.dueDate && overdue && { fontWeight: '700' },
                ]}
              >
                {(() => {
                  if (!task.dueDate) return t('tasks.noDueDate', 'ללא תאריך יעד');
                  // Join only the non-empty parts so we never render a dangling " • ".
                  const parts = [formatDate(task.dueDate), formatRelativeTime(task.dueDate, lang)].filter(Boolean);
                  // If neither formatter could parse it, fall back to the raw value rather than a blank.
                  return parts.length ? parts.join(' • ') : String(task.dueDate);
                })()}
              </Text>
            </View>
            {inlineDueSaving ? (
              <ActivityIndicator size={16} color={theme.colors.primary} />
            ) : (
              <MaterialCommunityIcons name="pencil" size={16} color={theme.colors.onSurfaceVariant} />
            )}
          </Pressable>

          {(task.assignedToName || relatedEntity) ? (
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
              <View style={[styles.detailContent, { alignItems: 'flex-start' }]}>
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
              onPress={() => {
                const phone = (task as any)?.relatedContactPhone || (task?.relatedTo as any)?.entityPhone;
                navigateToRelated(relatedEntity.type || '', relatedEntity.entityId, phone);
              }}
              style={styles.detailRow}
            >
              <View style={[styles.detailIcon, { backgroundColor: withAlpha(theme.colors.secondary, 0.094) }]}>
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
              <View style={[styles.detailContent, { alignItems: 'flex-start' }]}>
                <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                  {t(relatedEntity.label)}
                </Text>
                <Text variant="bodyMedium" style={{ color: theme.colors.primary, fontWeight: '500' }}>
                  {relatedEntity.name}
                </Text>
              </View>
              <MaterialCommunityIcons
                name={isRTL ? 'chevron-left' : 'chevron-right'}
                size={20}
                color={theme.colors.onSurfaceVariant}
              />
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

        {/* Activity / Comments */}
        <View
          style={[
            styles.sectionCard,
            { backgroundColor: theme.custom.cardBackground, borderColor: theme.colors.outlineVariant },
          ]}
        >
          <Text variant="labelLarge" style={[styles.sectionLabel, { color: BRAND_COLOR, textAlign: 'center', marginBottom: 12 }]}>
            {t('tasks.activity', 'פעילות')}
          </Text>

          <View style={[styles.commentInputRow, { flexDirection }]}>
            <TextInput
              value={newComment}
              onChangeText={setNewComment}
              mode="outlined"
              placeholder={t('tasks.addComment', 'הוסף הערה חדשה...')}
              style={[styles.commentInput, { textAlign }]}
              outlineColor={theme.colors.outline}
              activeOutlineColor={BRAND_COLOR}
              dense
              multiline
            />
            <IconButton
              icon="send"
              iconColor="#FFFFFF"
              size={20}
              style={[styles.commentSendBtn, { backgroundColor: BRAND_COLOR }]}
              onPress={handleAddComment}
              disabled={!newComment.trim() || addingComment}
              loading={addingComment}
            />
          </View>

          {activitiesLoading ? (
            <ActivityIndicator size="small" style={{ marginTop: 12 }} color={BRAND_COLOR} />
          ) : activities.length > 0 ? (
            <View style={styles.activitiesList}>
              {activities.map((act, idx) => {
                const actType = act.type || act.Type || 'comment';
                const actText = act.text || act.Text || '';
                const actUser = act.userName || act.UserName || '';
                const actDate = act.createdOn || act.CreatedOn || '';
                const isComment = actType === 'comment';
                return (
                  <View key={act.activityId || act.ActivityId || idx} style={[styles.activityItem, { borderColor: theme.colors.outlineVariant }]}>
                    <View style={[styles.activityHeader, { flexDirection }]}>
                      <View style={[styles.activityUserRow, { flexDirection }]}>
                        <Avatar.Text
                          size={24}
                          label={getInitials(actUser)}
                          style={{ backgroundColor: isComment ? theme.colors.primaryContainer : theme.colors.surfaceVariant }}
                          labelStyle={{ fontSize: 9, color: theme.colors.primary }}
                        />
                        <Text variant="labelSmall" style={{ color: theme.colors.onSurface, fontWeight: '600' }}>
                          {actUser}
                        </Text>
                      </View>
                      {actDate ? (
                        <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant, fontSize: 10 }}>
                          {formatDate(actDate)}
                        </Text>
                      ) : null}
                    </View>
                    <Text
                      variant="bodySmall"
                      style={[
                        styles.activityText,
                        { color: theme.colors.onSurface, textAlign },
                        !isComment && { fontStyle: 'italic', color: theme.colors.onSurfaceVariant },
                      ]}
                    >
                      {isComment ? actText : `${t(`tasks.activityType_${actType}`, actType)}: ${actText}`}
                    </Text>
                  </View>
                );
              })}
            </View>
          ) : (
            <Text variant="bodySmall" style={{ textAlign: 'center', color: theme.colors.onSurfaceVariant, marginTop: 8 }}>
              {t('tasks.noActivity', 'אין פעילות עדיין')}
            </Text>
          )}
        </View>

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

      {/* Lead picker Modal */}
      <Portal>
        <Modal
          visible={leadPickerVisible}
          onDismiss={() => { setLeadPickerVisible(false); setLeadSearch(''); }}
          contentContainerStyle={[
            { margin: 16, borderRadius: 12, backgroundColor: theme.colors.surface, maxHeight: '80%' },
          ]}
        >
          <View style={[{ flexDirection, alignItems: 'center', padding: 12, paddingBottom: 4 }]}>
            <Text variant="titleMedium" style={{ color: theme.colors.onSurface, fontWeight: '700', flex: 1, textAlign }}>
              {t('tasks.selectLead', 'בחר ליד')}
            </Text>
            <IconButton icon="close" size={20} onPress={() => { setLeadPickerVisible(false); setLeadSearch(''); }} />
          </View>
          <Searchbar
            placeholder={t('common.search')}
            value={leadSearch}
            onChangeText={handleLeadSearch}
            style={{ marginHorizontal: 12, marginBottom: 8 }}
            autoFocus
          />
          {leadSearching ? (
            <ActivityIndicator size="large" color={BRAND_COLOR} style={{ marginVertical: 32 }} />
          ) : (
            <FlatList
              data={leadResults}
              keyExtractor={(item) => item.id || String(Math.random())}
              style={{ maxHeight: 380 }}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[{ flexDirection, alignItems: 'center', gap: 10, padding: 12, borderBottomWidth: 1, borderBottomColor: theme.colors.outlineVariant }]}
                  onPress={() => {
                    setFormRelatedLeadId(item.id);
                    setFormRelatedLeadName(item.title || item.contactName || item.id);
                    setLeadPickerVisible(false);
                    setLeadSearch('');
                  }}
                >
                  <MaterialCommunityIcons name="chart-line" size={20} color={BRAND_COLOR} />
                  <View style={{ flex: 1 }}>
                    <Text variant="bodyMedium" style={{ color: theme.colors.onSurface, fontWeight: '600', textAlign }}>
                      {item.title || item.contactName || item.id}
                    </Text>
                    {item.contactName && item.title && (
                      <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant, textAlign }}>
                        {item.contactName}
                      </Text>
                    )}
                  </View>
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center', margin: 24 }}>
                  {t('common.noResults')}
                </Text>
              }
            />
          )}
        </Modal>
      </Portal>

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
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
            {/* Bounded maxHeight lets the ScrollView scroll. A bare `flex:1` collapses the content
                to height 0 inside a Paper Modal whose container only has `maxHeight` (grey backdrop). */}
            <ScrollView style={{ maxHeight: windowHeight * 0.74 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
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

              <Pressable onPress={openDuePicker}>
                <View pointerEvents="none">
                <TextInput
                  label={t('tasks.dueDate')}
                  value={formDueDate ? (() => { const d = new Date(formDueDate); return !isNaN(d.getTime()) ? d.toLocaleString(i18n.language === 'he' ? 'he-IL' : 'en-US', { dateStyle: 'short', timeStyle: 'short' }) : formDueDate; })() : ''}
                  mode="outlined"
                  editable={false}
                  placeholder={t('tasks.selectDueDate', 'בחר תאריך ושעה')}
                  style={[styles.formInput, { textAlign }]}
                  outlineColor={theme.colors.outline}
                  activeOutlineColor={BRAND_COLOR}
                  right={<TextInput.Icon icon="calendar" onPress={openDuePicker} />}
                />
                </View>
              </Pressable>

              <View style={[styles.reminderRow, { flexDirection }]}>
                <View style={[styles.reminderLabelRow, { flexDirection }]}>
                  <MaterialCommunityIcons name="bell-outline" size={20} color={BRAND_COLOR} />
                  <Text style={[styles.reminderLabel, { color: theme.colors.onSurface }]}>
                    {t('tasks.reminder', 'תזכורת')}
                  </Text>
                </View>
                <Switch
                  value={reminderEnabled}
                  onValueChange={(val) => {
                    setReminderEnabled(val);
                    if (val && formDueDate) {
                      setReminderDateObj(new Date(formDueDate));
                    }
                  }}
                  color={BRAND_COLOR}
                />
              </View>

              {reminderEnabled && (
                <>
                  <Pressable onPress={openReminderPicker}>
                    <View pointerEvents="none">
                    <TextInput
                      label={t('tasks.reminderDateTime', 'תאריך ושעת תזכורת')}
                      value={reminderDateObj.toLocaleString(i18n.language === 'he' ? 'he-IL' : 'en-US', { dateStyle: 'short', timeStyle: 'short' })}
                      mode="outlined"
                      editable={false}
                      style={[styles.formInput, { textAlign }]}
                      outlineColor={theme.colors.outline}
                      activeOutlineColor={BRAND_COLOR}
                      right={<TextInput.Icon icon="bell-ring-outline" onPress={openReminderPicker} />}
                    />
                    </View>
                  </Pressable>
                </>
              )}

              {/* Assigned to - user picker */}
              <Pressable
                onPress={() => setUserPickerExpanded((v) => !v)}
                style={[
                  styles.formInput,
                  {
                    borderWidth: 1,
                    borderRadius: 4,
                    borderColor: userPickerExpanded ? BRAND_COLOR : theme.colors.outline,
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                    backgroundColor: theme.colors.surface,
                  },
                ]}
              >
                <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 2 }}>
                  {t('tasks.assignedTo')}
                </Text>
                <View style={[{ flexDirection, alignItems: 'center', gap: 8 }]}>
                  <MaterialCommunityIcons name="account" size={16} color={theme.colors.onSurfaceVariant} />
                  <Text variant="bodyMedium" style={{ flex: 1, color: formAssignedTo ? theme.colors.onSurface : theme.colors.onSurfaceVariant, textAlign }}>
                    {orgUsersLoading ? t('common.loading') || 'טוען...' : (formAssignedTo || t('tasks.selectUser') || 'בחר משתמש')}
                  </Text>
                  <MaterialCommunityIcons name={userPickerExpanded ? 'chevron-up' : 'chevron-down'} size={18} color={theme.colors.onSurfaceVariant} />
                </View>
              </Pressable>
              {userPickerExpanded && (
                <View style={{ borderWidth: 1, borderColor: theme.colors.outline, borderRadius: 4, marginTop: -14, marginBottom: 14, overflow: 'hidden' }}>
                  <Pressable
                    style={[{ padding: 12, flexDirection, alignItems: 'center', gap: 8 }]}
                    onPress={() => { setFormAssignedTo(''); setFormAssignedToId(''); setUserPickerExpanded(false); }}
                  >
                    <MaterialCommunityIcons name="close" size={16} color={theme.colors.onSurfaceVariant} />
                    <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                      {t('common.none') || 'ללא'}
                    </Text>
                  </Pressable>
                  <Divider />
                  {orgUsers.map((u) => (
                    <Pressable
                      key={u.uID || u.userId}
                      style={[{ padding: 12, flexDirection, alignItems: 'center', gap: 8, backgroundColor: (u.uID || u.userId) === formAssignedToId ? `${BRAND_COLOR}15` : 'transparent' }]}
                      onPress={() => { setFormAssignedTo(u.fullname || u.name || ''); setFormAssignedToId(u.uID || u.userId || ''); setUserPickerExpanded(false); }}
                    >
                      <MaterialCommunityIcons name="account" size={16} color={(u.uID || u.userId) === formAssignedToId ? BRAND_COLOR : theme.colors.onSurfaceVariant} />
                      <Text variant="bodySmall" style={{ color: (u.uID || u.userId) === formAssignedToId ? BRAND_COLOR : theme.colors.onSurface, fontWeight: (u.uID || u.userId) === formAssignedToId ? '700' : '400' }}>
                        {u.fullname || u.name}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )}

              <Text variant="labelLarge" style={[styles.formLabel, { color: theme.colors.onSurface }]}>
                {t('tasks.relatedTo', 'משויך ל')}
              </Text>

              {/* Entity type chips */}
              <View style={{ flexDirection, gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
                {[
                  { key: '', label: t('common.none', 'ללא'), icon: 'close-circle-outline' },
                  { key: 'contact', label: t('tasks.relatedContact', 'איש קשר'), icon: 'account' },
                  { key: 'lead', label: t('tasks.relatedLead', 'ליד'), icon: 'chart-line' },
                ].map(({ key, label, icon }) => (
                  <Chip
                    key={key}
                    selected={formRelatedEntityType === key}
                    onPress={() => {
                      setFormRelatedEntityType(key as '' | 'contact' | 'lead');
                      if (key !== 'contact') {
                        setFormRelatedContactName('');
                        setFormRelatedContactId('');
                        setFormRelatedContactPhone('');
                      }
                      if (key !== 'lead') {
                        setFormRelatedLeadName('');
                        setFormRelatedLeadId('');
                      }
                    }}
                    icon={icon}
                    style={formRelatedEntityType === key ? { backgroundColor: `${BRAND_COLOR}20` } : undefined}
                    selectedColor={BRAND_COLOR}
                  >
                    {label}
                  </Chip>
                ))}
              </View>

              {/* Contact picker */}
              {formRelatedEntityType === 'contact' && (
                <Pressable
                  onPress={() => setContactLookupVisible(true)}
                  style={[
                    styles.contactLookupField,
                    { backgroundColor: theme.colors.surfaceVariant, borderColor: formRelatedContactId ? BRAND_COLOR : theme.colors.outline, flexDirection },
                  ]}
                >
                  <MaterialCommunityIcons name="account-search" size={20} color={formRelatedContactId ? BRAND_COLOR : theme.colors.onSurfaceVariant} />
                  <Text
                    style={{ color: formRelatedContactName ? theme.colors.onSurface : theme.colors.onSurfaceVariant, fontSize: 15, textAlign, flex: 1, marginStart: 8 }}
                    numberOfLines={1}
                  >
                    {formRelatedContactName
                      ? `${formRelatedContactName}${formRelatedContactPhone ? `  •  ${formRelatedContactPhone}` : ''}`
                      : t('common.selectContact')}
                  </Text>
                  {formRelatedContactId ? (
                    <Pressable onPress={() => { setFormRelatedContactName(''); setFormRelatedContactId(''); setFormRelatedContactPhone(''); }} hitSlop={8}>
                      <MaterialCommunityIcons name="close-circle" size={18} color={BRAND_COLOR} />
                    </Pressable>
                  ) : null}
                </Pressable>
              )}

              {/* Lead picker */}
              {formRelatedEntityType === 'lead' && (
                <Pressable
                  onPress={openLeadPicker}
                  style={[
                    styles.contactLookupField,
                    { backgroundColor: theme.colors.surfaceVariant, borderColor: formRelatedLeadId ? BRAND_COLOR : theme.colors.outline, flexDirection },
                  ]}
                >
                  <MaterialCommunityIcons name="chart-line" size={20} color={formRelatedLeadId ? BRAND_COLOR : theme.colors.onSurfaceVariant} />
                  <Text
                    style={{ color: formRelatedLeadName ? theme.colors.onSurface : theme.colors.onSurfaceVariant, fontSize: 15, textAlign, flex: 1, marginStart: 8 }}
                    numberOfLines={1}
                  >
                    {formRelatedLeadName || t('tasks.selectLead', 'בחר ליד')}
                  </Text>
                  {formRelatedLeadId ? (
                    <Pressable onPress={() => { setFormRelatedLeadName(''); setFormRelatedLeadId(''); }} hitSlop={8}>
                      <MaterialCommunityIcons name="close-circle" size={18} color={BRAND_COLOR} />
                    </Pressable>
                  ) : null}
                </Pressable>
              )}

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

      {/* Due date picker (edit modal) */}
      <GambotDateTimePicker
        visible={showDueDatePicker}
        value={formDueDate || dueDateObj}
        title={t('tasks.dueDate')}
        allowClear
        onConfirm={(d) => {
          // Keep the reminder aligned with the due date: shift it by the same amount the due date
          // moved so the chosen gap is preserved (matches AddTaskSheet). Editing the reminder alone
          // never touches the due date.
          const prevDue = formDueDate ? new Date(formDueDate) : dueDateObj;
          const base = prevDue && !isNaN(prevDue.getTime()) ? prevDue : d;
          const delta = d.getTime() - base.getTime();
          setDueDateObj(d);
          setFormDueDate(d.toISOString());
          setReminderDateObj((prev) => {
            const ref = prev && !isNaN(prev.getTime()) ? prev : new Date(d);
            const shifted = new Date(ref.getTime() + delta);
            return isNaN(shifted.getTime()) ? new Date(d) : shifted;
          });
        }}
        onClear={() => setFormDueDate('')}
        onDismiss={() => setShowDueDatePicker(false)}
      />

      {/* Reminder picker (edit modal) */}
      <GambotDateTimePicker
        visible={showReminderDatePicker}
        value={reminderDateObj}
        title={t('tasks.reminderDateTime', 'תאריך ושעת תזכורת')}
        onConfirm={(d) => setReminderDateObj(d)}
        onDismiss={() => setShowReminderDatePicker(false)}
      />

      {/* Inline due date picker (task view — no edit modal needed) */}
      <GambotDateTimePicker
        visible={inlineDueVisible}
        value={task?.dueDate || dueDateObj}
        title={t('tasks.dueDate')}
        allowClear
        onConfirm={(d) => saveDueDateInline(d.toISOString())}
        onClear={() => saveDueDateInline(null)}
        onDismiss={() => setInlineDueVisible(false)}
      />
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
  reminderRow: {
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
    paddingHorizontal: 4,
  },
  reminderLabelRow: {
    alignItems: 'center',
    gap: 8,
  },
  reminderLabel: {
    fontSize: 15,
    fontWeight: '500',
  },
  commentInputRow: {
    alignItems: 'center',
    gap: 8,
  },
  commentInput: {
    flex: 1,
    maxHeight: 80,
    fontSize: 14,
  },
  commentSendBtn: {
    borderRadius: 20,
    marginTop: 4,
  },
  activitiesList: {
    marginTop: 12,
    gap: 10,
  },
  activityItem: {
    borderWidth: 1,
    borderRadius: borderRadius.md,
    padding: 10,
  },
  activityHeader: {
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  activityUserRow: {
    alignItems: 'center',
    gap: 6,
  },
  activityText: {
    lineHeight: 20,
  },
});
