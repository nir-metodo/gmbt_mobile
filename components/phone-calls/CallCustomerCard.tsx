import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { contactsApi } from '../../services/api/contacts';
import type { Contact } from '../../types';

const last9 = (s: string) => (s || '').replace(/\D/g, '').slice(-9);

/** The CRM side of the call: who the customer is (owner, tags, last conversation) with one tap to the contact / chat. */
export default function CallCustomerCard({ organization, phone, onNavigate, onContact }: { organization: string; phone: string; onNavigate?: () => void; onContact?: (c: Contact | null) => void }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [contact, setContact] = useState<Contact | null | undefined>(undefined);
  useEffect(() => { if (contact !== undefined) onContact?.(contact); }, [contact]);

  useEffect(() => {
    let off = false;
    setContact(undefined);
    const key = last9(phone);
    if (key.length < 7) { setContact(null); return undefined; }
    (async () => {
      try {
        const list = await contactsApi.search(organization, key, 5);
        const hit = (list || []).find((c) => last9(c.phoneNumber || c.id) === key) || null;
        if (!off) setContact(hit);
      } catch {
        if (!off) setContact(null);
      }
    })();
    return () => { off = true; };
  }, [organization, phone]);

  if (contact === undefined) return null;

  const open = (kind: 'contact' | 'chat') => {
    onNavigate?.();
    if (kind === 'chat') router.push({ pathname: '/(tabs)/chats/[phoneNumber]', params: { phoneNumber: contact?.phoneNumber || contact?.id || phone } } as any);
    else router.push({ pathname: '/(tabs)/contacts/[id]', params: { id: contact?.id || contact?.phoneNumber || phone } } as any);
  };

  if (!contact) {
    return (
      <View style={styles.card}>
        <Text style={styles.unknown}>{t('phoneCalls.newCustomer', 'New number - not in your contacts yet')}</Text>
      </View>
    );
  }

  const tags = (Array.isArray(contact.keys) ? contact.keys : String(contact.keys || '').split(',')).map((k) => String(k).trim()).filter(Boolean).slice(0, 4);

  return (
    <View style={styles.card}>
      <View style={styles.rowTop}>
        {!!contact.ownerName && (
          <View style={styles.chip}>
            <MaterialCommunityIcons name="account-tie" size={14} color="#CBD5E1" />
            <Text style={styles.chipText} numberOfLines={1}>{contact.ownerName}</Text>
          </View>
        )}
        {tags.map((k) => (
          <View key={k} style={[styles.chip, { backgroundColor: 'rgba(74,222,128,0.16)' }]}>
            <Text style={[styles.chipText, { color: '#86EFAC' }]} numberOfLines={1}>{k}</Text>
          </View>
        ))}
      </View>
      {!!contact.lastMessage && (
        <Text style={styles.last} numberOfLines={2}>
          {t('phoneCalls.lastMessage', 'Last message')}: {String(contact.lastMessage)}
        </Text>
      )}
      <View style={styles.actions}>
        <Pressable style={styles.action} onPress={() => open('contact')}>
          <MaterialCommunityIcons name="card-account-details-outline" size={18} color="#fff" />
          <Text style={styles.actionText}>{t('phoneCalls.openContact', 'Contact card')}</Text>
        </Pressable>
        <Pressable style={styles.action} onPress={() => open('chat')}>
          <MaterialCommunityIcons name="chat-outline" size={18} color="#fff" />
          <Text style={styles.actionText}>{t('phoneCalls.openChat', 'Chat')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { width: '100%', marginTop: 18, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 14, padding: 12, gap: 8 },
  unknown: { color: '#CBD5E1', fontSize: 14, textAlign: 'center' },
  rowTop: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4, maxWidth: '100%' },
  chipText: { color: '#E2E8F0', fontSize: 12 },
  last: { color: '#CBD5E1', fontSize: 13 },
  actions: { flexDirection: 'row', gap: 10 },
  action: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 10, paddingVertical: 9 },
  actionText: { color: '#fff', fontSize: 14, fontWeight: '600' },
});
