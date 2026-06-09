import React, { useState } from 'react';
import { View, StyleSheet, Pressable, ScrollView, TextInput } from 'react-native';
import { Text, Divider, Chip } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useAppTheme } from '../hooks/useAppTheme';
import { useRTL } from '../hooks/useRTL';

export interface DynamicField {
  labelEn?: string;
  labelHe?: string;
  label?: string;
  type?: string;
  options?: string[];
  required?: boolean;
  showOnForm?: boolean;
  showOnView?: boolean;
  textMultiline?: boolean;
  order?: number;
}

export interface DynamicSection {
  id: string;
  labelEn?: string;
  labelHe?: string;
  label?: string;
  collapseByDefault?: boolean;
  fields?: Record<string, DynamicField> | DynamicField[];
}

function getSectionLabel(section: DynamicSection, lang: 'en' | 'he'): string {
  if (lang === 'he' && section.labelHe) return section.labelHe;
  if (section.labelEn) return section.labelEn;
  return section.label || 'Section';
}

function getFieldLabel(field: DynamicField, lang: 'en' | 'he'): string {
  if (lang === 'he' && field.labelHe) return field.labelHe;
  if (field.labelEn) return field.labelEn;
  return field.label || '';
}

function getOrderedFields(section: DynamicSection): [string, DynamicField][] {
  const raw = section.fields;
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map((f: any, i: number) => [f.key || f.id || `field_${i}`, f as DynamicField])
      .sort(([, a], [, b]) => (a.order ?? 999) - (b.order ?? 999));
  }
  return Object.entries(raw).sort(([, a], [, b]) => ((a as DynamicField).order ?? 999) - ((b as DynamicField).order ?? 999));
}

function InfoRow({
  icon,
  label,
  value,
  theme,
  flexDirection,
  textAlign,
}: {
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  label: string;
  value: string;
  theme: any;
  flexDirection: 'row' | 'row-reverse';
  textAlign: 'left' | 'right';
}) {
  return (
    <View style={[styles.infoRow, { flexDirection }]}>
      <MaterialCommunityIcons
        name={icon}
        size={20}
        color={theme.colors.onSurfaceVariant}
        style={{ marginEnd: 12 }}
      />
      <View style={styles.infoRowText}>
        <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant, textAlign }}>
          {label}
        </Text>
        <Text variant="bodyMedium" style={{ color: theme.colors.onSurface, textAlign, fontWeight: '500' }}>
          {value}
        </Text>
      </View>
    </View>
  );
}

function formatFieldValue(value: any, field: DynamicField): string {
  if (value == null || value === '') return '';
  if (field.type === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}

interface DynamicFieldsSectionViewProps {
  sections: DynamicSection[];
  data: Record<string, any> | null | undefined;
  lang?: 'en' | 'he';
  formLayout?: string[];
}

export function DynamicFieldsSectionView({
  sections,
  data,
  lang = 'en',
  formLayout = [],
}: DynamicFieldsSectionViewProps) {
  const safeData: Record<string, any> = data ?? {};
  const theme = useAppTheme();
  const { flexDirection, textAlign } = useRTL();
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    sections.forEach((s) => {
      init[s.id] = !s.collapseByDefault;
    });
    return init;
  });

  const hasFields = (s: DynamicSection) => {
    if (!s.fields) return false;
    if (Array.isArray(s.fields)) return s.fields.length > 0;
    return Object.keys(s.fields).length > 0;
  };

  const sectionsWithFields = sections.filter(hasFields);

  const orderedSectionIds =
    formLayout.length > 0
      ? formLayout.filter((id) => sectionsWithFields.some((s) => `custom_section_${s.id}` === id))
      : sectionsWithFields.map((s) => `custom_section_${s.id}`);

  const orderedSections = orderedSectionIds
    .map((id) => {
      const sectionId = id.replace('custom_section_', '');
      return sectionsWithFields.find((s) => s.id === sectionId);
    })
    .filter(Boolean) as DynamicSection[];

  if (orderedSections.length === 0) return null;

  return (
    <>
      {orderedSections.map((section) => {
        const fields = getOrderedFields(section).filter(
          ([, f]) => f.showOnView !== false,
        );
        const hasData = fields.some(([key]) => {
          const v = safeData[key];
          return v != null && v !== '' && (Array.isArray(v) ? v.length > 0 : true);
        });
        if (!hasData) return null;

        const isExpanded = expandedSections[section.id] ?? true;
        const sectionLabel = getSectionLabel(section, lang);

        return (
          <View
            key={section.id}
            style={[styles.sectionCard, { backgroundColor: theme.colors.surface }]}
          >
            <Pressable
              onPress={() =>
                setExpandedSections((prev) => ({
                  ...prev,
                  [section.id]: !prev[section.id],
                }))
              }
              style={[styles.sectionHeader, { flexDirection }]}
            >
              <Text
                variant="titleSmall"
                style={{ color: theme.colors.onSurface, fontWeight: '600', flex: 1 }}
              >
                {sectionLabel}
              </Text>
              <MaterialCommunityIcons
                name={isExpanded ? 'chevron-up' : 'chevron-down'}
                size={20}
                color={theme.colors.onSurfaceVariant}
              />
            </Pressable>
            {isExpanded &&
              fields.map(([fieldKey, field], idx) => {
                const value = safeData[fieldKey];
                const displayValue = formatFieldValue(value, field);
                if (!displayValue) return null;
                return (
                  <React.Fragment key={fieldKey}>
                    {idx > 0 ? <Divider style={styles.cardDivider} /> : null}
                    <InfoRow
                      icon="text-box-outline"
                      label={getFieldLabel(field, lang) || fieldKey}
                      value={displayValue}
                      theme={theme}
                      flexDirection={flexDirection}
                      textAlign={textAlign}
                    />
                  </React.Fragment>
                );
              })}
          </View>
        );
      })}
    </>
  );
}

