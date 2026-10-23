import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, ScrollView, Pressable, Alert, KeyboardAvoidingView, Platform, Image } from 'react-native';
import { Text, Button, ActivityIndicator, TextInput, IconButton } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { mediaApi } from '../../../../services/api/media';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../../../stores/authStore';
import { useAppTheme } from '../../../../hooks/useAppTheme';
import { useRTL } from '../../../../hooks/useRTL';
import { withAlpha } from '../../../../utils/formatters';
import GambotDateTimePicker from '../../../../components/GambotDateTimePicker';
import { campaignsApi, WaCampaign, WaLimit, WaNumber, WaTemplate } from '../../../../services/api/campaigns';
import PickerSheet from '../../../../components/campaigns/email/PickerSheet';
import WaHeader from '../../../../components/campaigns/whatsapp/WaHeader';
import TemplateBubble from '../../../../components/campaigns/whatsapp/TemplateBubble';
import { Section, Notice, ChipGroup, Picker } from '../../../../components/campaigns/whatsapp/formParts';
import { invalidateRunSummary } from '../../../../components/campaigns/whatsapp/useRunSummaries';
import {
  FilterRow,
  FieldOp,
  buildContactFilters,
  filterToRow,
  needsValue,
  rowValid,
} from '../../../../components/campaigns/whatsapp/audience';
import {
  analyzeTemplate,
  campaignTemplateId,
  deviceTimeZone,
  formatRunAt,
  formatWabaDailyLimit,
  formatWhen,
  cleanButtonValue,
  getCachedCampaign,
  isBodyQuery,
  mappingFromQuery,
  mergeQueries,
  parseRunAtLocal,
  queryBodyIndex,
  templateKey,
  VarMapping,
  VarSource,
} from '../../../../components/campaigns/whatsapp/campaignUtils';

const BASE = '/(tabs)/more/campaigns';
const BRAND = '#2e6155';
const MIN_SCHEDULE_LEAD_MS = 60 * 1000;
const TPL_LIST_LIMIT = 30;
const TAG_LIST_LIMIT = 40;

// 'keep' (edit only): leave the campaign's existing schedule exactly as it is.
type Mode = 'draft' | 'now' | 'once' | 'weekly' | 'keep';
const pad2 = (n: number) => String(n).padStart(2, '0');

/** Header-media override: the campaign sends this file instead of the template's own image/video. */
type MediaOverride = { url: string; name: string; kind: 'file' | 'url' };
const isMediaQuery = (q: any) =>
  !!q && (q.isMediaUpload || /dynamic_image|dynamic_video/.test(String(q.Variable || '')));
const SCHEDULE_KEYS = [
  'campaignTrigger', 'campaignStatus', 'runAt', 'timezone', 'scheduleType', 'interval', 'intervalNumber',
  'EndCondition', 'Recurrence', 'AutoSplit', 'BatchSize', 'ScheduledRuns',
];

