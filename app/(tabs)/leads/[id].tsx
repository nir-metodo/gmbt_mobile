import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  Linking,
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
  Surface,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useLeadStore } from '../../../stores/leadStore';
import { useAuthStore } from '../../../stores/authStore';
import { makeAppCall } from '../../../utils/phoneCall';
import { tasksApi } from '../../../services/api/tasks';
import { contactsApi } from '../../../services/api/contacts';
import axiosInstance from '../../../services/api/axiosInstance';
import { ENDPOINTS } from '../../../constants/api';
import { usersApi } from '../../../services/api/users';
import { leadsApi } from '../../../services/api/leads';
import { paymentsApi } from '../../../services/api/payments';
import { useAppTheme } from '../../../hooks/useAppTheme';
import { useRTL } from '../../../hooks/useRTL';
import {
  formatCurrency,
  formatDate,
  formatRelativeTime,
  getInitials,
  withAlpha,
} from '../../../utils/formatters';
import { spacing, borderRadius } from '../../../constants/theme';
import ContactLookup from '../../../components/ContactLookup';
import {
  DynamicFieldsSectionView,
  DynamicFieldsSectionForm,
  type DynamicSection,
} from '../../../components/DynamicFieldsSection';
import { NoteAttachmentRow, type NoteAttachment } from '../../../components/NoteAttachmentRow';
import type { Lead, LeadStage, TimelineEvent, OrgUser } from '../../../types';

const DEFAULT_STAGE_COLORS: Record<string, string> = {
  New: '#2e6155',
  Contacted: '#00BCD4',
  Qualified: '#9C27B0',
  Proposal: '#FF9800',
  Negotiation: '#FFC107',
  'Closed Won': '#4CAF50',
  'Closed Lost': '#F44336',
};

const DEFAULT_STAGE_KEYS = [
  'New',
  'Contacted',
  'Qualified',
  'Proposal',
  'Negotiation',
  'Closed Won',
  'Closed Lost',
];

const STAGE_I18N: Record<string, string> = {
  New: 'leads.newLead',
  Contacted: 'leads.contacted',
  Qualified: 'leads.qualified',
  Proposal: 'leads.proposal',
  Negotiation: 'leads.negotiation',
  'Closed Won': 'leads.closed_won',
  'Closed Lost': 'leads.closed_lost',
};

const CURRENCY_OPTIONS = ['ILS', 'USD', 'EUR', 'GBP'];

const LEAD_SOURCES = [
  'Google Ads', 'Facebook Ads', 'Instagram Ads', 'LinkedIn', 'TikTok',
  'Organic Search', 'Direct', 'Referral', 'Email Marketing',
  'SMS Campaign', 'Gambot Campaign', 'Social Media', 'Other',
];

const LEAD_CHANNELS = [
  'WhatsApp Message', 'Landing Page / Form', 'Phone Call', 'Website Chat',
  'Email', 'Walk-in', 'Event / Conference', 'Social Media DM', 'Botomation', 'Other',
];

const LEAD_STATUSES = ['Active', 'Interested', 'Not Interested', 'On Hold', 'Archived'];

const LOST_REASONS = ['price', 'competitor', 'timing', 'no_budget', 'no_response', 'not_qualified', 'other'];

const EMPTY_LEAD: Partial<Lead> = {
  title: '',
  stage: 'New',
  value: 0,
  currency: 'ILS',
  source: '',
  medium: '',
  status: 'Active',
  description: '',
  notes: '',
  expectedCloseDate: '',
  contactName: '',
  contactPhone: '',
  companyName: '',
  jobTitle: '',
  nextFollowUp: '',
  priority: 'medium',
  ownerId: '',
  tags: [],
  score: 0,
  lostReason: '',
};

