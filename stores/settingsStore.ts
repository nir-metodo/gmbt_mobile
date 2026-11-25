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
  /**
   * True only when the org has a calling solution we may actually use from the app right now: the SIP trunk, or - while the
   * legacy carrier is still switched on for this login - Twilio (master login only). When false, every "call" button just opens
   * the phone's own dialer and logs the call. `telephonyEnabled` (above) only decides whether the calls history screen is shown.
   */
  telephonySolutionAvailable: boolean;
  telephonyProvider: 'twilio' | 'sip';
  /** Numbers the caller may dial from (Twilio-bought numbers are removed for everyone except the master login). */
  usableCallerNumbers: any[];
  defaultCallerId: string;
  /** Organization-wide caller ID policy for outgoing calls: 'user' = each user chooses (default), 'did' = org number, 'fixed' = one agreed number. */
  outboundCallerIdMode: 'user' | 'did' | 'fixed';
  outboundFixedCallerId: string;
  /** The signed-in user's own extension (שלוחה): present only when the org restricts the phone to extensions. */
  myExtension: { extension?: string; enabled?: boolean; ringMobile?: boolean; mobilePhone?: string; outboundCallerId?: 'did' | 'mobile' } | null;
  callAlertSoundEnabled: boolean;
  callAlertVibrateEnabled: boolean;
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
  // Dialer every call button opens first: 'system' (organization line), 'phone' (device dialer) or '' = automatic.
  defaultDialer: 'system' | 'phone' | '';
  // Ringtone for calls that ring in the app (id from utils/ringtones; '' = default).
  ringtone: string;
  // True once locally-persisted settings (incl. defaultScreen) have been loaded.
  settingsInitialized: boolean;
  isLoading: boolean;

  initialize: () => Promise<void>;
  setTheme: (theme: 'light' | 'dark' | 'system') => Promise<void>;
  setLanguage: (lang: 'en' | 'he') => Promise<void>;
  setDefaultScreen: (route: string) => Promise<void>;
  setDefaultDialer: (value: 'system' | 'phone' | '') => Promise<void>;
  setRingtone: (id: string) => Promise<void>;
  loadTelephonySettings: (organization: string, userId?: string) => Promise<void>;
  setCallAlertSound: (enabled: boolean) => void;
  setCallAlertVibrate: (enabled: boolean) => void;
  setMyMobileRinging: (organization: string, ringMobile: boolean, mobilePhone?: string) => Promise<{ ok: boolean; error?: string }>;
  setMyOutboundCallerId: (organization: string, outboundCallerId: 'did' | 'mobile', mobilePhone?: string) => Promise<{ ok: boolean; error?: string }>;
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
  telephonySolutionAvailable: false,
  telephonyProvider: 'twilio',
  usableCallerNumbers: [],
  defaultCallerId: '',
  outboundCallerIdMode: 'user',
  outboundFixedCallerId: '',
  myExtension: null,
  callAlertSoundEnabled: true,
  callAlertVibrateEnabled: true,
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
  defaultDialer: '',
  ringtone: '',
  settingsInitialized: false,
  isLoading: false,

  initialize: async () => {
    try {
      const theme = await appStorage.getTheme();
      const language = await appStorage.getLanguage();
      const reportDeviceCallEventsEnabled = await appStorage.getReportDeviceCallEvents();
      const callAlertSoundEnabled = await appStorage.getCallAlertSound();
      const callAlertVibrateEnabled = await appStorage.getCallAlertVibrate();
      const defaultScreen = await appStorage.getDefaultScreen();
      const defaultDialer = await appStorage.getDefaultDialer();
      const ringtone = await appStorage.getRingtone();
      i18n.changeLanguage(language);
      const shouldBeRTL = language === 'he';
      if (I18nManager.isRTL !== shouldBeRTL) {
        I18nManager.forceRTL(shouldBeRTL);
      }
      set({ theme, language, reportDeviceCallEventsEnabled, callAlertSoundEnabled, callAlertVibrateEnabled, defaultScreen, defaultDialer, ringtone });
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

  setDefaultDialer: async (value) => {
    await appStorage.setDefaultDialer(value);
    set({ defaultDialer: value });
  },

  setRingtone: async (id) => {
    await appStorage.setRingtone(id);
    set({ ringtone: id });
  },

  loadTelephonySettings: async (organization, userId) => {
    try {
      const settings = await phoneCallsApi.getTelephonySettings(organization);
      const nums = Array.isArray(settings?.phoneNumbers) ? settings.phoneNumbers : [];

      // Twilio/Telnyx calling is limited to the master login (backend flag twilioCallingAllowed); everyone else needs SIP.
      const legacyAllowed = settings?.twilioCallingAllowed === true;
      const provider: 'twilio' | 'sip' = settings?.telephonyProvider === 'sip' ? 'sip' : 'twilio';
      const isLegacyNum = (pn: any) => ['twilio', 'telnyx'].includes(String(pn?.provider || '').toLowerCase());
      const usable = nums.filter((pn: any) => legacyAllowed || !isLegacyNum(pn));
      const callerIdOk = settings?.defaultCallerId && usable.some((pn: any) => pn.number === settings.defaultCallerId);
      const pbxOn = !!settings?.enabled || nums.length > 0;

      // The org may restrict the phone to users with an enabled extension. No user extensions at all = everyone may call.
      const exts: any[] = Array.isArray(settings?.extensions) ? settings.extensions.filter((e: any) => e && e.userId) : [];
      const mine = userId ? exts.find((e) => String(e.userId) === String(userId)) : null;
      const allowedByExtension = exts.length === 0 || !!(mine && mine.enabled);

      set({
        telephonyEnabled: pbxOn,
        telephonyProvider: provider,
        usableCallerNumbers: usable,
        defaultCallerId: callerIdOk ? settings.defaultCallerId : (usable[0]?.number || ''),
        // The admin can pin this user to one choice (adminCallerIdMode = did | user | fixed); it wins over the organization-wide mode.
        outboundCallerIdMode: ['did', 'fixed', 'user'].includes(mine?.adminCallerIdMode)
          ? mine.adminCallerIdMode
          : (settings?.outboundCallerIdMode === 'did' || settings?.outboundCallerIdMode === 'fixed' ? settings.outboundCallerIdMode : 'user'),
        outboundFixedCallerId: mine?.adminCallerIdMode === 'fixed' ? String(mine.adminCallerIdFixed || '') : String(settings?.outboundFixedCallerId || ''),
        myExtension: mine ? { extension: mine.extension, enabled: !!mine.enabled, ringMobile: mine.ringMobile === true, mobilePhone: mine.mobilePhone || '', outboundCallerId: (mine.adminCallerIdMode === 'user' || mine.outboundCallerId !== 'did') ? 'mobile' : 'did' } : null, // default = the user's own mobile (only an explicit "did" keeps the org number)
        telephonySolutionAvailable: pbxOn && allowedByExtension && (legacyAllowed || provider === 'sip'),
      });
    } catch {
      set({ telephonyEnabled: false, telephonySolutionAvailable: false });
    }
  },

  setCallAlertSound: (enabled) => {
    set({ callAlertSoundEnabled: enabled });
    appStorage.setCallAlertSound(enabled).catch(() => {});
  },

  setCallAlertVibrate: (enabled) => {
    set({ callAlertVibrateEnabled: enabled });
    appStorage.setCallAlertVibrate(enabled).catch(() => {});
  },

  setMyMobileRinging: async (organization, ringMobile, mobilePhone) => {
    try {
      const res = await phoneCallsApi.setMyMobileRinging(organization, ringMobile, mobilePhone);
      if (!res?.success) return { ok: false, error: res?.error || 'failed' };
      set((s) => ({
        myExtension: s.myExtension ? { ...s.myExtension, ringMobile: !!res.ringMobile, mobilePhone: res.mobilePhone || s.myExtension.mobilePhone } : s.myExtension,
      }));
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e?.message || 'network_error' };
    }
  },

  setMyOutboundCallerId: async (organization, outboundCallerId, mobilePhone) => {
    try {
      const res = await phoneCallsApi.setMyOutboundCallerId(organization, outboundCallerId, mobilePhone);
      if (!res?.success) return { ok: false, error: res?.error || 'failed' };
      set((s) => ({
        myExtension: s.myExtension ? { ...s.myExtension, outboundCallerId: res.outboundCallerId === 'mobile' ? 'mobile' : 'did', mobilePhone: res.mobilePhone || s.myExtension.mobilePhone } : s.myExtension,
      }));
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e?.message || 'network_error' };
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
