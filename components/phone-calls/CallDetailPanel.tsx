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
  const [sendingIdx, setSendingIdx] = useState<number | null>(null);
  const [sendFailed, setSendFailed] = useState(false);
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
        extractedActions: (r.Actions || []).map((a: any) => ({
          type: a.Type ?? a.type, description: a.Description ?? a.description, fields: a.Fields ?? a.fields ?? {},
          status: a.Status ?? a.status, result: a.Result ?? a.result,
        })),
      }));
    } catch {
      setSummaryError(true);
    } finally {
      setSummarizing(false);
    }
  }, [org, callKey, call.recordingUrl, call.phoneNumber]);

  const summaryText: string | undefined = info?.summary || call.aiSummary;
  const transcriptText: string | undefined = info?.transcription || call.transcription;
  // "Required actions" = detected but not done yet; "performed by AI" = executed ones + what the system did for the call itself.
  const allActions: any[] = (info?.extractedActions || []).map((a: any, i: number) => ({ ...a, _i: i }));
  const pendingActions = allActions.filter((a) => a?.description && a.status !== 'executed');
  const doneActions: any[] = [
    ...allActions.filter((a) => a?.description && a.status === 'executed'),
    ...(Array.isArray(info?.performedActions) ? info.performedActions : []),
  ];
  const legacyItems: string[] = call.aiActionItems || [];
  const actionText = (a: any): string => a?.fields?.text || a?.fields?.message || a?.fields?.body || '';

  const sendNow = useCallback(async (a: any) => {
    const text = actionText(a);
    if (!text) return;
    setSendingIdx(a._i);
    try {
      const r = await phoneCallsApi.sendCallSummaryMessage(org, {
        callId: callKey, contactPhone: call.phoneNumber, text, actionIndex: a._i,
        userName: (user as any)?.fullname || (user as any)?.userName || (user as any)?.name || '',
      });
      setInfo((prev: any) => ({
        ...(prev || {}),
        extractedActions: (prev?.extractedActions || []).map((x: any, i: number) =>
          i === a._i ? { ...x, status: r?.Status || (r?.Success ? 'executed' : 'failed'), result: r?.Result || '' } : x),
      }));
    } catch {
      setSendFailed(true);
    } finally {
      setSendingIdx(null);
    }
  }, [org, callKey, call.phoneNumber, user]);
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
            style={{
              color: themeColors.onSurfaceVariant, marginTop: 4,
              // Hebrew transcript on the right, English on the left (by the text itself, not the app language)
              ...(/[\u0590-\u05FF]/.test(transcriptText)
                ? { textAlign: 'right' as const, writingDirection: 'rtl' as const }
                : { textAlign: 'left' as const, writingDirection: 'ltr' as const }),
            }}
          >
            {transcriptText}
          </Text>
        </View>
      ) : null}

      {(pendingActions.length > 0 || legacyItems.length > 0) && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <MaterialCommunityIcons name="clipboard-check-outline" size={16} color="#FF6B35" />
            <Text variant="labelMedium" style={{ color: '#FF6B35', marginHorizontal: 6 }}>{t('phoneCalls.actionItems')}</Text>
          </View>
          {pendingActions.map((a: any) => {
            const text = a.type === 'send_message' ? actionText(a) : '';
            return (
              <View key={`p${a._i}`} style={{ marginTop: 6 }}>
                <View style={styles.actionItem}>
                  <Text variant="bodySmall" style={{ color: themeColors.onSurfaceVariant }}>•</Text>
                  <Text variant="bodySmall" style={{ color: themeColors.onSurfaceVariant, flex: 1, marginHorizontal: 6, textAlign: align }}>{a.description}</Text>
                </View>
                {text ? (
                  <>
                    <Text variant="labelSmall" style={{ color: themeColors.onSurfaceVariant, marginHorizontal: 14, marginTop: 2, textAlign: align }}>{text}</Text>
                    <Button
                      mode="contained"
                      compact
                      icon="whatsapp"
                      buttonColor="#25D366"
                      style={{ alignSelf: isRTL ? 'flex-end' : 'flex-start', marginTop: 6, marginHorizontal: 14 }}
                      loading={sendingIdx === a._i}
                      disabled={sendingIdx !== null}
                      onPress={() => sendNow(a)}
                    >
                      {t('phoneCalls.sendWhatsAppNow', 'שלח עכשיו בוואטסאפ')}
                    </Button>
                  </>
                ) : null}
              </View>
            );
          })}
          {legacyItems.map((item: string, idx: number) => (
            <View key={`l${idx}`} style={styles.actionItem}>
              <Text variant="bodySmall" style={{ color: themeColors.onSurfaceVariant }}>•</Text>
              <Text variant="bodySmall" style={{ color: themeColors.onSurfaceVariant, flex: 1, marginHorizontal: 6, textAlign: align }}>{item}</Text>
            </View>
          ))}
          {sendFailed ? (
            <Text variant="labelSmall" style={{ color: '#E63946', marginTop: 6, textAlign: align }}>{t('phoneCalls.sendFailed', 'השליחה נכשלה')}</Text>
          ) : null}
        </View>
      )}

      {doneActions.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <MaterialCommunityIcons name="robot-outline" size={16} color="#7B2D8E" />
            <Text variant="labelMedium" style={{ color: '#7B2D8E', marginHorizontal: 6 }}>{t('phoneCalls.performedByAi', 'פעולות שבוצעו על ידי AI')}</Text>
          </View>
          {doneActions.map((a: any, idx: number) => (
            <View key={`d${idx}`} style={styles.actionItem}>
              <Text variant="bodySmall" style={{ color: '#2A9D8F' }}>✓</Text>
              <Text variant="bodySmall" style={{ color: themeColors.onSurfaceVariant, flex: 1, marginHorizontal: 6, textAlign: align }}>
                {a.description}{a.result ? ` — ${a.result}` : ''}
              </Text>
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
