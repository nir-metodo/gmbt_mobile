import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, Button, Chip, IconButton, SegmentedButtons, TextInput, ActivityIndicator } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../../hooks/useAppTheme';
import { useRTL } from '../../../hooks/useRTL';
import {
  EmailContactFieldDef,
  EmailContactFilter,
  EmailContactFilters,
  emailCampaignsApi,
} from '../../../services/api/emailCampaigns';
import PickerSheet, { PickerItem } from './PickerSheet';
import { BRAND } from './emailCampaignHelpers';

type OpDef = { value: string; he: string; en: string };

const OPS_TEXT: OpDef[] = [
  { value: 'equals', he: 'שווה ל', en: 'equals' },
  { value: 'notEquals', he: 'שונה מ', en: 'not equals' },
  { value: 'contains', he: 'מכיל', en: 'contains' },
  { value: 'notContains', he: 'לא מכיל', en: 'not contains' },
  { value: 'startsWith', he: 'מתחיל ב', en: 'starts with' },
  { value: 'endsWith', he: 'מסתיים ב', en: 'ends with' },
  { value: 'isEmpty', he: 'ריק', en: 'is empty' },
  { value: 'isNotEmpty', he: 'לא ריק', en: 'is not empty' },
];
const OPS_NUMBER: OpDef[] = [
  { value: 'equals', he: 'שווה ל', en: 'equals' },
  { value: 'notEquals', he: 'שונה מ', en: 'not equals' },
  { value: 'greaterThan', he: 'גדול מ', en: '>' },
  { value: 'lessThan', he: 'קטן מ', en: '<' },
  { value: 'isEmpty', he: 'ריק', en: 'is empty' },
  { value: 'isNotEmpty', he: 'לא ריק', en: 'is not empty' },
];
const OPS_SELECT: OpDef[] = [
  { value: 'equals', he: 'שווה ל', en: 'equals' },
  { value: 'notEquals', he: 'שונה מ', en: 'not equals' },
  { value: 'isEmpty', he: 'ריק', en: 'is empty' },
  { value: 'isNotEmpty', he: 'לא ריק', en: 'is not empty' },
];

type FieldCategory = 'text' | 'number' | 'select';

/** Field types the mobile filter row can edit faithfully. Dates/users/etc. stay web-only (kept untouched if present). */
function fieldCategory(f: EmailContactFieldDef | undefined): FieldCategory | null {
  if (!f) return 'text';
  if (f.options && f.options.length > 0) return 'select';
  if (['number', 'numeric', 'integer', 'int', 'decimal'].includes(f.type)) return 'number';
  if (['select', 'dropdown', 'enum'].includes(f.type)) return 'select';
  if (['', 'text', 'string', 'email', 'phone', 'tel', 'url', 'textarea', 'longtext'].includes(f.type)) return 'text';
  return null;
}

const NO_VALUE_OPS = ['isEmpty', 'isNotEmpty'];

export function isFilterComplete(f: EmailContactFilter): boolean {
  if (f.filterType === 'group') return f.groupValue.length > 0;
  if (f.filterType === 'contactField') {
    if (!f.fieldName || !f.operator) return false;
    return NO_VALUE_OPS.includes(f.operator) || f.value.trim().length > 0;
  }
  return true; // web-only filter types are preserved as-is
}

/** Only complete rows go to the backend (an empty row would otherwise silently match everyone / no-one). */
export function cleanFilters(f: EmailContactFilters | null): EmailContactFilters | null {
  if (!f) return null;
  const filters = f.filters.filter(isFilterComplete);
  return filters.length > 0 ? { filters, logic: f.logic } : null;
}

const newGroupFilter = (): EmailContactFilter => ({ filterType: 'group', fieldName: '', operator: 'equals', value: '', groupValue: [] });
const newFieldFilter = (): EmailContactFilter => ({ filterType: 'contactField', fieldName: '', operator: 'equals', value: '', groupValue: [] });

interface Props {
  organization: string;
  filters: EmailContactFilters | null;
  onChange: (f: EmailContactFilters | null) => void;
  /** Reports the live matching-contacts count (null while unknown/loading). */
  onCount?: (n: number | null) => void;
}

/**
 * Audience selection for the email campaign — the mobile subset of the web AdvancedContactFilter:
 * all contacts, or tag (group) / contact-field rules combined with AND / OR. Filter types that only exist on
 * the web (related records, campaigns, tasks…) are shown read-only and preserved on save.
 */
