import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Alert,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  Modal,
} from 'react-native';
import { Text, TextInput, Button, SegmentedButtons, ActivityIndicator, Chip, Divider } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../../../stores/authStore';
import { useAppTheme } from '../../../../hooks/useAppTheme';
import { useRTL } from '../../../../hooks/useRTL';
import GambotDateTimePicker from '../../../../components/GambotDateTimePicker';
import type { Connection } from '../../../../services/api/calendar';
import {
  EmailCampaignDetails,
  EmailCampaignInput,
  EmailContactFilters,
  EmailContentSource,
  EmailTemplateInfo,
  EmailTemplateVariable,
  emailCampaignsApi,
  errorMessage,
} from '../../../../services/api/emailCampaigns';
import EmailScreenHeader from '../../../../components/campaigns/email/EmailScreenHeader';
import EmailHtmlPreview from '../../../../components/campaigns/email/EmailHtmlPreview';
import EmailAudienceEditor, { cleanFilters, isFilterComplete } from '../../../../components/campaigns/email/EmailAudienceEditor';
import EmailVariableMapper from '../../../../components/campaigns/email/EmailVariableMapper';
import PickerSheet from '../../../../components/campaigns/email/PickerSheet';
import {
  BRAND,
  applySampleVariables,
  contentToHtml,
  deviceTimeZone,
  formatDateTime,
  parseRunAt,
} from '../../../../components/campaigns/email/emailCampaignHelpers';

const connLabel = (c: Connection) => `${c.provider === 'google' ? 'Google' : 'Microsoft'} — ${c.email || c.name || c.id}`;

/** Re-aligns saved variable mappings with the template's current variable list (keeps existing mappings by name). */
function mergeVariables(tpl: EmailTemplateInfo | undefined, existing: EmailTemplateVariable[]): EmailTemplateVariable[] {
  if (!tpl) return existing;
  return tpl.variables.map((name, i) => {
    const prev = existing.find((v) => v.variable === name);
    return (
      prev || {
        index: i + 1,
        variable: name,
        dataSource: '',
        contactField: '',
        customTable: '',
        customTableField: '',
        hardCodedValue: '',
      }
    );
  });
}

