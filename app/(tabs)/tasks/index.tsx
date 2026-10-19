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
  Alert,
  TouchableOpacity,
  TextInput as RNTextInput,
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
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuthStore } from '../../../stores/authStore';
import { useAppTheme } from '../../../hooks/useAppTheme';
import { useRTL } from '../../../hooks/useRTL';
import { useWindowedList } from '../../../hooks/useWindowedList';
import { ListPaginationFooter } from '../../../components/ListPaginationFooter';
import { tasksApi } from '../../../services/api/tasks';
import { usersApi } from '../../../services/api/users';
import { leadsApi } from '../../../services/api/leads';
import { cacheEntities } from '../../../services/entityCache';
import { readList as readDiskList, cacheList as cacheDiskList } from '../../../services/db/genericCache';
import { getDataVisibility } from '../../../constants/permissions';
import { formatDate, formatDueDate, formatRelativeTime, getInitials } from '../../../utils/formatters';
import { spacing, borderRadius, fontSize } from '../../../constants/theme';
import type { Task, OrgUser } from '../../../types';
import { useContactLookup } from '../../../hooks/useContactLookup';
import ContactLookupField from '../../../components/ContactLookupField';
import GambotDateTimePicker from '../../../components/GambotDateTimePicker';

const BRAND_COLOR = '#2e6155';
// Status filter: open work (default), finished, or everything. Today / Overdue / Upcoming are
// shown as grouped sections inside the list, so they don't need their own chips.
const TASK_VIEWS = ['active', 'completed', 'all'] as const;
type TaskView = (typeof TASK_VIEWS)[number];
// "Mine" (assigned to or created by me — same rule as the web "My Tasks" view) vs. the whole team.
type TaskScope = 'mine' | 'all';

type TaskGroup = 'overdue' | 'today' | 'upcoming' | 'noDate' | 'done';
const GROUP_ORDER: TaskGroup[] = ['overdue', 'today', 'upcoming', 'noDate', 'done'];
const GROUP_COLORS: Record<TaskGroup, string> = {
  overdue: '#d32f2f',
  today: '#2e6155',
  upcoming: '#1976d2',
  noDate: '#757575',
  done: '#4CAF50',
};

type ListRow =
  | { kind: 'header'; key: string; group: TaskGroup; count: number }
  | { kind: 'task'; key: string; task: Task };

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

function isActiveTask(task: Task): boolean {
  return task.status !== 'completed' && task.status !== 'cancelled';
}

