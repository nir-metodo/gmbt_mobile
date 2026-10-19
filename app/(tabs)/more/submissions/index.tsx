import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { IconButton, Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../../../stores/authStore';
import { useAppTheme } from '../../../../hooks/useAppTheme';
import { useRTL } from '../../../../hooks/useRTL';
import { useRowDirection } from '../../../../hooks/useRowDirection';
import { useDebouncedValue, useWindowedList } from '../../../../hooks/useWindowedList';
import { hasPermission } from '../../../../constants/permissions';
import { ScreenHeader } from '../../../../components/ScreenHeader';
import { ListToolbar } from '../../../../components/ListToolbar';
import { ListPaginationFooter } from '../../../../components/ListPaginationFooter';
import { EmptyState } from '../../../../components/EmptyState';
import { BRAND, ChipRow, PeriodChips } from '../../../../components/dashboard/ui';
import SubmissionsAnalyticsView from '../../../../components/submissions/SubmissionsAnalyticsView';
import SubmissionDetailSheet from '../../../../components/submissions/SubmissionDetailSheet';
import { submissionsApi, type SubmissionRecord, type SubmissionSource } from '../../../../services/api/submissions';
import { formatDateTime } from '../../../../utils/formatters';
import { rangeBounds, rangeForPeriod, type PeriodKey } from '../../../../utils/datePresets';
import {
  applyTypedFilters,
  countActiveFilters,
  displayValue,
  fieldKind,
  isFilterActive,
  type FilterMap,
  type InsightItem,
  type TypedFilter,
} from '../../../../utils/submissionsInsights';

type KindFilter = 'all' | 'form' | 'document';
type Tab = 'responses' | 'analytics';

const FORM_COLOR = '#0d9488';
const DOC_COLOR = '#7c3aed';

const sourceKeyOf = (kind: string, id: string) => `${kind}:${id}`;
const recordKey = (r: SubmissionRecord) => `${r.kind}:${r.id}`;

export default function SubmissionsScreen() {
  const router = useRouter();
  const theme = useAppTheme();
  const { t } = useTranslation();
  const { textAlign } = useRTL();
  const dir = useRowDirection();
  const user = useAuthStore((s) => s.user);
  const organization = user?.organization || '';

  const canForms = hasPermission(user?.Permissions, user?.SecurityRole, 'webForms');
  const canDocs = hasPermission(user?.Permissions, user?.SecurityRole, 'documentTemplates');

  const [records, setRecords] = useState<SubmissionRecord[]>([]);
  const [sources, setSources] = useState<SubmissionSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [tab, setTab] = useState<Tab>('responses');
  const [kind, setKind] = useState<KindFilter>('all');
  const [sourceKey, setSourceKey] = useState<string>('all');
  const [period, setPeriod] = useState<PeriodKey>('all');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 350);
  const [fieldFilters, setFieldFilters] = useState<FilterMap>({});
  const [selected, setSelected] = useState<SubmissionRecord | null>(null);

  const load = useCallback(async () => {
    if (!organization) {
      setLoading(false);
      return;
    }
    setError(null);
    const jobs: Promise<any>[] = [];
    if (canForms) jobs.push(submissionsApi.getWebFormSubmissions(organization));
    if (canDocs) jobs.push(submissionsApi.getDocumentSubmissions(organization));
    const results = await Promise.allSettled(jobs);
    const okRecords: SubmissionRecord[] = [];
    const okSources: SubmissionSource[] = [];
    let failed = 0;
    results.forEach((r) => {
      if (r.status === 'fulfilled') {
        okRecords.push(...r.value.records);
        okSources.push(...r.value.sources);
      } else {
        failed += 1;
      }
    });
    setRecords(okRecords);
    setSources(okSources);
    if (results.length > 0 && failed === results.length) setError(t('submissions.loadFailed'));
    setLoading(false);
  }, [organization, canForms, canDocs, t]);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  // Which kinds are available (a single available kind hides the kind switch).
  const kindOptions = useMemo(() => {
    const opts: { key: KindFilter; label: string; icon: string }[] = [];
    if (canForms && canDocs) opts.push({ key: 'all', label: t('common.all'), icon: 'view-grid-outline' });
    if (canForms) opts.push({ key: 'form', label: t('submissions.kindForms'), icon: 'clipboard-text-outline' });
    if (canDocs) opts.push({ key: 'document', label: t('submissions.kindDocuments'), icon: 'file-document-outline' });
    return opts;
  }, [canForms, canDocs, t]);

  const kindScoped = useMemo(() => (kind === 'all' ? records : records.filter((r) => r.kind === kind)), [records, kind]);
  const sourcesInKind = useMemo(() => (kind === 'all' ? sources : sources.filter((s) => s.kind === kind)), [sources, kind]);

  // Changing the kind / source invalidates per-field filters (fields differ between forms).
  useEffect(() => {
    setSourceKey('all');
  }, [kind]);
  useEffect(() => {
    setFieldFilters({});
  }, [sourceKey, kind]);

  const scopedSource = useMemo(
    () => (sourceKey === 'all' ? null : sourcesInKind.find((s) => sourceKeyOf(s.kind, s.id) === sourceKey) || null),
    [sourceKey, sourcesInKind],
  );
  const scopedFields = scopedSource?.fields || [];

  const recordByKey = useMemo(() => {
    const m = new Map<string, SubmissionRecord>();
    records.forEach((r) => m.set(recordKey(r), r));
    return m;
  }, [records]);

  const toItem = useCallback((r: SubmissionRecord): InsightItem => ({ id: recordKey(r), submittedAt: r.submittedAt, data: r.data }), []);

  // scope (kind + source)
  const scopeRecords = useMemo(
    () => (scopedSource ? kindScoped.filter((r) => sourceKeyOf(r.kind, r.sourceId) === sourceKey) : kindScoped),
    [kindScoped, scopedSource, sourceKey],
  );
  const scopeItems = useMemo(() => scopeRecords.map(toItem), [scopeRecords, toItem]);

  // + free-text search + typed field filters (before the period so KPI tiles can show per-period counts)
  const baseItems = useMemo(() => {
    let list = scopeItems;
    const q = debouncedSearch.trim().toLowerCase();
    if (q) {
      list = list.filter((it) => {
        const r = recordByKey.get(it.id);
        if (!r) return false;
        const hay = [r.name, r.phone, r.email, r.sourceTitle, ...Object.values(r.data)].join(' ').toLowerCase();
        return hay.includes(q);
      });
    }
    if (scopedSource) list = applyTypedFilters(list, scopedFields, fieldFilters);
    return list;
  }, [scopeItems, debouncedSearch, recordByKey, scopedSource, scopedFields, fieldFilters]);

  const filteredItems = useMemo(() => {
    if (period === 'all') return baseItems;
    const r = rangeForPeriod(period);
    const { start, end } = rangeBounds(r.from, r.to);
    return baseItems.filter((it) => {
      const d = it.submittedAt ? new Date(it.submittedAt) : null;
      if (!d || Number.isNaN(d.getTime())) return false;
      if (start && d < start) return false;
      if (end && d > end) return false;
      return true;
    });
  }, [baseItems, period]);

  const filteredRecords = useMemo(
    () =>
      filteredItems
        .map((it) => recordByKey.get(it.id))
        .filter((r): r is SubmissionRecord => !!r)
        .sort((a, b) => (b.submittedAt || '').localeCompare(a.submittedAt || '')),
    [filteredItems, recordByKey],
  );

  const activeFieldFilters = useMemo(() => countActiveFilters(scopedFields, fieldFilters), [scopedFields, fieldFilters]);
  const hasActiveFilters = activeFieldFilters > 0 || !!debouncedSearch.trim() || period !== 'all';

  const clearFilters = () => {
    setFieldFilters({});
    setSearch('');
    setPeriod('all');
  };

  const setFieldFilter = useCallback((key: string, value: TypedFilter) => setFieldFilters((prev) => ({ ...prev, [key]: value })), []);

  // Source chips / "responses by source" follow the active filters.
  const sourceCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    filteredItems.forEach((it) => {
      const r = recordByKey.get(it.id);
      if (r) counts[sourceKeyOf(r.kind, r.sourceId)] = (counts[sourceKeyOf(r.kind, r.sourceId)] || 0) + 1;
    });
    return counts;
  }, [filteredItems, recordByKey]);

  const sourceBars = useMemo(
    () =>
      sourcesInKind
        .map((s) => ({ id: sourceKeyOf(s.kind, s.id), label: s.title, count: sourceCounts[sourceKeyOf(s.kind, s.id)] || 0 }))
        .filter((s) => s.count > 0)
        .sort((a, b) => b.count - a.count),
    [sourcesInKind, sourceCounts],
  );

  const sourceChipOptions = useMemo(
    () => [
      { key: 'all', label: `${t('submissions.allSources')} (${kindScoped.length})` },
      ...sourcesInKind.map((s) => ({ key: sourceKeyOf(s.kind, s.id), label: `${s.title || t('submissions.noName')} (${s.count})` })),
    ],
    [sourcesInKind, kindScoped.length, t],
  );

  // Human-readable list of the active per-field filters (shown in the banner).
  const filterChips = useMemo(() => {
    const yes = t('submissions.yes');
    const no = t('submissions.no');
    const chips: { key: string; text: string }[] = [];
    scopedFields.forEach((fl) => {
      const f = fieldFilters[fl.key];
      if (!isFilterActive(fieldKind(fl.type), f)) return;
      let val = '';
      if (Array.isArray(f.values)) val = f.values.join(', ');
      else if (f.value === 'true' || f.value === 'false') val = f.value === 'true' ? yes : no;
      else if (f.filled) val = f.filled === 'yes' ? t('submissions.filled') : t('submissions.empty');
      else if (f.q) val = f.q;
      else {
        const lo = f.min ?? f.from ?? '';
        const hi = f.max ?? f.to ?? '';
        val = `${lo !== '' ? lo : '…'} – ${hi !== '' ? hi : '…'}`;
      }
      chips.push({ key: fl.key, text: `${fl.label}: ${val}` });
    });
    return chips;
  }, [scopedFields, fieldFilters, t]);

  const { visible, hasMore, loadMore, loadAll, count } = useWindowedList(filteredRecords, {
    pageSize: 30,
    resetKey: `${kind}|${sourceKey}|${period}|${debouncedSearch}|${JSON.stringify(fieldFilters)}`,
  });

  const openChat = useCallback(
    (phone: string) => {
      setSelected(null);
      router.push({ pathname: '/(tabs)/chats/[phoneNumber]', params: { phoneNumber: phone } } as any);
    },
    [router],
  );

  const resolvePdf = useCallback(
    async (r: SubmissionRecord) => (r.formId ? submissionsApi.getWebFormPdfUrl(organization, r.formId, r.id) : null),
    [organization],
  );

  const yes = t('submissions.yes');
  const no = t('submissions.no');

  const renderCard = useCallback(
    ({ item }: { item: SubmissionRecord }) => {
      const title = item.name || item.phone || item.email || t('submissions.noName');
      const accent = item.kind === 'form' ? FORM_COLOR : DOC_COLOR;
      const chips = item.rows
        .filter((r) => r.value && !r.value.startsWith('data:image') && r.type !== 'signature' && r.type !== 'file')
        .slice(0, 2);
      return (
        <Pressable
          onPress={() => setSelected(item)}
          style={({ pressed }) => [
            styles.card,
            { backgroundColor: theme.colors.surface, borderColor: theme.colors.outlineVariant || '#e2e8f0', borderStartColor: accent, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <View style={[styles.cardTop, { flexDirection: dir }]}>
            <View style={[styles.avatar, { backgroundColor: accent }]}>
              <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15 }}>{title.trim().charAt(0).toUpperCase() || '?'}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={{ fontSize: 15, fontWeight: '700', color: theme.colors.onSurface, textAlign }}>
                {title}
              </Text>
              <Text numberOfLines={1} style={{ fontSize: 12, color: theme.colors.onSurfaceVariant, textAlign }}>
                {[item.sourceTitle, formatDateTime(item.submittedAt)].filter(Boolean).join(' · ')}
              </Text>
            </View>
            {item.signed ? (
              <View style={[styles.badge, { backgroundColor: '#f3e8ff' }]}>
                <Text style={{ fontSize: 11, fontWeight: '700', color: '#5b21b6' }}>{t('submissions.signed')}</Text>
              </View>
            ) : null}
            <MaterialCommunityIcons name="chevron-left" size={20} color={theme.colors.onSurfaceVariant} />
          </View>
          {chips.length > 0 ? (
            <View style={[styles.chips, { flexDirection: dir }]}>
              {chips.map((c) => (
                <View key={c.key} style={[styles.chip, { backgroundColor: theme.colors.surfaceVariant }]}>
                  <Text numberOfLines={1} style={{ fontSize: 12, color: theme.colors.onSurface }}>
                    <Text style={{ fontWeight: '700' }}>{c.label}: </Text>
                    {displayValue(c.value, yes, no)}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </Pressable>
      );
    },
    [dir, textAlign, theme, t, yes, no],
  );

  if (!canForms && !canDocs) {
    return (
      <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
        <ScreenHeader title={t('submissions.title')} onBack={() => router.back()} />
        <EmptyState icon="lock-outline" title={t('submissions.noAccess')} />
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
      <ScreenHeader
        title={t('submissions.title')}
        subtitle={loading ? undefined : t('submissions.totalCount', { count: records.length })}
        onBack={() => router.back()}
        actions={<IconButton icon="refresh" iconColor={theme.custom.headerText} onPress={onRefresh} disabled={refreshing} />}
      />

      <ListToolbar query={search} onChangeQuery={setSearch} placeholder={t('submissions.searchPlaceholder')} />

      {/* Responses | Analytics */}
      <ChipRow<Tab>
        value={tab}
        onChange={setTab}
        options={[
          { key: 'responses', label: t('submissions.tabResponses'), icon: 'format-list-bulleted' },
          { key: 'analytics', label: t('submissions.tabAnalytics'), icon: 'chart-bar' },
        ]}
      />

      <View style={{ backgroundColor: theme.colors.background }}>
        {kindOptions.length > 1 ? <ChipRow<KindFilter> value={kind} onChange={setKind} options={kindOptions} /> : null}
        {sourcesInKind.length > 1 ? <ChipRow<string> value={sourceKey} onChange={setSourceKey} options={sourceChipOptions} /> : null}
        <PeriodChips value={period} onChange={setPeriod} />
      </View>

      {hasActiveFilters ? (
        <View style={[styles.banner, { backgroundColor: BRAND + '12', borderColor: BRAND + '40' }]}>
          <View style={{ flexDirection: dir, alignItems: 'center', gap: 8 }}>
            <Text style={{ flex: 1, fontSize: 12.5, color: theme.colors.onSurface, textAlign }}>
              {t('submissions.showingOf', { shown: filteredItems.length, total: scopeItems.length })}
            </Text>
            <Pressable onPress={clearFilters} hitSlop={8} style={{ flexDirection: dir, alignItems: 'center', gap: 4 }}>
              <MaterialCommunityIcons name="close-circle-outline" size={16} color={BRAND} />
              <Text style={{ color: BRAND, fontWeight: '700', fontSize: 12.5 }}>{t('submissions.clearFilters')}</Text>
            </Pressable>
          </View>
          {filterChips.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ flexDirection: dir, gap: 6, marginTop: 6 }}>
              {filterChips.map((c) => (
                <Pressable key={c.key} onPress={() => setFieldFilter(c.key, {})} style={[styles.activeChip, { flexDirection: dir }]}>
                  <Text style={{ fontSize: 12, color: '#fff' }}>{c.text}</Text>
                  <MaterialCommunityIcons name="close" size={12} color="#fff" />
                </Pressable>
              ))}
            </ScrollView>
          ) : null}
        </View>
      ) : null}

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={BRAND} />
        </View>
      ) : error ? (
        <Pressable onPress={load} style={styles.centered}>
          <MaterialCommunityIcons name="alert-circle-outline" size={44} color={theme.colors.error} />
          <Text style={{ color: theme.colors.error, marginTop: 8 }}>{error}</Text>
          <Text style={{ color: BRAND, fontWeight: '700', marginTop: 6 }}>{t('common.retry')}</Text>
        </Pressable>
      ) : tab === 'analytics' ? (
        <ScrollView
          contentContainerStyle={{ paddingBottom: 40, paddingTop: 4 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[BRAND]} tintColor={BRAND} />}
        >
          <SubmissionsAnalyticsView
            items={filteredItems}
            baseItems={baseItems}
            scopeItems={scopeItems}
            fields={scopedFields}
            filters={fieldFilters}
            onFilterChange={setFieldFilter}
            sourceBars={sourceBars}
            onPickSource={setSourceKey}
          />
        </ScrollView>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={recordKey}
          renderItem={renderCard}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          contentContainerStyle={[styles.listContent, filteredRecords.length === 0 && { flexGrow: 1 }]}
          onEndReached={hasMore ? loadMore : undefined}
          onEndReachedThreshold={0.4}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[BRAND]} tintColor={BRAND} />}
          ListEmptyComponent={
            <EmptyState
              icon="clipboard-text-off-outline"
              title={records.length ? t('submissions.noMatch') : t('submissions.noSubmissions')}
              description={records.length ? undefined : t('submissions.noSubmissionsDesc')}
            />
          }
          ListFooterComponent={<ListPaginationFooter count={count} total={filteredRecords.length} hasMore={hasMore} onLoadMore={loadMore} onLoadAll={loadAll} />}
          showsVerticalScrollIndicator={false}
        />
      )}

      <SubmissionDetailSheet record={selected} onDismiss={() => setSelected(null)} onOpenChat={openChat} onResolvePdf={resolvePdf} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  listContent: { padding: 14, paddingBottom: 60 },
  card: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderStartWidth: 4, padding: 12, gap: 8 },
  cardTop: { alignItems: 'center', gap: 10 },
  avatar: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  chips: { flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, maxWidth: '100%' },
  banner: { marginHorizontal: 12, marginBottom: 6, padding: 10, borderRadius: 12, borderWidth: 1 },
  activeChip: { alignItems: 'center', gap: 4, backgroundColor: BRAND, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 14 },
});
