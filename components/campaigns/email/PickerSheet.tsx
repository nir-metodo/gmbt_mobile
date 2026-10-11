import React, { useEffect, useMemo, useState } from 'react';
import { View, Modal, Pressable, FlatList, StyleSheet } from 'react-native';
import { Text, Button, TextInput, Checkbox, ActivityIndicator } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '../../../hooks/useAppTheme';
import { useRTL } from '../../../hooks/useRTL';
import { BRAND } from './emailCampaignHelpers';

export interface PickerItem {
  value: string;
  label: string;
  subtitle?: string;
}

interface Props {
  visible: boolean;
  title: string;
  items: PickerItem[];
  /** 'single' picks one and closes, 'multi' needs the confirm button, 'view' is a read-only list. */
  mode: 'single' | 'multi' | 'view';
  selected?: string[];
  loading?: boolean;
  emptyText?: string;
  confirmLabel?: string;
  searchPlaceholder?: string;
  onDismiss: () => void;
  onConfirm?: (selected: string[]) => void;
}

/** Bottom-sheet list picker with search — used for templates, tags, contact fields and the audience preview. */
export default function PickerSheet({
  visible,
  title,
  items,
  mode,
  selected = [],
  loading,
  emptyText,
  confirmLabel,
  searchPlaceholder,
  onDismiss,
  onConfirm,
}: Props) {
  const theme = useAppTheme();
  const { flexDirection, textAlign } = useRTL();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<string[]>(selected);

  useEffect(() => {
    if (visible) {
      setQuery('');
      setDraft(selected);
    }
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) => i.label.toLowerCase().includes(q) || (i.subtitle || '').toLowerCase().includes(q));
  }, [items, query]);

  const toggle = (value: string) => {
    if (mode === 'single') {
      onConfirm?.([value]);
      onDismiss();
      return;
    }
    if (mode === 'multi') setDraft((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onDismiss} statusBarTranslucent>
      <Pressable style={styles.overlay} onPress={onDismiss}>
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={[styles.sheet, { backgroundColor: theme.colors.surface, paddingBottom: insets.bottom + 12 }]}
        >
          <View style={[styles.header, { flexDirection }]}>
            <Text variant="titleMedium" style={{ flex: 1, textAlign, fontWeight: '700', color: theme.colors.onSurface }}>
              {title}
            </Text>
            <Pressable onPress={onDismiss} hitSlop={10}>
              <MaterialCommunityIcons name="close" size={22} color={theme.colors.onSurfaceVariant} />
            </Pressable>
          </View>

          {items.length > 8 && (
            <TextInput
              mode="outlined"
              dense
              value={query}
              onChangeText={setQuery}
              placeholder={searchPlaceholder}
              left={<TextInput.Icon icon="magnify" />}
              style={{ marginBottom: 8, backgroundColor: theme.colors.surface }}
              outlineColor={theme.colors.outline}
              activeOutlineColor={BRAND}
            />
          )}

          {loading ? (
            <ActivityIndicator color={BRAND} style={{ marginVertical: 32 }} />
          ) : (
            <FlatList
              data={filtered}
              keyExtractor={(i, idx) => `${i.value}-${idx}`}
              style={{ maxHeight: 420 }}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={
                <Text style={{ textAlign: 'center', color: theme.colors.onSurfaceVariant, marginVertical: 24 }}>
                  {emptyText || '—'}
                </Text>
              }
              renderItem={({ item }) => {
                const checked = mode === 'multi' ? draft.includes(item.value) : selected.includes(item.value);
                return (
                  <Pressable
                    onPress={() => toggle(item.value)}
                    disabled={mode === 'view'}
                    style={[styles.row, { flexDirection, borderBottomColor: theme.colors.outline }]}
                  >
                    {mode === 'multi' && <Checkbox status={checked ? 'checked' : 'unchecked'} color={BRAND} onPress={() => toggle(item.value)} />}
                    <View style={{ flex: 1 }}>
                      <Text style={{ textAlign, color: theme.colors.onSurface, fontWeight: checked && mode !== 'multi' ? '700' : '500' }} numberOfLines={1}>
                        {item.label}
                      </Text>
                      {!!item.subtitle && (
                        <Text style={{ textAlign, color: theme.colors.onSurfaceVariant, fontSize: 12 }} numberOfLines={1}>
                          {item.subtitle}
                        </Text>
                      )}
                    </View>
                    {mode === 'single' && checked && <MaterialCommunityIcons name="check" size={20} color={BRAND} />}
                  </Pressable>
                );
              }}
            />
          )}

          {mode === 'multi' && (
            <Button
              mode="contained"
              buttonColor={BRAND}
              style={{ marginTop: 12 }}
              onPress={() => {
                onConfirm?.(draft);
                onDismiss();
              }}
            >
              {confirmLabel || 'OK'}
            </Button>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 16, paddingTop: 14 },
  header: { alignItems: 'center', marginBottom: 10, gap: 8 },
  row: { alignItems: 'center', gap: 8, paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth },
});
