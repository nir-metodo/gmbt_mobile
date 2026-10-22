import React, { useEffect, useState } from 'react';
import { View, StyleSheet, ScrollView, Pressable } from 'react-native';
import { Text, Chip, Button, Modal, Portal, TextInput } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useRTL } from '../../hooks/useRTL';
import GambotDateTimePicker from '../GambotDateTimePicker';
import { formatDate } from '../../utils/formatters';
import type { InvoiceCreator } from '../../services/api/invoices';

const BRAND_COLOR = '#2e6155';

export interface InvoiceFilters {
  fromDate: string; // yyyy-MM-dd or ''
  toDate: string;
  createdBy: string; // user id or ''
  minAmount: string;
  maxAmount: string;
}

export const EMPTY_INVOICE_FILTERS: InvoiceFilters = { fromDate: '', toDate: '', createdBy: '', minAmount: '', maxAmount: '' };

export const countInvoiceFilters = (f: InvoiceFilters) =>
  (f.fromDate || f.toDate ? 1 : 0) + (f.createdBy ? 1 : 0) + (f.minAmount || f.maxAmount ? 1 : 0);

const pad = (n: number) => String(n).padStart(2, '0');
export const toYMD = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

type Preset = { key: string; label: string; range: () => [string, string] };

function buildPresets(t: (k: string, d: string) => string): Preset[] {
  return [
    { key: 'today', label: t('invoices.presetToday', 'היום'), range: () => { const n = new Date(); return [toYMD(n), toYMD(n)]; } },
    { key: '7d', label: t('invoices.preset7d', '7 ימים'), range: () => { const n = new Date(); const s = new Date(); s.setDate(n.getDate() - 6); return [toYMD(s), toYMD(n)]; } },
    { key: 'month', label: t('invoices.presetMonth', 'החודש'), range: () => { const n = new Date(); return [toYMD(new Date(n.getFullYear(), n.getMonth(), 1)), toYMD(n)]; } },
    { key: 'lastMonth', label: t('invoices.presetLastMonth', 'חודש שעבר'), range: () => { const n = new Date(); return [toYMD(new Date(n.getFullYear(), n.getMonth() - 1, 1)), toYMD(new Date(n.getFullYear(), n.getMonth(), 0))]; } },
    { key: 'year', label: t('invoices.presetYear', 'השנה'), range: () => { const n = new Date(); return [toYMD(new Date(n.getFullYear(), 0, 1)), toYMD(n)]; } },
  ];
}

interface Props {
  visible: boolean;
  filters: InvoiceFilters;
  creators: InvoiceCreator[];
  onApply: (f: InvoiceFilters) => void;
  onDismiss: () => void;
}

