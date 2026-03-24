import React, { useEffect, useState, useCallback } from 'react';
import { View, StyleSheet, ScrollView, RefreshControl, Dimensions } from 'react-native';
import { Appbar, Surface, Text, ProgressBar, Divider, Chip, ActivityIndicator } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../../../hooks/useAppTheme';
import { useAuthStore } from '../../../../stores/authStore';
import axiosInstance from '../../../../services/api/axiosInstance';
import { ENDPOINTS } from '../../../../constants/api';
import { spacing, borderRadius, fontSize } from '../../../../constants/theme';

const BRAND = '#2e6155';
const { width } = Dimensions.get('window');
const CARD_WIDTH = (width - spacing.md * 2 - spacing.sm) / 2;

type DateRange = 'today' | 'week' | 'month' | 'year';

interface DashboardData {
  messages?: { total: number; sent: number; received: number; delivered: number; read: number; failed: number };
  aiUsage?: { used: number; limit: number };
  proActiveUsage?: { used: number; limit: number };
  activeTasks?: number;
}

interface ContactGrowth {
  totalContacts?: number;
  thisMonthCount?: number;
  lastMonthCount?: number;
  growthPercentage?: number;
}

interface RecentLead {
  id: string;
  title: string;
  stage: string;
  value: number;
  contactName?: string;
}

interface LeadsDashboard {
  totalLeads?: number;
  openLeads?: number;
  byStage?: Record<string, number>;
  wonThisMonth?: number;
  lostThisMonth?: number;
  pipelineValue?: number;
  conversionRate?: number;
  recentLeads?: RecentLead[];
}

interface TaskStats {
  total: number;
  active: number;
  completed: number;
  overdue: number;
  byPriority: Record<string, number>;
}

interface QuoteStats {
  total: number;
  totalValue: number;
  byStatus: Record<string, number>;
}

interface ESignatureStats {
  total: number;
  signed: number;
  pending: number;
  expired: number;
}

interface ConversationDashboard {
  totalConversations?: number;
  openConversations?: number;
  closedConversations?: number;
  avgResponseTime?: number;
}

interface PhoneCallStats {
  total: number;
  answered: number;
  missed: number;
  avgDuration: number;
}

const STAGE_COLORS = ['#2e6155', '#3b82f6', '#f59e0b', '#8b5cf6', '#ec4899', '#10b981', '#ef4444', '#6366f1'];
const PRIORITY_COLORS: Record<string, string> = { High: '#ef4444', Medium: '#f59e0b', Low: '#10b981', None: '#94a3b8' };
const QUOTE_STATUS_COLORS: Record<string, string> = { Draft: '#94a3b8', Sent: '#3b82f6', Accepted: '#10b981', Rejected: '#ef4444', Paid: '#8b5cf6' };

function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return '0s';
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins < 60) return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return remainMins > 0 ? `${hrs}h ${remainMins}m` : `${hrs}h`;
}

function getDateRange(range: DateRange): { startDate: string; endDate: string } {
  const now = new Date();
  const end = now.toISOString();
  let start: Date;
  switch (range) {
    case 'today':
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      break;
    case 'week': {
      const day = now.getDay();
      start = new Date(now);
      start.setDate(now.getDate() - day);
      start.setHours(0, 0, 0, 0);
      break;
    }
    case 'month':
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      break;
    case 'year':
      start = new Date(now.getFullYear(), 0, 1);
      break;
  }
  return { startDate: start.toISOString(), endDate: end };
}

function StatCard({ icon, label, value, color, surfaceBg, textColor, subtextColor }: {
  icon: string; label: string; value: string | number; color: string;
  surfaceBg: string; textColor: string; subtextColor: string;
}) {
  return (
    <Surface style={[styles.statCard, { backgroundColor: surfaceBg, borderTopWidth: 3, borderTopColor: color }]} elevation={1}>
      <View style={[styles.statIcon, { backgroundColor: color + '18' }]}>
        <MaterialCommunityIcons name={icon as any} size={22} color={color} />
      </View>
      <Text variant="headlineSmall" style={[styles.statValue, { color: textColor }]}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </Text>
      <Text variant="labelSmall" style={{ color: subtextColor }}>{label}</Text>
    </Surface>
  );
}

function UsageBar({ label, used, limit, color, textColor, subtextColor }: {
  label: string; used: number; limit: number; color: string;
  textColor: string; subtextColor: string;
}) {
  const pct = limit > 0 ? Math.round((used / limit) * 100) : 0;
  return (
    <View style={styles.usageRow}>
      <View style={styles.usageHeader}>
        <Text variant="bodyMedium" style={{ color: textColor, fontWeight: '600' }}>{label}</Text>
        <Text variant="labelSmall" style={{ color: subtextColor }}>
          {used.toLocaleString()} / {limit.toLocaleString()} ({pct}%)
        </Text>
      </View>
      <ProgressBar progress={limit > 0 ? Math.min(used / limit, 1) : 0} color={color} style={styles.progressBar} />
    </View>
  );
}

