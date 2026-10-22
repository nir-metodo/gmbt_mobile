import { chatsApi } from './api/chats';

/**
 * "Send via WhatsApp" for business documents — always THROUGH Gambot (never the phone's own WhatsApp),
 * so the message lands in the customer's chat:
 *   • 24h conversation window OPEN   → a regular free-text message (with the link).
 *   • window CLOSED                  → the org's default WABA template for that role
 *                                      (Settings → default templates; created automatically with the account).
 * Same rule the web uses for quotes and payment links.
 */
export type DocTemplateRole = 'sendInvoice' | 'sendPaymentLink' | 'digitalSignature';

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

interface SenderUser {
  uID?: string | null;
  userId?: string | null;
  fullname?: string | null;
  wabaNumber?: string | null;
  email?: string | null;
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

async function isConversationOpen(organization: string, phone: string): Promise<boolean> {
  try {
    const exp = await chatsApi.getConversationExpiration(organization, phone);
    if (!exp) return false;
    const d = new Date(exp);
    return !isNaN(d.getTime()) && d > new Date();
  } catch {
    return false; // can't tell → treat as closed (a template is always deliverable)
  }
}

export async function sendDocumentViaGambot(p: SendDocParams): Promise<SendDocResult> {
  const userId = p.user.uID || p.user.userId;

  if (await isConversationOpen(p.organization, p.phone)) {
    await chatsApi.sendMessage(
      p.organization,
      p.phone,
      `${p.liveText}\n\n${p.url}`,
      p.user.fullname || undefined,
      userId || undefined,
      undefined,
      p.user.wabaNumber || undefined,
      p.user.email || undefined,
    );
    return 'regular';
  }

  const defRes = await chatsApi.getDefaultMessageTemplates(p.organization);
  const assignment = defRes?.Data?.templates?.[p.role];
  const templateId = Array.isArray(assignment?.templateId) ? assignment.templateId[0] || '' : assignment?.templateId || '';
  if (!templateId) throw new MissingDefaultTemplateError(p.role);

  const firstName = (p.customerName || '').trim().split(/\s+/)[0] || '';
  await chatsApi.sendTemplateMessage(p.organization, p.phone, templateId, userId || undefined, [
    entry(1, firstName, 'שם לקוח'),
    entry(2, p.docLabel, 'שם המסמך'),
    // Dynamic URL button — carries the actual link (button1 {{1}}), same as the web payment-link flow.
    entry(1, p.url, 'קישור', 'button1_dynamic_var1'),
  ]);
  return 'template';
}
