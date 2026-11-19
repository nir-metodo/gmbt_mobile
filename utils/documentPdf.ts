import { Linking } from 'react-native';
import axiosInstance from '../services/api/axiosInstance';
import { DOCUMENT_TYPES, INVOICE_STATUSES, type Invoice } from '../services/api/invoices';
import { formatDate, formatCurrency } from './formatters';
import { currencySymbol } from './currency';

/**
 * "Download PDF" for invoices / quotes. The phone builds a simple printable HTML of the document (same content as the
 * on-screen preview) and the server turns it into a PDF (the same HTML→PDF service the document templates use), then
 * the file opens in the viewer where it can be saved or shared. Several documents → ONE PDF, one document per page.
 */

const esc = (v: any) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '<br/>');

const NB = 'border:none;';
const INK = '#1f2937';
const MUTED = '#6b7280';
const LINE = '#e5e7eb';

interface PdfItem {
  description: string;
  sub?: string;
  quantity: number | string;
  unitPrice: number;
  total: number;
}

interface PdfDoc {
  title: string; // "חשבונית מס" / "הצעת מחיר"
  number?: string;
  subtitle?: string;
  statusLabel?: string;
  details: { label: string; value?: string }[];
  customer: string[];
  items: PdfItem[];
  totals: { label: string; value: string; color?: string; strong?: boolean }[];
  grand: { label: string; value: string };
  notes?: string;
  extraBlocks?: { heading: string; lines: string[] }[];
  isCredit?: boolean;
  /** hex colour of the banner / headings */
  color: string;
}

function companyBanner(b: any, color: string): string {
  const lines = [
    b.slogan ? `<div style="font-size:12px;font-style:italic;">${esc(b.slogan)}</div>` : '',
    b.companyAddress ? `<div style="font-size:12px;">${esc(b.companyAddress)}</div>` : '',
    b.companyPhone ? `<div style="font-size:12px;">${esc(b.companyPhone)}</div>` : '',
    b.companyEmail ? `<div style="font-size:12px;">${esc(b.companyEmail)}</div>` : '',
    b.taxId ? `<div style="font-size:12px;">ע.מ / ח.פ ${esc(b.taxId)}</div>` : '',
  ].join('');
  const logo = typeof b.logo === 'string' && /^https?:/i.test(b.logo)
    ? `<td style="${NB}width:90px;text-align:left;padding:10px;"><img src="${esc(b.logo)}" style="max-width:80px;max-height:60px;" /></td>`
    : '';
  return `<table style="width:100%;background-color:${color};color:#ffffff;"><tr>
    <td style="${NB}padding:14px;text-align:right;"><div style="font-size:22px;font-weight:bold;">${esc(b.companyName || 'העסק שלי')}</div>${lines}</td>${logo}
  </tr></table>`;
}

