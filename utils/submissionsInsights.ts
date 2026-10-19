// Mobile port of the web "SubmissionsInsights" helpers (gmbt_frontend/.../SubmissionsInsights/submissionsInsightsUtils.js).
//
// Web forms and document-template forms are normalised to:
//   item  = { id, submittedAt, data: { [fieldKey]: stringValue } }
//   field = { key, label, type, options?, ratingMax? }
// and everything below (typed filters, per-field stats, timeline) works on those two shapes.
//
// All answers are strings: checkbox => 'true'/'false', multi-select => values joined with ', ',
// rating/scale/nps => the chosen number as a string.

export interface InsightField {
  key: string;
  label: string;
  type: string;
  options?: string[];
  ratingMax?: number;
}

export interface InsightItem {
  id: string;
  submittedAt: string;
  data: Record<string, string>;
}

export type FieldKind = 'choice' | 'multi' | 'bool' | 'rating' | 'number' | 'date' | 'file' | 'text';

export interface TypedFilter {
  q?: string;
  values?: string[];
  value?: string;
  min?: string | number;
  max?: string | number;
  from?: string;
  to?: string;
  filled?: string;
}
export type FilterMap = Record<string, TypedFilter>;

export interface StatRow {
  key: string;
  count: number;
}

export interface FieldStats {
  field: InsightField;
  kind: FieldKind;
  total: number;
  filled: number;
  fillRate: number;
  rows?: StatRow[];
  base?: number;
  answered?: number;
  avg?: number | null;
  range?: [number, number];
  nps?: number;
  sum?: number;
  min?: number;
  max?: number;
  median?: number | null;
  unique?: number;
}

export const toStr = (v: any): string => {
  if (v == null) return '';
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};

export const fieldKind = (type?: string): FieldKind => {
  switch (String(type || '').toLowerCase()) {
    case 'select':
    case 'radio':
    case 'dropdown':
    case 'radio_group':
      return 'choice';
    case 'checkboxes':
      return 'multi';
    case 'checkbox':
      return 'bool';
    case 'rating':
    case 'scale':
    case 'nps':
    case 'emoji':
      return 'rating';
    case 'number':
      return 'number';
    case 'date':
      return 'date';
    case 'file':
    case 'signature':
    case 'initials':
    case 'image':
      return 'file';
    default:
      return 'text';
  }
};

export const KIND_ICON: Record<FieldKind, string> = {
  choice: 'format-list-bulleted',
  multi: 'checkbox-multiple-marked-outline',
  bool: 'checkbox-marked-outline',
  rating: 'star-outline',
  number: 'numeric',
  date: 'calendar-outline',
  file: 'paperclip',
  text: 'text',
};

export const splitMulti = (v: any): string[] =>
  toStr(v)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

export const parseNumber = (v: any): number | null => {
  const s = toStr(v).replace(/,/g, '').trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

const pad2 = (n: number) => String(n).padStart(2, '0');
export const ymd = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
export const ym = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;

// Parses yyyy-mm-dd, dd/mm/yyyy, dd.mm.yyyy, dd-mm-yyyy and full ISO date-times (local day).
export const parseDate = (v: any): Date | null => {
  const s = toStr(v).trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:$|[T\s])/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate());
};

export const ratingRange = (field: InsightField): [number, number] => {
  const t = String(field.type || '').toLowerCase();
  if (t === 'nps') return [0, 10];
  if (t === 'emoji') return [1, 5];
  if (t === 'scale') return [1, Math.max(2, Math.min(10, Number(field.ratingMax) || 10))];
  return [1, Math.max(2, Math.min(10, Number(field.ratingMax) || 5))];
};

export const displayValue = (v: any, yes: string, no: string): string => {
  const s = toStr(v);
  if (s === 'true') return yes;
  if (s === 'false') return no;
  if (s.startsWith('data:image')) return '🖼️';
  return s;
};

