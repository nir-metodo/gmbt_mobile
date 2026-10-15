import React from 'react';
import { View, StyleSheet, ScrollView, Image } from 'react-native';
import { Text, Portal, Modal, IconButton } from 'react-native-paper';
import { useRTL } from '../hooks/useRTL';
import { DOCUMENT_TYPES, INVOICE_STATUSES, type InvoiceItem } from '../services/api/invoices';
import { formatDate, formatCurrency } from '../utils/formatters';
import { currencySymbol } from '../utils/currency';

export interface InvoicePreviewDoc {
  type: string;
  status?: string;
  documentNumber?: string;
  date?: string;
  dueDate?: string;
  currency?: string;
  vatRate?: number;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  contactCompany?: string;
  items: InvoiceItem[];
  subtotal?: number;
  discountAmount?: number;
  vatAmount?: number;
  total?: number;
  notes?: string;
  allocationNumber?: string;
  isDraft?: boolean;
}

interface Props {
  visible: boolean;
  onDismiss: () => void;
  doc: InvoicePreviewDoc;
  /** Result of GetInvoiceBranding (companyName, logo, primaryColor, taxId, bank*, footerText …). */
  branding?: any;
}

const INK = '#1f2937';
const MUTED = '#6b7280';
const LINE = '#e5e7eb';