function Section({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  const theme = useAppTheme();
  const { flexDirection, textAlign } = useRTL();
  return (
    <View style={[styles.section, { backgroundColor: theme.colors.surface, borderColor: theme.colors.outline }]}>
      <View style={[styles.sectionHeader, { flexDirection }]}>
        <MaterialCommunityIcons name={icon as any} size={18} color={BRAND} />
        <Text style={{ flex: 1, textAlign, fontWeight: '700', fontSize: 15, color: theme.colors.onSurface }}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

export default function EmailCampaignFormScreen() {
  const { id: routeId } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const { flexDirection, textAlign, isRTL } = useRTL();
  const { i18n } = useTranslation();
  const he = i18n.language !== 'en';
  const { user } = useAuthStore();
  const org = user?.organization || '';
  const userInfo = useMemo(
    () => ({ userId: user?.uID || user?.userId || '', userName: user?.fullname || user?.name || user?.email || '' }),
    [user],
  );

  const [campaignId, setCampaignId] = useState<string | undefined>(routeId || undefined);
  const [details, setDetails] = useState<EmailCampaignDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);

  const [connections, setConnections] = useState<Connection[]>([]);
  const [templates, setTemplates] = useState<EmailTemplateInfo[]>([]);
  const [columns, setColumns] = useState<string[]>([]);

  // form
  const [name, setName] = useState('');
  const [provider, setProvider] = useState('');
  const [contentSource, setContentSource] = useState<EmailContentSource>('template');
  const [templateId, setTemplateId] = useState('');
  const [variables, setVariables] = useState<EmailTemplateVariable[]>([]);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [filters, setFilters] = useState<EmailContactFilters | null>(null);
  const [audienceCount, setAudienceCount] = useState<number | null>(null);
  const [sendMode, setSendMode] = useState<'now' | 'schedule'>('now');
  const [scheduledAt, setScheduledAt] = useState<Date | null>(null);
  const [scheduleChanged, setScheduleChanged] = useState(false);

  // ui
  const [showConnPicker, setShowConnPicker] = useState(false);
  const [showTplPicker, setShowTplPicker] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [replaceInfo, setReplaceInfo] = useState('');
  const [showCode, setShowCode] = useState(false);

  const isExcel = details?.recipientSource === 'Excel';
  const excelCount: number = Array.isArray(details?.excelData?.recipients) ? details!.excelData.recipients.length : 0;
  const selectedTemplate = templates.find((t) => t.id === templateId);

  const load = useCallback(async () => {
    if (!org) return;
    setLoading(true);
    setLoadError('');
    try {
      const [conns, tpls, d] = await Promise.all([
        emailCampaignsApi.getConnections(org).catch(() => [] as Connection[]),
        emailCampaignsApi.getTemplates(org).catch(() => [] as EmailTemplateInfo[]),
        routeId ? emailCampaignsApi.get(org, routeId) : Promise.resolve(null),
      ]);
      setConnections(conns);
      setTemplates(tpls);
      if (d) {
        setDetails(d);
        setName(d.name);
        setProvider(d.provider);
        setContentSource(d.contentSource);
        setTemplateId(d.templateId);
        setVariables(mergeVariables(tpls.find((t) => t.id === d.templateId), d.templateVariables));
        setSubject(d.inlineSubject);
        setBody(d.inlineBody);
        setFilters(d.contactFilters);
        if (d.trigger === 'Scheduled') {
          setSendMode('schedule');
          setScheduledAt(parseRunAt(d.runAt));
        }
      } else if (conns.length > 0) {
        setProvider(conns[0].id);
      }
    } catch (e: any) {
      setLoadError(errorMessage(e, he ? 'טעינת הקמפיין נכשלה' : 'Failed to load campaign'));
    } finally {
      setLoading(false);
    }
  }, [org, routeId, he]);

  useEffect(() => {
    load();
  }, [load]);

  // Contact columns are only needed once a template with variables is in play.
  useEffect(() => {
    if (contentSource === 'template' && variables.length > 0 && columns.length === 0 && org) {
      emailCampaignsApi.getContactColumns(org).then(setColumns).catch(() => {});
    }
  }, [contentSource, variables.length, columns.length, org]);

  const pickTemplate = (id: string) => {
    const tpl = templates.find((t) => t.id === id);
    setTemplateId(id);
    setVariables(mergeVariables(tpl, id === details?.templateId ? details.templateVariables : []));
  };

  const convertToEditableCopy = () => {
    if (!selectedTemplate) return;
    Alert.alert(
      he ? 'עריכת עותק של התבנית' : 'Edit a copy of the template',
      he
        ? 'הקמפיין יעבור למצב HTML עם עותק של הנושא והתוכן של התבנית, וניתן יהיה לערוך אותם. התבנית המקורית לא תשתנה.'
        : 'The campaign switches to HTML mode with a copy of the template subject and content that you can edit. The original template is not changed.',
      [
        { text: he ? 'ביטול' : 'Cancel', style: 'cancel' },
        {
          text: he ? 'המשך' : 'Continue',
          onPress: () => {
            setSubject(selectedTemplate.subject);
            setBody(selectedTemplate.html); // `{{variables}}` are kept as-is in the copy
            setContentSource('html');
            setShowCode(false);
          },
        },
      ],
    );
  };

  const doFindReplace = () => {
    if (!findText) return;
    const parts = body.split(findText);
    const n = parts.length - 1;
    if (n > 0) setBody(parts.join(replaceText));
    setReplaceInfo(
      n > 0
        ? he ? `הוחלפו ${n} מופעים` : `Replaced ${n} occurrence(s)`
        : he ? 'לא נמצא טקסט תואם' : 'No match found',
    );
  };

  // ── Preview of the content being edited ──
  const previewHtml = useMemo(() => {
    if (contentSource === 'template') {
      return applySampleVariables(selectedTemplate?.html || '', variables, he);
    }
    return contentToHtml(contentSource, body);
  }, [contentSource, selectedTemplate, variables, body, he]);
  const previewSubject = contentSource === 'template' ? selectedTemplate?.subject || '' : subject;

  // ── Validation + build ──
  const effectiveFilters = cleanFilters(filters);
  const hasIncompleteFilters = !isExcel && (filters?.filters || []).some((f) => !isFilterComplete(f));

  const scheduleValid = sendMode !== 'schedule' || (!!scheduledAt && scheduledAt.getTime() > Date.now() + 60_000);

  const validate = (forReview: boolean): string | null => {
    if (!name.trim()) return he ? 'יש להזין שם לקמפיין' : 'Please enter a campaign name';
    if (hasIncompleteFilters) return he ? 'יש תנאי סינון שלא הושלמו' : 'Some audience rules are incomplete';
    if (!forReview) return null;
    if (!provider) return he ? 'יש לבחור חיבור שליחה (Google / Microsoft)' : 'Please choose a sending connection';
    if (contentSource === 'template' && !templateId) return he ? 'יש לבחור תבנית' : 'Please choose a template';
    if (contentSource !== 'template' && (!subject.trim() || !body.trim()))
      return he ? 'יש למלא נושא ותוכן' : 'Please fill subject and content';
    if (!isExcel && audienceCount === 0) return he ? 'לא נמצאו אנשי קשר בקהל שנבחר' : 'The selected audience has no contacts';
    if (sendMode === 'schedule' && !scheduleValid)
      return he ? 'מועד התזמון חייב להיות בעתיד' : 'The scheduled time must be in the future';
    return null;
  };

  const keepExistingSchedule =
    !!details &&
    details.trigger === 'Scheduled' &&
    details.scheduleType !== 'repeated' &&
    sendMode === 'schedule' &&
    !scheduleChanged &&
    !!scheduledAt &&
    scheduledAt.getTime() > Date.now() + 60_000;

  const buildInput = (): EmailCampaignInput => ({
    name: name.trim(),
    // Saving never CREATES a schedule: it only retains an unchanged, still-future existing one.
    // New scheduling happens explicitly in the review step.
    trigger: keepExistingSchedule ? 'Scheduled' : 'Manually',
    recipientSource: isExcel ? 'Excel' : 'Contacts',
    templateId,
    templateVariables: variables,
    contactFilters: isExcel ? null : effectiveFilters,
    excelData: details?.excelData ?? null,
    contentSource,
    inlineSubject: subject,
    inlineBody: body,
    inlineAttachments: details?.inlineAttachments || [],
    provider,
    runAt: keepExistingSchedule ? details!.runAt : '',
    timezone: keepExistingSchedule ? details!.timezone || deviceTimeZone() : deviceTimeZone(),
    scheduleType: keepExistingSchedule ? details!.scheduleType : 'once',
    interval: keepExistingSchedule ? details!.interval : '',
    intervalNumber: keepExistingSchedule ? details!.intervalNumber : 0,
    endCondition: keepExistingSchedule ? details!.endCondition : null,
  });

  const persist = async (): Promise<string | null> => {
    setSaving(true);
    try {
      const savedId = await emailCampaignsApi.save(org, userInfo, buildInput(), campaignId);
      setCampaignId(savedId);
      return savedId;
    } catch (e: any) {
      Alert.alert(he ? 'שגיאה בשמירה' : 'Save failed', errorMessage(e));
      return null;
    } finally {
      setSaving(false);
    }
  };

  /** Warns when saving from mobile would drop a schedule that was defined on the web (recurring / changed). */
  const confirmScheduleDrop = (then: () => void) => {
    if (details?.trigger === 'Scheduled' && !keepExistingSchedule) {
      Alert.alert(
        he ? 'ביטול התזמון הקיים' : 'Existing schedule will be removed',
        he
          ? 'לקמפיין הזה מוגדר תזמון. שמירה כאן תחזיר אותו לטיוטה ותבטל את התזמון — ניתן לתזמן מחדש בשלב האישור.'
          : 'This campaign has a schedule. Saving here returns it to a draft and removes the schedule — you can schedule it again in the review step.',
        [
          { text: he ? 'ביטול' : 'Cancel', style: 'cancel' },
          { text: he ? 'המשך' : 'Continue', style: 'destructive', onPress: then },
        ],
      );
    } else {
      then();
    }
  };

  const saveDraft = () => {
    const err = validate(false);
    if (err) return Alert.alert(he ? 'חסרים פרטים' : 'Missing details', err);
    confirmScheduleDrop(async () => {
      const savedId = await persist();
      if (savedId) {
        Alert.alert(he ? 'נשמר' : 'Saved', he ? 'הטיוטה נשמרה. לא נשלח דבר.' : 'Draft saved. Nothing was sent.', [
          { text: 'OK', onPress: () => router.back() },
        ]);
      }
    });
  };

  const reviewAndSend = () => {
    const err = validate(true);
    if (err) return Alert.alert(he ? 'חסרים פרטים' : 'Missing details', err);
    confirmScheduleDrop(async () => {
      const savedId = await persist();
      if (!savedId) return;
      router.push({
        pathname: '/(tabs)/more/campaigns/email-preview',
        params: {
          id: savedId,
          mode: sendMode,
          ...(sendMode === 'schedule' && scheduledAt ? { runAt: scheduledAt.toISOString() } : {}),
        },
      } as any);
    });
  };

  // ── Render ──
  const inputProps = {
    mode: 'outlined' as const,
    outlineColor: theme.colors.outline,
    activeOutlineColor: BRAND,
    style: { backgroundColor: theme.colors.surface, textAlign },
  };

  const title = routeId ? (he ? 'עריכת קמפיין מייל' : 'Edit email campaign') : he ? 'קמפיין מייל חדש' : 'New email campaign';

  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
        <EmailScreenHeader title={title} />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={BRAND} />
        </View>
      </View>
    );
  }

  if (loadError) {
    return (
      <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
        <EmailScreenHeader title={title} />
        <View style={styles.centered}>
          <MaterialCommunityIcons name="alert-circle-outline" size={44} color={theme.colors.error} />
          <Text style={{ color: theme.colors.onSurfaceVariant, marginVertical: 12, textAlign: 'center' }}>{loadError}</Text>
          <Button mode="outlined" onPress={load} textColor={BRAND}>
            {he ? 'נסה שוב' : 'Retry'}
          </Button>
        </View>
      </View>
    );
  }

  const selectedConn = connections.find((c) => c.id === provider);

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <EmailScreenHeader title={title} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={{ padding: 14, gap: 12, paddingBottom: 130 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Name */}
          <Section title={he ? 'פרטי הקמפיין' : 'Campaign'} icon="email-edit-outline">
            <TextInput
              {...inputProps}
              label={he ? 'שם הקמפיין *' : 'Campaign name *'}
              value={name}
              onChangeText={setName}
            />
          </Section>

          {/* Audience */}
          <Section title={he ? 'קהל יעד' : 'Audience'} icon="account-group-outline">
            {isExcel ? (
              <View style={{ gap: 6 }}>
                <Text style={{ textAlign, color: theme.colors.onSurface, fontWeight: '600' }}>
                  {he ? `הנמענים נטענו מקובץ אקסל (${excelCount.toLocaleString()})` : `Recipients come from an Excel file (${excelCount.toLocaleString()})`}
                </Text>
                <Text style={{ textAlign, color: theme.colors.onSurfaceVariant, fontSize: 12 }}>
                  {he ? 'את רשימת האקסל ניתן להחליף רק באתר. עריכת שאר הפרטים כאן שומרת אותה כפי שהיא.' : 'The Excel list can only be replaced on the web. Editing other details here keeps it unchanged.'}
                </Text>
              </View>
            ) : (
              <EmailAudienceEditor organization={org} filters={filters} onChange={setFilters} onCount={setAudienceCount} />
            )}
          </Section>

          {/* Content */}
          <Section title={he ? 'תוכן המייל' : 'Email content'} icon="file-document-outline">
            <SegmentedButtons
              density="small"
              value={contentSource}
              onValueChange={(v) => setContentSource(v as EmailContentSource)}
              buttons={[
                { value: 'template', label: he ? 'תבנית' : 'Template' },
                { value: 'inline', label: he ? 'הודעה רגילה' : 'Message' },
                { value: 'html', label: 'HTML' },
              ]}
            />

            {contentSource === 'template' && (
              <View style={{ gap: 10 }}>
                {templates.length === 0 ? (
                  <Text style={{ textAlign, color: theme.colors.onSurfaceVariant }}>
                    {he ? 'אין תבניות מייל בארגון. ניתן ליצור תבנית באתר, או לעבור ל"הודעה רגילה".' : 'No email templates yet. Create one on the web, or use "Message".'}
                  </Text>
                ) : (
                  <Button
                    mode="outlined"
                    icon="chevron-down"
                    textColor={BRAND}
                    onPress={() => setShowTplPicker(true)}
                    contentStyle={{ flexDirection: 'row-reverse' }}
                  >
                    {selectedTemplate?.name || (he ? 'בחר תבנית' : 'Choose a template')}
                  </Button>
                )}
                {!!selectedTemplate && (
                  <>
                    <Text style={{ textAlign, color: theme.colors.onSurface }}>
                      <Text style={{ fontWeight: '700' }}>{he ? 'נושא: ' : 'Subject: '}</Text>
                      {selectedTemplate.subject || (he ? '(ללא נושא)' : '(no subject)')}
                    </Text>
                    <View style={[styles.btnRow, { flexDirection }]}>
                      <Button mode="outlined" compact icon="eye-outline" textColor={BRAND} onPress={() => setShowPreview(true)}>
                        {he ? 'תצוגה מקדימה' : 'Preview'}
                      </Button>
                      <Button mode="outlined" compact icon="pencil-outline" textColor={BRAND} onPress={convertToEditableCopy}>
                        {he ? 'ערוך עותק' : 'Edit a copy'}
                      </Button>
                    </View>
                    <EmailVariableMapper variables={variables} columns={columns} onChange={setVariables} />
                  </>
                )}
              </View>
            )}

            {contentSource === 'inline' && (
              <View style={{ gap: 10 }}>
                <TextInput {...inputProps} label={he ? 'נושא *' : 'Subject *'} value={subject} onChangeText={setSubject} />
                <TextInput
                  {...inputProps}
                  label={he ? 'תוכן ההודעה *' : 'Message *'}
                  value={body}
                  onChangeText={setBody}
                  multiline
                  numberOfLines={8}
                  style={[inputProps.style, { minHeight: 180 }]}
                />
                <Button mode="outlined" compact icon="eye-outline" textColor={BRAND} onPress={() => setShowPreview(true)} style={{ alignSelf: 'flex-start' }}>
                  {he ? 'תצוגה מקדימה' : 'Preview'}
                </Button>
              </View>
            )}

            {contentSource === 'html' && (
              <View style={{ gap: 10 }}>
                <TextInput {...inputProps} label={he ? 'נושא *' : 'Subject *'} value={subject} onChangeText={setSubject} />
                <View style={[styles.btnRow, { flexDirection }]}>
                  <Button mode="outlined" compact icon="eye-outline" textColor={BRAND} onPress={() => setShowPreview(true)}>
                    {he ? 'תצוגה מקדימה' : 'Preview'}
                  </Button>
                  <Button mode="outlined" compact icon="code-tags" textColor={BRAND} onPress={() => setShowCode((v) => !v)}>
                    {showCode ? (he ? 'הסתר קוד' : 'Hide code') : he ? 'ערוך קוד HTML' : 'Edit HTML code'}
                  </Button>
                </View>
                <Text style={{ textAlign, color: theme.colors.onSurfaceVariant, fontSize: 12 }}>
                  {body.trim()
                    ? he ? `${body.length.toLocaleString()} תווים` : `${body.length.toLocaleString()} characters`
                    : he ? 'אין תוכן עדיין — הדביקו קוד HTML או בחרו תבנית וערכו עותק.' : 'No content yet — paste HTML code, or pick a template and edit a copy.'}
                </Text>

                {/* Simple text replacement — the safe, mobile-friendly way to tweak an existing email */}
                <View style={[styles.replaceBox, { borderColor: theme.colors.outline, backgroundColor: theme.colors.surfaceVariant }]}>
                  <Text style={{ textAlign, fontWeight: '700', color: theme.colors.onSurface, fontSize: 13 }}>
                    {he ? 'החלפת טקסט / משתנה' : 'Replace text / variable'}
                  </Text>
                  <TextInput {...inputProps} dense label={he ? 'חפש' : 'Find'} value={findText} onChangeText={(v) => { setFindText(v); setReplaceInfo(''); }} autoCapitalize="none" />
                  <TextInput {...inputProps} dense label={he ? 'החלף ב' : 'Replace with'} value={replaceText} onChangeText={setReplaceText} autoCapitalize="none" />
                  <View style={[styles.btnRow, { flexDirection }]}>
                    <Button mode="contained" compact buttonColor={BRAND} onPress={doFindReplace} disabled={!findText || !body}>
                      {he ? 'החלף הכל' : 'Replace all'}
                    </Button>
                    {!!replaceInfo && <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 12 }}>{replaceInfo}</Text>}
                  </View>
                </View>

                {showCode && (
                  <TextInput
                    {...inputProps}
                    label={he ? 'קוד HTML' : 'HTML code'}
                    value={body}
                    onChangeText={setBody}
                    multiline
                    numberOfLines={12}
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={[inputProps.style, { minHeight: 240, maxHeight: 360, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 12, textAlign: 'left' }]}
                  />
                )}
              </View>
            )}

            <View style={[styles.noteBox, { backgroundColor: `${theme.colors.primary}10` }]}>
              <MaterialCommunityIcons name="information-outline" size={16} color={BRAND} />
              <Text style={{ flex: 1, textAlign, fontSize: 12, color: theme.colors.onSurfaceVariant }}>
                {he
                  ? 'העורך הוויזואלי (גרור ושחרר), העלאת קבצים מצורפים וקובצי אקסל זמינים באתר. כאן אפשר לבחור תבנית, לערוך נושא ותוכן, להחליף טקסט ולראות תצוגה מקדימה.'
                  : 'The visual drag & drop editor, attachments and Excel upload are available on the web. Here you can pick a template, edit subject and content, replace text and preview.'}
              </Text>
            </View>
          </Section>

          {/* Sender */}
          <Section title={he ? 'שליחה מתוך' : 'Send from'} icon="send-outline">
            {connections.length === 0 ? (
              <Text style={{ textAlign, color: theme.colors.error }}>
                {he ? 'אין חיבור Google / Microsoft מחובר. יש לחבר חשבון מייל באזור החיבורים.' : 'No Google / Microsoft connection. Connect an email account in connections first.'}
              </Text>
            ) : (
              <Button
                mode="outlined"
                icon="chevron-down"
                textColor={BRAND}
                onPress={() => setShowConnPicker(true)}
                contentStyle={{ flexDirection: 'row-reverse' }}
              >
                {selectedConn ? connLabel(selectedConn) : provider ? (he ? 'חיבור לא זמין — בחר אחר' : 'Connection unavailable — choose another') : he ? 'בחר חיבור' : 'Choose a connection'}
              </Button>
            )}
          </Section>

          {/* When */}
          <Section title={he ? 'מועד שליחה' : 'When to send'} icon="clock-outline">
            <SegmentedButtons
              density="small"
              value={sendMode}
              onValueChange={(v) => setSendMode(v === 'schedule' ? 'schedule' : 'now')}
              buttons={[
                { value: 'now', label: he ? 'שליחה מיידית' : 'Send now', icon: 'send' },
                { value: 'schedule', label: he ? 'תזמון' : 'Schedule', icon: 'calendar-clock' },
              ]}
            />
            {sendMode === 'schedule' && (
              <Pressable
                onPress={() => setShowDatePicker(true)}
                style={[styles.dateField, { borderColor: scheduleValid ? theme.colors.outline : theme.colors.error, flexDirection }]}
              >
                <MaterialCommunityIcons name="calendar-clock" size={20} color={BRAND} />
                <Text style={{ flex: 1, textAlign, color: theme.colors.onSurface, fontWeight: '600' }}>
                  {scheduledAt ? formatDateTime(scheduledAt, he) : he ? 'בחר תאריך ושעה' : 'Pick date & time'}
                </Text>
                <MaterialCommunityIcons name="chevron-down" size={20} color={theme.colors.onSurfaceVariant} />
              </Pressable>
            )}
            {sendMode === 'schedule' && details?.scheduleType === 'repeated' && (
              <Text style={{ textAlign, color: theme.colors.onSurfaceVariant, fontSize: 12 }}>
                {he ? 'לקמפיין מוגדר תזמון חוזר באתר. תזמון מכאן הוא חד-פעמי.' : 'This campaign has a recurring schedule set on the web. Scheduling from here is one-time.'}
              </Text>
            )}
            <Text style={{ textAlign, color: theme.colors.onSurfaceVariant, fontSize: 12 }}>
              {he ? 'שום דבר לא נשלח עד שתאשרו בשלב הבא (תצוגה מקדימה ואישור).' : 'Nothing is sent until you confirm in the next step (preview & confirm).'}
            </Text>
          </Section>
        </ScrollView>

        {/* Action bar */}
        <View
          style={[
            styles.actionBar,
            { backgroundColor: theme.colors.surface, borderTopColor: theme.colors.outline, paddingBottom: insets.bottom + 10, flexDirection },
          ]}
        >
          <Button mode="outlined" onPress={saveDraft} disabled={saving} style={{ flex: 1 }} textColor={BRAND}>
            {he ? 'שמור טיוטה' : 'Save draft'}
          </Button>
          <Button
            mode="contained"
            onPress={reviewAndSend}
            loading={saving}
            disabled={saving}
            buttonColor={BRAND}
            icon={isRTL ? 'arrow-left' : 'arrow-right'}
            contentStyle={{ flexDirection: isRTL ? 'row' : 'row-reverse' }}
            style={{ flex: 1.4 }}
          >
            {he ? 'סקירה ואישור' : 'Review & confirm'}
          </Button>
        </View>
      </KeyboardAvoidingView>

      <PickerSheet
        visible={showConnPicker}
        title={he ? 'בחירת חיבור שליחה' : 'Sending connection'}
        mode="single"
        items={connections.map((c) => ({ value: c.id, label: connLabel(c) }))}
        selected={[provider]}
        onDismiss={() => setShowConnPicker(false)}
        onConfirm={(sel) => setProvider(sel[0])}
      />
      <PickerSheet
        visible={showTplPicker}
        title={he ? 'בחירת תבנית' : 'Choose a template'}
        mode="single"
        items={templates.map((t) => ({ value: t.id, label: t.name, subtitle: t.subject }))}
        selected={[templateId]}
        searchPlaceholder={he ? 'חיפוש תבנית' : 'Search templates'}
        onDismiss={() => setShowTplPicker(false)}
        onConfirm={(sel) => pickTemplate(sel[0])}
      />
      <GambotDateTimePicker
        visible={showDatePicker}
        value={scheduledAt}
        mode="datetime"
        minimumDate={new Date()}
        title={he ? 'מועד שליחת הקמפיין' : 'Campaign send time'}
        onConfirm={(d) => {
          setScheduledAt(d);
          setScheduleChanged(true);
        }}
        onDismiss={() => setShowDatePicker(false)}
      />

      {/* Content preview (sample variable values) */}
      <Modal visible={showPreview} animationType="slide" onRequestClose={() => setShowPreview(false)}>
        <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
          <EmailScreenHeader title={he ? 'תצוגה מקדימה' : 'Preview'} onBack={() => setShowPreview(false)} />
          <ScrollView contentContainerStyle={{ padding: 14, gap: 10 }}>
            <Text style={{ textAlign, color: theme.colors.onSurface }}>
              <Text style={{ fontWeight: '700' }}>{he ? 'נושא: ' : 'Subject: '}</Text>
              {previewSubject || (he ? '(ללא נושא)' : '(no subject)')}
            </Text>
            <EmailHtmlPreview html={previewHtml} rtl={isRTL} height={520} />
            {contentSource === 'template' && variables.length > 0 && (
              <Text style={{ textAlign, color: theme.colors.onSurfaceVariant, fontSize: 12 }}>
                {he ? 'משתנים מוצגים עם ערכי דוגמה. בשליחה בפועל כל נמען יקבל את הערכים שלו.' : 'Variables show sample values. When sent, each recipient gets their own values.'}
              </Text>
            )}
            <Divider />
            <Button mode="contained" buttonColor={BRAND} onPress={() => setShowPreview(false)}>
              {he ? 'סגור' : 'Close'}
            </Button>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  section: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 10 },
  sectionHeader: { alignItems: 'center', gap: 8 },
  btnRow: { gap: 8, alignItems: 'center', flexWrap: 'wrap' },
  replaceBox: { borderWidth: 1, borderRadius: 12, padding: 10, gap: 8 },
  noteBox: { flexDirection: 'row', gap: 8, padding: 10, borderRadius: 10, alignItems: 'flex-start' },
  dateField: { alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 14 },
  actionBar: { gap: 10, paddingHorizontal: 14, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth },
});