// ---------------------------------------------------------------- typed filters

export const isFilterActive = (kind: FieldKind, f?: TypedFilter): boolean => {
  if (!f) return false;
  switch (kind) {
    case 'choice':
    case 'multi':
      return Array.isArray(f.values) && f.values.length > 0;
    case 'bool':
      return f.value === 'true' || f.value === 'false';
    case 'rating':
    case 'number':
      return (f.min !== '' && f.min != null) || (f.max !== '' && f.max != null);
    case 'date':
      return !!(f.from || f.to);
    case 'file':
      return f.filled === 'yes' || f.filled === 'no';
    default:
      return !!(f.q && f.q.trim());
  }
};

export const matchesFilter = (item: InsightItem, field: InsightField, f?: TypedFilter): boolean => {
  const kind = fieldKind(field.type);
  if (!f || !isFilterActive(kind, f)) return true;
  const raw = toStr(item.data?.[field.key]).trim();
  switch (kind) {
    case 'choice':
      return (f.values || []).includes(raw);
    case 'multi': {
      const parts = splitMulti(raw);
      return (f.values || []).some((v) => parts.includes(v));
    }
    case 'bool':
      return f.value === 'true' ? raw === 'true' : raw !== 'true';
    case 'rating':
    case 'number': {
      const n = parseNumber(raw);
      if (n == null) return false;
      if (f.min !== '' && f.min != null && n < Number(f.min)) return false;
      if (f.max !== '' && f.max != null && n > Number(f.max)) return false;
      return true;
    }
    case 'date': {
      const d = parseDate(raw);
      if (!d) return false;
      if (f.from) {
        const a = parseDate(f.from);
        if (a && d < a) return false;
      }
      if (f.to) {
        const b = parseDate(f.to);
        if (b && d > b) return false;
      }
      return true;
    }
    case 'file':
      return f.filled === 'yes' ? raw !== '' : raw === '';
    default:
      return raw.toLowerCase().includes((f.q || '').trim().toLowerCase());
  }
};

export const applyTypedFilters = (items: InsightItem[], fields: InsightField[], filters: FilterMap): InsightItem[] => {
  const active = fields.filter((fl) => isFilterActive(fieldKind(fl.type), filters[fl.key]));
  if (!active.length) return items;
  return items.filter((it) => active.every((fl) => matchesFilter(it, fl, filters[fl.key])));
};

export const countActiveFilters = (fields: InsightField[], filters: FilterMap): number =>
  fields.filter((fl) => isFilterActive(fieldKind(fl.type), filters[fl.key])).length;

export const optionsFor = (field: InsightField, items: InsightItem[]): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (v: any) => {
    const s = String(v ?? '').trim();
    if (s && !seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  };
  (Array.isArray(field.options) ? field.options : []).forEach(push);
  const kind = fieldKind(field.type);
  items.forEach((it) => {
    const raw = toStr(it.data?.[field.key]).trim();
    if (!raw) return;
    if (kind === 'multi') splitMulti(raw).forEach(push);
    else push(raw);
  });
  return out;
};

// ---------------------------------------------------------------- grouping

export const groupKeys = (item: InsightItem, field: InsightField): string[] => {
  const kind = fieldKind(field.type);
  const raw = toStr(item.data?.[field.key]).trim();
  switch (kind) {
    case 'choice':
      return raw ? [raw] : [];
    case 'multi':
      return splitMulti(raw);
    case 'bool':
      return [raw === 'true' ? 'true' : 'false'];
    case 'rating': {
      const n = parseNumber(raw);
      return n == null ? [] : [String(n)];
    }
    case 'date': {
      const d = parseDate(raw);
      return d ? [ym(d)] : [];
    }
    case 'text':
      return raw ? [raw] : [];
    default:
      return [];
  }
};

