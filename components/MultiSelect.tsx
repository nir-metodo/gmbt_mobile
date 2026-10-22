import React, { useCallback, useMemo, useState } from 'react';
import { View, Pressable, StyleSheet, ScrollView } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '../hooks/useAppTheme';
import { useRTL } from '../hooks/useRTL';
import { withAlpha } from '../utils/formatters';

/**
 * Shared multi-select behaviour for list screens (leads / contacts / cases).
 *  - long-press a row  -> enters selection mode and selects that row
 *  - tap while selecting -> toggles the row
 *  - closing / selecting nothing leaves selection mode
 */
export function useMultiSelect() {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const active = selected.size > 0;

  const toggle = useCallback((id: string) => {
    if (!id) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const start = useCallback((id: string) => {
    if (!id) return;
    setSelected((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  }, []);

  const selectAll = useCallback((ids: string[]) => setSelected(new Set(ids.filter(Boolean))), []);
  const clear = useCallback(() => setSelected(new Set()), []);
  const isSelected = useCallback((id: string) => selected.has(id), [selected]);
  const ids = useMemo(() => Array.from(selected), [selected]);

  return { selected, ids, count: selected.size, active, toggle, start, selectAll, clear, isSelected };
}

/** Round check mark shown at the start of a row while selecting. */
export function SelectCheck({ checked, size = 24 }: { checked: boolean; size?: number }) {
  const theme = useAppTheme();
  return (
    <View
      style={[
        styles.check,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderColor: checked ? theme.colors.primary : theme.colors.outline,
          backgroundColor: checked ? theme.colors.primary : 'transparent',
        },
      ]}
    >
      {checked ? <MaterialCommunityIcons name="check" size={size - 8} color="#FFF" /> : null}
    </View>
  );
}

/** Top bar replacing the screen header while selecting: ✕  "N selected"  [select all]. */
export function SelectionHeader({
  count,
  total,
  onClose,
  onSelectAll,
  label,
}: {
  count: number;
  total: number;
  onClose: () => void;
  onSelectAll: () => void;
  label: string; // e.g. "נבחרו" / "selected"
}) {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const { flexDirection } = useRTL();
  const allSelected = total > 0 && count >= total;
  return (
    <View
      style={[
        styles.header,
        { backgroundColor: theme.custom.headerBackground, paddingTop: insets.top + 6, flexDirection },
      ]}
    >
      <Pressable onPress={onClose} hitSlop={10} style={styles.headerBtn} accessibilityRole="button">
        <MaterialCommunityIcons name="close" size={24} color={theme.custom.headerText} />
      </Pressable>
      <Text style={styles.headerTitle}>
        {count} {label}
      </Text>
      <View style={{ flex: 1 }} />
      <Pressable onPress={allSelected ? onClose : onSelectAll} hitSlop={10} style={[styles.headerBtn, { flexDirection, gap: 6 }]}>
        <MaterialCommunityIcons
          name={allSelected ? 'checkbox-multiple-marked' : 'checkbox-multiple-marked-outline'}
          size={22}
          color={theme.custom.headerText}
        />
      </Pressable>
    </View>
  );
}

export interface BulkAction {
  key: string;
  icon: string;
  label: string;
  onPress: () => void;
  color?: string;
  disabled?: boolean;
}

/** Bottom action bar shown while selecting. Scrolls horizontally if there are many actions. */
export function BulkActionBar({ actions, busy }: { actions: BulkAction[]; busy?: boolean }) {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const { flexDirection } = useRTL();
  return (
    <View
      style={[
        styles.bar,
        {
          backgroundColor: theme.colors.surface,
          borderTopColor: theme.colors.outline,
          paddingBottom: Math.max(insets.bottom, 8),
          opacity: busy ? 0.6 : 1,
        },
      ]}
      pointerEvents={busy ? 'none' : 'auto'}
    >
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.barScroll, { flexDirection }]}>
        {actions.map((a) => {
          const color = a.disabled ? theme.colors.onSurfaceVariant : a.color || theme.colors.primary;
          return (
            <Pressable
              key={a.key}
              onPress={a.onPress}
              disabled={a.disabled}
              style={({ pressed }) => [
                styles.action,
                { backgroundColor: pressed ? withAlpha(color, 0.16) : withAlpha(color, 0.08), opacity: a.disabled ? 0.5 : 1 },
              ]}
            >
              <MaterialCommunityIcons name={a.icon as any} size={22} color={color} />
              <Text style={{ fontSize: 11, fontWeight: '700', color, marginTop: 2 }} numberOfLines={1}>
                {a.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  check: { borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  header: { alignItems: 'center', paddingHorizontal: 12, paddingBottom: 10, gap: 8 },
  headerBtn: { padding: 6, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '700', color: '#FFF' },
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 8,
    elevation: 12,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: -2 },
  },
  barScroll: { paddingHorizontal: 12, gap: 8, alignItems: 'center' },
  action: {
    minWidth: 76,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