function renderDoc(d: PdfDoc, b: any): string {
  const box = (heading: string, rows: string) =>
    `<td style="border:1px solid ${LINE};vertical-align:top;padding:10px;text-align:right;width:50%;"><div style="font-weight:bold;color:${d.color};font-size:12px;margin-bottom:4px;">${heading}</div>${rows}</td>`;
  const customer = d.customer.length
    ? d.customer.map((r, i) => `<div style="font-size:${i === 0 ? 14 : 12}px;${i === 0 ? 'font-weight:bold;' : `color:${MUTED};`}">${esc(r)}</div>`).join('')
    : '—';
  const details = d.details
    .filter((r) => r.value)
    .map((r) => `<div style="font-size:12px;"><span style="color:${MUTED};">${esc(r.label)}:</span> <b>${esc(r.value)}</b></div>`)
    .join('') + (d.statusLabel ? `<div style="font-size:12px;color:${MUTED};">${esc(d.statusLabel)}</div>` : '');

  const rows = d.items
    .map(
      (it, i) => `<tr style="background-color:${i % 2 ? '#f9fafb' : '#ffffff'};">
      <td style="text-align:right;">${esc(it.description || '—')}${it.sub ? `<div style="font-size:10px;color:${MUTED};">${esc(it.sub)}</div>` : ''}</td>
      <td style="text-align:center;">${esc(it.quantity)}</td>
      <td style="text-align:left;">${esc(formatNum(it.unitPrice, b._sym))}</td>
      <td style="text-align:left;font-weight:bold;">${esc(formatNum(it.total, b._sym))}</td></tr>`,
    )
    .join('');

  const totals = d.totals
    .map(
      (t) => `<tr><td style="${NB}text-align:right;color:${t.color || MUTED};">${esc(t.label)}</td><td style="${NB}text-align:left;color:${t.color || INK};font-weight:${t.strong ? 'bold' : 'normal'};">${esc(t.value)}</td></tr>`,
    )
    .join('');

  const blocks = [
    d.notes ? { heading: 'הערות', lines: [d.notes] } : null,
    ...(d.extraBlocks || []),
  ]
    .filter(Boolean)
    .map(
      (blk: any) => `<div style="border:1px solid ${LINE};padding:10px;margin-top:10px;text-align:right;"><div style="font-weight:bold;color:${d.color};font-size:12px;margin-bottom:3px;">${esc(blk.heading)}</div>${blk.lines
        .map((l: string) => `<div style="font-size:12px;color:${INK};">${esc(l)}</div>`)
        .join('')}</div>`,
    )
    .join('');

  return `<div style="direction:rtl;text-align:right;font-family:Arial,sans-serif;color:${INK};">
    ${companyBanner(b, d.color)}
    <div style="text-align:center;margin:14px 0 10px 0;">
      <div style="font-size:24px;font-weight:bold;color:${d.color};">${esc(d.title)}</div>
      ${d.number ? `<div style="font-size:14px;color:${MUTED};">מס׳ ${esc(d.number)}</div>` : ''}
      ${d.subtitle ? `<div style="font-size:13px;color:${MUTED};">${esc(d.subtitle)}</div>` : ''}
      ${d.isCredit ? `<div style="font-size:11px;color:#b91c1c;">מסמך זיכוי — הסכומים מופחתים מהמסמך המקורי</div>` : ''}
    </div>
    <table style="width:100%;"><tr>${box('לכבוד', customer)}${box('פרטי המסמך', details)}</tr></table>
    <table style="width:100%;margin-top:12px;">
      <tr style="background-color:${d.color};color:#ffffff;"><th style="text-align:right;color:#ffffff;">תיאור</th><th style="color:#ffffff;">כמות</th><th style="text-align:left;color:#ffffff;">מחיר ליחידה</th><th style="text-align:left;color:#ffffff;">סה״כ</th></tr>
      ${rows}
    </table>
    <table style="width:45%;margin-top:12px;margin-right:0;margin-left:auto;float:left;">${totals}
      <tr><td style="${NB}border-top:2px solid ${d.color};text-align:right;color:${d.color};font-weight:bold;font-size:15px;">${esc(d.grand.label)}</td><td style="${NB}border-top:2px solid ${d.color};text-align:left;color:${d.color};font-weight:bold;font-size:16px;">${esc(d.grand.value)}</td></tr>
    </table>
    <div style="clear:both;"></div>
    ${blocks}
    ${b.footerText ? `<div style="text-align:center;font-size:11px;color:${MUTED};margin-top:16px;">${esc(b.footerText)}</div>` : ''}
  </div>`;
}

const formatNum = (n: number, sym: string) => formatCurrency(Number(n || 0), sym);

// ── Invoice ────────────────────────────────────────────────────────────────────────────────────────
export function invoiceToPdfDoc(inv: Invoice, branding: any): { doc: PdfDoc; branding: any } {
  const b = { ...(branding || {}), _sym: currencySymbol(inv.currency) };
  const sym = b._sym;
  const typeInfo = DOCUMENT_TYPES.find((x) => x.key === inv.type);
  const isCredit = inv.type === 'credit_invoice' || inv.type === 'credit_receipt';
  const discount = Number((inv as any).discountAmount || 0);
  const totals = [{ label: 'סכום ביניים', value: formatNum(inv.subtotal || 0, sym) }] as PdfDoc['totals'];
  if (discount > 0) totals.push({ label: 'הנחה', value: `-${formatNum(discount, sym)}`, color: '#dc2626' });
  totals.push({ label: `מע״מ (${inv.vatRate ?? 18}%)`, value: formatNum(inv.vatAmount || 0, sym) });
  const bankLines = [
    b.bankName ? `בנק: ${b.bankName}${b.bankBranch ? ` · סניף ${b.bankBranch}` : ''}` : '',
    b.bankAccount ? `חשבון: ${b.bankAccount}` : '',
    b.bankAccountHolder ? `על שם: ${b.bankAccountHolder}` : '',
  ].filter(Boolean);
  return {
    branding: b,
    doc: {
      title: typeInfo?.labelHe || inv.type,
      number: inv.documentNumber,
      statusLabel: INVOICE_STATUSES.find((s) => s.key === inv.status)?.labelHe,
      details: [
        { label: 'תאריך', value: inv.date ? formatDate(inv.date) : undefined },
        { label: 'פירעון', value: inv.dueDate ? formatDate(inv.dueDate) : undefined },
        { label: 'מספר הקצאה', value: inv.allocationNumber },
      ],
      customer: [inv.contactName, inv.contactCompany, inv.contactPhone, inv.contactEmail].filter(Boolean) as string[],
      items: (inv.items || [])
        .filter((it) => (it.description || '').trim() || (it.unitPrice || 0) * (it.quantity || 0) !== 0)
        .map((it) => ({ description: it.description, quantity: it.quantity, unitPrice: it.unitPrice, total: (it.unitPrice || 0) * (it.quantity || 0) })),
      totals,
      grand: { label: 'סה״כ לתשלום', value: `${isCredit ? '-' : ''}${formatNum(inv.total || 0, sym)}` },
      notes: inv.notes,
      extraBlocks: bankLines.length && !isCredit ? [{ heading: 'פרטי תשלום', lines: bankLines }] : [],
      isCredit,
      color: b.primaryColor || '#2e6155',
    },
  };
}

