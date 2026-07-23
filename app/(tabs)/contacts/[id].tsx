import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Keyboard,
} from 'react-native';
import {
  Text,
  Avatar,
  Chip,
  Button,
  Divider,
  IconButton,
  Menu,
  Portal,
  Surface,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useContactStore } from '../../../stores/contactStore';
import { useAuthStore } from '../../../stores/authStore';
import { useLeadStore } from '../../../stores/leadStore';
import { contactsApi } from '../../../services/api/contacts';
import { usersApi } from '../../../services/api/users';
import { tasksApi } from '../../../services/api/tasks';
import { quotesApi } from '../../../services/api/quotes';
import axiosInstance from '../../../services/api/axiosInstance';
import { ENDPOINTS } from '../../../constants/api';
import { placeSmartCall } from '../../../utils/phoneCall';
import { cleanPhoneNumber } from '../../../utils/phoneNumber';
import PhoneNumberInput from '../../../components/PhoneNumberInput';
import { useAppTheme } from '../../../hooks/useAppTheme';
import { useRTL } from '../../../hooks/useRTL';
import {
  formatPhoneNumber,
  getInitials,
  formatRelativeTime,
  formatDate,
} from '../../../utils/formatters';
import { spacing, borderRadius } from '../../../constants/theme';
import {
  DynamicFieldsSectionView,
  DynamicFieldsSectionForm,
  type DynamicSection,
} from '../../../components/DynamicFieldsSection';
import { MediaPanel } from '../../../components/chat/MediaPanel';
import { NoteAttachmentRow, type NoteAttachment } from '../../../components/NoteAttachmentRow';
import ContactInternalMessages from '../../../components/ContactInternalMessages';
import AddTaskSheet from '../../../components/AddTaskSheet';
import type { Contact, TimelineEvent } from '../../../types';

type DetailTab = 'timeline' | 'internal' | 'related';

// Soft cap on how many notes can be pinned to the top of a contact's timeline.
const MAX_PINNED_NOTES = 3;

function extractTags(keys: string[] | string | undefined): string[] {
  if (!keys) return [];
  if (Array.isArray(keys)) return keys.filter(Boolean);
  if (typeof keys === 'string') {
    return keys.split('#').filter((t: string) => t.trim()).map((t: string) => t.trim());
  }
  return [];
}

const EMPTY_CONTACT: Partial<Contact> = {
  name: '',
  phoneNumber: '',
  email: '',
  keys: [],
};

