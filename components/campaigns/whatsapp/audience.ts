/**
 * Audience (ContactFilters) editing model for the mobile campaign form.
 *
 * The backend's contact filter (ExecuteAdvancedContactFilter / CountContactsByFilter) supports
 * group (tags), contactField, relatedRecord, relatedTask and ctwa filters. Mobile edits the first
 * two; any other filter found on a duplicated campaign is kept untouched as a `raw` row so a
 * duplicate never silently loses part of its audience.
 */

export type FieldOp = 'equals' | 'contains' | 'isEmpty' | 'isNotEmpty';

export type FilterRow =
  | { id: number; kind: 'tag'; op: 'equals' | 'notEquals'; tags: string[] }
  | { id: number; kind: 'owner'; op: 'equals' | 'notEquals'; ownerId: string }
  | { id: number; kind: 'field'; field: string; op: FieldOp; value: string }
  | { id: number; kind: 'raw'; raw: any };

export const OWNER_FIELD = 'contactOwner';

export const needsValue = (op: string) => op !== 'isEmpty' && op !== 'isNotEmpty';

export function rowToFilter(r: FilterRow): any {
  switch (r.kind) {
    case 'tag':
      return { filterType: 'group', fieldName: '', operator: r.op, value: '', groupValue: r.tags };
    case 'owner':
      return { filterType: 'contactField', fieldName: OWNER_FIELD, operator: r.op, value: r.ownerId };
    case 'field':
      return { filterType: 'contactField', fieldName: r.field, operator: r.op, value: needsValue(r.op) ? r.value : '' };
    default:
      return r.raw;
  }
}

export function rowValid(r: FilterRow): boolean {
  switch (r.kind) {
    case 'tag':
      return r.tags.length > 0;
    case 'owner':
      return !!r.ownerId;
    case 'field':
      return !!r.field && (!needsValue(r.op) || r.value.trim().length > 0);
    default:
      return true;
  }
}

export function filterToRow(f: any, id: number): FilterRow {
  const type = f?.filterType;
  if (type === 'group') {
    const tags = Array.isArray(f.groupValue) && f.groupValue.length ? f.groupValue.map(String) : f.value ? [String(f.value)] : [];
    return { id, kind: 'tag', op: f.operator === 'notEquals' ? 'notEquals' : 'equals', tags };
  }
  if (type === 'contactField') {
    const name = String(f.fieldName || '');
    const op = String(f.operator || 'equals');
    if (name === OWNER_FIELD && (op === 'equals' || op === 'notEquals')) {
      return { id, kind: 'owner', op, ownerId: String(f.value || '') };
    }
    if (op === 'equals' || op === 'contains' || op === 'isEmpty' || op === 'isNotEmpty') {
      return { id, kind: 'field', field: name, op, value: String(f.value || '') };
    }
  }
  return { id, kind: 'raw', raw: f };
}

export function buildContactFilters(rows: FilterRow[], logic: 'AND' | 'OR') {
  return { filters: rows.map(rowToFilter), logic };
}
