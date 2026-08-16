import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  Pressable,
  ScrollView,
  TextInput,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTranslation } from 'react-i18next';
import { useRTL } from '../../hooks/useRTL';
import { useAuthStore } from '../../stores/authStore';
import { contactsApi, chatsApi, usersApi } from '../../services/api';
import { ENDPOINTS } from '../../constants/api';
import axiosInstance from '../../services/api/axiosInstance';
import type { Message, Template } from '../../types';

type Recipient = {
  phoneNumber: string;
  name: string;
  ownerName: string;
  email: string;
  firstName: string;
  fromNumberId?: string;
};

// Derive the forwardable content (text + media kind) from a chat message.
function getForwardContent(msg: Message | null) {
  const m: any = msg || {};
  const text = m.text || m.body || m.caption || '';
  const mediaUrl = m.mediaUrl || m.MediaUrl || m.media_url || m.gmbt_mediaUrl || '';
  const rawType = String(m.type || m.mediaType || '').toLowerCase();
  const messageType = String(m.messageType || '').toLowerCase();
  let kind: 'text' | 'image' | 'video' | 'audio' | 'document' = 'text';
  if (mediaUrl && (messageType === 'media' || rawType)) {
    if (rawType.startsWith('image') || rawType === 'sticker' || rawType.includes('webp')) kind = 'image';
    else if (rawType.startsWith('video')) kind = 'video';
    else if (rawType.startsWith('audio')) kind = 'audio';
    else if (rawType.startsWith('application') || rawType === 'document') kind = 'document';
    else kind = 'document';
  }
  return { text, mediaUrl, kind, fileName: m.fileName || '' };
}

function tplHeaderFormat(tpl: Template): string {
  const h = (tpl.components || []).find((c: any) => String(c.type || '').toUpperCase() === 'HEADER');
  return h ? String(h.format || 'TEXT').toUpperCase() : 'NONE';
}

function templateBodyVarCount(tpl: Template): number {
  const body = (tpl.components || []).find((c: any) => String(c.type || '').toUpperCase() === 'BODY');
  const text = body?.text || '';
  const matches = text.match(/\{\{(\d+)\}\}/g);
  if (!matches) return 0;
  return new Set(matches.map((x: string) => parseInt(x.replace(/\{\{|\}\}/g, ''), 10))).size;
}

function resolveEntityField(entity: string, field: string, r: Recipient, user: any): string {
  const f = (field || '').trim();
  switch ((entity || '').toLowerCase()) {
    case 'contact':
      if (f === 'name' || f === 'fullName' || f === '') return r.name;
      if (f === 'firstName') return r.firstName;
      if (f === 'phone' || f === 'phoneNumber') return r.phoneNumber;
      if (f === 'email') return r.email;
      return '';
    case 'user':
      return r.ownerName;
    case 'org':
      return user?.organization || '';
    default:
      return '';
  }
}

function buildVarEntry(index: number, value: string) {
  return {
    index,
    bodyVarIndex: index,
    Variable: `dynamic_var${index}`,
    variableLabel: `{{${index}}}`,
    dataSource1: 'data_source1_HardCoded',
    dataSource2: '',
    conditionOperator: '',
    parameters_hardCoded_Text: value || '-',
    field1: [],
    field2: [],
    table1: '',
    table2: '',
    retrieveFields: [],
  };
}

interface Props {
  visible: boolean;
  sourceMessage: Message | null;
  onClose: () => void;
}

