import React, { useEffect, useState } from 'react';
import { Alert, Keyboard, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { Button, IconButton, Modal, Portal, Text, TextInput } from 'react-native-paper';
import * as Clipboard from 'expo-clipboard';
import PhoneNumberInput from '../PhoneNumberInput';
import { sendDocAndAlert } from '../../utils/sendDocAlert';
import { useAppTheme } from '../../hooks/useAppTheme';

const BRAND_COLOR = '#2e6155';

export interface CatalogShare {
  /** Sheet title, e.g. "שיתוף הקטלוג" / the item name. */
  title: string;
  /** Link the customer opens (template URL button / appended to the free text). */
  url: string;
  /** What is being sent - template variable {{2}} ("הקטלוג שלנו", item name...). */
  docLabel: string;
  /** Free text used when the 24h window is open (the link is appended automatically). {name} is replaced by the customer's name. */
  liveText: string;
  phone?: string;
  name?: string;
}

interface Props {
  share: CatalogShare | null;
  user: any;
  onClose: () => void;
}

/** Shares a catalog link / item through Gambot's WhatsApp (open window → regular message, closed → the default catalog template), or copies the link. */
export function CatalogWhatsAppSheet({ share, user, onClose }: Props) {
  const theme = useAppTheme();
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (share) {
      setPhone(share.phone || '');
      setName(share.name || '');
    }
  }, [share]);

  const copy = async () => {
    if (!share) return;
    await Clipboard.setStringAsync(share.url);
    Alert.alert('הקישור הועתק', 'הקישור הועתק ללוח');
  };

  const confirmSend = () => {
    if (!share) return;
    Keyboard.dismiss();
    if (!phone || phone.replace(/\D/g, '').length < 7) {
      Alert.alert('שליחה בוואטסאפ', 'יש להזין מספר טלפון של הלקוח.');
      return;
    }
    Alert.alert(
      'שליחה בוואטסאפ',
      `לשלוח את "${share.docLabel}" ל${name.trim() || phone}?\nבהודעה רגילה, או בתבנית כשהשיחה סגורה.`,
      [
        { text: 'ביטול', style: 'cancel' },
        {
          text: 'שלח',
          onPress: async () => {
            setSending(true);
            try {
              const first = name.trim();
              const sent = await sendDocAndAlert({
                organization: user.organization,
                phone,
                role: 'sendForm', // the one generic "send a link" template
                user,
                customerName: first,
                docLabel: share.docLabel,
                url: share.url,
                liveText: share.liveText.replace('{name}', first ? `${first}, ` : ''),
              });
              if (sent) onClose();
            } finally {
              setSending(false);
            }
          },
        },
      ],
    );
  };

  return (
    <Portal>
      <Modal
        visible={!!share}
        onDismiss={onClose}
        contentContainerStyle={[styles.modal, { backgroundColor: theme.colors.surface }]}
      >
        <View style={styles.head}>
          <Text variant="titleMedium" style={{ color: theme.colors.onSurface, flex: 1 }} numberOfLines={1}>
            {share?.title || ''}
          </Text>
          <IconButton icon="close" size={20} onPress={onClose} />
        </View>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView keyboardShouldPersistTaps="handled">
            <Text selectable style={[styles.url, { color: theme.colors.onSurfaceVariant, backgroundColor: theme.colors.surfaceVariant }]} numberOfLines={2}>
              {share?.url}
            </Text>
            <TextInput
              label="שם הלקוח (לא חובה)"
              value={name}
              onChangeText={setName}
              mode="outlined"
              dense
              style={styles.input}
              outlineColor={BRAND_COLOR + '40'}
              activeOutlineColor={BRAND_COLOR}
            />
            <PhoneNumberInput
              label="טלפון (לשליחה בוואטסאפ)"
              value={phone}
              onChangeNumber={setPhone}
              theme={theme}
              placeholder="050-0000000"
            />
            <View style={styles.btns}>
              <Button mode="outlined" icon="content-copy" onPress={copy} style={{ flex: 1, borderColor: BRAND_COLOR }} textColor={BRAND_COLOR}>
                העתק קישור
              </Button>
              <Button
                mode="contained"
                icon="whatsapp"
                onPress={confirmSend}
                loading={sending}
                disabled={sending}
                style={{ flex: 1, backgroundColor: BRAND_COLOR }}
                textColor="#fff"
              >
                שלח בוואטסאפ
              </Button>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </Portal>
  );
}

const styles = StyleSheet.create({
  modal: { marginHorizontal: 20, borderRadius: 16, padding: 16, maxHeight: '85%' },
  head: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  url: { padding: 10, borderRadius: 8, marginBottom: 12, writingDirection: 'ltr', fontSize: 12 },
  input: { marginBottom: 10 },
  btns: { flexDirection: 'row', gap: 8, marginTop: 16 },
});

export default CatalogWhatsAppSheet;
