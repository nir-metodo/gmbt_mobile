import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, ScrollView, KeyboardAvoidingView, Platform, Alert, Pressable, Image, TextInput as RNTextInput } from 'react-native';
import { Text, TextInput, Chip, Button, ActivityIndicator } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '../../../../stores/authStore';
import { useAppTheme } from '../../../../hooks/useAppTheme';
import { useRTL } from '../../../../hooks/useRTL';
import { ScreenHeader } from '../../../../components/ScreenHeader';
import { campaignsApi, type WaTemplate } from '../../../../services/api/campaigns';
import axiosInstance from '../../../../services/api/axiosInstance';

// Meta limits (same numbers the web editor enforces).
const MAX_BODY = 1024;
const MAX_HEADER = 60;
const MAX_FOOTER = 60;
const MAX_BTN_LABEL = 25;
const MAX_URL_BUTTONS = 2;
const MAX_PHONE_BUTTONS = 1;
const MAX_BUTTONS = 10;
const MAX_IMAGE = 5 * 1024 * 1024;
const MAX_VIDEO = 16 * 1024 * 1024;
const MAX_DOC = 100 * 1024 * 1024;

type BtnType = 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER';
interface Btn { id: number; type: BtnType; label: string; value: string }

type MediaKind = 'IMAGE' | 'VIDEO' | 'DOCUMENT';
interface HeaderMedia { kind: MediaKind; uri: string; name: string; type: string; size: number }
type HeaderState = { mode: 'none' } | { mode: 'text'; text: string } | { mode: 'media'; media: HeaderMedia };

const LANGS = [
  { code: 'he', he: 'עברית', en: 'Hebrew' },
  { code: 'en', he: 'אנגלית', en: 'English' },
  { code: 'ar', he: 'ערבית', en: 'Arabic' },
  { code: 'ru', he: 'רוסית', en: 'Russian' },
];
const USAGE = [
  { value: 'new_lead', he: 'ליד חדש', en: 'New lead' },
  { value: 'followup', he: 'פולואפ', en: 'Follow-up' },
  { value: 'quote', he: 'הצעת מחיר', en: 'Quote' },
  { value: 'meeting', he: 'פגישה', en: 'Meeting' },
  { value: 'service', he: 'שירות', en: 'Service' },
];
const VAR_SUGGESTIONS = [
  { he: 'שם', en: 'name' },
  { he: 'שם חברה', en: 'company name' },
  { he: 'משתמש', en: 'user' },
  { he: 'תאריך', en: 'date' },
  { he: 'שעה', en: 'time' },
  { he: 'סכום', en: 'amount' },
  { he: 'קישור', en: 'link' },
];

/** A typed {name} (single braces) becomes {{name}} on the spot - the variable is created, no error later. */
const autoDoubleBraces = (text: string): string =>
  text.replace(/\{([^{}]+)\}/g, (m, inner, offset, str) => {
    if (str[offset - 1] === '{' || str[offset + m.length] === '}') return m;
    return `{{${String(inner).trim()}}}`;
  });
const OPT_OUT_FOOTER = 'להסרה יש להשיב הסר';

const VAR_RE = /\{\{\s*([^{}]+?)\s*\}\}/g;

/** Unique variable names in order of first appearance. */
const extractVars = (text: string): string[] => {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(VAR_RE.source, 'g');
  while ((m = re.exec(text))) { const n = m[1].trim(); if (n && !out.includes(n)) out.push(n); }
  return out;
};

/**
 * Named variables ({{שם}}) -> Meta positional ({{1}}, {{2}}…). A name used twice gets its own position each time and
 * `aliases` records the repeat ({"3":1} = {{3}} reuses {{1}}) - the same contract the web editor sends.
 */
const numberVars = (text: string, examples: Record<string, string>) => {
  const ex: string[] = [];
  const aliases: Record<string, number> = {};
  const first: Record<string, number> = {};
  const out = text.replace(new RegExp(VAR_RE.source, 'g'), (_m, raw) => {
    const name = String(raw).trim();
    const n = ex.length + 1;
    ex.push((examples[name] || '').trim() || name);
    if (first[name] === undefined) first[name] = n; else aliases[String(n)] = first[name];
    return `{{${n}}}`;
  });
  return { text: out, examples: ex, aliases };
};

/** Meta rejects interleaved button families (quick-reply vs link/phone): group them, keep the first group first. */
const orderButtons = <T extends { type: string }>(btns: T[]): T[] => {
  if (btns.length <= 1) return btns;
  const firstQR = btns[0].type === 'QUICK_REPLY';
  return [...btns.filter((b) => (b.type === 'QUICK_REPLY') === firstQR), ...btns.filter((b) => (b.type === 'QUICK_REPLY') !== firstQR)];
};

const cleanBody = (t: string) => t.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+/g, ' ').trim();

const normalizePhone = (raw: string): string => {
  let d = raw.replace(/[^\d+]/g, '');
  if (d.startsWith('+')) return '+' + d.slice(1).replace(/\D/g, '');
  d = d.replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  else if (d.startsWith('0')) d = '972' + d.slice(1);
  return d ? '+' + d : '';
};

const slug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const cleanMetaName = (s: string) => String(s || '').replace(/[^a-z0-9_]/gi, '').toLowerCase().replace(/_+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);

