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
  TextInput as RNTextInput,
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
import { borderRadius } from '../../../constants/theme';
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
  const [deleting, setDeleting] = useState(false);

  // Autosave state: every field change is saved immediately (no Edit button, no Save button).
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Text fields keep a local draft while typing and save on blur.
  const [titleDraft, setTitleDraft] = useState(cachedTask?.title ?? '');
  const [descDraft, setDescDraft] = useState(cachedTask?.description ?? '');
  const titleFocusedRef = useRef(false);
  const descFocusedRef = useRef(false);

  const [orgUsers, setOrgUsers] = useState<OrgUser[]>([]);
  const [orgUsersLoading, setOrgUsersLoading] = useState(false);
  const [userPickerExpanded, setUserPickerExpanded] = useState(false);

  const [contactLookupVisible, setContactLookupVisible] = useState(false);
  const [leadPickerVisible, setLeadPickerVisible] = useState(false);
  const [leadSearch, setLeadSearch] = useState('');
  const [leadResults, setLeadResults] = useState<any[]>([]);
  const [leadSearching, setLeadSearching] = useState(false);
  const leadDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [dueDateObj, setDueDateObj] = useState<Date>(new Date());
  const [inlineDueVisible, setInlineDueVisible] = useState(false);
  const [reminderPickerVisible, setReminderPickerVisible] = useState(false);

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

  // Keep the drafts in sync with the server value, but never clobber what the user is typing.
  useEffect(() => {
    if (task && !titleFocusedRef.current) setTitleDraft(task.title || '');
  }, [task?.title]);
  useEffect(() => {
    if (task && !descFocusedRef.current) setDescDraft(task.description || '');
  }, [task?.description]);

  useEffect(() => () => {
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
  }, []);

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
  }, [task?.id, fetchActivities]);

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
        user.fullname || (user as any).displayName || 'User',
      );
      setNewComment('');
      await fetchActivities();
    } catch {}
    setAddingComment(false);
  }, [user, task, newComment, fetchActivities]);

  /**
   * Autosave a partial update. The change is applied to the screen immediately (`optimistic`),
   * sent to the backend, and the task is re-read afterwards; on failure the server value is
   * restored and an alert is shown.
   */
  const savePatch = useCallback(
    async (patch: Record<string, any>, optimistic?: Record<string, any>) => {
      if (!user?.organization || !task) return;
      const taskId = task.taskId || task.id;
      if (optimistic) setTask((prev) => (prev ? ({ ...prev, ...optimistic } as Task) : prev));
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      setSaveState('saving');
      try {
        await tasksApi.update(
          user.organization,
          { id: task.id, taskId, ...patch } as any,
          user.userId || user.uID || '',
          user.fullname || '',
        );
        await fetchTask();
        setSaveState('saved');
        savedTimerRef.current = setTimeout(() => setSaveState('idle'), 1500);
      } catch (err: any) {
        setSaveState('idle');
        Alert.alert(t('common.error'), err.message || t('errors.generic'));
        await fetchTask();
      }
    },
    [user?.organization, user?.userId, user?.uID, user?.fullname, task, fetchTask, t],
  );

  const commitTitle = useCallback(() => {
    titleFocusedRef.current = false;
    if (!task) return;
    const next = titleDraft.trim();
    if (!next) {
      setTitleDraft(task.title || '');
      return;
    }
    if (next !== (task.title || '')) savePatch({ title: next }, { title: next });
  }, [task, titleDraft, savePatch]);

  const commitDescription = useCallback(() => {
    descFocusedRef.current = false;
    if (!task) return;
    const next = descDraft.trim();
    if (next !== (task.description || '').trim()) savePatch({ description: next }, { description: next });
  }, [task, descDraft, savePatch]);

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
      if (!user?.organization || !task || newStatus === task.status) return;
      const taskId = task.taskId || task.id;
      const previous = task.status;
      setTask((prev) => (prev ? ({ ...prev, status: newStatus } as Task) : prev));
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
        setTask((prev) => (prev ? ({ ...prev, status: previous } as Task) : prev));
        Alert.alert(t('common.error'), err.message || t('errors.generic'));
      }
    },
    [user?.organization, user?.userId, user?.uID, user?.fullname, task, fetchTask, t],
  );

  const handleComplete = useCallback(() => {
    handleStatusChange('completed');
  }, [handleStatusChange]);

  // Due date: shift the reminder along with it so it keeps the same gap (same rule as the
  // shared AddTaskSheet). Only when a reminder is actually set on the task.
  const saveDueDate = useCallback(
    (iso: string | null) => {
      if (!task) return;
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
      savePatch(
        { dueDate: iso || '', ...reminderPatch },
        { dueDate: iso || '', ...(reminderPatch.reminderDate ? { reminderDate: reminderPatch.reminderDate } : {}) },
      );
    },
    [task, savePatch],
  );

  const toggleReminder = useCallback(
    (enabled: boolean) => {
      if (!task) return;
      if (!enabled) {
        savePatch(
          { reminderEnabled: false, reminderDate: null, reminderDateUTC: null },
          { reminderEnabled: false, reminderDate: '' },
        );
        return;
      }
      // Default the reminder to the due date; if that is already past (or missing), one hour from now.
      const due = task.dueDate ? new Date(task.dueDate) : null;
      const base = due && !isNaN(due.getTime()) && due.getTime() > Date.now() ? due : new Date(Date.now() + 60 * 60 * 1000);
      const iso = base.toISOString();
      savePatch(
        { reminderEnabled: true, reminderDate: iso, reminderDateUTC: iso, reminderRecipientType: 'assigned_user' },
        { reminderEnabled: true, reminderDate: iso },
      );
    },
    [task, savePatch],
  );

  const saveReminderDate = useCallback(
    (d: Date) => {
      const iso = d.toISOString();
      savePatch(
        { reminderEnabled: true, reminderDate: iso, reminderDateUTC: iso, reminderRecipientType: 'assigned_user' },
        { reminderEnabled: true, reminderDate: iso },
      );
    },
    [savePatch],
  );

  const saveAssignee = useCallback(
    (userId: string, userName: string) => {
      setUserPickerExpanded(false);
      savePatch(
        { assignedToId: userId || undefined, assignedTo: userId || undefined, assignedToName: userName || undefined },
        { assignedToId: userId, assignedToName: userName },
      );
    },
    [savePatch],
  );

  const saveRelated = useCallback(
    (type: 'contact' | 'lead' | null, entityId = '', entityName = '', phone = '') => {
      if (!type) {
        savePatch(
          { relatedTo: null },
          { relatedTo: undefined, relatedContactName: '', relatedContactId: '', relatedContactPhone: '', relatedLeadName: '', relatedLeadId: '' },
        );
        return;
      }
      savePatch(
        {
          relatedTo: { type, entityId, entityName },
          ...(type === 'contact' && phone ? { relatedContactPhone: phone } : {}),
        },
        { relatedTo: { type, entityId, entityName } },
      );
    },
    [savePatch],
  );

  const openUserPicker = useCallback(() => {
    const next = !userPickerExpanded;
    setUserPickerExpanded(next);
    if (next && orgUsers.length === 0) {
      setOrgUsersLoading(true);
      usersApi.getAll(user?.organization || '').then((u) => setOrgUsers(u)).catch(() => {}).finally(() => setOrgUsersLoading(false));
    }
  }, [userPickerExpanded, orgUsers.length, user?.organization]);

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
  const currentPriority = ((task as any).priority || task.priority || 'medium') as string;
  const completed = task.status === 'completed';
  const relatedEntity = getRelatedEntityDisplay(task);
  const createdDate = task.createdAt || task.createdOn;
  const reminderOn = !!(task as any).reminderEnabled;
  const reminderIso: string = (task as any).reminderDate || '';
  const cardStyle = [
    styles.sectionCard,
    { backgroundColor: theme.custom.cardBackground, borderColor: theme.colors.outlineVariant },
  ];

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
        {/* Header: the title is the edit field. */}
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
            <RNTextInput
              value={titleDraft}
              onChangeText={setTitleDraft}
              onFocus={() => { titleFocusedRef.current = true; }}
              onBlur={commitTitle}
              onSubmitEditing={commitTitle}
              returnKeyType="done"
              placeholder={t('tasks.taskTitle')}
              placeholderTextColor="rgba(255,255,255,0.6)"
              selectionColor="#FFFFFF"
              style={[styles.headerTitleInput, { textAlign }]}
            />
            <View style={styles.saveIndicator}>
              {saveState === 'saving' ? (
                <ActivityIndicator size={16} color="#FFFFFF" />
              ) : saveState === 'saved' ? (
                <MaterialCommunityIcons name="check" size={18} color="#FFFFFF" />
              ) : null}
            </View>
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
          keyboardShouldPersistTaps="handled"
        >
          {/* Status — one tap to change. */}
          <View style={cardStyle}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">
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
            {overdue && (
              <View style={styles.overdueBanner}>
                <MaterialCommunityIcons name="alert" size={16} color="#F44336" />
                <Text style={styles.overdueText}>{t('tasks.overdue')}</Text>
              </View>
            )}
          </View>

          {/* Fields — every row edits in place and saves immediately. */}
          <View style={cardStyle}>
            {/* Due date */}
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
                    const parts = [formatDate(task.dueDate, 'dd/MM/yyyy HH:mm'), formatRelativeTime(task.dueDate, lang)].filter(Boolean);
                    return parts.length ? parts.join(' • ') : String(task.dueDate);
                  })()}
                </Text>
              </View>
              <MaterialCommunityIcons name="chevron-down" size={18} color={theme.colors.onSurfaceVariant} />
            </Pressable>

            <Divider style={styles.rowDivider} />

            {/* Reminder: switch + (when on) tap the time to change it */}
            <View style={styles.detailRow}>
              <View style={[styles.detailIcon, { backgroundColor: withAlpha(theme.colors.primary, 0.094) }]}>
                <MaterialCommunityIcons name="bell-outline" size={20} color={theme.colors.primary} />
              </View>
              <Pressable
                style={[styles.detailContent, { alignItems: 'flex-start' }]}
                disabled={!reminderOn}
                onPress={() => setReminderPickerVisible(true)}
              >
                <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                  {t('tasks.reminder', 'תזכורת')}
                </Text>
                <Text variant="bodyMedium" style={{ color: reminderOn ? theme.colors.onSurface : theme.colors.onSurfaceVariant, fontWeight: '500' }}>
                  {reminderOn && reminderIso ? formatDate(reminderIso, 'dd/MM/yyyy HH:mm') : t('tasks.noReminder')}
                </Text>
              </Pressable>
              <Switch value={reminderOn} onValueChange={toggleReminder} color={BRAND_COLOR} />
            </View>

            <Divider style={styles.rowDivider} />

            {/* Priority */}
            <View style={styles.fieldBlock}>
              <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant, textAlign }}>
                {t('tasks.priority')}
              </Text>
              <View style={[styles.chipsRow, { flexDirection }]}>
                {PRIORITIES.map((p) => {
                  const pc = PRIORITY_COLORS[p];
                  const active = currentPriority === p;
                  return (
                    <Chip
                      key={p}
                      selected={active}
                      onPress={() => { if (!active) savePatch({ priority: p }, { priority: p }); }}
                      compact
                      style={[
                        styles.formChip,
                        active
                          ? { backgroundColor: `${pc}20`, borderColor: pc, borderWidth: 1.5 }
                          : { backgroundColor: theme.colors.surfaceVariant, borderWidth: 1.5, borderColor: 'transparent' },
                      ]}
                      textStyle={[{ fontSize: 12 }, active && { color: pc, fontWeight: '700' }]}
                    >
                      {t(`tasks.${p}`)}
                    </Chip>
                  );
                })}
              </View>
            </View>

            {/* Type */}
            <View style={styles.fieldBlock}>
              <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant, textAlign }}>
                {t('tasks.taskType')}
              </Text>
              <View style={[styles.chipsRow, { flexDirection }]}>
                {TASK_TYPES.map((tt) => {
                  const active = (task.taskType || 'general') === tt;
                  return (
                    <Chip
                      key={tt}
                      selected={active}
                      onPress={() => { if (!active) savePatch({ taskType: tt }, { taskType: tt }); }}
                      compact
                      style={[
                        styles.formChip,
                        active
                          ? { backgroundColor: `${BRAND_COLOR}20`, borderColor: BRAND_COLOR, borderWidth: 1.5 }
                          : { backgroundColor: theme.colors.surfaceVariant, borderWidth: 1.5, borderColor: 'transparent' },
                      ]}
                      textStyle={[{ fontSize: 12 }, active && { color: BRAND_COLOR, fontWeight: '700' }]}
                    >
                      {t(`tasks.${tt}`)}
                    </Chip>
                  );
                })}
              </View>
            </View>

            <Divider style={styles.rowDivider} />

            {/* Assignee: tap to open the team list, tap a person to assign. */}
            <Pressable style={styles.detailRow} onPress={openUserPicker}>
              {task.assignedToName ? (
                <Avatar.Text
                  size={36}
                  label={getInitials(task.assignedToName)}
                  style={{ backgroundColor: theme.colors.primaryContainer }}
                  labelStyle={{ fontSize: 13, color: theme.colors.primary, fontWeight: '700' }}
                />
              ) : (
                <View style={[styles.detailIcon, { backgroundColor: withAlpha(theme.colors.primary, 0.094) }]}>
                  <MaterialCommunityIcons name="account-outline" size={20} color={theme.colors.primary} />
                </View>
              )}
              <View style={[styles.detailContent, { alignItems: 'flex-start' }]}>
                <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                  {t('tasks.assignedTo')}
                </Text>
                <Text variant="bodyMedium" style={{ color: task.assignedToName ? theme.colors.onSurface : theme.colors.onSurfaceVariant, fontWeight: '500' }}>
                  {task.assignedToName || t('tasks.selectUser')}
                </Text>
              </View>
              <MaterialCommunityIcons name={userPickerExpanded ? 'chevron-up' : 'chevron-down'} size={18} color={theme.colors.onSurfaceVariant} />
            </Pressable>
            {userPickerExpanded && (
              <View style={[styles.userList, { borderColor: theme.colors.outlineVariant }]}>
                {orgUsersLoading ? (
                  <ActivityIndicator size="small" color={BRAND_COLOR} style={{ margin: 16 }} />
                ) : (
                  <ScrollView style={{ maxHeight: 240 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                    {orgUsers.map((u) => {
                      const uid = u.uID || u.userId || '';
                      const selected = uid === task.assignedToId;
                      return (
                        <Pressable
                          key={uid}
                          style={[styles.userItem, { flexDirection, backgroundColor: selected ? `${BRAND_COLOR}15` : 'transparent' }]}
                          onPress={() => saveAssignee(uid, u.fullname || u.name || '')}
                        >
                          <MaterialCommunityIcons name={selected ? 'check-circle' : 'account'} size={18} color={selected ? BRAND_COLOR : theme.colors.onSurfaceVariant} />
                          <Text variant="bodyMedium" style={{ color: selected ? BRAND_COLOR : theme.colors.onSurface, fontWeight: selected ? '700' : '400' }}>
                            {u.fullname || u.name}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                )}
              </View>
            )}

            <Divider style={styles.rowDivider} />

            {/* Linked record: open it, unlink it, or link one (contact / lead). */}
            {relatedEntity ? (
              <View style={styles.detailRow}>
                <Pressable
                  onPress={() => {
                    const phone = (task as any)?.relatedContactPhone || (task?.relatedTo as any)?.entityPhone;
                    navigateToRelated(relatedEntity.type || '', relatedEntity.entityId, phone);
                  }}
                  style={[styles.detailRow, { flex: 1 }]}
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
                    <Text variant="bodyMedium" style={{ color: theme.colors.primary, fontWeight: '500' }} numberOfLines={1}>
                      {relatedEntity.name}
                    </Text>
                  </View>
                  <MaterialCommunityIcons
                    name={isRTL ? 'chevron-left' : 'chevron-right'}
                    size={20}
                    color={theme.colors.onSurfaceVariant}
                  />
                </Pressable>
                <IconButton
                  icon="link-variant-off"
                  size={20}
                  iconColor={theme.colors.onSurfaceVariant}
                  onPress={() => saveRelated(null)}
                  accessibilityLabel={t('tasks.unlink')}
                />
              </View>
            ) : (
              <View style={styles.fieldBlock}>
                <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant, textAlign }}>
                  {t('tasks.relatedTo', 'רשומה מקושרת')}
                </Text>
                <View style={[styles.chipsRow, { flexDirection }]}>
                  <Chip icon="account" compact style={styles.formChip} onPress={() => setContactLookupVisible(true)}>
                    {t('tasks.relatedContact', 'איש קשר')}
                  </Chip>
                  <Chip icon="trending-up" compact style={styles.formChip} onPress={openLeadPicker}>
                    {t('tasks.relatedLead', 'ליד')}
                  </Chip>
                </View>
              </View>
            )}
          </View>

          {/* Description — always an editable field. */}
          <View style={cardStyle}>
            <Text variant="labelLarge" style={[styles.sectionLabel, { color: theme.colors.onSurface, textAlign }]}>
              {t('tasks.description')}
            </Text>
            <RNTextInput
              value={descDraft}
              onChangeText={setDescDraft}
              onFocus={() => { descFocusedRef.current = true; }}
              onBlur={commitDescription}
              placeholder={t('tasks.addDescription')}
              placeholderTextColor={theme.colors.onSurfaceVariant}
              multiline
              style={[
                styles.descriptionInput,
                { color: theme.colors.onSurface, textAlign },
                completed && { opacity: 0.6 },
              ]}
            />
          </View>

          {/* Activity / Comments */}
          <View style={cardStyle}>
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

          {/* Timestamps */}
          {createdDate && (
            <View style={cardStyle}>
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
            setContactLookupVisible(false);
            saveRelated('contact', contact.id, contact.name, contact.phoneNumber);
          }}
          onDismiss={() => setContactLookupVisible(false)}
        />

        {/* Lead picker */}
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
                keyExtractor={(item, index) => item.id || String(index)}
                style={{ maxHeight: 380 }}
                keyboardShouldPersistTaps="handled"
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={[{ flexDirection, alignItems: 'center', gap: 10, padding: 12, borderBottomWidth: 1, borderBottomColor: theme.colors.outlineVariant }]}
                    onPress={() => {
                      setLeadPickerVisible(false);
                      setLeadSearch('');
                      saveRelated('lead', item.id, item.title || item.contactName || item.id);
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

        {/* Due date picker */}
        <GambotDateTimePicker
          visible={inlineDueVisible}
          value={task?.dueDate || dueDateObj}
          title={t('tasks.dueDate')}
          allowClear
          onConfirm={(d) => saveDueDate(d.toISOString())}
          onClear={() => saveDueDate(null)}
          onDismiss={() => setInlineDueVisible(false)}
        />

        {/* Reminder picker */}
        <GambotDateTimePicker
          visible={reminderPickerVisible}
          value={reminderIso || new Date()}
          title={t('tasks.reminderDateTime', 'תאריך ושעת תזכורת')}
          onConfirm={saveReminderDate}
          onDismiss={() => setReminderPickerVisible(false)}
        />
      </View>
    </KeyboardAvoidingView>
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
  headerTitleInput: {
    flex: 1,
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 17,
    paddingVertical: 8,
  },
  saveIndicator: {
    width: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1 },
  bodyContent: {
    padding: 16,
    gap: 12,
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
  rowDivider: {
    marginVertical: 10,
  },
  fieldBlock: {
    gap: 6,
    marginBottom: 10,
  },
  chipsRow: {
    gap: 8,
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  formChip: {
    height: 32,
  },
  userList: {
    borderWidth: 1,
    borderRadius: borderRadius.md,
    marginTop: 8,
    overflow: 'hidden',
  },
  userItem: {
    padding: 12,
    alignItems: 'center',
    gap: 10,
  },
  descriptionInput: {
    fontSize: 15,
    lineHeight: 22,
    minHeight: 60,
    paddingVertical: 0,
    textAlignVertical: 'top',
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