// Collect every field key declared across the custom sections, so a generic
// "additional details" view can avoid re-rendering fields already shown.
export function getSectionFieldKeys(sections: DynamicSection[] | null | undefined): string[] {
  if (!sections) return [];
  const keys: string[] = [];
  sections.forEach((s) => {
    getOrderedFields(s).forEach(([k]) => keys.push(k));
  });
  return keys;
}

// Technical/internal keys that should never be surfaced to the user, regardless of value.
const SYSTEM_KEYS = new Set<string>([
  'id', 'Id', 'ID', '_id', 'docId', 'key', 'uid',
  'orgId', 'organization', 'organizationId', 'companyId', 'tenantId',
  'ownerId', 'assignedToId', 'assignedTo', 'contactId', 'userId',
  'createdBy', 'createdById', 'updatedBy', 'updatedById',
  'createdAt', 'created_at', 'createdOn', 'updatedAt', 'updated_at', 'updatedOn',
  'deletedAt', 'timestamp', '__v', 'v', 'version', 'isDeleted', 'deleted',
  'type', 'entityType', 'stage', 'stageName', 'stageId', 'stageColor',
  'pipeline', 'pipelineId', 'color', 'icon', 'avatar', 'photoUrl', 'photoURL',
  'history', 'timeline', 'events', 'metadata', 'raw', 'customFields',
  'formSections', 'formLayout', 'sections', 'layout', 'settings',
]);

function humanizeKey(key: string): string {
  const withSpaces = key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim();
  if (!withSpaces) return key;
  return withSpaces.charAt(0).toUpperCase() + withSpaces.slice(1);
}

function isDisplayableExtraValue(v: any): boolean {
  if (v == null || v === '') return false;
  if (Array.isArray(v)) return v.length > 0 && v.every((x) => x != null && typeof x !== 'object');
  if (typeof v === 'object') return false; // skip nested objects / complex structures
  return true;
}

function formatExtraValue(v: any): string {
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (Array.isArray(v)) return v.join(', ');
  return String(v);
}

interface ExtraFieldsSectionViewProps {
  data: Record<string, any> | null | undefined;
  // Keys already rendered elsewhere on the screen (built-in fields, contact header, etc.)
  excludeKeys?: string[];
  lang?: 'en' | 'he';
  title?: string;
  // Whether to expand by default. Defaults to collapsed (matches large-app "show more" pattern).
  defaultExpanded?: boolean;
}

