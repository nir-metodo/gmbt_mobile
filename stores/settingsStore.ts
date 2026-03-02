import { create } from 'zustand';
import type { AppSettings, CallRule } from '../types';
import { appStorage } from '../services/storage';
import { settingsApi } from '../services/api/settings';
import { phoneCallsApi } from '../services/api/phoneCalls';
import i18n from '../i18n';

interface SettingsState {
  theme: 'light' | 'dark' | 'system';
  language: 'en' | 'he';
  callRecordingEnabled: boolean;
  callTranscriptionEnabled: boolean;
  callAiSummaryEnabled: boolean;
  callSaveToTimelineEnabled: boolean;
  callRules: CallRule[];
  pushNotificationsEnabled: boolean;
  messageNotificationsEnabled: boolean;
  callNotificationsEnabled: boolean;
  isLoading: boolean;

  initialize: () => Promise<void>;
  setTheme: (theme: 'light' | 'dark' | 'system') => Promise<void>;
  setLanguage: (lang: 'en' | 'he') => Promise<void>;
  setCallRecording: (enabled: boolean) => void;
  setCallTranscription: (enabled: boolean) => void;
  setCallAiSummary: (enabled: boolean) => void;
  setCallSaveToTimeline: (enabled: boolean) => void;
  loadCallRules: (organization: string) => Promise<void>;
  updateCallRules: (organization: string, rules: CallRule[]) => Promise<void>;
  setPushNotifications: (enabled: boolean) => void;
  setMessageNotifications: (enabled: boolean) => void;
  setCallNotifications: (enabled: boolean) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  theme: 'system',
  language: 'he',
  callRecordingEnabled: false,
  callTranscriptionEnabled: false,
  callAiSummaryEnabled: false,
  callSaveToTimelineEnabled: true,
  callRules: [],
  pushNotificationsEnabled: true,
  messageNotificationsEnabled: true,
  callNotificationsEnabled: true,
  isLoading: false,

  initialize: async () => {
    const theme = await appStorage.getTheme();
    const language = await appStorage.getLanguage();
    i18n.changeLanguage(language);
    set({ theme, language });
  },

  setTheme: async (theme) => {
    await appStorage.setTheme(theme);
    set({ theme });
  },

  setLanguage: async (lang) => {
    await appStorage.setLanguage(lang);
    i18n.changeLanguage(lang);
    set({ language: lang });
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
}));
