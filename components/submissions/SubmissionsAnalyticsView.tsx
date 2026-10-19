import React, { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useRowDirection } from '../../hooks/useRowDirection';
import { BRAND, BarRow, ProgressBar, SectionCard, StatTile, fmtNum } from '../dashboard/ui';
import { MiniBars } from '../dashboard/charts';
import {
  buildFieldStats,
  buildTimeline,
  filterFromGroup,
  groupLabel,
  inLastDays,
  isGroupSelected,
  KIND_ICON,
  type FieldStats,
  type FilterMap,
  type InsightField,
  type InsightItem,
  type TypedFilter,
} from '../../utils/submissionsInsights';

export interface SourceBar {
  id: string;
  label: string;
  count: number;
}

interface Props {
  /** Items after every filter (scope + search + typed filters + period). */
  items: InsightItem[];
  /** Items before the period filter (used for the today / 7d / 30d tiles). */
  baseItems: InsightItem[];
  /** Everything in the current source scope, unfiltered (lists every answer option). */
  scopeItems: InsightItem[];
  /** Fields of the picked source; empty = "all sources" overview. */
  fields: InsightField[];
  filters: FilterMap;
  onFilterChange: (key: string, value: TypedFilter) => void;
  /** Counts per source for the overview (already limited to the current filters). */
  sourceBars: SourceBar[];
  onPickSource: (id: string) => void;
}

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : '0%');

/** Tappable answer bar: tapping filters the whole screen to that answer (tap again to undo). */
function AnswerBar({ label, count, base, top, selected, onPress }: { label: string; count: number; base: number; top: number; selected: boolean; onPress: () => void }) {
  const theme = useAppTheme();
  const dir = useRowDirection();
  const width = top > 0 ? Math.max(count > 0 ? 3 : 0, (count / top) * 100) : 0;
  return (
    <Pressable
      onPress={onPress}
      style={{
        marginBottom: 8,
        paddingVertical: 4,
        paddingHorizontal: 6,
        borderRadius: 8,
        backgroundColor: selected ? BRAND + '18' : 'transparent',
        borderWidth: selected ? 1 : 0,
        borderColor: BRAND,
      }}
    >
      <View style={{ flexDirection: dir, justifyContent: 'space-between', marginBottom: 3 }}>
        <Text numberOfLines={1} style={{ flex: 1, fontSize: 13, color: theme.colors.onSurface, fontWeight: selected ? '700' : '400' }}>
          {label}
        </Text>
        <Text style={{ fontSize: 13, fontWeight: '700', color: theme.colors.onSurface, marginStart: 8 }}>
          {fmtNum(count)}
          <Text style={{ fontSize: 11, fontWeight: '400', color: theme.colors.onSurfaceVariant }}>{base ? `  ${pct(count, base)}` : ''}</Text>
        </Text>
      </View>
      <View style={{ height: 6, borderRadius: 3, backgroundColor: theme.colors.surfaceVariant, overflow: 'hidden', flexDirection: dir }}>
        <View style={{ width: `${width}%`, backgroundColor: BRAND, borderRadius: 3 }} />
      </View>
    </Pressable>
  );
}

