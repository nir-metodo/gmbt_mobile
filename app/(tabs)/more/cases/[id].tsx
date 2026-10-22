import React, { useState, useCallback, useEffect, useLayoutEffect, useRef, useMemo } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
} from 'react-native';
import {
  Text,
  Chip,
  Avatar,
  ActivityIndicator,
  Portal,
  Modal,
  TextInput,
  Button,
  IconButton,
  Divider,
  Switch,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams, useNavigation } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../../../stores/authStore';
import { placeSmartCall } from '../../../../utils/phoneCall';
import { useAppTheme } from '../../../../hooks/useAppTheme';
import { useRTL } from '../../../../hooks/useRTL';
import { casesApi } from '../../../../services/api/cases';
import { chatsApi } from '../../../../services/api/chats';
import { cacheEntity, getCachedEntity } from '../../../../services/entityCache';
import { contactsApi } from '../../../../services/api/contacts';
import { usersApi } from '../../../../services/api/users';
import { tasksApi } from '../../../../services/api/tasks';
import { formatDate, formatRelativeTime, getInitials, withAlpha } from '../../../../utils/formatters';
import { spacing, borderRadius } from '../../../../constants/theme';
import ContactLookup from '../../../../components/ContactLookup';
import type { OrgUser, Template } from '../../../../types';
import {
  DynamicFieldsSectionForm,
  ExtraFieldsSectionView,
  getSectionFieldKeys,
  type DynamicSection,
} from '../../../../components/DynamicFieldsSection';
import { NoteAttachmentRow, type NoteAttachment } from '../../../../components/NoteAttachmentRow';
import AddTaskSheet from '../../../../components/AddTaskSheet';
import type { Case } from '../../../../types';
import { HeaderMenu } from '../../../../components/HeaderMenu';
import { StickySaveBar } from '../../../../components/StickySaveBar';
import { PrimaryActionBar } from '../../../../components/PrimaryActionBar';

const PRIORITY_COLORS: Record<string, string> = {
  low: '#4CAF50',
  medium: '#FF9800',
  high: '#FF5722',
  urgent: '#F44336',
};

const STATUS_OPTIONS = ['open', 'pending', 'escalated', 'on_hold', 'in_progress', 'resolved', 'closed'] as const;
const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
const CASE_SOURCES = ['whatsapp', 'phone', 'email', 'website', 'walk_in', 'social', 'other'] as const;

const PRIORITY_ICONS: Record<string, string> = {
  low: 'chevron-down',
  medium: 'minus',
  high: 'chevron-up',
  urgent: 'chevron-double-up',
};

function getStatusColor(status: string): string {
  const map: Record<string, string> = {
    open: '#2196F3',
    in_progress: '#FF9800',
    resolved: '#4CAF50',
    closed: '#757575',
    pending: '#9E9E9E',
  };
  const normalized = status.toLowerCase().replace(/\s+/g, '_');
  return map[normalized] || '#9E9E9E';
}

// Keys of a stored case that are edited through dedicated form fields (everything else is carried
// along as a "dynamic"/custom field value).
const CORE_CASE_KEYS = ['id', 'title', 'subject', 'description', 'status', 'priority', 'category', 'assignedTo', 'source', 'contactName', 'contactPhone', 'contactId', 'dueDate', 'tags', 'notes', 'createdAt', 'updatedAt', 'resolvedAt', 'organization', 'pipelineId', 'stageId', 'stageName'];

interface CaseFormValues {
  title: string;
  description: string;
  status: string;
  priority: string;
  category: string;
  assignedTo: string;
  assignedToId: string;
  source: string;
  contactName: string;
  contactPhone: string;
  contactId: string;
  dueDate: string;
  tags: string;
  notes: string;
  followUpEnabled: boolean;
  followUpInterval: number;
  followUpUnit: 'hours' | 'days' | 'weeks';
  followUpTemplateId: string;
  followUpTemplateName: string;
  followUpRepeat: number;
  nextFollowUp: string;
  dynamic: Record<string, any>;
}

// Stored case -> editable form values. Used both to fill the form and as the "unsaved changes" baseline.
function formFromCase(c: Case): CaseFormValues {
  const anyC = c as any;
  const dynamicVals: Record<string, any> = {};
  Object.keys(anyC).forEach((k) => {
    if (!CORE_CASE_KEYS.includes(k)) dynamicVals[k] = anyC[k];
  });
  return {
    title: c.title || c.subject || '',
    description: c.description || '',
    status: c.status,
    priority: c.priority,
    category: c.category || '',
    assignedTo: c.assignedToName || c.assignedTo || '',
    assignedToId: c.assignedTo || '',
    source: anyC.source || '',
    contactName: c.contactName || '',
    contactPhone: c.contactPhone || anyC.contact_phone || '',
    contactId: c.contactId || '',
    dueDate: anyC.dueDate || anyC.due_date || '',
    tags: Array.isArray(anyC.tags) ? anyC.tags.join(', ') : (anyC.tags || ''),
    notes: anyC.notes || '',
    followUpEnabled: !!c.followUpEnabled,
    followUpInterval: c.followUpInterval || 2,
    followUpUnit: (c.followUpUnit as any) || 'days',
    followUpTemplateId: c.followUpTemplateId || '',
    followUpTemplateName: c.followUpTemplateName || '',
    followUpRepeat: c.followUpRepeat || 3,
    nextFollowUp: c.nextFollowUp || '',
    dynamic: { ...(anyC.customFields || {}), ...dynamicVals },
  };
}

const serializeForm = (v: CaseFormValues) => JSON.stringify(v);

