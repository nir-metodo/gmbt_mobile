import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View,
  FlatList,
  StyleSheet,
  RefreshControl,
  Pressable,
  ScrollView,
  Alert,
  AppState,
} from 'react-native';
import {
  Appbar,
  Surface,
  Text,
  Avatar,
  Chip,
  ActivityIndicator,
  Button,
  Divider,
  SegmentedButtons,
  Portal,
  Modal,
  Dialog,
  IconButton,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import * as Location from 'expo-location';
import { useTranslation } from 'react-i18next';
import GambotDateTimePicker from '../../../../components/GambotDateTimePicker';
import { useAppTheme } from '../../../../hooks/useAppTheme';
import { useRTL } from '../../../../hooks/useRTL';
import { useAuthStore } from '../../../../stores/authStore';
import axiosInstance from '../../../../services/api/axiosInstance';
import { ENDPOINTS } from '../../../../constants/api';
import { getInitials } from '../../../../utils/formatters';

const BRAND_COLOR = '#2e6155';
const CLOCK_COLOR = '#2A9D8F';
const WARN_COLOR  = '#E63946';

interface Employee {
  id: string;
  name: string;
  email?: string;
  profilePicture?: string;
  isClockedIn: boolean;
  clockInTime?: string;
  todayHours: number;
  endDate?: string;
}

interface AttendanceRecord {
  id: string;
  date: string;
  clockIn?: string;
  clockOut?: string;
  totalHours: number;
  notes?: string;
}

interface ClockStatus {
  isClockedIn: boolean;
  clockInTime?: string;
  todayHours: number;
}

function parseTimestamp(dt: any): Date | null {
  if (dt === null || dt === undefined || dt === '') return null;
  if (typeof dt === 'number') return new Date(dt);
  if (typeof dt === 'object') {
    const seconds = dt._seconds ?? dt.seconds ?? dt.Seconds;
    if (typeof seconds === 'number') return new Date(seconds * 1000);
    return null;
  }
  if (typeof dt !== 'string') return null;

  const raw = dt.trim();
  if (!raw) return null;

  // 1) Fast path — engine-native parse (works for full ISO with an offset or trailing Z).
  const direct = new Date(raw);
  if (!isNaN(direct.getTime())) return direct;

  // 2) Hermes (React Native's JS engine) is stricter than the browser's V8: it rejects
  //    values the web parses fine, e.g. "2026-07-09 10:00:00" (space instead of T) or
  //    "2026-07-09T10:00" (no seconds, no timezone). MANAGER-entered attendance records can
  //    be saved in exactly these shapes, which is why they rendered as "—" / 0:00 in the app
  //    while showing correctly on the web. Normalize the string and retry.
  let s = raw.replace(' ', 'T');
  s = s.replace(/(\.\d{3})\d+/, '$1'); // trim over-long fractional seconds (".1234567" → ".123")
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) s += ':00'; // add seconds strict parsers require
  const retry = new Date(s);
  if (!isNaN(retry.getTime())) return retry;

  // 3) Last resort — extract the components and build a local Date by hand.
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    const [, y, mo, d, hh, mi, ss] = m;
    return new Date(
      parseInt(y, 10), parseInt(mo, 10) - 1, parseInt(d, 10),
      hh ? parseInt(hh, 10) : 0, mi ? parseInt(mi, 10) : 0, ss ? parseInt(ss, 10) : 0
    );
  }
  return null;
}

function formatTime(dt?: any) {
  const d = parseTimestamp(dt);
  if (!d) return '—';
  return d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
}

function formatHours(h: number | undefined | null) {
  const n = typeof h === 'number' && isFinite(h) ? h : 0;
  const hrs = Math.floor(Math.abs(n));
  const mins = Math.round((Math.abs(n) - hrs) * 60);
  return `${hrs}:${mins.toString().padStart(2, '0')}`;
}

function computeHours(rec: AttendanceRecord): number {
  if (typeof rec.totalHours === 'number' && isFinite(rec.totalHours) && rec.totalHours > 0) {
    return rec.totalHours;
  }
  const ci = parseTimestamp(rec.clockIn)?.getTime() || 0;
  const co = parseTimestamp(rec.clockOut)?.getTime() || 0;
  if (ci && co && co > ci) return (co - ci) / 3600000;
  return 0;
}

// Overtime settings snapshot (matches the web `employees` doc fields).
interface OtSettings {
  overtimeEnabled?: boolean;
  overtimeDailyThreshold?: number | string;
  overtimeRate1?: number | string;
  overtimeRate?: number | string;
  overtimeRate1Hours?: number | string;
  overtimeRate2?: number | string;
  weekendHolidayEnabled?: boolean;
  weekendHolidayRate?: number | string;
}

interface TierResult {
  regularHours: number;
  ot1Hours: number;
  ot2Hours: number;
  weekendHours: number;
  overtimeHours: number;
  perRecord: Record<string, { regular: number; ot1: number; ot2: number; weekend: number; total: number; rest: boolean }>;
  r1Pct: number;
  r2Pct: number;
  weekendPct: number;
}

// Stable per-record key shared between the tier calc and the daily breakdown render.
function recKey(r: AttendanceRecord): string {
  return r.id || parseTimestamp(r.clockIn)?.toISOString() || r.date || '';
}

function isRestDayRec(rec: AttendanceRecord): boolean {
  if ((rec as any).isHoliday) return true;
  const d = parseTimestamp(rec.clockIn) || (rec.date ? new Date(rec.date) : null);
  return d ? d.getDay() === 6 : false; // Saturday is the Israeli rest day
}

/**
 * Splits worked hours into tiers (100% / 125% / 150%) both overall and per shift.
 * Overtime thresholds are DAILY: first `dailyThreshold` hours = regular, next `r1Hours`
 * = tier-1 (125%), rest = tier-2 (150%); rest-day (Shabbat/holiday) hours count as 150%.
 * Multiple shifts in a day are distributed by the running daily total so the split is
 * accurate per shift too. Mirrors the web AttendanceReport logic.
 */
