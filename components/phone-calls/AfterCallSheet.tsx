import React, { useState, useEffect, useCallback } from 'react';
import { View, StyleSheet, ScrollView, Pressable, KeyboardAvoidingView, Platform } from 'react-native';
import {
  Portal,
  Modal,
  Surface,
  Text,
  Button,
  IconButton,
  TextInput,
  Chip,
  Divider,
  ActivityIndicator,
  ProgressBar,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { phoneCallsApi } from '../../services/api/phoneCalls';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useRTL } from '../../hooks/useRTL';
import { useAuthStore } from '../../stores/authStore';
import { PhoneCall } from '../../types';
import { formatDuration, formatPhoneNumber } from '../../utils/formatters';

const BRAND_COLOR = '#2e6155';

interface AfterCallSheetProps {
  visible: boolean;
  call: PhoneCall | null;
  onDismiss: () => void;
  onAction?: (action: string, data?: any) => void;
}

type ActivePanel = null | 'followUp' | 'stageSelect' | 'addNote' | 'sendMessage';

const STAGES = [
  { key: 'new', labelKey: 'phoneCalls.stageNew', color: '#6C757D' },
  { key: 'contacted', labelKey: 'phoneCalls.stageContacted', color: BRAND_COLOR },
  { key: 'qualified', labelKey: 'phoneCalls.stageQualified', color: '#7B2D8E' },
  { key: 'proposal', labelKey: 'phoneCalls.stageProposal', color: '#FF6B35' },
  { key: 'won', labelKey: 'phoneCalls.stageWon', color: '#2A9D8F' },
  { key: 'lost', labelKey: 'phoneCalls.stageLost', color: '#E63946' },
];

