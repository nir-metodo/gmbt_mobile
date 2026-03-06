import React, { useState, useCallback, useMemo, useEffect } from 'react';
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
import { useLeadStore } from '../../../stores/leadStore';
import { useAuthStore } from '../../../stores/authStore';
import { makeAppCall } from '../../../utils/phoneCall';
import { tasksApi } from '../../../services/api/tasks';
import { contactsApi } from '../../../services/api/contacts';
import { leadsApi } from '../../../services/api/leads';
import { useAppTheme } from '../../../hooks/useAppTheme';
import { useRTL } from '../../../hooks/useRTL';
import {
  formatCurrency,
  formatDate,
  formatRelativeTime,
  getInitials,
} from '../../../utils/formatters';
import { spacing, borderRadius } from '../../../constants/theme';
import ContactLookup from '../../../components/ContactLookup';
import {
  DynamicFieldsSectionView,
  DynamicFieldsSectionForm,
  type DynamicSection,
} from '../../../components/DynamicFieldsSection';
import type { Lead, LeadStage, TimelineEvent } from '../../../types';

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
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const theme = useAppTheme();
  const { isRTL, flexDirection, textAlign, writingDirection } = useRTL();
  const { t, i18n } = useTranslation();
  const lang = i18n.language as 'en' | 'he';

  const user = useAuthStore((s) => s.user);
  const organization = user?.organization ?? '';

  const leads = useLeadStore((s) => s.leads);
  const updateLead = useLeadStore((s) => s.updateLead);
  const createLead = useLeadStore((s) => s.createLead);
  const deleteLead = useLeadStore((s) => s.deleteLead);

  const isNew = id === 'new';
  const lead = useMemo(
    () => (isNew ? null : leads.find((l) => l.id === id) ?? null),
    [leads, id, isNew],
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
  const [noteModalVisible, setNoteModalVisible] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [addingNote, setAddingNote] = useState(false);
  const [pipelineStages, setPipelineStages] = useState<LeadStage[]>([]);
  const [leadFormSections, setLeadFormSections] = useState<DynamicSection[]>([]);
  const [leadFormLayout, setLeadFormLayout] = useState<string[]>([]);
  const [form, setForm] = useState<Partial<Lead>>(
    lead ? { ...lead } : { ...EMPTY_LEAD },
  );

  useEffect(() => {
    if (lead) setForm({ ...lead });
  }, [lead]);

  useEffect(() => {
    if (!organization) return;
    leadsApi.getPipelineSettings(organization)
      .then((res) => { if (res.stages.length > 0) setPipelineStages(res.stages); })
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
    if (lead?.contactId) {
      router.push({
        pathname: '/(tabs)/contacts/[id]',
        params: { id: lead.contactId },
      });
    }
  }, [lead, router]);

  const handleStageChange = useCallback(
    async (newStage: string) => {
      setStagePickerVisible(false);
      if (!organization || !lead) return;
      try {
        await updateLead(organization, { id: lead.id, stage: newStage, stageName: newStage });
      } catch {
        Alert.alert(t('common.error'));
      }
    },
    [organization, lead, updateLead, t],
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
      setTimelineEvents(Array.isArray(timeline) ? timeline : []);
    } catch {
      setTimelineEvents([]);
    } finally {
      setTimelineLoading(false);
    }
  }, [organization, lead?.id]);

  useEffect(() => {
    if (lead && !isNew) {
      fetchLeadTimeline();
    }
  }, [lead, isNew, fetchLeadTimeline]);

  const handleAddNote = useCallback(async () => {
    if (!organization || !lead || !noteText.trim()) return;
    setAddingNote(true);
    try {
      await contactsApi.addTimelineEntry(
        organization,
        `lead_${lead.id}`,
        noteText.trim(),
        user?.uID || user?.userId || '',
        user?.fullname || '',
      );
      setNoteText('');
      setNoteModalVisible(false);
      fetchLeadTimeline();
    } catch {
      Alert.alert(t('common.error'));
    } finally {
      setAddingNote(false);
    }
  }, [organization, lead, noteText, user, t, fetchLeadTimeline]);

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
                setEditVisible(true);
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
            style={[styles.stageBanner, { backgroundColor: `${stageColor}15` }]}
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

        <DynamicFieldsSectionView
          sections={leadFormSections}
          data={lead as Record<string, any>}
          lang={lang}
          formLayout={leadFormLayout}
        />

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
      <Portal>
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
            <View
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
                      isActive && { backgroundColor: `${color}15` },
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
            </View>
          </Pressable>
        </Modal>
      </Portal>

      {/* Edit modal */}
      <Portal>
        <Modal
          visible={editVisible}
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={() => {
            if (isNew) router.back();
            else setEditVisible(false);
          }}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={[styles.modalContainer, { backgroundColor: theme.colors.background }]}
          >
            <View
              style={[
                styles.modalHeader,
                { borderBottomColor: theme.colors.outline, flexDirection },
              ]}
            >
              <Pressable
                onPress={() => {
                  if (isNew) router.back();
                  else setEditVisible(false);
                }}
              >
                <Text style={{ color: theme.colors.primary, fontSize: 16 }}>
                  {t('common.cancel')}
                </Text>
              </Pressable>
              <Text
                variant="titleMedium"
                style={{ color: theme.colors.onSurface, fontWeight: '700' }}
              >
                {isNew ? t('leads.addLead') : t('leads.editLead')}
              </Text>
              <Pressable onPress={handleSave} disabled={saving}>
                {saving ? (
                  <ActivityIndicator size="small" color={theme.colors.primary} />
                ) : (
                  <Text
                    style={{ color: theme.colors.primary, fontSize: 16, fontWeight: '600' }}
                  >
                    {t('common.save')}
                  </Text>
                )}
              </Pressable>
            </View>

            <ScrollView
              contentContainerStyle={styles.formContent}
              keyboardShouldPersistTaps="handled"
            >
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
                style={{ color: theme.colors.onSurfaceVariant, marginBottom: 6 }}
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
                          ? { backgroundColor: `${color}25`, borderColor: color, borderWidth: 1 }
                          : { backgroundColor: theme.colors.surfaceVariant },
                      ]}
                      textStyle={{
                        fontSize: 12,
                        color: isSelected ? color : theme.colors.onSurfaceVariant,
                        fontWeight: isSelected ? '600' : '400',
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
                style={{ color: theme.colors.onSurfaceVariant, marginBottom: 6 }}
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
                          ? { backgroundColor: `${theme.colors.primary}25`, borderColor: theme.colors.primary, borderWidth: 1 }
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

              <Text
                variant="labelMedium"
                style={{ color: theme.colors.onSurfaceVariant, marginBottom: 6 }}
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
                          ? { backgroundColor: `${theme.colors.primary}25`, borderColor: theme.colors.primary, borderWidth: 1 }
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
                style={{ color: theme.colors.onSurfaceVariant, marginBottom: 6 }}
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

              <Text
                variant="labelMedium"
                style={{ color: theme.colors.onSurfaceVariant, marginBottom: 6 }}
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
                          ? { backgroundColor: `${theme.colors.tertiary || '#FF9800'}25`, borderColor: theme.colors.tertiary || '#FF9800', borderWidth: 1 }
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

              <View style={styles.formField}>
                <Text
                  variant="labelMedium"
                  style={{ color: theme.colors.onSurfaceVariant, marginBottom: 6 }}
                >
                  {t('leads.contact')}
                </Text>
                <Pressable
                  onPress={() => setContactLookupVisible(true)}
                  style={[
                    styles.formInput,
                    {
                      backgroundColor: theme.custom.inputBackground,
                      borderColor: theme.colors.outline,
                      flexDirection,
                      alignItems: 'center',
                    },
                  ]}
                >
                  <View style={{ flex: 1 }}>
                    <Text
                      style={{
                        color: form.contactName ? theme.colors.onSurface : theme.custom.placeholder,
                        fontSize: 15,
                        textAlign,
                      }}
                      numberOfLines={1}
                    >
                      {form.contactName
                        ? `${form.contactName}${form.contactPhone ? `  •  ${form.contactPhone}` : ''}`
                        : t('common.selectContact')}
                    </Text>
                  </View>
                  <MaterialCommunityIcons
                    name="account-search"
                    size={20}
                    color={theme.colors.onSurfaceVariant}
                  />
                </Pressable>
              </View>
              <FormField
                label={t('contacts.company')}
                value={form.companyName ?? ''}
                onChangeText={(v) => updateField('companyName', v)}
                theme={theme}
                textAlign={textAlign}
                writingDirection={writingDirection}
              />
              <FormField
                label={t('leads.jobTitle', 'Job Title')}
                value={form.jobTitle ?? ''}
                onChangeText={(v) => updateField('jobTitle', v)}
                theme={theme}
                textAlign={textAlign}
                writingDirection={writingDirection}
              />
              <Text
                variant="labelMedium"
                style={{ color: theme.colors.onSurfaceVariant, marginBottom: 6 }}
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
                          ? { backgroundColor: `${theme.colors.primary}25`, borderColor: theme.colors.primary, borderWidth: 1 }
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
              <FormField
                label={t('leads.owner')}
                value={form.ownerName ?? form.ownerId ?? ''}
                onChangeText={(v) => {
                  setForm((prev) => ({ ...prev, ownerId: v, ownerName: v }));
                }}
                theme={theme}
                textAlign={textAlign}
                writingDirection={writingDirection}
              />

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

              <Text
                variant="labelMedium"
                style={{ color: theme.colors.onSurfaceVariant, marginBottom: 6 }}
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
                    style={{ color: theme.colors.onSurfaceVariant, marginBottom: 6 }}
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
                              ? { backgroundColor: `${theme.colors.error}25`, borderColor: theme.colors.error, borderWidth: 1 }
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
            </ScrollView>
          </KeyboardAvoidingView>
        </Modal>
      </Portal>

      {/* Add Task modal */}
      <Portal>
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
      </Portal>

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

      <Portal>
        <Modal
          visible={noteModalVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setNoteModalVisible(false)}
        >
          <Pressable
            style={styles.stagePickerOverlay}
            onPress={() => setNoteModalVisible(false)}
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
                {t('phoneCalls.addNote')}
              </Text>
              <TextInput
                value={noteText}
                onChangeText={setNoteText}
                placeholder={t('phoneCalls.noteHint', 'Write a note...')}
                placeholderTextColor={theme.custom?.placeholder || '#999'}
                multiline
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
              <View style={[styles.modalActions, { flexDirection }]}>
                <Button
                  mode="outlined"
                  onPress={() => { setNoteModalVisible(false); setNoteText(''); }}
                  style={styles.addTaskModalBtn}
                  textColor={theme.colors.onSurface}
                >
                  {t('common.cancel')}
                </Button>
                <Button
                  mode="contained"
                  onPress={handleAddNote}
                  loading={addingNote}
                  disabled={!noteText.trim() || addingNote}
                  style={[styles.addTaskModalBtn, { backgroundColor: theme.colors.primary }]}
                  textColor="#FFFFFF"
                >
                  {t('common.save')}
                </Button>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      </Portal>
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
}) {
  return (
    <View style={styles.formField}>
      <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 6 }}>
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
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
      />
    </View>
  );
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

  return (
    <View>
      {events.map((event, idx) => {
        const id = event.TimelineId || event.timelineId || event.id || `${idx}`;
        const note = event.Notes || event.notes || event.description || '';
        const creator = event.CreatedByName || event.createdByName || '';
        const ts = event.CreateDateTimeUTC || event.createDateTimeUTC || event.timestamp || '';
        return (
          <View key={id} style={[styles.timelineItem, { flexDirection }]}>
            <View style={[styles.timelineDot, { backgroundColor: theme.colors.primary }]} />
            <View style={[styles.timelineBody, { alignItems: isRTL ? 'flex-end' : 'flex-start' }]}>
              {note ? (
                <Text variant="bodySmall" style={{ color: theme.colors.onSurface, textAlign: isRTL ? 'right' : 'left', width: '100%' }}>
                  {note}
                </Text>
              ) : null}
              <View style={{ flexDirection, alignItems: 'center', gap: 6, marginTop: 2 }}>
                {creator ? (
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
    borderRadius: 12,
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
    borderRadius: 12,
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
  formStageRow: { gap: 8, paddingBottom: 4 },
  formStageChip: { height: 32 },
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
});