export default function ForwardMessageSheet({ visible, sourceMessage, onClose }: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { isRTL } = useRTL();
  const user = useAuthStore((s) => s.user);
  const org = user?.organization || '';
  const myId = user?.uID || user?.userId || '';
  const myName = user?.fullname || user?.name || '';

  const content = useMemo(() => getForwardContent(sourceMessage), [sourceMessage]);

  const [search, setSearch] = useState('');
  const [contacts, setContacts] = useState<any[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [selectedMap, setSelectedMap] = useState<Record<string, Recipient>>({});

  const [views, setViews] = useState<any[]>([]);
  const [orgUsersById, setOrgUsersById] = useState<Record<string, string>>({});
  const [activeViewId, setActiveViewId] = useState('__all__');
  const [viewOrder, setViewOrder] = useState<string[]>([]);
  const [hiddenViewIds, setHiddenViewIds] = useState<string[]>([]);

  const [mode, setMode] = useState<'regular' | 'template'>('regular');
  const [checking, setChecking] = useState(false);
  const [windowStatus, setWindowStatus] = useState<Record<string, boolean>>({});

  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);

  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState<{ sent: number; failed: number; total: number } | null>(null);
  const [done, setDone] = useState(false);

  const mediaFileRef = useRef<{ uri: string; name: string; type: string } | null>(null);
  const searchDebounceRef = useRef<any>(null);

  // Reset everything when the sheet closes/opens for a new message.
  useEffect(() => {
    if (!visible) {
      setSearch('');
      setSelectedMap({});
      setActiveViewId('__all__');
      setMode('regular');
      setWindowStatus({});
      setSelectedTemplateId('');
      setSending(false);
      setProgress(null);
      setDone(false);
      mediaFileRef.current = null;
    }
  }, [visible]);

  const normalizeContact = (c: any): Recipient => ({
    phoneNumber: c.phoneNumber || c.PhoneNumber || c.phone || c.to || '',
    name: c.name || c.Name || c.fullName || '',
    ownerName: c.ownerName || c.OwnerName || '',
    email: c.email || c.Email || '',
    firstName: (c.name || c.Name || '').split(' ')[0] || '',
    fromNumberId: c.lastFromNumberId || c.wabaPhoneNumberId || undefined,
  });

  // Load sidebar views + org users + templates + local view prefs (order/hidden).
  useEffect(() => {
    if (!visible || !org) return;
    axiosInstance
      .post(ENDPOINTS.GET_USER_VIEWS, { organization: org, userId: myId, viewType: 'sidebar' })
      .then((res) => {
        const data = res.data;
        if (data?.Success && data?.Data?.views) setViews(data.Data.views);
        else if (Array.isArray(data)) setViews(data);
      })
      .catch(() => {});

    usersApi
      .getAll(org)
      .then((arr: any[]) => {
        const map: Record<string, string> = {};
        (Array.isArray(arr) ? arr : []).forEach((u: any) => {
          const id = u.userId || u.uID || u.id || u.UserId;
          const name = u.fullname || u.FullName || u.name || u.Name || '';
          if (id) map[id] = name;
        });
        setOrgUsersById(map);
      })
      .catch(() => {});

    chatsApi.getTemplates(org).then(setTemplates).catch(() => setTemplates([]));

    Promise.all([
      AsyncStorage.getItem(`chats_view_order_${org}`),
      AsyncStorage.getItem(`chats_hidden_views_${org}`),
    ])
      .then(([orderRaw, hiddenRaw]) => {
        setViewOrder(orderRaw ? JSON.parse(orderRaw) : []);
        setHiddenViewIds(hiddenRaw ? JSON.parse(hiddenRaw) : []);
      })
      .catch(() => {});
  }, [visible, org, myId]);

  // Translate a sidebar view into owner-name / tag fetch params + a client "unassigned only" flag.
  const resolveTabFilter = useCallback(
    (tabId: string) => {
      if (tabId === '__all__') return { ownerNames: [] as string[], tags: [] as string[], unassignedOnly: false };
      if (tabId === '__mine__') return { ownerNames: myName ? [myName] : [], tags: [], unassignedOnly: false };
      if (tabId === '__unassigned__') return { ownerNames: [], tags: [], unassignedOnly: true };
      const view = views.find((v) => v.id === tabId);
      const f = (view?.ViewData || view || {}).filters || {};
      const ownerNames: string[] = [];
      let unassignedOnly = false;
      const ownerVal = f.owner;
      if (f.myConversations || ownerVal === '__me__') {
        if (myName) ownerNames.push(myName);
      } else if (ownerVal === '__unassigned__') {
        unassignedOnly = true;
      } else if (ownerVal) {
        // Saved views store the owner NAME; if it happens to be a user id, resolve it.
        ownerNames.push(orgUsersById[ownerVal] || ownerVal);
      }
      const tags = Array.isArray(f.contactGroup) ? f.contactGroup : [];
      return { ownerNames, tags, unassignedOnly };
    },
    [views, orgUsersById, myName],
  );

  const activeFilter = useMemo(() => resolveTabFilter(activeViewId), [resolveTabFilter, activeViewId]);

  const fetchContacts = useCallback(
    async (searchTerm: string, filter: { ownerNames: string[]; tags: string[] }) => {
      if (!org) return;
      setLoadingContacts(true);
      try {
        const list = await contactsApi.searchForForward(org, {
          search: searchTerm,
          ownerNames: filter.ownerNames,
          tags: filter.tags,
          userId: myId,
          dataVisibility: 'all',
        });
        setContacts(list);
      } catch {
        setContacts([]);
      } finally {
        setLoadingContacts(false);
      }
    },
    [org, myId],
  );

  // Debounced refetch on search / view change.
  useEffect(() => {
    if (!visible) return;
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(
      () => fetchContacts(search, { ownerNames: activeFilter.ownerNames, tags: activeFilter.tags }),
      300,
    );
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, [visible, search, activeFilter, fetchContacts]);

  // Ordered visible tabs = built-ins + visible saved views, in the user's saved order, minus hidden.
  const orderedTabs = useMemo(() => {
    const builtins = [
      { id: '__all__', label: t('sidebar.allContacts', 'כל אנשי הקשר'), shared: false },
      { id: '__mine__', label: t('chats.myChats', 'שלי'), shared: false },
      { id: '__unassigned__', label: t('sidebar.unassigned', 'לא משויך'), shared: false },
    ];
    const visibleSaved = views
      .filter((v) => {
        if (hiddenViewIds.includes(v.id)) return false;
        const vis = v.Visibility || 'personal';
        if (vis === 'shared') return true;
        return (v.UserId || '') === myId;
      })
      .map((v) => ({ id: v.id, label: v.Name || v.name, shared: (v.Visibility || 'personal') === 'shared' }));
    const all = [...builtins.filter((b) => !hiddenViewIds.includes(b.id)), ...visibleSaved];
    if (viewOrder.length > 0) {
      const byId = new Map(all.map((tb) => [tb.id, tb]));
      const ordered = viewOrder.map((id) => byId.get(id)).filter(Boolean) as typeof all;
      const known = new Set(viewOrder);
      const extras = all.filter((tb) => !known.has(tb.id));
      return [...ordered, ...extras];
    }
    return all;
  }, [views, hiddenViewIds, viewOrder, myId, t]);

  const displayContacts = useMemo(() => {
    if (!activeFilter.unassignedOnly) return contacts;
    return contacts.filter((c) => {
      const o = c.ownerId || c.OwnerId || c.ownerName || c.OwnerName || '';
      return !o || o === 'gambot';
    });
  }, [contacts, activeFilter.unassignedOnly]);

  const selectedRecipients = useMemo(() => Object.values(selectedMap), [selectedMap]);

  const toggleContact = (c: any) => {
    const r = normalizeContact(c);
    if (!r.phoneNumber) return;
    setSelectedMap((prev) => {
      const next = { ...prev };
      if (next[r.phoneNumber]) delete next[r.phoneNumber];
      else next[r.phoneNumber] = r;
      return next;
    });
  };

  const selectAllShown = () => {
    setSelectedMap((prev) => {
      const next = { ...prev };
      displayContacts.forEach((c) => {
        const r = normalizeContact(c);
        if (r.phoneNumber) next[r.phoneNumber] = r;
      });
      return next;
    });
  };
  const clearSelection = () => setSelectedMap({});

  // Check the 24h window for selected recipients when on the Regular tab.
  useEffect(() => {
    if (!visible || mode !== 'regular' || selectedRecipients.length === 0) return undefined;
    let cancelled = false;
    setChecking(true);
    const status: Record<string, boolean> = {};
    (async () => {
      for (const r of selectedRecipients) {
        try {
          const res = await chatsApi.getConversationStatus(org, r.phoneNumber, r.fromNumberId);
          const s: any = res || {};
          status[r.phoneNumber] = !!(
            s.IsRecipientReplyLast24Hours ||
            s.isRecipientReplyLast24Hours ||
            s.IsConversationLive ||
            s.isConversationLive
          );
        } catch {
          status[r.phoneNumber] = false;
        }
      }
      if (!cancelled) {
        setWindowStatus({ ...status });
        setChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, mode, selectedRecipients, org]);

  const eligible = useMemo(
    () => selectedRecipients.filter((r) => windowStatus[r.phoneNumber]),
    [selectedRecipients, windowStatus],
  );
  const blocked = useMemo(
    () => selectedRecipients.filter((r) => windowStatus[r.phoneNumber] === false),
    [selectedRecipients, windowStatus],
  );

  // Templates whose header type matches the forwarded content.
  const filteredTemplates = useMemo(
    () =>
      templates.filter((tpl) => {
        const f = tplHeaderFormat(tpl);
        if (content.kind === 'image') return f === 'IMAGE';
        if (content.kind === 'video') return f === 'VIDEO';
        if (content.kind === 'document') return f === 'DOCUMENT';
        return f === 'TEXT' || f === 'NONE';
      }),
    [templates, content.kind],
  );

  const selectedTemplate = useMemo(
    () => filteredTemplates.find((tpl) => (tpl.id || tpl.templateId) === selectedTemplateId),
    [filteredTemplates, selectedTemplateId],
  );

  const buildTemplateQuery = useCallback(
    (tpl: Template, r: Recipient) => {
      const n = templateBodyVarCount(tpl);
      if (n === 0) return [];
      let am: Record<number, any> | null = null;
      if (tpl.variableMappingJson) {
        try {
          const parsed = JSON.parse(tpl.variableMappingJson);
          am = {};
          (parsed || []).forEach((e: any) => {
            if (e && e.index != null) am![Number(e.index)] = e;
          });
        } catch {
          am = null;
        }
      }
      const out: any[] = [];
      for (let i = 1; i <= n; i++) {
        let val = '';
        if (am && am[i]) val = resolveEntityField(am[i].entity, am[i].field, r, user) || '';
        // Sensible default: first variable → recipient name.
        if (!val && i === 1) val = r.name || r.phoneNumber;
        out.push(buildVarEntry(i, val || '-'));
      }
      return out;
    },
    [user],
  );

  const ensureMediaFile = useCallback(async () => {
    if (mediaFileRef.current) return mediaFileRef.current;
    const d = await chatsApi.downloadMediaForForward(content.mediaUrl);
    if (!d?.success || !d.base64) throw new Error('media download failed');
    const FileSystem = require('expo-file-system');
    const name = d.fileName || content.fileName || `forwarded_${Date.now()}`;
    const fileUri = (FileSystem.cacheDirectory || '') + name.replace(/[^\w.\-]/g, '_');
    await FileSystem.writeAsStringAsync(fileUri, d.base64, { encoding: FileSystem.EncodingType.Base64 });
    mediaFileRef.current = { uri: fileUri, name, type: d.contentType || 'application/octet-stream' };
    return mediaFileRef.current;
  }, [content]);

  const sendRegular = useCallback(
    async (r: Recipient) => {
      if (content.mediaUrl && content.kind !== 'text') {
        const file = await ensureMediaFile();
        await chatsApi.sendMediaMessage(org, r.phoneNumber, file, content.text || '', myId, r.fromNumberId);
        return;
      }
      await chatsApi.sendMessage(
        org,
        r.phoneNumber,
        content.text || '',
        myName,
        myId,
        undefined,
        user?.wabaNumber || undefined,
        user?.email,
        r.fromNumberId,
      );
    },
    [content, org, myId, myName, user, ensureMediaFile],
  );

  const sendTemplate = useCallback(
    async (r: Recipient, tpl: Template) => {
      const query = buildTemplateQuery(tpl, r);
      const tid = tpl.id || tpl.templateId || '';
      await chatsApi.sendTemplateMessage(org, r.phoneNumber, tid, myId, query, r.fromNumberId);
    },
    [buildTemplateQuery, org, myId],
  );

  const canSend = useMemo(() => {
    if (sending) return false;
    if (mode === 'regular') return !checking && eligible.length > 0;
    return selectedRecipients.length > 0 && !!selectedTemplate;
  }, [sending, mode, checking, eligible.length, selectedRecipients.length, selectedTemplate]);

  const handleSend = useCallback(async () => {
    const targets = mode === 'regular' ? eligible : selectedRecipients;
    if (targets.length === 0) return;
    const tpl = mode === 'template' ? selectedTemplate : null;
    setSending(true);
    setDone(false);
    let sent = 0;
    let failed = 0;
    setProgress({ sent: 0, failed: 0, total: targets.length });
    for (const r of targets) {
      try {
        if (mode === 'regular') await sendRegular(r);
        else if (tpl) await sendTemplate(r, tpl);
        sent++;
      } catch {
        failed++;
      }
      setProgress({ sent, failed, total: targets.length });
    }
    setSending(false);
    setDone(true);
  }, [mode, eligible, selectedRecipients, selectedTemplate, sendRegular, sendTemplate]);

  const kindLabel = {
    image: isRTL ? 'תמונה' : 'Image',
    video: isRTL ? 'וידאו' : 'Video',
    document: isRTL ? 'מסמך' : 'Document',
    audio: isRTL ? 'אודיו' : 'Audio',
    text: isRTL ? 'טקסט' : 'Text',
  }[content.kind];

  const templateName = (tpl?: Template) => tpl?.friendlyName || tpl?.name || '';

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={() => !sending && onClose()}>
      <View style={styles.overlay}>
        <View style={[styles.sheet, { backgroundColor: theme.colors.surface, paddingBottom: insets.bottom + 12 }]}>
          <View style={styles.handle} />

          {/* Header */}
          <View style={[styles.header, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
            <Text style={[styles.title, { color: theme.colors.onSurface }]}>{isRTL ? 'העברת הודעה' : 'Forward message'}</Text>
            <Pressable onPress={() => !sending && onClose()} hitSlop={10}>
              <MaterialCommunityIcons name="close" size={22} color={theme.colors.onSurfaceVariant} />
            </Pressable>
          </View>

          {/* Preview */}
          <View style={[styles.preview, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
            <View style={styles.previewKind}>
              <Text style={styles.previewKindText}>{kindLabel}</Text>
            </View>
            <Text style={[styles.previewText, { color: theme.colors.onSurfaceVariant, textAlign: isRTL ? 'right' : 'left' }]} numberOfLines={2}>
              {content.text || (content.kind !== 'text' ? (isRTL ? '(מדיה ללא טקסט)' : '(media, no text)') : '')}
            </Text>
          </View>

          {progress ? (
            <View style={styles.progressBox}>
              {!done ? (
                <>
                  <ActivityIndicator color="#2e6155" />
                  <Text style={{ marginTop: 10, color: theme.colors.onSurface }}>
                    {isRTL ? 'מעביר…' : 'Forwarding…'} {progress.sent + progress.failed} / {progress.total}
                  </Text>
                </>
              ) : (
                <>
                  <MaterialCommunityIcons name="check-circle" size={40} color="#2e6155" />
                  <Text style={{ marginTop: 8, color: theme.colors.onSurface, fontWeight: '600' }}>
                    {isRTL ? `הועברו ${progress.sent} מתוך ${progress.total}` : `Forwarded ${progress.sent} of ${progress.total}`}
                  </Text>
                  {progress.failed > 0 && (
                    <Text style={{ marginTop: 2, color: '#dc2626' }}>{isRTL ? `${progress.failed} נכשלו` : `${progress.failed} failed`}</Text>
                  )}
                  <Pressable onPress={onClose} style={[styles.primaryBtn, { marginTop: 14 }]}>
                    <Text style={styles.primaryBtnText}>{isRTL ? 'סגור' : 'Close'}</Text>
                  </Pressable>
                </>
              )}
            </View>
          ) : (
            <>
              {/* Search */}
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder={isRTL ? 'חפש איש קשר…' : 'Search contact…'}
                placeholderTextColor={theme.colors.onSurfaceVariant}
                style={[styles.search, { color: theme.colors.onSurface, borderColor: theme.colors.outlineVariant, textAlign: isRTL ? 'right' : 'left' }]}
              />

              {/* View tabs */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabsRow} contentContainerStyle={{ gap: 6, paddingHorizontal: 4 }}>
                {orderedTabs.map((tab) => (
                  <Pressable
                    key={tab.id}
                    onPress={() => setActiveViewId(tab.id)}
                    style={[
                      styles.tabChip,
                      activeViewId === tab.id ? { backgroundColor: '#2e6155' } : { backgroundColor: theme.colors.surfaceVariant },
                    ]}
                  >
                    <Text style={{ fontSize: 12, fontWeight: '600', color: activeViewId === tab.id ? '#fff' : theme.colors.onSurface }}>
                      {(tab.shared ? '👥 ' : '') + tab.label}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>

              {/* Select actions */}
              <View style={[styles.pickerActions, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
                <Pressable onPress={selectAllShown}>
                  <Text style={styles.link}>{isRTL ? 'בחר הכל' : 'Select all'}</Text>
                </Pressable>
                <Pressable onPress={clearSelection}>
                  <Text style={styles.link}>{isRTL ? 'נקה' : 'Clear'}</Text>
                </Pressable>
                <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 12 }}>
                  {isRTL ? `${selectedRecipients.length} נבחרו` : `${selectedRecipients.length} selected`}
                </Text>
              </View>

              {/* Contact list */}
              <ScrollView style={styles.contactList} keyboardShouldPersistTaps="handled">
                {loadingContacts ? (
                  <View style={styles.empty}>
                    <ActivityIndicator color="#2e6155" />
                  </View>
                ) : displayContacts.length === 0 ? (
                  <Text style={[styles.empty, { color: theme.colors.onSurfaceVariant }]}>{isRTL ? 'לא נמצאו אנשי קשר' : 'No contacts found'}</Text>
                ) : (
                  displayContacts.map((c, i) => {
                    const phone = c.phoneNumber || c.PhoneNumber || c.phone || '';
                    const selected = !!selectedMap[phone];
                    return (
                      <Pressable
                        key={phone || i}
                        onPress={() => toggleContact(c)}
                        style={[styles.contactRow, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}
                      >
                        <MaterialCommunityIcons
                          name={selected ? 'checkbox-marked' : 'checkbox-blank-outline'}
                          size={22}
                          color={selected ? '#2e6155' : theme.colors.onSurfaceVariant}
                        />
                        <View style={{ flex: 1, marginHorizontal: 10 }}>
                          <Text style={{ color: theme.colors.onSurface, fontWeight: '600', textAlign: isRTL ? 'right' : 'left' }} numberOfLines={1}>
                            {c.name || c.Name || phone}
                          </Text>
                          <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 12, textAlign: isRTL ? 'right' : 'left' }} numberOfLines={1}>
                            {phone}
                          </Text>
                        </View>
                      </Pressable>
                    );
                  })
                )}
              </ScrollView>

              {/* Mode tabs */}
              <View style={[styles.modeTabs, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
                <Pressable
                  onPress={() => setMode('regular')}
                  style={[styles.modeTab, mode === 'regular' && styles.modeTabActive]}
                >
                  <Text style={[styles.modeTabText, mode === 'regular' && styles.modeTabTextActive]}>{isRTL ? 'הודעה רגילה' : 'Regular'}</Text>
                </Pressable>
                <Pressable
                  onPress={() => setMode('template')}
                  style={[styles.modeTab, mode === 'template' && styles.modeTabActive]}
                >
                  <Text style={[styles.modeTabText, mode === 'template' && styles.modeTabTextActive]}>{isRTL ? 'תבנית' : 'Template'}</Text>
                </Pressable>
              </View>

              {/* Mode body */}
              <View style={styles.modeBody}>
                {mode === 'regular' ? (
                  selectedRecipients.length === 0 ? (
                    <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 13, textAlign: isRTL ? 'right' : 'left' }}>
                      {isRTL ? 'בחר נמענים כדי לבדוק זמינות' : 'Select recipients to check availability'}
                    </Text>
                  ) : checking ? (
                    <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 13 }}>{isRTL ? 'בודק חלון 24 שעות…' : 'Checking 24h window…'}</Text>
                  ) : (
                    <>
                      <Text style={{ color: '#2e6155', fontSize: 13, fontWeight: '600', textAlign: isRTL ? 'right' : 'left' }}>
                        {isRTL ? `ניתן להעביר ל-${eligible.length}` : `Can forward to ${eligible.length}`}
                      </Text>
                      {blocked.length > 0 && (
                        <Text style={{ color: '#b45309', fontSize: 12, marginTop: 4, textAlign: isRTL ? 'right' : 'left' }}>
                          {isRTL
                            ? `${blocked.length} נמענים לא יקבלו — השיחה איתם סגורה. השתמש בתבנית עבורם.`
                            : `${blocked.length} recipients won't receive it — window closed. Use a template.`}
                        </Text>
                      )}
                    </>
                  )
                ) : (
                  <>
                    <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 12, marginBottom: 6, textAlign: isRTL ? 'right' : 'left' }}>
                      {isRTL ? `תבנית WhatsApp (${kindLabel})` : `WhatsApp template (${kindLabel})`}
                    </Text>
                    {filteredTemplates.length === 0 ? (
                      <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 13 }}>
                        {isRTL ? `אין תבניות מאושרות מסוג ${kindLabel}` : `No approved ${kindLabel} templates`}
                      </Text>
                    ) : (
                      <Pressable
                        onPress={() => setShowTemplatePicker((v) => !v)}
                        style={[styles.templateSelect, { borderColor: theme.colors.outlineVariant, flexDirection: isRTL ? 'row-reverse' : 'row' }]}
                      >
                        <Text style={{ color: selectedTemplate ? theme.colors.onSurface : theme.colors.onSurfaceVariant, flex: 1, textAlign: isRTL ? 'right' : 'left' }} numberOfLines={1}>
                          {selectedTemplate ? templateName(selectedTemplate) : isRTL ? 'בחר תבנית…' : 'Choose a template…'}
                        </Text>
                        <MaterialCommunityIcons name="chevron-down" size={20} color={theme.colors.onSurfaceVariant} />
                      </Pressable>
                    )}
                    {showTemplatePicker && (
                      <View style={[styles.templateDropdown, { backgroundColor: theme.colors.surface, borderColor: theme.colors.outlineVariant }]}>
                        <ScrollView style={{ maxHeight: 160 }} keyboardShouldPersistTaps="handled">
                          {filteredTemplates.map((tpl) => (
                            <Pressable
                              key={tpl.id || tpl.templateId}
                              onPress={() => {
                                setSelectedTemplateId(tpl.id || tpl.templateId || '');
                                setShowTemplatePicker(false);
                              }}
                              style={styles.templateOption}
                            >
                              <Text style={{ color: theme.colors.onSurface, textAlign: isRTL ? 'right' : 'left' }}>{templateName(tpl)}</Text>
                            </Pressable>
                          ))}
                        </ScrollView>
                      </View>
                    )}
                    <Text style={{ color: '#2e6155', fontSize: 13, marginTop: 8, textAlign: isRTL ? 'right' : 'left' }}>
                      {isRTL ? `תישלח ל-${selectedRecipients.length} נמענים` : `Will be sent to ${selectedRecipients.length} recipients`}
                    </Text>
                  </>
                )}
              </View>

              {/* Footer */}
              <View style={[styles.footer, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
                <Pressable onPress={() => !sending && onClose()} style={styles.cancelBtn}>
                  <Text style={{ color: theme.colors.onSurfaceVariant, fontWeight: '600' }}>{isRTL ? 'ביטול' : 'Cancel'}</Text>
                </Pressable>
                <Pressable onPress={handleSend} disabled={!canSend} style={[styles.primaryBtn, !canSend && { opacity: 0.5 }]}>
                  <Text style={styles.primaryBtnText}>
                    {mode === 'regular'
                      ? isRTL
                        ? `העבר ל-${eligible.length}`
                        : `Forward to ${eligible.length}`
                      : isRTL
                        ? `העבר ל-${selectedRecipients.length}`
                        : `Forward to ${selectedRecipients.length}`}
                  </Text>
                </Pressable>
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingHorizontal: 16, paddingTop: 8, maxHeight: '90%' },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(0,0,0,0.2)', marginBottom: 8 },
  header: { alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  title: { fontSize: 17, fontWeight: '700' },
  preview: { alignItems: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: 10, backgroundColor: 'rgba(46,97,85,0.06)', borderRadius: 10, marginBottom: 10 },
  previewKind: { backgroundColor: '#2e6155', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  previewKindText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  previewText: { flex: 1, fontSize: 13 },
  search: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, marginBottom: 8 },
  tabsRow: { flexGrow: 0, marginBottom: 8 },
  tabChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16 },
  pickerActions: { alignItems: 'center', gap: 16, marginBottom: 6 },
  link: { color: '#2e6155', fontWeight: '600', fontSize: 13 },
  contactList: { maxHeight: 220, borderWidth: 1, borderColor: 'rgba(0,0,0,0.06)', borderRadius: 10 },
  empty: { padding: 20, textAlign: 'center' },
  contactRow: { alignItems: 'center', paddingVertical: 10, paddingHorizontal: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(0,0,0,0.06)' },
  modeTabs: { marginTop: 12, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.05)', padding: 3 },
  modeTab: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  modeTabActive: { backgroundColor: '#2e6155' },
  modeTabText: { fontSize: 13, fontWeight: '600', color: '#475569' },
  modeTabTextActive: { color: '#fff' },
  modeBody: { paddingVertical: 12, minHeight: 60 },
  templateSelect: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, alignItems: 'center' },
  templateDropdown: { borderWidth: 1, borderRadius: 10, marginTop: 4, overflow: 'hidden' },
  templateOption: { paddingVertical: 10, paddingHorizontal: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(0,0,0,0.06)' },
  footer: { alignItems: 'center', justifyContent: 'flex-end', gap: 12, marginTop: 8 },
  cancelBtn: { paddingVertical: 10, paddingHorizontal: 16 },
  primaryBtn: { backgroundColor: '#2e6155', paddingVertical: 11, paddingHorizontal: 22, borderRadius: 10 },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  progressBox: { alignItems: 'center', justifyContent: 'center', paddingVertical: 40 },
});