export function buildInvoiceHtml(inv: Invoice, branding: any): string {
  const { doc, branding: b } = invoiceToPdfDoc(inv, branding);
  return renderDoc(doc, b);
}

// ── Quote ──────────────────────────────────────────────────────────────────────────────────────────
export function buildQuoteHtml(q: any, branding: any): string {
  const sym = currencySymbol(q.currency);
  const b = { ...(branding || {}), _sym: sym };
  const totals: PdfDoc['totals'] = [{ label: 'סכום ביניים', value: formatNum(q.subtotal || 0, sym) }];
  if ((q.discountAmount || 0) > 0) totals.push({ label: 'הנחה', value: `-${formatNum(q.discountAmount, sym)}`, color: '#16a34a' });
  if ((q.taxAmount || 0) > 0) totals.push({ label: `מע״מ (${q.tax || 0}%)`, value: formatNum(q.taxAmount, sym) });
  const extra: { heading: string; lines: string[] }[] = [];
  if (q.terms) extra.push({ heading: 'תנאים', lines: [q.terms] });
  const ship = q.showShipping && q.shipping ? q.shipping : null;
  if (ship && (ship.address || ship.city || ship.notes)) {
    extra.push({
      heading: 'פרטי משלוח',
      lines: [[ship.address, ship.city].filter(Boolean).join(', '), ship.floor ? `קומה: ${ship.floor}${ship.elevator ? ' (מעלית זמינה)' : ''}` : '', ship.notes || ''].filter(Boolean),
    });
  }
  const bank = q.showBankDetails && q.bankDetails ? q.bankDetails : null;
  if (bank && (bank.bankName || bank.accountNumber)) {
    extra.push({
      heading: 'פרטי בנק לתשלום',
      lines: [
        bank.bankName ? `בנק: ${bank.bankName}` : '',
        bank.branchNumber ? `סניף: ${bank.branchNumber}` : '',
        bank.accountNumber ? `חשבון: ${bank.accountNumber}` : '',
        bank.accountName ? `על שם: ${bank.accountName}` : '',
      ].filter(Boolean),
    });
  }
  const doc: PdfDoc = {
    title: 'הצעת מחיר',
    number: q.quoteNumber,
    subtitle: q.title,
    details: [
      { label: 'תאריך', value: formatDate(q.createdOn || q.createdAt || '') || undefined },
      { label: 'בתוקף עד', value: q.validUntil ? formatDate(q.validUntil) : undefined },
    ],
    customer: [q.contactName, q.contactPhone, q.contactEmail].filter(Boolean),
    items: (q.items || [])
      .filter((it: any) => String(it.name || it.description || '').trim())
      .map((it: any) => ({
        description: it.name || it.description,
        sub: it.name && it.description ? it.description : undefined,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        total: it.total || (it.quantity || 0) * (it.unitPrice || 0),
      })),
    totals,
    grand: { label: 'סה״כ לתשלום', value: formatNum(q.total || 0, sym) },
    notes: q.notes,
    extraBlocks: extra,
    color: b.primaryColor || '#2e6155',
  };
  return renderDoc(doc, b);
}

// ── Render + open ──────────────────────────────────────────────────────────────────────────────────
export const joinDocuments = (htmls: string[]) => htmls.join('<div style="page-break-after:always;"></div>');

/** HTML → PDF on the server, returns the file URL. Throws with a readable message on failure. */
export async function renderPdfUrl(organization: string, html: string, name: string): Promise<string> {
  const res = await axiosInstance.post('/api/Webhooks/DocTemplates_RenderHtmlToPdf', {
    organization,
    htmlContent: html,
    name,
  });
  const url = res.data?.fileUrl;
  if (!res.data?.success || !url) throw new Error(res.data?.error || 'יצירת ה-PDF נכשלה');
  return url;
}

/** Builds the PDF and opens it (the viewer offers save / share). */
export async function openPdf(organization: string, html: string, name: string): Promise<void> {
  const url = await renderPdfUrl(organization, html, name);
  await Linking.openURL(url);
}
