import React from 'react';
import { View, StyleSheet, Pressable, ScrollView } from 'react-native';
import { Text, Checkbox, Menu } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useAppTheme } from '../../../hooks/useAppTheme';
import { useRTL } from '../../../hooks/useRTL';
import { borderRadius } from '../../../constants/theme';
import { withAlpha } from '../../../utils/formatters';

/** Elevated section card with an optional title row. */
export function Section({
  title,
  icon,
  children,
  tint,
}: {
  title?: string;
  icon?: string;
  children: React.ReactNode;
  tint?: string;
}) {
  const theme = useAppTheme();
  const { flexDirection, textAlign } = useRTL();
  return (
    <View
      style={[
        styles.section,
        {
          backgroundColor: tint ? withAlpha(tint, 0.08) : theme.colors.surface,
          borderColor: tint ? withAlpha(tint, 0.4) : theme.colors.outlineVariant,
        },
      ]}
    >
      {title ? (
        <View style={[styles.sectionHead, { flexDirection }]}>
          {icon ? <MaterialCommunityIcons name={icon as any} size={18} color={tint || theme.colors.primary} /> : null}
          <Text style={{ color: tint || theme.colors.onSurface, fontWeight: '700', fontSize: 14, flex: 1, textAlign }}>{title}</Text>
        </View>
      ) : null}
      {children}
    </View>
  );
}

/** Tappable checkbox row whose label wraps (used for the confirmation gates). */
export function CheckRow({
  checked,
  onChange,
  label,
  highlight,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  highlight?: boolean;
  disabled?: boolean;
}) {
  const theme = useAppTheme();
  const { flexDirection, textAlign } = useRTL();
  return (
    <Pressable
      disabled={disabled}
      onPress={() => onChange(!checked)}
      style={[
        styles.checkRow,
        { flexDirection, borderColor: highlight && !checked ? theme.colors.error : 'transparent' },
        disabled && { opacity: 0.5 },
      ]}
    >
      <Checkbox status={checked ? 'checked' : 'unchecked'} onPress={() => !disabled && onChange(!checked)} color={theme.colors.primary} />
      <Text style={{ flex: 1, color: theme.colors.onSurface, fontSize: 13, lineHeight: 19, textAlign }}>{label}</Text>
    </Pressable>
  );
}

/** Inline notice (info / warning / error). */
export function Notice({
  kind = 'info',
  text,
  children,
}: {
  kind?: 'info' | 'warn' | 'error' | 'ok';
  text?: string;
  children?: React.ReactNode;
}) {
  const theme = useAppTheme();
  const { flexDirection, textAlign } = useRTL();
  const color = kind === 'error' ? theme.colors.error : kind === 'warn' ? '#d97706' : kind === 'ok' ? '#16a34a' : '#2563eb';
  const icon = kind === 'error' ? 'alert-circle' : kind === 'warn' ? 'alert' : kind === 'ok' ? 'check-circle' : 'information';
  return (
    <View style={[styles.notice, { flexDirection, backgroundColor: withAlpha(color, 0.1), borderColor: withAlpha(color, 0.35) }]}>
      <MaterialCommunityIcons name={icon as any} size={18} color={color} style={{ marginTop: 1 }} />
      <View style={{ flex: 1, gap: 6 }}>
        {text ? <Text style={{ color: theme.colors.onSurface, fontSize: 12.5, lineHeight: 18, textAlign }}>{text}</Text> : null}
        {children}
      </View>
    </View>
  );
}

/** Selectable chip row (single or multi select). */
export function ChipGroup({
  options,
  selected,
  onToggle,
  disabled,
}: {
  options: Array<{ key: string; label: string }>;
  selected: string[];
  onToggle: (key: string) => void;
  disabled?: boolean;
}) {
  const theme = useAppTheme();
  const { flexDirection } = useRTL();
  return (
    <View style={[styles.chips, { flexDirection }]}>
      {options.map((o) => {
        const on = selected.includes(o.key);
        return (
          <Pressable
            key={o.key}
            disabled={disabled}
            onPress={() => onToggle(o.key)}
            style={[
              styles.chip,
              {
                borderColor: on ? BRAND : theme.colors.outlineVariant,
                backgroundColor: on ? withAlpha(BRAND, 0.14) : 'transparent',
              },
              disabled && { opacity: 0.5 },
            ]}
          >
            <Text style={{ color: on ? BRAND : theme.colors.onSurface, fontSize: 12.5, fontWeight: on ? '700' : '400' }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Dropdown built on a paper Menu (scrollable for long option lists). */
export function Picker({
  options,
  value,
  onChange,
  placeholder,
  disabled,
}: {
  options: Array<{ key: string; label: string }>;
  value: string;
  onChange: (key: string) => void;
  placeholder: string;
  disabled?: boolean;
}) {
  const theme = useAppTheme();
  const { flexDirection, textAlign } = useRTL();
  const [open, setOpen] = React.useState(false);
  const current = options.find((o) => o.key === value);
  return (
    <Menu
      visible={open}
      onDismiss={() => setOpen(false)}
      anchor={
        <Pressable
          disabled={disabled}
          onPress={() => setOpen(true)}
          style={[styles.picker, { flexDirection, borderColor: theme.colors.outlineVariant }, disabled && { opacity: 0.5 }]}
        >
          <Text style={{ flex: 1, color: current ? theme.colors.onSurface : theme.colors.onSurfaceVariant, textAlign }} numberOfLines={1}>
            {current ? current.label : placeholder}
          </Text>
          <MaterialCommunityIcons name="chevron-down" size={20} color={theme.colors.onSurfaceVariant} />
        </Pressable>
      }
    >
      <ScrollView style={{ maxHeight: 280 }}>
        {options.map((o) => (
          <Menu.Item
            key={o.key}
            title={o.label}
            onPress={() => {
              onChange(o.key);
              setOpen(false);
            }}
          />
        ))}
      </ScrollView>
    </Menu>
  );
}

const BRAND = '#2e6155';

const styles = StyleSheet.create({
  chips: { flexWrap: 'wrap', gap: 6 },
  chip: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
  picker: { alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 11 },
  section: { borderRadius: borderRadius.lg, borderWidth: StyleSheet.hairlineWidth, padding: 14, gap: 10 },
  sectionHead: { alignItems: 'center', gap: 8 },
  checkRow: { alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: 10, paddingHorizontal: 4, paddingVertical: 2 },
  notice: { borderRadius: 10, borderWidth: 1, padding: 10, gap: 8, alignItems: 'flex-start' },
});
