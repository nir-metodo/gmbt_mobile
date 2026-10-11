import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Menu, Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../../../hooks/useAppTheme';
import { useRowDirection } from '../../../../hooks/useRowDirection';
import { usePersistedPeriod } from '../../../../hooks/usePersistedPeriod';
import ScreenHeader from '../../../../components/ScreenHeader';
import { BRAND, ChipRow, fmtMoney, fmtNum, PeriodChips, SectionCard, Skeleton, StatTile } from '../../../../components/dashboard/ui';
import { Legend, MiniBars, SlaGauge } from '../../../../components/dashboard/charts';
import { ExpandableBars, RecordItem, RecordList } from '../../../../components/dashboard/records';
import { useDashboardScope } from '../../../../components/dashboard/useDashboardScope';
import { DrillEntity, fetchDrilldown, fetchOrgUsers, fetchSlaChats, peekDrilldown } from '../../../../services/api/dashboard';
import { lastNDaysRange } from '../../../../utils/datePresets';
import { formatWaiting } from '../../../../utils/messageSla';

const TITLES: Record<string, [string, string, string]> = {
  messages: ['dashboard.messages', 'הודעות', 'message-text-outline'],
  contacts: ['dashboard.contacts', 'אנשי קשר', 'account-group-outline'],
  leads: ['dashboard.leads', 'לידים', 'account-tie-outline'],
  cases: ['dashboard.cases', 'פניות', 'folder-open-outline'],
  tasks: ['dashboard.tasks', 'משימות', 'checkbox-marked-circle-outline'],
  orders: ['dashboard.orders', 'הזמנות', 'package-variant-closed'],
  sla: ['dashboard.chatsWaiting', 'שיחות ממתינות מעבר ל-SLA', 'clock-alert-outline'],
};