export default function ContactDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const theme = useAppTheme();
  const { isRTL, flexDirection, textAlign, writingDirection } = useRTL();
  const { t, i18n } = useTranslation();
  const lang = i18n.language as 'en' | 'he';

  const user = useAuthStore((s) => s.user);
  const organization = user?.organization ?? '';

  const contacts = useContactStore((s) => s.contacts);
  // All tags across the org (derived from the whole DB in the store) — used to autocomplete tags
  // as the user types, so the app matches the web where typing "ר" suggests existing tags.
  const allTags = useContactStore((s) => s.facets.tags);
  const refreshFacets = useContactStore((s) => s.refreshFacets);
  const updateContact = useContactStore((s) => s.updateContact);
  const deleteContact = useContactStore((s) => s.deleteContact);
  const loadContacts = useContactStore((s) => s.loadContacts);
  const setSelectedContact = useContactStore((s) => s.setSelectedContact);

  const isNew = id === 'new';
  const contactFromStore = useMemo(
    () => (isNew ? null : contacts.find((c) => c.id === id) ?? null),
    [contacts, id, isNew],
  );
  const [fetchedContact, setFetchedContact] = useState<Contact | null>(null);
  const [loadingContact, setLoadingContact] = useState(false);
  // Prefer the full fetched record (incl. dynamic/custom fields) over the sparse list-store item,
  // so the edit form shows and saves every field like the web.
  const contact = fetchedContact ?? contactFromStore;

  const [activeTab, setActiveTab] = useState<DetailTab>('timeline');
  const [editVisible, setEditVisible] = useState(isNew);
  const [menuVisible, setMenuVisible] = useState(false);
  const [mediaPanelVisible, setMediaPanelVisible] = useState(false);
  const [form, setForm] = useState<Partial<Contact>>(
    contact ? { ...contact } : { ...EMPTY_CONTACT },
  );
  const [saving, setSaving] = useState(false);
  const [existingContact, setExistingContact] = useState<Contact | null>(null);
  const [checkingDuplicate, setCheckingDuplicate] = useState(false);
  const [contactFormSections, setContactFormSections] = useState<DynamicSection[]>([]);
  const [contactFormLayout, setContactFormLayout] = useState<string[]>([]);
  const [noteModalVisible, setNoteModalVisible] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [noteAttachment, setNoteAttachment] = useState<NoteAttachment | null>(null);
  const [addingNote, setAddingNote] = useState(false);
  const [formTags, setFormTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [timelineEvents, setTimelineEvents] = useState<any[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [relatedRecords, setRelatedRecords] = useState<any>({ tables: [], leads: [], quotes: [], tasks: [] });
  const [relatedLoading, setRelatedLoading] = useState(false);
  const [orgUsers, setOrgUsers] = useState<any[]>([]);
  const [orgUsersLoading, setOrgUsersLoading] = useState(false);
  const [ownerPickerExpanded, setOwnerPickerExpanded] = useState(false);
  const [flagSaving, setFlagSaving] = useState(false);
  const [addTaskVisible, setAddTaskVisible] = useState(false);
  const [consentModalVisible, setConsentModalVisible] = useState(false);
  const [consentSource, setConsentSource] = useState('manual');
  const [consentCustomSource, setConsentCustomSource] = useState('');
  const [consentType, setConsentType] = useState('Explicit');

  useEffect(() => {
    // Always load the full record for an existing contact (even if a sparse copy is in the list
    // store) so the dynamic/custom fields are available for viewing and editing.
    if (!isNew && id && organization) {
      setLoadingContact(true);
      contactsApi.getById(organization, id).then((c) => {
        if (c) {
          setFetchedContact(c);
          setForm({ ...c });
          setFormTags(extractTags(c.keys));
        }
      }).catch(() => {}).finally(() => setLoadingContact(false));
    }
  }, [isNew, id, organization]);

  const refetchContact = useCallback(async () => {
    if (isNew || !id || !organization) return;
    try {
      const c = await contactsApi.getById(organization, id);
      if (c) {
        setFetchedContact(c);
        setForm({ ...c });
        setFormTags(extractTags(c.keys));
      }
    } catch {
      // keep existing data on failure
    }
  }, [isNew, id, organization]);

  useEffect(() => {
    if (contact) {
      setSelectedContact(contact);
      setForm({ ...contact });
      setFormTags(extractTags(contact.keys));
    }
    return () => setSelectedContact(null);
  }, [contact, setSelectedContact]);

  const fetchTimeline = useCallback(async () => {
    if (!organization || !contact?.phoneNumber) return;
    setTimelineLoading(true);
    try {
      const [timeline, chatTimeline] = await Promise.all([
        contactsApi.getTimeline(organization, contact.phoneNumber).catch(() => []),
        contactsApi.getTimeline(organization, contact.id).catch(() => []),
      ]);
      let all = [...(Array.isArray(timeline) ? timeline : []), ...(Array.isArray(chatTimeline) ? chatTimeline : [])];

      // Cross-entity notes: fetch lead timelines if enabled
      try {
        const settingRes = await axiosInstance.post(ENDPOINTS.GET_CROSS_ENTITY_NOTES_SETTING, { organization });
        const crossEnabled = settingRes.data?.Data?.crossEntityNotesEnabled || settingRes.data?.crossEntityNotesEnabled;
        const crossMode = settingRes.data?.Data?.crossEntityNotesMode || settingRes.data?.crossEntityNotesMode || 'notes_only';
        if (crossEnabled) {
          const phone = (contact.phoneNumber || '').replace(/\D/g, '').trim();
          if (phone) {
            const leads = await contactsApi.getLeadsByContact(organization, phone).catch(() => []);
            const leadArr = Array.isArray(leads) ? leads : [];
            for (const lead of leadArr) {
              const lid = lead.LeadId || lead.leadId || lead.id;
              if (!lid) continue;
              try {
                let entries = await contactsApi.getTimeline(organization, `lead_${lid}`).catch(() => []);
                entries = Array.isArray(entries) ? entries : [];
                if (crossMode === 'notes_only') {
                  entries = entries.filter((e: any) => (e.TimelineType || e.timelineType) === 'note');
                }
                entries = entries.map((e: any) => ({ ...e, _crossEntitySource: 'lead', _crossEntityLabel: lead.Title || lead.title || lid }));
                all = [...all, ...entries];
              } catch {}
            }
          }
        }
      } catch {}

      const unique = all.reduce((acc: any[], ev: any) => {
        const id = ev.TimelineId || ev.timelineId || ev.id;
        if (id && !acc.find((e) => (e.TimelineId || e.timelineId || e.id) === id)) acc.push(ev);
        return acc;
      }, []);
      unique.sort((a: any, b: any) => {
        const dateA = new Date(a.CreateDateTimeUTC || a.createdOn || a.CreatedOn || a.timestamp || a.createdAt || 0).getTime();
        const dateB = new Date(b.CreateDateTimeUTC || b.createdOn || b.CreatedOn || b.timestamp || b.createdAt || 0).getTime();
        return dateB - dateA;
      });
      setTimelineEvents(unique);
    } catch {
      setTimelineEvents([]);
    } finally {
      setTimelineLoading(false);
    }
  }, [organization, contact]);

  const fetchRelated = useCallback(async () => {
    if (!organization || !contact) return;
    setRelatedLoading(true);
    try {
      const [related, leads, quotesRes] = await Promise.all([
        contactsApi.getRelatedRecords(organization, contact.id).catch(() => null),
        contactsApi.getLeadsByContact(organization, contact.phoneNumber || '').catch(() => []),
        quotesApi.getAll(organization, undefined, undefined, 1, 500, contact.phoneNumber || contact.id || '').catch(() => ({ data: [], total: 0 })),
      ]);
      const allQuotes = Array.isArray(quotesRes?.data) ? quotesRes.data : [];
      const contactQuotes = allQuotes.filter(
        (q: any) =>
          (q.contactPhone || q.contact_phone || q.phoneNumber || '') === (contact.phoneNumber || contact.id || '') ||
          (q.contactId || q.contact_id) === contact.id ||
          (contact.name && (q.contactName || q.contact_name || '')?.toLowerCase().includes((contact.name || '').toLowerCase())),
      );
      setRelatedRecords({
        tables: related?.tables || [],
        leads: Array.isArray(leads) ? leads : [],
        quotes: contactQuotes.length > 0 ? contactQuotes : allQuotes,
      });
    } catch {
      setRelatedRecords({ tables: [], leads: [], quotes: [] });
    } finally {
      setRelatedLoading(false);
    }
  }, [organization, contact]);

  useEffect(() => {
    if (contact && !isNew) {
      fetchTimeline();
      fetchRelated();
    }
  }, [contact, isNew, fetchTimeline, fetchRelated]);

  const handleAddNote = useCallback(async () => {
    if (!organization || !contact || (!noteText.trim() && !noteAttachment)) return;
    setAddingNote(true);
    try {
      await contactsApi.addTimelineEntry(
        organization,
        contact.phoneNumber || contact.id,
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
  }, [organization, contact, noteText, noteAttachment, user, t, fetchTimeline]);

  useEffect(() => {
    if (organization) {
      contactsApi.getDynamicContactColumns(organization).then((res) => {
        setContactFormSections(res.sections || []);
        setContactFormLayout(res.formLayout || []);
      }).catch(() => {});
    }
  }, [organization]);

  const switchTab = useCallback((tab: DetailTab) => {
    setActiveTab(tab);
  }, []);

  // Pin / unpin a note to the top of the timeline. Soft cap of MAX_PINNED_NOTES;
  // optimistic update with revert on failure (mirrors the web behaviour).
  // Open a task (from the timeline) in the full task detail screen for editing / completing.
  const openTaskFromTimeline = useCallback((taskId: string) => {
    if (!taskId) return;
    router.push({ pathname: '/(tabs)/tasks/[id]', params: { id: String(taskId) } } as any);
  }, [router]);

  // Mark a task complete straight from the timeline, then refresh.
  const completeTaskFromTimeline = useCallback(async (taskId: string) => {
    if (!taskId || !organization) return;
    try {
      await tasksApi.complete(organization, taskId, user?.uID || user?.userId || '', user?.fullname || user?.name || 'Gambot');
      await fetchTimeline();
    } catch {
      Alert.alert(t('common.error'));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organization, user]);

  const handleTogglePin = useCallback(async (entry: any) => {
    const timelineId = entry.TimelineId || entry.timelineId;
    if (!timelineId || !contact) return;
    const currentlyPinned = !!(entry.isPinned || entry.IsPinned);
    const newPinned = !currentlyPinned;

    if (newPinned) {
      const pinnedCount = (timelineEvents || []).filter(
        (e) => (e.isPinned || e.IsPinned) && (e.TimelineId || e.timelineId) !== timelineId,
      ).length;
      if (pinnedCount >= MAX_PINNED_NOTES) {
        Alert.alert(
          '',
          t('timeline.pinLimit', `ניתן לנעוץ עד ${MAX_PINNED_NOTES} הערות. בטל נעיצה של הערה אחרת קודם.`),
        );
        return;
      }
    }

    const nowIso = new Date().toISOString();
    const prevPinnedOn = entry.pinnedOn || entry.PinnedOn || null;
    setTimelineEvents((prev) =>
      prev.map((item) =>
        (item.TimelineId || item.timelineId) === timelineId
          ? { ...item, isPinned: newPinned, pinnedOn: newPinned ? nowIso : null }
          : item,
      ),
    );

    try {
      const response = await axiosInstance.post(ENDPOINTS.TOGGLE_TIMELINE_ENTRY_PIN, {
        organization,
        contactId: contact.id || contact.phoneNumber,
        timelineId,
        isPinned: newPinned,
        userId: user?.userId || user?.uID || '',
        userName: user?.fullname || '',
      });
      if (!response.data?.Success && response.data?.Success !== undefined) {
        throw new Error(response.data?.Message || 'Failed to toggle pin');
      }
    } catch (err) {
      setTimelineEvents((prev) =>
        prev.map((item) =>
          (item.TimelineId || item.timelineId) === timelineId
            ? { ...item, isPinned: currentlyPinned, pinnedOn: currentlyPinned ? prevPinnedOn : null }
            : item,
        ),
      );
    }
  }, [organization, contact, timelineEvents, user, t]);

  const contactName = useMemo(
    () => contact?.name || contact?.phoneNumber || '',
    [contact],
  );

  const tags = useMemo(() => extractTags(contact?.keys), [contact]);

  // Autocomplete suggestions for the tag input: existing org tags that start with (or, as a fallback,
  // contain) what the user typed, excluding tags already added to this contact. Prefix matches first.
  const tagSuggestions = useMemo(() => {
    const q = tagInput.trim().toLowerCase();
    if (!q) return [];
    const pool = (allTags || []).filter((tg) => tg && !formTags.includes(tg));
    const starts = pool.filter((tg) => tg.toLowerCase().startsWith(q));
    const contains = pool.filter((tg) => !tg.toLowerCase().startsWith(q) && tg.toLowerCase().includes(q));
    return [...starts, ...contains].slice(0, 8);
  }, [tagInput, allTags, formTags]);

  const addTag = useCallback((raw: string) => {
    const trimmed = (raw || '').trim();
    if (trimmed && !formTags.includes(trimmed)) {
      setFormTags((prev) => [...prev, trimmed]);
    }
    setTagInput('');
  }, [formTags]);

  // Make sure the tag autocomplete pool is populated even when a contact is opened directly
  // (e.g. from a chat) without having visited the contacts list first. Cheap local-DB distinct read.
  useEffect(() => {
    refreshFacets?.();
  }, [refreshFacets]);

  const handleCall = useCallback(() => {
    if (contact?.phoneNumber) {
      placeSmartCall({
        phoneNumber: contact.phoneNumber,
        organization,
        user,
        relatedTo: { type: 'contact', entityId: contact.id, entityName: contact.name },
        contactId: contact.id,
        customerName: contact.name,
      });
    }
  }, [contact, organization, user]);

  const handleWhatsApp = useCallback(() => {
    if (contact?.phoneNumber) {
      router.push({
        pathname: '/(tabs)/chats/[phoneNumber]',
        params: { phoneNumber: contact.phoneNumber },
      });
    }
  }, [contact, router]);

  const handleDelete = useCallback(() => {
    setMenuVisible(false);
    Alert.alert(contactName, t('contacts.deleteConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          if (!organization || !contact) return;
          try {
            await deleteContact(organization, contact.id || contact.phoneNumber || '');
            // Refresh the list so it reloads without the deleted contact.
            loadContacts(organization, user?.uID || user?.userId, 'all').catch(() => {});
            Alert.alert(
              t('common.success', 'הצלחה'),
              t('contacts.deleteSuccess', 'איש הקשר נמחק בהצלחה'),
            );
            if (router.canGoBack()) router.back();
            else router.replace('/(tabs)/contacts');
          } catch {
            Alert.alert(t('common.error'), t('contacts.deleteError', 'מחיקת איש הקשר נכשלה'));
          }
        },
      },
    ]);
  }, [organization, contact, contactName, deleteContact, loadContacts, user, t, router]);

  const createContact = useContactStore((s) => s.createContact);

  // Server-side "contact already exists?" check, mirroring the web NewContactForm.
  const checkDuplicate = useCallback(async (fullNumber: string): Promise<Contact | null> => {
    if (!organization || !isNew) return null;
    const cleaned = (fullNumber || '').replace(/\D/g, '');
    if (!cleaned) { setExistingContact(null); return null; }
    setCheckingDuplicate(true);
    try {
      const results = await contactsApi.search(organization, cleaned, 5);
      const found = (Array.isArray(results) ? results : []).find(
        (c) => (c.phoneNumber || c.id || '').replace(/\D/g, '') === cleaned,
      ) || null;
      setExistingContact(found);
      return found;
    } catch {
      setExistingContact(null);
      return null;
    } finally {
      setCheckingDuplicate(false);
    }
  }, [organization, isNew]);

  const handleSave = useCallback(async () => {
    if (!organization) return;
    setSaving(true);
    try {
      // Normalize to WhatsApp format on save too (safety net), matching the web.
      const normalizedPhone = cleanPhoneNumber(form.phoneNumber || '');
      const formData = { ...form, phoneNumber: normalizedPhone, keys: formTags.length > 0 ? formTags.join('#') : '' };
      const userId = user?.userId || user?.uID || '';
      const userName = user?.fullname || user?.name || 'Gambot';
      if (isNew) {
        // Server-side duplicate check (like web) before creating.
        const found = await checkDuplicate(normalizedPhone);
        if (found) {
          setSaving(false);
          return; // inline warning under the phone field guides the user
        }
        await createContact(organization, { ...formData, id: normalizedPhone || '' }, userId, userName);
        if (router.canGoBack()) {
          router.back();
        } else {
          router.replace('/(tabs)/contacts');
        }
      } else {
        await updateContact(organization, { ...formData, id: contact?.id ?? '' }, userId, userName);
        setEditVisible(false);
        // Pull the authoritative record back so the view reflects exactly what was saved.
        await refetchContact();
      }
    } catch {
      Alert.alert(t('common.error'));
    } finally {
      setSaving(false);
    }
  }, [organization, form, formTags, contact, isNew, createContact, updateContact, refetchContact, checkDuplicate, t, router]);

  const updateField = useCallback(
    (field: keyof Contact, value: string) => {
      setForm((prev) => ({ ...prev, [field]: value }));
    },
    [],
  );

  // Persist consent / spam flags directly (mirrors web ContactFormView UpdateContactById).
  const persistContactFlags = useCallback(
    async (patch: Partial<Contact>) => {
      if (!organization || !contact) return;
      const phone = (contact.phoneNumber || contact.id || '').toString();
      const userId = user?.userId || user?.uID || '';
      const userName = user?.fullname || user?.name || 'Gambot';
      await contactsApi.update(organization, { id: phone, phoneNumber: phone, ...patch }, userId, userName);
      await refetchContact();
    },
    [organization, contact, user, refetchContact],
  );

  const buildConsentText = useCallback(
    (source: string) => {
      const he: Record<string, string> = {
        manual: 'הסכמה ידנית',
        website_form: 'הלקוח אישר קבלת פניות דרך טופס באתר',
        facebook_lead_ads: 'הלקוח אישר קבלת פניות דרך טופס לידים בפייסבוק',
        google_lead_gen: 'הלקוח אישר קבלת פניות דרך טופס לידים בגוגל',
        excel_import: 'הלקוח נוסף ברשימה מיובאת עם אישור consent',
        physical_form: 'הלקוח חתם על טופס פיזי',
        phone_call: 'הלקוח אישר טלפונית קבלת פניות',
        event_registration: 'הלקוח נרשם לאירוע והסכים לקבלת עדכונים',
        whatsapp_optin: 'הלקוח אישר קבלת הודעות וואטסאפ',
      };
      const en: Record<string, string> = {
        manual: 'Manual consent',
        website_form: 'Customer opted in via website form',
        facebook_lead_ads: 'Customer opted in via Facebook lead form',
        google_lead_gen: 'Customer opted in via Google lead form',
        excel_import: 'Added from an imported list with consent',
        physical_form: 'Customer signed a physical form',
        phone_call: 'Customer agreed over the phone',
        event_registration: 'Customer registered for an event and opted in',
        whatsapp_optin: 'Customer opted in to WhatsApp messages',
      };
      const map = i18n.language !== 'en' ? he : en;
      if (map[source]) return map[source];
      return i18n.language !== 'en'
        ? `הלקוח אישר קבלת פניות (${source})`
        : `Customer opted in (${source})`;
    },
    [i18n.language],
  );

  const handleSaveConsent = useCallback(() => {
    const finalSource = (consentSource === 'other' ? consentCustomSource.trim() : consentSource) || 'manual';
    const run = async () => {
      setFlagSaving(true);
      try {
        const nowIso = new Date().toISOString();
        await persistContactFlags({
          consent: true,
          consentSource: finalSource,
          consentDate: nowIso,
          consentText: buildConsentText(finalSource),
          consentType,
        });
        setConsentModalVisible(false);
      } catch {
        Alert.alert(t('common.error'));
      } finally {
        setFlagSaving(false);
      }
    };
    run();
  }, [consentSource, consentCustomSource, consentType, persistContactFlags, buildConsentText, t]);

  const openConsentModal = useCallback(() => {
    setMenuVisible(false);
    const knownSources = ['manual', 'website_form', 'facebook_lead_ads', 'google_lead_gen', 'excel_import', 'physical_form', 'phone_call', 'event_registration', 'whatsapp_optin'];
    const existing = ((contact as any)?.consentSource || '').toString();
    if (existing && !knownSources.includes(existing)) {
      setConsentSource('other');
      setConsentCustomSource(existing);
    } else {
      setConsentSource(existing || 'manual');
      setConsentCustomSource('');
    }
    setConsentType((contact as any)?.consentType || 'Explicit');
    setConsentModalVisible(true);
  }, [contact]);

  const handleRevokeConsent = useCallback(() => {
    setMenuVisible(false);
    const run = async () => {
      setFlagSaving(true);
      try {
        await persistContactFlags({ consent: false, consentSource: null, consentDate: null, consentText: null, consentType: null });
      } catch {
        Alert.alert(t('common.error'));
      } finally {
        setFlagSaving(false);
      }
    };
    Alert.alert(
      t('contacts.consentNotAgreed', 'לא הסכימו'),
      t('contacts.markNotAgreedConfirm', 'לסמן שאיש הקשר אינו מסכים לקבל הודעות?'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('common.confirm', 'אישור'), style: 'destructive', onPress: run },
      ],
    );
  }, [persistContactFlags, t]);

  const handleToggleSpam = useCallback(() => {
    setMenuVisible(false);
    const isSpam = !!(contact as any)?.isSpam;
    const run = async () => {
      setFlagSaving(true);
      try {
        const patch: Partial<Contact> = isSpam
          ? { isSpam: false }
          : {
              isSpam: true,
              markedSpamAt: new Date().toISOString(),
              markedSpamBy: user?.userId || user?.uID || 'system',
              markedSpamByName: user?.fullname || user?.name || 'system',
            };
        await persistContactFlags(patch);
      } catch {
        Alert.alert(t('common.error'));
      } finally {
        setFlagSaving(false);
      }
    };
    Alert.alert(
      isSpam ? t('contacts.removeSpam', 'הסר ספאם') : t('contacts.markSpam', 'סמן כספאם'),
      isSpam
        ? t('contacts.removeSpamConfirm', 'להסיר את סימון הספאם מאיש קשר זה?')
        : t('contacts.markSpamConfirm', 'לסמן איש קשר זה כספאם? הוא יוחרג מקמפיינים ושליחות.'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('common.confirm', 'אישור'), style: 'destructive', onPress: run },
      ],
    );
  }, [contact, persistContactFlags, user, t]);

  const loadOrgUsers = useCallback(() => {
    if (orgUsers.length > 0 || orgUsersLoading || !organization) return;
    setOrgUsersLoading(true);
    usersApi
      .getAll(organization)
      .then((u) => setOrgUsers(u))
      .catch(() => {})
      .finally(() => setOrgUsersLoading(false));
  }, [orgUsers.length, orgUsersLoading, organization]);

  if (!contact && !isNew) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.colors.background }]}>
        <Stack.Screen options={{ headerShown: false }} />
        {loadingContact ? (
          <ActivityIndicator size="large" color={theme.colors.primary} />
        ) : (
          <>
            <Text style={{ color: theme.colors.onSurface, marginBottom: 12 }}>{t('contacts.notFound', 'איש קשר לא נמצא')}</Text>
            <Button onPress={() => router.back()}>{t('common.back')}</Button>
          </>
        )}
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View
        style={[
          styles.header,
          {
            backgroundColor: theme.custom.headerBackground,
            paddingTop: insets.top + 4,
            flexDirection,
          },
        ]}
      >
        <IconButton
          icon={isRTL ? 'arrow-right' : 'arrow-left'}
          iconColor={theme.custom.headerText}
          size={24}
          onPress={() => router.back()}
        />
        <Text style={styles.headerTitle} numberOfLines={1}>
          {isNew ? t('contacts.addContact') : contactName}
        </Text>
        {!isNew ? (
          <Menu
            visible={menuVisible}
            onDismiss={() => setMenuVisible(false)}
            anchor={
              <IconButton
                icon="dots-vertical"
                iconColor={theme.custom.headerText}
                size={24}
                onPress={() => setMenuVisible(true)}
              />
            }
            contentStyle={{ backgroundColor: theme.colors.surface }}
          >
            <Menu.Item
              leadingIcon="pencil-outline"
              onPress={() => {
                setMenuVisible(false);
                setEditVisible(true);
              }}
              title={t('common.edit')}
            />
            <Menu.Item
              leadingIcon="image-multiple"
              onPress={() => {
                setMenuVisible(false);
                setMediaPanelVisible(true);
              }}
              title={t('contacts.mediaAndFiles', 'מדיה וקבצים')}
            />
            <Divider />
            <Menu.Item
              leadingIcon="shield-check"
              onPress={openConsentModal}
              title={t('contacts.documentConsent', 'תעד הסכמה לדיוור')}
              titleStyle={{ color: '#16A34A' }}
            />
            {(contact as any)?.consent !== false ? (
              <Menu.Item
                leadingIcon="cancel"
                onPress={handleRevokeConsent}
                title={t('contacts.markNotAgreed', 'סמן כאי-הסכמה')}
                titleStyle={{ color: '#D97706' }}
              />
            ) : null}
            <Menu.Item
              leadingIcon={(contact as any)?.isSpam ? 'shield-check-outline' : 'shield-alert-outline'}
              onPress={handleToggleSpam}
              title={(contact as any)?.isSpam ? t('contacts.removeSpam', 'הסר ספאם') : t('contacts.markSpam', 'סמן כספאם')}
              titleStyle={{ color: (contact as any)?.isSpam ? theme.colors.onSurface : '#DC2626' }}
            />
            <Divider />
            <Menu.Item
              leadingIcon="delete-outline"
              onPress={handleDelete}
              title={t('common.delete')}
              titleStyle={{ color: theme.colors.error }}
            />
          </Menu>
        ) : (
          <View style={{ width: 48 }} />
        )}
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.avatarSection}>
          {contact?.photoURL ? (
            <Avatar.Image size={88} source={{ uri: contact.photoURL }} />
          ) : (
            <Avatar.Text
              size={88}
              label={getInitials(contactName || '?')}
              style={{ backgroundColor: theme.colors.primaryContainer }}
              labelStyle={{ color: theme.colors.primary, fontWeight: '700', fontSize: 32 }}
            />
          )}
          <Text variant="headlineSmall" style={{ color: theme.colors.onSurface, fontWeight: '700', marginTop: 12 }}>
            {contactName || t('contacts.addContact')}
          </Text>
          {contact?.phoneNumber ? (
            <Text variant="bodyLarge" style={{ color: theme.colors.onSurfaceVariant, marginTop: 2 }}>
              {formatPhoneNumber(contact.phoneNumber)}
            </Text>
          ) : null}
          {contact?.email ? (
            <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant, marginTop: 2 }}>
              {contact.email}
            </Text>
          ) : null}
          {(() => {
            const c = contact as any;
            const chips: React.ReactNode[] = [];
            if (c?.isSpam) {
              chips.push(
                <Chip key="spam" compact icon="shield-alert" style={{ backgroundColor: '#FEE2E2' }} textStyle={{ color: '#DC2626', fontWeight: '700', fontSize: 12 }}>
                  {t('contacts.possibleSpam', 'ספאם')}
                </Chip>,
              );
            }
            if (c?.consent === true) {
              const srcLabel = c?.consentSource ? ` · ${c.consentSource}` : '';
              chips.push(
                <Chip key="consent-yes" compact icon="check-decagram" style={{ backgroundColor: '#DCFCE7' }} textStyle={{ color: '#16A34A', fontWeight: '700', fontSize: 12 }}>
                  {t('contacts.consentAgreed', 'הסכים')}{srcLabel}
                </Chip>,
              );
            } else if (c?.consent === false) {
              chips.push(
                <Chip key="consent-no" compact icon="cancel" style={{ backgroundColor: '#FEF3C7' }} textStyle={{ color: '#D97706', fontWeight: '700', fontSize: 12 }}>
                  {t('contacts.consentNotAgreed', 'לא הסכים')}
                </Chip>,
              );
            }
            return chips.length > 0 ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10, justifyContent: 'center', opacity: flagSaving ? 0.5 : 1 }}>
                {chips}
              </View>
            ) : null;
          })()}
        </View>

        {!isNew ? (
          <View style={[styles.actionsRow, { flexDirection }]}>
            <ActionButton
              icon="phone"
              label={t('contacts.makeCall')}
              color={theme.colors.primary}
              bg={theme.colors.primaryContainer}
              onPress={handleCall}
            />
            <ActionButton
              icon="whatsapp"
              label="WhatsApp"
              color="#25D366"
              bg="#E8F5E9"
              onPress={handleWhatsApp}
            />
            <ActionButton
              icon="note-plus-outline"
              label={t('phoneCalls.noteShort', 'הערה')}
              color="#9C27B0"
              bg="#F3E5F5"
              onPress={() => setNoteModalVisible(true)}
            />
            <ActionButton
              icon="clipboard-check-outline"
              label={t('tasks.taskShort', 'משימה')}
              color="#FF9800"
              bg="#FFF3E0"
              onPress={() => setAddTaskVisible(true)}
            />
          </View>
        ) : null}

        <Surface style={[styles.card, { backgroundColor: theme.colors.surface }]} elevation={1}>
          {contact?.ownerName ? (
            <InfoRow
              icon="account-outline"
              label={t('contacts.owner')}
              value={contact.ownerName}
              theme={theme}
              flexDirection={flexDirection}
              textAlign={textAlign}
            />
          ) : null}
          {contact?.lastConversationStatus ? (
            <>
              {contact.ownerName ? <Divider style={styles.cardDivider} /> : null}
              <InfoRow
                icon="chat-processing-outline"
                label={t('contacts.status', 'Status')}
                value={contact.lastConversationStatus}
                theme={theme}
                flexDirection={flexDirection}
                textAlign={textAlign}
              />
            </>
          ) : null}
          {contact?.modifiedOn ? (
            <>
              <Divider style={styles.cardDivider} />
              <InfoRow
                icon="calendar-outline"
                label={t('common.modified', 'Modified')}
                value={formatDate(contact.modifiedOn)}
                theme={theme}
                flexDirection={flexDirection}
                textAlign={textAlign}
              />
            </>
          ) : null}
          {contact?.createdOn ? (
            <>
              <Divider style={styles.cardDivider} />
              <InfoRow
                icon="calendar-plus-outline"
                label={t('common.created', 'Created')}
                value={formatDate(contact.createdOn)}
                theme={theme}
                flexDirection={flexDirection}
                textAlign={textAlign}
              />
            </>
          ) : null}
        </Surface>

        {tags.length > 0 ? (
          <Surface style={[styles.card, { backgroundColor: theme.colors.surface }]} elevation={1}>
            <Text
              variant="titleSmall"
              style={{ color: theme.colors.onSurface, fontWeight: '600', marginBottom: 8 }}
            >
              {t('contacts.tags')}
            </Text>
            <View style={[styles.tagsWrap, { flexDirection }]}>
              {tags.map((tag) => (
                <Chip
                  key={tag}
                  compact
                  style={{ backgroundColor: theme.colors.primaryContainer }}
                  textStyle={{ color: theme.colors.primary, fontSize: 12 }}
                >
                  #{tag}
                </Chip>
              ))}
            </View>
          </Surface>
        ) : null}

        <DynamicFieldsSectionView
          sections={contactFormSections}
          data={contact as Record<string, any>}
          lang={lang}
          formLayout={contactFormLayout}
        />

        {!isNew ? (
          <>
            <View
              style={[
                styles.tabBar,
                { backgroundColor: theme.colors.surface, borderBottomColor: theme.colors.outline },
              ]}
            >
              {([
                { key: 'timeline' as DetailTab, label: t('contacts.timeline') },
                { key: 'internal' as DetailTab, label: t('internalMessages.tabShort', isRTL ? 'הודעות פנימיות' : 'Internal') },
                { key: 'related' as DetailTab, label: t('contacts.relatedRecords') },
              ]).map((tabItem) => {
                const isActive = activeTab === tabItem.key;
                return (
                  <Pressable
                    key={tabItem.key}
                    style={[
                      styles.tab,
                      isActive && { borderBottomWidth: 3, borderBottomColor: theme.colors.primary },
                    ]}
                    onPress={() => switchTab(tabItem.key)}
                  >
                    <Text
                      variant="titleSmall"
                      numberOfLines={1}
                      style={{
                        color: isActive ? theme.colors.primary : theme.colors.onSurfaceVariant,
                        fontWeight: isActive ? '700' : '500',
                      }}
                    >
                      {tabItem.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {activeTab === 'timeline' ? (
              <TimelineSection
                events={timelineEvents}
                loading={timelineLoading}
                theme={theme}
                t={t}
                lang={lang}
                isRTL={isRTL}
                flexDirection={flexDirection}
                onTogglePin={handleTogglePin}
                onOpenTask={openTaskFromTimeline}
                onCompleteTask={completeTaskFromTimeline}
              />
            ) : activeTab === 'internal' ? (
              <ContactInternalMessages contactPhone={contact?.phoneNumber || ''} />
            ) : (
              <RelatedRecordsSection
                data={relatedRecords}
                loading={relatedLoading}
                theme={theme}
                t={t}
                isRTL={isRTL}
                flexDirection={flexDirection}
                router={router}
              />
            )}
          </>
        ) : null}

        <View style={{ height: 40 }} />
      </ScrollView>

      <Portal>
        <Modal
          visible={editVisible}
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={() => setEditVisible(false)}
        >
          <KeyboardAvoidingView
            behavior="padding"
            style={[styles.modalContainer, { backgroundColor: theme.colors.background, paddingTop: insets.top }]}
          >
            <View
              style={[
                styles.modalHeader,
                { borderBottomColor: theme.colors.outline, flexDirection },
              ]}
            >
              <Pressable onPress={() => setEditVisible(false)}>
                <Text style={{ color: theme.colors.primary, fontSize: 16 }}>
                  {t('common.cancel')}
                </Text>
              </Pressable>
              <Text
                variant="titleMedium"
                style={{ color: theme.colors.onSurface, fontWeight: '700' }}
              >
                {isNew ? t('contacts.addContact') : t('contacts.editContact')}
              </Text>
              <Pressable onPress={handleSave} disabled={saving}>
                {saving ? (
                  <ActivityIndicator size="small" color={theme.colors.primary} />
                ) : (
                  <Text style={{ color: theme.colors.primary, fontSize: 16, fontWeight: '600' }}>
                    {t('common.save')}
                  </Text>
                )}
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={styles.formContent} keyboardShouldPersistTaps="handled">
              <FormField
                label={t('contacts.name', 'Name')}
                value={form.name ?? ''}
                onChangeText={(v) => updateField('name', v)}
                theme={theme}
                textAlign={textAlign}
                writingDirection={writingDirection}
              />
              <PhoneNumberInput
                label={t('contacts.phone')}
                value={form.phoneNumber ?? ''}
                onChangeNumber={(v) => { updateField('phoneNumber', v); if (existingContact) setExistingContact(null); }}
                onBlurNormalized={(full) => { checkDuplicate(full); }}
                theme={theme}
                helperText={
                  i18n.language !== 'en'
                    ? 'המספרים יומרו אוטומטית לפורמט וואטסאפ (למשל: 050-5278310 ← 972505278310)'
                    : 'Numbers are auto-converted to WhatsApp format (e.g. 050-5278310 → 972505278310)'
                }
              />
              {isNew && existingContact ? (
                <Pressable
                  onPress={() => {
                    const goId = existingContact.id || existingContact.phoneNumber || '';
                    if (goId) router.replace({ pathname: '/(tabs)/contacts/[id]', params: { id: goId } });
                  }}
                  style={{
                    flexDirection,
                    alignItems: 'center',
                    gap: 8,
                    backgroundColor: '#FEF3C7',
                    borderColor: '#F59E0B',
                    borderWidth: 1,
                    borderRadius: 10,
                    padding: 12,
                    marginBottom: 12,
                  }}
                >
                  <MaterialCommunityIcons name="alert-circle-outline" size={20} color="#B45309" />
                  <Text style={{ color: '#92400E', flex: 1, textAlign, writingDirection }}>
                    {i18n.language !== 'en'
                      ? `איש קשר עם מספר זה כבר קיים: ${existingContact.name || existingContact.phoneNumber}. הקש למעבר.`
                      : `A contact with this number already exists: ${existingContact.name || existingContact.phoneNumber}. Tap to open.`}
                  </Text>
                </Pressable>
              ) : null}
              <FormField
                label={t('contacts.email')}
                value={form.email ?? ''}
                onChangeText={(v) => updateField('email', v)}
                theme={theme}
                textAlign={textAlign}
                writingDirection={writingDirection}
                keyboardType="email-address"
                autoCapitalize="none"
              />
              {/* Owner — transfer ownership via user picker (mirrors web) */}
              <View style={styles.formField}>
                <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 6 }}>
                  {t('contacts.owner')}
                </Text>
                <Pressable
                  onPress={() => { setOwnerPickerExpanded((v) => !v); loadOrgUsers(); }}
                  style={{
                    borderWidth: 1,
                    borderRadius: 10,
                    borderColor: ownerPickerExpanded ? theme.colors.primary : theme.colors.outline,
                    paddingHorizontal: 12,
                    paddingVertical: 12,
                    backgroundColor: theme.custom.inputBackground,
                  }}
                >
                  <View style={[{ flexDirection, alignItems: 'center', gap: 8 }]}>
                    <MaterialCommunityIcons name="account-tie" size={18} color={theme.colors.onSurfaceVariant} />
                    <Text variant="bodyMedium" style={{ flex: 1, color: (form as any).ownerName ? theme.colors.onSurface : theme.colors.onSurfaceVariant, textAlign }}>
                      {orgUsersLoading
                        ? (t('common.loading') || 'טוען...')
                        : ((form as any).ownerName || (form as any).ownerId || t('contacts.selectOwner', 'בחר בעלים'))}
                    </Text>
                    <MaterialCommunityIcons name={ownerPickerExpanded ? 'chevron-up' : 'chevron-down'} size={18} color={theme.colors.onSurfaceVariant} />
                  </View>
                </Pressable>
                {ownerPickerExpanded ? (
                  <View style={{ borderWidth: 1, borderColor: theme.colors.outline, borderRadius: 10, marginTop: 6, overflow: 'hidden' }}>
                    <Pressable
                      style={[{ padding: 12, flexDirection, alignItems: 'center', gap: 8 }]}
                      onPress={() => { setForm((prev) => ({ ...prev, ownerId: '', ownerName: '', contactOwner: '' } as any)); setOwnerPickerExpanded(false); }}
                    >
                      <MaterialCommunityIcons name="close" size={16} color={theme.colors.onSurfaceVariant} />
                      <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>{t('common.none', 'ללא')}</Text>
                    </Pressable>
                    <Divider />
                    {orgUsers.map((u) => {
                      const uid = u.uID || u.userId || u.id || '';
                      const uname = u.FullName || u.userName || u.UserName || u.fullname || u.name || u.Email || '';
                      const selected = uid === (form as any).ownerId;
                      return (
                        <Pressable
                          key={uid}
                          style={[{ padding: 12, flexDirection, alignItems: 'center', gap: 8, backgroundColor: selected ? `${theme.colors.primary}15` : 'transparent' }]}
                          onPress={() => { setForm((prev) => ({ ...prev, ownerId: uid, ownerName: uname, contactOwner: uid } as any)); setOwnerPickerExpanded(false); }}
                        >
                          <MaterialCommunityIcons name="account" size={16} color={selected ? theme.colors.primary : theme.colors.onSurfaceVariant} />
                          <Text variant="bodySmall" style={{ color: selected ? theme.colors.primary : theme.colors.onSurface, fontWeight: selected ? '700' : '400' }}>
                            {uname}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                ) : null}
              </View>
              <View style={styles.formField}>
                <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 6 }}>
                  {t('contacts.tags')}
                </Text>
                <View style={[styles.tagsWrap, { flexDirection, marginBottom: 8 }]}>
                  {formTags.map((tag, idx) => (
                    <Chip
                      key={`${tag}-${idx}`}
                      compact
                      onClose={() => setFormTags((prev) => prev.filter((_, i) => i !== idx))}
                      style={{ backgroundColor: theme.colors.primaryContainer }}
                      textStyle={{ color: theme.colors.primary, fontSize: 12 }}
                    >
                      #{tag}
                    </Chip>
                  ))}
                </View>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TextInput
                    value={tagInput}
                    onChangeText={setTagInput}
                    placeholder={t('contacts.addTag', 'Add tag...')}
                    placeholderTextColor={theme.custom.placeholder}
                    style={[
                      styles.formInput,
                      {
                        flex: 1,
                        backgroundColor: theme.custom.inputBackground,
                        color: theme.colors.onSurface,
                        textAlign,
                        writingDirection,
                        borderColor: theme.colors.outline,
                      },
                    ]}
                    onSubmitEditing={() => addTag(tagInput)}
                    returnKeyType="done"
                    autoCorrect={false}
                    autoCapitalize="none"
                  />
                  <Pressable
                    onPress={() => addTag(tagInput)}
                    style={{
                      backgroundColor: theme.colors.primary,
                      borderRadius: 10,
                      paddingHorizontal: 16,
                      justifyContent: 'center',
                    }}
                  >
                    <MaterialCommunityIcons name="plus" size={20} color="#FFF" />
                  </Pressable>
                </View>
                {tagSuggestions.length > 0 ? (
                  <View style={[styles.tagsWrap, { flexDirection, marginTop: 8 }]}>
                    {tagSuggestions.map((tg) => (
                      <Chip
                        key={`sugg-${tg}`}
                        compact
                        icon="tag-outline"
                        onPress={() => addTag(tg)}
                        style={{ backgroundColor: theme.custom.inputBackground, borderColor: theme.colors.outline, borderWidth: 1 }}
                        textStyle={{ color: theme.colors.onSurface, fontSize: 12 }}
                      >
                        {tg}
                      </Chip>
                    ))}
                  </View>
                ) : null}
              </View>
              <DynamicFieldsSectionForm
                sections={contactFormSections}
                values={form as Record<string, any>}
                onChange={(k, v) => setForm((prev) => ({ ...prev, [k]: v }))}
                lang={lang}
                formLayout={contactFormLayout}
                theme={theme}
                textAlign={textAlign}
                writingDirection={writingDirection}
                flexDirection={flexDirection}
              />
            </ScrollView>
          </KeyboardAvoidingView>
        </Modal>
      </Portal>

      <Portal>
        <Modal
          visible={noteModalVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setNoteModalVisible(false)}
        >
          <KeyboardAvoidingView
            behavior="padding"
            style={{ flex: 1 }}
          >
            <Pressable
              style={styles.noteOverlay}
              onPress={() => { Keyboard.dismiss(); setNoteModalVisible(false); }}
            >
              <Pressable
                onPress={(e) => e.stopPropagation()}
                style={[styles.noteSheet, { backgroundColor: theme.colors.surface, paddingBottom: Math.max(insets.bottom, 12) + 8 }]}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <Text
                    variant="titleMedium"
                    style={{ color: theme.colors.onSurface, fontWeight: '700' }}
                  >
                    {t('phoneCalls.addNote')}
                  </Text>
                  <Pressable onPress={() => { Keyboard.dismiss(); setNoteModalVisible(false); setNoteText(''); }} hitSlop={8}>
                    <MaterialCommunityIcons name="close" size={22} color={theme.colors.onSurfaceVariant} />
                  </Pressable>
                </View>
                <TextInput
                  value={noteText}
                  onChangeText={setNoteText}
                  placeholder={t('phoneCalls.noteHint', 'Write a note...')}
                  placeholderTextColor={theme.custom?.placeholder || '#999'}
                  multiline
                  autoFocus
                  style={[
                    styles.noteInput,
                    {
                      backgroundColor: theme.custom?.inputBackground || theme.colors.surfaceVariant,
                      color: theme.colors.onSurface,
                      borderColor: theme.colors.outline,
                      textAlign,
                      writingDirection,
                    },
                  ]}
                />
                <NoteAttachmentRow
                  attachment={noteAttachment}
                  onAttach={setNoteAttachment}
                  onRemove={() => setNoteAttachment(null)}
                  primaryColor={theme.colors.primary}
                />
                <View style={[styles.noteActions, { flexDirection }]}>
                  <Button
                    mode="outlined"
                    onPress={() => { Keyboard.dismiss(); setNoteModalVisible(false); setNoteText(''); setNoteAttachment(null); }}
                    style={{ minWidth: 100, borderRadius: 10 }}
                    textColor={theme.colors.onSurface}
                  >
                    {t('common.cancel')}
                  </Button>
                  <Button
                    mode="contained"
                    onPress={() => { Keyboard.dismiss(); handleAddNote(); }}
                    loading={addingNote}
                    disabled={(!noteText.trim() && !noteAttachment) || addingNote}
                    style={{ minWidth: 100, borderRadius: 10, backgroundColor: theme.colors.primary }}
                    textColor="#FFFFFF"
                  >
                    {t('common.save')}
                  </Button>
                </View>
              </Pressable>
            </Pressable>
          </KeyboardAvoidingView>
        </Modal>
      </Portal>

      <Portal>
        <Modal
          visible={consentModalVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setConsentModalVisible(false)}
        >
          <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
            <Pressable
              style={styles.noteOverlay}
              onPress={() => { Keyboard.dismiss(); setConsentModalVisible(false); }}
            >
              <Pressable
                onPress={(e) => e.stopPropagation()}
                style={[styles.noteSheet, { backgroundColor: theme.colors.surface, paddingBottom: Math.max(insets.bottom, 12) + 8 }]}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <Text variant="titleMedium" style={{ color: theme.colors.onSurface, fontWeight: '700' }}>
                    {t('contacts.documentConsent', 'תעד הסכמה לדיוור')}
                  </Text>
                  <Pressable onPress={() => { Keyboard.dismiss(); setConsentModalVisible(false); }} hitSlop={8}>
                    <MaterialCommunityIcons name="close" size={22} color={theme.colors.onSurfaceVariant} />
                  </Pressable>
                </View>

                <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 420 }}>
                  <Text variant="labelLarge" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 8, textAlign }}>
                    {t('contacts.consentSource', 'מקור ההסכמה')}
                  </Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {([
                      ['manual', t('contacts.consentSourceManual', 'ידני')],
                      ['website_form', t('contacts.consentSourceWebsite', 'טופס באתר')],
                      ['phone_call', t('contacts.consentSourcePhone', 'שיחת טלפון')],
                      ['physical_form', t('contacts.consentSourcePhysical', 'טופס פיזי')],
                      ['event_registration', t('contacts.consentSourceEvent', 'הרשמה לאירוע')],
                      ['whatsapp_optin', t('contacts.consentSourceWhatsapp', 'אישור וואטסאפ')],
                      ['other', t('contacts.consentSourceOther', 'אחר')],
                    ] as [string, string][]).map(([val, label]) => {
                      const selected = consentSource === val;
                      return (
                        <Pressable
                          key={val}
                          onPress={() => setConsentSource(val)}
                          style={{
                            paddingVertical: 6,
                            paddingHorizontal: 12,
                            borderRadius: 16,
                            borderWidth: 1,
                            backgroundColor: selected ? theme.colors.primary : theme.colors.surfaceVariant,
                            borderColor: selected ? theme.colors.primary : theme.colors.outline,
                          }}
                        >
                          <Text style={{ fontSize: 12, fontWeight: selected ? '700' : '500', color: selected ? '#FFFFFF' : theme.colors.onSurface }}>
                            {label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  {consentSource === 'other' ? (
                    <TextInput
                      value={consentCustomSource}
                      onChangeText={setConsentCustomSource}
                      placeholder={t('contacts.consentSourceCustomHint', 'הקלד מקור הסכמה...')}
                      placeholderTextColor={theme.custom?.placeholder || '#999'}
                      style={[
                        styles.noteInput,
                        {
                          minHeight: 44,
                          marginTop: 10,
                          backgroundColor: theme.custom?.inputBackground || theme.colors.surfaceVariant,
                          color: theme.colors.onSurface,
                          borderColor: theme.colors.outline,
                          textAlign,
                          writingDirection,
                        },
                      ]}
                    />
                  ) : null}

                  <Text variant="labelLarge" style={{ color: theme.colors.onSurfaceVariant, marginTop: 18, marginBottom: 8, textAlign }}>
                    {t('contacts.consentType', 'סוג ההסכמה')}
                  </Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {([
                      ['Explicit', `🟢 ${t('contacts.consentTypeExplicit', 'הסכמה מפורשת')}`],
                      ['ExistingCustomer', `🟡 ${t('contacts.consentTypeExisting', 'לקוח קיים')}`],
                      ['CTWA', `🟡 ${t('contacts.consentTypeCtwa', 'פתח שיחה ממודעה')}`],
                      ['Unknown', `⚪ ${t('contacts.consentTypeUnknown', 'לא ידוע')}`],
                    ] as [string, string][]).map(([val, label]) => {
                      const selected = consentType === val;
                      return (
                        <Pressable
                          key={val}
                          onPress={() => setConsentType(val)}
                          style={{
                            paddingVertical: 6,
                            paddingHorizontal: 12,
                            borderRadius: 16,
                            borderWidth: 1,
                            backgroundColor: selected ? theme.colors.primary : theme.colors.surfaceVariant,
                            borderColor: selected ? theme.colors.primary : theme.colors.outline,
                          }}
                        >
                          <Text style={{ fontSize: 12, fontWeight: selected ? '700' : '500', color: selected ? '#FFFFFF' : theme.colors.onSurface }}>
                            {label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </ScrollView>

                <View style={[styles.noteActions, { flexDirection }]}>
                  <Button
                    mode="outlined"
                    onPress={() => { Keyboard.dismiss(); setConsentModalVisible(false); }}
                    style={{ minWidth: 100, borderRadius: 10 }}
                    textColor={theme.colors.onSurface}
                  >
                    {t('common.cancel')}
                  </Button>
                  <Button
                    mode="contained"
                    onPress={() => { Keyboard.dismiss(); handleSaveConsent(); }}
                    loading={flagSaving}
                    disabled={flagSaving || (consentSource === 'other' && !consentCustomSource.trim())}
                    style={{ minWidth: 100, borderRadius: 10, backgroundColor: theme.colors.primary }}
                    textColor="#FFFFFF"
                  >
                    {t('contacts.saveConsent', 'שמור הסכמה')}
                  </Button>
                </View>
              </Pressable>
            </Pressable>
          </KeyboardAvoidingView>
        </Modal>
      </Portal>

      <MediaPanel
        visible={mediaPanelVisible}
        onClose={() => setMediaPanelVisible(false)}
        contactPhone={contact?.phoneNumber || ''}
        organization={organization}
        wabaNumbers={user?.wabaNumbers && user.wabaNumbers.length > 1 ? user.wabaNumbers : undefined}
      />

      <AddTaskSheet
        visible={addTaskVisible}
        onDismiss={() => setAddTaskVisible(false)}
        onCreated={() => { if (activeTab === 'timeline') fetchTimeline().catch(() => {}); }}
        organization={organization}
        user={user}
        relatedPhone={contact?.phoneNumber || ''}
        relatedTo={{
          type: 'contact',
          entityId: contact?.phoneNumber || contact?.id || '',
          entityName: contactName,
        }}
        defaultTitle={contactName ? `${t('contacts.phoneCall')} - ${contactName}` : undefined}
      />
    </View>
  );
}

function ActionButton({
  icon,
  label,
  color,
  bg,
  onPress,
}: {
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  label: string;
  color: string;
  bg: string;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.actionBtn} onPress={onPress}>
      <View style={[styles.actionBtnCircle, { backgroundColor: bg }]}>
        <MaterialCommunityIcons name={icon} size={22} color={color} />
      </View>
      <Text variant="labelSmall" style={{ color, marginTop: 4, fontWeight: '500', textAlign: 'center' }} numberOfLines={2}>
        {label}
      </Text>
    </Pressable>
  );
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

function FormField({
  label,
  value,
  onChangeText,
  theme,
  textAlign,
  writingDirection,
  multiline,
  keyboardType,
  autoCapitalize,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  theme: any;
  textAlign: 'left' | 'right';
  writingDirection: 'ltr' | 'rtl';
  multiline?: boolean;
  keyboardType?: TextInput['props']['keyboardType'];
  autoCapitalize?: TextInput['props']['autoCapitalize'];
}) {
  return (
    <View style={styles.formField}>
      <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 6 }}>
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        style={[
          styles.formInput,
          {
            backgroundColor: theme.custom.inputBackground,
            color: theme.colors.onSurface,
            textAlign,
            writingDirection,
            borderColor: theme.colors.outline,
          },
          multiline && { height: 100, textAlignVertical: 'top' },
        ]}
        placeholderTextColor={theme.custom.placeholder}
        multiline={multiline}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
      />
    </View>
  );
}

const TIMELINE_TYPE_CONFIG: Record<string, { icon: string; color: string }> = {
  note: { icon: 'note-text', color: '#9C27B0' },
  internal_mention: { icon: 'at', color: '#FF9800' },
  assign: { icon: 'account-switch', color: '#2196F3' },
  'email sent': { icon: 'email-outline', color: '#4CAF50' },
  'event created': { icon: 'calendar', color: '#00BCD4' },
  task_created: { icon: 'clipboard-check-outline', color: '#FF9800' },
  task_completed: { icon: 'check-circle', color: '#4CAF50' },
  task_status_change: { icon: 'clipboard-text-clock', color: '#FF9800' },
  lead_created: { icon: 'account-plus', color: '#2e6155' },
  lead_updated: { icon: 'account-edit', color: '#2e6155' },
  stage_change: { icon: 'swap-horizontal', color: '#9C27B0' },
  lead_won: { icon: 'trophy', color: '#4CAF50' },
  lead_lost: { icon: 'close-circle', color: '#F44336' },
  'open conversation': { icon: 'chat-outline', color: '#2196F3' },
  status_change: { icon: 'swap-vertical', color: '#FF9800' },
  outbound_phone_call_initiated: { icon: 'phone-outgoing', color: '#4CAF50' },
};

type TimelineFilterKey = 'all' | 'notes' | 'email' | 'tasks' | 'calendar' | 'lead' | 'system';

const TIMELINE_FILTERS: { key: TimelineFilterKey; label: string; icon: string }[] = [
  { key: 'all', label: 'הכל', icon: 'format-list-bulleted' },
  { key: 'notes', label: 'הערות', icon: 'note-text' },
  { key: 'email', label: 'מייל', icon: 'email-outline' },
  { key: 'tasks', label: 'משימות', icon: 'clipboard-check-outline' },
  { key: 'calendar', label: 'יומן', icon: 'calendar' },
  { key: 'lead', label: 'ליד', icon: 'account-convert' },
  { key: 'system', label: 'מערכת', icon: 'cog-outline' },
];

function getTimelineFilterGroup(entry: any): TimelineFilterKey {
  const t = (entry?.TimelineType || entry?.timelineType || '').toLowerCase();
  if (t === 'note' || t === 'internal_mention') return 'notes';
  if (t === 'email sent' || t === 'email campaign sent') return 'email';
  if (t.startsWith('task_')) return 'tasks';
  if (t === 'event created') return 'calendar';
  if (t === 'stage_change' || t.startsWith('lead_')) return 'lead';
  return 'system';
}

const isEntryPinned = (e: any) => !!(e?.isPinned || e?.IsPinned);
const isNoteEntry = (e: any) => {
  const type = (e?.TimelineType || e?.timelineType || '').toLowerCase();
  return type === 'note' || type === 'internal_mention';
};

function TimelineSection({
  events,
  loading,
  theme,
  t,
  lang,
  isRTL,
  flexDirection,
  onTogglePin,
  onOpenTask,
  onCompleteTask,
}: {
  events: any[];
  loading: boolean;
  theme: any;
  t: any;
  lang: 'en' | 'he';
  isRTL: boolean;
  flexDirection: 'row' | 'row-reverse';
  onTogglePin: (entry: any) => void;
  onOpenTask?: (taskId: string) => void;
  onCompleteTask?: (taskId: string) => Promise<void> | void;
}) {
  const [activeFilter, setActiveFilter] = useState<TimelineFilterKey>('all');
  const [completingId, setCompletingId] = useState<string | null>(null);

  const handleComplete = async (taskId: string) => {
    if (!taskId || completingId) return;
    setCompletingId(taskId);
    try {
      await onCompleteTask?.(taskId);
    } finally {
      setCompletingId(null);
    }
  };

  if (loading) {
    return (
      <View style={styles.sectionEmpty}>
        <ActivityIndicator size="small" color={theme.colors.primary} />
      </View>
    );
  }

  if (events.length === 0) {
    return (
      <View style={styles.sectionEmpty}>
        <MaterialCommunityIcons
          name="timeline-clock-outline"
          size={48}
          color={theme.colors.onSurfaceVariant}
          style={{ opacity: 0.35 }}
        />
        <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant, marginTop: 8 }}>
          {t('timeline.noEvents')}
        </Text>
      </View>
    );
  }

  const counts: Record<TimelineFilterKey, number> = { all: events.length, notes: 0, email: 0, tasks: 0, calendar: 0, lead: 0, system: 0 };
  events.forEach((e) => { counts[getTimelineFilterGroup(e)]++; });

  const visibleFilters = TIMELINE_FILTERS.filter((f) => f.key === 'all' || counts[f.key] > 0);

  const filteredRaw = activeFilter === 'all' ? events : events.filter((e) => getTimelineFilterGroup(e) === activeFilter);
  // Pinned notes float to the top (most-recently-pinned first); everything else keeps order.
  const pinnedEntries = filteredRaw
    .filter(isEntryPinned)
    .sort(
      (a, b) =>
        new Date(b.pinnedOn || b.PinnedOn || b.createdOn || 0).getTime() -
        new Date(a.pinnedOn || a.PinnedOn || a.createdOn || 0).getTime(),
    );
  const normalEntries = filteredRaw.filter((e) => !isEntryPinned(e));
  const filtered = [...pinnedEntries, ...normalEntries];

  return (
    <View style={styles.sectionContent}>
      {visibleFilters.length > 2 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.timelineFilterBar} contentContainerStyle={{ gap: 6, paddingHorizontal: 4 }}>
          {visibleFilters.map((f) => {
            const isActive = activeFilter === f.key;
            return (
              <Pressable
                key={f.key}
                onPress={() => setActiveFilter(f.key)}
                style={[
                  styles.timelineFilterChip,
                  { backgroundColor: isActive ? theme.colors.primary : theme.colors.surfaceVariant },
                ]}
              >
                <MaterialCommunityIcons name={f.icon as any} size={14} color={isActive ? '#fff' : theme.colors.onSurfaceVariant} />
                <Text style={[styles.timelineFilterLabel, { color: isActive ? '#fff' : theme.colors.onSurfaceVariant }]}>
                  {f.label}
                </Text>
                {f.key !== 'all' && (
                  <Text style={[styles.timelineFilterCount, { color: isActive ? '#fff' : theme.colors.onSurfaceVariant }]}>
                    {counts[f.key]}
                  </Text>
                )}
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      {pinnedEntries.length > 0 && (
        <View style={[styles.pinnedHeader, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
          <MaterialCommunityIcons name="pin" size={14} color="#f59e0b" />
          <Text variant="labelSmall" style={{ color: '#b45309', fontWeight: '700' }}>
            {t('timeline.pinned', isRTL ? 'נעוץ' : 'Pinned')} {pinnedEntries.length}/{MAX_PINNED_NOTES}
          </Text>
        </View>
      )}

      {filtered.map((event, idx) => {
        const id = event.TimelineId || event.timelineId || event.id || String(idx);
        const type = (event.TimelineType || event.timelineType || 'note').toLowerCase();
        const config = TIMELINE_TYPE_CONFIG[type] || { icon: 'circle-small', color: theme.colors.primary };
        const note = event.note || event.Note || '';
        const createdBy = event.createdByName || event.CreatedByName || '';
        const createdOn = event.createdOn || event.CreatedOn || '';
        const crossLabel = event._crossEntitySource ? `[${event._crossEntityLabel || event._crossEntitySource}]` : '';
        const pinned = isEntryPinned(event);
        const canPin = isNoteEntry(event);
        const showPinnedDivider = pinnedEntries.length > 0 && idx === pinnedEntries.length;

        return (
          <React.Fragment key={id}>
          {showPinnedDivider && <View style={[styles.pinnedDivider, { backgroundColor: theme.colors.outline }]} />}
          <View style={[styles.timelineItem, { flexDirection }, pinned && { backgroundColor: 'rgba(245,158,11,0.06)', borderRadius: 10, padding: 6 }]}>
            <View style={[styles.timelineDot, { backgroundColor: config.color }]}>
              <MaterialCommunityIcons name={config.icon as any} size={12} color="#FFF" />
            </View>
            <View style={[styles.timelineBody, { alignItems: isRTL ? 'flex-end' : 'flex-start' }]}>
              <View style={{ flexDirection: isRTL ? 'row-reverse' : 'row', alignItems: 'center', gap: 6, width: '100%' }}>
                <Text variant="labelSmall" style={{ color: config.color, fontWeight: '600', textTransform: 'capitalize', textAlign: isRTL ? 'right' : 'left' }}>
                  {type.replace(/_/g, ' ')}
                </Text>
                {crossLabel ? (
                  <Text variant="labelSmall" style={{ color: '#9C27B0', fontWeight: '500', fontSize: 10 }}>
                    {crossLabel}
                  </Text>
                ) : null}
                <View style={{ flex: 1 }} />
                {canPin ? (
                  <Pressable
                    onPress={() => onTogglePin(event)}
                    hitSlop={8}
                    style={{ padding: 2 }}
                  >
                    <MaterialCommunityIcons
                      name={pinned ? 'pin' : 'pin-outline'}
                      size={16}
                      color={pinned ? '#f59e0b' : theme.colors.onSurfaceVariant}
                    />
                  </Pressable>
                ) : null}
              </View>
              {note ? (
                <Text variant="bodySmall" style={{ color: theme.colors.onSurface, marginTop: 2, textAlign: isRTL ? 'right' : 'left', writingDirection: isRTL ? 'rtl' : 'ltr', width: '100%' }}>
                  {note}
                </Text>
              ) : null}
              <View style={{ flexDirection, gap: 8, marginTop: 4 }}>
                {createdBy ? (
                  <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                    {createdBy}
                  </Text>
                ) : null}
                {createdOn ? (
                  <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                    {formatRelativeTime(createdOn, lang)}
                  </Text>
                ) : null}
              </View>
              {(() => {
                const taskId = event.taskId || event.TaskId || (type.startsWith('task') ? (event.entityId || event.relatedId) : '');
                const isTask = type.startsWith('task') && !!taskId;
                if (!isTask) return null;
                const taskDone = type === 'task_completed' || (event.taskStatus || event.TaskStatus || '').toLowerCase() === 'completed';
                return (
                  <View style={{ flexDirection: isRTL ? 'row-reverse' : 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
                    <Pressable
                      onPress={() => onOpenTask?.(String(taskId))}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: theme.colors.primary, paddingVertical: 5, paddingHorizontal: 12, borderRadius: 14 }}
                    >
                      <MaterialCommunityIcons name="pencil-outline" size={13} color="#fff" />
                      <Text style={{ color: '#fff', fontSize: 12, fontWeight: '600' }}>{lang === 'he' ? 'ערוך' : 'Edit'}</Text>
                    </Pressable>
                    {!taskDone ? (
                      <Pressable
                        onPress={() => handleComplete(String(taskId))}
                        disabled={completingId === taskId}
                        style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#10B98122', borderWidth: 1, borderColor: '#10B981', paddingVertical: 5, paddingHorizontal: 12, borderRadius: 14, opacity: completingId === taskId ? 0.6 : 1 }}
                      >
                        <MaterialCommunityIcons name="check" size={13} color="#059669" />
                        <Text style={{ color: '#059669', fontSize: 12, fontWeight: '700' }}>{completingId === taskId ? '…' : (lang === 'he' ? 'הושלם' : 'Complete')}</Text>
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
          </View>
          </React.Fragment>
        );
      })}
    </View>
  );
}

const RELATED_TYPE_ICONS: Record<string, { icon: string; color: string }> = {
  leads: { icon: 'account-convert', color: '#2e6155' },
  quotes: { icon: 'file-document-outline', color: '#8b5cf6' },
  tasks: { icon: 'clipboard-check-outline', color: '#FF9800' },
  cases: { icon: 'briefcase-outline', color: '#FF6B35' },
};

function RelatedRecordsSection({
  data,
  loading,
  theme,
  t,
  isRTL,
  flexDirection,
  router,
}: {
  data: { tables: any[]; leads: any[]; quotes?: any[] };
  loading: boolean;
  theme: any;
  t: any;
  isRTL: boolean;
  flexDirection: 'row' | 'row-reverse';
  router: any;
}) {
  if (loading) {
    return (
      <View style={styles.sectionEmpty}>
        <ActivityIndicator size="small" color={theme.colors.primary} />
      </View>
    );
  }

  const hasLeads = (data.leads?.length ?? 0) > 0;
  const hasQuotes = (data.quotes?.length ?? 0) > 0;
  const hasTables = (data.tables?.length ?? 0) > 0;
  const hasAny = hasLeads || hasQuotes || hasTables;

  if (!hasAny) {
    return (
      <View style={styles.sectionEmpty}>
        <MaterialCommunityIcons
          name="link-variant"
          size={48}
          color={theme.colors.onSurfaceVariant}
          style={{ opacity: 0.35 }}
        />
        <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant, marginTop: 8 }}>
          {t('common.noResults')}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.sectionContent}>
      {hasQuotes ? (
        <View style={{ marginBottom: 16 }}>
          <View style={[styles.relatedHeader, { flexDirection }]}>
            <MaterialCommunityIcons name="file-document-outline" size={18} color="#8b5cf6" />
            <Text variant="titleSmall" style={{ color: theme.colors.onSurface, fontWeight: '700' }}>
              {t('tabs.quotes')} ({data.quotes?.length ?? 0})
            </Text>
          </View>
          {(data.quotes ?? []).map((quote: any) => (
            <Pressable
              key={quote.id}
              onPress={() => router.push({ pathname: '/(tabs)/more/quotes/[id]', params: { id: quote.id } })}
              style={[styles.relatedCard, { backgroundColor: theme.colors.surfaceVariant, flexDirection }]}
            >
              <View style={{ flex: 1 }}>
                <Text variant="bodyMedium" style={{ color: theme.colors.onSurface, fontWeight: '600', textAlign: isRTL ? 'right' : 'left' }}>
                  {quote.title || quote.quoteNumber || quote.id}
                </Text>
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 3, flexWrap: 'wrap' }}>
                  {quote.status ? (
                    <View style={{ backgroundColor: '#8b5cf620', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 }}>
                      <Text variant="labelSmall" style={{ color: '#8b5cf6', fontWeight: '600' }}>
                        {quote.status}
                      </Text>
                    </View>
                  ) : null}
                  {quote.total != null ? (
                    <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                      {quote.total} {quote.currency || '₪'}
                    </Text>
                  ) : null}
                  {quote.createdOn ? (
                    <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                      {formatDate(quote.createdOn)}
                    </Text>
                  ) : null}
                </View>
              </View>
              <MaterialCommunityIcons
                name={isRTL ? 'chevron-left' : 'chevron-right'}
                size={18}
                color={theme.colors.onSurfaceVariant}
              />
            </Pressable>
          ))}
        </View>
      ) : null}

      {hasLeads ? (
        <View style={{ marginBottom: 16 }}>
          <View style={[styles.relatedHeader, { flexDirection }]}>
            <MaterialCommunityIcons name="account-convert" size={18} color="#2e6155" />
            <Text variant="titleSmall" style={{ color: theme.colors.onSurface, fontWeight: '700' }}>
              {t('tabs.leads')} ({data.leads.length})
            </Text>
          </View>
          {data.leads.map((lead: any) => (
            <Pressable
              key={lead.id}
              onPress={() => {
                useLeadStore.getState().setSelectedLead(lead);
                router.push({ pathname: '/(tabs)/leads/[id]', params: { id: lead.id } });
              }}
              style={[styles.relatedCard, { backgroundColor: theme.colors.surfaceVariant, flexDirection }]}
            >
              <View style={{ flex: 1 }}>
                <Text variant="bodyMedium" style={{ color: theme.colors.onSurface, fontWeight: '600', textAlign: isRTL ? 'right' : 'left' }}>
                  {lead.title || lead.leadTitle || t('leads.lead')}
                </Text>
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 3, flexWrap: 'wrap' }}>
                  {(lead.stageName || lead.stage) ? (
                    <View style={{ backgroundColor: '#2e615520', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 }}>
                      <Text variant="labelSmall" style={{ color: '#2e6155', fontWeight: '600' }}>
                        {lead.stageName || lead.stage}
                      </Text>
                    </View>
                  ) : null}
                  {lead.value ? (
                    <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                      {lead.currency || '₪'}{lead.value}
                    </Text>
                  ) : null}
                  {lead.status ? (
                    <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                      {lead.status}
                    </Text>
                  ) : null}
                </View>
              </View>
              <MaterialCommunityIcons
                name={isRTL ? 'chevron-left' : 'chevron-right'}
                size={18}
                color={theme.colors.onSurfaceVariant}
              />
            </Pressable>
          ))}
        </View>
      ) : null}

      {data.tables.map((table: any) => {
        const records: any[] = table.records || [];
        // Collect all column keys across records to display as fields
        const columnKeys = table.columns
          ? (table.columns as any[]).map((c: any) => c.key || c.name || c.fieldName).filter(Boolean)
          : [];
        return (
          <View key={table.tableId || table.tableName} style={{ marginBottom: 16 }}>
            <View style={[styles.relatedHeader, { flexDirection }]}>
              <MaterialCommunityIcons name="table-large" size={18} color="#6366f1" />
              <Text variant="titleSmall" style={{ color: theme.colors.onSurface, fontWeight: '700' }}>
                {table.tableName} ({table.recordCount ?? records.length})
              </Text>
            </View>
            {records.length === 0 ? (
              <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant, paddingHorizontal: 4, paddingVertical: 6 }}>
                {t('common.noResults')}
              </Text>
            ) : records.map((record: any, rIdx: number) => {
              // Try to find all meaningful field values in the record
              const rawFields: Record<string, any> =
                record.fields || record.Fields || record.data || record.Data || {};
              // Also include top-level string/number props (excluding meta fields)
              const META_KEYS = new Set(['id', 'Id', 'createdOn', 'createdAt', 'updatedAt', 'updatedOn', 'organization', 'contactId', 'tableId']);
              const topLevelFields: Record<string, any> = {};
              Object.entries(record).forEach(([k, v]) => {
                if (!META_KEYS.has(k) && (typeof v === 'string' || typeof v === 'number') && v !== '') {
                  topLevelFields[k] = v;
                }
              });
              const allFields = { ...topLevelFields, ...rawFields };
              const fieldEntries = Object.entries(allFields)
                .filter(([, v]) => v != null && v !== '' && typeof v !== 'object')
                .slice(0, 6);
              const displayKeys = columnKeys.length > 0 ? columnKeys : fieldEntries.map(([k]) => k);
              const createdOn = record.createdOn || record.createdAt;
              return (
                <View
                  key={record.id || rIdx}
                  style={[
                    styles.relatedCard,
                    { backgroundColor: theme.colors.surfaceVariant, flexDirection: 'column', alignItems: 'stretch' },
                  ]}
                >
                  {fieldEntries.length > 0 ? (
                    fieldEntries.map(([key, val]) => (
                      <View key={key} style={{ flexDirection: 'row', gap: 6, marginBottom: 2 }}>
                        <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant, minWidth: 60 }}>
                          {String(key)}:
                        </Text>
                        <Text variant="labelSmall" style={{ color: theme.colors.onSurface, fontWeight: '600', flex: 1, textAlign: isRTL ? 'right' : 'left' }} numberOfLines={1}>
                          {String(val)}
                        </Text>
                      </View>
                    ))
                  ) : (
                    <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                      {record.id || t('common.noData', 'אין מידע')}
                    </Text>
                  )}
                  {createdOn ? (
                    <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: 4, textAlign: isRTL ? 'right' : 'left' }}>
                      {formatDate(createdOn)}
                    </Text>
                  ) : null}
                </View>
              );
            })}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 4,
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    color: '#FFF',
    textAlign: 'center',
  },
  scrollContent: { paddingBottom: 20 },
  avatarSection: { alignItems: 'center', paddingVertical: 24 },
  actionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 20,
    paddingHorizontal: 16,
    paddingBottom: 20,
  },
  actionBtn: { alignItems: 'center', width: 64 },
  actionBtnCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 16,
    borderRadius: 12,
  },
  cardDivider: { marginVertical: 12 },
  infoRow: { alignItems: 'center' },
  infoRowText: { flex: 1 },
  tagsWrap: { flexWrap: 'wrap', gap: 8 },
  tabBar: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    position: 'relative',
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
  },
  pinnedHeader: {
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
    paddingBottom: 6,
  },
  pinnedDivider: {
    height: StyleSheet.hairlineWidth,
    marginBottom: 12,
    opacity: 0.6,
  },
  sectionContent: { paddingHorizontal: 16, paddingTop: 16 },
  sectionEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
  },
  timelineItem: { alignItems: 'flex-start', marginBottom: 16, gap: 12 },
  timelineDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    marginTop: 2,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  timelineBody: { flex: 1 },
  timelineFilterBar: { marginBottom: 12, maxHeight: 36 },
  timelineFilterChip: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
  },
  timelineFilterLabel: { fontSize: 12, fontWeight: '600' as const },
  timelineFilterCount: { fontSize: 10, fontWeight: '500' as const, marginStart: 2 },
  noteOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end' as const,
  },
  noteSheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
  },
  noteInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    height: 120,
    textAlignVertical: 'top' as const,
    marginBottom: 12,
  },
  noteActions: {
    gap: 12,
    justifyContent: 'flex-end' as const,
  },
  relatedHeader: {
    alignItems: 'center' as const,
    gap: 8,
    marginBottom: 8,
  },
  relatedCard: {
    padding: 12,
    borderRadius: 10,
    marginBottom: 6,
    alignItems: 'center' as const,
    gap: 8,
  },
  modalContainer: { flex: 1 },
  modalHeader: {
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  formContent: { padding: 16, gap: 16 },
  formField: {},
  formInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
});
