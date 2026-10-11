import React from 'react';
import { ScrollView, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Text } from 'react-native-paper';
import { useAppTheme } from '../hooks/useAppTheme';
import { useRowDirection } from '../hooks/useRowDirection';
import { withAlpha } from '../utils/formatters';

const BRAND_COLOR = '#2e6155';

export interface StatusOption {
  key: string;
  label: string;
  color?: string;
  /** Optional count shown next to the label (only pass when it is cheap to compute). */
  count?: number;
}

interface StatusFilterBarProps {
  options: StatusOption[];
  value: string;
  onChange: (key: string) => void;
  /** When set, a leading "all" chip (key = 'all') is rendered. Omit for a plain status picker. */
  allLabel?: string;
  allCount?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * ONE horizontally scrollable row of status chips. Used both as a list filter (with `allLabel` + counts)
 * and as a one-tap status picker on detail screens (without `allLabel`).
 */
export function StatusFilterBar({ options, value, onChange, allLabel, allCount, style }: StatusFilterBarProps) {
  const theme = useAppTheme();
  const rowDirection = useRowDirection();

  const chips: StatusOption[] = allLabel
    ? [{ key: 'all', label: allLabel, color: BRAND_COLOR, count: allCount }, ...options]
    : options;

  return (
    <View
      style={[
        styles.wrap,
        { backgroundColor: theme.colors.surface, borderBottomColor: theme.colors.outlineVariant },
        style,
      ]}
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.scroll, { flexDirection: rowDirection }]}
      >
        {chips.map((chip) => {
          const active = chip.key === value;
          const color = chip.color || BRAND_COLOR;
          return (
            <Pressable
              key={chip.key}
              onPress={() => onChange(chip.key)}
              hitSlop={4}
              style={[
                styles.chip,
                active
                  ? { backgroundColor: withAlpha(color, 0.14), borderColor: color }
                  : { backgroundColor: theme.colors.surfaceVariant, borderColor: 'transparent' },
              ]}
            >
              <Text
                numberOfLines={1}
                style={[
                  styles.chipText,
                  { color: active ? color : theme.colors.onSurfaceVariant },
                  active && { fontWeight: '700' },
                ]}
              >
                {chip.label}
              </Text>
              {chip.count != null ? (
                <View style={[styles.countBadge, { backgroundColor: active ? withAlpha(color, 0.2) : withAlpha(theme.colors.onSurfaceVariant, 0.15) }]}>
                  <Text style={[styles.countText, { color: active ? color : theme.colors.onSurfaceVariant }]}>
                    {chip.count}
                  </Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderBottomWidth: StyleSheet.hairlineWidth },
  scroll: { paddingHorizontal: 12, paddingVertical: 8, gap: 8, alignItems: 'center' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 34,
    paddingHorizontal: 12,
    borderRadius: 17,
    borderWidth: 1,
  },
  chipText: { fontSize: 13 },
  countBadge: { minWidth: 20, paddingHorizontal: 5, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  countText: { fontSize: 11, fontWeight: '700' },
});

export default StatusFilterBar;
