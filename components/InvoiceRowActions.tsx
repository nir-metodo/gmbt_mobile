import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';
import { Menu, Divider } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import { useAppTheme } from '../hooks/useAppTheme';
import { invoicesApi, Invoice, DOCUMENT_TYPES } from '../services/api/invoices';
import { sendDocAndAlert } from '../utils/sendDocAlert';
import { buildInvoiceHtml, openPdf } from '../utils/documentPdf';
import { formatCurrency } from '../utils/formatters';
import { currencySymbol } from '../utils/currency';

/** Unpaid balance of an issued tax invoice / tax-invoice-receipt (mirrors the invoice screen + web getOpenBalance). */
export function getOpenBalance(inv: Invoice): number {
  if (!inv.isLocked) return 0;
  if (inv.type !== 'tax_invoice' && inv.type !== 'combined') return 0;
  if (inv.status === 'cancelled') return 0;
  const total = Number(inv.total) || 0;
  const balance = inv.balanceDue != null
    ? Number(inv.balanceDue)
    : total - (Number(inv.paidAmount) || 0) - (Number(inv.creditedAmount) || 0);
  return balance > 0.001 ? balance : 0;
}

/** Follow-up documents that make sense without typing an amount (credit documents are created from the document screen). */
export const BULK_DERIVE: Record<string, { targetType: string; label: string; icon: string }[]> = {
  tax_invoice: [
    { targetType: 'receipt', label: 'הפק קבלות', icon: 'receipt' },
    { targetType: 'combined', label: 'חשבונית מס קבלה', icon: 'file-check-outline' },
  ],
  combined: [{ targetType: 'receipt', label: 'הפק קבלות', icon: 'receipt' }],
  transaction: [{ targetType: 'tax_invoice', label: 'הפק חשבוניות מס', icon: 'file-document-outline' }],
};

export const publicUrlOf = (org: string, inv: Invoice) =>
  `https://www.gambot.co.il/invoice?org=${encodeURIComponent(org)}&id=${encodeURIComponent(inv.id || '')}`;

// Issue-time state is never copied into a duplicate - same list as the web form.
const DUPLICATE_DROP = [
  'id', 'documentNumber', 'isLocked', 'status', 'issuedAt', 'allocationNumber', 'allocationNumberShort', 'allocationApproved',
  'allocationError', 'paidAmount', 'balanceDue', 'creditedAmount', 'paymentStatus', 'receiptLinks', 'derivedDocuments',
  'sourceDocumentId', 'sourceDocumentType', 'sourceDocumentNumber', 'createdOn', 'modifiedOn', 'createdById', 'viewCount',
  'lastViewedAt', 'branding',
];

interface Props {
  invoice: Invoice;
  user: any;
  /** The list changed (sent / issued / duplicated / deleted / derived) - refresh it. */
  onChanged: () => void;
}

