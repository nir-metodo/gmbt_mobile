import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useRowDirection } from '../../hooks/useRowDirection';
import { BRAND, fmtNum } from './ui';

export interface RecordItem {
  key: string;
  primary: string;
  secondary?: string;
  tag?: string;
  tone?: '' | 'bad' | 'good';
  meta?: string;
  onPress?: () => void;
}

const TONE: Record<string, string> = { bad: '#dc2626', good: '#16a34a', '': '#64748b' };

export function RecordRow({ r }: { r: RecordItem }) {
  const theme = useAppTheme();
  const dir = useRowDirection();
  const tone = TONE[r.tone || ''];
  const Wrap: any = r.onPress ? Pressable : View;
  return (
    <Wrap
      onPress={r.onPress}
      style={{ flexDirection: dir, alignItems: 'center', paddingVertical: 9, gap: 8, borderBottomWidth: 0.5, borderBottomColor: theme.colors.outlineVariant || '#e2e8f0' }}
    >
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ fontSize: 14, fontWeight: '600', color: theme.colors.onSurface }}>
          {r.primary}
        </Text>
        {r.secondary ? (
          <Text numberOfLines={1} style={{ fontSize: 12, color: theme.colors.onSurfaceVariant }}>
            {r.secondary}
          </Text>
        ) : null}
      </View>
      <View style={{ alignItems: 'flex-end', maxWidth: '38%' }}>
        {r.tag ? (
          <Text numberOfLines={1} style={{ fontSize: 11, fontWeight: '700', color: tone }}>
            {r.tag}
          </Text>
        ) : null}
        {r.meta ? <Text style={{ fontSize: 11, color: theme.colors.onSurfaceVariant }}>{r.meta}</Text> : null}
      </View>
      {r.onPress ? <MaterialCommunityIcons name="chevron-left" size={18} color={theme.colors.onSurfaceVariant} /> : null}
    </Wrap>
  );
}

/** Records list, shows the first `limit` rows and a "show more" link (no endless scrolling inside a scroll). */
export function RecordList({ rows, limit = 15, empty }: { rows: RecordItem[]; limit?: number; empty?: string }) {
  const { t } = useTranslation();
  const theme = useAppTheme();
  const [all, setAll] = useState(false);
  if (rows.length === 0) {
    return empty ? <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 13, paddingVertical: 8 }}>{empty}</Text> : null;
  }
  const shown = all ? rows : rows.slice(0, limit);
  return (
    <View>
      {shown.map((r) => (
        <RecordRow key={r.key} r={r} />
      ))}
      {rows.length > limit && !all ? (
        <Pressable onPress={() => setAll(true)} style={{ paddingVertical: 10 }}>
          <Text style={{ color: BRAND, fontWeight: '700', textAlign: 'center' }}>
            {t('dashboard.showMore', 'הצג עוד')} ({fmtNum(rows.length - limit)})
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export interface BarItem {
  label: string;
  count: number;
  /** records behind this bar - tapping the bar expands them */
  rows?: RecordItem[];
  color?: string;
}

/** Horizontal bars; a bar with records expands in place when tapped (web `BarList`). */
export function ExpandableBars({ items, empty, color = BRAND, limit = 12 }: { items: BarItem[]; empty?: string; color?: string; limit?: number }) {
  const { t } = useTranslation();
  const theme = useAppTheme();
  const dir = useRowDirection();
  const [open, setOpen] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const data = items.filter((i) => i.count > 0 || items.length <= 4);
  if (data.length === 0) {
    return <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 13, paddingVertical: 6 }}>{empty || t('dashboard.noData', 'אין נתונים')}</Text>;
  }
  const max = Math.max(1, ...data.map((i) => i.count));
  const shown = all ? data : data.slice(0, limit);
  return (
    <View>
      {shown.map((it, idx) => {
        const hasRows = !!it.rows && it.rows.length > 0;
        const isOpen = open === it.label + idx;
        const pct = Math.max(it.count > 0 ? 3 : 0, (it.count / max) * 100);
        return (
          <View key={it.label + idx} style={{ marginBottom: 10 }}>
            <Pressable disabled={!hasRows} onPress={() => setOpen(isOpen ? null : it.label + idx)}>
              <View style={{ flexDirection: dir, justifyContent: 'space-between', marginBottom: 3, alignItems: 'center' }}>
                <Text numberOfLines={1} style={{ flex: 1, fontSize: 13, color: theme.colors.onSurface }}>
                  {it.label || '—'}
                </Text>
                <Text style={{ fontSize: 13, fontWeight: '700', color: theme.colors.onSurface, marginStart: 8 }}>{fmtNum(it.count)}</Text>
                {hasRows ? <MaterialCommunityIcons name={isOpen ? 'chevron-up' : 'chevron-down'} size={18} color={theme.colors.onSurfaceVariant} /> : null}
              </View>
              <View style={{ height: 6, borderRadius: 3, backgroundColor: theme.colors.surfaceVariant, overflow: 'hidden', flexDirection: dir }}>
                <View style={{ width: `${pct}%`, backgroundColor: it.color || color, borderRadius: 3 }} />
              </View>
            </Pressable>
            {isOpen && it.rows ? (
              <View style={{ marginTop: 6 }}>
                <RecordList rows={it.rows} limit={8} />
              </View>
            ) : null}
          </View>
        );
      })}
      {data.length > limit && !all ? (
        <Pressable onPress={() => setAll(true)} style={{ paddingVertical: 4 }}>
          <Text style={{ color: BRAND, fontWeight: '700', textAlign: 'center' }}>
            {t('dashboard.showMore', 'הצג עוד')} ({fmtNum(data.length - limit)})
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
