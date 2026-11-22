import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Text, TextInput } from 'react-native-paper';
import type { MD3Theme } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { phoneCallsApi } from '../../services/api/phoneCalls';
import { useAuthStore } from '../../stores/authStore';
import { RecordingPlayer } from './RecordingPlayer';
import AddTaskSheet from '../AddTaskSheet';
import type { PhoneCall } from '../../types';

const BRAND_COLOR = '#2e6155';

interface Props {
  call: PhoneCall;
  org: string;
  isRTL: boolean;
  t: (key: string, fallback?: string) => string;
  themeColors: MD3Theme['colors'];
}

/**
 * Everything about one call, in one place (the calls list, the contact card): the recording player, the AI summary
 * (with a "summarize with AI" button when there is a recording but no summary yet), the agent's editable notes,
 * the transcript, the AI's action items and "add task". Same record as the web call page.
 */
export default function CallDetailPanel({ call, org, isRTL, t, themeColors }: Props) {
  const user = useAuthStore((s) => s.user);
  const [showFullTranscript, setShowFullTranscript] = useState(false);
  const [info, setInfo] = useState<any | null>(null);
  const [notesDraft, setNotesDraft] = useState('');
  const [notesState, setNotesState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [summarizing, setSummarizing] = useState(false);
  const [summaryError, setSummaryError] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const callKey = call.callId || call.id;
  const isPbx = call.source === 'pbx';

  useEffect(() => {
    if (!isPbx || !callKey) return undefined;
    let cancelled = false;
    phoneCallsApi.getCallSummary(org, callKey).then((data) => {
      if (cancelled || !data) return;
      setInfo(data);
      setNotesDraft(data.documentation?.notes || '');
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [isPbx, callKey, org]);

  const saveNotes = useCallback(async () => {
    setNotesState('saving');
    try {
      const doc = info?.documentation || {};
      const res = await phoneCallsApi.saveCallNotes(org, callKey, { notes: notesDraft, disposition: doc.disposition, tags: doc.tags }, call.phoneNumber);
      if (!res.success) throw new Error(res.error || 'save failed');
      setInfo((prev: any) => ({ ...(prev || {}), documentation: { ...(prev?.documentation || {}), notes: notesDraft } }));
      setNotesState('saved');
    } catch {
      setNotesState('error');
    }
  }, [org, callKey, notesDraft, info, call.phoneNumber]);

  const summarize = useCallback(async () => {
    if (!call.recordingUrl) return;
    setSummarizing(true);
    setSummaryError(false);
    try {
      const r = await phoneCallsApi.generateCallSummary(org, callKey, call.recordingUrl, call.phoneNumber);
      if (!r?.Success) throw new Error('no summary');
      setInfo((prev: any) => ({
        ...(prev || {}),
        summary: r.Summary,
        transcription: r.Transcription,
        extractedActions: r.Actions || [],
      }));
    } catch {
      setSummaryError(true);
    } finally {
      setSummarizing(false);
    }
  }, [org, callKey, call.recordingUrl, call.phoneNumber]);

  const summaryText: string | undefined = info?.summary || call.aiSummary;
  const transcriptText: string | undefined = info?.transcription || call.transcription;
  const actionItems: string[] = (info?.extractedActions || [])
    .map((a: any) => a?.description)
    .filter(Boolean)
    .concat(call.aiActionItems || []);
  const savedNotes: string = info?.documentation?.notes || '';
  const align = isRTL ? 'right' : 'left';
  const who = call.contactName || call.phoneNumber;

  return (
    <View>
      {call.recordingUrl ? <RecordingPlayer uri={call.recordingUrl} durationSec={call.duration} /> : null}

      {summaryText ? (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <MaterialCommunityIcons name="brain" size={16} color="#7B2D8E" />
            <Text variant="labelMedium" style={{ color: '#7B2D8E', marginHorizontal: 6 }}>{t('phoneCalls.aiSummary')}</Text>
          </View>
          <Text variant="bodySmall" style={{ color: themeColors.onSurfaceVariant, textAlign: align, marginTop: 4 }}>{summaryText}</Text>
        </View>
      ) : call.recordingUrl && isPbx ? (
        <View style={styles.section}>
          <Button
            mode="contained-tonal"
            compact
            icon="brain"
            loading={summarizing}
            disabled={summarizing}
            onPress={summarize}
          >
            {t('phoneCalls.summarizeWithAi', 'סכם שיחה עם AI')}
          </Button>
          {summarizing ? <ActivityIndicator size="small" style={{ marginTop: 6 }} /> : null}
          {summaryError ? (
            <Text variant="labelSmall" style={{ color: '#E63946', marginTop: 6, textAlign: align }}>
              {t('phoneCalls.summarizeFailed', 'לא הצלחנו לסכם את השיחה (ייתכן שהיא קצרה מדי)')}
            </Text>
          ) : null}
        </View>
      ) : null}

      {isPbx ? (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <MaterialCommunityIcons name="note-edit-outline" size={16} color={BRAND_COLOR} />
            <Text variant="labelMedium" style={{ color: BRAND_COLOR, marginHorizontal: 6 }}>{t('phoneCalls.agentNotes')}</Text>
          </View>
          <TextInput
            mode="outlined"
            multiline
            dense
            value={notesDraft}
            onChangeText={(v) => { setNotesDraft(v); setNotesState('idle'); }}
            placeholder={t('phoneCalls.notesPlaceholder')}
            style={{ marginTop: 6, minHeight: 64, backgroundColor: themeColors.surface }}
            outlineColor={BRAND_COLOR + '40'}
            activeOutlineColor={BRAND_COLOR}
            textAlign={align}
          />
          <View style={[styles.sectionHeader, { marginTop: 6 }]}>
            <Button
              mode="contained"
              compact
              buttonColor={BRAND_COLOR}
              loading={notesState === 'saving'}
              disabled={notesState === 'saving' || notesDraft === savedNotes}
              onPress={saveNotes}
            >
              {t('common.save')}
            </Button>
            {notesState === 'saved' ? (
              <Text variant="labelSmall" style={{ color: '#2A9D8F', marginHorizontal: 8 }}>{t('phoneCalls.noteSaved')}</Text>
            ) : null}
            {notesState === 'error' ? (
              <Text variant="labelSmall" style={{ color: '#E63946', marginHorizontal: 8 }}>{t('phoneCalls.noteSaveFailed')}</Text>
            ) : null}
          </View>
        </View>
      ) : null}

      {transcriptText ? (
        <View style={styles.section}>
          <Pressable onPress={() => setShowFullTranscript(!showFullTranscript)} style={styles.sectionHeader}>
            <MaterialCommunityIcons name="text-box-outline" size={16} color={BRAND_COLOR} />
            <Text variant="labelMedium" style={{ color: BRAND_COLOR, marginHorizontal: 6, flex: 1, textAlign: align }}>{t('phoneCalls.transcription')}</Text>
            <MaterialCommunityIcons name={showFullTranscript ? 'chevron-up' : 'chevron-down'} size={16} color={BRAND_COLOR} />
          </Pressable>
          <Text
            variant="bodySmall"
            numberOfLines={showFullTranscript ? undefined : 3}
            style={{ color: themeColors.onSurfaceVariant, textAlign: align, marginTop: 4 }}
          >
            {transcriptText}
          </Text>
        </View>
      ) : null}

      {actionItems.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <MaterialCommunityIcons name="clipboard-check-outline" size={16} color="#FF6B35" />
            <Text variant="labelMedium" style={{ color: '#FF6B35', marginHorizontal: 6 }}>{t('phoneCalls.actionItems')}</Text>
          </View>
          {actionItems.map((item: string, idx: number) => (
            <View key={idx} style={styles.actionItem}>
              <Text variant="bodySmall" style={{ color: themeColors.onSurfaceVariant }}>•</Text>
              <Text variant="bodySmall" style={{ color: themeColors.onSurfaceVariant, flex: 1, marginHorizontal: 6, textAlign: align }}>{item}</Text>
            </View>
          ))}
        </View>
      )}

      <Button mode="contained-tonal" compact icon="clipboard-plus-outline" style={styles.taskBtn} onPress={() => setTaskOpen(true)}>
        {t('tasks.addTask', 'הוסף משימה')}
      </Button>

      <AddTaskSheet
        visible={taskOpen}
        onDismiss={() => setTaskOpen(false)}
        organization={org}
        user={user}
        relatedTo={call.contactId ? { type: 'contact', entityId: call.contactId, entityName: call.contactName } : undefined}
        defaultTitle={`${t('phoneCalls.followUp')} - ${who}`}
        relatedPhone={call.phoneNumber}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: 10, padding: 10, backgroundColor: '#F8F9FA', borderRadius: 10 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center' },
  actionItem: { flexDirection: 'row', marginTop: 4, alignItems: 'flex-start' },
  taskBtn: { alignSelf: 'flex-start', marginTop: 10, borderRadius: 20 },
});
