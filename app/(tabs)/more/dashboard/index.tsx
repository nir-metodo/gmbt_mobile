import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAppTheme } from '../../../../hooks/useAppTheme';
import { useRowDirection } from '../../../../hooks/useRowDirection';
import { usePersistedPeriod } from '../../../../hooks/usePersistedPeriod';
import ScreenHeader from '../../../../components/ScreenHeader';
import EmptyState from '../../../../components/EmptyState';
import { BRAND, ChipRow, fmtMoney, fmtNum, PeriodChips, ProgressBar, SectionCard, Skeleton } from '../../../../components/dashboard/ui';
import { Legend, MiniBars } from '../../../../components/dashboard/charts';
import { DashEntity, useDashboardScope } from '../../../../components/dashboard/useDashboardScope';
import {
  AiUsage,
  DrillEntity,
  fetchCasesHeadline,
  fetchContactsHeadline,
  fetchDrilldown,
  fetchLeadsHeadline,
  fetchMessagesHeadline,
  fetchOrdersHeadline,
  fetchPaymentsHeadline,
  fetchQuotesHeadline,
  fetchSlaChats,
  fetchTasksHeadline,
  fetchWhatsAppNumbers,
} from '../../../../services/api/dashboard';
import { PERIOD_LABEL_FALLBACK } from '../../../../utils/datePresets';

type Slot<T = any> = T | null | undefined; // undefined = loading, null = nothing to show

const ENTITY_STYLE: Record<DashEntity, { icon: string; color: string }> = {
  messages: { icon: 'message-text-outline', color: '#16a34a' },
  contacts: { icon: 'account-group-outline', color: '#2563eb' },
  leads: { icon: 'account-tie-outline', color: '#7c3aed' },
  cases: { icon: 'folder-open-outline', color: '#ea580c' },
  tasks: { icon: 'checkbox-marked-circle-outline', color: '#d97706' },
  orders: { icon: 'package-variant-closed', color: '#db2777' },
  quotes: { icon: 'file-document-outline', color: '#0891b2' },
  payments: { icon: 'credit-card-outline', color: '#0d9488' },
};

const DRILL_ENTITIES: DrillEntity[] = ['cases', 'leads', 'contacts', 'messages', 'tasks', 'orders'];

interface Stat {
  value: string | number;
  label: string;
  tone?: 'good' | 'bad';
}

function KpiCard({
  entity,
  title,
  value,
  suffix,
  stats,
  progress,
  onPress,
}: {
  entity: DashEntity;
  title: string;
  value: string;
  suffix?: string;
  stats?: Stat[];
  progress?: { pct: number } | null;
  onPress: () => void;
}) {
  const theme = useAppTheme();
  const st = ENTITY_STYLE[entity];
  const dir = useRowDirection();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={[styles.kpi, { backgroundColor: theme.colors.surface, borderColor: theme.colors.outlineVariant || '#e2e8f0' }]}
    >
      <View style={{ flexDirection: dir, alignItems: 'center', gap: 6 }}>
        <View style={[styles.kpiIcon, { backgroundColor: st.color + '1f' }]}>
          <MaterialCommunityIcons name={st.icon as any} size={16} color={st.color} />
        </View>
        <Text numberOfLines={1} style={{ flex: 1, fontSize: 13, fontWeight: '600', color: theme.colors.onSurfaceVariant }}>
          {title}
        </Text>
        <MaterialCommunityIcons name="chevron-left" size={16} color={theme.colors.onSurfaceVariant} />
      </View>
      <View style={{ flexDirection: dir, alignItems: 'baseline', gap: 4, marginTop: 8 }}>
        <Text style={{ fontSize: 28, fontWeight: '800', color: theme.colors.onSurface }}>{value}</Text>
        {suffix ? (
          <Text numberOfLines={1} style={{ fontSize: 12, color: theme.colors.onSurfaceVariant, flexShrink: 1 }}>
            {suffix}
          </Text>
        ) : null}
      </View>
      {progress ? (
        <View style={{ marginTop: 6 }}>
          <ProgressBar pct={progress.pct} color={st.color} />
        </View>
      ) : null}
      {stats && stats.length > 0 ? (
        <View style={{ flexDirection: dir, flexWrap: 'wrap', columnGap: 10, rowGap: 2, marginTop: 8 }}>
          {stats.slice(0, 3).map((s, i) => (
            <Text key={i} style={{ fontSize: 11, color: s.tone === 'bad' ? '#dc2626' : s.tone === 'good' ? '#16a34a' : theme.colors.onSurfaceVariant }}>
              <Text style={{ fontWeight: '700', color: s.tone === 'bad' ? '#dc2626' : s.tone === 'good' ? '#16a34a' : theme.colors.onSurface }}>{s.value}</Text> {s.label}
            </Text>
          ))}
        </View>
      ) : null}
    </Pressable>
  );
}

