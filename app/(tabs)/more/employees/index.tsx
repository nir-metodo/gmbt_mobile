import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View,
  FlatList,
  StyleSheet,
  RefreshControl,
  Pressable,
  ScrollView,
  Alert,
  Platform,
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
  IconButton,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
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

function formatTime(dt?: string) {
  if (!dt) return '—';
  return new Date(dt).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
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
  const ci = rec.clockIn ? new Date(rec.clockIn).getTime() : 0;
  const co = rec.clockOut ? new Date(rec.clockOut).getTime() : 0;
  if (ci && co && co > ci) return (co - ci) / 3600000;
  return 0;
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
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [clockInTime]);

  return elapsed;
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
  const liveElapsed = useLiveTimer(status?.isClockedIn ? status.clockInTime : undefined);

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
      const openRec = todayRecs.find((r: any) => r.clockOut === '' || r.clockOut == null);
      const totalHours = todayRecs.reduce((sum: number, r: any) => {
        const ci = r.clockIn || '';
        const co = r.clockOut || '';
        if (ci && co) {
          const diff = (new Date(co).getTime() - new Date(ci).getTime()) / 3600000;
          return sum + Math.max(0, diff);
        } else if (ci && !co) {
          const diff = (Date.now() - new Date(ci).getTime()) / 3600000;
          return sum + Math.max(0, diff);
        }
        return sum;
      }, 0);
      setStatus({
        isClockedIn: !!openRec,
        clockInTime: openRec?.clockIn || undefined,
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
      setRecords(Array.isArray(res.data) ? res.data : []);
    } catch { setRecords([]); } finally { setLoadingRecords(false); }
  }, [org, userId]);

  useEffect(() => { fetchStatus(); fetchMyRecords(); }, [fetchStatus, fetchMyRecords]);

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

  const handleClockInOut = async () => {
    setClocking(true);
    try {
      if (status?.isClockedIn) {
        await axiosInstance.post(ENDPOINTS.CLOCK_OUT, { organizationName: org });
      } else {
        await axiosInstance.post(ENDPOINTS.CLOCK_IN, { organizationName: org });
      }
      await fetchStatus();
      await fetchMyRecords();
    } catch (e: any) {
      Alert.alert(t('common.error'), e?.message || t('errors.generic'));
    } finally {
      setClocking(false);
    }
  };

  const currentHours = status?.isClockedIn ? liveElapsed : (status?.todayHours || 0);

  if (loading) return (
    <View style={[s.center, { flex: 1 }]}>
      <ActivityIndicator color={BRAND_COLOR} />
    </View>
  );

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
      {/* Clock Card */}
      <Surface style={[s.clockCard, { backgroundColor: theme.colors.surface }]} elevation={2}>
        <View style={s.clockCardInner}>
          <MaterialCommunityIcons
            name={status?.isClockedIn ? 'clock-time-four' : 'clock-outline'}
            size={48}
            color={status?.isClockedIn ? CLOCK_COLOR : theme.colors.onSurfaceVariant}
          />
          <Text variant="headlineMedium" style={{ color: theme.colors.onSurface, fontWeight: '800', marginTop: 8 }}>
            {formatHours(currentHours)}
          </Text>
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 4 }}>
            {t('employees.todayHours')}
          </Text>
          {status?.isClockedIn && status.clockInTime && (
            <Chip compact icon="login" style={{ backgroundColor: CLOCK_COLOR + '15', marginBottom: 12 }}>
              <Text style={{ color: CLOCK_COLOR, fontSize: 12, fontWeight: '600' }}>
                {t('employees.clockedInSince')} {formatTime(status.clockInTime)}
              </Text>
            </Chip>
          )}
          <Button
            mode="contained"
            onPress={handleClockInOut}
            loading={clocking}
            disabled={clocking}
            buttonColor={status?.isClockedIn ? WARN_COLOR : CLOCK_COLOR}
            style={{ borderRadius: 28, minWidth: 200, marginTop: 8 }}
            contentStyle={{ paddingVertical: 6 }}
            icon={status?.isClockedIn ? 'logout' : 'login'}
          >
            {status?.isClockedIn ? t('employees.clockOut') : t('employees.clockIn')}
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
        records.map((rec, i) => (
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
          </Surface>
        ))
      )}
    </ScrollView>
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
      setRecords(Array.isArray(res.data) ? res.data : []);
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
                    {formatHours(records.reduce((s, r) => s + (r.totalHours || 0), 0))}
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
                records.map((rec, i) => (
                  <View key={rec.id || i} style={[s.recRow, { flexDirection: 'row', borderColor: theme.colors.outlineVariant }]}>
                    <Text variant="bodySmall" style={{ flex: 1, color: theme.colors.onSurface, textAlign: isRTL ? 'right' : 'left' }}>
                      {new Date(rec.date).toLocaleDateString('he-IL', { weekday: 'short', day: 'numeric', month: 'short' })}
                    </Text>
                    <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                      {formatTime(rec.clockIn)} — {formatTime(rec.clockOut)}
                    </Text>
                    <Text variant="labelMedium" style={{ color: BRAND_COLOR, fontWeight: '700', minWidth: 40, textAlign: 'center' }}>
                      {formatHours(computeHours(rec))}
                    </Text>
                  </View>
                ))
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

  useEffect(() => {
    if (admin) {
      axiosInstance.post(ENDPOINTS.GET_EMPLOYEES_DASHBOARD, { organizationName: org })
        .then((res) => setEmployees(Array.isArray(res.data) ? res.data.map((e: any) => ({ id: e.id, name: e.name })) : []))
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
      setRecords(Array.isArray(res.data) ? res.data : []);
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
      const timeA = new Date(a.clockIn!).getHours() * 60 + new Date(a.clockIn!).getMinutes();
      const timeB = new Date(b.clockIn!).getHours() * 60 + new Date(b.clockIn!).getMinutes();
      return timeA - timeB;
    })[0];
    const lateOut = records.filter((r) => r.clockOut).sort((a, b) => {
      const timeA = new Date(a.clockOut!).getHours() * 60 + new Date(a.clockOut!).getMinutes();
      const timeB = new Date(b.clockOut!).getHours() * 60 + new Date(b.clockOut!).getMinutes();
      return timeB - timeA;
    })[0];

    return { totalHours, daysWorked, avgHoursPerDay, maxDay, minDay, earlyIn, lateOut };
  }, [records]);

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

      {showFromPicker && (
        <DateTimePicker
          value={dateFrom}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={(_: DateTimePickerEvent, d?: Date) => { setShowFromPicker(false); if (d) setDateFrom(d); }}
        />
      )}
      {showToPicker && (
        <DateTimePicker
          value={dateTo}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={(_: DateTimePickerEvent, d?: Date) => { setShowToPicker(false); if (d) setDateTo(d); }}
        />
      )}

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

          {/* Daily Breakdown */}
          <Text variant="titleSmall" style={{ color: theme.colors.onSurface, fontWeight: '700', marginTop: 20, marginBottom: 10, textAlign: isRTL ? 'right' : 'left' }}>
            פירוט יומי
          </Text>
          {records.filter((r) => computeHours(r) > 0).map((rec, i) => (
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
            </Surface>
          ))}

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
});