export default function AfterCallSheet({ visible, call, onDismiss, onAction }: AfterCallSheetProps) {
  const theme = useAppTheme();
  const { isRTL } = useRTL();
  const { t } = useTranslation();
  const org = useAuthStore((s) => s.user?.organization || '');

  const [activePanel, setActivePanel] = useState<ActivePanel>(null);
  const [transcribing, setTranscribing] = useState(false);
  const [transcriptionProgress, setTranscriptionProgress] = useState(0);
  const [summary, setSummary] = useState<string | null>(null);
  const [actionItems, setActionItems] = useState<string[]>([]);
  const [followUpDate, setFollowUpDate] = useState('');
  const [followUpNote, setFollowUpNote] = useState('');
  const [noteText, setNoteText] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible || !call) return;

    setActivePanel(null);
    setFollowUpDate('');
    setFollowUpNote('');
    setNoteText('');
    setSummary(null);
    setActionItems([]);

    if (call.recordingUrl && !call.transcription) {
      startTranscription();
    } else if (call.aiSummary) {
      setSummary(call.aiSummary);
      setActionItems(call.aiActionItems || []);
    }
  }, [visible, call?.id]);

  const startTranscription = useCallback(async () => {
    if (!call) return;
    setTranscribing(true);
    setTranscriptionProgress(0);

    const interval = setInterval(() => {
      setTranscriptionProgress((p) => Math.min(p + 0.15, 0.9));
    }, 800);

    try {
      const result = await phoneCallsApi.transcribeCall(org, call.id);
      clearInterval(interval);
      setTranscriptionProgress(1);
      setSummary(result.summary);
      setActionItems(result.actionItems || []);
    } catch {
      clearInterval(interval);
    } finally {
      setTranscribing(false);
    }
  }, [call, org]);

  const handleCreateFollowUp = useCallback(async () => {
    if (!call) return;
    setSaving(true);
    try {
      (phoneCallsApi as any).createFollowUp?.(org, call.id, { date: followUpDate, note: followUpNote });
      onAction?.('followUpCreated', { date: followUpDate, note: followUpNote });
      setActivePanel(null);
    } catch (err) {
      console.error('Failed to create follow-up:', err);
    } finally {
      setSaving(false);
    }
  }, [call, followUpDate, followUpNote, onAction, org]);

  const handleStageSelect = useCallback(async (stage: string) => {
    if (!call) return;
    setSaving(true);
    try {
      (phoneCallsApi as any).updateLeadStage?.(org, call.id, stage);
      onAction?.('stageUpdated', { stage });
      setActivePanel(null);
    } catch (err) {
      console.error('Failed to update stage:', err);
    } finally {
      setSaving(false);
    }
  }, [call, onAction, org]);

  const handleMarkTalked = useCallback(async () => {
    if (!call) return;
    setSaving(true);
    try {
      (phoneCallsApi as any).updateLeadStage?.(org, call.id, 'contacted');
      onAction?.('markedTalked');
    } catch (err) {
      console.error('Failed to mark as talked:', err);
    } finally {
      setSaving(false);
    }
  }, [call, onAction, org]);

  const handleAddNote = useCallback(async () => {
    if (!call || !noteText.trim()) return;
    setSaving(true);
    try {
      (phoneCallsApi as any).addNote?.(org, call.id, noteText.trim());
      onAction?.('noteAdded', { note: noteText });
      setNoteText('');
      setActivePanel(null);
    } catch (err) {
      console.error('Failed to add note:', err);
    } finally {
      setSaving(false);
    }
  }, [call, noteText, onAction, org]);

  const handleSendFollowUpMessage = useCallback(() => {
    if (!call) return;
    onAction?.('sendFollowUpMessage', { phoneNumber: call.phoneNumber });
  }, [call, onAction]);

  if (!call) return null;

  const statusColor =
    call.status === 'answered' ? '#2A9D8F' :
    call.status === 'missed' ? '#E63946' :
    '#FF6B35';

  const statusIcon =
    call.status === 'answered' ? 'phone-check' :
    call.status === 'missed' ? 'phone-missed' :
    'phone-cancel';

  return (
    <Portal>
      <Modal
        visible={visible}
        onDismiss={onDismiss}
        contentContainerStyle={[s.modal, { backgroundColor: theme.colors.surface }]}
      >
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView showsVerticalScrollIndicator={false} bounces={false}>
            {/* ── Call Summary Header ── */}
            <View style={[s.header, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
              <View style={[s.statusCircle, { backgroundColor: statusColor + '20' }]}>
                <MaterialCommunityIcons name={statusIcon} size={28} color={statusColor} />
              </View>
              <View style={[s.headerInfo, { alignItems: isRTL ? 'flex-end' : 'flex-start' }]}>
                <Text variant="titleMedium" style={{ color: theme.colors.onSurface, fontWeight: '700' }}>
                  {call.contactName || formatPhoneNumber(call.phoneNumber)}
                </Text>
                <View style={[s.headerMeta, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
                  <Chip compact mode="flat" style={{ backgroundColor: statusColor + '15' }} textStyle={{ color: statusColor, fontSize: 11 }}>
                    {t(`phoneCalls.status_${call.status}`)}
                  </Chip>
                  {call.duration > 0 && (
                    <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginHorizontal: 8 }}>
                      {formatDuration(call.duration)}
                    </Text>
                  )}
                </View>
              </View>
              <IconButton icon="close" size={22} onPress={onDismiss} />
            </View>

            {/* ── Recording Indicator ── */}
            {call.recordingUrl && (
              <View style={[s.recordingBadge, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
                <MaterialCommunityIcons name="microphone" size={16} color="#FF6B35" />
                <Text variant="bodySmall" style={{ color: '#FF6B35', marginHorizontal: 6 }}>
                  {t('phoneCalls.callRecorded')}
                </Text>
              </View>
            )}

            {/* ── Transcription Progress ── */}
            {transcribing && (
              <Surface style={s.aiSection} elevation={0}>
                <View style={[s.aiHeader, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
                  <ActivityIndicator size={16} color="#7B2D8E" />
                  <Text variant="labelMedium" style={{ color: '#7B2D8E', marginHorizontal: 8 }}>
                    {t('phoneCalls.transcribing')}
                  </Text>
                </View>
                <ProgressBar progress={transcriptionProgress} color="#7B2D8E" style={s.progressBar} />
              </Surface>
            )}

            {/* ── AI Summary ── */}
            {summary && (
              <Surface style={s.aiSection} elevation={0}>
                <View style={[s.aiHeader, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
                  <MaterialCommunityIcons name="brain" size={18} color="#7B2D8E" />
                  <Text variant="labelLarge" style={{ color: '#7B2D8E', marginHorizontal: 8, fontWeight: '700' }}>
                    {t('phoneCalls.aiSummary')}
                  </Text>
                </View>
                <Text variant="bodyMedium" style={{ color: theme.colors.onSurface, textAlign: isRTL ? 'right' : 'left', marginTop: 6 }}>
                  {summary}
                </Text>
              </Surface>
            )}

            {/* ── AI Action Items ── */}
            {actionItems.length > 0 && (
              <Surface style={s.aiSection} elevation={0}>
                <View style={[s.aiHeader, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
                  <MaterialCommunityIcons name="clipboard-check-outline" size={18} color="#FF6B35" />
                  <Text variant="labelLarge" style={{ color: '#FF6B35', marginHorizontal: 8, fontWeight: '700' }}>
                    {t('phoneCalls.actionItems')}
                  </Text>
                </View>
                {actionItems.map((item, idx) => (
                  <View key={idx} style={[s.actionItem, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
                    <MaterialCommunityIcons name="checkbox-blank-circle-outline" size={14} color={theme.colors.onSurfaceVariant} />
                    <Text variant="bodySmall" style={{ color: theme.colors.onSurface, flex: 1, marginHorizontal: 8, textAlign: isRTL ? 'right' : 'left' }}>
                      {item}
                    </Text>
                  </View>
                ))}
              </Surface>
            )}

            <Divider style={{ marginVertical: 12 }} />

            {/* ── Quick Actions ── */}
            {activePanel === null && (
              <View style={s.actions}>
                <ActionButton
                  icon="calendar-plus"
                  label={t('phoneCalls.createFollowUp')}
                  color={BRAND_COLOR}
                  isRTL={isRTL}
                  onPress={() => setActivePanel('followUp')}
                />
                <ActionButton
                  icon="swap-horizontal"
                  label={t('phoneCalls.updateLeadStatus')}
                  color="#7B2D8E"
                  isRTL={isRTL}
                  onPress={() => setActivePanel('stageSelect')}
                />
                <ActionButton
                  icon="check-circle-outline"
                  label={t('phoneCalls.markAsTalked')}
                  color="#2A9D8F"
                  isRTL={isRTL}
                  onPress={handleMarkTalked}
                  loading={saving}
                />
                <ActionButton
                  icon="note-plus-outline"
                  label={t('phoneCalls.addNote')}
                  color="#FF6B35"
                  isRTL={isRTL}
                  onPress={() => setActivePanel('addNote')}
                />
                <ActionButton
                  icon="whatsapp"
                  label={t('phoneCalls.sendFollowUpMsg')}
                  color="#25D366"
                  isRTL={isRTL}
                  onPress={handleSendFollowUpMessage}
                />
              </View>
            )}

            {/* ── Follow-up Panel ── */}
            {activePanel === 'followUp' && (
              <View style={s.panel}>
                <View style={[s.panelHeader, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
                  <IconButton icon="arrow-left" size={20} onPress={() => setActivePanel(null)} style={{ transform: [{ scaleX: isRTL ? -1 : 1 }] }} />
                  <Text variant="titleSmall" style={{ color: theme.colors.onSurface, flex: 1, textAlign: isRTL ? 'right' : 'left' }}>
                    {t('phoneCalls.createFollowUp')}
                  </Text>
                </View>
                <TextInput
                  label={t('phoneCalls.followUpDate')}
                  value={followUpDate}
                  onChangeText={setFollowUpDate}
                  mode="outlined"
                  placeholder="DD/MM/YYYY"
                  left={<TextInput.Icon icon="calendar" />}
                  style={s.panelInput}
                  outlineColor={BRAND_COLOR + '40'}
                  activeOutlineColor={BRAND_COLOR}
                  textAlign={isRTL ? 'right' : 'left'}
                />
                <TextInput
                  label={t('phoneCalls.note')}
                  value={followUpNote}
                  onChangeText={setFollowUpNote}
                  mode="outlined"
                  multiline
                  numberOfLines={3}
                  style={s.panelInput}
                  outlineColor={BRAND_COLOR + '40'}
                  activeOutlineColor={BRAND_COLOR}
                  textAlign={isRTL ? 'right' : 'left'}
                />
                <Button mode="contained" onPress={handleCreateFollowUp} loading={saving} buttonColor={BRAND_COLOR} style={s.panelSaveBtn}>
                  {t('phoneCalls.save')}
                </Button>
              </View>
            )}

            {/* ── Stage Select Panel ── */}
            {activePanel === 'stageSelect' && (
              <View style={s.panel}>
                <View style={[s.panelHeader, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
                  <IconButton icon="arrow-left" size={20} onPress={() => setActivePanel(null)} style={{ transform: [{ scaleX: isRTL ? -1 : 1 }] }} />
                  <Text variant="titleSmall" style={{ color: theme.colors.onSurface, flex: 1, textAlign: isRTL ? 'right' : 'left' }}>
                    {t('phoneCalls.updateLeadStatus')}
                  </Text>
                </View>
                <View style={s.stageGrid}>
                  {STAGES.map((stage) => (
                    <Pressable key={stage.key} onPress={() => handleStageSelect(stage.key)} style={[s.stageItem, { borderColor: stage.color + '40' }]}>
                      <View style={[s.stageDot, { backgroundColor: stage.color }]} />
                      <Text variant="labelMedium" style={{ color: stage.color, fontWeight: '600' }}>
                        {t(stage.labelKey)}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                {saving && <ActivityIndicator size="small" color={BRAND_COLOR} style={{ marginTop: 12 }} />}
              </View>
            )}

            {/* ── Add Note Panel ── */}
            {activePanel === 'addNote' && (
              <View style={s.panel}>
                <View style={[s.panelHeader, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
                  <IconButton icon="arrow-left" size={20} onPress={() => setActivePanel(null)} style={{ transform: [{ scaleX: isRTL ? -1 : 1 }] }} />
                  <Text variant="titleSmall" style={{ color: theme.colors.onSurface, flex: 1, textAlign: isRTL ? 'right' : 'left' }}>
                    {t('phoneCalls.addNote')}
                  </Text>
                </View>
                <TextInput
                  label={t('phoneCalls.note')}
                  value={noteText}
                  onChangeText={setNoteText}
                  mode="outlined"
                  multiline
                  numberOfLines={4}
                  style={s.panelInput}
                  outlineColor={BRAND_COLOR + '40'}
                  activeOutlineColor={BRAND_COLOR}
                  textAlign={isRTL ? 'right' : 'left'}
                />
                <Button mode="contained" onPress={handleAddNote} loading={saving} buttonColor={BRAND_COLOR} style={s.panelSaveBtn} disabled={!noteText.trim()}>
                  {t('phoneCalls.save')}
                </Button>
              </View>
            )}

            {/* ── Done Button ── */}
            <Button
              mode="contained-tonal"
              onPress={onDismiss}
              style={s.doneBtn}
              contentStyle={s.doneBtnContent}
              labelStyle={{ fontWeight: '700' }}
            >
              {t('phoneCalls.done')}
            </Button>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </Portal>
  );
}

// ─── Action Button ────────────────────────────────────────────────────

interface ActionButtonProps {
  icon: string;
  label: string;
  color: string;
  isRTL: boolean;
  onPress: () => void;
  loading?: boolean;
}

function ActionButton({ icon, label, color, isRTL, onPress, loading }: ActionButtonProps) {
  return (
    <Pressable onPress={onPress} style={[s.actionBtn, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
      <View style={[s.actionIcon, { backgroundColor: color + '15' }]}>
        {loading ? (
          <ActivityIndicator size={18} color={color} />
        ) : (
          <MaterialCommunityIcons name={icon as any} size={20} color={color} />
        )}
      </View>
      <Text variant="labelMedium" style={{ color, flex: 1, textAlign: isRTL ? 'right' : 'left', marginHorizontal: 10, fontWeight: '600' }}>
        {label}
      </Text>
      <MaterialCommunityIcons
        name={isRTL ? 'chevron-left' : 'chevron-right'}
        size={18}
        color={color + '80'}
      />
    </Pressable>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────

const s = StyleSheet.create({
  modal: {
    margin: 16,
    borderRadius: 24,
    padding: 20,
    maxHeight: '90%',
  },
  header: {
    alignItems: 'center',
    marginBottom: 12,
  },
  statusCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerInfo: {
    flex: 1,
    marginHorizontal: 12,
  },
  headerMeta: {
    alignItems: 'center',
    marginTop: 4,
    gap: 4,
  },
  recordingBadge: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: '#FF6B3510',
    borderRadius: 12,
    marginBottom: 8,
  },
  aiSection: {
    backgroundColor: '#F8F9FA',
    borderRadius: 14,
    padding: 14,
    marginBottom: 8,
  },
  aiHeader: {
    alignItems: 'center',
  },
  progressBar: {
    marginTop: 10,
    borderRadius: 4,
    height: 4,
  },
  actionItem: {
    alignItems: 'flex-start',
    marginTop: 6,
  },
  actions: {
    gap: 4,
  },
  actionBtn: {
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderRadius: 12,
  },
  actionIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  panel: {
    marginBottom: 8,
  },
  panelHeader: {
    alignItems: 'center',
    marginBottom: 8,
  },
  panelInput: {
    marginBottom: 12,
  },
  panelSaveBtn: {
    borderRadius: 12,
  },
  stageGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  stageItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    gap: 8,
  },
  stageDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  doneBtn: {
    marginTop: 16,
    borderRadius: 14,
  },
  doneBtnContent: {
    paddingVertical: 6,
  },
});