export default function DashboardScreen() {
  const { t } = useTranslation();
  const theme = useAppTheme();
  const router = useRouter();
  const dir = useRowDirection();
  const { scope, canEntity, can, isAdmin, org, uid } = useDashboardScope();
  const { period, setPeriod, range, ready } = usePersistedPeriod('gambot.period.dashboard');
  const isRanged = range.key !== 'all';

  const [data, setData] = useState<Record<string, Slot>>({});
  const [aiUsage, setAiUsage] = useState<AiUsage | null>(null);
  const [drill, setDrill] = useState<Partial<Record<DrillEntity, any>>>({});
  const [slaChats, setSlaChats] = useState<Slot<any[]>>(undefined);
  const [waNumbers, setWaNumbers] = useState<any[]>([]);
  const [numberId, setNumberId] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const cacheKey = `dashboard_v2_${org}_${isAdmin ? 'admin' : uid}`;
  const loadSeq = useRef(0);

  const put = useCallback((key: string, value: any) => setData((p) => ({ ...p, [key]: value })), []);

  // ── Headline cards (each loads independently, never blocks the rest) ───────────────────────────
  const loadHeadlines = useCallback((): Promise<any>[] => {
    if (!org) return [];
    const run = <T,>(entity: DashEntity, fn: () => Promise<T>, handler: (v: T) => void) => {
      if (!canEntity(entity)) {
        put(entity, null);
        return Promise.resolve();
      }
      return fn().then(handler).catch(() => put(entity, null));
    };
    return [
      run('messages', () => fetchMessagesHeadline(scope), (r) => {
        put('messages', r.messages);
        setAiUsage(r.aiUsage);
      }),
      run('contacts', () => fetchContactsHeadline(scope), (v) => put('contacts', v)),
      run('leads', () => fetchLeadsHeadline(scope), (v) => put('leads', v)),
      run('cases', () => fetchCasesHeadline(scope), (v) => put('cases', v)),
      run('tasks', () => fetchTasksHeadline(scope), (v) => put('tasks', v)),
      run('quotes', () => fetchQuotesHeadline(scope), (v) => put('quotes', v)),
      run('payments', () => fetchPaymentsHeadline(scope), (v) => put('payments', v)),
      run('orders', () => fetchOrdersHeadline(scope), (v) => put('orders', v)),
      can('chats')
        ? fetchSlaChats(scope).then(setSlaChats).catch(() => setSlaChats(null))
        : Promise.resolve(setSlaChats(null)),
    ];
  }, [org, scope, canEntity, can, put]);

  // ── Time-range aware breakdowns (the numbers that follow the period chips) ────────────────────
  const loadDrills = useCallback(
    (force: boolean): Promise<any>[] => {
      if (!org) return [];
      const seq = ++loadSeq.current;
      setDrill({});
      const numberActive = !!numberId;
      // All time: skip the heavy per-message aggregation, but still load the cheap cases/leads drill-downs
      // (their cards show open/closed/breached). A selected number also needs messages + contacts.
      const entities = isRanged ? DRILL_ENTITIES : numberActive ? (['cases', 'leads', 'contacts', 'messages'] as DrillEntity[]) : (['cases', 'leads'] as DrillEntity[]);
      return entities
        .filter((e) => canEntity(e as DashEntity))
        .map((entity) =>
          fetchDrilldown(
            { org, entity, dateFrom: range.from, dateTo: range.to, owners: [], uid, isAdmin: scope.isAdmin, fromNumberId: numberId || null },
            force,
          ).then((d) => {
            if (seq === loadSeq.current) setDrill((p) => ({ ...p, [entity]: d }));
          }),
        );
    },
    [org, isRanged, range.from, range.to, numberId, uid, scope.isAdmin, canEntity],
  );

  // Instant repaint from the last visit, then refresh in the background.
  useEffect(() => {
    if (!org) return;
    AsyncStorage.getItem(cacheKey)
      .then((raw) => {
        if (!raw) return;
        const c = JSON.parse(raw);
        const { aiUsage: cachedAi, ...rest } = c.data || {};
        setData((prev) => (Object.keys(prev).length ? prev : rest));
        if (cachedAi !== undefined) setAiUsage(cachedAi);
      })
      .catch(() => {});
    Promise.allSettled(loadHeadlines());
    fetchWhatsAppNumbers(org).then(setWaNumbers).catch(() => setWaNumbers([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org, cacheKey]);

  useEffect(() => {
    const loaded = Object.keys(data).length >= 8 && Object.values(data).every((v) => v !== undefined);
    if (!loaded) return;
    AsyncStorage.setItem(cacheKey, JSON.stringify({ data: { ...data, aiUsage }, ts: Date.now() })).catch(() => {});
  }, [data, aiUsage, cacheKey]);

  useEffect(() => {
    if (!ready) return;
    Promise.allSettled(loadDrills(false));
  }, [ready, loadDrills]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.allSettled([...loadHeadlines(), ...loadDrills(true)]);
    } finally {
      setRefreshing(false);
    }
  }, [loadHeadlines, loadDrills]);

  // ── Navigation ───────────────────────────────────────────────────────────────────────────────
  const openDetail = (entity: string, extra: Record<string, string> = {}) =>
    router.push({ pathname: '/(tabs)/more/dashboard/detail', params: { entity, number: numberId, ...extra } } as any);

  // ── Card values ──────────────────────────────────────────────────────────────────────────────
  const numberActive = !!numberId;
  const rangedValue = (entity: DrillEntity, base: number): string => {
    const useDrill = isRanged || (numberActive && (entity === 'messages' || entity === 'contacts'));
    if (!useDrill) return fmtNum(base);
    const d = drill[entity];
    if (d === undefined) return '…';
    if (entity === 'messages') return fmtNum(d.total ?? d.bots ?? 0);
    return fmtNum(d.created ?? 0);
  };
  const created = t('dashboard.createdSuffix', 'חדשים');

  const m = data.messages;
  const c = data.contacts;
  const l = data.leads;
  const cs = data.cases;
  const tk = data.tasks;
  const q = data.quotes;
  const p = data.payments;
  const o = data.orders;

  const cards: { key: DashEntity; node: React.ReactNode | null; loading: boolean }[] = [];

  {
    const md = drill.messages;
    const breach =
      (isRanged || numberActive) && md && md.msgSlaEnabled && (md.msgSlaConsidered || 0) > 0 && (md.msgSlaBreached || 0) > 0
        ? [{ value: fmtNum(md.msgSlaBreached), label: t('dashboard.slaBreaches', 'חריגות SLA'), tone: 'bad' as const }]
        : [];
    cards.push({
      key: 'messages',
      loading: m === undefined,
      node: m ? (
        <KpiCard
          entity="messages"
          title={m.scoped ? t('dashboard.myMessages30', 'ההודעות שלי (30 יום)') : t('dashboard.messages', 'הודעות')}
          value={rangedValue('messages', m.total || 0)}
          progress={!isRanged && !m.scoped && m.sent > 0 ? { pct: ((m.delivered || 0) / m.sent) * 100 } : null}
          stats={
            isRanged
              ? [
                  ...(md && typeof md.incoming === 'number' ? [{ value: fmtNum(md.incoming), label: t('dashboard.received', 'התקבלו') }] : []),
                  ...(md && typeof md.outgoing === 'number' ? [{ value: fmtNum(md.outgoing), label: t('dashboard.sent', 'נשלחו') }] : []),
                  ...breach,
                ]
              : [
                  { value: fmtNum(m.sent || 0), label: t('dashboard.sent', 'נשלחו') },
                  { value: fmtNum(m.received || 0), label: t('dashboard.received', 'התקבלו') },
                  ...breach,
                ]
          }
          onPress={() => openDetail('messages')}
        />
      ) : null,
    });
  }
  {
    const md = drill.messages;
    const contactsInTouch = isRanged && md && typeof md.activeContacts === 'number';
    cards.push({
      key: 'contacts',
      loading: c === undefined,
      node: c ? (
        <KpiCard
          entity="contacts"
          title={t('dashboard.contacts', 'אנשי קשר')}
          value={contactsInTouch ? fmtNum(md.activeContacts) : rangedValue('contacts', c.totalContacts || 0)}
          suffix={contactsInTouch ? t('dashboard.inTouch', 'בקשר') : undefined}
          stats={
            isRanged
              ? [
                  ...(drill.contacts && typeof drill.contacts.created === 'number'
                    ? [{ value: fmtNum(drill.contacts.created), label: t('dashboard.newlyCreated', 'חדשים'), tone: 'good' as const }]
                    : []),
                  ...(md && typeof md.inboundContacts === 'number' ? [{ value: fmtNum(md.inboundContacts), label: t('dashboard.wroteToUs', 'כתבו לנו') }] : []),
                ]
              : [
                  { value: `+${fmtNum(c.thisMonthCount || 0)}`, label: t('dashboard.thisMonth', 'החודש'), tone: 'good' as const },
                  ...(typeof c.growthPercentage === 'number' && c.growthPercentage !== 0
                    ? [{ value: `${c.growthPercentage > 0 ? '+' : ''}${c.growthPercentage}%`, label: t('dashboard.growth', 'צמיחה'), tone: (c.growthPercentage >= 0 ? 'good' : 'bad') as 'good' | 'bad' }]
                    : []),
                ]
          }
          onPress={() => openDetail('contacts')}
        />
      ) : null,
    });
  }
  {
    const ld = drill.leads;
    const openCount = ld && typeof ld.openTotal === 'number' ? ld.openTotal : l?.totalOpen || 0;
    const wonCount = ld && typeof ld.won === 'number' ? ld.won : l?.wonThisMonth || 0;
    cards.push({
      key: 'leads',
      loading: l === undefined,
      node: l ? (
        <KpiCard
          entity="leads"
          title={t('dashboard.leads', 'לידים')}
          value={rangedValue('leads', l.totalOpen || 0)}
          suffix={isRanged ? created : t('dashboard.open', 'פתוחים')}
          progress={!isRanged && l.conversionRate ? { pct: l.conversionRate } : null}
          stats={isRanged ? [] : [{ value: fmtNum(openCount), label: t('dashboard.open', 'פתוחים') }, { value: fmtNum(wonCount), label: t('dashboard.won', 'נסגרו'), tone: 'good' as const }]}
          onPress={() => openDetail('leads')}
        />
      ) : null,
    });
  }
  {
    const cd = drill.cases;
    cards.push({
      key: 'cases',
      loading: cs === undefined,
      node: cs ? (
        <KpiCard
          entity="cases"
          title={t('dashboard.cases', 'פניות')}
          value={rangedValue('cases', cs.total || 0)}
          suffix={isRanged ? created : undefined}
          progress={cd && typeof cd.resolutionRate === 'number' && cd.resolutionRate >= 0 ? { pct: cd.resolutionRate } : null}
          stats={
            cd
              ? [
                  ...(typeof cd.openTotal === 'number' ? [{ value: fmtNum(cd.openTotal), label: t('dashboard.open', 'פתוחות') }] : []),
                  ...(typeof cd.closed === 'number' ? [{ value: fmtNum(cd.closed), label: t('dashboard.closed', 'נסגרו'), tone: 'good' as const }] : []),
                  ...((cd.breachedOpen || 0) > 0 ? [{ value: fmtNum(cd.breachedOpen), label: t('dashboard.slaBreaches', 'חריגות SLA'), tone: 'bad' as const }] : []),
                ]
              : []
          }
          onPress={() => openDetail('cases')}
        />
      ) : null,
    });
  }
  cards.push({
    key: 'tasks',
    loading: tk === undefined,
    node: tk ? (
      <KpiCard
        entity="tasks"
        title={t('dashboard.tasks', 'משימות')}
        value={rangedValue('tasks', tk.active || 0)}
        suffix={isRanged ? created : t('dashboard.active', 'פעילות')}
        stats={
          isRanged
            ? []
            : [
                ...((tk.overdueTasks || 0) > 0 ? [{ value: fmtNum(tk.overdueTasks), label: t('dashboard.overdue', 'באיחור'), tone: 'bad' as const }] : []),
                { value: fmtNum(tk.dueToday || 0), label: t('dashboard.today', 'היום') },
                { value: fmtNum(tk.inProgress || 0), label: t('dashboard.inProgress', 'בטיפול') },
              ]
        }
        onPress={() => openDetail('tasks')}
      />
    ) : null,
  });
  cards.push({
    key: 'orders',
    loading: o === undefined,
    node: o ? (
      <KpiCard
        entity="orders"
        title={t('dashboard.orders', 'הזמנות')}
        value={rangedValue('orders', o.count || 0)}
        suffix={isRanged ? created : undefined}
        stats={
          isRanged
            ? []
            : [
                ...(o.revenue ? [{ value: fmtMoney(o.revenue), label: t('dashboard.revenue30', 'הכנסות (30 יום)') }] : []),
                ...(o.active ? [{ value: fmtNum(o.active), label: t('dashboard.active', 'פעילות'), tone: 'good' as const }] : []),
              ]
        }
        onPress={() => openDetail('orders')}
      />
    ) : null,
  });
  cards.push({
    key: 'quotes',
    loading: q === undefined,
    node: q ? (
      <KpiCard
        entity="quotes"
        title={t('dashboard.quotes', 'הצעות מחיר')}
        value={fmtNum(q.count || 0)}
        progress={q.count > 0 ? { pct: ((q.approved || 0) / q.count) * 100 } : null}
        stats={[
          ...(q.value ? [{ value: fmtMoney(q.value), label: t('dashboard.totalValue', 'שווי כולל') }] : []),
          { value: fmtNum(q.approved || 0), label: t('dashboard.approved', 'אושרו'), tone: 'good' as const },
        ]}
        onPress={() => router.push('/(tabs)/more/quotes' as any)}
      />
    ) : null,
  });
  cards.push({
    key: 'payments',
    loading: p === undefined,
    node: p ? (
      <KpiCard
        entity="payments"
        title={t('dashboard.payments', 'תשלומים')}
        value={fmtMoney(p.paidAmount)}
        stats={[
          { value: fmtNum(p.paid || 0), label: t('dashboard.paid', 'שולמו'), tone: 'good' as const },
          ...((p.pending || 0) > 0 ? [{ value: fmtNum(p.pending), label: t('dashboard.pending', 'ממתינים') }] : []),
        ]}
        onPress={() => router.push('/(tabs)/more/transactions' as any)}
      />
    ) : null,
  });

  const visibleCards = cards.filter((x) => x.node || x.loading);
  const allLoaded = cards.every((x) => !x.loading) && slaChats !== undefined;
  const nothing = allLoaded && visibleCards.length === 0;

  // ── Needs attention: only non-zero items (web renderAttention) ─────────────────────────────
  const attention = useMemo(() => {
    const items: { key: string; tone: 'bad' | 'warn'; icon: string; count: number; label: string; onPress: () => void }[] = [];
    if (Array.isArray(slaChats) && slaChats.length > 0)
      items.push({ key: 'sla', tone: 'bad', icon: 'clock-alert-outline', count: slaChats.length, label: t('dashboard.chatsWaiting', 'שיחות ממתינות מעבר ל-SLA'), onPress: () => openDetail('sla') });
    if ((tk?.overdueTasks || 0) > 0)
      items.push({ key: 'overdue', tone: 'bad', icon: 'alert-circle-outline', count: tk.overdueTasks, label: t('dashboard.overdueTasks', 'משימות באיחור'), onPress: () => openDetail('tasks') });
    if ((drill.cases?.breachedOpen || 0) > 0)
      items.push({ key: 'cases', tone: 'bad', icon: 'folder-alert-outline', count: drill.cases.breachedOpen, label: t('dashboard.casesBreaching', 'פניות חורגות מ-SLA'), onPress: () => openDetail('cases', { tab: 'breaches' }) });
    if ((tk?.dueToday || 0) > 0)
      items.push({ key: 'today', tone: 'warn', icon: 'calendar-today', count: tk.dueToday, label: t('dashboard.tasksDueToday', 'משימות להיום'), onPress: () => openDetail('tasks') });
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slaChats, tk, drill.cases, numberId]);
  const attentionLoaded = tk !== undefined && slaChats !== undefined;

  // ── Messages chart ───────────────────────────────────────────────────────────────────────────
  const chart = useMemo(() => {
    if (!canEntity('messages') || !m) return null;
    if (isRanged) {
      const md = drill.messages;
      if (!md || !range.from || !range.to) return null;
      if (range.from === range.to) {
        const h = Array.isArray(md.byHour) ? md.byHour : [];
        return h.map((x: any) => ({ label: String(x.hour), a: x.incoming || 0, b: x.outgoing || 0 }));
      }
      const byDay: Record<string, any> = {};
      (Array.isArray(md.byDay) ? md.byDay : []).forEach((x: any) => {
        byDay[x.date] = x;
      });
      const out: { label: string; a: number; b: number }[] = [];
      const d = new Date(`${range.from}T12:00:00`);
      const end = new Date(`${range.to}T12:00:00`);
      for (let guard = 0; d <= end && guard < 93; guard++) {
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const x = byDay[key] || {};
        out.push({ label: `${d.getDate()}/${d.getMonth() + 1}`, a: x.incoming || 0, b: x.outgoing || 0 });
        d.setDate(d.getDate() + 1);
      }
      return out;
    }
    const rows = Array.isArray(m.monthly) ? m.monthly : [];
    return rows.map((x: any) => ({ label: String(x.month || '').split(' ')[0], a: x.received || 0, b: x.sent || 0 }));
  }, [m, drill.messages, isRanged, range.from, range.to, canEntity]);
  const chartHasData = !!chart && chart.some((x: any) => x.a + x.b > 0);

  // ── Leads by stage ───────────────────────────────────────────────────────────────────────────
  const leadStages: { stageName: string; count: number }[] = (drill.leads?.byStage || l?.byStage || []).filter((s: any) => (s.count || 0) > 0);

  const numberLabel = (n: any) => {
    const id = n.PhoneNumberId || n.phoneNumberId;
    return n.Label || n.label || n.DisplayNumber || n.displayNumber || id;
  };
  const numberOptions = useMemo(
    () => [
      { key: '', label: t('dashboard.allNumbers', 'כל המספרים'), icon: 'whatsapp' },
      ...waNumbers.map((n) => ({ key: n.PhoneNumberId || n.phoneNumberId || '', label: String(numberLabel(n)), icon: 'whatsapp' })).filter((x) => x.key),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [waNumbers, t],
  );

  const periodTitle = t(`dashboard.period.${period}`, PERIOD_LABEL_FALLBACK[period]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <ScreenHeader
        title={t('dashboard.title', 'דשבורד')}
        subtitle={isAdmin ? t('dashboard.orgView', 'תמונת מצב ארגונית') : t('dashboard.myView', 'הדשבורד שלי')}
        onBack={() => router.back()}
      />
      <PeriodChips value={period} onChange={setPeriod} />
      {waNumbers.length > 1 ? <ChipRow options={numberOptions} value={numberId} onChange={setNumberId} /> : null}

      <ScrollView
        contentContainerStyle={{ paddingBottom: 32, paddingTop: 4 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[BRAND]} tintColor={BRAND} />}
      >
        {aiUsage ? <AiUsageBanner usage={aiUsage} /> : null}

        {/* Needs attention */}
        {attentionLoaded && (attention.length > 0 || visibleCards.length > 0) ? (
          <SectionCard title={t('dashboard.needsAttention', 'דורש טיפול')} icon="bell-alert-outline" color={attention.length ? '#dc2626' : '#16a34a'}>
            {attention.length === 0 ? (
              <View style={{ flexDirection: dir, alignItems: 'center', gap: 6 }}>
                <MaterialCommunityIcons name="check-circle-outline" size={18} color="#16a34a" />
                <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 13, flex: 1 }}>{t('dashboard.allClear', 'הכול תקין - אין חריגות או איחורים')}</Text>
              </View>
            ) : (
              attention.map((it) => (
                <Pressable key={it.key} onPress={it.onPress} style={[styles.attnRow, { flexDirection: dir, backgroundColor: it.tone === 'bad' ? '#fef2f2' : '#fffbeb' }]}>
                  <MaterialCommunityIcons name={it.icon as any} size={20} color={it.tone === 'bad' ? '#dc2626' : '#d97706'} />
                  <Text style={{ flex: 1, fontSize: 13, color: '#1e293b' }}>{it.label}</Text>
                  <Text style={{ fontSize: 16, fontWeight: '800', color: it.tone === 'bad' ? '#dc2626' : '#d97706' }}>{fmtNum(it.count)}</Text>
                  <MaterialCommunityIcons name="chevron-left" size={18} color="#94a3b8" />
                </Pressable>
              ))
            )}
          </SectionCard>
        ) : !attentionLoaded ? (
          <Skeleton height={64} style={{ marginHorizontal: 12, marginBottom: 12 }} />
        ) : null}

        {nothing ? (
          <EmptyState icon="chart-box-outline" title={t('dashboard.emptyTitle', 'עדיין אין נתונים')} description={t('dashboard.emptyDesc', 'הנתונים יופיעו כאן ברגע שתתחילו לעבוד')} />
        ) : (
          <View style={[styles.grid, { flexDirection: dir }]}>
            {visibleCards.map((x) => (
              <View key={x.key} style={styles.gridCell}>
                {x.node || <Skeleton height={118} />}
              </View>
            ))}
          </View>
        )}

        {/* Messages trend */}
        {chart && chartHasData ? (
          <SectionCard
            title={`${t('dashboard.messages', 'הודעות')} · ${isRanged ? periodTitle : t('dashboard.last6Months', '6 חודשים אחרונים')}`}
            icon="chart-bar"
            color="#16a34a"
            onPress={() => openDetail('messages')}
          >
            <MiniBars data={chart} colorA="#2e6155" colorB="#93c5fd" />
            <Legend items={[{ color: '#2e6155', label: t('dashboard.received', 'התקבלו') }, { color: '#93c5fd', label: t('dashboard.sent', 'נשלחו') }]} />
          </SectionCard>
        ) : null}

        {/* Leads by stage */}
        {l && leadStages.length > 0 ? (
          <SectionCard title={t('dashboard.leadsByStage', 'לידים לפי שלב')} icon="filter-variant" color="#7c3aed" onPress={() => openDetail('leads')}>
            {(() => {
              const max = Math.max(1, ...leadStages.map((s) => s.count));
              return leadStages.slice(0, 6).map((s) => (
                <View key={s.stageName} style={{ marginBottom: 8 }}>
                  <View style={{ flexDirection: dir, justifyContent: 'space-between', marginBottom: 2 }}>
                    <Text numberOfLines={1} style={{ flex: 1, fontSize: 13, color: theme.colors.onSurface }}>
                      {s.stageName}
                    </Text>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: theme.colors.onSurface }}>{fmtNum(s.count)}</Text>
                  </View>
                  <ProgressBar pct={(s.count / max) * 100} color="#7c3aed" />
                </View>
              ));
            })()}
          </SectionCard>
        ) : null}
      </ScrollView>
    </View>
  );
}

