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
  Animated,
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
import { useContactStore } from '../../../stores/contactStore';
import { useAuthStore } from '../../../stores/authStore';
import { contactsApi } from '../../../services/api/contacts';
import { quotesApi } from '../../../services/api/quotes';
import { makeAppCall } from '../../../utils/phoneCall';
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
import type { Contact, TimelineEvent } from '../../../types';

type DetailTab = 'timeline' | 'related';

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
  const updateContact = useContactStore((s) => s.updateContact);
  const deleteContact = useContactStore((s) => s.deleteContact);
  const setSelectedContact = useContactStore((s) => s.setSelectedContact);

  const isNew = id === 'new';
  const contact = useMemo(
    () => (isNew ? null : contacts.find((c) => c.id === id) ?? null),
    [contacts, id, isNew],
  );

  const [activeTab, setActiveTab] = useState<DetailTab>('timeline');
  const [editVisible, setEditVisible] = useState(isNew);
  const [menuVisible, setMenuVisible] = useState(false);
  const [form, setForm] = useState<Partial<Contact>>(
    contact ? { ...contact } : { ...EMPTY_CONTACT },
  );
  const [saving, setSaving] = useState(false);
  const [contactFormSections, setContactFormSections] = useState<DynamicSection[]>([]);
  const [contactFormLayout, setContactFormLayout] = useState<string[]>([]);
  const [noteModalVisible, setNoteModalVisible] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [addingNote, setAddingNote] = useState(false);
  const [formTags, setFormTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [timelineEvents, setTimelineEvents] = useState<any[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [relatedRecords, setRelatedRecords] = useState<any>({ tables: [], leads: [], quotes: [], tasks: [] });
  const [relatedLoading, setRelatedLoading] = useState(false);
  const tabIndicator = useRef(new Animated.Value(0)).current;

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
      const all = [...(Array.isArray(timeline) ? timeline : []), ...(Array.isArray(chatTimeline) ? chatTimeline : [])];
      const unique = all.reduce((acc: any[], ev: any) => {
        const id = ev.TimelineId || ev.timelineId || ev.id;
        if (id && !acc.find((e) => (e.TimelineId || e.timelineId || e.id) === id)) acc.push(ev);
        return acc;
      }, []);
      unique.sort((a: any, b: any) => {
        const dateA = new Date(a.createdOn || a.CreatedOn || 0).getTime();
        const dateB = new Date(b.createdOn || b.CreatedOn || 0).getTime();
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
    if (!organization || !contact || !noteText.trim()) return;
    setAddingNote(true);
    try {
      await contactsApi.addTimelineEntry(
        organization,
        contact.phoneNumber || contact.id,
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
  }, [organization, contact, noteText, user, t, fetchTimeline]);

  useEffect(() => {
    if (organization) {
      contactsApi.getDynamicContactColumns(organization).then((res) => {
        setContactFormSections(res.sections || []);
        setContactFormLayout(res.formLayout || []);
      }).catch(() => {});
    }
  }, [organization]);

  const switchTab = useCallback(
    (tab: DetailTab) => {
      setActiveTab(tab);
      Animated.spring(tabIndicator, {
        toValue: tab === 'timeline' ? 0 : 1,
        useNativeDriver: true,
        friction: 8,
      }).start();
    },
    [tabIndicator],
  );

  const contactName = useMemo(
    () => contact?.name || contact?.phoneNumber || '',
    [contact],
  );

  const tags = useMemo(() => extractTags(contact?.keys), [contact]);

  const handleCall = useCallback(() => {
    if (contact?.phoneNumber) {
      makeAppCall({
        phoneNumber: contact.phoneNumber,
        organization,
        callerUserId: user?.uID || user?.userId,
        callerUserName: user?.fullname,
        relatedTo: { type: 'contact', entityId: contact.id, entityName: contact.name },
        contactName: contact.name,
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
          if (organization && contact) {
            await deleteContact(organization, contact.id);
            router.back();
          }
        },
      },
    ]);
  }, [organization, contact, contactName, deleteContact, t, router]);

  const createContact = useContactStore((s) => s.createContact);

  const handleSave = useCallback(async () => {
    if (!organization) return;
    setSaving(true);
    try {
      const formData = { ...form, keys: formTags.length > 0 ? formTags.join('#') : '' };
      if (isNew) {
        await createContact(organization, { ...formData, id: form.phoneNumber || '' });
        router.back();
      } else {
        await updateContact(organization, { ...formData, id: contact?.id ?? '' });
        setEditVisible(false);
      }
    } catch {
      Alert.alert(t('common.error'));
    } finally {
      setSaving(false);
    }
  }, [organization, form, formTags, contact, isNew, createContact, updateContact, t, router]);

  const updateField = useCallback(
    (field: keyof Contact, value: string) => {
      setForm((prev) => ({ ...prev, [field]: value }));
    },
    [],
  );

  if (!contact && !isNew) {
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
              label={t('phoneCalls.addNote')}
              color="#9C27B0"
              bg="#F3E5F5"
              onPress={() => setNoteModalVisible(true)}
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
              <Pressable
                style={styles.tab}
                onPress={() => switchTab('timeline')}
              >
                <Text
                  variant="titleSmall"
                  style={{
                    color: activeTab === 'timeline' ? theme.colors.primary : theme.colors.onSurfaceVariant,
                    fontWeight: activeTab === 'timeline' ? '700' : '500',
                  }}
                >
                  {t('contacts.timeline')}
                </Text>
              </Pressable>
              <Pressable
                style={styles.tab}
                onPress={() => switchTab('related')}
              >
                <Text
                  variant="titleSmall"
                  style={{
                    color: activeTab === 'related' ? theme.colors.primary : theme.colors.onSurfaceVariant,
                    fontWeight: activeTab === 'related' ? '700' : '500',
                  }}
                >
                  {t('contacts.relatedRecords')}
                </Text>
              </Pressable>
              <Animated.View
                style={[
                  styles.tabIndicator,
                  {
                    backgroundColor: theme.colors.primary,
                    transform: [
                      {
                        translateX: tabIndicator.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0, 160],
                        }),
                      },
                    ],
                  },
                ]}
              />
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
              />
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
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={[styles.modalContainer, { backgroundColor: theme.colors.background }]}
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
              <FormField
                label={t('contacts.phone')}
                value={form.phoneNumber ?? ''}
                onChangeText={(v) => updateField('phoneNumber', v)}
                theme={theme}
                textAlign={textAlign}
                writingDirection={writingDirection}
                keyboardType="phone-pad"
              />
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
              <FormField
                label={t('contacts.owner')}
                value={(form as any).ownerName ?? ''}
                onChangeText={(v) => setForm((prev) => ({ ...prev, ownerName: v }))}
                theme={theme}
                textAlign={textAlign}
                writingDirection={writingDirection}
              />
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
                    onSubmitEditing={() => {
                      const trimmed = tagInput.trim();
                      if (trimmed && !formTags.includes(trimmed)) {
                        setFormTags((prev) => [...prev, trimmed]);
                        setTagInput('');
                      }
                    }}
                    returnKeyType="done"
                  />
                  <Pressable
                    onPress={() => {
                      const trimmed = tagInput.trim();
                      if (trimmed && !formTags.includes(trimmed)) {
                        setFormTags((prev) => [...prev, trimmed]);
                        setTagInput('');
                      }
                    }}
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
          <Pressable
            style={styles.noteOverlay}
            onPress={() => setNoteModalVisible(false)}
          >
            <Pressable
              onPress={(e) => e.stopPropagation()}
              style={[styles.noteSheet, { backgroundColor: theme.colors.surface, paddingBottom: insets.bottom + 16 }]}
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
              <View style={[styles.noteActions, { flexDirection }]}>
                <Button
                  mode="outlined"
                  onPress={() => { setNoteModalVisible(false); setNoteText(''); }}
                  style={{ minWidth: 100, borderRadius: 10 }}
                  textColor={theme.colors.onSurface}
                >
                  {t('common.cancel')}
                </Button>
                <Button
                  mode="contained"
                  onPress={handleAddNote}
                  loading={addingNote}
                  disabled={!noteText.trim() || addingNote}
                  style={{ minWidth: 100, borderRadius: 10, backgroundColor: theme.colors.primary }}
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
      <Text variant="labelSmall" style={{ color, marginTop: 4, fontWeight: '500' }} numberOfLines={1}>
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

function TimelineSection({
  events,
  loading,
  theme,
  t,
  lang,
  isRTL,
  flexDirection,
}: {
  events: any[];
  loading: boolean;
  theme: any;
  t: any;
  lang: 'en' | 'he';
  isRTL: boolean;
  flexDirection: 'row' | 'row-reverse';
}) {
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

  return (
    <View style={styles.sectionContent}>
      {events.map((event, idx) => {
        const id = event.TimelineId || event.timelineId || event.id || String(idx);
        const type = (event.TimelineType || event.timelineType || 'note').toLowerCase();
        const config = TIMELINE_TYPE_CONFIG[type] || { icon: 'circle-small', color: theme.colors.primary };
        const note = event.note || event.Note || '';
        const createdBy = event.createdByName || event.CreatedByName || '';
        const createdOn = event.createdOn || event.CreatedOn || '';

        return (
          <View key={id} style={[styles.timelineItem, { flexDirection }]}>
            <View style={[styles.timelineDot, { backgroundColor: config.color }]}>
              <MaterialCommunityIcons name={config.icon as any} size={12} color="#FFF" />
            </View>
            <View style={[styles.timelineBody, { alignItems: isRTL ? 'flex-end' : 'flex-start' }]}>
              <Text variant="labelSmall" style={{ color: config.color, fontWeight: '600', textTransform: 'capitalize', textAlign: isRTL ? 'right' : 'left' }}>
                {type.replace(/_/g, ' ')}
              </Text>
              {note ? (
                <Text variant="bodySmall" style={{ color: theme.colors.onSurface, marginTop: 2, textAlign: isRTL ? 'right' : 'left', width: '100%' }}>
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
            </View>
          </View>
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
              {t('tabs.quotes')} ({data.quotes.length})
            </Text>
          </View>
          {data.quotes.map((quote: any) => (
            <Pressable
              key={quote.id}
              onPress={() => router.push({ pathname: '/(tabs)/more/quotes/[id]', params: { id: quote.id } })}
              style={[styles.relatedCard, { backgroundColor: theme.colors.surfaceVariant, flexDirection }]}
            >
              <View style={{ flex: 1 }}>
                <Text variant="bodyMedium" style={{ color: theme.colors.onSurface, fontWeight: '600' }}>
                  {quote.title || quote.quoteNumber || quote.id}
                </Text>
                {(quote.status || quote.total) ? (
                  <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: 2 }}>
                    {[quote.status, quote.total != null ? `${quote.total} ${quote.currency || ''}` : ''].filter(Boolean).join(' · ')}
                  </Text>
                ) : null}
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
              onPress={() => router.push({ pathname: '/(tabs)/leads/[id]', params: { id: lead.id } })}
              style={[styles.relatedCard, { backgroundColor: theme.colors.surfaceVariant, flexDirection }]}
            >
              <View style={{ flex: 1 }}>
                <Text variant="bodyMedium" style={{ color: theme.colors.onSurface, fontWeight: '600' }}>
                  {lead.title || lead.leadTitle || ''}
                </Text>
                {lead.stageName || lead.stage ? (
                  <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: 2 }}>
                    {lead.stageName || lead.stage}
                  </Text>
                ) : null}
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

      {data.tables.map((table: any) => (
        <View key={table.tableId || table.tableName} style={{ marginBottom: 16 }}>
          <View style={[styles.relatedHeader, { flexDirection }]}>
            <MaterialCommunityIcons name="table" size={18} color="#6366f1" />
            <Text variant="titleSmall" style={{ color: theme.colors.onSurface, fontWeight: '700' }}>
              {table.tableName} ({table.recordCount || table.records?.length || 0})
            </Text>
          </View>
          {(table.records || []).map((record: any) => (
            <View
              key={record.id}
              style={[styles.relatedCard, { backgroundColor: theme.colors.surfaceVariant, flexDirection }]}
            >
              <View style={{ flex: 1 }}>
                <Text variant="bodyMedium" style={{ color: theme.colors.onSurface, fontWeight: '500' }}>
                  {record.recordName || record.name || record.id}
                </Text>
                {record.createdOn ? (
                  <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: 2 }}>
                    {formatDate(record.createdOn)}
                  </Text>
                ) : null}
              </View>
            </View>
          ))}
        </View>
      ))}
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
  tabIndicator: {
    position: 'absolute',
    bottom: 0,
    height: 3,
    width: 120,
    borderTopLeftRadius: 2,
    borderTopRightRadius: 2,
    left: 20,
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
