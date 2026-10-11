import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, ScrollView, Pressable, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { Text, Button, ActivityIndicator, Switch, TextInput, IconButton, ProgressBar } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../../../stores/authStore';
import { useAppTheme } from '../../../../hooks/useAppTheme';
import { useRTL } from '../../../../hooks/useRTL';
import { borderRadius } from '../../../../constants/theme';
import { withAlpha } from '../../../../utils/formatters';
import GambotDateTimePicker from '../../../../components/GambotDateTimePicker';
import {
  campaignsApi,
  WaCampaign,
  WaNumber,
  WaLimit,
  BroadcastBank,
  WaRunResult,
  RunRecipient,
} from '../../../../services/api/campaigns';
import WaHeader from '../../../../components/campaigns/whatsapp/WaHeader';
import TemplateBubble from '../../../../components/campaigns/whatsapp/TemplateBubble';
import { Section, CheckRow, Notice } from '../../../../components/campaigns/whatsapp/formParts';
import { invalidateRunSummary } from '../../../../components/campaigns/whatsapp/useRunSummaries';
import {
  analyzeTemplate,
  buildResolvedBody,
  campaignTemplateId,
  computeRunStats,
  deviceTimeZone,
  formatWabaDailyLimit,
  formatWhen,
  getCachedCampaign,
  isMediaOrButtonQuery,
  num,
  parseRunAtAsUtc,
  parseRunAtLocal,
  TemplateInfo,
  upsertCachedCampaign,
} from '../../../../components/campaigns/whatsapp/campaignUtils';

const BASE = '/(tabs)/more/campaigns';
const POLL_MS = 5000;
const LIST_PREVIEW_LIMIT = 50;
const MIN_SCHEDULE_LEAD_MS = 60 * 1000;

const EXCEL_CONSENT_SOURCES = [
  { value: 'excel_import', he: 'ייבוא מקובץ Excel', en: 'Excel import' },
  { value: 'website_form', he: 'טופס באתר', en: 'Website form' },
  { value: 'event_registration', he: 'הרשמה לאירוע', en: 'Event registration' },
  { value: 'physical_form', he: 'טופס פיזי', en: 'Physical form' },
  { value: 'whatsapp_optin', he: 'הסכמה בוואטסאפ', en: 'WhatsApp opt-in' },
  { value: 'other', he: 'אחר', en: 'Other' },
];

type Phase = 'loading' | 'ready' | 'sending' | 'progress' | 'scheduled';
type Guard = { kind: 'future'; whenMs: number; imminent: boolean } | { kind: 'finished' } | null;

/** A scheduled-run `runAt` is either "dd/MM/yyyy HH:mm:ss" (campaign tz) or a UTC ISO string. */
function parseAnyRunAt(v: any): Date | null {
  if (typeof v === 'string' && /^\d{1,2}\/\d{1,2}\/\d{4}/.test(v)) return parseRunAtLocal(v);
  return parseRunAtAsUtc(v);
}

/** Port of Campaigns.js handlePlayClick: is a manual run now a duplicate of an upcoming / finished schedule? */
function computeGuard(c: WaCampaign): Guard {
  if (String(c.campaignStatus || '').toLowerCase() === 'cancelled') return null; // schedule was cancelled on purpose
  const isScheduledAuto = !!c.AutoSplit || c.campaignTrigger === 'Scheduled' || c.scheduleType === 'custom';
  const now = Date.now();
  let nextRunMs: number | null = null;
  for (const b of Array.isArray(c.ScheduledRuns) ? c.ScheduledRuns : []) {
    const d = parseAnyRunAt(b?.runAt);
    if (d && d.getTime() > now) nextRunMs = nextRunMs == null ? d.getTime() : Math.min(nextRunMs, d.getTime());
  }
  if (nextRunMs == null) {
    const single = parseRunAtLocal(c.runAt);
    if (single && single.getTime() > now) nextRunMs = single.getTime();
  }
  if (nextRunMs != null) return { kind: 'future', whenMs: nextRunMs, imminent: nextRunMs - now <= 3 * 60 * 1000 };
  if (isScheduledAuto) return { kind: 'finished' };
  return null;
}

/** Legacy `ContactsQuery` ([[{selectedoperator, selectedgroup:[{value}]}]]) client-side filter. */
function applyLegacyQuery(all: RunRecipient[], query: any): RunRecipient[] {
  const criteria = (query as any[]).map((q) => {
    const { selectedgroup, selectedoperator } = q[0];
    return { op: selectedoperator, groups: (selectedgroup as any[]).map((g) => g.value) };
  });
  return all.filter((c) =>
    criteria.every(({ op, groups }) => {
      const keys: string[] = (c as any).keys || [];
      if (op === 'equals') return groups.some((g: string) => keys.includes(g));
      if (op === 'notEquals') return !groups.some((g: string) => keys.includes(g));
      return false;
    }),
  );
}

async function loadRecipients(org: string, c: WaCampaign): Promise<RunRecipient[]> {
  let list: RunRecipient[];
  if (String(c.recipientSource || '').toLowerCase() === 'excel') {
    const rows: any[] = c.ExcelData?.recipients || [];
    list = rows.map((r, i) => ({ ...r, id: i, phoneNumber: r.phone, name: r.variables?.var1 || r.phone }));
  } else if (c.ContactFilters && typeof c.ContactFilters === 'object') {
    list = await campaignsApi.executeAdvancedFilter(org, c.ContactFilters);
  } else if (c.ContactsQuery) {
    list = applyLegacyQuery(await campaignsApi.getAllContacts(org), c.ContactsQuery);
  } else {
    list = await campaignsApi.getAllContacts(org);
  }
  // Deterministic order: index-based bulk blocks ("0–200", then "200–400") must stay stable between runs.
  return list
    .filter((r) => !(r as any).isSpam && !(r as any).deleted)
    .sort((a, b) => String(a.phoneNumber || '').localeCompare(String(b.phoneNumber || '')));
}

const isTimeoutError = (e: any) => e?.code === 'ECONNABORTED' || /timeout/i.test(String(e?.message || ''));
const pad2 = (n: number) => String(n).padStart(2, '0');

function Stat({ label, value, color }: { label: string; value: number | string; color?: string }) {
  const theme = useAppTheme();
  return (
    <View style={styles.stat}>
      <Text style={{ fontSize: 20, fontWeight: '800', color: color || theme.colors.onSurface }}>{value}</Text>
      <Text style={{ fontSize: 11, color: theme.colors.onSurfaceVariant }}>{label}</Text>
    </View>
  );
}

