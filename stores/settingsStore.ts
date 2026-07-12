import { create } from 'zustand';
import { I18nManager } from 'react-native';
import * as Updates from 'expo-updates';
import type { AppSettings, CallRule } from '../types';
import { appStorage } from '../services/storage';
import { settingsApi } from '../services/api/settings';
import { phoneCallsApi } from '../services/api/phoneCalls';
import i18n from '../i18n';

interface SettingsState {
  theme: 'light' | 'dark' | 'system';
  language: 'en' | 'he';
  telephonyEnabled: boolean | null;
  callRecordingEnabled: boolean;
  callTranscriptionEnabled: boolean;
  callAiSummaryEnabled: boolean;
  callSaveToTimelineEnabled: boolean;
  reportDeviceCallEventsEnabled: boolean;
  callRules: CallRule[];
  pushNotificationsEnabled: boolean;
  messageNotificationsEnabled: boolean;
  callNotificationsEnabled: boolean;
  contactAssignedNotification: boolean;
  leadAssignedNotification: boolean;
  mentionNotification: boolean;
  taskAssignedNotification: boolean;
  calendarReminderNotification: boolean;
  botActionNotification: boolean;
  caseAssignedNotification: boolean;
  // Preferred landing screen route (empty = auto / first permitted screen).
  defaultScreen: string;
  // True once locally-persisted settings (incl. defaultScreen) have been loaded.
  settingsInitialized: boolean;
  isLoading: boolean;

  initialize: () => Promise<void>;
  setTheme: (theme: 'light' | 'dark' | 'system') => Promise<void>;
  setLanguage: (lang: 'en' | 'he') => Promise<void>;
  setDefaultScreen: (route: string) => Promise<void>;
  loadTelephonySettings: (organization: string) => Promise<void>;
  setCallRecording: (enabled: boolean) => void;
  setCallTranscription: (enabled: boolean) => void;
  setCallAiSummary: (enabled: boolean) => void;
  setCallSaveToTimeline: (enabled: boolean) => void;
  setReportDeviceCallEvents: (enabled: boolean) => void;
  loadCallRules: (organization: string) => Promise<void>;
  updateCallRules: (organization: string, rules: CallRule[]) => Promise<void>;
  setPushNotifications: (enabled: boolean) => void;
  setMessageNotifications: (enabled: boolean) => void;
  setCallNotifications: (enabled: boolean) => void;
  setNotificationPref: (key: string, enabled: boolean) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  theme: 'system',
  language: 'he',
  telephonyEnabled: null,
  callRecordingEnabled: false,
  callTranscriptionEnabled: false,
  callAiSummaryEnabled: false,
  callSaveToTimelineEnabled: true,
  reportDeviceCallEventsEnabled: false,
  callRules: [],
  pushNotificationsEnabled: true,
  messageNotificationsEnabled: true,
  callNotificationsEnabled: true,
  contactAssignedNotification: true,
  leadAssignedNotification: true,
  mentionNotification: true,
  taskAssignedNotification: true,
  calendarReminderNotification: true,
  botActionNotification: true,
  caseAssignedNotification: true,
  defaultScreen: '',
  settingsInitialized: false,
  isLoading: false,

  initialize: async () => {
    try {
      const theme = await appStorage.getTheme();
      const language = await appStorage.getLanguage();
      const reportDeviceCallEventsEnabled = await appStorage.getReportDeviceCallEvents();
      const defaultScreen = await appStorage.getDefaultScreen();
      i18n.changeLanguage(language);
      const shouldBeRTL = language === 'he';
      if (I18nManager.isRTL !== shouldBeRTL) {
        I18nManager.forceRTL(shouldBeRTL);
      }
      set({ theme, language, reportDeviceCallEventsEnabled, defaultScreen });
    } finally {
      // Never block app launch on a settings read failure.
      set({ settingsInitialized: true });
    }
  },

  setTheme: async (theme) => {
    await appStorage.setTheme(theme);
    set({ theme });
  },

  setLanguage: async (lang) => {
    await appStorage.setLanguage(lang);
    i18n.changeLanguage(lang);
    const shouldBeRTL = lang === 'he';
    if (I18nManager.isRTL !== shouldBeRTL) {
      I18nManager.forceRTL(shouldBeRTL);
      try { await Updates.reloadAsync(); } catch { /* dev mode - manual restart needed */ }
    }
    set({ language: lang });
  },

  setDefaultScreen: async (route) => {
    await appStorage.setDefaultScreen(route);
    set({ defaultScreen: route });
  },

  loadTelephonySettings: async (organization) => {
    try {
      const settings = await phoneCallsApi.getTelephonySettings(organization);
      const nums = Array.isArray(settings?.phoneNumbers) ? settings.phoneNumbers : [];
      set({ telephonyEnabled: !!settings?.enabled || nums.length > 0 });
    } catch {
      set({ telephonyEnabled: false });
    }
  },

  setCallRecording: (enabled) => {
    set({ callRecordingEnabled: enabled });
  },

  setCallTranscription: (enabled) => {
    set({ callTranscriptionEnabled: enabled });
  },

  setCallAiSummary: (enabled) => {
    set({ callAiSummaryEnabled: enabled });
  },

  setCallSaveToTimeline: (enabled) => {
    set({ callSaveToTimelineEnabled: enabled });
  },

  setReportDeviceCallEvents: (enabled) => {
    set({ reportDeviceCallEventsEnabled: enabled });
    appStorage.setReportDeviceCallEvents(enabled).catch(() => {});
  },

  loadCallRules: async (organization) => {
    set({ isLoading: true });
    try {
      const rules = await phoneCallsApi.getCallRules(organization);
      set({ callRules: rules, isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  updateCallRules: async (organization, rules) => {
    await phoneCallsApi.updateCallRules(organization, rules);
    set({ callRules: rules });
  },

  setPushNotifications: (enabled) => {
    set({ pushNotificationsEnabled: enabled });
  },

  setMessageNotifications: (enabled) => {
    set({ messageNotificationsEnabled: enabled });
  },

  setCallNotifications: (enabled) => {
    set({ callNotificationsEnabled: enabled });
  },

  setNotificationPref: (key, enabled) => {
    set({ [key]: enabled } as any);
  },
}));
