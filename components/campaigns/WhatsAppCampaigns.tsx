import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, RefreshControl, ScrollView, Alert } from 'react-native';
import { Text, Searchbar, Chip, FAB, Button, ActivityIndicator, Snackbar } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../stores/authStore';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useRTL } from '../../hooks/useRTL';
import { campaignsApi, WaCampaign, WaScheduledEntry, WaTemplate } from '../../services/api/campaigns';
import CampaignCard from './whatsapp/CampaignCard';
import { useRunSummaries, invalidateRunSummary } from './whatsapp/useRunSummaries';
import { cacheCampaigns, deriveStatus, DerivedStatus, templateKey } from './whatsapp/campaignUtils';

type FilterKey = 'all' | 'scheduled' | 'sent' | 'draft' | 'cancelled';

const BASE = '/(tabs)/more/campaigns';

/**
 * WhatsApp campaigns list (body only — the hub screen owns the app bar + channel toggle).
 * Port of gmbt_frontend Campaigns.js: same GetAllCampaigns / GetWaitingScheduledCampaignsByOrganization
 * sources, same derived scheduled / cancelled / completed logic.
 */
export default function WhatsAppCampaigns() {
  const router = useRouter();
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const { isRTL, flexDirection, textAlign } = useRTL();
  const { i18n } = useTranslation();
  const he = i18n.language !== 'en';
  const organization = useAuthStore((s) => s.user?.organization) as string | undefined;

  const [campaigns, setCampaigns] = useState<WaCampaign[]>([]);
  const [entries, setEntries] = useState<WaScheduledEntry[]>([]);
  const [templateNames, setTemplateNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [snack, setSnack] = useState('');
  const loadedOnceRef = useRef(false);

  const { get: getSummary, request: requestSummaries, pending } = useRunSummaries(organization);

  const load = useCallback(
    async (mode: 'initial' | 'refresh' | 'silent') => {
      if (!organization) return;
      if (mode === 'initial') setLoading(true);
      if (mode === 'refresh') setRefreshing(true);
      try {
        const [list, sched, tpls] = await Promise.all([
          campaignsApi.getAll(organization),
          campaignsApi.getWaitingScheduled(organization),
          campaignsApi.getTemplates(organization).catch(() => [] as WaTemplate[]),
        ]);
        cacheCampaigns(list);
        setCampaigns(list);
        setEntries(sched);
        const map: Record<string, string> = {};
        tpls.forEach((t) => {
          const label = String(t.friendlyName || t.name || '');
          [t.Id, t.id, t.name, templateKey(t)].forEach((k) => {
            if (k) map[String(k)] = label;
          });
        });
        setTemplateNames(map);
        setError('');
        if (mode !== 'silent') invalidateRunSummary();
        loadedOnceRef.current = true;
      } catch (e: any) {
        if (!loadedOnceRef.current || mode !== 'silent') {
          setError(e?.message || (he ? 'טעינת הקמפיינים נכשלה' : 'Failed to load campaigns'));
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [organization, he],
  );

  // Initial load + silent refresh whenever we come back from create / run / results.
  useFocusEffect(
    useCallback(() => {
      load(loadedOnceRef.current ? 'silent' : 'initial');
    }, [load]),
  );

  // Derived status per campaign (re-derived as lazy run summaries arrive).
  const statusById = useMemo(() => {
    const m = new Map<string, DerivedStatus>();
    campaigns.forEach((c) => m.set(c.campaingId, deriveStatus(c, entries, getSummary(c.campaingId))));
    return m;
    // `pending` changes whenever a summary lands, which is what re-derives statuses.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaigns, entries, getSummary, pending, refreshing]);

  const bucketOf = useCallback(
    (c: WaCampaign): FilterKey => {
      const s = statusById.get(c.campaingId)?.key;
      if (s === 'scheduled') return 'scheduled';
      if (s === 'sent' || s === 'completed') return 'sent';
      if (s === 'cancelled') return 'cancelled';
      return 'draft'; // draft / broken schedule / system
    },
    [statusById],
  );

  // "Sent" vs "Draft" for MANUAL campaigns can only be proven from run history → load it for them
  // when one of those filters is active (small concurrency, cached).
  useEffect(() => {
    if (filter !== 'sent' && filter !== 'draft') return;
    const ids = campaigns
      .filter((c) => !c.isSystem && statusById.get(c.campaingId)?.unresolved)
      .map((c) => c.campaingId)
      .slice(0, 80);
    if (ids.length) requestSummaries(ids);
  }, [filter, campaigns, statusById, requestSummaries]);

  const counts = useMemo(() => {
    const c: Record<FilterKey, number> = { all: campaigns.length, scheduled: 0, sent: 0, draft: 0, cancelled: 0 };
    campaigns.forEach((x) => {
      c[bucketOf(x)] += 1;
    });
    return c;
  }, [campaigns, bucketOf]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return campaigns.filter((c) => {
      if (filter !== 'all' && bucketOf(c) !== filter) return false;
      if (!q) return true;
      const tpl = templateNames[String(c.wabaTemplateId || '')] || '';
      return (c.campaignName || '').toLowerCase().includes(q) || tpl.toLowerCase().includes(q);
    });
  }, [campaigns, filter, search, bucketOf, templateNames]);

  // ── Actions ──
  const openResults = useCallback(
    (c: WaCampaign) => router.push({ pathname: `${BASE}/wa-results`, params: { id: c.campaingId } } as any),
    [router],
  );
  const runCampaign = useCallback(
    (c: WaCampaign) => router.push({ pathname: `${BASE}/wa-run`, params: { id: c.campaingId } } as any),
    [router],
  );
  const duplicate = useCallback(
    (c: WaCampaign) => router.push({ pathname: `${BASE}/wa-create`, params: { duplicateFrom: c.campaingId } } as any),
    [router],
  );

  const removeCampaign = useCallback(
    (c: WaCampaign) => {
      if (!organization) return;
      const st = statusById.get(c.campaingId)?.key;
      const warn =
        st === 'scheduled'
          ? he
            ? '\n\nהקמפיין מתוזמן — המחיקה תבטל גם את התזמון.'
            : '\n\nThis campaign is scheduled — deleting it also removes the schedule.'
          : '';
      Alert.alert(
        he ? 'מחיקת קמפיין' : 'Delete campaign',
        (he ? `למחוק את "${c.campaignName}"?` : `Delete "${c.campaignName}"?`) + warn,
        [
          { text: he ? 'ביטול' : 'Cancel', style: 'cancel' },
          {
            text: he ? 'מחק' : 'Delete',
            style: 'destructive',
            onPress: async () => {
              try {
                await campaignsApi.deleteCampaign(organization, c.campaingId);
                setCampaigns((prev) => prev.filter((x) => x.campaingId !== c.campaingId));
                invalidateRunSummary(c.campaingId);
                setSnack(he ? 'הקמפיין נמחק' : 'Campaign deleted');
              } catch (e: any) {
                setSnack(e?.message || (he ? 'המחיקה נכשלה' : 'Delete failed'));
              }
            },
          },
        ],
      );
    },
    [organization, statusById, he],
  );

  const cancelSchedule = useCallback(
    (c: WaCampaign) => {
      if (!organization) return;
      Alert.alert(
        he ? 'ביטול תזמון' : 'Cancel schedule',
        he ? 'האם אתה בטוח שברצונך לבטל את התזמון?' : 'Are you sure you want to cancel this schedule?',
        [
          { text: he ? 'לא' : 'No', style: 'cancel' },
          {
            text: he ? 'בטל תזמון' : 'Cancel schedule',
            style: 'destructive',
            onPress: async () => {
              try {
                await campaignsApi.cancelSchedule(organization, c.campaingId);
                setSnack(he ? 'התזמון בוטל' : 'Schedule cancelled');
                load('silent');
              } catch (e: any) {
                setSnack(e?.message || (he ? 'ביטול התזמון נכשל' : 'Cancelling the schedule failed'));
              }
            },
          },
        ],
      );
    },
    [organization, he, load],
  );

  const renderItem = useCallback(
    ({ item }: { item: WaCampaign }) => (
      <CampaignCard
        campaign={item}
        status={statusById.get(item.campaingId) || { key: 'draft' }}
        summary={getSummary(item.campaingId)}
        templateName={templateNames[String(item.wabaTemplateId || '')] || ''}
        he={he}
        onVisible={(id) => requestSummaries([id])}
        onOpen={openResults}
        onRun={runCampaign}
        onDuplicate={duplicate}
        onDelete={removeCampaign}
        onCancelSchedule={cancelSchedule}
      />
    ),
    // `pending` re-renders rows when a lazy summary lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [statusById, getSummary, templateNames, he, requestSummaries, openResults, runCampaign, duplicate, removeCampaign, cancelSchedule, pending],
  );

  const chips: Array<{ key: FilterKey; he: string; en: string }> = [
    { key: 'all', he: 'הכל', en: 'All' },
    { key: 'scheduled', he: 'מתוזמנים', en: 'Scheduled' },
    { key: 'sent', he: 'נשלחו', en: 'Sent' },
    { key: 'draft', he: 'טיוטות', en: 'Draft' },
    { key: 'cancelled', he: 'בוטלו', en: 'Cancelled' },
  ];

  const renderEmpty = () => {
    if (loading) return null;
    if (error) {
      return (
        <View style={styles.empty}>
          <MaterialCommunityIcons name="alert-circle-outline" size={44} color={theme.colors.error} />
          <Text style={[styles.emptyTitle, { color: theme.colors.onSurface }]}>{error}</Text>
          <Button mode="contained" onPress={() => load('initial')}>
            {he ? 'נסה שוב' : 'Retry'}
          </Button>
        </View>
      );
    }
    const filtered = campaigns.length > 0;
    return (
      <View style={styles.empty}>
        <MaterialCommunityIcons name="bullhorn-outline" size={48} color={theme.colors.onSurfaceVariant} />
        <Text style={[styles.emptyTitle, { color: theme.colors.onSurface }]}>
          {filtered ? (he ? 'לא נמצאו קמפיינים' : 'No campaigns found') : he ? 'עדיין אין קמפיינים' : 'No campaigns yet'}
        </Text>
        {!filtered && (
          <>
            <Text style={[styles.emptySub, { color: theme.colors.onSurfaceVariant }]}>
              {he ? 'צור קמפיין וואטסאפ ושלח הודעה לקבוצת אנשי קשר.' : 'Create a WhatsApp campaign to message a group of contacts.'}
            </Text>
            <Button mode="contained" icon="plus" onPress={() => router.push(`${BASE}/wa-create` as any)}>
              {he ? 'קמפיין חדש' : 'New campaign'}
            </Button>
          </>
        )}
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <View style={styles.searchWrap}>
        <Searchbar
          value={search}
          onChangeText={setSearch}
          placeholder={he ? 'חיפוש קמפיין או תבנית' : 'Search campaign or template'}
          style={[styles.search, { backgroundColor: theme.colors.surface }]}
          inputStyle={{ textAlign, minHeight: 0 }}
          elevation={0}
        />
      </View>

      <View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={[styles.chips, { flexDirection }]}
        >
          {chips.map((c) => (
            <Chip
              key={c.key}
              selected={filter === c.key}
              showSelectedCheck={false}
              onPress={() => setFilter(c.key)}
              style={[
                styles.chip,
                filter === c.key && { backgroundColor: theme.colors.primaryContainer },
              ]}
              textStyle={{ fontSize: 12, fontWeight: filter === c.key ? '700' : '500' }}
            >
              {`${he ? c.he : c.en} · ${counts[c.key]}`}
            </Chip>
          ))}
        </ScrollView>
        {(filter === 'sent' || filter === 'draft') && pending > 0 && (
          <Text style={[styles.checking, { color: theme.colors.onSurfaceVariant, textAlign }]}>
            {he ? `בודק היסטוריית שליחות… (${pending})` : `Checking run history… (${pending})`}
          </Text>
        )}
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      ) : (
        <FlashList
          data={visible}
          renderItem={renderItem}
          keyExtractor={(item) => item.campaingId}
          ListEmptyComponent={renderEmpty}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load('refresh')}
              colors={[theme.colors.primary]}
              tintColor={theme.colors.primary}
            />
          }
          contentContainerStyle={{ paddingBottom: insets.bottom + 96, paddingTop: 4 }}
        />
      )}

      <FAB
        icon="plus"
        onPress={() => router.push(`${BASE}/wa-create` as any)}
        style={[
          styles.fab,
          {
            backgroundColor: theme.colors.primary,
            bottom: insets.bottom + 16,
            left: isRTL ? 16 : undefined,
            right: isRTL ? undefined : 16,
          },
        ]}
        color="#FFFFFF"
      />

      <Snackbar visible={!!snack} onDismiss={() => setSnack('')} duration={3500}>
        {snack}
      </Snackbar>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  searchWrap: { paddingHorizontal: 12, paddingTop: 10 },
  search: { borderRadius: 12, height: 44 },
  chips: { paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  chip: { borderRadius: 18 },
  checking: { fontSize: 11, paddingHorizontal: 14, paddingBottom: 4 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { alignItems: 'center', justifyContent: 'center', paddingTop: 70, paddingHorizontal: 32, gap: 12 },
  emptyTitle: { fontSize: 16, fontWeight: '700', textAlign: 'center' },
  emptySub: { fontSize: 13, textAlign: 'center' },
  fab: { position: 'absolute' },
});
