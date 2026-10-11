import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useAppTheme } from '../hooks/useAppTheme';
import { useRTL } from '../hooks/useRTL';
import { useRowDirection } from '../hooks/useRowDirection';
import { withAlpha } from '../utils/formatters';

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
  onPress: () => void;
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
  onPress,
}: DocumentListItemProps) {
  const theme = useAppTheme();
  const { textAlign } = useRTL();
  const rowDirection = useRowDirection();
  return (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: theme.colors.surfaceVariant }}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: pressed ? theme.colors.surfaceVariant : theme.custom.cardBackground,
          borderColor: theme.colors.outlineVariant,
          flexDirection: rowDirection,
        },
      ]}
    >
      <View style={[styles.bar, { backgroundColor: statusColor }]} />
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
        <View style={[styles.bottomRow, { flexDirection: rowDirection }]}>
          {statusLabel ? (
            <View style={[styles.pill, { backgroundColor: withAlpha(statusColor, 0.16) }]}>
              <Text style={{ color: statusColor, fontSize: 11, fontWeight: '700' }}>{statusLabel}</Text>
            </View>
          ) : null}
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
  body: { flex: 1, paddingHorizontal: 14, paddingVertical: 12, gap: 8 },
  topRow: { alignItems: 'flex-start', gap: 10 },
  bottomRow: { alignItems: 'center', gap: 10 },
  pill: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 12 },
  meta: { alignItems: 'center', gap: 3 },
});

export default DocumentListItem;