const WEEKDAYS_HE = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
const WEEKDAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function WaCreateScreen() {
  const { duplicateFrom, editId: editParam } = useLocalSearchParams<{ duplicateFrom?: string; editId?: string }>();
  const duplicateId = duplicateFrom ? String(duplicateFrom) : '';
  const editId = editParam ? String(editParam) : '';
  const sourceId = editId || duplicateId;
  const router = useRouter();
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const { flexDirection, textAlign } = useRTL();
  const { i18n } = useTranslation();
  const he = i18n.language !== 'en';
  const L = (h: string, e: string) => (he ? h : e);
  const user = useAuthStore((s) => s.user) as any;
  const organization = user?.organization as string | undefined;
  const sub = theme.colors.onSurfaceVariant;

  // ── loading / reference data ──
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [templates, setTemplates] = useState<WaTemplate[]>([]);
  const [waNumbers, setWaNumbers] = useState<WaNumber[]>([]);
  const [limits, setLimits] = useState<WaLimit[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [users, setUsers] = useState<Array<{ id: string; name: string }>>([]);
  const [fields, setFields] = useState<Array<{ name: string; label: string; type: string }>>([]);
  const [columns, setColumns] = useState<Array<{ key: string; label: string }>>([]);
  const [source, setSource] = useState<WaCampaign | null>(null);

  // ── form state ──
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [tplId, setTplId] = useState('');
  const [tplDetail, setTplDetail] = useState<WaTemplate | null>(null);
  const [tplSearch, setTplSearch] = useState('');
  const [mediaUrl, setMediaUrl] = useState('');
  const [mediaOverride, setMediaOverride] = useState<MediaOverride | null>(null);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [mediaError, setMediaError] = useState('');
  const [mediaLinkOpen, setMediaLinkOpen] = useState(false);
  const [mediaLink, setMediaLink] = useState('');
  const [rows, setRows] = useState<FilterRow[]>([]);
  const [logic, setLogic] = useState<'AND' | 'OR'>('AND');
  const [tagSearch, setTagSearch] = useState('');
  const [count, setCount] = useState<number | null>(null);
  const [countLoading, setCountLoading] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewContacts, setPreviewContacts] = useState<Array<{ phone: string; name: string }>>([]);
  const [previewTotal, setPreviewTotal] = useState(0);
  const [maps, setMaps] = useState<Record<number, VarMapping>>({});
  // Dynamic URL-button values, keyed by the query name (button{B}_dynamic_var{N}).
  const [btnMaps, setBtnMaps] = useState<Record<string, VarMapping>>({});
  const [warnings, setWarnings] = useState<Array<{ severity: string; message: string; label: string }>>([]);
  const [fromNumberId, setFromNumberId] = useState('');
  const [mode, setMode] = useState<Mode>('draft');
  const [when, setWhen] = useState<Date | null>(null);
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [endType, setEndType] = useState<'none' | 'count'>('none');
  const [endCount, setEndCount] = useState('4');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const rowId = useRef(1);
  const savingRef = useRef(false);

  const isDuplicate = !!duplicateId;
  const isEdit = !!editId;
  const hasSource = !!sourceId;
  const sourceScheduled = !!source && String(source.campaignTrigger || '') === 'Scheduled' && !!source.runAt;
  const isExcelDup = String(source?.recipientSource || '').toLowerCase() === 'excel';
  const isRegularDup = !!source && String(source.messageType || '').toLowerCase() === 'regular';
  const lockAudience = isExcelDup;
  const lockTemplate = isExcelDup || isRegularDup;
  const lockVariables = isExcelDup || isRegularDup;

  // ───────────── load reference data (+ duplicate source) ─────────────
  useEffect(() => {
    if (!organization) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError('');
      try {
        const [tpls, nums, lims, tg, us, fl, cols, src] = await Promise.all([
          campaignsApi.getTemplates(organization),
          campaignsApi.getWhatsAppNumbers(organization),
          campaignsApi.getWabaLimits(organization),
          campaignsApi.getTags(organization),
          campaignsApi.getUsers(organization),
          campaignsApi.getContactFields(organization),
          campaignsApi.getContactColumns(organization),
          hasSource ? loadSource(organization, sourceId) : Promise.resolve(null),
        ]);
        if (cancelled) return;
        setTemplates(tpls);
        setWaNumbers(nums);
        setLimits(lims);
        setTags(tg);
        setUsers(us);
        setFields(fl);
        setColumns(cols);
        const primary = nums.find((n) => n.IsPrimary) || nums[0];
        setFromNumberId(src?.fromNumberId || primary?.PhoneNumberId || '');
        if (src) {
          setSource(src);
          setName(isEdit ? String(src.campaignName || '') : `${src.campaignName || ''} ${L('(עותק)', '(copy)')}`.trim());
          const srcTplId = campaignTemplateId(src);
          if (srcTplId && tpls.some((t) => templateKey(t) === srcTplId)) setTplId(srcTplId);
          const qs = Array.isArray(src.templateVariableQuery) ? src.templateVariableQuery : [];
          // The image/video this campaign already sends instead of the template's own (so it can be replaced / reverted).
          const mq: any = qs.find((q: any) => isMediaQuery(q) && String(q.parameters_hardCoded_Text || '').trim());
          if (mq) {
            const u = String(mq.parameters_hardCoded_Text);
            setMediaOverride({ url: u, name: String(mq.parameters_webhook_value || '').replace(/^URL:\s*/, ''), kind: mq.mediaSourceType === 'url' ? 'url' : 'file' });
          }
          // Editing keeps the schedule untouched unless the user changes it.
          if (isEdit) setMode(String(src.campaignTrigger || '') === 'Scheduled' && src.runAt ? 'keep' : 'draft');
          const m: Record<number, VarMapping> = {};
          qs.filter(isBodyQuery).forEach((q) => {
            const n = queryBodyIndex(q);
            if (n != null) m[n] = mappingFromQuery(q);
          });
          setMaps(m);
          const bm: Record<string, VarMapping> = {};
          qs.filter((q: any) => q?.buttonType === 'URL_DYNAMIC' && !q.hidden && q.Variable).forEach((q: any) => {
            bm[String(q.Variable)] = mappingFromQuery(q);
          });
          setBtnMaps(bm);
          const cf = src.ContactFilters;
          if (cf && Array.isArray(cf.filters)) {
            setRows(cf.filters.map((f: any) => filterToRow(f, rowId.current++)));
            setLogic(String(cf.logic).toUpperCase() === 'OR' ? 'OR' : 'AND');
          }
        }
        setLoading(false);
      } catch (e: any) {
        if (cancelled) return;
        setLoadError(e?.response?.data?.error || e?.message || L('הטעינה נכשלה', 'Failed to load'));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organization, sourceId, reloadKey]);

  // ───────────── derived: template ─────────────
  const approvedTemplates = useMemo(() => {
    const ok = templates.filter((t) => ['APPROVED', 'PENDING'].includes(String(t.status || '').toUpperCase()));
    return ok.sort((a, b) => {
      const sa = String(a.status).toUpperCase() === 'APPROVED' ? 0 : 1;
      const sb = String(b.status).toUpperCase() === 'APPROVED' ? 0 : 1;
      return sa - sb || String(a.name).localeCompare(String(b.name));
    });
  }, [templates]);
  const selListItem = templates.find((t) => templateKey(t) === tplId) || null;
  const selTpl = tplDetail && templateKey(tplDetail) === tplId ? tplDetail : selListItem;
  const info = useMemo(() => (selTpl ? analyzeTemplate(selTpl, he) : null), [selTpl, he]);
  const tplPending = !!selTpl && String(selTpl.status || '').toUpperCase() !== 'APPROVED';
  const filteredTemplates = useMemo(() => {
    const q = tplSearch.trim().toLowerCase();
    const list = q ? approvedTemplates.filter((t) => `${t.name} ${t.category || ''}`.toLowerCase().includes(q)) : approvedTemplates;
    return list.slice(0, TPL_LIST_LIMIT);
  }, [approvedTemplates, tplSearch]);

  // Fetch the full template (and header media) when selected — the list payload may be partial.
  useEffect(() => {
    if (!organization || !tplId || isRegularDup) return;
    let cancelled = false;
    setTplDetail(null);
    setMediaUrl('');
    (async () => {
      const full = await campaignsApi.getTemplateById(organization, tplId).catch(() => null);
      if (cancelled) return;
      if (full && Array.isArray(full.components) && full.components.length) setTplDetail({ ...(selListItem || {}), ...full, id: full.id || full.Id || tplId } as WaTemplate);
      const media = await campaignsApi.getTemplateMediaUrl(organization, tplId);
      if (!cancelled) setMediaUrl(media.includes(' ') ? encodeURI(media) : media);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organization, tplId, isRegularDup]);

  const selectTemplate = (t: WaTemplate) => {
    const key = templateKey(t);
    if (key === tplId) return;
    setTplId(key);
    // A custom header image belongs to the previous template — back to the new template's own media
    // (only the campaign's original template keeps its saved override).
    setMediaError('');
    if (source && campaignTemplateId(source) === key) {
      const mq: any = (Array.isArray(source.templateVariableQuery) ? source.templateVariableQuery : []).find(
        (q: any) => isMediaQuery(q) && String(q.parameters_hardCoded_Text || '').trim(),
      );
      setMediaOverride(mq ? { url: String(mq.parameters_hardCoded_Text), name: String(mq.parameters_webhook_value || '').replace(/^URL:\s*/, ''), kind: mq.mediaSourceType === 'url' ? 'url' : 'file' } : null);
    } else {
      setMediaOverride(null);
    }
    // Variable mapping belongs to the template — start clean unless this is the duplicated template.
    if (!(source && campaignTemplateId(source) === key)) {
      setMaps({});
      setBtnMaps({});
    }
  };

  // ───────────── derived: audience ─────────────
  const rowsValid = rows.every(rowValid);
  const contactFilters = useMemo(() => buildContactFilters(rows, logic), [rows, logic]);
  const filtersKey = JSON.stringify(contactFilters);

  useEffect(() => {
    if (!organization || lockAudience || !rowsValid || step < 1) return;
    let cancelled = false;
    setCountLoading(true);
    const timer = setTimeout(async () => {
      try {
        const n = await campaignsApi.countContacts(organization, contactFilters);
        if (!cancelled) setCount(n);
      } catch {
        if (!cancelled) setCount(null);
      } finally {
        if (!cancelled) setCountLoading(false);
      }
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organization, filtersKey, rowsValid, lockAudience, step >= 1]);

  // "View contacts": the real list behind the number (same as the web recipients preview).
  const openPreview = async () => {
    if (!organization) return;
    setPreviewOpen(true);
    setPreviewLoading(true);
    setPreviewContacts([]);
    try {
      const r = await campaignsApi.previewContacts(organization, contactFilters);
      setPreviewContacts(r.contacts);
      setPreviewTotal(r.count);
      setCount(r.count);
    } catch {
      setPreviewContacts([]);
      setPreviewTotal(0);
    } finally {
      setPreviewLoading(false);
    }
  };

  const audienceCount = lockAudience
    ? Number(source?.ExcelData?.validCount ?? source?.ExcelData?.recipients?.length ?? 0)
    : count;

  // ───────────── derived: variables ─────────────
  const bodyVars = info?.bodyVars || [];
  const missingVars = lockVariables
    ? []
    : bodyVars.filter((n) => {
        const m = maps[n];
        return !m || (m.source === 'text' && !m.value.trim()) || (m.source === 'column' && !m.value);
      });
  const setMap = (n: number, patch: Partial<VarMapping>) =>
    setMaps((prev) => {
      const cur: VarMapping = prev[n] || { source: 'text', value: '' };
      return { ...prev, [n]: { ...cur, ...patch } };
    });

  // Dynamic URL buttons: the ones the sender must fill (tracked buttons are auto-attributed to the phone).
  const buttonVars = info?.buttonVars || [];
  const inputButtonVars = buttonVars.filter((b) => !b.hidden);
  const missingButtonVars = lockVariables
    ? []
    : inputButtonVars.filter((b) => {
        const m = btnMaps[b.Variable];
        return !m || (m.source === 'text' && !m.value.trim()) || (m.source === 'column' && !m.value);
      });
  const setBtnMap = (key: string, patch: Partial<VarMapping>) =>
    setBtnMaps((prev) => {
      const cur: VarMapping = prev[key] || { source: 'text', value: '' };
      return { ...prev, [key]: { ...cur, ...patch } };
    });

  const headerFormat = info?.headerFormat || '';
  const hasMediaHeader = headerFormat === 'IMAGE' || headerFormat === 'VIDEO';
  const queries = useMemo(() => {
    let list: any[];
    if (lockVariables) list = Array.isArray(source?.templateVariableQuery) ? [...source!.templateVariableQuery!] : [];
    else {
      const keepExisting = source && campaignTemplateId(source) === tplId ? source.templateVariableQuery : [];
      list = mergeQueries(keepExisting, bodyVars, maps, info?.bodyHints || {}, buttonVars, btnMaps);
    }
    // Header media: the chosen image/video replaces the template's own (same shape the web stores).
    // No override → drop any stale one so the template's original media is sent.
    if (hasMediaHeader) {
      const idx = list.findIndex(isMediaQuery);
      const isVideo = headerFormat === 'VIDEO';
      if (mediaOverride) {
        const q = {
          ...(idx >= 0 ? list[idx] : {}),
          Variable: idx >= 0 && list[idx].Variable ? list[idx].Variable : isVideo ? 'dynamic_video' : 'dynamic_image',
          dataSource1: 'data_source1_HardCoded',
          parameters_hardCoded_Text: mediaOverride.url,
          parameters_webhook_value: mediaOverride.kind === 'url' ? `URL: ${mediaOverride.url}` : mediaOverride.name,
          mediaSourceType: mediaOverride.kind === 'url' ? 'url' : 'media',
          isMediaUpload: true,
          mediaFormat: isVideo ? 'VIDEO' : 'IMAGE',
        };
        if (idx >= 0) list[idx] = q;
        else {
          list.unshift(q);
          list = list.map((x, i) => ({ ...x, index: i + 1 }));
        }
      } else if (idx >= 0) {
        list.splice(idx, 1);
        list = list.map((x, i) => ({ ...x, index: i + 1 }));
      }
    }
    return list;
  }, [lockVariables, source, tplId, bodyVars, maps, info, buttonVars, btnMaps, hasMediaHeader, headerFormat, mediaOverride]);

  // Server-side sanity check of the column mappings (empty columns etc.) — advisory only.
  useEffect(() => {
    if (!organization || lockVariables || step !== 2) return;
    const cols = bodyVars
      .filter((n) => maps[n]?.source === 'column' && maps[n].value)
      .map((n) => ({ varKey: `var${n}`, label: `{{${n}}}`, column: maps[n].value }));
    if (!cols.length) {
      setWarnings([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      const issues = await campaignsApi.validateContactMapping(organization, contactFilters, cols);
      if (!cancelled) setWarnings(issues);
    }, 700);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organization, lockVariables, step, JSON.stringify(maps), filtersKey]);

  const previewBody = useMemo(() => {
    if (!info) return '';
    let text = info.bodyText;
    bodyVars.forEach((n) => {
      const m = maps[n];
      const val = !m ? '' : m.source === 'phone' ? '‹phone›' : m.source === 'column' ? (m.value ? `‹${m.value.replace(/^firstword:/i, '')}›` : '') : m.value;
      if (val) text = text.replace(new RegExp(`\\{\\{${n}\\}\\}`, 'g'), val);
    });
    return text;
  }, [info, bodyVars, maps]);

  // Link each URL button opens, with the sender's value merged in (shown under the button in the preview).
  const buttonUrls = useMemo(() => {
    if (!info) return [] as string[];
    return info.buttons.map((b, i) => {
      if (b.type !== 'URL' || !b.url) return '';
      let url = String(b.originalUrl || b.url);
      buttonVars
        .filter((bv) => bv.buttonIndex === i + 1)
        .forEach((bv) => {
          if (bv.hidden) return;
          const m = btnMaps[bv.Variable];
          const val = !m ? '' : m.source === 'column' ? (m.value ? `‹${m.value.replace(/^firstword:/i, '')}›` : '') : cleanButtonValue(bv, m.value);
          if (val) url = url.replace(new RegExp(`\\{+${bv.variableIndex}\\}+`), val);
        });
      return url;
    });
  }, [info, buttonVars, btnMaps]);

  // ───────────── derived: delivery ─────────────
  const scheduled = mode === 'once' || mode === 'weekly';
  const senderNum = waNumbers.find((n) => n.PhoneNumberId === fromNumberId) || waNumbers.find((n) => n.IsPrimary) || waNumbers[0];
  const senderLimit =
    limits.find((l) => l.PhoneNumberId && senderNum && l.PhoneNumberId === senderNum.PhoneNumberId) ||
    limits.find((l) => l.IsPrimary) ||
    limits[0];
  const dailyLimit =
    senderLimit && (senderLimit.DailyLimit != null || senderLimit.Tier)
      ? parseInt(formatWabaDailyLimit(senderLimit).replace(/,/g, ''), 10)
      : NaN;
  const overLimit = Number.isFinite(dailyLimit) && audienceCount != null && audienceCount > dailyLimit;

  const whenValid = !!when && when.getTime() >= Date.now() + MIN_SCHEDULE_LEAD_MS;
  const scheduleError =
    mode === 'now' && tplPending
      ? L('התבנית עדיין ממתינה לאישור Meta – אי אפשר לשלוח עכשיו', 'The template is still pending Meta approval — it cannot be sent now')
      : scheduled && !whenValid
        ? L('בחר מועד עתידי', 'Pick a future date & time')
        : mode === 'weekly' && weekdays.length === 0
          ? L('בחר לפחות יום אחד בשבוע', 'Pick at least one weekday')
          : mode === 'weekly' && endType === 'count' && !(parseInt(endCount, 10) >= 1)
            ? L('מספר הריצות חייב להיות 1 ומעלה', 'Number of runs must be 1 or more')
            : '';

  // ───────────── step gating ─────────────
  const STEPS = [L('בסיס', 'Basics'), L('קהל', 'Audience'), L('משתנים', 'Variables'), L('שליחה', 'Delivery'), L('סיכום', 'Review')];
  const stepError = (s: number): string => {
    if (s === 0) {
      if (!name.trim()) return L('הזן שם לקמפיין', 'Enter a campaign name');
      if (!lockTemplate && !selTpl) return L('בחר תבנית', 'Pick a template');
      if (!lockTemplate && info && info.unsupported.length) return L('התבנית דורשת את האתר', 'This template needs the web app');
      return '';
    }
    if (s === 1) return lockAudience || rowsValid ? '' : L('השלם את כל תנאי הסינון', 'Complete every filter condition');
    if (s === 2) {
      if (missingVars.length) return L('מלא את כל המשתנים', 'Fill in every variable');
      if (missingButtonVars.length) return L('הזן את הקישור של הכפתור', 'Enter the button link');
      return '';
    }
    if (s === 3) return scheduleError;
    return '';
  };
  const currentError = stepError(step);
  const firstBadStep = [0, 1, 2, 3].find((s) => !!stepError(s));

  // ───────────── actions ─────────────
  // Editing: "dirty" = something actually changed since the campaign was loaded.
  const formSig = JSON.stringify([name, tplId, rows, logic, maps, btnMaps, mediaOverride, mode, when?.getTime() ?? null, weekdays, endType, endCount, fromNumberId]);
  const baselineSig = useRef<string | null>(null);
  useEffect(() => {
    if (!loading && baselineSig.current === null) baselineSig.current = formSig;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);
  const dirty = isEdit ? baselineSig.current !== null && formSig !== baselineSig.current : !!(name.trim() || tplId || rows.length);
  const leave = () => {
    if (router.canGoBack()) router.back();
    else router.replace(BASE as any);
  };
  const onBack = () => {
    if (!dirty || saving) return leave();
    Alert.alert(isEdit ? L('לצאת בלי לשמור את השינויים?', 'Discard your changes?') : L('לצאת ללא שמירה?', 'Discard this campaign?'), L('השינויים לא יישמרו.', 'Your changes will not be saved.'), [
      { text: L('המשך עריכה', 'Keep editing'), style: 'cancel' },
      { text: L('צא', 'Discard'), style: 'destructive', onPress: leave },
    ]);
  };

  const addRow = (kind: 'tag' | 'owner' | 'field') => {
    const id = rowId.current++;
    const row: FilterRow =
      kind === 'tag'
        ? { id, kind, op: 'equals', tags: [] }
        : kind === 'owner'
          ? { id, kind, op: 'equals', ownerId: '' }
          : { id, kind, field: '', op: 'equals', value: '' };
    setRows((r) => [...r, row]);
  };
  const patchRow = (id: number, patch: any) => setRows((r) => r.map((x) => (x.id === id ? ({ ...x, ...patch } as FilterRow) : x)));
  const removeRow = (id: number) => setRows((r) => r.filter((x) => x.id !== id));

  // ── header media: pick → upload to the media library → use the permanent link ──
  const uploadHeaderMedia = async (uri: string, fileName: string, mimeType: string) => {
    if (!organization) return;
    setMediaBusy(true);
    setMediaError('');
    try {
      const res = await mediaApi.uploadFile(organization, uri, fileName, mimeType, {
        uploadedBy: user?.uID || user?.userId || '',
        uploadedByName: user?.fullname || '',
      });
      const file = Array.isArray(res?.files) ? res.files[0] : null;
      if (!file?.url) throw new Error(L('ההעלאה נכשלה', 'Upload failed'));
      // The listed URL is short-lived — keep the permanent share link so the campaign still sends it later.
      const url = (await mediaApi.getShareLink(organization, file.url)) || file.url;
      setMediaOverride({ url, name: String(file.name || fileName), kind: 'file' });
    } catch (e: any) {
      setMediaError(e?.response?.data?.Message || e?.message || L('ההעלאה נכשלה', 'Upload failed'));
    } finally {
      setMediaBusy(false);
    }
  };

  const pickHeaderMedia = async (from: 'gallery' | 'camera') => {
    const isVideo = headerFormat === 'VIDEO';
    try {
      if (from === 'camera') {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (perm.status !== 'granted') {
          setMediaError(L('יש לאפשר גישה למצלמה', 'Camera permission is required'));
          return;
        }
      }
      const opts: any = { mediaTypes: [isVideo ? 'videos' : 'images'], quality: 0.85 };
      const result =
        from === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
      if (result.canceled || !result.assets?.length) return;
      const a: any = result.assets[0];
      const size = Number(a.fileSize || 0);
      const max = isVideo ? 16 * 1024 * 1024 : 5 * 1024 * 1024;
      if (size > max) {
        setMediaError(isVideo ? L('הסרטון חייב להיות קטן מ-16MB', 'The video must be under 16MB') : L('התמונה חייבת להיות קטנה מ-5MB', 'The image must be under 5MB'));
        return;
      }
      await uploadHeaderMedia(a.uri, a.fileName || `${isVideo ? 'video' : 'photo'}_${Date.now()}.${isVideo ? 'mp4' : 'jpg'}`, a.mimeType || (isVideo ? 'video/mp4' : 'image/jpeg'));
    } catch (e: any) {
      setMediaError(e?.message || L('לא ניתן לבחור קובץ', 'Could not pick a file'));
    }
  };

  const applyMediaLink = () => {
    const u = mediaLink.trim();
    if (!/^https?:\/\/\S+$/i.test(u)) {
      setMediaError(L('הזן כתובת תקינה שמתחילה ב-https://', 'Enter a valid link starting with https://'));
      return;
    }
    setMediaError('');
    setMediaOverride({ url: u, name: u, kind: 'url' });
    setMediaLinkOpen(false);
    setMediaLink('');
  };

  const buildPayload = (): Record<string, any> => {
    const data: Record<string, any> = {};
    if (source) {
      ['sendOncePerContact', 'holidayHandling', 'sendResultsSummary', 'sendResultsAfterDays', 'resultsEmailTo', 'aiAnalysisEnabled', 'recipientSourceTable'].forEach((k) => {
        if (source[k] !== undefined && source[k] !== null) data[k] = source[k];
      });
    }
    Object.assign(data, {
      campaignName: name.trim(),
      campaignTrigger: scheduled ? 'Scheduled' : 'Manually',
      campaignStatus: '',
      recipientSource: isExcelDup ? 'Excel' : 'Contacts',
      ContactsQuery: null,
      campaignResults: null,
      createdBy: user?.email || user?.Email || '',
      messageType: isRegularDup ? 'Regular' : 'Template',
      message: isRegularDup ? source?.message || '' : '',
      templateVariableQuery: queries,
      sendResultsSummary: data.sendResultsSummary !== false,
      aiAnalysisEnabled: data.aiAnalysisEnabled !== false,
      runAt: '',
      scheduleType: '',
      interval: '',
      intervalNumber: '',
      EndCondition: null,
      Recurrence: null,
      AutoSplit: false,
      ScheduledRuns: null,
    });
    if (!lockTemplate && selTpl) {
      const key = templateKey(selTpl);
      Object.assign(data, { wabaTemplateId: key, fbTemplateID: key, wabaTemplateName: selTpl.name });
    } else if (source) {
      Object.assign(data, {
        wabaTemplateId: source.wabaTemplateId || null,
        fbTemplateID: source.fbTemplateID || '',
        wabaTemplateName: source.wabaTemplateName || '',
      });
    }
    if (isExcelDup) data.ExcelData = source?.ExcelData || null;
    else data.ContactFilters = contactFilters;
    if (fromNumberId) data.fromNumberId = fromNumberId;

    if (isEdit) {
      data.campaingId = editId;
      data.modifiedOn = new Date().toISOString();
      data.createdBy = source?.createdBy || data.createdBy;
    }

    if (mode === 'keep' && source) {
      // Untouched schedule: hand back exactly what is stored so the server sees no timing change.
      SCHEDULE_KEYS.forEach((k) => {
        if ((source as any)[k] !== undefined) data[k] = (source as any)[k];
      });
      if (!data.campaignTrigger) data.campaignTrigger = 'Scheduled';
    } else if (scheduled && when) {
      const tz = deviceTimeZone();
      data.runAt = formatRunAt(when);
      data.timezone = tz;
      data.scheduleType = mode === 'once' ? 'once' : 'repeated';
      data.interval = 'Minute';
      data.intervalNumber = 1;
      if (mode === 'once') {
        data.EndCondition = { type: 'none' };
      } else {
        const cnt = Math.max(1, parseInt(endCount, 10) || 1);
        const end = endType === 'count' ? { type: 'count', value: String(cnt) } : { type: 'none' };
        data.EndCondition = end;
        data.Recurrence = {
          frequency: 'weekly',
          weekdays: [...weekdays].sort((a, b) => a - b),
          time: `${pad2(when.getHours())}:${pad2(when.getMinutes())}`,
          timezone: tz,
          endCondition: end,
          horizonMonths: 12,
        };
      }
    }
    return data;
  };

  const doSave = async () => {
    if (!organization || savingRef.current) return;
    if (firstBadStep != null) {
      setStep(firstBadStep);
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setSaveError('');
    try {
      const who = { userId: user?.userId || user?.uID || '', userName: user?.fullname || user?.userName || '' };
      const res = isEdit
        ? await campaignsApi.updateCampaign(organization, buildPayload(), who)
        : await campaignsApi.createCampaign(organization, buildPayload(), who);
      invalidateRunSummary();
      const newId = isEdit ? editId : String(res?.Data ?? res?.data ?? '');
      if (mode === 'now' && newId) {
        router.replace(`${BASE}/wa-run?id=${encodeURIComponent(newId)}` as any);
      } else {
        router.replace(BASE as any);
      }
    } catch (e: any) {
      setSaveError(e?.response?.data?.Message || e?.message || L('השמירה נכשלה', 'Saving failed'));
      savingRef.current = false;
      setSaving(false);
    }
  };

  const onNext = () => {
    if (currentError) return;
    if (step < STEPS.length - 1) setStep(step + 1);
    else doSave();
  };

  // ───────────── render ─────────────
  const title = isEdit ? L('עריכת קמפיין', 'Edit campaign') : isDuplicate ? L('שכפול קמפיין', 'Duplicate campaign') : L('קמפיין חדש', 'New campaign');

  if (!organization) {
    return (
      <View style={[styles.flex, { backgroundColor: theme.colors.background }]}>
        <WaHeader title={title} />
      </View>
    );
  }

  if (loading) {
    return (
      <View style={[styles.flex, { backgroundColor: theme.colors.background }]}>
        <WaHeader title={title} />
        <View style={styles.center}>
          {loadError ? (
            <View style={{ alignItems: 'center', gap: 12, padding: 24 }}>
              <MaterialCommunityIcons name="alert-circle-outline" size={44} color={theme.colors.error} />
              <Text style={{ color: theme.colors.onSurface, textAlign: 'center' }}>{loadError}</Text>
              <Button mode="contained" buttonColor={BRAND} onPress={() => setReloadKey((k) => k + 1)}>
                {L('נסה שוב', 'Retry')}
              </Button>
            </View>
          ) : (
            <ActivityIndicator color={BRAND} />
          )}
        </View>
      </View>
    );
  }

  const fieldOptions = fields.map((f) => ({ key: f.name, label: f.label }));
  const userOptions = users.map((u) => ({ key: u.id, label: u.name }));
  const columnOptions = columns.map((c) => ({ key: c.key, label: c.label }));
  const tagQuery = tagSearch.trim().toLowerCase();
  const visibleTags = (tagQuery ? tags.filter((t) => t.toLowerCase().includes(tagQuery)) : tags).slice(0, TAG_LIST_LIMIT);
  const opLabel = (op: string) =>
    ({
      equals: L('שווה', 'Equals'),
      notEquals: L('שונה', 'Not equals'),
      contains: L('מכיל', 'Contains'),
      isEmpty: L('ריק', 'Is empty'),
      isNotEmpty: L('לא ריק', 'Is not empty'),
    })[op] || op;

  const describeRow = (r: FilterRow): string => {
    if (r.kind === 'tag') return `${L('תגית', 'Tag')} ${r.op === 'notEquals' ? L('לא ב', 'not in') : L('ב', 'in')}: ${r.tags.join(', ')}`;
    if (r.kind === 'owner') return `${L('אחראי', 'Owner')} ${opLabel(r.op)}: ${users.find((u) => u.id === r.ownerId)?.name || r.ownerId}`;
    if (r.kind === 'field') return `${fields.find((f) => f.name === r.field)?.label || r.field} ${opLabel(r.op)}${needsValue(r.op) ? ` "${r.value}"` : ''}`;
    return L('סינון מתקדם (נערך באתר)', 'Advanced filter (edit on web)');
  };

  const sourceLabel = (s: VarSource) => ({ text: L('טקסט קבוע', 'Fixed text'), column: L('שדה איש קשר', 'Contact field'), phone: L('טלפון', 'Phone') })[s];

  const keptWhen = sourceScheduled ? parseRunAtLocal(source?.runAt) : null;
  const modeOptions: Array<{ key: Mode; label: string; icon: string; hint: string }> = [
    ...(isEdit && sourceScheduled
      ? [
          {
            key: 'keep' as Mode,
            label: L('השאר את התזמון הקיים', 'Keep the current schedule'),
            icon: 'calendar-check',
            hint: keptWhen ? `${formatWhen(keptWhen, he)}${source?.timezone ? ` · ${source.timezone}` : ''}` : L('התזמון לא ישתנה', 'The schedule is not changed'),
          },
        ]
      : []),
    {
      key: 'draft',
      label: isEdit ? L('שמירה ללא תזמון', 'Save without a schedule') : L('שמירה כטיוטה', 'Save as draft'),
      icon: 'content-save-outline',
      hint: isEdit && sourceScheduled ? L('מבטל את התזמון הקיים – הרצה ידנית בהמשך', 'Removes the current schedule — run it manually later') : L('הרצה ידנית בהמשך', 'Run it manually later'),
    },
    { key: 'now', label: L('שמור ושלח עכשיו', 'Save & send now'), icon: 'send', hint: L('עובר למסך התצוגה המקדימה לפני השליחה', 'Opens the preview screen before sending') },
    { key: 'once', label: L('תזמון חד-פעמי', 'Schedule once'), icon: 'calendar-clock', hint: L('שליחה אוטומטית במועד שתבחר', 'Sent automatically at the time you pick') },
    { key: 'weekly', label: L('תזמון שבועי', 'Repeat weekly'), icon: 'calendar-sync', hint: L('חוזר בימים שתבחר', 'Repeats on the weekdays you pick') },
  ];

  const shownMedia = mediaOverride?.url || mediaUrl;
  const isVideoHeader = headerFormat === 'VIDEO';
  // Replace the header image/video of this campaign (the template itself is not touched).
  const mediaSection = hasMediaHeader ? (
    <Section title={isVideoHeader ? L('סרטון כותרת', 'Header video') : L('תמונת כותרת', 'Header image')} icon={isVideoHeader ? 'video-outline' : 'image-outline'}>
      <View style={[styles.mediaRow, { flexDirection }]}>
        {!isVideoHeader && shownMedia ? (
          <Image source={{ uri: shownMedia }} style={[styles.mediaThumb, { backgroundColor: theme.colors.surfaceVariant }]} resizeMode="cover" />
        ) : (
          <View style={[styles.mediaThumb, styles.center, { backgroundColor: theme.colors.surfaceVariant }]}>
            <MaterialCommunityIcons name={isVideoHeader ? 'video-outline' : 'image-outline'} size={28} color={sub} />
          </View>
        )}
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ color: theme.colors.onSurface, fontWeight: '700', fontSize: 13, textAlign }} numberOfLines={2}>
            {mediaOverride ? L('קובץ מותאם לקמפיין', 'Custom file for this campaign') : L('המדיה של התבנית', "The template's own media")}
          </Text>
          <Text style={{ color: sub, fontSize: 11.5, textAlign }} numberOfLines={2}>
            {mediaOverride ? mediaOverride.name || mediaOverride.url : L('אפשר להחליף רק לקמפיין הזה', 'You can replace it for this campaign only')}
          </Text>
        </View>
        {mediaBusy ? <ActivityIndicator size="small" color={BRAND} /> : null}
      </View>
      <View style={[styles.addRow, { flexDirection }]}>
        <Button compact mode="outlined" icon="image-multiple-outline" disabled={mediaBusy} onPress={() => pickHeaderMedia('gallery')}>
          {mediaOverride ? L('החלף', 'Replace') : L('בחר מהגלריה', 'Gallery')}
        </Button>
        {!isVideoHeader ? (
          <Button compact mode="outlined" icon="camera-outline" disabled={mediaBusy} onPress={() => pickHeaderMedia('camera')}>
            {L('מצלמה', 'Camera')}
          </Button>
        ) : null}
        <Button compact mode="outlined" icon="link-variant" disabled={mediaBusy} onPress={() => setMediaLinkOpen((v) => !v)}>
          {L('קישור', 'Link')}
        </Button>
        {mediaOverride ? (
          <Button compact mode="text" icon="undo" disabled={mediaBusy} onPress={() => { setMediaOverride(null); setMediaError(''); }}>
            {L('חזרה לתבנית', 'Use template media')}
          </Button>
        ) : null}
      </View>
      {mediaLinkOpen ? (
        <View style={{ gap: 6 }}>
          <TextInput
            mode="outlined"
            dense
            value={mediaLink}
            onChangeText={setMediaLink}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder="https://…"
          />
          <Button compact mode="contained" buttonColor={BRAND} onPress={applyMediaLink} style={{ alignSelf: 'flex-start' }}>
            {L('השתמש בקישור', 'Use this link')}
          </Button>
        </View>
      ) : null}
      {mediaError ? <Notice kind="error" text={mediaError} /> : null}
    </Section>
  ) : null;

  // Preview of the chosen template, shown right under it in the list.
  const previewBlock =
    info && selTpl && !lockTemplate ? (
      <View style={{ gap: 8 }}>
        {info.unsupported.length ? (
          <Notice
            kind="error"
            text={L(
              `התבנית כוללת ${info.unsupported.join(', ')} – את סוג התבנית הזה אפשר להגדיר רק באתר.`,
              `This template includes ${info.unsupported.join(', ')} — that kind of template can only be set up on the web.`,
            )}
          />
        ) : null}
        {tplPending ? (
          <Notice
            kind="warn"
            text={L(
              'התבנית עדיין ממתינה לאישור Meta. אפשר לשמור כטיוטה או לתזמן, אך לא לשלוח עכשיו.',
              'This template is still pending Meta approval. You can save a draft or schedule it, but not send now.',
            )}
          />
        ) : null}
        {inputButtonVars.length > 0 || bodyVars.length > 0 ? (
          <Notice
            kind="info"
            text={L('התבנית כוללת משתנים – תמלא אותם בשלב "משתנים".', 'This template has variables — you fill them in the "Variables" step.')}
          />
        ) : null}
        <TemplateBubble info={info} mediaUrl={shownMedia} he={he} buttonUrls={buttonUrls} />
        {mediaSection}
      </View>
    ) : null;

  const saveLabel =
    isEdit && (mode === 'draft' || mode === 'keep')
      ? L('שמור שינויים', 'Save changes')
      : mode === 'draft'
      ? L('שמור טיוטה', 'Save draft')
      : mode === 'now'
        ? L('שמור והמשך לשליחה', 'Save & continue to send')
        : L('שמור ותזמן', 'Save & schedule');

  return (
    <KeyboardAvoidingView style={[styles.flex, { backgroundColor: theme.colors.background }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <WaHeader title={title} subtitle={`${step + 1}/${STEPS.length} · ${STEPS[step]}`} onBack={onBack} />

      {/* Stepper */}
      <View style={[styles.stepper, { flexDirection, backgroundColor: theme.colors.surface, borderBottomColor: theme.colors.outlineVariant }]}>
        {STEPS.map((label, i) => {
          const done = i < step;
          const active = i === step;
          const reachable = i <= step || [...Array(i).keys()].every((s) => !stepError(s));
          return (
            <Pressable key={label} disabled={!reachable} onPress={() => setStep(i)} style={styles.stepItem}>
              <View
                style={[
                  styles.stepDot,
                  { backgroundColor: active || done ? BRAND : 'transparent', borderColor: active || done ? BRAND : theme.colors.outline },
                ]}
              >
                {done ? (
                  <MaterialCommunityIcons name="check" size={13} color="#fff" />
                ) : (
                  <Text style={{ color: active ? '#fff' : sub, fontSize: 11, fontWeight: '700' }}>{i + 1}</Text>
                )}
              </View>
              <Text style={{ fontSize: 10.5, color: active ? BRAND : sub, fontWeight: active ? '700' : '400' }} numberOfLines={1}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {saveError ? <Notice kind="error" text={saveError} /> : null}

        {/* ───── Step 0: basics ───── */}
        {step === 0 ? (
          <>
            <Section title={L('שם הקמפיין', 'Campaign name')} icon="tag-outline">
              <TextInput mode="outlined" value={name} onChangeText={setName} placeholder={L('לדוגמה: מבצע סוף חודש', 'e.g. End-of-month sale')} />
            </Section>

            {isExcelDup ? (
              <Notice
                kind="info"
                text={L(
                  'קמפיין מאקסל: הנמענים, התבנית והמשתנים נשמרים כפי שהם ואינם ניתנים לעריכה כאן. אפשר לשנות שם, מספר שולח ותזמון.',
                  'Excel campaign: recipients, template and variables are kept as-is and cannot be edited here. You can change the name, sender and schedule.',
                )}
              />
            ) : null}
            {isRegularDup ? (
              <Notice
                kind="info"
                text={L(
                  'הודעה רגילה (ללא תבנית): ההודעה נשמרת כפי שהיא. יצירת קמפיינים כאלה מתבצעת באתר.',
                  'Regular (non-template) message: kept as-is. Creating such campaigns is done on the web.',
                )}
              />
            ) : null}

            {lockTemplate ? (
              <Section title={L('הודעה', 'Message')} icon="message-text-outline">
                <Text style={{ color: theme.colors.onSurface, fontSize: 13, lineHeight: 19, textAlign }}>
                  {source?.wabaTemplateName ? `${L('תבנית', 'Template')}: ${source.wabaTemplateName}` : source?.message || ''}
                </Text>
              </Section>
            ) : (
              <Section title={L('תבנית וואטסאפ', 'WhatsApp template')} icon="message-text-outline">
                {approvedTemplates.length === 0 ? (
                  <Notice
                    kind="warn"
                    text={L(
                      'אין תבניות מאושרות. צור תבנית ואשר אותה באתר לפני יצירת קמפיין.',
                      'There are no approved templates. Create and get one approved on the web before making a campaign.',
                    )}
                  />
                ) : (
                  <>
                    <TextInput
                      mode="outlined"
                      dense
                      value={tplSearch}
                      onChangeText={setTplSearch}
                      placeholder={L('חיפוש תבנית', 'Search templates')}
                      left={<TextInput.Icon icon="magnify" />}
                    />
                    {isDuplicate && source && !tplId ? (
                      <Notice kind="warn" text={L('התבנית של הקמפיין המקורי לא נמצאה – בחר תבנית.', "The original campaign's template wasn't found — pick a template.")} />
                    ) : null}
                    {filteredTemplates.map((t) => {
                      const key = templateKey(t);
                      const on = key === tplId;
                      const pending = String(t.status || '').toUpperCase() !== 'APPROVED';
                      const bodyPreview = analyzeTemplate(t, he).bodyText;
                      return (
                        <React.Fragment key={key}>
                        <Pressable
                          onPress={() => selectTemplate(t)}
                          style={[
                            styles.tplRow,
                            {
                              borderColor: on ? BRAND : theme.colors.outlineVariant,
                              backgroundColor: on ? withAlpha(BRAND, 0.08) : 'transparent',
                            },
                          ]}
                        >
                          <View style={[styles.rowBetween, { flexDirection, gap: 8 }]}>
                            <Text style={{ flex: 1, color: theme.colors.onSurface, fontWeight: '700', textAlign }} numberOfLines={1}>
                              {t.name}
                            </Text>
                            {pending ? (
                              <Text style={{ color: '#d97706', fontSize: 11 }}>{L('ממתינה לאישור', 'Pending')}</Text>
                            ) : null}
                            {on ? <MaterialCommunityIcons name="check-circle" size={18} color={BRAND} /> : null}
                          </View>
                          <Text style={{ color: sub, fontSize: 12, textAlign }} numberOfLines={2}>
                            {bodyPreview}
                          </Text>
                          <Text style={{ color: sub, fontSize: 11, textAlign }}>
                            {[t.category, t.language].filter(Boolean).join(' · ')}
                          </Text>
                        </Pressable>
                        {/* Preview right under the chosen template (not at the bottom of a long list). */}
                        {on ? previewBlock : null}
                        </React.Fragment>
                      );
                    })}
                    {tplId && !filteredTemplates.some((t) => templateKey(t) === tplId) ? previewBlock : null}
                    {approvedTemplates.length > filteredTemplates.length ? (
                      <Text style={{ color: sub, fontSize: 11.5, textAlign: 'center' }}>
                        {L(`מוצגות ${filteredTemplates.length} – השתמש בחיפוש`, `Showing ${filteredTemplates.length} — use search`)}
                      </Text>
                    ) : null}
                  </>
                )}
              </Section>
            )}
            {lockTemplate ? mediaSection : null}
          </>
        ) : null}

        {/* ───── Step 1: audience ───── */}
        {step === 1 ? (
          <>
            {lockAudience ? (
              <Section title={L('נמענים מאקסל', 'Excel recipients')} icon="file-excel-outline">
                <Text style={{ color: theme.colors.onSurface, textAlign }}>
                  {L(`${(audienceCount || 0).toLocaleString()} נמענים מהקובץ המקורי`, `${(audienceCount || 0).toLocaleString()} recipients from the original file`)}
                </Text>
              </Section>
            ) : (
              <>
                <Section title={L('למי לשלוח', 'Who to send to')} icon="account-filter-outline">
                  <Text style={{ color: sub, fontSize: 12.5, textAlign }}>
                    {rows.length === 0
                      ? L('בלי סינון – הקמפיין יישלח לכל אנשי הקשר.', 'No filters — the campaign goes to all contacts.')
                      : L('אנשי קשר שעומדים בתנאים:', 'Contacts matching:')}
                  </Text>
                  {rows.length > 1 ? (
                    <ChipGroup
                      options={[
                        { key: 'AND', label: L('כל התנאים (וגם)', 'All conditions (AND)') },
                        { key: 'OR', label: L('אחד מהתנאים (או)', 'Any condition (OR)') },
                      ]}
                      selected={[logic]}
                      onToggle={(k) => setLogic(k as 'AND' | 'OR')}
                    />
                  ) : null}

                  {rows.map((r) => (
                    <View key={r.id} style={[styles.filterCard, { borderColor: theme.colors.outlineVariant }]}>
                      <View style={[styles.rowBetween, { flexDirection }]}>
                        <Text style={{ color: BRAND, fontWeight: '700', fontSize: 12.5 }}>
                          {r.kind === 'tag' ? L('תגית', 'Tag') : r.kind === 'owner' ? L('אחראי', 'Owner') : r.kind === 'field' ? L('שדה איש קשר', 'Contact field') : L('מתקדם', 'Advanced')}
                        </Text>
                        <IconButton icon="close" size={18} onPress={() => removeRow(r.id)} />
                      </View>

                      {r.kind === 'tag' ? (
                        <>
                          <ChipGroup
                            options={[
                              { key: 'equals', label: L('נמצא בתגית', 'Is in tag') },
                              { key: 'notEquals', label: L('לא נמצא בתגית', 'Not in tag') },
                            ]}
                            selected={[r.op]}
                            onToggle={(k) => patchRow(r.id, { op: k })}
                          />
                          {tags.length > TAG_LIST_LIMIT ? (
                            <TextInput mode="outlined" dense value={tagSearch} onChangeText={setTagSearch} placeholder={L('חיפוש תגית', 'Search tags')} />
                          ) : null}
                          {tags.length === 0 ? (
                            <Text style={{ color: sub, fontSize: 12 }}>{L('אין תגיות בארגון.', 'No tags in this organization.')}</Text>
                          ) : (
                            <ChipGroup
                              options={[...new Set([...r.tags, ...visibleTags])].map((t) => ({ key: t, label: t }))}
                              selected={r.tags}
                              onToggle={(k) => patchRow(r.id, { tags: r.tags.includes(k) ? r.tags.filter((x) => x !== k) : [...r.tags, k] })}
                            />
                          )}
                        </>
                      ) : null}

                      {r.kind === 'owner' ? (
                        <>
                          <ChipGroup
                            options={[
                              { key: 'equals', label: L('האחראי הוא', 'Owner is') },
                              { key: 'notEquals', label: L('האחראי אינו', 'Owner is not') },
                            ]}
                            selected={[r.op]}
                            onToggle={(k) => patchRow(r.id, { op: k })}
                          />
                          <Picker options={userOptions} value={r.ownerId} onChange={(k) => patchRow(r.id, { ownerId: k })} placeholder={L('בחר משתמש', 'Pick a user')} />
                        </>
                      ) : null}

                      {r.kind === 'field' ? (
                        <>
                          <Picker options={fieldOptions} value={r.field} onChange={(k) => patchRow(r.id, { field: k })} placeholder={L('בחר שדה', 'Pick a field')} />
                          <ChipGroup
                            options={(['equals', 'contains', 'isEmpty', 'isNotEmpty'] as FieldOp[]).map((o) => ({ key: o, label: opLabel(o) }))}
                            selected={[r.op]}
                            onToggle={(k) => patchRow(r.id, { op: k })}
                          />
                          {needsValue(r.op) ? (
                            <TextInput mode="outlined" dense value={r.value} onChangeText={(v) => patchRow(r.id, { value: v })} placeholder={L('ערך', 'Value')} />
                          ) : null}
                        </>
                      ) : null}

                      {r.kind === 'raw' ? <Text style={{ color: sub, fontSize: 12.5, textAlign }}>{describeRow(r)}</Text> : null}
                    </View>
                  ))}

                  <View style={[styles.addRow, { flexDirection }]}>
                    <Button compact mode="outlined" icon="tag-plus-outline" onPress={() => addRow('tag')}>
                      {L('תגית', 'Tag')}
                    </Button>
                    <Button compact mode="outlined" icon="account-plus-outline" onPress={() => addRow('owner')}>
                      {L('אחראי', 'Owner')}
                    </Button>
                    <Button compact mode="outlined" icon="plus" onPress={() => addRow('field')}>
                      {L('שדה', 'Field')}
                    </Button>
                  </View>
                  <Text style={{ color: sub, fontSize: 11.5, textAlign }}>
                    {L(
                      'סינון לפי שלב ליד, רשומות קשורות ו-CTWA זמין באתר.',
                      'Filtering by lead stage, related records and CTWA is available on the web.',
                    )}
                  </Text>
                </Section>

                <Section tint={BRAND}>
                  <View style={[styles.rowBetween, { flexDirection }]}>
                    <Text style={{ color: theme.colors.onSurface, fontWeight: '700', textAlign }}>{L('אנשי קשר שיקבלו', 'Matching contacts')}</Text>
                    {!rowsValid ? (
                      <Text style={{ color: theme.colors.error, fontSize: 12 }}>{L('השלם תנאים', 'Complete the conditions')}</Text>
                    ) : countLoading ? (
                      <ActivityIndicator size="small" color={BRAND} />
                    ) : (
                      <Text style={{ color: BRAND, fontSize: 22, fontWeight: '800' }}>{count == null ? '—' : count.toLocaleString()}</Text>
                    )}
                  </View>
                  {rowsValid && !countLoading && count !== 0 ? (
                    <Button mode="outlined" icon="account-search-outline" textColor={BRAND} onPress={openPreview} style={{ alignSelf: 'flex-start' }}>
                      {L('צפה באנשי קשר', 'View contacts')}
                    </Button>
                  ) : null}
                  <Text style={{ color: sub, fontSize: 11.5, textAlign }}>
                    {L(
                      'ספירה מקורבת – הרשימה הסופית נקבעת בעת ההרצה (ללא ספאם / מחוקים; מי שהסיר הסכמה מוחרג).',
                      'Approximate — the final list is resolved at run time (spam/deleted excluded; opted-out contacts are skipped).',
                    )}
                  </Text>
                </Section>
              </>
            )}
          </>
        ) : null}

        {/* ───── Step 2: variables ───── */}
        {step === 2 ? (
          <>
            {lockVariables ? (
              <Notice
                kind="info"
                text={L('משתני ההודעה נשמרים כפי שהם בקמפיין המקורי.', "The message variables are kept as in the original campaign.")}
              />
            ) : bodyVars.length === 0 && inputButtonVars.length === 0 ? (
              <Notice kind="ok" text={L('לתבנית אין משתנים – אפשר להמשיך.', 'This template has no variables — you can continue.')} />
            ) : (
              <>
                {bodyVars.map((n) => {
                  const m = maps[n] || { source: 'text' as VarSource, value: '' };
                  const missing = missingVars.includes(n);
                  return (
                    <Section key={n} title={`{{${n}}}${info?.bodyHints[n] ? ` · ${info.bodyHints[n]}` : ''}`} icon="code-braces">
                      <ChipGroup
                        options={(['text', 'column', 'phone'] as VarSource[]).map((s) => ({ key: s, label: sourceLabel(s) }))}
                        selected={[m.source]}
                        onToggle={(k) => setMap(n, { source: k as VarSource, value: '' })}
                      />
                      {m.source === 'text' ? (
                        <TextInput
                          mode="outlined"
                          dense
                          value={m.value}
                          error={missing}
                          onChangeText={(v) => setMap(n, { value: v })}
                          placeholder={info?.bodyHints[n] || L('טקסט', 'Text')}
                        />
                      ) : null}
                      {m.source === 'column' ? (
                        <Picker options={columnOptions} value={m.value} onChange={(k) => setMap(n, { value: k })} placeholder={L('בחר שדה איש קשר', 'Pick a contact field')} />
                      ) : null}
                      {m.source === 'phone' ? (
                        <Text style={{ color: sub, fontSize: 12.5, textAlign }}>{L('יוחלף במספר הטלפון של הנמען.', "Replaced with the recipient's phone number.")}</Text>
                      ) : null}
                    </Section>
                  );
                })}
                {inputButtonVars.map((bv) => {
                  const m = btnMaps[bv.Variable] || { source: 'text' as VarSource, value: '' };
                  const missing = missingButtonVars.includes(bv);
                  const title = `${L('קישור לכפתור', 'Button link')}${bv.buttonText ? ` · ${bv.buttonText}` : ''}`;
                  return (
                    <Section key={bv.Variable} title={title} icon="link-variant">
                      {bv.prefix ? (
                        <Text style={{ color: sub, fontSize: 12, textAlign, writingDirection: 'ltr' }} numberOfLines={2}>
                          {bv.prefix}…
                        </Text>
                      ) : null}
                      <ChipGroup
                        options={(['text', 'column'] as VarSource[]).map((s) => ({ key: s, label: sourceLabel(s) }))}
                        selected={[m.source === 'column' ? 'column' : 'text']}
                        onToggle={(k) => setBtnMap(bv.Variable, { source: k as VarSource, value: '' })}
                      />
                      {m.source !== 'column' ? (
                        <TextInput
                          mode="outlined"
                          dense
                          value={m.value}
                          error={missing}
                          autoCapitalize="none"
                          autoCorrect={false}
                          keyboardType="url"
                          onChangeText={(v) => setBtnMap(bv.Variable, { value: v.replace(/[\n\r\t]/g, ' ') })}
                          placeholder={bv.isTrackingDestination ? 'https://…' : bv.prefix ? L('החלק שאחרי הכתובת (או קישור מלא)', 'The part after the address (or a full link)') : 'https://…'}
                        />
                      ) : (
                        <Picker options={columnOptions} value={m.value} onChange={(k) => setBtnMap(bv.Variable, { value: k })} placeholder={L('בחר שדה איש קשר', 'Pick a contact field')} />
                      )}
                    </Section>
                  );
                })}
                {warnings.map((w, i) => (
                  <Notice key={i} kind={/error|high/i.test(w.severity) ? 'error' : 'warn'} text={`${w.label ? `${w.label}: ` : ''}${w.message}`} />
                ))}
                {info ? (
                  <Section title={L('תצוגה מקדימה', 'Preview')} icon="eye-outline">
                    <TemplateBubble info={info} bodyText={previewBody} mediaUrl={shownMedia} he={he} buttonUrls={buttonUrls} />
                    <Text style={{ color: sub, fontSize: 11.5, textAlign }}>
                      {L('‹שדה› יוחלף בערך של כל נמען בעת השליחה.', '‹field› is replaced with each recipient\'s value when sending.')}
                    </Text>
                  </Section>
                ) : null}
              </>
            )}
          </>
        ) : null}

        {/* ───── Step 3: sender & delivery ───── */}
        {step === 3 ? (
          <>
            {waNumbers.length > 1 ? (
              <Section title={L('שליחה מהמספר', 'Send from number')} icon="cellphone-message">
                <ChipGroup
                  options={waNumbers.map((n) => ({
                    key: n.PhoneNumberId,
                    label: `${n.DisplayNumber}${n.Label ? ` · ${n.Label}` : ''}${n.IsPrimary ? ' ★' : ''}`,
                  }))}
                  selected={[fromNumberId]}
                  onToggle={setFromNumberId}
                />
              </Section>
            ) : null}

            <Section title={L('מתי לשלוח', 'When to send')} icon="calendar-clock">
              {modeOptions.map((o) => {
                const on = mode === o.key;
                return (
                  <Pressable
                    key={o.key}
                    onPress={() => setMode(o.key)}
                    style={[
                      styles.modeRow,
                      { flexDirection, borderColor: on ? BRAND : theme.colors.outlineVariant, backgroundColor: on ? withAlpha(BRAND, 0.08) : 'transparent' },
                    ]}
                  >
                    <MaterialCommunityIcons name={o.icon as any} size={22} color={on ? BRAND : sub} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: theme.colors.onSurface, fontWeight: '700', textAlign }}>{o.label}</Text>
                      <Text style={{ color: sub, fontSize: 12, textAlign }}>{o.hint}</Text>
                    </View>
                    <MaterialCommunityIcons name={on ? 'radiobox-marked' : 'radiobox-blank'} size={22} color={on ? BRAND : sub} />
                  </Pressable>
                );
              })}

              {scheduled ? (
                <>
                  <Pressable
                    onPress={() => setPickerOpen(true)}
                    style={[styles.pickRow, { flexDirection, borderColor: theme.colors.outlineVariant }]}
                  >
                    <MaterialCommunityIcons name="calendar" size={20} color={theme.colors.primary} />
                    <Text style={{ flex: 1, color: when ? theme.colors.onSurface : sub, textAlign }}>
                      {when ? formatWhen(when, he) : mode === 'weekly' ? L('בחר מועד התחלה', 'Pick the first run') : L('בחר תאריך ושעה', 'Pick date & time')}
                    </Text>
                    <Text style={{ color: sub, fontSize: 11 }}>{deviceTimeZone()}</Text>
                  </Pressable>
                  {mode === 'weekly' ? (
                    <>
                      <Text style={{ color: theme.colors.onSurface, fontWeight: '600', fontSize: 13, textAlign }}>{L('ימי שליחה', 'Weekdays')}</Text>
                      <ChipGroup
                        options={(he ? WEEKDAYS_HE : WEEKDAYS_EN).map((label, i) => ({ key: String(i), label }))}
                        selected={weekdays.map(String)}
                        onToggle={(k) => {
                          const d = parseInt(k, 10);
                          setWeekdays((w) => (w.includes(d) ? w.filter((x) => x !== d) : [...w, d]));
                        }}
                      />
                      <Text style={{ color: theme.colors.onSurface, fontWeight: '600', fontSize: 13, textAlign }}>{L('סיום', 'Ends')}</Text>
                      <ChipGroup
                        options={[
                          { key: 'none', label: L('ללא סיום', 'Never') },
                          { key: 'count', label: L('אחרי מספר ריצות', 'After N runs') },
                        ]}
                        selected={[endType]}
                        onToggle={(k) => setEndType(k as 'none' | 'count')}
                      />
                      {endType === 'count' ? (
                        <TextInput
                          mode="outlined"
                          dense
                          keyboardType="number-pad"
                          label={L('מספר ריצות', 'Number of runs')}
                          value={endCount}
                          onChangeText={(t) => setEndCount(t.replace(/\D/g, ''))}
                        />
                      ) : null}
                    </>
                  ) : null}
                </>
              ) : null}

              {scheduleError && (scheduled || mode === 'now') ? <Notice kind="warn" text={scheduleError} /> : null}
            </Section>

            {overLimit ? (
              <Notice
                kind="warn"
                text={L(
                  `הקהל (${(audienceCount || 0).toLocaleString()}) גדול ממגבלת ה-24 שעות של Meta למספר (${dailyLimit.toLocaleString()}). באתר אפשר לפצל אוטומטית לבלוקים יומיים; מהנייד אפשר לשמור כטיוטה ולשלוח בבלוקים ממסך ההרצה.`,
                  `The audience (${(audienceCount || 0).toLocaleString()}) exceeds Meta's 24-hour limit for this number (${dailyLimit.toLocaleString()}). The web can auto-split into daily blocks; from mobile, save as a draft and send in blocks from the run screen.`,
                )}
              />
            ) : null}
          </>
        ) : null}

        {/* ───── Step 4: review ───── */}
        {step === 4 ? (
          <>
            <Section title={L('סיכום', 'Summary')} icon="clipboard-check-outline">
              <ReviewLine label={L('שם', 'Name')} value={name.trim()} />
              <ReviewLine
                label={L('תבנית', 'Template')}
                value={lockTemplate ? source?.wabaTemplateName || L('הודעה רגילה', 'Regular message') : selTpl?.name || ''}
              />
              <ReviewLine
                label={L('קהל', 'Audience')}
                value={
                  lockAudience
                    ? L(`${(audienceCount || 0).toLocaleString()} נמענים מאקסל`, `${(audienceCount || 0).toLocaleString()} Excel recipients`)
                    : rows.length === 0
                      ? L('כל אנשי הקשר', 'All contacts')
                      : rows.map(describeRow).join(logic === 'AND' ? ` ${L('וגם', 'AND')} ` : ` ${L('או', 'OR')} `)
                }
              />
              {!lockAudience ? <ReviewLine label={L('נמענים (משוער)', 'Recipients (approx.)')} value={count == null ? '—' : count.toLocaleString()} /> : null}
              {!lockVariables && bodyVars.length > 0 ? (
                <ReviewLine
                  label={L('משתנים', 'Variables')}
                  value={bodyVars
                    .map((n) => {
                      const m = maps[n];
                      return `{{${n}}} = ${m?.source === 'phone' ? L('טלפון', 'phone') : m?.source === 'column' ? m.value : `"${m?.value || ''}"`}`;
                    })
                    .join('\n')}
                />
              ) : null}
              {!lockVariables && inputButtonVars.length > 0 ? (
                <ReviewLine
                  label={L('קישורי כפתורים', 'Button links')}
                  value={inputButtonVars
                    .map((bv) => {
                      const m = btnMaps[bv.Variable];
                      return `${bv.buttonText || `#${bv.buttonIndex}`} = ${m?.source === 'column' ? m.value : buttonUrls[bv.buttonIndex - 1] || `"${m?.value || ''}"`}`;
                    })
                    .join('\n')}
                />
              ) : null}
              {hasMediaHeader ? (
                <ReviewLine
                  label={headerFormat === 'VIDEO' ? L('סרטון כותרת', 'Header video') : L('תמונת כותרת', 'Header image')}
                  value={mediaOverride ? mediaOverride.name || L('קובץ מותאם', 'Custom file') : L('של התבנית', "The template's own")}
                />
              ) : null}
              {senderNum ? <ReviewLine label={L('מספר שולח', 'Sender')} value={senderNum.DisplayNumber} /> : null}
              <ReviewLine
                label={L('שליחה', 'Delivery')}
                value={
                  mode === 'keep'
                    ? `${L('התזמון הקיים נשאר', 'Current schedule kept')}${keptWhen ? `: ${formatWhen(keptWhen, he)}` : ''}`
                    : mode === 'draft'
                    ? isEdit
                      ? L('ללא תזמון – הרצה ידנית', 'No schedule — run manually')
                      : L('טיוטה – הרצה ידנית', 'Draft — run manually')
                    : mode === 'now'
                      ? L('שליחה עכשיו (דרך מסך התצוגה המקדימה)', 'Send now (via the preview screen)')
                      : mode === 'once'
                        ? `${L('חד-פעמי', 'Once')}: ${formatWhen(when, he)}`
                        : `${L('שבועי', 'Weekly')}: ${formatWhen(when, he)} · ${[...weekdays].sort().map((d) => (he ? WEEKDAYS_HE : WEEKDAYS_EN)[d]).join(', ')}${
                            endType === 'count' ? ` · ${endCount} ${L('ריצות', 'runs')}` : ''
                          }`
                }
              />
            </Section>
            {mode === 'now' ? (
              <Notice
                kind="info"
                text={L(
                  'הקמפיין יישמר, ואז תעבור למסך התצוגה המקדימה שבו תאשר את הנמענים וההודעה לפני שליחה בפועל.',
                  'The campaign is saved, then you go to the preview screen where you confirm recipients and message before anything is sent.',
                )}
              />
            ) : null}
            {mode === 'once' || mode === 'weekly' ? (
              <Notice
                kind="warn"
                text={L(
                  'קמפיין מתוזמן נשלח אוטומטית במועד שנבחר. ודא שיש לך הסכמה חוקית לדיוור לנמענים.',
                  'A scheduled campaign is sent automatically at the chosen time. Make sure you have legal consent to market to the recipients.',
                )}
              />
            ) : null}
            {firstBadStep != null ? (
              <Notice kind="error" text={`${STEPS[firstBadStep]}: ${stepError(firstBadStep)}`}>
                <Button compact mode="outlined" onPress={() => setStep(firstBadStep)}>
                  {L('עבור לשלב', 'Go to step')}
                </Button>
              </Notice>
            ) : null}
          </>
        ) : null}

        <PickerSheet
          visible={previewOpen}
          mode="view"
          title={
            previewLoading
              ? L('אנשי קשר', 'Contacts')
              : L(
                  `אנשי קשר – ${previewTotal.toLocaleString()} סה"כ${previewTotal > previewContacts.length ? ` (מוצגים ${previewContacts.length})` : ''}`,
                  `Contacts – ${previewTotal.toLocaleString()} total${previewTotal > previewContacts.length ? ` (showing ${previewContacts.length})` : ''}`,
                )
          }
          loading={previewLoading}
          items={previewContacts.map((c) => ({ value: c.phone, label: c.name || c.phone, subtitle: c.name ? c.phone : undefined }))}
          emptyText={L('לא נמצאו אנשי קשר', 'No contacts found')}
          searchPlaceholder={L('חיפוש לפי שם או טלפון', 'Search by name or phone')}
          onDismiss={() => setPreviewOpen(false)}
        />

        <GambotDateTimePicker
          visible={pickerOpen}
          value={when}
          minimumDate={new Date()}
          title={L('מועד השליחה', 'Send time')}
          onConfirm={(d) => {
            setWhen(d);
            setPickerOpen(false);
            if (mode === 'weekly' && weekdays.length === 0) setWeekdays([d.getDay()]);
          }}
          onDismiss={() => setPickerOpen(false)}
        />
      </ScrollView>

      {/* Nav bar */}
      <View style={[styles.bar, { backgroundColor: theme.colors.surface, borderTopColor: theme.colors.outlineVariant, paddingBottom: Math.max(insets.bottom, 10) }]}>
        {currentError && step < STEPS.length - 1 ? (
          <Text style={{ color: theme.colors.error, fontSize: 12, textAlign, marginBottom: 6 }}>{currentError}</Text>
        ) : null}
        <View style={[styles.rowBetween, { flexDirection, gap: 10 }]}>
          {step > 0 ? (
            <Button mode="outlined" onPress={() => setStep(step - 1)} disabled={saving}>
              {L('הקודם', 'Back')}
            </Button>
          ) : null}
          {isEdit && step < STEPS.length - 1 ? (
            <Button mode="outlined" icon="content-save-outline" onPress={doSave} disabled={saving || !dirty || firstBadStep != null}>
              {L('שמור', 'Save')}
            </Button>
          ) : null}
          <Button
            mode="contained"
            buttonColor={BRAND}
            style={{ flex: 1 }}
            loading={saving}
            disabled={saving || (step < STEPS.length - 1 ? !!currentError : firstBadStep != null)}
            onPress={onNext}
            icon={step === STEPS.length - 1 ? 'content-save' : undefined}
          >
            {step === STEPS.length - 1 ? saveLabel : L('הבא', 'Next')}
          </Button>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

function ReviewLine({ label, value }: { label: string; value: string }) {
  const theme = useAppTheme();
  const { textAlign } = useRTL();
  return (
    <View style={{ gap: 2 }}>
      <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 11.5, textAlign }}>{label}</Text>
      <Text style={{ color: theme.colors.onSurface, fontSize: 13.5, lineHeight: 19, textAlign }}>{value || '—'}</Text>
    </View>
  );
}

async function loadSource(org: string, id: string): Promise<WaCampaign | null> {
  // Always the full document (Excel data, filters, queries) — the list payload may be trimmed.
  const full = await campaignsApi.getCampaignById(org, id).catch(() => null);
  const cached = getCachedCampaign(id) || null;
  if (full && !(full as any).error) return { ...(cached || {}), ...full, campaingId: full.campaingId || id };
  return cached;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 14, gap: 12, paddingBottom: 24 },
  stepper: { paddingHorizontal: 6, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  stepItem: { flex: 1, alignItems: 'center', gap: 3 },
  stepDot: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  rowBetween: { alignItems: 'center', justifyContent: 'space-between' },
  tplRow: { borderWidth: 1, borderRadius: 10, padding: 10, gap: 3 },
  filterCard: { borderWidth: 1, borderRadius: 10, padding: 10, gap: 8 },
  addRow: { gap: 8, flexWrap: 'wrap' },
  modeRow: { alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 10, padding: 10 },
  mediaRow: { alignItems: 'center', gap: 10 },
  mediaThumb: { width: 72, height: 72, borderRadius: 10, overflow: 'hidden' },
  pickRow: { alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 8, padding: 12 },
  bar: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14, paddingTop: 10 },
});
