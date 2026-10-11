import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text, IconButton } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '../hooks/useAppTheme';
import { useRTL } from '../hooks/useRTL';
import { useRowDirection } from '../hooks/useRowDirection';

interface ScreenHeaderProps {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  /** Optional accent color for the bar (defaults to the themed header color). */
  color?: string;
  /** Right-side actions: at most one icon + a <HeaderMenu/>. */
  actions?: React.ReactNode;
}

/** Shared top bar for list and detail screens: back · title · actions. */
export function ScreenHeader({ title, subtitle, onBack, color, actions }: ScreenHeaderProps) {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const { isRTL, textAlign } = useRTL();
  const rowDirection = useRowDirection();
  return (
    <View style={[styles.header, { backgroundColor: color || theme.custom.headerBackground, paddingTop: insets.top + 4 }]}>
      <View style={[styles.row, { flexDirection: rowDirection }]}>
        {onBack ? (
          <IconButton icon={isRTL ? 'arrow-right' : 'arrow-left'} iconColor={theme.custom.headerText} size={24} onPress={onBack} />
        ) : (
          <View style={{ width: 12 }} />
        )}
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={[styles.title, { color: theme.custom.headerText, textAlign }]}>
            {title}
          </Text>
          {subtitle ? (
            <Text numberOfLines={1} style={[styles.subtitle, { color: theme.custom.headerText, textAlign }]}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {actions}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingBottom: 4 },
  row: { alignItems: 'center' },
  title: { fontSize: 19, fontWeight: '700' },
  subtitle: { fontSize: 12, opacity: 0.85 },
});

export default ScreenHeader;