function computeTierBreakdown(records: AttendanceRecord[], emp?: OtSettings | null): TierResult {
  const otEnabled      = emp?.overtimeEnabled !== false;
  const dailyThreshold = parseFloat(String(emp?.overtimeDailyThreshold ?? '')) || 8;
  const r1Mult         = (parseFloat(String(emp?.overtimeRate1 ?? emp?.overtimeRate ?? '')) || 125) / 100;
  const r1Hours        = emp?.overtimeRate1Hours != null ? parseFloat(String(emp.overtimeRate1Hours)) : 2;
  const r2Mult         = (parseFloat(String(emp?.overtimeRate2 ?? '')) || 150) / 100;
  const weekendEnabled = emp?.weekendHolidayEnabled !== false;
  const weekendMult    = weekendEnabled ? ((parseFloat(String(emp?.weekendHolidayRate ?? '')) || 150) / 100) : 1;

  const days: Record<string, { recs: AttendanceRecord[]; rest: boolean }> = {};
  records.forEach((r) => {
    const d = parseTimestamp(r.clockIn) || (r.date ? new Date(r.date) : null);
    const key = d ? d.toISOString().slice(0, 10) : (r.date || 'unknown');
    if (!days[key]) days[key] = { recs: [], rest: false };
    days[key].recs.push(r);
    if (isRestDayRec(r)) days[key].rest = true;
  });

  let regularHours = 0, ot1Hours = 0, ot2Hours = 0, weekendHours = 0;
  const perRecord: TierResult['perRecord'] = {};

  Object.values(days).forEach(({ recs, rest }) => {
    const sorted = [...recs].sort(
      (a, b) => (parseTimestamp(a.clockIn)?.getTime() || 0) - (parseTimestamp(b.clockIn)?.getTime() || 0)
    );
    let cum = 0;
    sorted.forEach((r) => {
      const h = computeHours(r);
      const start = cum, end = cum + h;
      let reg = 0, o1 = 0, o2 = 0;
      if (otEnabled && end > dailyThreshold) {
        reg = Math.max(0, Math.min(end, dailyThreshold) - start);
        o1  = Math.max(0, Math.min(end, dailyThreshold + r1Hours) - Math.max(start, dailyThreshold));
        o2  = Math.max(0, end - Math.max(start, dailyThreshold + r1Hours));
      } else {
        reg = h;
      }
      cum = end;
      if (rest) {
        weekendHours += h;
        perRecord[recKey(r)] = { regular: 0, ot1: 0, ot2: 0, weekend: h, total: h, rest: true };
      } else {
        regularHours += reg; ot1Hours += o1; ot2Hours += o2;
        perRecord[recKey(r)] = { regular: reg, ot1: o1, ot2: o2, weekend: 0, total: h, rest: false };
      }
    });
  });

  return {
    regularHours, ot1Hours, ot2Hours, weekendHours,
    overtimeHours: ot1Hours + ot2Hours + weekendHours,
    perRecord,
    r1Pct: Math.round(r1Mult * 100),
    r2Pct: Math.round(r2Mult * 100),
    weekendPct: Math.round(weekendMult * 100),
  };
}

function isAdmin(user: any) {
  const role = (user?.SecurityRole || user?.securityRole || '').toLowerCase();
  return ['admin', 'superadmin', 'owner', 'manager'].includes(role);
}

function isTerminated(emp: Employee) {
  return !!emp.endDate && new Date(emp.endDate) <= new Date();
}

// ── Live timer for clocked-in employees ──────────────────────────────────────
function useLiveTimer(clockInTime?: string) {
  const [elapsed, setElapsed] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!clockInTime) { setElapsed(0); return; }
    const tick = () => setElapsed((Date.now() - new Date(clockInTime).getTime()) / 3600000);
    tick();
    intervalRef.current = setInterval(tick, 30000);

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') tick();
    });

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      sub.remove();
    };
  }, [clockInTime]);

  return elapsed;
}

// Maps known backend (English) clock in/out errors to friendly Hebrew text.
function mapClockError(raw?: string): string {
  if (!raw) return '';
  const map: Record<string, string> = {
    'Already clocked in. Clock out first.': 'כבר בוצעה כניסה. יש לבצע יציאה לפני כניסה חדשה.',
    'No active clock-in found.': 'לא נמצאה כניסה פעילה לדיווח יציאה.',
    'Missing organizationName': 'שגיאה בזיהוי הארגון. נסה/י להתחבר מחדש.',
  };
  return map[raw.trim()] || raw;
}

