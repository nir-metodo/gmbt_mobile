import { useEffect } from 'react';
import { Modal, Pressable, StyleSheet, Vibration, View } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import { useTranslation } from 'react-i18next';
import { useSipPhoneStore } from '../../stores/sipPhoneStore';
import { useActiveCallStore } from '../../stores/activeCallStore';
import { useAuthStore } from '../../stores/authStore';
import { sipPhone } from '../../services/sip/sipPhone';

/** Full-screen "incoming call" for a call that rings in the app's SIP phone. Answer opens the call (the in-call bar takes over). */
export default function IncomingCallOverlay() {
  const { t } = useTranslation();
  const incoming = useSipPhoneStore((s) => s.incoming);
  const organization = useAuthStore((s) => s.user?.organization);

  // Ring + vibrate while it is ringing.
  useEffect(() => {
    if (!incoming) return undefined;
    let sound: Audio.Sound | null = null;
    let cancelled = false;
    Vibration.vibrate([0, 800, 1200], true);
    (async () => {
      try {
        await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
        const { sound: s } = await Audio.Sound.createAsync(require('../../assets/sounds/notification.wav'), { isLooping: true, shouldPlay: true, volume: 1 });
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
      useActiveCallStore.getState().start({ callId: call.callId, organization, phoneNumber: call.from });
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
  actions: { flexDirection: 'row', justifyContent: 'space-around' },
  actionCol: { alignItems: 'center', gap: 10 },
  circle: { width: 74, height: 74, borderRadius: 37, alignItems: 'center', justifyContent: 'center' },
  actionText: { color: '#e2e8f0', fontSize: 14 },
});
