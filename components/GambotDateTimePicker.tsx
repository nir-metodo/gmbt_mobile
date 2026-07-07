import React, { useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, Modal, Pressable, ScrollView, Platform } from 'react-native';
import { Text, Button } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import DateTimePicker, { DateTimePickerAndroid, DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../hooks/useAppTheme';
import { useRTL } from '../hooks/useRTL';

interface Props {
  visible: boolean;
  /** Current value — Date, ISO string, or null/empty. */
  value?: Date | string | null;
  /** 'datetime' shows date + time; 'date' shows only the date; 'time' only the time. Default 'datetime'. */
  mode?: 'datetime' | 'date' | 'time';
  /** Earliest selectable date (native wheel enforces it on iOS; used for the Android date dialog). */
  minimumDate?: Date;
  /** Kept for API compatibility (no longer used with the native wheel). */
  minuteStep?: number;
  title?: string;
  /** Show a "Clear" button that calls onClear. */
  allowClear?: boolean;
  onConfirm: (date: Date) => void;
  onClear?: () => void;
  onDismiss: () => void;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function toDate(value?: Date | string | null): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/**
 * Friendly date & time picker built on the native spinner wheel — the layout users found the most
 * convenient (the same wheel the lead "Add task" sheet used).
 *
 * Crucially, changes only update a local `draft`; nothing is committed until the user taps "Save".
 * That's what fixes the old native-picker complaints (the default/dialog display would close on the
 * first tick and silently drop the value). Presets + Clear stay for quick edits.
 *
 * iOS renders the inline `display="spinner"` wheel. Android must NOT render the native picker inline
 * inside a React Native <Modal> (it throws "Fragment already added" and crashes), so it opens the
 * date/time dialogs imperatively — mirroring the proven chat-schedule flow.
 */
export default function GambotDateTimePicker({
  visible,
  value,
  mode = 'datetime',
  minimumDate,
  title,
  allowClear = false,
  onConfirm,
  onClear,
  onDismiss,
}: Props) {
  const theme = useAppTheme();
  const { flexDirection, textAlign } = useRTL();
  const { t, i18n } = useTranslation();
  const lang = i18n.language === 'he' ? 'he' : 'en';
  const insets = useSafeAreaInsets();

  // Default: today's date, and a clean 09:00 start time when none was supplied — so "pick only a
  // date" still yields a sensible time.
  const seed = () => {
    const existing = toDate(value);
    if (existing) return existing;
    const d = new Date();
    d.setHours(9, 0, 0, 0);
    return d;
  };

  const [draft, setDraft] = useState<Date>(seed);

  // Re-seed from the incoming value each time the sheet opens.
  useEffect(() => {
    if (!visible) return;
    setDraft(seed());
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const applyPreset = (d: Date) => setDraft(d);

  const setTimeOnDraft = (h: number, m: number) => setDraft((prev) => { const n = new Date(prev); n.setHours(h, m, 0, 0); return n; });

  const presets: Array<{ label: string; make?: () => Date; apply?: () => void }> =
    mode === 'time'
      ? [
          { label: '09:00', apply: () => setTimeOnDraft(9, 0) },
          { label: '12:00', apply: () => setTimeOnDraft(12, 0) },
          { label: '15:00', apply: () => setTimeOnDraft(15, 0) },
          { label: '18:00', apply: () => setTimeOnDraft(18, 0) },
          { label: lang === 'he' ? 'עכשיו' : 'Now', apply: () => { const n = new Date(); setTimeOnDraft(n.getHours(), n.getMinutes()); } },
        ]
      : mode === 'date'
        ? [
            { label: lang === 'he' ? 'היום' : 'Today', make: () => startOfDay(new Date()) },
            { label: lang === 'he' ? 'מחר' : 'Tomorrow', make: () => startOfDay(new Date(Date.now() + DAY_MS)) },
            { label: lang === 'he' ? 'עוד שבוע' : 'In a week', make: () => startOfDay(new Date(Date.now() + 7 * DAY_MS)) },
          ]
        : [
            { label: lang === 'he' ? 'עכשיו' : 'Now', make: () => new Date() },
            { label: lang === 'he' ? 'בעוד שעה' : 'In 1 hour', make: () => new Date(Date.now() + 60 * 60 * 1000) },
            { label: lang === 'he' ? 'היום 18:00' : 'Today 18:00', make: () => { const d = startOfDay(new Date()); d.setHours(18); return d; } },
            { label: lang === 'he' ? 'מחר 09:00' : 'Tomorrow 09:00', make: () => { const d = startOfDay(new Date(Date.now() + DAY_MS)); d.setHours(9); return d; } },
            { label: lang === 'he' ? 'עוד שבוע' : 'In a week', make: () => new Date(draft.getTime() + 7 * DAY_MS) },
          ];

  const headerValue = useMemo(() => {
    const fmt: Intl.DateTimeFormatOptions =
      mode === 'time' ? { hour: '2-digit', minute: '2-digit' }
      : mode === 'date' ? { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }
      : { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' };
    try {
      return draft.toLocaleString(lang === 'he' ? 'he-IL' : 'en-US', fmt);
    } catch {
      const p = (n: number) => n.toString().padStart(2, '0');
      return mode === 'time'
        ? `${p(draft.getHours())}:${p(draft.getMinutes())}`
        : `${p(draft.getDate())}/${p(draft.getMonth() + 1)}/${draft.getFullYear()}${mode === 'datetime' ? ` ${p(draft.getHours())}:${p(draft.getMinutes())}` : ''}`;
    }
  }, [draft, lang, mode]);

  const pad = (n: number) => n.toString().padStart(2, '0');
  const bannerIcon = mode === 'time' ? 'clock-outline' : mode === 'date' ? 'calendar' : 'calendar-clock';

  // ── Android: open the native dialogs imperatively (inline inside a Modal crashes on Android). ──
  const openAndroidDate = () => {
    DateTimePickerAndroid.open({
      value: draft,
      mode: 'date',
      minimumDate,
      onChange: (e: DateTimePickerEvent, d?: Date) => {
        if (e.type !== 'set' || !d) return;
        setDraft((prev) => {
          const n = new Date(prev);
          n.setFullYear(d.getFullYear(), d.getMonth(), d.getDate());
          return n;
        });
      },
    });
  };

  const openAndroidTime = () => {
    DateTimePickerAndroid.open({
      value: draft,
      mode: 'time',
      is24Hour: true,
      onChange: (e: DateTimePickerEvent, d?: Date) => {
        if (e.type !== 'set' || !d) return;
        setDraft((prev) => {
          const n = new Date(prev);
          n.setHours(d.getHours(), d.getMinutes(), 0, 0);
          return n;
        });
      },
    });
  };

  const dateText = (() => {
    try { return draft.toLocaleDateString(lang === 'he' ? 'he-IL' : 'en-US', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }); }
    catch { return `${pad(draft.getDate())}/${pad(draft.getMonth() + 1)}/${draft.getFullYear()}`; }
  })();
  const timeText = `${pad(draft.getHours())}:${pad(draft.getMinutes())}`;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onDismiss} statusBarTranslucent>
      <Pressable style={styles.overlay} onPress={onDismiss}>
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={[styles.sheet, { backgroundColor: theme.colors.surface, paddingBottom: insets.bottom + 12 }]}
        >
          {/* Header */}
          <View style={[styles.header, { flexDirection }]}>
            <Text variant="titleMedium" style={{ color: theme.colors.onSurface, fontWeight: '700', flex: 1, textAlign }}>
              {title || (lang === 'he'
                ? (mode === 'time' ? 'בחירת שעה' : mode === 'date' ? 'בחירת תאריך' : 'בחירת תאריך ושעה')
                : (mode === 'time' ? 'Pick a time' : mode === 'date' ? 'Pick a date' : 'Pick date & time'))}
            </Text>
            <Pressable onPress={onDismiss} hitSlop={10}>
              <MaterialCommunityIcons name="close" size={22} color={theme.colors.onSurfaceVariant} />
            </Pressable>
          </View>

          {/* Selected value banner */}
          <View style={[styles.valueBanner, { backgroundColor: `${theme.colors.primary}14`, borderColor: `${theme.colors.primary}33` }]}>
            <MaterialCommunityIcons name={bannerIcon} size={18} color={theme.colors.primary} />
            <Text style={{ color: theme.colors.primary, fontWeight: '700', fontSize: 15 }}>{headerValue}</Text>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={{ maxHeight: 420 }}>
            {/* Quick presets */}
            <View style={[styles.presetRow, { flexDirection }]}>
              {presets.map((p) => (
                <Pressable
                  key={p.label}
                  onPress={() => (p.apply ? p.apply() : p.make && applyPreset(p.make()))}
                  style={[styles.presetChip, { backgroundColor: theme.colors.surfaceVariant }]}
                >
                  <Text style={{ color: theme.colors.onSurface, fontSize: 12, fontWeight: '600' }}>{p.label}</Text>
                </Pressable>
              ))}
            </View>

            {/* Native wheel — iOS inline spinner; Android tappable fields (native dialogs). */}
            {Platform.OS === 'ios' ? (
              <View style={styles.wheelWrap}>
                <DateTimePicker
                  value={draft}
                  mode={mode === 'time' ? 'time' : mode === 'date' ? 'date' : 'datetime'}
                  display="spinner"
                  is24Hour
                  minimumDate={minimumDate}
                  themeVariant={theme.dark ? 'dark' : 'light'}
                  locale={lang === 'he' ? 'he-IL' : 'en-US'}
                  onChange={(_e: DateTimePickerEvent, d?: Date) => { if (d) setDraft(d); }}
                  style={styles.iosWheel}
                />
              </View>
            ) : (
              <View style={{ gap: 10, marginTop: 4 }}>
                {mode !== 'time' && (
                  <Pressable
                    onPress={openAndroidDate}
                    style={[styles.androidField, { borderColor: theme.colors.outline, flexDirection }]}
                  >
                    <MaterialCommunityIcons name="calendar" size={20} color={theme.colors.primary} />
                    <Text style={{ color: theme.colors.onSurface, fontWeight: '600', fontSize: 15, flex: 1, textAlign }}>
                      {dateText}
                    </Text>
                    <MaterialCommunityIcons name="chevron-down" size={20} color={theme.colors.onSurfaceVariant} />
                  </Pressable>
                )}

                {mode !== 'date' && (
                  <Pressable
                    onPress={openAndroidTime}
                    style={[styles.androidField, { borderColor: theme.colors.outline, flexDirection }]}
                  >
                    <MaterialCommunityIcons name="clock-outline" size={20} color={theme.colors.primary} />
                    <Text style={{ color: theme.colors.onSurface, fontWeight: '600', fontSize: 15, flex: 1, textAlign }}>
                      {timeText}
                    </Text>
                    <MaterialCommunityIcons name="chevron-down" size={20} color={theme.colors.onSurfaceVariant} />
                  </Pressable>
                )}
              </View>
            )}
          </ScrollView>

          {/* Footer actions */}
          <View style={[styles.footer, { flexDirection }]}>
            {allowClear && (
              <Button mode="text" onPress={() => { onClear?.(); onDismiss(); }} textColor={theme.colors.error} style={{ flex: 1 }}>
                {lang === 'he' ? 'נקה' : 'Clear'}
              </Button>
            )}
            <Button mode="outlined" onPress={onDismiss} style={{ flex: 1 }} textColor={theme.colors.onSurfaceVariant}>
              {t('common.cancel', lang === 'he' ? 'ביטול' : 'Cancel')}
            </Button>
            <Button mode="contained" onPress={() => { onConfirm(draft); onDismiss(); }} style={{ flex: 1 }}>
              {t('common.save', lang === 'he' ? 'שמור' : 'Save')}
            </Button>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 18, paddingTop: 14 },
  header: { alignItems: 'center', marginBottom: 12, gap: 8 },
  valueBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 10, borderRadius: 12, borderWidth: 1, marginBottom: 12 },
  presetRow: { flexWrap: 'wrap', gap: 8, marginBottom: 8, justifyContent: 'center' },
  presetChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 18 },
  wheelWrap: { alignItems: 'center', justifyContent: 'center' },
  iosWheel: { alignSelf: 'stretch', height: 200 },
  androidField: { alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 16 },
  footer: { gap: 10, marginTop: 10, alignItems: 'center' },
});