// ── My Hours Tab ─────────────────────────────────────────────────────────────
function MyHoursTab({ org, userId }: { org: string; userId: string }) {
  const { t } = useTranslation();
  const theme = useAppTheme();
  const { isRTL } = useRTL();
  const [status, setStatus] = useState<ClockStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [clocking, setClocking] = useState(false);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [errorDialog, setErrorDialog] = useState<{
    visible: boolean; icon: string; iconColor: string; title: string; message: string;
  }>({ visible: false, icon: 'alert-circle-outline', iconColor: WARN_COLOR, title: '', message: '' });

  // An OPEN shift is any record with a clock-in but no clock-out. We look across the whole
  // month (not just today) so a shift a MANAGER opened for the employee shows up as an active
  // shift the employee can finish — even if it was entered for an earlier day.
  const openRecord = useMemo(
    () => records.find((r) => parseTimestamp(r.clockIn) && (!r.clockOut || r.clockOut === '')) || null,
    [records]
  );
  const openClockInIso = useMemo(
    () => (openRecord ? parseTimestamp(openRecord.clockIn)?.toISOString() : undefined),
    [openRecord]
  );
  // Clocked-in state is driven by an open record if we found one; otherwise fall back to the
  // today-only status probe (covers the brief window before the month list finishes loading).
  const isClockedIn = openRecord ? true : !!status?.isClockedIn;
  const activeClockInIso = openClockInIso || status?.clockInTime;
  const liveElapsed = useLiveTimer(isClockedIn ? activeClockInIso : undefined);

  // Whether the org actually requires location for time reporting (geofence enabled + at least
  // one configured location). When it doesn't, we must NOT ask for location permission at all —
  // requesting it needlessly is both a bad UX and an app-store review flag. Defaults to false so
  // we never prompt until we've confirmed the org opted in.
  const [locationRequired, setLocationRequired] = useState(false);

  useEffect(() => {
    let active = true;
    axiosInstance.post(ENDPOINTS.GET_ATTENDANCE_SETTINGS, { organizationName: org })
      .then((res) => {
        if (!active) return;
        const d = res.data || {};
        const enabled = d.geofenceEnabled === true;
        const locs = Array.isArray(d.locations) ? d.locations : [];
        const hasLegacyPoint = typeof d.latitude === 'number' && typeof d.longitude === 'number';
        setLocationRequired(enabled && (locs.length > 0 || hasLegacyPoint));
      })
      .catch(() => { if (active) setLocationRequired(false); });
    return () => { active = false; };
  }, [org]);

  const fetchStatus = useCallback(async () => {
    try {
      const now = new Date();
      const today = now.toISOString().slice(0, 10);
      // Derive clock status from today's attendance records (GetMyClockStatus endpoint doesn't exist)
      const res = await axiosInstance.post(ENDPOINTS.GET_ATTENDANCE_RECORDS, {
        organizationName: org,
        userId,
        dateFrom: today,
        dateTo: today,
      });
      const todayRecs: any[] = Array.isArray(res.data) ? res.data : [];
      const openRec = todayRecs.find((r: any) => !r.clockOut || r.clockOut === '');
      const totalHours = todayRecs.reduce((sum: number, r: any) => {
        const ciDate = parseTimestamp(r.clockIn);
        const coDate = parseTimestamp(r.clockOut);
        if (ciDate && coDate) {
          const diff = (coDate.getTime() - ciDate.getTime()) / 3600000;
          return sum + Math.max(0, diff);
        } else if (ciDate && !coDate) {
          const diff = (Date.now() - ciDate.getTime()) / 3600000;
          return sum + Math.max(0, diff);
        }
        return sum;
      }, 0);
      const clockInParsed = parseTimestamp(openRec?.clockIn);
      setStatus({
        isClockedIn: !!openRec,
        clockInTime: clockInParsed ? clockInParsed.toISOString() : undefined,
        todayHours: Math.round(totalHours * 100) / 100,
      });
    } catch { setStatus(null); } finally { setLoading(false); }
  }, [org, userId]);

  const fetchMyRecords = useCallback(async () => {
    setLoadingRecords(true);
    try {
      const now = new Date();
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
      const lastDay  = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
      const res = await axiosInstance.post(ENDPOINTS.GET_ATTENDANCE_RECORDS, {
        organizationName: org, userId, dateFrom: firstDay, dateTo: lastDay,
      });
      const data: AttendanceRecord[] = Array.isArray(res.data) ? res.data : [];
      data.sort((a, b) => new Date(b.date || b.clockIn || '').getTime() - new Date(a.date || a.clockIn || '').getTime());
      setRecords(data);
    } catch { setRecords([]); } finally { setLoadingRecords(false); }
  }, [org, userId]);

  useEffect(() => { fetchStatus(); fetchMyRecords(); }, [fetchStatus, fetchMyRecords]);

  // Refresh clock status when app returns from background
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') { fetchStatus(); }
    });
    return () => sub.remove();
  }, [fetchStatus]);

  const didMountRef = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!didMountRef.current) {
        didMountRef.current = true;
        return;
      }
      fetchStatus();
      fetchMyRecords();
    }, [fetchStatus, fetchMyRecords])
  );

  // Best-effort GPS coordinates for geofenced time reporting. Only request the location
  // permission when the org actually configured a geofence — otherwise skip entirely so the
  // app never asks for location it doesn't need.
  const getCoords = async (): Promise<{ latitude?: number; longitude?: number; accuracy?: number }> => {
    if (!locationRequired) return {};
    try {
      const { status: perm } = await Location.requestForegroundPermissionsAsync();
      if (perm !== 'granted') return {};
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      return { latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy ?? undefined };
    } catch {
      return {};
    }
  };

  const handleClockInOut = async () => {
    setClocking(true);
    try {
      const coords = await getCoords();
      if (isClockedIn) {
        // Pass the exact open record id so the employee can finish a shift a MANAGER opened for
        // them — even if it was entered for an earlier day (the backend's no-recordId path only
        // looks at today's records and would otherwise fail with "No active clock-in found").
        await axiosInstance.post(ENDPOINTS.CLOCK_OUT, {
          organizationName: org,
          ...(openRecord?.id ? { recordId: openRecord.id } : {}),
          ...coords,
        });
      } else {
        await axiosInstance.post(ENDPOINTS.CLOCK_IN, { organizationName: org, ...coords });
      }
      await fetchStatus();
      await fetchMyRecords();
    } catch (e: any) {
      const data = e?.response?.data;
      if (data?.code === 'OUTSIDE_RADIUS') {
        const parts: string[] = ['לא ניתן לדווח שעות — נמצאת מחוץ לאזור המורשה לדיווח.'];
        if (data.distance > 0) {
          const distTxt = data.distance >= 1000
            ? `${(data.distance / 1000).toFixed(1)} ק"מ`
            : `${Math.round(data.distance)} מ'`;
          const radiusTxt = data.radius > 0 ? ` (הטווח המותר: עד ${Math.round(data.radius)} מ')` : '';
          parts.push(`המרחק מהמיקום המורשה הקרוב ביותר: ${distTxt}${radiusTxt}.`);
        }
        parts.push('התקרב/י לאחד ממקומות העבודה המוגדרים ונסה/י שוב.');
        setErrorDialog({
          visible: true, icon: 'map-marker-off-outline', iconColor: WARN_COLOR,
          title: 'מחוץ לאזור המורשה', message: parts.join('\n\n'),
        });
      } else if (data?.code === 'LOCATION_REQUIRED') {
        setErrorDialog({
          visible: true, icon: 'crosshairs-gps', iconColor: WARN_COLOR,
          title: 'נדרשת הרשאת מיקום',
          message: 'דיווח שעות דורש גישה למיקום המכשיר.\n\nאנא אפשר/י הרשאת מיקום בהגדרות המכשיר ונסה/י שוב.',
        });
      } else {
        const raw = typeof data === 'string' ? data : (data?.error || e?.message);
        setErrorDialog({
          visible: true, icon: 'alert-circle-outline', iconColor: WARN_COLOR,
          title: t('common.error'), message: mapClockError(raw) || t('errors.generic'),
        });
      }
    } finally {
      setClocking(false);
    }
  };

  const currentHours = isClockedIn ? liveElapsed : (status?.todayHours || 0);

  if (loading) return (
    <View style={[s.center, { flex: 1 }]}>
      <ActivityIndicator color={BRAND_COLOR} />
    </View>
  );

  return (
    <>
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
      {/* Clock Card */}
      <Surface style={[s.clockCard, { backgroundColor: theme.colors.surface }]} elevation={2}>
        <View style={s.clockCardInner}>
          <MaterialCommunityIcons
            name={isClockedIn ? 'clock-time-four' : 'clock-outline'}
            size={48}
            color={isClockedIn ? CLOCK_COLOR : theme.colors.onSurfaceVariant}
          />
          <Text variant="headlineMedium" style={{ color: theme.colors.onSurface, fontWeight: '800', marginTop: 8 }}>
            {formatHours(currentHours)}
          </Text>
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 4 }}>
            {t('employees.todayHours')}
          </Text>
          {isClockedIn && activeClockInIso && (
            <Chip compact icon="login" style={{ backgroundColor: CLOCK_COLOR + '15', marginBottom: 12 }}>
              <Text style={{ color: CLOCK_COLOR, fontSize: 12, fontWeight: '600' }}>
                {t('employees.clockedInSince')} {formatTime(activeClockInIso)}
              </Text>
            </Chip>
          )}
          <Button
            mode="contained"
            onPress={handleClockInOut}
            loading={clocking}
            disabled={clocking}
            buttonColor={isClockedIn ? WARN_COLOR : CLOCK_COLOR}
            style={{ borderRadius: 28, minWidth: 200, marginTop: 8 }}
            contentStyle={{ paddingVertical: 6 }}
            icon={isClockedIn ? 'logout' : 'login'}
          >
            {isClockedIn ? t('employees.clockOut') : t('employees.clockIn')}
          </Button>
        </View>
      </Surface>

      {/* This month records */}
      <Text variant="titleMedium" style={[s.sectionTitle, { color: theme.colors.onSurface, textAlign: isRTL ? 'right' : 'left' }]}>
        {t('employees.thisMonthRecords')}
      </Text>

      {loadingRecords ? (
        <ActivityIndicator color={BRAND_COLOR} style={{ marginTop: 20 }} />
      ) : records.length === 0 ? (
        <Text style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center', marginTop: 20 }}>
          {t('common.noResults')}
        </Text>
      ) : (
        records.map((rec, i) => {
          const recIsOpen = !!parseTimestamp(rec.clockIn) && (!rec.clockOut || rec.clockOut === '');
          const recDate = parseTimestamp(rec.date) || parseTimestamp(rec.clockIn);
          return (
          <Surface key={rec.id || i} style={[s.recordCard, { backgroundColor: theme.colors.surface }]} elevation={1}>
            <View style={[s.recordRow, { flexDirection: 'row' }]}>
              <View style={{ flex: 1 }}>
                <Text variant="labelMedium" style={{ color: theme.colors.onSurface, fontWeight: '700', textAlign: isRTL ? 'right' : 'left' }}>
                  {recDate ? recDate.toLocaleDateString('he-IL', { weekday: 'short', day: 'numeric', month: 'short' }) : '—'}
                </Text>
                <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, textAlign: isRTL ? 'right' : 'left' }}>
                  {recIsOpen
                    ? `${formatTime(rec.clockIn)} — ${t('employees.ongoing', 'עכשיו')}`
                    : `${formatTime(rec.clockIn)} — ${formatTime(rec.clockOut)}`}
                </Text>
              </View>
              <Chip compact style={{ backgroundColor: (recIsOpen ? CLOCK_COLOR : BRAND_COLOR) + '15' }}>
                <Text style={{ color: recIsOpen ? CLOCK_COLOR : BRAND_COLOR, fontWeight: '700', fontSize: 13 }}>
                  {recIsOpen ? t('employees.activeShift', 'משמרת פעילה') : formatHours(computeHours(rec))}
                </Text>
              </Chip>
            </View>
          </Surface>
          );
        })
      )}
    </ScrollView>

    {/* Styled error dialog (geofence / clock errors) */}
    <Portal>
      <Dialog
        visible={errorDialog.visible}
        onDismiss={() => setErrorDialog(d => ({ ...d, visible: false }))}
        style={{ borderRadius: 20 }}
      >
        <Dialog.Icon icon={errorDialog.icon} color={errorDialog.iconColor} size={40} />
        <Dialog.Title style={{ textAlign: 'center' }}>{errorDialog.title}</Dialog.Title>
        <Dialog.Content>
          <Text
            variant="bodyMedium"
            style={{ textAlign: 'center', color: theme.colors.onSurfaceVariant, lineHeight: 22 }}
          >
            {errorDialog.message}
          </Text>
        </Dialog.Content>
        <Dialog.Actions style={{ justifyContent: 'center' }}>
          <Button
            onPress={() => setErrorDialog(d => ({ ...d, visible: false }))}
            mode="contained"
            buttonColor={BRAND_COLOR}
            textColor="#fff"
          >
            {t('common.ok', 'הבנתי')}
          </Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
    </>
  );
}

