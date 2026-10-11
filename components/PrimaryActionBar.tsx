import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Button } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '../hooks/useAppTheme';

const BRAND_COLOR = '#2e6155';

interface PrimaryActionBarProps {
  visible?: boolean;
  label: string;
  icon?: string;
  color?: string;
  loading?: boolean;
  disabled?: boolean;
  onPress: () => void;
}

/**
 * The ONE prominent "next step" button of a detail screen (chosen by status), pinned at the bottom.
 * Everything else lives in the header "..." menu.
 */
export function PrimaryActionBar({ visible = true, label, icon, color = BRAND_COLOR, loading, disabled, onPress }: PrimaryActionBarProps) {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  if (!visible) return null;
  return (
    <View
      style={[
        styles.bar,
        {
          backgroundColor: theme.colors.surface,
          borderTopColor: theme.colors.outlineVariant,
          paddingBottom: Math.max(insets.bottom, 10),
        },
      ]}
    >
      <Button
        mode="contained"
        icon={icon}
        onPress={onPress}
        loading={loading}
        disabled={loading || disabled}
        buttonColor={color}
        textColor="#FFFFFF"
        style={styles.btn}
        contentStyle={styles.content}
        labelStyle={styles.label}
      >
        {label}
      </Button>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 12,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
  },
  btn: { borderRadius: 12 },
  content: { height: 48 },
  label: { fontSize: 16, fontWeight: '700' },
});

export default PrimaryActionBar;
