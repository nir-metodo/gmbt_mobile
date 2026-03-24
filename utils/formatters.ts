import { format, formatDistanceToNow, isToday, isYesterday, parseISO } from 'date-fns';

/**
 * Safely adds alpha transparency to any color string (hex OR rgb/rgba).
 * Hex appending like `${rgbaColor}20` is invalid — use this instead.
 * @param color - hex (#RRGGBB) or rgb(...) or rgba(...) string
 * @param opacity - 0 (transparent) to 1 (opaque)
 */
export function withAlpha(color: string, opacity: number): string {
  if (!color || typeof color !== 'string') return color;
  if (color.startsWith('rgba(')) {
    return color.replace(/,\s*[\d.]+\s*\)$/, `, ${opacity})`);
  }
  if (color.startsWith('rgb(')) {
    return color.replace('rgb(', 'rgba(').replace(')', `, ${opacity})`);
  }
  const hex = Math.round(opacity * 255).toString(16).padStart(2, '0');
  return `${color}${hex}`;
}
import { he, enUS } from 'date-fns/locale';

export function formatPhoneNumber(phone: string): string {
  if (!phone) return '';
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.startsWith('972')) {
    return `+${cleaned.slice(0, 3)}-${cleaned.slice(3, 5)}-${cleaned.slice(5)}`;
  }
  if (cleaned.length === 10) {
    return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
  }
  return phone;
}

export function formatChatTime(dateStr: string, lang: 'en' | 'he' = 'he'): string {
  try {
    const date = typeof dateStr === 'string' ? parseISO(dateStr) : new Date(dateStr);
    if (isToday(date)) {
      return format(date, 'HH:mm');
    }
    if (isYesterday(date)) {
      return lang === 'he' ? 'אתמול' : 'Yesterday';
    }
    return format(date, 'dd/MM/yy');
  } catch {
    return '';
  }
}

export function formatMessageTime(dateStr: string): string {
  try {
    const date = typeof dateStr === 'string' ? parseISO(dateStr) : new Date(dateStr);
    return format(date, 'HH:mm');
  } catch {
    return '';
  }
}

export function formatRelativeTime(dateStr: string, lang: 'en' | 'he' = 'he'): string {
  try {
    const date = typeof dateStr === 'string' ? parseISO(dateStr) : new Date(dateStr);
    return formatDistanceToNow(date, {
      addSuffix: true,
      locale: lang === 'he' ? he : enUS,
    });
  } catch {
    return '';
  }
}

export function formatDate(dateStr: string, formatStr = 'dd/MM/yyyy'): string {
  try {
    const date = typeof dateStr === 'string' ? parseISO(dateStr) : new Date(dateStr);
    return format(date, formatStr);
  } catch {
    return '';
  }
}

export function formatDateTime(dateStr: string): string {
  try {
    const date = typeof dateStr === 'string' ? parseISO(dateStr) : new Date(dateStr);
    return format(date, 'dd/MM/yyyy HH:mm');
  } catch {
    return '';
  }
}

export function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function formatCurrency(amount: number, currency = '₪'): string {
  return `${currency}${amount.toLocaleString('he-IL', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function getInitials(name: string): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

export function formatMessageDateSeparator(dateStr: string, lang: 'en' | 'he' = 'he'): string {
  try {
    const date = typeof dateStr === 'string' ? parseISO(dateStr) : new Date(dateStr);
    if (isToday(date)) return lang === 'he' ? 'היום' : 'Today';
    if (isYesterday(date)) return lang === 'he' ? 'אתמול' : 'Yesterday';
    return format(date, 'dd MMMM yyyy', { locale: lang === 'he' ? he : enUS });
  } catch {
    return '';
  }
}
