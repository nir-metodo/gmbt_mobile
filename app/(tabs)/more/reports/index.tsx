import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Share,
  I18nManager,
} from 'react-native';
import {
  Appbar,
  Surface,
  Text,
  Chip,
  Divider,
  Searchbar,
  IconButton,
  ActivityIndicator,
  Menu,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../../../hooks/useAppTheme';
import { useAuthStore } from '../../../../stores/authStore';
import axiosInstance from '../../../../services/api/axiosInstance';
import { ENDPOINTS } from '../../../../constants/api';
import { spacing, borderRadius, fontSize } from '../../../../constants/theme';

const BRAND = '#2e6155';

type ReportCategory = 'leads' | 'cases' | 'tasks' | 'quotes' | 'esignatures' | 'phonecalls' | 'sla';
type DatePreset = 'all' | 'today' | 'yesterday' | 'thisWeek' | 'lastWeek' | 'thisMonth' | 'lastMonth' | 'thisQuarter' | 'thisYear';
type DataScope = 'my' | 'all';
type SortOption = 'date_desc' | 'date_asc' | 'name' | 'status';

const CATEGORIES: { key: ReportCategory; icon: string; color: string }[] = [
  { key: 'leads', icon: 'trending-up', color: '#f59e0b' },
  { key: 'cases', icon: 'briefcase-outline', color: '#FF6B35' },
  { key: 'tasks', icon: 'checkbox-marked-circle-outline', color: '#10b981' },
  { key: 'quotes', icon: 'file-document-outline', color: '#7B2D8E' },
  { key: 'esignatures', icon: 'draw-pen', color: '#0ea5e9' },
  { key: 'phonecalls', icon: 'phone-outline', color: '#6366f1' },
  { key: 'sla', icon: 'shield-alert-outline', color: '#ef4444' },
];

const DATE_PRESETS: DatePreset[] = ['all', 'today', 'yesterday', 'thisWeek', 'lastWeek', 'thisMonth', 'lastMonth', 'thisQuarter', 'thisYear'];

function getDateRange(preset: DatePreset): { start: Date | null; end: Date | null } {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd = new Date(todayStart);
  todayEnd.setDate(todayEnd.getDate() + 1);

  switch (preset) {
    case 'today':
      return { start: todayStart, end: todayEnd };
    case 'yesterday': {
      const yesterdayStart = new Date(todayStart);
      yesterdayStart.setDate(yesterdayStart.getDate() - 1);
      return { start: yesterdayStart, end: todayStart };
    }
    case 'thisWeek': {
      const dayOfWeek = todayStart.getDay();
      const weekStart = new Date(todayStart);
      weekStart.setDate(weekStart.getDate() - dayOfWeek);
      return { start: weekStart, end: todayEnd };
    }
    case 'lastWeek': {
      const dayOfWeek = todayStart.getDay();
      const thisWeekStart = new Date(todayStart);
      thisWeekStart.setDate(thisWeekStart.getDate() - dayOfWeek);
      const lastWeekStart = new Date(thisWeekStart);
      lastWeekStart.setDate(lastWeekStart.getDate() - 7);
      return { start: lastWeekStart, end: thisWeekStart };
    }
    case 'thisMonth':
      return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: todayEnd };
    case 'lastMonth': {
      const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 1);
      return { start: lastMonthStart, end: lastMonthEnd };
    }
    case 'thisQuarter': {
      const quarterStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
      return { start: quarterStart, end: todayEnd };
    }
    case 'thisYear':
      return { start: new Date(now.getFullYear(), 0, 1), end: todayEnd };
    default:
      return { start: null, end: null };
  }
}