/** A paper-like tax invoice: company banner, customer + details, items table, totals, notes, bank details. */
export function InvoicePreviewModal({ visible, onDismiss, doc, branding }: Props) {
  const { flexDirection, textAlign, isRTL } = useRTL();
  const b = branding || {};
  const typeInfo = DOCUMENT_TYPES.find((d) => d.key === doc.type);
  const color: string = b.primaryColor || typeInfo?.color || '#2e6155';
  const isCredit = doc.type === 'credit_invoice' || doc.type === 'credit_receipt';
  const sym = currencySymbol(doc.currency);
  const money = (n: number | undefined | null) => formatCurrency(Number(n || 0), sym);
  const statusInfo = INVOICE_STATUSES.find((s) => s.key === doc.status);
  const lineTotal = (it: InvoiceItem) => (it.unitPrice || 0) * (it.quantity || 0);
  const discount = Number(doc.discountAmount || 0);
  const detailRows: { label: string; value?: string }[] = [
    { label: 'תאריך', value: doc.date ? formatDate(doc.date) : undefined },
    { label: 'פירעון', value: doc.dueDate ? formatDate(doc.dueDate) : undefined },
    { label: 'מספר הקצאה', value: doc.allocationNumber },
  ];
  const customerRows: string[] = [doc.contactName, doc.contactCompany, doc.contactPhone, doc.contactEmail].filter(Boolean) as string[];
  const bankLines: string[] = [
    b.bankName ? `בנק: ${b.bankName}${b.bankBranch ? ` · סניף ${b.bankBranch}` : ''}` : '',
    b.bankAccount ? `חשבון: ${b.bankAccount}` : '',
    b.bankAccountHolder ? `על שם: ${b.bankAccountHolder}` : '',
  ].filter(Boolean);

  return (
    <Portal>
      <Modal visible={visible} onDismiss={onDismiss} contentContainerStyle={styles.modal}>
        <View style={[styles.header, { flexDirection }]}>
          <Text style={styles.headerTitle}>תצוגה מקדימה</Text>
          <IconButton icon="close" size={22} onPress={onDismiss} style={{ margin: 0 }} />
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.paper}>
          {/* Company banner */}
          <View style={[styles.banner, { backgroundColor: color, flexDirection }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.companyName, { textAlign }]} numberOfLines={2}>{b.companyName || 'העסק שלי'}</Text>
              {b.slogan ? <Text style={[styles.bannerSub, { textAlign, fontStyle: 'italic' }]}>{b.slogan}</Text> : null}
              {b.companyAddress ? <Text style={[styles.bannerSub, { textAlign }]}>{b.companyAddress}</Text> : null}
              {b.companyPhone ? <Text style={[styles.bannerSub, { textAlign }]}>📞 {b.companyPhone}</Text> : null}
              {b.companyEmail ? <Text style={[styles.bannerSub, { textAlign }]}>✉️ {b.companyEmail}</Text> : null}
              {b.taxId ? <Text style={[styles.bannerSub, { textAlign }]}>ע.מ / ח.פ {b.taxId}</Text> : null}
            </View>
            {b.logo ? (
              <View style={styles.logoBox}>
                <Image source={{ uri: b.logo }} style={styles.logo} resizeMode="contain" />
              </View>
            ) : null}
          </View>

          {/* Title */}
          <View style={styles.titleRow}>
            <Text style={[styles.docTitle, { color }]}>{typeInfo?.labelHe || doc.type}</Text>
            {doc.documentNumber ? <Text style={styles.docNumber}>מס׳ {doc.documentNumber}</Text> : null}
            {doc.isDraft ? <Text style={styles.draftTag}>טיוטה — טרם הופקה</Text> : null}
            {isCredit ? <Text style={styles.creditNote}>מסמך זיכוי — הסכומים מופחתים מהחשבונית המקורית</Text> : null}
          </View>

          {/* Customer + details */}
          <View style={[styles.infoGrid, { flexDirection }]}>
            <View style={[styles.infoBox, { borderColor: `${color}33`, backgroundColor: `${color}0d` }]}>
              <Text style={[styles.infoHeading, { color, textAlign }]}>לכבוד</Text>
              {customerRows.length > 0 ? customerRows.map((r, i) => (
                <Text key={i} style={[i === 0 ? styles.infoStrong : styles.infoText, { textAlign }]}>{r}</Text>
              )) : <Text style={[styles.infoText, { textAlign }]}>—</Text>}
            </View>
            <View style={[styles.infoBox, { borderColor: `${color}33`, backgroundColor: `${color}0d` }]}>
              <Text style={[styles.infoHeading, { color, textAlign }]}>פרטי המסמך</Text>
              {detailRows.filter((r) => !!r.value).map((r) => (
                <View key={r.label} style={{ flexDirection, justifyContent: 'space-between', gap: 8 }}>
                  <Text style={styles.infoText}>{r.label}</Text>
                  <Text style={styles.infoStrong}>{r.value}</Text>
                </View>
              ))}
              {statusInfo ? (
                <View style={[styles.statusPill, { backgroundColor: `${statusInfo.color}22`, alignSelf: isRTL ? 'flex-end' : 'flex-start' }]}>
                  <Text style={{ color: statusInfo.color, fontWeight: '700', fontSize: 11 }}>{statusInfo.labelHe}</Text>
                </View>
              ) : null}
            </View>
          </View>

          {/* Items table */}
          <View style={styles.table}>
            <View style={[styles.tr, styles.thRow, { backgroundColor: color, flexDirection }]}>
              <Text style={[styles.th, { flex: 4, textAlign }]}>תיאור</Text>
              <Text style={[styles.th, { flex: 1, textAlign: 'center' }]}>כמות</Text>
              <Text style={[styles.th, { flex: 2, textAlign: isRTL ? 'left' : 'right' }]}>סה״כ</Text>
            </View>
            {(doc.items || []).filter((it) => (it.description || '').trim() || lineTotal(it) !== 0).map((it, i) => (
              <View key={i} style={[styles.tr, { flexDirection, backgroundColor: i % 2 ? '#f9fafb' : '#fff' }]}>
                <View style={{ flex: 4 }}>
                  <Text style={[styles.td, { textAlign }]}>{it.description || '—'}</Text>
                  <Text style={[styles.tdSub, { textAlign }]}>{money(it.unitPrice)} ליחידה</Text>
                </View>
                <Text style={[styles.td, { flex: 1, textAlign: 'center' }]}>{it.quantity}</Text>
                <Text style={[styles.td, { flex: 2, textAlign: isRTL ? 'left' : 'right', fontWeight: '700' }]}>{money(lineTotal(it))}</Text>
              </View>
            ))}
          </View>

          {/* Totals */}
          <View style={styles.totals}>
            <View style={[styles.totalRow, { flexDirection }]}>
              <Text style={styles.totalLabel}>סכום ביניים</Text>
              <Text style={styles.totalValue}>{money(doc.subtotal)}</Text>
            </View>
            {discount > 0 ? (
              <View style={[styles.totalRow, { flexDirection }]}>
                <Text style={[styles.totalLabel, { color: '#dc2626' }]}>הנחה</Text>
                <Text style={[styles.totalValue, { color: '#dc2626' }]}>-{money(discount)}</Text>
              </View>
            ) : null}
            <View style={[styles.totalRow, { flexDirection }]}>
              <Text style={styles.totalLabel}>מע״מ ({doc.vatRate ?? 18}%)</Text>
              <Text style={styles.totalValue}>{money(doc.vatAmount)}</Text>
            </View>
            <View style={[styles.grandRow, { flexDirection, borderTopColor: color }]}>
              <Text style={[styles.grandLabel, { color }]}>סה״כ לתשלום</Text>
              <Text style={[styles.grandValue, { color }]}>{isCredit ? '-' : ''}{money(doc.total)}</Text>
            </View>
          </View>

          {doc.notes ? (
            <View style={styles.notes}>
              <Text style={[styles.infoHeading, { color, textAlign }]}>הערות</Text>
              <Text style={[styles.infoText, { textAlign, lineHeight: 20 }]}>{doc.notes}</Text>
            </View>
          ) : null}

          {bankLines.length > 0 && !isCredit ? (
            <View style={styles.notes}>
              <Text style={[styles.infoHeading, { color, textAlign }]}>פרטי תשלום</Text>
              {bankLines.map((l, i) => <Text key={i} style={[styles.infoText, { textAlign }]}>{l}</Text>)}
            </View>
          ) : null}

          {b.footerText ? <Text style={styles.footer}>{b.footerText}</Text> : null}
        </ScrollView>
      </Modal>
    </Portal>
  );
}

