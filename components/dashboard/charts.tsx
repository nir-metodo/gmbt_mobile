import React from 'react';
import { View } from 'react-native';
import { Text } from 'react-native-paper';
import { useAppTheme } from '../../hooks/useAppTheme';
import { BRAND } from './ui';

export interface BarDatum {
  label: string;
  a: number; // primary series (e.g. incoming)
  b?: number; // secondary series (e.g. outgoing)
}

/**
 * Tiny dependency-free column chart. A time axis always runs left-to-right (even in RTL), so the
 * container is forced to `direction: 'ltr'`.
 */
export function MiniBars({ data, colorA = BRAND, colorB = '#93c5fd', height = 70 }: { data: BarDatum[]; colorA?: string; colorB?: string; height?: number }) {
  const theme = useAppTheme();
  const hasB = data.some((d) => (d.b || 0) > 0);
  const max = Math.max(1, ...data.map((d) => Math.max(d.a || 0, d.b || 0)));
  const step = Math.max(1, Math.ceil(data.length / 7));
  return (
    <View style={{ direction: 'ltr' }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', height, gap: data.length > 40 ? 1 : 3 }}>
        {data.map((d, i) => (
          <View key={i} style={{ flex: 1, flexDirection: 'row', alignItems: 'flex-end', height: '100%', gap: 1 }}>
            <View style={{ flex: 1, height: `${Math.max(d.a > 0 ? 3 : 0, (d.a / max) * 100)}%`, backgroundColor: colorA, borderTopLeftRadius: 2, borderTopRightRadius: 2 }} />
            {hasB ? (
              <View style={{ flex: 1, height: `${Math.max((d.b || 0) > 0 ? 3 : 0, ((d.b || 0) / max) * 100)}%`, backgroundColor: colorB, borderTopLeftRadius: 2, borderTopRightRadius: 2 }} />
            ) : null}
          </View>
        ))}
      </View>
      <View style={{ flexDirection: 'row', marginTop: 4 }}>
        {data.map((d, i) => (
          <Text key={i} numberOfLines={1} style={{ flex: 1, fontSize: 9, color: theme.colors.onSurfaceVariant, textAlign: 'center' }}>
            {i % step === 0 ? d.label : ''}
          </Text>
        ))}
      </View>
    </View>
  );
}

/** Two-colour legend for MiniBars. */
export function Legend({ items }: { items: { color: string; label: string }[] }) {
  const theme = useAppTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
      {items.map((it) => (
        <View key={it.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: it.color }} />
          <Text style={{ fontSize: 11, color: theme.colors.onSurfaceVariant }}>{it.label}</Text>
        </View>
      ))}
    </View>
  );
}

/** SLA compliance gauge: big % + coloured track (web `dash-sla-gauge`). */
export function SlaGauge({ pct, met, breached, caption }: { pct: number; met?: number; breached?: number; caption?: string }) {
  const theme = useAppTheme();
  const color = pct >= 90 ? '#16a34a' : pct >= 70 ? '#f59e0b' : '#dc2626';
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
        <Text style={{ fontSize: 26, fontWeight: '800', color }}>{pct}%</Text>
        {caption ? <Text style={{ fontSize: 12, color: theme.colors.onSurfaceVariant, flex: 1 }}>{caption}</Text> : null}
      </View>
      <View style={{ height: 6, borderRadius: 3, backgroundColor: theme.colors.surfaceVariant, overflow: 'hidden', marginTop: 4 }}>
        <View style={{ width: `${Math.max(0, Math.min(100, pct))}%`, height: '100%', backgroundColor: color }} />
      </View>
      {typeof met === 'number' || typeof breached === 'number' ? (
        <View style={{ flexDirection: 'row', gap: 14, marginTop: 6 }}>
          {typeof met === 'number' ? <Text style={{ fontSize: 12, color: '#16a34a' }}>{met}</Text> : null}
          {typeof breached === 'number' ? <Text style={{ fontSize: 12, color: '#dc2626' }}>{breached}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}