function getItemDate(item: any): Date | null {
  const raw = item.createdOn || item.createdAt || item.startTime || item.date || item.Date || item.modifiedOn || item.breachedAt;
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

function groupBy(items: any[], fieldExtractor: (item: any) => string): Record<string, number> {
  const grouped: Record<string, number> = {};
  items.forEach((item) => {
    const key = fieldExtractor(item) || 'Other';
    grouped[key] = (grouped[key] || 0) + 1;
  });
  return grouped;
}

function sortedEntries(obj: Record<string, number>): [string, number][] {
  return Object.entries(obj).sort(([, a], [, b]) => b - a);
}

function getItemTitle(item: any, category: ReportCategory): string {
  switch (category) {
    case 'leads':
      return item.title || item.Title || item.contactName || '—';
    case 'cases':
      return item.subject || item.title || item.Title || '—';
    case 'tasks':
      return item.title || item.Title || '—';
    case 'quotes':
      return item.title || item.Title || item.quoteNumber || '—';
    case 'esignatures':
      return item.title || item.Title || item.documentTitle || '—';
    case 'phonecalls':
      return item.contactName || item.phoneNumber || '—';
    case 'sla':
      return item.entityTitle || item.subject || item.title || '—';
  }
}

function getItemSubtitle(item: any, category: ReportCategory): string {
  switch (category) {
    case 'leads':
      return [item.stageName || item.stage, item.ownerName].filter(Boolean).join(' · ');
    case 'cases':
      return [item.status || item.Status, item.priority || item.Priority].filter(Boolean).join(' · ');
    case 'tasks':
      return [item.status || item.Status, item.assignedToName].filter(Boolean).join(' · ');
    case 'quotes':
      return [item.status || item.Status, item.total != null ? `₪${Number(item.total).toLocaleString()}` : null].filter(Boolean).join(' · ');
    case 'esignatures':
      return [item.status || item.Status, item.contactName].filter(Boolean).join(' · ');
    case 'phonecalls': {
      const dur = item.duration ? `${Math.floor(item.duration / 60)}:${String(item.duration % 60).padStart(2, '0')}` : null;
      return [item.direction, item.status, dur].filter(Boolean).join(' · ');
    }
    case 'sla':
      return [item.entityType, item.breachType || item.ruleType, item.ownerName].filter(Boolean).join(' · ');
  }
}

function getStatusColor(status: string): string {
  const s = (status || '').toLowerCase();
  if (['completed', 'signed', 'accepted', 'paid', 'closed_won', 'won', 'answered'].includes(s)) return '#10b981';
  if (['pending', 'draft', 'open', 'new', 'voicemail'].includes(s)) return '#f59e0b';
  if (['in_progress', 'in progress', 'sent', 'viewed', 'inbound', 'outbound'].includes(s)) return '#3b82f6';
  if (['overdue', 'rejected', 'expired', 'cancelled', 'closed_lost', 'lost', 'missed', 'no_answer', 'busy', 'breached'].includes(s)) return '#ef4444';
  if (['high', 'urgent'].includes(s)) return '#ef4444';
  if (['medium'].includes(s)) return '#f59e0b';
  if (['low'].includes(s)) return '#10b981';
  return '#6b7280';
}

export default function ReportsScreen() {
  const router = useRouter();
  const theme = useAppTheme();
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const org = user?.organization || '';
  const userId = user?.uID || user?.userId || '';

  const [category, setCategory] = useState<ReportCategory>('leads');
  const [datePreset, setDatePreset] = useState<DatePreset>('all');
  const [dataScope, setDataScope] = useState<DataScope>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('date_desc');
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [rawData, setRawData] = useState<any[]>([]);
  const scrollRef = useRef<ScrollView>(null);

  const canSeeAll = useMemo(() => {
    if (user?.SecurityRole === 'Admin') return true;
    if (category === 'sla') return true;
    const vis = user?.DataVisibility;
    if (!vis) return true;
    const catKey = category === 'esignatures' ? 'esignature' : category === 'phonecalls' ? 'phoneCalls' : category;
    return vis[catKey] === 'all';
  }, [user, category]);

  useEffect(() => {
    if (!canSeeAll && dataScope === 'all') setDataScope('my');
  }, [canSeeAll, dataScope]);

  const fetchReport = useCallback(async (cat: ReportCategory) => {
    if (!org) return;
    setLoading(true);
    try {
      let endpoint = '';
      const payload: any = { organization: org, pageNumber: 1, pageSize: 5000 };

      switch (cat) {
        case 'leads': endpoint = ENDPOINTS.GET_LEADS; break;
        case 'cases': endpoint = ENDPOINTS.GET_CASES; break;
        case 'tasks': endpoint = ENDPOINTS.GET_TASKS; break;
        case 'quotes': endpoint = ENDPOINTS.GET_ALL_QUOTES; break;
        case 'esignatures': endpoint = ENDPOINTS.GET_ESIGNATURE_DOCS; break;
        case 'phonecalls': endpoint = ENDPOINTS.GET_PHONE_CALLS; break;
        case 'sla': endpoint = ENDPOINTS.GET_SLA_BREACHES; break;
      }

      if (cat === 'tasks') {
        payload.organizationName = org;
        payload.userId = userId;
        payload.dataVisibility = dataScope === 'my' ? 'seeOwn' : 'seeAll';
        delete payload.organization;
        delete payload.pageNumber;
        delete payload.pageSize;
      } else if (cat === 'quotes') {
        payload.userId = userId;
        payload.dataVisibility = dataScope === 'my' ? 'seeOwn' : 'seeAll';
        delete payload.pageNumber;
        delete payload.pageSize;
      } else if (cat === 'sla') {
        delete payload.pageNumber;
        delete payload.pageSize;
      } else if (cat === 'phonecalls') {
        payload.userId = userId;
        payload.dataVisibility = dataScope === 'my' ? 'seeOwn' : 'seeAll';
      } else {
        payload.userId = userId;
        payload.dataVisibility = dataScope === 'my' ? 'seeOwn' : 'seeAll';
      }

      const res = await axiosInstance.post(endpoint, payload);
      const raw = res.data;
      const items =
        raw?.Leads || raw?.Cases || raw?.Quotes || raw?.tasks || raw?.Tasks ||
        raw?.Data || raw?.data || raw?.Documents || raw?.documents ||
        raw?.Calls || raw?.calls || raw?.Breaches || raw?.breaches ||
        (Array.isArray(raw) ? raw : []);
      setRawData(Array.isArray(items) ? items : []);
    } catch (err) {
      console.log('Reports fetch error:', err);
      setRawData([]);
    } finally {
      setLoading(false);
    }
  }, [org, userId, dataScope]);

  useEffect(() => { fetchReport(category); }, [category, fetchReport]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchReport(category);
    setRefreshing(false);
  }, [category, fetchReport]);

  const filteredData = useMemo(() => {
    let items = rawData;

    if (datePreset !== 'all') {
      const { start, end } = getDateRange(datePreset);
      if (start && end) {
        items = items.filter((item) => {
          const d = getItemDate(item);
          return d && d >= start && d < end;
        });
      }
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      items = items.filter((item) => {
        const title = getItemTitle(item, category).toLowerCase();
        const sub = getItemSubtitle(item, category).toLowerCase();
        const contact = (item.contactName || item.contactPhone || item.phoneNumber || '').toLowerCase();
        return title.includes(q) || sub.includes(q) || contact.includes(q);
      });
    }

    return items;
  }, [rawData, datePreset, searchQuery, category]);

  const sortedData = useMemo(() => {
    const items = [...filteredData];
    switch (sortBy) {
      case 'date_desc':
        return items.sort((a, b) => (getItemDate(b)?.getTime() || 0) - (getItemDate(a)?.getTime() || 0));
      case 'date_asc':
        return items.sort((a, b) => (getItemDate(a)?.getTime() || 0) - (getItemDate(b)?.getTime() || 0));
      case 'name':
        return items.sort((a, b) => getItemTitle(a, category).localeCompare(getItemTitle(b, category)));
      case 'status':
        return items.sort((a, b) => {
          const sa = a.status || a.Status || a.stageName || '';
          const sb = b.status || b.Status || b.stageName || '';
          return sa.localeCompare(sb);
        });
      default:
        return items;
    }
  }, [filteredData, sortBy, category]);

  const stats = useMemo(() => {
    const items = filteredData;
    switch (category) {
      case 'leads': return {
        byStage: groupBy(items, (i) => i.stageName || i.stage || i.Stage),
        bySource: groupBy(items, (i) => i.source || i.Source),
        byOwner: groupBy(items, (i) => i.ownerName || i.OwnerName),
        byChannel: groupBy(items, (i) => i.channel || i.Channel || i.leadChannel),
      };
      case 'cases': return {
        byCategory: groupBy(items, (i) => i.categoryName || i.category || i.Category),
        byPriority: groupBy(items, (i) => i.priority || i.Priority),
        byStatus: groupBy(items, (i) => i.status || i.Status || i.stageName),
        byOwner: groupBy(items, (i) => i.ownerName || i.OwnerName || i.assignedToName),
      };
      case 'tasks': {
        const overdue = items.filter((i) => {
          if ((i.status || '').toLowerCase() === 'completed') return false;
          const due = i.dueDate || i.DueDate;
          return due && new Date(due) < new Date();
        }).length;
        return {
          byStatus: groupBy(items, (i) => i.status || i.Status),
          byPriority: groupBy(items, (i) => i.priority || i.Priority),
          byAssignee: groupBy(items, (i) => i.assignedToName || i.assignedTo || i.AssignedTo),
          overdue,
        };
      }
      case 'quotes': {
        const totalValue = items.reduce((sum, i) => sum + (Number(i.total || i.Total || 0)), 0);
        return {
          byStatus: groupBy(items, (i) => i.status || i.Status),
          bySalesperson: groupBy(items, (i) => i.ownerName || i.salespersonName || i.createdByName),
          totalValue,
        };
      }
      case 'esignatures': return {
        byStatus: groupBy(items, (i) => i.status || i.Status),
      };
      case 'phonecalls': {
        const answered = items.filter((i) => (i.status || '').toLowerCase() === 'answered').length;
        const missed = items.filter((i) => ['missed', 'no_answer'].includes((i.status || '').toLowerCase())).length;
        const totalDuration = items.reduce((sum, i) => sum + (Number(i.duration) || 0), 0);
        const avgDuration = items.length > 0 ? Math.round(totalDuration / items.length) : 0;
        return {
          byStatus: groupBy(items, (i) => i.status || i.Status),
          byDirection: groupBy(items, (i) => i.direction || i.Direction),
          byUser: groupBy(items, (i) => i.userName || i.userId || i.createdByName),
          byContact: groupBy(items, (i) => i.contactName || i.phoneNumber),
          answered,
          missed,
          totalDuration,
          avgDuration,
        };
      }
      case 'sla': return {
        byEntityType: groupBy(items, (i) => i.entityType || i.EntityType),
        byBreachType: groupBy(items, (i) => i.breachType || i.ruleType || i.BreachType),
        byOwner: groupBy(items, (i) => i.ownerName || i.OwnerName),
      };
    }
  }, [filteredData, category]);

  const kpiMetrics = useMemo(() => {
    const items = filteredData;
    if (items.length === 0) return [];

    switch (category) {
      case 'leads': {
        const won = items.filter(i => ['closed_won', 'won'].includes((i.stageName || i.stage || '').toLowerCase())).length;
        const convRate = items.length > 0 ? ((won / items.length) * 100).toFixed(0) : '0';
        const newCount = items.filter(i => ['new', 'new lead'].includes((i.stageName || i.stage || '').toLowerCase())).length;
        return [
          { label: t('reports.kpiWonRate'), value: `${convRate}%`, color: '#10b981', icon: 'trophy-outline' },
          { label: t('reports.kpiNew'), value: newCount, color: '#3b82f6', icon: 'plus-circle-outline' },
          { label: t('reports.kpiWon'), value: won, color: '#10b981', icon: 'check-circle-outline' },
        ];
      }
      case 'cases': {
        const open = items.filter(i => ['open', 'new', 'in_progress', 'in progress'].includes((i.status || i.Status || '').toLowerCase())).length;
        const highPri = items.filter(i => ['high', 'urgent'].includes((i.priority || i.Priority || '').toLowerCase())).length;
        const closed = items.filter(i => ['closed', 'resolved', 'completed'].includes((i.status || i.Status || '').toLowerCase())).length;
        return [
          { label: t('reports.kpiOpen'), value: open, color: '#f59e0b', icon: 'folder-open-outline' },
          { label: t('reports.kpiHighPriority'), value: highPri, color: '#ef4444', icon: 'alert-circle-outline' },
          { label: t('reports.kpiClosed'), value: closed, color: '#10b981', icon: 'check-circle-outline' },
        ];
      }
      case 'tasks': {
        const completed = items.filter(i => (i.status || '').toLowerCase() === 'completed').length;
        const inProgress = items.filter(i => ['in_progress', 'in progress'].includes((i.status || '').toLowerCase())).length;
        const completionRate = items.length > 0 ? ((completed / items.length) * 100).toFixed(0) : '0';
        return [
          { label: t('reports.kpiCompletionRate'), value: `${completionRate}%`, color: '#10b981', icon: 'percent' },
          { label: t('reports.kpiCompleted'), value: completed, color: '#10b981', icon: 'check-circle-outline' },
          { label: t('reports.kpiInProgress'), value: inProgress, color: '#3b82f6', icon: 'progress-clock' },
        ];
      }
      case 'quotes': {
        const totalVal = items.reduce((sum, i) => sum + Number(i.total || i.Total || 0), 0);
        const avgVal = items.length > 0 ? totalVal / items.length : 0;
        const accepted = items.filter(i => (i.status || '').toLowerCase() === 'accepted').length;
        const acceptRate = items.length > 0 ? ((accepted / items.length) * 100).toFixed(0) : '0';
        return [
          { label: t('reports.kpiAvgValue'), value: `₪${Math.round(avgVal).toLocaleString()}`, color: '#7B2D8E', icon: 'calculator-variant' },
          { label: t('reports.kpiAcceptRate'), value: `${acceptRate}%`, color: '#10b981', icon: 'thumb-up-outline' },
          { label: t('reports.kpiAccepted'), value: accepted, color: '#10b981', icon: 'check-circle-outline' },
        ];
      }
      case 'esignatures': {
        const signed = items.filter(i => (i.status || '').toLowerCase() === 'signed').length;
        const pending = items.filter(i => (i.status || '').toLowerCase() === 'pending').length;
        const signRate = items.length > 0 ? ((signed / items.length) * 100).toFixed(0) : '0';
        return [
          { label: t('reports.kpiSignRate'), value: `${signRate}%`, color: '#10b981', icon: 'check-decagram-outline' },
          { label: t('reports.kpiSigned'), value: signed, color: '#10b981', icon: 'draw-pen' },
          { label: t('reports.kpiPending'), value: pending, color: '#f59e0b', icon: 'clock-outline' },
        ];
      }
      case 'phonecalls': {
        const answered = items.filter(i => (i.status || '').toLowerCase() === 'answered').length;
        const missed = items.filter(i => ['missed', 'no_answer'].includes((i.status || '').toLowerCase())).length;
        const totalDur = items.reduce((sum, i) => sum + (Number(i.duration) || 0), 0);
        const avgDur = items.length > 0 ? Math.round(totalDur / items.length) : 0;
        const avgMin = Math.floor(avgDur / 60);
        const avgSec = avgDur % 60;
        const answerRate = items.length > 0 ? ((answered / items.length) * 100).toFixed(0) : '0';
        return [
          { label: t('reports.kpiAnswerRate'), value: `${answerRate}%`, color: '#10b981', icon: 'phone-check' },
          { label: t('reports.kpiAnswered'), value: answered, color: '#10b981', icon: 'phone-in-talk' },
          { label: t('reports.kpiMissed'), value: missed, color: '#ef4444', icon: 'phone-missed' },
          { label: t('reports.kpiAvgDuration'), value: `${avgMin}:${String(avgSec).padStart(2, '0')}`, color: '#6366f1', icon: 'timer-outline' },
        ];
      }
      case 'sla': {
        const byType = groupBy(items, (i) => i.entityType || i.EntityType);
        const topType = sortedEntries(byType)[0];
        return [
          { label: t('reports.kpiTotalBreaches'), value: items.length, color: '#ef4444', icon: 'shield-alert-outline' },
          { label: t('reports.kpiTopBreachType'), value: topType ? topType[0] : '—', color: '#f59e0b', icon: 'alert-circle-outline' },
        ];
      }
    }
  }, [filteredData, category, t]);

  const currentCat = CATEGORIES.find((c) => c.key === category)!;
  const totalItems = filteredData.length;

  const handleExport = useCallback(async () => {
    if (sortedData.length === 0) return;
    try {
      const headerMap: Record<ReportCategory, string[]> = {
        leads: ['Title', 'Stage', 'Source', 'Owner', 'Channel', 'Value', 'Created'],
        cases: ['Title', 'Status', 'Category', 'Owner', 'Priority', 'Created'],
        tasks: ['Title', 'Status', 'Priority', 'Assigned To', 'Due Date', 'Created'],
        quotes: ['Title', 'Status', 'Salesperson', 'Total', 'Contact', 'Created'],
        esignatures: ['Title', 'Status', 'Contact', 'Created'],
        phonecalls: ['Contact', 'Phone', 'Direction', 'Status', 'Duration', 'Date'],
        sla: ['Entity', 'Type', 'Breach Type', 'Owner', 'Breached At'],
      };
      const headers = headerMap[category];

      const rows = sortedData.map((item) => {
        switch (category) {
          case 'leads': return [
            getItemTitle(item, category),
            item.stageName || item.stage || '',
            item.source || '',
            item.ownerName || '',
            item.channel || item.Channel || '',
            item.value || '',
            item.createdOn || item.createdAt || '',
          ];
          case 'cases': return [
            getItemTitle(item, category),
            item.status || '',
            item.categoryName || item.category || '',
            item.ownerName || item.assignedToName || '',
            item.priority || '',
            item.createdOn || item.createdAt || '',
          ];
          case 'tasks': return [
            getItemTitle(item, category),
            item.status || '',
            item.priority || '',
            item.assignedToName || '',
            item.dueDate || '',
            item.createdOn || item.createdAt || '',
          ];
          case 'quotes': return [
            getItemTitle(item, category),
            item.status || '',
            item.ownerName || item.salespersonName || '',
            item.total || '',
            item.contactName || '',
            item.createdOn || item.createdAt || '',
          ];
          case 'esignatures': return [
            getItemTitle(item, category),
            item.status || '',
            item.contactName || '',
            item.createdAt || '',
          ];
          case 'phonecalls': {
            const dur = item.duration ? `${Math.floor(item.duration / 60)}:${String(item.duration % 60).padStart(2, '0')}` : '';
            return [
              item.contactName || '',
              item.phoneNumber || '',
              item.direction || '',
              item.status || '',
              dur,
              item.startTime || item.createdAt || '',
            ];
          }
          case 'sla': return [
            getItemTitle(item, category),
            item.entityType || '',
            item.breachType || item.ruleType || '',
            item.ownerName || '',
            item.breachedAt || item.createdAt || '',
          ];
        }
      });

      const csvContent = [headers.join(','), ...rows.map((r) => r.map((v: any) => `"${String(v).replace(/"/g, '""')}"`).join(','))].join('\n');

      await Share.share({
        message: csvContent,
        title: `${t(`reports.${category}`)} Report`,
      });
    } catch (err) {
      console.log('Export error:', err);
    }
  }, [sortedData, category, t]);

  const sortLabel = (opt: SortOption) => {
    switch (opt) {
      case 'date_desc': return t('reports.sortNewest');
      case 'date_asc': return t('reports.sortOldest');
      case 'name': return t('reports.sortName');
      case 'status': return t('reports.sortStatus');
    }
  };

  const renderBarSection = (title: string, data: Record<string, number>, color: string) => {
    const entries = sortedEntries(data);
    if (entries.length === 0) return null;
    const max = entries[0]?.[1] || 1;

    return (
      <Surface style={[styles.section, { backgroundColor: theme.colors.surface }]} elevation={1}>
        <Text variant="titleMedium" style={[styles.sectionTitle, { color: theme.colors.onSurface }]}>
          {title}
        </Text>
        <Divider style={{ marginBottom: spacing.sm }} />
        {entries.map(([key, count]) => {
          const pct = totalItems > 0 ? (count / totalItems) * 100 : 0;
          return (
            <View key={key} style={styles.barRow}>
              <View style={styles.barLabel}>
                <View style={[styles.statusDot, { backgroundColor: getStatusColor(key) }]} />
                <Text variant="bodyMedium" style={{ color: theme.colors.onSurface, flex: 1 }} numberOfLines={1}>
                  {key}
                </Text>
                <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant, fontWeight: '600' }}>
                  {count}
                </Text>
                <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant, width: 45, textAlign: 'right' }}>
                  {pct.toFixed(0)}%
                </Text>
              </View>
              <View style={styles.barTrack}>
                <View style={[styles.barFill, { width: `${Math.max((count / max) * 100, 2)}%`, backgroundColor: color }]} />
              </View>
            </View>
          );
        })}
      </Surface>
    );
  };

  const renderKPICards = () => {
    if (!kpiMetrics || kpiMetrics.length === 0) return null;
    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.kpiScroll} contentContainerStyle={styles.kpiContainer}>
        {kpiMetrics.map((kpi, idx) => (
          <Surface key={idx} style={[styles.kpiCard, { backgroundColor: theme.colors.surface }]} elevation={1}>
            <View style={[styles.kpiIconWrap, { backgroundColor: kpi.color + '15' }]}>
              <MaterialCommunityIcons name={kpi.icon as any} size={18} color={kpi.color} />
            </View>
            <Text variant="titleLarge" style={{ color: theme.colors.onSurface, fontWeight: '800', marginTop: 6 }}>
              {kpi.value}
            </Text>
            <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: 2 }} numberOfLines={1}>
              {kpi.label}
            </Text>
          </Surface>
        ))}
      </ScrollView>
    );
  };

  const renderCategoryStats = () => {
    if (!stats) return null;
    const s = stats as any;

    switch (category) {
      case 'leads':
        return (
          <>
            {renderBarSection(t('reports.byStage'), s.byStage, currentCat.color)}
            {renderBarSection(t('reports.bySource'), s.bySource, '#6366f1')}
            {renderBarSection(t('reports.byOwner'), s.byOwner, '#0ea5e9')}
            {renderBarSection(t('reports.byChannel'), s.byChannel, '#8b5cf6')}
          </>
        );
      case 'cases':
        return (
          <>
            {renderBarSection(t('reports.byStatus'), s.byStatus, currentCat.color)}
            {renderBarSection(t('reports.byCategory'), s.byCategory, '#6366f1')}
            {renderBarSection(t('reports.byOwner'), s.byOwner, '#0ea5e9')}
            {renderBarSection(t('reports.byPriority'), s.byPriority, '#ef4444')}
          </>
        );
      case 'tasks':
        return (
          <>
            {s.overdue > 0 && (
              <Surface style={[styles.alertCard, { backgroundColor: '#fef2f2' }]} elevation={1}>
                <MaterialCommunityIcons name="alert-circle" size={20} color="#ef4444" />
                <Text variant="bodyMedium" style={{ color: '#ef4444', fontWeight: '700', marginLeft: spacing.sm }}>
                  {s.overdue} {t('reports.overdueItems')}
                </Text>
              </Surface>
            )}
            {renderBarSection(t('reports.byStatus'), s.byStatus, currentCat.color)}
            {renderBarSection(t('reports.byAssignee'), s.byAssignee, '#0ea5e9')}
            {renderBarSection(t('reports.byPriority'), s.byPriority, '#f59e0b')}
          </>
        );
      case 'quotes': {
        const totalVal = s.totalValue || 0;
        return (
          <>
            <Surface style={[styles.valueCard, { backgroundColor: theme.colors.surface }]} elevation={1}>
              <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant }}>
                {t('reports.totalValue')}
              </Text>
              <Text variant="headlineMedium" style={{ color: BRAND, fontWeight: '800' }}>
                ₪{totalVal.toLocaleString()}
              </Text>
            </Surface>
            {renderBarSection(t('reports.byStatus'), s.byStatus, currentCat.color)}
            {renderBarSection(t('reports.bySalesperson'), s.bySalesperson, '#0ea5e9')}
          </>
        );
      }
      case 'esignatures':
        return renderBarSection(t('reports.byStatus'), s.byStatus, currentCat.color);
      case 'phonecalls': {
        const avgMin = Math.floor((s.avgDuration || 0) / 60);
        const avgSec = (s.avgDuration || 0) % 60;
        const totalMin = Math.floor((s.totalDuration || 0) / 60);
        const totalSec = (s.totalDuration || 0) % 60;
        return (
          <>
            <Surface style={[styles.section, { backgroundColor: theme.colors.surface }]} elevation={1}>
              <Text variant="titleMedium" style={[styles.sectionTitle, { color: theme.colors.onSurface }]}>
                {t('reports.callSummary')}
              </Text>
              <Divider style={{ marginBottom: spacing.sm }} />
              <View style={styles.callStatsGrid}>
                <View style={styles.callStatItem}>
                  <Text variant="headlineSmall" style={{ color: '#6366f1', fontWeight: '800' }}>{filteredData.length}</Text>
                  <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>{t('reports.totalCalls')}</Text>
                </View>
                <View style={styles.callStatItem}>
                  <Text variant="headlineSmall" style={{ color: '#10b981', fontWeight: '800' }}>{s.answered || 0}</Text>
                  <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>{t('reports.kpiAnswered')}</Text>
                </View>
                <View style={styles.callStatItem}>
                  <Text variant="headlineSmall" style={{ color: '#ef4444', fontWeight: '800' }}>{s.missed || 0}</Text>
                  <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>{t('reports.kpiMissed')}</Text>
                </View>
                <View style={styles.callStatItem}>
                  <Text variant="headlineSmall" style={{ color: '#6366f1', fontWeight: '800' }}>{avgMin}:{String(avgSec).padStart(2, '0')}</Text>
                  <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>{t('reports.kpiAvgDuration')}</Text>
                </View>
              </View>
              <Divider style={{ marginVertical: spacing.sm }} />
              <View style={{ flexDirection: 'row', justifyContent: 'center', gap: spacing.lg }}>
                <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                  {t('reports.totalDuration')}: {totalMin}:{String(totalSec).padStart(2, '0')}
                </Text>
              </View>
            </Surface>
            {renderBarSection(t('reports.byStatus'), s.byStatus, currentCat.color)}
            {renderBarSection(t('reports.byDirection'), s.byDirection, '#3b82f6')}
            {renderBarSection(t('reports.byUser'), s.byUser, '#0ea5e9')}
            {renderBarSection(t('reports.byContact'), s.byContact, '#8b5cf6')}
          </>
        );
      }
      case 'sla':
        return (
          <>
            {filteredData.length > 0 && (
              <Surface style={[styles.alertCard, { backgroundColor: '#fef2f2' }]} elevation={1}>
                <MaterialCommunityIcons name="shield-alert" size={20} color="#ef4444" />
                <Text variant="bodyMedium" style={{ color: '#ef4444', fontWeight: '700', marginLeft: spacing.sm }}>
                  {filteredData.length} {t('reports.slaBreaches')}
                </Text>
              </Surface>
            )}
            {renderBarSection(t('reports.byEntityType'), s.byEntityType, currentCat.color)}
            {renderBarSection(t('reports.byBreachType'), s.byBreachType, '#f59e0b')}
            {renderBarSection(t('reports.byOwner'), s.byOwner, '#0ea5e9')}
          </>
        );
    }
  };

  const renderListItem = ({ item }: { item: any }) => {
    const title = getItemTitle(item, category);
    const subtitle = getItemSubtitle(item, category);
    const dateRaw = item.createdOn || item.createdAt || item.date;
    const dateStr = dateRaw ? new Date(dateRaw).toLocaleDateString() : '';
    const status = item.status || item.Status || item.stageName || item.stage || '';

    return (
      <Surface style={[styles.listItem, { backgroundColor: theme.colors.surface }]} elevation={0}>
        <View style={[styles.listItemIcon, { backgroundColor: currentCat.color + '15' }]}>
          <MaterialCommunityIcons name={currentCat.icon as any} size={18} color={currentCat.color} />
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="bodyMedium" style={{ color: theme.colors.onSurface, fontWeight: '600' }} numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: 2 }} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          {status ? (
            <View style={[styles.statusBadge, { backgroundColor: getStatusColor(status) + '18' }]}>
              <Text variant="labelSmall" style={{ color: getStatusColor(status), fontWeight: '600', fontSize: 10 }}>
                {status}
              </Text>
            </View>
          ) : null}
          {dateStr ? (
            <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: 2, fontSize: 10 }}>
              {dateStr}
            </Text>
          ) : null}
        </View>
      </Surface>
    );
  };

  const datePresetLabel = (preset: DatePreset) => {
    switch (preset) {
      case 'all': return t('reports.all');
      case 'today': return t('reports.today');
      case 'yesterday': return t('reports.yesterday');
      case 'thisWeek': return t('reports.thisWeek');
      case 'lastWeek': return t('reports.lastWeek');
      case 'thisMonth': return t('reports.thisMonth');
      case 'lastMonth': return t('reports.lastMonth');
      case 'thisQuarter': return t('reports.thisQuarter');
      case 'thisYear': return t('reports.thisYear');
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Appbar.Header style={{ backgroundColor: BRAND }} statusBarHeight={0}>
        <Appbar.BackAction onPress={() => router.back()} color="#fff" />
        <Appbar.Content title={t('reports.title')} titleStyle={styles.headerTitle} />
        <Appbar.Action icon="export-variant" onPress={handleExport} color="#fff" disabled={sortedData.length === 0} />
      </Appbar.Header>

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[BRAND]} />}
        showsVerticalScrollIndicator={false}
      >
        {/* Category Tabs */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.categoryScroll}>
          {CATEGORIES.map((cat) => (
            <Chip
              key={cat.key}
              selected={category === cat.key}
              onPress={() => { setCategory(cat.key); setSearchQuery(''); }}
              style={[styles.chip, category === cat.key && { backgroundColor: cat.color + '20', borderColor: cat.color, borderWidth: 1 }]}
              textStyle={category === cat.key ? { color: cat.color, fontWeight: '700' } : { color: theme.colors.onSurfaceVariant }}
              icon={() => (
                <MaterialCommunityIcons
                  name={cat.icon as any}
                  size={16}
                  color={category === cat.key ? cat.color : theme.colors.onSurfaceVariant}
                />
              )}
            >
              {t(`reports.${cat.key}`)}
            </Chip>
          ))}
        </ScrollView>

        {/* Date Range Presets */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow}>
          {DATE_PRESETS.map((preset) => (
            <Chip
              key={preset}
              selected={datePreset === preset}
              onPress={() => setDatePreset(preset)}
              style={[
                styles.dateChip,
                datePreset === preset && { backgroundColor: BRAND + '15', borderColor: BRAND, borderWidth: 1 },
              ]}
              textStyle={datePreset === preset ? { color: BRAND, fontWeight: '600', fontSize: 12 } : { color: theme.colors.onSurfaceVariant, fontSize: 12 }}
              compact
            >
              {datePresetLabel(preset)}
            </Chip>
          ))}
        </ScrollView>

        {/* Data Scope Toggle */}
        <View style={styles.controlsRow}>
          {canSeeAll && (
            <View style={styles.scopeToggle}>
              <Chip
                selected={dataScope === 'my'}
                onPress={() => setDataScope('my')}
                style={[styles.scopeChip, dataScope === 'my' && { backgroundColor: BRAND + '15' }]}
                textStyle={dataScope === 'my' ? { color: BRAND, fontWeight: '600', fontSize: 12 } : { fontSize: 12, color: theme.colors.onSurfaceVariant }}
                compact
                icon={() => <MaterialCommunityIcons name="account" size={14} color={dataScope === 'my' ? BRAND : theme.colors.onSurfaceVariant} />}
              >
                {t('reports.myData')}
              </Chip>
              <Chip
                selected={dataScope === 'all'}
                onPress={() => setDataScope('all')}
                style={[styles.scopeChip, dataScope === 'all' && { backgroundColor: BRAND + '15' }]}
                textStyle={dataScope === 'all' ? { color: BRAND, fontWeight: '600', fontSize: 12 } : { fontSize: 12, color: theme.colors.onSurfaceVariant }}
                compact
                icon={() => <MaterialCommunityIcons name="account-group" size={14} color={dataScope === 'all' ? BRAND : theme.colors.onSurfaceVariant} />}
              >
                {t('reports.allData')}
              </Chip>
            </View>
          )}
        </View>

        {/* Search */}
        <Searchbar
          placeholder={t('reports.searchPlaceholder')}
          value={searchQuery}
          onChangeText={setSearchQuery}
          style={[styles.searchbar, { backgroundColor: theme.colors.surfaceVariant }]}
          inputStyle={{ fontSize: 14 }}
          iconColor={theme.colors.onSurfaceVariant}
          elevation={0}
        />

        {/* Loading */}
        {loading && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={BRAND} />
          </View>
        )}

        {/* Total Card */}
        {!loading && (
          <Surface style={[styles.totalCard, { backgroundColor: currentCat.color }]} elevation={2}>
            <MaterialCommunityIcons name={currentCat.icon as any} size={32} color="#fff" />
            <View style={{ marginLeft: spacing.md, flex: 1 }}>
              <Text variant="headlineMedium" style={{ color: '#fff', fontWeight: '800' }}>
                {totalItems.toLocaleString()}
              </Text>
              <Text variant="labelMedium" style={{ color: 'rgba(255,255,255,0.8)' }}>
                {t(`reports.${category}`)} {datePreset !== 'all' ? `· ${datePresetLabel(datePreset)}` : ''}
              </Text>
            </View>
            {dataScope === 'my' && (
              <View style={styles.scopeIndicator}>
                <MaterialCommunityIcons name="account" size={14} color="rgba(255,255,255,0.8)" />
                <Text variant="labelSmall" style={{ color: 'rgba(255,255,255,0.8)', marginLeft: 2 }}>
                  {t('reports.myData')}
                </Text>
              </View>
            )}
          </Surface>
        )}

        {/* KPI Summary Cards */}
        {!loading && totalItems > 0 && renderKPICards()}

        {/* Stats Sections */}
        {!loading && totalItems > 0 && renderCategoryStats()}

        {/* Records List */}
        {!loading && totalItems > 0 && (
          <Surface style={[styles.section, { backgroundColor: theme.colors.surface, paddingBottom: 0 }]} elevation={1}>
            <View style={styles.listHeader}>
              <Text variant="titleMedium" style={[styles.sectionTitle, { marginBottom: 0, color: theme.colors.onSurface }]}>
                {t('reports.records')} ({totalItems})
              </Text>
              <Menu
                visible={showSortMenu}
                onDismiss={() => setShowSortMenu(false)}
                anchor={
                  <IconButton
                    icon="sort"
                    size={20}
                    onPress={() => setShowSortMenu(true)}
                    iconColor={theme.colors.onSurfaceVariant}
                  />
                }
              >
                {(['date_desc', 'date_asc', 'name', 'status'] as SortOption[]).map((opt) => (
                  <Menu.Item
                    key={opt}
                    title={sortLabel(opt)}
                    leadingIcon={sortBy === opt ? 'check' : undefined}
                    onPress={() => { setSortBy(opt); setShowSortMenu(false); }}
                    titleStyle={sortBy === opt ? { color: BRAND, fontWeight: '600' } : undefined}
                  />
                ))}
              </Menu>
            </View>
            <Divider style={{ marginVertical: spacing.sm }} />
            {sortedData.slice(0, 50).map((item, idx) => (
              <React.Fragment key={item.id || item.Id || idx}>
                {renderListItem({ item })}
                {idx < Math.min(sortedData.length, 50) - 1 && (
                  <Divider style={{ marginLeft: 52 }} />
                )}
              </React.Fragment>
            ))}
            {sortedData.length > 50 && (
              <View style={{ padding: spacing.md, alignItems: 'center' }}>
                <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                  {t('reports.showingFirst', { count: 50, total: sortedData.length })}
                </Text>
              </View>
            )}
          </Surface>
        )}

        {/* Empty State */}
        {!loading && totalItems === 0 && (
          <View style={styles.emptyState}>
            <MaterialCommunityIcons name="chart-line-variant" size={64} color={theme.colors.onSurfaceVariant} />
            <Text variant="bodyLarge" style={{ color: theme.colors.onSurfaceVariant, marginTop: spacing.md, textAlign: 'center' }}>
              {t('reports.noData')}
            </Text>
          </View>
        )}

        <View style={{ height: spacing.xxl }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerTitle: { color: '#fff', fontWeight: '700', fontSize: fontSize.xl },
  content: { padding: spacing.md, paddingBottom: spacing.xxl },
  categoryScroll: { marginBottom: spacing.sm },
  chip: { marginRight: spacing.sm, borderRadius: borderRadius.full },
  filterRow: { marginBottom: spacing.sm },
  dateChip: { marginRight: spacing.xs, borderRadius: borderRadius.full, height: 32 },
  controlsRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
  scopeToggle: { flexDirection: 'row', gap: spacing.xs },
  scopeChip: { borderRadius: borderRadius.full, height: 32 },
  searchbar: { borderRadius: borderRadius.xl, marginBottom: spacing.md, height: 42 },
  loadingContainer: { padding: spacing.xxl, alignItems: 'center' },
  totalCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  scopeIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  kpiScroll: { marginBottom: spacing.md },
  kpiContainer: { gap: spacing.sm },
  kpiCard: {
    borderRadius: borderRadius.xl,
    padding: spacing.md,
    minWidth: 120,
    alignItems: 'center',
  },
  kpiIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  section: {
    borderRadius: borderRadius.xl,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  sectionTitle: { fontWeight: '700', marginBottom: spacing.sm },
  barRow: { marginBottom: spacing.sm },
  barLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
    gap: spacing.sm,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  barTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: '#e2e8f0',
    overflow: 'hidden',
  },
  barFill: { height: '100%', borderRadius: 4 },
  alertCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: borderRadius.xl,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  valueCard: {
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
    marginBottom: spacing.md,
    alignItems: 'center',
  },
  listHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: 0,
  },
  listItemIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  statusBadge: {
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxl,
  },
  callStatsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-around',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  callStatItem: {
    alignItems: 'center',
    minWidth: 70,
    paddingVertical: spacing.xs,
  },
});
