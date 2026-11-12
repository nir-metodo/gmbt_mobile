import { useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Text, useTheme } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useDialSheetStore } from '../../stores/dialSheetStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { executeCall, getDefaultDialer, type DialerKind } from '../../utils/phoneCall';

const BRAND = '#2e6155';

/**
 * Opened by every "Call" button (chats, contacts, leads, cases, quotes...). Shows the number with the user's DEFAULT dialer
 * ready to go (Settings → Default dialer), and a small "switch to the other dialer" link below it.
 */
export default function DialSheet() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const isRTL = i18n.language?.startsWith('he');
  const opts = useDialSheetStore((s) => s.opts);
  const close = useDialSheetStore((s) => s.close);
  // re-render when the user changes the default in Settings
  useSettingsStore((s) => s.defaultDialer);
  const [busy, setBusy] = useState(false);

  if (!opts) return null;

  const primary: DialerKind = getDefaultDialer();
  const other: DialerKind = primary === 'system' ? 'phone' : 'system';
  const label = (k: DialerKind) => (k === 'system'
    ? t('phoneCalls.systemDialer', isRTL ? 'חייגן המערכת' : 'System dialer')
    : t('phoneCalls.phoneDialer', isRTL ? 'חייגן הטלפון' : 'Phone dialer'));

  const run = async (kind: DialerKind) => {
    if (busy) return;
    const call = opts;
    setBusy(true);
    close();
    try {
      const res = await executeCall(call, kind);
      // A bridge call (non-SIP provider) rings the user's phone first - tell them. SIP calls show the in-call bar instead.
      if (res.mode === 'gambot' && res.success && useSettingsStore.getState().telephonyProvider !== 'sip') {
        Alert.alert(
          t('phoneCalls.gambotCallTitle', 'Gambot Call'),
          t('phoneCalls.callInitiated', 'Call initiated. Your phone will ring shortly.'),
        );
      }
    } catch {
      Alert.alert(t('common.error'), t('phoneCalls.gambotCallFailed', 'Failed to initiate call'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible transparent animationType="slide" statusBarTranslucent onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close}>
        <Pressable style={[styles.sheet, { backgroundColor: theme.colors.surface }]} onPress={() => {}}>
          <View style={styles.handle} />
          {!!opts.customerName && (
            <Text style={[styles.name, { color: theme.colors.onSurface }]} numberOfLines={1}>{opts.customerName}</Text>
          )}
          <Text style={[styles.number, { color: theme.colors.onSurfaceVariant }]}>{opts.phoneNumber}</Text>

          <Pressable style={[styles.callBtn, { opacity: busy ? 0.7 : 1 }]} onPress={() => run(primary)} disabled={busy}>
            {busy
              ? <ActivityIndicator color="#fff" />
              : <MaterialCommunityIcons name={primary === 'system' ? 'phone-in-talk' : 'phone'} size={24} color="#fff" />}
            <View>
              <Text style={styles.callBtnText}>{t('common.call', isRTL ? 'חייג' : 'Call')}</Text>
              <Text style={styles.callBtnSub}>{label(primary)}</Text>
            </View>
          </Pressable>

          <Pressable onPress={() => run(other)} disabled={busy} hitSlop={8} style={styles.switchWrap}>
            <Text style={[styles.switchText, { color: BRAND }]}>
              {isRTL ? `עבור ל${label(other)}` : `Switch to ${label(other).toLowerCase()}`}
            </Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 24, paddingTop: 10, paddingBottom: 32, alignItems: 'center' },
  handle: { width: 44, height: 5, borderRadius: 3, backgroundColor: '#cbd5e1', marginBottom: 16 },
  name: { fontSize: 20, fontWeight: '700', textAlign: 'center' },
  number: { fontSize: 18, marginTop: 4, marginBottom: 20, writingDirection: 'ltr' },
  callBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: '#16a34a', borderRadius: 16, paddingVertical: 14, paddingHorizontal: 28, alignSelf: 'stretch' },
  callBtnText: { color: '#fff', fontSize: 18, fontWeight: '700', textAlign: 'center' },
  callBtnSub: { color: '#dcfce7', fontSize: 12, textAlign: 'center' },
  switchWrap: { marginTop: 14, paddingVertical: 6 },
  switchText: { fontSize: 13, fontWeight: '600', textDecorationLine: 'underline' },
});