// Convert a tapped group key back into a typed filter (so bars can drill down).
export const filterFromGroup = (field: InsightField, key: string, current?: TypedFilter): TypedFilter => {
  const kind = fieldKind(field.type);
  switch (kind) {
    case 'choice':
    case 'multi': {
      const cur = Array.isArray(current?.values) ? (current!.values as string[]) : [];
      return { values: cur.includes(key) ? cur.filter((v) => v !== key) : [...cur, key] };
    }
    case 'bool':
      return { value: current?.value === key ? '' : key };
    case 'rating': {
      const same = String(current?.min) === key && String(current?.max) === key;
      return same ? { min: '', max: '' } : { min: key, max: key };
    }
    case 'date': {
      const [y, m] = key.split('-').map(Number);
      const from = `${y}-${pad2(m)}-01`;
      const to = ymd(new Date(y, m, 0));
      return current?.from === from && current?.to === to ? { from: '', to: '' } : { from, to };
    }
    default:
      return { q: current?.q === key ? '' : key };
  }
};

export const isGroupSelected = (field: InsightField, key: string, current?: TypedFilter): boolean => {
  const kind = fieldKind(field.type);
  if (!current) return false;
  switch (kind) {
    case 'choice':
    case 'multi':
      return (current.values || []).includes(key);
    case 'bool':
      return current.value === key;
    case 'rating':
      return String(current.min) === key && String(current.max) === key;
    case 'date': {
      const [y, m] = key.split('-').map(Number);
      return current.from === `${y}-${pad2(m)}-01` && current.to === ymd(new Date(y, m, 0));
    }
    default:
      return current.q === key;
  }
};

export const groupLabel = (field: InsightField, key: string, yes: string, no: string, locale: string): string => {
  const kind = fieldKind(field.type);
  if (kind === 'bool') return key === 'true' ? yes : no;
  if (kind === 'date') {
    const [y, m] = key.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString(locale, { month: 'short', year: 'numeric' });
  }
  return displayValue(key, yes, no);
};

// ---------------------------------------------------------------- per-field statistics

const median = (arr: number[]): number | null => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

const countBy = (items: InsightItem[], field: InsightField) => {
  const map = new Map<string, number>();
  items.forEach((it) => groupKeys(it, field).forEach((k) => map.set(k, (map.get(k) || 0) + 1)));
  return map;
};

export const buildFieldStats = (field: InsightField, items: InsightItem[], allItems?: InsightItem[]): FieldStats => {
  const kind = fieldKind(field.type);
  const total = items.length;
  const raws = items.map((it) => toStr(it.data?.[field.key]).trim());
  const filled = kind === 'bool' ? raws.filter((r) => r === 'true').length : raws.filter((r) => r !== '').length;
  const stats: FieldStats = { field, kind, total, filled, fillRate: total ? filled / total : 0 };

  if (kind === 'choice' || kind === 'multi') {
    const counts = countBy(items, field);
    const opts = optionsFor(field, allItems || items);
    const rows: StatRow[] = opts.slice(0, 60).map((o) => ({ key: o, count: counts.get(o) || 0 }));
    Array.from(counts.keys()).forEach((k) => {
      if (!opts.includes(k)) rows.push({ key: k, count: counts.get(k) || 0 });
    });
    rows.sort((a, b) => b.count - a.count);
    stats.rows = rows;
    stats.base = filled;
  } else if (kind === 'bool') {
    stats.rows = [
      { key: 'true', count: filled },
      { key: 'false', count: total - filled },
    ];
    stats.base = total;
  } else if (kind === 'rating') {
    const [lo, hi] = ratingRange(field);
    const nums = raws.map(parseNumber).filter((n): n is number => n != null);
    const counts = new Map<number, number>();
    nums.forEach((n) => counts.set(n, (counts.get(n) || 0) + 1));
    const rows: StatRow[] = [];
    for (let n = lo; n <= hi; n++) rows.push({ key: String(n), count: counts.get(n) || 0 });
    stats.rows = rows;
    stats.base = nums.length;
    stats.answered = nums.length;
    stats.avg = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
    stats.range = [lo, hi];
    if (String(field.type).toLowerCase() === 'nps' && nums.length) {
      const prom = nums.filter((n) => n >= 9).length;
      const det = nums.filter((n) => n <= 6).length;
      stats.nps = Math.round(((prom - det) / nums.length) * 100);
    }
  } else if (kind === 'number') {
    const nums = raws.map(parseNumber).filter((n): n is number => n != null);
    stats.answered = nums.length;
    if (nums.length) {
      const sum = nums.reduce((a, b) => a + b, 0);
      Object.assign(stats, { sum, avg: sum / nums.length, min: Math.min(...nums), max: Math.max(...nums), median: median(nums) });
    }
  } else if (kind === 'date') {
    const counts = countBy(items, field);
    const rows = Array.from(counts.entries())
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => a.key.localeCompare(b.key));
    stats.rows = rows;
    stats.base = rows.reduce((a, r) => a + r.count, 0);
  } else if (kind === 'text') {
    const counts = countBy(items, field);
    const rows = Array.from(counts.entries())
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count);
    stats.unique = rows.length;
    stats.rows = rows.filter((r) => r.count > 1).slice(0, 5);
    stats.base = filled;
  }
  return stats;
};

