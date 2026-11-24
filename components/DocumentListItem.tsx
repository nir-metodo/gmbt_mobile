import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useAppTheme } from '../hooks/useAppTheme';
import { useRTL } from '../hooks/useRTL';
import { useRowDirection } from '../hooks/useRowDirection';
import { withAlpha } from '../utils/formatters';
import { SelectCheck } from './MultiSelect';

interface DocumentListItemProps {
  /** Main line, e.g. "Quote #1042" or the document title. */
  title: string;
  /** Customer / contact name. */
  subtitle?: string;
  /** Pre-formatted amount, e.g. "₪1,250.00". */
  amount?: string;
  statusLabel?: string;
  statusColor?: string;
  /** Pre-formatted date. */
  date?: string;
  /** Overdue / expired dates are drawn in red. */
  dateWarning?: boolean;
  /** Small extra info next to the date (e.g. "viewed 3x"). */
  viewCount?: number;
  /** Extra facts shown under the title as icon + text chips (phone, products, tracking…). */
  details?: { icon: string; text: string }[];
  /** Extra status pills next to the main one (payment, channel…). */
  pills?: { label: string; color: string }[];
  /** Quick actions at the end of the bottom row (e.g. WhatsApp + "..." menu). Hidden while selecting. */
  actions?: React.ReactNode;
  onPress: () => void;
  /** Long-press starts multi-select (when the screen supports it). */
  onLongPress?: () => void;
  /** Multi-select mode: shows a check circle; `selected` highlights the row. */
  selecting?: boolean;
  selected?: boolean;
}

/** One consistent list row for every business-document list: title · customer · amount · status pill · date. */
export function DocumentListItem({
  title,
  subtitle,
  amount,
  statusLabel,
  statusColor = '#9E9E9E',
  date,
  dateWarning,
  viewCount,
  details,
  pills,
  actions,
  onPress,
  onLongPress,
  selecting,
  selected,
}: DocumentListItemProps) {
  const theme = useAppTheme();
  const { textAlign } = useRTL();
  const rowDirection = useRowDirection();
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      android_ripple={{ color: theme.colors.surfaceVariant }}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: selected ? withAlpha(theme.colors.primary, 0.1) : pressed ? theme.colors.surfaceVariant : theme.custom.cardBackground,
          borderColor: selected ? theme.colors.primary : theme.colors.outlineVariant,
          flexDirection: rowDirection,
        },
      ]}
    >
      <View style={[styles.bar, { backgroundColor: statusColor }]} />
      {selecting ? (
        <View style={styles.check}>
          <SelectCheck checked={!!selected} />
        </View>
      ) : null}
      <View style={styles.body}>
        <View style={[styles.topRow, { flexDirection: rowDirection }]}>
          <View style={{ flex: 1 }}>
            <Text variant="titleSmall" numberOfLines={1} style={{ color: theme.colors.onSurface, fontWeight: '700', textAlign }}>
              {title}
            </Text>
            {subtitle ? (
              <Text variant="bodySmall" numberOfLines={1} style={{ color: theme.colors.onSurfaceVariant, textAlign }}>
                {subtitle}
              </Text>
            ) : null}
          </View>
          {amount ? (
            <Text variant="titleMedium" style={{ color: theme.colors.primary, fontWeight: '800' }}>
              {amount}
            </Text>
          ) : null}
        </View>
        {details && details.length > 0 ? (
          <View style={styles.details}>
            {details.map((d, i) => (
              <View key={i} style={[styles.detail, { flexDirection: rowDirection }]}>
                <MaterialCommunityIcons name={d.icon as any} size={14} color={theme.colors.onSurfaceVariant} />
                <Text numberOfLines={1} style={{ color: theme.colors.onSurfaceVariant, fontSize: 12, flexShrink: 1, textAlign }}>{d.text}</Text>
              </View>
            ))}
          </View>
        ) : null}
        <View style={[styles.bottomRow, { flexDirection: rowDirection }]}>
          {statusLabel ? (
            <View style={[styles.pill, { backgroundColor: withAlpha(statusColor, 0.16) }]}>
              <Text style={{ color: statusColor, fontSize: 11, fontWeight: '700' }}>{statusLabel}</Text>
            </View>
          ) : null}
          {pills?.map((p, i) => (
            <View key={i} style={[styles.pill, { backgroundColor: withAlpha(p.color, 0.16) }]}>
              <Text style={{ color: p.color, fontSize: 11, fontWeight: '700' }}>{p.label}</Text>
            </View>
          ))}
          <View style={{ flex: 1 }} />
          {viewCount && viewCount > 0 ? (
            <View style={[styles.meta, { flexDirection: rowDirection }]}>
              <MaterialCommunityIcons name="eye-check-outline" size={13} color="#53bdeb" />
              <Text style={{ color: '#53bdeb', fontSize: 11, fontWeight: '600' }}>{viewCount}</Text>
            </View>
          ) : null}
          {date ? (
            <Text style={{ color: dateWarning ? theme.colors.error : theme.colors.onSurfaceVariant, fontSize: 12 }}>{date}</Text>
          ) : null}
          {actions && !selecting ? actions : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
  },
  bar: { width: 5 },
  check: { justifyContent: 'center', paddingHorizontal: 10 },
  body: { flex: 1, paddingHorizontal: 14, paddingVertical: 12, gap: 8 },
  topRow: { alignItems: 'flex-start', gap: 10 },
  bottomRow: { alignItems: 'center', gap: 10 },
  details: { gap: 3 },
  detail: { alignItems: 'center', gap: 6 },
  pill: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 12 },
  meta: { alignItems: 'center', gap: 3 },
});

export default DocumentListItem;