/** Quick actions on an invoice row: send on WhatsApp + the "..." menu (PDF, link, issue / follow-up documents, duplicate, delete) - like the web list. */
export function InvoiceRowActions({ invoice, user, onChanged }: Props) {
  const theme = useAppTheme();
  const router = useRouter();
  const [menuVisible, setMenuVisible] = useState(false);
  const [busy, setBusy] = useState<'send' | 'work' | null>(null);
  const org: string = user?.organization || '';
  const phone = invoice.contactPhone || '';
  const issued = !!invoice.isLocked;
  const isDraft = !invoice.isLocked && invoice.status === 'draft';
  const userId = user?.uID || user?.userId;
  const docLabel = `${DOCUMENT_TYPES.find((d) => d.key === invoice.type)?.labelHe || invoice.type}${invoice.documentNumber ? ` ${invoice.documentNumber}` : ''}`;
  const url = publicUrlOf(org, invoice);

  const send = useCallback(() => {
    if (!issued) {
      Alert.alert('שליחה בוואטסאפ', 'המסמך עדיין לא הופק. יש להפיק אותו לפני השליחה.');
      return;
    }
    if (!phone) {
      Alert.alert('שליחה בוואטסאפ', 'ללקוח אין מספר טלפון.');
      return;
    }
    Alert.alert(
      'שליחה בוואטסאפ',
      `לשלוח את ${docLabel} ל${invoice.contactName || phone}?\nבהודעה רגילה, או בתבנית כשהשיחה סגורה.`,
      [
        { text: 'ביטול', style: 'cancel' },
        {
          text: 'שלח',
          onPress: async () => {
            setBusy('send');
            try {
              const sent = await sendDocAndAlert({
                organization: org,
                phone,
                role: 'sendInvoice',
                user,
                customerName: invoice.contactName,
                docLabel,
                url,
                liveText: `שלום ${invoice.contactName || ''},\n${docLabel} מוכנה עבורך 🧾\nסה"כ: ${formatCurrency(Number(invoice.total || 0), currencySymbol(invoice.currency))}`,
              });
              if (sent) onChanged();
            } finally {
              setBusy(null);
            }
          },
        },
      ],
    );
  }, [issued, phone, docLabel, invoice, org, user, url, onChanged]);

  const copyLink = useCallback(async () => {
    await Clipboard.setStringAsync(url);
    Alert.alert('הקישור הועתק', 'קישור לצפייה במסמך הועתק ללוח');
  }, [url]);

  const downloadPdf = useCallback(async () => {
    setBusy('work');
    try {
      const [branding, full] = await Promise.all([
        invoicesApi.getBranding(org).catch(() => null),
        invoicesApi.getById(org, invoice.id as string).catch(() => null),
      ]);
      await openPdf(org, buildInvoiceHtml({ ...invoice, ...(full || {}) } as Invoice, branding), `invoice_${invoice.documentNumber || invoice.id || 'doc'}`);
    } catch (e: any) {
      Alert.alert('שגיאה', e?.message || 'יצירת ה-PDF נכשלה');
    } finally {
      setBusy(null);
    }
  }, [org, invoice]);

  const issue = useCallback(() => {
    Alert.alert(
      'הפקת מסמך',
      'הפקה היא סופית — מספר רשמי נקבע והמסמך ננעל לעריכה. ודא שפרטי הלקוח והתשלום נכונים.',
      [
        { text: 'ביטול', style: 'cancel' },
        {
          text: 'הפק',
          style: 'destructive',
          onPress: async () => {
            setBusy('work');
            try {
              const res = await invoicesApi.issue(org, invoice.id as string, userId, user?.fullname);
              if (!(res?.Success ?? res?.success)) throw new Error(res?.Message || res?.message || 'ההפקה נכשלה');
              onChanged();
            } catch (e: any) {
              Alert.alert('שגיאה', e?.message || 'ההפקה נכשלה');
            } finally {
              setBusy(null);
            }
          },
        },
      ],
    );
  }, [org, invoice, user, userId, onChanged]);

  // Creates the follow-up document as a draft and opens it (edit, then issue from there).
  const derive = useCallback((targetType: string, label: string) => {
    const bal = getOpenBalance(invoice);
    const total = Number(invoice.total) || 0;
    if (targetType === 'receipt' && bal <= 0) {
      Alert.alert(label, 'אין יתרה פתוחה במסמך הזה.');
      return;
    }
    // partly paid → receipt for the remaining balance only (0 = the whole document)
    const partial = targetType === 'receipt' && bal > 0 && bal < total - 0.005 ? Math.round(bal * 100) / 100 : 0;
    const amountTxt = targetType === 'receipt' ? ` על סך ${formatCurrency(bal, currencySymbol(invoice.currency))}` : '';
    Alert.alert(label, `ייווצר מסמך חדש כטיוטה${amountTxt}, ותועבר אליו לבדיקה והפקה.`, [
      { text: 'ביטול', style: 'cancel' },
      {
        text: 'צור',
        onPress: async () => {
          setBusy('work');
          try {
            const res = await invoicesApi.createDocumentFrom(org, invoice.id as string, targetType, partial, userId, user?.fullname);
            const ok = res?.success ?? res?.Success;
            const newId = res?.message ?? res?.Message;
            if (!ok || !newId) throw new Error(res?.error || (typeof newId === 'string' && newId) || 'יצירת המסמך נכשלה');
            onChanged();
            router.push({ pathname: '/(tabs)/more/invoices/[id]', params: { id: String(newId) } } as any);
          } catch (e: any) {
            Alert.alert('שגיאה', e?.message || 'יצירת המסמך נכשלה');
          } finally {
            setBusy(null);
          }
        },
      },
    ]);
  }, [invoice, org, user, userId, onChanged, router]);

  const duplicate = useCallback(async () => {
    setBusy('work');
    try {
      let full: any = invoice;
      try { full = { ...invoice, ...((await invoicesApi.getById(org, invoice.id as string)) || {}) }; } catch { /* use the row */ }
      const data: any = { ...full };
      DUPLICATE_DROP.forEach((k) => { delete data[k]; });
      data.status = 'draft';
      data.date = new Date().toISOString().split('T')[0];
      const res = await invoicesApi.create(org, data, userId, user?.fullname);
      const newId = res?.invoice?.id || res?.id || res?.invoiceId || (res?.success ?? res?.Success ? (res?.message ?? res?.Message) : undefined);
      if (!newId) throw new Error(res?.message || res?.Message || 'שכפול המסמך נכשל');
      onChanged();
      router.push({ pathname: '/(tabs)/more/invoices/[id]', params: { id: String(newId) } } as any);
    } catch (e: any) {
      Alert.alert('שגיאה', e?.message || 'שכפול המסמך נכשל');
    } finally {
      setBusy(null);
    }
  }, [invoice, org, user, userId, onChanged, router]);

  const remove = useCallback(() => {
    Alert.alert('מחיקת טיוטה', `למחוק את ${docLabel}?`, [
      { text: 'ביטול', style: 'cancel' },
      {
        text: 'מחק',
        style: 'destructive',
        onPress: async () => {
          try {
            await invoicesApi.delete(org, invoice.id as string);
            onChanged();
          } catch (e: any) {
            Alert.alert('שגיאה', e?.message || 'המחיקה נכשלה');
          }
        },
      },
    ]);
  }, [org, invoice, docLabel, onChanged]);

  const item = (title: string, icon: string, run: () => void, opts?: { destructive?: boolean; divider?: boolean }) => (
    <React.Fragment key={title}>
      {opts?.divider ? <Divider /> : null}
      <Menu.Item
        leadingIcon={icon}
        title={title}
        titleStyle={opts?.destructive ? { color: theme.colors.error } : undefined}
        onPress={() => { setMenuVisible(false); setTimeout(run, 60); }}
      />
    </React.Fragment>
  );

  const derived = issued
    ? (BULK_DERIVE[invoice.type] || []).filter((d) => d.targetType !== 'receipt' || getOpenBalance(invoice) > 0)
    : [];
  const singular: Record<string, string> = {
    receipt: 'הפק קבלה',
    combined: 'הפק חשבונית מס קבלה',
    tax_invoice: 'הפק חשבונית מס',
  };

  return (
    <View style={styles.row}>
      <Pressable onPress={send} disabled={busy === 'send'} hitSlop={8} style={[styles.btn, { backgroundColor: '#25D36622', opacity: issued ? 1 : 0.4 }]}>
        {busy === 'send'
          ? <ActivityIndicator size="small" color="#16a34a" />
          : <MaterialCommunityIcons name="whatsapp" size={20} color="#16a34a" />}
      </Pressable>
      <Menu
        visible={menuVisible}
        onDismiss={() => setMenuVisible(false)}
        anchor={
          <Pressable onPress={() => setMenuVisible(true)} hitSlop={8} style={styles.btn}>
            {busy === 'work'
              ? <ActivityIndicator size="small" color={theme.colors.onSurfaceVariant} />
              : <MaterialCommunityIcons name="dots-vertical" size={22} color={theme.colors.onSurfaceVariant} />}
          </Pressable>
        }
        contentStyle={{ backgroundColor: theme.colors.surface }}
      >
        {item('הורד PDF', 'file-pdf-box', downloadPdf)}
        {issued ? item('העתק קישור לשליחה', 'link-variant', copyLink) : null}
        {isDraft ? item('הפק', 'check-decagram-outline', issue) : null}
        {derived.map((d) => item(singular[d.targetType] || d.label, d.icon, () => derive(d.targetType, singular[d.targetType] || d.label)))}
        {item('שכפל', 'content-copy', duplicate)}
        {isDraft ? item('מחק טיוטה', 'delete-outline', remove, { destructive: true, divider: true }) : null}
      </Menu>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  btn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
});

export default InvoiceRowActions;
