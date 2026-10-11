import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text, Button } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useAppTheme } from '../hooks/useAppTheme';

const BRAND_COLOR = '#2e6155';

interface EmptyStateProps {
  icon: string;
  title: string;
  description?: string;
  /** Primary action (e.g. "New quote"). Omit when a filter is active and there is nothing to create. */
  actionLabel?: string;
  onAction?: () => void;
}

/** Empty list placeholder with ONE clear primary action. */
export function EmptyState({ icon, title, description, actionLabel, onAction }: EmptyStateProps) {
  const theme = useAppTheme();
  return (
    <View style={styles.wrap}>
      <MaterialCommunityIcons name={icon as any} size={64} color={theme.colors.onSurfaceVariant} style={{ opacity: 0.35 }} />
      <Text variant="titleMedium" style={{ color: theme.colors.onSurface, fontWeight: '700', marginTop: 12, textAlign: 'center' }}>
        {title}
      </Text>
      {description ? (
        <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center', marginTop: 6 }}>
          {description}
        </Text>
      ) : null}
      {actionLabel && onAction ? (
        <Button
          mode="contained"
          icon="plus"
          onPress={onAction}
          buttonColor={BRAND_COLOR}
          textColor="#FFFFFF"
          style={{ marginTop: 20, borderRadius: 12 }}
          contentStyle={{ height: 46, paddingHorizontal: 8 }}
        >
          {actionLabel}
        </Button>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 72, paddingHorizontal: 36 },
});

export default EmptyState;
