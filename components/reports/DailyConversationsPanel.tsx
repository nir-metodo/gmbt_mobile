import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useRowDirection } from '../../hooks/useRowDirection';
import { ChipRow, fmtNum, fmtPct, SectionCard, Skeleton, StatTile } from '../dashboard/ui';
import { Legend, MiniBars } from '../dashboard/charts';
import { RecordList, RecordItem } from '../dashboard/records';
import {
  fetchAiResponsesStats,
  fetchDailyBotSummary,
  fetchDailyConversationReport,
  fetchMessageSlaConfig,
} from '../../services/api/dashboard';
import { formatWaiting, getConversationWaiting, MessageSlaConfig } from '../../utils/messageSla';

export interface ReportPanelProps {
  org: string;
  from: string;
  to: string;
  refreshKey: number;
  onOpenChat: (phone: string) => void;
}

type FilterKey = 'all' | 'breach' | 'awaiting' | 'answered' | 'inbound' | 'noInbound' | 'human' | 'bot' | 'template' | 'ai';

/** Daily Business Report: conversations, SLA waiting state, agents and what the bots / AI did (web DailyConversationsReport). */
export default function DailyConversationsPanel({ org, from, to, refreshKey, onOpenChat }: ReportPanelProps) {
  const { t } = useTranslation();
  const theme = useAppTheme();
  const dir = useRowDirection();

  const [conv, setConv] = useState<any>(undefined);
  const [bots, setBots] = useState<any>(undefined);
  const [ai, setAi] = useState<any>(undefined);
  const [sla, setSla] = useState<MessageSlaConfig | null>(null);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [agent, setAgent] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setConv(undefined);
    setBots(undefined);
    setAi(undefined);
    fetchDailyConversationReport(org, from, to).then((d) => alive && setConv(d || {})).catch(() => alive && setConv(null));
    fetchDailyBotSummary(org, from, to).then((d) => alive && setBots(d || {})).catch(() => alive && setBots(null));
    fetchAiResponsesStats(org, from, to).then((d) => alive && setAi(d || null)).catch(() => alive && setAi(null));
    fetchMessageSlaConfig(org).then((c) => alive && setSla(c));
    return () => {
      alive = false;
    };
  }, [org, from, to, refreshKey]);

  const totals = conv?.totals || {};
  const daily: any[] = conv?.dailySummary || [];
  const rawContacts: any[] = conv?.contactBreakdown || [];
  const hasLiveState = rawContacts.length > 0 && rawContacts[0].currentDirection !== undefined;
  const hasTypeBreakdown = rawContacts.length > 0 && rawContacts[0].botMessages !== undefined;

  // Per-contact waiting state with the SAME rules as the chat list.
  const contacts = useMemo(
    () =>
      rawContacts.map((c) => {
        const d = String(c.currentDirection || c.lastDirection || '').toLowerCase();
        const status = c.currentStatus || '';
        const closed = String(status).toLowerCase() === 'closed';
        const awaiting = hasLiveState && d === 'inbound' && !closed;
        const since = c.currentLastMessageTime || c.lastInboundAt || null;
        const w = awaiting ? getConversationWaiting({ lastMessageDirection: d, lastMessageTime: since, lastConversationStatus: status }, sla) : null;
        const sinceMs = since ? new Date(since).getTime() : NaN;
        const waitMin = w ? w.minutes : awaiting && !isNaN(sinceMs) ? Math.max(0, (Date.now() - sinceMs) / 60000) : 0;
        return { ...c, awaiting, breach: w?.level === 'breach', warn: w?.level === 'warn', waitMin };
      }),
    [rawContacts, sla, hasLiveState],
  );

  const filters = useMemo(() => {
    const list: { key: FilterKey; label: string; test: (c: any) => boolean }[] = [{ key: 'all', label: t('reports.daily.all', 'הכל'), test: () => true }];
    if (hasLiveState) {
      list.push(
        { key: 'breach', label: t('reports.daily.breach', 'חריגת SLA'), test: (c) => c.breach },
        { key: 'awaiting', label: t('reports.daily.awaiting', 'ממתינים למענה'), test: (c) => c.awaiting },
        { key: 'answered', label: t('reports.daily.answered', 'נענו'), test: (c) => c.inbound > 0 && !c.awaiting },
      );
    }
    list.push(
      { key: 'inbound', label: t('reports.daily.wroteToUs', 'כתבו לנו'), test: (c) => c.inbound > 0 },
      { key: 'noInbound', label: t('reports.daily.outgoingOnly', 'יוצאות בלבד'), test: (c) => c.inbound === 0 },
    );
    if (hasTypeBreakdown) {
      list.push(
        { key: 'human', label: t('reports.daily.agent', 'נציג'), test: (c) => c.humanMessages > 0 },
        { key: 'bot', label: t('reports.daily.bot', 'בוט'), test: (c) => c.botMessages > 0 },
        { key: 'template', label: t('reports.daily.template', 'תבנית'), test: (c) => c.templateMessages > 0 },
      );
    }
    list.push({ key: 'ai', label: 'Gambot AI', test: (c) => c.aiMessages > 0 });
    return list;
  }, [t, hasLiveState, hasTypeBreakdown]);

  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    filters.forEach((f) => {
      out[f.key] = contacts.filter(f.test).length;
    });
    return out;
  }, [filters, contacts]);

  const agents: any[] = conv?.agents || [];
  const agentLabel = (a: any) => a.name || a.userId || t('reports.daily.unknownAgent', 'נשלח מהטלפון / לא ידוע');
  const active = filters.find((f) => f.key === filter) || filters[0];
  const shown = contacts
    .filter(active.test)
    .filter((c) => agent === null || (c.agentIds || []).includes(agent))
    .sort((a, b) => (filter === 'breach' || filter === 'awaiting' ? b.waitMin - a.waitMin : 0));

  const rows: RecordItem[] = shown.map((c, i) => ({
    key: c.phone || String(i),
    primary: (c.name || c.phone || '').replace(/\.+$/, ''),
    secondary: `${c.phone || ''} · ${fmtNum(c.inbound)} ↓  ${fmtNum(c.outbound)} ↑`,
    tag: c.awaiting && c.waitMin > 0 ? formatWaiting(Math.round(c.waitMin), true) : undefined,
    tone: c.breach ? 'bad' : undefined,
    onPress: c.phone ? () => onOpenChat(c.phone) : undefined,
  }));

  if (conv === undefined) {
    return (
      <View style={{ gap: 12, paddingHorizontal: 12 }}>
        <Skeleton height={90} />
        <Skeleton height={120} />
        <Skeleton height={160} />
      </View>
    );
  }
  if (conv === null) {
    return <Text style={{ textAlign: 'center', padding: 24, color: theme.colors.onSurfaceVariant }}>{t('reports.loadFailed', 'טעינת הנתונים נכשלה - משכו לרענון')}</Text>;
  }

  const botList: any[] = (bots?.botSummary || []).filter((b: any) => b.isBot);
  const sum = (k: string) => botList.reduce((a, b) => a + (b[k] || 0), 0);
  const runs = sum('total');
  const done = sum('completed');
  const aiAnswers = Number(ai?.current?.aiResponses || 0);
  const aiPrev = Number(ai?.previous?.aiResponses || 0);
  const aiChange = Number(ai?.changePercent || 0);
  const tile = (key: FilterKey | null, label: string, value: number, color?: string) => (
    <StatTile
      key={label}
      label={label}
      value={value}
      color={color}
      width="31.5%"
      onPress={key ? () => setFilter(key) : undefined}
    />
  );

  return (
    <View>
      <View style={[styles.tiles, { flexDirection: dir }]}>
        {tile(null, t('reports.daily.totalMessages', 'סה״כ הודעות'), totals.total || 0)}
        {tile(null, t('reports.daily.fromCustomers', 'מלקוחות'), totals.inbound || 0)}
        {tile(null, t('reports.daily.outgoing', 'יוצאות'), totals.outbound || 0)}
        {tile('all', t('reports.daily.contactsConversed', 'אנשי קשר'), totals.contacts || 0)}
        {tile('inbound', t('reports.daily.contactsWrote', 'כתבו לנו'), totals.inboundContacts || 0)}
        {totals.total > 0 && totals.inbound > 0 ? (
          <StatTile label={t('reports.daily.responseRatio', 'יחס מענה')} value={fmtPct((totals.outbound / totals.total) * 100)} width="31.5%" />
        ) : null}
        {hasLiveState ? tile('breach', t('reports.daily.breach', 'חריגת SLA'), counts.breach || 0, (counts.breach || 0) > 0 ? '#dc2626' : undefined) : null}
        {hasLiveState ? tile('awaiting', t('reports.daily.awaiting', 'ממתינים למענה'), counts.awaiting || 0, (counts.awaiting || 0) > 0 ? '#d97706' : undefined) : null}
        {hasLiveState ? tile('answered', t('reports.daily.answered', 'נענו'), counts.answered || 0, '#16a34a') : null}
      </View>

      {daily.length > 1 ? (
        <SectionCard title={t('reports.daily.dailyVolume', 'נפח הודעות יומי')} icon="chart-bar" color="#0891b2">
          <MiniBars
            data={daily.map((d: any) => ({ label: String(d.date || '').slice(8, 10) + '/' + String(d.date || '').slice(5, 7), a: d.inbound || 0, b: d.outbound || 0 }))}
            colorA="#2e6155"
            colorB="#93c5fd"
          />
          <Legend items={[{ color: '#2e6155', label: t('reports.daily.fromCustomers', 'מלקוחות') }, { color: '#93c5fd', label: t('reports.daily.outgoing', 'יוצאות') }]} />
        </SectionCard>
      ) : null}

      {rawContacts.length > 0 ? (
        <>
          <ChipRow
            options={filters.map((f) => ({ key: f.key, label: `${f.label} ${counts[f.key] || 0}` }))}
            value={filter}
            onChange={(k) => {
              setFilter(k);
              if (k !== 'human') setAgent(null);
            }}
          />
          {filter === 'human' && agents.length > 0 ? (
            <ChipRow
              options={[{ key: '', label: t('reports.daily.allAgents', 'כל הנציגים') }, ...agents.map((a) => ({ key: a.userId || '__none', label: agentLabel(a) }))]}
              value={agent ?? ''}
              onChange={(k) => setAgent(k === '' ? null : k === '__none' ? '' : k)}
            />
          ) : null}
          <SectionCard title={`${t('reports.daily.activeContacts', 'אנשי קשר פעילים')} (${fmtNum(shown.length)})`} icon="account-group-outline" color="#2563eb">
            <RecordList rows={rows} limit={25} empty={t('reports.noData', 'אין נתונים')} />
          </SectionCard>
        </>
      ) : null}

      {/* What the bots & AI did for you */}
      {bots !== undefined || ai !== undefined ? (
        (runs > 0 || aiAnswers > 0 || (hasTypeBreakdown && (totals.botMessages || 0) > 0)) ? (
          <SectionCard title={t('reports.daily.botsAndAi', 'מה הבוטים וה-AI עשו בשבילכם')} icon="robot-outline" color="#7c3aed">
            <View style={[styles.tilesInner, { flexDirection: dir }]}>
              <StatTile label={t('reports.daily.botConversations', 'שיחות שטופלו ע״י בוטים')} value={runs} width="48%" />
              <StatTile label={t('reports.daily.botCompleted', 'הושלמו')} value={done} color="#16a34a" width="48%" />
              {hasTypeBreakdown ? <StatTile label={t('reports.daily.botMessages', 'הודעות בוט')} value={totals.botMessages || 0} width="48%" /> : null}
              <StatTile
                label={t('reports.daily.aiAnswers', 'תשובות Gambot AI')}
                value={aiAnswers}
                color="#7c3aed"
                width="48%"
              />
            </View>
            {ai ? (
              <View style={{ flexDirection: dir, alignItems: 'center', gap: 6, marginTop: 10 }}>
                <MaterialCommunityIcons name={aiChange >= 0 ? 'trending-up' : 'trending-down'} size={18} color={aiChange >= 0 ? '#16a34a' : '#dc2626'} />
                <Text style={{ fontSize: 12, color: theme.colors.onSurfaceVariant, flex: 1 }}>
                  {t('reports.daily.vsPrevious', 'לעומת התקופה הקודמת')}: {fmtNum(aiPrev)} ({aiChange >= 0 ? '+' : ''}
                  {aiChange}%)
                </Text>
              </View>
            ) : null}
            {botList.slice(0, 8).map((b) => {
              const tot = b.total || 0;
              const pct = (n: number) => (tot > 0 ? (n / tot) * 100 : 0);
              return (
                <View key={b.botomationId} style={{ marginTop: 12 }}>
                  <View style={{ flexDirection: dir, justifyContent: 'space-between', marginBottom: 4 }}>
                    <Text numberOfLines={1} style={{ flex: 1, fontSize: 13, fontWeight: '600', color: theme.colors.onSurface }}>
                      {b.botomationName || b.botomationId}
                    </Text>
                    <Text style={{ fontSize: 12, color: theme.colors.onSurfaceVariant }}>
                      {fmtNum(tot)} · {fmtPct(b.completionRate ?? pct(b.completed || 0))}
                    </Text>
                  </View>
                  <View style={{ flexDirection: dir, height: 8, borderRadius: 4, overflow: 'hidden', backgroundColor: theme.colors.surfaceVariant }}>
                    <View style={{ width: `${pct(b.completed || 0)}%`, backgroundColor: '#22c55e' }} />
                    <View style={{ width: `${pct(b.stopped || 0)}%`, backgroundColor: '#f59e0b' }} />
                    <View style={{ width: `${pct(b.failed || 0)}%`, backgroundColor: '#ef4444' }} />
                  </View>
                </View>
              );
            })}
          </SectionCard>
        ) : null
      ) : null}

      {rawContacts.length === 0 && daily.length === 0 ? (
        <Text style={{ textAlign: 'center', padding: 24, color: theme.colors.onSurfaceVariant }}>{t('reports.noData', 'אין נתונים')}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  tiles: { flexWrap: 'wrap', gap: 8, paddingHorizontal: 12, marginBottom: 12 },
  tilesInner: { flexWrap: 'wrap', gap: 8 },
});