function FieldCard({
  stats,
  current,
  onPick,
  yes,
  no,
  locale,
}: {
  stats: FieldStats;
  current?: TypedFilter;
  onPick: (field: InsightField, key: string) => void;
  yes: string;
  no: string;
  locale: string;
}) {
  const { t } = useTranslation();
  const theme = useAppTheme();
  const dir = useRowDirection();
  const [showAll, setShowAll] = useState(false);
  const { field, kind } = stats;
  const rows = stats.rows || [];
  const max = kind === 'date' ? 12 : 6;
  const visible = showAll ? rows : rows.slice(0, max);
  const top = Math.max(1, ...rows.map((r) => r.count));
  const muted = { fontSize: 12, color: theme.colors.onSurfaceVariant } as const;

  return (
    <SectionCard>
      <View style={{ flexDirection: dir, alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <MaterialCommunityIcons name={KIND_ICON[kind] as any} size={18} color={BRAND} />
        <View style={{ flex: 1 }}>
          <Text numberOfLines={2} style={{ fontSize: 14, fontWeight: '700', color: theme.colors.onSurface }}>
            {field.label || field.key}
          </Text>
          <Text style={muted}>{t(`submissions.kind.${kind}`)}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{ fontSize: 13, fontWeight: '700', color: theme.colors.onSurface }}>
            {stats.filled}/{stats.total}
          </Text>
          <Text style={muted}>{pct(stats.filled, stats.total)}</Text>
        </View>
      </View>
      <ProgressBar pct={stats.fillRate * 100} />

      <View style={{ marginTop: 10 }}>
        {kind === 'rating' && stats.avg != null ? (
          <View style={{ flexDirection: dir, gap: 8, marginBottom: 8 }}>
            <StatTile width="48%" label={`${t('submissions.average')} / ${stats.range?.[1]}`} value={fmtNum2(stats.avg)} color={BRAND} />
            {stats.nps != null ? <StatTile width="48%" label="NPS" value={stats.nps} color={BRAND} /> : null}
          </View>
        ) : null}

        {kind === 'number' ? (
          stats.answered ? (
            <View style={{ flexDirection: dir, flexWrap: 'wrap', gap: 8 }}>
              <StatTile width="31%" label={t('submissions.sum')} value={fmtNum2(stats.sum)} />
              <StatTile width="31%" label={t('submissions.average')} value={fmtNum2(stats.avg)} />
              <StatTile width="31%" label={t('submissions.median')} value={fmtNum2(stats.median)} />
              <StatTile width="31%" label={t('submissions.min')} value={fmtNum2(stats.min)} />
              <StatTile width="31%" label={t('submissions.max')} value={fmtNum2(stats.max)} />
            </View>
          ) : (
            <Text style={muted}>{t('submissions.noNumeric')}</Text>
          )
        ) : null}

        {kind === 'file' ? <Text style={muted}>{t('submissions.attachedSigned', { count: stats.filled })}</Text> : null}

        {kind === 'text' ? (
          <>
            <Text style={muted}>{t('submissions.uniqueAnswers', { count: stats.unique || 0 })}</Text>
            {rows.length > 0 ? <Text style={[muted, { marginTop: 8, marginBottom: 4, fontWeight: '700' }]}>{t('submissions.mostCommon')}</Text> : null}
          </>
        ) : null}

        {kind !== 'number' && kind !== 'file' && rows.length > 0
          ? visible.map((r) => (
              <AnswerBar
                key={r.key}
                label={groupLabel(field, r.key, yes, no, locale)}
                count={r.count}
                base={stats.base || 0}
                top={top}
                selected={isGroupSelected(field, r.key, current)}
                onPress={() => onPick(field, r.key)}
              />
            ))
          : null}

        {rows.length > max && kind !== 'number' && kind !== 'file' ? (
          <Pressable onPress={() => setShowAll((s) => !s)} style={{ alignSelf: 'center', paddingVertical: 4 }}>
            <Text style={{ color: BRAND, fontWeight: '700', fontSize: 13 }}>
              {showAll ? t('submissions.showLess') : t('submissions.showMore', { count: rows.length - max })}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </SectionCard>
  );
}

const fmtNum2 = (n?: number | null) => (n == null || Number.isNaN(n) ? '—' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 }));

export default function SubmissionsAnalyticsView({ items, baseItems, scopeItems, fields, filters, onFilterChange, sourceBars, onPickSource }: Props) {
  const { t, i18n } = useTranslation();
  const theme = useAppTheme();
  const dir = useRowDirection();
  const yes = t('submissions.yes');
  const no = t('submissions.no');
  const locale = i18n.language === 'he' ? 'he-IL' : 'en-US';

  const timeline = useMemo(() => buildTimeline(items), [items]);
  const stats = useMemo(() => fields.map((f) => buildFieldStats(f, items, scopeItems)), [fields, items, scopeItems]);

  const kpi = useMemo(
    () => ({
      today: baseItems.filter((i) => inLastDays(i.submittedAt, 1)).length,
      d7: baseItems.filter((i) => inLastDays(i.submittedAt, 7)).length,
      d30: baseItems.filter((i) => inLastDays(i.submittedAt, 30)).length,
    }),
    [baseItems],
  );

  const avgCompletion = useMemo(() => {
    const countable = stats.filter((s) => s.kind !== 'bool' && s.total > 0);
    if (!countable.length) return null;
    return countable.reduce((a, s) => a + s.fillRate, 0) / countable.length;
  }, [stats]);

  const barData = useMemo(
    () =>
      timeline.rows.map((r) => ({
        a: r.count,
        label:
          timeline.unit === 'hour'
            ? r.key
            : timeline.unit === 'month'
              ? groupLabel({ key: '', label: '', type: 'date' }, r.key, yes, no, locale)
              : `${r.key.slice(8, 10)}/${r.key.slice(5, 7)}`,
      })),
    [timeline, yes, no, locale],
  );

  const pick = (field: InsightField, key: string) => onFilterChange(field.key, filterFromGroup(field, key, filters[field.key]));

  if (items.length === 0) {
    return (
      <View style={{ alignItems: 'center', padding: 40 }}>
        <MaterialCommunityIcons name="chart-box-outline" size={56} color={theme.colors.onSurfaceVariant} style={{ opacity: 0.35 }} />
        <Text style={{ color: theme.colors.onSurfaceVariant, marginTop: 10, textAlign: 'center' }}>{t('submissions.noMatch')}</Text>
      </View>
    );
  }

  const sourceTop = Math.max(1, ...sourceBars.map((s) => s.count));

  return (
    <View style={{ paddingTop: 4 }}>
      {/* KPI tiles */}
      <View style={{ flexDirection: dir, flexWrap: 'wrap', gap: 8, paddingHorizontal: 12, marginBottom: 12 }}>
        <StatTile width="48%" label={t('submissions.responses')} value={items.length} color={BRAND} />
        <StatTile width="48%" label={t('submissions.today')} value={kpi.today} />
        <StatTile width="48%" label={t('submissions.last7')} value={kpi.d7} />
        <StatTile width="48%" label={t('submissions.last30')} value={kpi.d30} />
        {avgCompletion != null ? (
          <StatTile width="100%" label={t('submissions.avgCompletion')} value={`${Math.round(avgCompletion * 100)}%`} />
        ) : null}
      </View>

      {/* Timeline (switches to hours when everything happened on one day) */}
      <SectionCard title={timeline.unit === 'hour' ? t('submissions.byHour') : t('submissions.overTime')} icon="chart-line">
        <MiniBars data={barData} colorA={BRAND} height={110} />
      </SectionCard>

      {/* Overview by source when no single form / template is picked */}
      {fields.length === 0 && sourceBars.length > 0 ? (
        <SectionCard title={t('submissions.bySource')} icon="folder-outline">
          <Text style={{ fontSize: 12, color: theme.colors.onSurfaceVariant, marginBottom: 10 }}>{t('submissions.bySourceHint')}</Text>
          {sourceBars.map((s) => (
            <BarRow key={s.id} label={s.label || t('submissions.noName')} value={s.count} max={sourceTop} onPress={() => onPickSource(s.id)} />
          ))}
        </SectionCard>
      ) : null}

      {fields.length > 0 ? (
        <>
          <View style={{ paddingHorizontal: 14, marginBottom: 8 }}>
            <Text style={{ fontSize: 15, fontWeight: '700', color: theme.colors.onSurface }}>{t('submissions.perField')}</Text>
            <Text style={{ fontSize: 12, color: theme.colors.onSurfaceVariant }}>{t('submissions.perFieldHint')}</Text>
          </View>
          {stats.map((s) => (
            <FieldCard key={s.field.key} stats={s} current={filters[s.field.key]} onPick={pick} yes={yes} no={no} locale={locale} />
          ))}
        </>
      ) : null}
    </View>
  );
}