// ── Manage Tab ────────────────────────────────────────────────────────────────
function ManageTab({ org }: { org: string }) {
  const { t } = useTranslation();
  const theme = useAppTheme();
  const { isRTL } = useRTL();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [selected, setSelected]   = useState<Employee | null>(null);
  const [records, setRecords]     = useState<AttendanceRecord[]>([]);
  const [loadingRec, setLoadingRec] = useState(false);

  const fetchEmployees = useCallback(async () => {
    setFetchError(null);
    try {
      const res = await axiosInstance.post(ENDPOINTS.GET_EMPLOYEES_DASHBOARD, { organizationName: org });
      setEmployees(Array.isArray(res.data) ? res.data : []);
    } catch (e: any) {
      setEmployees([]);
      setFetchError(e?.message || t('errors.generic'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [org, t]);

  useEffect(() => { fetchEmployees(); }, [fetchEmployees]);

  const didMountRefManage = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!didMountRefManage.current) {
        didMountRefManage.current = true;
        return;
      }
      fetchEmployees();
    }, [fetchEmployees])
  );

  const openEmployee = async (emp: Employee) => {
    setSelected(emp);
    setLoadingRec(true);
    try {
      const now = new Date();
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
      const lastDay  = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
      const res = await axiosInstance.post(ENDPOINTS.GET_ATTENDANCE_RECORDS, {
        organizationName: org, employeeId: emp.id, dateFrom: firstDay, dateTo: lastDay,
      });
      const data: AttendanceRecord[] = Array.isArray(res.data) ? res.data : [];
      data.sort((a, b) => new Date(b.date || b.clockIn || '').getTime() - new Date(a.date || a.clockIn || '').getTime());
      setRecords(data);
    } catch { setRecords([]); } finally { setLoadingRec(false); }
  };

  const activeEmployees = employees.filter(e => !isTerminated(e));
  const clockedInCount  = employees.filter(e => e.isClockedIn).length;
  const totalTodayHours = employees.reduce((s, e) => s + (e.todayHours || 0), 0);

  if (loading) return (
    <View style={[s.center, { flex: 1 }]}>
      <ActivityIndicator color={BRAND_COLOR} />
    </View>
  );

  return (
    <>
      {fetchError ? (
        <View style={{ padding: 16, alignItems: 'center', gap: 8 }}>
          <MaterialCommunityIcons name="alert-circle-outline" size={40} color="#E63946" style={{ opacity: 0.7 }} />
          <Text variant="bodyMedium" style={{ color: '#E63946', textAlign: 'center' }}>{fetchError}</Text>
          <Button mode="text" onPress={fetchEmployees}>{t('common.retry')}</Button>
        </View>
      ) : null}
      {/* Stats row */}
      <View style={[s.statsRow, { flexDirection: 'row' }]}>
        <Surface style={[s.statCard, { backgroundColor: theme.colors.surface }]} elevation={1}>
          <Text variant="headlineSmall" style={{ color: BRAND_COLOR, fontWeight: '800' }}>{activeEmployees.length}</Text>
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>{t('employees.active')}</Text>
        </Surface>
        <Surface style={[s.statCard, { backgroundColor: theme.colors.surface }]} elevation={1}>
          <Text variant="headlineSmall" style={{ color: CLOCK_COLOR, fontWeight: '800' }}>{clockedInCount}</Text>
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>{t('employees.clockedIn')}</Text>
        </Surface>
        <Surface style={[s.statCard, { backgroundColor: theme.colors.surface }]} elevation={1}>
          <Text variant="headlineSmall" style={{ color: BRAND_COLOR, fontWeight: '800' }}>{formatHours(totalTodayHours)}</Text>
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>{t('employees.totalToday')}</Text>
        </Surface>
      </View>

      <FlatList
        data={activeEmployees}
        keyExtractor={(e) => e.id}
        contentContainerStyle={{ padding: 12, paddingBottom: 48 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchEmployees(); }}
            colors={[BRAND_COLOR]} tintColor={BRAND_COLOR} />
        }
        renderItem={({ item }) => (
          <Surface style={[s.empCard, { backgroundColor: theme.colors.surface }]} elevation={1}>
            <Pressable onPress={() => openEmployee(item)} style={[s.empRow, { flexDirection: 'row' }]}>
              {item.profilePicture ? (
                <Avatar.Image size={44} source={{ uri: item.profilePicture }} />
              ) : (
                <Avatar.Text
                  size={44}
                  label={getInitials(item.name)}
                  style={{ backgroundColor: (item.isClockedIn ? CLOCK_COLOR : '#6C757D') + '25' }}
                  labelStyle={{ color: item.isClockedIn ? CLOCK_COLOR : '#6C757D', fontWeight: '700' }}
                />
              )}
              <View style={[s.empInfo, { alignItems: 'flex-start' }]}>
                <Text variant="titleSmall" style={{ color: theme.colors.onSurface, fontWeight: '700' }}>{item.name}</Text>
                <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                  {item.isClockedIn
                    ? `${t('employees.clockedInSince')} ${formatTime(item.clockInTime)}`
                    : t('employees.notClockedIn')}
                </Text>
              </View>
              <View style={{ alignItems: 'center', gap: 4 }}>
                <View style={[s.clockDot, { backgroundColor: item.isClockedIn ? CLOCK_COLOR : '#CCC' }]} />
                <Text variant="labelSmall" style={{ color: BRAND_COLOR, fontWeight: '700' }}>
                  {formatHours(item.todayHours)}
                </Text>
              </View>
            </Pressable>
          </Surface>
        )}
        ListEmptyComponent={
          <View style={s.center}>
            <MaterialCommunityIcons name="account-group-outline" size={56} color={theme.colors.onSurfaceVariant + '50'} />
            <Text style={{ color: theme.colors.onSurfaceVariant, marginTop: 12 }}>{t('common.noResults')}</Text>
          </View>
        }
      />

      {/* Employee Detail Modal */}
      <Portal>
        <Modal
          visible={!!selected}
          onDismiss={() => { setSelected(null); setRecords([]); }}
          contentContainerStyle={[s.modal, { backgroundColor: theme.colors.surface }]}
        >
          {selected && (
            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={[s.modalHeader, { flexDirection: 'row' }]}>
                <Text variant="titleLarge" style={{ flex: 1, color: theme.colors.onSurface, fontWeight: '700', textAlign: isRTL ? 'right' : 'left' }}>
                  {selected.name}
                </Text>
                <IconButton icon="close" onPress={() => { setSelected(null); setRecords([]); }} />
              </View>

              <View style={[s.empModalStats, { flexDirection: 'row' }]}>
                <View style={s.empModalStat}>
                  <View style={[s.clockDot, { backgroundColor: selected.isClockedIn ? CLOCK_COLOR : '#CCC', width: 12, height: 12, borderRadius: 6 }]} />
                  <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                    {selected.isClockedIn ? t('employees.clockedIn') : t('employees.notClockedIn')}
                  </Text>
                </View>
                <View style={s.empModalStat}>
                  <Text variant="titleMedium" style={{ color: BRAND_COLOR, fontWeight: '800' }}>{formatHours(selected.todayHours)}</Text>
                  <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>{t('employees.today')}</Text>
                </View>
                <View style={s.empModalStat}>
                  <Text variant="titleMedium" style={{ color: BRAND_COLOR, fontWeight: '800' }}>
                    {formatHours(records.reduce((s, r) => s + computeHours(r), 0))}
                  </Text>
                  <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>{t('employees.thisMonth')}</Text>
                </View>
              </View>

              <Divider style={{ marginVertical: 12 }} />

              <Text variant="labelLarge" style={{ color: BRAND_COLOR, fontWeight: '700', marginBottom: 8, textAlign: isRTL ? 'right' : 'left' }}>
                {t('employees.thisMonthRecords')}
              </Text>

              {loadingRec ? (
                <ActivityIndicator color={BRAND_COLOR} style={{ marginTop: 16 }} />
              ) : records.length === 0 ? (
                <Text style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center', marginTop: 16 }}>{t('common.noResults')}</Text>
              ) : (
                records.map((rec, i) => {
                  const recIsOpen = !!parseTimestamp(rec.clockIn) && (!rec.clockOut || rec.clockOut === '');
                  const recDate = parseTimestamp(rec.date) || parseTimestamp(rec.clockIn);
                  return (
                  <View key={rec.id || i} style={[s.recRow, { flexDirection: 'row', borderColor: theme.colors.outlineVariant }]}>
                    <Text variant="bodySmall" style={{ flex: 1, color: theme.colors.onSurface, textAlign: isRTL ? 'right' : 'left' }}>
                      {recDate ? recDate.toLocaleDateString('he-IL', { weekday: 'short', day: 'numeric', month: 'short' }) : '—'}
                    </Text>
                    <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                      {recIsOpen
                        ? `${formatTime(rec.clockIn)} — ${t('employees.ongoing', 'עכשיו')}`
                        : `${formatTime(rec.clockIn)} — ${formatTime(rec.clockOut)}`}
                    </Text>
                    <Text variant="labelMedium" style={{ color: recIsOpen ? CLOCK_COLOR : BRAND_COLOR, fontWeight: '700', minWidth: 40, textAlign: 'center' }}>
                      {recIsOpen ? t('employees.activeShift', 'פעילה') : formatHours(computeHours(rec))}
                    </Text>
                  </View>
                  );
                })
              )}
            </ScrollView>
          )}
        </Modal>
      </Portal>
    </>
  );
}

