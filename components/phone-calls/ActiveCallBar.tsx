import { useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { phoneCallsApi } from '../../services/api/phoneCalls';
import { useActiveCallStore } from '../../stores/activeCallStore';
import { useSipPhoneStore } from '../../stores/sipPhoneStore';
import { useAuthStore } from '../../stores/authStore';
import AddTaskSheet from '../AddTaskSheet';
import type { Contact } from '../../types';
import { isHeadsetRoute, isSpeakerSupported, resetCallAudio, setCallSpeaker, startCallAudio } from '../../utils/callAudio';
import { startCallProximity } from '../../utils/callProximity';
import { dismissOngoingCallNotification, showOngoingCallNotification } from '../../utils/callNotification';
import type { AppTheme } from '../../constants/theme';
import CallTransferSheet from './CallTransferSheet';
import CallCustomerCard from './CallCustomerCard';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];
const MAX_CALL_MS = 4 * 60 * 60 * 1000;
const NOTES_AUTOSAVE_MS = 1500;

type Action = 'hold' | 'unhold' | 'mute' | 'unmute' | 'dtmf' | 'hangup';
type TransferState = '' | 'ringing' | 'done' | 'failed';

/**
 * The agent's live SIP call, two states:
 *  - minimized: a small bar at the top of any screen (number + timer, hold, mute, red hang-up). Tap it to open the call page;
 *  - full call page (like the phone's own call screen): mute, keypad, speaker, hold, call notes and hang up. It opens by itself
 *    when the customer answers and can be minimized to keep working in the app.
 * Hold plays the organization's hold music to the customer. The call's audio runs through the app's own SIP phone (internet call)
 * when this build has it, otherwise it is a normal cell call that the phone's own call screen handles.
 */
