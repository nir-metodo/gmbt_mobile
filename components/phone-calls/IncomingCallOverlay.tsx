import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Vibration, View } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import { useTranslation } from 'react-i18next';
import { useSipPhoneStore } from '../../stores/sipPhoneStore';
import { useActiveCallStore } from '../../stores/activeCallStore';
import { useAuthStore } from '../../stores/authStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { getRingtone } from '../../utils/ringtones';
import { sipPhone } from '../../services/sip/sipPhone';
import axiosInstance from '../../services/api/axiosInstance';

/** Full-screen "incoming call" for a call that rings in the app's SIP phone. Answer opens the call (the in-call bar takes over). */
export default function IncomingCallOverlay() {
  const { t } = useTranslation();
  const incoming = useSipPhoneStore((s) => s.incoming);
  const organization = useAuthStore((s) => s.user?.organization);

  // A few facts about the caller (open lead / case / quote / payment, last note) - shown only when there are any.
  const [brief, setBrief] = useState<string[]>([]);
  const callerPhone = incoming?.from || '';
  useEffect(() => {
    setBrief([]);
    if (!callerPhone || !organization) return undefined;
    let off = false;
    axiosInstance
      .post('/api/Webhooks/GetCallBrief', { organization, phoneNumber: callerPhone })
      .then((res) => { if (!off && Array.isArray(res.data?.lines)) setBrief(res.data.lines.filter((l: any) => !!l)); })
      .catch(() => {});
    return () => { off = true; };
  }, [callerPhone, organization]);

  // Ring + vibrate while it is ringing.
  useEffect(() => {
    if (!incoming) return undefined;
    let sound: Audio.Sound | null = null;
    let cancelled = false;
    Vibration.vibrate([0, 800, 1200], true);
    (async () => {
      try {
        await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
        const { sound: s } = await Audio.Sound.createAsync(getRingtone(useSettingsStore.getState().ringtone).source, { isLooping: true, shouldPlay: true, volume: 1 });
        if (cancelled) { s.unloadAsync().catch(() => {}); return; }
        sound = s;
      } catch { /* vibration only */ }
    })();
    return () => {
      cancelled = true;
      Vibration.cancel();
      sound?.unloadAsync().catch(() => {});
    };
  }, [incoming?.callId, incoming?.from, !!incoming]);

  if (!incoming) return null;

  const title = incoming.name || incoming.from || t('phoneCalls.unknownNumber', 'Unknown number');

  const answer = async () => {
    const call = incoming;
    const ok = await sipPhone.answerIncoming();
    if (ok && call.callId && organization) {
      useActiveCallStore.getState().start({ callId: call.callId, organization, phoneNumber: call.from, name: call.name, answered: true });
    }
  };

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={() => sipPhone.rejectIncoming()}>
      <View style={styles.backdrop}>
        <View style={styles.top}>
          <MaterialCommunityIcons name="phone-incoming" size={44} color="#fff" />
          <Text style={styles.label}>{t('phoneCalls.incomingCall', 'Incoming call')}</Text>
          <Text style={styles.name} numberOfLines={2}>{title}</Text>
          {!!incoming.name && !!incoming.from && <Text style={styles.number}>{incoming.from}</Text>}
          {brief.length > 0 && (
            <View style={styles.brief}>
              {brief.slice(0, 5).map((line, i) => (
                <Text key={i} style={styles.briefLine} numberOfLines={2}>{line}</Text>
              ))}
            </View>
          )}
        </View>
        <View style={styles.actions}>
          <View style={styles.actionCol}>
            <Pressable style={[styles.circle, { backgroundColor: '#dc2626' }]} onPress={() => sipPhone.rejectIncoming()}>
              <MaterialCommunityIcons name="phone-hangup" size={34} color="#fff" />
            </Pressable>
            <Text style={styles.actionText}>{t('phoneCalls.decline', 'Decline')}</Text>
          </View>
          <View style={styles.actionCol}>
            <Pressable style={[styles.circle, { backgroundColor: '#16a34a' }]} onPress={answer}>
              <MaterialCommunityIcons name="phone" size={34} color="#fff" />
            </Pressable>
            <Text style={styles.actionText}>{t('phoneCalls.answer', 'Answer')}</Text>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#0f172a', justifyContent: 'space-between', paddingVertical: 96, paddingHorizontal: 32 },
  top: { alignItems: 'center', gap: 12 },
  label: { color: '#94a3b8', fontSize: 16 },
  name: { color: '#fff', fontSize: 30, fontWeight: '700', textAlign: 'center' },
  number: { color: '#cbd5e1', fontSize: 18, writingDirection: 'ltr' },
  brief: { alignSelf: 'stretch', marginTop: 16, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12, gap: 6 },
  briefLine: { color: '#e2e8f0', fontSize: 15 },
  actions: { flexDirection: 'row', justifyContent: 'space-around' },
  actionCol: { alignItems: 'center', gap: 10 },
  circle: { width: 74, height: 74, borderRadius: 37, alignItems: 'center', justifyContent: 'center' },
  actionText: { color: '#e2e8f0', fontSize: 14 },
});