const fmtDate = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getFullYear()).slice(2)}`;
};
const fmtDateTime = (iso?: string) => {
  const d = iso ? new Date(iso) : null;
  if (!d || isNaN(d.getTime())) return '';
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export default function DashboardDetailScreen() {
  const { t, i18n } = useTranslation();
  // Case stage names come from the org pipeline; default orgs have English names ("New") or the raw id
  // ("new"). Show those in Hebrew, like the web Cases board / dashboard.
  const heLang = (i18n.language || 'he').startsWith('he');
  const stageLabel = (name?: string) => {
    if (!heLang || !name) return name;
    const map: Record<string, string> = {
      new: 'חדש', open: 'פתוח', 'in progress': 'בטיפול', 'waiting for customer': 'ממתין ללקוח', pending: 'ממתין',
      escalated: 'הועבר לטיפול', 'on hold': 'בהמתנה', resolved: 'טופל', closed: 'סגור',
    };
    return map[name.trim().toLowerCase().replace(/[_-]+/g, ' ')] || name;
  };
  // Second line of a case row: the customer (unless it's just the subject again) · the owner.
  const caseSecondary = (c: any, fallbackOwner: string) =>
    [c.contactName && c.contactName !== c.subject ? c.contactName : '', c.ownerName || fallbackOwner]
      .filter(Boolean)
      .join(' · ');
  const theme = useAppTheme();
  const router = useRouter();
  const dir = useRowDirection();
  const params = useLocalSearchParams<{ entity?: string; number?: string; tab?: string }>();
  const entity = (params.entity as string) || 'cases';
  const numberId = (params.number as string) || '';
  const { scope, isAdmin, org, uid } = useDashboardScope();
  const { period, setPeriod, range, ready } = usePersistedPeriod('gambot.period.dashboard');
  const isRanged = range.key !== 'all';
  const isSla = entity === 'sla';
  const [titleKey, titleFallback, titleIcon] = TITLES[entity] || TITLES.cases;
  const he = (i18n.language || 'he').startsWith('he');

  const [d, setD] = useState<any>(undefined); // undefined = loading
  const [refreshing, setRefreshing] = useState(false);
  const [owner, setOwner] = useState<{ id: string; name: string } | null>(null);
  const [users, setUsers] = useState<{ id: string; name: string }[]>([]);
  const [ownerMenu, setOwnerMenu] = useState(false);
  const [caseTab, setCaseTab] = useState<'stage' | 'users' | 'breaches' | 'aging'>((params.tab as any) || 'stage');

  // "All time" + messages: show the last 30 days (the filter itself stays on "All time").
  const effective = useMemo(() => {
    if (entity === 'messages' && !isRanged) return { ...lastNDaysRange(30), isLast30: true };
    return { from: range.from, to: range.to, isLast30: false };
  }, [entity, isRanged, range.from, range.to]);

  useEffect(() => {
    if (isAdmin && !isSla && org) fetchOrgUsers(org).then(setUsers).catch(() => setUsers([]));
  }, [isAdmin, isSla, org]);

  const load = useCallback(
    async (force: boolean) => {
      if (!org) return;
      if (isSla) {
        setD(await fetchSlaChats(scope).catch(() => []));
        return;
      }
      const p = {
        org,
        entity: entity as DrillEntity,
        dateFrom: effective.from,
        dateTo: effective.to,
        owners: owner ? [owner.id] : [],
        uid,
        isAdmin: scope.isAdmin,
        fromNumberId: numberId || null,
      };
      if (!force) {
        const hit = peekDrilldown(p);
        if (hit !== undefined) {
          setD(hit);
          return;
        }
      }
      setD(undefined);
      setD(await fetchDrilldown(p, force));
    },
    [org, isSla, entity, effective.from, effective.to, owner, uid, scope, numberId],
  );

  useEffect(() => {
    if (ready) load(false);
  }, [ready, load]);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await load(true);
    } finally {
      setRefreshing(false);
    }
  };

  // ── navigation helpers ───────────────────────────────────────────────────────────────────────
  const openCase = (id: string) => router.push({ pathname: '/(tabs)/more/cases/[id]', params: { id } } as any);
  const openLead = (id: string) => router.push({ pathname: '/(tabs)/leads/[id]', params: { id } } as any);
  const openOrder = (id: string) => router.push({ pathname: '/(tabs)/more/orders/[id]', params: { id } } as any);
  const openChat = (phoneNumber: string) => router.push({ pathname: '/(tabs)/chats/[phoneNumber]', params: { phoneNumber } } as any);

  const unassigned = t('dashboard.unassigned', 'ללא בעלים');
  const loading = d === undefined;

  const stats = (items: { label: string; value: string | number; tone?: 'good' | 'bad' }[]) => (
    <View style={[styles.tiles, { flexDirection: dir }]}>
      {items.map((s, i) => (
        <StatTile key={i} label={s.label} value={s.value} color={s.tone === 'good' ? '#16a34a' : s.tone === 'bad' ? '#dc2626' : undefined} />
      ))}
    </View>
  );

  const subtitle = (text: string) => (
    <Text style={{ fontSize: 13, fontWeight: '700', color: theme.colors.onSurfaceVariant, marginTop: 14, marginBottom: 8 }}>{text}</Text>
  );

  // ── Entity bodies (same breakdowns as the web drill-down) ─────────────────────────────────────
  const renderBody = () => {
    if (isSla) {
      const list: any[] = Array.isArray(d) ? d : [];
      const rows: RecordItem[] = list.slice(0, 100).map((c, i) => ({
        key: c.contactId || String(i),
        primary: c.contactName || c.phoneNumber || '-',
        secondary: `${c.lastMessage || ''}`.slice(0, 80),
        tag: formatWaiting(Math.round((c.hoursWaiting || 0) * 60), he),
        tone: 'bad',
        meta: c.ownerName || unassigned,
        onPress: () => openChat(c.phoneNumber || c.contactId),
      }));
      return (
        <SectionCard>
          <RecordList rows={rows} limit={20} empty={t('dashboard.noWaitingChats', 'אין שיחות שממתינות')} />
        </SectionCard>
      );
    }

    if (entity === 'cases') {
      const caseRow = (c: any): RecordItem => ({
        key: c.caseId,
        primary: c.subject || c.contactName || t('dashboard.case', 'פנייה'),
        secondary: caseSecondary(c, unassigned),
        tag: c.breached ? t('dashboard.slaBreach', 'חריגת SLA') : stageLabel(c.stageName),
        tone: c.breached ? 'bad' : c.open ? '' : 'good',
        meta: fmtDate(c.createdOn),
        onPress: () => openCase(c.caseId),
      });
      const caseRows = (pred: (c: any) => boolean) => (d.items || []).filter(pred).map(caseRow);
      const ageDays = (c: any) => (c.createdOn ? (Date.now() - new Date(c.createdOn).getTime()) / 86400000 : 0);
      const breachType = (bt: string) =>
        ({ response: t('dashboard.breachResponse', 'תגובה'), resolution: t('dashboard.breachResolution', 'פתרון'), both: t('dashboard.breachBoth', 'תגובה + פתרון'), stage: t('dashboard.breachStage', 'שלב') } as any)[bt] || bt;
      const tabs = [
        { key: 'stage' as const, label: t('dashboard.byStage', 'לפי שלב') },
        ...(isAdmin ? [{ key: 'users' as const, label: t('dashboard.byUser', 'לפי משתמש') }] : []),
        { key: 'breaches' as const, label: `${t('dashboard.breaches', 'חריגות')} (${fmtNum(d.breachedOpen)})` },
        { key: 'aging' as const, label: t('dashboard.aging', 'גיל פניות') },
      ];
      return (
        <>
          {stats([
            { label: t('dashboard.created', 'נוצרו'), value: fmtNum(d.created), tone: 'good' },
            { label: t('dashboard.closed', 'נסגרו'), value: fmtNum(d.closed) },
            { label: t('dashboard.openTotal', 'פתוחות (סה״כ)'), value: fmtNum(d.openTotal) },
            { label: t('dashboard.slaBreachesOpen', 'חריגות SLA (פתוחות)'), value: fmtNum(d.breachedOpen), tone: (d.breachedOpen || 0) > 0 ? 'bad' : undefined },
            ...(typeof d.resolutionRate === 'number' && d.resolutionRate >= 0
              ? [{ label: t('dashboard.resolutionRate', 'שיעור פתרון'), value: `${fmtNum(d.resolutionRate)}%`, tone: (d.resolutionRate >= 70 ? 'good' : d.resolutionRate < 40 ? 'bad' : undefined) as any }]
              : []),
          ])}
          {d.slaEnabled && (d.slaCompliancePct ?? -1) >= 0 ? (
            <SectionCard title={t('dashboard.slaCompliance', 'עמידה ב-SLA')} icon="shield-check-outline" color="#ea580c">
              <SlaGauge pct={d.slaCompliancePct} met={d.slaMetCreated} breached={d.slaBreachedCreated} />
            </SectionCard>
          ) : null}
          <ChipRow options={tabs} value={caseTab} onChange={setCaseTab} />
          <SectionCard>
            {caseTab === 'stage' ? (
              <>
                <ExpandableBars
                  items={(d.openByStage || []).map((s: any) => ({ label: s.stageName, count: s.count, rows: caseRows((c) => c.open && c.stageName === s.stageName) }))}
                  empty={t('dashboard.noOpenCases', 'אין פניות פתוחות')}
                />
                {(d.closedByStage || []).length > 0 ? (
                  <>
                    {subtitle(t('dashboard.closedInRange', 'נסגרו בתקופה'))}
                    <ExpandableBars items={(d.closedByStage || []).map((s: any) => ({ label: stageLabel(s.stageName), count: s.count, rows: caseRows((c) => !c.open && c.stageName === s.stageName), color: '#16a34a' }))} />
                  </>
                ) : null}
                {typeof d.avgCloseHours === 'number' && d.avgCloseHours >= 0 ? (
                  <Text style={{ fontSize: 12, color: theme.colors.onSurfaceVariant, marginTop: 4 }}>
                    {t('dashboard.avgClose', 'זמן סגירה ממוצע')}: {d.avgCloseHours >= 48 ? `${(d.avgCloseHours / 24).toFixed(1)} ${t('dashboard.days', 'ימים')}` : `${d.avgCloseHours} ${t('dashboard.hoursShort', "שע'")}`}
                  </Text>
                ) : null}
              </>
            ) : null}
            {caseTab === 'users' && isAdmin ? (
              (d.byOwner || []).length === 0 ? (
                <Text style={{ color: theme.colors.onSurfaceVariant }}>{t('dashboard.noData', 'אין נתונים')}</Text>
              ) : (
                (d.byOwner || []).map((o: any, i: number) => (
                  <View key={o.userId || o.name || i} style={[styles.userRow, { flexDirection: dir, borderBottomColor: theme.colors.outlineVariant || '#e2e8f0' }]}>
                    <Text numberOfLines={1} style={{ flex: 1, fontWeight: '600', color: theme.colors.onSurface }}>
                      {o.name || unassigned}
                    </Text>
                    <Text style={styles.userNum}>{fmtNum(o.open)}</Text>
                    <Text style={styles.userNum}>{fmtNum(o.created)}</Text>
                    <Text style={styles.userNum}>{fmtNum(o.closed)}</Text>
                    <Text style={[styles.userNum, o.breached > 0 && { color: '#dc2626', fontWeight: '700' }]}>{fmtNum(o.breached)}</Text>
                  </View>
                ))
              )
            ) : null}
            {caseTab === 'users' && isAdmin && (d.byOwner || []).length > 0 ? (
              <Text style={{ fontSize: 11, color: theme.colors.onSurfaceVariant, marginTop: 6 }}>
                {t('dashboard.userColsHint', 'פתוחות · נוצרו · נסגרו · חריגות')}
              </Text>
            ) : null}
            {caseTab === 'breaches' ? (
              (d.breachedOpen || 0) > 0 ? (
                <>
                  {(d.breachedByOwner || []).length > 0 && isAdmin ? (
                    <>
                      {subtitle(t('dashboard.breachesByUser', 'חריגות פתוחות לפי משתמש'))}
                      <ExpandableBars
                        color="#dc2626"
                        items={(d.breachedByOwner || []).map((o: any) => ({
                          label: o.name || unassigned,
                          count: o.count || 0,
                          rows: caseRows((c) => c.open && c.breached && (o.userId ? c.ownerId === o.userId : c.ownerName === o.name)),
                        }))}
                      />
                    </>
                  ) : null}
                  {subtitle(`${t('dashboard.openBreaching', 'פניות פתוחות שחורגות מ-SLA')} · ${t('dashboard.breachResponse', 'תגובה')} ${fmtNum(d.breachedResponse)} · ${t('dashboard.breachResolution', 'פתרון')} ${fmtNum(d.breachedResolution)}`)}
                  <RecordList
                    rows={(d.breachedCases || []).map((b: any, i: number) => ({
                      key: b.caseId || String(i),
                      primary: b.subject || t('dashboard.case', 'פנייה'),
                      secondary: b.ownerName || unassigned,
                      tag: breachType(b.breachType),
                      tone: 'bad' as const,
                      onPress: () => openCase(b.caseId),
                    }))}
                  />
                </>
              ) : (
                <Text style={{ color: '#16a34a', fontWeight: '600' }}>{t('dashboard.noBreaches', 'אין פניות חורגות')}</Text>
              )
            ) : null}
            {caseTab === 'aging' ? (
              <>
                {subtitle(t('dashboard.openAge', 'גיל פניות פתוחות'))}
                <ExpandableBars
                  items={[
                    { label: t('dashboard.age.u1', 'פחות מיום'), count: d.aging?.under1d || 0, rows: caseRows((c) => c.open && ageDays(c) < 1) },
                    { label: t('dashboard.age.d13', '1-3 ימים'), count: d.aging?.d1to3 || 0, rows: caseRows((c) => c.open && ageDays(c) >= 1 && ageDays(c) < 3) },
                    { label: t('dashboard.age.d37', '3-7 ימים'), count: d.aging?.d3to7 || 0, rows: caseRows((c) => c.open && ageDays(c) >= 3 && ageDays(c) < 7) },
                    { label: t('dashboard.age.o7', 'יותר משבוע'), count: d.aging?.over7d || 0, rows: caseRows((c) => c.open && ageDays(c) >= 7), color: '#dc2626' },
                  ]}
                />
                {subtitle(t('dashboard.byPriority', 'לפי עדיפות'))}
                <ExpandableBars items={(d.openByPriority || []).map((p: any) => ({ label: p.priority, count: p.count, rows: caseRows((c) => c.open && c.priority === p.priority) }))} />
              </>
            ) : null}
          </SectionCard>
          <SectionCard title={isRanged ? t('dashboard.casesInRange', 'פניות שנוצרו בתקופה') : t('dashboard.latestCases', 'פניות אחרונות')}>
            <RecordList rows={(d.recent || []).map(caseRow)} empty={t('dashboard.noData', 'אין נתונים')} />
          </SectionCard>
        </>
      );
    }

    if (entity === 'leads') {
      return (
        <>
          {stats([
            { label: t('dashboard.created', 'נוצרו'), value: fmtNum(d.created), tone: 'good' },
            { label: t('dashboard.wonLabel', 'נסגרו בהצלחה'), value: fmtNum(d.won), tone: 'good' },
            { label: t('dashboard.openTotal', 'פתוחים (סה״כ)'), value: fmtNum(d.openTotal) },
          ])}
          <SectionCard title={t('dashboard.byStage', 'לפי שלב')}>
            <ExpandableBars
              color="#7c3aed"
              items={(d.byStage || []).map((s: any) => ({
                label: s.stageName,
                count: s.count,
                rows: (d.items || [])
                  .filter((l: any) => l.stageName === s.stageName)
                  .map((l: any) => ({
                    key: l.leadId,
                    primary: l.title || l.contactName || t('dashboard.lead', 'ליד'),
                    secondary: [l.contactName && l.contactName !== l.title ? l.contactName : '', l.ownerName].filter(Boolean).join(' · '),
                    tag: l.stageName,
                    tone: l.open ? '' : 'good',
                    meta: fmtDate(l.createdOn),
                    onPress: () => openLead(l.leadId),
                  })),
              }))}
            />
          </SectionCard>
          <SectionCard title={isRanged ? t('dashboard.leadsInRange', 'לידים שנוצרו בתקופה') : t('dashboard.latestLeads', 'לידים אחרונים')}>
            <RecordList
              empty={t('dashboard.noData', 'אין נתונים')}
              rows={(d.recent || []).map((l: any) => ({
                key: l.leadId,
                primary: l.title || l.contactName || t('dashboard.lead', 'ליד'),
                secondary: [l.contactName && l.contactName !== l.title ? l.contactName : '', l.ownerName].filter(Boolean).join(' · '),
                tag: l.stageName,
                tone: l.open ? '' : 'good',
                meta: fmtDate(l.createdOn),
                onPress: () => openLead(l.leadId),
              }))}
            />
          </SectionCard>
        </>
      );
    }

    if (entity === 'contacts') {
      const methodLabel = (m: string) =>
        ({ chat: t('dashboard.method.chat', 'שיחה'), manual: t('dashboard.method.manual', 'ידני'), import: t('dashboard.method.import', 'ייבוא'), form: t('dashboard.method.form', 'טופס'), api: 'API', ctwa: t('dashboard.method.ctwa', 'מודעות') } as any)[(m || '').toLowerCase()] || m || '—';
      const trend: { count?: number; label?: string; date?: string; month?: string }[] = d.trend || [];
      return (
        <>
          {stats([
            { label: t('dashboard.totalContacts', 'סה״כ אנשי קשר'), value: fmtNum(d.total ?? d.created) },
            { label: isRanged ? t('dashboard.newInRange', 'חדשים בתקופה') : t('dashboard.createdAll', 'נוצרו (כל הזמן)'), value: fmtNum(d.created), tone: 'good' },
            ...(typeof d.active30 === 'number' ? [{ label: t('dashboard.active30', 'פעילים ב-30 יום'), value: fmtNum(d.active30), tone: 'good' as const }] : []),
            ...(typeof d.dormant90 === 'number' ? [{ label: t('dashboard.dormant90', 'רדומים 90+ יום'), value: fmtNum(d.dormant90), tone: (d.dormant90 > 0 ? 'bad' : undefined) as any }] : []),
            ...(typeof d.noOwner === 'number' ? [{ label: t('dashboard.noOwner', 'ללא בעלים'), value: fmtNum(d.noOwner), tone: (d.noOwner > 0 ? 'bad' : undefined) as any }] : []),
            ...(d.ctwa > 0 ? [{ label: t('dashboard.fromAds', 'ממודעות (CTWA)'), value: fmtNum(d.ctwa) }] : []),
          ])}
          {trend.length > 0 ? (
            <SectionCard title={`${t('dashboard.newContacts', 'אנשי קשר חדשים')}${d.trendMonthly ? t('dashboard.perMonth', ' לפי חודש') : t('dashboard.perDay', ' לפי יום')}${isRanged ? '' : t('dashboard.last30', ' (30 ימים אחרונים)')}`}>
              <MiniBars
                data={trend.map((x: any) => ({
                  label: x.label || (x.date ? `${new Date(x.date).getDate()}/${new Date(x.date).getMonth() + 1}` : String(x.month || '').slice(0, 3)),
                  a: x.count || 0,
                }))}
                colorA="#2563eb"
              />
            </SectionCard>
          ) : null}
          <SectionCard title={t('dashboard.bySource', 'לפי מקור')}>
            <ExpandableBars color="#2563eb" items={(d.byMethod || []).map((s: any) => ({ label: methodLabel(s.method), count: s.count }))} />
          </SectionCard>
          {(d.byOwner || []).length > 0 ? (
            <SectionCard title={t('dashboard.byOwner', 'לפי בעלים')}>
              <ExpandableBars color="#2563eb" items={(d.byOwner || []).map((s: any) => ({ label: s.name || unassigned, count: s.count }))} />
            </SectionCard>
          ) : null}
          {(d.byTag || []).length > 0 ? (
            <SectionCard title={t('dashboard.topTags', 'תגיות מובילות')}>
              <ExpandableBars color="#2563eb" items={d.byTag.map((s: any) => ({ label: s.tag, count: s.count }))} />
            </SectionCard>
          ) : null}
          <SectionCard title={isRanged ? t('dashboard.contactsInRange', 'אנשי קשר שנוספו בתקופה') : t('dashboard.recentlyAdded', 'נוספו לאחרונה')}>
            <RecordList
              empty={t('dashboard.noData', 'אין נתונים')}
              rows={(d.recent || []).map((r: any) => ({
                key: r.phone,
                primary: r.name || r.phone,
                secondary: r.name ? r.phone : '',
                tag: methodLabel(r.method),
                meta: fmtDate(r.createdOn),
                onPress: () => openChat(r.phone),
              }))}
            />
          </SectionCard>
        </>
      );
    }

    if (entity === 'messages') {
      const hasTotal = typeof d.total === 'number';
      const series = (() => {
        if (!effective.from || !effective.to) return [];
        if (effective.from === effective.to) {
          return (Array.isArray(d.byHour) ? d.byHour : []).map((x: any) => ({ label: String(x.hour), a: x.incoming || 0, b: x.outgoing || 0 }));
        }
        const byDay: Record<string, any> = {};
        (Array.isArray(d.byDay) ? d.byDay : []).forEach((x: any) => {
          byDay[x.date] = x;
        });
        const out: { label: string; a: number; b: number }[] = [];
        const cur = new Date(`${effective.from}T12:00:00`);
        const end = new Date(`${effective.to}T12:00:00`);
        for (let g = 0; cur <= end && g < 93; g++) {
          const key = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`;
          const x = byDay[key] || {};
          out.push({ label: `${cur.getDate()}/${cur.getMonth() + 1}`, a: x.incoming || 0, b: x.outgoing || 0 });
          cur.setDate(cur.getDate() + 1);
        }
        return out;
      })();
      return (
        <>
          {effective.isLast30 ? (
            <Text style={{ fontSize: 12, color: theme.colors.onSurfaceVariant, marginHorizontal: 14, marginBottom: 6 }}>
              {t('dashboard.last30Note', 'מוצגים 30 הימים האחרונים')}
            </Text>
          ) : null}
          {stats([
            ...(hasTotal ? [{ label: t('dashboard.totalInRange', 'סה״כ בתקופה'), value: fmtNum(d.total) }] : []),
            ...(typeof d.incoming === 'number' ? [{ label: t('dashboard.received', 'נכנסות'), value: fmtNum(d.incoming) }] : []),
            ...(typeof d.outgoing === 'number' ? [{ label: t('dashboard.sent', 'יוצאות'), value: fmtNum(d.outgoing) }] : []),
            { label: t('dashboard.bots', 'בוטים'), value: fmtNum(d.bots), tone: 'good' as const },
            ...(d.msgSlaEnabled && (d.msgSlaConsidered || 0) > 0 ? [{ label: t('dashboard.slaBreaches', 'חריגות SLA'), value: fmtNum(d.msgSlaBreached || 0), tone: 'bad' as const }] : []),
          ])}
          {series.some((x: any) => x.a + x.b > 0) ? (
            <SectionCard title={t('dashboard.trend', 'מגמה')}>
              <MiniBars data={series} colorA="#2e6155" colorB="#93c5fd" />
              <Legend items={[{ color: '#2e6155', label: t('dashboard.received', 'נכנסות') }, { color: '#93c5fd', label: t('dashboard.sent', 'יוצאות') }]} />
            </SectionCard>
          ) : hasTotal && d.total === 0 ? (
            <Text style={{ color: theme.colors.onSurfaceVariant, marginHorizontal: 14, marginBottom: 8 }}>{t('dashboard.noMessagesInRange', 'אין הודעות בטווח שנבחר')}</Text>
          ) : null}
          <SectionCard title={t('dashboard.botSent', 'הודעות שנשלחו ע״י בוטים')}>
            <ExpandableBars
              items={[
                { label: t('dashboard.gambotRule', 'Gambot (בוט חוקים)'), count: d.gambot || 0 },
                { label: 'Gambot AI', count: d.gambotAi || 0 },
              ]}
              empty={t('dashboard.noData', 'אין נתונים')}
            />
          </SectionCard>
          <SectionCard title={t('dashboard.agentSent', 'הודעות שנשלחו ע״י נציגים')}>
            <ExpandableBars items={(d.byAgent || []).map((a: any) => ({ label: a.name, count: a.count || 0 }))} empty={t('dashboard.noAgentMessages', 'אין הודעות נציגים בתקופה')} />
          </SectionCard>
          {d.msgSlaEnabled && (d.msgSlaConsidered || 0) > 0 ? (
            <SectionCard title={t('dashboard.slaCompliance', 'עמידה ב-SLA')} icon="shield-check-outline" color="#16a34a">
              {(d.msgSlaCompliancePct ?? -1) >= 0 ? (
                <SlaGauge
                  pct={d.msgSlaCompliancePct}
                  met={d.msgSlaMet}
                  breached={d.msgSlaBreached}
                  caption={(d.msgSlaAvgResponseMin ?? -1) >= 0 ? `${t('dashboard.avgResponse', 'ממוצע תגובה')} ${formatWaiting(d.msgSlaAvgResponseMin, he)}` : undefined}
                />
              ) : null}
              {(d.msgSlaBreachedByAgent || []).length > 0 ? (
                <>
                  {subtitle(t('dashboard.breachesByAgent', 'חריגות לפי נציג'))}
                  <ExpandableBars color="#dc2626" items={(d.msgSlaBreachedByAgent || []).map((a: any) => ({ label: a.name, count: a.count || 0 }))} />
                </>
              ) : null}
            </SectionCard>
          ) : null}
          <SectionCard title={t('dashboard.recentChats', 'שיחות אחרונות בתקופה')}>
            <RecordList
              empty={t('dashboard.noData', 'אין נתונים')}
              rows={(d.recentChats || []).map((c: any) => ({
                key: c.phone,
                primary: c.name || c.phone,
                secondary: c.text || t('dashboard.noText', '(ללא טקסט)'),
                tag: c.direction === 'inbound' ? t('dashboard.incoming', 'נכנסת') : t('dashboard.outgoing', 'יוצאת'),
                meta: fmtDateTime(c.lastAt),
                onPress: () => openChat(c.phone),
              }))}
            />
          </SectionCard>
        </>
      );
    }

    if (entity === 'tasks') {
      const prLabel = (p: string) =>
        ({ urgent: t('dashboard.pr.urgent', 'דחוף'), high: t('dashboard.pr.high', 'גבוהה'), medium: t('dashboard.pr.medium', 'בינונית'), low: t('dashboard.pr.low', 'נמוכה') } as any)[p] || p;
      return (
        <>
          {stats([
            { label: t('dashboard.created', 'נוצרו'), value: fmtNum(d.created), tone: 'good' },
            { label: t('dashboard.completed', 'הושלמו'), value: fmtNum(d.completed), tone: 'good' },
            { label: t('dashboard.openTotal', 'פתוחות (סה״כ)'), value: fmtNum(d.openTotal) },
            { label: t('dashboard.overdue', 'באיחור'), value: fmtNum(d.overdue), tone: (d.overdue || 0) > 0 ? 'bad' : undefined },
          ])}
          <SectionCard title={t('dashboard.byPriority', 'לפי עדיפות')}>
            <ExpandableBars color="#d97706" items={(d.byPriority || []).map((s: any) => ({ label: prLabel(s.priority), count: s.count }))} empty={t('dashboard.noData', 'אין נתונים')} />
          </SectionCard>
        </>
      );
    }

    // orders
    return (
      <>
        {stats([
          { label: t('dashboard.created', 'נוצרו'), value: fmtNum(d.created), tone: 'good' },
          ...(typeof d.revenue === 'number' ? [{ label: t('dashboard.revenueInRange', 'הכנסות בתקופה'), value: fmtMoney(d.revenue) }] : []),
          { label: t('dashboard.activeTotal', 'פעילות (סה״כ)'), value: fmtNum(d.active) },
        ])}
        <SectionCard title={t('dashboard.byStatus', 'לפי סטטוס')}>
          <ExpandableBars
            color="#db2777"
            empty={t('dashboard.noData', 'אין נתונים')}
            items={(d.byStatus || []).map((s: any) => ({
              label: s.status,
              count: s.count,
              rows: (d.items || [])
                .filter((o: any) => o.status === s.status)
                .map((o: any) => ({
                  key: o.orderId,
                  primary: o.name || (o.number ? `#${o.number}` : t('dashboard.order', 'הזמנה')),
                  secondary: o.number && o.name ? `#${o.number}` : '',
                  tag: fmtMoney(o.total || 0),
                  meta: fmtDate(o.createdOn),
                  onPress: () => openOrder(o.orderId),
                })),
            }))}
          />
        </SectionCard>
      </>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <ScreenHeader
        title={t(titleKey, titleFallback)}
        onBack={() => router.back()}
        actions={<MaterialCommunityIcons name={titleIcon as any} size={22} color={theme.custom.headerText} style={{ marginHorizontal: 14 }} />}
      />
      {isSla ? null : <PeriodChips value={period} onChange={setPeriod} />}
      {isAdmin && !isSla && users.length > 0 ? (
        <View style={{ paddingHorizontal: 12, paddingBottom: 6, alignItems: 'flex-start' }}>
          <Menu
            visible={ownerMenu}
            onDismiss={() => setOwnerMenu(false)}
            anchor={
              <Pressable onPress={() => setOwnerMenu(true)} style={[styles.ownerChip, { flexDirection: dir, backgroundColor: theme.colors.surface, borderColor: owner ? BRAND : theme.colors.outlineVariant || '#cbd5e1' }]}>
                <MaterialCommunityIcons name="account-outline" size={16} color={owner ? BRAND : theme.colors.onSurfaceVariant} />
                <Text style={{ color: theme.colors.onSurface, fontSize: 13 }}>{owner ? owner.name : t('dashboard.allUsers', 'כל המשתמשים')}</Text>
                <MaterialCommunityIcons name="chevron-down" size={16} color={theme.colors.onSurfaceVariant} />
              </Pressable>
            }
          >
            <Menu.Item
              title={t('dashboard.allUsers', 'כל המשתמשים')}
              onPress={() => {
                setOwner(null);
                setOwnerMenu(false);
              }}
            />
            {users.map((u) => (
              <Menu.Item
                key={u.id}
                title={u.name}
                onPress={() => {
                  setOwner(u);
                  setOwnerMenu(false);
                }}
              />
            ))}
          </Menu>
        </View>
      ) : null}
      <ScrollView
        contentContainerStyle={{ paddingBottom: 32, paddingTop: 4 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[BRAND]} tintColor={BRAND} />}
      >
        {loading ? (
          <View style={{ gap: 12, paddingHorizontal: 12 }}>
            <Skeleton height={80} />
            <Skeleton height={140} />
            <Skeleton height={140} />
          </View>
        ) : (
          renderBody()
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  tiles: { flexWrap: 'wrap', gap: 8, paddingHorizontal: 12, marginBottom: 12 },
  userRow: { alignItems: 'center', gap: 6, paddingVertical: 8, borderBottomWidth: 0.5 },
  userNum: { width: 36, textAlign: 'center', fontSize: 13 },
  ownerChip: { alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 18, borderWidth: 1 },
});
