import {
  DS_CONTACT_FIELD,
  DS_HARDCODED,
  EmailContentSource,
  EmailPreviewRecipient,
  EmailTemplateVariable,
} from '../../../services/api/emailCampaigns';

export const BRAND = '#2e6155';

// ── Status ──────────────────────────────────────────────────────────────

export interface StatusMeta {
  key: string;
  label: string;
  color: string;
}

/** Maps backend campaign / recipient statuses to a label + colour (mirrors the web results page). */
export function statusMeta(status: string | undefined, he: boolean): StatusMeta {
  const key = String(status || 'draft').toLowerCase().replace(/[^a-z]/g, '');
  const L = (heText: string, enText: string) => (he ? heText : enText);
  switch (key) {
    case 'draft':
      return { key, label: L('טיוטה', 'Draft'), color: '#64748b' };
    case 'scheduled':
      return { key, label: L('מתוזמן', 'Scheduled'), color: '#6366f1' };
    case 'running':
    case 'inprocess':
    case 'sending':
      return { key, label: L('בשליחה', 'Sending'), color: '#f59e0b' };
    case 'queued':
      return { key, label: L('בתור לשליחה', 'Queued'), color: '#f59e0b' };
    case 'completed':
    case 'sent':
      return { key, label: L('נשלח', 'Sent'), color: '#10b981' };
    case 'completedwitherrors':
      return { key, label: L('הושלם חלקית', 'Partially sent'), color: '#f59e0b' };
    case 'failed':
      return { key, label: L('נכשל', 'Failed'), color: '#ef4444' };
    case 'opened':
      return { key, label: L('נפתח', 'Opened'), color: '#34d399' };
    case 'clicked':
      return { key, label: L('נלחץ', 'Clicked'), color: BRAND };
    case 'bounced':
      return { key, label: L('הוחזר', 'Bounced'), color: '#f59e0b' };
    case 'unsubscribed':
      return { key, label: L('הוסר מהרשימה', 'Unsubscribed'), color: '#94a3b8' };
    case 'duplicate':
      return { key, label: L('כפול', 'Duplicate'), color: '#94a3b8' };
    default:
      return { key, label: status || L('טיוטה', 'Draft'), color: '#64748b' };
  }
}

// ── Dates ───────────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, '0');

export function formatDateTime(value: string | Date | null | undefined, he: boolean): string {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return String(value);
  try {
    return d.toLocaleString(he ? 'he-IL' : 'en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
}

/** The scheduler (backend ConvertToUtc) expects day-first 'dd/MM/yyyy HH:mm:ss' in the campaign's timezone. */
export function formatRunAt(d: Date): string {
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Parses the stored RunAt (dd/MM/yyyy, dd.MM.yyyy, dd-MM-yyyy or ISO) into a local Date (assumes device tz). */
export function parseRunAt(value: string | undefined): Date | null {
  if (!value) return null;
  const s = value.trim().replace(',', ' ').replace(/\s+/g, ' ');
  const m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?: (\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0));
    return isNaN(d.getTime()) ? null : d;
  }
  const iso = new Date(s);
  return isNaN(iso.getTime()) ? null : iso;
}

export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Jerusalem';
  } catch {
    return 'Asia/Jerusalem';
  }
}

// ── HTML preview ────────────────────────────────────────────────────────

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** HTML for the preview content. 'inline' (regular message) is plain text → keep its line breaks (like the backend preview). */
export function contentToHtml(source: EmailContentSource, body: string): string {
  if (source === 'inline') {
    return `<div style="white-space:pre-wrap;font-family:Arial,Helvetica,sans-serif;line-height:1.6;">${escapeHtml(body)}</div>`;
  }
  return body;
}

/** Wraps an email fragment/document so it renders readably in a phone WebView (always on white, like a mailbox). */
export function wrapEmailHtml(html: string, rtl: boolean): string {
  const base =
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<style>html,body{margin:0;padding:0;background:#fff;color:#111;word-wrap:break-word;}' +
    'img{max-width:100%;height:auto;}table{max-width:100%;}</style>';
  const content = html && html.trim() ? html : '<p style="font-family:Arial,sans-serif;color:#6b7280">—</p>';
  if (/<html[\s>]/i.test(content)) {
    if (/<head[\s>]/i.test(content)) return content.replace(/<head([^>]*)>/i, `<head$1>${base}`);
    return content.replace(/<html([^>]*)>/i, `<html$1><head>${base}</head>`);
  }
  return `<!DOCTYPE html><html dir="${rtl ? 'rtl' : 'ltr'}"><head><meta charset="utf-8">${base}</head><body>${content}</body></html>`;
}

// ── Sample variable values ──────────────────────────────────────────────

export const SAMPLE_CONTACT = { name: 'ישראל ישראלי', email: 'israel@example.com', phone: '050-0000000' };

function sampleForField(field: string, he: boolean, recipient?: EmailPreviewRecipient): string {
  const f = field.toLowerCase();
  if (f === 'name' || f === 'fullname' || f === 'full_name') return recipient?.name || (he ? SAMPLE_CONTACT.name : 'John Doe');
  if (f === 'firstname' || f === 'first_name') return (recipient?.name || (he ? SAMPLE_CONTACT.name : 'John Doe')).split(' ')[0];
  if (f === 'email') return recipient?.email || SAMPLE_CONTACT.email;
  if (f === 'phone' || f === 'phonenumber') return recipient?.phone || SAMPLE_CONTACT.phone;
  return `[${field}]`;
}

/**
 * Replaces `{{variable}}` placeholders with sample values so the preview reads like a real email:
 * hard-coded mappings use their value, contact-field mappings use the first recipient (or a sample).
 */
export function applySampleVariables(
  html: string,
  mappings: EmailTemplateVariable[],
  he: boolean,
  recipient?: EmailPreviewRecipient,
): string {
  let out = html || '';
  mappings.forEach((m) => {
    if (!m.variable) return;
    let val = '';
    if (m.dataSource === DS_HARDCODED) val = m.hardCodedValue || '';
    else if (m.dataSource === DS_CONTACT_FIELD && m.contactField) val = sampleForField(m.contactField, he, recipient);
    else val = `{{${m.variable}}}`;
    out = out.split(`{{${m.variable}}}`).join(val);
  });
  return out;
}

export function countVariablesLeft(html: string): number {
  const m = (html || '').match(/\{\{[^{}]+\}\}/g);
  return m ? m.length : 0;
}
