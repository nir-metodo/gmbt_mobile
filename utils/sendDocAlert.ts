import { Alert, Share } from 'react-native';
import { router } from 'expo-router';
import {
  DefaultTemplatePendingError,
  MissingDefaultTemplateError,
  sendDocumentViaGambot,
  type SendDocParams,
} from '../services/whatsappDocSender';

const WHAT: Record<SendDocParams['role'], string> = {
  sendInvoice: 'המסמך',
  sendPaymentLink: 'קישור התשלום',
  digitalSignature: 'הבקשה לחתימה',
  sendForm: 'הקישור',
};

/**
 * Sends a document through the org's Gambot WhatsApp number (free text when the 24h window is open, the org's default
 * template when it is closed) and tells the user the outcome with one consistent message.
 * Never opens the phone's own WhatsApp. Returns true when the message was sent.
 */
export async function sendDocAndAlert(params: SendDocParams): Promise<boolean> {
  const what = WHAT[params.role];
  try {
    const mode = await sendDocumentViaGambot(params);
    Alert.alert(
      'נשלח',
      mode === 'regular' ? `${what} נשלח בוואטסאפ` : `${what} נשלח בוואטסאפ באמצעות תבנית (השיחה סגורה)`,
    );
    return true;
  } catch (err: any) {
    if (err instanceof DefaultTemplatePendingError) {
      Alert.alert(
        'התבנית נוצרה וממתינה לאישור',
        'השיחה עם הלקוח סגורה, ולארגון עדיין לא הייתה תבנית ברירת מחדל לשליחה זו. יצרנו אותה עכשיו ושלחנו לאישור של מטא (בדרך כלל כמה דקות). אפשר לנסות שוב אחרי האישור, או לשתף את הקישור ידנית.',
        [
          { text: 'סגור', style: 'cancel' },
          { text: 'שתף קישור', onPress: () => { Share.share({ message: params.url }).catch(() => {}); } },
        ],
      );
    } else if (err instanceof MissingDefaultTemplateError) {
      Alert.alert(
        'אי אפשר לשלוח',
        'השיחה עם הלקוח סגורה ואין תבנית ברירת מחדל לשליחה זו. אפשר להגדיר אותה בתבניות ← ברירות מחדל, או לשתף את הקישור ידנית.',
        [
          { text: 'סגור', style: 'cancel' },
          { text: 'שתף קישור', onPress: () => { Share.share({ message: params.url }).catch(() => {}); } },
          { text: 'הגדר תבניות', onPress: () => { router.push({ pathname: '/(tabs)/more/templates', params: { tab: 'defaults' } } as any); } },
        ],
      );
    } else {
      Alert.alert('שגיאה', err?.message || 'השליחה נכשלה');
    }
    return false;
  }
}
