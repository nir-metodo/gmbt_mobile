export type NormalizedConversationStatus = 'open' | 'in_process' | 'closed' | 'unknown';

/** CRM conversation status (Open / In Process / Closed) — not message delivery status. */
export function normalizeConversationStatus(status?: string | null): NormalizedConversationStatus {
  const raw = (status || '').trim().toLowerCase();
  if (!raw) return 'open';
  const s = raw.replace(/\s+/g, '_').replace(/-/g, '_');
  if (s === 'closed' || s === 'close' || s === 'סגור') return 'closed';
  if (s === 'open' || s === 'פתוח') return 'open';
  if (s === 'in_process' || s === 'in_progress' || s === 'inprocess' || s === 'pending' || s === 'בטיפול') {
    return 'in_process';
  }
  // Message delivery statuses must not be treated as CRM status
  if (['sent', 'delivered', 'read', 'failed', 'pending', 'received'].includes(s)) return 'unknown';
  return 'unknown';
}

export function getChatConversationStatus(chat?: {
  lastConversationStatus?: string;
  status?: string;
} | null): NormalizedConversationStatus {
  const fromField = normalizeConversationStatus(chat?.lastConversationStatus);
  if (fromField !== 'unknown') return fromField;
  return normalizeConversationStatus(chat?.status);
}

export function isChatOpen(chat?: { lastConversationStatus?: string; status?: string } | null): boolean {
  return getChatConversationStatus(chat) !== 'closed';
}

export function isChatClosed(chat?: { lastConversationStatus?: string; status?: string } | null): boolean {
  return getChatConversationStatus(chat) === 'closed';
}

export function conversationStatusLabel(
  status: NormalizedConversationStatus,
  t: (key: string, fallback?: string) => string,
): string {
  if (status === 'open') return t('chats.open', 'פתוח');
  if (status === 'in_process') return t('chats.inProcess', 'בטיפול');
  if (status === 'closed') return t('chats.closed', 'סגור');
  return t('chats.status', 'סטטוס');
}

export function conversationStatusColors(status: NormalizedConversationStatus): { bg: string; fg: string } {
  if (status === 'open') return { bg: '#dcfce7', fg: '#16a34a' };
  if (status === 'in_process') return { bg: '#fef9c3', fg: '#ca8a04' };
  if (status === 'closed') return { bg: '#f1f5f9', fg: '#64748b' };
  return { bg: '#f1f5f9', fg: '#64748b' };
}