// Generic catch-all: shows any populated, simple field that isn't already displayed and
// isn't an internal/system key. Collapsed by default to keep the view tidy.
export function ExtraFieldsSectionView({
  data,
  excludeKeys = [],
  lang = 'en',
  title,
  defaultExpanded = false,
}: ExtraFieldsSectionViewProps) {
  const theme = useAppTheme();
  const { flexDirection, textAlign } = useRTL();
  const [expanded, setExpanded] = useState(defaultExpanded);

  const safeData: Record<string, any> = data ?? {};
  const exclude = new Set<string>([...SYSTEM_KEYS, ...excludeKeys]);
  const entries = Object.entries(safeData).filter(
    ([k, v]) => !exclude.has(k) && isDisplayableExtraValue(v),
  );

  if (entries.length === 0) return null;

  const heading = title || (lang === 'he' ? 'פרטים נוספים' : 'Additional details');

  return (
    <View style={[styles.sectionCard, { backgroundColor: theme.colors.surface }]}>
      <Pressable
        onPress={() => setExpanded((e) => !e)}
        style={[styles.sectionHeader, { flexDirection }]}
      >
        <Text
          variant="titleSmall"
          style={{ color: theme.colors.onSurface, fontWeight: '600', flex: 1 }}
        >
          {`${heading} (${entries.length})`}
        </Text>
        <MaterialCommunityIcons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={20}
          color={theme.colors.onSurfaceVariant}
        />
      </Pressable>
      {expanded &&
        entries.map(([fieldKey, value], idx) => (
          <React.Fragment key={fieldKey}>
            {idx > 0 ? <Divider style={styles.cardDivider} /> : null}
            <InfoRow
              icon="information-outline"
              label={humanizeKey(fieldKey)}
              value={formatExtraValue(value)}
              theme={theme}
              flexDirection={flexDirection}
              textAlign={textAlign}
            />
          </React.Fragment>
        ))}
    </View>
  );
}

interface DynamicFieldsSectionFormProps {
  sections: DynamicSection[];
  values: Record<string, any>;
  onChange: (key: string, value: any) => void;
  lang?: 'en' | 'he';
  formLayout?: string[];
  theme: any;
  textAlign: 'left' | 'right';
  writingDirection: 'ltr' | 'rtl';
  flexDirection: 'row' | 'row-reverse';
}

