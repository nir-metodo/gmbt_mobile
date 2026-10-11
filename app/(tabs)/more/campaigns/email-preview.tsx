import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, ScrollView, Alert, Modal, KeyboardAvoidingView, Platform } from 'react-native';
import {
  Text,
  TextInput,
  Button,
  Checkbox,
  Switch,
  ActivityIndicator,
  ProgressBar,
  Divider,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../../../stores/authStore';
import { useAppTheme } from '../../../../hooks/useAppTheme';
import { useRTL } from '../../../../hooks/useRTL';
import {
  EmailBankState,
  EmailCampaignDetails,
  EmailCampaignPreviewData,
  EmailPreviewRecipient,
  EmailRunResult,
  emailCampaignsApi,
  errorMessage,
} from '../../../../services/api/emailCampaigns';
import EmailScreenHeader from '../../../../components/campaigns/email/EmailScreenHeader';
import EmailHtmlPreview from '../../../../components/campaigns/email/EmailHtmlPreview';
import {
  BRAND,
  applySampleVariables,
  deviceTimeZone,
  formatDateTime,
  formatRunAt,
  statusMeta,
} from '../../../../components/campaigns/email/emailCampaignHelpers';

type Phase = 'review' | 'sending' | 'sent' | 'scheduled';

function Stat({ value, label, color }: { value: number | string; label: string; color?: string }) {
  const theme = useAppTheme();
  return (
    <View style={styles.stat}>
      <Text style={{ fontSize: 20, fontWeight: '800', color: color || theme.colors.onSurface }}>{value}</Text>
      <Text style={{ fontSize: 11, color: theme.colors.onSurfaceVariant, textAlign: 'center' }}>{label}</Text>
    </View>
  );
}

export default function EmailCampaignPreviewScreen() {
  const { id, mode: modeParam, runAt: runAtParam } = useLocalSearchParams<{ id: string; mode?: string; runAt?: string }>();
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

  const scheduleDate = useMemo(() => {
    if (modeParam !== 'schedule' || !runAtParam) return null;
    const d = new Date(runAtParam);
    return isNaN(d.getTime()) ? null : d;
  }, [modeParam, runAtParam]);
  const isSchedule = modeParam === 'schedule';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<EmailCampaignPreviewData | null>(null);
  const [details, setDetails] = useState<EmailCampaignDetails | null>(null);
  const [bank, setBank] = useState<EmailBankState | null>(null);

  const [phase, setPhase] = useState<Phase>('review');
  const [runResult, setRunResult] = useState<EmailRunResult | null>(null);
  const [expected, setExpected] = useState(0);
  const [progress, setProgress] = useState<{ sent: number; failed: number; status: string } | null>(null);
  const sendInFlight = useRef(false);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // confirmations (same three as the web preview)
  const [okRecipients, setOkRecipients] = useState(false);
  const [okMessage, setOkMessage] = useState(false);
  const [okConsent, setOkConsent] = useState(false);
  const [consentOnly, setConsentOnly] = useState(false);

  // recipients list
  const [search, setSearch] = useState('');
  const [visible, setVisible] = useState(15);
  const [showFull, setShowFull] = useState(false);

  // test email
  const [testTo, setTestTo] = useState(user?.email || '');
  const [testBusy, setTestBusy] = useState(false);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    if (!org || !id) return;
    setLoading(true);
    setError('');
    try {
      const [p, d, b] = await Promise.all([
        emailCampaignsApi.getPreview(org, id),
        emailCampaignsApi.get(org, id),
        emailCampaignsApi.getBankState(org),
      ]);
      setPreview(p);
      setDetails(d);
      setBank(b);
    } catch (e: any) {
      setError(errorMessage(e, he ? 'טעינת התצוגה המקדימה נכשלה' : 'Failed to load preview'));
    } finally {
      setLoading(false);
    }
  }, [org, id, he]);

  useEffect(() => {
    load();
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
    };
  }, [load]);

  // ── Recipients math (mirrors the web preview) ──
  const recipients = preview?.recipients || [];
  const optedOut = recipients.filter((r) => r.consent === false);
  const noEmail = recipients.filter((r) => !r.email && r.consent !== false);
  const eligible = recipients.filter((r) => !!r.email && r.consent !== false);
  const consentGranted = eligible.filter((r) => r.consent === true);
  const consentKnown = recipients.some((r) => r.consent !== undefined);
  const toSend: EmailPreviewRecipient[] = consentOnly ? consentGranted : eligible;
  const uniqueCount = new Set(toSend.map((r) => r.email.toLowerCase())).size;
  const dupes = toSend.length - uniqueCount;

  const filteredList = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return recipients;
    return recipients.filter(
      (r) => r.name.toLowerCase().includes(q) || r.email.toLowerCase().includes(q) || r.phone.includes(q),
    );
  }, [recipients, search]);

  // ── Capacity gate (same rules as the web) ──
  const available = bank?.totalAvailable ?? 0;
  const shortfall = Math.max(0, toSend.length - available);
  const trialConverted = !!bank?.isTrial && !!bank?.hasPaymentToken;
  const hasShortfall = !trialConverted && (!!bank?.limitsConfigured || !!bank?.isTrial) && shortfall > 0;

  const scheduleOk = !isSchedule || (!!scheduleDate && scheduleDate.getTime() > Date.now() + 30_000);

  const missing: string[] = [];
  if (!loading && preview && !preview.from) missing.push(he ? 'חיבור מייל לשליחה (לא זוהתה כתובת שולח)' : 'a connected sender mailbox');
  if (toSend.length === 0) missing.push(he ? 'נמענים לשליחה' : 'recipients to send to');
  if (!okRecipients) missing.push(he ? 'אישור נמענים' : 'recipients confirmation');
  if (!okMessage) missing.push(he ? 'אישור תצוגת ההודעה' : 'message confirmation');
  if (!okConsent) missing.push(he ? 'אישור הסכמה לדיוור' : 'mailing consent confirmation');
  if (isSchedule && !scheduleOk) missing.push(he ? 'מועד תזמון עתידי' : 'a future schedule time');
  const blocked = missing.length > 0 || hasShortfall;

  // ── Rendered email (sample variable values) ──
  const emailHtml = useMemo(() => {
    const html = preview?.template?.html || '';
    if (details?.contentSource === 'template') {
      return applySampleVariables(html, details.templateVariables, he, recipients[0]);
    }
    return html;
  }, [preview, details, he, recipients]);
  const emailSubject = preview?.template?.subject || '';

  const sendTest = async () => {
    if (!details) return;
    if (!testTo.includes('@')) {
      setTestMsg({ ok: false, text: he ? 'נא להזין כתובת מייל תקינה' : 'Please enter a valid email address' });
      return;
    }
    if (!details.provider) {
      setTestMsg({ ok: false, text: he ? 'לא נבחר שולח' : 'No sender selected' });
      return;
    }
    setTestBusy(true);
    setTestMsg(null);
    try {
      await emailCampaignsApi.sendTest(org, userInfo, {
        to: testTo.trim(),
        provider: details.provider,
        contentSource: details.contentSource,
        templateId: details.templateId,
        subject: details.inlineSubject,
        body: details.inlineBody,
      });
      setTestMsg({
        ok: true,
        text: he ? `מייל בדיקה נשלח אל ${testTo.trim()} — בדקו גם בספאם.` : `Test email sent to ${testTo.trim()} — check spam too.`,
      });
    } catch (e: any) {
      setTestMsg({ ok: false, text: (he ? 'שליחת הבדיקה נכשלה: ' : 'Test failed: ') + errorMessage(e) });
    } finally {
      setTestBusy(false);
    }
  };

  const startPolling = (expectedCount: number) => {
    if (pollTimer.current) clearInterval(pollTimer.current);
    let attempts = 0;
    const tick = async () => {
      attempts += 1;
      try {
        const r = await emailCampaignsApi.getResults(org, id as string);
        const failed = r.recipients.filter((x) => ['failed', 'bounced', 'unsubscribed', 'duplicate'].includes(x.status)).length;
        const sent = r.recipients.filter((x) => ['sent', 'opened', 'clicked'].includes(x.status)).length;
        setProgress({ sent, failed, status: r.campaign.status });
        const key = statusMeta(r.campaign.status, true).key;
        const finished = ['completed', 'sent', 'completedwitherrors', 'failed'].includes(key);
        if ((finished && r.recipients.length > 0) || (expectedCount > 0 && r.recipients.length >= expectedCount && finished) || attempts >= 45) {
          if (pollTimer.current) clearInterval(pollTimer.current);
        }
      } catch {
        // keep polling quietly; the results screen shows the full picture
      }
    };
    tick();
    pollTimer.current = setInterval(tick, 4000);
  };

  const doSend = async () => {
    if (sendInFlight.current) return; // guard against double taps (the server also guards)
    sendInFlight.current = true;
    setPhase('sending');
    try {
      if (isSchedule) {
        if (!details || !scheduleDate) throw new Error('Missing schedule');
        const { id: _i, status: _s, ...rest } = details;
        await emailCampaignsApi.save(
          org,
          userInfo,
          {
            ...rest,
            trigger: 'Scheduled',
            runAt: formatRunAt(scheduleDate),
            timezone: deviceTimeZone(),
            scheduleType: 'once',
            interval: '',
            intervalNumber: 0,
            endCondition: null,
          },
          id as string,
        );
        setPhase('scheduled');
        return;
      }

      const res = await emailCampaignsApi.run(org, userInfo, id as string, toSend);
      if (res.ok) {
        setRunResult(res);
        setExpected(res.resuming ? 0 : toSend.length);
        setPhase('sent');
        startPolling(res.resuming ? 0 : toSend.length);
      } else if (res.blocked) {
        setPhase('review');
        Alert.alert(
          he ? 'הגעתם למכסת הדיוור' : 'Email allowance reached',
          res.message ||
            (he
              ? 'הגעתם למכסת הדיוור במייל. כדי להמשיך יש לרכוש בנק דיוור או להתחיל מסלול בתשלום (באתר).'
              : 'You reached your email allowance. Buy an email bank or start a paid plan on the web to continue.'),
        );
      } else {
        setPhase('review');
        Alert.alert(he ? 'השליחה נכשלה' : 'Send failed', res.error || (he ? 'אירעה שגיאה' : 'Something went wrong'));
      }
    } catch (e: any) {
      setPhase('review');
      Alert.alert(he ? 'השליחה נכשלה' : 'Send failed', errorMessage(e));
    } finally {
      sendInFlight.current = false;
    }
  };

  const confirmSend = () => {
    if (blocked) return;
    if (isSchedule && scheduleDate) {
      Alert.alert(
        he ? 'אישור תזמון' : 'Confirm scheduling',
        he
          ? `הקמפיין "${preview?.campaignName}" יישלח ב-${formatDateTime(scheduleDate, true)} לאנשי הקשר התואמים באותו רגע. לתזמן?`
          : `"${preview?.campaignName}" will be sent on ${formatDateTime(scheduleDate, false)} to the contacts matching at that moment. Schedule it?`,
        [
          { text: he ? 'ביטול' : 'Cancel', style: 'cancel' },
          { text: he ? 'תזמן' : 'Schedule', onPress: doSend },
        ],
      );
      return;
    }
    Alert.alert(
      he ? 'אישור שליחה סופי' : 'Final confirmation',
      he
        ? `לשלוח עכשיו את "${preview?.campaignName}" ל-${toSend.length.toLocaleString()} נמענים? לא ניתן לבטל לאחר השליחה.`
        : `Send "${preview?.campaignName}" now to ${toSend.length.toLocaleString()} recipients? This cannot be undone.`,
      [
        { text: he ? 'ביטול' : 'Cancel', style: 'cancel' },
        { text: he ? 'שלח' : 'Send', style: 'destructive', onPress: doSend },
      ],
    );
  };

  const goResults = () => router.replace({ pathname: '/(tabs)/more/campaigns/email-results', params: { id } } as any);
  const goList = () => router.replace('/(tabs)/more/campaigns' as any);

  const headerTitle = isSchedule ? (he ? 'אישור תזמון' : 'Confirm schedule') : he ? 'אישור הודעה ונמענים' : 'Review & confirm';

  // ── Loading / error ──
  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
        <EmailScreenHeader title={headerTitle} />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={BRAND} />
          <Text style={{ marginTop: 12, color: theme.colors.onSurfaceVariant }}>{he ? 'טוען תצוגה מקדימה…' : 'Loading preview…'}</Text>
        </View>
      </View>
    );
  }
  if (error || !preview || !details) {
    return (
      <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
        <EmailScreenHeader title={headerTitle} />
        <View style={styles.centered}>
          <MaterialCommunityIcons name="alert-circle-outline" size={44} color={theme.colors.error} />
          <Text style={{ color: theme.colors.onSurfaceVariant, marginVertical: 12, textAlign: 'center' }}>{error || (he ? 'לא נמצא' : 'Not found')}</Text>
          <Button mode="outlined" onPress={load} textColor={BRAND}>
            {he ? 'נסה שוב' : 'Retry'}
          </Button>
        </View>
      </View>
    );
  }

  // ── Done: scheduled ──
  if (phase === 'scheduled') {
    return (
      <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
        <EmailScreenHeader title={headerTitle} onBack={goList} />
        <View style={styles.centered}>
          <MaterialCommunityIcons name="calendar-check" size={64} color={BRAND} />
          <Text style={[styles.doneTitle, { color: theme.colors.onSurface }]}>{he ? 'הקמפיין תוזמן' : 'Campaign scheduled'}</Text>
          <Text style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center', marginBottom: 20 }}>
            {he
              ? `יישלח ב-${formatDateTime(scheduleDate, true)}. אפשר לשנות או לבטל את התזמון בעריכת הקמפיין.`
              : `It will be sent on ${formatDateTime(scheduleDate, false)}. You can change or cancel the schedule by editing the campaign.`}
          </Text>
          <Button mode="contained" buttonColor={BRAND} onPress={goList}>
            {he ? 'חזרה לקמפיינים' : 'Back to campaigns'}
          </Button>
        </View>
      </View>
    );
  }

  // ── Done: sent (with live progress) ──
  if (phase === 'sent') {
    const done = progress ? progress.sent + progress.failed : 0;
    const pct = expected > 0 ? Math.min(1, done / expected) : 0;
    const finishedKey = progress ? statusMeta(progress.status, true).key : '';
    const finished = ['completed', 'sent', 'completedwitherrors', 'failed'].includes(finishedKey);
    return (
      <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
        <EmailScreenHeader title={he ? 'תוצאות שליחה' : 'Send progress'} onBack={goList} />
        <ScrollView contentContainerStyle={styles.doneWrap}>
          <MaterialCommunityIcons name={finished ? 'check-circle' : 'send-check'} size={64} color={BRAND} />
          <Text style={[styles.doneTitle, { color: theme.colors.onSurface }]}>
            {runResult?.resuming
              ? he ? 'הקמפיין כבר בשליחה' : 'Campaign is already sending'
              : finished
                ? he ? 'השליחה הסתיימה' : 'Sending finished'
                : he ? 'הקמפיין נשלח לתור השליחה' : 'Campaign queued for sending'}
          </Text>
          <Text style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center' }}>
            {runResult?.message ||
              (he
                ? `${(runResult?.recipientCount || toSend.length).toLocaleString()} נמענים. המיילים נשלחים ברקע — אפשר לצאת מהמסך.`
                : `${(runResult?.recipientCount || toSend.length).toLocaleString()} recipients. Emails are sent in the background — you can leave this screen.`)}
          </Text>
          {expected > 0 && (
            <View style={{ width: '100%', gap: 8, marginTop: 16 }}>
              <ProgressBar progress={pct} color={BRAND} style={{ height: 8, borderRadius: 4 }} />
              <View style={[styles.statRow, { flexDirection }]}>
                <Stat value={progress ? progress.sent : '—'} label={he ? 'נשלחו' : 'Sent'} color="#10b981" />
                <Stat value={progress ? progress.failed : '—'} label={he ? 'נכשלו / דולגו' : 'Failed / skipped'} color={progress && progress.failed ? '#ef4444' : undefined} />
                <Stat value={expected.toLocaleString()} label={he ? 'סה״כ' : 'Total'} />
              </View>
            </View>
          )}
          <View style={{ width: '100%', gap: 10, marginTop: 24 }}>
            <Button mode="contained" buttonColor={BRAND} onPress={goResults}>
              {he ? 'לתוצאות המלאות' : 'View full results'}
            </Button>
            <Button mode="outlined" textColor={BRAND} onPress={goList}>
              {he ? 'חזרה לקמפיינים' : 'Back to campaigns'}
            </Button>
          </View>
        </ScrollView>
      </View>
    );
  }

  const card = { backgroundColor: theme.colors.surface, borderColor: theme.colors.outline };
  const sending = phase === 'sending';

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <EmailScreenHeader title={headerTitle} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: 14, gap: 12, paddingBottom: 150 }} keyboardShouldPersistTaps="handled">
          {/* What will happen */}
          <View
            style={[
              styles.banner,
              { flexDirection, backgroundColor: isSchedule ? '#eef2ff' : '#fff7ed', borderColor: isSchedule ? '#c7d2fe' : '#fed7aa' },
            ]}
          >
            <MaterialCommunityIcons name={isSchedule ? 'calendar-clock' : 'send'} size={22} color={isSchedule ? '#4f46e5' : '#c2410c'} />
            <Text style={{ flex: 1, textAlign, color: '#1e293b', fontWeight: '600' }}>
              {isSchedule
                ? he ? `תזמון לשליחה ב-${formatDateTime(scheduleDate, true)}` : `Scheduled for ${formatDateTime(scheduleDate, false)}`
                : he ? 'הקמפיין יישלח מיד לאחר האישור הסופי' : 'The campaign will be sent right after the final confirmation'}
            </Text>
          </View>

          {/* Summary */}
          <View style={[styles.card, card]}>
            <Text style={{ textAlign, fontSize: 17, fontWeight: '800', color: theme.colors.onSurface }}>{preview.campaignName}</Text>
            <View style={[styles.infoRow, { flexDirection }]}>
              <MaterialCommunityIcons name="email-fast-outline" size={16} color={theme.colors.onSurfaceVariant} />
              <Text style={{ flex: 1, textAlign, color: theme.colors.onSurfaceVariant, fontSize: 13 }}>
                {he ? 'נשלח מ: ' : 'From: '}
                {preview.from ? (
                  <Text style={{ color: theme.colors.onSurface, fontWeight: '700' }}>
                    {preview.from}
                    {preview.fromProvider === 'google' ? ' (Gmail)' : preview.fromProvider === 'microsoft' ? ' (Microsoft)' : ''}
                  </Text>
                ) : (
                  <Text style={{ color: theme.colors.error, fontWeight: '700' }}>
                    {he ? 'לא זוהתה כתובת שולח — חברו חשבון מייל' : 'No sender detected — connect an email account'}
                  </Text>
                )}
              </Text>
            </View>
            <View style={[styles.infoRow, { flexDirection }]}>
              <MaterialCommunityIcons name="format-title" size={16} color={theme.colors.onSurfaceVariant} />
              <Text style={{ flex: 1, textAlign, color: theme.colors.onSurfaceVariant, fontSize: 13 }}>
                {he ? 'נושא: ' : 'Subject: '}
                <Text style={{ color: theme.colors.onSurface, fontWeight: '700' }}>{emailSubject || (he ? '(ללא נושא)' : '(no subject)')}</Text>
              </Text>
            </View>
            <Divider />
            <View style={[styles.statRow, { flexDirection }]}>
              <Stat value={toSend.length.toLocaleString()} label={he ? 'יישלחו' : 'Will receive'} color={BRAND} />
              <Stat value={recipients.length.toLocaleString()} label={he ? 'בקהל' : 'In audience'} />
              <Stat value={(noEmail.length + optedOut.length).toLocaleString()} label={he ? 'ידולגו' : 'Skipped'} color={noEmail.length + optedOut.length ? '#f59e0b' : undefined} />
            </View>
            {noEmail.length > 0 && (
              <Text style={[styles.hint, { textAlign, color: theme.colors.onSurfaceVariant }]}>
                {he ? `${noEmail.length} אנשי קשר ללא כתובת מייל לא יקבלו את הקמפיין.` : `${noEmail.length} contact(s) without an email address will be skipped.`}
              </Text>
            )}
            {optedOut.length > 0 && (
              <Text style={[styles.hint, { textAlign, color: '#b91c1c' }]}>
                {he ? `${optedOut.length} סומנו "ביקשו הסרה" ויוחרגו תמיד.` : `${optedOut.length} opted out and are always excluded.`}
              </Text>
            )}
            {dupes > 0 && (
              <Text style={[styles.hint, { textAlign, color: theme.colors.onSurfaceVariant }]}>
                {he ? `${dupes} כתובות כפולות — כל כתובת תקבל מייל פעם אחת בלבד.` : `${dupes} duplicate address(es) — each address is emailed once.`}
              </Text>
            )}
            {isSchedule && (
              <Text style={[styles.hint, { textAlign, color: theme.colors.onSurfaceVariant }]}>
                {he ? 'בתזמון, הנמענים נקבעים מחדש בזמן השליחה לפי התנאים שנבחרו.' : 'For a scheduled send, recipients are re-evaluated at send time from the selected rules.'}
              </Text>
            )}
          </View>

          {/* Warnings */}
          {preview.fromProvider === 'google' && (
            <View style={[styles.warn, { flexDirection, backgroundColor: '#fffbeb', borderColor: '#fcd34d' }]}>
              <MaterialCommunityIcons name="alert-outline" size={20} color="#b45309" />
              <Text style={{ flex: 1, textAlign, color: '#92400e', fontSize: 12.5, lineHeight: 18 }}>
                {he
                  ? `שליחה דרך Gmail: גוגל מגבילה חשבון רגיל לכ-500 הודעות ב-24 שעות בסך כל הקמפיינים. חריגה גורמת להודעות להישלח ללא הצלחה.${toSend.length > 300 ? ` הקמפיין מיועד ל-${toSend.length.toLocaleString()} נמענים — מומלץ לפצל.` : ''}`
                  : `Sending via Gmail: Google caps a regular account at ~500 messages / 24h across all campaigns. Going over makes messages fail.${toSend.length > 300 ? ` This campaign targets ${toSend.length.toLocaleString()} recipients — consider splitting it.` : ''}`}
              </Text>
            </View>
          )}
          {hasShortfall && (
            <View style={[styles.warn, { flexDirection, backgroundColor: '#fef2f2', borderColor: '#fecaca' }]}>
              <MaterialCommunityIcons name="block-helper" size={20} color="#b91c1c" />
              <Text style={{ flex: 1, textAlign, color: '#991b1b', fontSize: 12.5, lineHeight: 18 }}>
                {bank?.isTrial
                  ? he
                    ? `מכסת הדיוור במייל של תקופת הניסיון (${(bank.trialCap || 300).toLocaleString()}) לא מספיקה — נותרו ${available.toLocaleString()}. לשליחה ל-${toSend.length.toLocaleString()} נמענים יש לרכוש בנק דיוור או להתחיל מסלול בתשלום באתר.`
                    : `Your trial email allowance (${(bank.trialCap || 300).toLocaleString()}) is not enough — ${available.toLocaleString()} left. To email ${toSend.length.toLocaleString()} recipients buy an email bank or start a paid plan on the web.`
                  : he
                    ? `נבחרו ${toSend.length.toLocaleString()} נמענים אך נותרו ${available.toLocaleString()} (מכסה חודשית + בנק). חסרים ${shortfall.toLocaleString()} — יש לרכוש בנק דיוור באתר.`
                    : `${toSend.length.toLocaleString()} recipients selected but only ${available.toLocaleString()} left (monthly quota + bank). ${shortfall.toLocaleString()} short — buy an email bank on the web.`}
              </Text>
            </View>
          )}

          {/* Email preview */}
          <View style={[styles.card, card]}>
            <View style={[styles.cardHeader, { flexDirection }]}>
              <Text style={{ flex: 1, textAlign, fontWeight: '700', color: theme.colors.onSurface }}>{he ? 'תצוגת ההודעה' : 'Message preview'}</Text>
              <Button compact mode="text" icon="fullscreen" textColor={BRAND} onPress={() => setShowFull(true)}>
                {he ? 'מסך מלא' : 'Full screen'}
              </Button>
            </View>
            {preview.template ? (
              <EmailHtmlPreview html={emailHtml} rtl={isRTL} height={400} />
            ) : (
              <Text style={{ textAlign, color: theme.colors.onSurfaceVariant }}>{he ? 'לקמפיין זה לא משויך תוכן' : 'This campaign has no content'}</Text>
            )}
            {details.contentSource === 'template' && details.templateVariables.length > 0 && (
              <Text style={[styles.hint, { textAlign, color: theme.colors.onSurfaceVariant }]}>
                {he ? 'משתנים מוצגים עם ערכי דוגמה (הנמען הראשון / טקסט קבוע).' : 'Variables show sample values (first recipient / fixed text).'}
              </Text>
            )}
          </View>

          {/* Recipients */}
          <View style={[styles.card, card]}>
            <Text style={{ textAlign, fontWeight: '700', color: theme.colors.onSurface }}>
              {he ? `נמענים (${recipients.length.toLocaleString()})` : `Recipients (${recipients.length.toLocaleString()})`}
            </Text>
            <TextInput
              mode="outlined"
              dense
              value={search}
              onChangeText={(v) => { setSearch(v); setVisible(15); }}
              placeholder={he ? 'חיפוש לפי שם, מייל או טלפון' : 'Search by name, email or phone'}
              left={<TextInput.Icon icon="magnify" />}
              style={{ backgroundColor: theme.colors.surface }}
              outlineColor={theme.colors.outline}
              activeOutlineColor={BRAND}
            />
            {filteredList.length === 0 ? (
              <Text style={{ textAlign: 'center', color: theme.colors.onSurfaceVariant, marginVertical: 12 }}>
                {search ? (he ? 'לא נמצאו תוצאות' : 'No results') : he ? 'אין נמענים זמינים לקמפיין זה' : 'No recipients for this campaign'}
              </Text>
            ) : (
              filteredList.slice(0, visible).map((r, i) => (
                <View key={`${r.id}-${i}`} style={[styles.recRow, { flexDirection, borderBottomColor: theme.colors.outline }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ textAlign, color: theme.colors.onSurface, fontWeight: '600' }} numberOfLines={1}>
                      {r.name || '—'}
                    </Text>
                    <Text style={{ textAlign, color: r.email ? theme.colors.onSurfaceVariant : '#f59e0b', fontSize: 12 }} numberOfLines={1}>
                      {r.email || (he ? 'אין כתובת מייל — ידולג' : 'No email — skipped')}
                    </Text>
                  </View>
                  {r.consent === false && (
                    <Text style={{ color: '#b91c1c', fontSize: 11, fontWeight: '700' }}>{he ? 'הסרה' : 'Opted out'}</Text>
                  )}
                </View>
              ))
            )}
            {filteredList.length > visible && (
              <Button mode="text" textColor={BRAND} onPress={() => setVisible((v) => v + 40)}>
                {he ? `הצג עוד (${(filteredList.length - visible).toLocaleString()})` : `Show more (${(filteredList.length - visible).toLocaleString()})`}
              </Button>
            )}
          </View>

          {/* Test email */}
          <View style={[styles.card, card]}>
            <Text style={{ textAlign, fontWeight: '700', color: theme.colors.onSurface }}>{he ? 'שליחת מייל בדיקה' : 'Send a test email'}</Text>
            <Text style={[styles.hint, { textAlign, color: theme.colors.onSurfaceVariant }]}>
              {he ? 'נשלח מייל אחד בלבד לכתובת שתבחרו — כדי לוודא שהוא מגיע לתיבה ולא לספאם.' : 'Sends a single email to the address you choose — to check it lands in the inbox, not spam.'}
            </Text>
            <TextInput
              mode="outlined"
              dense
              value={testTo}
              onChangeText={setTestTo}
              keyboardType="email-address"
              autoCapitalize="none"
              placeholder={he ? 'כתובת לבדיקה' : 'Test address'}
              style={{ backgroundColor: theme.colors.surface }}
              outlineColor={theme.colors.outline}
              activeOutlineColor={BRAND}
            />
            <Button mode="outlined" icon="send-outline" textColor={BRAND} onPress={sendTest} loading={testBusy} disabled={testBusy || sending}>
              {he ? 'שלח מייל בדיקה אליי' : 'Send test to me'}
            </Button>
            {!!testMsg && <Text style={{ textAlign, color: testMsg.ok ? '#15803d' : '#b91c1c', fontSize: 13 }}>{testMsg.text}</Text>}
          </View>

          {/* Confirmations */}
          <View style={[styles.card, card]}>
            <Text style={{ textAlign, fontWeight: '700', color: theme.colors.onSurface }}>{he ? 'אישורים לפני שליחה' : 'Confirm before sending'}</Text>
            <ConfirmRow label={he ? 'אישור נמענים' : 'I approve the recipients'} checked={okRecipients} onToggle={() => setOkRecipients((v) => !v)} flexDirection={flexDirection} textAlign={textAlign} />
            <ConfirmRow label={he ? 'אישור תצוגת ההודעה' : 'I approve the message preview'} checked={okMessage} onToggle={() => setOkMessage((v) => !v)} flexDirection={flexDirection} textAlign={textAlign} />
            {consentKnown && (
              <View style={[styles.infoRow, { flexDirection }]}>
                <Switch value={consentOnly} onValueChange={setConsentOnly} color={BRAND} />
                <Text style={{ flex: 1, textAlign, color: theme.colors.onSurface, fontSize: 13 }}>
                  {he ? `שלח רק למי שנתן הסכמה לדיוור (${consentGranted.length})` : `Only send to contacts with documented consent (${consentGranted.length})`}
                </Text>
              </View>
            )}
            <ConfirmRow
              label={
                he
                  ? 'אני מאשר/ת שיש בידי הסכמה חוקית לשלוח הודעות שיווקיות לאנשי הקשר ברשימה זו, ואני אחראי/ת לעמידה בחוק הספאם ותקנות הפרטיות.'
                  : 'I confirm I have lawful consent to send marketing emails to the contacts on this list and I am responsible for complying with anti-spam and privacy regulations.'
              }
              checked={okConsent}
              onToggle={() => setOkConsent((v) => !v)}
              flexDirection={flexDirection}
              textAlign={textAlign}
            />
          </View>
        </ScrollView>

        {/* Footer */}
        <View style={[styles.footer, { backgroundColor: theme.colors.surface, borderTopColor: theme.colors.outline, paddingBottom: insets.bottom + 10 }]}>
          {blocked && !sending && (
            <Text style={{ textAlign, color: theme.colors.onSurfaceVariant, fontSize: 11.5, marginBottom: 6 }}>
              {missing.length > 0
                ? (he ? 'כדי להמשיך יש להשלים: ' : 'To continue: ') + missing.join(' · ')
                : he ? 'אין מספיק קיבולת דיוור לשליחה הזו.' : 'Not enough email capacity for this send.'}
            </Text>
          )}
          <View style={{ flexDirection, gap: 10 }}>
            <Button mode="outlined" onPress={() => router.back()} disabled={sending} style={{ flex: 1 }} textColor={BRAND}>
              {he ? 'חזרה לעריכה' : 'Back to edit'}
            </Button>
            <Button
              mode="contained"
              icon={isSchedule ? 'calendar-check' : 'send'}
              onPress={confirmSend}
              loading={sending}
              disabled={blocked || sending}
              buttonColor={BRAND}
              style={{ flex: 1.6 }}
            >
              {isSchedule
                ? he ? 'תזמן קמפיין' : 'Schedule'
                : he ? `שלח ל-${toSend.length.toLocaleString()} נמענים` : `Send to ${toSend.length.toLocaleString()}`}
            </Button>
          </View>
        </View>
      </KeyboardAvoidingView>

      <Modal visible={showFull} animationType="slide" onRequestClose={() => setShowFull(false)}>
        <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
          <EmailScreenHeader title={emailSubject || (he ? 'תצוגה מקדימה' : 'Preview')} onBack={() => setShowFull(false)} />
          <View style={{ flex: 1, padding: 12 }}>
            <EmailHtmlPreview html={emailHtml} rtl={isRTL} height={9999} style={{ flex: 1, height: undefined }} />
          </View>
        </View>
      </Modal>
    </View>
  );
}

