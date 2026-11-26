// Multi-channel chats: WhatsApp (phone number), Facebook Messenger (ms_fb_*), Instagram (ms_ig_*), website chatbot (wc_*).
// Non-WhatsApp chats are keyed by a string (not a phone number), so digit-stripping identity checks must NOT be applied to them.

export type ChatChannel = 'whatsapp' | 'messenger' | 'instagram' | 'website';

export const ALL_CHANNELS: ChatChannel[] = ['whatsapp', 'messenger', 'instagram', 'website'];

export function isKeyedChat(key?: string | null): boolean {
  const k = String(key || '');
  return k.startsWith('ms_') || k.startsWith('wc_');
}

export function channelOfKey(key?: string | null, channelField?: string | null): ChatChannel {
  const k = String(key || '');
  if (channelField === 'instagram' || k.startsWith('ms_ig_')) return 'instagram';
  if (channelField === 'messenger' || k.startsWith('ms_fb_')) return 'messenger';
  if (channelField === 'website' || k.startsWith('wc_')) return 'website';
  return 'whatsapp';
}

export function channelLabel(ch: ChatChannel, lang: 'en' | 'he' = 'he'): string {
  if (ch === 'whatsapp') return 'WhatsApp';
  if (ch === 'messenger') return 'Facebook';
  if (ch === 'instagram') return 'Instagram';
  return lang === 'he' ? 'אתר' : 'Website';
}

/** Identity form of a chat key: keyed chats keep their exact key, phone chats collapse to digits. */
export function chatKeyNorm(key?: string | null): string {
  const k = String(key || '');
  return isKeyedChat(k) ? k : k.replace(/\D/g, '');
}

/** True when a user (allowedChannels empty/absent = all) may use the channel. */
export function isChannelAllowed(allowed: string[] | undefined | null, ch: ChatChannel): boolean {
  return !allowed || allowed.length === 0 || allowed.includes(ch);
}
