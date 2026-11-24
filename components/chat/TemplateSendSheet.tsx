import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  Pressable,
  ScrollView,
  FlatList,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Keyboard,
} from 'react-native';
import { Image } from 'expo-image';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useRTL } from '../../hooks/useRTL';
import { chatsApi } from '../../services/api/chats';
import type { Template } from '../../types';

type Tab = 'quick' | 'manual';

interface Props {
  visible: boolean;
  onClose: () => void;
  templates: Template[];
  loading: boolean;
  organization: string;
  /** Resolves an auto-mapped variable (contact / user / org / ...) to its current value. */
  resolveVar: (entity: string, field: string) => string;
  isSending: boolean;
  /** Called with the chosen template, its body variable indices and the values to send. */
  onSend: (template: Template, indices: number[], values: Record<number, string>) => void;
}

const ACCENT = '#6c63ff';
const hasHebrew = (s: string) => /[\u0590-\u05FF]/.test(s || '');

function bodyOf(t: Template): string {
  return (t.components || []).find((c: any) => c.type === 'BODY')?.text || '';
}

function varIndicesOf(t: Template): number[] {
  const m = bodyOf(t).match(/\{\{(\d+)\}\}/g);
  if (!m) return [];
  return [...new Set(m.map((x) => parseInt(x.replace(/[{}]/g, ''), 10)))].sort((a, b) => a - b);
}

function mappingOf(t: Template): Array<{ index: number; entity: string; field: string }> {
  try {
    return JSON.parse(t.variableMappingJson || '[]');
  } catch {
    return [];
  }
}

