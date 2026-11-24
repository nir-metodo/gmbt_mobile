import { chatsApi } from './api/chats';
import axiosInstance from './api/axiosInstance';
import { defaultSenderNumberId, pickSenderNumberId } from '../utils/wabaNumbers';
import type { WabaNumberInfo } from '../types';
import { withSharer } from '../utils/esignatureLink';

/**
 * "Send via WhatsApp" for business documents — always THROUGH Gambot (never the phone's own WhatsApp),
 * so the message lands in the customer's chat:
 *   • 24h conversation window OPEN   → a regular free-text message (with the link).
 *   • window CLOSED                  → the org's default WABA template for that role
 *                                      (Settings → default templates; created automatically with the account).
 * Same rule the web uses for quotes and payment links.
 *
 * Multi-number orgs: the 24h window belongs to a SPECIFIC connected number, so the number the conversation happened on
 * is resolved first and both the window check and the send use it (a document never leaves from a number the customer never wrote to).
 */
/** 'sendForm' is the ONE generic "send a link" template (form / fill-in document / catalog / file). */
export type DocTemplateRole = 'sendInvoice' | 'sendPaymentLink' | 'digitalSignature' | 'sendForm';

export type SendDocResult = 'regular' | 'template';

/** Thrown when the window is closed and the org has no template assigned for the role. */
export class MissingDefaultTemplateError extends Error {
  role: DocTemplateRole;
  constructor(role: DocTemplateRole) {
    super('MISSING_DEFAULT_TEMPLATE');
    this.name = 'MissingDefaultTemplateError';
    this.role = role;
  }
}

/** The default template was just created automatically and is waiting for Meta's approval. */
/** The default template was just created automatically and is waiting for Meta's approval (still "no usable template" for callers). */
export class DefaultTemplatePendingError extends MissingDefaultTemplateError {
  constructor(role: DocTemplateRole) {
    super(role);
    this.name = 'DefaultTemplatePendingError';
    this.message = 'DEFAULT_TEMPLATE_PENDING_APPROVAL';
  }
}

interface SenderUser {
  uID?: string | null;
  userId?: string | null;
  fullname?: string | null;
  wabaNumber?: string | null;
  email?: string | null;
  wabaNumbers?: WabaNumberInfo[];
  assignedWhatsAppNumbers?: string[];
}

export interface SendDocParams {
  organization: string;
  phone: string;
  role: DocTemplateRole;
  user: SenderUser;
  customerName?: string;
  /** Template body variable {{2}} — what the document is, e.g. "חשבונית מס #1001". */
  docLabel: string;
  /** The link the customer opens (template URL button / appended to the free text). */
  url: string;
  /** Free text used when the window is open. The link is appended automatically. */
  liveText: string;
  /** Send the default TEMPLATE even when the 24h window is open ("send as template"). */
  forceTemplate?: boolean;
}

const entry = (idx: number, val: string, label: string, variable?: string) => ({
  index: idx,
  bodyVarIndex: idx,
  Variable: variable || `dynamic_var${idx}`,
  variableLabel: label,
  dataSource1: 'data_source1_HardCoded',
  dataSource2: '',
  conditionOperator: '',
  parameters_hardCoded_Text: val,
  field1: [],
  field2: [],
  table1: '',
  table2: '',
  retrieveFields: [],
});

async function isConversationOpen(organization: string, phone: string, fromNumberId?: string): Promise<boolean> {
  try {
    const exp = await chatsApi.getConversationExpiration(organization, phone, fromNumberId);
    if (!exp) return false;
    const d = new Date(exp);
    return !isNaN(d.getTime()) && d > new Date();
  } catch {
    return false; // can't tell → treat as closed (a template is always deliverable)
  }
}

/** '' for single-number orgs (the backend uses the only number); otherwise the number this contact talks to. */
export async function resolveFromNumberId(user: SenderUser, organization: string, phone: string): Promise<string> {
  const numbers = user.wabaNumbers || [];
  if (numbers.length <= 1) return '';
  const assigned = user.assignedWhatsAppNumbers || [];
  let messages: any[] = [];
  try {
    messages = await chatsApi.getMessages(organization, phone, 60);
  } catch { /* no history → default number below */ }
  return pickSenderNumberId(messages, numbers, assigned) || defaultSenderNumberId(numbers, assigned);
}

export async function sendDocumentViaGambot(params: SendDocParams): Promise<SendDocResult> {
  // Signature requests carry the sender (?by=) so the person who sent it is notified when the customer signs —
  // in both the free-text message and the template's URL button.
  const p: SendDocParams = params.role === 'digitalSignature' ? { ...params, url: withSharer(params.url, params.user) } : params;
  const userId = p.user.uID || p.user.userId;
  const fromNumberId = await resolveFromNumberId(p.user, p.organization, p.phone);

  if (!p.forceTemplate && (await isConversationOpen(p.organization, p.phone, fromNumberId))) {
    await chatsApi.sendMessage(
      p.organization,
      p.phone,
      `${p.liveText}\n\n${p.url}`,
      p.user.fullname || undefined,
      userId || undefined,
      undefined,
      p.user.wabaNumber || undefined,
      p.user.email || undefined,
      fromNumberId || undefined,
    );
    return 'regular';
  }

  const readTemplateId = async (): Promise<string> => {
    const defRes = await chatsApi.getDefaultMessageTemplates(p.organization);
    const assignment = defRes?.Data?.templates?.[p.role];
    return Array.isArray(assignment?.templateId) ? assignment.templateId[0] || '' : assignment?.templateId || '';
  };
  let templateId = await readTemplateId();
  if (!templateId) {
    // Older orgs were never seeded with the default templates. Create them now (idempotent, only the missing roles) so a
    // closed conversation no longer dead-ends — Meta must approve a new template before it can be delivered.
    let created = false;
    try {
      const res = await axiosInstance.post('/api/Webhooks/CreateSystemDefaultWabaTemplates', { organization: p.organization });
      created = !!res.data?.Success;
    } catch { /* fall through to the missing-template error */ }
    if (!created) throw new MissingDefaultTemplateError(p.role);
    templateId = await readTemplateId();
    if (!templateId) throw new MissingDefaultTemplateError(p.role);
    throw new DefaultTemplatePendingError(p.role);
  }

  const firstName = (p.customerName || '').trim().split(/\s+/)[0] || '';
  await chatsApi.sendTemplateMessage(p.organization, p.phone, templateId, userId || undefined, [
    entry(1, firstName, 'שם לקוח'),
    entry(2, p.docLabel, 'שם המסמך'),
    // Dynamic URL button — carries the actual link (button1 {{1}}), same as the web payment-link flow.
    entry(1, p.url, 'קישור', 'button1_dynamic_var1'),
  ], fromNumberId || undefined);
  return 'template';
}