export default function DashboardScreen() {
  const router = useRouter();
  const theme = useAppTheme();
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const org = user?.organization || '';

  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState<DateRange>('month');
  const [dashData, setDashData] = useState<DashboardData>({});
  const [contactGrowth, setContactGrowth] = useState<ContactGrowth>({});
  const [leadsData, setLeadsData] = useState<LeadsDashboard>({});
  const [taskStats, setTaskStats] = useState<TaskStats>({ total: 0, active: 0, completed: 0, overdue: 0, byPriority: {} });
  const [quoteStats, setQuoteStats] = useState<QuoteStats>({ total: 0, totalValue: 0, byStatus: {} });
  const [esigStats, setEsigStats] = useState<ESignatureStats>({ total: 0, signed: 0, pending: 0, expired: 0 });
  const [conversationData, setConversationData] = useState<ConversationDashboard>({});
  const [phoneCallStats, setPhoneCallStats] = useState<PhoneCallStats>({ total: 0, answered: 0, missed: 0, avgDuration: 0 });

  const fetchData = useCallback(async () => {
    if (!org) return;
    const { startDate, endDate } = getDateRange(dateRange);
    try {
      const [dashRes, growthRes, leadsRes] = await Promise.allSettled([
        axiosInstance.post(ENDPOINTS.GET_DASHBOARD_STATS, { organization: org, startDate, endDate }),
        axiosInstance.post(ENDPOINTS.GET_CONTACT_GROWTH, { organization: org, startDate, endDate }),
        axiosInstance.post(ENDPOINTS.GET_LEADS_DASHBOARD, { organization: org, startDate, endDate }),
      ]);
      if (dashRes.status === 'fulfilled') setDashData(dashRes.value.data || {});
      if (growthRes.status === 'fulfilled') setContactGrowth(growthRes.value.data || {});
      if (leadsRes.status === 'fulfilled') setLeadsData(leadsRes.value.data || {});

      const [tasksRes, quotesRes, esigRes, convRes, callsRes] = await Promise.allSettled([
        axiosInstance.post(ENDPOINTS.GET_TASKS, { organization: org }),
        axiosInstance.post(ENDPOINTS.GET_ALL_QUOTES, { organization: org }),
        axiosInstance.post(ENDPOINTS.GET_ESIGNATURE_DOCS, { organization: org }),
        axiosInstance.post(ENDPOINTS.GET_CONVERSATION_STATS, { organization: org, startDate, endDate }),
        axiosInstance.post(ENDPOINTS.GET_PHONE_CALLS, { organization: org, page: 1, pageSize: 1000 }),
      ]);

      if (tasksRes.status === 'fulfilled') {
        const tasks: any[] = Array.isArray(tasksRes.value.data) ? tasksRes.value.data : [];
        const now = new Date();
        const active = tasks.filter((tk) => tk.status !== 'Completed' && !tk.isCompleted).length;
        const completed = tasks.filter((tk) => tk.status === 'Completed' || tk.isCompleted).length;
        const overdue = tasks.filter((tk) => tk.status !== 'Completed' && !tk.isCompleted && tk.dueDate && new Date(tk.dueDate) < now).length;
        const byPriority: Record<string, number> = {};
        tasks.forEach((tk) => { const p = tk.priority || 'None'; byPriority[p] = (byPriority[p] || 0) + 1; });
        setTaskStats({ total: tasks.length, active, completed, overdue, byPriority });
      }

      if (quotesRes.status === 'fulfilled') {
        const quotes: any[] = Array.isArray(quotesRes.value.data) ? quotesRes.value.data : [];
        const totalValue = quotes.reduce((sum: number, q: any) => sum + (q.totalAmount || q.total || 0), 0);
        const byStatus: Record<string, number> = {};
        quotes.forEach((q: any) => { const s = q.status || 'Draft'; byStatus[s] = (byStatus[s] || 0) + 1; });
        setQuoteStats({ total: quotes.length, totalValue, byStatus });
      }

      if (esigRes.status === 'fulfilled') {
        const docs: any[] = Array.isArray(esigRes.value.data) ? esigRes.value.data : [];
        const signed = docs.filter((d: any) => d.status === 'Signed' || d.status === 'Completed').length;
        const pending = docs.filter((d: any) => d.status === 'Pending' || d.status === 'Sent').length;
        const expired = docs.filter((d: any) => d.status === 'Expired').length;
        setEsigStats({ total: docs.length, signed, pending, expired });
      }

      if (convRes.status === 'fulfilled') setConversationData(convRes.value.data || {});

      if (callsRes.status === 'fulfilled') {
        const callData = callsRes.value.data;
        const calls: any[] = Array.isArray(callData) ? callData : (callData?.items || callData?.data || []);
        const answered = calls.filter((c: any) => c.status === 'Answered' || c.status === 'Completed' || c.duration > 0).length;
        const missed = calls.filter((c: any) => c.status === 'Missed' || c.status === 'NoAnswer' || c.status === 'No Answer').length;
        const durations = calls.filter((c: any) => c.duration > 0).map((c: any) => c.duration);
        const avgDuration = durations.length > 0 ? Math.round(durations.reduce((a: number, b: number) => a + b, 0) / durations.length) : 0;
        setPhoneCallStats({ total: calls.length, answered, missed, avgDuration });
      }
    } catch {
      // error handled by empty state UI
    } finally {
      setLoading(false);
    }
  }, [org, dateRange]);

  useEffect(() => {
    setLoading(true);
    fetchData();
  }, [fetchData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  }, [fetchData]);

  const handleDateRange = useCallback((range: DateRange) => {
    if (range !== dateRange) setDateRange(range);
  }, [dateRange]);

  const msgs = dashData.messages || { total: 0, sent: 0, received: 0, delivered: 0, read: 0, failed: 0 };
  const msgMax = Math.max(msgs.sent, msgs.received, msgs.delivered, msgs.read, msgs.failed, 1);

  const stageEntries = Object.entries(leadsData.byStage || {});
  const maxStageCount = stageEntries.length > 0 ? Math.max(...stageEntries.map(([, c]) => c), 1) : 1;
  const funnelStages = [...stageEntries].sort(([, a], [, b]) => b - a);
  const maxFunnelCount = funnelStages.length > 0 ? funnelStages[0][1] : 1;

  const growthPositive = (contactGrowth.growthPercentage || 0) >= 0;

  const dateRangeOptions: { key: DateRange; label: string }[] = [
    { key: 'today', label: t('dashboard.filterToday') },
    { key: 'week', label: t('dashboard.filterThisWeek') },
    { key: 'month', label: t('dashboard.filterThisMonth') },
    { key: 'year', label: t('dashboard.filterThisYear') },
  ];

  const msgBars = [
    { label: t('dashboard.sent'), value: msgs.sent, color: BRAND },
    { label: t('dashboard.received'), value: msgs.received, color: '#6366f1' },
    { label: t('dashboard.delivered'), value: msgs.delivered, color: '#0ea5e9' },
    { label: t('dashboard.read'), value: msgs.read, color: '#10b981' },
    { label: t('dashboard.failed'), value: msgs.failed, color: '#ef4444' },
  ];

  const surfaceBg = theme.colors.surface;
  const textColor = theme.colors.onSurface;
  const subtextColor = theme.colors.onSurfaceVariant;

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Appbar.Header style={{ backgroundColor: BRAND }}>
        <Appbar.BackAction onPress={() => router.back()} color="#fff" />
        <Appbar.Content title={t('dashboard.title')} titleStyle={styles.headerTitle} />
      </Appbar.Header>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[BRAND]} />}
      >
        {/* Date Range Chips */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll} contentContainerStyle={styles.chipRow}>
          {dateRangeOptions.map((opt) => {
            const active = dateRange === opt.key;
            return (
              <Chip
                key={opt.key}
                selected={active}
                onPress={() => handleDateRange(opt.key)}
                style={[styles.chip, active && styles.chipActive]}
                textStyle={[styles.chipText, active && styles.chipTextActive]}
                showSelectedOverlay={false}
                showSelectedCheck={false}
              >
                {opt.label}
              </Chip>
            );
          })}
        </ScrollView>

        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={BRAND} />
          </View>
        ) : (
          <>
            {/* Stats Cards */}
            <View style={styles.statsGrid}>
              <StatCard icon="account-group" label={t('dashboard.totalContacts')} value={contactGrowth.totalContacts || 0} color={BRAND} surfaceBg={surfaceBg} textColor={textColor} subtextColor={subtextColor} />
              <StatCard icon="trending-up" label={t('dashboard.openLeads')} value={leadsData.openLeads ?? leadsData.totalLeads ?? 0} color="#f59e0b" surfaceBg={surfaceBg} textColor={textColor} subtextColor={subtextColor} />
              <StatCard icon="clipboard-check-outline" label={t('dashboard.activeTasks')} value={dashData.activeTasks || 0} color="#10b981" surfaceBg={surfaceBg} textColor={textColor} subtextColor={subtextColor} />
              <StatCard icon="message-text" label={t('dashboard.totalMessages')} value={msgs.total} color="#6366f1" surfaceBg={surfaceBg} textColor={textColor} subtextColor={subtextColor} />
            </View>

            {/* Contact Growth */}
            <Surface style={[styles.section, { backgroundColor: surfaceBg }]} elevation={1}>
              <View style={styles.sectionHeader}>
                <MaterialCommunityIcons name="account-arrow-up" size={20} color={BRAND} />
                <Text variant="titleMedium" style={[styles.sectionTitle, { color: textColor }]}>
                  {t('dashboard.contactGrowth')}
                </Text>
              </View>
              <Divider style={styles.sectionDivider} />
              <View style={styles.growthRow}>
                <View style={styles.growthItem}>
                  <Text variant="headlineSmall" style={{ color: BRAND, fontWeight: '800' }}>
                    {(contactGrowth.totalContacts || 0).toLocaleString()}
                  </Text>
                  <Text variant="labelSmall" style={{ color: subtextColor }}>{t('dashboard.totalContacts')}</Text>
                </View>
                <View style={styles.growthItem}>
                  <Text variant="headlineSmall" style={{ color: textColor, fontWeight: '700' }}>
                    {(contactGrowth.thisMonthCount || 0).toLocaleString()}
                  </Text>
                  <Text variant="labelSmall" style={{ color: subtextColor }}>{t('dashboard.thisMonth')}</Text>
                </View>
                <View style={styles.growthItem}>
                  <Text variant="headlineSmall" style={{ color: subtextColor, fontWeight: '700' }}>
                    {(contactGrowth.lastMonthCount || 0).toLocaleString()}
                  </Text>
                  <Text variant="labelSmall" style={{ color: subtextColor }}>{t('dashboard.lastMonth')}</Text>
                </View>
                <View style={[styles.growthBadge, { backgroundColor: growthPositive ? '#dcfce7' : '#fee2e2' }]}>
                  <MaterialCommunityIcons
                    name={growthPositive ? 'arrow-up' : 'arrow-down'}
                    size={16}
                    color={growthPositive ? '#10b981' : '#ef4444'}
                  />
                  <Text style={{ color: growthPositive ? '#10b981' : '#ef4444', fontWeight: '700', fontSize: 16 }}>
                    {Math.abs(contactGrowth.growthPercentage || 0).toFixed(1)}%
                  </Text>
                </View>
              </View>
            </Surface>

            {/* Message Stats */}
            <Surface style={[styles.section, { backgroundColor: surfaceBg }]} elevation={1}>
              <View style={styles.sectionHeader}>
                <MaterialCommunityIcons name="chart-bar" size={20} color="#6366f1" />
                <Text variant="titleMedium" style={[styles.sectionTitle, { color: textColor }]}>
                  {t('dashboard.messageStats')}
                </Text>
              </View>
              <Divider style={styles.sectionDivider} />
              <View style={styles.msgTotal}>
                <Text variant="headlineMedium" style={{ color: textColor, fontWeight: '800' }}>
                  {msgs.total.toLocaleString()}
                </Text>
                <Text variant="labelSmall" style={{ color: subtextColor }}>{t('dashboard.totalMessages')}</Text>
              </View>
              {msgBars.map((item) => (
                <View key={item.label} style={styles.msgBarRow}>
                  <View style={styles.msgBarHeader}>
                    <View style={styles.msgBarLabel}>
                      <View style={[styles.msgDot, { backgroundColor: item.color }]} />
                      <Text variant="bodyMedium" style={{ color: textColor }}>{item.label}</Text>
                    </View>
                    <Text variant="bodyMedium" style={{ color: item.color, fontWeight: '700' }}>
                      {item.value.toLocaleString()}
                    </Text>
                  </View>
                  <ProgressBar
                    progress={msgMax > 0 ? Math.min(item.value / msgMax, 1) : 0}
                    color={item.color}
                    style={styles.progressBar}
                  />
                </View>
              ))}
            </Surface>

            {/* AI & Pro Active Usage */}
            {(dashData.aiUsage || dashData.proActiveUsage) && (
              <Surface style={[styles.section, { backgroundColor: surfaceBg }]} elevation={1}>
                <View style={styles.sectionHeader}>
                  <MaterialCommunityIcons name="robot" size={20} color="#6366f1" />
                  <Text variant="titleMedium" style={[styles.sectionTitle, { color: textColor }]}>
                    {t('dashboard.aiProActiveUsage')}
                  </Text>
                </View>
                <Divider style={styles.sectionDivider} />
                {dashData.aiUsage && (
                  <UsageBar
                    label={t('dashboard.aiUsage')}
                    used={dashData.aiUsage.used}
                    limit={dashData.aiUsage.limit}
                    color="#6366f1"
                    textColor={textColor}
                    subtextColor={subtextColor}
                  />
                )}
                {dashData.proActiveUsage && (
                  <UsageBar
                    label={t('dashboard.proActiveUsage')}
                    used={dashData.proActiveUsage.used}
                    limit={dashData.proActiveUsage.limit}
                    color={BRAND}
                    textColor={textColor}
                    subtextColor={subtextColor}
                  />
                )}
              </Surface>
            )}

            {/* Leads Pipeline */}
            <Surface style={[styles.section, { backgroundColor: surfaceBg }]} elevation={1}>
              <View style={styles.sectionHeader}>
                <MaterialCommunityIcons name="filter-variant" size={20} color="#f59e0b" />
                <Text variant="titleMedium" style={[styles.sectionTitle, { color: textColor }]}>
                  {t('dashboard.leadsPipeline')}
                </Text>
              </View>
              <Divider style={styles.sectionDivider} />
              <View style={styles.pipelineSummary}>
                <View style={styles.pipelineStat}>
                  <View style={[styles.pipelineDot, { backgroundColor: BRAND }]} />
                  <Text variant="bodySmall" style={{ color: subtextColor, flex: 1 }}>{t('dashboard.totalLeads')}</Text>
                  <Text variant="titleMedium" style={{ color: BRAND, fontWeight: '700' }}>
                    {leadsData.totalLeads || 0}
                  </Text>
                </View>
                <View style={styles.pipelineStat}>
                  <View style={[styles.pipelineDot, { backgroundColor: '#3b82f6' }]} />
                  <Text variant="bodySmall" style={{ color: subtextColor, flex: 1 }}>{t('dashboard.pipelineValue')}</Text>
                  <Text variant="titleMedium" style={{ color: '#3b82f6', fontWeight: '700' }}>
                    ₪{(leadsData.pipelineValue || 0).toLocaleString()}
                  </Text>
                </View>
                <View style={styles.pipelineStat}>
                  <View style={[styles.pipelineDot, { backgroundColor: '#10b981' }]} />
                  <Text variant="bodySmall" style={{ color: subtextColor, flex: 1 }}>{t('dashboard.wonThisMonth')}</Text>
                  <Text variant="titleMedium" style={{ color: '#10b981', fontWeight: '700' }}>
                    {leadsData.wonThisMonth || 0}
                  </Text>
                </View>
                <View style={styles.pipelineStat}>
                  <View style={[styles.pipelineDot, { backgroundColor: '#ef4444' }]} />
                  <Text variant="bodySmall" style={{ color: subtextColor, flex: 1 }}>{t('dashboard.lostThisMonth')}</Text>
                  <Text variant="titleMedium" style={{ color: '#ef4444', fontWeight: '700' }}>
                    {leadsData.lostThisMonth || 0}
                  </Text>
                </View>
                <View style={styles.pipelineStat}>
                  <View style={[styles.pipelineDot, { backgroundColor: '#f59e0b' }]} />
                  <Text variant="bodySmall" style={{ color: subtextColor, flex: 1 }}>{t('dashboard.conversionRate')}</Text>
                  <Text variant="titleMedium" style={{ color: '#f59e0b', fontWeight: '700' }}>
                    {(leadsData.conversionRate || 0).toFixed(1)}%
                  </Text>
                </View>
              </View>

              {stageEntries.length > 0 && (
                <View style={styles.stageSection}>
                  <Divider style={styles.sectionDivider} />
                  <Text variant="labelMedium" style={[styles.stageHeading, { color: subtextColor }]}>
                    {t('dashboard.byStage')}
                  </Text>
                  {stageEntries.map(([stage, count], i) => (
                    <View key={stage} style={styles.stageBarRow}>
                      <View style={styles.stageBarHeader}>
                        <Text variant="bodyMedium" style={{ color: textColor, flex: 1 }} numberOfLines={1}>
                          {stage}
                        </Text>
                        <Text variant="bodyMedium" style={{ color: STAGE_COLORS[i % STAGE_COLORS.length], fontWeight: '700' }}>
                          {count}
                        </Text>
                      </View>
                      <ProgressBar
                        progress={maxStageCount > 0 ? count / maxStageCount : 0}
                        color={STAGE_COLORS[i % STAGE_COLORS.length]}
                        style={styles.progressBar}
                      />
                    </View>
                  ))}
                </View>
              )}
            </Surface>

            {/* Recent Leads */}
            {(leadsData.recentLeads?.length ?? 0) > 0 && (
              <Surface style={[styles.section, { backgroundColor: surfaceBg }]} elevation={1}>
                <View style={styles.sectionHeader}>
                  <MaterialCommunityIcons name="clock-outline" size={20} color={BRAND} />
                  <Text variant="titleMedium" style={[styles.sectionTitle, { color: textColor }]}>
                    {t('dashboard.recentLeads')}
                  </Text>
                </View>
                <Divider style={styles.sectionDivider} />
                {leadsData.recentLeads!.map((lead, i) => (
                  <View
                    key={lead.id || i}
                    style={[
                      styles.recentLeadRow,
                      i < leadsData.recentLeads!.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#e2e8f0' },
                    ]}
                  >
                    <View style={styles.recentLeadInfo}>
                      <Text variant="bodyMedium" style={{ color: textColor, fontWeight: '600' }} numberOfLines={1}>
                        {lead.title}
                      </Text>
                      <View style={styles.recentLeadMeta}>
                        <View style={[styles.stageBadge, { backgroundColor: BRAND + '15' }]}>
                          <Text variant="labelSmall" style={{ color: BRAND, fontWeight: '600' }}>{lead.stage}</Text>
                        </View>
                        {lead.contactName ? (
                          <Text variant="labelSmall" style={{ color: subtextColor }} numberOfLines={1}>
                            {lead.contactName}
                          </Text>
                        ) : null}
                      </View>
                    </View>
                    {lead.value > 0 && (
                      <Text variant="bodyMedium" style={{ color: BRAND, fontWeight: '700' }}>
                        ₪{lead.value.toLocaleString()}
                      </Text>
                    )}
                  </View>
                ))}
              </Surface>
            )}

            {/* Tasks Dashboard */}
            <Surface style={[styles.section, { backgroundColor: surfaceBg }]} elevation={1}>
              <View style={styles.sectionHeader}>
                <MaterialCommunityIcons name="clipboard-check-outline" size={20} color="#10b981" />
                <Text variant="titleMedium" style={[styles.sectionTitle, { color: textColor }]}>
                  {t('dashboard.tasksDashboard')}
                </Text>
              </View>
              <Divider style={styles.sectionDivider} />
              <View style={styles.widgetStatsRow}>
                <View style={styles.widgetStatItem}>
                  <Text variant="headlineSmall" style={{ color: textColor, fontWeight: '800' }}>{taskStats.total}</Text>
                  <Text variant="labelSmall" style={{ color: subtextColor }}>{t('dashboard.totalTasks')}</Text>
                </View>
                <View style={styles.widgetStatItem}>
                  <Text variant="headlineSmall" style={{ color: '#3b82f6', fontWeight: '800' }}>{taskStats.active}</Text>
                  <Text variant="labelSmall" style={{ color: subtextColor }}>{t('dashboard.active')}</Text>
                </View>
                <View style={styles.widgetStatItem}>
                  <Text variant="headlineSmall" style={{ color: '#10b981', fontWeight: '800' }}>{taskStats.completed}</Text>
                  <Text variant="labelSmall" style={{ color: subtextColor }}>{t('dashboard.completed')}</Text>
                </View>
                <View style={styles.widgetStatItem}>
                  <Text variant="headlineSmall" style={{ color: '#ef4444', fontWeight: '800' }}>{taskStats.overdue}</Text>
                  <Text variant="labelSmall" style={{ color: subtextColor }}>{t('dashboard.overdue')}</Text>
                </View>
              </View>
              {Object.keys(taskStats.byPriority).length > 0 && (
                <>
                  <Divider style={[styles.sectionDivider, { marginTop: spacing.sm }]} />
                  <Text variant="labelMedium" style={[styles.stageHeading, { color: subtextColor }]}>
                    {t('dashboard.byPriority')}
                  </Text>
                  {Object.entries(taskStats.byPriority).map(([priority, count]) => (
                    <View key={priority} style={styles.pipelineStat}>
                      <View style={[styles.pipelineDot, { backgroundColor: PRIORITY_COLORS[priority] || '#94a3b8' }]} />
                      <Text variant="bodySmall" style={{ color: subtextColor, flex: 1 }}>{priority}</Text>
                      <Text variant="titleMedium" style={{ color: PRIORITY_COLORS[priority] || '#94a3b8', fontWeight: '700' }}>
                        {count}
                      </Text>
                    </View>
                  ))}
                </>
              )}
            </Surface>

            {/* Quotes Dashboard */}
            <Surface style={[styles.section, { backgroundColor: surfaceBg }]} elevation={1}>
              <View style={styles.sectionHeader}>
                <MaterialCommunityIcons name="file-document-outline" size={20} color="#8b5cf6" />
                <Text variant="titleMedium" style={[styles.sectionTitle, { color: textColor }]}>
                  {t('dashboard.quotesDashboard')}
                </Text>
              </View>
              <Divider style={styles.sectionDivider} />
              <View style={styles.widgetStatsRow}>
                <View style={styles.widgetStatItem}>
                  <Text variant="headlineSmall" style={{ color: textColor, fontWeight: '800' }}>{quoteStats.total}</Text>
                  <Text variant="labelSmall" style={{ color: subtextColor }}>{t('dashboard.totalQuotes')}</Text>
                </View>
                <View style={styles.widgetStatItem}>
                  <Text variant="headlineSmall" style={{ color: '#8b5cf6', fontWeight: '800' }}>
                    ₪{quoteStats.totalValue.toLocaleString()}
                  </Text>
                  <Text variant="labelSmall" style={{ color: subtextColor }}>{t('dashboard.totalValue')}</Text>
                </View>
              </View>
              {Object.keys(quoteStats.byStatus).length > 0 && (
                <>
                  <Divider style={[styles.sectionDivider, { marginTop: spacing.md }]} />
                  <Text variant="labelMedium" style={[styles.stageHeading, { color: subtextColor }]}>
                    {t('dashboard.byStatus')}
                  </Text>
                  {Object.entries(quoteStats.byStatus).map(([status, count]) => (
                    <View key={status} style={styles.pipelineStat}>
                      <View style={[styles.pipelineDot, { backgroundColor: QUOTE_STATUS_COLORS[status] || '#94a3b8' }]} />
                      <Text variant="bodySmall" style={{ color: subtextColor, flex: 1 }}>{status}</Text>
                      <Text variant="titleMedium" style={{ color: QUOTE_STATUS_COLORS[status] || '#94a3b8', fontWeight: '700' }}>
                        {count}
                      </Text>
                    </View>
                  ))}
                </>
              )}
            </Surface>

            {/* E-Signature Dashboard */}
            <Surface style={[styles.section, { backgroundColor: surfaceBg }]} elevation={1}>
              <View style={styles.sectionHeader}>
                <MaterialCommunityIcons name="draw" size={20} color="#ec4899" />
                <Text variant="titleMedium" style={[styles.sectionTitle, { color: textColor }]}>
                  {t('dashboard.esignatureDashboard')}
                </Text>
              </View>
              <Divider style={styles.sectionDivider} />
              <View style={styles.widgetStatsRow}>
                <View style={styles.widgetStatItem}>
                  <Text variant="headlineSmall" style={{ color: textColor, fontWeight: '800' }}>{esigStats.total}</Text>
                  <Text variant="labelSmall" style={{ color: subtextColor }}>{t('dashboard.totalDocs')}</Text>
                </View>
                <View style={styles.widgetStatItem}>
                  <Text variant="headlineSmall" style={{ color: '#10b981', fontWeight: '800' }}>{esigStats.signed}</Text>
                  <Text variant="labelSmall" style={{ color: subtextColor }}>{t('dashboard.signed')}</Text>
                </View>
                <View style={styles.widgetStatItem}>
                  <Text variant="headlineSmall" style={{ color: '#f59e0b', fontWeight: '800' }}>{esigStats.pending}</Text>
                  <Text variant="labelSmall" style={{ color: subtextColor }}>{t('dashboard.pending')}</Text>
                </View>
                <View style={styles.widgetStatItem}>
                  <Text variant="headlineSmall" style={{ color: '#ef4444', fontWeight: '800' }}>{esigStats.expired}</Text>
                  <Text variant="labelSmall" style={{ color: subtextColor }}>{t('dashboard.expired')}</Text>
                </View>
              </View>
            </Surface>

            {/* Leads Funnel */}
            {funnelStages.length > 0 && (
              <Surface style={[styles.section, { backgroundColor: surfaceBg }]} elevation={1}>
                <View style={styles.sectionHeader}>
                  <MaterialCommunityIcons name="filter" size={20} color={BRAND} />
                  <Text variant="titleMedium" style={[styles.sectionTitle, { color: textColor }]}>
                    {t('dashboard.leadsFunnel')}
                  </Text>
                </View>
                <Divider style={styles.sectionDivider} />
                <View style={styles.funnelContainer}>
                  {funnelStages.map(([stage, count], i) => {
                    const widthPct = maxFunnelCount > 0 ? Math.max((count / maxFunnelCount) * 100, 20) : 20;
                    const color = STAGE_COLORS[i % STAGE_COLORS.length];
                    return (
                      <View key={stage} style={styles.funnelStep}>
                        <View style={[styles.funnelBar, { width: `${widthPct}%`, backgroundColor: color }]}>
                          <Text style={styles.funnelBarText}>{count}</Text>
                        </View>
                        <Text variant="bodySmall" style={{ color: subtextColor, marginTop: 2, textAlign: 'center' }}>
                          {stage}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              </Surface>
            )}

            {/* Conversation Stats */}
            <Surface style={[styles.section, { backgroundColor: surfaceBg }]} elevation={1}>
              <View style={styles.sectionHeader}>
                <MaterialCommunityIcons name="forum-outline" size={20} color="#0ea5e9" />
                <Text variant="titleMedium" style={[styles.sectionTitle, { color: textColor }]}>
                  {t('dashboard.conversationStats')}
                </Text>
              </View>
              <Divider style={styles.sectionDivider} />
              <View style={styles.widgetStatsRow}>
                <View style={styles.widgetStatItem}>
                  <Text variant="headlineSmall" style={{ color: textColor, fontWeight: '800' }}>
                    {(conversationData.totalConversations || 0).toLocaleString()}
                  </Text>
                  <Text variant="labelSmall" style={{ color: subtextColor }}>{t('dashboard.totalConversations')}</Text>
                </View>
                <View style={styles.widgetStatItem}>
                  <Text variant="headlineSmall" style={{ color: '#10b981', fontWeight: '800' }}>
                    {(conversationData.openConversations || 0).toLocaleString()}
                  </Text>
                  <Text variant="labelSmall" style={{ color: subtextColor }}>{t('dashboard.openConversations')}</Text>
                </View>
                <View style={styles.widgetStatItem}>
                  <Text variant="headlineSmall" style={{ color: '#6366f1', fontWeight: '800' }}>
                    {(conversationData.closedConversations || 0).toLocaleString()}
                  </Text>
                  <Text variant="labelSmall" style={{ color: subtextColor }}>{t('dashboard.closedConversations')}</Text>
                </View>
              </View>
              {conversationData.avgResponseTime != null && (
                <View style={[styles.pipelineStat, { marginTop: spacing.sm }]}>
                  <MaterialCommunityIcons name="clock-fast" size={18} color="#0ea5e9" />
                  <Text variant="bodySmall" style={{ color: subtextColor, flex: 1 }}>{t('dashboard.avgResponseTime')}</Text>
                  <Text variant="titleMedium" style={{ color: '#0ea5e9', fontWeight: '700' }}>
                    {formatDuration(conversationData.avgResponseTime)}
                  </Text>
                </View>
              )}
            </Surface>

            {/* Phone Calls Stats */}
            <Surface style={[styles.section, { backgroundColor: surfaceBg }]} elevation={1}>
              <View style={styles.sectionHeader}>
                <MaterialCommunityIcons name="phone" size={20} color="#3b82f6" />
                <Text variant="titleMedium" style={[styles.sectionTitle, { color: textColor }]}>
                  {t('dashboard.phoneCallStats')}
                </Text>
              </View>
              <Divider style={styles.sectionDivider} />
              <View style={styles.widgetStatsRow}>
                <View style={styles.widgetStatItem}>
                  <Text variant="headlineSmall" style={{ color: textColor, fontWeight: '800' }}>{phoneCallStats.total}</Text>
                  <Text variant="labelSmall" style={{ color: subtextColor }}>{t('dashboard.totalCalls')}</Text>
                </View>
                <View style={styles.widgetStatItem}>
                  <Text variant="headlineSmall" style={{ color: '#10b981', fontWeight: '800' }}>{phoneCallStats.answered}</Text>
                  <Text variant="labelSmall" style={{ color: subtextColor }}>{t('dashboard.answered')}</Text>
                </View>
                <View style={styles.widgetStatItem}>
                  <Text variant="headlineSmall" style={{ color: '#ef4444', fontWeight: '800' }}>{phoneCallStats.missed}</Text>
                  <Text variant="labelSmall" style={{ color: subtextColor }}>{t('dashboard.missed')}</Text>
                </View>
                <View style={styles.widgetStatItem}>
                  <Text variant="headlineSmall" style={{ color: '#3b82f6', fontWeight: '800' }}>
                    {formatDuration(phoneCallStats.avgDuration)}
                  </Text>
                  <Text variant="labelSmall" style={{ color: subtextColor }}>{t('dashboard.avgDuration')}</Text>
                </View>
              </View>
              {phoneCallStats.total > 0 && (
                <>
                  <Divider style={[styles.sectionDivider, { marginTop: spacing.md }]} />
                  <View style={styles.msgBarRow}>
                    <View style={styles.msgBarHeader}>
                      <View style={styles.msgBarLabel}>
                        <View style={[styles.msgDot, { backgroundColor: '#10b981' }]} />
                        <Text variant="bodyMedium" style={{ color: textColor }}>{t('dashboard.answered')}</Text>
                      </View>
                      <Text variant="bodyMedium" style={{ color: '#10b981', fontWeight: '700' }}>
                        {phoneCallStats.answered}
                      </Text>
                    </View>
                    <ProgressBar
                      progress={phoneCallStats.total > 0 ? phoneCallStats.answered / phoneCallStats.total : 0}
                      color="#10b981"
                      style={styles.progressBar}
                    />
                  </View>
                  <View style={styles.msgBarRow}>
                    <View style={styles.msgBarHeader}>
                      <View style={styles.msgBarLabel}>
                        <View style={[styles.msgDot, { backgroundColor: '#ef4444' }]} />
                        <Text variant="bodyMedium" style={{ color: textColor }}>{t('dashboard.missed')}</Text>
                      </View>
                      <Text variant="bodyMedium" style={{ color: '#ef4444', fontWeight: '700' }}>
                        {phoneCallStats.missed}
                      </Text>
                    </View>
                    <ProgressBar
                      progress={phoneCallStats.total > 0 ? phoneCallStats.missed / phoneCallStats.total : 0}
                      color="#ef4444"
                      style={styles.progressBar}
                    />
                  </View>
                </>
              )}
            </Surface>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerTitle: { color: '#fff', fontWeight: '700', fontSize: fontSize.xl },
  content: { padding: spacing.md, paddingBottom: spacing.xxl },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 80 },

  chipScroll: { marginBottom: spacing.md },
  chipRow: { gap: spacing.sm, paddingHorizontal: 2 },
  chip: { borderRadius: borderRadius.full, backgroundColor: '#e2e8f0' },
  chipActive: { backgroundColor: BRAND },
  chipText: { fontSize: fontSize.sm, color: '#475569' },
  chipTextActive: { color: '#fff' },

  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  statCard: { width: CARD_WIDTH, borderRadius: borderRadius.xl, padding: spacing.md, alignItems: 'center' },
  statIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm },
  statValue: { fontWeight: '800', marginBottom: 2 },

  section: { borderRadius: borderRadius.xl, padding: spacing.md, marginBottom: spacing.md },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  sectionTitle: { fontWeight: '700' },
  sectionDivider: { marginBottom: spacing.md },

  growthRow: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center' },
  growthItem: { alignItems: 'center' },
  growthBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.lg,
  },

  msgTotal: { alignItems: 'center', marginBottom: spacing.md },
  msgBarRow: { marginBottom: spacing.sm },
  msgBarHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.xs },
  msgBarLabel: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  msgDot: { width: 8, height: 8, borderRadius: 4 },

  usageRow: { marginBottom: spacing.md },
  usageHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.xs },
  progressBar: { height: 8, borderRadius: 4 },

  pipelineSummary: { gap: spacing.sm },
  pipelineStat: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  pipelineDot: { width: 10, height: 10, borderRadius: 5 },

  stageSection: { marginTop: spacing.sm },
  stageHeading: { fontWeight: '600', marginBottom: spacing.sm },
  stageBarRow: { marginBottom: spacing.sm },
  stageBarHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.xs },

  recentLeadRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm },
  recentLeadInfo: { flex: 1, marginRight: spacing.sm },
  recentLeadMeta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 4 },
  stageBadge: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: borderRadius.sm },

  widgetStatsRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-around', gap: spacing.sm, marginBottom: spacing.sm },
  widgetStatItem: { alignItems: 'center', minWidth: 70 },

  funnelContainer: { alignItems: 'center', gap: spacing.sm },
  funnelStep: { width: '100%', alignItems: 'center' },
  funnelBar: { height: 36, borderRadius: borderRadius.lg, alignItems: 'center', justifyContent: 'center', minWidth: 40 },
  funnelBarText: { color: '#fff', fontWeight: '700', fontSize: fontSize.sm },
});
