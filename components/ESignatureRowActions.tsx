import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';
import { Menu, Divider } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useAppTheme } from '../hooks/useAppTheme';
import { sendDocAndAlert } from '../utils/sendDocAlert';
import { withSharer } from '../utils/esignatureLink';
import type { ESignatureDocument } from '../types';

interface Props {
  doc: ESignatureDocument;
  user: any;
}

interface Target {
  name: string;
  phone: string;
  url: string;
}

/** Quick actions on a signature row: send the signing link on WhatsApp (confirm first) or copy it - per pending signer. */
export function ESignatureRowActions({ doc, user }: Props) {
  const theme = useAppTheme();
  const [menuVisible, setMenuVisible] = useState(false);
  const [sending, setSending] = useState(false);
  const org: string = user?.organization || '';
  const docId = doc.documentId || doc.id;
  const docName = doc.documentName || doc.title || '';
  const open = doc.status === 'pending' || doc.status === 'partiallySigned';

  const urlFor = (token?: string) => (token ? withSharer(`https://gambot.co.il/${org}/esignature/${docId}/sign/${token}`, user) : '');

  // Everyone who still has to sign (a document with no signers list signs through its own token).
  const pending = (doc.signers || []).filter((s) => s.status !== 'signed');
  const targets: Target[] = pending.length > 0
    ? pending.map((s) => ({
        name: s.signerName || '',
        phone: s.signerPhone || (pending.length === 1 ? doc.phoneNumber || '' : ''),
        url: urlFor(s.signingToken || doc.token),
      }))
    : [{ name: doc.contactName || '', phone: doc.phoneNumber || '', url: urlFor(doc.token) }];
  const usable = targets.filter((t) => !!t.url);
  const multi = usable.length > 1;

  const confirmSend = useCallback((tg: Target) => {
    if (!tg.phone) {
      Alert.alert('שליחה בוואטסאפ', `${tg.name ? `ל${tg.name} ` : ''}אין מספר טלפון. אפשר להעתיק את הקישור ולשלוח ידנית.`);
      return;
    }
    Alert.alert(
      'שליחה בוואטסאפ',
      `לשלוח את "${docName}" לחתימה ל${tg.name || tg.phone}?\nבהודעה רגילה, או בתבנית כשהשיחה סגורה.`,
      [
        { text: 'ביטול', style: 'cancel' },
        {
          text: 'שלח',
          onPress: async () => {
            setSending(true);
            try {
              await sendDocAndAlert({
                organization: org,
                phone: tg.phone,
                role: 'digitalSignature',
                user,
                customerName: tg.name,
                docLabel: docName,
                url: tg.url,
                liveText: `שלום ${tg.name || ''},\nהמסמך "${docName}" מוכן לחתימה ✍️`,
              });
            } finally {
              setSending(false);
            }
          },
        },
      ],
    );
  }, [docName, org, user]);

  const copy = useCallback(async (tg: Target) => {
    await Clipboard.setStringAsync(tg.url);
    Alert.alert('הקישור הועתק', 'קישור החתימה הועתק ללוח');
  }, []);

  if (!open || usable.length === 0 || !org) return null;

  const item = (title: string, icon: string, run: () => void, divider = false) => (
    <React.Fragment key={title}>
      {divider ? <Divider /> : null}
      <Menu.Item
        leadingIcon={icon}
        title={title}
        onPress={() => { setMenuVisible(false); setTimeout(run, 60); }}
      />
    </React.Fragment>
  );

  return (
    <View style={styles.row}>
      <Pressable
        onPress={() => (multi ? setMenuVisible(true) : confirmSend(usable[0]))}
        disabled={sending}
        hitSlop={8}
        style={[styles.btn, { backgroundColor: '#25D36622' }]}
      >
        {sending
          ? <ActivityIndicator size="small" color="#16a34a" />
          : <MaterialCommunityIcons name="whatsapp" size={20} color="#16a34a" />}
      </Pressable>
      <Menu
        visible={menuVisible}
        onDismiss={() => setMenuVisible(false)}
        anchor={
          <Pressable onPress={() => setMenuVisible(true)} hitSlop={8} style={styles.btn}>
            <MaterialCommunityIcons name="dots-vertical" size={22} color={theme.colors.onSurfaceVariant} />
          </Pressable>
        }
        contentStyle={{ backgroundColor: theme.colors.surface }}
      >
        {usable.map((tg, i) => (
          <React.Fragment key={`${tg.name}-${i}`}>
            {item(multi ? `שלח בוואטסאפ ל${tg.name || 'חותם'}` : 'שלח בוואטסאפ', 'whatsapp', () => confirmSend(tg), i > 0)}
            {item(multi ? `העתק קישור של ${tg.name || 'חותם'}` : 'העתק קישור לחתימה', 'link-variant', () => copy(tg))}
          </React.Fragment>
        ))}
      </Menu>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  btn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
});

export default ESignatureRowActions;
