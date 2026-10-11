// Date-range presets shared by the Dashboard and Reports screens.
// Mirrors the web app's src/utils/datePresets.js exactly (local-date parts, weeks start on Monday,
// every range is inclusive of both ends) so a period means the same thing on web and mobile.

export type PresetKey =
  | 'today'
  | 'yesterday'
  | 'thisWeek'
  | 'lastWeek'
  | 'thisMonth'
  | 'lastMonth'
  | 'thisQuarter'
  | 'thisYear';

/** 'all' = no date filter (all time). */
export type PeriodKey = 'all' | PresetKey;

export interface PeriodRange {
  key: PeriodKey;
  /** yyyy-MM-dd (local) or null for all time */
  from: string | null;
  to: string | null;
}

export const PRESET_KEYS: PresetKey[] = [
  'today',
  'yesterday',
  'thisWeek',
  'lastWeek',
  'thisMonth',
  'lastMonth',
  'thisQuarter',
  'thisYear',
];

export const PERIOD_KEYS: PeriodKey[] = ['all', ...PRESET_KEYS];

/** Hebrew fallbacks (web PRESET_LABELS.he); the screens look the label up through i18n first. */
export const PERIOD_LABEL_FALLBACK: Record<PeriodKey, string> = {
  all: 'כל הזמן',
  today: 'היום',
  yesterday: 'אתמול',
  thisWeek: 'השבוע',
  lastWeek: 'שבוע שעבר',
  thisMonth: 'החודש',
  lastMonth: 'חודש שעבר',
  thisQuarter: 'הרבעון',
  thisYear: 'השנה',
};

export const isPeriodKey = (v: any): v is PeriodKey => PERIOD_KEYS.includes(v);

export const formatLocalDate = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const startOfWeek = (d: Date): Date => {
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.getFullYear(), d.getMonth(), diff);
};

const startOfQuarter = (d: Date): Date => {
  const q = Math.floor(d.getMonth() / 3);
  return new Date(d.getFullYear(), q * 3, 1);
};

export function getPresetRange(key: PresetKey, now: Date = new Date()): { from: string; to: string } {
  switch (key) {
    case 'today':
      return { from: formatLocalDate(now), to: formatLocalDate(now) };
    case 'yesterday': {
      const d = new Date(now);
      d.setDate(d.getDate() - 1);
      return { from: formatLocalDate(d), to: formatLocalDate(d) };
    }
    case 'thisWeek':
      return { from: formatLocalDate(startOfWeek(now)), to: formatLocalDate(now) };
    case 'lastWeek': {
      const thisWeekStart = startOfWeek(now);
      const lastWeekStart = new Date(thisWeekStart);
      lastWeekStart.setDate(lastWeekStart.getDate() - 7);
      const lastWeekEnd = new Date(thisWeekStart);
      lastWeekEnd.setDate(lastWeekEnd.getDate() - 1);
      return { from: formatLocalDate(lastWeekStart), to: formatLocalDate(lastWeekEnd) };
    }
    case 'thisMonth':
      return { from: formatLocalDate(new Date(now.getFullYear(), now.getMonth(), 1)), to: formatLocalDate(now) };
    case 'lastMonth': {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 0);
      return { from: formatLocalDate(start), to: formatLocalDate(end) };
    }
    case 'thisQuarter':
      return { from: formatLocalDate(startOfQuarter(now)), to: formatLocalDate(now) };
    case 'thisYear':
    default:
      return { from: formatLocalDate(new Date(now.getFullYear(), 0, 1)), to: formatLocalDate(now) };
  }
}

export function rangeForPeriod(key: PeriodKey, now: Date = new Date()): PeriodRange {
  if (key === 'all') return { key, from: null, to: null };
  const r = getPresetRange(key, now);
  return { key, from: r.from, to: r.to };
}

/** Last `days` days ending today (web: the Dashboard "Messages" detail while the filter is "All time"). */
export function lastNDaysRange(days: number, now: Date = new Date()): { from: string; to: string } {
  const from = new Date(now);
  from.setDate(from.getDate() - (days - 1));
  return { from: formatLocalDate(from), to: formatLocalDate(now) };
}

/** Inclusive local-time bounds of a yyyy-MM-dd range, for client-side filtering of records. */
export function rangeBounds(from: string | null, to: string | null): { start: Date | null; end: Date | null } {
  const parse = (s: string, endOfDay: boolean): Date | null => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || '');
    if (!m) return null;
    return endOfDay
      ? new Date(+m[1], +m[2] - 1, +m[3], 23, 59, 59, 999)
      : new Date(+m[1], +m[2] - 1, +m[3], 0, 0, 0, 0);
  };
  return { start: from ? parse(from, false) : null, end: to ? parse(to, true) : null };
}