function isDueToday(task: Task): boolean {
  if (!task.dueDate) return false;
  const d = new Date(task.dueDate);
  if (isNaN(d.getTime())) return false;
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

function getTaskGroup(task: Task): TaskGroup {
  if (!isActiveTask(task)) return 'done';
  if (!task.dueDate) return 'noDate';
  if (isOverdue(task)) return 'overdue';
  if (isDueToday(task)) return 'today';
  return 'upcoming';
}

// Quick-add default due date: end of today, so a task typed in the morning is "Today" all day
// and only turns "Overdue" once the day is over.
function endOfToday(): Date {
  const d = new Date();
  d.setHours(23, 59, 0, 0);
  return d;
}

const parseTs = (v: any): number => {
  if (!v) return 0;
  if (typeof v === 'number') return v;
  if (v._seconds) return v._seconds * 1000;
  if (v.seconds) return v.seconds * 1000;
  const d = new Date(v);
  return isNaN(d.getTime()) ? 0 : d.getTime();
};

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
  const [viewFilter, setViewFilter] = useState<TaskView>('active');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  // "Mine" by default (like the web My Tasks view); the choice is remembered between visits.
  const [scope, setScope] = useState<TaskScope>('mine');
  const [quickTitle, setQuickTitle] = useState('');
  const [quickAdding, setQuickAdding] = useState(false);
  const [priorityMenuVisible, setPriorityMenuVisible] = useState(false);
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [creating, setCreating] = useState(false);

  const [formTitle, setFormTitle] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formPriority, setFormPriority] = useState<string>('medium');
  const [formDueDate, setFormDueDate] = useState('');
  const [formAssignedTo, setFormAssignedTo] = useState('');
  const [formAssignedToId, setFormAssignedToId] = useState('');
  const [orgUsers, setOrgUsers] = useState<OrgUser[]>([]);
  const [orgUsersLoading, setOrgUsersLoading] = useState(false);
  const [userPickerExpanded, setUserPickerExpanded] = useState(false);
  const [formTaskType, setFormTaskType] = useState<string>('general');
  const [formDetailsExpanded, setFormDetailsExpanded] = useState(false); // description / type / linked record

  // Linked entity: pick a type (contact / lead), then pick the specific record.
  const [formRelatedEntityType, setFormRelatedEntityType] = useState<'' | 'contact' | 'lead'>('');
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

  const tasksDV = getDataVisibility(user?.DataVisibility, user?.SecurityRole, 'tasks');

  const openDuePicker = useCallback(() => {
    const base = formDueDate ? new Date(formDueDate) : new Date();
    setDueDateObj(!isNaN(base.getTime()) ? base : new Date());
    setShowDueDatePicker(true);
  }, [formDueDate]);

  const openReminderPicker = useCallback(() => setShowReminderDatePicker(true), []);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Restore the saved Mine/All choice once on mount.
  useEffect(() => {
    AsyncStorage.getItem('tasks_scope')
      .then((saved) => { if (saved === 'mine' || saved === 'all') setScope(saved); })
      .catch(() => {});
  }, []);

  const changeScope = useCallback((next: TaskScope) => {
    setScope(next);
    AsyncStorage.setItem('tasks_scope', next).catch(() => {});
  }, []);

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

  const myId = user?.uID || user?.userId || '';
  // Users limited to their own data (DataVisibility = own) only ever receive their tasks, so the
  // Mine/All switch would be a dead control for them.
  const showScope = tasksDV !== 'own';
  const effectiveScope: TaskScope = showScope ? scope : 'mine';

  // Tasks in the chosen scope (Mine = assigned to me or created by me, same as the web).
  const scopedTasks = useMemo(() => {
    const list = Array.isArray(tasks) ? tasks : [];
    if (effectiveScope === 'all' || !myId) return list;
    return list.filter((tk) => tk.assignedToId === myId || tk.createdById === myId);
  }, [tasks, effectiveScope, myId]);

  const filteredTasks = useMemo(() => {
    let result = scopedTasks;

    switch (viewFilter) {
      case 'active':
        result = result.filter(isActiveTask);
        break;
      case 'completed':
        result = result.filter((t) => t.status === 'completed');
        break;
      case 'all':
      default:
        break;
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
          getRelatedName(t).toLowerCase().includes(q),
      );
    }

    // Grouped agenda order: Overdue → Today → Upcoming → No date → Done. Inside a group the
    // soonest due date comes first (no-date: newest first; done: most recently finished first),
    // with priority as the tie-breaker.
    const priorityOrder: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
    return [...result].sort((a, b) => {
      const ga = GROUP_ORDER.indexOf(getTaskGroup(a));
      const gb = GROUP_ORDER.indexOf(getTaskGroup(b));
      if (ga !== gb) return ga - gb;
      const group = GROUP_ORDER[ga];
      if (group === 'noDate') {
        const d = parseTs(b.createdOn || (b as any).CreatedOn) - parseTs(a.createdOn || (a as any).CreatedOn);
        if (d !== 0) return d;
      } else if (group === 'done') {
        const d = parseTs(b.completedDate || b.modifiedOn) - parseTs(a.completedDate || a.modifiedOn);
        if (d !== 0) return d;
      } else {
        const d = parseTs(a.dueDate) - parseTs(b.dueDate);
        if (d !== 0) return d;
      }
      return (priorityOrder[a.priority] ?? 2) - (priorityOrder[b.priority] ?? 2);
    });
  }, [scopedTasks, viewFilter, priorityFilter, debouncedSearch]);

  // Counts per status chip, over the scoped set (independent of status/priority/search) so the
  // numbers stay stable while filtering.
  const viewCounts = useMemo(() => ({
    active: scopedTasks.filter(isActiveTask).length,
    completed: scopedTasks.filter((t) => t.status === 'completed').length,
    all: scopedTasks.length,
  }) as Record<TaskView, number>, [scopedTasks]);

  // Client-side pagination over the filtered list (search still spans everything).
  const { visible: visibleTasks, hasMore: tasksHasMore, loadMore: tasksLoadMore, loadAll: tasksLoadAll, count: tasksCount } = useWindowedList(filteredTasks, {
    pageSize: 30,
    resetKey: `${viewFilter}|${priorityFilter}|${debouncedSearch}|${effectiveScope}`,
  });

  // Flat rows with a section header in front of each group (counts cover the whole filtered
  // list, not just the loaded page).
  const listRows = useMemo<ListRow[]>(() => {
    const totals: Record<TaskGroup, number> = { overdue: 0, today: 0, upcoming: 0, noDate: 0, done: 0 };
    filteredTasks.forEach((tk) => { totals[getTaskGroup(tk)] += 1; });
    const rows: ListRow[] = [];
    let current: TaskGroup | null = null;
    visibleTasks.forEach((tk, i) => {
      const g = getTaskGroup(tk);
      if (g !== current) {
        current = g;
        rows.push({ kind: 'header', key: `h_${g}`, group: g, count: totals[g] });
      }
      rows.push({ kind: 'task', key: tk.id || tk.taskId || `task_${i}`, task: tk });
    });
    return rows;
  }, [visibleTasks, filteredTasks]);

  const resetForm = useCallback(() => {
    // Default due date + reminder to "now" so the user only nudges it to the nearest convenient
    // time. Kept consistent with the shared AddTaskSheet used by contacts/leads/cases/orders.
    const now = new Date();
    setFormTitle('');
    setFormDescription('');
    setFormPriority('medium');
    setFormDueDate(now.toISOString());
    // Default the responsible user to the currently logged-in user (like the web + AddTaskSheet).
    setFormAssignedTo(user?.fullname || (user as any)?.name || '');
    setFormAssignedToId(user?.uID || user?.userId || '');
    setUserPickerExpanded(false);
    setFormTaskType('general');
    setFormDetailsExpanded(false);
    setFormRelatedEntityType('');
    setFormRelatedLeadName('');
    setFormRelatedLeadId('');
    setLeadPickerVisible(false);
    setLeadSearch('');
    setLeadResults([]);
    setDueDateObj(new Date(now));
    setReminderEnabled(true);
    setReminderDateObj(new Date(now));
    resetContactLookup();
  }, [resetContactLookup, user?.fullname, user?.uID, user?.userId]);

  const handleCreate = useCallback(async () => {
    if (!user?.organization || !formTitle.trim()) return;
    setCreating(true);
    try {
      const meId = user?.uID || user?.userId || '';
      const meName = user?.fullname || (user as any)?.name || '';
      // Assignee: use the picked user; fall back to the logged-in user.
      const assigneeId = formAssignedToId || meId;
      const assigneeName = formAssignedTo.trim() || meName;
      const contactName = selectedContact
        ? (selectedContact.fullName || selectedContact.name || '')
        : '';
      const contactPhone = selectedContact?.phoneNumber || selectedContact?.phone || undefined;
      // Linked entity: contact or lead, based on the chosen type.
      const relatedContact = formRelatedEntityType === 'contact' && selectedContact;
      const relatedLead = formRelatedEntityType === 'lead' && formRelatedLeadId;
      await tasksApi.create(user.organization, {
        title: formTitle.trim(),
        description: formDescription.trim() || undefined,
        priority: formPriority as Task['priority'],
        taskType: formTaskType as Task['taskType'],
        dueDate: formDueDate.trim() || undefined,
        assignedToId: assigneeId,
        assignedToName: assigneeName,
        assignedTo: assigneeName || undefined,
        ...(relatedContact
          ? {
              relatedEntityName: contactName || undefined,
              relatedEntityPhone: contactPhone,
              relatedContactId: selectedContact?.id || undefined,
              relatedTo: { type: 'contact', entityId: selectedContact.id || contactPhone || '', entityName: contactName },
            }
          : {}),
        ...(relatedLead
          ? {
              relatedEntityName: formRelatedLeadName || undefined,
              relatedLeadId: formRelatedLeadId,
              relatedTo: { type: 'lead', entityId: formRelatedLeadId, entityName: formRelatedLeadName },
            }
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
  }, [user?.organization, user?.uID, user?.userId, user?.fullname, formTitle, formDescription, formPriority, formTaskType, formDueDate, formAssignedTo, formAssignedToId, formRelatedEntityType, formRelatedLeadId, formRelatedLeadName, resetForm, fetchTasks, t, reminderEnabled, reminderDateObj, selectedContact]);

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

  // Load org users once the create modal opens so the assignee picker is populated.
  useEffect(() => {
    if (!createModalVisible || !user?.organization || orgUsers.length > 0) return;
    setOrgUsersLoading(true);
    usersApi.getAll(user.organization).then((u) => setOrgUsers(u)).catch(() => {}).finally(() => setOrgUsersLoading(false));
  }, [createModalVisible, user?.organization, orgUsers.length]);

  const openTask = useCallback(
    (task: Task) => {
      router.push({ pathname: '/(tabs)/tasks/[id]', params: { id: task.id } });
    },
    [router],
  );

  // One tap on the circle completes a task; tapping a finished task's check re-opens it.
  const handleCompleteTask = useCallback(async (task: Task) => {
    const taskId = (task as any).taskId || task.id;
    const reopen = task.status === 'completed';
    setTasks((prev) => prev.map((t) => t.id === task.id ? { ...t, status: reopen ? 'open' as const : 'completed' as const } : t));
    try {
      if (reopen) {
        await tasksApi.update(
          user?.organization || '',
          { id: task.id, taskId, status: 'open' } as any,
          user?.uID || user?.userId || '',
          user?.fullname || '',
        );
      } else {
        await tasksApi.complete(
          user?.organization || '',
          taskId,
          user?.uID || user?.userId || '',
          user?.fullname || '',
        );
      }
    } catch {
      setTasks((prev) => prev.map((t) => t.id === task.id ? { ...t, status: task.status } : t));
    }
  }, [user]);

  // Quick add: type a title + Enter. Defaults: due today (end of day), assigned to me, medium.
  const handleQuickAdd = useCallback(async () => {
    const title = quickTitle.trim();
    if (!title || !user?.organization || quickAdding) return;
    const meId = user?.uID || user?.userId || '';
    const meName = user?.fullname || (user as any)?.name || '';
    setQuickAdding(true);
    setQuickTitle('');
    try {
      await tasksApi.create(user.organization, {
        title,
        status: 'open',
        priority: 'medium',
        taskType: 'general',
        dueDate: endOfToday().toISOString(),
        assignedToId: meId,
        assignedToName: meName,
        assignedTo: meName || undefined,
      } as any, meId, meName);
      // Make sure the new task is visible even if the user was looking at "Done" or searching.
      setViewFilter('active');
      setSearchQuery('');
      await fetchTasks();
    } catch (err: any) {
      setQuickTitle(title);
      setError(err.message || t('errors.generic'));
    } finally {
      setQuickAdding(false);
    }
  }, [quickTitle, quickAdding, user, fetchTasks, t]);

  // ── Bulk selection + common bulk actions ─────────────────────────
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkProcessing, setBulkProcessing] = useState(false);
  const [bulkPriorityMenu, setBulkPriorityMenu] = useState(false);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const enterSelection = useCallback((id?: string) => {
    setSelectionMode(true);
    if (id) setSelectedIds((prev) => { const n = new Set(prev); n.add(id); return n; });
  }, []);

  const exitSelection = useCallback(() => { setSelectionMode(false); setSelectedIds(new Set()); }, []);

  // "Select all displayed" toggles between selecting every task in the current view and clearing.
  const allDisplayedSelected = filteredTasks.length > 0 && filteredTasks.every((tk) => selectedIds.has(tk.id));
  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) => {
      if (filteredTasks.length > 0 && filteredTasks.every((tk) => prev.has(tk.id))) return new Set();
      return new Set(filteredTasks.map((tk) => tk.id));
    });
  }, [filteredTasks]);

  const selectedTasks = useMemo(() => tasks.filter((tk) => selectedIds.has(tk.id)), [tasks, selectedIds]);

  // Run an operation over every selected task in parallel, then refresh + exit selection mode.
  const runBulk = useCallback(async (fn: (task: Task) => Promise<any>) => {
    if (selectedTasks.length === 0) return;
    setBulkProcessing(true);
    try {
      await Promise.all(selectedTasks.map((tk) => fn(tk).catch(() => {})));
      await fetchTasks();
      exitSelection();
    } finally {
      setBulkProcessing(false);
    }
  }, [selectedTasks, fetchTasks, exitSelection]);

  const bulkComplete = useCallback(() => {
    const org = user?.organization || '';
    const uid = user?.uID || user?.userId || '';
    const uname = user?.fullname || '';
    runBulk((tk) => (tk.status === 'completed'
      ? Promise.resolve()
      : tasksApi.complete(org, (tk as any).taskId || tk.id, uid, uname)));
  }, [runBulk, user]);

  const bulkSetPriority = useCallback((priority: string) => {
    setBulkPriorityMenu(false);
    const org = user?.organization || '';
    const uid = user?.uID || user?.userId || '';
    const uname = user?.fullname || '';
    runBulk((tk) => tasksApi.update(org, { taskId: (tk as any).taskId || tk.id, priority } as any, uid, uname));
  }, [runBulk, user]);

  const bulkDelete = useCallback(() => {
    const org = user?.organization || '';
    Alert.alert(
      t('tasks.deleteTask', 'מחיקת משימות'),
      isRTL ? `למחוק ${selectedTasks.length} משימות?` : `Delete ${selectedTasks.length} tasks?`,
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('common.delete'), style: 'destructive', onPress: () => runBulk((tk) => tasksApi.delete(org, (tk as any).taskId || tk.id)) },
      ],
    );
  }, [runBulk, user, selectedTasks.length, t, isRTL]);

  const renderTaskCard = useCallback(
    ({ item }: { item: Task }) => {
      const overdue = isOverdue(item);
      const completed = item.status === 'completed';
      const cancelled = item.status === 'cancelled';
      const priorityColor = PRIORITY_COLORS[item.priority] || PRIORITY_COLORS.medium;
      const statusColor = STATUS_COLORS[item.status] || STATUS_COLORS.pending;
      const isChecked = selectedIds.has(item.id);

      return (
        <Pressable
          onPress={() => (selectionMode ? toggleSelect(item.id) : openTask(item))}
          onLongPress={() => enterSelection(item.id)}
          android_ripple={{ color: theme.colors.surfaceVariant }}
          style={({ pressed }) => [
            styles.taskCard,
            {
              backgroundColor: pressed ? theme.colors.surfaceVariant : theme.custom.cardBackground,
              borderColor: selectionMode && isChecked ? BRAND_COLOR : (overdue ? '#F4433640' : theme.colors.outlineVariant),
            },
            overdue && styles.taskCardOverdue,
            selectionMode && isChecked && { borderWidth: 1.5 },
          ]}
        >
          <View style={[styles.priorityBar, { backgroundColor: priorityColor }]} />

          {selectionMode ? (
            <Pressable onPress={() => toggleSelect(item.id)} hitSlop={8} style={styles.completeBtn}>
              <MaterialCommunityIcons
                name={isChecked ? 'checkbox-marked-circle' : 'checkbox-blank-circle-outline'}
                size={26}
                color={isChecked ? BRAND_COLOR : theme.colors.onSurfaceVariant}
              />
            </Pressable>
          ) : !cancelled ? (
            <Pressable
              onPress={() => handleCompleteTask(item)}
              hitSlop={8}
              style={styles.completeBtn}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: completed }}
            >
              <MaterialCommunityIcons
                name={completed ? 'check-circle' : 'checkbox-blank-circle-outline'}
                size={26}
                color={completed ? STATUS_COLORS.completed : theme.colors.onSurfaceVariant}
              />
            </Pressable>
          ) : (
            <View style={styles.completeBtn}>
              <MaterialCommunityIcons
                name="close-circle-outline"
                size={26}
                color={STATUS_COLORS.cancelled}
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
              {/* Plain "open" / "completed" are already obvious from the section + the check circle;
                  only the unusual states get a chip. */}
              {item.status && item.status !== 'open' && item.status !== 'completed' ? (
                <Chip
                  compact
                  textStyle={[styles.statusChipText, { color: statusColor }]}
                  style={[styles.statusChip, { backgroundColor: `${statusColor}18` }]}
                >
                  {t(`tasks.${item.status}`)}
                </Chip>
              ) : null}
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
              <View style={[styles.metaItem, { flexDirection }]}>
                <MaterialCommunityIcons
                  name="calendar-clock"
                  size={14}
                  color={item.dueDate ? (overdue ? '#F44336' : theme.colors.onSurfaceVariant) : theme.colors.onSurfaceVariant}
                />
                <Text
                  variant="labelSmall"
                  style={[
                    styles.metaText,
                    { color: item.dueDate ? (overdue ? '#F44336' : theme.colors.onSurfaceVariant) : theme.colors.onSurfaceVariant },
                    overdue && { fontWeight: '700' },
                    !item.dueDate && { opacity: 0.6 },
                  ]}
                >
                  {item.dueDate
                    ? `${formatDueDate(item.dueDate, t('tasks.tomorrow', 'מחר'))}${overdue ? ` • ${t('tasks.overdue')}` : ''}`
                    : t('tasks.noDueDate', 'ללא תאריך יעד')}
                </Text>
              </View>

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
    [theme, openTask, handleCompleteTask, flexDirection, textAlign, t, selectionMode, selectedIds, toggleSelect, enterSelection],
  );

  const renderEmpty = useCallback(() => {
    if (loading) return null;
    const searching = debouncedSearch.trim() !== '';
    // Open-tasks view with nothing left (but tasks exist) = the good kind of empty.
    const allDone = !searching && viewFilter === 'active' && priorityFilter === 'all' && scopedTasks.length > 0;
    return (
      <View style={styles.emptyContainer}>
        <MaterialCommunityIcons
          name={searching ? 'magnify' : allDone ? 'check-all' : 'checkbox-marked-circle-outline'}
          size={72}
          color={allDone ? STATUS_COLORS.completed : theme.colors.onSurfaceVariant}
          style={{ opacity: allDone ? 0.7 : 0.3 }}
        />
        <Text
          variant="titleMedium"
          style={[styles.emptyTitle, { color: theme.colors.onSurface }]}
        >
          {searching ? t('common.noResults') : allDone ? t('tasks.allDone') : t('tasks.noTasks')}
        </Text>
        {!searching && !allDone ? (
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center' }}>
            {t('tasks.emptyHint')}
          </Text>
        ) : null}
      </View>
    );
  }, [loading, theme, t, debouncedSearch, viewFilter, priorityFilter, scopedTasks.length]);

  const renderRow = useCallback(
    ({ item }: { item: ListRow }) => {
      if (item.kind === 'header') {
        const color = GROUP_COLORS[item.group];
        return (
          <View style={[styles.sectionHeader, { flexDirection }]}>
            <View style={[styles.sectionDot, { backgroundColor: color }]} />
            <Text style={[styles.sectionTitle, { color }]}>{t(`tasks.group_${item.group}`)}</Text>
            <Text style={[styles.sectionCount, { color: theme.colors.onSurfaceVariant }]}>{item.count}</Text>
          </View>
        );
      }
      return renderTaskCard({ item: item.task });
    },
    [renderTaskCard, flexDirection, t, theme],
  );

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
        <Appbar.Content title={t('tasks.title')} titleStyle={{ color: '#FFF', fontWeight: '700', fontSize: 18 }} />
        <Appbar.Action
          icon={selectionMode ? 'close' : 'checkbox-multiple-marked-outline'}
          color="#FFF"
          onPress={() => { if (selectionMode) exitSelection(); else setSelectionMode(true); }}
        />
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

      {/* Quick add: type a title and press Enter — due today, assigned to me. */}
      {!selectionMode && (
        <View
          style={[
            styles.quickAddRow,
            { backgroundColor: theme.colors.surface, borderBottomColor: theme.colors.outlineVariant, flexDirection },
          ]}
        >
          <MaterialCommunityIcons name="plus-circle-outline" size={22} color={BRAND_COLOR} />
          <RNTextInput
            value={quickTitle}
            onChangeText={setQuickTitle}
            onSubmitEditing={handleQuickAdd}
            placeholder={t('tasks.quickAddPlaceholder')}
            placeholderTextColor={theme.colors.onSurfaceVariant}
            returnKeyType="done"
            blurOnSubmit={false}
            editable={!quickAdding}
            style={[styles.quickAddInput, { color: theme.colors.onSurface, textAlign }]}
          />
          {quickAdding ? (
            <ActivityIndicator size={18} color={BRAND_COLOR} />
          ) : quickTitle.trim() ? (
            <Pressable onPress={handleQuickAdd} hitSlop={8}>
              <MaterialCommunityIcons name="arrow-up-circle" size={26} color={BRAND_COLOR} />
            </Pressable>
          ) : null}
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
          {showScope && (
            <>
              {(['mine', 'all'] as TaskScope[]).map((s) => {
                const selected = effectiveScope === s;
                return (
                  <Chip
                    key={s}
                    selected={selected}
                    onPress={() => changeScope(s)}
                    showSelectedOverlay
                    compact
                    icon={s === 'mine' ? 'account' : 'account-group'}
                    style={[
                      styles.filterChip,
                      { backgroundColor: selected ? theme.colors.primaryContainer : theme.colors.surfaceVariant },
                    ]}
                    textStyle={[styles.filterChipText, selected && { color: theme.colors.primary, fontWeight: '600' }]}
                  >
                    {t(s === 'mine' ? 'tasks.scopeMine' : 'tasks.scopeAll')}
                  </Chip>
                );
              })}
              <View style={[styles.chipDivider, { backgroundColor: theme.colors.outlineVariant }]} />
            </>
          )}

          {TASK_VIEWS.map((v) => {
            const selected = viewFilter === v;
            const label = v === 'all' ? t('common.all') : v === 'active' ? t('tasks.active', 'פעיל') : t('tasks.completed');
            return (
              <Chip
                key={v}
                selected={selected}
                onPress={() => setViewFilter(v)}
                showSelectedOverlay
                compact
                style={[
                  styles.filterChip,
                  { backgroundColor: selected ? theme.colors.primaryContainer : theme.colors.surfaceVariant },
                ]}
                textStyle={[styles.filterChipText, selected && { color: theme.colors.primary, fontWeight: '600' }]}
              >
                {`${label} (${viewCounts[v]})`}
              </Chip>
            );
          })}

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
        data={listRows}
        renderItem={renderRow}
        keyExtractor={(item) => item.key}
        keyboardShouldPersistTaps="handled"
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
          selectionMode && { paddingBottom: 150 },
        ]}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        showsVerticalScrollIndicator={false}
      />

      {!selectionMode && (
        <FAB
          icon="plus"
          onPress={() => { resetForm(); setCreateModalVisible(true); }}
          style={[styles.fab, { backgroundColor: BRAND_COLOR, bottom: 16, left: isRTL ? 16 : undefined, right: isRTL ? undefined : 16 }]}
          color="#FFFFFF"
          size="small"
          accessibilityLabel={t('tasks.addTask')}
        />
      )}

      {/* Bulk action bar — select all displayed + common actions on the selection */}
      {selectionMode && (
        <View style={[styles.bulkBar, { backgroundColor: theme.colors.surface, borderTopColor: theme.colors.outlineVariant, paddingBottom: insets.bottom + 10 }]}>
          <View style={[styles.bulkTopRow, { flexDirection }]}>
            <Text style={{ color: theme.colors.onSurface, fontWeight: '700', flex: 1, textAlign }}>
              {selectedIds.size} {isRTL ? 'נבחרו' : 'selected'}
            </Text>
            <Button mode="text" compact onPress={toggleSelectAll} textColor={BRAND_COLOR}>
              {allDisplayedSelected ? (isRTL ? 'נקה הכל' : 'Clear all') : (isRTL ? 'בחר הכל' : 'Select all')}
            </Button>
            <Button mode="text" compact onPress={exitSelection} textColor={theme.colors.onSurfaceVariant}>
              {t('common.cancel')}
            </Button>
          </View>
          <View style={[styles.bulkActionsRow, { flexDirection }]}>
            <Button
              mode="contained"
              icon="check-circle"
              compact
              disabled={selectedIds.size === 0 || bulkProcessing}
              loading={bulkProcessing}
              onPress={bulkComplete}
              buttonColor={STATUS_COLORS.completed}
              textColor="#fff"
              style={styles.bulkBtn}
            >
              {isRTL ? 'סמן כהושלם' : 'Complete'}
            </Button>
            <Menu
              visible={bulkPriorityMenu}
              onDismiss={() => setBulkPriorityMenu(false)}
              anchor={
                <Button
                  mode="outlined"
                  icon="flag"
                  compact
                  disabled={selectedIds.size === 0 || bulkProcessing}
                  onPress={() => setBulkPriorityMenu(true)}
                  textColor={BRAND_COLOR}
                  style={[styles.bulkBtn, { borderColor: BRAND_COLOR }]}
                >
                  {isRTL ? 'עדיפות' : 'Priority'}
                </Button>
              }
            >
              {PRIORITIES.map((p) => (
                <Menu.Item key={p} title={t(`tasks.${p}`)} onPress={() => bulkSetPriority(p)} leadingIcon="flag" />
              ))}
            </Menu>
            <Button
              mode="outlined"
              icon="delete-outline"
              compact
              disabled={selectedIds.size === 0 || bulkProcessing}
              onPress={bulkDelete}
              textColor={theme.colors.error}
              style={[styles.bulkBtn, { borderColor: theme.colors.error }]}
            >
              {t('common.delete')}
            </Button>
          </View>
        </View>
      )}

      <Portal>
        <Modal
          visible={createModalVisible}
          onDismiss={() => { setCreateModalVisible(false); resetForm(); }}
          contentContainerStyle={[styles.modalContainer, { backgroundColor: theme.colors.surface }]}
        >
          <KeyboardAvoidingView style={{ flexShrink: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={80}>
              <View style={[styles.modalHeader, { flexDirection }]}>
                <Text variant="titleLarge" style={{ color: theme.colors.onSurface, fontWeight: '700' }}>
                  {t('tasks.addTask')}
                </Text>
                <IconButton icon="close" size={22} onPress={() => { setCreateModalVisible(false); resetForm(); }} />
              </View>

            <ScrollView style={{ flexShrink: 1 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <TextInput
                label={t('tasks.taskTitle')}
                value={formTitle}
                onChangeText={setFormTitle}
                mode="outlined"
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

              <Pressable onPress={openDuePicker}>
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
                  right={<TextInput.Icon icon="calendar" onPress={openDuePicker} />}
                />
                </View>
              </Pressable>

              <GambotDateTimePicker
                visible={showDueDatePicker}
                value={formDueDate || dueDateObj}
                title={t('tasks.dueDate')}
                allowClear
                onConfirm={(d) => {
                  // Keep the reminder in lockstep with the due date by shifting it by the same delta.
                  // Since both default to the same "now", they stay equal until the user edits the
                  // reminder on its own — matching AddTaskSheet / the task edit screen.
                  const prevDue = formDueDate ? new Date(formDueDate) : dueDateObj;
                  const base = prevDue && !isNaN(prevDue.getTime()) ? prevDue : d;
                  const delta = d.getTime() - base.getTime();
                  setDueDateObj(d);
                  setFormDueDate(d.toISOString());
                  if (reminderEnabled) {
                    setReminderDateObj((prev) => {
                      const ref = prev && !isNaN(prev.getTime()) ? prev : new Date(d);
                      const shifted = new Date(ref.getTime() + delta);
                      return isNaN(shifted.getTime()) ? new Date(d) : shifted;
                    });
                  }
                }}
                onClear={() => setFormDueDate('')}
                onDismiss={() => setShowDueDatePicker(false)}
              />

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

                  <GambotDateTimePicker
                    visible={showReminderDatePicker}
                    value={reminderDateObj}
                    title={t('tasks.reminderDateTime', 'תאריך ושעת תזכורת')}
                    onConfirm={(d) => setReminderDateObj(d)}
                    onDismiss={() => setShowReminderDatePicker(false)}
                  />
                </>
              )}

              {/* Assigned to - user picker (defaults to the logged-in user) */}
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
                  {t('tasks.assignedTo', 'אחראי')}
                </Text>
                <View style={[{ flexDirection, alignItems: 'center', gap: 8 }]}>
                  <MaterialCommunityIcons name="account" size={16} color={theme.colors.onSurfaceVariant} />
                  <Text variant="bodyMedium" style={{ flex: 1, color: formAssignedTo ? theme.colors.onSurface : theme.colors.onSurfaceVariant, textAlign }}>
                    {orgUsersLoading ? (t('common.loading') || 'טוען...') : (formAssignedTo || t('tasks.selectUser') || 'בחר משתמש')}
                  </Text>
                  <MaterialCommunityIcons name={userPickerExpanded ? 'chevron-up' : 'chevron-down'} size={18} color={theme.colors.onSurfaceVariant} />
                </View>
              </Pressable>
              {userPickerExpanded && (
                <View style={{ borderWidth: 1, borderColor: theme.colors.outline, borderRadius: 4, marginTop: -8, marginBottom: 12, overflow: 'hidden' }}>
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

              {/* Additional details - collapsed by default (same idea as the web task form and the quick-add sheet) */}
              <Pressable
                onPress={() => setFormDetailsExpanded((v) => !v)}
                style={[styles.detailsToggle, { flexDirection }]}
              >
                <MaterialCommunityIcons
                  name={formDetailsExpanded ? 'chevron-down' : (isRTL ? 'chevron-left' : 'chevron-right')}
                  size={20}
                  color={BRAND_COLOR}
                />
                <Text style={{ color: BRAND_COLOR, fontWeight: '700' }}>
                  {isRTL ? '\u05E4\u05E8\u05D8\u05D9\u05DD \u05E0\u05D5\u05E1\u05E4\u05D9\u05DD' : 'Additional details'}
                </Text>
              </Pressable>

              {formDetailsExpanded && (
                <View>
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

              {/* Linked entity: choose a type, then pick the record */}
              <Text variant="labelLarge" style={[styles.formLabel, { color: theme.colors.onSurface }]}>
                {t('tasks.relatedTo', 'רשומה מקושרת')}
              </Text>
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
                      if (key !== 'contact') resetContactLookup();
                      if (key !== 'lead') { setFormRelatedLeadName(''); setFormRelatedLeadId(''); }
                    }}
                    icon={icon}
                    style={formRelatedEntityType === key ? { backgroundColor: `${BRAND_COLOR}20` } : undefined}
                    selectedColor={BRAND_COLOR}
                  >
                    {label}
                  </Chip>
                ))}
              </View>

              {/* Contact record picker */}
              {formRelatedEntityType === 'contact' && (
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
              )}

              {/* Lead record picker */}
              {formRelatedEntityType === 'lead' && (
                <Pressable
                  onPress={openLeadPicker}
                  style={[
                    styles.formInput,
                    {
                      borderWidth: 1,
                      borderRadius: 4,
                      borderColor: formRelatedLeadId ? BRAND_COLOR : theme.colors.outline,
                      paddingHorizontal: 12,
                      paddingVertical: 12,
                      backgroundColor: theme.colors.surfaceVariant,
                      flexDirection,
                      alignItems: 'center',
                      gap: 8,
                    },
                  ]}
                >
                  <MaterialCommunityIcons name="chart-line" size={20} color={formRelatedLeadId ? BRAND_COLOR : theme.colors.onSurfaceVariant} />
                  <Text
                    style={{ color: formRelatedLeadName ? theme.colors.onSurface : theme.colors.onSurfaceVariant, fontSize: 15, textAlign, flex: 1 }}
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

                </View>
              )}
            </ScrollView>

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
          </KeyboardAvoidingView>
        </Modal>
      </Portal>

      {/* Lead picker modal */}
      <Portal>
        <Modal
          visible={leadPickerVisible}
          onDismiss={() => { setLeadPickerVisible(false); setLeadSearch(''); }}
          contentContainerStyle={[{ margin: 16, borderRadius: 12, backgroundColor: theme.colors.surface, maxHeight: '80%' }]}
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
  chipDivider: { width: 1, height: 20, marginHorizontal: 2 },
  quickAddRow: {
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  quickAddInput: { flex: 1, fontSize: 15, paddingVertical: 10 },
  sectionHeader: { alignItems: 'center', gap: 8, paddingHorizontal: 4, paddingTop: 10, paddingBottom: 2 },
  sectionDot: { width: 8, height: 8, borderRadius: 4 },
  sectionTitle: { fontSize: 13, fontWeight: '700' },
  sectionCount: { fontSize: 12 },
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
  bulkBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 12,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    elevation: 8,
    gap: 6,
  },
  bulkTopRow: { alignItems: 'center' },
  bulkActionsRow: { alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  bulkBtn: { borderRadius: borderRadius.md, flex: 1, minWidth: 100 },
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
  detailsToggle: { alignItems: 'center', gap: 6, paddingVertical: 10, marginBottom: 6 },
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
