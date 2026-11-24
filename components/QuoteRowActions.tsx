import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';
import { Menu, Divider } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import { useAppTheme } from '../hooks/useAppTheme';
import { quotesApi } from '../services/api/quotes';
import { invoicesApi } from '../services/api/invoices';
import { sendQuoteViaGambot } from '../services/quoteWhatsApp';
import { buildQuoteHtml, openPdf } from '../utils/documentPdf';
import type { Quote } from '../types';

// Only the content the quote form edits is copied (not runtime state like views / signatures / invoice link) — same list as the web.
const DUPLICATE_FIELDS = [
  'currency', 'items', 'discount', 'discountType', 'tax', 'notes', 'terms', 'showSalesperson', 'showSignatureLine',
  'showNotes', 'showTerms', 'showShipping', 'shipping', 'showBankDetails', 'bankDetails', 'salespersonId', 'salespersonName',
  'contactName', 'contactPhone', 'contactEmail', 'contactCompany', 'additionalContacts', 'signers',
  'subtotal', 'discountAmount', 'taxAmount', 'total', 'branding',
];

interface Props {
  quote: Quote;
  user: any;
  /** The list changed (sent / duplicated / deleted) - refresh it. */
  onChanged: () => void;
}

/** Quick actions on a quote row: send on WhatsApp + the "..." menu (PDF, copy link, invoice, duplicate, delete) - like the web list. */
export function QuoteRowActions({ quote, user, onChanged }: Props) {
  const theme = useAppTheme();
  const router = useRouter();
  const [menuVisible, setMenuVisible] = useState(false);
  const [busy, setBusy] = useState<'send' | 'pdf' | 'dup' | null>(null);
  const org: string = user?.organization || '';
  const phone = quote.phoneNumber || quote.contactPhone || '';

  const quoteUrl = `https://www.gambot.co.il/quote?org=${encodeURIComponent(org)}&id=${encodeURIComponent(quote.id || '')}`;

  const send = useCallback(() => {
    if (!phone) {
      Alert.alert('שליחה בוואטסאפ', 'ללקוח אין מספר טלפון.');
      return;
    }
    Alert.alert(
      'שליחה בוואטסאפ',
      `לשלוח את הצעת המחיר ל${quote.contactName || phone}?\nבהודעה רגילה, או בתבנית כשהשיחה סגורה.`,
      [
        { text: 'ביטול', style: 'cancel' },
        {
          text: 'שלח',
          onPress: async () => {
            setBusy('send');
            try {
              const mode = await sendQuoteViaGambot(user, quote);
              Alert.alert('נשלח', mode === 'template' ? 'ההצעה נשלחה בתבנית (השיחה הייתה סגורה).' : 'ההצעה נשלחה בוואטסאפ.');
              onChanged();
            } catch (e: any) {
              Alert.alert('השליחה נכשלה', e?.message || 'שגיאה');
            } finally {
              setBusy(null);
            }
          },
        },
      ],
    );
  }, [phone, quote, user, onChanged]);

  const copyLink = useCallback(async () => {
    await Clipboard.setStringAsync(quoteUrl);
    Alert.alert('הקישור הועתק', 'קישור לצפייה בהצעת המחיר הועתק ללוח');
  }, [quoteUrl]);

  const downloadPdf = useCallback(async () => {
    setBusy('pdf');
    try {
      const [branding, full] = await Promise.all([
        invoicesApi.getBranding(org).catch(() => null),
        quotesApi.getById(org, quote.id).catch(() => null),
      ]);
      await openPdf(org, buildQuoteHtml({ ...quote, ...(full || {}) } as Quote, branding), `quote_${quote.quoteNumber || quote.id || 'doc'}`);
    } catch (e: any) {
      Alert.alert('שגיאה', e?.message || 'יצירת ה-PDF נכשלה');
    } finally {
      setBusy(null);
    }
  }, [org, quote]);

  const invoice = useCallback(() => {
    if (quote.invoiceGeneratedId) {
      router.push({ pathname: '/(tabs)/more/invoices/[id]', params: { id: quote.invoiceGeneratedId } } as any);
      return;
    }
    router.push({
      pathname: '/(tabs)/more/invoices/[id]',
      params: {
        id: 'new',
        prefillContactName: quote.contactName || '',
        prefillContactPhone: quote.contactPhone || quote.phoneNumber || '',
        prefillRelatedQuoteId: quote.id || '',
      },
    } as any);
  }, [quote, router]);

  const duplicate = useCallback(async () => {
    setBusy('dup');
    try {
      let full: any = quote;
      try { full = { ...quote, ...(await quotesApi.getById(org, quote.id)) }; } catch { /* use the row */ }
      const data: any = {};
      DUPLICATE_FIELDS.forEach((k) => { if (full[k] !== undefined) data[k] = full[k]; });
      data.title = `${full.title || ''} (העתק)`;
      data.status = 'draft';
      data.leadId = '';
      data.leadTitle = '';
      data.date = new Date().toISOString().split('T')[0];
      data.validUntil = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];
      const res = await quotesApi.create(org, data, user?.uID || user?.userId, user?.fullname);
      const newId = res?.Message ?? res?.message;
      if (!(res?.Success ?? res?.success) || !newId) throw new Error(typeof newId === 'string' && newId ? newId : 'שכפול ההצעה נכשל');
      onChanged();
      router.push({ pathname: '/(tabs)/more/quotes/[id]', params: { id: String(newId) } } as any);
    } catch (e: any) {
      Alert.alert('שגיאה', e?.message || 'שכפול ההצעה נכשל');
    } finally {
      setBusy(null);
    }
  }, [org, quote, user, onChanged, router]);

  const remove = useCallback(() => {
    Alert.alert('מחיקת הצעת מחיר', `למחוק את "${quote.title}"?`, [
      { text: 'ביטול', style: 'cancel' },
      {
        text: 'מחק',
        style: 'destructive',
        onPress: async () => {
          try {
            await quotesApi.delete(org, quote.id);
            onChanged();
          } catch (e: any) {
            Alert.alert('שגיאה', e?.message || 'המחיקה נכשלה');
          }
        },
      },
    ]);
  }, [org, quote, onChanged]);

  const item = (title: string, icon: string, run: () => void, opts?: { destructive?: boolean; divider?: boolean; disabled?: boolean }) => (
    <React.Fragment key={title}>
      {opts?.divider ? <Divider /> : null}
      <Menu.Item
        leadingIcon={icon}
        title={title}
        disabled={opts?.disabled}
        titleStyle={opts?.destructive ? { color: theme.colors.error } : undefined}
        onPress={() => { setMenuVisible(false); setTimeout(run, 60); }}
      />
    </React.Fragment>
  );

  return (
    <View style={styles.row}>
      <Pressable onPress={send} disabled={busy === 'send'} hitSlop={8} style={[styles.btn, { backgroundColor: '#25D36622' }]}>
        {busy === 'send'
          ? <ActivityIndicator size="small" color="#16a34a" />
          : <MaterialCommunityIcons name="whatsapp" size={20} color="#16a34a" />}
      </Pressable>
      <Menu
        visible={menuVisible}
        onDismiss={() => setMenuVisible(false)}
        anchor={
          <Pressable onPress={() => setMenuVisible(true)} hitSlop={8} style={styles.btn}>
            {busy === 'pdf' || busy === 'dup'
              ? <ActivityIndicator size="small" color={theme.colors.onSurfaceVariant} />
              : <MaterialCommunityIcons name="dots-vertical" size={22} color={theme.colors.onSurfaceVariant} />}
          </Pressable>
        }
        contentStyle={{ backgroundColor: theme.colors.surface }}
      >
        {item('הורד PDF', 'file-pdf-box', downloadPdf)}
        {item('העתק קישור לשליחה', 'link-variant', copyLink)}
        {item(quote.invoiceGeneratedId ? `צפה בחשבונית ${quote.invoiceDocumentNumber || ''}`.trim() : 'הפק חשבונית', 'file-document-check-outline', invoice)}
        {item('שכפל', 'content-copy', duplicate)}
        {item('מחק', 'delete-outline', remove, { destructive: true, divider: true })}
      </Menu>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  btn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
});

export default QuoteRowActions;