// ---------------------------------------------------------------- timeline

export interface Timeline {
  unit: 'hour' | 'day' | 'month';
  rows: StatRow[];
}

export const buildTimeline = (items: InsightItem[]): Timeline => {
  const dates = items
    .map((it) => (it.submittedAt ? new Date(it.submittedAt) : null))
    .filter((d): d is Date => !!d && !Number.isNaN(d.getTime()));
  if (!dates.length) return { unit: 'day', rows: [] };
  const min = new Date(Math.min(...dates.map((d) => d.getTime())));
  const max = new Date(Math.max(...dates.map((d) => d.getTime())));
  // Everything on ONE calendar day (e.g. the "Today" filter) → break it down by hour.
  if (ymd(min) === ymd(max)) {
    const counts = new Array(24).fill(0);
    dates.forEach((d) => {
      counts[d.getHours()] += 1;
    });
    const isToday = ymd(min) === ymd(new Date());
    const lastHour = isToday ? Math.max(new Date().getHours(), max.getHours()) : 23;
    return { unit: 'hour', rows: counts.slice(0, lastHour + 1).map((count, h) => ({ key: pad2(h), count })) };
  }
  const spanDays = Math.round((max.getTime() - min.getTime()) / 86400000);
  const unit: 'day' | 'month' = spanDays > 62 ? 'month' : 'day';
  const counts = new Map<string, number>();
  dates.forEach((d) => {
    const k = unit === 'month' ? ym(d) : ymd(d);
    counts.set(k, (counts.get(k) || 0) + 1);
  });
  const rows: StatRow[] = [];
  if (unit === 'day') {
    const cur = new Date(min.getFullYear(), min.getMonth(), min.getDate());
    const end = new Date(max.getFullYear(), max.getMonth(), max.getDate());
    while (cur <= end) {
      const k = ymd(cur);
      rows.push({ key: k, count: counts.get(k) || 0 });
      cur.setDate(cur.getDate() + 1);
    }
  } else {
    const cur = new Date(min.getFullYear(), min.getMonth(), 1);
    const end = new Date(max.getFullYear(), max.getMonth(), 1);
    while (cur <= end) {
      const k = ym(cur);
      rows.push({ key: k, count: counts.get(k) || 0 });
      cur.setMonth(cur.getMonth() + 1);
    }
  }
  return { unit, rows };
};

/** Fixed rolling windows used by the KPI tiles ("today" / 7 days / 30 days). */
export const inLastDays = (iso: string, days: number): boolean => {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return false;
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return d >= new Date(startToday.getTime() - (days - 1) * 86400000);
};
