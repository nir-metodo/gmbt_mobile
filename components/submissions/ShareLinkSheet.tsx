import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, View, Share, Alert, StyleSheet } from 'react-native';
import { Button, Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useRTL } from '../../hooks/useRTL';
import { sendDocAndAlert } from '../../utils/sendDocAlert';
import ContactLookup from '../ContactLookup';
import { TaskFormFrame, TaskFormHeader, TaskFormBody } from '../tasks/TaskFormParts';

export interface ShareContact {
  name: string;
  phone: string;
}

interface Props {
  visible: boolean;
  onDismiss: () => void;
  /** Form / document name — shown as the title and used in the WhatsApp message. */
  title: string;
  kind: 'form' | 'document';
  /** Returns the public link. Forms: static. Documents: creates a fill-in link (optionally tied to the recipient). */
  makeUrl: (contact?: ShareContact) => Promise<string>;
  user: any;
}

type Busy = 'copy' | 'share' | 'wa' | null;

/**
 * One place to hand a form / document to a customer: copy the link, share it with any app, or send it on WhatsApp
 * THROUGH Gambot (free text when the 24h window is open, the default "form" template when closed).
 */
export default function ShareLinkSheet({ visible, onDismiss, title, kind, makeUrl, user }: Props) {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const { isRTL, flexDirection, textAlign } = useRTL();
  const tr = (he: string, en: string) => (isRTL ? he : en);
  const organization: string = user?.organization || '';

  const [contact, setContact] = useState<ShareContact | null>(null);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState<Busy>(null);
  const [note, setNote] = useState('');
  const [lookup, setLookup] = useState(false);
  const cache = useRef<Record<string, string>>({});
  // True when the contact picker was opened from the WhatsApp button → send as soon as a contact is picked.
  const waPending = useRef<null | 'auto' | 'template'>(null);

  useEffect(() => {
    if (!visible) return;
    setContact(null);
    setUrl('');
    setNote('');
    setBusy(null);
    setLookup(false);
    cache.current = {};
    // Static links (forms) are shown right away; per-recipient links are created on the first action.
    if (kind === 'form') {
      makeUrl().then((u) => {
        cache.current[''] = u;
        setUrl(u);
      }).catch(() => {});
    }
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const ensureUrl = useCallback(async (c?: ShareContact | null): Promise<string> => {
    const key = c?.phone || '';
    if (cache.current[key]) {
      setUrl(cache.current[key]);
      return cache.current[key];
    }
    const u = await makeUrl(c || undefined);
    if (!u) throw new Error('no url');
    cache.current[key] = u;
    setUrl(u);
    return u;
  }, [makeUrl]);

  const run = useCallback(async (what: Exclude<Busy, null>, fn: () => Promise<void>) => {
    setBusy(what);
    setNote('');
    try {
      await fn();
    } catch (e: any) {
      Alert.alert(tr('שגיאה', 'Error'), e?.message && e.message !== 'no url' ? e.message : tr('יצירת הקישור נכשלה', 'Could not create the link'));
    } finally {
      setBusy(null);
    }
  }, [isRTL]); // eslint-disable-line react-hooks/exhaustive-deps

  const copy = () => run('copy', async () => {
    const u = await ensureUrl(contact);
    await Clipboard.setStringAsync(u);
    setNote(tr('הקישור הועתק', 'Link copied'));
  });

  const share = () => run('share', async () => {
    const u = await ensureUrl(contact);
    await Share.share({ message: `${title}: ${u}` });
  });

  // asTemplate: always the default template (even with an open 24h window); otherwise a regular message when open, template when closed.
  const sendWhatsApp = (c: ShareContact, asTemplate: boolean) => run('wa', async () => {
    const u = await ensureUrl(c);
    const noun = kind === 'form' ? 'הטופס' : 'המסמך';
    await sendDocAndAlert({
      organization,
      phone: c.phone,
      role: 'sendForm',
      user,
      customerName: c.name,
      docLabel: title,
      url: u,
      liveText: `שלום ${c.name || ''},\nקישור למילוי ${noun} "${title}":`,
      forceTemplate: asTemplate,
    });
  });

  // Confirm before anything leaves the app.
  const confirmSend = (c: ShareContact, asTemplate: boolean) =>
    Alert.alert(
      tr('שליחה בוואטסאפ', 'Send on WhatsApp'),
      asTemplate
        ? tr(`לשלוח את "${title}" ל${c.name || c.phone} כתבנית?`, `Send "${title}" to ${c.name || c.phone} as a template?`)
        : tr(`לשלוח את "${title}" ל${c.name || c.phone}?\nבהודעה רגילה, או בתבנית כשהשיחה סגורה.`, `Send "${title}" to ${c.name || c.phone}?\nAs a regular message, or as a template if the chat is closed.`),
      [
        { text: tr('ביטול', 'Cancel'), style: 'cancel' },
        { text: tr('שלח', 'Send'), onPress: () => sendWhatsApp(c, asTemplate) },
      ],
    );

  const onWhatsApp = (asTemplate: boolean) => {
    if (contact) confirmSend(contact, asTemplate);
    else {
      waPending.current = asTemplate ? 'template' : 'auto';
      setLookup(true);
    }
  };

  const muted = theme.colors.onSurfaceVariant;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss} statusBarTranslucent>
      <TaskFormFrame dim onBackdropPress={onDismiss}>
        <TaskFormHeader title={title} onClose={onDismiss} />
        <TaskFormBody>
          <View style={[styles.linkBox, { borderColor: theme.colors.outlineVariant, backgroundColor: theme.colors.surfaceVariant }]}>
            <Text selectable numberOfLines={2} style={{ fontSize: 12.5, color: url ? theme.colors.onSurface : muted, textAlign: 'left' }}>
              {url || tr('הקישור ייווצר עם הפעולה הראשונה (העתקה / שיתוף / שליחה)', 'The link is created with the first action (copy / share / send)')}
            </Text>
          </View>

          <View style={[styles.recipient, { flexDirection }]}>
            <MaterialCommunityIcons name="account-outline" size={20} color={muted} />
            <Text style={{ flex: 1, color: contact ? theme.colors.onSurface : muted, textAlign }} numberOfLines={1}>
              {contact ? `${contact.name || ''} ${contact.phone}`.trim() : tr('נמען (לשליחה בוואטסאפ)', 'Recipient (for WhatsApp)')}
            </Text>
            <Button compact mode="text" onPress={() => { waPending.current = null; setLookup(true); }}>
              {contact ? tr('החלף', 'Change') : tr('בחר איש קשר', 'Pick a contact')}
            </Button>
          </View>

          <View style={styles.actions}>
            <Button mode="contained" icon="whatsapp" buttonColor="#16a34a" loading={busy === 'wa'} disabled={!!busy} onPress={() => onWhatsApp(false)}>
              {tr('שלח בוואטסאפ', 'Send on WhatsApp')}
            </Button>
            <Button mode="outlined" icon="message-text-outline" textColor="#16a34a" disabled={!!busy} onPress={() => onWhatsApp(true)}>
              {tr('שלח כתבנית', 'Send as template')}
            </Button>
            <View style={[styles.row, { flexDirection }]}>
              <Button style={{ flex: 1 }} mode="outlined" icon="content-copy" loading={busy === 'copy'} disabled={!!busy} onPress={copy}>
                {tr('העתק קישור', 'Copy link')}
              </Button>
              <Button style={{ flex: 1 }} mode="outlined" icon="share-variant-outline" loading={busy === 'share'} disabled={!!busy} onPress={share}>
                {tr('שתף', 'Share')}
              </Button>
            </View>
            {note ? <Text style={{ color: '#166534', textAlign: 'center', fontWeight: '600' }}>{note}</Text> : null}
          </View>
          <View style={{ height: insets.bottom + 8 }} />
        </TaskFormBody>
      </TaskFormFrame>

      <ContactLookup
        visible={lookup}
        organization={organization}
        onDismiss={() => { waPending.current = null; setLookup(false); }}
        onSelect={(c) => {
          setLookup(false);
          const picked = { name: c.name, phone: c.phoneNumber };
          setContact(picked);
          if (waPending.current) {
            const asTemplate = waPending.current === 'template';
            waPending.current = null;
            confirmSend(picked, asTemplate);
          }
        }}
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  linkBox: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 12 },
  recipient: { alignItems: 'center', gap: 8, marginTop: 12 },
  actions: { gap: 10, marginTop: 14 },
  row: { gap: 10 },
});
