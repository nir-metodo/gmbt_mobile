import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { phoneCallsApi } from '../../services/api/phoneCalls';
import { useActiveCallStore } from '../../stores/activeCallStore';
import type { AppTheme } from '../../constants/theme';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];
const MAX_CALL_MS = 4 * 60 * 60 * 1000;

/**
 * Floating control bar for the agent's live SIP call: hold (plays the organization's hold music to the customer), mute,
 * keypad (DTMF to the customer) and hang up. The call's audio runs through the app's own SIP phone (internet call) when this build
 * has it, otherwise it is a normal cell call that the phone's own call screen handles.
 */
export default function ActiveCallBar() {
  const { t } = useTranslation();
  const theme = useTheme<AppTheme>();
  const insets = useSafeAreaInsets();
  const call = useActiveCallStore((s) => s.call);
  const patch = useActiveCallStore((s) => s.patch);
  const clear = useActiveCallStore((s) => s.clear);
  const [showKeys, setShowKeys] = useState(false);
  const [busy, setBusy] = useState(false);
  const [seconds, setSeconds] = useState(0);

  const callId = call?.callId;
  const organization = call?.organization;

  // Follow the call on the gateway: closes the bar when it ends, shows when the customer answered.
  useEffect(() => {
    if (!callId || !organization) return undefined;
    let stopped = false;
    const poll = async () => {
      try {
        const s = await phoneCallsApi.sipCallControl(organization, callId, 'status');
        if (stopped) return;
        if (s.active === false) { clear(); return; }
        patch({ answered: !!s.answered, held: !!s.held, muted: !!s.muted });
      } catch { /* transient network error - keep the bar */ }
    };
    poll();
    const id = setInterval(poll, 3000);
    return () => { stopped = true; clearInterval(id); };
  }, [callId, organization]);

  useEffect(() => {
    if (!call) { setShowKeys(false); setSeconds(0); return undefined; }
    const id = setInterval(() => {
      const elapsed = Date.now() - call.startedAt;
      if (elapsed > MAX_CALL_MS) { clear(); return; }
      setSeconds(Math.floor(elapsed / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [call?.callId]);

  if (!call) return null;

  const run = async (action: 'hold' | 'unhold' | 'mute' | 'unmute' | 'dtmf' | 'hangup', digit?: string) => {
    if (busy && action !== 'hangup') return;
    setBusy(true);
    try {
      const s = await phoneCallsApi.sipCallControl(call.organization, call.callId, action, digit);
      if (s.active === false || action === 'hangup') { clear(); return; }
      if (!s.error) patch({ held: !!s.held, muted: !!s.muted });
    } catch { /* ignore - the status poll resyncs */ }
    finally { setBusy(false); }
  };

  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');
  const connected = call.answered;
  const label = connected ? `${mm}:${ss}` : t('phoneCalls.connectingCustomer');

  const Btn = ({ icon, text, on, onPress, disabled }: { icon: any; text: string; on?: boolean; onPress: () => void; disabled?: boolean }) => (
    <Pressable onPress={onPress} disabled={disabled} style={[styles.btn, disabled && { opacity: 0.4 }]}>
      <View style={[styles.btnIcon, { backgroundColor: on ? '#059669' : theme.colors.surfaceVariant }]}>
        <MaterialCommunityIcons name={icon} size={22} color={on ? '#FFF' : theme.colors.onSurface} />
      </View>
      <Text variant="labelSmall" style={{ color: theme.colors.onSurface, marginTop: 3 }}>{text}</Text>
    </Pressable>
  );

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { top: insets.top + 6 }]}>
      <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.outlineVariant }]}>
        <View style={styles.header}>
          <MaterialCommunityIcons name="phone-in-talk" size={20} color="#059669" />
          <View style={{ flex: 1, marginHorizontal: 10 }}>
            <Text variant="titleSmall" numberOfLines={1} style={{ color: theme.colors.onSurface, fontWeight: '700' }}>{call.phoneNumber}</Text>
            <Text variant="labelSmall" style={{ color: call.held ? '#D97706' : '#059669' }}>
              {call.held ? t('phoneCalls.hold') : label}
            </Text>
          </View>
          <Pressable onPress={() => run('hangup')} style={styles.hangup} hitSlop={8}>
            <MaterialCommunityIcons name="phone-hangup" size={22} color="#FFF" />
          </Pressable>
        </View>

        <View style={styles.actions}>
          <Btn icon={call.muted ? 'microphone-off' : 'microphone'} on={call.muted} disabled={!connected}
            text={call.muted ? t('phoneCalls.unmute') : t('phoneCalls.mute')} onPress={() => run(call.muted ? 'unmute' : 'mute')} />
          <Btn icon={call.held ? 'play' : 'pause'} on={call.held} disabled={!connected}
            text={call.held ? t('phoneCalls.resume') : t('phoneCalls.hold')} onPress={() => run(call.held ? 'unhold' : 'hold')} />
          <Btn icon="dialpad" on={showKeys} disabled={!connected}
            text={t('phoneCalls.keypad')} onPress={() => setShowKeys((v) => !v)} />
        </View>

        {showKeys && connected ? (
          <View style={styles.keys}>
            {KEYS.map((k) => (
              <Pressable key={k} onPress={() => run('dtmf', k)} style={[styles.key, { backgroundColor: theme.colors.surfaceVariant }]}>
                <Text variant="titleMedium" style={{ color: theme.colors.onSurface, fontWeight: '600' }}>{k}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 10, right: 10, zIndex: 1000, elevation: 20 },
  card: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: 12, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
  header: { flexDirection: 'row', alignItems: 'center' },
  hangup: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#DC2626', alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', justifyContent: 'space-around', marginTop: 10 },
  btn: { alignItems: 'center', minWidth: 64 },
  btnIcon: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  keys: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', marginTop: 8, direction: 'ltr' },
  key: { width: '30%', margin: '1.5%', height: 42, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
});
