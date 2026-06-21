import React, { useState, useCallback, useEffect } from 'react';
import { View, StyleSheet, ScrollView, Pressable, Image, Linking, ActivityIndicator, Platform } from 'react-native';
import type { MD3Theme } from 'react-native-paper';
import {
  Appbar,
  Surface,
  Text,
  Switch,
  Divider,
  Button,
  Portal,
  Dialog,
  List,
  RadioButton,
  Avatar,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { settingsApi } from '../../../../services/api/settings';
import { useAppTheme } from '../../../../hooks/useAppTheme';
import { useRTL } from '../../../../hooks/useRTL';
import { useAuthStore } from '../../../../stores/authStore';
import { hasPermission } from '../../../../constants/permissions';
import { useSettingsStore } from '../../../../stores/settingsStore';
import { getInitials } from '../../../../utils/formatters';
import { getCacheSize, clearCache, formatCacheSize } from '../../../../services/mediaCache';
import axiosInstance from '../../../../services/api/axiosInstance';
import { ENDPOINTS } from '../../../../constants/api';
import { enableDeviceCallEvents, disableDeviceCallEvents } from '../../../../services/deviceCallEvents';
import Constants from 'expo-constants';

const BRAND_COLOR = '#2e6155';

type ThemeMode = 'light' | 'dark' | 'system';

interface SettingRowProps {
  icon: string;
  iconColor: string;
  label: string;
  description?: string;
  isRTL: boolean;
  themeColors: MD3Theme['colors'];
  right?: React.ReactNode;
  onPress?: () => void;
}

function SettingRow({ icon, iconColor, label, description, isRTL, themeColors, right, onPress }: SettingRowProps) {
  const content = (
    <View style={[rs.row, { flexDirection: 'row' }]}>
      <View style={[rs.iconWrap, { backgroundColor: iconColor + '15' }]}>
        <MaterialCommunityIcons name={icon as any} size={20} color={iconColor} />
      </View>
      <View style={[rs.textWrap, { alignItems: 'flex-start' }]}>
        <Text variant="bodyLarge" style={{ color: themeColors.onSurface }}>
          {label}
        </Text>
        {description && (
          <Text variant="bodySmall" style={{ color: themeColors.onSurfaceVariant, marginTop: 2 }}>
            {description}
          </Text>
        )}
      </View>
      {right}
    </View>
  );

  if (onPress) {
    return <Pressable onPress={onPress}>{content}</Pressable>;
  }
  return content;
}

const rs = StyleSheet.create({
  row: { alignItems: 'center', paddingVertical: 12, paddingHorizontal: 16 },
  iconWrap: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  textWrap: { flex: 1, marginHorizontal: 12 },
});

export default function SettingsScreen() {
  const theme = useAppTheme();
  const { isRTL } = useRTL();
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const settings = useSettingsStore();

  const [logoutDialogVisible, setLogoutDialogVisible] = useState(false);
  const [languageDialogVisible, setLanguageDialogVisible] = useState(false);
  const [themeDialogVisible, setThemeDialogVisible] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [cacheSize, setCacheSize] = useState<string>('...');
  const [clearingCache, setClearingCache] = useState(false);
  const [clearCacheDialogVisible, setClearCacheDialogVisible] = useState(false);
  const [reminderViaEmail, setReminderViaEmail] = useState(true);
  const [reminderViaPush, setReminderViaPush] = useState(true);

  useEffect(() => {
    getCacheSize().then((bytes) => setCacheSize(formatCacheSize(bytes)));
  }, []);

  useEffect(() => {
    if (!user?.organization) return;
    (async () => {
      try {
        const res = await axiosInstance.post(ENDPOINTS.GET_TASK_REMINDER_DEFAULT_SETTING, { organization: user.organization });
        if (res.data?.Success && res.data.Data) {
          setReminderViaEmail(res.data.Data.taskReminderViaEmail !== false);
          setReminderViaPush(res.data.Data.taskReminderViaPush !== false);
        }
      } catch {}
    })();
  }, [user?.organization]);

  const handleClearCache = useCallback(async () => {
    setClearingCache(true);
    try {
      await clearCache();
      setCacheSize(formatCacheSize(0));
    } catch {}
    setClearingCache(false);
    setClearCacheDialogVisible(false);
  }, []);

  const currentLanguage = i18n.language?.startsWith('he') ? 'he' : 'en';
  const currentTheme = settings.theme || 'system';

  const handleLanguageChange = useCallback(async (lang: string) => {
    try {
      await settings.setLanguage(lang as 'en' | 'he');
      await settingsApi.updateSettings(user?.organization || '', { language: lang });
    } catch {
      // language update failed — settings already applied locally
    }
    setLanguageDialogVisible(false);
  }, [settings, user]);

  const handleThemeChange = useCallback(async (mode: string) => {
    try {
      await settings.setTheme(mode as 'light' | 'dark' | 'system');
      await settingsApi.updateSettings(user?.organization || '', { themeMode: mode });
    } catch {
      // theme update failed — settings already applied locally
    }
    setThemeDialogVisible(false);
  }, [settings, user]);

  const handleToggle = useCallback(async (key: string, value: boolean) => {
    try {
      if (key === 'callRecording') settings.setCallRecording(value);
      else if (key === 'reportDeviceCallEvents') {
        settings.setReportDeviceCallEvents(value);
        if (value) await enableDeviceCallEvents();
        else disableDeviceCallEvents();
        return;
      }
      else if (key === 'pushNotifications') settings.setPushNotifications(value);
      else if (key === 'messageNotifications') settings.setMessageNotifications(value);
      else if (key === 'callNotifications') settings.setCallNotifications(value);
      else settings.setNotificationPref(key, value);
      await settingsApi.updateSettings(user?.organization || '', { [key]: value });
    } catch {
      // setting update failed — toggle already applied locally
    }
  }, [settings, user]);

  const handleReminderToggle = useCallback(async (key: 'taskReminderViaEmail' | 'taskReminderViaPush', value: boolean) => {
    if (key === 'taskReminderViaEmail') setReminderViaEmail(value);
    else setReminderViaPush(value);
    try {
      await axiosInstance.post(ENDPOINTS.UPDATE_TASK_REMINDER_DEFAULT_SETTING, {
        organization: user?.organization,
        [key]: value,
      });
    } catch {}
  }, [user?.organization]);

  const handleLogout = useCallback(async () => {
    setLoggingOut(true);
    try {
      await logout();
      router.replace('/');
    } catch {
      // logout failed
    } finally {
      setLoggingOut(false);
      setLogoutDialogVisible(false);
    }
  }, [logout, router]);

  const appVersion = Constants.expoConfig?.version || '1.0.0';

  // Show only the setting groups relevant to this user's permissions. Generic groups
  // (language, theme, push management link, storage, account, about, logout) always stay.
  const hasTelephony = !!user?.hasItsOwnSim;
  const canTasks = hasPermission(user?.Permissions, user?.SecurityRole, 'tasks' as any);

  return (
    <View style={[s.container, { backgroundColor: theme.colors.background }]}>
      {/* Header */}
      <Appbar.Header style={{ backgroundColor: BRAND_COLOR }} mode="center-aligned">
        <Appbar.BackAction onPress={() => router.back()} color="#FFF" />
        <Appbar.Content title={t('settings.title')} titleStyle={s.headerTitle} />
      </Appbar.Header>

      <ScrollView contentContainerStyle={s.scrollContent}>
        {/* ────── General ────── */}
        <SectionHeader title={t('settings.general')} isRTL={isRTL} themeColors={theme.colors} />
        <Surface style={[s.section, { backgroundColor: theme.colors.surface }]} elevation={1}>
          <SettingRow
            icon="translate"
            iconColor={BRAND_COLOR}
            label={t('settings.language')}
            description={currentLanguage === 'he' ? 'עברית 🇮🇱' : 'English 🇺🇸'}
            isRTL={isRTL}
            themeColors={theme.colors}
            onPress={() => setLanguageDialogVisible(true)}
            right={<MaterialCommunityIcons name="chevron-right" size={22} color={theme.colors.onSurfaceVariant} style={{ transform: [{ scaleX: isRTL ? -1 : 1 }] }} />}
          />
          <Divider style={s.divider} />
          <SettingRow
            icon="theme-light-dark"
            iconColor="#7B2D8E"
            label={t('settings.theme')}
            description={t(`settings.theme_${currentTheme}`)}
            isRTL={isRTL}
            themeColors={theme.colors}
            onPress={() => setThemeDialogVisible(true)}
            right={<MaterialCommunityIcons name="chevron-right" size={22} color={theme.colors.onSurfaceVariant} style={{ transform: [{ scaleX: isRTL ? -1 : 1 }] }} />}
          />
        </Surface>

        {/* ────── Notifications ────── */}
        <SectionHeader title={t('settings.notifications')} isRTL={isRTL} themeColors={theme.colors} />
        <Surface style={[s.section, { backgroundColor: theme.colors.surface }]} elevation={1}>
          <SettingRow
            icon="bell-cog-outline"
            iconColor="#FF6B35"
            label={t('settings.managePushNotifications', isRTL ? 'ניהול התראות Push' : 'Manage Push Notifications')}
            description={isRTL ? 'בחר אילו התראות לקבל במכשיר זה' : 'Choose which alerts you receive on this device'}
            isRTL={isRTL}
            themeColors={theme.colors}
            onPress={() => router.push('/(tabs)/more/notifications' as any)}
            right={<MaterialCommunityIcons name="chevron-right" size={22} color={theme.colors.onSurfaceVariant} style={{ transform: [{ scaleX: isRTL ? -1 : 1 }] }} />}
          />
        </Surface>

        {/* ────── Task Reminders — Organization Policy ────── */}
        {canTasks && (
        <><SectionHeader title={t('settings.taskReminders', 'תזכורות משימות (ארגון)')} isRTL={isRTL} themeColors={theme.colors} />
        <Surface style={[s.section, { backgroundColor: theme.colors.surface }]} elevation={1}>
          <SettingRow
            icon="email-outline"
            iconColor="#2196F3"
            label={t('settings.reminderViaEmail', 'שלח תזכורת במייל')}
            description={t('settings.reminderViaEmailDesc', 'הגדרת ארגון: שליחת תזכורות משימות בדוא"ל לכל המשתמשים')}
            isRTL={isRTL}
            themeColors={theme.colors}
            right={<Switch value={reminderViaEmail} onValueChange={(v) => handleReminderToggle('taskReminderViaEmail', v)} color={BRAND_COLOR} />}
          />
          <Divider style={s.divider} />
          <SettingRow
            icon="cellphone-message"
            iconColor="#4CAF50"
            label={t('settings.reminderViaPush', 'שלח תזכורת באפליקציה')}
            description={t('settings.reminderViaPushDesc', 'הגדרת ארגון: כל משתמש יכול לכבות אצלו ב"ניהול התראות Push"')}
            isRTL={isRTL}
            themeColors={theme.colors}
            right={<Switch value={reminderViaPush} onValueChange={(v) => handleReminderToggle('taskReminderViaPush', v)} color={BRAND_COLOR} />}
          />
        </Surface></>
        )}

        {/* ────── Call Settings ────── */}
        {hasTelephony && (
        <><SectionHeader title={t('settings.callSettings')} isRTL={isRTL} themeColors={theme.colors} />
        <Surface style={[s.section, { backgroundColor: theme.colors.surface }]} elevation={1}>
          <SettingRow
            icon="record-circle-outline"
            iconColor="#E63946"
            label={t('settings.callRecording')}
            description={t('settings.callRecordingDesc')}
            isRTL={isRTL}
            themeColors={theme.colors}
            right={<Switch value={!!settings.callRecordingEnabled} onValueChange={(v) => handleToggle('callRecording', v)} color={BRAND_COLOR} />}
          />
          <Divider style={s.divider} />
          <SettingRow
            icon="timeline-text-outline"
            iconColor="#0ea5e9"
            label={t('settings.saveToTimeline')}
            description={t('settings.saveToTimelineDesc')}
            isRTL={isRTL}
            themeColors={theme.colors}
            right={<Switch value={!!settings.callSaveToTimelineEnabled} onValueChange={(v) => handleToggle('callSaveToTimeline', v)} color={BRAND_COLOR} />}
          />
          <Divider style={s.divider} />
          <SettingRow
            icon="text-box-outline"
            iconColor="#FF6B35"
            label={t('settings.callTranscription')}
            description={t('settings.callTranscriptionDesc')}
            isRTL={isRTL}
            themeColors={theme.colors}
            right={<Switch value={!!settings.callTranscriptionEnabled} onValueChange={(v) => handleToggle('callTranscription', v)} color={BRAND_COLOR} />}
          />
          <Divider style={s.divider} />
          <SettingRow
            icon="brain"
            iconColor="#7B2D8E"
            label={t('settings.callAiSummary')}
            description={t('settings.callAiSummaryDesc')}
            isRTL={isRTL}
            themeColors={theme.colors}
            right={<Switch value={!!settings.callAiSummaryEnabled} onValueChange={(v) => handleToggle('callAiSummary', v)} color={BRAND_COLOR} />}
          />
          <Divider style={s.divider} />
          <SettingRow
            icon="auto-fix"
            iconColor={BRAND_COLOR}
            label={t('settings.callRules')}
            description={t('settings.callRulesDesc')}
            isRTL={isRTL}
            themeColors={theme.colors}
            onPress={() => router.push('/(tabs)/phone-calls' as any)}
            right={<MaterialCommunityIcons name="chevron-right" size={22} color={theme.colors.onSurfaceVariant} style={{ transform: [{ scaleX: isRTL ? -1 : 1 }] }} />}
          />
        </Surface></>
        )}

        {/* ────── Device Call Automation (Android only) ────── */}
        {Platform.OS === 'android' && (
        <><SectionHeader title={t('settings.deviceCallAutomation', 'Call2Chat — שיחות מהמכשיר')} isRTL={isRTL} themeColors={theme.colors} />
        <Surface style={[s.section, { backgroundColor: theme.colors.surface }]} elevation={1}>
          <SettingRow
            icon="phone-sync-outline"
            iconColor="#4CAF50"
            label={t('settings.reportDeviceCallEvents', 'הפעל Call2Chat (דיווח שיחות מהמכשיר)')}
            description={t('settings.reportDeviceCallEventsDesc', 'מפעיל בוטומיישן משיחות בטלפון האישי שלך: "נכנסת" ברגע הצלצול, "לא נענתה"/"הסתיימה" בסיום השיחה. שונה מפתרון השיחות במספר וירטואלי (Call Flow). דורש הרשאת טלפון/יומן שיחות. אנדרואיד בלבד.')}
            isRTL={isRTL}
            themeColors={theme.colors}
            right={<Switch value={!!settings.reportDeviceCallEventsEnabled} onValueChange={(v) => handleToggle('reportDeviceCallEvents', v)} color={BRAND_COLOR} />}
          />
        </Surface></>
        )}

        {/* ────── Storage ────── */}
        <SectionHeader title={t('settings.storage', 'אחסון')} isRTL={isRTL} themeColors={theme.colors} />
        <Surface style={[s.section, { backgroundColor: theme.colors.surface }]} elevation={1}>
          <SettingRow
            icon="database-outline"
            iconColor="#0ea5e9"
            label={t('settings.mediaCacheSize', 'גודל מטמון מדיה')}
            description={cacheSize}
            isRTL={isRTL}
            themeColors={theme.colors}
          />
          <Divider style={s.divider} />
          <SettingRow
            icon="delete-sweep-outline"
            iconColor="#E63946"
            label={t('settings.clearMediaCache', 'נקה מטמון מדיה')}
            description={t('settings.clearMediaCacheDesc', 'מחק את כל קבצי המדיה השמורים במכשיר')}
            isRTL={isRTL}
            themeColors={theme.colors}
            onPress={() => setClearCacheDialogVisible(true)}
            right={clearingCache
              ? <ActivityIndicator size="small" color={BRAND_COLOR} />
              : <MaterialCommunityIcons name="chevron-right" size={22} color={theme.colors.onSurfaceVariant} style={{ transform: [{ scaleX: isRTL ? -1 : 1 }] }} />
            }
          />
        </Surface>

        {/* ────── Account ────── */}
        <SectionHeader title={t('settings.account')} isRTL={isRTL} themeColors={theme.colors} />
        <Surface style={[s.section, { backgroundColor: theme.colors.surface }]} elevation={1}>
          <View style={[s.accountCard, { flexDirection: 'row' }]}>
            {user?.photoURL ? (
              <Avatar.Image size={52} source={{ uri: user.photoURL }} />
            ) : (
              <Avatar.Text
                size={52}
                label={getInitials(user?.fullname || '')}
                style={{ backgroundColor: BRAND_COLOR + '20' }}
                labelStyle={{ color: BRAND_COLOR, fontWeight: '700' }}
              />
            )}
            <View style={[s.accountInfo, { alignItems: 'flex-start' }]}>
              <Text variant="titleMedium" style={{ color: theme.colors.onSurface, fontWeight: '700' }}>
                {user?.fullname}
              </Text>
              <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                {user?.email}
              </Text>
              {user?.organization && (
                <View style={[s.orgRow, { flexDirection: 'row' }]}>
                  <MaterialCommunityIcons name="domain" size={14} color={theme.colors.onSurfaceVariant} />
                  <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginHorizontal: 4 }}>
                    {user.organization}
                  </Text>
                </View>
              )}
            </View>
          </View>
        </Surface>

        {/* ────── About ────── */}
        <SectionHeader title={t('settings.about')} isRTL={isRTL} themeColors={theme.colors} />
        <Surface style={[s.section, { backgroundColor: theme.colors.surface }]} elevation={1}>
          <SettingRow
            icon="information-outline"
            iconColor="#6C757D"
            label={t('settings.appVersion')}
            description={`v${appVersion}`}
            isRTL={isRTL}
            themeColors={theme.colors}
          />
          <Divider style={s.divider} />
          <SettingRow
            icon="shield-lock-outline"
            iconColor="#6C757D"
            label={t('settings.privacyPolicy')}
            isRTL={isRTL}
            themeColors={theme.colors}
            onPress={() => Linking.openURL('https://gambot.co.il/privacy/en')}
            right={<MaterialCommunityIcons name="open-in-new" size={18} color={theme.colors.onSurfaceVariant} />}
          />
          <Divider style={s.divider} />
          <SettingRow
            icon="headset"
            iconColor={BRAND_COLOR}
            label={t('settings.contactSupport')}
            isRTL={isRTL}
            themeColors={theme.colors}
            onPress={() => Linking.openURL('mailto:support@gambot.co.il')}
            right={<MaterialCommunityIcons name="open-in-new" size={18} color={theme.colors.onSurfaceVariant} />}
          />
        </Surface>

        {/* ────── Logout ────── */}
        <View style={s.logoutSection}>
          <Button
            mode="contained"
            onPress={() => setLogoutDialogVisible(true)}
            icon="logout"
            buttonColor="#E6394615"
            textColor="#E63946"
            style={s.logoutBtn}
            contentStyle={s.logoutBtnContent}
            labelStyle={{ fontWeight: '700' }}
          >
            {t('settings.logout')}
          </Button>
        </View>
      </ScrollView>

      {/* ── Language Dialog ── */}
      <Portal>
        <Dialog visible={languageDialogVisible} onDismiss={() => setLanguageDialogVisible(false)} style={{ borderRadius: 20 }}>
          <Dialog.Title>{t('settings.selectLanguage')}</Dialog.Title>
          <Dialog.Content>
            <RadioButton.Group value={currentLanguage} onValueChange={handleLanguageChange}>
              <Pressable onPress={() => handleLanguageChange('he')} style={[s.langRow, { flexDirection: 'row' }]}>
                <Text style={s.langFlag}>🇮🇱</Text>
                <Text variant="bodyLarge" style={{ flex: 1, color: theme.colors.onSurface, textAlign: isRTL ? 'right' : 'left' }}>
                  עברית
                </Text>
                <RadioButton value="he" color={BRAND_COLOR} />
              </Pressable>
              <Pressable onPress={() => handleLanguageChange('en')} style={[s.langRow, { flexDirection: 'row' }]}>
                <Text style={s.langFlag}>🇺🇸</Text>
                <Text variant="bodyLarge" style={{ flex: 1, color: theme.colors.onSurface, textAlign: isRTL ? 'right' : 'left' }}>
                  English
                </Text>
                <RadioButton value="en" color={BRAND_COLOR} />
              </Pressable>
            </RadioButton.Group>
          </Dialog.Content>
        </Dialog>
      </Portal>

      {/* ── Theme Dialog ── */}
      <Portal>
        <Dialog visible={themeDialogVisible} onDismiss={() => setThemeDialogVisible(false)} style={{ borderRadius: 20 }}>
          <Dialog.Title>{t('settings.selectTheme')}</Dialog.Title>
          <Dialog.Content>
            <RadioButton.Group value={currentTheme} onValueChange={(v) => handleThemeChange(v as ThemeMode)}>
              {([
                { value: 'light', icon: 'white-balance-sunny', label: t('settings.theme_light') },
                { value: 'dark', icon: 'moon-waning-crescent', label: t('settings.theme_dark') },
                { value: 'system', icon: 'cellphone', label: t('settings.theme_system') },
              ] as const).map((opt) => (
                <Pressable key={opt.value} onPress={() => handleThemeChange(opt.value)} style={[s.themeRow, { flexDirection: 'row' }]}>
                  <MaterialCommunityIcons name={opt.icon} size={22} color={theme.colors.onSurface} />
                  <Text variant="bodyLarge" style={{ flex: 1, color: theme.colors.onSurface, marginHorizontal: 12, textAlign: isRTL ? 'right' : 'left' }}>
                    {opt.label}
                  </Text>
                  <RadioButton value={opt.value} color={BRAND_COLOR} />
                </Pressable>
              ))}
            </RadioButton.Group>
          </Dialog.Content>
        </Dialog>
      </Portal>

      {/* ── Clear Cache Confirmation Dialog ── */}
      <Portal>
        <Dialog visible={clearCacheDialogVisible} onDismiss={() => setClearCacheDialogVisible(false)} style={{ borderRadius: 20 }}>
          <Dialog.Icon icon="delete-sweep-outline" color="#E63946" size={40} />
          <Dialog.Title style={{ textAlign: 'center' }}>{t('settings.clearCacheTitle', 'ניקוי מטמון מדיה')}</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium" style={{ textAlign: 'center', color: theme.colors.onSurfaceVariant }}>
              {t('settings.clearCacheMessage', 'פעולה זו תמחק את כל קבצי המדיה השמורים במכשיר. קבצים יורדו מחדש לפי הצורך.')}
            </Text>
          </Dialog.Content>
          <Dialog.Actions style={{ justifyContent: 'center', gap: 12 }}>
            <Button onPress={() => setClearCacheDialogVisible(false)} textColor={theme.colors.onSurfaceVariant}>
              {t('settings.cancel')}
            </Button>
            <Button onPress={handleClearCache} loading={clearingCache} textColor="#E63946" mode="contained" buttonColor="#E6394615">
              {t('settings.clearCache', 'נקה')}
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      {/* ── Logout Confirmation Dialog ── */}
      <Portal>
        <Dialog visible={logoutDialogVisible} onDismiss={() => setLogoutDialogVisible(false)} style={{ borderRadius: 20 }}>
          <Dialog.Icon icon="logout" color="#E63946" size={40} />
          <Dialog.Title style={{ textAlign: 'center' }}>{t('settings.logoutConfirmTitle')}</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium" style={{ textAlign: 'center', color: theme.colors.onSurfaceVariant }}>
              {t('settings.logoutConfirmMessage')}
            </Text>
          </Dialog.Content>
          <Dialog.Actions style={{ justifyContent: 'center', gap: 12 }}>
            <Button onPress={() => setLogoutDialogVisible(false)} textColor={theme.colors.onSurfaceVariant}>
              {t('settings.cancel')}
            </Button>
            <Button onPress={handleLogout} loading={loggingOut} textColor="#E63946" mode="contained" buttonColor="#E6394615">
              {t('settings.logout')}
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </View>
  );
}