export default function ActiveCallBar() {
  const { t } = useTranslation();
  const theme = useTheme<AppTheme>();
  const insets = useSafeAreaInsets();
  const call = useActiveCallStore((s) => s.call);
  const patch = useActiveCallStore((s) => s.patch);
  const clear = useActiveCallStore((s) => s.clear);
  const inCall = useSipPhoneStore((s) => s.inCall);
  const [showKeys, setShowKeys] = useState(false);
  const [typedDigits, setTypedDigits] = useState(''); // keys pressed on the in-call keypad, shown like a phone's own dialer
  const [busy, setBusy] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [notesSaved, setNotesSaved] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [transfer, setTransfer] = useState<TransferState>('');
  const [showTask, setShowTask] = useState(false);
  const [contact, setContact] = useState<Contact | null>(null);
  const user = useAuthStore((s) => s.user);

  const callId = call?.callId;
  const organization = call?.organization;
  const answered = !!call?.answered;
  const speaker = !!call?.speaker;
  const notes = call?.notes || '';

  // Latest values for the end-of-call flush (the effect cleanup must not read stale closures).
  const latest = useRef<{ callId: string; organization: string; phone: string; notes: string } | null>(null);
  if (call) latest.current = { callId: call.callId, organization: call.organization, phone: call.phoneNumber, notes: call.notes };
  const savedNotes = useRef('');
  // Follow the call on the gateway: closes the bar when it ends, shows when the customer answered.
  useEffect(() => {
    if (!callId || !organization) return undefined;
    let stopped = false;
    const poll = async () => {
      try {
        const s = await phoneCallsApi.sipCallControl(organization, callId, 'status');
        if (stopped) return;
        if (s.active === false) { clear(); return; }
        // Handed over to a colleague: the call goes on without us.
        if (s.transfer === 'done') { clear(); return; }
        setTransfer((s.transfer as TransferState) || '');
        patch({ answered: !!s.answered, held: !!s.held, muted: !!s.muted });
      } catch { /* transient network error - keep the bar */ }
    };
    poll();
    const id = setInterval(poll, transfer === 'ringing' ? 1500 : 3000);
    return () => { stopped = true; clearInterval(id); };
  }, [callId, organization, transfer === 'ringing']);

  useEffect(() => {
    if (!call) { setShowKeys(false); setTypedDigits(''); setSeconds(0); return undefined; }
    const id = setInterval(() => {
      const elapsed = Date.now() - call.startedAt;
      if (elapsed > MAX_CALL_MS) { clear(); return; }
      setSeconds(Math.floor(elapsed / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [call?.callId]);

  // The call page opens as soon as dialing starts (activeCallStore.start); if the user minimizes it, it stays minimized.

  // Audio route: earpiece by default, loudspeaker on request. Re-applied when the call's audio actually starts, because the
  // phone's call audio can reset the route; restored to normal app audio when the call is over.
  useEffect(() => {
    if (!callId) return;
    // startCallAudio turns on headset-aware routing (Bluetooth / wired headset) and asks for the Bluetooth permission once.
    startCallAudio().then(() => setCallSpeaker(speaker));
  }, [callId, speaker, answered, inCall]);
  useEffect(() => {
    if (!callId) return undefined;
    return () => { resetCallAudio(); };
  }, [callId]);

  // Phone at the ear → screen goes dark and ignores touch (no accidental mute/hang-up). Off while the loudspeaker is on.
  useEffect(() => {
    if (!callId || speaker) return undefined;
    // With a Bluetooth / wired headset carrying the call the phone is not at the ear → keep the screen on.
    return startCallProximity(() => isHeadsetRoute());
  }, [callId, speaker]);

  // Left the app mid-call (home / another app): the call keeps going, so pin an ongoing notification (tap = back to the call,
  // "נתק" = hang up). Removed when the app is open again or the call ends.
  useEffect(() => {
    if (!callId) return undefined;
    const label = call?.name || call?.phoneNumber || '';
    const sync = (state: AppStateStatus) => {
      if (state === 'active') dismissOngoingCallNotification();
      else showOngoingCallNotification(`📞 ${t('phoneCalls.callInProgress', 'שיחה פעילה')}`, label);
    };
    sync(AppState.currentState);
    const sub = AppState.addEventListener('change', sync);
    return () => { sub.remove(); dismissOngoingCallNotification(); };
  }, [callId]);

  // Call notes: saved while typing, and once more (final) when the call ends so they reach the timeline.
  useEffect(() => {
    if (!callId || !organization || notes === savedNotes.current) return undefined;
    const id = setTimeout(async () => {
      try {
        const r = await phoneCallsApi.saveCallNotes(organization, callId, { notes }, call?.phoneNumber || '');
        if (r.success) { savedNotes.current = notes; setNotesSaved(true); }
      } catch { /* the end-of-call save retries */ }
    }, NOTES_AUTOSAVE_MS);
    return () => clearTimeout(id);
  }, [callId, organization, notes]);
  useEffect(() => {
    if (!callId) return undefined;
    savedNotes.current = '';
    setNotesSaved(false);
    setContact(null);
    return () => {
      const l = latest.current;
      if (l && l.callId === callId && l.notes.trim()) {
        phoneCallsApi.saveCallNotes(l.organization, l.callId, { notes: l.notes }, l.phone.replace(/\D/g, '')).catch(() => {});
      }
    };
  }, [callId]);

  if (!call) return null;

  const run = async (action: Action, digit?: string) => {
    if (busy && action !== 'hangup') return;
    setBusy(true);
    try {
      const s = await phoneCallsApi.sipCallControl(call.organization, call.callId, action, digit);
      if (s.active === false || action === 'hangup') { clear(); return; }
      if (!s.error) patch({ held: !!s.held, muted: !!s.muted });
    } catch { /* ignore - the status poll resyncs */ }
    finally { setBusy(false); }
  };

  const startTransfer = async (target: { targetUserId?: string; number?: string }) => {
    setShowTransfer(false);
    setTransfer('ringing');
    try {
      const s = await phoneCallsApi.sipCallControl(call.organization, call.callId, 'transfer', undefined, target);
      if (s.error) { setTransfer('failed'); return; }
      setTransfer((s.transfer as TransferState) || 'ringing');
      patch({ held: true });
    } catch {
      setTransfer('failed');
    }
  };

  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');
  const connected = call.answered;
  const label = transfer === 'ringing' ? t('phoneCalls.transferring', 'Transferring...')
    : transfer === 'failed' ? t('phoneCalls.transferFailed', 'Transfer failed')
    : call.held ? t('phoneCalls.hold') : connected ? `${mm}:${ss}` : t('phoneCalls.connectingCustomer');
  const title = call.name || call.phoneNumber;

  // ───────────── full call page ─────────────
  const Round = ({ icon, text, on, onPress, disabled }: { icon: any; text: string; on?: boolean; onPress: () => void; disabled?: boolean }) => (
    <Pressable onPress={onPress} disabled={disabled} style={[styles.roundWrap, disabled && { opacity: 0.4 }]}>
      <View style={[styles.round, { backgroundColor: on ? '#FFFFFF' : 'rgba(255,255,255,0.14)' }]}>
        <MaterialCommunityIcons name={icon} size={28} color={on ? '#0f172a' : '#FFFFFF'} />
      </View>
      <Text style={styles.roundText}>{text}</Text>
    </Pressable>
  );

  const page = (
    <Modal visible={call.expanded} animationType="slide" statusBarTranslucent onRequestClose={() => patch({ expanded: false })}>
      <KeyboardAvoidingView style={styles.page} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 16 }}>
          <Pressable onPress={() => patch({ expanded: false })} hitSlop={10} style={styles.minimize}>
            <MaterialCommunityIcons name="chevron-down" size={26} color="#FFFFFF" />
            <Text style={styles.minimizeText}>{t('phoneCalls.minimizeCall')}</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.pageBody} keyboardShouldPersistTaps="handled">
          <View style={styles.avatar}>
            <MaterialCommunityIcons name="account" size={44} color="#FFFFFF" />
          </View>
          <Text style={styles.pageName} numberOfLines={2}>{title}</Text>
          {call.name ? <Text style={styles.pageNumber}>{call.phoneNumber}</Text> : null}
          <Text style={[styles.pageStatus, call.held && { color: '#FBBF24' }]}>{label}</Text>

          <View style={styles.grid}>
            <Round icon={call.muted ? 'microphone-off' : 'microphone'} on={call.muted} disabled={!connected}
              text={call.muted ? t('phoneCalls.unmute') : t('phoneCalls.mute')} onPress={() => run(call.muted ? 'unmute' : 'mute')} />
            <Round icon="dialpad" on={showKeys} disabled={!connected}
              text={t('phoneCalls.keypad')} onPress={() => setShowKeys((v) => !v)} />
            {isSpeakerSupported ? (
              <Round icon={speaker ? 'volume-high' : 'volume-medium'} on={speaker}
                text={t('phoneCalls.speaker')} onPress={() => patch({ speaker: !speaker })} />
            ) : null}
            <Round icon={call.held ? 'play' : 'pause'} on={call.held} disabled={!connected || transfer === 'ringing'}
              text={call.held ? t('phoneCalls.resume') : t('phoneCalls.hold')} onPress={() => run(call.held ? 'unhold' : 'hold')} />
            <Round icon="phone-forward" on={transfer === 'ringing'} disabled={!connected || transfer === 'ringing'}
              text={t('phoneCalls.transfer', 'Transfer')} onPress={() => setShowTransfer(true)} />
            <Round icon="clipboard-plus-outline"
              text={t('phoneCalls.callTask', 'Task')} onPress={() => setShowTask(true)} />
          </View>

          {showKeys && connected ? (
            <View style={styles.keys}>
              {typedDigits ? (
                <View style={styles.typedRow}>
                  <Text style={styles.typedText} numberOfLines={1}>{typedDigits.slice(-18)}</Text>
                  <Pressable onPress={() => setTypedDigits((v) => v.slice(0, -1))} onLongPress={() => setTypedDigits('')} hitSlop={10}>
                    <MaterialCommunityIcons name="backspace-outline" size={22} color="#CBD5E1" />
                  </Pressable>
                </View>
              ) : null}
              {KEYS.map((k) => (
                <Pressable key={k} onPress={() => { setTypedDigits((v) => v + k); run('dtmf', k); }} style={styles.key}>
                  <Text style={styles.keyText}>{k}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          <CallCustomerCard organization={call.organization} phone={call.phoneNumber} onNavigate={() => patch({ expanded: false })} onContact={setContact} />

          <View style={styles.notesBox}>
            <View style={styles.notesHeader}>
              <MaterialCommunityIcons name="note-edit-outline" size={16} color="#CBD5E1" />
              <Text style={styles.notesTitle}>{t('phoneCalls.agentNotes')}</Text>
              {notesSaved && notes === savedNotes.current ? <Text style={styles.notesSaved}>{t('phoneCalls.noteSaved')}</Text> : null}
            </View>
            <TextInput
              value={notes}
              onChangeText={(v) => patch({ notes: v })}
              placeholder={t('phoneCalls.notesPlaceholder')}
              placeholderTextColor="#64748B"
              multiline
              style={styles.notesInput}
            />
          </View>
        </ScrollView>

        <View style={[styles.hangRow, { paddingBottom: insets.bottom + 16 }]}>
          <Pressable onPress={() => run('hangup')} style={styles.bigHangup} accessibilityLabel={t('phoneCalls.endCall')}>
            <MaterialCommunityIcons name="phone-hangup" size={34} color="#FFFFFF" />
          </Pressable>
        </View>
        {/* Rendered inside the call page's modal: two sibling modals do not stack reliably on iOS. */}
        <CallTransferSheet visible={showTransfer} organization={call.organization} onClose={() => setShowTransfer(false)} onPick={startTransfer} />
        <AddTaskSheet
          visible={showTask}
          onDismiss={() => setShowTask(false)}
          organization={call.organization}
          user={user}
          relatedTo={contact?.id ? { type: 'contact', entityId: contact.id, entityName: contact.name } : undefined}
          defaultTitle={`${t('phoneCalls.callTaskTitle', 'Call follow-up')} - ${call.name || contact?.name || call.phoneNumber}`}
          relatedPhone={call.phoneNumber}
        />
      </KeyboardAvoidingView>
    </Modal>
  );

  // ───────────── minimized bar ─────────────
  const MiniBtn = ({ icon, on, onPress, disabled }: { icon: any; on?: boolean; onPress: () => void; disabled?: boolean }) => (
    <Pressable onPress={onPress} disabled={disabled} hitSlop={4}
      style={[styles.miniBtn, { backgroundColor: on ? '#059669' : theme.colors.surfaceVariant }, disabled && { opacity: 0.4 }]}>
      <MaterialCommunityIcons name={icon} size={20} color={on ? '#FFF' : theme.colors.onSurface} />
    </Pressable>
  );

  return (
    <>
      {page}
      {!call.expanded ? (
        <View pointerEvents="box-none" style={[styles.wrap, { top: insets.top + 6 }]}>
          <View style={[styles.bar, { backgroundColor: theme.colors.surface, borderColor: theme.colors.outlineVariant }]}>
            <Pressable onPress={() => patch({ expanded: true })} style={styles.barInfo}>
              <MaterialCommunityIcons name="phone-in-talk" size={20} color="#059669" />
              <View style={{ flex: 1, marginHorizontal: 10 }}>
                <Text variant="titleSmall" numberOfLines={1} style={{ color: theme.colors.onSurface, fontWeight: '700' }}>{title}</Text>
                <Text variant="labelSmall" style={{ color: call.held ? '#D97706' : '#059669' }}>{label}</Text>
              </View>
            </Pressable>
            <MiniBtn icon={call.held ? 'play' : 'pause'} on={call.held} disabled={!connected} onPress={() => run(call.held ? 'unhold' : 'hold')} />
            <MiniBtn icon={call.muted ? 'microphone-off' : 'microphone'} on={call.muted} disabled={!connected} onPress={() => run(call.muted ? 'unmute' : 'mute')} />
            <Pressable onPress={() => run('hangup')} style={styles.hangup} hitSlop={8}>
              <MaterialCommunityIcons name="phone-hangup" size={22} color="#FFF" />
            </Pressable>
          </View>
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 10, right: 10, zIndex: 1000, elevation: 20 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, paddingVertical: 8, paddingHorizontal: 12, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
  barInfo: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  miniBtn: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  hangup: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#DC2626', alignItems: 'center', justifyContent: 'center' },

  page: { flex: 1, backgroundColor: '#0f172a' },
  minimize: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', paddingVertical: 4, paddingEnd: 8 },
  minimizeText: { color: '#FFFFFF', fontSize: 15 },
  pageBody: { alignItems: 'center', paddingHorizontal: 24, paddingTop: 12, paddingBottom: 16 },
  avatar: { width: 88, height: 88, borderRadius: 44, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  pageName: { color: '#FFFFFF', fontSize: 28, fontWeight: '700', textAlign: 'center', marginTop: 14 },
  pageNumber: { color: '#CBD5E1', fontSize: 16, writingDirection: 'ltr', marginTop: 2 },
  pageStatus: { color: '#4ADE80', fontSize: 18, marginTop: 6, fontVariant: ['tabular-nums'] },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 18, marginTop: 26 },
  roundWrap: { alignItems: 'center', width: 76 },
  round: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  roundText: { color: '#E2E8F0', fontSize: 12, marginTop: 6, textAlign: 'center' },
  keys: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', marginTop: 16, width: '100%', maxWidth: 320, direction: 'ltr' },
  key: { width: '30%', margin: '1.5%', height: 52, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  typedRow: { width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, minHeight: 40, marginBottom: 6 },
  typedText: { color: '#FFFFFF', fontSize: 28, fontWeight: '600', letterSpacing: 2, writingDirection: 'ltr', fontVariant: ['tabular-nums'] },
  keyText: { color: '#FFFFFF', fontSize: 22, fontWeight: '600' },
  notesBox: { width: '100%', marginTop: 24, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 14, padding: 12 },
  notesHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  notesTitle: { color: '#CBD5E1', fontSize: 13, fontWeight: '600', flex: 1 },
  notesSaved: { color: '#4ADE80', fontSize: 12 },
  notesInput: { color: '#FFFFFF', fontSize: 15, minHeight: 90, maxHeight: 180, textAlignVertical: 'top', padding: 0 },
  hangRow: { alignItems: 'center', paddingTop: 8 },
  bigHangup: { width: 72, height: 72, borderRadius: 36, backgroundColor: '#DC2626', alignItems: 'center', justifyContent: 'center' },
});
