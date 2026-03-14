import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  FlatList,
  StyleSheet,
  RefreshControl,
  Pressable,
  ScrollView,
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
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
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

function formatHours(h: number) {
  const hrs = Math.floor(h);
  const mins = Math.round((h - hrs) * 60);
  return `${hrs}:${mins.toString().padStart(2, '0')}`;
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
      const res = await axiosInstance.post(ENDPOINTS.GET_MY_CLOCK_STATUS, { organizationName: org });
      setStatus(res.data);
    } catch { setStatus(null); } finally { setLoading(false); }
  }, [org]);

  const fetchMyRecords = useCallback(async () => {
    setLoadingRecords(true);
    try {
      const now = new Date();
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
      const lastDay  = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
      const res = await axiosInstance.post(ENDPOINTS.GET_ATTENDANCE_RECORDS, {
        organizationName: org, employeeId: userId, dateFrom: firstDay, dateTo: lastDay,
      });
      setRecords(Array.isArray(res.data) ? res.data : []);
    } catch { setRecords([]); } finally { setLoadingRecords(false); }
  }, [org, userId]);

  useEffect(() => { fetchStatus(); fetchMyRecords(); }, [fetchStatus, fetchMyRecords]);

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
    } catch (e) { console.error(e); } finally { setClocking(false); }
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
            <View style={[s.recordRow, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
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
                  {formatHours(rec.totalHours)}
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
  const [selected, setSelected]   = useState<Employee | null>(null);
  const [records, setRecords]     = useState<AttendanceRecord[]>([]);
  const [loadingRec, setLoadingRec] = useState(false);

  const fetchEmployees = useCallback(async () => {
    try {
      const res = await axiosInstance.post(ENDPOINTS.GET_EMPLOYEES_DASHBOARD, { organizationName: org });
      setEmployees(Array.isArray(res.data) ? res.data : []);
    } catch { setEmployees([]); } finally { setLoading(false); setRefreshing(false); }
  }, [org]);

  useEffect(() => { fetchEmployees(); }, [fetchEmployees]);

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
      {/* Stats row */}
      <View style={[s.statsRow, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
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
            <Pressable onPress={() => openEmployee(item)} style={[s.empRow, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
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
              <View style={[s.empInfo, { alignItems: isRTL ? 'flex-end' : 'flex-start' }]}>
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
              <View style={[s.modalHeader, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
                <Text variant="titleLarge" style={{ flex: 1, color: theme.colors.onSurface, fontWeight: '700', textAlign: isRTL ? 'right' : 'left' }}>
                  {selected.name}
                </Text>
                <IconButton icon="close" onPress={() => { setSelected(null); setRecords([]); }} />
              </View>

              <View style={[s.empModalStats, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
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
                  <View key={rec.id || i} style={[s.recRow, { flexDirection: isRTL ? 'row-reverse' : 'row', borderColor: theme.colors.outlineVariant }]}>
                    <Text variant="bodySmall" style={{ flex: 1, color: theme.colors.onSurface, textAlign: isRTL ? 'right' : 'left' }}>
                      {new Date(rec.date).toLocaleDateString('he-IL', { weekday: 'short', day: 'numeric', month: 'short' })}
                    </Text>
                    <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                      {formatTime(rec.clockIn)} — {formatTime(rec.clockOut)}
                    </Text>
                    <Text variant="labelMedium" style={{ color: BRAND_COLOR, fontWeight: '700', minWidth: 40, textAlign: 'center' }}>
                      {formatHours(rec.totalHours)}
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

  const [tab, setTab] = useState<'my' | 'manage'>('my');

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
          onValueChange={(v) => setTab(v as 'my' | 'manage')}
          buttons={[
            { value: 'my', label: t('employees.myHours'), icon: 'clock-outline' },
            ...(admin ? [{ value: 'manage' as const, label: t('employees.manage'), icon: 'account-group-outline' }] : []),
          ]}
          style={{ marginHorizontal: 16 }}
          theme={{ colors: { secondaryContainer: BRAND_COLOR + '20', onSecondaryContainer: BRAND_COLOR } }}
        />
      </View>

      {tab === 'my' ? (
        <MyHoursTab org={org} userId={userId} />
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
  tabsWrapper: { paddingVertical: 12, backgroundColor: 'transparent' },
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
});
