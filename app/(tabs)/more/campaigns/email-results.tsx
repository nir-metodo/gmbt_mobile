import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, FlatList, RefreshControl } from 'react-native';
import { Text, Button, Chip, ActivityIndicator, Divider } from 'react-native-paper';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../../../stores/authStore';
import { useAppTheme } from '../../../../hooks/useAppTheme';
import { useRTL } from '../../../../hooks/useRTL';
import {
  EmailCampaignResults,
  EmailClickStats,
  EmailResultRecipient,
  emailCampaignsApi,
  errorMessage,
} from '../../../../services/api/emailCampaigns';
import EmailScreenHeader from '../../../../components/campaigns/email/EmailScreenHeader';
import { formatDateTime, statusMeta } from '../../../../components/campaigns/email/emailCampaignHelpers';

const PAGE = 30;
type Filter = 'all' | 'sent' | 'opened' | 'failed';

const SENT_OK = ['sent', 'opened', 'clicked'];
const FAILED = ['failed', 'bounced', 'unsubscribed', 'duplicate'];

function pct(part: number, total: number) {
  return total > 0 ? `${Math.round((part / total) * 100)}%` : '0%';
}

export default function EmailCampaignResultsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const { flexDirection, textAlign } = useRTL();
  const { i18n } = useTranslation();
  const he = i18n.language !== 'en';
  const { user } = useAuthStore();
  const org = user?.organization || '';

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState<EmailCampaignResults | null>(null);
  const [clicks, setClicks] = useState<EmailClickStats | null>(null);
  const [runId, setRunId] = useState<string>('');
  const [filter, setFilter] = useState<Filter>('all');
  const [visible, setVisible] = useState(PAGE);

  const load = useCallback(
    async (silent = false) => {
      if (!org || !id) return;
      if (!silent) setLoading(true);
      setError('');
      try {
        const [r, c] = await Promise.all([
          emailCampaignsApi.getResults(org, id),
          emailCampaignsApi.getClickStats(org, id).catch(() => null),
        ]);
        setData(r);
        setClicks(c);
      } catch (e) {
        setError(errorMessage(e, he ? 'שגיאה בטעינת התוצאות' : 'Failed to load results'));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [org, id, he],
  );

  useEffect(() => {
    load();
  }, [load]);

  // Distinct runs (a campaign can be sent more than once)
  const runs = useMemo(() => {
    const seen = new Map<string, string>();
    (data?.recipients || []).forEach((r) => {
      if (r.campaignRunId && !seen.has(r.campaignRunId)) seen.set(r.campaignRunId, r.sentAt || '');
    });
    return Array.from(seen.entries()).map(([key, at]) => ({ key, at }));
  }, [data]);

  // Selected run: all by default, or one of the runs.
  const recipients = useMemo(() => {
    const all = data?.recipients || [];
    return runId ? all.filter((r) => r.campaignRunId === runId) : all;
  }, [data, runId]);

  const stats = useMemo(() => {
    const total = recipients.length;
    const sent = recipients.filter((r) => SENT_OK.includes(r.status)).length;
    const opened = recipients.filter((r) => r.status === 'opened' || r.status === 'clicked' || !!r.openedAt).length;
    const failed = recipients.filter((r) => r.status === 'failed').length;
    const bounced = recipients.filter((r) => r.status === 'bounced').length;
    const pending = recipients.filter((r) => !SENT_OK.includes(r.status) && !FAILED.includes(r.status)).length;
    return { total, sent, opened, failed, bounced, pending };
  }, [recipients]);

  const filtered = useMemo(() => {
    switch (filter) {
      case 'sent':
        return recipients.filter((r) => SENT_OK.includes(r.status));
      case 'opened':
        return recipients.filter((r) => r.status === 'opened' || r.status === 'clicked' || !!r.openedAt);
      case 'failed':
        return recipients.filter((r) => FAILED.includes(r.status));
      default:
        return recipients;
    }
  }, [recipients, filter]);

  useEffect(() => {
    setVisible(PAGE);
  }, [filter, runId]);

  const campaign = data?.campaign;
  const campStatus = statusMeta(campaign?.status, he);

  const goBack = () => router.back();

  const sendAgain = () =>
    router.push({ pathname: '/(tabs)/more/campaigns/email-preview', params: { id, mode: 'now' } } as any);

  const header = (
    <View style={{ padding: 16 }}>
      <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.outline }]}>
        <View style={[styles.rowBetween, { flexDirection }]}>
          <Text style={{ flex: 1, fontSize: 17, fontWeight: '700', color: theme.colors.onSurface, textAlign }} numberOfLines={2}>
            {campaign?.name || ''}
          </Text>
          <View style={[styles.badge, { backgroundColor: campStatus.color + '22' }]}>
            <Text style={{ color: campStatus.color, fontWeight: '700', fontSize: 12 }}>{campStatus.label}</Text>
          </View>
        </View>
        {!!campaign?.templateName && (
          <Text style={{ color: theme.colors.onSurfaceVariant, textAlign, marginTop: 6 }}>
            {he ? 'תבנית: ' : 'Template: '}
            {campaign.templateName}
          </Text>
        )}
        {!!campaign?.sentDate && (
          <Text style={{ color: theme.colors.onSurfaceVariant, textAlign, marginTop: 2 }}>
            {he ? 'נשלח: ' : 'Sent: '}
            {formatDateTime(campaign.sentDate, he)}
          </Text>
        )}
      </View>

      <View style={[styles.statsGrid, { flexDirection }]}>
        <StatBox label={he ? 'נמענים' : 'Recipients'} value={String(stats.total)} color={theme.colors.onSurface} />
        <StatBox label={he ? 'נשלחו' : 'Sent'} value={String(stats.sent)} sub={pct(stats.sent, stats.total)} color="#10b981" />
        <StatBox label={he ? 'נפתחו' : 'Opened'} value={String(stats.opened)} sub={pct(stats.opened, stats.sent)} color="#34d399" />
        <StatBox
          label={he ? 'הקלקות' : 'Clicks'}
          value={String(clicks?.totalClicks ?? 0)}
          color="#2e6155"
        />
        <StatBox label={he ? 'נכשלו' : 'Failed'} value={String(stats.failed)} sub={pct(stats.failed, stats.total)} color="#ef4444" />
        <StatBox label={he ? 'הוחזרו' : 'Bounced'} value={String(stats.bounced)} sub={pct(stats.bounced, stats.total)} color="#f59e0b" />
      </View>

      {stats.pending > 0 && (
        <Text style={{ color: theme.colors.onSurfaceVariant, textAlign, marginTop: 8 }}>
          {he
            ? `${stats.pending} נמענים עדיין בתור לשליחה. משכו לרענון.`
            : `${stats.pending} recipients are still queued. Pull to refresh.`}
        </Text>
      )}

      {runs.length > 1 && (
        <View style={[styles.chipsRow, { flexDirection }]}>
          <Chip selected={!runId} onPress={() => setRunId('')} style={styles.chip}>
            {he ? 'כל השליחות' : 'All runs'}
          </Chip>
          {runs.map((r, i) => (
            <Chip key={r.key} selected={runId === r.key} onPress={() => setRunId(r.key)} style={styles.chip}>
              {`${he ? 'שליחה' : 'Run'} ${runs.length - i}${r.at ? ' · ' + formatDateTime(r.at, he) : ''}`}
            </Chip>
          ))}
        </View>
      )}

      <View style={[styles.chipsRow, { flexDirection }]}>
        {(
          [
            ['all', he ? 'הכל' : 'All'],
            ['sent', he ? 'נשלחו' : 'Sent'],
            ['opened', he ? 'נפתחו' : 'Opened'],
            ['failed', he ? 'כשלונות' : 'Failed'],
          ] as [Filter, string][]
        ).map(([k, label]) => (
          <Chip key={k} selected={filter === k} onPress={() => setFilter(k)} style={styles.chip}>
            {label}
          </Chip>
        ))}
      </View>

      <Button mode="contained" icon="send" onPress={sendAgain} style={{ marginTop: 12, backgroundColor: '#2e6155' }}>
        {he ? 'שליחה חוזרת (עם תצוגה מקדימה)' : 'Send again (with preview)'}
      </Button>
    </View>
  );

  const renderItem = ({ item }: { item: EmailResultRecipient }) => {
    const m = statusMeta(item.status, he);
    return (
      <View style={[styles.recipient, { borderColor: theme.colors.outline, backgroundColor: theme.colors.surface }]}>
        <View style={[styles.rowBetween, { flexDirection }]}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.colors.onSurface, fontWeight: '600', textAlign }} numberOfLines={1}>
              {item.name || item.email}
            </Text>
            {!!item.name && (
              <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 12, textAlign }} numberOfLines={1}>
                {item.email}
              </Text>
            )}
          </View>
          <View style={[styles.badge, { backgroundColor: m.color + '22' }]}>
            <Text style={{ color: m.color, fontWeight: '700', fontSize: 11 }}>{m.label}</Text>
          </View>
        </View>
        {(!!item.sentAt || !!item.openedAt) && (
          <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 11, textAlign, marginTop: 4 }}>
            {item.sentAt ? `${he ? 'נשלח' : 'Sent'}: ${formatDateTime(item.sentAt, he)}` : ''}
            {item.openedAt ? `   ${he ? 'נפתח' : 'Opened'}: ${formatDateTime(item.openedAt, he)}` : ''}
          </Text>
        )}
        {!!item.errorMessage && (
          <Text style={{ color: theme.colors.error, fontSize: 12, textAlign, marginTop: 4 }}>{item.errorMessage}</Text>
        )}
      </View>
    );
  };

  return (
    <View style={[styles.flex, { backgroundColor: theme.colors.background }]}>
      <EmailScreenHeader title={he ? 'תוצאות קמפיין' : 'Campaign results'} onBack={goBack} />
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color="#2e6155" />
        </View>
      ) : error && !data ? (
        <View style={styles.center}>
          <Text style={{ color: theme.colors.error, textAlign: 'center', marginBottom: 12 }}>{error}</Text>
          <Button mode="outlined" onPress={() => load()}>
            {he ? 'נסו שוב' : 'Retry'}
          </Button>
        </View>
      ) : (
        <FlatList
          data={filtered.slice(0, visible)}
          keyExtractor={(item, i) => `${item.email}-${item.campaignRunId}-${i}`}
          renderItem={renderItem}
          ListHeaderComponent={header}
          ItemSeparatorComponent={() => <Divider style={{ opacity: 0 }} />}
          ListEmptyComponent={
            <Text style={{ textAlign: 'center', color: theme.colors.onSurfaceVariant, padding: 24 }}>
              {recipients.length === 0
                ? he
                  ? 'עדיין אין תוצאות. הקמפיין טרם נשלח.'
                  : 'No results yet. This campaign has not been sent.'
                : he
                  ? 'אין נמענים בסינון הזה'
                  : 'No recipients match this filter'}
            </Text>
          }
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (visible < filtered.length) setVisible((v) => v + PAGE);
          }}
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                load(true);
              }}
              colors={['#2e6155']}
            />
          }
        />
      )}
    </View>
  );
}

function StatBox({ label, value, sub, color }: { label: string; value: string; sub?: string; color: string }) {
  const theme = useAppTheme();
  return (
    <View style={[styles.statBox, { backgroundColor: theme.colors.surface, borderColor: theme.colors.outline }]}>
      <Text style={{ fontSize: 20, fontWeight: '800', color }}>{value}</Text>
      <Text style={{ fontSize: 11, color: theme.colors.onSurfaceVariant }}>{label}</Text>
      {!!sub && <Text style={{ fontSize: 10, color: theme.colors.onSurfaceVariant }}>{sub}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 14 },
  rowBetween: { alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  badge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10 },
  statsGrid: { flexWrap: 'wrap', gap: 8, marginTop: 12 },
  statBox: {
    width: '31%',
    flexGrow: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  chipsRow: { flexWrap: 'wrap', gap: 6, marginTop: 12 },
  chip: {},
  recipient: {
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
