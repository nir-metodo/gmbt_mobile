import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useRowDirection } from '../../hooks/useRowDirection';
import { fmtNum, fmtPct, ProgressBar, SectionCard, Skeleton, StatTile } from '../dashboard/ui';
import { ExpandableBars, RecordList } from '../dashboard/records';
import { fetchDailyBotSummary } from '../../services/api/dashboard';
import type { ReportPanelProps } from './DailyConversationsPanel';

const pct = (n: number, total: number) => (total > 0 ? Math.round((n / total) * 100) : 0);

/** Bot performance: how many flows opened / completed / dropped, operators, drop-off paths (web BotomationReport). */
export default function BotPanel({ org, from, to, refreshKey, onOpenChat }: ReportPanelProps) {
  const { t } = useTranslation();
  const theme = useAppTheme();
  const dir = useRowDirection();
  const [data, setData] = useState<any>(undefined);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setData(undefined);
    fetchDailyBotSummary(org, from, to)
      .then((d) => alive && setData(d || {}))
      .catch(() => alive && setData(null));
    return () => {
      alive = false;
    };
  }, [org, from, to, refreshKey]);

  if (data === undefined) {
    return (
      <View style={{ gap: 12, paddingHorizontal: 12 }}>
        <Skeleton height={90} />
        <Skeleton height={160} />
      </View>
    );
  }
  if (data === null) {
    return <Text style={{ textAlign: 'center', padding: 24, color: theme.colors.onSurfaceVariant }}>{t('reports.loadFailed', 'טעינת הנתונים נכשלה - משכו לרענון')}</Text>;
  }

  const summary: any[] = data.botSummary || [];
  const totals = data.totals || {};
  const eng = data.templateEngagement || {};
  const bots = summary.filter((b) => b.isBot);
  const automations = summary.filter((b) => !b.isBot);
  const totalRuns = totals.totalRuns || 0;

  const renderList = (list: any[]) =>
    list.map((bot) => {
      const id = String(bot.botomationId);
      const isOpen = open === id;
      const rate = bot.completionRate ?? pct(bot.completed || 0, bot.total || 0);
      const color = rate >= 70 ? '#22c55e' : rate >= 40 ? '#f59e0b' : '#ef4444';
      const dropped = (bot.stopped || 0) + (bot.failed || 0);
      const expandable = (bot.branchBreakdown?.length || 0) > 0 || (bot.stepBreakdown?.length || 0) > 0 || (bot.activators?.length || 0) > 0 || (bot.contactDetails?.length || 0) > 0;
      return (
        <View key={id} style={{ marginBottom: 14 }}>
          <Pressable disabled={!expandable} onPress={() => setOpen(isOpen ? null : id)}>
            <View style={{ flexDirection: dir, alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <MaterialCommunityIcons name={bot.isBot ? 'robot-outline' : 'lightning-bolt-outline'} size={16} color="#7c3aed" />
              <Text numberOfLines={1} style={{ flex: 1, fontSize: 14, fontWeight: '700', color: theme.colors.onSurface }}>
                {bot.botomationName || bot.botomationId}
              </Text>
              <Text style={{ fontSize: 13, fontWeight: '800', color }}>{fmtPct(rate)}</Text>
              {expandable ? <MaterialCommunityIcons name={isOpen ? 'chevron-up' : 'chevron-down'} size={18} color={theme.colors.onSurfaceVariant} /> : null}
            </View>
            <ProgressBar pct={rate} color={color} />
            <Text style={{ fontSize: 11, color: theme.colors.onSurfaceVariant, marginTop: 4 }}>
              {fmtNum(bot.total)} {t('reports.bot.opened', 'נפתחו')} · <Text style={{ color: '#16a34a' }}>{fmtNum(bot.completed)} {t('reports.bot.completed', 'הושלמו')}</Text> ·{' '}
              <Text style={{ color: '#d97706' }}>{fmtNum(bot.stopped)} {t('reports.bot.dropped', 'נשרו')}</Text>
              {bot.failed > 0 ? <Text style={{ color: '#dc2626' }}> · {fmtNum(bot.failed)} {t('reports.bot.errors', 'שגיאות')}</Text> : null} · {fmtNum(bot.uniqueContacts)}{' '}
              {t('reports.bot.contacts', 'אנשי קשר')}
            </Text>
          </Pressable>
          {isOpen ? (
            <View style={{ marginTop: 10, paddingStart: 8 }}>
              {bot.activators?.length > 0 ? (
                <>
                  <Text style={styles.sub}>{t('reports.bot.operators', 'אופרטורים שהובילו לבוט')}</Text>
                  <ExpandableBars
                    color="#7c3aed"
                    items={bot.activators.map((op: any) => ({
                      label: `${op.botomationName || op.botomationId} · ${t('reports.bot.started', 'התחילו')} ${fmtNum(op.started)}/${fmtNum(op.sent)} (${op.conversionRate}%)`,
                      count: op.started || 0,
                    }))}
                  />
                </>
              ) : null}
              {bot.branchBreakdown?.length > 0 ? (
                <>
                  <Text style={styles.sub}>{t('reports.bot.branches', 'מסלולים / כפתורים שבהם נעצרו')}</Text>
                  <ExpandableBars color="#f59e0b" items={bot.branchBreakdown.map((b: any) => ({ label: b.branch, count: b.count }))} />
                </>
              ) : null}
              {bot.stepBreakdown?.length > 0 ? (
                <>
                  <Text style={styles.sub}>{t('reports.bot.steps', 'נשירה לפי שלב')}</Text>
                  <ExpandableBars
                    color="#ef4444"
                    items={bot.stepBreakdown.map((s: any) => ({
                      label: String(s.stepName || s.stepId || '').split(/[>/→]/).pop()?.trim() || s.stepId,
                      count: s.count,
                    }))}
                  />
                </>
              ) : null}
              {dropped > 0 && bot.contactDetails?.length > 0 ? (
                <>
                  <Text style={styles.sub}>{t('reports.bot.droppedContacts', 'אנשי קשר שנשרו')}</Text>
                  <RecordList
                    limit={8}
                    rows={bot.contactDetails.map((c: any, i: number) => ({
                      key: `${c.phone}-${i}`,
                      primary: c.phone,
                      secondary: c.lastStepContent || '',
                      tag: c.status,
                      tone: c.status?.toLowerCase() === 'completed' ? 'good' : c.status?.toLowerCase() === 'failed' ? 'bad' : '',
                      onPress: () => onOpenChat(c.phone),
                    }))}
                  />
                </>
              ) : null}
            </View>
          ) : null}
        </View>
      );
    });

  if (summary.length === 0) {
    return <Text style={{ textAlign: 'center', padding: 24, color: theme.colors.onSurfaceVariant }}>{t('reports.noData', 'אין נתונים')}</Text>;
  }

  return (
    <View>
      <View style={[styles.tiles, { flexDirection: dir }]}>
        <StatTile label={t('reports.bot.runs', 'ריצות')} value={totalRuns} width="31.5%" />
        <StatTile label={t('reports.bot.contacts', 'אנשי קשר')} value={totals.uniqueContacts || 0} width="31.5%" />
        <StatTile label={t('reports.bot.completionRate', 'שיעור השלמה')} value={fmtPct(pct(totals.totalCompleted || 0, totalRuns))} color="#16a34a" width="31.5%" />
        <StatTile label={t('reports.bot.completed', 'הושלמו')} value={totals.totalCompleted || 0} color="#16a34a" width="31.5%" />
        <StatTile label={t('reports.bot.dropped', 'נשרו')} value={totals.totalStopped || 0} color="#d97706" width="31.5%" />
        {(totals.totalFailed || 0) > 0 ? <StatTile label={t('reports.bot.errors', 'שגיאות')} value={totals.totalFailed} color="#dc2626" width="31.5%" /> : null}
      </View>

      {eng.activatorContacts > 0 ? (
        <SectionCard title={t('reports.bot.engagement', 'מעורבות בהודעות תבנית')} icon="filter-variant" color="#7c3aed">
          <View style={{ flexDirection: dir, justifyContent: 'space-between' }}>
            <Text style={{ fontSize: 13, color: theme.colors.onSurface }}>
              {t('reports.bot.activated', 'קיבלו הודעה')}: <Text style={{ fontWeight: '800' }}>{fmtNum(eng.activatorContacts)}</Text>
            </Text>
            <Text style={{ fontSize: 13, color: theme.colors.onSurface }}>
              {t('reports.bot.responded', 'הגיבו')}: <Text style={{ fontWeight: '800', color: '#16a34a' }}>{fmtNum(eng.respondedContacts)}</Text>
            </Text>
            <Text style={{ fontSize: 13, color: theme.colors.onSurface }}>
              {t('reports.bot.notEngaged', 'לא הגיבו')}: <Text style={{ fontWeight: '800', color: '#dc2626' }}>{fmtNum(eng.notEngagedCount)}</Text>
            </Text>
          </View>
          <View style={{ marginTop: 8 }}>
            <ProgressBar pct={eng.engagementRate || 0} color="#7c3aed" />
            <Text style={{ fontSize: 12, color: theme.colors.onSurfaceVariant, marginTop: 4 }}>
              {t('reports.bot.engagementRate', 'שיעור מעורבות')} {fmtPct(eng.engagementRate)}
            </Text>
          </View>
        </SectionCard>
      ) : null}

      {bots.length > 0 ? (
        <SectionCard title={t('reports.bot.bots', 'בוטים')} icon="robot-outline" color="#7c3aed">
          {renderList(bots)}
        </SectionCard>
      ) : null}
      {automations.length > 0 ? (
        <SectionCard title={t('reports.bot.automations', 'אוטומציות')} icon="lightning-bolt-outline" color="#d97706">
          {renderList(automations)}
        </SectionCard>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  tiles: { flexWrap: 'wrap', gap: 8, paddingHorizontal: 12, marginBottom: 12 },
  sub: { fontSize: 12, fontWeight: '700', color: '#64748b', marginTop: 8, marginBottom: 6 },
});
