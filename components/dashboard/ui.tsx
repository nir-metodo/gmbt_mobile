import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, View, ViewStyle } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useRowDirection } from '../../hooks/useRowDirection';
import { PeriodKey, PERIOD_KEYS, PERIOD_LABEL_FALLBACK } from '../../utils/datePresets';

export const BRAND = '#2e6155';

export const fmtNum = (n: any): string => {
  const v = Number(n);
  return Number.isFinite(v) ? v.toLocaleString('en-US') : '0';
};

export const fmtMoney = (n: any): string => {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1_000_000) return `₪${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 10_000) return `₪${Math.round(v / 1000)}K`;
  return `₪${Math.round(v).toLocaleString('en-US')}`;
};

export const fmtPct = (n: any): string => `${Math.round(Number(n) || 0)}%`;

/** Period selector shown at the top of every dashboard / report screen (one row, scrolls sideways). */
export function PeriodChips({
  value,
  onChange,
  keys = PERIOD_KEYS,
}: {
  value: PeriodKey;
  onChange: (k: PeriodKey) => void;
  keys?: PeriodKey[];
}) {
  const { t } = useTranslation();
  const theme = useAppTheme();
  const dir = useRowDirection();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.chipsRow, { flexDirection: dir }]}>
      {keys.map((k) => {
        const active = k === value;
        return (
          <Pressable
            key={k}
            onPress={() => onChange(k)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={[
              styles.chip,
              { backgroundColor: active ? BRAND : theme.colors.surface, borderColor: active ? BRAND : theme.colors.outlineVariant || '#cbd5e1' },
            ]}
          >
            <Text style={{ color: active ? '#fff' : theme.colors.onSurface, fontWeight: active ? '700' : '500', fontSize: 13 }}>
              {t(`dashboard.period.${k}`, PERIOD_LABEL_FALLBACK[k])}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/** Generic single-select chip row (cases tabs, owner filter, report scope ...). */
export function ChipRow<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { key: T; label: string; icon?: string }[];
  value: T;
  onChange: (k: T) => void;
}) {
  const theme = useAppTheme();
  const dir = useRowDirection();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.chipsRow, { flexDirection: dir }]}>
      {options.map((o) => {
        const active = o.key === value;
        return (
          <Pressable
            key={o.key}
            onPress={() => onChange(o.key)}
            style={[
              styles.chip,
              { flexDirection: dir, alignItems: 'center', gap: 4, backgroundColor: active ? BRAND : theme.colors.surface, borderColor: active ? BRAND : theme.colors.outlineVariant || '#cbd5e1' },
            ]}
          >
            {o.icon ? <MaterialCommunityIcons name={o.icon as any} size={14} color={active ? '#fff' : theme.colors.onSurfaceVariant} /> : null}
            <Text style={{ color: active ? '#fff' : theme.colors.onSurface, fontWeight: active ? '700' : '500', fontSize: 13 }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/** Grey pulsing block used while a card is still loading. */
export function Skeleton({ height = 90, style }: { height?: number; style?: ViewStyle }) {
  const theme = useAppTheme();
  const opacity = useRef(new Animated.Value(0.45)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.45, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return <Animated.View style={[{ height, borderRadius: 14, backgroundColor: theme.colors.surfaceVariant, opacity }, style]} />;
}

/** Small icon + number + label tile (used in grids). */
export function StatTile({ label, value, color, onPress, width = '48%' }: { label: string; value: string | number; color?: string; onPress?: () => void; width?: any }) {
  const theme = useAppTheme();
  const Wrap: any = onPress ? Pressable : View;
  return (
    <Wrap onPress={onPress} style={[styles.tile, { width, backgroundColor: theme.colors.surface, borderColor: theme.colors.outlineVariant || '#e2e8f0' }]}>
      <Text style={{ fontSize: 20, fontWeight: '800', color: color || theme.colors.onSurface }}>{typeof value === 'number' ? fmtNum(value) : value}</Text>
      <Text style={{ fontSize: 12, color: theme.colors.onSurfaceVariant }} numberOfLines={1}>
        {label}
      </Text>
    </Wrap>
  );
}

/** One horizontal bar: label · value, thin bar underneath. `max` scales the bar. */
export function BarRow({ label, value, max, color = BRAND, suffix, sub, onPress }: { label: string; value: number; max: number; color?: string; suffix?: string; sub?: string; onPress?: () => void }) {
  const theme = useAppTheme();
  const dir = useRowDirection();
  const pct = max > 0 ? Math.max(value > 0 ? 3 : 0, Math.min(100, (value / max) * 100)) : 0;
  const Wrap: any = onPress ? Pressable : View;
  return (
    <Wrap onPress={onPress} style={{ marginBottom: 10 }}>
      <View style={{ flexDirection: dir, justifyContent: 'space-between', marginBottom: 3 }}>
        <Text style={{ flex: 1, fontSize: 13, color: theme.colors.onSurface }} numberOfLines={1}>
          {label}
        </Text>
        <Text style={{ fontSize: 13, fontWeight: '700', color: theme.colors.onSurface, marginStart: 8 }}>
          {fmtNum(value)}
          {suffix || ''}
        </Text>
      </View>
      <View style={{ height: 6, borderRadius: 3, backgroundColor: theme.colors.surfaceVariant, overflow: 'hidden', flexDirection: dir }}>
        <View style={{ width: `${pct}%`, backgroundColor: color, borderRadius: 3 }} />
      </View>
      {sub ? <Text style={{ fontSize: 11, color: theme.colors.onSurfaceVariant, marginTop: 2 }}>{sub}</Text> : null}
    </Wrap>
  );
}

/** Card wrapper with an optional title row + chevron when tappable. */
export function SectionCard({ title, icon, color = BRAND, onPress, children, right }: { title?: string; icon?: string; color?: string; onPress?: () => void; children: React.ReactNode; right?: React.ReactNode }) {
  const theme = useAppTheme();
  const dir = useRowDirection();
  const Wrap: any = onPress ? Pressable : View;
  return (
    <Wrap onPress={onPress} style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.outlineVariant || '#e2e8f0' }]}>
      {title ? (
        <View style={{ flexDirection: dir, alignItems: 'center', marginBottom: 10, gap: 8 }}>
          {icon ? <MaterialCommunityIcons name={icon as any} size={18} color={color} /> : null}
          <Text style={{ flex: 1, fontSize: 15, fontWeight: '700', color: theme.colors.onSurface }}>{title}</Text>
          {right}
          {onPress ? <MaterialCommunityIcons name="chevron-left" size={20} color={theme.colors.onSurfaceVariant} /> : null}
        </View>
      ) : null}
      {children}
    </Wrap>
  );
}

/** Mini ratio bar (e.g. paid vs total) used inside KPI cards. */
export function ProgressBar({ pct, color = BRAND }: { pct: number; color?: string }) {
  const theme = useAppTheme();
  return (
    <View style={{ height: 5, borderRadius: 3, backgroundColor: theme.colors.surfaceVariant, overflow: 'hidden' }}>
      <View style={{ width: `${Math.max(0, Math.min(100, pct))}%`, height: '100%', backgroundColor: color, borderRadius: 3 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  chipsRow: { paddingHorizontal: 12, paddingVertical: 8, gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 18, borderWidth: 1 },
  tile: { padding: 12, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, gap: 2 },
  card: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, padding: 14, marginHorizontal: 12, marginBottom: 12 },
});
