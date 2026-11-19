import { chatsApi } from './api/chats';
import { quotesApi } from './api/quotes';
import { resolveFromNumberId } from './whatsappDocSender';
import { formatCurrency } from '../utils/formatters';
import { currencySymbol } from '../utils/currency';
import type { Quote } from '../types';

/**
 * Sends one quote to its customer through Gambot WhatsApp — the same flow as the quote screen's "send on WhatsApp":
 * window open → regular message with the link; closed → the org's default "sendQuote" WABA template.
 * A draft is marked "sent". Throws an Error with a readable (Hebrew) message when it cannot be sent.
 */
export async function sendQuoteViaGambot(user: any, quote: Quote): Promise<'regular' | 'template'> {
  const org = user?.organization;
  const phone = quote.phoneNumber || quote.contactPhone;
  if (!org) throw new Error('חסר ארגון');
  if (!phone) throw new Error('אין מספר טלפון ללקוח');

  const publicUrl = `https://www.gambot.co.il/quote?org=${encodeURIComponent(org)}&id=${encodeURIComponent(quote.id || '')}`;
  const fromNumberId = await resolveFromNumberId(user, org, phone);

  let isLive = false;
  try {
    const expStr = await chatsApi.getConversationExpiration(org, phone, fromNumberId || undefined);
    if (expStr) {
      const exp = new Date(expStr);
      isLive = !isNaN(exp.getTime()) && exp > new Date();
    }
  } catch { /* treat as closed */ }

  let mode: 'regular' | 'template';
  if (isLive) {
    const text = `שלום ${quote.contactName || ''},\nהצעת המחיר "${quote.title}" מוכנה עבורך 📄\nמספר הצעה: ${quote.quoteNumber || ''}\nסה"כ: ${formatCurrency(quote.total || 0, currencySymbol(quote.currency))}\n\n${publicUrl}`;
    await chatsApi.sendMessage(
      org, phone, text, user.fullname, user.uID || user.userId,
      undefined, user.wabaNumber || undefined, user.email || undefined, fromNumberId || undefined,
    );
    mode = 'regular';
  } else {
    const defRes = await chatsApi.getDefaultMessageTemplates(org);
    const assignment = defRes?.Data?.templates?.sendQuote;
    const templateId = Array.isArray(assignment?.templateId) ? (assignment.templateId[0] || '') : (assignment?.templateId || '');
    if (!templateId) throw new Error('השיחה סגורה ואין תבנית ברירת מחדל לשליחת הצעת מחיר');
    const entry = (idx: number, val: string, label: string) => ({
      index: idx, bodyVarIndex: idx, Variable: `dynamic_var${idx}`,
      variableLabel: label, dataSource1: 'data_source1_HardCoded', dataSource2: '',
      conditionOperator: '', parameters_hardCoded_Text: val,
      field1: [], field2: [], table1: '', table2: '', retrieveFields: [],
    });
    await chatsApi.sendTemplateMessage(
      org, phone, templateId, user.uID || user.userId,
      [entry(1, quote.contactName || '', 'שם לקוח'), entry(2, quote.title || '', 'כותרת הצעת מחיר')],
      fromNumberId || undefined,
    );
    mode = 'template';
  }

  if (quote.status === 'draft') {
    await quotesApi.update(org, { id: quote.id, status: 'sent' }, user.uID || user.userId, user.fullname).catch(() => {});
  }
  return mode;
}
