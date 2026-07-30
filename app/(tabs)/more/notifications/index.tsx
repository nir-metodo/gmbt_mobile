import React, { useState, useCallback, useEffect } from 'react';
import { View, StyleSheet, ScrollView, Linking, AppState } from 'react-native';
import type { MD3Theme } from 'react-native-paper';
import {
  Appbar,
  Surface,
  Text,
  Switch,
  Divider,
  ActivityIndicator,
  Button,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../../../hooks/useAppTheme';
import { useRTL } from '../../../../hooks/useRTL';
import { useAuthStore } from '../../../../stores/authStore';
import { hasPermission } from '../../../../constants/permissions';
import {
  pushNotificationService,
  DEFAULT_PUSH_SETTINGS,
  type PushNotificationSettings,
  type PushPermissionState,
} from '../../../../services/pushNotifications';

const BRAND_COLOR = '#2e6155';

interface SettingRowProps {
  icon: string;
  iconColor: string;
  label: string;
  description?: string;
  isRTL: boolean;
  themeColors: MD3Theme['colors'];
  value: boolean;
  onToggle: (value: boolean) => void;
  disabled?: boolean;
}

function SettingRow({
  icon,
  iconColor,
  label,
  description,
  isRTL,
  themeColors,
  value,
  onToggle,
  disabled,
}: SettingRowProps) {
  return (
    <View style={[styles.row, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
      <View style={[styles.iconWrap, { backgroundColor: iconColor + '15' }]}>
        <MaterialCommunityIcons name={icon as any} size={20} color={iconColor} />
      </View>
      <View style={[styles.textWrap, { alignItems: isRTL ? 'flex-end' : 'flex-start' }]}>
        <Text variant="bodyLarge" style={{ color: themeColors.onSurface }}>
          {label}
        </Text>
        {description && (
          <Text variant="bodySmall" style={{ color: themeColors.onSurfaceVariant, marginTop: 2 }}>
            {description}
          </Text>
        )}
      </View>
      <Switch
        value={value}
        onValueChange={onToggle}
        color={BRAND_COLOR}
        disabled={disabled}
      />
    </View>
  );
}

function SectionHeader({ title, isRTL, themeColors }: { title: string; isRTL: boolean; themeColors: MD3Theme['colors'] }) {
  return (
    <Text
      variant="labelLarge"
      style={[styles.sectionTitle, { color: themeColors.onSurfaceVariant, textAlign: isRTL ? 'right' : 'left' }]}
    >
      {title}
    </Text>
  );
}

export default function NotificationsSettingsScreen() {
  const theme = useAppTheme();
  const { isRTL } = useRTL();
  const { t } = useTranslation();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);

  const [settings, setSettings] = useState<PushNotificationSettings>(DEFAULT_PUSH_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [permState, setPermState] = useState<PushPermissionState | null>(null);
  const [requesting, setRequesting] = useState(false);

  useEffect(() => {
    if (!user) return;
    pushNotificationService
      .getPushSettings(user.organization, user.userId)
      .then((s) => setSettings(s))
      .finally(() => setLoading(false));
  }, [user]);

  // Refresh the OS permission status. If it's granted, make sure the push token is registered —
  // this is the recovery path for users who denied at login and later enabled in device settings.
  const refreshPermission = useCallback(async () => {
    const state = await pushNotificationService.getPermissionState();
    setPermState(state);
    if (state.status === 'granted' && user) {
      pushNotificationService.registerPushToken(user.organization, user.userId).catch(() => {});
    }
  }, [user]);

  // Re-check whenever the screen is focused (e.g. returning from the OS Settings app).
  useFocusEffect(
    useCallback(() => {
      refreshPermission();
    }, [refreshPermission])
  );

  // Re-check when the app comes back to the foreground.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') refreshPermission();
    });
    return () => sub.remove();
  }, [refreshPermission]);

  const handleEnablePush = useCallback(async () => {
    if (!permState) return;
    // If the OS will still show the dialog, ask in-app. Otherwise deep-link to system settings.
    if (permState.status !== 'granted' && permState.canAskAgain) {
      setRequesting(true);
      try {
        const status = await pushNotificationService.requestPermission();
        if (status === 'granted' && user) {
          await pushNotificationService.registerPushToken(user.organization, user.userId).catch(() => {});
        }
        await refreshPermission();
      } finally {
        setRequesting(false);
      }
    } else {
      Linking.openSettings().catch(() => {});
    }
  }, [permState, user, refreshPermission]);

  const handleToggle = useCallback(
    async (key: keyof PushNotificationSettings, value: boolean) => {
      if (!user) return;
      const prev = settings[key];
      setSettings((s) => ({ ...s, [key]: value }));
      setSaving(key);
      try {
        await pushNotificationService.updatePushSettings(user.organization, user.userId, {
          [key]: value,
        });
      } catch {
        setSettings((s) => ({ ...s, [key]: prev }));
      } finally {
        setSaving(null);
      }
    },
    [user, settings]
  );

  if (loading) {
    return (
      <View style={[styles.container, styles.center, { backgroundColor: theme.colors.background }]}>
        <Appbar.Header style={{ backgroundColor: BRAND_COLOR }} mode="center-aligned">
          <Appbar.BackAction onPress={() => router.back()} color="#FFF" />
          <Appbar.Content title={t('pushSettings.title')} titleStyle={styles.headerTitle} />
        </Appbar.Header>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={BRAND_COLOR} />
        </View>
      </View>
    );
  }

  const hasTelephony = !!user?.hasItsOwnSim;

  // Only surface notification settings the user can actually act on. If a user has no
  // visibility into a feature (e.g. can't see chats/messages), the matching push section
  // is irrelevant to them and is hidden. The screen itself stays reachable so the user
  // can always manage the settings that DO apply to them.
  const canChats = hasPermission(user?.Permissions, user?.SecurityRole, 'chats' as any);
  const canLeads = hasPermission(user?.Permissions, user?.SecurityRole, 'leads' as any);
  const canCases = hasPermission(user?.Permissions, user?.SecurityRole, 'cases' as any);
  const canOrders =
    hasPermission(user?.Permissions, user?.SecurityRole, 'orders' as any) ||
    hasPermission(user?.Permissions, user?.SecurityRole, 'quotes' as any);
  const canTasks = hasPermission(user?.Permissions, user?.SecurityRole, 'tasks' as any);
  const canGambotAI = hasPermission(user?.Permissions, user?.SecurityRole, 'gambotAI' as any);

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Appbar.Header style={{ backgroundColor: BRAND_COLOR }} mode="center-aligned">
        <Appbar.BackAction onPress={() => router.back()} color="#FFF" />
        <Appbar.Content title={t('pushSettings.title')} titleStyle={styles.headerTitle} />
      </Appbar.Header>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* OS permission status — lets users who denied at login enable notifications later. */}
        {permState && permState.status !== 'unsupported' && (() => {
          const granted = permState.status === 'granted';
          const accent = granted ? '#16a34a' : '#dc2626';
          const title = granted
            ? (isRTL ? 'ההתראות מופעלות' : 'Notifications are on')
            : (isRTL ? 'ההתראות כבויות' : 'Notifications are off');
          const desc = granted
            ? (isRTL ? 'המכשיר שלך מקבל התראות מהמערכת.' : 'Your device is receiving push notifications.')
            : (permState.canAskAgain
                ? (isRTL ? 'אשר קבלת התראות כדי לא לפספס הודעות, לידים ומשימות.' : 'Allow notifications so you don\'t miss messages, leads and tasks.')
                : (isRTL ? 'ההתראות חסומות בהגדרות המכשיר. פתח את ההגדרות כדי להפעיל.' : 'Notifications are blocked in device settings. Open settings to enable.'));
          const btnLabel = permState.canAskAgain
            ? (isRTL ? 'אפשר התראות' : 'Allow notifications')
            : (isRTL ? 'פתח הגדרות' : 'Open settings');
          return (
            <Surface style={[styles.section, styles.permCard, { backgroundColor: theme.colors.surface, borderColor: accent + '33' }]} elevation={1}>
              <View style={[styles.permRow, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
                <View style={[styles.iconWrap, { backgroundColor: accent + '15' }]}>
                  <MaterialCommunityIcons name={granted ? 'bell-check-outline' : 'bell-off-outline'} size={22} color={accent} />
                </View>
                <View style={[styles.textWrap, { alignItems: isRTL ? 'flex-end' : 'flex-start' }]}>
                  <Text variant="bodyLarge" style={{ color: theme.colors.onSurface, fontWeight: '700' }}>
                    {title}
                  </Text>
                  <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: 2, textAlign: isRTL ? 'right' : 'left' }}>
                    {desc}
                  </Text>
                </View>
              </View>
              {!granted && (
                <Button
                  mode="contained"
                  onPress={handleEnablePush}
                  loading={requesting}
                  disabled={requesting}
                  buttonColor={BRAND_COLOR}
                  textColor="#fff"
                  style={styles.permButton}
                  icon={permState.canAskAgain ? 'bell-ring-outline' : 'cog-outline'}
                >
                  {btnLabel}
                </Button>
              )}
            </Surface>
          );
        })()}

        {/* Messages */}
        {canChats && (
        <><SectionHeader title={t('pushSettings.messagesSection')} isRTL={isRTL} themeColors={theme.colors} />
        <Surface style={[styles.section, { backgroundColor: theme.colors.surface }]} elevation={1}>
          <SettingRow
            icon="message-text-outline"
            iconColor="#2A9D8F"
            label={t('pushSettings.incomingMessages')}
            description={t('pushSettings.incomingMessagesDesc')}
            isRTL={isRTL}
            themeColors={theme.colors}
            value={settings.incomingMessages}
            onToggle={(v) => handleToggle('incomingMessages', v)}
            disabled={saving === 'incomingMessages'}
          />
          {settings.incomingMessages && (
            <>
              <Divider style={styles.divider} />
              <SettingRow
                icon="account-filter-outline"
                iconColor="#2A9D8F"
                label={t('pushSettings.onlyMyContacts', 'רק אנשי קשר שלי')}
                description={t('pushSettings.onlyMyContactsDesc', 'קבל התראות רק על הודעות מאנשי קשר שאני הבעלים שלהם')}
                isRTL={isRTL}
                themeColors={theme.colors}
                value={settings.messagesOnlyMyContacts}
                onToggle={(v) => handleToggle('messagesOnlyMyContacts', v)}
                disabled={saving === 'messagesOnlyMyContacts'}
              />
            </>
          )}
          <Divider style={styles.divider} />
          <SettingRow
            icon="account-arrow-right-outline"
            iconColor="#2A9D8F"
            label={t('pushSettings.contactAssignedToMe', 'איש קשר שויך אליי')}
            description={t('pushSettings.contactAssignedToMeDesc', 'קבל התראה כשמשייכים אליך איש קשר')}
            isRTL={isRTL}
            themeColors={theme.colors}
            value={settings.contactAssignedToMe}
            onToggle={(v) => handleToggle('contactAssignedToMe', v)}
            disabled={saving === 'contactAssignedToMe'}
          />
          <Divider style={styles.divider} />
          <SettingRow
            icon="at"
            iconColor="#2A9D8F"
            label={t('pushSettings.internalMessage', 'הודעה פנימית / אזכור')}
            description={t('pushSettings.internalMessageDesc', 'קבל התראה כשמזכירים אותך (@) בהודעה פנימית')}
            isRTL={isRTL}
            themeColors={theme.colors}
            value={settings.internalMessage}
            onToggle={(v) => handleToggle('internalMessage', v)}
            disabled={saving === 'internalMessage'}
          />
        </Surface></>
        )}

        {/* Leads */}
        {canLeads && (
        <><SectionHeader title={t('pushSettings.leadsSection')} isRTL={isRTL} themeColors={theme.colors} />
        <Surface style={[styles.section, { backgroundColor: theme.colors.surface }]} elevation={1}>
          <SettingRow
            icon="account-plus-outline"
            iconColor="#FF9800"
            label={t('pushSettings.newLeadCreated')}
            description={t('pushSettings.newLeadCreatedDesc')}
            isRTL={isRTL}
            themeColors={theme.colors}
            value={settings.newLeadCreated}
            onToggle={(v) => handleToggle('newLeadCreated', v)}
            disabled={saving === 'newLeadCreated'}
          />
          <Divider style={styles.divider} />
          <SettingRow
            icon="account-arrow-right-outline"
            iconColor="#E67E22"
            label={t('pushSettings.leadAssignedToMe')}
            description={t('pushSettings.leadAssignedToMeDesc')}
            isRTL={isRTL}
            themeColors={theme.colors}
            value={settings.leadAssignedToMe}
            onToggle={(v) => handleToggle('leadAssignedToMe', v)}
            disabled={saving === 'leadAssignedToMe'}
          />
          <Divider style={styles.divider} />
          <SettingRow
            icon="account-filter-outline"
            iconColor="#FF9800"
            label={t('pushSettings.onlyMyLeads', 'רק לידים שלי')}
            description={t('pushSettings.onlyMyLeadsDesc', 'קבל התראות רק על לידים שאני הבעלים שלהם')}
            isRTL={isRTL}
            themeColors={theme.colors}
            value={settings.leadsOnlyMyLeads}
            onToggle={(v) => handleToggle('leadsOnlyMyLeads', v)}
            disabled={saving === 'leadsOnlyMyLeads'}
          />
        </Surface></>
        )}

        {/* Cases */}
        {canCases && (
        <><SectionHeader title={t('pushSettings.casesSection')} isRTL={isRTL} themeColors={theme.colors} />
        <Surface style={[styles.section, { backgroundColor: theme.colors.surface }]} elevation={1}>
          <SettingRow
            icon="briefcase-plus-outline"
            iconColor="#FF6B35"
            label={t('pushSettings.newCaseCreated')}
            description={t('pushSettings.newCaseCreatedDesc')}
            isRTL={isRTL}
            themeColors={theme.colors}
            value={settings.newCaseCreated}
            onToggle={(v) => handleToggle('newCaseCreated', v)}
            disabled={saving === 'newCaseCreated'}
          />
          <Divider style={styles.divider} />
          <SettingRow
            icon="briefcase-arrow-right-outline"
            iconColor="#E63946"
            label={t('pushSettings.caseAssignedToMe')}
            description={t('pushSettings.caseAssignedToMeDesc')}
            isRTL={isRTL}
            themeColors={theme.colors}
            value={settings.caseAssignedToMe}
            onToggle={(v) => handleToggle('caseAssignedToMe', v)}
            disabled={saving === 'caseAssignedToMe'}
          />
          <Divider style={styles.divider} />
          <SettingRow
            icon="swap-horizontal"
            iconColor="#4A90D9"
            label={t('pushSettings.caseStageChanged', 'שלב פנייה עודכן')}
            description={t('pushSettings.caseStageChangedDesc', 'קבל התראה כאשר שלב הפנייה שבבעלותך משתנה')}
            isRTL={isRTL}
            themeColors={theme.colors}
            value={settings.caseStageChanged}
            onToggle={(v) => handleToggle('caseStageChanged', v)}
            disabled={saving === 'caseStageChanged'}
          />
          <Divider style={styles.divider} />
          <SettingRow
            icon="clock-alert-outline"
            iconColor="#E63946"
            label={t('pushSettings.caseSlaBreach', 'חריגת SLA')}
            description={t('pushSettings.caseSlaBreachDesc', 'קבל התראה כאשר פנייה חורגת מזמן התגובה/טיפול שהוגדר')}
            isRTL={isRTL}
            themeColors={theme.colors}
            value={settings.caseSlaBreach}
            onToggle={(v) => handleToggle('caseSlaBreach', v)}
            disabled={saving === 'caseSlaBreach'}
          />
          <Divider style={styles.divider} />
          <SettingRow
            icon="account-filter-outline"
            iconColor="#FF6B35"
            label={t('pushSettings.onlyMyCases', 'רק פניות שלי')}
            description={t('pushSettings.onlyMyCasesDesc', 'קבל התראות רק על פניות שאני הבעלים שלהן')}
            isRTL={isRTL}
            themeColors={theme.colors}
            value={settings.casesOnlyMyCases}
            onToggle={(v) => handleToggle('casesOnlyMyCases', v)}
            disabled={saving === 'casesOnlyMyCases'}
          />
        </Surface></>
        )}

        {/* Quotes & Orders */}
        {canOrders && (
        <><SectionHeader title={t('pushSettings.ordersSection', 'הצעות מחיר והזמנות')} isRTL={isRTL} themeColors={theme.colors} />
        <Surface style={[styles.section, { backgroundColor: theme.colors.surface }]} elevation={1}>
          <SettingRow
            icon="file-document-outline"
            iconColor="#0891b2"
            label={t('pushSettings.newOrderCreated', 'הצעת מחיר / הזמנה חדשה')}
            description={t('pushSettings.newOrderCreatedDesc', 'קבל התראה כשנוצרת הצעת מחיר או הזמנה חדשה')}
            isRTL={isRTL}
            themeColors={theme.colors}
            value={settings.newOrderCreated}
            onToggle={(v) => handleToggle('newOrderCreated', v)}
            disabled={saving === 'newOrderCreated'}
          />
          <Divider style={styles.divider} />
          <SettingRow
            icon="file-document-arrow-right-outline"
            iconColor="#0891b2"
            label={t('pushSettings.orderAssignedToMe', 'הזמנה שויכה אליי')}
            description={t('pushSettings.orderAssignedToMeDesc', 'קבל התראה כשמשייכים אליך הזמנה / הצעת מחיר')}
            isRTL={isRTL}
            themeColors={theme.colors}
            value={settings.orderAssignedToMe}
            onToggle={(v) => handleToggle('orderAssignedToMe', v)}
            disabled={saving === 'orderAssignedToMe'}
          />
          <Divider style={styles.divider} />
          <SettingRow
            icon="account-filter-outline"
            iconColor="#0891b2"
            label={t('pushSettings.onlyMyOrders', 'רק הזמנות שלי')}
            description={t('pushSettings.onlyMyOrdersDesc', 'קבל התראות רק על הזמנות שאני הבעלים שלהן')}
            isRTL={isRTL}
            themeColors={theme.colors}
            value={settings.ordersOnlyMyOrders}
            onToggle={(v) => handleToggle('ordersOnlyMyOrders', v)}
            disabled={saving === 'ordersOnlyMyOrders'}
          />
        </Surface></>
        )}

        {/* Tasks */}
        {canTasks && (
        <><SectionHeader title={t('pushSettings.tasksSection')} isRTL={isRTL} themeColors={theme.colors} />
        <Surface style={[styles.section, { backgroundColor: theme.colors.surface }]} elevation={1}>
          <SettingRow
            icon="bell-ring-outline"
            iconColor="#7B2D8E"
            label={t('pushSettings.taskReminder')}
            description={t('pushSettings.taskReminderDesc')}
            isRTL={isRTL}
            themeColors={theme.colors}
            value={settings.taskReminder}
            onToggle={(v) => handleToggle('taskReminder', v)}
            disabled={saving === 'taskReminder'}
          />
          <Divider style={styles.divider} />
          <SettingRow
            icon="clipboard-account-outline"
            iconColor="#6366f1"
            label={t('pushSettings.taskAssignedToMe')}
            description={t('pushSettings.taskAssignedToMeDesc')}
            isRTL={isRTL}
            themeColors={theme.colors}
            value={settings.taskAssignedToMe}
            onToggle={(v) => handleToggle('taskAssignedToMe', v)}
            disabled={saving === 'taskAssignedToMe'}
          />
        </Surface></>
        )}

        {/* Calendar Events */}
        <SectionHeader title={isRTL ? 'אירועי יומן' : 'Calendar Events'} isRTL={isRTL} themeColors={theme.colors} />
        <Surface style={[styles.section, { backgroundColor: theme.colors.surface }]} elevation={1}>
          <SettingRow
            icon="calendar-clock"
            iconColor="#059669"
            label={isRTL ? 'תזכורת אירוע' : 'Event Reminder'}
            description={isRTL ? 'קבל התראה לפני אירוע ביומן' : 'Get notified before calendar events'}
            isRTL={isRTL}
            themeColors={theme.colors}
            value={settings.calendarEventReminder}
            onToggle={(v) => handleToggle('calendarEventReminder', v)}
            disabled={saving === 'calendarEventReminder'}
          />
        </Surface>

        {/* Gambot AI */}
        {canGambotAI && (
        <><SectionHeader title={isRTL ? 'Gambot AI' : 'Gambot AI'} isRTL={isRTL} themeColors={theme.colors} />
        <Surface style={[styles.section, { backgroundColor: theme.colors.surface }]} elevation={1}>
          <SettingRow
            icon="robot-outline"
            iconColor="#8b5cf6"
            label={isRTL ? 'העברה מ-AI' : 'AI Transfer'}
            description={isRTL ? 'קבל התראה כשה-AI מעביר אליך לקוח לטיפול' : 'Get notified when AI transfers a customer to you'}
            isRTL={isRTL}
            themeColors={theme.colors}
            value={settings.gambotAiTransfer}
            onToggle={(v) => handleToggle('gambotAiTransfer', v)}
            disabled={saving === 'gambotAiTransfer'}
          />
        </Surface></>
        )}

        {/* Scheduled reports (daily / weekly / monthly) */}
        <SectionHeader title={isRTL ? 'דוחות מתוזמנים' : 'Scheduled reports'} isRTL={isRTL} themeColors={theme.colors} />
        <Surface style={[styles.section, { backgroundColor: theme.colors.surface }]} elevation={1}>
          <SettingRow
            icon="file-chart-outline"
            iconColor="#2563eb"
            label={isRTL ? 'דוח תקופתי מוכן' : 'Report ready'}
            description={isRTL ? 'קבל התראה כשדוח יומי / שבועי / חודשי נשלח, וצפה בו באפליקציה' : 'Get notified when a daily / weekly / monthly report is sent, and view it in the app'}
            isRTL={isRTL}
            themeColors={theme.colors}
            value={settings.scheduledReport}
            onToggle={(v) => handleToggle('scheduledReport', v)}
            disabled={saving === 'scheduledReport'}
          />
        </Surface>

        {/* Calls — only if telephony is enabled */}
        {hasTelephony && (
          <>
            <SectionHeader title={t('pushSettings.callsSection')} isRTL={isRTL} themeColors={theme.colors} />
            <Surface style={[styles.section, { backgroundColor: theme.colors.surface }]} elevation={1}>
              <SettingRow
                icon="phone-ring-outline"
                iconColor="#0ea5e9"
                label={t('pushSettings.incomingCall')}
                description={t('pushSettings.incomingCallDesc')}
                isRTL={isRTL}
                themeColors={theme.colors}
                value={settings.incomingCall}
                onToggle={(v) => handleToggle('incomingCall', v)}
                disabled={saving === 'incomingCall'}
              />
            </Surface>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
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
  permCard: { marginTop: 16, padding: 16, borderWidth: 1 },
  permRow: { alignItems: 'center' },
  permButton: { marginTop: 14, borderRadius: 10 },
  divider: { marginHorizontal: 16 },
  row: { alignItems: 'center', paddingVertical: 12, paddingHorizontal: 16 },
  iconWrap: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  textWrap: { flex: 1, marginHorizontal: 12 },
});
