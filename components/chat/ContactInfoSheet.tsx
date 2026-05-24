import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  Pressable,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { Text, Chip, Divider, Menu, Portal, Modal } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useRTL } from '../../hooks/useRTL';
import axiosInstance from '../../services/api/axiosInstance';
import { ENDPOINTS } from '../../constants/api';

interface Props {
  visible: boolean;
  onDismiss: () => void;
  organization: string;
  phoneNumber: string;
  userId?: string;
  contactData?: any;
  onUpdate?: () => void;
}

const STATUS_OPTIONS = ['Open', 'Closed', 'Pending', 'In Progress', 'Resolved'];

export function ContactInfoSheet({ visible, onDismiss, organization, phoneNumber, userId, contactData, onUpdate }: Props) {
  const { t } = useTranslation();
  const theme = useAppTheme();
  const { isRTL } = useRTL();

  const [loading, setLoading] = useState(false);
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState('');
  const [timeline, setTimeline] = useState<any[]>([]);
  const [contactLeads, setContactLeads] = useState<any[]>([]);
  const [contactCases, setContactCases] = useState<any[]>([]);
  const [pipelineStages, setPipelineStages] = useState<any[]>([]);
  const [caseStages, setCaseStages] = useState<any[]>([]);
  const [categoryMenuVisible, setCategoryMenuVisible] = useState(false);
  const [statusMenuVisible, setStatusMenuVisible] = useState(false);
  const [stageMenuVisible, setStageMenuVisible] = useState<string | null>(null);
  const [caseStageMenuVisible, setCaseStageMenuVisible] = useState<string | null>(null);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [showAddCategory, setShowAddCategory] = useState(false);

  const flexDirection = isRTL ? 'row-reverse' as const : 'row' as const;
  const textAlign = isRTL ? 'right' as const : 'left' as const;

  const loadData = useCallback(async () => {
    if (!organization || !phoneNumber) return;
    setLoading(true);
    try {
      const [catRes, timelineRes, leadsRes, stagesRes, casesRes, caseSettingsRes] = await Promise.allSettled([
        axiosInstance.post(ENDPOINTS.GET_CONVERSATION_CATEGORIES, { organization }),
        axiosInstance.post(ENDPOINTS.GET_CHAT_TIMELINE, { organizationiD: organization, phoneNumber }),
        axiosInstance.post(ENDPOINTS.GET_LEADS_BY_CONTACT, { organization, phoneNumber }),
        axiosInstance.post(ENDPOINTS.GET_PIPELINE_SETTINGS, { organization }),
        axiosInstance.post(ENDPOINTS.GET_CASES_BY_CONTACT, { organization, phoneNumber }),
        axiosInstance.post(ENDPOINTS.GET_CASE_SETTINGS, { organization }),
      ]);

      if (catRes.status === 'fulfilled') {
        const raw = catRes.value.data;
        const cats = Array.isArray(raw) ? raw : raw?.Data || raw?.data || [];
        setCategories(cats.map((c: any) => typeof c === 'string' ? c : c.label || c.name || '').filter(Boolean));
      }
      if (timelineRes.status === 'fulfilled') {
        const raw = timelineRes.value.data;
        const arr = Array.isArray(raw) ? raw : raw?.Data || raw?.data || [];
        arr.sort((a: any, b: any) => {
          const dateA = new Date(a.CreateDateTimeUTC || a.createdOn || a.CreatedOn || a.timestamp || a.createdAt || a.date || 0).getTime();
          const dateB = new Date(b.CreateDateTimeUTC || b.createdOn || b.CreatedOn || b.timestamp || b.createdAt || b.date || 0).getTime();
          return dateB - dateA;
        });
        setTimeline(arr);
      }
      if (leadsRes.status === 'fulfilled') {
        const raw = leadsRes.value.data;
        setContactLeads(Array.isArray(raw) ? raw : raw?.Data || raw?.data || []);
      }
      if (stagesRes.status === 'fulfilled') {
        const raw = stagesRes.value.data;
        const stages = raw?.stages || raw?.Data?.stages || raw?.Stages || [];
        setPipelineStages(Array.isArray(stages) ? stages : []);
      }
      if (casesRes.status === 'fulfilled') {
        const raw = casesRes.value.data;
        setContactCases(Array.isArray(raw) ? raw : raw?.Data || raw?.data || []);
      }
      if (caseSettingsRes.status === 'fulfilled') {
        const raw = caseSettingsRes.value.data;
        const stages = raw?.stages || raw?.Data?.stages || raw?.Stages || [];
        setCaseStages(Array.isArray(stages) ? stages : []);
      }
    } catch {}
    setLoading(false);
  }, [organization, phoneNumber]);

  useEffect(() => {
    if (visible) {
      loadData();
      if (contactData) {
        setSelectedCategory(contactData.lastConversationCategory || contactData.category || '');
        setSelectedStatus(contactData.lastConversationStatus || contactData.status || '');
        const contactTags = contactData.tags || contactData.searchKeys || contactData.keys || [];
        setTags(Array.isArray(contactTags) ? contactTags : []);
      }
    }
  }, [visible, loadData, contactData]);

  const handleCategoryChange = async (value: string) => {
    setCategoryMenuVisible(false);
    setSelectedCategory(value);
    try {
      await axiosInstance.post(ENDPOINTS.UPDATE_CONVERSATION_CATEGORY, {
        organization, phoneNumber, category: value, modifiedById: userId || '',
      });
      onUpdate?.();
    } catch {}
  };

  const handleAddCategory = async () => {
    if (!newCategoryName.trim()) return;
    try {
      await axiosInstance.post(ENDPOINTS.ADD_CONVERSATION_CATEGORY, {
        organization, label: newCategoryName.trim(), createdBy: userId,
      });
      setCategories(prev => [...prev, newCategoryName.trim()]);
      await handleCategoryChange(newCategoryName.trim());
      setNewCategoryName('');
      setShowAddCategory(false);
    } catch {}
  };

  const handleStatusChange = async (value: string) => {
    setStatusMenuVisible(false);
    setSelectedStatus(value);
    try {
      await axiosInstance.post(ENDPOINTS.UPDATE_CONVERSATION_STATUS, {
        organization, phoneNumber, status: value, modifiedById: userId || '',
      });
      onUpdate?.();
    } catch {}
  };

  const handleAddTag = async () => {
    if (!newTag.trim() || tags.includes(newTag.trim())) return;
    const updated = [...tags, newTag.trim()];
    setTags(updated);
    setNewTag('');
    try {
      await axiosInstance.post(ENDPOINTS.UPDATE_CONTACT_KEYS, {
        organization, contactID: phoneNumber, keys: updated,
      });
      onUpdate?.();
    } catch {}
  };

  const handleRemoveTag = async (tag: string) => {
    const updated = tags.filter(t => t !== tag);
    setTags(updated);
    try {
      await axiosInstance.post(ENDPOINTS.UPDATE_CONTACT_KEYS, {
        organization, contactID: phoneNumber, keys: updated,
      });
      onUpdate?.();
    } catch {}
  };

  const handleMoveLeadStage = async (leadId: string, newStageId: string, newStageName: string) => {
    setStageMenuVisible(null);
    setContactLeads(prev => prev.map(l => l.id === leadId ? { ...l, stageId: newStageId, stageName: newStageName } : l));
    try {
      await axiosInstance.post(ENDPOINTS.MOVE_LEAD_STAGE, {
        organization, leadId, stageId: newStageId, stageName: newStageName,
      });
      onUpdate?.();
    } catch {}
  };

  const handleMoveCaseStage = async (caseId: string, newStageId: string, newStageName: string) => {
    setCaseStageMenuVisible(null);
    setContactCases(prev => prev.map(c => c.id === caseId ? { ...c, stageId: newStageId, stageName: newStageName } : c));
    try {
      await axiosInstance.post(ENDPOINTS.UPDATE_CASE, {
        organization, caseId, stageId: newStageId, stageName: newStageName,
      });
      onUpdate?.();
    } catch {}
  };

  if (!visible) return null;

  return (
    <Portal>
      <Modal
        visible={visible}
        onDismiss={onDismiss}
        contentContainerStyle={[styles.container, { backgroundColor: theme.colors.surface }]}
      >
        <View style={[styles.header, { flexDirection }]}>
          <Text variant="titleMedium" style={{ fontWeight: '700', color: theme.colors.onSurface, flex: 1, textAlign }}>
            {t('chats.contactInfo', 'פרטי שיחה')}
          </Text>
          <Pressable onPress={onDismiss}>
            <MaterialCommunityIcons name="close" size={22} color={theme.colors.onSurfaceVariant} />
          </Pressable>
        </View>

        {loading ? (
          <ActivityIndicator style={{ marginVertical: 30 }} />
        ) : (
          <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
            {/* Category */}
            <View style={styles.section}>
              <Text variant="labelLarge" style={[styles.sectionLabel, { color: theme.colors.onSurfaceVariant, textAlign }]}>
                {t('chats.category', 'קטגוריה')}
              </Text>
              <Menu
                visible={categoryMenuVisible}
                onDismiss={() => setCategoryMenuVisible(false)}
                anchor={
                  <Pressable onPress={() => setCategoryMenuVisible(true)} style={[styles.selector, { borderColor: theme.colors.outline, flexDirection }]}>
                    <Text style={{ color: selectedCategory ? theme.colors.onSurface : theme.colors.onSurfaceVariant, flex: 1, textAlign }}>
                      {selectedCategory || t('chats.selectCategory', 'בחר קטגוריה...')}
                    </Text>
                    <MaterialCommunityIcons name="chevron-down" size={18} color={theme.colors.onSurfaceVariant} />
                  </Pressable>
                }
              >
                <Menu.Item title={t('common.none', 'ללא')} onPress={() => handleCategoryChange('')} />
                {categories.map(cat => (
                  <Menu.Item key={cat} title={cat} onPress={() => handleCategoryChange(cat)} leadingIcon={selectedCategory === cat ? 'check' : undefined} />
                ))}
                <Divider />
                <Menu.Item title={t('chats.addCategory', '+ הוסף קטגוריה')} onPress={() => { setCategoryMenuVisible(false); setShowAddCategory(true); }} leadingIcon="plus" />
              </Menu>
              {showAddCategory && (
                <View style={[styles.addRow, { flexDirection }]}>
                  <TextInput
                    style={[styles.addInput, { borderColor: theme.colors.outline, color: theme.colors.onSurface, textAlign }]}
                    placeholder={t('chats.newCategoryName', 'שם קטגוריה')}
                    placeholderTextColor={theme.colors.onSurfaceVariant}
                    value={newCategoryName}
                    onChangeText={setNewCategoryName}
                    onSubmitEditing={handleAddCategory}
                  />
                  <Pressable onPress={handleAddCategory} style={[styles.addBtn, { backgroundColor: theme.colors.primary }]}>
                    <MaterialCommunityIcons name="check" size={18} color="white" />
                  </Pressable>
                </View>
              )}
            </View>

            {/* Status */}
            <View style={styles.section}>
              <Text variant="labelLarge" style={[styles.sectionLabel, { color: theme.colors.onSurfaceVariant, textAlign }]}>
                {t('chats.status', 'סטטוס')}
              </Text>
              <Menu
                visible={statusMenuVisible}
                onDismiss={() => setStatusMenuVisible(false)}
                anchor={
                  <Pressable onPress={() => setStatusMenuVisible(true)} style={[styles.selector, { borderColor: theme.colors.outline, flexDirection }]}>
                    <Text style={{ color: selectedStatus ? theme.colors.onSurface : theme.colors.onSurfaceVariant, flex: 1, textAlign }}>
                      {selectedStatus || t('chats.selectStatus', 'בחר סטטוס...')}
                    </Text>
                    <MaterialCommunityIcons name="chevron-down" size={18} color={theme.colors.onSurfaceVariant} />
                  </Pressable>
                }
              >
                {STATUS_OPTIONS.map(s => (
                  <Menu.Item key={s} title={s} onPress={() => handleStatusChange(s)} leadingIcon={selectedStatus === s ? 'check' : undefined} />
                ))}
              </Menu>
            </View>

            {/* Lead Stages */}
            {contactLeads.length > 0 && (
              <View style={styles.section}>
                <Text variant="labelLarge" style={[styles.sectionLabel, { color: theme.colors.onSurfaceVariant, textAlign }]}>
                  {t('chats.leadStage', 'שלב ליד')}
                </Text>
                {contactLeads.map(lead => (
                  <View key={lead.id} style={[styles.leadRow, { flexDirection }]}>
                    <View style={{ flex: 1 }}>
                      <Text variant="bodyMedium" style={{ color: theme.colors.onSurface, fontWeight: '600', textAlign }}>
                        {lead.title || lead.name || lead.contactName || phoneNumber}
                      </Text>
                    </View>
                    <Menu
                      visible={stageMenuVisible === lead.id}
                      onDismiss={() => setStageMenuVisible(null)}
                      anchor={
                        <Chip
                          compact
                          onPress={() => setStageMenuVisible(lead.id)}
                          style={{ backgroundColor: theme.colors.primaryContainer }}
                          textStyle={{ color: theme.colors.primary, fontWeight: '600', fontSize: 12 }}
                        >
                          {lead.stageName || lead.stage || '—'}  ▾
                        </Chip>
                      }
                    >
                      {pipelineStages.map((stage: any) => (
                        <Menu.Item
                          key={stage.id || stage.Id}
                          title={stage.name || stage.Name || stage.stageName}
                          onPress={() => handleMoveLeadStage(lead.id, stage.id || stage.Id, stage.name || stage.Name || stage.stageName)}
                          leadingIcon={(lead.stageId === (stage.id || stage.Id)) ? 'check' : undefined}
                        />
                      ))}
                    </Menu>
                  </View>
                ))}
              </View>
            )}

            {/* Case Stages */}
            {contactCases.length > 0 && (
              <View style={styles.section}>
                <Text variant="labelLarge" style={[styles.sectionLabel, { color: theme.colors.onSurfaceVariant, textAlign }]}>
                  {t('chats.caseStage', 'שלב פנייה')}
                </Text>
                {contactCases.map(caseItem => (
                  <View key={caseItem.id} style={[styles.leadRow, { flexDirection }]}>
                    <View style={{ flex: 1 }}>
                      <Text variant="bodyMedium" style={{ color: theme.colors.onSurface, fontWeight: '600', textAlign }}>
                        {caseItem.title || caseItem.subject || caseItem.name || `#${caseItem.id?.slice(-4)}`}
                      </Text>
                    </View>
                    <Menu
                      visible={caseStageMenuVisible === caseItem.id}
                      onDismiss={() => setCaseStageMenuVisible(null)}
                      anchor={
                        <Chip
                          compact
                          onPress={() => setCaseStageMenuVisible(caseItem.id)}
                          style={{ backgroundColor: theme.colors.tertiaryContainer || '#e8f5e9' }}
                          textStyle={{ color: theme.colors.tertiary || '#2e7d32', fontWeight: '600', fontSize: 12 }}
                        >
                          {caseItem.stageName || caseItem.stage || '—'}  ▾
                        </Chip>
                      }
                    >
                      {caseStages.map((stage: any) => (
                        <Menu.Item
                          key={stage.id || stage.Id}
                          title={stage.name || stage.Name || stage.stageName}
                          onPress={() => handleMoveCaseStage(caseItem.id, stage.id || stage.Id, stage.name || stage.Name || stage.stageName)}
                          leadingIcon={(caseItem.stageId === (stage.id || stage.Id)) ? 'check' : undefined}
                        />
                      ))}
                    </Menu>
                  </View>
                ))}
              </View>
            )}

            {/* Tags */}
            <View style={styles.section}>
              <Text variant="labelLarge" style={[styles.sectionLabel, { color: theme.colors.onSurfaceVariant, textAlign }]}>
                {t('chats.tags', 'תיוגים')}
              </Text>
              <View style={[styles.tagsWrap, { flexDirection: 'row', flexWrap: 'wrap' }]}>
                {tags.map(tag => (
                  <Chip
                    key={tag}
                    compact
                    onClose={() => handleRemoveTag(tag)}
                    style={{ margin: 2, backgroundColor: theme.colors.secondaryContainer }}
                    textStyle={{ fontSize: 12 }}
                  >
                    {tag}
                  </Chip>
                ))}
              </View>
              <View style={[styles.addRow, { flexDirection }]}>
                <TextInput
                  style={[styles.addInput, { borderColor: theme.colors.outline, color: theme.colors.onSurface, textAlign }]}
                  placeholder={t('chats.addTag', 'הוסף תיוג...')}
                  placeholderTextColor={theme.colors.onSurfaceVariant}
                  value={newTag}
                  onChangeText={setNewTag}
                  onSubmitEditing={handleAddTag}
                />
                <Pressable onPress={handleAddTag} style={[styles.addBtn, { backgroundColor: theme.colors.primary }]}>
                  <MaterialCommunityIcons name="plus" size={18} color="white" />
                </Pressable>
              </View>
            </View>

            {/* Timeline */}
            {timeline.length > 0 && (
              <View style={styles.section}>
                <Text variant="labelLarge" style={[styles.sectionLabel, { color: theme.colors.onSurfaceVariant, textAlign }]}>
                  {t('chats.timeline', 'ציר זמן')}
                </Text>
                {timeline.slice(0, 20).map((entry, idx) => {
                  const ts = entry.timestamp || entry.createdOn || entry.date || '';
                  const dateStr = ts ? new Date(ts).toLocaleDateString() : '';
                  const timeStr = ts ? new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
                  const action = entry.action || entry.type || entry.eventType || '';
                  const desc = entry.description || entry.text || entry.details || entry.note || '';
                  const by = entry.createdByName || entry.userName || entry.by || '';

                  return (
                    <View key={entry.id || idx} style={[styles.timelineItem, { flexDirection }]}>
                      <View style={[styles.timelineDot, { backgroundColor: theme.colors.primary }]} />
                      <View style={{ flex: 1, marginHorizontal: 8 }}>
                        <Text variant="bodySmall" style={{ color: theme.colors.onSurface, fontWeight: '600', textAlign }}>
                          {action}{by ? ` — ${by}` : ''}
                        </Text>
                        {desc ? <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, textAlign }}>{desc}</Text> : null}
                      </View>
                      <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                        {dateStr}{'\n'}{timeStr}
                      </Text>
                    </View>
                  );
                })}
              </View>
            )}
          </ScrollView>
        )}
      </Modal>
    </Portal>
  );
}

const styles = StyleSheet.create({
  container: {
    margin: 16,
    borderRadius: 16,
    maxHeight: '85%',
    overflow: 'hidden',
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    alignItems: 'center',
  },
  body: { paddingHorizontal: 16, paddingBottom: 16 },
  section: { marginBottom: 18 },
  sectionLabel: { fontWeight: '700', marginBottom: 8 },
  selector: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignItems: 'center',
  },
  addRow: { marginTop: 8, alignItems: 'center', gap: 8 },
  addInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
  },
  addBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  leadRow: {
    alignItems: 'center',
    paddingVertical: 8,
    gap: 8,
  },
  tagsWrap: { marginBottom: 4 },
  timelineItem: {
    alignItems: 'flex-start',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e2e8f0',
  },
  timelineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 5,
  },
});