export default function CaseDetailScreen() {
  const router = useRouter();
  const { id, contactPhone: prefillPhone, prefillContactName } = useLocalSearchParams<{
    id: string;
    contactPhone?: string;
    prefillContactName?: string;
  }>();
  const insets = useSafeAreaInsets();
  const theme = useAppTheme();
  const { isRTL, flexDirection, textAlign, writingDirection } = useRTL();
  const { t, i18n } = useTranslation();
  const lang = i18n.language as 'en' | 'he';

  const user = useAuthStore((s) => s.user);

  const isNew = id === 'new';

  // Render instantly from the list cache, then refresh in the background.
  // Memoized per id so the cache lookup keeps a stable identity across renders
  // (otherwise fetchCase, which depends on it, re-runs in an infinite loop).
  const cachedCase = useMemo(
    () => (!isNew ? getCachedEntity<Case>('cases', id) : undefined),
    [isNew, id]
  );
  const [caseData, setCaseData] = useState<Case | null>(cachedCase ?? null);
  const [caseSettings, setCaseSettings] = useState<{ sla?: { enabled: boolean; responseTime: number; resolutionTime: number } } | null>(null);
  const [caseFormSections, setCaseFormSections] = useState<DynamicSection[]>([]);
  const [caseFormLayout, setCaseFormLayout] = useState<string[]>([]);
  const [formDynamicFields, setFormDynamicFields] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(!isNew && !cachedCase);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Serialized form values as last loaded/saved; the form is "dirty" when it differs from this.
  const [formBaseline, setFormBaseline] = useState<string | null>(null);
  const forceInitRef = useRef(false);
  const skipGuardRef = useRef(false);
  const [deleting, setDeleting] = useState(false);

  const [formTitle, setFormTitle] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formStatus, setFormStatus] = useState<string>('open');
  const [formPriority, setFormPriority] = useState<string>('medium');
  const [formCategory, setFormCategory] = useState('');
  const [formAssignedTo, setFormAssignedTo] = useState('');
  const [formAssignedToId, setFormAssignedToId] = useState('');
  const [orgUsers, setOrgUsers] = useState<OrgUser[]>([]);
  const [orgUsersLoading, setOrgUsersLoading] = useState(false);
  const [userPickerExpanded, setUserPickerExpanded] = useState(false);
  const [formSource, setFormSource] = useState('');
  const [formContactName, setFormContactName] = useState('');
  const [formContactPhone, setFormContactPhone] = useState('');
  const [formContactId, setFormContactId] = useState('');
  const [contactLookupVisible, setContactLookupVisible] = useState(false);
  const [formDueDate, setFormDueDate] = useState('');
  const [formTags, setFormTags] = useState('');
  const [formNotes, setFormNotes] = useState('');

  // Auto follow-up
  const [formFollowUpEnabled, setFormFollowUpEnabled] = useState(false);
  const [formFollowUpInterval, setFormFollowUpInterval] = useState(2);
  const [formFollowUpUnit, setFormFollowUpUnit] = useState<'hours' | 'days' | 'weeks'>('days');
  const [formFollowUpTemplateId, setFormFollowUpTemplateId] = useState('');
  const [formFollowUpTemplateName, setFormFollowUpTemplateName] = useState('');
  const [formFollowUpRepeat, setFormFollowUpRepeat] = useState(3);
  const [formNextFollowUp, setFormNextFollowUp] = useState('');
  const [waTemplates, setWaTemplates] = useState<Template[]>([]);
  const [waTemplatesLoading, setWaTemplatesLoading] = useState(false);
  const [followUpTemplateExpanded, setFollowUpTemplateExpanded] = useState(false);
  const [noteModalVisible, setNoteModalVisible] = useState(false);
  const [addTaskVisible, setAddTaskVisible] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [noteAttachment, setNoteAttachment] = useState<NoteAttachment | null>(null);
  const [addingNote, setAddingNote] = useState(false);
  const [timelineEvents, setTimelineEvents] = useState<any[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineFilter, setTimelineFilter] = useState<'all' | 'notes' | 'system'>('all');

  const fetchTimeline = useCallback(async () => {
    if (!user?.organization || !id || isNew) return;
    setTimelineLoading(true);
    try {
      const data = await contactsApi.getTimeline(user.organization, `case_${id}`);
      const arr = Array.isArray(data) ? data : (data as any)?.events || [];
      arr.sort((a: any, b: any) => {
        const dateA = new Date(a.CreateDateTimeUTC || a.createdOn || a.CreatedOn || a.timestamp || a.createdAt || 0).getTime();
        const dateB = new Date(b.CreateDateTimeUTC || b.createdOn || b.CreatedOn || b.timestamp || b.createdAt || 0).getTime();
        return dateB - dateA;
      });
      setTimelineEvents(arr);
    } catch {
      // non-critical
    } finally {
      setTimelineLoading(false);
    }
  }, [user?.organization, id, isNew]);

  const [completingTaskId, setCompletingTaskId] = useState<string | null>(null);

  const openTaskFromTimeline = useCallback((taskId: string) => {
    if (!taskId) return;
    router.push({ pathname: '/(tabs)/tasks/[id]', params: { id: String(taskId) } } as any);
  }, [router]);

  const completeTaskFromTimeline = useCallback(async (taskId: string) => {
    if (!taskId || !user?.organization || completingTaskId) return;
    setCompletingTaskId(taskId);
    try {
      await tasksApi.complete(user.organization, taskId, user?.uID || user?.userId || '', user?.fullname || user?.name || 'Gambot');
      await fetchTimeline();
    } catch {
      Alert.alert(t('common.error'));
    } finally {
      setCompletingTaskId(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, completingTaskId, fetchTimeline]);

  const fetchCase = useCallback(async (): Promise<Case | null> => {
    if (!user?.organization) return null;
    if (isNew) {
      setLoading(false);
      return null;
    }
    if (!id) return null;
    let result: Case | null = null;
    try {
      setError(null);
      const [found, settings] = await Promise.all([
        casesApi.getById(user.organization, id).catch(() => null),
        casesApi.getSettings(user.organization).catch(() => null),
      ]);
      if (found) {
        result = found;
        setCaseData(found);
        cacheEntity('cases', found);
      } else if (!cachedCase) {
        setError(t('common.noResults'));
      }
      if (settings?.sla) setCaseSettings(settings);
      if (Array.isArray(settings?.formSections)) setCaseFormSections(settings.formSections);
      if (Array.isArray(settings?.formLayout)) setCaseFormLayout(settings.formLayout);
    } catch (err: any) {
      setError(err.message || t('errors.generic'));
    } finally {
      setLoading(false);
    }
    return result;
  }, [user?.organization, id, isNew, t, cachedCase]);

  useEffect(() => {
    fetchCase();
    fetchTimeline();
  }, [fetchCase, fetchTimeline]);

  useEffect(() => {
    if (!user?.organization) return;
    setWaTemplatesLoading(true);
    chatsApi.getTemplates(user.organization)
      .then((tpls) => setWaTemplates(Array.isArray(tpls) ? tpls : []))
      .catch(() => {})
      .finally(() => setWaTemplatesLoading(false));
  }, [user?.organization]);

  // Pre-fill form for "new" case from URL params (runs once on mount)
  useEffect(() => {
    if (isNew) {
      setFormContactPhone(prefillPhone || '');
      setFormContactName(prefillContactName || '');
      setFormStatus('open');
      setFormPriority('medium');
      // Load case settings for dynamic fields
      if (user?.organization) {
        casesApi.getSettings(user.organization).then((settings) => {
          if (settings?.sla) setCaseSettings(settings);
          if (Array.isArray(settings?.formSections)) setCaseFormSections(settings.formSections);
          if (Array.isArray(settings?.formLayout)) setCaseFormLayout(settings.formLayout);
        }).catch(() => {});
      }
    }
  }, [isNew, prefillPhone, prefillContactName, user?.organization]);

  // ── Always-editable form ──────────────────────────────────────────────────────
  // The detail screen is the edit form: fields are bound to the form* state below, filled from the
  // stored case, and a sticky save bar appears only while the values differ from `baselineValues`.
  const [baselineValues, setBaselineValues] = useState<CaseFormValues | null>(null);

  const currentForm = useMemo<CaseFormValues>(() => ({
    title: formTitle,
    description: formDescription,
    status: formStatus,
    priority: formPriority,
    category: formCategory,
    assignedTo: formAssignedTo,
    assignedToId: formAssignedToId,
    source: formSource,
    contactName: formContactName,
    contactPhone: formContactPhone,
    contactId: formContactId,
    dueDate: formDueDate,
    tags: formTags,
    notes: formNotes,
    followUpEnabled: formFollowUpEnabled,
    followUpInterval: formFollowUpInterval,
    followUpUnit: formFollowUpUnit,
    followUpTemplateId: formFollowUpTemplateId,
    followUpTemplateName: formFollowUpTemplateName,
    followUpRepeat: formFollowUpRepeat,
    nextFollowUp: formNextFollowUp,
    dynamic: formDynamicFields,
  }), [formTitle, formDescription, formStatus, formPriority, formCategory, formAssignedTo, formAssignedToId, formSource, formContactName, formContactPhone, formContactId, formDueDate, formTags, formNotes, formFollowUpEnabled, formFollowUpInterval, formFollowUpUnit, formFollowUpTemplateId, formFollowUpTemplateName, formFollowUpRepeat, formNextFollowUp, formDynamicFields]);

  const initFormFromCase = useCallback((c: Case) => {
    const v = formFromCase(c);
    setFormTitle(v.title);
    setFormDescription(v.description);
    setFormStatus(v.status);
    setFormPriority(v.priority);
    setFormCategory(v.category);
    setFormAssignedTo(v.assignedTo);
    setFormAssignedToId(v.assignedToId);
    setFormSource(v.source);
    setFormContactName(v.contactName);
    setFormContactPhone(v.contactPhone);
    setFormContactId(v.contactId);
    setFormDueDate(v.dueDate);
    setFormTags(v.tags);
    setFormNotes(v.notes);
    setFormFollowUpEnabled(v.followUpEnabled);
    setFormFollowUpInterval(v.followUpInterval);
    setFormFollowUpUnit(v.followUpUnit);
    setFormFollowUpTemplateId(v.followUpTemplateId);
    setFormFollowUpTemplateName(v.followUpTemplateName);
    setFormFollowUpRepeat(v.followUpRepeat);
    setFormNextFollowUp(v.nextFollowUp);
    setFormDynamicFields(v.dynamic);
    setUserPickerExpanded(false);
    setBaselineValues(v);
  }, []);

  const isDirty = !isNew && !!caseData && !!baselineValues
    && serializeForm(currentForm) !== serializeForm(baselineValues);
  const isDirtyRef = useRef(false);
  isDirtyRef.current = isDirty;

  // (Re)fill the form whenever the stored case changes — unless the user has unsaved edits
  // (a save forces a refill so the form picks up server-stamped values).
  useLayoutEffect(() => {
    if (isNew || !caseData) return;
    if (forceInitRef.current || !isDirtyRef.current) {
      forceInitRef.current = false;
      initFormFromCase(caseData);
    }
  }, [caseData, isNew, initFormFromCase]);

  // Org users for the assignee picker (loaded once, for existing cases).
  useEffect(() => {
    if (isNew || !user?.organization || orgUsers.length > 0) return;
    setOrgUsersLoading(true);
    usersApi.getAll(user.organization).then((u) => setOrgUsers(u)).catch(() => {}).finally(() => setOrgUsersLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNew, user?.organization]);

  // Builds the auto follow-up fields for the case payload. When enabled we schedule
  // the first send from interval/unit (mirrors the web CaseForm + leads) so the backend
  // ProcessLeadFollowUps job (which also processes cases) can pick it up.
  const buildFollowUpPayload = useCallback((): Partial<Case> => {
    if (!formFollowUpEnabled) {
      return { followUpEnabled: false, nextFollowUp: '' };
    }
    const interval = Math.max(1, formFollowUpInterval || 2);
    let nextFollowUp = formNextFollowUp;
    if (!nextFollowUp) {
      const d = new Date();
      if (formFollowUpUnit === 'hours') d.setHours(d.getHours() + interval);
      else if (formFollowUpUnit === 'weeks') d.setDate(d.getDate() + interval * 7);
      else d.setDate(d.getDate() + interval);
      nextFollowUp = d.toISOString();
    }
    return {
      followUpEnabled: true,
      followUpInterval: interval,
      followUpUnit: formFollowUpUnit,
      followUpTemplateId: formFollowUpTemplateId,
      followUpTemplateName: formFollowUpTemplateName,
      followUpRepeat: formFollowUpRepeat,
      followUpMaxRepeats: formFollowUpRepeat,
      followUpMappingMode: 'auto',
      followUpSentCount: 0,
      nextFollowUp,
    };
  }, [formFollowUpEnabled, formFollowUpInterval, formFollowUpUnit, formFollowUpTemplateId, formFollowUpTemplateName, formFollowUpRepeat, formNextFollowUp]);

  const handleCreate = useCallback(async () => {
    if (!user?.organization) {
      Alert.alert(t('common.error'), t('errors.generic', 'אירעה שגיאה, נסה שוב'));
      return;
    }
    if (!formContactName.trim()) {
      Alert.alert(t('common.error'), t('cases.contactRequired', 'חובה לבחור איש קשר'));
      return;
    }
    if (!formTitle.trim()) {
      Alert.alert(t('common.error'), t('cases.titleRequired', 'יש להזין כותרת לפנייה'));
      return;
    }
    setSaving(true);
    try {
      await casesApi.create(user.organization, {
        title: formTitle.trim(),
        description: formDescription.trim() || undefined,
        status: formStatus as Case['status'],
        priority: formPriority as Case['priority'],
        category: formCategory.trim() || undefined,
        assignedTo: formAssignedToId || formAssignedTo.trim() || undefined,
        assignedToName: formAssignedTo.trim() || undefined,
        source: formSource || undefined,
        contactName: formContactName.trim() || undefined,
        contactPhone: formContactPhone.trim() || undefined,
        dueDate: formDueDate.trim() || undefined,
        tags: (formTags.trim() || undefined) as any,
        notes: formNotes.trim() || undefined,
        ...buildFollowUpPayload(),
        ...({ customFields: formDynamicFields } as any),
        ...formDynamicFields,
      }, user?.fullname, user?.userId || user?.uID || '');
      Alert.alert(
        t('common.success', 'נוצר בהצלחה'),
        t('cases.caseCreated', 'הפנייה נוצרה בהצלחה'),
        [{ text: 'OK', onPress: () => { if (router.canGoBack()) router.back(); else router.replace('/(tabs)/more/cases'); } }],
      );
    } catch (err: any) {
      Alert.alert(t('common.error'), err.message || t('errors.generic'));
    } finally {
      setSaving(false);
    }
  }, [user, formTitle, formDescription, formStatus, formPriority, formCategory, formAssignedTo, formAssignedToId, formSource, formContactName, formContactPhone, formDueDate, formTags, formNotes, formDynamicFields, buildFollowUpPayload, router, t]);

  // Saves only what the user actually changed (so e.g. editing the title never re-sends the
  // auto follow-up schedule or stale server-stamped values). Returns true on success.
  const handleSave = useCallback(async (): Promise<boolean> => {
    if (!user?.organization || !caseData || !baselineValues) return false;
    if (!formTitle.trim()) {
      Alert.alert(t('common.error'), t('cases.titleRequired', 'יש להזין כותרת לפנייה'));
      return false;
    }
    const b = baselineValues;
    const differs = (a: unknown, c: unknown) => JSON.stringify(a) !== JSON.stringify(c);
    const payload: Record<string, any> = {};
    if (formTitle.trim() !== b.title.trim()) payload.title = formTitle.trim();
    if (formDescription.trim() !== b.description.trim()) payload.description = formDescription.trim();
    if (formStatus !== b.status) {
      payload.status = formStatus;
      if (formStatus === 'resolved') payload.resolvedAt = new Date().toISOString();
    }
    if (formPriority !== b.priority) payload.priority = formPriority;
    if (formCategory.trim() !== b.category.trim()) payload.category = formCategory.trim();
    if (formAssignedToId !== b.assignedToId || formAssignedTo !== b.assignedTo) {
      payload.assignedTo = formAssignedToId || formAssignedTo.trim();
      payload.assignedToName = formAssignedTo.trim();
    }
    if (formSource !== b.source) payload.source = formSource;
    if (formContactName.trim() !== b.contactName.trim() || formContactPhone.trim() !== b.contactPhone.trim() || formContactId !== b.contactId) {
      payload.contactName = formContactName.trim();
      payload.contactPhone = formContactPhone.trim();
      payload.contactId = formContactId;
    }
    if (formDueDate.trim() !== b.dueDate.trim()) payload.dueDate = formDueDate.trim();
    if (formTags.trim() !== b.tags.trim()) payload.tags = formTags.trim();
    if (formNotes.trim() !== b.notes.trim()) payload.notes = formNotes.trim();
    if (
      formFollowUpEnabled !== b.followUpEnabled || formFollowUpInterval !== b.followUpInterval
      || formFollowUpUnit !== b.followUpUnit || formFollowUpTemplateId !== b.followUpTemplateId
      || formFollowUpRepeat !== b.followUpRepeat
    ) {
      Object.assign(payload, buildFollowUpPayload());
    }
    const changedDynamic: Record<string, any> = {};
    Object.keys(formDynamicFields).forEach((k) => {
      if (differs(formDynamicFields[k], b.dynamic[k])) changedDynamic[k] = formDynamicFields[k];
    });
    if (Object.keys(changedDynamic).length > 0) {
      Object.assign(payload, changedDynamic);
      payload.customFields = { ...((caseData as any).customFields || {}), ...changedDynamic };
    }
    if (Object.keys(payload).length === 0) {
      initFormFromCase(caseData);
      return true;
    }
    setSaving(true);
    try {
      const res = await casesApi.update(user.organization, caseData.id, payload as Partial<Case>, user?.fullname, user?.userId || user?.uID || '');
      if (res && res.Success === false) throw new Error(res.Message || res.message || t('errors.generic'));
      // Refill the form from the server copy (or, if that fetch fails, from what we just saved).
      forceInitRef.current = true;
      const fresh = await fetchCase();
      if (!fresh) setCaseData((prev) => (prev ? ({ ...prev, ...payload } as Case) : prev));
      return true;
    } catch (err: any) {
      forceInitRef.current = false;
      Alert.alert(t('common.error'), err.message || t('errors.generic'));
      return false;
    } finally {
      setSaving(false);
    }
  }, [user, caseData, baselineValues, formTitle, formDescription, formStatus, formPriority, formCategory, formAssignedTo, formAssignedToId, formSource, formContactName, formContactPhone, formContactId, formDueDate, formTags, formNotes, formFollowUpEnabled, formFollowUpInterval, formFollowUpUnit, formFollowUpTemplateId, formFollowUpRepeat, formDynamicFields, buildFollowUpPayload, initFormFromCase, fetchCase, t]);

  // Throw away unsaved edits and restore the form from the stored case.
  const discardChanges = useCallback(() => {
    if (caseData) initFormFromCase(caseData);
  }, [caseData, initFormFromCase]);

  // Unsaved-changes guard: leaving with a dirty form asks to save / discard / stay.
  const navigation = useNavigation();
  const handleSaveRef = useRef(handleSave);
  handleSaveRef.current = handleSave;
  useEffect(() => {
    if (isNew) return;
    const unsubscribe = navigation.addListener('beforeRemove', (e: any) => {
      if (skipGuardRef.current || !isDirtyRef.current) return;
      e.preventDefault();
      const he = lang === 'he';
      Alert.alert(
        he ? 'שינויים שלא נשמרו' : 'Unsaved changes',
        he ? 'יש שינויים שלא נשמרו בפנייה. מה לעשות?' : 'You have unsaved changes to this case. What would you like to do?',
        [
          { text: he ? 'הישאר' : 'Stay', style: 'cancel' },
          {
            text: he ? 'בטל שינויים' : 'Discard',
            style: 'destructive',
            onPress: () => {
              skipGuardRef.current = true;
              navigation.dispatch(e.data.action);
            },
          },
          {
            text: t('common.save'),
            onPress: async () => {
              const ok = await handleSaveRef.current();
              if (ok) {
                skipGuardRef.current = true;
                navigation.dispatch(e.data.action);
              }
            },
          },
        ],
      );
    });
    return unsubscribe;
  }, [navigation, isNew, lang, t]);

  const handleDelete = useCallback(() => {
    Alert.alert(
      t('common.delete'),
      t('cases.deleteConfirm'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            if (!user?.organization || !caseData) return;
            setDeleting(true);
            try {
              await casesApi.delete(user.organization, caseData.id);
              Alert.alert(t('common.success', 'הצלחה'), t('cases.deleteSuccess', 'נמחק בהצלחה'));
              skipGuardRef.current = true;
              if (router.canGoBack()) {
                router.back();
              } else {
                router.replace('/(tabs)/more/cases');
              }
            } catch (err: any) {
              Alert.alert(t('common.error'), err.message || t('errors.generic'));
              setDeleting(false);
            }
          },
        },
      ],
    );
  }, [user?.organization, caseData, router, t]);

  const handleAddNote = useCallback(async () => {
    if (!user?.organization || !caseData || (!noteText.trim() && !noteAttachment)) return;
    setAddingNote(true);
    try {
      await contactsApi.addTimelineEntry(
        user.organization,
        `case_${caseData.id}`,
        noteText.trim(),
        user?.uID || user?.userId || '',
        user?.fullname || '',
        noteAttachment || undefined,
      );
      setNoteText('');
      setNoteAttachment(null);
      setNoteModalVisible(false);
      fetchTimeline();
    } catch {
      Alert.alert(t('common.error'));
    } finally {
      setAddingNote(false);
    }
  }, [user, caseData, noteText, noteAttachment, t, fetchTimeline]);

  const caseStatusLabel = useCallback(
    (st: string) => t(`cases.status_${st}`, { defaultValue: st.charAt(0).toUpperCase() + st.slice(1).replace(/_/g, ' ') }),
    [t],
  );

  // One tap, optimistic, rolled back on failure.
  const handleStatusChange = useCallback(
    async (newStatus: string) => {
      if (!user?.organization || !caseData) return;
      const prevStatus = caseData.status;
      if (prevStatus === newStatus) return;
      setCaseData((c) => (c ? { ...c, status: newStatus as any } : c));
      try {
        await casesApi.update(user.organization, caseData.id, {
          status: newStatus,
          ...(newStatus === 'resolved' ? { resolvedAt: new Date().toISOString() } : {}),
        }, user?.fullname);
        fetchCase();
      } catch (err: any) {
        setCaseData((c) => (c ? { ...c, status: prevStatus } : c));
        Alert.alert(t('common.error'), err.message || t('errors.generic'));
      }
    },
    [user?.organization, user?.fullname, caseData, fetchCase, t],
  );

  // Next step in the case life-cycle drives the one prominent action.
  const normalizedCaseStatus = (caseData?.status || '').toLowerCase().replace(/\s+/g, '_');
  const nextCaseStatus: string | null =
    ['open', 'pending', 'escalated', 'on_hold'].includes(normalizedCaseStatus) ? 'in_progress'
      : normalizedCaseStatus === 'in_progress' ? 'resolved'
        : normalizedCaseStatus === 'resolved' ? 'closed'
          : null;
  const nextCaseLabel: Record<string, string> = {
    in_progress: t('cases.startWorking', 'התחל טיפול'),
    resolved: t('cases.markResolved', 'סמן כנפתרה'),
    closed: t('cases.closeCase', 'סגור פנייה'),
  };

  const renderFollowUpSection = (cardStyle: any) => (
    <View style={cardStyle}>
      <View style={[styles.formSectionHeader, { flexDirection }]}>
        <View style={styles.formSectionAccent} />
        <MaterialCommunityIcons name="bell-ring-outline" size={18} color="#2e6155" />
        <Text variant="titleSmall" style={styles.formSectionTitle}>
          {lang === 'he' ? 'פולואפ אוטומטי' : 'Auto Follow-up'}
        </Text>
        {formFollowUpEnabled ? (
          <View style={{ backgroundColor: '#dcfce7', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2, marginStart: 8 }}>
            <Text style={{ fontSize: 10, color: '#166534', fontWeight: '700' }}>{lang === 'he' ? 'פעיל' : 'Active'}</Text>
          </View>
        ) : null}
      </View>

      <View style={[{ flexDirection, alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 }]}>
        <Text variant="bodyMedium" style={{ color: theme.colors.onSurface, flex: 1, textAlign }}>
          {lang === 'he' ? 'שלח הודעת מעקב אוטומטית' : 'Send automatic follow-up message'}
        </Text>
        <Switch value={formFollowUpEnabled} onValueChange={setFormFollowUpEnabled} color="#2e6155" />
      </View>

      {formFollowUpEnabled ? (
        <View style={{ marginTop: 10 }}>
          <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 6, textAlign }}>
            {lang === 'he' ? 'שלח בעוד' : 'Send after'}
          </Text>
          <View style={[{ flexDirection, alignItems: 'center', gap: 8, marginBottom: 14 }]}>
            <TextInput
              value={String(formFollowUpInterval)}
              onChangeText={(v) => setFormFollowUpInterval(Math.max(1, Math.min(30, parseInt(v, 10) || 1)))}
              keyboardType="numeric"
              mode="outlined"
              style={{ width: 72, textAlign: 'center' }}
              outlineColor={theme.colors.outline}
              activeOutlineColor="#2e6155"
            />
            {(['hours', 'days', 'weeks'] as const).map((u) => {
              const isSelected = formFollowUpUnit === u;
              const label = u === 'hours' ? (lang === 'he' ? 'שעות' : 'Hours') : u === 'days' ? (lang === 'he' ? 'ימים' : 'Days') : (lang === 'he' ? 'שבועות' : 'Weeks');
              return (
                <Chip
                  key={u}
                  selected={isSelected}
                  onPress={() => setFormFollowUpUnit(u)}
                  compact
                  style={[styles.formPill, isSelected ? { backgroundColor: withAlpha('#2e6155', 0.145), borderColor: '#2e6155', borderWidth: 1.5 } : { backgroundColor: theme.colors.surfaceVariant, borderWidth: 1.5, borderColor: 'transparent' }]}
                  textStyle={{ fontSize: 12, color: isSelected ? '#2e6155' : theme.colors.onSurfaceVariant, fontWeight: isSelected ? '700' : '400' }}
                >
                  {label}
                </Chip>
              );
            })}
          </View>

          <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 6, textAlign }}>
            {lang === 'he' ? 'תבנית הודעה' : 'Message template'}
          </Text>
          <Pressable
            onPress={() => setFollowUpTemplateExpanded((v) => !v)}
            style={{
              borderWidth: 1,
              borderRadius: 8,
              borderColor: followUpTemplateExpanded ? '#2e6155' : theme.colors.outline,
              paddingHorizontal: 12,
              paddingVertical: 12,
              backgroundColor: theme.colors.surface,
              marginBottom: 12,
            }}
          >
            <View style={[{ flexDirection, alignItems: 'center', gap: 8 }]}>
              <MaterialCommunityIcons name="file-document-outline" size={16} color={theme.colors.onSurfaceVariant} />
              <Text variant="bodyMedium" style={{ flex: 1, color: formFollowUpTemplateName ? theme.colors.onSurface : theme.colors.onSurfaceVariant, textAlign }}>
                {waTemplatesLoading
                  ? (t('common.loading') || 'טוען...')
                  : (formFollowUpTemplateName || (lang === 'he' ? 'בחר תבנית...' : 'Select template...'))}
              </Text>
              <MaterialCommunityIcons name={followUpTemplateExpanded ? 'chevron-up' : 'chevron-down'} size={18} color={theme.colors.onSurfaceVariant} />
            </View>
          </Pressable>
          {followUpTemplateExpanded ? (
            <View style={{ borderWidth: 1, borderColor: theme.colors.outline, borderRadius: 8, marginBottom: 12, overflow: 'hidden', maxHeight: 260 }}>
              <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled>
                {waTemplates.length === 0 ? (
                  <View style={{ padding: 12 }}>
                    <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, textAlign }}>
                      {lang === 'he' ? 'אין תבניות מאושרות' : 'No approved templates'}
                    </Text>
                  </View>
                ) : (
                  waTemplates.map((tpl) => {
                    const isSelected = formFollowUpTemplateId === tpl.name;
                    return (
                      <Pressable
                        key={`${tpl.name}-${tpl.language}`}
                        style={[{ padding: 12, flexDirection, alignItems: 'center', gap: 8, backgroundColor: isSelected ? withAlpha('#2e6155', 0.1) : 'transparent' }]}
                        onPress={() => {
                          setFormFollowUpTemplateId(tpl.name);
                          setFormFollowUpTemplateName(tpl.friendlyName || tpl.name);
                          setFollowUpTemplateExpanded(false);
                        }}
                      >
                        <MaterialCommunityIcons name={isSelected ? 'check-circle' : 'circle-outline'} size={16} color={isSelected ? '#2e6155' : theme.colors.onSurfaceVariant} />
                        <View style={{ flex: 1 }}>
                          <Text variant="bodyMedium" style={{ color: isSelected ? '#2e6155' : theme.colors.onSurface, fontWeight: isSelected ? '700' : '400', textAlign }}>
                            {tpl.friendlyName || tpl.name}
                          </Text>
                          {tpl.friendlyName ? (
                            <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant, textAlign }}>{tpl.name}</Text>
                          ) : null}
                        </View>
                      </Pressable>
                    );
                  })
                )}
              </ScrollView>
            </View>
          ) : null}

          <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 6, textAlign }}>
            {lang === 'he' ? 'חזרות (עד תגובת הלקוח)' : 'Repeats (until customer responds)'}
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={[styles.chipRow, { flexDirection }]}>
              {[1, 2, 3, 4, 5].map((n) => {
                const isSelected = formFollowUpRepeat === n;
                return (
                  <Chip
                    key={n}
                    selected={isSelected}
                    onPress={() => setFormFollowUpRepeat(n)}
                    compact
                    style={[styles.formPill, isSelected ? { backgroundColor: withAlpha('#2e6155', 0.145), borderColor: '#2e6155', borderWidth: 1.5 } : { backgroundColor: theme.colors.surfaceVariant, borderWidth: 1.5, borderColor: 'transparent' }]}
                    textStyle={{ fontSize: 12, color: isSelected ? '#2e6155' : theme.colors.onSurfaceVariant, fontWeight: isSelected ? '700' : '400' }}
                  >
                    {n}
                  </Chip>
                );
              })}
            </View>
          </ScrollView>

          {formFollowUpTemplateId ? (
            <View style={[{ flexDirection, alignItems: 'center', gap: 6, marginTop: 12, padding: 10, borderRadius: 8, backgroundColor: withAlpha('#2e6155', 0.08) }]}>
              <MaterialCommunityIcons name="clock-outline" size={16} color="#2e6155" />
              <Text variant="bodySmall" style={{ color: '#2e6155', flex: 1, textAlign }}>
                {(() => {
                  const interval = Math.max(1, formFollowUpInterval || 2);
                  const d = formNextFollowUp ? new Date(formNextFollowUp) : new Date();
                  if (!formNextFollowUp) {
                    if (formFollowUpUnit === 'hours') d.setHours(d.getHours() + interval);
                    else if (formFollowUpUnit === 'weeks') d.setDate(d.getDate() + interval * 7);
                    else d.setDate(d.getDate() + interval);
                  }
                  const dateStr = formatDate(d.toISOString());
                  return lang === 'he' ? `ההודעה הראשונה תישלח ב: ${dateStr}` : `First message will be sent: ${dateStr}`;
                })()}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );

  if (loading) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  if (isNew) {
    return (
      <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
        <View style={[styles.header, { backgroundColor: theme.custom.headerBackground, paddingTop: insets.top + 4 }]}>
          <View style={[styles.headerRow, { flexDirection }]}>
            <IconButton icon={isRTL ? 'arrow-right' : 'arrow-left'} iconColor={theme.custom.headerText} size={24} onPress={() => { if (router.canGoBack()) router.back(); else router.replace('/(tabs)/more/cases'); }} />
            <Text variant="titleMedium" style={[styles.headerTitleText, { flex: 1, textAlign, color: theme.custom.headerText }]}>
              {t('cases.createCase', 'פנייה חדשה')}
            </Text>
          </View>
        </View>
        <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={styles.formScrollContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {/* ── Contact Section ── */}
            <View style={[styles.formSectionCard, { backgroundColor: theme.colors.surface }]}>
              <View style={[styles.formSectionHeader, { flexDirection }]}>
                <View style={styles.formSectionAccent} />
                <MaterialCommunityIcons name="account-box-outline" size={18} color="#2e6155" />
                <Text variant="titleSmall" style={styles.formSectionTitle}>{t('cases.contact', 'איש קשר')}</Text>
              </View>
              <Pressable
                onPress={() => setContactLookupVisible(true)}
                style={[styles.contactLookupBtn, { backgroundColor: formContactName ? withAlpha('#2e6155', 0.08) : withAlpha('#2e6155', 0.06), borderColor: withAlpha('#2e6155', 0.2), flexDirection }]}
              >
                <View style={[styles.contactLookupIconCircle, { backgroundColor: '#2e6155' }]}>
                  <MaterialCommunityIcons name={formContactName ? 'account-check' : 'account-search'} size={20} color="#FFFFFF" />
                </View>
                <View style={{ flex: 1 }}>
                  {formContactName ? (
                    <>
                      <Text style={{ color: theme.colors.onSurface, fontSize: 15, fontWeight: '600', textAlign }} numberOfLines={1}>
                        {formContactName}
                      </Text>
                      {formContactPhone ? (
                        <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 13, marginTop: 2, textAlign }} numberOfLines={1}>
                          {formContactPhone}
                        </Text>
                      ) : null}
                    </>
                  ) : (
                    <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 15, textAlign }}>
                      {t('common.selectContact', 'חפש ובחר איש קשר')}
                    </Text>
                  )}
                </View>
                {formContactName ? (
                  <Pressable hitSlop={8} onPress={() => { setFormContactName(''); setFormContactPhone(''); setFormContactId(''); }}>
                    <MaterialCommunityIcons name="close-circle" size={20} color={theme.colors.onSurfaceVariant} />
                  </Pressable>
                ) : (
                  <MaterialCommunityIcons name={isRTL ? 'chevron-left' : 'chevron-right'} size={20} color="#2e6155" />
                )}
              </Pressable>
              {!formContactName && (
                <Text style={{ color: '#e53935', fontSize: 12, marginTop: -8, marginBottom: 8, textAlign }}>
                  * {t('cases.contactRequired', 'חובה לבחור איש קשר')}
                </Text>
              )}
            </View>

            {/* ── Case Details Section ── */}
            <View style={[styles.formSectionCard, { backgroundColor: theme.colors.surface }]}>
              <View style={[styles.formSectionHeader, { flexDirection }]}>
                <View style={styles.formSectionAccent} />
                <MaterialCommunityIcons name="text-box-outline" size={18} color="#2e6155" />
                <Text variant="titleSmall" style={styles.formSectionTitle}>{t('cases.caseTitle')} *</Text>
              </View>
              <CaseFormField label={t('cases.caseTitle')} value={formTitle} onChangeText={setFormTitle} theme={theme} textAlign={textAlign} writingDirection={writingDirection} required />
              <CaseFormField label={t('cases.description', 'תיאור')} value={formDescription} onChangeText={setFormDescription} theme={theme} textAlign={textAlign} writingDirection={writingDirection} multiline placeholder={t('cases.description', 'תאר את הבעיה...')} />
              <CaseFormField label={t('cases.category', 'קטגוריה')} value={formCategory} onChangeText={setFormCategory} theme={theme} textAlign={textAlign} writingDirection={writingDirection} />
            </View>

            {/* ── Priority Section ── */}
            <View style={[styles.formSectionCard, { backgroundColor: theme.colors.surface }]}>
              <View style={[styles.formSectionHeader, { flexDirection }]}>
                <View style={styles.formSectionAccent} />
                <MaterialCommunityIcons name="flag-outline" size={18} color="#2e6155" />
                <Text variant="titleSmall" style={styles.formSectionTitle}>{t('cases.priority', 'עדיפות')}</Text>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={[styles.chipRow, { flexDirection }]}>
                  {PRIORITIES.map((p) => {
                    const pc = PRIORITY_COLORS[p];
                    const active = formPriority === p;
                    return (
                      <Chip
                        key={p}
                        selected={active}
                        onPress={() => setFormPriority(p)}
                        compact
                        style={[styles.formPill, active ? { backgroundColor: `${pc}20`, borderColor: pc, borderWidth: 1.5 } : { backgroundColor: theme.colors.surfaceVariant, borderWidth: 1.5, borderColor: 'transparent' }]}
                        textStyle={{ fontSize: 12, color: active ? pc : theme.colors.onSurfaceVariant, fontWeight: active ? '700' : '400' }}
                      >
                        {t(`cases.${p}`, p)}
                      </Chip>
                    );
                  })}
                </View>
              </ScrollView>
            </View>

            {/* ── Auto Follow-up Section ── */}
            {renderFollowUpSection([styles.formSectionCard, { backgroundColor: theme.colors.surface }])}

            {/* ── Custom Fields Section ── */}
            {caseFormSections.length > 0 && (
              <View style={[styles.formSectionCard, { backgroundColor: theme.colors.surface }]}>
                <DynamicFieldsSectionForm
                  sections={caseFormSections}
                  values={formDynamicFields}
                  onChange={(key, val) => setFormDynamicFields((prev) => ({ ...prev, [key]: val }))}
                  lang={lang}
                  formLayout={caseFormLayout}
                  theme={theme}
                  textAlign={textAlign}
                  writingDirection={writingDirection}
                  flexDirection={flexDirection}
                />
              </View>
            )}

            <View style={{ height: 100 }} />
          </ScrollView>

          {/* ── Sticky Footer ── */}
          <View style={[styles.stickyFooter, { paddingBottom: insets.bottom + 12, borderTopColor: theme.colors.outline, backgroundColor: theme.colors.surface }]}>
            <View style={{ flex: 1 }} />
            <Button mode="outlined" onPress={() => { if (router.canGoBack()) router.back(); else router.replace('/(tabs)/more/cases'); }} style={styles.footerBtn} textColor={theme.colors.onSurface}>{t('common.cancel')}</Button>
            <Button
              mode="contained"
              onPress={handleCreate}
              style={[styles.footerBtn, { backgroundColor: '#2e6155' }]}
              textColor="#fff"
              loading={saving}
              disabled={saving || !formTitle.trim() || !formContactName.trim()}
            >
              {t('common.save')}
            </Button>
          </View>
        </KeyboardAvoidingView>

        {/* Contact picker for create mode. Nested inside this return so the RN <Modal> actually
            renders here — previously the only <ContactLookup> lived in the detail/edit return, so
            in create mode tapping "select contact" set state but rendered nothing. */}
        <ContactLookup
          visible={contactLookupVisible}
          organization={user?.organization || ''}
          onSelect={(contact) => {
            setFormContactName(contact.name);
            setFormContactPhone(contact.phoneNumber);
            setFormContactId(contact.id);
            setContactLookupVisible(false);
          }}
          onDismiss={() => setContactLookupVisible(false)}
        />
      </View>
    );
  }

  if (error || !caseData) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.colors.background }]}>
        <View style={[styles.errorHeader, { paddingTop: insets.top + 8 }]}>
          <IconButton icon={isRTL ? 'arrow-right' : 'arrow-left'} iconColor="#FFFFFF" onPress={() => router.back()} />
        </View>
        <MaterialCommunityIcons
          name="alert-circle-outline"
          size={64}
          color={theme.colors.onSurfaceVariant}
          style={{ opacity: 0.4 }}
        />
        <Text
          variant="titleMedium"
          style={{ color: theme.colors.onSurface, marginTop: 12 }}
        >
          {error || t('common.noResults')}
        </Text>
        <Button mode="text" onPress={fetchCase} style={{ marginTop: 8 }}>
          {t('common.retry')}
        </Button>
      </View>
    );
  }

  const priorityColor = PRIORITY_COLORS[caseData.priority] || PRIORITY_COLORS.medium;
  const statusColor = getStatusColor(caseData.status);

  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
      {/* Header */}
      <View
        style={[
          styles.header,
          { backgroundColor: theme.custom.headerBackground, paddingTop: insets.top + 4 },
        ]}
      >
        <View style={[styles.headerRow, { flexDirection }]}>
          <IconButton
            icon={isRTL ? 'arrow-right' : 'arrow-left'}
            iconColor={theme.custom.headerText}
            size={24}
            onPress={() => router.back()}
          />
          <Text
            variant="titleMedium"
            numberOfLines={1}
            style={[styles.headerTitleText, { flex: 1, textAlign }]}
          >
            {t('cases.caseLabel', 'פנייה')}
          </Text>
          <HeaderMenu
            iconColor={theme.custom.headerText}
            items={[
              { key: 'note', title: t('leads.addNote', 'הוסף הערה'), icon: 'note-plus-outline', onPress: () => setNoteModalVisible(true) },
              { key: 'task', title: t('tasks.addTask', 'הוסף משימה'), icon: 'clipboard-check-outline', onPress: () => setAddTaskVisible(true) },
              { key: 'delete', title: t('common.delete'), icon: 'delete-outline', onPress: handleDelete, destructive: true, dividerBefore: true },
            ]}
          />
        </View>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* SLA Badge */}
        {caseSettings?.sla?.enabled ? (
          <View
            style={[
              styles.slaBadge,
              { backgroundColor: theme.colors.primaryContainer, borderColor: theme.colors.primary },
            ]}
          >
            <MaterialCommunityIcons name="clock-check-outline" size={18} color={theme.colors.primary} />
            <Text variant="labelMedium" style={{ color: theme.colors.primary, fontWeight: '600' }}>
              {t('cases.sla')}: {caseSettings.sla.responseTime}h {t('cases.response')} / {caseSettings.sla.resolutionTime}h {t('cases.resolution')}
            </Text>
          </View>
        ) : null}

        {/* Live per-case SLA status — breach (red) / due-soon (amber) / on-track (green). Reads the
            breach flags + due dates the backend stamps on the case, mirroring the web case form. */}
        {(() => {
          const c: any = caseData;
          if (!c || c.resolvedAt) return null;
          if (c.slaPaused === true || c.slaPaused === 'true') return null;
          const toMs = (v: any) => { if (!v) return null; const d = new Date(v?.seconds ? v.seconds * 1000 : v); const ms = d.getTime(); return isNaN(ms) ? null : ms; };
          const hasFR = !!c.firstResponseAt;
          const respDue = toMs(c.slaResponseDueAt);
          const resnDue = toMs(c.slaResolutionDueAt);
          const stageDue = toMs(c.stageDueAt);
          const breached = c.stageSlaBreached === true || c.slaResponseBreached === true || c.slaResolutionBreached === true
            || [(!hasFR ? respDue : null), resnDue, stageDue].some((d) => d && d - Date.now() <= 0);
          // The active/nearest deadline that's still in the future.
          const upcoming = [(!hasFR ? respDue : null), resnDue, stageDue].filter((d): d is number => !!d && d > Date.now());
          const soonest = upcoming.length ? Math.min(...upcoming) : null;
          const warn = !breached && soonest != null && (soonest - Date.now()) <= 60 * 60000;
          const hasAnyDue = respDue || resnDue || stageDue;
          if (!hasAnyDue && !breached) return null;
          const color = breached ? '#ef4444' : warn ? '#f59e0b' : '#10b981';
          const label = breached
            ? t('cases.slaBreach', 'חריגת SLA')
            : warn
              ? t('cases.slaDueSoon', 'קרוב לחריגה')
              : t('cases.slaOnTrack', 'עומד ב-SLA');
          const which = c.slaResponseBreached === true || (!hasFR && respDue && respDue - Date.now() <= 0)
            ? t('cases.response', 'תגובה')
            : c.slaResolutionBreached === true || (resnDue && resnDue - Date.now() <= 0)
              ? t('cases.resolution', 'פתרון')
              : (c.stageSlaBreached === true || (stageDue && stageDue - Date.now() <= 0))
                ? t('cases.slaStage', 'שלב')
                : '';
          return (
            <View style={[styles.slaBadge, { backgroundColor: `${color}18`, borderColor: color }]}>
              <MaterialCommunityIcons name={breached ? 'clock-alert' : warn ? 'clock-alert-outline' : 'clock-check-outline'} size={18} color={color} />
              <Text variant="labelMedium" style={{ color, fontWeight: '700' }}>
                {label}{which ? ` · ${which}` : ''}
                {soonest != null ? ` · ${isRTL ? 'עד' : 'due'} ${formatDate(new Date(soonest).toISOString())}` : ''}
              </Text>
            </View>
          );
        })()}

        {/* The case is edited in place: every field below is live, and a sticky save bar appears
            (only) while something differs from the saved case. */}

        {/* Status + priority */}
        <View
          style={[
            styles.sectionCard,
            { backgroundColor: theme.custom.cardBackground, borderColor: theme.colors.outlineVariant },
          ]}
        >
          <Text variant="labelLarge" style={[styles.sectionLabel, { color: theme.colors.onSurface, textAlign }]}>
            {t('cases.status')}
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <View style={[styles.statusRow, { flexDirection }]}>
              {STATUS_OPTIONS.map((st) => {
                const sc = getStatusColor(st);
                const active = (formStatus || '').toLowerCase().replace(/\s+/g, '_') === st;
                return (
                  <Chip
                    key={st}
                    selected={active}
                    onPress={() => setFormStatus(st)}
                    compact
                    style={[
                      styles.statusSelectChip,
                      active
                        ? { backgroundColor: `${sc}20`, borderColor: sc, borderWidth: 1.5 }
                        : { backgroundColor: theme.colors.surfaceVariant, borderWidth: 1.5, borderColor: 'transparent' },
                    ]}
                    textStyle={[{ fontSize: 12 }, active && { color: sc, fontWeight: '700' }]}
                    icon={active ? 'check' : undefined}
                  >
                    {caseStatusLabel(st)}
                  </Chip>
                );
              })}
            </View>
          </ScrollView>

          <Text variant="labelLarge" style={[styles.sectionLabel, { color: theme.colors.onSurface, textAlign, marginTop: 14 }]}>
            {t('cases.priority')}
          </Text>
          <View style={[styles.statusRow, { flexDirection }]}>
            {PRIORITIES.map((p) => {
              const pc = PRIORITY_COLORS[p] || PRIORITY_COLORS.medium;
              const active = formPriority === p;
              return (
                <Chip
                  key={p}
                  selected={active}
                  onPress={() => setFormPriority(p)}
                  compact
                  style={[
                    styles.statusSelectChip,
                    active
                      ? { backgroundColor: `${pc}20`, borderColor: pc, borderWidth: 1.5 }
                      : { backgroundColor: theme.colors.surfaceVariant, borderWidth: 1.5, borderColor: 'transparent' },
                  ]}
                  textStyle={[{ fontSize: 12 }, active && { color: pc, fontWeight: '700' }]}
                  icon={active ? 'check' : undefined}
                >
                  {t(`tasks.${p}`)}
                </Chip>
              );
            })}
          </View>
        </View>

        {/* Title, description, category */}
        <View
          style={[
            styles.sectionCard,
            { backgroundColor: theme.custom.cardBackground, borderColor: theme.colors.outlineVariant },
          ]}
        >
          <TextInput
            mode="outlined"
            label={t('cases.caseTitle', 'כותרת')}
            value={formTitle}
            onChangeText={setFormTitle}
            error={!formTitle.trim()}
            style={{ textAlign }}
            activeOutlineColor={theme.colors.primary}
          />
          <TextInput
            mode="outlined"
            label={t('cases.description')}
            value={formDescription}
            onChangeText={setFormDescription}
            multiline
            numberOfLines={3}
            style={{ marginTop: 10, textAlign }}
            activeOutlineColor={theme.colors.primary}
          />
          <TextInput
            mode="outlined"
            label={t('cases.category')}
            value={formCategory}
            onChangeText={setFormCategory}
            style={{ marginTop: 10, textAlign }}
            activeOutlineColor={theme.colors.primary}
            right={<TextInput.Icon icon="tag" />}
          />
        </View>

        {/* Contact */}
        <View
          style={[
            styles.sectionCard,
            { backgroundColor: theme.custom.cardBackground, borderColor: theme.colors.outlineVariant },
          ]}
        >
          <View style={[styles.formSectionHeader, { flexDirection }]}>
            <View style={styles.formSectionAccent} />
            <MaterialCommunityIcons name="account-box-outline" size={18} color="#2e6155" />
            <Text variant="titleSmall" style={styles.formSectionTitle}>{t('cases.contact')}</Text>
          </View>
          <Pressable
            onPress={() => setContactLookupVisible(true)}
            style={[styles.contactLookupBtn, { backgroundColor: withAlpha('#2e6155', formContactName ? 0.08 : 0.06), borderColor: withAlpha('#2e6155', 0.2), flexDirection, marginBottom: 0 }]}
          >
            <View style={[styles.contactLookupIconCircle, { backgroundColor: '#2e6155' }]}>
              <MaterialCommunityIcons name={formContactName ? 'account-check' : 'account-search'} size={20} color="#FFFFFF" />
            </View>
            <View style={{ flex: 1 }}>
              {formContactName ? (
                <>
                  <Text style={{ color: theme.colors.onSurface, fontSize: 15, fontWeight: '600', textAlign }} numberOfLines={1}>
                    {formContactName}
                  </Text>
                  {formContactPhone ? (
                    <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 13, marginTop: 2, textAlign }} numberOfLines={1}>
                      {formContactPhone}
                    </Text>
                  ) : null}
                </>
              ) : (
                <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 15, textAlign }}>
                  {t('common.selectContact', 'חפש ובחר איש קשר')}
                </Text>
              )}
            </View>
            {formContactName ? (
              <Pressable hitSlop={8} onPress={() => { setFormContactName(''); setFormContactPhone(''); setFormContactId(''); }}>
                <MaterialCommunityIcons name="close-circle" size={20} color={theme.colors.onSurfaceVariant} />
              </Pressable>
            ) : (
              <MaterialCommunityIcons name={isRTL ? 'chevron-left' : 'chevron-right'} size={20} color="#2e6155" />
            )}
          </Pressable>

          {(() => {
            const contactNavId = caseData.contactId || caseData.contactPhone || (caseData as any).contact_phone;
            const savedPhone = caseData.contactPhone || (caseData as any).contact_phone;
            if (!caseData.contactName || !contactNavId) return null;
            return (
              <Pressable
                onPress={() => router.push({ pathname: '/(tabs)/contacts/[id]', params: { id: contactNavId } })}
                style={[styles.detailRow, { marginTop: 10, flexDirection }]}
              >
                <MaterialCommunityIcons name="account-arrow-right-outline" size={18} color={theme.colors.primary} />
                <Text variant="bodySmall" style={{ color: theme.colors.primary, fontWeight: '600', flex: 1, textAlign }}>
                  {lang === 'he' ? 'פתח כרטיס איש קשר' : 'Open contact'}
                </Text>
                <MaterialCommunityIcons
                  name={isRTL ? 'chevron-left' : 'chevron-right'}
                  size={20}
                  color={theme.colors.onSurfaceVariant}
                />
              </Pressable>
            );
          })()}

          {(caseData.contactPhone || (caseData as any).contact_phone) ? (
            <View style={[styles.contactActions, { flexDirection, marginStart: 0 }]}>
              <Pressable
                onPress={() => {
                  const phone = caseData.contactPhone || (caseData as any).contact_phone;
                  placeSmartCall({
                    phoneNumber: phone,
                    organization: user?.organization || '',
                    user,
                    relatedTo: { type: 'case', entityId: caseData.id, entityName: caseData.subject || caseData.title },
                    contactId: (caseData as any).contactId,
                    leadId: (caseData as any).leadId,
                    customerName: caseData.contactName,
                  });
                }}
                style={[styles.contactActionBtn, { backgroundColor: theme.colors.primaryContainer }]}
              >
                <MaterialCommunityIcons name="phone" size={20} color={theme.colors.primary} />
                <Text variant="labelMedium" style={{ color: theme.colors.primary, fontWeight: '600' }}>
                  {t('common.call')}
                </Text>
              </Pressable>
              <Pressable
                onPress={() =>
                  router.push({
                    pathname: '/(tabs)/chats/[phoneNumber]',
                    params: { phoneNumber: caseData.contactPhone || (caseData as any).contact_phone },
                  })
                }
                style={[styles.contactActionBtn, { backgroundColor: '#25D36620' }]}
              >
                <MaterialCommunityIcons name="whatsapp" size={20} color="#25D366" />
                <Text variant="labelMedium" style={{ color: '#25D366', fontWeight: '600' }}>
                  WhatsApp
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setNoteModalVisible(true)}
                style={[styles.contactActionBtn, { backgroundColor: '#9C27B018' }]}
              >
                <MaterialCommunityIcons name="note-plus-outline" size={20} color="#9C27B0" />
                <Text variant="labelMedium" style={{ color: '#9C27B0', fontWeight: '600' }}>
                  {t('phoneCalls.addNote')}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setAddTaskVisible(true)}
                style={[styles.contactActionBtn, { backgroundColor: '#FFF3E0' }]}
              >
                <MaterialCommunityIcons name="clipboard-check-outline" size={20} color="#FF9800" />
                <Text variant="labelMedium" style={{ color: '#FF9800', fontWeight: '600' }}>
                  {t('tasks.taskShort', 'משימה')}
                </Text>
              </Pressable>
            </View>
          ) : null}
        </View>

        {/* Source & assignee */}
        <View
          style={[
            styles.sectionCard,
            { backgroundColor: theme.custom.cardBackground, borderColor: theme.colors.outlineVariant },
          ]}
        >
          <Text variant="labelLarge" style={[styles.sectionLabel, { color: theme.colors.onSurface, textAlign }]}>
            {t('leads.source')}
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={{ marginBottom: 14 }}>
            <View style={[styles.statusRow, { flexDirection }]}>
              {CASE_SOURCES.map((src) => {
                const active = formSource === src;
                return (
                  <Chip
                    key={src}
                    selected={active}
                    onPress={() => setFormSource(active ? '' : src)}
                    compact
                    style={[
                      styles.statusSelectChip,
                      active
                        ? { backgroundColor: '#2196F320', borderColor: '#2196F3', borderWidth: 1.5 }
                        : { backgroundColor: theme.colors.surfaceVariant, borderWidth: 1.5, borderColor: 'transparent' },
                    ]}
                    textStyle={[{ fontSize: 12 }, active && { color: '#2196F3', fontWeight: '700' }]}
                  >
                    {src.charAt(0).toUpperCase() + src.slice(1).replace(/_/g, ' ')}
                  </Chip>
                );
              })}
            </View>
          </ScrollView>

          {/* Assigned to - user picker */}
          <Pressable
            onPress={() => {
              setUserPickerExpanded((v) => !v);
              if (orgUsers.length === 0 && !orgUsersLoading) {
                setOrgUsersLoading(true);
                usersApi.getAll(user?.organization || '').then((u) => setOrgUsers(u)).catch(() => {}).finally(() => setOrgUsersLoading(false));
              }
            }}
            style={{
              borderWidth: 1,
              borderRadius: 4,
              borderColor: userPickerExpanded ? theme.colors.primary : theme.colors.outline,
              paddingHorizontal: 12,
              paddingVertical: 10,
              backgroundColor: theme.colors.surface,
            }}
          >
            <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 2, textAlign }}>
              {t('cases.assignedTo')}
            </Text>
            <View style={[{ flexDirection, alignItems: 'center', gap: 8 }]}>
              {formAssignedTo ? (
                <Avatar.Text
                  size={24}
                  label={getInitials(formAssignedTo)}
                  style={{ backgroundColor: theme.colors.primaryContainer }}
                  labelStyle={{ fontSize: 10, color: theme.colors.primary, fontWeight: '700' }}
                />
              ) : (
                <MaterialCommunityIcons name="account-check" size={16} color={theme.colors.onSurfaceVariant} />
              )}
              <Text variant="bodyMedium" style={{ flex: 1, color: formAssignedTo ? theme.colors.onSurface : theme.colors.onSurfaceVariant, textAlign }}>
                {orgUsersLoading ? t('common.loading') || 'טוען...' : (formAssignedTo || t('cases.selectAssignee') || 'בחר נציג')}
              </Text>
              <MaterialCommunityIcons name={userPickerExpanded ? 'chevron-up' : 'chevron-down'} size={18} color={theme.colors.onSurfaceVariant} />
            </View>
          </Pressable>
          {userPickerExpanded && (
            <View style={{ borderWidth: 1, borderColor: theme.colors.outline, borderRadius: 4, marginTop: 6, overflow: 'hidden' }}>
              <Pressable
                style={[{ padding: 12, flexDirection, alignItems: 'center', gap: 8 }]}
                onPress={() => { setFormAssignedTo(''); setFormAssignedToId(''); setUserPickerExpanded(false); }}
              >
                <MaterialCommunityIcons name="close" size={16} color={theme.colors.onSurfaceVariant} />
                <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>{t('common.none') || 'ללא'}</Text>
              </Pressable>
              <Divider />
              {orgUsers.map((u) => {
                const uid = u.uID || u.userId || u.id;
                const selected = uid === formAssignedToId;
                return (
                  <Pressable
                    key={uid}
                    style={[{ padding: 12, flexDirection, alignItems: 'center', gap: 8, backgroundColor: selected ? `${theme.colors.primary}15` : 'transparent' }]}
                    onPress={() => { setFormAssignedTo(u.userName || u.fullname || u.name || ''); setFormAssignedToId(uid || ''); setUserPickerExpanded(false); }}
                  >
                    <MaterialCommunityIcons name="account" size={16} color={selected ? theme.colors.primary : theme.colors.onSurfaceVariant} />
                    <Text variant="bodySmall" style={{ color: selected ? theme.colors.primary : theme.colors.onSurface, fontWeight: selected ? '700' : '400' }}>
                      {u.userName || u.fullname || u.name}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>

        {/* Due date, tags, notes */}
        <View
          style={[
            styles.sectionCard,
            { backgroundColor: theme.custom.cardBackground, borderColor: theme.colors.outlineVariant },
          ]}
        >
          <TextInput
            mode="outlined"
            label={t('cases.dueDate', 'Due Date')}
            value={formDueDate}
            onChangeText={setFormDueDate}
            placeholder="YYYY-MM-DD"
            style={{ textAlign }}
            activeOutlineColor={theme.colors.primary}
            right={<TextInput.Icon icon="calendar-clock" />}
          />
          <TextInput
            mode="outlined"
            label={t('contacts.tags', 'Tags')}
            value={formTags}
            onChangeText={setFormTags}
            placeholder={t('cases.tagsHint', 'Comma-separated tags')}
            style={{ marginTop: 10, textAlign }}
            activeOutlineColor={theme.colors.primary}
            right={<TextInput.Icon icon="tag-multiple" />}
          />
          <TextInput
            mode="outlined"
            label={t('cases.notes', 'Notes')}
            value={formNotes}
            onChangeText={setFormNotes}
            multiline
            numberOfLines={3}
            style={{ marginTop: 10, textAlign }}
            activeOutlineColor={theme.colors.primary}
            right={<TextInput.Icon icon="note-text" />}
          />
        </View>

        {/* Auto follow-up */}
        {renderFollowUpSection([
          styles.sectionCard,
          { backgroundColor: theme.custom.cardBackground, borderColor: theme.colors.outlineVariant },
        ])}

        {/* Custom fields */}
        {caseFormSections.length > 0 ? (
          <View
            style={[
              styles.sectionCard,
              { backgroundColor: theme.custom.cardBackground, borderColor: theme.colors.outlineVariant },
            ]}
          >
            <DynamicFieldsSectionForm
              sections={caseFormSections}
              values={formDynamicFields}
              onChange={(k, v) => setFormDynamicFields((prev) => ({ ...prev, [k]: v }))}
              lang={lang}
              formLayout={caseFormLayout}
              theme={theme}
              textAlign={textAlign}
              writingDirection={writingDirection}
              flexDirection={flexDirection}
            />
          </View>
        ) : null}

        {/* Timestamps */}
        <View
          style={[
            styles.sectionCard,
            { backgroundColor: theme.custom.cardBackground, borderColor: theme.colors.outlineVariant },
          ]}
        >
          <View style={[styles.timestampRow, { flexDirection }]}>
            <MaterialCommunityIcons name="clock-outline" size={14} color={theme.colors.onSurfaceVariant} />
            <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
              {t('common.create', 'Created')}:
            </Text>
            <Text variant="labelSmall" style={{ color: theme.colors.onSurface }}>
              {formatDate(caseData.createdAt || '')} • {formatRelativeTime(caseData.createdAt || '', lang)}
            </Text>
          </View>

          {caseData.updatedAt ? (
            <View style={[styles.timestampRow, { flexDirection, marginTop: 6 }]}>
              <MaterialCommunityIcons name="update" size={14} color={theme.colors.onSurfaceVariant} />
              <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                {t('common.edit', 'Updated')}:
              </Text>
              <Text variant="labelSmall" style={{ color: theme.colors.onSurface }}>
                {formatDate(caseData.updatedAt)} • {formatRelativeTime(caseData.updatedAt, lang)}
              </Text>
            </View>
          ) : null}

          {caseData.resolvedAt ? (
            <View style={[styles.timestampRow, { flexDirection, marginTop: 6 }]}>
              <MaterialCommunityIcons name="check-circle" size={14} color="#4CAF50" />
              <Text variant="labelSmall" style={{ color: '#4CAF50' }}>
                Resolved:
              </Text>
              <Text variant="labelSmall" style={{ color: '#4CAF50' }}>
                {formatDate(caseData.resolvedAt)} • {formatRelativeTime(caseData.resolvedAt, lang)}
              </Text>
            </View>
          ) : null}
        </View>

        <ExtraFieldsSectionView
          data={{ ...(caseData as any).customFields, ...caseData } as Record<string, any>}
          lang={lang}
          excludeKeys={[
            'description', 'category', 'source', 'contactName', 'contactPhone',
            'contact_phone', 'assignedToName', 'assignedToId', 'dueDate', 'due_date',
            'resolvedAt', 'title', 'subject', 'priority', 'sla',
            'customerName', 'customerPhone', 'name', 'phone', 'email',
            ...getSectionFieldKeys(caseFormSections),
          ]}
        />

        {/* Timeline / Notes */}
        <View
          style={[
            styles.sectionCard,
            { backgroundColor: theme.custom.cardBackground, borderColor: theme.colors.outlineVariant },
          ]}
        >
          <View style={[styles.sectionHeader, { flexDirection }]}>
            <View style={[styles.sectionIconCircle, { backgroundColor: '#2e615518' }]}>
              <MaterialCommunityIcons name="timeline-text-outline" size={18} color="#2e6155" />
            </View>
            <Text variant="titleSmall" style={[styles.sectionTitle, { color: theme.colors.onSurface, flex: 1, textAlign }]}>
              {t('contacts.timeline')}
            </Text>
          </View>

          {timelineLoading ? (
            <ActivityIndicator size="small" color={theme.colors.primary} style={{ marginVertical: 12 }} />
          ) : timelineEvents.length === 0 ? (
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center', paddingVertical: 12 }}>
              {t('timeline.noEvents')}
            </Text>
          ) : (
            <>
              {(() => {
                const notesCount = timelineEvents.filter((e: any) => (e.TimelineType || e.timelineType || e.type || '').toLowerCase() === 'note' || (e.TimelineType || e.timelineType || e.type || '').toLowerCase() === 'internal_mention').length;
                const systemCount = timelineEvents.length - notesCount;
                if (notesCount === 0 || systemCount === 0) return null;
                const filters: { key: 'all' | 'notes' | 'system'; label: string; count?: number }[] = [
                  { key: 'all', label: 'הכל' },
                  { key: 'notes', label: 'הערות', count: notesCount },
                  { key: 'system', label: 'מערכת', count: systemCount },
                ];
                return (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10, maxHeight: 34 }} contentContainerStyle={{ gap: 6 }}>
                    {filters.map((f) => {
                      const isActive = timelineFilter === f.key;
                      return (
                        <Pressable
                          key={f.key}
                          onPress={() => setTimelineFilter(f.key)}
                          style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, backgroundColor: isActive ? theme.colors.primary : theme.colors.surfaceVariant }}
                        >
                          <Text style={{ fontSize: 12, fontWeight: '600', color: isActive ? '#fff' : theme.colors.onSurfaceVariant }}>
                            {f.label}
                          </Text>
                          {f.count != null && (
                            <Text style={{ fontSize: 10, color: isActive ? '#fff' : theme.colors.onSurfaceVariant }}>
                              {f.count}
                            </Text>
                          )}
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                );
              })()}
              {timelineEvents
                .filter((ev: any) => {
                  if (timelineFilter === 'all') return true;
                  const evType = (ev.TimelineType || ev.timelineType || ev.type || '').toLowerCase();
                  if (timelineFilter === 'notes') return evType === 'note' || evType === 'internal_mention';
                  return evType !== 'note' && evType !== 'internal_mention';
                })
                .slice(0, 15).map((ev: any, idx: number) => (
                <View key={ev.id || idx} style={[styles.timelineEvent, { borderStartColor: '#2e615540' }]}>
                  <Text variant="bodySmall" style={{ color: theme.colors.onSurface, lineHeight: 20, textAlign: isRTL ? 'right' : 'left', writingDirection: isRTL ? 'rtl' : 'ltr' }}>
                    {ev.notes || ev.description || ev.text || ev.note || ''}
                  </Text>
                  <View style={[{ flexDirection: isRTL ? 'row-reverse' : 'row', gap: 8, marginTop: 4 }]}>
                    {ev.createdByName || ev.userName ? (
                      <Text variant="labelSmall" style={{ color: '#2e6155', fontWeight: '600' }}>
                        {ev.createdByName || ev.userName}
                      </Text>
                    ) : null}
                    {ev.createdOn || ev.createdAt || ev.timestamp ? (
                      <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                        {formatRelativeTime(ev.createdOn || ev.createdAt || ev.timestamp, lang)}
                      </Text>
                    ) : null}
                  </View>
                  {(() => {
                    const evType = (ev.TimelineType || ev.timelineType || ev.type || '').toLowerCase();
                    const taskId = ev.taskId || ev.TaskId || (evType.startsWith('task') ? (ev.entityId || ev.relatedId) : '');
                    if (!evType.startsWith('task') || !taskId) return null;
                    const taskDone = evType === 'task_completed' || (ev.taskStatus || ev.TaskStatus || '').toLowerCase() === 'completed';
                    return (
                      <View style={{ flexDirection: isRTL ? 'row-reverse' : 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
                        <Pressable
                          onPress={() => openTaskFromTimeline(String(taskId))}
                          style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: theme.colors.primary, paddingVertical: 5, paddingHorizontal: 12, borderRadius: 14 }}
                        >
                          <MaterialCommunityIcons name="pencil-outline" size={13} color="#fff" />
                          <Text style={{ color: '#fff', fontSize: 12, fontWeight: '600' }}>{lang === 'he' ? 'ערוך' : 'Edit'}</Text>
                        </Pressable>
                        {!taskDone ? (
                          <Pressable
                            onPress={() => completeTaskFromTimeline(String(taskId))}
                            disabled={completingTaskId === taskId}
                            style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#10B98122', borderWidth: 1, borderColor: '#10B981', paddingVertical: 5, paddingHorizontal: 12, borderRadius: 14, opacity: completingTaskId === taskId ? 0.6 : 1 }}
                          >
                            <MaterialCommunityIcons name="check" size={13} color="#059669" />
                            <Text style={{ color: '#059669', fontSize: 12, fontWeight: '700' }}>{completingTaskId === taskId ? '…' : (lang === 'he' ? 'הושלם' : 'Complete')}</Text>
                          </Pressable>
                        ) : (
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                            <MaterialCommunityIcons name="check-circle" size={14} color="#059669" />
                            <Text style={{ color: '#059669', fontSize: 12, fontWeight: '700' }}>{lang === 'he' ? 'הושלמה' : 'Done'}</Text>
                          </View>
                        )}
                      </View>
                    );
                  })()}
                </View>
              ))}
            </>
          )}
        </View>

        <View style={{ height: insets.bottom + 24 }} />
      </ScrollView>
      </KeyboardAvoidingView>

      <ContactLookup
        visible={contactLookupVisible}
        organization={user?.organization || ''}
        onSelect={(contact) => {
          setFormContactName(contact.name);
          setFormContactPhone(contact.phoneNumber);
          setFormContactId(contact.id);
          setContactLookupVisible(false);
        }}
        onDismiss={() => setContactLookupVisible(false)}
      />

      <StickySaveBar
        visible={isDirty}
        saving={saving}
        disabled={!formTitle.trim()}
        onSave={handleSave}
        onDiscard={discardChanges}
      />
      <PrimaryActionBar
        visible={!isDirty && !!nextCaseStatus}
        label={nextCaseStatus ? nextCaseLabel[nextCaseStatus] : ''}
        icon="arrow-right-circle-outline"
        color={nextCaseStatus ? getStatusColor(nextCaseStatus) : undefined}
        onPress={() => { if (nextCaseStatus) handleStatusChange(nextCaseStatus); }}
      />

      <Portal>
        <Modal
          visible={noteModalVisible}
          onDismiss={() => { Keyboard.dismiss(); setNoteModalVisible(false); }}
          contentContainerStyle={[styles.modalContainer, { backgroundColor: theme.colors.surface }]}
        >
          <KeyboardAvoidingView
            behavior="padding"
            style={{ flex: 1 }}
          >
            <Text variant="titleLarge" style={{ color: theme.colors.onSurface, fontWeight: '700', marginBottom: 12 }}>
              {t('phoneCalls.addNote')}
            </Text>
            <TextInput
              label={t('phoneCalls.noteHint', 'Write a note...')}
              value={noteText}
              onChangeText={setNoteText}
              mode="outlined"
              multiline
              numberOfLines={4}
              autoFocus
              style={[styles.formInput, { textAlign, writingDirection }]}
              outlineColor={theme.colors.outline}
              activeOutlineColor={theme.colors.primary}
            />
            <NoteAttachmentRow
              attachment={noteAttachment}
              onAttach={setNoteAttachment}
              onRemove={() => setNoteAttachment(null)}
              primaryColor={theme.colors.primary}
            />
            <View style={[styles.modalActions, { flexDirection }]}>
              <Button
                mode="outlined"
                onPress={() => { Keyboard.dismiss(); setNoteModalVisible(false); setNoteText(''); setNoteAttachment(null); }}
                style={styles.modalButton}
                textColor={theme.colors.onSurface}
              >
                {t('common.cancel')}
              </Button>
              <Button
                mode="contained"
                onPress={() => { Keyboard.dismiss(); handleAddNote(); }}
                loading={addingNote}
                disabled={(!noteText.trim() && !noteAttachment) || addingNote}
                style={[styles.modalButton, { backgroundColor: theme.colors.primary }]}
                textColor="#FFFFFF"
              >
                {t('common.save')}
              </Button>
            </View>
          </KeyboardAvoidingView>
        </Modal>
      </Portal>

      <AddTaskSheet
        visible={addTaskVisible}
        onDismiss={() => setAddTaskVisible(false)}
        organization={user?.organization || ''}
        user={user}
        relatedPhone={caseData?.contactPhone || (caseData as any)?.contact_phone || ''}
        relatedTo={{
          type: 'case',
          entityId: caseData?.id || '',
          entityName: caseData?.subject || caseData?.title || '',
        }}
        defaultTitle={caseData?.contactName ? `${t('contacts.phoneCall')} - ${caseData.contactName}` : (caseData?.subject || caseData?.title)}
      />
    </View>
  );
}

function CaseFormField({
  label,
  value,
  onChangeText,
  theme,
  textAlign,
  writingDirection,
  multiline,
  keyboardType,
  placeholder,
  required,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  theme: any;
  textAlign: 'left' | 'right';
  writingDirection: 'ltr' | 'rtl';
  multiline?: boolean;
  keyboardType?: any;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <View style={{ marginBottom: 12 }}>
      <TextInput
        label={`${label}${required ? ' *' : ''}`}
        value={value}
        onChangeText={onChangeText}
        mode="outlined"
        multiline={multiline}
        numberOfLines={multiline ? 3 : undefined}
        placeholder={placeholder}
        style={[styles.formInput, { textAlign }]}
        outlineColor={theme.colors.outline}
        activeOutlineColor="#2e6155"
        keyboardType={keyboardType}
        outlineStyle={{ borderRadius: 10 }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: '#2e6155',
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: 8,
  },
  header: {
    paddingBottom: 4,
  },
  headerRow: {
    alignItems: 'center',
  },
  headerTitleText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 17,
  },
  body: { flex: 1 },
  bodyContent: {
    padding: 16,
    gap: 12,
    paddingBottom: 130,
  },
  slaBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
  },
  contactActions: {
    gap: 10,
    marginTop: 8,
    marginStart: 48,
  },
  contactActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: borderRadius.md,
    alignSelf: 'flex-start',
  },
  bannerCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  bannerRow: {
    alignItems: 'flex-start',
    justifyContent: 'space-around',
    gap: 16,
  },
  bannerItem: {
    gap: 6,
  },
  priorityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  priorityBadgeText: {
    fontSize: 13,
    fontWeight: '700',
  },
  statusChip: {
    height: 28,
    borderRadius: 14,
  },
  statusChipText: {
    fontSize: 12,
    fontWeight: '600',
  },
  sectionCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  sectionHeader: {
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  sectionIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionTitle: {
    fontWeight: '700',
    fontSize: 14,
  },
  timelineEvent: {
    borderStartWidth: 2,
    paddingStart: 12,
    marginBottom: 12,
  },
  sectionLabel: {
    fontWeight: '600',
    marginBottom: 10,
  },
  statusRow: {
    gap: 8,
    alignItems: 'center',
  },
  statusSelectChip: {
    height: 32,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 2,
  },
  detailIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailContent: {
    flex: 1,
    gap: 2,
  },
  timestampRow: {
    alignItems: 'center',
    gap: 6,
  },
  modalContainer: {
    marginHorizontal: 16,
    borderRadius: borderRadius.xl,
    maxHeight: '92%',
    padding: 20,
  },
  modalSectionCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
  },
  modalHeader: {
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  formInput: {
    marginBottom: 14,
  },
  formLabel: {
    fontWeight: '600',
    marginBottom: 8,
  },
  chipsRow: {
    gap: 8,
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  formChip: {
    height: 32,
    borderRadius: 16,
  },
  editModalActions: {
    gap: 10,
    alignItems: 'center',
    marginTop: 8,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e2e8f0',
  },
  modalActions: {
    gap: 12,
    justifyContent: 'flex-end',
    marginTop: 8,
  },
  modalButton: {
    minWidth: 90,
    borderRadius: 10,
  },
  deleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  formScrollContent: {
    padding: 16,
    paddingBottom: 0,
    gap: 0,
  },
  formSectionCard: {
    borderRadius: 14,
    padding: 16,
    marginBottom: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  formSectionHeader: {
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
  },
  formSectionAccent: {
    width: 3,
    height: 18,
    borderRadius: 2,
    backgroundColor: '#2e6155',
  },
  formSectionTitle: {
    fontWeight: '700',
    color: '#2e6155',
    fontSize: 14,
  },
  contactLookupBtn: {
    borderWidth: 1.5,
    borderRadius: 12,
    borderStyle: 'dashed',
    paddingHorizontal: 14,
    paddingVertical: 14,
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  contactLookupIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipRow: { gap: 8, paddingBottom: 6 },
  formPill: { height: 32, borderRadius: 16 },
  stickyFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  footerBtn: {
    minWidth: 90,
    borderRadius: 10,
  },
  formInputNew: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    marginBottom: 2,
  },
  formChipNew: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#f5f5f5',
    borderWidth: 1,
    borderColor: 'transparent',
  },
});