/** Checkbox + wrapping label row. */
function ConfirmRow({
  label,
  checked,
  onToggle,
  flexDirection,
  textAlign,
}: {
  label: string;
  checked: boolean;
  onToggle: () => void;
  flexDirection: 'row' | 'row-reverse';
  textAlign: 'left' | 'right';
}) {
  const theme = useAppTheme();
  return (
    <View style={[styles.infoRow, { flexDirection }]}>
      <Checkbox status={checked ? 'checked' : 'unchecked'} onPress={onToggle} color={BRAND} />
      <Text onPress={onToggle} style={{ flex: 1, textAlign, color: theme.colors.onSurface, fontSize: 13, lineHeight: 19 }}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  doneWrap: { alignItems: 'center', padding: 24, gap: 10 },
  doneTitle: { fontSize: 20, fontWeight: '800', marginTop: 8 },
  banner: { alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 12, padding: 12 },
  card: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 8 },
  cardHeader: { alignItems: 'center' },
  infoRow: { alignItems: 'center', gap: 8 },
  statRow: { justifyContent: 'space-around', paddingVertical: 4 },
  stat: { alignItems: 'center', minWidth: 80 },
  hint: { fontSize: 12 },
  warn: { alignItems: 'flex-start', gap: 10, borderWidth: 1, borderRadius: 12, padding: 12 },
  recRow: { alignItems: 'center', gap: 8, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  footer: { paddingHorizontal: 14, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth },
});
