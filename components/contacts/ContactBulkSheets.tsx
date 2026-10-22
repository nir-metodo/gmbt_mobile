import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Modal as RNModal,
  Pressable,
  ScrollView,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  TextInput as RNTextInput,
} from 'react-native';
import { Text, Button, ActivityIndicator } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useRTL } from '../../hooks/useRTL';
import { withAlpha } from '../../utils/formatters';
import { chatsApi } from '../../services/api/chats';
import { usersApi } from '../../services/api/users';
import axiosInstance from '../../services/api/axiosInstance';
import { ENDPOINTS } from '../../constants/api';
import type { Contact, WabaNumberInfo } from '../../types';

// Bottom sheets used by the Contacts multi-select bulk action bar:
//   tags (add / remove), conversation status, owner, send WhatsApp message (text or template).
// Each sheet only collects the user's choice (or, for "send", performs the sends itself because it
// needs live progress); the Contacts screen applies the tag / status / owner changes.

// ─────────────────────────────────────────────────────────────────────────────
// Generic bottom sheet shell
// ─────────────────────────────────────────────────────────────────────────────
function Sheet({
  visible,
  onDismiss,
  title,
  subtitle,
  icon,
  children,
  footer,
  locked,
}: {
  visible: boolean;
  onDismiss: () => void;
  title: string;
  subtitle?: string;
  icon: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  locked?: boolean;
}) {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const { flexDirection, textAlign } = useRTL();
  return (
    <RNModal visible={visible} transparent animationType="slide" onRequestClose={locked ? undefined : onDismiss} statusBarTranslucent>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={styles.backdrop} onPress={locked ? undefined : onDismiss} />
        <View
          style={[
            styles.sheet,
            { backgroundColor: theme.colors.surface, paddingBottom: Math.max(insets.bottom, 12) },
          ]}
        >
          <View style={[styles.grabber, { backgroundColor: theme.colors.outline }]} />
          <View style={[styles.sheetHeader, { flexDirection }]}>
            <View style={[styles.sheetIcon, { backgroundColor: withAlpha(theme.colors.primary, 0.12) }]}>
              <MaterialCommunityIcons name={icon as any} size={20} color={theme.colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text variant="titleMedium" style={{ color: theme.colors.onSurface, fontWeight: '700', textAlign }}>
                {title}
              </Text>
              {subtitle ? (
                <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, textAlign }}>
                  {subtitle}
                </Text>
              ) : null}
            </View>
            <Pressable onPress={onDismiss} disabled={locked} hitSlop={10} style={{ padding: 4, opacity: locked ? 0.4 : 1 }}>
              <MaterialCommunityIcons name="close" size={22} color={theme.colors.onSurfaceVariant} />
            </Pressable>
          </View>
          {children}
          {footer ? <View style={{ marginTop: 12 }}>{footer}</View> : null}
        </View>
      </KeyboardAvoidingView>
    </RNModal>
  );
}

function Pill({
  label,
  active,
  color,
  icon,
  onPress,
}: {
  label: string;
  active?: boolean;
  color: string;
  icon?: string;
  onPress: () => void;
}) {
  const theme = useAppTheme();
  const fg = active ? color : theme.colors.onSurfaceVariant;
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.pill,
        {
          backgroundColor: active ? withAlpha(color, 0.14) : theme.colors.surfaceVariant,
          borderColor: active ? color : 'transparent',
        },
      ]}
    >
      {icon ? <MaterialCommunityIcons name={icon as any} size={14} color={fg} /> : null}
      <Text style={{ fontSize: 13, fontWeight: active ? '700' : '500', color: fg }} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

type TrFn = (he: string, en: string) => string;

