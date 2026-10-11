import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, ScrollView, RefreshControl, Pressable } from 'react-native';
import { Text, Button, ActivityIndicator } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../../../stores/authStore';
import { useAppTheme } from '../../../../hooks/useAppTheme';
import { useRTL } from '../../../../hooks/useRTL';
import { borderRadius } from '../../../../constants/theme';
import { withAlpha } from '../../../../utils/formatters';
import { campaignsApi, WaCampaign, WaRunResult, ClickStats } from '../../../../services/api/campaigns';
import WaHeader from '../../../../components/campaigns/whatsapp/WaHeader';
import { STATUS_STYLE } from '../../../../components/campaigns/whatsapp/CampaignCard';
import { invalidateRunSummary } from '../../../../components/campaigns/whatsapp/useRunSummaries';
import {
  computeRunStats,
  deriveStatus,
  formatWhen,
  getCachedCampaign,
  num,
  summarizeRuns,
  upsertCachedCampaign,
} from '../../../../components/campaigns/whatsapp/campaignUtils';

const POLL_MS = 10000;
const FAILED_ROWS_LIMIT = 30;

function Tile({ label, value, color, icon }: { label: string; value: number | string; color: string; icon: string }) {
  const theme = useAppTheme();
  return (
    <View style={[styles.tile, { backgroundColor: withAlpha(color, 0.1) }]}>
      <MaterialCommunityIcons name={icon as any} size={18} color={color} />
      <Text style={[styles.tileValue, { color }]}>{value}</Text>
      <Text style={[styles.tileLabel, { color: theme.colors.onSurfaceVariant }]}>{label}</Text>
    </View>
  );
}

