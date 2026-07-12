import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, ScrollView, RefreshControl, Pressable } from 'react-native';
import { Appbar, Surface, Text, Chip, ActivityIndicator } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAppTheme } from '../../../../hooks/useAppTheme';
import { useRTL } from '../../../../hooks/useRTL';
import { useAuthStore } from '../../../../stores/authStore';
import axiosInstance from '../../../../services/api/axiosInstance';
import { ENDPOINTS } from '../../../../constants/api';

const BRAND = '#2563eb';

type Frequency = 'daily' | 'weekly' | 'monthly';
type FilterKey = 'all' | Frequency;

interface ScheduledReport {
  id: string;
  type: string;
  reportName?: string;
  reportMode?: string;
  createdOn?: string | null;
  status?: string;
  sections?: string[] | null;
  hasContent?: boolean;
}

const FREQ_META: Record<Frequency, { icon: string; color: string; he: string; en: string }> = {
  daily: { icon: 'calendar-today', color: '#27AE60', he: 'יומי', en: 'Daily' },
  weekly: { icon: 'calendar-week', color: '#4A90D9', he: 'שבועי', en: 'Weekly' },
  monthly: { icon: 'calendar-month', color: '#7C3AED', he: 'חודשי', en: 'Monthly' },
};

function normalizeFreq(type?: string): Frequency {
  const t = (type || '').toLowerCase();
  if (t === 'weekly') return 'weekly';
  if (t === 'monthly') return 'monthly';
  return 'daily';
}

export default function ScheduledReportsScreen() {
  const router = useRouter();
  const theme = useAppTheme();
  const { isRTL } = useRTL();
  const user = useAuthStore((s) => s.user);
  const org = user?.organization || '';

  const [reports, setReports] = useState<ScheduledReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<FilterKey>('all');

  const fetchReports = useCallback(async () => {
    if (!org) return;
    try {
      const res = await axiosInstance.post(ENDPOINTS.GET_SCHEDULED_REPORTS, { organization: org, limit: 100 });
      const list = res.data?.reports || res.data?.Reports || [];
      setReports(Array.isArray(list) ? list : []);
    } catch {
      setReports([]);
    } finally {
      setLoading(false);
    }
  }, [org]);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchReports();
    setRefreshing(false);
  }, [fetchReports]);

  // Only offer frequency filters that actually have reports, so an org with just a daily report
  // doesn't see empty Weekly/Monthly tabs.
  const availableFreqs = useMemo(() => {
    const set = new Set<Frequency>();
    reports.forEach((r) => set.add(normalizeFreq(r.type)));
    return (['daily', 'weekly', 'monthly'] as Frequency[]).filter((f) => set.has(f));
  }, [reports]);

  const visibleReports = useMemo(() => {
    const filtered = filter === 'all' ? reports : reports.filter((r) => normalizeFreq(r.type) === filter);
    return [...filtered].sort((a, b) => (b.createdOn || '').localeCompare(a.createdOn || ''));
  }, [reports, filter]);

  const formatDate = (iso?: string | null) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString(isRTL ? 'he-IL' : 'en-US', {
      weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    }) + ' · ' + d.toLocaleTimeString(isRTL ? 'he-IL' : 'en-US', { hour: '2-digit', minute: '2-digit' });
  };

  const filterLabel = (f: FilterKey) => {
    if (f === 'all') return isRTL ? 'הכל' : 'All';
    return isRTL ? FREQ_META[f].he : FREQ_META[f].en;
  };

  const openReport = (r: ScheduledReport) => {
    router.push({ pathname: '/(tabs)/more/reports/view', params: { reportId: r.id } });
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Appbar.Header style={{ backgroundColor: BRAND }}>
        <Appbar.BackAction onPress={() => router.back()} color="#fff" />
        <Appbar.Content
          title={isRTL ? 'דוחות מתוזמנים' : 'Scheduled reports'}
          titleStyle={styles.headerTitle}
        />
      </Appbar.Header>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={BRAND} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[BRAND]} />}
          showsVerticalScrollIndicator={false}
        >
          {/* Frequency filter */}
          {availableFreqs.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow}>
              {(['all', ...availableFreqs] as FilterKey[]).map((f) => {
                const selected = filter === f;
                const color = f === 'all' ? BRAND : FREQ_META[f as Frequency].color;
                return (
                  <Chip
                    key={f}
                    selected={selected}
                    onPress={() => setFilter(f)}
                    style={[styles.chip, selected && { backgroundColor: color + '20', borderColor: color, borderWidth: 1 }]}
                    textStyle={selected ? { color, fontWeight: '700' } : { color: theme.colors.onSurfaceVariant }}
                  >
                    {filterLabel(f)}
                  </Chip>
                );
              })}
            </ScrollView>
          )}

          {visibleReports.length === 0 ? (
            <View style={styles.emptyState}>
              <MaterialCommunityIcons name="file-chart-outline" size={64} color={theme.colors.onSurfaceVariant} />
              <Text variant="bodyLarge" style={{ color: theme.colors.onSurfaceVariant, marginTop: 16, textAlign: 'center' }}>
                {isRTL ? 'אין עדיין דוחות מתוזמנים' : 'No scheduled reports yet'}
              </Text>
              <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: 6, textAlign: 'center', paddingHorizontal: 32 }}>
                {isRTL
                  ? 'דוחות יומיים / שבועיים / חודשיים שנשלחים במייל יופיעו כאן לצפייה'
                  : 'Daily / weekly / monthly reports sent by email will appear here to view'}
              </Text>
            </View>
          ) : (
            visibleReports.map((r) => {
              const freq = normalizeFreq(r.type);
              const meta = FREQ_META[freq];
              return (
                <Pressable key={r.id} onPress={() => openReport(r)}>
                  <Surface style={[styles.card, { backgroundColor: theme.colors.surface }]} elevation={1}>
                    <View style={[styles.cardIcon, { backgroundColor: meta.color + '18' }]}>
                      <MaterialCommunityIcons name={meta.icon as any} size={22} color={meta.color} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text
                        variant="bodyLarge"
                        style={{ color: theme.colors.onSurface, fontWeight: '700', textAlign: isRTL ? 'right' : 'left' }}
                        numberOfLines={1}
                      >
                        {r.reportName || (isRTL ? meta.he : meta.en)}
                      </Text>
                      <View style={[styles.metaRow, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
                        <View style={[styles.freqBadge, { backgroundColor: meta.color + '18' }]}>
                          <Text style={{ color: meta.color, fontSize: 11, fontWeight: '700' }}>
                            {isRTL ? meta.he : meta.en}
                          </Text>
                        </View>
                        <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                          {formatDate(r.createdOn)}
                        </Text>
                      </View>
                    </View>
                    <MaterialCommunityIcons
                      name={isRTL ? 'chevron-left' : 'chevron-right'}
                      size={24}
                      color={theme.colors.onSurfaceVariant}
                    />
                  </Surface>
                </Pressable>
              );
            })
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { color: '#fff', fontWeight: '700', fontSize: 18 },
  content: { padding: 16 },
  filterRow: { marginBottom: 12 },
  chip: { marginRight: 8, borderRadius: 999 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
    gap: 12,
  },
  cardIcon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  metaRow: { alignItems: 'center', gap: 8, marginTop: 4 },
  freqBadge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  emptyState: { alignItems: 'center', justifyContent: 'center', paddingVertical: 64 },
});