// ─────────────────────────────────────────────────────────────────────────────
// Tags
// ─────────────────────────────────────────────────────────────────────────────
export function BulkTagsSheet({
  visible,
  onDismiss,
  count,
  allTags,
  tagsOnSelected,
  onApply,
  tr,
}: {
  visible: boolean;
  onDismiss: () => void;
  count: number;
  allTags: string[];
  tagsOnSelected: string[];
  onApply: (op: 'add' | 'remove', tags: string[]) => void;
  tr: TrFn;
}) {
  const theme = useAppTheme();
  const { flexDirection, textAlign, isRTL } = useRTL();
  const [mode, setMode] = useState<'add' | 'remove'>('add');
  const [picked, setPicked] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [created, setCreated] = useState<string[]>([]);

  useEffect(() => {
    if (visible) {
      setMode('add');
      setPicked([]);
      setDraft('');
      setCreated([]);
    }
  }, [visible]);

  useEffect(() => {
    setPicked([]);
  }, [mode]);

  const pool = useMemo(() => {
    if (mode === 'remove') return [...tagsOnSelected].sort((a, b) => a.localeCompare(b));
    const set = new Set<string>([...created, ...allTags]);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [mode, allTags, tagsOnSelected, created]);

  const q = draft.trim().replace(/#/g, '');
  const visibleTags = useMemo(
    () => (q ? pool.filter((x) => x.toLowerCase().includes(q.toLowerCase())) : pool),
    [pool, q],
  );
  const canCreate = mode === 'add' && !!q && !pool.some((x) => x.toLowerCase() === q.toLowerCase());

  const toggleTag = (tag: string) =>
    setPicked((prev) => (prev.includes(tag) ? prev.filter((x) => x !== tag) : [...prev, tag]));

  const createTag = () => {
    if (!canCreate) return;
    setCreated((prev) => [...prev, q]);
    setPicked((prev) => [...prev, q]);
    setDraft('');
  };

  const color = mode === 'add' ? theme.colors.primary : '#ef4444';

  return (
    <Sheet
      visible={visible}
      onDismiss={onDismiss}
      icon="tag-multiple-outline"
      title={tr('תגיות', 'Tags')}
      subtitle={tr(`${count} אנשי קשר נבחרו`, `${count} contacts selected`)}
      footer={
        <Button
          mode="contained"
          disabled={picked.length === 0}
          buttonColor={color}
          textColor="#FFF"
          onPress={() => onApply(mode, picked)}
        >
          {mode === 'add'
            ? tr(`הוסף ${picked.length || ''} תגיות ל-${count}`, `Add ${picked.length || ''} tags to ${count}`)
            : tr(`הסר ${picked.length || ''} תגיות מ-${count}`, `Remove ${picked.length || ''} tags from ${count}`)}
        </Button>
      }
    >
      <View style={[styles.modeRow, { flexDirection }]}>
        <Pill label={tr('הוספה', 'Add')} icon="tag-plus-outline" color={theme.colors.primary} active={mode === 'add'} onPress={() => setMode('add')} />
        <Pill label={tr('הסרה', 'Remove')} icon="tag-remove-outline" color="#ef4444" active={mode === 'remove'} onPress={() => setMode('remove')} />
      </View>

      <View style={[styles.inputWrap, { backgroundColor: theme.colors.surfaceVariant, flexDirection }]}>
        <MaterialCommunityIcons name="magnify" size={18} color={theme.colors.onSurfaceVariant} />
        <RNTextInput
          value={draft}
          onChangeText={setDraft}
          placeholder={mode === 'add' ? tr('חפש או צור תגית חדשה...', 'Search or create a tag...') : tr('חפש תגית...', 'Search tag...')}
          placeholderTextColor={theme.colors.onSurfaceVariant}
          style={[styles.input, { color: theme.colors.onSurface, textAlign: isRTL ? 'right' : 'left' }]}
          onSubmitEditing={createTag}
          returnKeyType="done"
        />
        {canCreate ? (
          <Pressable onPress={createTag} hitSlop={8} style={[styles.createBtn, { backgroundColor: theme.colors.primary }]}>
            <MaterialCommunityIcons name="plus" size={16} color="#FFF" />
            <Text style={{ color: '#FFF', fontSize: 12, fontWeight: '700' }}>{tr('צור', 'Create')}</Text>
          </Pressable>
        ) : null}
      </View>

      <ScrollView style={{ maxHeight: 280 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {visibleTags.length === 0 ? (
          <Text style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center', paddingVertical: 24 }}>
            {mode === 'remove'
              ? tr('לאנשי הקשר שנבחרו אין תגיות', 'The selected contacts have no tags')
              : tr('אין תגיות. הקלד שם כדי ליצור תגית חדשה.', 'No tags yet. Type a name to create one.')}
          </Text>
        ) : (
          <View style={[styles.tagWrap, { flexDirection }]}>
            {visibleTags.map((tag) => (
              <Pill
                key={tag}
                label={`#${tag}`}
                color={color}
                active={picked.includes(tag)}
                icon={picked.includes(tag) ? 'check' : undefined}
                onPress={() => toggleTag(tag)}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </Sheet>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Conversation status
// ─────────────────────────────────────────────────────────────────────────────
export const CONVERSATION_STATUSES: { key: 'Open' | 'In Process' | 'Closed'; he: string; en: string; color: string; icon: string }[] = [
  { key: 'Open', he: 'פתוח', en: 'Open', color: '#16a34a', icon: 'message-text-outline' },
  { key: 'In Process', he: 'בטיפול', en: 'In process', color: '#f59e0b', icon: 'progress-clock' },
  { key: 'Closed', he: 'סגור', en: 'Closed', color: '#6b7280', icon: 'check-circle-outline' },
];

export function BulkStatusSheet({
  visible,
  onDismiss,
  count,
  onApply,
  tr,
}: {
  visible: boolean;
  onDismiss: () => void;
  count: number;
  onApply: (status: string) => void;
  tr: TrFn;
}) {
  const theme = useAppTheme();
  const { flexDirection, textAlign } = useRTL();
  return (
    <Sheet
      visible={visible}
      onDismiss={onDismiss}
      icon="swap-horizontal"
      title={tr('סטטוס שיחה', 'Conversation status')}
      subtitle={tr(`עדכון ${count} אנשי קשר`, `Update ${count} contacts`)}
    >
      {CONVERSATION_STATUSES.map((s) => (
        <Pressable
          key={s.key}
          onPress={() => onApply(s.key)}
          style={({ pressed }) => [
            styles.optionRow,
            { flexDirection, backgroundColor: pressed ? withAlpha(s.color, 0.12) : 'transparent' },
          ]}
        >
          <View style={[styles.optionIcon, { backgroundColor: withAlpha(s.color, 0.14) }]}>
            <MaterialCommunityIcons name={s.icon as any} size={20} color={s.color} />
          </View>
          <Text variant="bodyLarge" style={{ flex: 1, color: theme.colors.onSurface, fontWeight: '600', textAlign }}>
            {tr(s.he, s.en)}
          </Text>
          <MaterialCommunityIcons name="circle-medium" size={22} color={s.color} />
        </Pressable>
      ))}
    </Sheet>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Owner
// ─────────────────────────────────────────────────────────────────────────────
export function BulkOwnerSheet({
  visible,
  onDismiss,
  count,
  organization,
  currentUserId,
  onApply,
  tr,
}: {
  visible: boolean;
  onDismiss: () => void;
  count: number;
  organization: string;
  currentUserId: string;
  onApply: (ownerId: string, ownerName: string) => void;
  tr: TrFn;
}) {
  const theme = useAppTheme();
  const { flexDirection, textAlign, isRTL } = useRTL();
  const [users, setUsers] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');

  useEffect(() => {
    if (!visible) return;
    setQ('');
    if (!organization || users.length > 0) return;
    let cancelled = false;
    setLoading(true);
    usersApi
      .getAll(organization)
      .then((list) => {
        if (cancelled) return;
        setUsers(
          (Array.isArray(list) ? list : [])
            .map((u: any) => ({ id: String(u.uID || u.userId || u.id || ''), name: String(u.fullname || u.userName || u.name || u.email || '') }))
            .filter((u) => u.id && u.name),
        );
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, organization]);

  const filtered = useMemo(() => {
    const list = q.trim() ? users.filter((u) => u.name.toLowerCase().includes(q.trim().toLowerCase())) : users;
    // Current user first.
    return [...list].sort((a, b) => Number(b.id === currentUserId) - Number(a.id === currentUserId) || a.name.localeCompare(b.name));
  }, [users, q, currentUserId]);

  return (
    <Sheet
      visible={visible}
      onDismiss={onDismiss}
      icon="account-arrow-left-outline"
      title={tr('שיוך אחראי', 'Assign owner')}
      subtitle={tr(`עדכון ${count} אנשי קשר`, `Update ${count} contacts`)}
    >
      <View style={[styles.inputWrap, { backgroundColor: theme.colors.surfaceVariant, flexDirection }]}>
        <MaterialCommunityIcons name="magnify" size={18} color={theme.colors.onSurfaceVariant} />
        <RNTextInput
          value={q}
          onChangeText={setQ}
          placeholder={tr('חיפוש משתמש...', 'Search user...')}
          placeholderTextColor={theme.colors.onSurfaceVariant}
          style={[styles.input, { color: theme.colors.onSurface, textAlign: isRTL ? 'right' : 'left' }]}
        />
      </View>
      {loading ? (
        <ActivityIndicator style={{ marginVertical: 24 }} color={theme.colors.primary} />
      ) : (
        <ScrollView style={{ maxHeight: 340 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {filtered.map((u) => (
            <Pressable
              key={u.id}
              onPress={() => onApply(u.id, u.name)}
              style={({ pressed }) => [
                styles.optionRow,
                { flexDirection, backgroundColor: pressed ? theme.colors.surfaceVariant : 'transparent' },
              ]}
            >
              <View style={[styles.optionIcon, { backgroundColor: withAlpha(theme.colors.primary, 0.12) }]}>
                <Text style={{ color: theme.colors.primary, fontWeight: '700' }}>{(u.name[0] || '?').toUpperCase()}</Text>
              </View>
              <Text variant="bodyLarge" style={{ flex: 1, color: theme.colors.onSurface, textAlign }} numberOfLines={1}>
                {u.name}
              </Text>
              {u.id === currentUserId ? (
                <Text style={{ color: theme.colors.primary, fontSize: 12, fontWeight: '700' }}>{tr('אני', 'Me')}</Text>
              ) : null}
            </Pressable>
          ))}
          {filtered.length === 0 ? (
            <Text style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center', paddingVertical: 24 }}>
              {tr('לא נמצאו משתמשים', 'No users found')}
            </Text>
          ) : null}
        </ScrollView>
      )}
    </Sheet>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Send WhatsApp message (free text or approved template) — mirrors the web BulkSendMessageModal
// and the Chats bulk-send: sequential SendTemplateMessage / sendMessage per recipient.
// ─────────────────────────────────────────────────────────────────────────────
interface TemplateVarMap {
  index: number;
  entity: string;
  field: string;
}

function buildTemplateVarEntry(bodyVarIndex: number, value: string, queryIndex: number) {
  // Same payload shape as the web SendTemplateMessage: backend maps by `index` + `bodyVarIndex`.
  return {
    index: queryIndex,
    bodyVarIndex,
    Variable: `dynamic_var${bodyVarIndex}`,
    variableLabel: `{{${bodyVarIndex}}}`,
    dataSource1: 'data_source1_HardCoded',
    dataSource2: '',
    conditionOperator: '',
    parameters_hardCoded_Text: value,
    field1: [],
    field2: [],
    table1: '',
    table2: '',
    retrieveFields: [],
  };
}

function parseVarMapping(json?: string): TemplateVarMap[] {
  try {
    const arr = JSON.parse(json || '[]');
    if (!Array.isArray(arr)) return [];
    return arr
      .map((m: any) => ({ index: Number(m.index), entity: m.entity || 'open', field: m.field || '' }))
      .filter((m: TemplateVarMap) => !Number.isNaN(m.index));
  } catch {
    return [];
  }
}

function templateBody(tpl: any): string {
  const body = (tpl?.components || []).find((c: any) => c?.type === 'BODY');
  return body?.text || '';
}

function templateVarIndices(tpl: any): number[] {
  const matches = templateBody(tpl).match(/\{\{(\d+)\}\}/g);
  if (!matches) return [];
  return [...new Set(matches.map((m: string) => parseInt(m.replace(/\{\{|\}\}/g, ''), 10)))].sort((a, b) => a - b);
}

function resolveVar(entity: string, field: string, contact: Contact | undefined, user: any): string {
  if (!entity || entity === 'open') return '';
  if (entity === 'contact') {
    const full = String(contact?.name || '');
    if (field === 'name' || field === 'fullName' || field === '') return full || contact?.phoneNumber || '';
    if (field === 'firstName') return full.split(' ')[0] || '';
    if (field === 'lastName') return full.split(' ').slice(1).join(' ') || '';
    if (field === 'phone' || field === 'phoneNumber') return contact?.phoneNumber || '';
    if (field === 'email') return contact?.email || '';
    const v = (contact as any)?.[field];
    return v == null ? '' : String(v);
  }
  if (entity === 'user') {
    if (field === 'name' || field === 'displayName' || field === '') return user?.fullname || user?.name || '';
    if (field === 'email') return user?.email || '';
    if (field === 'phone') return user?.phone || '';
    return '';
  }
  if (entity === 'org') {
    if (field === 'name' || field === '') return user?.organization || '';
    return '';
  }
  return '';
}

export function BulkSendSheet({
  visible,
  onDismiss,
  contacts,
  organization,
  user,
  onDone,
  tr,
}: {
  visible: boolean;
  onDismiss: () => void;
  contacts: Contact[];
  organization: string;
  user: any;
  onDone: (ok: number, failed: number) => void;
  tr: TrFn;
}) {
  const theme = useAppTheme();
  const { flexDirection, textAlign, isRTL } = useRTL();
  const [mode, setMode] = useState<'text' | 'template'>('template');
  const [text, setText] = useState('');
  const [templates, setTemplates] = useState<any[]>([]);
  const [loadingTpl, setLoadingTpl] = useState(false);
  const [templateId, setTemplateId] = useState('');
  const [varValues, setVarValues] = useState<Record<number, string>>({});
  const [numbers, setNumbers] = useState<WabaNumberInfo[]>([]);
  const [numberId, setNumberId] = useState('');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const sending = progress !== null;

  // Reset + lazy load templates / numbers each time the sheet opens.
  useEffect(() => {
    if (!visible) return;
    setMode('template');
    setText('');
    setTemplateId('');
    setVarValues({});
    setProgress(null);
    if (!organization) return;
    if (templates.length === 0) {
      setLoadingTpl(true);
      chatsApi
        .getTemplates(organization)
        .then((t) => setTemplates(Array.isArray(t) ? t : []))
        .catch(() => setTemplates([]))
        .finally(() => setLoadingTpl(false));
    }
    if (numbers.length === 0) {
      axiosInstance
        .get(ENDPOINTS.GET_WHATSAPP_NUMBERS, { params: { organization } })
        .then((res) => {
          const nums: WabaNumberInfo[] = res.data?.Numbers || res.data?.numbers || [];
          if (Array.isArray(nums)) setNumbers(nums);
        })
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, organization]);

  const availableNumbers = useMemo(() => {
    const assigned: string[] = user?.assignedWhatsAppNumbers || [];
    if (assigned.length > 0) return numbers.filter((n) => assigned.includes(n.PhoneNumberId || n.phoneNumberId || ''));
    return numbers;
  }, [numbers, user?.assignedWhatsAppNumbers]);

  useEffect(() => {
    if (!numberId && availableNumbers[0]) setNumberId(availableNumbers[0].PhoneNumberId || availableNumbers[0].phoneNumberId || '');
  }, [availableNumbers, numberId]);

  const tplKey = (tpl: any) => String(tpl.id || tpl.Id || tpl.templateId || tpl.name || tpl.Name || '');
  const selectedTpl = useMemo(() => templates.find((t) => tplKey(t) === templateId), [templates, templateId]);
  const varIndices = useMemo(() => (selectedTpl ? templateVarIndices(selectedTpl) : []), [selectedTpl]);
  const mapping = useMemo(() => (selectedTpl ? parseVarMapping((selectedTpl as any).variableMappingJson) : []), [selectedTpl]);
  const openVars = useMemo(
    () =>
      varIndices.filter((idx) => {
        const m = mapping.find((e) => e.index === idx);
        return !m || m.entity === 'open';
      }),
    [varIndices, mapping],
  );

  const varFor = useCallback(
    (idx: number, contact: Contact | undefined) => {
      const m = mapping.find((e) => e.index === idx);
      if (!m || m.entity === 'open') return varValues[idx] || '';
      return resolveVar(m.entity, m.field, contact, user) || varValues[idx] || '';
    },
    [mapping, varValues, user],
  );

  const preview = useMemo(() => {
    if (!selectedTpl) return '';
    let body = templateBody(selectedTpl);
    varIndices.forEach((idx) => {
      const v = varFor(idx, contacts[0]);
      if (v) body = body.replace(new RegExp(`\\{\\{${idx}\\}\\}`, 'g'), v);
    });
    return body;
  }, [selectedTpl, varIndices, varFor, contacts]);

  const canSend =
    !sending &&
    contacts.length > 0 &&
    (mode === 'text' ? !!text.trim() : !!templateId && openVars.every((i) => (varValues[i] || '').trim()));

  const send = useCallback(async () => {
    if (!canSend || !organization) return;
    const num = availableNumbers.find((n) => (n.PhoneNumberId || n.phoneNumberId) === numberId) || availableNumbers[0];
    const fromNumberId = num ? num.PhoneNumberId || num.phoneNumberId || '' : '';
    const from = num ? num.DisplayNumber || num.displayNumber || num.Label || num.label || user?.wabaNumber || '' : user?.wabaNumber || '';
    const senderName = user?.fullname || user?.name || 'system';
    const uid = user?.uID || user?.userId || '';
    let ok = 0;
    let failed = 0;
    setProgress({ done: 0, total: contacts.length });
    for (let i = 0; i < contacts.length; i++) {
      const c = contacts[i];
      const phone = (c.phoneNumber || '').replace(/\D/g, '');
      try {
        if (!phone) throw new Error('no phone');
        if (mode === 'template') {
          const query = varIndices.map((idx, qi) => buildTemplateVarEntry(idx, varFor(idx, c), qi + 1));
          await chatsApi.sendTemplateMessage(organization, phone, templateId, uid, query, fromNumberId || undefined);
        } else {
          await chatsApi.sendMessage(organization, phone, text.trim(), senderName, uid, undefined, from, user?.email || '', fromNumberId || undefined);
        }
        ok++;
      } catch {
        failed++;
      }
      setProgress({ done: i + 1, total: contacts.length });
    }
    setProgress(null);
    onDone(ok, failed);
  }, [canSend, organization, availableNumbers, numberId, user, contacts, mode, varIndices, varFor, templateId, text, onDone]);

  return (
    <Sheet
      visible={visible}
      onDismiss={onDismiss}
      locked={sending}
      icon="whatsapp"
      title={tr('שליחת הודעה', 'Send message')}
      subtitle={tr(`${contacts.length} נמענים`, `${contacts.length} recipients`)}
      footer={
        <Button
          mode="contained"
          icon="send"
          disabled={!canSend}
          loading={sending}
          buttonColor="#25D366"
          textColor="#FFF"
          onPress={send}
        >
          {sending
            ? `${progress?.done ?? 0} / ${progress?.total ?? contacts.length}`
            : tr(`שלח ל-${contacts.length}`, `Send to ${contacts.length}`)}
        </Button>
      }
    >
      <View style={[styles.modeRow, { flexDirection }]}>
        <Pill label={tr('תבנית', 'Template')} icon="file-document-outline" color="#25D366" active={mode === 'template'} onPress={() => setMode('template')} />
        <Pill label={tr('הודעה חופשית', 'Free text')} icon="message-text-outline" color="#25D366" active={mode === 'text'} onPress={() => setMode('text')} />
      </View>

      <ScrollView style={{ maxHeight: 360 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {availableNumbers.length > 1 ? (
          <View style={{ marginBottom: 10 }}>
            <Text style={[styles.label, { color: theme.colors.onSurfaceVariant, textAlign }]}>{tr('שליחה מהמספר', 'Send from')}</Text>
            <View style={[styles.tagWrap, { flexDirection }]}>
              {availableNumbers.map((n) => {
                const id = n.PhoneNumberId || n.phoneNumberId || '';
                return (
                  <Pill
                    key={id}
                    label={n.Label || n.label || n.DisplayNumber || n.displayNumber || id}
                    color={theme.colors.primary}
                    active={numberId === id}
                    onPress={() => setNumberId(id)}
                  />
                );
              })}
            </View>
          </View>
        ) : null}

        {mode === 'text' ? (
          <>
            <RNTextInput
              value={text}
              onChangeText={setText}
              multiline
              placeholder={tr('כתוב הודעה...', 'Write a message...')}
              placeholderTextColor={theme.colors.onSurfaceVariant}
              style={[
                styles.textArea,
                { color: theme.colors.onSurface, backgroundColor: theme.colors.surfaceVariant, textAlign: isRTL ? 'right' : 'left' },
              ]}
            />
            <View style={[styles.notice, { backgroundColor: withAlpha('#f59e0b', 0.14), flexDirection }]}>
              <MaterialCommunityIcons name="information-outline" size={16} color="#d97706" />
              <Text style={{ flex: 1, color: '#b45309', fontSize: 12, textAlign }}>
                {tr(
                  'הודעה חופשית תתקבל רק אצל מי ששלח הודעה ב-24 השעות האחרונות. לשאר - השתמש בתבנית.',
                  'Free text is only delivered to contacts who wrote in the last 24 hours. Use a template for the rest.',
                )}
              </Text>
            </View>
          </>
        ) : loadingTpl ? (
          <ActivityIndicator style={{ marginVertical: 24 }} color={theme.colors.primary} />
        ) : templates.length === 0 ? (
          <Text style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center', paddingVertical: 24 }}>
            {tr('אין תבניות מאושרות', 'No approved templates')}
          </Text>
        ) : (
          <>
            {templates.map((tpl) => {
              const id = tplKey(tpl);
              const active = id === templateId;
              return (
                <Pressable
                  key={id}
                  onPress={() => {
                    setTemplateId(id);
                    setVarValues({});
                  }}
                  style={[
                    styles.tplRow,
                    {
                      borderColor: active ? '#25D366' : theme.colors.outlineVariant,
                      backgroundColor: active ? withAlpha('#25D366', 0.1) : 'transparent',
                    },
                  ]}
                >
                  <View style={{ flexDirection, alignItems: 'center', gap: 6 }}>
                    <Text style={{ flex: 1, color: theme.colors.onSurface, fontWeight: '700', textAlign }} numberOfLines={1}>
                      {tpl.friendlyName || tpl.name}
                    </Text>
                    {active ? <MaterialCommunityIcons name="check-circle" size={18} color="#25D366" /> : null}
                  </View>
                  <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 12, textAlign, marginTop: 2 }} numberOfLines={active ? 6 : 2}>
                    {active && preview ? preview : templateBody(tpl)}
                  </Text>
                </Pressable>
              );
            })}
            {openVars.length > 0 ? (
              <View style={{ marginTop: 6 }}>
                <Text style={[styles.label, { color: theme.colors.onSurfaceVariant, textAlign }]}>
                  {tr('משתנים להשלמה (זהים לכולם)', 'Variables to fill (same for everyone)')}
                </Text>
                {openVars.map((idx) => (
                  <View key={idx} style={[styles.varRow, { flexDirection }]}>
                    <Text style={{ color: theme.colors.primary, fontWeight: '700', width: 40 }}>{`{{${idx}}}`}</Text>
                    <RNTextInput
                      value={varValues[idx] || ''}
                      onChangeText={(v) => setVarValues((prev) => ({ ...prev, [idx]: v }))}
                      placeholder={tr('ערך', 'Value')}
                      placeholderTextColor={theme.colors.onSurfaceVariant}
                      style={[
                        styles.varInput,
                        { color: theme.colors.onSurface, backgroundColor: theme.colors.surfaceVariant, textAlign: isRTL ? 'right' : 'left' },
                      ]}
                    />
                  </View>
                ))}
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 16,
    paddingTop: 8,
    maxHeight: '88%',
  },
  grabber: { alignSelf: 'center', width: 38, height: 4, borderRadius: 2, marginBottom: 10, opacity: 0.5 },
  sheetHeader: { alignItems: 'center', gap: 10, marginBottom: 12 },
  sheetIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
  },
  modeRow: { gap: 8, marginBottom: 10 },
  inputWrap: {
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    height: 42,
    borderRadius: 21,
    marginBottom: 10,
  },
  input: { flex: 1, fontSize: 14, paddingVertical: 0 },
  createBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 10, height: 28, borderRadius: 14 },
  tagWrap: { flexWrap: 'wrap', gap: 8, paddingBottom: 4 },
  optionRow: { alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 8, borderRadius: 12 },
  optionIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 12, fontWeight: '700', marginBottom: 6 },
  textArea: { minHeight: 110, borderRadius: 12, padding: 12, fontSize: 14, textAlignVertical: 'top' },
  notice: { alignItems: 'center', gap: 8, padding: 10, borderRadius: 10, marginTop: 10 },
  tplRow: { borderWidth: 1, borderRadius: 12, padding: 10, marginBottom: 8 },
  varRow: { alignItems: 'center', gap: 8, marginBottom: 8 },
  varInput: { flex: 1, height: 40, borderRadius: 10, paddingHorizontal: 12, fontSize: 14 },
});
