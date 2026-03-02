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
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../../../stores/authStore';
import { useAppTheme } from '../../../../hooks/useAppTheme';
import { useRTL } from '../../../../hooks/useRTL';
import { tasksApi } from '../../../../services/api/tasks';
import { formatDate, formatRelativeTime, getInitials } from '../../../../utils/formatters';
import { spacing, borderRadius, fontSize } from '../../../../constants/theme';
import type { Task } from '../../../../types';

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

export default function TasksMoreScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useAppTheme();
  const { isRTL, flexDirection, textAlign } = useRTL();
  const { t, i18n } = useTranslation();

  const user = useAuthStore((s) => s.user);

  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchVisible, setSearchVisible] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
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

  const fetchTasks = useCallback(async () => {
    if (!user?.organization) return;
    try {
      setError(null);
      const data = await tasksApi.getAll(
        user.organization,
        user.uID || user.userId,
        'seeAll',
      );
      setTasks(data);
    } catch (err: any) {
      setError(err.message || t('errors.generic'));
    } finally {
      setLoading(false);
    }
  }, [user?.organization, t]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

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

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (t) =>
          t.title?.toLowerCase().includes(q) ||
          t.description?.toLowerCase().includes(q) ||
          t.assignedToName?.toLowerCase().includes(q),
      );
    }

    return result.sort((a, b) => {
      if (a.status === 'completed' && b.status !== 'completed') return 1;
      if (a.status !== 'completed' && b.status === 'completed') return -1;
      const aOverdue = isOverdue(a);
      const bOverdue = isOverdue(b);
      if (aOverdue && !bOverdue) return -1;
      if (!aOverdue && bOverdue) return 1;
      const priorityOrder: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
      return (priorityOrder[a.priority] ?? 2) - (priorityOrder[b.priority] ?? 2);
    });
  }, [tasks, statusFilter, priorityFilter, searchQuery]);

  const resetForm = useCallback(() => {
    setFormTitle('');
    setFormDescription('');
    setFormPriority('medium');
    setFormDueDate('');
    setFormAssignedTo('');
    setFormTaskType('general');
    setFormRelatedEntityName('');
  }, []);

  const handleCreate = useCallback(async () => {
    if (!user?.organization || !formTitle.trim()) return;
    setCreating(true);
    try {
      await tasksApi.create(user.organization, {
        title: formTitle.trim(),
        description: formDescription.trim() || undefined,
        priority: formPriority as Task['priority'],
        taskType: formTaskType as Task['taskType'],
        dueDate: formDueDate.trim() || undefined,
        assignedTo: formAssignedTo.trim() || undefined,
        relatedEntityName: formRelatedEntityName.trim() || undefined,
        status: 'open',
      } as any);
      setCreateModalVisible(false);
      resetForm();
      await fetchTasks();
    } catch (err: any) {
      setError(err.message || t('errors.generic'));
    } finally {
      setCreating(false);
    }
  }, [user?.organization, formTitle, formDescription, formPriority, formTaskType, formDueDate, formAssignedTo, formRelatedEntityName, resetForm, fetchTasks, t]);

  const openTask = useCallback(
    (task: Task) => {
      router.push({ pathname: '/(tabs)/more/tasks/[id]', params: { id: task.id } });
    },
    [router],
  );

  const renderTaskCard = useCallback(
    ({ item }: { item: Task }) => {
      const overdue = isOverdue(item);
      const completed = item.status === 'completed';
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
                {t(`tasks.${item.status}`)}
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
            </View>
          </View>
        </Pressable>
      );
    },
    [theme, openTask, flexDirection, textAlign, t],
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

      <FlatList
        data={filteredTasks}
        renderItem={renderTaskCard}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={renderEmpty}
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
        onPress={() => setCreateModalVisible(true)}
        style={[styles.fab, { backgroundColor: BRAND_COLOR, bottom: insets.bottom + 16 }]}
        color="#FFFFFF"
        label={t('tasks.addTask')}
      />

      <Portal>
        <Modal
          visible={createModalVisible}
          onDismiss={() => { setCreateModalVisible(false); resetForm(); }}
          contentContainerStyle={[styles.modalContainer, { backgroundColor: theme.colors.surface }]}
        >
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={[styles.modalHeader, { flexDirection }]}>
                <Text variant="titleLarge" style={{ color: theme.colors.onSurface, fontWeight: '700' }}>
                  {t('tasks.addTask')}
                </Text>
                <IconButton icon="close" size={22} onPress={() => { setCreateModalVisible(false); resetForm(); }} />
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

              <TextInput
                label={t('tasks.relatedEntity')}
                value={formRelatedEntityName}
                onChangeText={setFormRelatedEntityName}
                mode="outlined"
                placeholder={t('tasks.relatedEntityPlaceholder')}
                style={[styles.formInput, { textAlign }]}
                outlineColor={theme.colors.outline}
                activeOutlineColor={BRAND_COLOR}
                left={<TextInput.Icon icon="link-variant" />}
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
  taskContent: {
    flex: 1,
    padding: 14,
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
    height: 24,
    borderRadius: 12,
  },
  statusChipText: {
    fontSize: 11,
    fontWeight: '600',
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
    end: 16,
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
});