export default function LeadDetailScreen() {
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
  const organization = user?.organization ?? '';

  const leadFromStore = useLeadStore((s) => s.leads.find((l) => l.id === id) ?? null);
  const selectedLead = useLeadStore((s) => s.selectedLead);
  const updateLead = useLeadStore((s) => s.updateLead);
  const createLead = useLeadStore((s) => s.createLead);
  const deleteLead = useLeadStore((s) => s.deleteLead);

  const isNew = id === 'new';
  const lead = useMemo(
    () => {
      if (isNew) return null;
      return leadFromStore ?? (selectedLead?.id === id ? selectedLead : null);
    },
    [leadFromStore, selectedLead, id, isNew],
  );

  const [menuVisible, setMenuVisible] = useState(false);
  const [stagePickerVisible, setStagePickerVisible] = useState(false);
  const [editVisible, setEditVisible] = useState(isNew);
  const [saving, setSaving] = useState(false);
  const [addTaskVisible, setAddTaskVisible] = useState(false);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDueDate, setTaskDueDate] = useState('');
  const [creatingTask, setCreatingTask] = useState(false);
  const [contactLookupVisible, setContactLookupVisible] = useState(false);
  const [orgUsers, setOrgUsers] = useState<OrgUser[]>([]);
  const [orgUsersLoading, setOrgUsersLoading] = useState(false);
  const [ownerPickerExpanded, setOwnerPickerExpanded] = useState(false);
  const [noteModalVisible, setNoteModalVisible] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [noteAttachment, setNoteAttachment] = useState<NoteAttachment | null>(null);
  const [addingNote, setAddingNote] = useState(false);
  const [pipelineStages, setPipelineStages] = useState<LeadStage[]>([]);
  const [leadFormSections, setLeadFormSections] = useState<DynamicSection[]>([]);
  const [leadFormLayout, setLeadFormLayout] = useState<string[]>([]);

  // Product catalog state
  const [catalogEnabled, setCatalogEnabled] = useState(false);
  const [syncCatalogToValue, setSyncCatalogToValue] = useState(false);
  const [catalogItems, setCatalogItems] = useState<any[]>([]);
  const [catalogSearch, setCatalogSearch] = useState('');

  // Payment / clearing state
  const [clearingEnabled, setClearingEnabled] = useState(false);
  const [paymentModalVisible, setPaymentModalVisible] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentDescription, setPaymentDescription] = useState('');
  const [paymentInstallments, setPaymentInstallments] = useState(1);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [paymentResult, setPaymentResult] = useState<{ success: boolean; url?: string; error?: string } | null>(null);
  const [form, setForm] = useState<Partial<Lead>>(
    lead
      ? { ...lead }
      : {
          ...EMPTY_LEAD,
          contactPhone: prefillPhone || '',
          contactName: prefillContactName || '',
        },
  );

  useEffect(() => {
    if (lead) setForm({ ...lead });
  }, [lead]);

  useEffect(() => {
    if (!syncCatalogToValue || !catalogEnabled) return;
    const products = form.interestedProducts || [];
    if (products.length === 0) return;
    const total = products.reduce((s: number, p: any) => s + (parseFloat(p.unitPrice) || 0) * (parseInt(p.quantity) || 1), 0);
    if (total > 0 && Number(form.value) !== total) {
      setForm((prev) => ({ ...prev, value: total }));
    }
  }, [form.interestedProducts, syncCatalogToValue, catalogEnabled]);

  useEffect(() => {
    if (!organization) return;
    leadsApi.getPipelineSettings(organization)
      .then((res) => {
        if (res.stages.length > 0) setPipelineStages(res.stages);
        if (res.enableProductCatalog) {
          setCatalogEnabled(true);
          setSyncCatalogToValue(!!res.syncCatalogToValue);
          leadsApi.getCatalogItems(organization).then(setCatalogItems).catch(() => {});
        }
      })
      .catch(() => {});
  }, [organization]);

  useEffect(() => {
    if (!organization) return;
    leadsApi.getLeadFormSettings(organization)
      .then((res) => {
        setLeadFormSections(res.sections || []);
        setLeadFormLayout(res.formLayout || []);
      })
      .catch(() => {});
  }, [organization]);

  useEffect(() => {
    if (!organization) return;
    paymentsApi.getClearingSettings(organization)
      .then((settings) => {
        if (settings?.enabledEntities?.leads) setClearingEnabled(true);
      })
      .catch(() => {});
  }, [organization]);

  const stageKeys = useMemo(() => {
    if (pipelineStages.length > 0) return pipelineStages.map((s) => s.name);
    return DEFAULT_STAGE_KEYS;
  }, [pipelineStages]);

  const stageColorMap = useMemo(() => {
    if (pipelineStages.length > 0) {
      const map: Record<string, string> = {};
      pipelineStages.forEach((s) => { map[s.name] = s.color; });
      return map;
    }
    return DEFAULT_STAGE_COLORS;
  }, [pipelineStages]);

  const stageColor = useMemo(
    () => stageColorMap[lead?.stageName || lead?.stage || 'New'] ?? theme.colors.primary,
    [lead, stageColorMap, theme],
  );

  const isLostStage = useMemo(() => {
    const currentStage = form.stageName || form.stage || '';
    if (pipelineStages.length > 0) {
      return pipelineStages.some((s) => s.name === currentStage && s.isLost);
    }
    return currentStage === 'Closed Lost' || currentStage.toLowerCase().includes('lost');
  }, [form.stageName, form.stage, pipelineStages]);

  const handleCall = useCallback(() => {
    const phone = lead?.contactPhone || (lead as any)?.phoneNumber;
    if (phone) {
      makeAppCall({
        phoneNumber: phone,
        organization,
        callerUserId: user?.uID || user?.userId,
        callerUserName: user?.fullname,
        relatedTo: { type: 'lead', entityId: lead?.id || '', entityName: lead?.title },
        contactName: lead?.contactName,
      });
    }
  }, [lead, organization, user]);

  const handleMessage = useCallback(() => {
    if (lead?.contactPhone || lead?.phoneNumber) {
      router.push({
        pathname: '/(tabs)/chats/[phoneNumber]',
        params: { phoneNumber: lead.contactPhone || lead.phoneNumber || '' },
      });
    }
  }, [lead, router]);

  const handleViewContact = useCallback(() => {
    const navId = lead?.contactId || lead?.contactPhone || lead?.phoneNumber;
    if (navId) {
      router.push({
        pathname: '/(tabs)/contacts/[id]',
        params: { id: navId },
      });
    }
  }, [lead, router]);

  const handleStageChange = useCallback(
    async (newStage: string) => {
      setStagePickerVisible(false);
      if (!organization || !lead) return;
      const stageObj = pipelineStages.find((s) => s.name === newStage);
      const newStageId = stageObj?.id || '';

      // Optimistic update in store (updates list + detail via leadFromStore)
      useLeadStore.setState((state) => ({
        leads: state.leads.map((l) =>
          l.id === lead.id ? { ...l, stageName: newStage, stage: newStage, stageId: newStageId } : l
        ),
      }));
      // Also update local form
      setForm((prev) => ({ ...prev, stageName: newStage, stage: newStage, stageId: newStageId }));

      try {
        await leadsApi.moveStage(organization, lead.id, newStageId, newStage, user?.fullname || '');
      } catch {
        // Revert on error
        useLeadStore.setState((state) => ({
          leads: state.leads.map((l) =>
            l.id === lead.id ? { ...l, stageName: lead.stageName, stage: lead.stage, stageId: lead.stageId } : l
          ),
        }));
        setForm((prev) => ({ ...prev, stageName: lead.stageName, stage: lead.stage, stageId: lead.stageId }));
        Alert.alert(t('common.error'));
      }
    },
    [organization, lead, pipelineStages, user, t],
  );

  const handleDelete = useCallback(() => {
    setMenuVisible(false);
    Alert.alert(lead?.title ?? '', t('leads.deleteConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          if (organization && lead) {
            await deleteLead(organization, lead.id);
            router.back();
          }
        },
      },
    ]);
  }, [organization, lead, deleteLead, t, router]);

  const handleAddTask = useCallback(async () => {
    if (!organization || !lead) return;
    const defaultTitle = lead.contactName
      ? `${t('contacts.phoneCall')} - ${lead.contactName}`
      : t('contacts.phoneCall');
    const title = taskTitle.trim() || defaultTitle;
    setCreatingTask(true);
    try {
      await tasksApi.create(organization, {
        title,
        taskType: 'phone_call',
        status: 'open',
        priority: 'medium',
        dueDate: taskDueDate.trim() || undefined,
        relatedTo: {
          type: 'lead',
          entityId: lead.id,
          entityName: lead.title ?? '',
        },
      } as any);
      setAddTaskVisible(false);
      setTaskTitle('');
      setTaskDueDate('');
    } catch {
      Alert.alert(t('common.error'));
    } finally {
      setCreatingTask(false);
    }
  }, [organization, lead, taskTitle, taskDueDate, t]);

  const [timelineEvents, setTimelineEvents] = useState<any[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);

  const fetchLeadTimeline = useCallback(async () => {
    if (!organization || !lead?.id) return;
    setTimelineLoading(true);
    try {
      const timeline = await contactsApi.getTimeline(organization, `lead_${lead.id}`).catch(() => []);
      let arr = Array.isArray(timeline) ? timeline : [];

      // Cross-entity: fetch contact notes if enabled
      const contactPhone = lead.contactPhone || lead.phoneNumber || '';
      if (contactPhone) {
        try {
          const settingRes = await axiosInstance.post(ENDPOINTS.GET_CROSS_ENTITY_NOTES_SETTING, { organization });
          const crossEnabled = settingRes.data?.Data?.crossEntityNotesEnabled || settingRes.data?.crossEntityNotesEnabled;
          const crossMode = settingRes.data?.Data?.crossEntityNotesMode || settingRes.data?.crossEntityNotesMode || 'notes_only';
          if (crossEnabled) {
            let contactEntries = await contactsApi.getTimeline(organization, contactPhone).catch(() => []);
            contactEntries = Array.isArray(contactEntries) ? contactEntries : [];
            if (crossMode === 'notes_only') {
              contactEntries = contactEntries.filter((e: any) => (e.TimelineType || e.timelineType) === 'note');
            }
            contactEntries = contactEntries.map((e: any) => ({ ...e, _crossEntitySource: 'contact', _crossEntityLabel: contactPhone }));
            arr = [...arr, ...contactEntries];
          }
        } catch {}
      }

      // Deduplicate
      const unique = arr.reduce((acc: any[], ev: any) => {
        const id = ev.TimelineId || ev.timelineId || ev.id;
        if (id && !acc.find((e: any) => (e.TimelineId || e.timelineId || e.id) === id)) acc.push(ev);
        else if (!id) acc.push(ev);
        return acc;
      }, []);

      unique.sort((a: any, b: any) => {
        const dateA = new Date(a.CreateDateTimeUTC || a.createdOn || a.CreatedOn || a.timestamp || 0).getTime();
        const dateB = new Date(b.CreateDateTimeUTC || b.createdOn || b.CreatedOn || b.timestamp || 0).getTime();
        return dateB - dateA;
      });
      setTimelineEvents(unique);
    } catch {
      setTimelineEvents([]);
    } finally {
      setTimelineLoading(false);
    }
  }, [organization, lead?.id, lead?.contactPhone, lead?.phoneNumber]);

  useEffect(() => {
    if (lead && !isNew) {
      fetchLeadTimeline();
    }
  }, [lead, isNew, fetchLeadTimeline]);

  const handleAddNote = useCallback(async () => {
    if (!organization || !lead || (!noteText.trim() && !noteAttachment)) return;
    setAddingNote(true);
    try {
      await contactsApi.addTimelineEntry(
        organization,
        `lead_${lead.id}`,
        noteText.trim(),
        user?.uID || user?.userId || '',
        user?.fullname || '',
        noteAttachment || undefined,
      );
      setNoteText('');
      setNoteAttachment(null);
      setNoteModalVisible(false);
      fetchLeadTimeline();
    } catch {
      Alert.alert(t('common.error'));
    } finally {
      setAddingNote(false);
    }
  }, [organization, lead, noteText, noteAttachment, user, t, fetchLeadTimeline]);

  const handleOpenPayment = useCallback(() => {
    setPaymentAmount(lead?.value?.toString() || '');
    setPaymentDescription(lead?.title || '');
    setPaymentInstallments(1);
    setPaymentResult(null);
    setPaymentModalVisible(true);
  }, [lead]);

  const handleCreatePaymentLink = useCallback(async () => {
    if (!organization || !lead) return;
    const amt = parseFloat(paymentAmount);
    if (!amt || amt <= 0) {
      Alert.alert(t('common.error'), t('payments.enterAmount', 'Please enter an amount'));
      return;
    }
    setPaymentLoading(true);
    try {
      const res = await paymentsApi.createPaymentLink(organization, {
        amount: amt,
        description: paymentDescription,
        customerName: lead.contactName || '',
        customerPhone: lead.contactPhone || lead.phoneNumber || '',
        entityType: 'lead',
        entityId: lead.id,
        payments: paymentInstallments,
      });
      if (res.success) {
        setPaymentResult({
          success: true,
          url: res.gambotPaymentUrl || res.paymentUrl,
        });
      } else {
        setPaymentResult({ success: false, error: res.error || t('common.error') });
      }
    } catch (err: any) {
      setPaymentResult({ success: false, error: err?.message || t('common.error') });
    } finally {
      setPaymentLoading(false);
    }
  }, [organization, lead, paymentAmount, paymentDescription, paymentInstallments, t]);

  const handleSave = useCallback(async () => {
    if (!organization) return;
    setSaving(true);
    try {
      if (isNew) {
        await createLead(organization, form);
        router.back();
      } else {
        await updateLead(organization, { ...form, id: lead?.id ?? '' });
        setEditVisible(false);
      }
    } catch {
      Alert.alert(t('common.error'));
    } finally {
      setSaving(false);
    }
  }, [organization, form, isNew, lead, createLead, updateLead, t, router]);

  const updateField = useCallback(
    (field: keyof Lead | string, value: string | number | boolean | string[]) => {
      setForm((prev) => ({ ...prev, [field]: value }));
    },
    [],
  );

  if (!lead && !isNew) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.colors.background }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
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
          {isNew ? t('leads.addLead') : lead?.title ?? ''}
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
                setOwnerPickerExpanded(false);
                setEditVisible(true);
                if (orgUsers.length === 0) {
                  setOrgUsersLoading(true);
                  usersApi.getAll(organization).then((u) => setOrgUsers(u)).catch(() => {}).finally(() => setOrgUsersLoading(false));
                }
              }}
              title={t('common.edit')}
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
        {/* Stage indicator */}
        {!isNew && lead ? (
          <Pressable
            onPress={() => setStagePickerVisible(true)}
            style={[styles.stageBanner, { backgroundColor: withAlpha(stageColor, 0.082) }]}
          >
            <View style={[styles.stageIndicator, { flexDirection }]}>
              <View style={[styles.stageDot, { backgroundColor: stageColor }]} />
              <Text variant="titleMedium" style={{ color: stageColor, fontWeight: '700', flex: 1 }}>
                {t(STAGE_I18N[lead.stageName || lead.stage || 'New'] ?? lead.stageName ?? lead.stage ?? 'New')}
              </Text>
              <MaterialCommunityIcons
                name="chevron-down"
                size={20}
                color={stageColor}
              />
            </View>
            {/* Stage progress */}
            <View style={styles.stageProgress}>
              {stageKeys.map((stage, idx) => {
                const currentIdx = Math.max(0, stageKeys.indexOf(lead.stageName || lead.stage || 'New'));
                const isActive = idx <= currentIdx;
                return (
                  <View
                    key={stage}
                    style={[
                      styles.stageProgressDot,
                      {
                        backgroundColor: isActive
                          ? stageColor
                          : theme.colors.outlineVariant,
                        flex: 1,
                      },
                    ]}
                  />
                );
              })}
            </View>
          </Pressable>
        ) : null}

        {/* Lead info card */}
        <Surface style={[styles.card, { backgroundColor: theme.colors.surface }]} elevation={1}>
          {lead?.value != null && lead.value > 0 ? (
            <InfoRow
              icon="currency-usd"
              label={t('leads.value')}
              value={formatCurrency(lead.value, lead.currency ?? '₪')}
              theme={theme}
              flexDirection={flexDirection}
              textAlign={textAlign}
              valueStyle={{ color: theme.colors.primary, fontWeight: '700' }}
            />
          ) : null}
          {lead?.source ? (
            <>
              {lead.value != null && lead.value > 0 ? <Divider style={styles.cardDivider} /> : null}
              <InfoRow
                icon="source-branch"
                label={t('leads.source')}
                value={lead.source}
                theme={theme}
                flexDirection={flexDirection}
                textAlign={textAlign}
              />
            </>
          ) : null}
          {lead?.medium ? (
            <>
              <Divider style={styles.cardDivider} />
              <InfoRow
                icon="transit-connection-variant"
                label={t('leads.channel')}
                value={lead.medium}
                theme={theme}
                flexDirection={flexDirection}
                textAlign={textAlign}
              />
            </>
          ) : null}
          {lead?.status ? (
            <>
              <Divider style={styles.cardDivider} />
              <InfoRow
                icon="flag-outline"
                label={t('leads.status')}
                value={lead.status}
                theme={theme}
                flexDirection={flexDirection}
                textAlign={textAlign}
              />
            </>
          ) : null}
          {lead?.expectedCloseDate ? (
            <>
              <Divider style={styles.cardDivider} />
              <InfoRow
                icon="calendar-clock"
                label={t('leads.expectedClose')}
                value={formatDate(lead.expectedCloseDate)}
                theme={theme}
                flexDirection={flexDirection}
                textAlign={textAlign}
              />
            </>
          ) : null}
          {lead?.nextFollowUp ? (
            <>
              <Divider style={styles.cardDivider} />
              <InfoRow
                icon="calendar-arrow-right"
                label={t('leads.nextFollowUp', 'Next Follow-Up')}
                value={formatDate(lead.nextFollowUp)}
                theme={theme}
                flexDirection={flexDirection}
                textAlign={textAlign}
              />
            </>
          ) : null}
          {lead?.owner || lead?.ownerName ? (
            <>
              <Divider style={styles.cardDivider} />
              <InfoRow
                icon="account-outline"
                label={t('leads.owner')}
                value={lead.ownerName ?? lead.owner ?? ''}
                theme={theme}
                flexDirection={flexDirection}
                textAlign={textAlign}
              />
            </>
          ) : null}
          {lead?.jobTitle ? (
            <>
              <Divider style={styles.cardDivider} />
              <InfoRow
                icon="briefcase-outline"
                label={t('leads.jobTitle', 'Job Title')}
                value={lead.jobTitle}
                theme={theme}
                flexDirection={flexDirection}
                textAlign={textAlign}
              />
            </>
          ) : null}
          {lead?.currency ? (
            <>
              <Divider style={styles.cardDivider} />
              <InfoRow
                icon="cash"
                label={t('leads.currency', 'Currency')}
                value={lead.currency}
                theme={theme}
                flexDirection={flexDirection}
                textAlign={textAlign}
              />
            </>
          ) : null}
          {lead?.tags && lead.tags.length > 0 ? (
            <>
              <Divider style={styles.cardDivider} />
              <InfoRow
                icon="tag-multiple-outline"
                label={t('leads.tags', 'Tags')}
                value={lead.tags.join(', ')}
                theme={theme}
                flexDirection={flexDirection}
                textAlign={textAlign}
              />
            </>
          ) : null}
          {lead?.score != null && lead.score > 0 ? (
            <>
              <Divider style={styles.cardDivider} />
              <InfoRow
                icon="star-outline"
                label={t('leads.score', 'Score')}
                value={'★'.repeat(lead.score) + '☆'.repeat(Math.max(0, 5 - lead.score))}
                theme={theme}
                flexDirection={flexDirection}
                textAlign={textAlign}
                valueStyle={{ color: '#FFC107', fontSize: 18 }}
              />
            </>
          ) : null}
          {lead?.lostReason ? (
            <>
              <Divider style={styles.cardDivider} />
              <InfoRow
                icon="close-circle-outline"
                label={t('leads.lostReason', 'Lost Reason')}
                value={lead.lostReason}
                theme={theme}
                flexDirection={flexDirection}
                textAlign={textAlign}
                valueStyle={{ color: theme.colors.error }}
              />
            </>
          ) : null}
        </Surface>

        {lead ? (
          <DynamicFieldsSectionView
            sections={leadFormSections}
            data={lead as Record<string, any>}
            lang={lang}
            formLayout={leadFormLayout}
          />
        ) : null}

        {/* Description */}
        {lead?.description ? (
          <Surface style={[styles.card, { backgroundColor: theme.colors.surface }]} elevation={1}>
            <Text
              variant="titleSmall"
              style={{ color: theme.colors.onSurface, fontWeight: '600', marginBottom: 8 }}
            >
              {t('leads.description')}
            </Text>
            <Text
              variant="bodyMedium"
              style={{
                color: theme.colors.onSurfaceVariant,
                textAlign,
                writingDirection,
                lineHeight: 22,
              }}
            >
              {lead.description}
            </Text>
          </Surface>
        ) : null}

        {/* Contact link */}
        {lead?.contactName ? (
          <Pressable onPress={handleViewContact}>
            <Surface style={[styles.card, { backgroundColor: theme.colors.surface }]} elevation={1}>
              <View style={[styles.contactLink, { flexDirection }]}>
                <Avatar.Text
                  size={40}
                  label={getInitials(lead.contactName)}
                  style={{ backgroundColor: theme.colors.primaryContainer }}
                  labelStyle={{ color: theme.colors.primary, fontWeight: '700' }}
                />
                <View style={styles.contactLinkText}>
                  <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant }}>
                    {t('leads.contact')}
                  </Text>
                  <Text variant="titleSmall" style={{ color: theme.colors.onSurface, fontWeight: '600' }}>
                    {lead.contactName}
                  </Text>
                </View>
                <MaterialCommunityIcons
                  name={isRTL ? 'chevron-left' : 'chevron-right'}
                  size={20}
                  color={theme.colors.onSurfaceVariant}
                  style={{ opacity: 0.5 }}
                />
              </View>
            </Surface>
          </Pressable>
        ) : null}

        {/* Action buttons */}
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
              label={t('contacts.sendMessage')}
              color="#25D366"
              bg="#E8F5E9"
              onPress={handleMessage}
            />
            <ActionButton
              icon="clipboard-check-outline"
              label={t('tasks.addTask')}
              color="#FF9800"
              bg="#FFF3E0"
              onPress={() => setAddTaskVisible(true)}
            />
            <ActionButton
              icon="note-plus-outline"
              label={t('phoneCalls.addNote')}
              color="#9C27B0"
              bg="#F3E5F5"
              onPress={() => setNoteModalVisible(true)}
            />
            <ActionButton
              icon="file-document-outline"
              label={t('quotes.addQuote', 'הצעת מחיר')}
              color="#2196F3"
              bg="#E3F2FD"
              onPress={() => router.push({
                pathname: '/(tabs)/more/quotes/[id]',
                params: {
                  id: 'new',
                  prefillContactName: lead?.contactName || '',
                  prefillContactPhone: lead?.contactPhone || lead?.phoneNumber || '',
                  prefillTitle: lead?.title || '',
                  prefillLeadId: lead?.id || '',
                },
              })}
            />
            {clearingEnabled ? (
              <ActionButton
                icon="credit-card-outline"
                label={t('payments.charge', 'סליקה')}
                color="#2e6155"
                bg="#E8F5E9"
                onPress={handleOpenPayment}
              />
            ) : null}
          </View>
        ) : null}

        {/* Timeline */}
        {!isNew ? (
          <Surface style={[styles.card, { backgroundColor: theme.colors.surface }]} elevation={1}>
            <Text
              variant="titleSmall"
              style={{ color: theme.colors.onSurface, fontWeight: '600', marginBottom: 12 }}
            >
              {t('contacts.timeline')}
            </Text>
            <TimelineSection theme={theme} t={t} lang={lang} isRTL={isRTL} flexDirection={flexDirection} events={timelineEvents} loading={timelineLoading} />
          </Surface>
        ) : null}

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Stage picker modal */}
      <Modal
        visible={stagePickerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setStagePickerVisible(false)}
        >
          <Pressable
            style={styles.stagePickerOverlay}
            onPress={() => setStagePickerVisible(false)}
          >
            <Pressable
              onPress={(e) => e.stopPropagation()}
              style={[
                styles.stagePickerSheet,
                { backgroundColor: theme.colors.surface, paddingBottom: insets.bottom + 16 },
              ]}
            >
              <Text
                variant="titleMedium"
                style={{ color: theme.colors.onSurface, fontWeight: '700', marginBottom: 12 }}
              >
                {t('leads.moveStage')}
              </Text>
              {stageKeys.map((stage) => {
                const color = stageColorMap[stage] ?? theme.colors.primary;
                const isActive = (lead?.stage === stage) || (lead?.stageName === stage);
                return (
                  <Pressable
                    key={stage}
                    onPress={() => handleStageChange(stage)}
                    style={[
                      styles.stagePickerItem,
                      isActive && { backgroundColor: withAlpha(color, 0.082) },
                      { flexDirection },
                    ]}
                  >
                    <View
                      style={[styles.stagePickerDot, { backgroundColor: color }]}
                    />
                    <Text
                      variant="bodyLarge"
                      style={{
                        color: isActive ? color : theme.colors.onSurface,
                        fontWeight: isActive ? '700' : '400',
                        flex: 1,
                      }}
                    >
                      {t(STAGE_I18N[stage] ?? stage)}
                    </Text>
                    {isActive ? (
                      <MaterialCommunityIcons name="check" size={20} color={color} />
                    ) : null}
                  </Pressable>
                );
              })}
            </Pressable>
          </Pressable>
      </Modal>

      {/* Edit modal */}
      <Modal
        visible={editVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => {
          if (isNew) { if (router.canGoBack()) router.back(); else router.replace('/(tabs)/leads'); }
          else setEditVisible(false);
        }}
      >
          <KeyboardAvoidingView
            behavior="padding"
            style={[styles.modalContainer, { backgroundColor: theme.colors.background, paddingTop: insets.top }]}
          >
            <View style={[styles.modalHeader, { borderBottomColor: theme.colors.outline, flexDirection }]}>
              <IconButton icon="close" iconColor={theme.colors.onSurfaceVariant} size={22} onPress={() => { if (isNew) { if (router.canGoBack()) router.back(); else router.replace('/(tabs)/leads'); } else setEditVisible(false); }} style={{ margin: 0 }} />
              <Text variant="titleMedium" style={{ color: theme.colors.onSurface, fontWeight: '700', flex: 1, textAlign }}>
                {isNew ? t('leads.addLead') : t('leads.editLead')}
              </Text>
              <View style={{ width: 40 }} />
            </View>

            <ScrollView
              contentContainerStyle={styles.formScrollContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {/* ── Contact Section ── */}
              <View style={[styles.formSectionCard, { backgroundColor: theme.colors.surface }]}>
                <View style={[styles.formSectionHeader, { flexDirection }]}>
                  <View style={styles.formSectionAccent} />
                  <MaterialCommunityIcons name="account-box-outline" size={18} color="#2e6155" />
                  <Text variant="titleSmall" style={styles.formSectionTitle}>{t('leads.contact')}</Text>
                </View>
                <Pressable
                  onPress={() => setContactLookupVisible(true)}
                  style={[styles.contactLookupBtn, { backgroundColor: withAlpha('#2e6155', 0.06), borderColor: withAlpha('#2e6155', 0.2), flexDirection }]}
                >
                  <View style={[styles.contactLookupIconCircle, { backgroundColor: '#2e6155' }]}>
                    <MaterialCommunityIcons name="account-search" size={20} color="#FFFFFF" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: form.contactName ? theme.colors.onSurface : theme.custom.placeholder, fontSize: 15, fontWeight: form.contactName ? '600' : '400', textAlign }} numberOfLines={1}>
                      {form.contactName ? `${form.contactName}${form.contactPhone ? `  •  ${form.contactPhone}` : ''}` : t('common.selectContact')}
                    </Text>
                  </View>
                  <MaterialCommunityIcons name={isRTL ? 'chevron-left' : 'chevron-right'} size={20} color="#2e6155" />
                </Pressable>
                <FormField label={t('contacts.company')} value={form.companyName ?? ''} onChangeText={(v) => updateField('companyName', v)} theme={theme} textAlign={textAlign} writingDirection={writingDirection} />
                <FormField label={t('leads.jobTitle', 'Job Title')} value={form.jobTitle ?? ''} onChangeText={(v) => updateField('jobTitle', v)} theme={theme} textAlign={textAlign} writingDirection={writingDirection} />
              </View>

              {/* ── Lead Details Section ── */}
              <View style={[styles.formSectionCard, { backgroundColor: theme.colors.surface }]}>
                <View style={[styles.formSectionHeader, { flexDirection }]}>
                  <View style={styles.formSectionAccent} />
                  <MaterialCommunityIcons name="text-box-outline" size={18} color="#2e6155" />
                  <Text variant="titleSmall" style={styles.formSectionTitle}>{t('leads.leadTitle')}</Text>
                </View>
              <FormField
                label={t('leads.leadTitle')}
                value={form.title ?? ''}
                onChangeText={(v) => updateField('title', v)}
                theme={theme}
                textAlign={textAlign}
                writingDirection={writingDirection}
              />

              <Text
                variant="labelMedium"
                style={{ color: theme.colors.onSurfaceVariant, marginBottom: 6, textAlign }}
              >
                {t('leads.stage')}
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={[styles.formStageRow, { flexDirection }]}
              >
                {stageKeys.map((stage) => {
                  const color = stageColorMap[stage] ?? theme.colors.primary;
                  const isSelected = (form.stage === stage) || (form.stageName === stage);
                  return (
                    <Chip
                      key={stage}
                      selected={isSelected}
                      onPress={() => setForm((prev) => ({ ...prev, stage, stageName: stage }))}
                      compact
                      style={[
                        styles.formStageChip,
                        isSelected
                          ? { backgroundColor: withAlpha(color, 0.145), borderColor: color, borderWidth: 1.5 }
                          : { backgroundColor: theme.colors.surfaceVariant, borderWidth: 1.5, borderColor: 'transparent' },
                      ]}
                      textStyle={{
                        fontSize: 12,
                        color: isSelected ? color : theme.colors.onSurfaceVariant,
                        fontWeight: isSelected ? '700' : '400',
                      }}
                    >
                      {t(STAGE_I18N[stage] ?? stage)}
                    </Chip>
                  );
                })}
              </ScrollView>

              <FormField
                label={t('leads.value')}
                value={form.value?.toString() ?? ''}
                onChangeText={(v) => updateField('value', parseFloat(v) || 0)}
                theme={theme}
                textAlign={textAlign}
                writingDirection={writingDirection}
                keyboardType="numeric"
              />

              <Text
                variant="labelMedium"
                style={{ color: theme.colors.onSurfaceVariant, marginBottom: 6, textAlign }}
              >
                {t('leads.currency', 'Currency')}
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={[styles.formStageRow, { flexDirection }]}
              >
                {CURRENCY_OPTIONS.map((cur) => {
                  const isSelected = (form.currency || 'ILS') === cur;
                  return (
                    <Chip
                      key={cur}
                      selected={isSelected}
                      onPress={() => setForm((prev) => ({ ...prev, currency: cur }))}
                      compact
                      style={[
                        styles.formStageChip,
                        isSelected
                          ? { backgroundColor: withAlpha(theme.colors.primary, 0.145), borderColor: theme.colors.primary, borderWidth: 1 }
                          : { backgroundColor: theme.colors.surfaceVariant },
                      ]}
                      textStyle={{
                        fontSize: 12,
                        color: isSelected ? theme.colors.primary : theme.colors.onSurfaceVariant,
                        fontWeight: isSelected ? '600' : '400',
                      }}
                    >
                      {cur}
                    </Chip>
                  );
                })}
              </ScrollView>
              </View>

              {/* ── Source & Channel Section ── */}
              <View style={[styles.formSectionCard, { backgroundColor: theme.colors.surface }]}>
                <View style={[styles.formSectionHeader, { flexDirection }]}>
                  <View style={styles.formSectionAccent} />
                  <MaterialCommunityIcons name="source-branch" size={18} color="#2e6155" />
                  <Text variant="titleSmall" style={styles.formSectionTitle}>{t('leads.source')}</Text>
                </View>
              <Text
                variant="labelMedium"
                style={{ color: theme.colors.onSurfaceVariant, marginBottom: 6, textAlign }}
              >
                {t('leads.source')}
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={[styles.formStageRow, { flexDirection }]}
              >
                {LEAD_SOURCES.map((src) => {
                  const isSelected = form.source === src;
                  return (
                    <Chip
                      key={src}
                      selected={isSelected}
                      onPress={() => setForm((prev) => ({ ...prev, source: isSelected ? '' : src }))}
                      compact
                      style={[
                        styles.formStageChip,
                        isSelected
                          ? { backgroundColor: withAlpha(theme.colors.primary, 0.145), borderColor: theme.colors.primary, borderWidth: 1 }
                          : { backgroundColor: theme.colors.surfaceVariant },
                      ]}
                      textStyle={{
                        fontSize: 12,
                        color: isSelected ? theme.colors.primary : theme.colors.onSurfaceVariant,
                        fontWeight: isSelected ? '600' : '400',
                      }}
                    >
                      {src}
                    </Chip>
                  );
                })}
              </ScrollView>

              <Text
                variant="labelMedium"
                style={{ color: theme.colors.onSurfaceVariant, marginBottom: 6, textAlign }}
              >
                {t('leads.channel')}
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={[styles.formStageRow, { flexDirection }]}
              >
                {LEAD_CHANNELS.map((ch) => {
                  const isSelected = form.medium === ch;
                  return (
                    <Chip
                      key={ch}
                      selected={isSelected}
                      onPress={() => setForm((prev) => ({ ...prev, medium: isSelected ? '' : ch }))}
                      compact
                      style={[
                        styles.formStageChip,
                        isSelected
                          ? { backgroundColor: '#9C27B025', borderColor: '#9C27B0', borderWidth: 1 }
                          : { backgroundColor: theme.colors.surfaceVariant },
                      ]}
                      textStyle={{
                        fontSize: 12,
                        color: isSelected ? '#9C27B0' : theme.colors.onSurfaceVariant,
                        fontWeight: isSelected ? '600' : '400',
                      }}
                    >
                      {ch}
                    </Chip>
                  );
                })}
              </ScrollView>
              </View>

              {/* ── Status & Assignment Section ── */}
              <View style={[styles.formSectionCard, { backgroundColor: theme.colors.surface }]}>
                <View style={[styles.formSectionHeader, { flexDirection }]}>
                  <View style={styles.formSectionAccent} />
                  <MaterialCommunityIcons name="flag-outline" size={18} color="#2e6155" />
                  <Text variant="titleSmall" style={styles.formSectionTitle}>{t('leads.status')}</Text>
                </View>
              <Text
                variant="labelMedium"
                style={{ color: theme.colors.onSurfaceVariant, marginBottom: 6, textAlign }}
              >
                {t('leads.status')}
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={[styles.formStageRow, { flexDirection }]}
              >
                {LEAD_STATUSES.map((st) => {
                  const isSelected = (form.status || 'Active') === st;
                  return (
                    <Chip
                      key={st}
                      selected={isSelected}
                      onPress={() => setForm((prev) => ({ ...prev, status: st }))}
                      compact
                      style={[
                        styles.formStageChip,
                        isSelected
                          ? { backgroundColor: withAlpha(theme.colors.tertiary || '#FF9800', 0.145), borderColor: theme.colors.tertiary || '#FF9800', borderWidth: 1 }
                          : { backgroundColor: theme.colors.surfaceVariant },
                      ]}
                      textStyle={{
                        fontSize: 12,
                        color: isSelected ? (theme.colors.tertiary || '#FF9800') : theme.colors.onSurfaceVariant,
                        fontWeight: isSelected ? '600' : '400',
                      }}
                    >
                      {st}
                    </Chip>
                  );
                })}
              </ScrollView>

              <Text
                variant="labelMedium"
                style={{ color: theme.colors.onSurfaceVariant, marginBottom: 6, textAlign }}
              >
                {t('tasks.priority')}
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={[styles.formStageRow, { flexDirection }]}
              >
                {(['low', 'medium', 'high'] as const).map((p) => {
                  const isSelected = form.priority === p;
                  return (
                    <Chip
                      key={p}
                      selected={isSelected}
                      onPress={() => updateField('priority', p)}
                      compact
                      style={[
                        styles.formStageChip,
                        isSelected
                          ? { backgroundColor: withAlpha(theme.colors.primary, 0.145), borderColor: theme.colors.primary, borderWidth: 1 }
                          : { backgroundColor: theme.colors.surfaceVariant },
                      ]}
                      textStyle={{
                        fontSize: 12,
                        color: isSelected ? theme.colors.primary : theme.colors.onSurfaceVariant,
                        fontWeight: isSelected ? '600' : '400',
                      }}
                    >
                      {t(`tasks.${p}`)}
                    </Chip>
                  );
                })}
              </ScrollView>
              </View>

              {/* ── Dates Section ── */}
              <View style={[styles.formSectionCard, { backgroundColor: theme.colors.surface }]}>
                <View style={[styles.formSectionHeader, { flexDirection }]}>
                  <View style={styles.formSectionAccent} />
                  <MaterialCommunityIcons name="calendar-range" size={18} color="#2e6155" />
                  <Text variant="titleSmall" style={styles.formSectionTitle}>{t('leads.expectedClose')}</Text>
                </View>
              <FormField
                label={t('leads.expectedClose')}
                value={form.expectedCloseDate ?? ''}
                onChangeText={(v) => updateField('expectedCloseDate', v)}
                theme={theme}
                textAlign={textAlign}
                writingDirection={writingDirection}
                placeholder="DD/MM/YYYY"
              />
              <FormField
                label={t('leads.nextFollowUp', 'Next Follow-Up')}
                value={form.nextFollowUp ?? ''}
                onChangeText={(v) => updateField('nextFollowUp', v)}
                theme={theme}
                textAlign={textAlign}
                writingDirection={writingDirection}
                placeholder="YYYY-MM-DD"
              />
              </View>

              {/* ── Additional Details Section ── */}
              <View style={[styles.formSectionCard, { backgroundColor: theme.colors.surface }]}>
                <View style={[styles.formSectionHeader, { flexDirection }]}>
                  <View style={styles.formSectionAccent} />
                  <MaterialCommunityIcons name="text-box-multiple-outline" size={18} color="#2e6155" />
                  <Text variant="titleSmall" style={styles.formSectionTitle}>{t('leads.description')}</Text>
                </View>
              <FormField
                label={t('leads.description')}
                value={form.description ?? ''}
                onChangeText={(v) => updateField('description', v)}
                theme={theme}
                textAlign={textAlign}
                writingDirection={writingDirection}
                multiline
              />
              <FormField
                label={t('quotes.notes')}
                value={form.notes ?? ''}
                onChangeText={(v) => updateField('notes', v)}
                theme={theme}
                textAlign={textAlign}
                writingDirection={writingDirection}
                multiline
              />
              {/* Owner - user picker */}
              <Pressable
                onPress={() => {
                  setOwnerPickerExpanded((v) => !v);
                  if (orgUsers.length === 0 && !orgUsersLoading) {
                    setOrgUsersLoading(true);
                    usersApi.getAll(organization).then((u) => setOrgUsers(u)).catch(() => {}).finally(() => setOrgUsersLoading(false));
                  }
                }}
                style={{
                  borderWidth: 1,
                  borderRadius: 4,
                  borderColor: ownerPickerExpanded ? theme.colors.primary : theme.colors.outline,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  backgroundColor: theme.colors.surface,
                  marginBottom: 14,
                }}
              >
                <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 2 }}>
                  {t('leads.owner')}
                </Text>
                <View style={[{ flexDirection, alignItems: 'center', gap: 8 }]}>
                  <MaterialCommunityIcons name="account-tie" size={16} color={theme.colors.onSurfaceVariant} />
                  <Text variant="bodyMedium" style={{ flex: 1, color: form.ownerName ? theme.colors.onSurface : theme.colors.onSurfaceVariant, textAlign }}>
                    {orgUsersLoading ? t('common.loading') || 'טוען...' : (form.ownerName || form.ownerId || t('leads.selectOwner') || 'בחר בעל ליד')}
                  </Text>
                  <MaterialCommunityIcons name={ownerPickerExpanded ? 'chevron-up' : 'chevron-down'} size={18} color={theme.colors.onSurfaceVariant} />
                </View>
              </Pressable>
              {ownerPickerExpanded && (
                <View style={{ borderWidth: 1, borderColor: theme.colors.outline, borderRadius: 4, marginTop: -14, marginBottom: 14, overflow: 'hidden' }}>
                  <Pressable
                    style={[{ padding: 12, flexDirection, alignItems: 'center', gap: 8 }]}
                    onPress={() => { setForm((prev) => ({ ...prev, ownerId: '', ownerName: '' })); setOwnerPickerExpanded(false); }}
                  >
                    <MaterialCommunityIcons name="close" size={16} color={theme.colors.onSurfaceVariant} />
                    <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>{t('common.none') || 'ללא'}</Text>
                  </Pressable>
                  <Divider />
                  {orgUsers.map((u) => (
                    <Pressable
                      key={u.uID || u.userId || u.id}
                      style={[{ padding: 12, flexDirection, alignItems: 'center', gap: 8, backgroundColor: (u.uID || u.userId || u.id) === form.ownerId ? `${theme.colors.primary}15` : 'transparent' }]}
                      onPress={() => { setForm((prev) => ({ ...prev, ownerId: u.uID || u.userId || u.id || '', ownerName: u.userName || u.fullname || u.name || '' })); setOwnerPickerExpanded(false); }}
                    >
                      <MaterialCommunityIcons name="account" size={16} color={(u.uID || u.userId || u.id) === form.ownerId ? theme.colors.primary : theme.colors.onSurfaceVariant} />
                      <Text variant="bodySmall" style={{ color: (u.uID || u.userId || u.id) === form.ownerId ? theme.colors.primary : theme.colors.onSurface, fontWeight: (u.uID || u.userId || u.id) === form.ownerId ? '700' : '400' }}>
                        {u.userName || u.fullname || u.name}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )}

              <FormField
                label={t('leads.tags', 'Tags')}
                value={Array.isArray(form.tags) ? form.tags.join(', ') : ''}
                onChangeText={(v) => {
                  setForm((prev) => ({
                    ...prev,
                    tags: v.split(',').map((s) => s.trim()).filter(Boolean),
                  }));
                }}
                theme={theme}
                textAlign={textAlign}
                writingDirection={writingDirection}
                placeholder={t('leads.tagsPlaceholder', 'tag1, tag2, tag3')}
              />
              </View>

              {/* ── Product Catalog Section ── */}
              {catalogEnabled && catalogItems.length > 0 && (
                <View style={[styles.formSectionCard, { backgroundColor: theme.colors.surface }]}>
                  <View style={[styles.formSectionHeader, { flexDirection }]}>
                    <View style={styles.formSectionAccent} />
                    <MaterialCommunityIcons name="cart-outline" size={18} color="#2e6155" />
                    <Text variant="titleSmall" style={styles.formSectionTitle}>
                      {lang === 'he' ? 'מוצרים/שירותים' : 'Products of Interest'}
                    </Text>
                  </View>
                  {catalogItems.length > 6 && (
                    <TextInput
                      placeholder={lang === 'he' ? 'חיפוש מוצר...' : 'Search product...'}
                      placeholderTextColor={theme.colors.onSurfaceVariant}
                      value={catalogSearch}
                      onChangeText={setCatalogSearch}
                      style={[styles.catalogSearchInput, { backgroundColor: theme.dark ? 'rgba(255,255,255,0.06)' : '#f3f4f6', color: theme.colors.onSurface, borderColor: theme.colors.outline, textAlign }]}
                    />
                  )}
                  <View style={styles.catalogGrid}>
                    {catalogItems
                      .filter((item: any) => {
                        if (!catalogSearch.trim()) return true;
                        const q = catalogSearch.trim().toLowerCase();
                        return (item.name || '').toLowerCase().includes(q) || (item.category || '').toLowerCase().includes(q);
                      })
                      .map((item: any) => {
                        const products = (form.interestedProducts || []) as any[];
                        const existing = products.find((p: any) => p.productId === item.id);
                        return (
                          <Pressable
                            key={item.id}
                            onPress={() => {
                              if (existing) {
                                const updated = products.filter((p: any) => p.productId !== item.id);
                                setForm((prev) => ({ ...prev, interestedProducts: updated }));
                              } else {
                                const updated = [...products, { productId: item.id, name: item.name, unitPrice: item.unitPrice, sku: item.sku, category: item.category, quantity: 1 }];
                                setForm((prev) => ({ ...prev, interestedProducts: updated }));
                              }
                            }}
                            style={[
                              styles.catalogCard,
                              {
                                backgroundColor: existing ? (theme.dark ? '#1e3a2a' : '#d1fae5') : (theme.dark ? 'rgba(255,255,255,0.04)' : '#f9fafb'),
                                borderColor: existing ? '#2e6155' : (theme.dark ? 'rgba(255,255,255,0.1)' : '#e5e7eb'),
                              },
                            ]}
                          >
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                              <View style={[styles.catalogCheck, { backgroundColor: existing ? '#2e6155' : 'transparent', borderColor: existing ? '#2e6155' : theme.colors.outline }]}>
                                {existing && <MaterialCommunityIcons name="check" size={14} color="#fff" />}
                              </View>
                              <View style={{ flex: 1 }}>
                                <Text style={{ fontSize: 14, fontWeight: '600', color: theme.colors.onSurface }} numberOfLines={1}>{item.name}</Text>
                                {item.description ? <Text style={{ fontSize: 12, color: theme.colors.onSurfaceVariant, marginTop: 1 }} numberOfLines={1}>{item.description}</Text> : null}
                              </View>
                              <Text style={{ fontSize: 13, fontWeight: '600', color: '#2e6155' }}>
                                ₪{Number(item.unitPrice || 0).toLocaleString()}
                              </Text>
                            </View>
                            {existing && (
                              <View style={[styles.catalogQtyRow, { flexDirection }]}>
                                <Text style={{ fontSize: 12, color: theme.colors.onSurfaceVariant }}>{lang === 'he' ? 'כמות:' : 'Qty:'}</Text>
                                <View style={styles.catalogQtyControls}>
                                  <Pressable
                                    onPress={() => setForm((prev) => ({ ...prev, interestedProducts: products.map((p: any) => p.productId === item.id ? { ...p, quantity: Math.max(1, (p.quantity || 1) - 1) } : p) }))}
                                    style={[styles.catalogQtyBtn, { backgroundColor: theme.dark ? 'rgba(255,255,255,0.1)' : '#e5e7eb' }]}
                                  >
                                    <Text style={{ fontSize: 16, fontWeight: '700', color: theme.colors.onSurface }}>−</Text>
                                  </Pressable>
                                  <Text style={{ fontSize: 14, fontWeight: '600', color: theme.colors.onSurface, minWidth: 24, textAlign: 'center' }}>{existing.quantity || 1}</Text>
                                  <Pressable
                                    onPress={() => setForm((prev) => ({ ...prev, interestedProducts: products.map((p: any) => p.productId === item.id ? { ...p, quantity: (p.quantity || 1) + 1 } : p) }))}
                                    style={[styles.catalogQtyBtn, { backgroundColor: theme.dark ? 'rgba(255,255,255,0.1)' : '#e5e7eb' }]}
                                  >
                                    <Text style={{ fontSize: 16, fontWeight: '700', color: theme.colors.onSurface }}>+</Text>
                                  </Pressable>
                                </View>
                              </View>
                            )}
                          </Pressable>
                        );
                      })}
                  </View>
                  {(form.interestedProducts || []).length > 0 && (
                    <View style={[styles.catalogSummary, { backgroundColor: theme.dark ? 'rgba(46,97,85,0.15)' : '#ecfdf5' }]}>
                      <Text style={{ fontSize: 13, color: '#2e6155', fontWeight: '600' }}>
                        {lang === 'he' ? 'נבחרו' : 'Selected'}: {(form.interestedProducts || []).length} {lang === 'he' ? 'פריטים' : 'items'} | {lang === 'he' ? 'שווי' : 'Value'}: ₪{(form.interestedProducts || []).reduce((s: number, p: any) => s + (p.unitPrice || 0) * (p.quantity || 1), 0).toLocaleString()}
                      </Text>
                    </View>
                  )}
                </View>
              )}

              {/* ── Custom Fields Section ── */}
              {leadFormSections.length > 0 && (
                <View style={[styles.formSectionCard, { backgroundColor: theme.colors.surface }]}>
                  <DynamicFieldsSectionForm
                    sections={leadFormSections}
                    values={form as Record<string, any>}
                    onChange={(k, v) => updateField(k, v)}
                    lang={lang}
                    formLayout={leadFormLayout}
                    theme={theme}
                    textAlign={textAlign}
                    writingDirection={writingDirection}
                    flexDirection={flexDirection}
                  />
                </View>
              )}

              {/* ── Scoring Section ── */}
              <View style={[styles.formSectionCard, { backgroundColor: theme.colors.surface }]}>
                <View style={[styles.formSectionHeader, { flexDirection }]}>
                  <View style={styles.formSectionAccent} />
                  <MaterialCommunityIcons name="star-outline" size={18} color="#2e6155" />
                  <Text variant="titleSmall" style={styles.formSectionTitle}>{t('leads.score', 'Score')}</Text>
                </View>
              <Text
                variant="labelMedium"
                style={{ color: theme.colors.onSurfaceVariant, marginBottom: 6, textAlign }}
              >
                {t('leads.score', 'Score')}
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={[styles.formStageRow, { flexDirection }]}
              >
                {[1, 2, 3, 4, 5].map((star) => {
                  const isSelected = (form.score || 0) >= star;
                  return (
                    <Pressable
                      key={star}
                      onPress={() => setForm((prev) => ({ ...prev, score: prev.score === star ? 0 : star }))}
                      style={{ padding: 4 }}
                    >
                      <MaterialCommunityIcons
                        name={isSelected ? 'star' : 'star-outline'}
                        size={32}
                        color={isSelected ? '#FFC107' : theme.colors.onSurfaceVariant}
                      />
                    </Pressable>
                  );
                })}
              </ScrollView>

              {isLostStage ? (
                <>
                  <Text
                    variant="labelMedium"
                    style={{ color: theme.colors.onSurfaceVariant, marginBottom: 6, textAlign }}
                  >
                    {t('leads.lostReason', 'Lost Reason')}
                  </Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={[styles.formStageRow, { flexDirection }]}
                  >
                    {LOST_REASONS.map((reason) => {
                      const isSelected = form.lostReason === reason;
                      return (
                        <Chip
                          key={reason}
                          selected={isSelected}
                          onPress={() => setForm((prev) => ({ ...prev, lostReason: isSelected ? '' : reason }))}
                          compact
                          style={[
                            styles.formStageChip,
                            isSelected
                              ? { backgroundColor: withAlpha(theme.colors.error, 0.145), borderColor: theme.colors.error, borderWidth: 1 }
                              : { backgroundColor: theme.colors.surfaceVariant },
                          ]}
                          textStyle={{
                            fontSize: 12,
                            color: isSelected ? theme.colors.error : theme.colors.onSurfaceVariant,
                            fontWeight: isSelected ? '600' : '400',
                          }}
                        >
                          {reason.replace(/_/g, ' ')}
                        </Chip>
                      );
                    })}
                  </ScrollView>
                </>
              ) : null}
              </View>

              <View style={{ height: 100 }} />
            </ScrollView>

            {/* ── Sticky Footer ── */}
            <View style={[styles.stickyFooter, { paddingBottom: insets.bottom + 12, borderTopColor: theme.colors.outline, backgroundColor: theme.colors.surface }]}>
              {!isNew && (
                <Pressable onPress={handleDelete} style={[styles.deleteBtn, { backgroundColor: withAlpha(theme.colors.error, 0.08) }]}>
                  <MaterialCommunityIcons name="delete-outline" size={20} color={theme.colors.error} />
                  <Text style={{ color: theme.colors.error, fontWeight: '600', fontSize: 14 }}>{t('common.delete')}</Text>
                </Pressable>
              )}
              <View style={{ flex: 1 }} />
              <Button
                mode="outlined"
                onPress={() => { if (isNew) { if (router.canGoBack()) router.back(); else router.replace('/(tabs)/leads'); } else setEditVisible(false); }}
                style={styles.footerBtn}
                textColor={theme.colors.onSurface}
              >
                {t('common.cancel')}
              </Button>
              <Button
                mode="contained"
                onPress={handleSave}
                loading={saving}
                disabled={saving}
                style={[styles.footerBtn, { backgroundColor: '#2e6155' }]}
                textColor="#FFFFFF"
              >
                {t('common.save')}
              </Button>
            </View>
          </KeyboardAvoidingView>
      </Modal>

      {/* Add Task modal */}
      <Modal
        visible={addTaskVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setAddTaskVisible(false)}
      >
          <Pressable
            style={styles.stagePickerOverlay}
            onPress={() => setAddTaskVisible(false)}
          >
            <Pressable
              onPress={(e) => e.stopPropagation()}
              style={[
                styles.stagePickerSheet,
                { backgroundColor: theme.colors.surface, paddingBottom: insets.bottom + 16 },
              ]}
            >
              <Text
                variant="titleMedium"
                style={{ color: theme.colors.onSurface, fontWeight: '700', marginBottom: 12 }}
              >
                {t('tasks.addTask')} ({t('contacts.phoneCall')})
              </Text>
              <FormField
                label={t('tasks.taskTitle')}
                value={taskTitle}
                onChangeText={setTaskTitle}
                theme={theme}
                textAlign={textAlign}
                writingDirection={writingDirection}
                placeholder={lead?.contactName ? `${t('contacts.phoneCall')} - ${lead.contactName}` : undefined}
              />
              <FormField
                label={t('tasks.dueDate')}
                value={taskDueDate}
                onChangeText={setTaskDueDate}
                theme={theme}
                textAlign={textAlign}
                writingDirection={writingDirection}
                placeholder="YYYY-MM-DD"
              />
              <View style={[styles.modalActions, { flexDirection }]}>
                <Button
                  mode="outlined"
                  onPress={() => {
                    setAddTaskVisible(false);
                    setTaskTitle('');
                    setTaskDueDate('');
                  }}
                  style={styles.addTaskModalBtn}
                  textColor={theme.colors.onSurface}
                >
                  {t('common.cancel')}
                </Button>
                <Button
                  mode="contained"
                  onPress={handleAddTask}
                  loading={creatingTask}
                  disabled={creatingTask}
                  style={[styles.addTaskModalBtn, { backgroundColor: theme.colors.primary }]}
                  textColor="#FFFFFF"
                >
                  {t('common.create')}
                </Button>
              </View>
            </Pressable>
          </Pressable>
      </Modal>

      <ContactLookup
        visible={contactLookupVisible}
        organization={organization}
        onSelect={(contact) => {
          setForm((prev) => ({
            ...prev,
            contactName: contact.name,
            contactPhone: contact.phoneNumber,
            contactId: contact.id,
          }));
          setContactLookupVisible(false);
        }}
        onDismiss={() => setContactLookupVisible(false)}
      />

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
              style={styles.stagePickerOverlay}
              onPress={() => { Keyboard.dismiss(); setNoteModalVisible(false); }}
            >
              <Pressable
                onPress={(e) => e.stopPropagation()}
                style={[
                  styles.stagePickerSheet,
                  { backgroundColor: theme.colors.surface, paddingBottom: Math.max(insets.bottom, 12) + 8 },
                ]}
              >
                <Text
                  variant="titleMedium"
                  style={{ color: theme.colors.onSurface, fontWeight: '700', marginBottom: 12 }}
                >
                  {t('phoneCalls.addNote')}
                </Text>
                <TextInput
                  value={noteText}
                  onChangeText={setNoteText}
                  placeholder={t('phoneCalls.noteHint', 'Write a note...')}
                  placeholderTextColor={theme.custom?.placeholder || '#999'}
                  multiline
                  autoFocus
                  style={[
                    styles.formInput,
                    {
                      backgroundColor: theme.custom?.inputBackground || theme.colors.surfaceVariant,
                      color: theme.colors.onSurface,
                      borderColor: theme.colors.outline,
                      textAlign,
                      writingDirection,
                      height: 120,
                      textAlignVertical: 'top',
                      marginBottom: 12,
                    },
                  ]}
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
                    style={styles.addTaskModalBtn}
                    textColor={theme.colors.onSurface}
                  >
                    {t('common.cancel')}
                  </Button>
                  <Button
                    mode="contained"
                    onPress={() => { Keyboard.dismiss(); handleAddNote(); }}
                    loading={addingNote}
                    disabled={(!noteText.trim() && !noteAttachment) || addingNote}
                    style={[styles.addTaskModalBtn, { backgroundColor: theme.colors.primary }]}
                    textColor="#FFFFFF"
                  >
                    {t('common.save')}
                  </Button>
                </View>
              </Pressable>
            </Pressable>
          </KeyboardAvoidingView>
      </Modal>

      {/* Payment Modal */}
      <Modal
        visible={paymentModalVisible}
        transparent
          animationType="fade"
          onRequestClose={() => setPaymentModalVisible(false)}
        >
          <Pressable
            style={styles.stagePickerOverlay}
            onPress={() => setPaymentModalVisible(false)}
          >
            <Pressable
              onPress={(e) => e.stopPropagation()}
              style={[
                styles.stagePickerSheet,
                { backgroundColor: theme.colors.surface, paddingBottom: insets.bottom + 16 },
              ]}
            >
              <View style={[{ flexDirection, alignItems: 'center', gap: 8, marginBottom: 16 }]}>
                <MaterialCommunityIcons name="credit-card-outline" size={22} color="#2e6155" />
                <Text
                  variant="titleMedium"
                  style={{ color: theme.colors.onSurface, fontWeight: '700', flex: 1, textAlign }}
                >
                  {t('payments.chargePayment', 'סליקה ותשלומים')}
                </Text>
              </View>

              {paymentResult?.success ? (
                <View style={{ alignItems: 'center', paddingVertical: 12 }}>
                  <MaterialCommunityIcons name="check-circle" size={56} color="#16a34a" />
                  <Text variant="titleMedium" style={{ color: '#16a34a', fontWeight: '700', marginTop: 8, textAlign: 'center' }}>
                    {t('payments.linkCreated', 'לינק תשלום נוצר!')}
                  </Text>
                  <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: 4, textAlign: 'center' }}>
                    {t('payments.amount', 'סכום')}: ₪{parseFloat(paymentAmount).toFixed(2)}
                  </Text>
                  {paymentResult.url ? (
                    <Pressable
                      onPress={() => {
                        if (paymentResult.url) Linking.openURL(paymentResult.url);
                      }}
                      style={{
                        marginTop: 12,
                        paddingHorizontal: 16,
                        paddingVertical: 10,
                        backgroundColor: '#f0fdf4',
                        borderWidth: 1,
                        borderColor: '#bbf7d0',
                        borderRadius: 10,
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 8,
                      }}
                    >
                      <MaterialCommunityIcons name="open-in-new" size={16} color="#2e6155" />
                      <Text variant="bodySmall" style={{ color: '#2e6155', fontWeight: '600' }}>
                        {t('payments.openLink', 'פתח קישור תשלום')}
                      </Text>
                    </Pressable>
                  ) : null}
                  {paymentResult.url && (lead?.contactPhone || lead?.phoneNumber) ? (
                    <Pressable
                      onPress={() => {
                        const phone = lead?.contactPhone || lead?.phoneNumber || '';
                        const text = encodeURIComponent(
                          `${t('common.hello', 'שלום')} ${lead?.contactName || ''},\n${t('payments.paymentLink', 'קישור לתשלום')}:\n${paymentResult.url}\n${t('payments.amount', 'סכום')}: ₪${parseFloat(paymentAmount).toFixed(2)}`
                        );
                        Linking.openURL(`whatsapp://send?phone=${phone}&text=${text}`);
                      }}
                      style={{
                        marginTop: 8,
                        paddingHorizontal: 16,
                        paddingVertical: 10,
                        backgroundColor: '#25D366',
                        borderRadius: 10,
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 8,
                      }}
                    >
                      <MaterialCommunityIcons name="whatsapp" size={16} color="#FFF" />
                      <Text variant="bodySmall" style={{ color: '#FFF', fontWeight: '600' }}>
                        {t('payments.sendWhatsApp', 'שלח בוואטסאפ')}
                      </Text>
                    </Pressable>
                  ) : null}
                  <View style={[styles.modalActions, { flexDirection, marginTop: 16 }]}>
                    <Button
                      mode="outlined"
                      onPress={() => { setPaymentResult(null); }}
                      style={styles.addTaskModalBtn}
                      textColor={theme.colors.onSurface}
                    >
                      {t('payments.newPayment', 'תשלום נוסף')}
                    </Button>
                    <Button
                      mode="contained"
                      onPress={() => setPaymentModalVisible(false)}
                      style={[styles.addTaskModalBtn, { backgroundColor: '#2e6155' }]}
                      textColor="#FFFFFF"
                    >
                      {t('common.close', 'סגור')}
                    </Button>
                  </View>
                </View>
              ) : (
                <>
                  {paymentResult?.error ? (
                    <View style={{ padding: 10, backgroundColor: '#fef2f2', borderRadius: 8, marginBottom: 12 }}>
                      <Text variant="bodySmall" style={{ color: '#991b1b' }}>{paymentResult.error}</Text>
                    </View>
                  ) : null}

                  {lead?.contactName ? (
                    <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 12, textAlign }}>
                      {t('payments.customer', 'לקוח')}: <Text style={{ fontWeight: '600', color: theme.colors.onSurface }}>{lead.contactName}</Text>
                      {lead.contactPhone || lead.phoneNumber ? ` • ${lead.contactPhone || lead.phoneNumber}` : ''}
                    </Text>
                  ) : null}

                  <FormField
                    label={t('payments.amount', 'סכום (₪)')}
                    value={paymentAmount}
                    onChangeText={setPaymentAmount}
                    theme={theme}
                    textAlign={textAlign}
                    writingDirection={writingDirection}
                    keyboardType="numeric"
                    placeholder="0.00"
                  />

                  <FormField
                    label={t('payments.description', 'תיאור')}
                    value={paymentDescription}
                    onChangeText={setPaymentDescription}
                    theme={theme}
                    textAlign={textAlign}
                    writingDirection={writingDirection}
                    placeholder={t('payments.descPlaceholder', 'תיאור העסקה')}
                  />

                  <Text
                    variant="labelMedium"
                    style={{ color: theme.colors.onSurfaceVariant, marginBottom: 6, textAlign }}
                  >
                    {t('payments.installments', 'תשלומים')}
                  </Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={[styles.formStageRow, { flexDirection }]}
                  >
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => {
                      const isSelected = paymentInstallments === n;
                      return (
                        <Chip
                          key={n}
                          selected={isSelected}
                          onPress={() => setPaymentInstallments(n)}
                          compact
                          style={[
                            styles.formStageChip,
                            isSelected
                              ? { backgroundColor: withAlpha('#2e6155', 0.145), borderColor: '#2e6155', borderWidth: 1 }
                              : { backgroundColor: theme.colors.surfaceVariant },
                          ]}
                          textStyle={{
                            fontSize: 12,
                            color: isSelected ? '#2e6155' : theme.colors.onSurfaceVariant,
                            fontWeight: isSelected ? '600' : '400',
                          }}
                        >
                          {n === 1 ? (t('payments.onePayment', '1') ) : `${n}`}
                        </Chip>
                      );
                    })}
                  </ScrollView>

                  <View style={[styles.modalActions, { flexDirection, marginTop: 16 }]}>
                    <Button
                      mode="outlined"
                      onPress={() => setPaymentModalVisible(false)}
                      style={styles.addTaskModalBtn}
                      textColor={theme.colors.onSurface}
                    >
                      {t('common.cancel')}
                    </Button>
                    <Button
                      mode="contained"
                      onPress={handleCreatePaymentLink}
                      loading={paymentLoading}
                      disabled={paymentLoading}
                      style={[styles.addTaskModalBtn, { backgroundColor: '#2e6155' }]}
                      textColor="#FFFFFF"
                      icon="link-variant"
                    >
                      {t('payments.createLink', 'צור לינק תשלום')}
                    </Button>
                  </View>
                </>
              )}
            </Pressable>
          </Pressable>
      </Modal>
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
      <Text
        variant="labelSmall"
        style={{ color, marginTop: 4, fontWeight: '500', textAlign: 'center' }}
        numberOfLines={1}
      >
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
  valueStyle,
}: {
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  label: string;
  value: string;
  theme: any;
  flexDirection: 'row' | 'row-reverse';
  textAlign: 'left' | 'right';
  valueStyle?: any;
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
        <Text
          variant="bodyMedium"
          style={[{ color: theme.colors.onSurface, textAlign, fontWeight: '500' }, valueStyle]}
        >
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
  placeholder,
  icon,
  error,
  required,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  theme: any;
  textAlign: 'left' | 'right';
  writingDirection: 'ltr' | 'rtl';
  multiline?: boolean;
  keyboardType?: TextInput['props']['keyboardType'];
  placeholder?: string;
  icon?: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  error?: string;
  required?: boolean;
}) {
  const [focused, setFocused] = React.useState(false);
  const borderColor = error
    ? theme.colors.error
    : focused
      ? '#2e6155'
      : theme.colors.outline;
  return (
    <View style={styles.formField}>
      <Text
        variant="labelMedium"
        style={{
          color: error ? theme.colors.error : theme.colors.onSurfaceVariant,
          marginBottom: 6,
          textAlign,
          fontWeight: '500',
        }}
      >
        {label}{required ? ' *' : ''}
      </Text>
      <View
        style={[
          styles.formInputRow,
          {
            backgroundColor: theme.custom.inputBackground,
            borderColor,
            borderWidth: focused || error ? 1.5 : 1,
          },
          multiline && { alignItems: 'flex-start' },
        ]}
      >
        {icon ? (
          <MaterialCommunityIcons
            name={icon}
            size={18}
            color={focused ? '#2e6155' : theme.colors.onSurfaceVariant}
            style={{ marginEnd: 10, marginTop: multiline ? 2 : 0 }}
          />
        ) : null}
        <TextInput
          value={value}
          onChangeText={onChangeText}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={placeholder}
          style={[
            styles.formInputInner,
            {
              color: theme.colors.onSurface,
              textAlign,
              writingDirection,
            },
            multiline && { height: 80, textAlignVertical: 'top' },
          ]}
          placeholderTextColor={theme.custom.placeholder}
          multiline={multiline}
          keyboardType={keyboardType}
        />
      </View>
      {error ? (
        <Text variant="labelSmall" style={{ color: theme.colors.error, marginTop: 4, textAlign }}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

type LeadTimelineFilterKey = 'all' | 'notes' | 'lead' | 'system';

const LEAD_TIMELINE_FILTERS: { key: LeadTimelineFilterKey; label: string; icon: string }[] = [
  { key: 'all', label: 'הכל', icon: 'format-list-bulleted' },
  { key: 'notes', label: 'הערות', icon: 'note-text' },
  { key: 'lead', label: 'ליד', icon: 'account-convert' },
  { key: 'system', label: 'מערכת', icon: 'cog-outline' },
];

function getLeadTimelineGroup(entry: any): LeadTimelineFilterKey {
  const t = (entry?.TimelineType || entry?.timelineType || entry?.Type || entry?.type || '').toLowerCase();
  if (t === 'note' || t === 'internal_mention') return 'notes';
  if (t === 'stage_change' || t.startsWith('lead_')) return 'lead';
  return 'system';
}

function TimelineSection({
  theme,
  t,
  lang,
  isRTL,
  flexDirection,
  events,
  loading,
}: {
  theme: any;
  t: any;
  lang: 'en' | 'he';
  isRTL: boolean;
  flexDirection: 'row' | 'row-reverse';
  events: any[];
  loading: boolean;
}) {
  const [activeFilter, setActiveFilter] = useState<LeadTimelineFilterKey>('all');

  if (loading) {
    return (
      <View style={styles.timelineEmpty}>
        <ActivityIndicator size="small" color={theme.colors.primary} />
      </View>
    );
  }

  if (!events || events.length === 0) {
    return (
      <View style={styles.timelineEmpty}>
        <MaterialCommunityIcons
          name="timeline-clock-outline"
          size={40}
          color={theme.colors.onSurfaceVariant}
          style={{ opacity: 0.35 }}
        />
        <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant, marginTop: 8 }}>
          {t('timeline.noEvents')}
        </Text>
      </View>
    );
  }

  const counts: Record<LeadTimelineFilterKey, number> = { all: events.length, notes: 0, lead: 0, system: 0 };
  events.forEach((e) => { counts[getLeadTimelineGroup(e)]++; });
  const visibleFilters = LEAD_TIMELINE_FILTERS.filter((f) => f.key === 'all' || counts[f.key] > 0);
  const filtered = activeFilter === 'all' ? events : events.filter((e) => getLeadTimelineGroup(e) === activeFilter);

  return (
    <View>
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

      {filtered.map((event, idx) => {
        const id = event.TimelineId || event.timelineId || event.id || `${idx}`;
        const creator = event.CreatedByName || event.createdByName || '';
        const ts = event.CreateDateTimeUTC || event.createDateTimeUTC || event.timestamp || event.createdOn || '';
        const { icon, color, label, detail } = buildTimelineItem(event, lang);
        return (
          <View key={id} style={[styles.timelineItem, { flexDirection }]}>
            <View style={[styles.timelineDot, { backgroundColor: color }]} />
            <View style={[styles.timelineBody, { alignItems: isRTL ? 'flex-end' : 'flex-start' }]}>
              <View style={{ flexDirection: isRTL ? 'row-reverse' : 'row', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                {icon ? <Text style={{ fontSize: 14 }}>{icon}</Text> : null}
                {label ? (
                  <Text variant="labelMedium" style={{ color: theme.colors.onSurface, fontWeight: '700' }}>
                    {label}
                  </Text>
                ) : null}
              </View>
              {detail ? (
                <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, textAlign: isRTL ? 'right' : 'left', writingDirection: isRTL ? 'rtl' : 'ltr', width: '100%' }}>
                  {detail}
                </Text>
              ) : null}
              <View style={{ flexDirection, alignItems: 'center', gap: 6, marginTop: 2 }}>
                {creator && creator.toLowerCase() !== 'system' ? (
                  <Text variant="labelSmall" style={{ color: theme.colors.primary }}>
                    {creator}
                  </Text>
                ) : null}
                {ts ? (
                  <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                    {formatRelativeTime(ts, lang)}
                  </Text>
                ) : null}
              </View>
            </View>
          </View>
        );
      })}
    </View>
  );
}

function buildTimelineItem(event: any, lang: 'en' | 'he'): {
  icon: string; color: string; label: string; detail: string;
} {
  const type = (
    event.TimelineType || event.timelineType ||
    event.Type       || event.type         ||
    event.EventType  || event.eventType    ||
    'system'
  ).toLowerCase().trim();

  const note = (
    event.note        || event.Note        ||
    event.Notes       || event.notes       ||
    event.activityText || event.ActivityText ||
    event.description || event.Description ||
    event.message     || event.Message     ||
    event.content     || event.Content     ||
    ''
  );
  const he = lang === 'he';

  switch (type) {
    case 'lead_created':
      return { icon: '🆕', color: '#2e6155', label: he ? 'ליד נוצר' : 'Lead Created', detail: note };
    case 'lead_updated':
      const changed = event.changedFields ? event.changedFields.split(',').filter(Boolean).join(', ') : '';
      return { icon: '✏️', color: '#d97706', label: he ? 'ליד עודכן' : 'Lead Updated', detail: changed || note };
    case 'stage_change':
      const from = event.fromStageName || event.fromStage || '?';
      const to = event.toStageName || event.toStage || '?';
      return { icon: '🔄', color: '#8b5cf6', label: he ? 'שלב שונה' : 'Stage Changed', detail: `${from} → ${to}` };
    case 'lead_won':
      const wonVal = event.leadValue ? `${event.leadCurrency || '₪'}${parseFloat(event.leadValue).toLocaleString()}` : '';
      return { icon: '🏆', color: '#059669', label: he ? 'ליד נסגר (זכייה)' : 'Lead Won', detail: wonVal || note };
    case 'lead_lost':
      return { icon: '❌', color: '#ef4444', label: he ? 'ליד אבוד' : 'Lead Lost', detail: event.fromStageName || note };
    case 'lead_owner_change':
      const fromOwner = event.fromOwner || '';
      const toOwner = event.toOwner || '';
      return { icon: '👤', color: '#3b82f6', label: he ? 'בעלים שונה' : 'Owner Changed', detail: fromOwner && toOwner ? `${fromOwner} → ${toOwner}` : note };
    case 'lead_value_change':
      const cur = event.currency || '₪';
      const fromV = event.fromValue ? `${cur}${parseFloat(event.fromValue).toLocaleString()}` : '';
      const toV = event.toValue ? `${cur}${parseFloat(event.toValue).toLocaleString()}` : '';
      return { icon: '💰', color: '#059669', label: he ? 'ערך שונה' : 'Value Changed', detail: fromV && toV ? `${fromV} → ${toV}` : note };
    case 'lead_contact_change':
      return { icon: '📋', color: '#6366f1', label: he ? 'איש קשר שונה' : 'Contact Changed', detail: note };
    case 'task_created':
      const taskTitle = event.taskTitle || event.title || '';
      return { icon: '✅', color: '#f59e0b', label: he ? 'משימה נוצרה' : 'Task Created', detail: taskTitle || note };
    case 'task_completed':
      return { icon: '✔️', color: '#10b981', label: he ? 'משימה הושלמה' : 'Task Completed', detail: event.taskTitle || note };
    case 'task_status_change':
    case 'task_assigned':
    case 'task_priority_change':
    case 'task_due_date_change':
    case 'task_title_change':
    case 'task_type_change':
    case 'task_description_change':
      return { icon: '📝', color: '#f59e0b', label: he ? 'משימה עודכנה' : 'Task Updated', detail: event.activityText || event.taskTitle || note };
    case 'email sent':
      return { icon: '📧', color: '#6366f1', label: he ? 'מייל נשלח' : 'Email Sent', detail: event.subject || note };
    case 'event created':
      return { icon: '📅', color: '#3b82f6', label: he ? 'אירוע נוצר' : 'Event Created', detail: event.eventTitle || note };
    case 'note':
      return { icon: '💬', color: '#6b7280', label: he ? 'הערה' : 'Note', detail: note };
    case 'assign':
      return { icon: '👋', color: '#3b82f6', label: he ? 'הוקצה' : 'Assigned', detail: event.assignToName || note };
    case 'open conversation':
    case 'open conversation (incoming)':
      return { icon: '💬', color: '#2e6155', label: he ? 'שיחה נפתחה' : 'Conversation Opened', detail: note };
    case 'close':
      return { icon: '🔒', color: '#6b7280', label: he ? 'שיחה נסגרה' : 'Conversation Closed', detail: note };
    case 'status change':
      return { icon: '🔁', color: '#8b5cf6', label: he ? 'סטטוס שונה' : 'Status Changed', detail: note };
    case 'botomation send message':
      return { icon: '🤖', color: '#2e6155', label: he ? 'הודעת בוט' : 'Bot Message', detail: note };
    case 'campaign message sent':
      return { icon: '📣', color: '#f59e0b', label: he ? 'הודעת קמפיין' : 'Campaign Message', detail: note };
    case 'internal_mention':
      return { icon: '💬', color: '#f59e0b', label: he ? 'אזכור פנימי' : 'Internal Mention', detail: note };
    case 'whatsapp':
    case 'whatsapp_message':
    case 'message':
    case 'incoming message':
    case 'outgoing message':
      return { icon: '💬', color: '#25D366', label: he ? 'הודעת וואטסאפ' : 'WhatsApp Message', detail: note };
    case 'call':
    case 'phone_call':
    case 'phone call':
      return { icon: '📞', color: '#3b82f6', label: he ? 'שיחת טלפון' : 'Phone Call', detail: note };
    case 'system':
    case 'system_event':
    case 'automation':
      return { icon: '⚙️', color: '#6b7280', label: he ? 'פעולת מערכת' : 'System Action', detail: note };
    default:
      return {
        icon: note ? '📝' : '⚙️',
        color: '#6b7280',
        label: note ? (he ? 'פעילות' : 'Activity') : (he ? 'פעולת מערכת' : 'System'),
        detail: note,
      };
  }
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
  stageBanner: {
    marginHorizontal: 16,
    marginTop: 16,
    marginBottom: 12,
    borderRadius: 14,
    padding: 14,
  },
  stageIndicator: { alignItems: 'center', gap: 10, marginBottom: 10 },
  stageDot: { width: 12, height: 12, borderRadius: 6 },
  stageProgress: {
    flexDirection: 'row',
    gap: 3,
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  stageProgressDot: { height: 4, borderRadius: 2 },
  card: {
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 16,
    borderRadius: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  cardDivider: { marginVertical: 12 },
  infoRow: { alignItems: 'center' },
  infoRowText: { flex: 1 },
  contactLink: { alignItems: 'center', gap: 12 },
  contactLinkText: { flex: 1 },
  actionsRow: {
    justifyContent: 'center',
    gap: 20,
    paddingHorizontal: 24,
    paddingVertical: 16,
    flexWrap: 'wrap',
  },
  actionBtn: { alignItems: 'center', width: 64 },
  actionBtnCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timelineEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 24,
  },
  timelineItem: { alignItems: 'flex-start', marginBottom: 16, gap: 12 },
  timelineDot: { width: 10, height: 10, borderRadius: 5, marginTop: 5 },
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
  stagePickerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  stagePickerSheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
  },
  stagePickerItem: {
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 10,
    marginBottom: 2,
  },
  stagePickerDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  modalContainer: { flex: 1 },
  modalHeader: {
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  formScrollContent: { padding: 16, paddingBottom: 0, gap: 0 },
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
  chipLabel: {
    marginBottom: 8,
    fontWeight: '500',
  },
  chipRow: { gap: 8, paddingBottom: 6 },
  valueRow: { gap: 12 },
  formField: { marginBottom: 12 },
  formInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  formInputInner: {
    flex: 1,
    fontSize: 15,
    padding: 0,
  },
  formInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  formStageRow: { gap: 8, paddingBottom: 4 },
  formStageChip: { height: 32, borderRadius: 16 },
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
  deleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'flex-end',
    marginTop: 8,
  },
  addTaskModalBtn: {
    minWidth: 100,
    borderRadius: 10,
  },
  catalogSearchInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    marginBottom: 10,
  },
  catalogGrid: {
    gap: 8,
  },
  catalogCard: {
    borderWidth: 1.5,
    borderRadius: 10,
    padding: 12,
    gap: 8,
  },
  catalogCheck: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  catalogQtyRow: {
    alignItems: 'center' as const,
    gap: 8,
    marginTop: 4,
    paddingStart: 30,
  },
  catalogQtyControls: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
  },
  catalogQtyBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  catalogSummary: {
    marginTop: 10,
    padding: 10,
    borderRadius: 8,
    alignItems: 'center' as const,
  },
});