// ── Report Tab ────────────────────────────────────────────────────────────────
type ReportRange = 'this_month' | 'last_month' | 'custom';

function ReportTab({ org, userId, userName }: { org: string; userId: string; userName: string }) {
  const { t } = useTranslation();
  const theme = useAppTheme();
  const { isRTL } = useRTL();
  const user = useAuthStore((st) => st.user);
  const admin = isAdmin(user);

  const [range, setRange] = useState<ReportRange>('this_month');
  const [dateFrom, setDateFrom] = useState<Date>(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [dateTo, setDateTo] = useState<Date>(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0));
  const [showFromPicker, setShowFromPicker] = useState(false);
  const [showToPicker, setShowToPicker] = useState(false);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [targetEmployee, setTargetEmployee] = useState<string | null>(null);
  const [employees, setEmployees] = useState<{ id: string; name: string }[]>([]);
  const [showEmployeePicker, setShowEmployeePicker] = useState(false);
  // Overtime settings for the tier breakdown: own profile + (admin) a map of all employees.
  const [mySettings, setMySettings] = useState<OtSettings | null>(null);
  const [empSettingsMap, setEmpSettingsMap] = useState<Record<string, OtSettings>>({});

  useEffect(() => {
    axiosInstance.post(ENDPOINTS.GET_MY_ATTENDANCE, { organizationName: org, userId })
      .then((res) => { if (res.data?.employee) setMySettings(res.data.employee); })
      .catch(() => {});
  }, [org, userId]);

  useEffect(() => {
    if (admin) {
      axiosInstance.post(ENDPOINTS.GET_EMPLOYEES_DASHBOARD, { organizationName: org })
        .then((res) => setEmployees(Array.isArray(res.data) ? res.data.map((e: any) => ({ id: e.id, name: e.name })) : []))
        .catch(() => {});
      // Full employee docs carry the overtime rules (dashboard only returns names).
      axiosInstance.post(ENDPOINTS.GET_EMPLOYEES, { organizationName: org })
        .then((res) => {
          const map: Record<string, OtSettings> = {};
          (Array.isArray(res.data) ? res.data : []).forEach((e: any) => {
            if (e.id) map[e.id] = e;
            if (e.uID) map[e.uID] = e;
            if (e.userId) map[e.userId] = e;
          });
          setEmpSettingsMap(map);
        })
        .catch(() => {});
    }
  }, [org, admin]);

  const handleRangeChange = (r: ReportRange) => {
    setRange(r);
    setGenerated(false);
    const now = new Date();
    if (r === 'this_month') {
      setDateFrom(new Date(now.getFullYear(), now.getMonth(), 1));
      setDateTo(new Date(now.getFullYear(), now.getMonth() + 1, 0));
    } else if (r === 'last_month') {
      setDateFrom(new Date(now.getFullYear(), now.getMonth() - 1, 1));
      setDateTo(new Date(now.getFullYear(), now.getMonth(), 0));
    }
  };

  const generateReport = async () => {
    setLoading(true);
    setGenerated(false);
    try {
      const empId = targetEmployee || userId;
      const res = await axiosInstance.post(ENDPOINTS.GET_ATTENDANCE_RECORDS, {
        organizationName: org,
        ...(empId === userId ? { userId: empId } : { employeeId: empId }),
        dateFrom: dateFrom.toISOString().slice(0, 10),
        dateTo: dateTo.toISOString().slice(0, 10),
      });
      const data: AttendanceRecord[] = Array.isArray(res.data) ? res.data : [];
      data.sort((a, b) => new Date(b.date || b.clockIn || '').getTime() - new Date(a.date || a.clockIn || '').getTime());
      setRecords(data);
      setGenerated(true);
    } catch {
      Alert.alert(t('common.error'));
    } finally {
      setLoading(false);
    }
  };

  const reportStats = useMemo(() => {
    if (!records.length) return null;
    const totalHours = records.reduce((sum, r) => sum + computeHours(r), 0);
    const daysWorked = records.filter((r) => computeHours(r) > 0).length;
    const avgHoursPerDay = daysWorked > 0 ? totalHours / daysWorked : 0;
    const maxDay = records.reduce((max, r) => computeHours(r) > computeHours(max) ? r : max, records[0]);
    const minDay = records.filter((r) => computeHours(r) > 0).reduce((min, r) => computeHours(r) < computeHours(min) ? r : min, records.find((r) => computeHours(r) > 0) || records[0]);

    const earlyIn = records.filter((r) => r.clockIn).sort((a, b) => {
      const dA = parseTimestamp(a.clockIn);
      const dB = parseTimestamp(b.clockIn);
      const timeA = dA ? dA.getHours() * 60 + dA.getMinutes() : 9999;
      const timeB = dB ? dB.getHours() * 60 + dB.getMinutes() : 9999;
      return timeA - timeB;
    })[0];
    const lateOut = records.filter((r) => r.clockOut).sort((a, b) => {
      const dA = parseTimestamp(a.clockOut);
      const dB = parseTimestamp(b.clockOut);
      const timeA = dA ? dA.getHours() * 60 + dA.getMinutes() : 0;
      const timeB = dB ? dB.getHours() * 60 + dB.getMinutes() : 0;
      return timeB - timeA;
    })[0];

    return { totalHours, daysWorked, avgHoursPerDay, maxDay, minDay, earlyIn, lateOut };
  }, [records]);

  // Resolve which OT settings apply to the report subject, then split hours into tiers.
  const activeSettings: OtSettings | null = targetEmployee
    ? (empSettingsMap[targetEmployee] || null)
    : mySettings;
  const tierData = useMemo(
    () => computeTierBreakdown(records, activeSettings),
    [records, activeSettings]
  );

  const selectedName = targetEmployee
    ? employees.find((e) => e.id === targetEmployee)?.name || ''
    : userName;

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }}>
      {/* Range selector */}
      <Surface style={[s.clockCard, { backgroundColor: theme.colors.surface }]} elevation={2}>
        <View style={{ padding: 20 }}>
          <Text variant="titleMedium" style={{ color: theme.colors.onSurface, fontWeight: '700', marginBottom: 12, textAlign: isRTL ? 'right' : 'left' }}>
            הפקת דוח נוכחות
          </Text>

          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
            {([
              { key: 'this_month' as ReportRange, label: 'חודש נוכחי' },
              { key: 'last_month' as ReportRange, label: 'חודש קודם' },
              { key: 'custom' as ReportRange, label: 'בין תאריכים' },
            ]).map((opt) => (
              <Pressable
                key={opt.key}
                onPress={() => handleRangeChange(opt.key)}
                style={[s.rangeChip, { backgroundColor: range === opt.key ? BRAND_COLOR : theme.colors.surfaceVariant }]}
              >
                <Text style={{ color: range === opt.key ? '#fff' : theme.colors.onSurfaceVariant, fontWeight: '600', fontSize: 13 }}>
                  {opt.label}
                </Text>
              </Pressable>
            ))}
          </View>

          {range === 'custom' && (
            <View style={{ flexDirection: 'row', gap: 12, marginBottom: 16 }}>
              <Pressable
                onPress={() => setShowFromPicker(true)}
                style={[s.datePickerBtn, { backgroundColor: theme.colors.surfaceVariant, flex: 1 }]}
              >
                <MaterialCommunityIcons name="calendar-start" size={18} color={BRAND_COLOR} />
                <Text style={{ color: theme.colors.onSurface, fontSize: 13 }}>
                  {dateFrom.toLocaleDateString('he-IL')}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setShowToPicker(true)}
                style={[s.datePickerBtn, { backgroundColor: theme.colors.surfaceVariant, flex: 1 }]}
              >
                <MaterialCommunityIcons name="calendar-end" size={18} color={BRAND_COLOR} />
                <Text style={{ color: theme.colors.onSurface, fontSize: 13 }}>
                  {dateTo.toLocaleDateString('he-IL')}
                </Text>
              </Pressable>
            </View>
          )}

          {admin && employees.length > 0 && (
            <View style={{ marginBottom: 16 }}>
              <Pressable
                onPress={() => setShowEmployeePicker(true)}
                style={[s.datePickerBtn, { backgroundColor: theme.colors.surfaceVariant }]}
              >
                <MaterialCommunityIcons name="account" size={18} color={BRAND_COLOR} />
                <Text style={{ color: theme.colors.onSurface, fontSize: 13, flex: 1 }}>
                  {selectedName || 'בחר עובד'}
                </Text>
                <MaterialCommunityIcons name="chevron-down" size={18} color={theme.colors.onSurfaceVariant} />
              </Pressable>
            </View>
          )}

          <Button
            mode="contained"
            onPress={generateReport}
            loading={loading}
            disabled={loading}
            buttonColor={BRAND_COLOR}
            icon="file-chart-outline"
            style={{ borderRadius: 12 }}
          >
            הפק דוח
          </Button>
        </View>
      </Surface>

      <GambotDateTimePicker
        visible={showFromPicker}
        mode="date"
        value={dateFrom}
        onConfirm={(d) => setDateFrom(d)}
        onDismiss={() => setShowFromPicker(false)}
      />
      <GambotDateTimePicker
        visible={showToPicker}
        mode="date"
        value={dateTo}
        minimumDate={dateFrom}
        onConfirm={(d) => setDateTo(d)}
        onDismiss={() => setShowToPicker(false)}
      />

      {/* Employee Picker Modal */}
      <Portal>
        <Modal
          visible={showEmployeePicker}
          onDismiss={() => setShowEmployeePicker(false)}
          contentContainerStyle={[s.modal, { backgroundColor: theme.colors.surface, maxHeight: '60%' }]}
        >
          <Text variant="titleMedium" style={{ color: theme.colors.onSurface, fontWeight: '700', marginBottom: 12 }}>
            בחר עובד
          </Text>
          <ScrollView>
            <Pressable
              onPress={() => { setTargetEmployee(null); setShowEmployeePicker(false); setGenerated(false); }}
              style={[s.empPickerItem, { backgroundColor: !targetEmployee ? BRAND_COLOR + '15' : 'transparent' }]}
            >
              <Text style={{ color: !targetEmployee ? BRAND_COLOR : theme.colors.onSurface, fontWeight: '600' }}>
                אני ({userName})
              </Text>
            </Pressable>
            {employees.map((emp) => (
              <Pressable
                key={emp.id}
                onPress={() => { setTargetEmployee(emp.id); setShowEmployeePicker(false); setGenerated(false); }}
                style={[s.empPickerItem, { backgroundColor: targetEmployee === emp.id ? BRAND_COLOR + '15' : 'transparent' }]}
              >
                <Text style={{ color: targetEmployee === emp.id ? BRAND_COLOR : theme.colors.onSurface, fontWeight: '600' }}>
                  {emp.name}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </Modal>
      </Portal>

      {/* Generated Report */}
      {generated && reportStats && (
        <View style={{ marginTop: 20 }}>
          {/* Summary Card */}
          <Surface style={[s.reportSummary, { backgroundColor: theme.colors.surface }]} elevation={2}>
            <View style={s.reportHeader}>
              <MaterialCommunityIcons name="file-chart" size={24} color={BRAND_COLOR} />
              <Text variant="titleMedium" style={{ color: theme.colors.onSurface, fontWeight: '700', flex: 1, textAlign: isRTL ? 'right' : 'left' }}>
                דוח נוכחות — {selectedName}
              </Text>
            </View>
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 16, textAlign: isRTL ? 'right' : 'left' }}>
              {dateFrom.toLocaleDateString('he-IL')} — {dateTo.toLocaleDateString('he-IL')}
            </Text>

            {/* Stats Grid */}
            <View style={s.reportGrid}>
              <View style={[s.reportStat, { backgroundColor: BRAND_COLOR + '10' }]}>
                <MaterialCommunityIcons name="clock-outline" size={22} color={BRAND_COLOR} />
                <Text variant="headlineSmall" style={{ color: BRAND_COLOR, fontWeight: '800' }}>
                  {formatHours(reportStats.totalHours)}
                </Text>
                <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>סה״כ שעות</Text>
              </View>
              <View style={[s.reportStat, { backgroundColor: CLOCK_COLOR + '10' }]}>
                <MaterialCommunityIcons name="calendar-check" size={22} color={CLOCK_COLOR} />
                <Text variant="headlineSmall" style={{ color: CLOCK_COLOR, fontWeight: '800' }}>
                  {reportStats.daysWorked}
                </Text>
                <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>ימי עבודה</Text>
              </View>
              <View style={[s.reportStat, { backgroundColor: '#FF980010' }]}>
                <MaterialCommunityIcons name="chart-line" size={22} color="#FF9800" />
                <Text variant="headlineSmall" style={{ color: '#FF9800', fontWeight: '800' }}>
                  {formatHours(reportStats.avgHoursPerDay)}
                </Text>
                <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>ממוצע יומי</Text>
              </View>
              <View style={[s.reportStat, { backgroundColor: '#9C27B010' }]}>
                <MaterialCommunityIcons name="trophy" size={22} color="#9C27B0" />
                <Text variant="headlineSmall" style={{ color: '#9C27B0', fontWeight: '800' }}>
                  {reportStats.maxDay ? formatHours(computeHours(reportStats.maxDay)) : '—'}
                </Text>
                <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>יום שיא</Text>
              </View>
            </View>

            {/* Extra insights */}
            <Divider style={{ marginVertical: 14 }} />
            <View style={{ gap: 8 }}>
              {reportStats.earlyIn?.clockIn && (
                <View style={s.insightRow}>
                  <MaterialCommunityIcons name="weather-sunset-up" size={16} color={CLOCK_COLOR} />
                  <Text variant="bodySmall" style={{ color: theme.colors.onSurface, flex: 1 }}>
                    כניסה מוקדמת ביותר: {formatTime(reportStats.earlyIn.clockIn)}
                  </Text>
                  <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                    {new Date(reportStats.earlyIn.date).toLocaleDateString('he-IL', { day: 'numeric', month: 'short' })}
                  </Text>
                </View>
              )}
              {reportStats.lateOut?.clockOut && (
                <View style={s.insightRow}>
                  <MaterialCommunityIcons name="weather-night" size={16} color="#9C27B0" />
                  <Text variant="bodySmall" style={{ color: theme.colors.onSurface, flex: 1 }}>
                    יציאה מאוחרת ביותר: {formatTime(reportStats.lateOut.clockOut)}
                  </Text>
                  <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                    {new Date(reportStats.lateOut.date).toLocaleDateString('he-IL', { day: 'numeric', month: 'short' })}
                  </Text>
                </View>
              )}
            </View>
          </Surface>

          {/* Hours calculation — tier breakdown (100% / 125% / 150%) + overtime.
              Shown to both admin and employee: hours only, no salary. */}
          <Surface style={[s.reportSummary, { backgroundColor: theme.colors.surface, marginTop: 16 }]} elevation={2}>
            <View style={s.reportHeader}>
              <MaterialCommunityIcons name="chart-timeline-variant" size={22} color={BRAND_COLOR} />
              <Text variant="titleMedium" style={{ color: theme.colors.onSurface, fontWeight: '700', flex: 1, textAlign: isRTL ? 'right' : 'left' }}>
                חישוב שעות
              </Text>
            </View>
            {(() => {
              const t100 = tierData.regularHours;
              const t125 = tierData.ot1Hours;
              const t150 = tierData.ot2Hours + tierData.weekendHours;
              const grand = t100 + t125 + t150 || 1;
              const rows = [
                { label: '100%', hint: 'רגילות', hours: t100, color: '#ec4899' },
                { label: `${tierData.r1Pct}%`, hint: 'תוספת', hours: t125, color: '#f59e0b' },
                { label: `${Math.max(tierData.r2Pct, tierData.weekendPct)}%`, hint: 'תוספת / שבת-חג', hours: t150, color: '#8b5cf6' },
              ];
              return rows.map((row) => (
                <View key={row.label} style={s.tierRow}>
                  <View style={s.tierLabelWrap}>
                    <View style={[s.tierDot, { backgroundColor: row.color }]} />
                    <Text style={{ color: theme.colors.onSurface, fontWeight: '700', fontSize: 13, width: 42 }}>{row.label}</Text>
                    <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 11 }} numberOfLines={1}>{row.hint}</Text>
                  </View>
                  <View style={[s.tierTrack, { backgroundColor: theme.colors.surfaceVariant }]}>
                    <View style={[s.tierFill, { backgroundColor: row.color, width: `${Math.min(100, (row.hours / grand) * 100)}%` }]} />
                  </View>
                  <Text style={{ color: theme.colors.onSurface, fontWeight: '700', fontSize: 13, width: 54, textAlign: 'left' }}>
                    {formatHours(row.hours)}
                  </Text>
                </View>
              ));
            })()}
            <Divider style={{ marginVertical: 12 }} />
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <View style={[s.reportStat, { backgroundColor: BRAND_COLOR + '10', flex: 1 }]}>
                <Text variant="headlineSmall" style={{ color: BRAND_COLOR, fontWeight: '800' }}>{formatHours(reportStats.totalHours)}</Text>
                <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>שעות נוכחות</Text>
              </View>
              <View style={[s.reportStat, { backgroundColor: '#8b5cf610', flex: 1 }]}>
                <Text variant="headlineSmall" style={{ color: '#8b5cf6', fontWeight: '800' }}>{formatHours(tierData.overtimeHours)}</Text>
                <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>שעות נוספות</Text>
              </View>
            </View>
          </Surface>

          {/* Daily Breakdown */}
          <Text variant="titleSmall" style={{ color: theme.colors.onSurface, fontWeight: '700', marginTop: 20, marginBottom: 10, textAlign: isRTL ? 'right' : 'left' }}>
            פירוט יומי
          </Text>
          {records.filter((r) => computeHours(r) > 0).map((rec, i) => {
            const tb = tierData.perRecord[recKey(rec)];
            const chips: { label: string; color: string; bg: string }[] = [];
            if (tb) {
              if (tb.regular > 0.001) chips.push({ label: `100% · ${formatHours(tb.regular)}`, color: '#be185d', bg: '#fce7f3' });
              if (tb.ot1 > 0.001)     chips.push({ label: `${tierData.r1Pct}% · ${formatHours(tb.ot1)}`, color: '#b45309', bg: '#fef3c7' });
              if (tb.ot2 > 0.001)     chips.push({ label: `${tierData.r2Pct}% · ${formatHours(tb.ot2)}`, color: '#6d28d9', bg: '#ede9fe' });
              if (tb.weekend > 0.001) chips.push({ label: `${tierData.weekendPct}% · ${formatHours(tb.weekend)}`, color: '#6d28d9', bg: '#ede9fe' });
            }
            const showChips = chips.length > 1; // only when a shift spans more than one tier
            return (
            <Surface key={rec.id || i} style={[s.recordCard, { backgroundColor: theme.colors.surface }]} elevation={1}>
              <View style={[s.recordRow, { flexDirection: 'row' }]}>
                <View style={{ flex: 1 }}>
                  <Text variant="labelMedium" style={{ color: theme.colors.onSurface, fontWeight: '700', textAlign: isRTL ? 'right' : 'left' }}>
                    {new Date(rec.date).toLocaleDateString('he-IL', { weekday: 'short', day: 'numeric', month: 'short' })}
                  </Text>
                  <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, textAlign: isRTL ? 'right' : 'left' }}>
                    {formatTime(rec.clockIn)} — {formatTime(rec.clockOut)}
                  </Text>
                </View>
                <Chip compact style={{ backgroundColor: BRAND_COLOR + '15' }}>
                  <Text style={{ color: BRAND_COLOR, fontWeight: '700', fontSize: 13 }}>
                    {formatHours(computeHours(rec))}
                  </Text>
                </Chip>
              </View>
              {showChips && (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                  {chips.map((c, ci) => (
                    <View key={ci} style={{ backgroundColor: c.bg, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }}>
                      <Text style={{ color: c.color, fontSize: 11, fontWeight: '700' }}>{c.label}</Text>
                    </View>
                  ))}
                </View>
              )}
            </Surface>
          );
          })}

          {records.filter((r) => computeHours(r) > 0).length === 0 && (
            <Text style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center', marginTop: 16 }}>
              אין נתונים בטווח שנבחר
            </Text>
          )}
        </View>
      )}

      {generated && !reportStats && (
        <View style={{ marginTop: 20, alignItems: 'center' }}>
          <MaterialCommunityIcons name="file-remove-outline" size={48} color={theme.colors.onSurfaceVariant + '50'} />
          <Text style={{ color: theme.colors.onSurfaceVariant, marginTop: 8 }}>אין נתונים בטווח שנבחר</Text>
        </View>
      )}
    </ScrollView>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────────