function Bar({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const theme = useAppTheme();
  const { flexDirection } = useRTL();
  const pct = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0;
  return (
    <View style={{ gap: 3 }}>
      <View style={[styles.barHead, { flexDirection }]}>
        <Text style={[styles.barLabel, { color: theme.colors.onSurfaceVariant }]}>{label}</Text>
        <Text style={[styles.barLabel, { color: theme.colors.onSurface, fontWeight: '700' }]}>{`${value} (${pct}%)`}</Text>
      </View>
      <View style={[styles.barTrack, { backgroundColor: theme.colors.surfaceVariant }]}>
        <View style={[styles.barFill, { width: `${pct}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
}

export default function WaResultsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const { flexDirection, textAlign } = useRTL();
  const { i18n } = useTranslation();
  const he = i18n.language !== 'en';
  const organization = useAuthStore((s) => s.user?.organization) as string | undefined;

  const [campaign, setCampaign] = useState<WaCampaign | null>(() => (id ? getCachedCampaign(String(id)) || null : null));
  const [templateName, setTemplateName] = useState('');
  const [runs, setRuns] = useState<WaRunResult[]>([]);
  const [clicks, setClicks] = useState<ClickStats | null>(null);
  const [entries, setEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const campaignId = String(id || '');

  const fetchAll = useCallback(
    async (opts: { rebuild?: boolean; silent?: boolean } = {}) => {
      if (!organization || !campaignId) return;
      if (!opts.silent) setError('');
      try {
        let camp = campaign;
        if (!camp) {
          camp = await campaignsApi.getCampaignById(organization, campaignId);
          if (camp?.campaingId) upsertCachedCampaign(camp);
          if (mountedRef.current) setCampaign(camp);
        }
        if (opts.rebuild) await campaignsApi.rebuildResults(organization, campaignId);
        const tplId = String(camp?.wabaTemplateId || '');
        const [res, sched, tpl] = await Promise.all([
          campaignsApi.getResults(organization, campaignId),
          campaignsApi.getWaitingScheduled(organization),
          templateName || !tplId ? Promise.resolve(null) : campaignsApi.getTemplateById(organization, tplId).catch(() => null),
        ]);
        if (!mountedRef.current) return;
        setRuns(res);
        setEntries(sched);
        if (tpl?.name) setTemplateName(String(tpl.friendlyName || tpl.name));
        // Click tracking is stored by template NAME (tid in the URL), not by document id.
        const key = String(tpl?.name || camp?.wabaTemplateName || templateName || tplId);
        const cs = await campaignsApi.getClickStats(organization, key);
        if (mountedRef.current) setClicks(cs);
        invalidateRunSummary(campaignId);
      } catch (e: any) {
        if (mountedRef.current && !opts.silent) setError(e?.message || (he ? 'טעינת התוצאות נכשלה' : 'Failed to load results'));
      } finally {
        if (mountedRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [organization, campaignId, campaign, templateName, he],
  );

  useEffect(() => {
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organization, campaignId]);

  const anyInProcess = useMemo(
    () => runs.some((r) => /process|queue|sending|pending/i.test(String(r.Status || ''))),
    [runs],
  );

  // While a run is still sending, keep refreshing quietly.
  useEffect(() => {
    if (!anyInProcess) return;
    const t = setInterval(() => fetchAll({ silent: true }), POLL_MS);
    return () => clearInterval(t);
  }, [anyInProcess, fetchAll]);

  const totals = useMemo(() => {
    const acc = { contacts: 0, sent: 0, delivered: 0, read: 0, failed: 0, clicks: 0, replies: 0, unsubscribed: 0 };
    runs.forEach((r) => {
      const st = computeRunStats(r);
      const s = r.CampaignResultSummary || {};
      acc.contacts += st.total;
      acc.sent += st.sent;
      acc.delivered += st.delivered;
      acc.read += st.read;
      acc.failed += st.failed;
      acc.clicks += num(s.NumberOfClickButton);
      acc.replies += num(s.NumberOfReplyMessage);
      acc.unsubscribed += st.unsubscribed;
    });
    return acc;
  }, [runs]);

  const status = useMemo(
    () => (campaign ? deriveStatus(campaign, entries, summarizeRuns(runs)) : { key: 'draft' as const }),
    [campaign, entries, runs],
  );
  const st = STATUS_STYLE[status.key];
  const isSystem = !!campaign?.isSystem;
  const totalLinkClicks = num(clicks?.totalClicks);

  const onRefresh = () => {
    setRefreshing(true);
    // Rebuild delivered/read counters from the authoritative message docs first (same as the web's refresh).
    fetchAll({ rebuild: true });
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <WaHeader
        title={campaign?.campaignName || (he ? 'תוצאות קמפיין' : 'Campaign results')}
        subtitle={he ? 'תוצאות' : 'Results'}
        actions={[{ icon: 'refresh', onPress: onRefresh, disabled: refreshing }]}
      />

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 12, paddingBottom: insets.bottom + 90, gap: 12 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[theme.colors.primary]} />}
        >
          {error ? (
            <View style={[styles.card, { backgroundColor: withAlpha(theme.colors.error, 0.1) }]}>
              <Text style={{ color: theme.colors.error, textAlign }}>{error}</Text>
              <Button onPress={() => fetchAll()}>{he ? 'נסה שוב' : 'Retry'}</Button>
            </View>
          ) : null}

          {/* Overview */}
          <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
            <View style={[styles.rowWrap, { flexDirection }]}>
              <View style={[styles.pill, { backgroundColor: withAlpha(st.color, 0.12) }]}>
                <MaterialCommunityIcons name={st.icon as any} size={14} color={st.color} />
                <Text style={{ color: st.color, fontSize: 12, fontWeight: '700' }}>{he ? st.he : st.en}</Text>
              </View>
              {templateName ? (
                <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 12, flex: 1, textAlign }} numberOfLines={1}>
                  {templateName}
                </Text>
              ) : null}
            </View>
            {status.key === 'scheduled' && status.nextRun ? (
              <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 12, textAlign }}>
                {(he ? 'הריצה הבאה: ' : 'Next run: ') + formatWhen(status.nextRun, he)}
              </Text>
            ) : null}
            {anyInProcess ? (
              <View style={[styles.rowWrap, { flexDirection }]}>
                <ActivityIndicator size={14} color={theme.colors.primary} />
                <Text style={{ color: theme.colors.primary, fontSize: 12, fontWeight: '600' }}>
                  {he ? 'שליחה בתהליך — מתעדכן אוטומטית' : 'Sending in progress — updating automatically'}
                </Text>
              </View>
            ) : null}

            {runs.length > 0 && (
              <>
                <View style={[styles.tiles, { flexDirection }]}>
                  <Tile label={he ? 'נשלחו' : 'Sent'} value={totals.sent} color="#64748b" icon="send" />
                  <Tile label={he ? 'נמסרו' : 'Delivered'} value={totals.delivered} color="#16a34a" icon="check-all" />
                  <Tile label={he ? 'נקראו' : 'Read'} value={totals.read} color="#2563eb" icon="eye-outline" />
                  <Tile label={he ? 'נכשלו' : 'Failed'} value={totals.failed} color="#dc2626" icon="alert-circle-outline" />
                </View>
                <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 11, textAlign }}>
                  {he
                    ? `${runs.length} ריצות · ${totals.contacts} נמענים`
                    : `${runs.length} run${runs.length === 1 ? '' : 's'} · ${totals.contacts} recipients`}
                  {totals.replies > 0 ? (he ? ` · ${totals.replies} תגובות` : ` · ${totals.replies} replies`) : ''}
                  {totals.clicks > 0 ? (he ? ` · ${totals.clicks} לחיצות על כפתור` : ` · ${totals.clicks} button clicks`) : ''}
                  {totals.unsubscribed > 0 ? (he ? ` · ${totals.unsubscribed} הסרות` : ` · ${totals.unsubscribed} unsubscribed`) : ''}
                </Text>
              </>
            )}
          </View>

          {/* Link clicks (cheap: from GetBulkTemplateClickStats) */}
          {totalLinkClicks > 0 && (
            <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
              <View style={[styles.rowWrap, { flexDirection }]}>
                <MaterialCommunityIcons name="cursor-default-click-outline" size={18} color={theme.colors.primary} />
                <Text style={{ color: theme.colors.onSurface, fontWeight: '700', flex: 1, textAlign }}>
                  {he ? `${totalLinkClicks} לחיצות על קישורי התבנית` : `${totalLinkClicks} clicks on the template links`}
                </Text>
              </View>
              {clicks?.buttonBreakdown
                ? Object.entries(clicks.buttonBreakdown).map(([label, count]) => (
                    <View key={label} style={[styles.rowWrap, { flexDirection, justifyContent: 'space-between' }]}>
                      <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 12 }} numberOfLines={1}>
                        {label}
                      </Text>
                      <Text style={{ color: theme.colors.onSurface, fontSize: 12, fontWeight: '700' }}>{String(count)}</Text>
                    </View>
                  ))
                : null}
              <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 10, textAlign }}>
                {he ? 'כל הלחיצות על התבנית (כל הקמפיינים שמשתמשים בה).' : 'All clicks on this template (across every campaign using it).'}
              </Text>
            </View>
          )}

          {/* Runs */}
          {runs.length === 0 && !error ? (
            <View style={styles.empty}>
              <MaterialCommunityIcons name="send-clock-outline" size={44} color={theme.colors.onSurfaceVariant} />
              <Text style={[styles.emptyTitle, { color: theme.colors.onSurface }]}>
                {he ? 'עדיין אין ריצות לקמפיין הזה' : 'No runs for this campaign yet'}
              </Text>
              {status.key === 'scheduled' && status.nextRun ? (
                <Text style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center' }}>
                  {(he ? 'הריצה הראשונה מתוזמנת ל-' : 'First run scheduled for ') + formatWhen(status.nextRun, he)}
                </Text>
              ) : null}
            </View>
          ) : null}

          {runs.map((r, idx) => {
            const stats = computeRunStats(r);
            const key = r.CampaignResultsId || String(idx);
            const isOpen = expanded === key;
            const inProc = /process|queue|sending|pending/i.test(String(r.Status || ''));
            const failedRows = (r.CampaignRecipientData || []).filter((rd) => {
              const s = String(rd?.Status || '').toLowerCase();
              return s === 'failed' || s === 'undelivered' || s === 'not delivered';
            });
            const s = r.CampaignResultSummary || {};
            return (
              <View key={key} style={[styles.card, { backgroundColor: theme.colors.surface }]}>
                <Pressable onPress={() => setExpanded(isOpen ? null : key)} style={[styles.rowWrap, { flexDirection }]}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={{ color: theme.colors.onSurface, fontWeight: '700', textAlign }}>
                      {formatWhen(r.RunsAt, he) || (he ? 'ריצה' : 'Run')}
                    </Text>
                    <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 11, textAlign }}>
                      {[
                        r.RunsByName,
                        r.BulkStart != null && r.BulkEnd != null ? `${r.BulkStart}–${r.BulkEnd}` : '',
                        r.Source ? String(r.Source) : '',
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.pill,
                      { backgroundColor: withAlpha(inProc ? '#2563eb' : r.Error ? '#dc2626' : '#16a34a', 0.12) },
                    ]}
                  >
                    <Text style={{ fontSize: 11, fontWeight: '700', color: inProc ? '#2563eb' : r.Error ? '#dc2626' : '#16a34a' }}>
                      {inProc ? (he ? 'בתהליך' : 'In progress') : r.Error ? (he ? 'שגיאה' : 'Error') : he ? 'הסתיים' : 'Finished'}
                    </Text>
                  </View>
                  <MaterialCommunityIcons
                    name={isOpen ? 'chevron-up' : 'chevron-down'}
                    size={20}
                    color={theme.colors.onSurfaceVariant}
                  />
                </Pressable>

                <Bar label={he ? 'נשלחו' : 'Sent'} value={stats.sent} total={stats.total} color="#64748b" />
                <Bar label={he ? 'נמסרו' : 'Delivered'} value={stats.delivered} total={stats.total} color="#16a34a" />
                <Bar label={he ? 'נקראו' : 'Read'} value={stats.read} total={stats.total} color="#2563eb" />
                {stats.failed > 0 && <Bar label={he ? 'נכשלו' : 'Failed'} value={stats.failed} total={stats.total} color="#dc2626" />}

                {isOpen && (
                  <View style={{ gap: 6 }}>
                    <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 12, textAlign }}>
                      {he ? `סה״כ נמענים: ${stats.total}` : `Total recipients: ${stats.total}`}
                      {stats.pending > 0 ? (he ? ` · ממתינים ${stats.pending}` : ` · ${stats.pending} pending`) : ''}
                      {stats.skipped > 0 ? (he ? ` · דולגו ${stats.skipped}` : ` · ${stats.skipped} skipped`) : ''}
                      {num(s.NumberOfReplyMessage) > 0 ? (he ? ` · ${num(s.NumberOfReplyMessage)} תגובות` : ` · ${num(s.NumberOfReplyMessage)} replies`) : ''}
                      {num(s.NumberOfClickButton) > 0 ? (he ? ` · ${num(s.NumberOfClickButton)} לחיצות` : ` · ${num(s.NumberOfClickButton)} clicks`) : ''}
                    </Text>
                    {s.ButtonClickStats && Object.keys(s.ButtonClickStats).length > 0
                      ? Object.entries(s.ButtonClickStats as Record<string, number>).map(([label, count]) => (
                          <Text key={label} style={{ color: theme.colors.onSurfaceVariant, fontSize: 12, textAlign }}>
                            {`• ${label}: ${count}`}
                          </Text>
                        ))
                      : null}
                    {r.Error ? (
                      <Text style={{ color: theme.colors.error, fontSize: 12, textAlign }}>{String(r.Error)}</Text>
                    ) : null}
                    {failedRows.length > 0 && (
                      <View style={{ gap: 4 }}>
                        <Text style={{ color: theme.colors.error, fontWeight: '700', fontSize: 12, textAlign }}>
                          {he ? `נכשלו (${failedRows.length})` : `Failed (${failedRows.length})`}
                        </Text>
                        {failedRows.slice(0, FAILED_ROWS_LIMIT).map((rd, i) => (
                          <View key={`${rd.PhoneNumber}-${i}`} style={{ gap: 1 }}>
                            <Text style={{ color: theme.colors.onSurface, fontSize: 12, textAlign }}>{rd.PhoneNumber}</Text>
                            {rd.errorMessage ? (
                              <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 11, textAlign }} numberOfLines={2}>
                                {String(rd.errorMessage)}
                              </Text>
                            ) : null}
                          </View>
                        ))}
                        {failedRows.length > FAILED_ROWS_LIMIT && (
                          <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 11, textAlign }}>
                            {he
                              ? `ועוד ${failedRows.length - FAILED_ROWS_LIMIT}… (הרשימה המלאה באתר)`
                              : `and ${failedRows.length - FAILED_ROWS_LIMIT} more… (full list on the web app)`}
                          </Text>
                        )}
                      </View>
                    )}
                  </View>
                )}
              </View>
            );
          })}
        </ScrollView>
      )}

      {!isSystem && campaign && !loading && (
        <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 10, backgroundColor: theme.colors.surface }]}>
          <Button
            mode="contained"
            icon="play"
            onPress={() => router.push({ pathname: '/(tabs)/more/campaigns/wa-run', params: { id: campaignId } } as any)}
            buttonColor={theme.colors.primary}
          >
            {he ? 'הרץ שוב' : 'Run again'}
          </Button>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: { borderRadius: borderRadius.lg, padding: 14, gap: 10 },
  rowWrap: { alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 },
  tiles: { gap: 8 },
  tile: { flex: 1, borderRadius: 10, paddingVertical: 10, alignItems: 'center', gap: 2 },
  tileValue: { fontSize: 18, fontWeight: '800' },
  tileLabel: { fontSize: 10 },
  barHead: { justifyContent: 'space-between' },
  barLabel: { fontSize: 11 },
  barTrack: { height: 6, borderRadius: 3, overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 3 },
  empty: { alignItems: 'center', paddingTop: 50, gap: 10, paddingHorizontal: 24 },
  emptyTitle: { fontSize: 15, fontWeight: '700', textAlign: 'center' },
  bottomBar: { paddingHorizontal: 12, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(0,0,0,0.1)' },
});