const BTN_META: Record<BtnType, { icon: string; he: string; en: string }> = {
  QUICK_REPLY: { icon: 'reply', he: 'תשובה מהירה', en: 'Quick reply' },
  URL: { icon: 'open-in-new', he: 'קישור לאתר', en: 'Website link' },
  PHONE_NUMBER: { icon: 'phone', he: 'חיוג', en: 'Call' },
};
const MEDIA_META: Record<MediaKind, { icon: string; he: string; en: string }> = {
  IMAGE: { icon: 'image-outline', he: 'תמונה', en: 'Image' },
  VIDEO: { icon: 'video-outline', he: 'וידאו', en: 'Video' },
  DOCUMENT: { icon: 'file-pdf-box', he: 'מסמך PDF', en: 'PDF document' },
};

let btnSeq = 1;

/**
 * Create a WhatsApp message template from the phone in two steps:
 *   1. name · type · language
 *   2. the message itself, edited right ON the WhatsApp-style preview (header, body + variables, footer, buttons).
 */
export default function NewTemplateScreen() {
  const router = useRouter();
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const { isRTL, textAlign, flexDirection } = useRTL();
  const L = (he: string, en: string) => (isRTL ? he : en);
  const user = useAuthStore((s) => s.user) as any;
  const org: string = user?.organization || '';

  const [step, setStep] = useState<1 | 2>(1);
  const [friendlyName, setFriendlyName] = useState('');
  const [category, setCategory] = useState<'UTILITY' | 'MARKETING'>('UTILITY');
  const [lang, setLang] = useState('he');
  const [usage, setUsage] = useState('');
  const [moreOpen, setMoreOpen] = useState(false);

  const [header, setHeader] = useState<HeaderState>({ mode: 'none' });
  const [headerPicker, setHeaderPicker] = useState(false);
  const [body, setBody] = useState('');
  const [footer, setFooter] = useState<string | null>(null); // null = no footer
  const [buttons, setButtons] = useState<Btn[]>([]);
  const [btnPicker, setBtnPicker] = useState(false);
  const [varPicker, setVarPicker] = useState(false);
  const [newVar, setNewVar] = useState('');
  const [examples, setExamples] = useState<Record<string, string>>({});

  const [wabas, setWabas] = useState<{ id: string; label: string }[]>([]);
  const [wabaId, setWabaId] = useState('');
  const [existing, setExisting] = useState<WaTemplate[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<null | { name: string; friendly: string }>(null);
  const selection = useRef({ start: 0, end: 0 });

  // Sender numbers (-> WABAs; only asked about when there is more than one) + existing templates (duplicate-name guard).
  useEffect(() => {
    if (!org) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await axiosInstance.get('/api/Webhooks/GetWhatsAppNumbers', { params: { organization: org } });
        const nums: any[] = res.data?.Numbers || res.data?.numbers || [];
        const map = new Map<string, string>();
        nums.forEach((n) => {
          const id = n.WabaBuisnessAccountId || n.wabaBuisnessAccountId;
          if (id && !map.has(id)) map.set(id, n.Label || n.label || n.DisplayNumber || n.displayNumber || n.WabaNumber || id);
        });
        const list = Array.from(map, ([id, label]) => ({ id, label: String(label) }));
        if (!cancelled) { setWabas(list); if (list.length) setWabaId(list[0].id); }
      } catch { /* single/unknown WABA: backend picks the default */ }
      try { const tpls = await campaignsApi.getTemplates(org); if (!cancelled) setExisting(tpls); } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [org]);

  const vars = useMemo(() => extractVars(body), [body]);

  const onBodyChange = (text: string) => setBody(autoDoubleBraces(text));

  /** "+" : a typed name is inserted as {{name}} at the cursor; with no name it opens the suggestions (name, company, user…). */
  const onPlusVar = () => {
    const n = newVar.trim().replace(/[{}]/g, '');
    if (n) { addVar(n); setNewVar(''); } else setVarPicker((p) => !p);
  };

  const addVar = (name: string) => {
    const tag = `{{${name}}}`;
    const { start, end } = selection.current;
    const s = Math.min(start, body.length);
    const e = Math.min(Math.max(end, s), body.length);
    const sp = s > 0 && !/\s/.test(body[s - 1]) ? ' ' : '';
    const next = body.slice(0, s) + sp + tag + body.slice(e);
    setBody(next);
    const pos = s + sp.length + tag.length;
    selection.current = { start: pos, end: pos };
    setVarPicker(false);
  };

  const addButton = (type: BtnType) => {
    const url = buttons.filter((b) => b.type === 'URL').length;
    const ph = buttons.filter((b) => b.type === 'PHONE_NUMBER').length;
    if (buttons.length >= MAX_BUTTONS) return Alert.alert('', L(`עד ${MAX_BUTTONS} כפתורים`, `Up to ${MAX_BUTTONS} buttons`));
    if (type === 'URL' && url >= MAX_URL_BUTTONS) return Alert.alert('', L(`עד ${MAX_URL_BUTTONS} כפתורי קישור`, `Up to ${MAX_URL_BUTTONS} link buttons`));
    if (type === 'PHONE_NUMBER' && ph >= MAX_PHONE_BUTTONS) return Alert.alert('', L('כפתור טלפון אחד בלבד', 'Only one phone button'));
    setButtons((b) => [...b, { id: btnSeq++, type, label: '', value: '' }]);
    setBtnPicker(false);
  };
  const patchButton = (id: number, p: Partial<Btn>) => setButtons((bs) => bs.map((b) => (b.id === id ? { ...b, ...p } : b)));

  // ── Header media ──
  const pickMedia = async (kind: MediaKind) => {
    setHeaderPicker(false);
    try {
      let media: HeaderMedia | null = null;
      if (kind === 'DOCUMENT') {
        const r = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true });
        if (r.canceled || !r.assets?.[0]) return;
        const a = r.assets[0];
        media = { kind, uri: a.uri, name: a.name || `file_${Date.now()}.pdf`, type: 'application/pdf', size: Number(a.size || 0) };
      } else {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) { Alert.alert('', L('אין הרשאה לגלריה', 'No gallery permission')); return; }
        const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: [kind === 'VIDEO' ? 'videos' : 'images'] as any, quality: 0.85 });
        if (r.canceled || !r.assets?.[0]) return;
        const a: any = r.assets[0];
        const type = String(a.mimeType || (kind === 'VIDEO' ? 'video/mp4' : 'image/jpeg')).toLowerCase();
        media = { kind, uri: a.uri, name: a.fileName || `media_${Date.now()}.${kind === 'VIDEO' ? 'mp4' : type.includes('png') ? 'png' : 'jpg'}`, type, size: Number(a.fileSize || 0) };
      }
      if (kind === 'IMAGE' && !/^image\/(jpe?g|png)$/.test(media.type)) { setError(L('תמונה חייבת להיות JPG או PNG', 'The image must be JPG or PNG')); return; }
      if (kind === 'VIDEO' && media.type !== 'video/mp4') { setError(L('וידאו חייב להיות MP4', 'The video must be MP4')); return; }
      const max = kind === 'IMAGE' ? MAX_IMAGE : kind === 'VIDEO' ? MAX_VIDEO : MAX_DOC;
      if (media.size > max) { setError(L(`הקובץ גדול מדי (עד ${Math.round(max / 1048576)}MB)`, `File too large (max ${Math.round(max / 1048576)}MB)`)); return; }
      setError('');
      setHeader({ mode: 'media', media });
    } catch (e: any) {
      Alert.alert(L('שגיאה', 'Error'), e?.message || '');
    }
  };

  /** The Meta components for what is currently typed. `mediaHandle` = the upload session handle for a media header. */
  const build = useCallback((mediaHandle?: string) => {
    const aliasesAll: Record<string, number> = {};
    const components: any[] = [];
    if (header.mode === 'text' && header.text.trim()) components.push({ type: 'HEADER', format: 'TEXT', text: header.text.trim() });
    if (header.mode === 'media') components.push({ type: 'HEADER', format: header.media.kind, example: { header_handle: [mediaHandle || ''] } });
    const b = cleanBody(body);
    const numbered = numberVars(b, examples);
    Object.assign(aliasesAll, numbered.aliases);
    const bodyComp: any = { type: 'BODY', text: numbered.text };
    if (numbered.examples.length) bodyComp.example = { body_text: [numbered.examples] };
    components.push(bodyComp);
    const ordered = orderButtons(buttons.filter((x) => x.label.trim()));
    if (ordered.length) {
      components.push({
        type: 'BUTTONS',
        buttons: ordered.map((x) => {
          if (x.type === 'QUICK_REPLY') return { type: 'QUICK_REPLY', text: x.label.trim() };
          if (x.type === 'PHONE_NUMBER') return { type: 'PHONE_NUMBER', text: x.label.trim(), phone_number: normalizePhone(x.value) };
          const u = x.value.trim();
          return { type: 'URL', text: x.label.trim(), url: u, originalUrl: u, label: x.label.trim() };
        }),
      });
    }
    const f = (footer || '').trim();
    if (f) components.push({ type: 'FOOTER', text: f });
    return { components, aliases: aliasesAll };
  }, [header, body, footer, buttons, examples]);

  const validateStep1 = (): string => {
    if (!friendlyName.trim()) return L('יש להזין שם לתבנית', 'Enter a template name');
    return '';
  };

  const validate = (): string => {
    const s1 = validateStep1();
    if (s1) return s1;
    const b = body.trim();
    if (!b) return L('יש להקליד את טקסט ההודעה', 'Type the message text');
    if (b.length > MAX_BODY) return L(`הטקסט ארוך מדי (עד ${MAX_BODY} תווים)`, `Message is too long (max ${MAX_BODY})`);
    const withoutVars = b.replace(/\{\{\s*[^{}]+?\s*\}\}/g, '');
    if (/[{}]/.test(withoutVars)) return L('משתנה חייב להיות עם שני סוגריים מסולסלים: {{שם}} (לא {שם})', 'Variables need double braces: {{name}} (not {name})');
    if (/^\{\{.*?\}\}/.test(b)) return L('ההודעה לא יכולה להתחיל במשתנה - הוסף מילה לפניו (למשל "שלום {{שם}}")', 'The message cannot start with a variable - add a word before it');
    if (/\{\{.*?\}\}$/.test(b)) return L('ההודעה לא יכולה להסתיים במשתנה - הוסף טקסט אחריו', 'The message cannot end with a variable - add text after it');
    if (/\{\{[^{}]*\}\}\s*\{\{[^{}]*\}\}/.test(b)) return L('אי אפשר לשים שני משתנים צמודים בלי טקסט ביניהם', 'Two variables need text between them');
    if (header.mode === 'text') {
      if (!header.text.trim()) return L('הכותרת ריקה - הקלד כותרת או הסר אותה', 'The header is empty - type one or remove it');
      if (header.text.includes('{{')) return L('כותרת לא יכולה לכלול משתנה (בגרסת הנייד)', 'The header cannot contain a variable here');
      if (header.text.trim().length > MAX_HEADER) return L(`הכותרת ארוכה מדי (עד ${MAX_HEADER})`, `Header too long (max ${MAX_HEADER})`);
    }
    if (footer !== null) {
      if (!footer.trim()) return L('הכותרת התחתונה ריקה - הקלד טקסט או הסר אותה', 'The footer is empty - type text or remove it');
      if (footer.includes('{{')) return L('כותרת תחתונה לא יכולה לכלול משתנה', 'The footer cannot contain a variable');
      if (footer.trim().length > MAX_FOOTER) return L(`הכותרת התחתונה ארוכה מדי (עד ${MAX_FOOTER})`, `Footer too long (max ${MAX_FOOTER})`);
    }
    for (const x of buttons) {
      if (!x.label.trim()) return L('לכל כפתור צריך טקסט', 'Every button needs a label');
      if (x.label.trim().length > MAX_BTN_LABEL) return L(`טקסט כפתור ארוך מדי (עד ${MAX_BTN_LABEL})`, `Button label too long (max ${MAX_BTN_LABEL})`);
      if (x.type === 'URL' && !/^https?:\/\/\S+\.\S+/i.test(x.value.trim())) return L('כפתור קישור צריך כתובת שמתחילה ב-https://', 'A link button needs an address starting with https://');
      if (x.type === 'URL' && x.value.includes('{{')) return L('בגרסת הנייד קישור לא יכול לכלול משתנה', 'A link cannot contain a variable here');
      if (x.type === 'PHONE_NUMBER' && normalizePhone(x.value).replace('+', '').length < 8) return L('מספר טלפון לא תקין בכפתור', 'Invalid phone number on a button');
    }
    return '';
  };

  /** Meta name = lowercase a-z/0-9/_ . The server translates a Hebrew friendly name; we fall back to a local slug. */
  const makeMetaName = async (): Promise<string> => {
    let base = '';
    try {
      const res = await axiosInstance.post('/api/Webhooks/GenerateTemplateMetaName', {
        organization: org,
        organizationName: org,
        friendlyName: friendlyName.trim(),
        category: category === 'MARKETING' ? 'Marketing' : 'Utility',
      });
      base = cleanMetaName(res.data?.name);
    } catch { /* fall through to the local slug */ }
    if (!base) base = cleanMetaName(slug(friendlyName)) || `template_${Date.now().toString().slice(-8)}`;
    const taken = (n: string) => existing.some((t) => {
      if (String(t.name || '').trim().toLowerCase() !== n) return false;
      const w = t.wabaBuisnessAccountId || t.WabaBuisnessAccountId || '';
      return wabas.length > 1 && wabaId ? !w || w === wabaId : true;
    });
    let name = base; let i = 2;
    while (taken(name)) name = `${base}_${i++}`;
    return name;
  };

  const submit = async () => {
    const v = validate();
    if (v) { setError(v); return; }
    setError('');
    setSaving(true);
    try {
      // A media header is uploaded first (Meta needs a sample file) - same call the web editor makes.
      let mediaHandle = '';
      let gmbtMediaId = '';
      if (header.mode === 'media') {
        const m = header.media;
        const fd = new FormData();
        fd.append('File', { uri: m.uri, name: m.name, type: m.type } as any);
        fd.append('Org', org);
        fd.append('file_type', m.type);
        fd.append('file_length', String(m.size || 0));
        const up = await axiosInstance.post('/api/Webhooks/CreateWabaMedia', fd, { timeout: 300000, headers: { 'Content-Type': 'multipart/form-data' } });
        mediaHandle = String(up.data?.mediaSessionId || '');
        gmbtMediaId = String(up.data?.gmbtMediaId || '');
        if (!mediaHandle) throw new Error(L('העלאת הקובץ נכשלה', 'File upload failed'));
      }
      const metaName = await makeMetaName();
      const { components, aliases } = build(mediaHandle);
      const template = { name: metaName, language: lang, category, components };
      const res = await axiosInstance.post('/api/Webhooks/CreateWabaTemplate', {
        organization: org,
        template: JSON.stringify(template, null, 2),
        gmbtMediaId,
        targetWabaId: wabas.length > 1 && wabaId ? wabaId : undefined,
        friendlyName: friendlyName.trim(),
        usageType: usage,
        variableAliases: Object.keys(aliases).length ? JSON.stringify(aliases) : undefined,
        user: { userId: user?.uID || user?.userId, userName: user?.fullname || user?.name },
      }, { timeout: 300000 });
      if (res.data?.Success === true) {
        setDone({ name: metaName, friendly: friendlyName.trim() });
      } else {
        setError(String(res.data?.Message || L('יצירת התבנית נכשלה', 'Template creation failed')));
      }
    } catch (e: any) {
      setError(String(e?.response?.data?.Message || e?.response?.data?.message || e?.message || L('יצירת התבנית נכשלה', 'Template creation failed')));
    } finally {
      setSaving(false);
    }
  };

  const resetForm = () => {
    setDone(null); setStep(1); setFriendlyName(''); setHeader({ mode: 'none' }); setBody(''); setFooter(null); setButtons([]); setExamples({}); setUsage(''); setError(''); setNewVar('');
    setHeaderPicker(false); setBtnPicker(false); setVarPicker(false);
    selection.current = { start: 0, end: 0 };
  };

  const goBack = () => {
    if (step === 2) { setStep(1); setError(''); } else router.back();
  };
  const goNext = () => {
    const v = validateStep1();
    if (v) { setError(v); return; }
    setError('');
    setStep(2);
  };

  const label = (text: string) => <Text style={[styles.label, { color: theme.colors.onSurfaceVariant, textAlign }]}>{text}</Text>;
  const input = { mode: 'outlined' as const, style: { backgroundColor: theme.colors.surface }, contentStyle: { textAlign } };

  // WhatsApp-style colors (the bubble IS the editor, so text must stay readable on the dark theme too).
  const chatBg = theme.custom?.chatBackground || theme.colors.surfaceVariant;
  const bubbleBg = theme.custom?.chatBubbleOut || '#dcf8c6';
  const rowBg = theme.custom?.chatBubbleIn || '#fff';
  const ink = theme.dark ? '#e9edef' : '#111111';
  const sub = theme.dark ? 'rgba(233,237,239,0.6)' : 'rgba(0,0,0,0.5)';
  const dashed = theme.dark ? 'rgba(233,237,239,0.35)' : 'rgba(0,0,0,0.3)';
  const bubbleInput = { color: ink, textAlign, writingDirection: isRTL ? ('rtl' as const) : ('ltr' as const), padding: 0 };

  /** A dashed "+ add" pill used inside the bubble. */
  const addPill = (text: string, onPress: () => void) => (
    <Pressable onPress={onPress} style={[styles.pill, { borderColor: dashed, flexDirection }]}>
      <MaterialCommunityIcons name="plus" size={16} color={sub} />
      <Text style={{ color: sub, fontSize: 13 }}>{text}</Text>
    </Pressable>
  );
  const removeX = (onPress: () => void) => (
    <Pressable onPress={onPress} hitSlop={10} style={styles.x}>
      <MaterialCommunityIcons name="close-circle" size={20} color={sub} />
    </Pressable>
  );

  if (done) {
    return (
      <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
        <ScreenHeader title={L('תבנית חדשה', 'New template')} onBack={() => router.back()} />
        <View style={styles.doneWrap}>
          <MaterialCommunityIcons name="check-circle" size={64} color="#16a34a" />
          <Text style={[styles.doneTitle, { color: theme.colors.onSurface }]}>{L('התבנית נשלחה לאישור', 'Template sent for approval')}</Text>
          <Text style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center', marginTop: 6 }}>{done.friendly}</Text>
          <Text style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center', marginTop: 12, lineHeight: 20 }}>
            {L('WhatsApp בודק כל תבנית - בדרך כלל זה לוקח דקות ולפעמים עד כמה שעות. כשהסטטוס יהפוך ל"מאושרת" אפשר לשלוח אותה בקמפיין (רענון ברשימה מושך את הסטטוס העדכני).',
              'WhatsApp reviews every template - usually minutes, sometimes a few hours. Once it shows "Approved" you can use it in a campaign (pull to refresh the list for the latest status).')}
          </Text>
          <Button mode="contained" style={{ marginTop: 24, alignSelf: 'stretch' }} onPress={() => router.replace('/(tabs)/more/templates' as any)}>
            {L('לרשימת התבניות', 'Back to templates')}
          </Button>
          <Button mode="outlined" style={{ marginTop: 10, alignSelf: 'stretch' }} icon="bullhorn-outline" onPress={() => router.replace('/(tabs)/more/campaigns' as any)}>
            {L('לקמפיינים', 'Go to campaigns')}
          </Button>
          <Button mode="text" style={{ marginTop: 6 }} onPress={resetForm}>{L('יצירת תבנית נוספת', 'Create another template')}</Button>
        </View>
      </View>
    );
  }

  const stepper = (
    <View style={[styles.stepper, { flexDirection, backgroundColor: theme.colors.surface, borderBottomColor: theme.colors.outlineVariant }]}>
      {[{ n: 1, t: L('פרטים', 'Details') }, { n: 2, t: L('עיצוב ההודעה', 'Design the message') }].map(({ n, t }) => {
        const active = step === n;
        const passed = step > n;
        return (
          <View key={n} style={[styles.stepItem, { flexDirection }]}>
            <View style={[styles.stepDot, { backgroundColor: active || passed ? theme.colors.primary : theme.colors.surfaceVariant }]}>
              {passed ? <MaterialCommunityIcons name="check" size={14} color="#fff" /> : <Text style={{ color: active ? '#fff' : theme.colors.onSurfaceVariant, fontSize: 12, fontWeight: '800' }}>{n}</Text>}
            </View>
            <Text style={{ fontWeight: active ? '800' : '500', color: active ? theme.colors.onSurface : theme.colors.onSurfaceVariant, fontSize: 13 }}>{t}</Text>
          </View>
        );
      })}
    </View>
  );

  const errorBox = error ? (
    <View style={styles.errBox}>
      <Text style={{ color: '#991b1b', textAlign }}>{error}</Text>
    </View>
  ) : null;

  // ───────────── Step 1: name · type · language ─────────────
  if (step === 1) {
    return (
      <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
        <ScreenHeader title={L('תבנית WhatsApp חדשה', 'New WhatsApp template')} onBack={goBack} />
        {stepper}
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
            {label(L('שם התבנית (לשימוש פנימי)', 'Template name (internal)'))}
            <TextInput {...input} value={friendlyName} onChangeText={setFriendlyName} placeholder={L('למשל: תזכורת לפגישה', 'e.g. Meeting reminder')} />

            {label(L('סוג התבנית', 'Type'))}
            {([
              { key: 'UTILITY', icon: 'bell-outline', t: L('שירות / עדכון', 'Utility'), d: L('פגישה, הצעה, הזמנה, מעקב - הכי קל לאישור', 'Meeting, quote, order, follow-up - easiest to approve') },
              { key: 'MARKETING', icon: 'bullhorn-outline', t: L('שיווק', 'Marketing'), d: L('מבצעים ופרסום לקהל שיווקי', 'Promotions and offers') },
            ] as const).map((c) => {
              const on = category === c.key;
              return (
                <Pressable
                  key={c.key}
                  onPress={() => setCategory(c.key)}
                  style={[styles.typeCard, { flexDirection, borderColor: on ? theme.colors.primary : theme.colors.outlineVariant, backgroundColor: on ? theme.colors.primary + '14' : theme.colors.surface }]}
                >
                  <MaterialCommunityIcons name={c.icon as any} size={24} color={on ? theme.colors.primary : theme.colors.onSurfaceVariant} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: '800', color: theme.colors.onSurface, textAlign }}>{c.t}</Text>
                    <Text style={{ fontSize: 12, color: theme.colors.onSurfaceVariant, textAlign, marginTop: 2 }}>{c.d}</Text>
                  </View>
                  <MaterialCommunityIcons name={on ? 'radiobox-marked' : 'radiobox-blank'} size={22} color={on ? theme.colors.primary : theme.colors.onSurfaceVariant} />
                </Pressable>
              );
            })}

            {label(L('שפה', 'Language'))}
            <View style={[styles.chips, { flexDirection }]}>
              {LANGS.map((l) => (
                <Chip key={l.code} selected={lang === l.code} showSelectedOverlay onPress={() => setLang(l.code)}>{isRTL ? l.he : l.en}</Chip>
              ))}
            </View>

            {wabas.length > 1 ? (
              <>
                {label(L('חשבון WhatsApp', 'WhatsApp account'))}
                <View style={[styles.chips, { flexDirection }]}>
                  {wabas.map((w) => (
                    <Chip key={w.id} selected={wabaId === w.id} showSelectedOverlay onPress={() => setWabaId(w.id)}>{w.label}</Chip>
                  ))}
                </View>
              </>
            ) : null}

            <Pressable onPress={() => setMoreOpen((o) => !o)} style={[styles.moreRow, { flexDirection }]}>
              <Text style={{ color: theme.colors.primary, fontWeight: '700' }}>{L('אפשרויות נוספות', 'More options')}</Text>
              <MaterialCommunityIcons name={moreOpen ? 'chevron-up' : 'chevron-down'} size={20} color={theme.colors.primary} />
            </Pressable>
            {moreOpen ? (
              <>
                {label(L('שימוש (אופציונלי)', 'Use (optional)'))}
                <View style={[styles.chips, { flexDirection }]}>
                  {USAGE.map((u) => (
                    <Chip key={u.value} selected={usage === u.value} showSelectedOverlay onPress={() => setUsage(usage === u.value ? '' : u.value)}>{isRTL ? u.he : u.en}</Chip>
                  ))}
                </View>
              </>
            ) : null}
            {errorBox}
          </ScrollView>
          <View style={[styles.bar, { backgroundColor: theme.colors.surface, borderTopColor: theme.colors.outlineVariant, paddingBottom: insets.bottom + 10 }]}>
            <Button mode="contained" style={{ flex: 1 }} contentStyle={{ paddingVertical: 6 }} icon={isRTL ? 'arrow-left' : 'arrow-right'} onPress={goNext}>
              {L('המשך לעיצוב ההודעה', 'Continue')}
            </Button>
          </View>
        </KeyboardAvoidingView>
      </View>
    );
  }

  // ───────────── Step 2: edit ON the preview ─────────────
  const media = header.mode === 'media' ? header.media : null;
  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
      <ScreenHeader title={friendlyName.trim() || L('עיצוב ההודעה', 'Design the message')} onBack={goBack} />
      {stepper}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView style={{ backgroundColor: chatBg }} contentContainerStyle={{ padding: 14, paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
          <Text style={{ textAlign: 'center', color: sub, fontSize: 12, marginBottom: 10 }}>
            {L('לחץ על כל חלק בהודעה כדי לערוך אותו', 'Tap any part of the message to edit it')}
          </Text>

          <View style={[styles.bubble, { backgroundColor: bubbleBg }]}>
            {/* Header: text / image / video / PDF */}
            {header.mode === 'none' ? (
              <>
                {addPill(L('כותרת (טקסט / תמונה / וידאו / מסמך)', 'Header (text / image / video / document)'), () => setHeaderPicker((p) => !p))}
                {headerPicker ? (
                  <View style={[styles.chips, { flexDirection, marginTop: 6 }]}>
                    <Chip compact icon="format-title" onPress={() => { setHeader({ mode: 'text', text: '' }); setHeaderPicker(false); }}>{L('טקסט', 'Text')}</Chip>
                    {(['IMAGE', 'VIDEO', 'DOCUMENT'] as MediaKind[]).map((k) => (
                      <Chip key={k} compact icon={MEDIA_META[k].icon as any} onPress={() => pickMedia(k)}>{isRTL ? MEDIA_META[k].he : MEDIA_META[k].en}</Chip>
                    ))}
                  </View>
                ) : null}
              </>
            ) : header.mode === 'text' ? (
              <View style={styles.editRow}>
                <RNTextInput
                  value={header.text}
                  onChangeText={(t) => setHeader({ mode: 'text', text: t })}
                  maxLength={MAX_HEADER}
                  autoFocus={header.text === ''}
                  placeholder={L('כותרת מודגשת…', 'Bold header…')}
                  placeholderTextColor={sub}
                  style={[styles.headerInput, bubbleInput, { flex: 1 }]}
                />
                {removeX(() => setHeader({ mode: 'none' }))}
              </View>
            ) : (
              <View>
                <Pressable onPress={() => pickMedia(media!.kind)} style={[styles.mediaTile, { backgroundColor: 'rgba(0,0,0,0.08)' }]}>
                  {media!.kind === 'IMAGE' ? (
                    <Image source={{ uri: media!.uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                  ) : (
                    <View style={{ alignItems: 'center', gap: 4 }}>
                      <MaterialCommunityIcons name={MEDIA_META[media!.kind].icon as any} size={38} color={sub} />
                      <Text numberOfLines={1} style={{ color: sub, fontSize: 12, maxWidth: 220 }}>{media!.name}</Text>
                    </View>
                  )}
                  <View style={styles.replaceBadge}>
                    <MaterialCommunityIcons name="swap-horizontal" size={14} color="#fff" />
                    <Text style={{ color: '#fff', fontSize: 11 }}>{L('החלף', 'Replace')}</Text>
                  </View>
                </Pressable>
                <View style={styles.xFloat}>{removeX(() => setHeader({ mode: 'none' }))}</View>
              </View>
            )}

            {/* Body */}
            <RNTextInput
              value={body}
              onChangeText={onBodyChange}
              multiline
              maxLength={MAX_BODY}
              onSelectionChange={(e) => { selection.current = e.nativeEvent.selection; }}
              placeholder={L('הקלד את ההודעה… למשל: שלום {{שם}}, מזכירים לך את הפגישה שלנו מחר.', 'Type the message… e.g. Hi {{name}}, a reminder about our meeting tomorrow.')}
              placeholderTextColor={sub}
              style={[styles.bodyInput, bubbleInput]}
            />

            {/* Variable: type a name + "+" (or "+" alone for suggestions). Right under the body, above the footer. */}
            <View style={[styles.varBar, { borderColor: dashed, flexDirection }]}>
              <MaterialCommunityIcons name="code-braces" size={16} color={sub} />
              <RNTextInput
                value={newVar}
                onChangeText={setNewVar}
                onSubmitEditing={onPlusVar}
                returnKeyType="done"
                placeholder={L('משתנה: הקלד שם ולחץ +', 'Variable: type a name, tap +')}
                placeholderTextColor={sub}
                style={[styles.varInput, { color: ink, textAlign, writingDirection: isRTL ? 'rtl' : 'ltr' }]}
              />
              <Pressable onPress={onPlusVar} hitSlop={8} style={[styles.varPlus, { backgroundColor: theme.colors.primary }]}>
                <MaterialCommunityIcons name="plus" size={18} color="#fff" />
              </Pressable>
            </View>
            {varPicker ? (
              <View style={[styles.chips, { flexDirection }]}>
                {VAR_SUGGESTIONS.map((s) => (
                  <Chip key={s.he} compact icon="plus" onPress={() => { addVar(isRTL ? s.he : s.en); }} textStyle={{ fontSize: 12 }}>{isRTL ? s.he : s.en}</Chip>
                ))}
              </View>
            ) : null}

            {/* Footer */}
            {footer === null ? (
              addPill(L('כותרת תחתונה', 'Footer'), () => setFooter(category === 'MARKETING' ? OPT_OUT_FOOTER : ''))
            ) : (
              <View style={styles.editRow}>
                <RNTextInput
                  value={footer}
                  onChangeText={setFooter}
                  maxLength={MAX_FOOTER}
                  autoFocus={footer === ''}
                  placeholder={L('שורה קטנה בתחתית…', 'A small line at the bottom…')}
                  placeholderTextColor={sub}
                  style={[styles.footerInput, bubbleInput, { color: sub, flex: 1 }]}
                />
                {removeX(() => setFooter(null))}
              </View>
            )}
          </View>

          {/* Buttons - shown like WhatsApp does: separate rows under the bubble */}
          {buttons.map((b) => (
            <View key={b.id} style={[styles.btnRow, { backgroundColor: rowBg }]}>
              <View style={[styles.editRow, { flexDirection }]}>
                <MaterialCommunityIcons name={BTN_META[b.type].icon as any} size={18} color="#0a7cff" />
                <RNTextInput
                  value={b.label}
                  onChangeText={(t) => patchButton(b.id, { label: t })}
                  maxLength={MAX_BTN_LABEL}
                  autoFocus={b.label === '' && b.value === ''}
                  placeholder={L(`טקסט הכפתור (${BTN_META[b.type].he})`, `Button text (${BTN_META[b.type].en})`)}
                  placeholderTextColor="rgba(10,124,255,0.5)"
                  style={[styles.btnInput, { flex: 1 }]}
                />
                {removeX(() => setButtons((bs) => bs.filter((x) => x.id !== b.id)))}
              </View>
              {b.type !== 'QUICK_REPLY' ? (
                <RNTextInput
                  value={b.value}
                  onChangeText={(t) => patchButton(b.id, { value: t })}
                  autoCapitalize="none"
                  keyboardType={b.type === 'PHONE_NUMBER' ? 'phone-pad' : 'url'}
                  placeholder={b.type === 'URL' ? 'https://...' : '+972501234567'}
                  placeholderTextColor="rgba(0,0,0,0.35)"
                  style={[styles.btnValue, { color: theme.dark ? '#e9edef' : '#444' }]}
                />
              ) : null}
            </View>
          ))}
          {addPill(L('כפתור', 'Button'), () => setBtnPicker((p) => !p))}
          {btnPicker ? (
            <View style={[styles.chips, { flexDirection, marginTop: 6 }]}>
              {(['QUICK_REPLY', 'URL', 'PHONE_NUMBER'] as BtnType[]).map((t) => (
                <Chip key={t} compact icon={BTN_META[t].icon as any} onPress={() => addButton(t)}>{isRTL ? BTN_META[t].he : BTN_META[t].en}</Chip>
              ))}
            </View>
          ) : null}

          {/* Sample for each variable (helps Meta approve) - below the whole preview */}
          {vars.length > 0 ? (
            <View style={[styles.tool, { backgroundColor: theme.colors.surface }]}>
              <Text style={{ fontSize: 12, fontWeight: '700', color: theme.colors.onSurface, textAlign, marginBottom: 6 }}>{L('דוגמה לכל משתנה (עוזר לאישור)', 'Sample for each variable (helps approval)')}</Text>
              {vars.map((v) => (
                <View key={v} style={[styles.exRow, { flexDirection }]}>
                  <Text style={{ width: 90, color: theme.colors.onSurfaceVariant, textAlign }} numberOfLines={1}>{`{{${v}}}`}</Text>
                  <TextInput
                    {...input}
                    dense
                    style={[input.style, { flex: 1 }]}
                    value={examples[v] || ''}
                    onChangeText={(t) => setExamples((e) => ({ ...e, [v]: t }))}
                    placeholder={L('למשל: דנה', 'e.g. Dana')}
                  />
                </View>
              ))}
            </View>
          ) : null}

          {errorBox}
        </ScrollView>
        <View style={[styles.bar, { backgroundColor: theme.colors.surface, borderTopColor: theme.colors.outlineVariant, paddingBottom: insets.bottom + 10, flexDirection }]}>
          <Button mode="outlined" disabled={saving} onPress={goBack}>{L('חזרה', 'Back')}</Button>
          <Button mode="contained" style={{ flex: 1 }} contentStyle={{ paddingVertical: 6 }} disabled={saving} onPress={submit} icon={saving ? undefined : 'send'}>
            {saving ? <ActivityIndicator size={16} color="white" /> : L('שלח לאישור WhatsApp', 'Submit to WhatsApp')}
          </Button>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  label: { fontSize: 13, fontWeight: '700', marginTop: 16, marginBottom: 6 },
  chips: { flexWrap: 'wrap', gap: 8 },
  exRow: { alignItems: 'center', gap: 8, marginBottom: 6 },
  errBox: { backgroundColor: '#fee2e2', borderRadius: 10, padding: 12, marginTop: 14 },
  doneWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  doneTitle: { fontSize: 20, fontWeight: '800', marginTop: 14 },
  stepper: { alignItems: 'center', justifyContent: 'center', gap: 24, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  stepItem: { alignItems: 'center', gap: 8 },
  stepDot: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  typeCard: { alignItems: 'center', gap: 12, borderWidth: 1.5, borderRadius: 12, padding: 12, marginBottom: 8 },
  moreRow: { alignItems: 'center', gap: 4, marginTop: 18 },
  bar: { flexDirection: 'row', gap: 10, paddingHorizontal: 14, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth },
  bubble: { borderRadius: 12, padding: 10, gap: 8 },
  varBar: { alignItems: 'center', gap: 6, borderWidth: 1, borderStyle: 'dashed', borderRadius: 16, paddingStart: 10, paddingEnd: 4, paddingVertical: 3 },
  varInput: { flex: 1, fontSize: 13, padding: 0, minHeight: 26 },
  varPlus: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  editRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  x: { padding: 2 },
  xFloat: { position: 'absolute', top: 4, end: 4 },
  pill: { alignSelf: 'flex-start', alignItems: 'center', gap: 4, borderWidth: 1, borderStyle: 'dashed', borderRadius: 16, paddingHorizontal: 10, paddingVertical: 5 },
  headerInput: { fontSize: 16, fontWeight: '700' },
  bodyInput: { fontSize: 15, lineHeight: 22, minHeight: 90, textAlignVertical: 'top' },
  footerInput: { fontSize: 12 },
  mediaTile: { height: 150, borderRadius: 8, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  replaceBadge: { position: 'absolute', bottom: 6, start: 6, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  tool: { borderRadius: 12, padding: 12, marginTop: 10 },
  toolHead: { alignItems: 'center', gap: 8 },
  btnRow: { borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12, marginTop: 6 },
  btnInput: { color: '#0a7cff', fontSize: 15, fontWeight: '600', textAlign: 'center', padding: 0 },
  btnValue: { fontSize: 12, textAlign: 'center', marginTop: 6, padding: 0, writingDirection: 'ltr' },
});