const styles = StyleSheet.create({
  modal: { backgroundColor: '#f3f4f6', margin: 12, borderRadius: 16, maxHeight: '92%', overflow: 'hidden' },
  header: { alignItems: 'center', justifyContent: 'space-between', paddingLeft: 16, paddingRight: 6, paddingVertical: 4, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: LINE },
  headerTitle: { fontSize: 15, fontWeight: '700', color: INK },
  paper: { padding: 12, paddingBottom: 24, gap: 12 },
  banner: { borderRadius: 14, padding: 16, gap: 12, alignItems: 'center' },
  companyName: { color: '#fff', fontSize: 20, fontWeight: '800' },
  bannerSub: { color: 'rgba(255,255,255,0.9)', fontSize: 12, marginTop: 2 },
  logoBox: { backgroundColor: '#fff', borderRadius: 10, padding: 4 },
  logo: { width: 64, height: 48 },
  titleRow: { alignItems: 'center', gap: 2, paddingVertical: 4 },
  docTitle: { fontSize: 22, fontWeight: '800' },
  docNumber: { fontSize: 14, color: MUTED, fontWeight: '600' },
  draftTag: { marginTop: 4, fontSize: 11, fontWeight: '700', color: '#92400e', backgroundColor: '#fef3c7', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10, overflow: 'hidden' },
  creditNote: { marginTop: 4, fontSize: 11, color: '#b91c1c', textAlign: 'center' },
  infoGrid: { gap: 10 },
  infoBox: { flex: 1, borderWidth: 1, borderRadius: 12, padding: 12, gap: 3 },
  infoHeading: { fontSize: 12, fontWeight: '800', marginBottom: 4 },
  infoStrong: { fontSize: 13, fontWeight: '700', color: INK },
  infoText: { fontSize: 12, color: MUTED },
  statusPill: { marginTop: 6, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10 },
  table: { backgroundColor: '#fff', borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: LINE },
  tr: { paddingHorizontal: 10, paddingVertical: 9, alignItems: 'center', gap: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: LINE },
  thRow: { paddingVertical: 8, borderBottomWidth: 0 },
  th: { color: '#fff', fontSize: 12, fontWeight: '700' },
  td: { fontSize: 13, color: INK },
  tdSub: { fontSize: 10, color: MUTED, marginTop: 1 },
  totals: { backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: LINE, padding: 12, gap: 6 },
  totalRow: { justifyContent: 'space-between' },
  totalLabel: { fontSize: 13, color: MUTED },
  totalValue: { fontSize: 13, color: INK, fontWeight: '600' },
  grandRow: { justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 2, paddingTop: 8, marginTop: 4 },
  grandLabel: { fontSize: 15, fontWeight: '800' },
  grandValue: { fontSize: 20, fontWeight: '800' },
  notes: { backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: LINE, padding: 12, gap: 2 },
  footer: { textAlign: 'center', fontSize: 11, color: MUTED, marginTop: 4 },
});