/** Date range, "created by" and amount range — applied together with a single tap (no refetch per change). */
export function InvoiceFiltersSheet({ visible, filters, creators, onApply, onDismiss }: Props) {
  const theme = useAppTheme();
  const { textAlign } = useRTL();
  const { t } = useTranslation();
  const [draft, setDraft] = useState<InvoiceFilters>(filters);
  const [picking, setPicking] = useState<'from' | 'to' | null>(null);

  useEffect(() => { if (visible) setDraft(filters); }, [visible, filters]);

  const presets = buildPresets(t as any);
  const activePreset = presets.find((p) => {
    const [a, b] = p.range();
    return draft.fromDate === a && draft.toDate === b;
  })?.key;

  const set = (patch: Partial<InvoiceFilters>) => setDraft((d) => ({ ...d, ...patch }));
  const label = (txt: string) => (
    <Text variant="labelMedium" style={[styles.label, { color: theme.colors.onSurfaceVariant, textAlign }]}>{txt}</Text>
  );
  const dateBtn = (which: 'from' | 'to', value: string, placeholder: string) => (
    <Pressable
      onPress={() => setPicking(which)}
      style={[styles.dateBtn, { borderColor: value ? BRAND_COLOR : theme.colors.outlineVariant, backgroundColor: theme.colors.surfaceVariant }]}
    >
      <MaterialCommunityIcons name="calendar-month-outline" size={18} color={value ? BRAND_COLOR : theme.colors.onSurfaceVariant} />
      <Text style={{ flex: 1, color: value ? theme.colors.onSurface : theme.colors.onSurfaceVariant, textAlign }}>
        {value ? formatDate(value) : placeholder}
      </Text>
      {value ? (
        <Pressable hitSlop={8} onPress={() => set(which === 'from' ? { fromDate: '' } : { toDate: '' })}>
          <MaterialCommunityIcons name="close-circle" size={18} color={theme.colors.onSurfaceVariant} />
        </Pressable>
      ) : null}
    </Pressable>
  );

  const chip = (key: string, text: string, selected: boolean, onPress: () => void) => (
    <Chip
      key={key}
      selected={selected}
      compact
      onPress={onPress}
      style={[styles.chip, { backgroundColor: selected ? theme.colors.primaryContainer : theme.colors.surfaceVariant }]}
      textStyle={[styles.chipText, selected && { color: theme.colors.primary, fontWeight: '600' }]}
    >
      {text}
    </Chip>
  );

  return (
    <Portal>
      <Modal
        visible={visible}
        onDismiss={onDismiss}
        contentContainerStyle={[styles.modal, { backgroundColor: theme.colors.surface }]}
      >
        <Text variant="titleLarge" style={{ color: theme.colors.onSurface, fontWeight: '700', marginBottom: 4, textAlign }}>
          {t('invoices.filters', 'סינון')}
        </Text>

        <ScrollView showsVerticalScrollIndicator={false} style={{ flexShrink: 1 }} keyboardShouldPersistTaps="handled">
          {label(t('invoices.dateRange', 'טווח תאריכים (תאריך המסמך)'))}
          <View style={styles.chipRow}>
            {presets.map((p) =>
              chip(p.key, p.label, activePreset === p.key, () => {
                if (activePreset === p.key) set({ fromDate: '', toDate: '' });
                else { const [a, b] = p.range(); set({ fromDate: a, toDate: b }); }
              }),
            )}
          </View>
          <View style={styles.dateRow}>
            <View style={{ flex: 1 }}>{dateBtn('from', draft.fromDate, t('invoices.from', 'מתאריך'))}</View>
            <View style={{ flex: 1 }}>{dateBtn('to', draft.toDate, t('invoices.to', 'עד תאריך'))}</View>
          </View>

          {creators.length > 0 ? (
            <>
              {label(t('invoices.createdBy', 'נוצר על ידי'))}
              <View style={styles.chipRow}>
                {creators.map((c) =>
                  chip(c.id, `${c.name || t('invoices.unknownUser', 'משתמש')} (${c.count})`, draft.createdBy === c.id, () =>
                    set({ createdBy: draft.createdBy === c.id ? '' : c.id }),
                  ),
                )}
              </View>
            </>
          ) : null}

          {label(t('invoices.amountRange', 'טווח סכום'))}
          <View style={styles.dateRow}>
            <TextInput
              mode="outlined"
              dense
              style={{ flex: 1, textAlign }}
              keyboardType="numeric"
              placeholder={t('invoices.minAmount', 'מינימום')}
              value={draft.minAmount}
              onChangeText={(v) => set({ minAmount: v.replace(/[^0-9.]/g, '') })}
              activeOutlineColor={BRAND_COLOR}
            />
            <TextInput
              mode="outlined"
              dense
              style={{ flex: 1, textAlign }}
              keyboardType="numeric"
              placeholder={t('invoices.maxAmount', 'מקסימום')}
              value={draft.maxAmount}
              onChangeText={(v) => set({ maxAmount: v.replace(/[^0-9.]/g, '') })}
              activeOutlineColor={BRAND_COLOR}
            />
          </View>
        </ScrollView>

        <View style={styles.footer}>
          <Button mode="outlined" onPress={() => setDraft(EMPTY_INVOICE_FILTERS)} textColor={theme.colors.onSurface}>
            {t('common.clear', 'נקה')}
          </Button>
          <Button mode="contained" onPress={() => onApply(draft)} buttonColor={BRAND_COLOR} textColor="#FFF">
            {t('common.apply', 'החל')}{countInvoiceFilters(draft) > 0 ? ` (${countInvoiceFilters(draft)})` : ''}
          </Button>
        </View>
      </Modal>

      <GambotDateTimePicker
        visible={picking !== null}
        mode="date"
        value={picking === 'from' ? draft.fromDate : draft.toDate}
        title={picking === 'from' ? t('invoices.from', 'מתאריך') : t('invoices.to', 'עד תאריך')}
        allowClear
        onConfirm={(d) => {
          const ymd = toYMD(d);
          setDraft((prev) => (picking === 'from' ? { ...prev, fromDate: ymd } : { ...prev, toDate: ymd }));
          setPicking(null);
        }}
        onClear={() => {
          setDraft((prev) => (picking === 'from' ? { ...prev, fromDate: '' } : { ...prev, toDate: '' }));
          setPicking(null);
        }}
        onDismiss={() => setPicking(null)}
      />
    </Portal>
  );
}

const styles = StyleSheet.create({
  modal: { marginHorizontal: 20, borderRadius: 18, padding: 20, maxHeight: '85%' },
  label: { marginBottom: 6, marginTop: 14 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { height: 32 },
  chipText: { fontSize: 13 },
  dateRow: { flexDirection: 'row', gap: 10, marginTop: 8 },
  dateBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, height: 44 },
  footer: { flexDirection: 'row', gap: 12, justifyContent: 'flex-end', marginTop: 16 },
});

export default InvoiceFiltersSheet;
