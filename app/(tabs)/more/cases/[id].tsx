import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
  KeyboardAvoidingView,
  Platform,
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
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../../../stores/authStore';
import { makeAppCall } from '../../../../utils/phoneCall';
import { useAppTheme } from '../../../../hooks/useAppTheme';
import { useRTL } from '../../../../hooks/useRTL';
import { casesApi } from '../../../../services/api/cases';
import { contactsApi } from '../../../../services/api/contacts';
import { usersApi } from '../../../../services/api/users';
import { formatDate, formatRelativeTime, getInitials, withAlpha } from '../../../../utils/formatters';
import { spacing, borderRadius } from '../../../../constants/theme';
import ContactLookup from '../../../../components/ContactLookup';
import type { OrgUser } from '../../../../types';
import {
  DynamicFieldsSectionView,
  DynamicFieldsSectionForm,
  type DynamicSection,
} from '../../../../components/DynamicFieldsSection';
import type { Case } from '../../../../types';

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

  const [caseData, setCaseData] = useState<Case | null>(null);
  const [caseSettings, setCaseSettings] = useState<{ sla?: { enabled: boolean; responseTime: number; resolutionTime: number } } | null>(null);
  const [caseFormSections, setCaseFormSections] = useState<DynamicSection[]>([]);
  const [caseFormLayout, setCaseFormLayout] = useState<string[]>([]);
  const [formDynamicFields, setFormDynamicFields] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [saving, setSaving] = useState(false);
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
  const [noteModalVisible, setNoteModalVisible] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [addingNote, setAddingNote] = useState(false);
  const [timelineEvents, setTimelineEvents] = useState<any[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);

  const fetchTimeline = useCallback(async () => {
    if (!user?.organization || !id || isNew) return;
    setTimelineLoading(true);
    try {
      const data = await contactsApi.getTimeline(user.organization, `case_${id}`);
      const arr = Array.isArray(data) ? data : (data as any)?.events || [];
      setTimelineEvents(arr);
    } catch {
      // non-critical
    } finally {
      setTimelineLoading(false);
    }
  }, [user?.organization, id, isNew]);

  const fetchCase = useCallback(async () => {
    if (!user?.organization) return;
    if (isNew) {
      setLoading(false);
      return;
    }
    if (!id) return;
    try {
      setError(null);
      const [found, settings] = await Promise.all([
        casesApi.getById(user.organization, id).catch(() => null),
        casesApi.getSettings(user.organization).catch(() => null),
      ]);
      if (found) {
        setCaseData(found);
      } else {
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
  }, [user?.organization, id, isNew, t]);

  useEffect(() => {
    fetchCase();
    fetchTimeline();
  }, [fetchCase, fetchTimeline]);

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

  const openEditModal = useCallback(() => {
    if (!caseData) return;
    setFormTitle(caseData.title || caseData.subject || '');
    setFormDescription(caseData.description || '');
    setFormStatus(caseData.status);
    setFormPriority(caseData.priority);
    setFormCategory(caseData.category || '');
    setFormAssignedTo(caseData.assignedToName || caseData.assignedTo || '');
    setFormAssignedToId(caseData.assignedTo || '');
    setFormSource((caseData as any).source || '');
    setFormContactName(caseData.contactName || '');
    setFormContactPhone(caseData.contactPhone || (caseData as any).contact_phone || '');
    setFormContactId(caseData.contactId || '');
    setFormDueDate((caseData as any).dueDate || (caseData as any).due_date || '');
    setFormTags((caseData as any).tags || '');
    setFormNotes((caseData as any).notes || '');
    const customFields = (caseData as any).customFields || {};
    const dynamicVals: Record<string, any> = {};
    Object.keys(caseData as any).forEach((k) => {
      if (!['id', 'title', 'subject', 'description', 'status', 'priority', 'category', 'assignedTo', 'source', 'contactName', 'contactPhone', 'contactId', 'dueDate', 'tags', 'notes', 'createdAt', 'updatedAt', 'resolvedAt', 'organization', 'pipelineId', 'stageId', 'stageName'].includes(k)) {
        dynamicVals[k] = (caseData as any)[k];
      }
    });
    setFormDynamicFields({ ...customFields, ...dynamicVals });
    setUserPickerExpanded(false);
    setEditModalVisible(true);
    if (orgUsers.length === 0) {
      setOrgUsersLoading(true);
      usersApi.getAll(user?.organization || '').then((u) => setOrgUsers(u)).catch(() => {}).finally(() => setOrgUsersLoading(false));
    }
  }, [caseData, user?.organization, orgUsers.length]);

  const handleCreate = useCallback(async () => {
    if (!user?.organization) {
      Alert.alert(t('common.error'), t('errors.generic', 'אירעה שגיאה, נסה שוב'));
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
        tags: formTags.trim() || undefined,
        notes: formNotes.trim() || undefined,
        customFields: formDynamicFields,
        ...formDynamicFields,
      }, user?.fullname, user?.userId || user?.uID || '');
      Alert.alert(
        t('common.success', 'נוצר בהצלחה'),
        t('cases.caseCreated', 'הפנייה נוצרה בהצלחה'),
        [{ text: 'OK', onPress: () => router.back() }],
      );
    } catch (err: any) {
      Alert.alert(t('common.error'), err.message || t('errors.generic'));
    } finally {
      setSaving(false);
    }
  }, [user, formTitle, formDescription, formStatus, formPriority, formCategory, formAssignedTo, formAssignedToId, formSource, formContactName, formContactPhone, formDueDate, formTags, formNotes, formDynamicFields, router, t]);

  const handleSave = useCallback(async () => {
    if (!user?.organization || !caseData || !formTitle.trim()) return;
    setSaving(true);
    try {
      await casesApi.update(user.organization, caseData.id, {
        title: formTitle.trim(),
        description: formDescription.trim() || undefined,
        status: formStatus,
        priority: formPriority as Case['priority'],
        category: formCategory.trim() || undefined,
        assignedTo: formAssignedToId || formAssignedTo.trim() || undefined,
        assignedToName: formAssignedTo.trim() || undefined,
        source: formSource || undefined,
        contactName: formContactName.trim() || undefined,
        contactPhone: formContactPhone.trim() || undefined,
        contactId: formContactId || undefined,
        dueDate: formDueDate.trim() || undefined,
        tags: formTags.trim() || undefined,
        notes: formNotes.trim() || undefined,
        customFields: formDynamicFields,
        ...formDynamicFields,
      }, user?.fullname, user?.userId || user?.uID || '');
      setEditModalVisible(false);
      await fetchCase();
    } catch (err: any) {
      Alert.alert(t('common.error'), err.message || t('errors.generic'));
    } finally {
      setSaving(false);
    }
  }, [user?.organization, caseData, formTitle, formDescription, formStatus, formPriority, formCategory, formAssignedTo, formSource, formContactName, formContactPhone, formContactId, formDueDate, formTags, formNotes, formDynamicFields, fetchCase, t]);

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
              router.back();
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
    if (!user?.organization || !caseData || !noteText.trim()) return;
    setAddingNote(true);
    try {
      await contactsApi.addTimelineEntry(
        user.organization,
        `case_${caseData.id}`,
        noteText.trim(),
        user?.uID || user?.userId || '',
        user?.fullname || '',
      );
      setNoteText('');
      setNoteModalVisible(false);
      fetchTimeline();
    } catch {
      Alert.alert(t('common.error'));
    } finally {
      setAddingNote(false);
    }
  }, [user, caseData, noteText, t, fetchTimeline]);

  const handleStatusChange = useCallback(
    async (newStatus: string) => {
      if (!user?.organization || !caseData) return;
      try {
        await casesApi.update(user.organization, caseData.id, {
          status: newStatus,
          ...(newStatus === 'resolved' ? { resolvedAt: new Date().toISOString() } : {}),
        }, user?.fullname);
        await fetchCase();
      } catch (err: any) {
        Alert.alert(t('common.error'), err.message || t('errors.generic'));
      }
    },
    [user?.organization, caseData, fetchCase, t],
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
            <IconButton icon={isRTL ? 'arrow-right' : 'arrow-left'} iconColor={theme.custom.headerText} size={24} onPress={() => router.back()} />
            <Text variant="titleMedium" style={[styles.headerTitleText, { flex: 1, textAlign, color: theme.custom.headerText }]}>
              {t('cases.createCase', 'פנייה חדשה')}
            </Text>
          </View>
        </View>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }} keyboardShouldPersistTaps="handled">
            <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant }}>{t('cases.caseTitle')} *</Text>
            <TextInput
              value={formTitle}
              onChangeText={setFormTitle}
              placeholder={t('cases.caseTitle')}
              style={[styles.formInputNew, { backgroundColor: theme.colors.surfaceVariant, color: theme.colors.onSurface, borderColor: theme.colors.outline, textAlign, writingDirection }]}
              placeholderTextColor={theme.colors.onSurfaceVariant}
            />

            <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant }}>{t('cases.description', 'תיאור')}</Text>
            <TextInput
              value={formDescription}
              onChangeText={setFormDescription}
              placeholder={t('cases.description', 'תאר את הבעיה...')}
              style={[styles.formInputNew, { backgroundColor: theme.colors.surfaceVariant, color: theme.colors.onSurface, borderColor: theme.colors.outline, height: 80, textAlignVertical: 'top', textAlign, writingDirection }]}
              placeholderTextColor={theme.colors.onSurfaceVariant}
              multiline
            />

            <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant }}>{t('cases.priority', 'עדיפות')}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={[{ flexDirection: isRTL ? 'row-reverse' : 'row', gap: 8 }]}>
                {PRIORITIES.map((p) => (
                  <Pressable
                    key={p}
                    onPress={() => setFormPriority(p)}
                    style={[styles.formChipNew, formPriority === p && { backgroundColor: `${PRIORITY_COLORS[p]}20`, borderColor: PRIORITY_COLORS[p], borderWidth: 1.5 }]}
                  >
                    <Text style={{ fontSize: 13, color: formPriority === p ? PRIORITY_COLORS[p] : theme.colors.onSurfaceVariant, fontWeight: formPriority === p ? '700' : '400' }}>{t(`cases.${p}`, p)}</Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>

            <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant }}>{t('cases.contactName', 'שם איש קשר')}</Text>
            <TextInput
              value={formContactName}
              onChangeText={setFormContactName}
              placeholder={t('cases.contactName', 'שם')}
              style={[styles.formInputNew, { backgroundColor: theme.colors.surfaceVariant, color: theme.colors.onSurface, borderColor: theme.colors.outline, textAlign, writingDirection }]}
              placeholderTextColor={theme.colors.onSurfaceVariant}
            />

            <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant }}>{t('cases.contactPhone', 'טלפון')}</Text>
            <TextInput
              value={formContactPhone}
              onChangeText={setFormContactPhone}
              placeholder={t('cases.contactPhone', 'מספר טלפון')}
              style={[styles.formInputNew, { backgroundColor: theme.colors.surfaceVariant, color: theme.colors.onSurface, borderColor: theme.colors.outline }]}
              placeholderTextColor={theme.colors.onSurfaceVariant}
              keyboardType="phone-pad"
            />

            <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant }}>{t('cases.category', 'קטגוריה')}</Text>
            <TextInput
              value={formCategory}
              onChangeText={setFormCategory}
              placeholder={t('cases.category', 'קטגוריה')}
              style={[styles.formInputNew, { backgroundColor: theme.colors.surfaceVariant, color: theme.colors.onSurface, borderColor: theme.colors.outline, textAlign, writingDirection }]}
              placeholderTextColor={theme.colors.onSurfaceVariant}
            />

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

            <View style={{ flexDirection: isRTL ? 'row-reverse' : 'row', gap: 12, marginTop: 8, paddingBottom: insets.bottom + 20 }}>
              <Button mode="outlined" onPress={() => router.back()} style={{ flex: 1 }}>{t('common.cancel')}</Button>
              <Button
                mode="contained"
                onPress={handleCreate}
                style={{ flex: 1 }}
                buttonColor={theme.colors.primary}
                textColor="#fff"
                loading={saving}
                disabled={saving || !formTitle.trim()}
              >
                {t('common.save')}
              </Button>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
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
            {caseData.title}
          </Text>
          <IconButton
            icon="pencil"
            iconColor={theme.custom.headerText}
            size={22}
            onPress={openEditModal}
          />
          <IconButton
            icon="delete-outline"
            iconColor={theme.custom.headerText}
            size={22}
            onPress={handleDelete}
            loading={deleting}
          />
        </View>
      </View>

      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        showsVerticalScrollIndicator={false}
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

        {/* Priority & Status banner */}
        <View
          style={[
            styles.bannerCard,
            { backgroundColor: theme.custom.cardBackground, borderColor: theme.colors.outlineVariant },
          ]}
        >
          <View style={[styles.bannerRow, { flexDirection }]}>
            <View style={[styles.bannerItem, { alignItems: isRTL ? 'flex-end' : 'flex-start' }]}>
              <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                {t('cases.priority')}
              </Text>
              <View style={[styles.priorityBadge, { backgroundColor: `${priorityColor}18` }]}>
                <MaterialCommunityIcons
                  name={PRIORITY_ICONS[caseData.priority] as any}
                  size={16}
                  color={priorityColor}
                />
                <Text style={[styles.priorityBadgeText, { color: priorityColor }]}>
                  {t(`tasks.${caseData.priority}`)}
                </Text>
              </View>
            </View>

            <View style={[styles.bannerItem, { alignItems: isRTL ? 'flex-end' : 'flex-start' }]}>
              <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                {t('cases.status')}
              </Text>
              <Chip
                compact
                textStyle={[styles.statusChipText, { color: statusColor }]}
                style={[styles.statusChip, { backgroundColor: `${statusColor}18` }]}
              >
                {caseData.status}
              </Chip>
            </View>
          </View>
        </View>

        {/* Status selector */}
        <View
          style={[
            styles.sectionCard,
            { backgroundColor: theme.custom.cardBackground, borderColor: theme.colors.outlineVariant },
          ]}
        >
          <Text variant="labelLarge" style={[styles.sectionLabel, { color: theme.colors.onSurface, textAlign }]}>
            {t('cases.status')}
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={[styles.statusRow, { flexDirection }]}>
              {STATUS_OPTIONS.map((s) => {
                const sc = getStatusColor(s);
                const active = caseData.status.toLowerCase().replace(/\s+/g, '_') === s;
                return (
                  <Chip
                    key={s}
                    selected={active}
                    onPress={() => handleStatusChange(s)}
                    compact
                    style={[
                      styles.statusSelectChip,
                      active
                        ? { backgroundColor: `${sc}20`, borderColor: sc, borderWidth: 1.5 }
                        : { backgroundColor: theme.colors.surfaceVariant, borderWidth: 1.5, borderColor: 'transparent' },
                    ]}
                    textStyle={[
                      { fontSize: 12 },
                      active && { color: sc, fontWeight: '700' },
                    ]}
                    icon={active ? 'check' : undefined}
                  >
                    {s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ')}
                  </Chip>
                );
              })}
            </View>
          </ScrollView>
        </View>

        {/* Description */}
        {caseData.description ? (
          <View
            style={[
              styles.sectionCard,
              { backgroundColor: theme.custom.cardBackground, borderColor: theme.colors.outlineVariant },
            ]}
          >
            <Text variant="labelLarge" style={[styles.sectionLabel, { color: theme.colors.onSurface, textAlign }]}>
              {t('cases.description')}
            </Text>
            <Text
              variant="bodyMedium"
              style={{ color: theme.colors.onSurface, lineHeight: 22, textAlign }}
            >
              {caseData.description}
            </Text>
          </View>
        ) : null}

        {/* Detail fields */}
        <View
          style={[
            styles.sectionCard,
            { backgroundColor: theme.custom.cardBackground, borderColor: theme.colors.outlineVariant },
          ]}
        >
          {/* Category */}
          {caseData.category ? (
            <View style={styles.detailRow}>
              <View style={[styles.detailIcon, { backgroundColor: '#9C27B018' }]}>
                <MaterialCommunityIcons name="tag" size={20} color="#9C27B0" />
              </View>
              <View style={[styles.detailContent, { alignItems: isRTL ? 'flex-end' : 'flex-start' }]}>
                <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                  {t('cases.category')}
                </Text>
                <Text variant="bodyMedium" style={{ color: theme.colors.onSurface, fontWeight: '500' }}>
                  {caseData.category}
                </Text>
              </View>
            </View>
          ) : null}

          {/* Source */}
          {(caseData as any).source ? (
            <>
              {caseData.category ? <Divider style={{ marginVertical: 10 }} /> : null}
              <View style={styles.detailRow}>
                <View style={[styles.detailIcon, { backgroundColor: '#2196F318' }]}>
                  <MaterialCommunityIcons name="source-branch" size={20} color="#2196F3" />
                </View>
                <View style={[styles.detailContent, { alignItems: isRTL ? 'flex-end' : 'flex-start' }]}>
                  <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                    {t('leads.source')}
                  </Text>
                  <Text variant="bodyMedium" style={{ color: theme.colors.onSurface, fontWeight: '500' }}>
                    {(caseData as any).source}
                  </Text>
                </View>
              </View>
            </>
          ) : null}

          {(caseData.category || (caseData as any).source) && (caseData.contactName || caseData.assignedToName) ? (
            <Divider style={{ marginVertical: 10 }} />
          ) : null}

          {/* Contact */}
          {caseData.contactName ? (
            <View>
              <Pressable
                onPress={() => {
                  if (caseData.contactId) {
                    router.push({ pathname: '/(tabs)/contacts/[id]', params: { id: caseData.contactId } });
                  }
                }}
                style={styles.detailRow}
              >
                <View style={[styles.detailIcon, { backgroundColor: withAlpha(theme.colors.secondary, 0.094) }]}>
                  <MaterialCommunityIcons name="account" size={20} color={theme.colors.secondary} />
                </View>
                <View style={[styles.detailContent, { alignItems: isRTL ? 'flex-end' : 'flex-start' }]}>
                  <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                    {t('cases.contact')}
                  </Text>
                  <Text variant="bodyMedium" style={{ color: theme.colors.primary, fontWeight: '500' }}>
                    {caseData.contactName}
                  </Text>
                </View>
                {caseData.contactId ? (
                  <MaterialCommunityIcons
                    name={isRTL ? 'chevron-left' : 'chevron-right'}
                    size={20}
                    color={theme.colors.onSurfaceVariant}
                  />
                ) : null}
              </Pressable>
              {(caseData.contactPhone || (caseData as any).contact_phone) ? (
                <View style={[styles.contactActions, { flexDirection }]}>
                  <Pressable
                    onPress={() => {
                      const phone = caseData.contactPhone || (caseData as any).contact_phone;
                      makeAppCall({
                        phoneNumber: phone,
                        organization: user?.organization || '',
                        callerUserId: user?.uID || user?.userId,
                        callerUserName: user?.fullname,
                        relatedTo: { type: 'case', entityId: caseData.id, entityName: caseData.subject || caseData.title },
                        contactName: caseData.contactName,
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
                </View>
              ) : null}
            </View>
          ) : null}

          {caseData.contactName && caseData.assignedToName ? (
            <Divider style={{ marginVertical: 10 }} />
          ) : null}

          {/* Assigned to */}
          {caseData.assignedToName ? (
            <View style={styles.detailRow}>
              <Avatar.Text
                size={36}
                label={getInitials(caseData.assignedToName)}
                style={{ backgroundColor: theme.colors.primaryContainer }}
                labelStyle={{ fontSize: 13, color: theme.colors.primary, fontWeight: '700' }}
              />
              <View style={[styles.detailContent, { alignItems: isRTL ? 'flex-end' : 'flex-start' }]}>
                <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                  {t('cases.assignedTo')}
                </Text>
                <Text variant="bodyMedium" style={{ color: theme.colors.onSurface, fontWeight: '500' }}>
                  {caseData.assignedToName}
                </Text>
              </View>
            </View>
          ) : null}
        </View>

        {/* Due Date */}
        {(caseData as any).dueDate || (caseData as any).due_date ? (
          <View
            style={[
              styles.sectionCard,
              { backgroundColor: theme.custom.cardBackground, borderColor: theme.colors.outlineVariant },
            ]}
          >
            <View style={styles.detailRow}>
              <View style={[styles.detailIcon, { backgroundColor: '#FF572218' }]}>
                <MaterialCommunityIcons name="calendar-clock" size={20} color="#FF5722" />
              </View>
              <View style={[styles.detailContent, { alignItems: isRTL ? 'flex-end' : 'flex-start' }]}>
                <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                  {t('cases.dueDate', 'Due Date')}
                </Text>
                <Text variant="bodyMedium" style={{ color: theme.colors.onSurface, fontWeight: '500' }}>
                  {formatDate((caseData as any).dueDate || (caseData as any).due_date)}
                </Text>
              </View>
            </View>
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
              {formatDate(caseData.createdAt)} • {formatRelativeTime(caseData.createdAt, lang)}
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

        <DynamicFieldsSectionView
          sections={caseFormSections}
          data={{ ...(caseData as any).customFields, ...caseData } as Record<string, any>}
          lang={lang}
          formLayout={caseFormLayout}
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
            timelineEvents.slice(0, 15).map((ev: any, idx: number) => (
              <View key={ev.id || idx} style={[styles.timelineEvent, { borderLeftColor: '#2e615540' }]}>
                <Text variant="bodySmall" style={{ color: theme.colors.onSurface, lineHeight: 20 }}>
                  {ev.notes || ev.description || ev.text || ev.note || ''}
                </Text>
                <View style={[{ flexDirection: 'row', gap: 8, marginTop: 4 }]}>
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
              </View>
            ))
          )}
        </View>

        <View style={{ height: insets.bottom + 24 }} />
      </ScrollView>

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

      {/* Edit Modal */}
      <Portal>
        <Modal
          visible={editModalVisible}
          onDismiss={() => setEditModalVisible(false)}
          contentContainerStyle={[
            styles.modalContainer,
            { backgroundColor: theme.colors.surface },
          ]}
        >
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={[styles.modalHeader, { flexDirection }]}>
                <Text variant="titleLarge" style={{ color: theme.colors.onSurface, fontWeight: '700' }}>
                  {t('cases.editCase')}
                </Text>
                <IconButton icon="close" size={22} onPress={() => setEditModalVisible(false)} />
              </View>

              <TextInput
                label={t('cases.caseTitle')}
                value={formTitle}
                onChangeText={setFormTitle}
                mode="outlined"
                style={[styles.formInput, { textAlign }]}
                outlineColor={theme.colors.outline}
                activeOutlineColor={theme.colors.primary}
              />

              <TextInput
                label={t('cases.description')}
                value={formDescription}
                onChangeText={setFormDescription}
                mode="outlined"
                multiline
                numberOfLines={3}
                style={[styles.formInput, { textAlign }]}
                outlineColor={theme.colors.outline}
                activeOutlineColor={theme.colors.primary}
              />

              <Text variant="labelLarge" style={[styles.formLabel, { color: theme.colors.onSurface }]}>
                {t('cases.contact')}
              </Text>
              <Pressable
                onPress={() => setContactLookupVisible(true)}
                style={[
                  styles.contactLookupField,
                  {
                    backgroundColor: theme.colors.surfaceVariant,
                    borderColor: theme.colors.outline,
                    flexDirection,
                  },
                ]}
              >
                <View style={{ flex: 1 }}>
                  <Text
                    style={{
                      color: formContactName ? theme.colors.onSurface : theme.colors.onSurfaceVariant,
                      fontSize: 15,
                      textAlign,
                    }}
                    numberOfLines={1}
                  >
                    {formContactName
                      ? `${formContactName}${formContactPhone ? `  •  ${formContactPhone}` : ''}`
                      : t('common.selectContact')}
                  </Text>
                </View>
                <MaterialCommunityIcons
                  name="account-search"
                  size={20}
                  color={theme.colors.onSurfaceVariant}
                />
              </Pressable>

              <Text variant="labelLarge" style={[styles.formLabel, { color: theme.colors.onSurface }]}>
                {t('cases.status')}
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }}>
                <View style={[styles.chipsRow, { flexDirection }]}>
                  {STATUS_OPTIONS.map((s) => {
                    const sc = getStatusColor(s);
                    const active = formStatus.toLowerCase().replace(/\s+/g, '_') === s;
                    return (
                      <Chip
                        key={s}
                        selected={active}
                        onPress={() => setFormStatus(s)}
                        compact
                        style={[
                          styles.formChip,
                          active
                            ? { backgroundColor: `${sc}20`, borderColor: sc, borderWidth: 1.5 }
                            : { backgroundColor: theme.colors.surfaceVariant, borderWidth: 1.5, borderColor: 'transparent' },
                        ]}
                        textStyle={[
                          { fontSize: 12 },
                          active && { color: sc, fontWeight: '700' },
                        ]}
                      >
                        {s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ')}
                      </Chip>
                    );
                  })}
                </View>
              </ScrollView>

              <Text variant="labelLarge" style={[styles.formLabel, { color: theme.colors.onSurface }]}>
                {t('cases.priority')}
              </Text>
              <View style={[styles.chipsRow, { flexDirection, marginBottom: 14 }]}>
                {PRIORITIES.map((p) => {
                  const pc = PRIORITY_COLORS[p];
                  const active = formPriority === p;
                  return (
                    <Chip
                      key={p}
                      selected={active}
                      onPress={() => setFormPriority(p)}
                      compact
                      style={[
                        styles.formChip,
                        active
                          ? { backgroundColor: `${pc}20`, borderColor: pc, borderWidth: 1.5 }
                          : { backgroundColor: theme.colors.surfaceVariant, borderWidth: 1.5, borderColor: 'transparent' },
                      ]}
                      textStyle={[
                        { fontSize: 12 },
                        active && { color: pc, fontWeight: '700' },
                      ]}
                    >
                      {t(`tasks.${p}`)}
                    </Chip>
                  );
                })}
              </View>

              <TextInput
                label={t('cases.category')}
                value={formCategory}
                onChangeText={setFormCategory}
                mode="outlined"
                style={[styles.formInput, { textAlign }]}
                outlineColor={theme.colors.outline}
                activeOutlineColor={theme.colors.primary}
                right={<TextInput.Icon icon="tag" />}
              />

              <Text variant="labelLarge" style={[styles.formLabel, { color: theme.colors.onSurface }]}>
                {t('leads.source')}
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }}>
                <View style={[styles.chipsRow, { flexDirection }]}>
                  {CASE_SOURCES.map((src) => {
                    const active = formSource === src;
                    return (
                      <Chip
                        key={src}
                        selected={active}
                        onPress={() => setFormSource(active ? '' : src)}
                        compact
                        style={[
                          styles.formChip,
                          active
                            ? { backgroundColor: '#2196F320', borderColor: '#2196F3', borderWidth: 1.5 }
                            : { backgroundColor: theme.colors.surfaceVariant, borderWidth: 1.5, borderColor: 'transparent' },
                        ]}
                        textStyle={[
                          { fontSize: 12 },
                          active && { color: '#2196F3', fontWeight: '700' },
                        ]}
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
                style={[
                  styles.formInput,
                  {
                    borderWidth: 1,
                    borderRadius: 4,
                    borderColor: userPickerExpanded ? theme.colors.primary : theme.colors.outline,
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                    backgroundColor: theme.colors.surface,
                  },
                ]}
              >
                <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 2 }}>
                  {t('cases.assignedTo')}
                </Text>
                <View style={[{ flexDirection, alignItems: 'center', gap: 8 }]}>
                  <MaterialCommunityIcons name="account-check" size={16} color={theme.colors.onSurfaceVariant} />
                  <Text variant="bodyMedium" style={{ flex: 1, color: formAssignedTo ? theme.colors.onSurface : theme.colors.onSurfaceVariant, textAlign }}>
                    {orgUsersLoading ? t('common.loading') || 'טוען...' : (formAssignedTo || t('cases.selectAssignee') || 'בחר נציג')}
                  </Text>
                  <MaterialCommunityIcons name={userPickerExpanded ? 'chevron-up' : 'chevron-down'} size={18} color={theme.colors.onSurfaceVariant} />
                </View>
              </Pressable>
              {userPickerExpanded && (
                <View style={{ borderWidth: 1, borderColor: theme.colors.outline, borderRadius: 4, marginTop: -14, marginBottom: 14, overflow: 'hidden' }}>
                  <Pressable
                    style={[{ padding: 12, flexDirection, alignItems: 'center', gap: 8 }]}
                    onPress={() => { setFormAssignedTo(''); setFormAssignedToId(''); setUserPickerExpanded(false); }}
                  >
                    <MaterialCommunityIcons name="close" size={16} color={theme.colors.onSurfaceVariant} />
                    <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>{t('common.none') || 'ללא'}</Text>
                  </Pressable>
                  <Divider />
                  {orgUsers.map((u) => (
                    <Pressable
                      key={u.uID || u.userId}
                      style={[{ padding: 12, flexDirection, alignItems: 'center', gap: 8, backgroundColor: (u.uID || u.userId) === formAssignedToId ? `${theme.colors.primary}15` : 'transparent' }]}
                      onPress={() => { setFormAssignedTo(u.fullname || u.name || ''); setFormAssignedToId(u.uID || u.userId || ''); setUserPickerExpanded(false); }}
                    >
                      <MaterialCommunityIcons name="account" size={16} color={(u.uID || u.userId) === formAssignedToId ? theme.colors.primary : theme.colors.onSurfaceVariant} />
                      <Text variant="bodySmall" style={{ color: (u.uID || u.userId) === formAssignedToId ? theme.colors.primary : theme.colors.onSurface, fontWeight: (u.uID || u.userId) === formAssignedToId ? '700' : '400' }}>
                        {u.fullname || u.name}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )}

              <TextInput
                label={t('cases.dueDate', 'Due Date')}
                value={formDueDate}
                onChangeText={setFormDueDate}
                mode="outlined"
                placeholder="YYYY-MM-DD"
                style={[styles.formInput, { textAlign }]}
                outlineColor={theme.colors.outline}
                activeOutlineColor={theme.colors.primary}
                right={<TextInput.Icon icon="calendar-clock" />}
              />

              <TextInput
                label={t('contacts.tags', 'Tags')}
                value={formTags}
                onChangeText={setFormTags}
                mode="outlined"
                placeholder={t('cases.tagsHint', 'Comma-separated tags')}
                style={[styles.formInput, { textAlign }]}
                outlineColor={theme.colors.outline}
                activeOutlineColor={theme.colors.primary}
                right={<TextInput.Icon icon="tag-multiple" />}
              />

              <TextInput
                label={t('cases.notes', 'Notes')}
                value={formNotes}
                onChangeText={setFormNotes}
                mode="outlined"
                multiline
                numberOfLines={3}
                style={[styles.formInput, { textAlign }]}
                outlineColor={theme.colors.outline}
                activeOutlineColor={theme.colors.primary}
                right={<TextInput.Icon icon="note-text" />}
              />

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

              <View style={[styles.modalActions, { flexDirection }]}>
                <Button
                  mode="outlined"
                  onPress={() => setEditModalVisible(false)}
                  style={styles.modalButton}
                  textColor={theme.colors.onSurface}
                >
                  {t('common.cancel')}
                </Button>
                <Button
                  mode="contained"
                  onPress={handleSave}
                  loading={saving}
                  disabled={!formTitle.trim() || saving}
                  style={[styles.modalButton, { backgroundColor: theme.colors.primary }]}
                  textColor="#FFFFFF"
                >
                  {t('common.save')}
                </Button>
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
        </Modal>
      </Portal>

      <Portal>
        <Modal
          visible={noteModalVisible}
          onDismiss={() => setNoteModalVisible(false)}
          contentContainerStyle={[styles.modalContainer, { backgroundColor: theme.colors.surface }]}
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
            style={[styles.formInput, { textAlign }]}
            outlineColor={theme.colors.outline}
            activeOutlineColor={theme.colors.primary}
          />
          <View style={[styles.modalActions, { flexDirection }]}>
            <Button
              mode="outlined"
              onPress={() => { setNoteModalVisible(false); setNoteText(''); }}
              style={styles.modalButton}
              textColor={theme.colors.onSurface}
            >
              {t('common.cancel')}
            </Button>
            <Button
              mode="contained"
              onPress={handleAddNote}
              loading={addingNote}
              disabled={!noteText.trim() || addingNote}
              style={[styles.modalButton, { backgroundColor: theme.colors.primary }]}
              textColor="#FFFFFF"
            >
              {t('common.save')}
            </Button>
          </View>
        </Modal>
      </Portal>
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
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    padding: 16,
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
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    padding: 16,
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
    borderLeftWidth: 2,
    paddingLeft: 12,
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
    marginHorizontal: 20,
    borderRadius: borderRadius.xl,
    maxHeight: '85%',
    padding: 20,
  },
  modalHeader: {
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  formInput: {
    marginBottom: 14,
  },
  contactLookupField: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 14,
    alignItems: 'center',
    gap: 8,
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
  },
  modalActions: {
    gap: 12,
    justifyContent: 'flex-end',
    marginTop: 8,
  },
  modalButton: {
    minWidth: 100,
    borderRadius: borderRadius.md,
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