export default function EmployeesScreen() {
  const theme = useAppTheme();
  const { isRTL } = useRTL();
  const { t } = useTranslation();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const org = user?.organization || '';
  const userId = user?.id || user?.userId || '';
  const admin = isAdmin(user);

  const [tab, setTab] = useState<'my' | 'manage' | 'report'>('my');
  const userName = user?.fullname || user?.name || '';

  return (
    <View style={[s.container, { backgroundColor: theme.colors.background }]}>
      <Appbar.Header style={{ backgroundColor: BRAND_COLOR }} mode="center-aligned">
        <Appbar.BackAction onPress={() => router.back()} color="#FFF" />
        <Appbar.Content title={t('employees.title')} titleStyle={s.headerTitle} />
      </Appbar.Header>

      {/* Tabs */}
      <View style={s.tabsWrapper}>
        <SegmentedButtons
          value={tab}
          onValueChange={(v) => setTab(v as 'my' | 'manage' | 'report')}
          buttons={[
            { value: 'my', label: t('employees.myHours') },
            { value: 'report', label: 'דוח' },
            ...(admin ? [{ value: 'manage' as const, label: t('employees.manage') }] : []),
          ]}
          style={s.segmentedButtons}
          theme={{ colors: { secondaryContainer: BRAND_COLOR + '20', onSecondaryContainer: BRAND_COLOR } }}
        />
      </View>

      {tab === 'my' ? (
        <MyHoursTab org={org} userId={userId} />
      ) : tab === 'report' ? (
        <ReportTab org={org} userId={userId} userName={userName} />
      ) : (
        <ManageTab org={org} />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center', paddingTop: 60 },
  headerTitle: { color: '#FFF', fontWeight: '700', fontSize: 18 },
  tabsWrapper: { paddingVertical: 12, paddingHorizontal: 16, backgroundColor: 'transparent' },
  segmentedButtons: { width: '100%' },
  // Clock card
  clockCard: { borderRadius: 20, marginBottom: 20, overflow: 'hidden' },
  clockCardInner: { alignItems: 'center', padding: 32 },
  // Stats row (manage tab)
  statsRow: { padding: 12, gap: 10 },
  statCard: { flex: 1, borderRadius: 14, padding: 14, alignItems: 'center' },
  // Employee row
  empCard: { borderRadius: 14, marginHorizontal: 12, marginVertical: 5, overflow: 'hidden' },
  empRow: { padding: 14, alignItems: 'center', gap: 12 },
  empInfo: { flex: 1 },
  clockDot: { width: 10, height: 10, borderRadius: 5 },
  // Records
  recordCard: { borderRadius: 12, marginHorizontal: 0, marginVertical: 4, overflow: 'hidden' },
  recordRow: { padding: 12, alignItems: 'center', gap: 8 },
  recRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, borderBottomWidth: 1 },
  sectionTitle: { fontWeight: '700', marginTop: 20, marginBottom: 10 },
  // Modal
  modal: { margin: 16, borderRadius: 24, padding: 24, maxHeight: '85%' },
  modalHeader: { alignItems: 'center', marginBottom: 12 },
  empModalStats: { gap: 12, marginBottom: 4 },
  empModalStat: { flex: 1, alignItems: 'center', gap: 4 },
  // Report
  rangeChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  datePickerBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
  },
  empPickerItem: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginBottom: 4,
  },
  reportSummary: {
    borderRadius: 20,
    padding: 20,
    overflow: 'hidden' as const,
  },
  reportHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
    marginBottom: 6,
  },
  reportGrid: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 10,
  },
  reportStat: {
    width: '47%' as any,
    alignItems: 'center' as const,
    paddingVertical: 14,
    borderRadius: 14,
    gap: 4,
  },
  insightRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
  },
  tierRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
    marginBottom: 10,
  },
  tierLabelWrap: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    width: 130,
  },
  tierDot: { width: 10, height: 10, borderRadius: 5 },
  tierTrack: { flex: 1, height: 9, borderRadius: 999, overflow: 'hidden' as const },
  tierFill: { height: '100%' as any, borderRadius: 999 },
});
