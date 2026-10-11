import React, { useMemo, useState } from 'react';
import { View, ScrollView, Pressable, StyleSheet } from 'react-native';
import { Text, Chip, Button, Portal, Modal, TextInput } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useRTL } from '../../hooks/useRTL';
import GambotDateTimePicker from '../GambotDateTimePicker';
import {
  countActiveFilterGroups,
  makeDateFilter,
  type ConsentBucket,
  type ContactFilterState,
  type ContactSort,
  type ConvStatusBucket,
  type DateFilter,
  type TagsOperator,
} from '../../services/contactFilters';

interface Props {
  visible: boolean;
  onDismiss: () => void;
  filters: ContactFilterState;
  onChange: (partial: Partial<ContactFilterState>) => void;
  onClearAll: () => void;
  onSaveView: () => void;
  resultCount: number;
  owners: string[];
  tags: string[];
  // false when the user can only see their own contacts (owner filters are meaningless then)
  showOwnerFilters: boolean;
  canFilterMine: boolean;
}

const COLLAPSED_CHIPS = 10;

function toYmd(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
}

function Section({ title, children, hint }: { title: string; children: React.ReactNode; hint?: React.ReactNode }) {
  const theme = useAppTheme();
  const { flexDirection, textAlign } = useRTL();
  return (
    <View style={styles.section}>
      <View style={{ flexDirection, alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <Text variant="labelLarge" style={{ color: theme.colors.onSurface, fontWeight: '700', textAlign }}>
          {title}
        </Text>
        {hint}
      </View>
      {children}
    </View>
  );
}

function Wrap({ children }: { children: React.ReactNode }) {
  const { flexDirection } = useRTL();
  return <View style={[styles.wrap, { flexDirection }]}>{children}</View>;
}

function OptChip({
  label,
  active,
  onPress,
  icon,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  icon?: string;
}) {
  const theme = useAppTheme();
  return (
    <Chip
      selected={active}
      showSelectedCheck={false}
      icon={active ? 'check' : icon}
      onPress={onPress}
      compact
      style={{ backgroundColor: active ? theme.colors.primaryContainer : theme.colors.surfaceVariant }}
      textStyle={{
        color: active ? theme.colors.onPrimaryContainer : theme.colors.onSurfaceVariant,
        fontSize: 13,
        fontWeight: active ? '600' : '400',
      }}
    >
      {label}
    </Chip>
  );
}
export default function ContactFiltersSheet({
  visible,
  onDismiss,
  filters,
  onChange,
  onClearAll,
  onSaveView,
  resultCount,
  owners,
  tags,
  showOwnerFilters,
  canFilterMine,
}: Props) {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const { flexDirection, textAlign } = useRTL();
  const { t, i18n } = useTranslation();
  const L = (he: string, en: string) => (i18n.language === 'en' ? en : he);

  const [ownersExpanded, setOwnersExpanded] = useState(false);
  const [tagsExpanded, setTagsExpanded] = useState(false);
  const [tagSearch, setTagSearch] = useState('');
  const [picker, setPicker] = useState<{ which: 'created' | 'activity'; edge: 'start' | 'end' } | null>(null);

  const activeCount = countActiveFilterGroups(filters);

  const visibleTags = useMemo(() => {
    const q = tagSearch.trim().toLowerCase();
    const list = q ? tags.filter((x) => x.toLowerCase().includes(q)) : tags;
    // Selected tags always stay visible even when collapsed.
    if (tagsExpanded || q) return list;
    const head = list.slice(0, COLLAPSED_CHIPS);
    const extra = filters.tags.filter((x) => !head.includes(x));
    return [...head, ...extra];
  }, [tags, tagSearch, tagsExpanded, filters.tags]);

  const visibleOwners = useMemo(() => {
    if (ownersExpanded) return owners;
    const head = owners.slice(0, COLLAPSED_CHIPS);
    const extra = filters.owners.filter((x) => !head.includes(x));
    return [...head, ...extra];
  }, [owners, ownersExpanded, filters.owners]);

  // ── Date filter block (presets + custom range) ──────────────────────────────────────────────
  const renderDateBlock = (which: 'created' | 'activity', value: DateFilter | null, withDormant?: boolean) => {
    const set = (v: DateFilter | null) => onChange(which === 'created' ? { created: v } : { activity: v });
    const is = (op: string, days = '') => !!value && value.operator === op && (days === '' || value.daysValue === days);
    const isCustom = !!value && value.operator === 'between';
    const presets: { label: string; op: DateFilter['operator']; days?: string }[] = [
      { label: L('היום', 'Today'), op: 'is_today' },
      { label: L('אתמול', 'Yesterday'), op: 'is_yesterday' },
      { label: L('7 ימים אחרונים', 'Last 7 days'), op: 'is_in_last_x_days', days: '7' },
      { label: L('30 ימים אחרונים', 'Last 30 days'), op: 'is_in_last_x_days', days: '30' },
      { label: L('90 ימים אחרונים', 'Last 90 days'), op: 'is_in_last_x_days', days: '90' },
    ];
    if (withDormant) {
      presets.push(
        { label: L('ללא פעילות 30 יום', 'Inactive 30 days'), op: 'not_in_last_x_days', days: '30' },
        { label: L('ללא פעילות 90 יום', 'Inactive 90 days'), op: 'not_in_last_x_days', days: '90' },
      );
    }
    return (
      <>
        <Wrap>
          {presets.map((p) => {
            const active = is(p.op, p.days ?? '');
            return (
              <OptChip
                key={p.label}
                label={p.label}
                active={active}
                onPress={() => set(active ? null : makeDateFilter(p.op, p.days ?? ''))}
              />
            );
          })}
          <OptChip
            label={L('טווח מותאם', 'Custom range')}
            icon="calendar-range"
            active={isCustom}
            onPress={() => (isCustom ? set(null) : setPicker({ which, edge: 'start' }))}
          />
        </Wrap>
        {isCustom ? (
          <View style={{ flexDirection, gap: 8, marginTop: 8 }}>
            {(['start', 'end'] as const).map((edge) => {
              const v = edge === 'start' ? value!.startDate : value!.endDate;
              return (
                <Pressable
                  key={edge}
                  onPress={() => setPicker({ which, edge })}
                  style={[styles.dateBtn, { borderColor: theme.colors.outline, flexDirection }]}
                >
                  <MaterialCommunityIcons name="calendar" size={16} color={theme.colors.onSurfaceVariant} />
                  <Text style={{ color: v ? theme.colors.onSurface : theme.colors.onSurfaceVariant, fontSize: 13 }}>
                    {(edge === 'start' ? L('מתאריך', 'From') : L('עד תאריך', 'To')) + (v ? `: ${v}` : '')}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}
      </>
    );
  };

  const pickerValue = (() => {
    if (!picker) return null;
    const f = picker.which === 'created' ? filters.created : filters.activity;
    const s = f && f.operator === 'between' ? (picker.edge === 'start' ? f.startDate : f.endDate) : '';
    return s ? new Date(`${s}T12:00:00`) : new Date();
  })();

  const applyPicked = (d: Date | null) => {
    if (!picker) return;
    const cur = picker.which === 'created' ? filters.created : filters.activity;
    const base: DateFilter =
      cur && cur.operator === 'between' ? cur : makeDateFilter('between', '', '', '');
    const next: DateFilter = {
      ...base,
      ...(picker.edge === 'start' ? { startDate: d ? toYmd(d) : '' } : { endDate: d ? toYmd(d) : '' }),
    };
    const empty = !next.startDate && !next.endDate;
    onChange(picker.which === 'created' ? { created: empty ? null : next } : { activity: empty ? null : next });
    setPicker(null);
  };

  const tagOps: { key: TagsOperator; label: string }[] = [
    { key: 'any', label: L('אחד מהם (או)', 'Any (OR)') },
    { key: 'all', label: L('כולם (וגם)', 'All (AND)') },
    { key: 'none', label: L('ללא אלו', 'None of') },
  ];

  const consentOpts: { key: ConsentBucket; label: string }[] = [
    { key: 'agreed', label: L('אישר קבלת הודעות', 'Opted in') },
    { key: 'notAgreed', label: L('לא הסכים / הוסר', 'Opted out') },
    { key: 'noRecord', label: L('אין רישום', 'No record') },
    { key: 'spam', label: L('ספאם', 'Spam') },
  ];

  const convOpts: { key: ConvStatusBucket; label: string }[] = [
    { key: 'Open', label: L('פתוח', 'Open') },
    { key: 'In Process', label: L('בטיפול', 'In process') },
    { key: 'Closed', label: L('סגור', 'Closed') },
  ];

  const sortOpts: { key: ContactSort; label: string }[] = [
    { key: '', label: L('פעילות אחרונה', 'Last activity') },
    { key: 'name', label: t('contacts.name', L('שם', 'Name')) },
    { key: 'createdOn', label: t('contacts.createdAt', L('תאריך יצירה', 'Created')) },
  ];

  return (
    <>
      <Portal>
        <Modal
          visible={visible}
          onDismiss={onDismiss}
          style={{ justifyContent: 'flex-end' }}
          contentContainerStyle={[
            styles.sheet,
            { backgroundColor: theme.colors.surface, paddingBottom: Math.max(insets.bottom, 12) },
          ]}
        >
          {/* Header */}
          <View style={[styles.sheetHeader, { flexDirection, borderBottomColor: theme.colors.outlineVariant }]}>
            <Text variant="titleLarge" style={{ color: theme.colors.onSurface, fontWeight: '700', flex: 1, textAlign }}>
              {L('סינון מתקדם', 'Filters')}
              {activeCount > 0 ? `  (${activeCount})` : ''}
            </Text>
            {activeCount > 0 ? (
              <Button compact onPress={onClearAll} textColor={theme.colors.error}>
                {L('נקה הכל', 'Clear all')}
              </Button>
            ) : null}
            <Pressable onPress={onDismiss} hitSlop={10} style={{ padding: 6 }}>
              <MaterialCommunityIcons name="close" size={22} color={theme.colors.onSurfaceVariant} />
            </Pressable>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingHorizontal: 18, paddingTop: 12, paddingBottom: 8 }}
          >
            {/* Owner */}
            {showOwnerFilters ? (
              <Section title={t('contacts.owner', L('אחראי', 'Owner'))}>
                <Wrap>
                  {canFilterMine ? (
                    <OptChip
                      label={L('שלי', 'Mine')}
                      icon="account"
                      active={filters.mine}
                      onPress={() => onChange({ mine: !filters.mine })}
                    />
                  ) : null}
                  <OptChip
                    label={L('ללא אחראי', 'Unassigned')}
                    icon="account-off-outline"
                    active={filters.unassigned}
                    onPress={() => onChange({ unassigned: !filters.unassigned })}
                  />
                  {visibleOwners.map((o) => (
                    <OptChip
                      key={o}
                      label={o}
                      active={filters.owners.includes(o)}
                      onPress={() => onChange({ owners: toggle(filters.owners, o) })}
                    />
                  ))}
                </Wrap>
                {owners.length > COLLAPSED_CHIPS ? (
                  <Button compact onPress={() => setOwnersExpanded((v) => !v)} style={{ alignSelf: 'flex-start' }}>
                    {ownersExpanded ? L('הצג פחות', 'Show less') : L(`הצג הכל (${owners.length})`, `Show all (${owners.length})`)}
                  </Button>
                ) : null}
              </Section>
            ) : null}

            {/* Tags */}
            {tags.length > 0 ? (
              <Section
                title={t('contacts.tags', L('תגיות', 'Tags'))}
                hint={
                  filters.tags.length > 0 ? (
                    <Pressable onPress={() => onChange({ tags: [] })} hitSlop={8}>
                      <Text style={{ color: theme.colors.primary, fontSize: 12 }}>{L('נקה', 'Clear')}</Text>
                    </Pressable>
                  ) : null
                }
              >
                {filters.tags.length > 1 ? (
                  <Wrap>
                    {tagOps.map((op) => (
                      <OptChip
                        key={op.key}
                        label={op.label}
                        active={filters.tagsOperator === op.key}
                        onPress={() => onChange({ tagsOperator: op.key })}
                      />
                    ))}
                  </Wrap>
                ) : null}
                {tags.length > 15 ? (
                  <TextInput
                    mode="outlined"
                    dense
                    value={tagSearch}
                    onChangeText={setTagSearch}
                    placeholder={L('חפש תגית...', 'Find a tag...')}
                    left={<TextInput.Icon icon="magnify" />}
                    style={{ marginVertical: 8, fontSize: 13, textAlign }}
                  />
                ) : null}
                <Wrap>
                  {visibleTags.map((tag) => (
                    <OptChip
                      key={tag}
                      label={`#${tag}`}
                      active={filters.tags.includes(tag)}
                      onPress={() => onChange({ tags: toggle(filters.tags, tag) })}
                    />
                  ))}
                </Wrap>
                {tags.length > COLLAPSED_CHIPS && !tagSearch ? (
                  <Button compact onPress={() => setTagsExpanded((v) => !v)} style={{ alignSelf: 'flex-start' }}>
                    {tagsExpanded ? L('הצג פחות', 'Show less') : L(`הצג הכל (${tags.length})`, `Show all (${tags.length})`)}
                  </Button>
                ) : null}
              </Section>
            ) : null}

            {/* Consent */}
            <Section title={L('הסכמה לקבלת הודעות', 'Consent')}>
              <Wrap>
                {consentOpts.map((o) => (
                  <OptChip
                    key={o.key}
                    label={o.label}
                    active={filters.consent.includes(o.key)}
                    onPress={() => onChange({ consent: toggle(filters.consent, o.key) })}
                  />
                ))}
              </Wrap>
            </Section>

            {/* Conversation status */}
            <Section title={L('סטטוס שיחה', 'Conversation status')}>
              <Wrap>
                {convOpts.map((o) => (
                  <OptChip
                    key={o.key}
                    label={o.label}
                    active={filters.convStatus.includes(o.key)}
                    onPress={() => onChange({ convStatus: toggle(filters.convStatus, o.key) })}
                  />
                ))}
              </Wrap>
            </Section>

            {/* Created */}
            <Section title={L('תאריך יצירה', 'Created')}>
              {renderDateBlock('created', filters.created)}
            </Section>

            {/* Last activity */}
            <Section title={L('פעילות אחרונה', 'Last activity')}>
              {renderDateBlock('activity', filters.activity, true)}
            </Section>

            {/* Other */}
            <Section title={L('עוד', 'More')}>
              <Wrap>
                <OptChip
                  label={L('יש אימייל', 'Has email')}
                  icon="email-outline"
                  active={filters.hasEmail === true}
                  onPress={() => onChange({ hasEmail: filters.hasEmail === true ? null : true })}
                />
                <OptChip
                  label={L('ללא אימייל', 'No email')}
                  icon="email-off-outline"
                  active={filters.hasEmail === false}
                  onPress={() => onChange({ hasEmail: filters.hasEmail === false ? null : false })}
                />
                <OptChip
                  label={L('לא נקראו', 'Unread')}
                  icon="message-badge-outline"
                  active={filters.unread}
                  onPress={() => onChange({ unread: !filters.unread })}
                />
              </Wrap>
            </Section>

            {/* Sort */}
            <Section title={t('contacts.sortBy', L('מיון', 'Sort by'))}>
              <Wrap>
                {sortOpts.map((o) => (
                  <OptChip
                    key={o.key || 'modifiedOn'}
                    label={o.label}
                    icon={filters.sortBy === o.key ? undefined : 'sort'}
                    active={filters.sortBy === o.key}
                    onPress={() => onChange({ sortBy: o.key })}
                  />
                ))}
              </Wrap>
            </Section>
          </ScrollView>

          {/* Footer */}
          <View style={[styles.footer, { flexDirection, borderTopColor: theme.colors.outlineVariant }]}>
            <Button
              mode="outlined"
              icon="content-save-outline"
              onPress={onSaveView}
              disabled={activeCount === 0 && !filters.sortBy}
              style={{ flexShrink: 1 }}
            >
              {L('שמור כתצוגה', 'Save as view')}
            </Button>
            <Button
              mode="contained"
              onPress={onDismiss}
              buttonColor={theme.colors.primary}
              textColor="#FFF"
              style={{ flex: 1 }}
            >
              {L(`הצג ${resultCount.toLocaleString()} אנשי קשר`, `Show ${resultCount.toLocaleString()} contacts`)}
            </Button>
          </View>
        </Modal>
      </Portal>

      <GambotDateTimePicker
        visible={!!picker}
        mode="date"
        value={pickerValue}
        title={picker?.edge === 'end' ? L('עד תאריך', 'To date') : L('מתאריך', 'From date')}
        allowClear
        onConfirm={(d) => applyPicked(d)}
        onClear={() => applyPicked(null)}
        onDismiss={() => setPicker(null)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '88%',
    overflow: 'hidden',
  },
  sheetHeader: {
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 10,
    gap: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  section: { marginBottom: 18 },
  wrap: { flexWrap: 'wrap', gap: 8 },
  dateBtn: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  footer: {
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 18,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