export default function WaRunScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const campaignId = String(id || '');
  const router = useRouter();
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const { flexDirection, textAlign } = useRTL();
  const { i18n } = useTranslation();
  const he = i18n.language !== 'en';
  const L = (h: string, e: string) => (he ? h : e);
  const user = useAuthStore((s) => s.user) as any;
  const organization = user?.organization as string | undefined;

  const [phase, setPhase] = useState<Phase>('loading');
  const [loadError, setLoadError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [campaign, setCampaign] = useState<WaCampaign | null>(null);
  const [info, setInfo] = useState<TemplateInfo | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [mediaUrl, setMediaUrl] = useState('');
  const [all, setAll] = useState<RunRecipient[]>([]);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [waNumbers, setWaNumbers] = useState<WaNumber[]>([]);
  const [limits, setLimits] = useState<WaLimit[]>([]);
  const [bank, setBank] = useState<BroadcastBank | null>(null);
  const [sampleIdx, setSampleIdx] = useState(0);
  const [listOpen, setListOpen] = useState(false);
  const [listSearch, setListSearch] = useState('');

  // range
  const [useBulk, setUseBulk] = useState(false);
  const [startStr, setStartStr] = useState('');
  const [endStr, setEndStr] = useState('');
  // consent
  const [consentMode, setConsentMode] = useState<'all' | 'consentOnly'>('all');
  const [excelMode, setExcelMode] = useState<'legal_only' | 'document_consent'>('legal_only');
  const [excelSource, setExcelSource] = useState('excel_import');
  const [excelOther, setExcelOther] = useState('');
  // confirmations
  const [guardAck, setGuardAck] = useState(false);
  const [rcChecked, setRcChecked] = useState(false);
  const [pcChecked, setPcChecked] = useState(false);
  const [ccChecked, setCcChecked] = useState(false);
  const [highlight, setHighlight] = useState(false);
  // schedule instead
  const [scheduleOn, setScheduleOn] = useState(false);
  const [scheduleDate, setScheduleDate] = useState<Date | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [weekly, setWeekly] = useState(false);
  const [repeatCount, setRepeatCount] = useState('4');
  // result
  const [sendError, setSendError] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const [sentCount, setSentCount] = useState(0);
  const [scheduledInfo, setScheduledInfo] = useState<{ runAt: Date; recipients: number; weekly: boolean } | null>(null);
  const [progressRun, setProgressRun] = useState<WaRunResult | null>(null);
  const [pollCount, setPollCount] = useState(0);
  const startedAtRef = useRef(0);
  const sendingRef = useRef(false);

  // ───────────── load ─────────────
  useEffect(() => {
    if (!organization || !campaignId) return;
    let cancelled = false;
    (async () => {
      setPhase('loading');
      setLoadError('');
      setPreviewError('');
      try {
        let c = getCachedCampaign(campaignId) || null;
        const needsFull = !c || String(c.recipientSource || '').toLowerCase() === 'excel' || !c.recipientSource;
        if (needsFull) {
          const full = await campaignsApi.getCampaignById(organization, campaignId);
          if ((full as any)?.error) throw new Error(String((full as any).error));
          c = { ...(c || {}), ...full, campaingId: full.campaingId || campaignId };
        }
        if (!c) throw new Error(L('הקמפיין לא נמצא', 'Campaign not found'));
        if (c.isSystem) throw new Error(L('קמפיין מערכת – לקריאה בלבד', 'System campaign – read only'));
        upsertCachedCampaign(c);

        const isTemplate = String(c.messageType || 'template').toLowerCase() === 'template';
        const tplId = campaignTemplateId(c);
        const [recipients, nums, lims, bk, tpl] = await Promise.all([
          loadRecipients(organization, c),
          campaignsApi.getWhatsAppNumbers(organization),
          campaignsApi.getWabaLimits(organization),
          campaignsApi.getBroadcastBank(organization),
          isTemplate && tplId ? campaignsApi.getTemplateById(organization, tplId).catch(() => null) : Promise.resolve(null),
        ]);
        if (cancelled) return;

        let tInfo: TemplateInfo | null = null;
        if (isTemplate) {
          if (tpl) tInfo = analyzeTemplate(tpl, he);
          else setPreviewError(L('לא ניתן לטעון את התבנית לתצוגה מקדימה', "Couldn't load the template for the preview"));
        } else {
          tInfo = analyzeTemplate({ name: '', components: [{ type: 'BODY', text: c.message || '' }] } as any, he);
        }

        // Header media: a per-campaign custom media URL wins, else the template's sample media.
        let media = '';
        const q = (c.templateVariableQuery || []).find(
          (x: any) => isMediaOrButtonQuery(x) && /dynamic_image|dynamic_video|dynamic_file|header_document/.test(String(x.Variable || '')),
        );
        if (q?.parameters_hardCoded_Text) media = String(q.parameters_hardCoded_Text);
        else if (isTemplate && tplId && tInfo && ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(tInfo.headerFormat)) {
          media = await campaignsApi.getTemplateMediaUrl(organization, tplId);
        }
        if (cancelled) return;

        setCampaign(c);
        setInfo(tInfo);
        setMediaUrl(media.includes(' ') ? encodeURI(media) : media);
        setAll(recipients);
        setWaNumbers(nums);
        setLimits(lims);
        setBank(bk);
        setRemoved(new Set());
        setSampleIdx(0);
        // Same as the web: continue from the previous block when a bulk range was used before.
        const lastEnd = num(c.lastBulkEnd);
        if (lastEnd > 0) {
          const size = Math.max(1, lastEnd - num(c.lastBulkStart)) || lastEnd;
          setUseBulk(true);
          setStartStr(String(lastEnd));
          setEndStr(String(lastEnd + size));
        } else {
          setUseBulk(false);
          setStartStr('');
          setEndStr('');
        }
        setPhase('ready');
      } catch (e: any) {
        if (cancelled) return;
        setLoadError(e?.response?.data?.error || e?.message || L('הטעינה נכשלה', 'Failed to load'));
        setPhase('loading');
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organization, campaignId, reloadKey]);

  // ───────────── derived ─────────────
  const isExcel = String(campaign?.recipientSource || '').toLowerCase() === 'excel';
  const guard = useMemo(() => (campaign ? computeGuard(campaign) : null), [campaign]);

  const rangeStart = parseInt(startStr, 10);
  const rangeEnd = parseInt(endStr, 10);
  const rangeActive = useBulk && !isNaN(rangeStart) && !isNaN(rangeEnd) && rangeStart >= 0 && rangeEnd > rangeStart;
  const rangeInvalid = useBulk && !rangeActive;

  // Range indexes refer to the full sorted list (stable across runs); removals apply afterwards.
  const base = useMemo(() => {
    const sliced = rangeActive ? all.slice(rangeStart, rangeEnd) : all;
    return removed.size ? sliced.filter((r) => !removed.has(String(r.phoneNumber))) : sliced;
  }, [all, rangeActive, rangeStart, rangeEnd, removed]);

  const stats = useMemo(
    () => ({
      granted: base.filter((r) => r.consent === true).length,
      revoked: base.filter((r) => r.consent === false).length,
      unknown: base.filter((r) => r.consent == null).length,
    }),
    [base],
  );
  const toSend = useMemo(() => {
    if (isExcel) return base.filter((r) => r.consent !== false);
    return consentMode === 'consentOnly' ? base.filter((r) => r.consent === true) : base.filter((r) => r.consent !== false);
  }, [base, isExcel, consentMode]);
  const plannedCount = toSend.length;

  const sample = toSend.length ? toSend[sampleIdx % toSend.length] : base[0] || null;
  const queries = campaign?.templateVariableQuery;
  const resolvedBody = info && sample ? buildResolvedBody(info.bodyText, queries, sample) : info?.bodyText;

  const senderNum =
    waNumbers.find((n) => n.PhoneNumberId && n.PhoneNumberId === campaign?.fromNumberId) ||
    waNumbers.find((n) => n.IsPrimary) ||
    waNumbers[0];
  const senderLimit =
    limits.find((l) => l.PhoneNumberId && senderNum && l.PhoneNumberId === senderNum.PhoneNumberId) ||
    limits.find((l) => l.IsPrimary) ||
    limits[0];
  const dailyLimit = useMemo(() => {
    if (!senderLimit || (senderLimit.DailyLimit == null && !senderLimit.Tier)) return NaN;
    return parseInt(formatWabaDailyLimit(senderLimit).replace(/,/g, ''), 10);
  }, [senderLimit]);
  const qualityRed = String(senderLimit?.QualityRating || '').toUpperCase() === 'RED';

  const capacityAvailable = bank?.totalAvailable ?? 0;
  const capacityShortfall = Math.max(0, plannedCount - capacityAvailable);
  const trialConvertedWithCard = !!bank?.isTrial && !!bank?.hasPaymentToken;
  const hasCapacityShortfall = !trialConvertedWithCard && (!!bank?.limitsConfigured || !!bank?.isTrial) && capacityShortfall > 0;

  const resolvedExcelSource = excelSource === 'other' ? excelOther.trim() : excelSource;
  const excelConsentValid = !isExcel || excelMode === 'legal_only' || resolvedExcelSource.length > 0;

  const scheduleBlockedReason =
    removed.size > 0
      ? L('הסרת נמענים חלה רק על שליחה מיידית', 'Removed recipients only apply to an immediate send')
      : !isExcel && consentMode === 'consentOnly'
        ? L('שליחה "רק למסכימים" חלה רק על שליחה מיידית', '"Consented only" only applies to an immediate send')
        : '';
  const scheduleActive = scheduleOn && !scheduleBlockedReason;
  const scheduleTooSoon = scheduleActive && (!scheduleDate || scheduleDate.getTime() < Date.now() + MIN_SCHEDULE_LEAD_MS);

  const missing: string[] = [];
  if (!info) missing.push(L('תצוגה מקדימה לא נטענה', 'Preview not loaded'));
  if (guard && !guardAck) missing.push(L('אישור אזהרת שליחה כפולה', 'Acknowledge the duplicate-send warning'));
  if (rangeInvalid) missing.push(L('טווח לא תקין', 'Invalid range'));
  if (!rcChecked) missing.push(L('אישור נמענים', 'Confirm recipients'));
  if (!pcChecked) missing.push(L('אישור תצוגה מקדימה', 'Confirm message preview'));
  if (!ccChecked || !excelConsentValid) missing.push(L('אישור הסכמה לדיוור', 'Marketing consent approval'));
  if (plannedCount === 0) missing.push(L('אין נמענים לשליחה', 'No recipients to send to'));
  if (hasCapacityShortfall) missing.push(L('אין מספיק קיבולת דיוור', 'Not enough broadcast capacity'));
  if (scheduleTooSoon) missing.push(L('בחר זמן עתידי לתזמון', 'Pick a future time to schedule'));
  const blocked = missing.length > 0;

  // ───────────── actions ─────────────
  const goResults = () => router.replace(`${BASE}/wa-results?id=${encodeURIComponent(campaignId)}` as any);
  const goList = () => router.replace(BASE as any);

  const resetBulkHistory = () => {
    if (!organization) return;
    Alert.alert(
      L('איפוס היסטוריית בלוקים', 'Reset block history'),
      L('הבלוק הבא יתחיל שוב מתחילת הרשימה. להמשיך?', 'The next block will start again from the top of the list. Continue?'),
      [
        { text: L('ביטול', 'Cancel'), style: 'cancel' },
        {
          text: L('איפוס', 'Reset'),
          style: 'destructive',
          onPress: async () => {
            try {
              await campaignsApi.resetBulkRange(organization, campaignId);
              setCampaign((c) => (c ? { ...c, lastBulkStart: 0, lastBulkEnd: 0, BulkHistory: [] } : c));
              setStartStr('0');
              setEndStr(String(Math.max(1, all.length)));
            } catch (e: any) {
              Alert.alert(L('שגיאה', 'Error'), e?.message || '');
            }
          },
        },
      ],
    );
  };

  const doSchedule = async () => {
    if (!organization || !campaign || !scheduleDate) return;
    const start = rangeActive ? rangeStart : 0;
    const end = rangeActive ? rangeEnd : all.length;
    const runAt = scheduleDate;
    sendingRef.current = true;
    setPhase('sending');
    setSendError('');
    try {
      await campaignsApi.saveScheduledRuns(
        organization,
        campaignId,
        [
          {
            runAt: runAt.toISOString(),
            batchStart: start,
            batchEnd: end,
            batchNumber: 1,
            recipients: Math.max(0, Math.min(end, all.length) - start),
            weekday: runAt.getDay(),
            time: `${pad2(runAt.getHours())}:${pad2(runAt.getMinutes())}`,
          },
        ],
        deviceTimeZone(),
        weekly
          ? {
              frequency: 'weekly',
              timezone: deviceTimeZone(),
              horizonMonths: 12,
              endCondition: { type: 'count', value: String(Math.max(1, parseInt(repeatCount, 10) || 1)) },
            }
          : undefined,
      );
      invalidateRunSummary(campaignId);
      setScheduledInfo({ runAt, recipients: Math.max(0, Math.min(end, all.length) - start), weekly });
      setPhase('scheduled');
    } catch (e: any) {
      setSendError(e?.response?.data?.error || e?.message || L('התזמון נכשל', 'Scheduling failed'));
      setPhase('ready');
    } finally {
      sendingRef.current = false;
    }
  };

  const doRun = async () => {
    if (!organization || !campaign) return;
    const isTemplate = String(campaign.messageType || 'template').toLowerCase() === 'template';
    const tplId = campaignTemplateId(campaign);
    if (isTemplate && !tplId) {
      Alert.alert(
        L('חסרה תבנית', 'Missing template'),
        L('לא ניתן להריץ קמפיין תבנית בלי תבנית וואטסאפ. ערוך את הקמפיין באתר ובחר תבנית.', 'Cannot run a template campaign without a WhatsApp template. Edit the campaign on the web and pick one.'),
      );
      return;
    }
    const runData: Record<string, any> = {
      recipientSource: campaign.recipientSource,
      recipientSourceTable: campaign.recipientSourceTable || 'Gambot_Contacts',
      recipientPhoneNumbers: toSend.map((r) => r.phoneNumber),
      messageType: campaign.messageType || 'template',
      templateId: tplId || null,
      campaignId: campaign.campaingId || campaignId,
      runById: user?.userId,
      message: campaign.message,
      fromNumberId: campaign.fromNumberId || undefined,
      bulkStart: rangeActive ? rangeStart : undefined,
      bulkEnd: rangeActive ? rangeEnd : undefined,
    };
    if (isExcel && toSend.length > 0) {
      runData.excelRecipients = toSend.map((r) => ({
        phone: r.phone || r.phoneNumber,
        variables: r.variables || {},
        rowData: r.rowData || undefined,
        saveAsContact: r.saveAsContact ?? false,
        contactFields: r.contactFields || undefined,
      }));
      runData.excelConsent = {
        consentConfirmed: excelMode === 'document_consent',
        consentSource: excelMode === 'document_consent' ? resolvedExcelSource : null,
      };
    }

    sendingRef.current = true;
    setSendError('');
    setUncertain(false);
    setSentCount(toSend.length);
    setProgressRun(null);
    setPollCount(0);
    startedAtRef.current = Date.now();
    setPhase('sending');
    try {
      // Persist the bulk range BEFORE running, so it survives even if the request times out.
      if (rangeActive) {
        await campaignsApi.saveBulkRange(organization, campaignId, rangeStart, rangeEnd).catch(() => undefined);
      }
      await campaignsApi.runCampaign(organization, runData);
    } catch (e: any) {
      const noResponse = !e?.response;
      if (isTimeoutError(e) || noResponse) {
        // The request may well have reached the server (background send) — never auto-retry; verify in results.
        setUncertain(true);
      } else {
        setSendError(e?.response?.data?.error || e?.message || L('ההרצה נכשלה', 'Failed to run the campaign'));
        setPhase('ready');
        sendingRef.current = false;
        return;
      }
    }
    sendingRef.current = false;
    invalidateRunSummary(campaignId);
    setPhase('progress');
  };

  const onConfirm = () => {
    if (sendingRef.current) return;
    if (blocked) {
      setHighlight(true);
      return;
    }
    if (scheduleActive) {
      Alert.alert(
        L('תזמון הקמפיין', 'Schedule campaign'),
        L(
          `הקמפיין "${campaign?.campaignName}" יישלח ב-${formatWhen(scheduleDate, true)}${weekly ? ' ויחזור מדי שבוע' : ''}.`,
          `"${campaign?.campaignName}" will be sent on ${formatWhen(scheduleDate, false)}${weekly ? ' and repeat weekly' : ''}.`,
        ),
        [
          { text: L('ביטול', 'Cancel'), style: 'cancel' },
          { text: L('תזמן', 'Schedule'), onPress: doSchedule },
        ],
      );
      return;
    }
    Alert.alert(
      L('לשלוח עכשיו?', 'Send now?'),
      L(
        `הקמפיין "${campaign?.campaignName}" יישלח עכשיו ל-${plannedCount.toLocaleString()} נמענים. לא ניתן לבטל לאחר השליחה.`,
        `"${campaign?.campaignName}" will be sent now to ${plannedCount.toLocaleString()} recipients. This cannot be undone.`,
      ),
      [
        { text: L('ביטול', 'Cancel'), style: 'cancel' },
        { text: L('שלח', 'Send'), style: 'destructive', onPress: doRun },
      ],
    );
  };

  // ───────────── progress polling ─────────────
  useEffect(() => {
    if (phase !== 'progress' || !organization) return;
    let stopped = false;
    const tick = async () => {
      try {
        const runs = await campaignsApi.getResults(organization, campaignId);
        if (stopped) return;
        const since = startedAtRef.current - 5 * 60 * 1000;
        const mine = runs.find((r) => (parseRunAtAsUtc(r.RunsAt)?.getTime() ?? 0) >= since) || null;
        setProgressRun(mine);
      } catch {
        /* transient — try again on the next tick */
      }
      if (!stopped) setPollCount((n) => n + 1);
    };
    tick();
    const timer = setInterval(tick, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [phase, organization, campaignId]);

  // ───────────── render helpers ─────────────
  const cardBg = theme.colors.surface;
  const sub = theme.colors.onSurfaceVariant;

  if (!organization || !campaignId) {
    return (
      <View style={[styles.center, { backgroundColor: theme.colors.background }]}>
        <WaHeader title={L('הרצת קמפיין', 'Run campaign')} />
        <Text style={{ color: sub, marginTop: 40 }}>{L('חסרים פרטי קמפיין', 'Missing campaign details')}</Text>
      </View>
    );
  }

  if (phase === 'loading') {
    return (
      <View style={[styles.flex, { backgroundColor: theme.colors.background }]}>
        <WaHeader title={L('הרצת קמפיין', 'Run campaign')} />
        <View style={styles.center}>
          {loadError ? (
            <View style={{ alignItems: 'center', gap: 12, padding: 24 }}>
              <MaterialCommunityIcons name="alert-circle-outline" size={44} color={theme.colors.error} />
              <Text style={{ color: theme.colors.onSurface, textAlign: 'center' }}>{loadError}</Text>
              <Button mode="contained" buttonColor="#2e6155" onPress={() => setReloadKey((k) => k + 1)}>
                {L('נסה שוב', 'Retry')}
              </Button>
            </View>
          ) : (
            <View style={{ alignItems: 'center', gap: 12 }}>
              <ActivityIndicator color="#2e6155" />
              <Text style={{ color: sub }}>{L('טוען נמענים ותצוגה מקדימה…', 'Loading recipients & preview…')}</Text>
            </View>
          )}
        </View>
      </View>
    );
  }

  if (phase === 'progress') {
    const st = progressRun ? computeRunStats(progressRun) : null;
    const total = st?.total || sentCount;
    const processed = st ? st.sent + st.failed + st.skipped + st.stopped : 0;
    const running = !progressRun || /process|queue|sending|pending/i.test(String(progressRun.Status || ''));
    const finished = !!progressRun && !running;
    return (
      <View style={[styles.flex, { backgroundColor: theme.colors.background }]}>
        <WaHeader title={campaign?.campaignName || ''} subtitle={L('שליחה', 'Sending')} onBack={goList} />
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
          <Section>
            <View style={{ alignItems: 'center', gap: 10, paddingVertical: 6 }}>
              {finished ? (
                <MaterialCommunityIcons name="check-circle" size={48} color="#16a34a" />
              ) : (
                <ActivityIndicator size="large" color="#2e6155" />
              )}
              <Text style={{ fontSize: 17, fontWeight: '800', color: theme.colors.onSurface, textAlign: 'center' }}>
                {finished
                  ? L('השליחה הסתיימה', 'Sending finished')
                  : L(`שולח ${total.toLocaleString()} הודעות ברקע…`, `Sending ${total.toLocaleString()} messages in the background…`)}
              </Text>
              <Text style={{ color: sub, fontSize: 12.5, textAlign: 'center' }}>
                {L('אפשר לצאת מהמסך – השליחה ממשיכה בשרת.', 'You can leave this screen — sending continues on the server.')}
              </Text>
            </View>
            {total > 0 ? <ProgressBar progress={Math.min(1, processed / total)} color="#2e6155" style={{ height: 8, borderRadius: 4 }} /> : null}
            {st ? (
              <View style={[styles.statsRow, { flexDirection }]}>
                <Stat label={L('נשלחו', 'Sent')} value={st.sent} color="#2e6155" />
                <Stat label={L('נמסרו', 'Delivered')} value={st.delivered} color="#2563eb" />
                <Stat label={L('נקראו', 'Read')} value={st.read} color="#7c3aed" />
                <Stat label={L('נכשלו', 'Failed')} value={st.failed} color={st.failed ? '#dc2626' : undefined} />
              </View>
            ) : (
              <Text style={{ color: sub, textAlign: 'center', fontSize: 12.5 }}>
                {pollCount === 0 ? L('מתחיל…', 'Starting…') : L('ממתין לתוצאות הריצה…', 'Waiting for the run to appear…')}
              </Text>
            )}
          </Section>
          {uncertain ? (
            <Notice
              kind="warn"
              text={L(
                'החיבור נותק או שהבקשה ארכה זמן רב. ייתכן שהשליחה כבר התחילה – בדוק בתוצאות לפני שתנסה שוב כדי לא לשלוח כפול.',
                'The connection dropped or the request took long. The send may already have started — check the results before retrying to avoid duplicates.',
              )}
            />
          ) : null}
          <Button mode="contained" buttonColor="#2e6155" icon="chart-box-outline" onPress={goResults}>
            {L('לתוצאות המלאות', 'View full results')}
          </Button>
          <Button mode="outlined" onPress={goList}>
            {L('חזרה לקמפיינים', 'Back to campaigns')}
          </Button>
        </ScrollView>
      </View>
    );
  }

  if (phase === 'scheduled' && scheduledInfo) {
    return (
      <View style={[styles.flex, { backgroundColor: theme.colors.background }]}>
        <WaHeader title={campaign?.campaignName || ''} subtitle={L('תזמון', 'Scheduled')} onBack={goList} />
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
          <Section>
            <View style={{ alignItems: 'center', gap: 10, paddingVertical: 6 }}>
              <MaterialCommunityIcons name="calendar-check" size={48} color="#2563eb" />
              <Text style={{ fontSize: 17, fontWeight: '800', color: theme.colors.onSurface, textAlign: 'center' }}>
                {L('הקמפיין תוזמן', 'Campaign scheduled')}
              </Text>
              <Text style={{ color: sub, textAlign: 'center' }}>
                {L(
                  `${scheduledInfo.recipients.toLocaleString()} נמענים · ${formatWhen(scheduledInfo.runAt, true)}${scheduledInfo.weekly ? ' · חוזר מדי שבוע' : ''}`,
                  `${scheduledInfo.recipients.toLocaleString()} recipients · ${formatWhen(scheduledInfo.runAt, false)}${scheduledInfo.weekly ? ' · repeats weekly' : ''}`,
                )}
              </Text>
              <Text style={{ color: sub, fontSize: 12, textAlign: 'center' }}>{deviceTimeZone()}</Text>
            </View>
          </Section>
          <Button mode="contained" buttonColor="#2e6155" onPress={goList}>
            {L('חזרה לקמפיינים', 'Back to campaigns')}
          </Button>
        </ScrollView>
      </View>
    );
  }

  // ───────────── ready / sending ─────────────
  const sending = phase === 'sending';
  const listRows = (listSearch.trim()
    ? base.filter((r) => `${r.name || ''} ${r.phoneNumber}`.toLowerCase().includes(listSearch.trim().toLowerCase()))
    : base
  ).slice(0, LIST_PREVIEW_LIMIT);
  const whenStr = guard && guard.kind === 'future' ? formatWhen(new Date(guard.whenMs), he) : '';

  return (
    <KeyboardAvoidingView style={[styles.flex, { backgroundColor: theme.colors.background }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <WaHeader title={campaign?.campaignName || ''} subtitle={L('תצוגה מקדימה והרצה', 'Preview & run')} />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: 24 }]} keyboardShouldPersistTaps="handled">
        {sendError ? <Notice kind="error" text={sendError} /> : null}

        {/* Duplicate-send guard */}
        {guard ? (
          <Section tint="#d97706" title={L('אזהרת שליחה כפולה', 'Duplicate-send warning')} icon="alert">
            <Text style={{ color: theme.colors.onSurface, fontSize: 13, lineHeight: 19, textAlign }}>
              {guard.kind === 'future'
                ? guard.imminent
                  ? L(
                      'הקמפיין כבר מתוזמן לרוץ אוטומטית – המשלוח הראשון מתחיל בקרוב מאוד. הרצה ידנית עכשיו תשלח הודעות כפולות לאותם נמענים.',
                      'This campaign is already scheduled to run automatically — the first batch starts very soon. Running it manually now will send DUPLICATE messages to the same recipients.',
                    )
                  : L(
                      `הקמפיין מתוזמן לרוץ אוטומטית ב-${whenStr}. הרצה ידנית עכשיו תשלח הודעות כפולות – הנמענים יקבלו שוב במועד המתוזמן.`,
                      `This campaign is scheduled to run automatically on ${whenStr}. Running it manually now will send DUPLICATE messages — recipients will get it again at the scheduled time.`,
                    )
                : L('הקמפיין כבר רץ ואין לו ריצה עתידית מתוזמנת. הרצה נוספת תשלח שוב לנמענים.', 'This campaign already ran and has no upcoming scheduled run. Running it again will message the recipients again.')}
            </Text>
            <CheckRow
              checked={guardAck}
              onChange={setGuardAck}
              highlight={highlight}
              label={L('אני מבין/ה ורוצה להריץ בכל זאת', 'I understand and want to run anyway')}
            />
          </Section>
        ) : null}

        {/* Regular (non-template) warning */}
        {String(campaign?.messageType || '').toLowerCase() === 'regular' ? (
          <Notice
            kind="warn"
            text={L(
              'הודעה רגילה (לא תבנית) מגיעה רק לנמענים שבחלון 24 השעות הפתוח.',
              'A regular (non-template) message is only delivered inside the open 24-hour window.',
            )}
          />
        ) : null}

        {/* Preview */}
        <Section title={L('תצוגה מקדימה', 'Message preview')} icon="message-text-outline">
          {previewError ? (
            <Notice kind="error" text={previewError}>
              <Button compact mode="outlined" onPress={() => setReloadKey((k) => k + 1)}>
                {L('נסה שוב', 'Retry')}
              </Button>
            </Notice>
          ) : null}
          {info ? <TemplateBubble info={info} bodyText={resolvedBody} mediaUrl={mediaUrl} he={he} /> : null}
          {sample ? (
            <View style={[styles.sampleRow, { flexDirection }]}>
              <IconButton
                icon={he ? 'chevron-right' : 'chevron-left'}
                size={20}
                disabled={toSend.length < 2}
                onPress={() => setSampleIdx((i) => (i - 1 + toSend.length) % Math.max(1, toSend.length))}
              />
              <View style={{ flex: 1, alignItems: 'center' }}>
                <Text style={{ color: theme.colors.onSurface, fontWeight: '600', fontSize: 13 }} numberOfLines={1}>
                  {sample.name || sample.phoneNumber}
                </Text>
                <Text style={{ color: sub, fontSize: 12 }}>
                  {sample.phoneNumber} · {L('דוגמה', 'sample')} {toSend.length ? (sampleIdx % toSend.length) + 1 : 1}/{Math.max(1, toSend.length)}
                </Text>
              </View>
              <IconButton
                icon={he ? 'chevron-left' : 'chevron-right'}
                size={20}
                disabled={toSend.length < 2}
                onPress={() => setSampleIdx((i) => (i + 1) % Math.max(1, toSend.length))}
              />
            </View>
          ) : null}
          <Text style={{ color: sub, fontSize: 11.5, textAlign }}>
            {L('הערכים בתצוגה הם של הנמען לדוגמה – כל נמען יקבל את הערכים שלו.', "Values shown are the sample recipient's — each recipient gets their own.")}
          </Text>
          <CheckRow
            checked={pcChecked}
            onChange={setPcChecked}
            highlight={highlight}
            label={L('אני מאשר/ת את תצוגת ההודעה', 'I confirm the message preview')}
          />
        </Section>

        {/* Sender + counts */}
        <Section title={L('פרטי שליחה', 'Send details')} icon="send-outline">
          <View style={[styles.statsRow, { flexDirection }]}>
            <Stat label={L('יישלחו', 'Will send')} value={plannedCount.toLocaleString()} color="#2e6155" />
            <Stat label={L('ברשימה', 'In list')} value={base.length.toLocaleString()} />
            {!isExcel ? <Stat label={L('הסכימו', 'Consented')} value={stats.granted.toLocaleString()} color="#16a34a" /> : null}
            {!isExcel ? <Stat label={L('ללא הסכמה', 'Opted out')} value={stats.revoked.toLocaleString()} color={stats.revoked ? '#dc2626' : undefined} /> : null}
          </View>
          {senderNum ? (
            <View style={[styles.senderRow, { flexDirection, backgroundColor: withAlpha('#2e6155', 0.1) }]}>
              <MaterialCommunityIcons name="cellphone-message" size={18} color="#2e6155" />
              <Text style={{ flex: 1, color: theme.colors.onSurface, fontSize: 13, textAlign }}>
                {L('נשלח מהמספר: ', 'Sending from: ')}
                <Text style={{ fontWeight: '700' }}>{senderNum.DisplayNumber}</Text>
                {senderNum.IsPrimary ? (he ? ' ★ (ראשי)' : ' ★ (primary)') : ''}
                {senderNum.Label ? ` – ${senderNum.Label}` : ''}
              </Text>
            </View>
          ) : null}

          {Number.isFinite(dailyLimit) && plannedCount > dailyLimit ? (
            <Notice
              kind="warn"
              text={L(
                `אתה עומד לשלוח ${plannedCount.toLocaleString()} הודעות, מעל מגבלת ה-24 שעות של Meta למספר (${dailyLimit.toLocaleString()}). חלק מההודעות עלולות להידחות – שקול לשלוח בבלוקים קטנים יותר (אפשרות הטווח למטה).`,
                `You're about to send ${plannedCount.toLocaleString()} messages, above Meta's 24-hour limit for this number (${dailyLimit.toLocaleString()}). Some may be rejected — consider sending in smaller blocks (range option below).`,
              )}
            />
          ) : senderLimit && Number.isFinite(dailyLimit) ? (
            <Text style={{ color: sub, fontSize: 12, textAlign }}>
              {L(`מגבלת Meta ל-24 שעות: ${dailyLimit.toLocaleString()}`, `Meta 24-hour limit: ${dailyLimit.toLocaleString()}`)}
              {senderLimit.QualityRating ? ` · ${L('איכות', 'quality')}: ${senderLimit.QualityRating}` : ''}
            </Text>
          ) : null}
          {qualityRed ? (
            <Notice
              kind="warn"
              text={L(
                'איכות המספר נמוכה (אדום) – שליחה המונית עלולה להוריד את מגבלת המספר או לחסום אותו.',
                'This number\'s quality rating is RED — a bulk send may lower its limit or get it restricted.',
              )}
            />
          ) : null}

          {hasCapacityShortfall ? (
            <Notice
              kind="error"
              text={
                bank?.isTrial
                  ? L(
                      `בתקופת הניסיון ניתן לשלוח עד ${(bank?.trialCap || 300).toLocaleString()} הודעות דיוור (נותרו ${capacityAvailable.toLocaleString()}). כדי לשלוח ${plannedCount.toLocaleString()} נמענים יש לרכוש בנק דיוור או לשדרג חבילה באתר.`,
                      `During the trial you can send up to ${(bank?.trialCap || 300).toLocaleString()} broadcast messages (${capacityAvailable.toLocaleString()} left). To send ${plannedCount.toLocaleString()} recipients, buy a broadcast pack or upgrade on the web.`,
                    )
                  : L(
                      `נבחרו ${plannedCount.toLocaleString()} נמענים אך נותרו ${capacityAvailable.toLocaleString()} (מכסה חודשית + בנק). חסרים ${capacityShortfall.toLocaleString()} – יש לרכוש בנק או לשדרג חבילה באתר. אפשר גם לצמצם את הטווח.`,
                      `${plannedCount.toLocaleString()} recipients selected but only ${capacityAvailable.toLocaleString()} left (monthly quota + bank). Short by ${capacityShortfall.toLocaleString()} — buy a pack or upgrade on the web, or narrow the range.`,
                    )
              }
            />
          ) : bank && (bank.limitsConfigured || bank.isTrial) ? (
            <Text style={{ color: sub, fontSize: 12, textAlign }}>
              {L(`קיבולת דיוור זמינה: ${capacityAvailable.toLocaleString()}`, `Broadcast capacity left: ${capacityAvailable.toLocaleString()}`)}
              {bank.planName ? ` · ${bank.planName}` : ''}
            </Text>
          ) : null}
        </Section>

        {/* Recipients */}
        <Section title={L(`נמענים (${base.length.toLocaleString()})`, `Recipients (${base.length.toLocaleString()})`)} icon="account-multiple-outline">
          {all.length === 0 ? (
            <Notice kind="warn" text={L('לא נמצאו נמענים בקמפיין הזה.', 'No recipients were found for this campaign.')} />
          ) : null}
          {removed.size > 0 ? (
            <View style={[styles.rowBetween, { flexDirection }]}>
              <Text style={{ color: sub, fontSize: 12 }}>{L(`${removed.size} הוסרו ידנית`, `${removed.size} removed manually`)}</Text>
              <Button compact onPress={() => setRemoved(new Set())}>
                {L('שחזר', 'Restore')}
              </Button>
            </View>
          ) : null}
          <Pressable onPress={() => setListOpen((o) => !o)} style={[styles.rowBetween, { flexDirection }]}>
            <Text style={{ color: theme.colors.primary, fontWeight: '600', fontSize: 13 }}>
              {listOpen ? L('הסתר רשימה', 'Hide list') : L('הצג / הסר נמענים', 'Show / remove recipients')}
            </Text>
            <MaterialCommunityIcons name={listOpen ? 'chevron-up' : 'chevron-down'} size={20} color={theme.colors.primary} />
          </Pressable>
          {listOpen ? (
            <View style={{ gap: 6 }}>
              <TextInput
                mode="outlined"
                dense
                value={listSearch}
                onChangeText={setListSearch}
                placeholder={L('חיפוש לפי שם / טלפון', 'Search name / phone')}
                left={<TextInput.Icon icon="magnify" />}
              />
              {listRows.map((r) => (
                <View key={String(r.phoneNumber)} style={[styles.recipientRow, { flexDirection, borderColor: theme.colors.outlineVariant }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: theme.colors.onSurface, fontSize: 13, textAlign }} numberOfLines={1}>
                      {r.name || r.phoneNumber}
                    </Text>
                    <Text style={{ color: sub, fontSize: 11.5, textAlign }}>{r.phoneNumber}</Text>
                  </View>
                  {!isExcel ? (
                    <MaterialCommunityIcons
                      name={r.consent === true ? 'shield-check' : r.consent === false ? 'shield-off' : 'shield-outline'}
                      size={16}
                      color={r.consent === true ? '#16a34a' : r.consent === false ? '#dc2626' : sub}
                    />
                  ) : null}
                  <IconButton
                    icon="close"
                    size={16}
                    onPress={() => setRemoved((prev) => new Set(prev).add(String(r.phoneNumber)))}
                  />
                </View>
              ))}
              {base.length > LIST_PREVIEW_LIMIT && !listSearch.trim() ? (
                <Text style={{ color: sub, fontSize: 11.5, textAlign: 'center' }}>
                  {L(`מוצגים ${LIST_PREVIEW_LIMIT} הראשונים – השתמש בחיפוש`, `Showing the first ${LIST_PREVIEW_LIMIT} — use search`)}
                </Text>
              ) : null}
            </View>
          ) : null}
          <CheckRow
            checked={rcChecked}
            onChange={setRcChecked}
            highlight={highlight}
            label={L('אני מאשר/ת את רשימת הנמענים', 'I confirm the recipients')}
          />
        </Section>

        {/* Block range */}
        {all.length > 0 ? (
          <Section title={L('שליחה בבלוקים (טווח)', 'Send in blocks (range)')} icon="format-list-numbered">
            <View style={[styles.rowBetween, { flexDirection }]}>
              <Text style={{ flex: 1, color: theme.colors.onSurface, fontSize: 13, textAlign }}>
                {L(`שלח רק חלק מהרשימה (סה"כ ${all.length.toLocaleString()})`, `Send only part of the list (total ${all.length.toLocaleString()})`)}
              </Text>
              <Switch
                value={useBulk}
                onValueChange={(v) => {
                  setUseBulk(v);
                  if (v && !startStr && !endStr) {
                    setStartStr('0');
                    setEndStr(String(Math.min(all.length, 200)));
                  }
                }}
                color="#2e6155"
              />
            </View>
            {useBulk ? (
              <>
                <View style={[styles.rowBetween, { flexDirection, gap: 10 }]}>
                  <TextInput
                    style={styles.rangeInput}
                    mode="outlined"
                    dense
                    keyboardType="number-pad"
                    label={L('מ- (כולל)', 'From (incl.)')}
                    value={startStr}
                    onChangeText={(t) => setStartStr(t.replace(/\D/g, ''))}
                  />
                  <TextInput
                    style={styles.rangeInput}
                    mode="outlined"
                    dense
                    keyboardType="number-pad"
                    label={L('עד (לא כולל)', 'To (excl.)')}
                    value={endStr}
                    onChangeText={(t) => setEndStr(t.replace(/\D/g, ''))}
                  />
                </View>
                {rangeInvalid ? (
                  <Notice kind="error" text={L('הטווח חייב להיות מספרים כש"עד" גדול מ"מ".', '"To" must be greater than "From".')} />
                ) : rangeActive && rangeStart >= all.length ? (
                  <Notice kind="warn" text={L('הטווח מעבר לסוף הרשימה – אין נמענים לשליחה.', 'The range is past the end of the list — nothing to send.')} />
                ) : null}
                {num(campaign?.lastBulkEnd) > 0 ? (
                  <View style={{ gap: 4 }}>
                    <Text style={{ color: sub, fontSize: 12, textAlign }}>
                      {L(
                        `הריצה הקודמת כיסתה ${num(campaign?.lastBulkStart)}–${num(campaign?.lastBulkEnd)}; הבלוק הבא הוזן אוטומטית.`,
                        `The previous run covered ${num(campaign?.lastBulkStart)}–${num(campaign?.lastBulkEnd)}; the next block was pre-filled.`,
                      )}
                    </Text>
                    <Button compact mode="text" onPress={resetBulkHistory} style={{ alignSelf: 'flex-start' }}>
                      {L('איפוס היסטוריית בלוקים', 'Reset block history')}
                    </Button>
                  </View>
                ) : null}
              </>
            ) : null}
            <Text style={{ color: sub, fontSize: 11.5, textAlign }}>
              {L(
                'פיצול אוטומטי לבלוקים מרובים ותזמון בלוקים חוזרים זמינים באתר.',
                'Auto-splitting into several blocks and recurring block plans are available on the web.',
              )}
            </Text>
          </Section>
        ) : null}

        {/* Consent */}
        <Section title={L('אישור הסכמה לדיוור', 'Marketing consent approval')} icon="lock-outline">
          {!isExcel ? (
            <View style={{ gap: 6 }}>
              <Text style={{ color: theme.colors.onSurface, fontWeight: '600', fontSize: 13, textAlign }}>{L('למי לשלוח?', 'Who to send to?')}</Text>
              {(
                [
                  ['all', L(`לכולם (${base.length - stats.revoked} נמענים)`, `Everyone (${base.length - stats.revoked} recipients)`)],
                  ['consentOnly', L(`רק למי שהסכים (${stats.granted} נמענים)`, `Only consented contacts (${stats.granted} recipients)`)],
                ] as Array<['all' | 'consentOnly', string]>
              ).map(([val, label]) => (
                <Pressable key={val} onPress={() => setConsentMode(val)} style={[styles.radioRow, { flexDirection }]}>
                  <MaterialCommunityIcons
                    name={consentMode === val ? 'radiobox-marked' : 'radiobox-blank'}
                    size={22}
                    color={consentMode === val ? '#2e6155' : sub}
                  />
                  <Text style={{ flex: 1, color: theme.colors.onSurface, fontSize: 13, textAlign }}>{label}</Text>
                </Pressable>
              ))}
              {consentMode === 'consentOnly' ? (
                <Notice kind="warn" text={L(`${base.length - stats.granted} נמענים ידולגו (ללא הסכמה מתועדת).`, `${base.length - stats.granted} recipients will be skipped (no recorded consent).`)} />
              ) : null}
              {stats.revoked > 0 ? (
                <Notice
                  kind="error"
                  text={L(
                    `${stats.revoked} אנשי קשר סומנו "ללא הסכמה" ויוחרגו תמיד – גם בשליחה לכולם.`,
                    `${stats.revoked} contacts marked "no consent" are always excluded — even when sending to everyone.`,
                  )}
                />
              ) : null}
              {consentMode === 'all' && stats.unknown > 0 ? (
                <Notice
                  kind="warn"
                  text={L(
                    `ל-${stats.unknown} נמענים אין הסכמה מתועדת. שליחה אליהם באחריותך.`,
                    `${stats.unknown} recipients have no recorded consent. Sending to them is your responsibility.`,
                  )}
                />
              ) : null}
              {consentMode === 'consentOnly' && stats.granted === 0 ? (
                <Notice kind="error" text={L('אין נמענים שהסכימו לדיוור.', 'No recipients have consented.')} />
              ) : null}
            </View>
          ) : (
            <View style={{ gap: 6 }}>
              <Text style={{ color: theme.colors.onSurface, fontWeight: '600', fontSize: 13, textAlign }}>
                {L('קמפיין מאקסל – שליחה לכל הנמענים', 'Excel campaign — send to all recipients')}
              </Text>
              {(
                [
                  ['legal_only', L('אישור דיוור ללא תיעוד הסכמה במערכת', 'Approve marketing without recording consent in the system')],
                  ['document_consent', L('תיעוד הסכמה – כל הנמענים מאושרים לדיוור', 'Document consent — all recipients are approved for marketing')],
                ] as Array<['legal_only' | 'document_consent', string]>
              ).map(([val, label]) => (
                <Pressable key={val} onPress={() => setExcelMode(val)} style={[styles.radioRow, { flexDirection }]}>
                  <MaterialCommunityIcons
                    name={excelMode === val ? 'radiobox-marked' : 'radiobox-blank'}
                    size={22}
                    color={excelMode === val ? '#2e6155' : sub}
                  />
                  <Text style={{ flex: 1, color: theme.colors.onSurface, fontSize: 13, textAlign }}>{label}</Text>
                </Pressable>
              ))}
              {excelMode === 'document_consent' ? (
                <View style={{ gap: 6 }}>
                  <Text style={{ color: sub, fontSize: 12, textAlign }}>{L('מקור ההסכמה:', 'Consent source:')}</Text>
                  <View style={[styles.chipsWrap, { flexDirection }]}>
                    {EXCEL_CONSENT_SOURCES.map((s) => {
                      const on = excelSource === s.value;
                      return (
                        <Pressable
                          key={s.value}
                          onPress={() => setExcelSource(s.value)}
                          style={[
                            styles.chip,
                            { borderColor: on ? '#2e6155' : theme.colors.outlineVariant, backgroundColor: on ? withAlpha('#2e6155', 0.12) : 'transparent' },
                          ]}
                        >
                          <Text style={{ color: on ? '#2e6155' : theme.colors.onSurface, fontSize: 12.5, fontWeight: on ? '700' : '400' }}>{he ? s.he : s.en}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  {excelSource === 'other' ? (
                    <TextInput
                      mode="outlined"
                      dense
                      value={excelOther}
                      onChangeText={setExcelOther}
                      label={L('פרט מקור ההסכמה', 'Specify consent source')}
                    />
                  ) : null}
                </View>
              ) : null}
            </View>
          )}
          <CheckRow
            checked={ccChecked}
            onChange={setCcChecked}
            highlight={highlight}
            label={
              isExcel
                ? excelMode === 'document_consent'
                  ? L(
                      'אני מאשר/ת שיש לי הסכמה חוקית לדיוור לכל הנמענים ברשימת האקסל, ומאשר/ת תיעוד ההסכמה במערכת. אני לוקח/ת אחריות מלאה על עמידה בחוק הספאם ותקנות הפרטיות, ומוותר/ת על כל זכות לפנות לגמבוט בטענה כלשהי בנושא זה.',
                      'I confirm legal consent to market to all Excel recipients and approve recording consent in the system. I take full responsibility for compliance, and waive any right to raise any claim against Gambot in this matter.',
                    )
                  : L(
                      'אני מאשר/ת שיש לי בסיס חוקי לדיוור לכל הנמענים ברשימת האקסל (ללא תיעוד הסכמה במערכת). אני לוקח/ת אחריות מלאה על עמידה בחוק הספאם ותקנות הפרטיות, ומוותר/ת על כל זכות לפנות לגמבוט בטענה כלשהי בנושא זה.',
                      'I confirm I have a legal basis to market to all Excel recipients (without recording consent in the system). I take full responsibility for compliance, and waive any right to raise any claim against Gambot in this matter.',
                    )
                : L(
                    'אני מאשר שיש בידי הסכמה חוקית לשלוח הודעות שיווקיות לאנשי הקשר ברשימה זו. אני לוקח/ת אחריות מלאה על עמידה בחוק הספאם ותקנות הפרטיות, ומוותר/ת על כל זכות לפנות לגמבוט בטענה כלשהי בנושא זה.',
                    'I confirm that I have obtained the necessary legal consent to send marketing messages to the recipients on this list. I take full responsibility for compliance with anti-spam and privacy regulations, and waive any right to raise any claim against Gambot in this matter.',
                  )
            }
          />
        </Section>

        {/* Schedule instead */}
        <Section title={L('תזמון במקום שליחה מיידית', 'Schedule instead of sending now')} icon="calendar-clock">
          <View style={[styles.rowBetween, { flexDirection }]}>
            <Text style={{ flex: 1, color: theme.colors.onSurface, fontSize: 13, textAlign }}>
              {L('שלח בזמן מאוחר יותר (בלוק אחד)', 'Send at a later time (single block)')}
            </Text>
            <Switch value={scheduleOn} onValueChange={setScheduleOn} color="#2e6155" />
          </View>
          {scheduleOn && scheduleBlockedReason ? <Notice kind="warn" text={scheduleBlockedReason} /> : null}
          {scheduleActive ? (
            <>
              <Pressable
                onPress={() => setPickerOpen(true)}
                style={[styles.pickRow, { flexDirection, borderColor: scheduleTooSoon && highlight ? theme.colors.error : theme.colors.outlineVariant }]}
              >
                <MaterialCommunityIcons name="calendar" size={20} color={theme.colors.primary} />
                <Text style={{ flex: 1, color: scheduleDate ? theme.colors.onSurface : sub, textAlign }}>
                  {scheduleDate ? formatWhen(scheduleDate, he) : L('בחר תאריך ושעה', 'Pick date & time')}
                </Text>
                <Text style={{ color: sub, fontSize: 11 }}>{deviceTimeZone()}</Text>
              </Pressable>
              <View style={[styles.rowBetween, { flexDirection }]}>
                <Text style={{ flex: 1, color: theme.colors.onSurface, fontSize: 13, textAlign }}>{L('חזור מדי שבוע', 'Repeat weekly')}</Text>
                <Switch value={weekly} onValueChange={setWeekly} color="#2e6155" />
              </View>
              {weekly ? (
                <TextInput
                  mode="outlined"
                  dense
                  keyboardType="number-pad"
                  label={L('מספר ריצות', 'Number of runs')}
                  value={repeatCount}
                  onChangeText={(t) => setRepeatCount(t.replace(/\D/g, ''))}
                />
              ) : null}
            </>
          ) : null}
        </Section>

        <GambotDateTimePicker
          visible={pickerOpen}
          value={scheduleDate}
          minimumDate={new Date()}
          title={L('מועד השליחה', 'Send time')}
          onConfirm={(d) => {
            setScheduleDate(d);
            setPickerOpen(false);
          }}
          onDismiss={() => setPickerOpen(false)}
        />
      </ScrollView>

      {/* Sticky confirm bar */}
      <View style={[styles.bar, { backgroundColor: cardBg, borderTopColor: theme.colors.outlineVariant, paddingBottom: Math.max(insets.bottom, 10) }]}>
        {blocked && highlight ? (
          <Text style={{ color: theme.colors.error, fontSize: 12, textAlign, marginBottom: 6 }}>
            {L('חסר: ', 'Missing: ')}
            {missing.join(' · ')}
          </Text>
        ) : null}
        <Button
          mode="contained"
          buttonColor={scheduleActive ? '#2563eb' : '#2e6155'}
          icon={scheduleActive ? 'calendar-check' : 'send'}
          loading={sending}
          disabled={sending}
          onPress={onConfirm}
          contentStyle={{ paddingVertical: 4 }}
        >
          {scheduleActive
            ? L(`תזמן ${plannedCount.toLocaleString()} נמענים`, `Schedule ${plannedCount.toLocaleString()} recipients`)
            : L(`שלח עכשיו ל-${plannedCount.toLocaleString()} נמענים`, `Send now to ${plannedCount.toLocaleString()} recipients`)}
        </Button>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 14, gap: 12 },
  statsRow: { justifyContent: 'space-around', alignItems: 'center', paddingVertical: 4 },
  stat: { alignItems: 'center', minWidth: 60 },
  sampleRow: { alignItems: 'center' },
  senderRow: { alignItems: 'center', gap: 8, padding: 10, borderRadius: 10 },
  rowBetween: { alignItems: 'center', justifyContent: 'space-between' },
  recipientRow: { alignItems: 'center', gap: 6, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 2 },
  rangeInput: { flex: 1 },
  radioRow: { alignItems: 'center', gap: 8, paddingVertical: 4 },
  chipsWrap: { flexWrap: 'wrap', gap: 6 },
  chip: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
  pickRow: { alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: borderRadius.md, padding: 12 },
  bar: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14, paddingTop: 10 },
});
