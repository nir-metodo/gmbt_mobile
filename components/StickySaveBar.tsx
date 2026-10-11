import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Button } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../hooks/useAppTheme';
import { useRowDirection } from '../hooks/useRowDirection';

const BRAND_COLOR = '#2e6155';

interface StickySaveBarProps {
  /** Show only while the form is dirty — no "Edit" button is ever needed. */
  visible: boolean;
  saving?: boolean;
  /** Disable Save (e.g. a required field is empty). */
  disabled?: boolean;
  onSave: () => void;
  onDiscard?: () => void;
  saveLabel?: string;
  color?: string;
}

/** Contextual bottom bar: appears only when there are unsaved changes. Pin it at the bottom of a screen. */
export function StickySaveBar({ visible, saving, disabled, onSave, onDiscard, saveLabel, color = BRAND_COLOR }: StickySaveBarProps) {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const rowDirection = useRowDirection();
  const { t } = useTranslation();
  if (!visible) return null;
  return (
    <View
      style={[
        styles.bar,
        {
          backgroundColor: theme.colors.surface,
          borderTopColor: theme.colors.outlineVariant,
          paddingBottom: Math.max(insets.bottom, 10),
          flexDirection: rowDirection,
        },
      ]}
    >
      <Button
        mode="contained"
        onPress={onSave}
        loading={saving}
        disabled={saving || disabled}
        buttonColor={color}
        textColor="#FFFFFF"
        style={styles.save}
        contentStyle={styles.content}
        labelStyle={styles.label}
      >
        {saveLabel || t('docs.saveChanges', 'שמור שינויים')}
      </Button>
      {onDiscard ? (
        <Button mode="text" onPress={onDiscard} disabled={saving} textColor={theme.colors.onSurfaceVariant} contentStyle={styles.content}>
          {t('docs.discard', 'בטל')}
        </Button>
      ) : null}
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
    gap: 8,
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
  },
  save: { flex: 1, borderRadius: 12 },
  content: { height: 46 },
  label: { fontSize: 15, fontWeight: '700' },
});

export default StickySaveBar;
