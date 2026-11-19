import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, ScrollView, KeyboardAvoidingView, Platform, Alert, Pressable } from 'react-native';
import { Text, TextInput, Chip, Button, ActivityIndicator, IconButton, Switch } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '../../../../stores/authStore';
import { useAppTheme } from '../../../../hooks/useAppTheme';
import { useRTL } from '../../../../hooks/useRTL';
import { ScreenHeader } from '../../../../components/ScreenHeader';
import TemplateBubble from '../../../../components/campaigns/whatsapp/TemplateBubble';
import { analyzeTemplate } from '../../../../components/campaigns/whatsapp/campaignUtils';
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

type BtnType = 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER';
interface Btn { id: number; type: BtnType; label: string; value: string }

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
  { he: 'חברה', en: 'company' },
  { he: 'תאריך', en: 'date' },
  { he: 'שעה', en: 'time' },
  { he: 'סכום', en: 'amount' },
  { he: 'קישור', en: 'link' },
];
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

let btnSeq = 1;

/** Create a WhatsApp message template (text header/body/footer + buttons) straight from the phone. */
export default function NewTemplateScreen() {
  const router = useRouter();
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const { isRTL, textAlign, flexDirection } = useRTL();
  const L = (he: string, en: string) => (isRTL ? he : en);
  const user = useAuthStore((s) => s.user) as any;
  const org: string = user?.organization || '';

  const [friendlyName, setFriendlyName] = useState('');
  const [category, setCategory] = useState<'UTILITY' | 'MARKETING'>('UTILITY');
  const [lang, setLang] = useState('he');
  const [usage, setUsage] = useState('');
  const [header, setHeader] = useState('');
  const [body, setBody] = useState('');
  const [footer, setFooter] = useState('');
  const [buttons, setButtons] = useState<Btn[]>([]);
  const [examples, setExamples] = useState<Record<string, string>>({});
  const [showPreview, setShowPreview] = useState(true);

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
  };

  const addButton = (type: BtnType) => {
    const url = buttons.filter((b) => b.type === 'URL').length;
    const ph = buttons.filter((b) => b.type === 'PHONE_NUMBER').length;
    if (buttons.length >= MAX_BUTTONS) return Alert.alert('', L(`עד ${MAX_BUTTONS} כפתורים`, `Up to ${MAX_BUTTONS} buttons`));
    if (type === 'URL' && url >= MAX_URL_BUTTONS) return Alert.alert('', L(`עד ${MAX_URL_BUTTONS} כפתורי קישור`, `Up to ${MAX_URL_BUTTONS} link buttons`));
    if (type === 'PHONE_NUMBER' && ph >= MAX_PHONE_BUTTONS) return Alert.alert('', L('כפתור טלפון אחד בלבד', 'Only one phone button'));
    setButtons((b) => [...b, { id: btnSeq++, type, label: '', value: '' }]);
  };
  const patchButton = (id: number, p: Partial<Btn>) => setButtons((bs) => bs.map((b) => (b.id === id ? { ...b, ...p } : b)));

  /** The Meta components for what is currently typed (also drives the live preview). */
  const build = useCallback(() => {
    const aliasesAll: Record<string, number> = {};
    const components: any[] = [];
    const h = header.trim();
    if (h) components.push({ type: 'HEADER', format: 'TEXT', text: h });
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
    const f = footer.trim();
    if (f) components.push({ type: 'FOOTER', text: f });
    return { components, aliases: aliasesAll, numberedBody: numbered.text, exampleList: numbered.examples };
  }, [header, body, footer, buttons, examples]);

  const previewInfo = useMemo(() => {
    const { components } = build();
    const info = analyzeTemplate({ name: 'preview', components } as WaTemplate, isRTL);
    // Show the sample values (or the variable name) instead of {{1}}.
    let shown = cleanBody(body);
    shown = shown.replace(new RegExp(VAR_RE.source, 'g'), (_m, raw) => (examples[String(raw).trim()] || '').trim() || `{{${String(raw).trim()}}}`);
    return { info, shown };
  }, [build, body, examples, isRTL]);

  const validate = (): string => {
    if (!friendlyName.trim()) return L('יש להזין שם לתבנית', 'Enter a template name');
    const b = body.trim();
    if (!b) return L('יש להזין טקסט להודעה', 'Enter the message text');
    if (b.length > MAX_BODY) return L(`הטקסט ארוך מדי (עד ${MAX_BODY} תווים)`, `Message is too long (max ${MAX_BODY})`);
    const withoutVars = b.replace(/\{\{\s*[^{}]+?\s*\}\}/g, '');
    if (/[{}]/.test(withoutVars)) return L('משתנה חייב להיות עם שני סוגריים מסולסלים: {{שם}} (לא {שם})', 'Variables need double braces: {{name}} (not {name})');
    if (/^\{\{.*?\}\}/.test(b)) return L('ההודעה לא יכולה להתחיל במשתנה - הוסף מילה לפניו (למשל "שלום {{שם}}")', 'The message cannot start with a variable - add a word before it');
    if (/\{\{.*?\}\}$/.test(b)) return L('ההודעה לא יכולה להסתיים במשתנה - הוסף טקסט אחריו', 'The message cannot end with a variable - add text after it');
    if (/\{\{[^{}]*\}\}\s*\{\{[^{}]*\}\}/.test(b)) return L('אי אפשר לשים שני משתנים צמודים בלי טקסט ביניהם', 'Two variables need text between them');
    if (header.includes('{{')) return L('כותרת לא יכולה לכלול משתנה (בגרסת הנייד)', 'The header cannot contain a variable here');
    if (header.trim().length > MAX_HEADER) return L(`הכותרת ארוכה מדי (עד ${MAX_HEADER})`, `Header too long (max ${MAX_HEADER})`);
    if (footer.includes('{{')) return L('כותרת תחתונה לא יכולה לכלול משתנה', 'The footer cannot contain a variable');
    if (footer.trim().length > MAX_FOOTER) return L(`הכותרת התחתונה ארוכה מדי (עד ${MAX_FOOTER})`, `Footer too long (max ${MAX_FOOTER})`);
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
      const metaName = await makeMetaName();
      const { components, aliases } = build();
      const template = { name: metaName, language: lang, category, components };
      const res = await axiosInstance.post('/api/Webhooks/CreateWabaTemplate', {
        organization: org,
        template: JSON.stringify(template, null, 2),
        gmbtMediaId: '',
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
    setDone(null); setFriendlyName(''); setHeader(''); setBody(''); setFooter(''); setButtons([]); setExamples({}); setUsage(''); setError('');
    selection.current = { start: 0, end: 0 };
  };

  const label = (text: string) => <Text style={[styles.label, { color: theme.colors.onSurfaceVariant, textAlign }]}>{text}</Text>;
  const input = { mode: 'outlined' as const, style: { backgroundColor: theme.colors.surface }, contentStyle: { textAlign } };

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

  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
      <ScreenHeader title={L('תבנית WhatsApp חדשה', 'New WhatsApp template')} onBack={() => router.back()} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled">
          {label(L('שם התבנית (לשימוש פנימי)', 'Template name (internal)'))}
          <TextInput {...input} value={friendlyName} onChangeText={setFriendlyName} placeholder={L('למשל: תזכורת לפגישה', 'e.g. Meeting reminder')} />

          {label(L('סוג התבנית', 'Category'))}
          <View style={[styles.chips, { flexDirection }]}>
            <Chip selected={category === 'UTILITY'} showSelectedOverlay onPress={() => setCategory('UTILITY')}>{L('שירות / עדכון', 'Utility')}</Chip>
            <Chip selected={category === 'MARKETING'} showSelectedOverlay onPress={() => setCategory('MARKETING')}>{L('שיווק', 'Marketing')}</Chip>
          </View>
          <Text style={[styles.hint, { color: theme.colors.onSurfaceVariant, textAlign }]}>
            {category === 'MARKETING'
              ? L('הודעות פרסום/מבצעים. מאפשר שליחה לקהל שיווקי.', 'Promotions / offers. Use for marketing blasts.')
              : L('הודעות על פגישה, הצעה, הזמנה, מעקב - הכי קל לאישור.', 'Messages about a meeting, quote, order, follow-up - easiest to approve.')}
          </Text>

          {label(L('שפה', 'Language'))}
          <View style={[styles.chips, { flexDirection }]}>
            {LANGS.map((l) => (
              <Chip key={l.code} selected={lang === l.code} showSelectedOverlay onPress={() => setLang(l.code)}>{isRTL ? l.he : l.en}</Chip>
            ))}
          </View>

          {label(L('שימוש (אופציונלי)', 'Use (optional)'))}
          <View style={[styles.chips, { flexDirection }]}>
            {USAGE.map((u) => (
              <Chip key={u.value} selected={usage === u.value} showSelectedOverlay onPress={() => setUsage(usage === u.value ? '' : u.value)}>{isRTL ? u.he : u.en}</Chip>
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

          {label(L('כותרת (אופציונלי)', 'Header (optional)'))}
          <TextInput {...input} value={header} onChangeText={setHeader} maxLength={MAX_HEADER} placeholder={L('שורה קצרה מודגשת בראש ההודעה', 'A short bold line on top')} />

          {label(L('טקסט ההודעה', 'Message text'))}
          <TextInput
            {...input}
            value={body}
            onChangeText={setBody}
            multiline
            numberOfLines={6}
            maxLength={MAX_BODY}
            style={[input.style, { minHeight: 140 }]}
            onSelectionChange={(e) => { selection.current = e.nativeEvent.selection; }}
            placeholder={L('שלום {{שם}}, מזכירים לך את הפגישה שלנו מחר.', 'Hi {{name}}, a reminder about our meeting tomorrow.')}
          />
          <Text style={[styles.hint, { color: theme.colors.onSurfaceVariant, textAlign }]}>
            {L('הוספת משתנה (ימולא אוטומטית לכל איש קשר). ההודעה לא יכולה להתחיל או להסתיים במשתנה.', 'Insert a variable (filled per contact). The message cannot start or end with one.')}
          </Text>
          <View style={[styles.chips, { flexDirection }]}>
            {VAR_SUGGESTIONS.map((s) => (
              <Chip key={s.he} compact icon="plus" onPress={() => addVar(isRTL ? s.he : s.en)} textStyle={{ fontSize: 12 }}>{isRTL ? s.he : s.en}</Chip>
            ))}
          </View>

          {vars.length > 0 ? (
            <View style={[styles.box, { borderColor: theme.colors.outlineVariant }]}>
              <Text style={[styles.boxTitle, { color: theme.colors.onSurface, textAlign }]}>{L('דוגמה לכל משתנה (עוזר לאישור)', 'Sample for each variable (helps approval)')}</Text>
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

          {label(L('כותרת תחתונה (אופציונלי)', 'Footer (optional)'))}
          <TextInput {...input} value={footer} onChangeText={setFooter} maxLength={MAX_FOOTER} placeholder={L('שורה קטנה בתחתית ההודעה', 'A small line at the bottom')} />
          {category === 'MARKETING' || usage ? (
            <View style={[styles.chips, { flexDirection, marginTop: 6 }]}>
              <Chip compact icon="plus" onPress={() => setFooter(OPT_OUT_FOOTER)} textStyle={{ fontSize: 12 }}>{L('הוסף: להסרה יש להשיב הסר', 'Add opt-out line (Hebrew)')}</Chip>
            </View>
          ) : null}

          {label(L('כפתורים (אופציונלי)', 'Buttons (optional)'))}
          {buttons.map((b) => (
            <View key={b.id} style={[styles.box, { borderColor: theme.colors.outlineVariant }]}>
              <View style={[styles.exRow, { flexDirection, justifyContent: 'space-between' }]}>
                <View style={{ flexDirection, alignItems: 'center', gap: 6 }}>
                  <MaterialCommunityIcons name={b.type === 'URL' ? 'open-in-new' : b.type === 'PHONE_NUMBER' ? 'phone' : 'reply'} size={18} color={theme.colors.primary} />
                  <Text style={{ fontWeight: '700', color: theme.colors.onSurface }}>
                    {b.type === 'URL' ? L('קישור לאתר', 'Website link') : b.type === 'PHONE_NUMBER' ? L('חיוג', 'Call') : L('תשובה מהירה', 'Quick reply')}
                  </Text>
                </View>
                <IconButton icon="delete-outline" size={20} onPress={() => setButtons((bs) => bs.filter((x) => x.id !== b.id))} />
              </View>
              <TextInput {...input} dense value={b.label} maxLength={MAX_BTN_LABEL} onChangeText={(t) => patchButton(b.id, { label: t })} placeholder={L('טקסט הכפתור', 'Button text')} />
              {b.type !== 'QUICK_REPLY' ? (
                <TextInput
                  {...input}
                  dense
                  style={[input.style, { marginTop: 8 }]}
                  value={b.value}
                  autoCapitalize="none"
                  keyboardType={b.type === 'PHONE_NUMBER' ? 'phone-pad' : 'url'}
                  onChangeText={(t) => patchButton(b.id, { value: t })}
                  placeholder={b.type === 'URL' ? 'https://...' : '+972501234567'}
                />
              ) : null}
            </View>
          ))}
          <View style={[styles.chips, { flexDirection }]}>
            <Chip icon="reply" onPress={() => addButton('QUICK_REPLY')}>{L('תשובה מהירה', 'Quick reply')}</Chip>
            <Chip icon="open-in-new" onPress={() => addButton('URL')}>{L('קישור', 'Link')}</Chip>
            <Chip icon="phone" onPress={() => addButton('PHONE_NUMBER')}>{L('חיוג', 'Call')}</Chip>
          </View>
          <Text style={[styles.hint, { color: theme.colors.onSurfaceVariant, textAlign }]}>
            {L('תמונה/וידאו/מסמך בראש ההודעה - ליצירה בפורטל.', 'Image / video / document headers are created in the web app.')}
          </Text>

          <Pressable onPress={() => setShowPreview((s) => !s)} style={[styles.exRow, { flexDirection, marginTop: 16 }]}>
            <Text style={[styles.label, { color: theme.colors.onSurface, marginTop: 0 }]}>{L('תצוגה מקדימה', 'Preview')}</Text>
            <Switch value={showPreview} onValueChange={setShowPreview} />
          </Pressable>
          {showPreview && body.trim() ? <TemplateBubble info={previewInfo.info} bodyText={previewInfo.shown} he={isRTL} /> : null}

          {error ? (
            <View style={styles.errBox}>
              <Text style={{ color: '#991b1b', textAlign }}>{error}</Text>
            </View>
          ) : null}

          <Button mode="contained" style={{ marginTop: 18 }} contentStyle={{ paddingVertical: 6 }} disabled={saving} onPress={submit} icon={saving ? undefined : 'send'}>
            {saving ? <ActivityIndicator size={16} color="white" /> : L('שלח לאישור WhatsApp', 'Submit to WhatsApp')}
          </Button>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  label: { fontSize: 13, fontWeight: '700', marginTop: 16, marginBottom: 6 },
  hint: { fontSize: 11, marginTop: 6, lineHeight: 16 },
  chips: { flexWrap: 'wrap', gap: 8 },
  box: { borderWidth: 1, borderRadius: 10, padding: 10, marginTop: 10 },
  boxTitle: { fontSize: 12, fontWeight: '700', marginBottom: 8 },
  exRow: { alignItems: 'center', gap: 8, marginBottom: 6 },
  errBox: { backgroundColor: '#fee2e2', borderRadius: 10, padding: 12, marginTop: 14 },
  doneWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  doneTitle: { fontSize: 20, fontWeight: '800', marginTop: 14 },
});
