import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useAppTheme } from '../hooks/useAppTheme';
import { useRowDirection } from '../hooks/useRowDirection';

export interface SummaryItem {
  label: string;
  value: string;
  color?: string;
}

/** Compact totals strip shown at the top of a list (e.g. open quotes total, unpaid invoices total). */
export function SummaryHeader({ items }: { items: SummaryItem[] }) {
  const theme = useAppTheme();
  const rowDirection = useRowDirection();
  if (!items.length) return null;
  return (
    <View
      style={[
        styles.wrap,
        { backgroundColor: theme.colors.surface, borderBottomColor: theme.colors.outlineVariant, flexDirection: rowDirection },
      ]}
    >
      {items.map((item, idx) => (
        <View
          key={`${item.label}-${idx}`}
          style={[
            styles.cell,
            idx > 0 && { borderStartWidth: StyleSheet.hairlineWidth, borderStartColor: theme.colors.outlineVariant },
          ]}
        >
          <Text style={[styles.label, { color: theme.colors.onSurfaceVariant }]} numberOfLines={1}>
            {item.label}
          </Text>
          <Text style={[styles.value, { color: item.color || theme.colors.onSurface }]} numberOfLines={1} adjustsFontSizeToFit>
            {item.value}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 8 },
  cell: { flex: 1, alignItems: 'center', paddingHorizontal: 8 },
  label: { fontSize: 11 },
  value: { fontSize: 16, fontWeight: '800', marginTop: 1 },
});

export default SummaryHeader;
