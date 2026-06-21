import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  Pressable,
  RefreshControl,
  Animated,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import {
  Text,
  Searchbar,
  Chip,
  FAB,
  Avatar,
  ActivityIndicator,
  Portal,
  Modal,
  TextInput,
  Button,
  IconButton,
  Menu,
  Divider,
  Appbar,
  Switch,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useAuthStore } from '../../../../stores/authStore';
import { useAppTheme } from '../../../../hooks/useAppTheme';
import { useRTL } from '../../../../hooks/useRTL';
import { useWindowedList } from '../../../../hooks/useWindowedList';
import { ListPaginationFooter } from '../../../../components/ListPaginationFooter';
import { tasksApi } from '../../../../services/api/tasks';
import { cacheEntities } from '../../../../services/entityCache';
import { readList as readDiskList, cacheList as cacheDiskList } from '../../../../services/db/genericCache';
import { getDataVisibility } from '../../../../constants/permissions';
import { formatDate, formatRelativeTime, getInitials } from '../../../../utils/formatters';
import { spacing, borderRadius, fontSize } from '../../../../constants/theme';
import type { Task } from '../../../../types';
import { useContactLookup } from '../../../../hooks/useContactLookup';
import ContactLookupField from '../../../../components/ContactLookupField';

const BRAND_COLOR = '#2e6155';
const STATUS_FILTERS = ['all', 'open', 'in_progress', 'completed', 'cancelled'] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

const PRIORITY_COLORS: Record<string, string> = {
  low: '#4CAF50',
  medium: '#FF9800',
  high: '#FF5722',
  urgent: '#F44336',
};

const STATUS_COLORS: Record<string, string> = {
  open: '#2196F3',
  pending: '#9E9E9E',
  in_progress: '#FF9800',
  completed: '#4CAF50',
  cancelled: '#757575',
};

const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
const TASK_TYPES = ['phone_call', 'follow_up', 'meeting', 'general', 'other'] as const;

function isOverdue(task: Task): boolean {
  if (!task.dueDate || task.status === 'completed' || task.status === 'cancelled') return false;
  return new Date(task.dueDate) < new Date();
}

function getRelatedName(task: Task): string {
  if (task.relatedTo?.entityName) return task.relatedTo.entityName;
  if ((task as any).relatedContactName) return (task as any).relatedContactName;
  if ((task as any).relatedEntityName) return (task as any).relatedEntityName;
  if ((task as any).relatedLeadName) return (task as any).relatedLeadName;
  return '';
}

