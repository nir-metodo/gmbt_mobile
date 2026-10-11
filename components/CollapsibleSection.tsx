import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../hooks/useAppTheme';
import { useRowDirection } from '../hooks/useRowDirection';

interface CollapsibleSectionProps {
  /** Row title. Defaults to "More options". */
  title?: string;
  /** Short grey hint shown on the collapsed row (e.g. "Terms, salesperson, currency"). */
  hint?: string;
  icon?: string;
  defaultOpen?: boolean;
  /** Called the first time the section is opened (lazy-load its content). */
  onOpen?: () => void;
  children: React.ReactNode;
}

/** The single collapsed "More options / Advanced" row that hides rarely-used or technical fields. */
export function CollapsibleSection({ title, hint, icon = 'tune-variant', defaultOpen = false, onOpen, children }: CollapsibleSectionProps) {
  const theme = useAppTheme();
  const rowDirection = useRowDirection();
  const { t } = useTranslation();
  const [open, setOpen] = useState(defaultOpen);
  return (
    <View style={[styles.card, { backgroundColor: theme.custom.cardBackground, borderColor: theme.colors.outlineVariant }]}>
      <Pressable
        onPress={() => {
          if (!open) onOpen?.();
          setOpen((o) => !o);
        }}
        style={[styles.row, { flexDirection: rowDirection }]}
      >
        <MaterialCommunityIcons name={icon as any} size={20} color={theme.colors.onSurfaceVariant} />
        <View style={{ flex: 1 }}>
          <Text variant="titleSmall" style={{ color: theme.colors.onSurface, fontWeight: '600' }}>
            {title || t('docs.moreOptions', 'אפשרויות נוספות')}
          </Text>
          {!open && hint ? (
            <Text variant="labelSmall" numberOfLines={1} style={{ color: theme.colors.onSurfaceVariant }}>
              {hint}
            </Text>
          ) : null}
        </View>
        <MaterialCommunityIcons name={open ? 'chevron-up' : 'chevron-down'} size={22} color={theme.colors.onSurfaceVariant} />
      </Pressable>
      {open ? <View style={styles.body}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 14, borderWidth: 1, overflow: 'hidden' },
  row: { alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 14 },
  body: { paddingHorizontal: 14, paddingBottom: 14, gap: 4 },
});

export default CollapsibleSection;