/** WhatsApp inline formatting (*bold*, _italic_, ~strike~) → nested <Text>. */
function renderFormatted(text: string, color: string, keyPrefix: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /(\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const inner = tok.slice(1, -1);
    const style =
      tok[0] === '*' ? { fontWeight: '700' as const }
      : tok[0] === '_' ? { fontStyle: 'italic' as const }
      : { textDecorationLine: 'line-through' as const };
    out.push(
      <Text key={`${keyPrefix}-f${i++}`} style={[style, { color }]}>{inner}</Text>,
    );
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export default function TemplateSendSheet({
  visible,
  onClose,
  templates,
  loading,
  organization,
  resolveVar,
  isSending,
  onSend,
}: Props) {
  const theme = useAppTheme();
  const { isRTL } = useRTL();
  const insets = useSafeAreaInsets();

  const [tab, setTab] = useState<Tab>('quick');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Template | null>(null);
  const [listOpen, setListOpen] = useState(true);
  const [values, setValues] = useState<Record<number, string>>({});
  const [autoIdx, setAutoIdx] = useState<Set<number>>(new Set());
  const [mediaUrl, setMediaUrl] = useState('');
  const initRef = useRef(false);

  const quickTemplates = useMemo(() => templates.filter((t) => t.showInQuickSend), [templates]);

  // Every time the sheet opens (and the templates are loaded): quick tab with the list open — or, when no template is
  // marked ⚡ quick, the manual tab with the list open.
  useEffect(() => {
    if (!visible) {
      initRef.current = false;
      return;
    }
    if (loading || initRef.current) return;
    initRef.current = true;
    setTab(quickTemplates.length > 0 ? 'quick' : 'manual');
    setSearch('');
    setSelected(null);
    setListOpen(true);
    setValues({});
    setAutoIdx(new Set());
    setMediaUrl('');
  }, [visible, loading, quickTemplates.length]);

  const listData = useMemo(() => {
    const q = search.trim().toLowerCase();
    // Quick tab without a search shows only the ⚡ templates; searching looks through all of them.
    const base = tab === 'quick' && !q ? quickTemplates : templates;
    if (!q) return base;
    return base.filter(
      (t) =>
        (t.friendlyName || '').toLowerCase().includes(q) ||
        (t.usageType || '').toLowerCase().includes(q) ||
        (t.name || '').toLowerCase().includes(q) ||
        bodyOf(t).toLowerCase().includes(q),
    );
  }, [tab, search, quickTemplates, templates]);

  const header = useMemo(
    () => (selected?.components || []).find((c: any) => c.type === 'HEADER'),
    [selected],
  );
  const headerFormat = String(header?.format || '').toUpperCase();
  const isMediaHeader = headerFormat === 'IMAGE' || headerFormat === 'VIDEO' || headerFormat === 'DOCUMENT';
  const footerText = useMemo(
    () => (selected?.components || []).find((c: any) => c.type === 'FOOTER')?.text || '',
    [selected],
  );
  const buttons: any[] = useMemo(
    () => (selected?.components || []).find((c: any) => c.type === 'BUTTONS')?.buttons || [],
    [selected],
  );
  const indices = useMemo(() => (selected ? varIndicesOf(selected) : []), [selected]);

  // Header image for the preview (same endpoint the chat bubble uses).
  useEffect(() => {
    setMediaUrl('');
    if (!selected || headerFormat !== 'IMAGE') return;
    const id = selected.id || selected.templateId || (selected as any).Id;
    if (!id) return;
    let cancelled = false;
    chatsApi.getMediaByTemplateId(organization, id).then((u) => { if (!cancelled && u) setMediaUrl(u); });
    return () => { cancelled = true; };
  }, [selected, headerFormat, organization]);

  const pick = useCallback((tpl: Template) => {
    const idxs = varIndicesOf(tpl);
    const mapping = mappingOf(tpl);
    const init: Record<number, string> = {};
    const auto = new Set<number>();
    idxs.forEach((idx) => {
      const me = mapping.find((m) => m.index === idx);
      if (me && me.entity !== 'open') {
        init[idx] = resolveVar(me.entity, me.field);
        auto.add(idx);
      } else {
        init[idx] = '';
      }
    });
    setValues(init);
    setAutoIdx(auto);
    setSelected(tpl);
    setListOpen(false);
    Keyboard.dismiss();
  }, [resolveVar]);

  const missing = indices.some((idx) => !(values[idx] || '').trim());

  const send = useCallback(() => {
    if (!selected || missing || isSending) return;
    onSend(selected, indices, values);
  }, [selected, missing, isSending, onSend, indices, values]);

  const switchTab = (next: Tab) => {
    if (next === tab) return;
    setTab(next);
    setSearch('');
    setSelected(null);
    setListOpen(true);
  };

  // ── colours ──
  const dark = theme.dark;
  const bubbleBg = dark ? '#005c4b' : '#d9fdd3';
  const chatBg = dark ? '#0b141a' : '#efeae2';
  const bubbleText = dark ? '#e9edef' : '#111b21';
  const subText = theme.colors.onSurfaceVariant;
  const border = theme.colors.outlineVariant || (dark ? '#3f3f46' : '#e5e7eb');

  const bodyText = selected ? bodyOf(selected) : '';
  const previewRtl = hasHebrew(bodyText) || hasHebrew(footerText) || hasHebrew(header?.text || '');

  const renderBody = () => {
    const parts = bodyText.split(/(\{\{\d+\}\})/g);
    return parts.map((p, i) => {
      const m = p.match(/^\{\{(\d+)\}\}$/);
      if (m) {
        const v = (values[parseInt(m[1], 10)] || '').trim();
        if (v) return <Text key={`v${i}`} style={{ color: bubbleText }}>{v}</Text>;
        return <Text key={`v${i}`} style={{ color: ACCENT, fontWeight: '700' }}>{p}</Text>;
      }
      return <Text key={`t${i}`}>{renderFormatted(p, bubbleText, `t${i}`)}</Text>;
    });
  };

  const buttonIcon = (type: string): any => {
    const t = String(type || '').toUpperCase();
    if (t.includes('PHONE')) return 'phone';
    if (t.includes('URL')) return 'open-in-new';
    if (t.includes('COPY') || t.includes('OTP')) return 'content-copy';
    return 'reply';
  };

  const close = () => { Keyboard.dismiss(); onClose(); };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top : 0}
      >
        <View style={s.overlay}>
          <View style={[s.sheet, { backgroundColor: theme.colors.surface, paddingBottom: insets.bottom + 8 }]}>
            <View style={s.handle} />

            {/* Header */}
            <View style={s.header}>
              <Text style={{ flex: 1, fontSize: 18, fontWeight: '700', color: theme.colors.onSurface, textAlign: isRTL ? 'right' : 'left' }}>
                {isRTL ? 'שלח תבנית' : 'Send Template'}
              </Text>
              <Pressable onPress={close} hitSlop={10} style={s.closeBtn}>
                <MaterialCommunityIcons name="close" size={22} color={theme.colors.onSurfaceVariant} />
              </Pressable>
            </View>

            {/* Tabs */}
            <View style={[s.tabs, { borderBottomColor: border }]}>
              {([
                { key: 'quick', label: isRTL ? '⚡ מהיר' : '⚡ Quick' },
                { key: 'manual', label: isRTL ? '✏️ ידני' : '✏️ Manual' },
              ] as const).map((tb) => (
                <Pressable
                  key={tb.key}
                  onPress={() => switchTab(tb.key)}
                  style={[s.tab, { borderBottomColor: tab === tb.key ? ACCENT : 'transparent' }]}
                >
                  <Text style={{ fontSize: 14, fontWeight: tab === tb.key ? '700' : '400', color: tab === tb.key ? ACCENT : theme.colors.onSurfaceVariant }}>
                    {tb.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            {loading ? (
              <View style={s.center}>
                <ActivityIndicator size="large" color={theme.colors.primary} />
              </View>
            ) : listOpen || !selected ? (
              /* ── Template list ── */
              <View style={{ flex: 1 }}>
                <View style={[s.searchWrap, { backgroundColor: dark ? 'rgba(255,255,255,0.06)' : '#f3f4f6', borderColor: border }]}>
                  <MaterialCommunityIcons name="magnify" size={18} color={theme.colors.onSurfaceVariant} />
                  <TextInput
                    value={search}
                    onChangeText={setSearch}
                    placeholder={isRTL ? 'חפש בכל התבניות לפי שם או סוג...' : 'Search all templates by name or type...'}
                    placeholderTextColor={theme.colors.onSurfaceVariant}
                    style={[s.searchInput, { color: theme.colors.onSurface, textAlign: isRTL ? 'right' : 'left' }]}
                  />
                </View>
                {listData.length === 0 ? (
                  <View style={s.center}>
                    <MaterialCommunityIcons name="file-document-outline" size={40} color={theme.colors.onSurfaceVariant} style={{ opacity: 0.35 }} />
                    <Text style={{ color: theme.colors.onSurfaceVariant, marginTop: 8, textAlign: 'center', paddingHorizontal: 24, lineHeight: 20 }}>
                      {search.trim()
                        ? (isRTL ? 'לא נמצאו תבניות תואמות.' : 'No matching templates.')
                        : tab === 'quick'
                          ? (isRTL ? 'אין תבניות מהירות.\nסמן ⚡ בהגדרות תבניות, או עבור ללשונית "ידני".' : 'No Quick templates.\nMark ⚡ in template settings, or use the Manual tab.')
                          : (isRTL ? 'אין תבניות מאושרות.' : 'No approved templates.')}
                    </Text>
                  </View>
                ) : (
                  <FlatList
                    data={listData}
                    keyExtractor={(item, i) => item.id || item.templateId || `${item.name}-${i}`}
                    keyboardShouldPersistTaps="handled"
                    renderItem={({ item }) => (
                      <Pressable
                        onPress={() => pick(item)}
                        style={({ pressed }) => [s.row, { borderBottomColor: border, backgroundColor: pressed ? theme.colors.surfaceVariant : 'transparent' }]}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 15, fontWeight: '700', color: theme.colors.onSurface, textAlign: isRTL ? 'right' : 'left' }} numberOfLines={1}>
                            {item.friendlyName || item.name}
                          </Text>
                          {!!item.friendlyName && item.friendlyName !== item.name && (
                            <Text style={{ fontSize: 11, color: subText, textAlign: isRTL ? 'right' : 'left' }} numberOfLines={1}>{item.name}</Text>
                          )}
                          {!!item.usageType && (
                            <Text style={{ fontSize: 11, color: ACCENT, textAlign: isRTL ? 'right' : 'left' }}>{item.usageType}</Text>
                          )}
                          <Text numberOfLines={2} style={{ fontSize: 12.5, color: subText, marginTop: 2, textAlign: isRTL ? 'right' : 'left' }}>
                            {bodyOf(item) || `${item.language} · ${item.category}`}
                          </Text>
                        </View>
                        <MaterialCommunityIcons name={isRTL ? 'chevron-left' : 'chevron-right'} size={22} color={subText} />
                      </Pressable>
                    )}
                  />
                )}
              </View>
            ) : (
              /* ── Selected template: preview + variables + send ── */
              <View style={{ flex: 1 }}>
                <Pressable
                  onPress={() => setListOpen(true)}
                  style={[s.selectedRow, { borderColor: ACCENT, backgroundColor: dark ? 'rgba(108,99,255,0.12)' : 'rgba(108,99,255,0.07)' }]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 15, fontWeight: '700', color: theme.colors.onSurface, textAlign: isRTL ? 'right' : 'left' }} numberOfLines={1}>
                      {selected.friendlyName || selected.name}
                    </Text>
                    {!!selected.usageType && (
                      <Text style={{ fontSize: 11, color: ACCENT, textAlign: isRTL ? 'right' : 'left' }}>{selected.usageType}</Text>
                    )}
                  </View>
                  <Text style={{ color: ACCENT, fontWeight: '700', fontSize: 13 }}>{isRTL ? 'החלף' : 'Change'}</Text>
                  <MaterialCommunityIcons name="swap-horizontal" size={18} color={ACCENT} />
                </Pressable>

                <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12, paddingBottom: 16 }} keyboardShouldPersistTaps="handled">
                  {/* Preview — the message as the customer will get it */}
                  <Text style={[s.sectionLabel, { color: subText, textAlign: isRTL ? 'right' : 'left' }]}>
                    {isRTL ? 'תצוגה מקדימה' : 'Preview'}
                  </Text>
                  <View style={[s.chatArea, { backgroundColor: chatBg }]}>
                    <View style={[s.bubble, { backgroundColor: bubbleBg, alignSelf: previewRtl ? 'flex-end' : 'flex-start' }]}>
                      {isMediaHeader && (
                        headerFormat === 'IMAGE' && mediaUrl ? (
                          <Image source={{ uri: mediaUrl }} style={s.media} contentFit="cover" />
                        ) : (
                          <View style={[s.media, s.mediaPlaceholder]}>
                            <MaterialCommunityIcons
                              name={headerFormat === 'VIDEO' ? 'video-outline' : headerFormat === 'DOCUMENT' ? 'file-document-outline' : 'image-outline'}
                              size={34}
                              color="#00796b"
                            />
                          </View>
                        )
                      )}
                      {!isMediaHeader && !!header?.text && (
                        <Text style={{ fontWeight: '700', fontSize: 14.5, color: bubbleText, marginBottom: 4, writingDirection: previewRtl ? 'rtl' : 'ltr', textAlign: previewRtl ? 'right' : 'left' }}>
                          {header.text}
                        </Text>
                      )}
                      <Text style={{ fontSize: 14.5, lineHeight: 21, color: bubbleText, writingDirection: previewRtl ? 'rtl' : 'ltr', textAlign: previewRtl ? 'right' : 'left' }}>
                        {renderBody()}
                      </Text>
                      {!!footerText && (
                        <Text style={{ fontSize: 12, color: dark ? '#8696a0' : '#667781', marginTop: 6, writingDirection: previewRtl ? 'rtl' : 'ltr', textAlign: previewRtl ? 'right' : 'left' }}>
                          {footerText}
                        </Text>
                      )}
                    </View>
                    {buttons.map((b, i) => (
                      <View key={i} style={[s.btnPreview, { backgroundColor: bubbleBg, alignSelf: previewRtl ? 'flex-end' : 'flex-start' }]}>
                        <MaterialCommunityIcons name={buttonIcon(b.type)} size={15} color={dark ? '#53bdeb' : '#027eb5'} />
                        <Text style={{ color: dark ? '#53bdeb' : '#027eb5', fontWeight: '600', fontSize: 13.5 }}>{b.text}</Text>
                      </View>
                    ))}
                  </View>

                  {/* Variables — only when the template has any */}
                  {indices.length > 0 && (
                    <View style={{ marginTop: 16 }}>
                      <Text style={[s.sectionLabel, { color: subText, textAlign: isRTL ? 'right' : 'left' }]}>
                        {isRTL ? 'מלא משתנים' : 'Fill in variables'}
                      </Text>
                      {indices.map((idx) => (
                        <View key={idx} style={s.varRow}>
                          <Text style={{ color: ACCENT, fontWeight: '700', minWidth: 34, textAlign: 'center' }}>{`{{${idx}}}`}</Text>
                          <TextInput
                            value={values[idx] ?? ''}
                            onChangeText={(v) => setValues((prev) => ({ ...prev, [idx]: v }))}
                            placeholder={isRTL ? 'הזן ערך...' : 'Enter value...'}
                            placeholderTextColor={theme.colors.onSurfaceVariant}
                            style={[
                              s.varInput,
                              {
                                borderColor: autoIdx.has(idx) ? ACCENT : border,
                                color: theme.colors.onSurface,
                                backgroundColor: theme.colors.background,
                                textAlign: isRTL ? 'right' : 'left',
                              },
                            ]}
                          />
                          {autoIdx.has(idx) && (
                            <Text style={{ fontSize: 10, color: ACCENT, fontWeight: '700' }}>{isRTL ? 'אוטו' : 'AUTO'}</Text>
                          )}
                        </View>
                      ))}
                    </View>
                  )}
                </ScrollView>

                <Pressable
                  onPress={send}
                  disabled={isSending || missing}
                  style={({ pressed }) => [
                    s.sendBtn,
                    { backgroundColor: pressed ? '#1a7a5e' : '#25D366', opacity: isSending || missing ? 0.5 : 1 },
                  ]}
                >
                  {isSending
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <MaterialCommunityIcons name="send" size={18} color="#fff" />}
                  <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>
                    {isRTL ? 'שלח תבנית' : 'Send Template'}
                  </Text>
                </Pressable>
              </View>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { height: '94%', borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 8 },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(128,128,128,0.4)', alignSelf: 'center', marginBottom: 6 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 6 },
  closeBtn: { padding: 4 },
  tabs: { flexDirection: 'row', borderBottomWidth: 1.5, marginHorizontal: 12, marginBottom: 8 },
  tab: { paddingVertical: 10, paddingHorizontal: 18, borderBottomWidth: 2.5, marginBottom: -1.5 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 140 },
  searchWrap: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 12, marginBottom: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, gap: 8 },
  searchInput: { flex: 1, fontSize: 14, padding: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  selectedRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 12, marginBottom: 4, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, borderWidth: 1 },
  sectionLabel: { fontSize: 12, fontWeight: '700', marginBottom: 6 },
  chatArea: { borderRadius: 12, padding: 12, gap: 4 },
  bubble: { maxWidth: '92%', minWidth: '45%', borderRadius: 10, padding: 8 },
  media: { width: '100%', height: 150, borderRadius: 6, marginBottom: 6, overflow: 'hidden' },
  mediaPlaceholder: { backgroundColor: '#b2dfdb', alignItems: 'center', justifyContent: 'center' },
  btnPreview: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 14, minWidth: '45%', maxWidth: '92%' },
  varRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  varInput: { flex: 1, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14 },
  sendBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginHorizontal: 12, marginTop: 4, paddingVertical: 14, borderRadius: 12 },
});