export default function EmailAudienceEditor({ organization, filters, onChange, onCount }: Props) {
  const theme = useAppTheme();
  const { flexDirection, textAlign } = useRTL();
  const { i18n } = useTranslation();
  const he = i18n.language !== 'en';

  const [mode, setMode] = useState<'all' | 'filters'>(filters && filters.filters.length > 0 ? 'filters' : 'all');
  const [tags, setTags] = useState<string[] | null>(null);
  const [fields, setFields] = useState<EmailContactFieldDef[] | null>(null);
  const [tagPickerFor, setTagPickerFor] = useState<number | null>(null);
  const [fieldPickerFor, setFieldPickerFor] = useState<number | null>(null);
  const [valuePickerFor, setValuePickerFor] = useState<number | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const [counting, setCounting] = useState(false);
  const [countError, setCountError] = useState(false);
  const [contacts, setContacts] = useState<{ phone: string; name: string }[]>([]);
  const [showContacts, setShowContacts] = useState(false);
  const reqId = useRef(0);

  const rows = filters?.filters || [];
  const logic = filters?.logic || 'AND';

  // Lazy-load tags / contact fields the first time the user goes into filter mode.
  useEffect(() => {
    if (mode !== 'filters' || !organization) return;
    if (tags === null) emailCampaignsApi.getTags(organization).then(setTags).catch(() => setTags([]));
    if (fields === null) emailCampaignsApi.getContactFields(organization).then(setFields).catch(() => setFields([]));
  }, [mode, organization, tags, fields]);

  const effective = useMemo(() => (mode === 'all' ? null : cleanFilters(filters)), [mode, filters]);
  const effectiveKey = JSON.stringify(effective);

  // Debounced live count (same endpoint as the web "show recipients" button).
  useEffect(() => {
    if (!organization) return;
    const id = ++reqId.current;
    setCounting(true);
    setCountError(false);
    onCount?.(null);
    const timer = setTimeout(() => {
      emailCampaignsApi
        .countContacts(organization, effective)
        .then((r) => {
          if (id !== reqId.current) return;
          setCount(r.count);
          setContacts(r.contacts);
          onCount?.(r.count);
        })
        .catch(() => {
          if (id !== reqId.current) return;
          setCountError(true);
          setCount(null);
          onCount?.(null);
        })
        .finally(() => {
          if (id === reqId.current) setCounting(false);
        });
    }, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organization, effectiveKey]);

  const update = useCallback(
    (next: EmailContactFilter[], nextLogic: 'AND' | 'OR' = logic) => {
      onChange(next.length === 0 ? null : { filters: next, logic: nextLogic });
    },
    [onChange, logic],
  );

  const patchRow = (idx: number, patch: Partial<EmailContactFilter>) => {
    update(rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  const switchMode = (v: string) => {
    if (v === 'all') {
      setMode('all');
      onChange(null);
    } else {
      setMode('filters');
      if (rows.length === 0) update([newGroupFilter()]);
    }
  };

  const fieldOf = (name: string) => fields?.find((f) => f.name === name);

  const opLabel = (op: OpDef) => (he ? op.he : op.en);

  const renderRow = (row: EmailContactFilter, idx: number) => {
    const header = (title: string) => (
      <View style={[styles.rowHeader, { flexDirection }]}>
        <Text style={{ flex: 1, textAlign, fontWeight: '700', color: theme.colors.onSurface }}>{title}</Text>
        <IconButton icon="close" size={18} onPress={() => update(rows.filter((_, i) => i !== idx))} />
      </View>
    );
    const card = { backgroundColor: theme.colors.surfaceVariant, borderColor: theme.colors.outline };

    if (row.filterType === 'group') {
      return (
        <View key={idx} style={[styles.rowCard, card]}>
          {header(he ? 'תגית' : 'Tag')}
          <SegmentedButtons
            density="small"
            value={row.operator === 'notEquals' ? 'notEquals' : 'equals'}
            onValueChange={(v) => patchRow(idx, { operator: v })}
            buttons={[
              { value: 'equals', label: he ? 'נמצא בתגית' : 'In tag' },
              { value: 'notEquals', label: he ? 'לא נמצא בתגית' : 'Not in tag' },
            ]}
          />
          <View style={[styles.chipsWrap, { flexDirection }]}>
            {row.groupValue.map((g) => (
              <Chip key={g} compact onClose={() => patchRow(idx, { groupValue: row.groupValue.filter((x) => x !== g) })} style={styles.chip}>
                {g}
              </Chip>
            ))}
            <Button mode="outlined" compact icon="tag-plus-outline" textColor={BRAND} onPress={() => setTagPickerFor(idx)}>
              {he ? 'בחר תגיות' : 'Pick tags'}
            </Button>
          </View>
        </View>
      );
    }

    if (row.filterType === 'contactField') {
      const def = fieldOf(row.fieldName);
      const cat = fieldCategory(def) || 'text';
      const ops = cat === 'number' ? OPS_NUMBER : cat === 'select' ? OPS_SELECT : OPS_TEXT;
      const needsValue = !NO_VALUE_OPS.includes(row.operator);
      return (
        <View key={idx} style={[styles.rowCard, card]}>
          {header(he ? 'שדה איש קשר' : 'Contact field')}
          <Button mode="outlined" icon="chevron-down" textColor={BRAND} onPress={() => setFieldPickerFor(idx)} contentStyle={{ flexDirection: 'row-reverse' }}>
            {def?.label || row.fieldName || (he ? 'בחר שדה' : 'Pick field')}
          </Button>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.opsRow, { flexDirection }]}>
            {ops.map((op) => (
              <Chip
                key={op.value}
                compact
                selected={row.operator === op.value}
                onPress={() => patchRow(idx, { operator: op.value })}
                style={styles.chip}
              >
                {opLabel(op)}
              </Chip>
            ))}
          </ScrollView>
          {needsValue &&
            (cat === 'select' && def?.options ? (
              <Button mode="outlined" icon="chevron-down" textColor={BRAND} onPress={() => setValuePickerFor(idx)} contentStyle={{ flexDirection: 'row-reverse' }}>
                {row.value || (he ? 'בחר ערך' : 'Pick value')}
              </Button>
            ) : (
              <TextInput
                mode="outlined"
                dense
                value={row.value}
                onChangeText={(v) => patchRow(idx, { value: v })}
                placeholder={he ? 'ערך' : 'Value'}
                keyboardType={cat === 'number' ? 'numeric' : 'default'}
                style={{ backgroundColor: theme.colors.surface, textAlign }}
                outlineColor={theme.colors.outline}
                activeOutlineColor={BRAND}
              />
            ))}
        </View>
      );
    }

    // Web-only filter (related record / campaign / task …): shown read-only and kept untouched.
    return (
      <View key={idx} style={[styles.rowCard, card]}>
        {header(he ? 'מסנן מתקדם (נערך באתר)' : 'Advanced filter (edit on web)')}
        <Text style={{ textAlign, color: theme.colors.onSurfaceVariant, fontSize: 12 }}>
          {row.filterType}
          {row.fieldName ? ` · ${row.fieldName}` : ''}
          {row.operator ? ` · ${row.operator}` : ''}
          {row.value ? ` · ${row.value}` : ''}
        </Text>
      </View>
    );
  };

  const tagItems: PickerItem[] = (tags || []).map((t) => ({ value: t, label: t }));
  const fieldItems: PickerItem[] = (fields || [])
    .filter((f) => fieldCategory(f) !== null)
    .map((f) => ({ value: f.name, label: f.label, subtitle: f.name !== f.label ? f.name : undefined }));
  const valueFieldDef = valuePickerFor !== null ? fieldOf(rows[valuePickerFor]?.fieldName || '') : undefined;

  return (
    <View>
      <SegmentedButtons
        value={mode}
        onValueChange={switchMode}
        density="small"
        buttons={[
          { value: 'all', label: he ? 'כל אנשי הקשר' : 'All contacts', icon: 'account-group-outline' },
          { value: 'filters', label: he ? 'סינון לפי תנאים' : 'Filter', icon: 'filter-outline' },
        ]}
      />

      {mode === 'filters' && (
        <View style={{ marginTop: 12, gap: 10 }}>
          {rows.length > 1 && (
            <View style={[styles.logicRow, { flexDirection }]}>
              <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 12 }}>{he ? 'התאמה:' : 'Match:'}</Text>
              <SegmentedButtons
                density="small"
                value={logic}
                onValueChange={(v) => update(rows, v === 'OR' ? 'OR' : 'AND')}
                buttons={[
                  { value: 'AND', label: he ? 'כל התנאים' : 'All rules' },
                  { value: 'OR', label: he ? 'אחד מהתנאים' : 'Any rule' },
                ]}
                style={{ flex: 1 }}
              />
            </View>
          )}
          {rows.map(renderRow)}
          <View style={[styles.addRow, { flexDirection }]}>
            <Button mode="outlined" compact icon="tag-outline" textColor={BRAND} onPress={() => update([...rows, newGroupFilter()])}>
              {he ? 'תגית' : 'Tag'}
            </Button>
            <Button mode="outlined" compact icon="form-textbox" textColor={BRAND} onPress={() => update([...rows, newFieldFilter()])}>
              {he ? 'שדה' : 'Field'}
            </Button>
          </View>
          {rows.some((r) => !isFilterComplete(r)) && (
            <Text style={{ color: theme.colors.error, fontSize: 12, textAlign }}>
              {he ? 'יש תנאים שלא הושלמו — הם לא ייכללו בספירה ולא יישמרו.' : 'Some rules are incomplete — they are ignored in the count and must be completed before saving.'}
            </Text>
          )}
        </View>
      )}

      {/* Live recipient count */}
      <View style={[styles.countBox, { flexDirection, backgroundColor: `${BRAND}14`, borderColor: `${BRAND}33` }]}>
        {counting ? <ActivityIndicator size="small" color={BRAND} /> : null}
        <Text style={{ flex: 1, textAlign, color: BRAND, fontWeight: '700' }}>
          {countError
            ? he ? 'לא ניתן לספור אנשי קשר כרגע' : 'Could not count contacts right now'
            : count === null
              ? he ? 'סופר אנשי קשר…' : 'Counting contacts…'
              : he ? `${count.toLocaleString()} אנשי קשר תואמים` : `${count.toLocaleString()} matching contacts`}
        </Text>
        {count !== null && count > 0 && !counting && (
          <Button compact mode="text" textColor={BRAND} onPress={() => setShowContacts(true)}>
            {he ? 'הצג' : 'View'}
          </Button>
        )}
      </View>
      <Text style={{ textAlign, color: theme.colors.onSurfaceVariant, fontSize: 11, marginTop: 6 }}>
        {he
          ? 'אנשי קשר ללא כתובת מייל או שהסירו את עצמם מהרשימה לא יקבלו את הקמפיין — בשלב האישור תראו את הרשימה המדויקת.'
          : 'Contacts without an email address, or who unsubscribed, are skipped — you will see the exact list in the review step.'}
      </Text>

      <PickerSheet
        visible={tagPickerFor !== null}
        title={he ? 'בחירת תגיות' : 'Select tags'}
        mode="multi"
        items={tagItems}
        loading={tags === null}
        selected={tagPickerFor !== null ? rows[tagPickerFor]?.groupValue || [] : []}
        emptyText={he ? 'לא נמצאו תגיות' : 'No tags found'}
        searchPlaceholder={he ? 'חיפוש' : 'Search'}
        confirmLabel={he ? 'אישור' : 'OK'}
        onDismiss={() => setTagPickerFor(null)}
        onConfirm={(sel) => tagPickerFor !== null && patchRow(tagPickerFor, { groupValue: sel })}
      />
      <PickerSheet
        visible={fieldPickerFor !== null}
        title={he ? 'בחירת שדה' : 'Select field'}
        mode="single"
        items={fieldItems}
        loading={fields === null}
        selected={fieldPickerFor !== null ? [rows[fieldPickerFor]?.fieldName || ''] : []}
        emptyText={he ? 'לא נמצאו שדות' : 'No fields found'}
        searchPlaceholder={he ? 'חיפוש' : 'Search'}
        onDismiss={() => setFieldPickerFor(null)}
        onConfirm={(sel) => fieldPickerFor !== null && patchRow(fieldPickerFor, { fieldName: sel[0], operator: 'equals', value: '' })}
      />
      <PickerSheet
        visible={valuePickerFor !== null}
        title={he ? 'בחירת ערך' : 'Select value'}
        mode="single"
        items={(valueFieldDef?.options || []).map((o) => ({ value: o, label: o }))}
        selected={valuePickerFor !== null ? [rows[valuePickerFor]?.value || ''] : []}
        onDismiss={() => setValuePickerFor(null)}
        onConfirm={(sel) => valuePickerFor !== null && patchRow(valuePickerFor, { value: sel[0] })}
      />
      <PickerSheet
        visible={showContacts}
        title={he ? `אנשי קשר (עד ${contacts.length})` : `Contacts (up to ${contacts.length})`}
        mode="view"
        items={contacts.map((c) => ({ value: c.phone, label: c.name || c.phone, subtitle: c.name ? c.phone : undefined }))}
        searchPlaceholder={he ? 'חיפוש לפי שם או טלפון' : 'Search by name or phone'}
        onDismiss={() => setShowContacts(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  rowCard: { borderWidth: 1, borderRadius: 12, padding: 10, gap: 8 },
  rowHeader: { alignItems: 'center' },
  chipsWrap: { flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  chip: { marginVertical: 2 },
  opsRow: { gap: 6, paddingVertical: 2 },
  logicRow: { alignItems: 'center', gap: 8 },
  addRow: { gap: 8 },
  countBox: { alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, marginTop: 12 },
});