export function DynamicFieldsSectionForm({
  sections,
  values,
  onChange,
  lang = 'en',
  formLayout = [],
  theme,
  textAlign,
  writingDirection,
  flexDirection,
}: DynamicFieldsSectionFormProps) {
  const hasFields = (s: DynamicSection) => {
    if (!s.fields) return false;
    if (Array.isArray(s.fields)) return s.fields.length > 0;
    return Object.keys(s.fields).length > 0;
  };

  const sectionsWithFields = sections.filter(hasFields);

  const orderedSectionIds =
    formLayout.length > 0
      ? formLayout.filter((id) => sectionsWithFields.some((s) => `custom_section_${s.id}` === id))
      : sectionsWithFields.map((s) => `custom_section_${s.id}`);

  const orderedSections = orderedSectionIds
    .map((id) => {
      const sectionId = id.replace('custom_section_', '');
      return sectionsWithFields.find((s) => s.id === sectionId);
    })
    .filter(Boolean) as DynamicSection[];

  if (orderedSections.length === 0) return null;

  return (
    <>
      {orderedSections.map((section) => {
        const sectionLabel = getSectionLabel(section, lang);
        const fields = getOrderedFields(section).filter(
          ([, f]) => f.showOnForm !== false,
        );
        if (fields.length === 0) return null;

        return (
          <View key={section.id} style={styles.formSection}>
            <Text
              variant="titleSmall"
              style={{ color: theme.colors.onSurface, fontWeight: '600', marginBottom: 12, textAlign }}
            >
              {sectionLabel}
            </Text>
            {fields.map(([fieldKey, field]) => {
              const label = getFieldLabel(field, lang) || fieldKey;
              const value = values[fieldKey];

              if (field.type === 'select' || field.type === 'multi-select') {
                const options = field.options || [];
                const currentVal = value;
                const isMulti = field.type === 'multi-select';
                return (
                  <View key={fieldKey} style={styles.formField}>
                    <Text
                      variant="labelMedium"
                      style={{ color: theme.colors.onSurfaceVariant, marginBottom: 6, textAlign }}
                    >
                      {label}
                    </Text>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={[styles.chipsRow, { flexDirection }]}
                    >
                      {options.map((opt) => {
                        const selected = isMulti
                          ? Array.isArray(currentVal) && currentVal.includes(opt)
                          : currentVal === opt;
                        return (
                          <Chip
                            key={opt}
                            selected={selected}
                            onPress={() => {
                              if (isMulti) {
                                const arr = Array.isArray(currentVal) ? [...currentVal] : [];
                                const idx = arr.indexOf(opt);
                                if (idx >= 0) arr.splice(idx, 1);
                                else arr.push(opt);
                                onChange(fieldKey, arr);
                              } else {
                                onChange(fieldKey, selected ? '' : opt);
                              }
                            }}
                            compact
                            style={[
                              styles.formChip,
                              selected
                                ? {
                                    backgroundColor: `${theme.colors.primary}25`,
                                    borderColor: theme.colors.primary,
                                    borderWidth: 1,
                                  }
                                : { backgroundColor: theme.colors.surfaceVariant },
                            ]}
                            textStyle={{
                              fontSize: 12,
                              color: selected ? theme.colors.primary : theme.colors.onSurfaceVariant,
                              fontWeight: selected ? '600' : '400',
                            }}
                          >
                            {opt}
                          </Chip>
                        );
                      })}
                    </ScrollView>
                  </View>
                );
              }

              if (field.type === 'boolean') {
                const boolVal = value;
                return (
                  <View key={fieldKey} style={styles.formField}>
                    <Text
                      variant="labelMedium"
                      style={{ color: theme.colors.onSurfaceVariant, marginBottom: 6, textAlign }}
                    >
                      {label}
                    </Text>
                    <View style={[styles.chipsRow, { flexDirection }]}>
                      {[true, false].map((v) => (
                        <Chip
                          key={String(v)}
                          selected={boolVal === v}
                          onPress={() => onChange(fieldKey, v)}
                          compact
                          style={[
                            styles.formChip,
                            boolVal === v
                              ? {
                                  backgroundColor: `${theme.colors.primary}25`,
                                  borderColor: theme.colors.primary,
                                  borderWidth: 1,
                                }
                              : { backgroundColor: theme.colors.surfaceVariant },
                          ]}
                          textStyle={{
                            fontSize: 12,
                            color: boolVal === v ? theme.colors.primary : theme.colors.onSurfaceVariant,
                            fontWeight: boolVal === v ? '600' : '400',
                          }}
                        >
                          {v ? 'Yes' : 'No'}
                        </Chip>
                      ))}
                    </View>
                  </View>
                );
              }

              return (
                <View key={fieldKey} style={styles.formField}>
                  <Text
                    variant="labelMedium"
                    style={{ color: theme.colors.onSurfaceVariant, marginBottom: 6, textAlign }}
                  >
                    {label}
                  </Text>
                  <TextInput
                    value={String(value ?? '')}
                    onChangeText={(v) => onChange(fieldKey, v)}
                    placeholder={
                      field.type === 'date'
                        ? 'YYYY-MM-DD'
                        : field.type === 'datetime'
                        ? 'YYYY-MM-DD HH:MM'
                        : ''
                    }
                    style={[
                      styles.formInput,
                      {
                        backgroundColor: theme.custom?.inputBackground || theme.colors.surfaceVariant,
                        color: theme.colors.onSurface,
                        textAlign,
                        writingDirection,
                        borderColor: theme.colors.outline,
                      },
                      field.textMultiline && { height: 100, textAlignVertical: 'top' },
                    ]}
                    placeholderTextColor={theme.custom?.placeholder}
                    multiline={field.textMultiline}
                    keyboardType={
                      field.type === 'number'
                        ? 'numeric'
                        : field.type === 'date' || field.type === 'datetime'
                        ? 'numbers-and-punctuation'
                        : 'default'
                    }
                  />
                </View>
              );
            })}
          </View>
        );
      })}
    </>
  );
}

const styles = StyleSheet.create({
  sectionCard: {
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 16,
    borderRadius: 12,
  },
  sectionHeader: {
    alignItems: 'center',
    marginBottom: 8,
  },
  cardDivider: { marginVertical: 12 },
  infoRow: { alignItems: 'center' },
  infoRowText: { flex: 1 },
  formSection: { marginBottom: 20 },
  formField: { marginBottom: 16 },
  formInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  formChip: { height: 32, marginEnd: 6 },
  chipsRow: { gap: 8, flexWrap: 'wrap', alignItems: 'center' },
});
