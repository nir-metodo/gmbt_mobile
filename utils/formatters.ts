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

// Phone numbers must always read left-to-right ("+972 54 ..."), even inside Hebrew (RTL) text - otherwise "+972" jumps to the right end.
// Wrapped in a Unicode LTR isolate (LRI ... PDI); display-only (never use the result for dialing/comparison).
export function formatPhoneNumber(phone: string): string {
  const f = formatPhoneNumberRaw(phone);
  return f ? `\u2066${f}\u2069` : '';
}

export function formatPhoneNumberRaw(phone: string): string {
  if (!phone) return '';
  // Same display format as the web app: "+972 50 527 8310" (landline: "+972 3 123 4567"), whatever the stored form.
  let digits = phone.replace(/\D/g, '');
  if (!digits) return phone;
  if (digits.startsWith('00')) digits = digits.slice(2);
  const hasPlus = phone.trim().startsWith('+') || phone.trim().startsWith('00');
  let national = '';
  if (digits.startsWith('972')) national = digits.slice(3).replace(/^0+/, '');
  else if (!hasPlus && digits.startsWith('0')) national = digits.slice(1);
  else if (!hasPlus && (digits.length === 8 || digits.length === 9)) national = digits;
  if (national.length === 9) return `+972 ${national.slice(0, 2)} ${national.slice(2, 5)} ${national.slice(5)}`;
  if (national.length === 8) return `+972 ${national.slice(0, 1)} ${national.slice(1, 4)} ${national.slice(4)}`;
  return hasPlus || digits.startsWith('972') || digits.length > 10 ? `+${digits}` : phone;
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

/**
 * Smart due-date label for task rows (agenda-style, matching the web task cards):
 *   - Today    → time only, e.g. "14:30"
 *   - Tomorrow → "<tomorrowLabel> 09:00"
 *   - Else     → "dd/MM HH:mm" (adds the year only when it differs from the current year)
 * Overdue coloring is handled by the caller (this only builds the text).
 */
export function formatDueDate(dateStr: string, tomorrowLabel = 'מחר'): string {
  try {
    const date = typeof dateStr === 'string' ? parseISO(dateStr) : new Date(dateStr);
    if (isNaN(date.getTime())) return '';
    const now = new Date();
    const time = format(date, 'HH:mm');
    const sameDay = (a: Date, b: Date) =>
      a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    if (sameDay(date, now)) return time;
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    if (sameDay(date, tomorrow)) return `${tomorrowLabel} ${time}`;
    const sameYear = date.getFullYear() === now.getFullYear();
    return `${format(date, sameYear ? 'dd/MM' : 'dd/MM/yyyy')} ${time}`;
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
