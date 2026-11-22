import React, { useCallback, useEffect, useState } from 'react';
import { View, Pressable, Alert } from 'react-native';
import { Text, TextInput, Button, ActivityIndicator } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useAppTheme } from '../../hooks/useAppTheme';
import { calendarApi, OUTCOME_KEYS, OUTCOME_META, TimelineItem } from '../../services/api/calendar';

// "Did the meeting happen?" + the event's timeline, shown inside the event edit form.
// One tap on a status saves it right away (optional note goes into the timeline); tap the selected one again to clear.
interface Props {
  org: string;
  eventId: string;
  outcome: string;
  awaiting: boolean;
  userName: string;
  isRTL: boolean;
  onOutcomeChanged: (outcome: string) => void;
}

const fmt = (iso?: string, he = true) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(he ? 'he-IL' : 'en-US', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};

export default function EventOutcomeSection({ org, eventId, outcome, awaiting, userName, isRTL, onOutcomeChanged }: Props) {
  const theme = useAppTheme();
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [addingNote, setAddingNote] = useState(false);
  const L = (he: string, en: string) => (isRTL ? he : en);
  const textAlign = isRTL ? ('right' as const) : ('left' as const);
  const rowDir = isRTL ? ('row-reverse' as const) : ('row' as const);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await calendarApi.getTimeline(org, 'event', eventId));
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [org, eventId]);

  useEffect(() => { load(); }, [load]);

  const lbl = (v?: string) => (v ? (isRTL ? OUTCOME_META[v]?.he : OUTCOME_META[v]?.en) || v : L('מתוכנן', 'Scheduled'));

  const choose = async (key: string) => {
    if (saving) return;
    const next = outcome === key ? '' : key;
    setSaving(true);
    try {
      await calendarApi.setOutcome(org, eventId, next, note.trim(), userName);
      onOutcomeChanged(next);
      setNote('');
      load();
    } catch (e: any) {
      Alert.alert(L('שגיאה', 'Error'), e?.message || L('העדכון נכשל', 'Update failed'));
    } finally {
      setSaving(false);
    }
  };

  const addNote = async () => {
    const t = noteText.trim();
    if (!t || addingNote) return;
    setAddingNote(true);
    try {
      await calendarApi.addTimelineNote(org, 'event', eventId, t, userName);
      setNoteText('');
      load();
    } catch (e: any) {
      Alert.alert(L('שגיאה', 'Error'), e?.message || L('ההערה לא נשמרה', 'Note not saved'));
    } finally {
      setAddingNote(false);
    }
  };

  const describe = (it: TimelineItem): { icon: string; title: string; sub?: string } => {
    switch (it.type) {
      case 'created': return { icon: 'plus-circle-outline', title: L('נוצר', 'Created'), sub: it.to ? `${L('למועד', 'For')} ${it.to}` : '' };
      case 'rescheduled': return { icon: 'calendar-refresh-outline', title: L('המועד שונה', 'Rescheduled'), sub: `${it.from || '—'} → ${it.to || '—'}` };
      case 'outcome': return { icon: 'flag-checkered', title: `${lbl(it.from)} → ${lbl(it.to)}` };
      default: return { icon: 'note-text-outline', title: it.text || L('הערה', 'Note') };
    }
  };

  return (
    <View style={{ marginTop: 12 }}>
      <View
        style={{
          backgroundColor: awaiting ? '#fffbeb' : theme.colors.surfaceVariant,
          borderWidth: 1,
          borderColor: awaiting ? '#fde68a' : theme.colors.outlineVariant,
          borderRadius: 12,
          padding: 12,
        }}
      >
        <Text style={{ fontWeight: '700', fontSize: 15, textAlign, color: theme.colors.onSurface }}>
          {L('האם התקיימה הפגישה?', 'Did the meeting happen?')}
          {awaiting ? `  ❔ ${L('ממתין לעדכון', 'awaiting update')}` : ''}
        </Text>

        <View style={{ flexDirection: rowDir, flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
          {OUTCOME_KEYS.map((k) => {
            const m = OUTCOME_META[k];
            const sel = outcome === k;
            return (
              <Pressable
                key={k}
                disabled={saving}
                onPress={() => choose(k)}
                style={{
                  flexDirection: rowDir,
                  alignItems: 'center',
                  gap: 6,
                  paddingVertical: 9,
                  paddingHorizontal: 14,
                  borderRadius: 999,
                  borderWidth: 1.5,
                  borderColor: sel ? m.fg : theme.colors.outline,
                  backgroundColor: sel ? m.bg : 'transparent',
                  opacity: saving ? 0.6 : 1,
                }}
              >
                <MaterialCommunityIcons name={m.icon as any} size={18} color={sel ? m.fg : theme.colors.onSurfaceVariant} />
                <Text style={{ fontWeight: '600', color: sel ? m.fg : theme.colors.onSurface }}>{isRTL ? m.he : m.en}</Text>
              </Pressable>
            );
          })}
        </View>

        <TextInput
          mode="outlined"
          dense
          value={note}
          onChangeText={setNote}
          maxLength={2000}
          placeholder={L('הערה לסטטוס (אופציונלי)', 'Status note (optional)')}
          style={{ marginTop: 10, textAlign }}
        />
      </View>

      <View style={{ marginTop: 12, borderWidth: 1, borderColor: theme.colors.outlineVariant, borderRadius: 12, padding: 12 }}>
        <Text style={{ fontWeight: '700', fontSize: 15, textAlign, color: theme.colors.onSurface }}>🕒 {L('ציר זמן', 'Timeline')}</Text>

        <View style={{ flexDirection: rowDir, gap: 8, marginTop: 10, alignItems: 'center' }}>
          <TextInput
            mode="outlined"
            dense
            value={noteText}
            onChangeText={setNoteText}
            maxLength={2000}
            placeholder={L('מה קרה? הוסף הערה…', 'What happened? Add a note…')}
            style={{ flex: 1, textAlign }}
            onSubmitEditing={addNote}
          />
          <Button mode="contained" compact onPress={addNote} loading={addingNote} disabled={addingNote || !noteText.trim()} buttonColor="#2e6155" textColor="white">
            {L('הוסף', 'Add')}
          </Button>
        </View>

        {loading && items.length === 0 ? <ActivityIndicator style={{ marginTop: 10 }} /> : null}
        {!loading && items.length === 0 ? (
          <Text style={{ marginTop: 10, textAlign, color: theme.colors.onSurfaceVariant, fontSize: 12 }}>{L('עדיין אין רשומות', 'No entries yet')}</Text>
        ) : null}

        {items.map((it) => {
          const d = describe(it);
          return (
            <View key={it.id} style={{ flexDirection: rowDir, gap: 8, marginTop: 10, alignItems: 'flex-start' }}>
              <MaterialCommunityIcons name={d.icon as any} size={18} color={theme.colors.onSurfaceVariant} style={{ marginTop: 1 }} />
              <View style={{ flex: 1 }}>
                <Text style={{ textAlign, color: theme.colors.onSurface, fontWeight: it.type === 'note' ? '400' : '600' }}>{d.title}</Text>
                {d.sub ? <Text style={{ textAlign, color: theme.colors.onSurfaceVariant, fontSize: 12 }}>{d.sub}</Text> : null}
                {it.type !== 'note' && it.text ? <Text style={{ textAlign, color: theme.colors.onSurface, fontSize: 13, marginTop: 2 }}>{it.text}</Text> : null}
                <Text style={{ textAlign, color: theme.colors.onSurfaceVariant, fontSize: 11, marginTop: 1 }}>
                  {[it.userName, fmt(it.createdOn, isRTL)].filter(Boolean).join(' · ')}
                </Text>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}