function AiUsageBanner({ usage }: { usage: AiUsage }) {
  const { t } = useTranslation();
  const theme = useAppTheme();
  const dir = useRowDirection();
  const used = Math.max(0, Number(usage.used) || 0);
  const limit = usage.limit;
  const pct = Math.min(100, Math.round((used / limit) * 100));
  const over = used > limit;
  const color = over ? '#dc2626' : pct >= 90 ? '#d97706' : BRAND;
  return (
    <SectionCard>
      <View style={{ flexDirection: dir, justifyContent: 'space-between', marginBottom: 6, alignItems: 'center' }}>
        <View style={{ flexDirection: dir, alignItems: 'center', gap: 6 }}>
          <MaterialCommunityIcons name="robot-outline" size={18} color={color} />
          <Text style={{ fontSize: 13, fontWeight: '700', color: theme.colors.onSurface }}>{t('dashboard.aiCredits', 'קרדיטי AI החודש')}</Text>
        </View>
        <Text style={{ fontSize: 13, fontWeight: '800', color }}>
          {fmtNum(used)} / {fmtNum(limit)}
        </Text>
      </View>
      <ProgressBar pct={pct} color={color} />
      {over ? <Text style={{ fontSize: 11, color: '#dc2626', marginTop: 4 }}>{t('dashboard.aiOverQuota', 'חריגה מהמכסה - כל 500 קרדיטים נוספים = ₪39')}</Text> : null}
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  grid: { flexWrap: 'wrap', paddingHorizontal: 12, gap: 10, marginBottom: 12 },
  gridCell: { width: '48%', flexGrow: 1 },
  kpi: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, padding: 12, minHeight: 118 },
  kpiIcon: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  attnRow: { alignItems: 'center', gap: 10, padding: 10, borderRadius: 10, marginBottom: 6 },
});
