import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { phoneCallsApi } from '../../services/api/phoneCalls';
import { useAuthStore } from '../../stores/authStore';

interface Props {
  visible: boolean;
  organization: string;
  onClose: () => void;
  /** Called with the chosen target: a colleague (their app + mobile ring) or any phone number. */
  onPick: (target: { targetUserId?: string; number?: string }) => void;
}

/** "Transfer call": pick a colleague with an extension, or type any number. Kept to one tap. */
export default function CallTransferSheet({ visible, organization, onClose, onPick }: Props) {
  const { t } = useTranslation();
  const me = useAuthStore((s) => s.user);
  const [team, setTeam] = useState<{ userId: string; name: string; extension: string }[] | null>(null);
  const [number, setNumber] = useState('');

  useEffect(() => {
    if (!visible || team) return;
    let off = false;
    (async () => {
      try {
        const s = await phoneCallsApi.getTelephonySettings(organization);
        const list = (Array.isArray(s?.extensions) ? s.extensions : [])
          .filter((e: any) => e && e.userId && String(e.enabled) === 'true' && e.userId !== me?.userId && e.userId !== me?.uID)
          .map((e: any) => ({ userId: String(e.userId), name: String(e.name || e.extension || ''), extension: String(e.extension || '') }));
        if (!off) setTeam(list);
      } catch {
        if (!off) setTeam([]);
      }
    })();
    return () => { off = true; };
  }, [visible, organization]);

  const digits = number.replace(/[^\d+]/g, '');

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.header}>
            <Text style={styles.title}>{t('phoneCalls.transferCall', 'Transfer call')}</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <MaterialCommunityIcons name="close" size={22} color="#E2E8F0" />
            </Pressable>
          </View>

          <ScrollView style={{ maxHeight: 300 }} keyboardShouldPersistTaps="handled">
            {team === null ? <ActivityIndicator color="#fff" style={{ margin: 16 }} /> : null}
            {team && team.length === 0 ? <Text style={styles.empty}>{t('phoneCalls.transferNoTeam', 'No other team members with an extension')}</Text> : null}
            {(team || []).map((m) => (
              <Pressable key={m.userId} style={styles.row} onPress={() => onPick({ targetUserId: m.userId })}>
                <View style={styles.avatar}><MaterialCommunityIcons name="account" size={20} color="#fff" /></View>
                <Text style={styles.rowName} numberOfLines={1}>{m.name}</Text>
                {!!m.extension && <Text style={styles.rowExt}>{m.extension}</Text>}
              </Pressable>
            ))}
          </ScrollView>

          <View style={styles.numberRow}>
            <TextInput
              value={number}
              onChangeText={setNumber}
              placeholder={t('phoneCalls.transferNumber', 'Or enter a phone number')}
              placeholderTextColor="#64748B"
              keyboardType="phone-pad"
              style={styles.input}
            />
            <Pressable
              disabled={digits.replace(/\D/g, '').length < 7}
              onPress={() => onPick({ number: digits })}
              style={[styles.go, digits.replace(/\D/g, '').length < 7 && { opacity: 0.4 }]}
            >
              <MaterialCommunityIcons name="phone-forward" size={22} color="#fff" />
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#1e293b', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, paddingBottom: 28 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  title: { color: '#fff', fontSize: 18, fontWeight: '700' },
  empty: { color: '#94A3B8', textAlign: 'center', padding: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.12)' },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#2e6155', alignItems: 'center', justifyContent: 'center' },
  rowName: { color: '#fff', fontSize: 16, flex: 1 },
  rowExt: { color: '#94A3B8', fontSize: 14 },
  numberRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14 },
  input: { flex: 1, color: '#fff', backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 16, writingDirection: 'ltr' },
  go: { width: 46, height: 46, borderRadius: 23, backgroundColor: '#16a34a', alignItems: 'center', justifyContent: 'center' },
});