export default function TasksMoreScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useAppTheme();
  const { isRTL, flexDirection, textAlign } = useRTL();
  const { t, i18n } = useTranslation();

  const user = useAuthStore((s) => s.user);
  const { contactSearch, contactResults, contactSearching, selectedContact, handleContactSearch, handleSelectContact, resetContactLookup } = useContactLookup();

  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [searchVisible, setSearchVisible] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [taskSortKey, setTaskSortKey] = useState<'priority' | 'createdOn' | 'dueDate' | 'reminderDate'>('priority');
  const [taskSortDir, setTaskSortDir] = useState<'asc' | 'desc'>('desc');
  const [priorityMenuVisible, setPriorityMenuVisible] = useState(false);
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [creating, setCreating] = useState(false);

  const [formTitle, setFormTitle] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formPriority, setFormPriority] = useState<string>('medium');
  const [formDueDate, setFormDueDate] = useState('');
  const [formAssignedTo, setFormAssignedTo] = useState('');
  const [formTaskType, setFormTaskType] = useState<string>('general');
  const [formRelatedEntityName, setFormRelatedEntityName] = useState('');

  const [showDueDatePicker, setShowDueDatePicker] = useState(false);
  const [showDueTimePicker, setShowDueTimePicker] = useState(false);
  const [dueDateObj, setDueDateObj] = useState<Date>(new Date());

  const [reminderEnabled, setReminderEnabled] = useState(false);
  const [showReminderDatePicker, setShowReminderDatePicker] = useState(false);
  const [showReminderTimePicker, setShowReminderTimePicker] = useState(false);
  const [reminderDateObj, setReminderDateObj] = useState<Date>(new Date());

  const tasksDV = getDataVisibility(user?.DataVisibility, user?.SecurityRole, 'tasks');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const fetchTasks = useCallback(async () => {
    if (!user?.organization) { setLoading(false); return; }
    try {
      setError(null);
      const data = await tasksApi.getAll(
        user.organization,
        user.uID || user.userId,
        // Backend GetAllTasksByOrganization filters only when dataVisibility === 'own'.
        // (Previously sent 'seeOwn'/'seeAll', which never matched → all tasks always showed.)
        tasksDV === 'own' ? 'own' : 'all',
      );
      cacheEntities('tasks', data);
      cacheDiskList('tasks', user.organization, data, (tk) => tk.id);
      setTasks(data);
    } catch (err: any) {
      setError(err.message || t('errors.generic'));
    } finally {
      setLoading(false);
    }
  }, [user?.organization, t, tasksDV]);

  // Instant open after an app restart: hydrate from the on-device DB before the network responds.
  useEffect(() => {
    if (!user?.organization) return;
    let active = true;
    readDiskList<Task>('tasks', user.organization).then((cached) => {
      if (active && cached.length > 0) {
        setTasks((prev) => (prev.length > 0 ? prev : cached));
        setLoading(false);
      }
    });
    return () => { active = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.organization]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const didMountRef = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!didMountRef.current) {
        didMountRef.current = true;
        return;
      }
      fetchTasks();
    }, [fetchTasks])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchTasks();
    setRefreshing(false);
  }, [fetchTasks]);

  const filteredTasks = useMemo(() => {
    let result = Array.isArray(tasks) ? tasks : [];

    if (statusFilter !== 'all') {
      result = result.filter((t) => t.status === statusFilter);
    }

    if (priorityFilter !== 'all') {
      result = result.filter((t) => t.priority === priorityFilter);
    }

    if (debouncedSearch.trim()) {
      const q = debouncedSearch.trim().toLowerCase();
      result = result.filter(
        (t) =>
          t.title?.toLowerCase().includes(q) ||
          t.description?.toLowerCase().includes(q) ||
          t.assignedToName?.toLowerCase().includes(q) ||
          (t as any).contactName?.toLowerCase().includes(q) ||
          (t as any).relatedEntityName?.toLowerCase().includes(q),
      );
    }

    return result.sort((a, b) => {
      if (a.status === 'completed' && b.status !== 'completed') return 1;
      if (a.status !== 'completed' && b.status === 'completed') return -1;

      const parseTs = (v: any): number => {
        if (!v) return 0;
        if (typeof v === 'number') return v;
        if (v._seconds) return v._seconds * 1000;
        if (v.seconds) return v.seconds * 1000;
        const d = new Date(v);
        return isNaN(d.getTime()) ? 0 : d.getTime();
      };

      let aVal: number, bVal: number;
      if (taskSortKey === 'createdOn') {
        aVal = parseTs(a.createdOn || (a as any).CreatedOn);
        bVal = parseTs(b.createdOn || (b as any).CreatedOn);
      } else if (taskSortKey === 'dueDate') {
        aVal = parseTs(a.dueDate);
        bVal = parseTs(b.dueDate);
      } else if (taskSortKey === 'reminderDate') {
        aVal = parseTs(a.reminderDate || (a as any).reminderDateUTC);
        bVal = parseTs(b.reminderDate || (b as any).reminderDateUTC);
      } else {
        const priorityOrder: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
        aVal = priorityOrder[a.priority] ?? 2;
        bVal = priorityOrder[b.priority] ?? 2;
      }
      if (aVal < bVal) return taskSortDir === 'asc' ? -1 : 1;
      if (aVal > bVal) return taskSortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [tasks, statusFilter, priorityFilter, debouncedSearch, taskSortKey, taskSortDir]);

  // Client-side pagination over the filtered list (search still spans everything).
  const { visible: visibleTasks, hasMore: tasksHasMore, loadMore: tasksLoadMore, loadAll: tasksLoadAll, count: tasksCount } = useWindowedList(filteredTasks, {
    pageSize: 30,
    resetKey: `${statusFilter}|${priorityFilter}|${debouncedSearch}|${taskSortKey}|${taskSortDir}`,
  });

  const resetForm = useCallback(() => {
    // Default due date + reminder to "now" so the user only nudges it to the nearest convenient
    // time. Kept consistent with the shared AddTaskSheet used by contacts/leads/cases/orders.
    const now = new Date();
    setFormTitle('');
    setFormDescription('');
    setFormPriority('medium');
    setFormDueDate(now.toISOString());
    setFormAssignedTo('');
    setFormTaskType('general');
    setFormRelatedEntityName('');
    setDueDateObj(new Date(now));
    setReminderEnabled(true);
    setReminderDateObj(new Date(now));
    resetContactLookup();
  }, [resetContactLookup]);

  const handleCreate = useCallback(async () => {
    if (!user?.organization || !formTitle.trim()) return;
    setCreating(true);
    try {
      const meId = user?.uID || user?.userId || '';
      const meName = user?.fullname || (user as any)?.name || '';
      const contactName = selectedContact
        ? (selectedContact.fullName || selectedContact.name || formRelatedEntityName.trim())
        : formRelatedEntityName.trim();
      const contactPhone = selectedContact?.phoneNumber || selectedContact?.phone || undefined;
      await tasksApi.create(user.organization, {
        title: formTitle.trim(),
        description: formDescription.trim() || undefined,
        priority: formPriority as Task['priority'],
        taskType: formTaskType as Task['taskType'],
        dueDate: formDueDate.trim() || undefined,
        // Default assignee to the current user (like web) when no one is typed in.
        assignedToId: meId,
        assignedToName: formAssignedTo.trim() || meName,
        assignedTo: formAssignedTo.trim() || meName || undefined,
        relatedEntityName: contactName || undefined,
        relatedEntityPhone: contactPhone,
        relatedContactId: selectedContact?.id || undefined,
        ...(selectedContact
          ? { relatedTo: { type: 'contact', entityId: selectedContact.id || contactPhone || '', entityName: contactName } }
          : {}),
        status: 'open',
        reminderEnabled: reminderEnabled || undefined,
        reminderDate: reminderEnabled ? reminderDateObj.toISOString() : undefined,
        reminderDateUTC: reminderEnabled ? reminderDateObj.toISOString() : undefined,
        reminderRecipientType: reminderEnabled ? 'assigned_user' : undefined,
      } as any, meId, meName);
      setCreateModalVisible(false);
      resetForm();
      await fetchTasks();
    } catch (err: any) {
      setError(err.message || t('errors.generic'));
    } finally {
      setCreating(false);
    }
  }, [user?.organization, formTitle, formDescription, formPriority, formTaskType, formDueDate, formAssignedTo, formRelatedEntityName, resetForm, fetchTasks, t, reminderEnabled, reminderDateObj, selectedContact]);

  const openTask = useCallback(
    (task: Task) => {
      router.push({ pathname: '/(tabs)/more/tasks/[id]', params: { id: task.id } });
    },
    [router],
  );

  const handleCompleteTask = useCallback(async (task: Task) => {
    const taskId = (task as any).taskId || task.id;
    setTasks((prev) => prev.map((t) => t.id === task.id ? { ...t, status: 'completed' as const } : t));
    try {
      await tasksApi.complete(
        user?.organization || '',
        taskId,
        user?.uID || user?.userId || '',
        user?.fullname || '',
      );
    } catch {
      setTasks((prev) => prev.map((t) => t.id === task.id ? { ...t, status: task.status } : t));
    }
  }, [user]);

  const renderTaskCard = useCallback(
    ({ item }: { item: Task }) => {
      const overdue = isOverdue(item);
      const completed = item.status === 'completed';
      const cancelled = item.status === 'cancelled';
      const priorityColor = PRIORITY_COLORS[item.priority] || PRIORITY_COLORS.medium;
      const statusColor = STATUS_COLORS[item.status] || STATUS_COLORS.pending;

      return (
        <Pressable
          onPress={() => openTask(item)}
          android_ripple={{ color: theme.colors.surfaceVariant }}
          style={({ pressed }) => [
            styles.taskCard,
            {
              backgroundColor: pressed ? theme.colors.surfaceVariant : theme.custom.cardBackground,
              borderColor: overdue ? '#F4433640' : theme.colors.outlineVariant,
            },
            overdue && styles.taskCardOverdue,
          ]}
        >
          <View style={[styles.priorityBar, { backgroundColor: priorityColor }]} />

          {!completed && !cancelled ? (
            <Pressable
              onPress={() => handleCompleteTask(item)}
              hitSlop={8}
              style={styles.completeBtn}
            >
              <MaterialCommunityIcons
                name="checkbox-blank-circle-outline"
                size={26}
                color={theme.colors.onSurfaceVariant}
              />
            </Pressable>
          ) : (
            <View style={styles.completeBtn}>
              <MaterialCommunityIcons
                name="check-circle"
                size={26}
                color={STATUS_COLORS.completed}
              />
            </View>
          )}

          <View style={styles.taskContent}>
            <View style={[styles.taskTopRow, { flexDirection }]}>
              <Text
                variant="titleSmall"
                numberOfLines={1}
                style={[
                  styles.taskTitle,
                  { color: theme.colors.onSurface, textAlign },
                  completed && styles.taskTitleCompleted,
                ]}
              >
                {item.title}
              </Text>
              <Chip
                compact
                textStyle={[styles.statusChipText, { color: statusColor }]}
                style={[styles.statusChip, { backgroundColor: `${statusColor}18` }]}
              >
                {item.status ? t(`tasks.${item.status}`) : ''}
              </Chip>
            </View>

            {item.description ? (
              <Text
                variant="bodySmall"
                numberOfLines={2}
                style={[
                  styles.taskDescription,
                  { color: theme.colors.onSurfaceVariant, textAlign },
                  completed && { opacity: 0.5 },
                ]}
              >
                {item.description}
              </Text>
            ) : null}

            <View style={[styles.taskMeta, { flexDirection }]}>
              {item.dueDate ? (
                <View style={[styles.metaItem, { flexDirection }]}>
                  <MaterialCommunityIcons
                    name="calendar-clock"
                    size={14}
                    color={overdue ? '#F44336' : theme.colors.onSurfaceVariant}
                  />
                  <Text
                    variant="labelSmall"
                    style={[
                      styles.metaText,
                      { color: overdue ? '#F44336' : theme.colors.onSurfaceVariant },
                      overdue && { fontWeight: '700' },
                    ]}
                  >
                    {formatDate(item.dueDate)}
                    {overdue && ` • ${t('tasks.overdue')}`}
                  </Text>
                </View>
              ) : null}

              {item.assignedToName ? (
                <View style={[styles.metaItem, { flexDirection }]}>
                  <Avatar.Text
                    size={18}
                    label={getInitials(item.assignedToName)}
                    style={{ backgroundColor: theme.colors.primaryContainer }}
                    labelStyle={{ fontSize: 8, color: theme.colors.primary }}
                  />
                  <Text
                    variant="labelSmall"
                    numberOfLines={1}
                    style={[styles.metaText, { color: theme.colors.onSurfaceVariant }]}
                  >
                    {item.assignedToName}
                  </Text>
                </View>
              ) : null}

              {getRelatedName(item) ? (
                <View style={[styles.metaItem, { flexDirection }]}>
                  <MaterialCommunityIcons
                    name="link-variant"
                    size={14}
                    color={theme.colors.primary}
                  />
                  <Text
                    variant="labelSmall"
                    numberOfLines={1}
                    style={[styles.metaText, { color: theme.colors.primary, fontWeight: '500' }]}
                  >
                    {getRelatedName(item)}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>
        </Pressable>
      );
    },
    [theme, openTask, handleCompleteTask, flexDirection, textAlign, t],
  );

  const renderEmpty = useCallback(() => {
    if (loading) return null;
    return (
      <View style={styles.emptyContainer}>
        <MaterialCommunityIcons
          name="checkbox-marked-circle-outline"
          size={72}
          color={theme.colors.onSurfaceVariant}
          style={{ opacity: 0.3 }}
        />
        <Text
          variant="titleMedium"
          style={[styles.emptyTitle, { color: theme.colors.onSurface }]}
        >
          {t('tasks.noTasks')}
        </Text>
      </View>
    );
  }, [loading, theme, t]);

  if (loading && tasks.length === 0) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator size="large" color={BRAND_COLOR} />
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
      <Appbar.Header style={{ backgroundColor: BRAND_COLOR }} mode="center-aligned">
        <Appbar.BackAction onPress={() => router.back()} color="#FFF" />
        <Appbar.Content title={t('tasks.title')} titleStyle={{ color: '#FFF', fontWeight: '700', fontSize: 18 }} />
        <Appbar.Action
          icon={searchVisible ? 'close' : 'magnify'}
          color="#FFF"
          onPress={() => { setSearchVisible(!searchVisible); if (searchVisible) setSearchQuery(''); }}
        />
      </Appbar.Header>

      {searchVisible && (
        <View style={{ paddingHorizontal: 14, paddingVertical: 8, backgroundColor: theme.colors.surface }}>
          <Searchbar
            placeholder={t('tasks.searchPlaceholder')}
            value={searchQuery}
            onChangeText={setSearchQuery}
            returnKeyType="search"
            style={[styles.searchbar, { backgroundColor: theme.colors.surfaceVariant }]}
            inputStyle={{ fontSize: 14, textAlign: isRTL ? 'right' : 'left' }}
            iconColor={theme.colors.onSurfaceVariant}
            autoFocus
          />
        </View>
      )}

      <View
        style={[
          styles.filtersRow,
          { backgroundColor: theme.colors.surface, borderBottomColor: theme.colors.outline },
        ]}
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={[styles.filtersScroll, { flexDirection }]}
        >
          {STATUS_FILTERS.map((f) => (
            <Chip
              key={f}
              selected={statusFilter === f}
              onPress={() => setStatusFilter(f)}
              showSelectedOverlay
              compact
              style={[
                styles.filterChip,
                statusFilter === f
                  ? { backgroundColor: theme.colors.primaryContainer }
                  : { backgroundColor: theme.colors.surfaceVariant },
              ]}
              textStyle={[
                styles.filterChipText,
                statusFilter === f && { color: theme.colors.primary, fontWeight: '600' },
              ]}
            >
              {f === 'all' ? t('common.all') : t(`tasks.${f}`)}
            </Chip>
          ))}

          <Menu
            visible={priorityMenuVisible}
            onDismiss={() => setPriorityMenuVisible(false)}
            anchor={
              <Chip
                icon="filter-variant"
                onPress={() => setPriorityMenuVisible(true)}
                compact
                style={[
                  styles.filterChip,
                  priorityFilter !== 'all'
                    ? { backgroundColor: theme.colors.primaryContainer }
                    : { backgroundColor: theme.colors.surfaceVariant },
                ]}
                textStyle={[
                  styles.filterChipText,
                  priorityFilter !== 'all' && { color: theme.colors.primary, fontWeight: '600' },
                ]}
              >
                {priorityFilter === 'all'
                  ? t('tasks.priority')
                  : t(`tasks.${priorityFilter}`)}
              </Chip>
            }
          >
            <Menu.Item
              title={t('common.all')}
              onPress={() => { setPriorityFilter('all'); setPriorityMenuVisible(false); }}
              leadingIcon={priorityFilter === 'all' ? 'check' : undefined}
            />
            <Divider />
            {PRIORITIES.map((p) => (
              <Menu.Item
                key={p}
                title={t(`tasks.${p}`)}
                onPress={() => { setPriorityFilter(p); setPriorityMenuVisible(false); }}
                leadingIcon={priorityFilter === p ? 'check' : undefined}
              />
            ))}
          </Menu>
        </ScrollView>
      </View>

      {error ? (
        <Pressable
          onPress={fetchTasks}
          style={[styles.errorBanner, { backgroundColor: theme.colors.errorContainer }]}
        >
          <MaterialCommunityIcons name="alert-circle" size={18} color={theme.colors.error} />
          <Text variant="bodySmall" style={[styles.errorText, { color: theme.colors.error }]} numberOfLines={1}>
            {error}
          </Text>
          <Text variant="labelSmall" style={{ color: theme.colors.error, fontWeight: '600' }}>
            {t('common.retry')}
          </Text>
        </Pressable>
      ) : null}

      {/* Sort bar */}
      <View style={{ flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 6, backgroundColor: theme.colors.surface, borderBottomColor: theme.colors.outline, borderBottomWidth: StyleSheet.hairlineWidth, gap: 6, alignItems: 'center' }}>
        <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>{t('tasks.sortBy', 'מיין:')}</Text>
        {([
          { key: 'priority' as const, label: t('tasks.priority', 'עדיפות'), icon: 'flag' },
          { key: 'createdOn' as const, label: t('tasks.created', 'נוצר'), icon: 'calendar-plus' },
          { key: 'dueDate' as const, label: t('tasks.dueDate', 'תאריך יעד'), icon: 'calendar-clock' },
          { key: 'reminderDate' as const, label: t('tasks.reminder', 'תזכורת'), icon: 'bell-outline' },
        ]).map((opt) => (
          <Pressable
            key={opt.key}
            onPress={() => {
              if (taskSortKey === opt.key) setTaskSortDir((d) => d === 'asc' ? 'desc' : 'asc');
              else { setTaskSortKey(opt.key); setTaskSortDir(opt.key === 'priority' ? 'asc' : 'desc'); }
            }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12, backgroundColor: taskSortKey === opt.key ? '#e8f5e9' : 'transparent' }}
          >
            <MaterialCommunityIcons name={opt.icon as any} size={14} color={taskSortKey === opt.key ? BRAND_COLOR : theme.colors.onSurfaceVariant} />
            <Text style={{ fontSize: 11, color: taskSortKey === opt.key ? BRAND_COLOR : theme.colors.onSurfaceVariant, fontWeight: taskSortKey === opt.key ? '600' : '400' }}>
              {opt.label}
            </Text>
            {taskSortKey === opt.key && (
              <MaterialCommunityIcons name={taskSortDir === 'asc' ? 'arrow-up' : 'arrow-down'} size={12} color={BRAND_COLOR} />
            )}
          </Pressable>
        ))}
      </View>

      <FlatList
        data={visibleTasks}
        renderItem={renderTaskCard}
        keyExtractor={(item, index) => item.id || item.taskId || `task_${index}`}
        ListEmptyComponent={renderEmpty}
        ListFooterComponent={
          <ListPaginationFooter
            count={tasksCount}
            total={filteredTasks.length}
            hasMore={tasksHasMore}
            onLoadMore={tasksLoadMore}
            onLoadAll={tasksLoadAll}
          />
        }
        onEndReached={tasksHasMore ? tasksLoadMore : undefined}
        onEndReachedThreshold={0.4}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[BRAND_COLOR]}
            tintColor={BRAND_COLOR}
          />
        }
        contentContainerStyle={[
          styles.listContent,
          filteredTasks.length === 0 && styles.listContentEmpty,
        ]}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        showsVerticalScrollIndicator={false}
      />

      <FAB
        icon="plus"
        onPress={() => { resetForm(); setCreateModalVisible(true); }}
        style={[styles.fab, { backgroundColor: BRAND_COLOR, bottom: insets.bottom + 16, left: isRTL ? 16 : undefined, right: isRTL ? undefined : 16 }]}
        color="#FFFFFF"
        label={t('tasks.addTask')}
      />

      <Portal>
        <Modal
          visible={createModalVisible}
          onDismiss={() => { setCreateModalVisible(false); resetForm(); }}
          contentContainerStyle={[styles.modalContainer, { backgroundColor: theme.colors.surface }]}
        >
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={80}>
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <View style={[styles.modalHeader, { flexDirection }]}>
                <Text variant="titleLarge" style={{ color: theme.colors.onSurface, fontWeight: '700' }}>
                  {t('tasks.addTask')}
                </Text>
                <IconButton icon="close" size={22} onPress={() => { setCreateModalVisible(false); resetForm(); }} />
              </View>

              <ContactLookupField
                contactSearch={contactSearch}
                contactResults={contactResults}
                contactSearching={contactSearching}
                selectedContact={selectedContact}
                brandColor={BRAND_COLOR}
                onSearch={(text) => handleContactSearch(text, user?.organization || '')}
                onSelect={handleSelectContact}
                onClear={resetContactLookup}
              />

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
                {t('tasks.priority')}
              </Text>
              <View style={[styles.priorityRow, { flexDirection }]}>
                {PRIORITIES.map((p) => (
                  <Chip
                    key={p}
                    selected={formPriority === p}
                    onPress={() => setFormPriority(p)}
                    compact
                    style={[
                      styles.priorityChip,
                      formPriority === p
                        ? { backgroundColor: `${PRIORITY_COLORS[p]}20`, borderColor: PRIORITY_COLORS[p], borderWidth: 1 }
                        : { backgroundColor: theme.colors.surfaceVariant },
                    ]}
                    textStyle={[
                      styles.priorityChipText,
                      formPriority === p && { color: PRIORITY_COLORS[p], fontWeight: '600' },
                    ]}
                  >
                    {t(`tasks.${p}`)}
                  </Chip>
                ))}
              </View>

              <Text variant="labelLarge" style={[styles.formLabel, { color: theme.colors.onSurface }]}>
                {t('tasks.taskType')}
              </Text>
              <View style={[styles.priorityRow, { flexDirection }]}>
                {TASK_TYPES.map((tt) => (
                  <Chip
                    key={tt}
                    selected={formTaskType === tt}
                    onPress={() => setFormTaskType(tt)}
                    compact
                    style={[
                      styles.priorityChip,
                      formTaskType === tt
                        ? { backgroundColor: `${BRAND_COLOR}20`, borderColor: BRAND_COLOR, borderWidth: 1 }
                        : { backgroundColor: theme.colors.surfaceVariant },
                    ]}
                    textStyle={[
                      styles.priorityChipText,
                      formTaskType === tt && { color: BRAND_COLOR, fontWeight: '600' },
                    ]}
                  >
                    {t(`tasks.${tt}`)}
                  </Chip>
                ))}
              </View>

              <Pressable onPress={() => {
                setDueDateObj(formDueDate ? new Date(formDueDate) : new Date());
                setShowDueDatePicker(true);
              }}>
                <View pointerEvents="none">
                <TextInput
                  label={t('tasks.dueDate')}
                  value={formDueDate ? (() => { const d = new Date(formDueDate); return !isNaN(d.getTime()) ? d.toLocaleString(i18n.language === 'he' ? 'he-IL' : 'en-US', { dateStyle: 'short', timeStyle: 'short' }) : ''; })() : ''}
                  mode="outlined"
                  editable={false}
                  placeholder={t('tasks.selectDueDate', 'בחר תאריך ושעה')}
                  style={[styles.formInput, { textAlign }]}
                  outlineColor={theme.colors.outline}
                  activeOutlineColor={BRAND_COLOR}
                  right={<TextInput.Icon icon="calendar" onPress={() => {
                    setDueDateObj(formDueDate ? new Date(formDueDate) : new Date());
                    setShowDueDatePicker(true);
                  }} />}
                />
                </View>
              </Pressable>

              {showDueDatePicker && (
                <DateTimePicker
                  value={dueDateObj}
                  mode="date"
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  onChange={(_: DateTimePickerEvent, d?: Date) => {
                    setShowDueDatePicker(false);
                    if (d) {
                      const merged = new Date(dueDateObj);
                      merged.setFullYear(d.getFullYear(), d.getMonth(), d.getDate());
                      setDueDateObj(merged);
                      setShowDueTimePicker(true);
                    }
                  }}
                />
              )}
              {showDueTimePicker && (
                <DateTimePicker
                  value={dueDateObj}
                  mode="time"
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  onChange={(_: DateTimePickerEvent, d?: Date) => {
                    setShowDueTimePicker(false);
                    if (d) {
                      const merged = new Date(dueDateObj);
                      merged.setHours(d.getHours(), d.getMinutes());
                      setDueDateObj(merged);
                      setFormDueDate(merged.toISOString());
                      if (reminderEnabled && !formDueDate) {
                        setReminderDateObj(merged);
                      }
                    }
                  }}
                />
              )}

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
                  <Pressable onPress={() => {
                    setShowReminderDatePicker(true);
                  }}>
                    <View pointerEvents="none">
                    <TextInput
                      label={t('tasks.reminderDateTime', 'תאריך ושעת תזכורת')}
                      value={reminderDateObj.toLocaleString(i18n.language === 'he' ? 'he-IL' : 'en-US', { dateStyle: 'short', timeStyle: 'short' })}
                      mode="outlined"
                      editable={false}
                      style={[styles.formInput, { textAlign }]}
                      outlineColor={theme.colors.outline}
                      activeOutlineColor={BRAND_COLOR}
                      right={<TextInput.Icon icon="bell-ring-outline" onPress={() => setShowReminderDatePicker(true)} />}
                    />
                    </View>
                  </Pressable>

                  {showReminderDatePicker && (
                    <DateTimePicker
                      value={reminderDateObj}
                      mode="date"
                      display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                      onChange={(_: DateTimePickerEvent, d?: Date) => {
                        setShowReminderDatePicker(false);
                        if (d) {
                          const merged = new Date(reminderDateObj);
                          merged.setFullYear(d.getFullYear(), d.getMonth(), d.getDate());
                          setReminderDateObj(merged);
                          setShowReminderTimePicker(true);
                        }
                      }}
                    />
                  )}
                  {showReminderTimePicker && (
                    <DateTimePicker
                      value={reminderDateObj}
                      mode="time"
                      display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                      onChange={(_: DateTimePickerEvent, d?: Date) => {
                        setShowReminderTimePicker(false);
                        if (d) {
                          const merged = new Date(reminderDateObj);
                          merged.setHours(d.getHours(), d.getMinutes());
                          setReminderDateObj(merged);
                        }
                      }}
                    />
                  )}
                </>
              )}

              <TextInput
                label={t('tasks.assignedTo')}
                value={formAssignedTo}
                onChangeText={setFormAssignedTo}
                mode="outlined"
                style={[styles.formInput, { textAlign }]}
                outlineColor={theme.colors.outline}
                activeOutlineColor={BRAND_COLOR}
                right={<TextInput.Icon icon="account" />}
              />

              <TextInput
                label={t('tasks.relatedEntity')}
                value={formRelatedEntityName}
                onChangeText={setFormRelatedEntityName}
                mode="outlined"
                placeholder={t('tasks.relatedEntityPlaceholder')}
                style={[styles.formInput, { textAlign }]}
                outlineColor={theme.colors.outline}
                activeOutlineColor={BRAND_COLOR}
                right={<TextInput.Icon icon="link-variant" />}
              />

              <View style={[styles.modalActions, { flexDirection }]}>
                <Button
                  mode="outlined"
                  onPress={() => { setCreateModalVisible(false); resetForm(); }}
                  style={styles.modalButton}
                  textColor={theme.colors.onSurface}
                >
                  {t('common.cancel')}
                </Button>
                <Button
                  mode="contained"
                  onPress={handleCreate}
                  loading={creating}
                  disabled={!formTitle.trim() || creating}
                  style={[styles.modalButton, { backgroundColor: BRAND_COLOR }]}
                  textColor="#FFFFFF"
                >
                  {t('common.create')}
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
  searchbar: { height: 40, borderRadius: 20, elevation: 0 },
  filtersRow: {
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  filtersScroll: {
    paddingHorizontal: 14,
    gap: 8,
    alignItems: 'center',
  },
  filterChip: { height: 32 },
  filterChipText: { fontSize: 13 },
  listContent: { padding: 14, paddingBottom: 100 },
  listContentEmpty: { flexGrow: 1 },
  taskCard: {
    flexDirection: 'row',
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    overflow: 'hidden',
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
  },
  taskCardOverdue: {
    borderColor: '#F4433640',
    borderWidth: 1,
  },
  priorityBar: {
    width: 5,
    borderTopLeftRadius: borderRadius.lg,
    borderBottomLeftRadius: borderRadius.lg,
  },
  completeBtn: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 10,
  },
  taskContent: {
    flex: 1,
    paddingVertical: 14,
    paddingEnd: 14,
    gap: 6,
  },
  taskTopRow: {
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  taskTitle: {
    flex: 1,
    fontWeight: '600',
    fontSize: 15,
  },
  taskTitleCompleted: {
    textDecorationLine: 'line-through',
    opacity: 0.5,
  },
  statusChip: {
    minHeight: 28,
    borderRadius: 14,
  },
  statusChipText: {
    fontSize: 11,
    fontWeight: '600',
    lineHeight: 16,
  },
  taskDescription: {
    fontSize: 13,
    lineHeight: 18,
  },
  taskMeta: {
    alignItems: 'center',
    gap: 14,
    marginTop: 4,
  },
  metaItem: {
    alignItems: 'center',
    gap: 4,
  },
  metaText: {
    fontSize: 12,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    paddingHorizontal: 40,
    gap: 12,
  },
  emptyTitle: { fontWeight: '600', marginTop: 8 },
  fab: {
    position: 'absolute',
    borderRadius: 16,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
  },
  errorText: { flex: 1, fontSize: 13 },
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
  formLabel: {
    fontWeight: '600',
    marginBottom: 8,
  },
  priorityRow: {
    gap: 8,
    marginBottom: 14,
    flexWrap: 'wrap',
  },
  priorityChip: {
    height: 32,
  },
  priorityChipText: {
    fontSize: 12,
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
});