// ─── Section Header ───────────────────────────────────────────────────

function SectionHeader({ title, isRTL, themeColors }: { title: string; isRTL: boolean; themeColors: MD3Theme['colors'] }) {
  return (
    <Text
      variant="labelLarge"
      style={[s.sectionTitle, { color: themeColors.onSurfaceVariant, textAlign: isRTL ? 'right' : 'left' }]}
    >
      {title}
    </Text>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: { flex: 1 },
  headerTitle: { color: '#FFF', fontWeight: '700', fontSize: 18 },
  scrollContent: { paddingBottom: 40 },
  sectionTitle: {
    fontWeight: '700',
    textTransform: 'uppercase',
    fontSize: 12,
    letterSpacing: 0.5,
    marginHorizontal: 20,
    marginTop: 24,
    marginBottom: 8,
  },
  section: { borderRadius: 16, marginHorizontal: 16, overflow: 'hidden' },
  divider: { marginHorizontal: 16 },
  accountCard: { alignItems: 'center', padding: 16 },
  accountInfo: { flex: 1, marginHorizontal: 12 },
  orgRow: { alignItems: 'center', marginTop: 4, gap: 2 },
  logoWrap: { alignItems: 'center', paddingBottom: 16 },
  companyLogo: { width: 120, height: 40 },
  logoutSection: { marginTop: 32, marginHorizontal: 16 },
  logoutBtn: { borderRadius: 14 },
  logoutBtnContent: { paddingVertical: 6 },
  langRow: { alignItems: 'center', paddingVertical: 8, gap: 8 },
  langFlag: { fontSize: 24 },
  themeRow: { alignItems: 'center', paddingVertical: 10, gap: 4 },
});
