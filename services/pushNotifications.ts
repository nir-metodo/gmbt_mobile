import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axiosInstance from './api/axiosInstance';
import { ENDPOINTS } from '../constants/api';

export interface PushNotificationSettings {
  incomingMessages: boolean;
  messagesOnlyMyContacts: boolean;
  newLeadCreated: boolean;
  leadAssignedToMe: boolean;
  leadsOnlyMyLeads: boolean;
  newCaseCreated: boolean;
  caseAssignedToMe: boolean;
  casesOnlyMyCases: boolean;
  newOrderCreated: boolean;
  taskReminder: boolean;
  taskAssignedToMe: boolean;
  calendarEventReminder: boolean;
  gambotAiTransfer: boolean;
  incomingCall: boolean;
}

export const DEFAULT_PUSH_SETTINGS: PushNotificationSettings = {
  incomingMessages: true,
  messagesOnlyMyContacts: false,
  newLeadCreated: true,
  leadAssignedToMe: true,
  leadsOnlyMyLeads: false,
  newCaseCreated: true,
  caseAssignedToMe: true,
  casesOnlyMyCases: false,
  newOrderCreated: true,
  taskReminder: true,
  taskAssignedToMe: true,
  calendarEventReminder: true,
  gambotAiTransfer: true,
  incomingCall: true,
};

// Dedicated key that tracks the push token we last *successfully registered with the backend*
// (ENDPOINTS.REGISTER_PUSH_TOKEN). This MUST be separate from appStorage's DEVICE_TOKEN key:
// notificationService.registerForPushNotifications() writes the device token first, and if we
// dedup against that same value, registerPushToken() short-circuits on a fresh install and never
// POSTs the token to the backend — so push silently never works until the OS token changes
// (which is exactly what toggling the permission off/on in settings does). Keeping our own key
// guarantees the backend registration happens on first run.
const PUSH_TOKEN_REGISTERED_KEY = 'gambot_push_token_registered';

async function getStoredRegistrationToken(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(PUSH_TOKEN_REGISTERED_KEY);
  } catch {
    return null;
  }
}

async function setStoredRegistrationToken(token: string): Promise<void> {
  try {
    await AsyncStorage.setItem(PUSH_TOKEN_REGISTERED_KEY, token);
  } catch {
    // Non-critical — worst case we re-POST the same token next time.
  }
}

export type PushPermissionState = {
  status: 'granted' | 'denied' | 'undetermined' | 'unsupported';
  canAskAgain: boolean;
  isDevice: boolean;
};

export const pushNotificationService = {
  // Read the current OS-level notification permission so the settings screen can show status
  // and offer the right action (in-app prompt vs. deep-link to OS settings).
  async getPermissionState(): Promise<PushPermissionState> {
    if (!Device.isDevice) {
      return { status: 'unsupported', canAskAgain: false, isDevice: false };
    }
    try {
      const perm = await Notifications.getPermissionsAsync();
      const status = (perm.status as PushPermissionState['status']) || 'undetermined';
      return { status, canAskAgain: perm.canAskAgain ?? true, isDevice: true };
    } catch {
      return { status: 'undetermined', canAskAgain: true, isDevice: true };
    }
  },

  // Show the OS permission dialog (only works when not permanently denied). Returns the new status.
  async requestPermission(): Promise<PushPermissionState['status']> {
    if (!Device.isDevice) return 'unsupported';
    try {
      const { status } = await Notifications.requestPermissionsAsync();
      return (status as PushPermissionState['status']) || 'undetermined';
    } catch {
      return 'undetermined';
    }
  },

  async registerPushToken(organization: string, userId: string): Promise<string | null> {
    if (!Device.isDevice) {
      return null;
    }

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      return null;
    }

    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    const tokenData = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );
    const expoPushToken = tokenData.data;

    // Dedup on user + token so switching accounts on the same device re-registers the token
    // for the new user (a token-only check would skip that and leave the new user without push).
    const registrationKey = `${organization}:${userId}:${expoPushToken}`;
    const alreadyRegistered = await getStoredRegistrationToken();
    if (alreadyRegistered === registrationKey) {
      return expoPushToken;
    }

    try {
      await axiosInstance.post(ENDPOINTS.REGISTER_PUSH_TOKEN, {
        organization,
        userId,
        expoPushToken,
        platform: Platform.OS,
        deviceName: Device.deviceName || `${Device.brand} ${Device.modelName}`,
      });
      await setStoredRegistrationToken(registrationKey);
      return expoPushToken;
    } catch {
      // POST failed — deliberately do NOT persist the registration key, and return null so callers
      // (registerPushTokenWithRetry) know it didn't stick and try again. Previously this returned
      // the token even on failure, which masked the error and left push silently unregistered.
      return null;
    }
  },

  // Register with a few spaced retries. On a FRESH login the OS permission dialog may still be open
  // (first attempt sees "not granted" → null), or the Expo/FCM push token may not be ready yet, or
  // the backend POST can transiently fail. Retrying within the session means push starts working
  // immediately instead of only after the user kills & reopens the app. Safe to call repeatedly:
  // once permission is resolved the OS won't re-prompt, and a successful registration short-circuits.
  async registerPushTokenWithRetry(
    organization: string,
    userId: string,
    attempts = 5,
    delayMs = 3000
  ): Promise<string | null> {
    for (let i = 0; i < attempts; i++) {
      try {
        const token = await pushNotificationService.registerPushToken(organization, userId);
        if (token) return token;
      } catch {
        // ignore and retry
      }
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
    return null;
  },

  async getPushSettings(organization: string, userId: string): Promise<PushNotificationSettings> {
    try {
      const response = await axiosInstance.post(ENDPOINTS.GET_PUSH_SETTINGS, {
        organization,
        userId,
      });
      return { ...DEFAULT_PUSH_SETTINGS, ...response.data };
    } catch {
      return DEFAULT_PUSH_SETTINGS;
    }
  },

  async updatePushSettings(
    organization: string,
    userId: string,
    settings: Partial<PushNotificationSettings>
  ): Promise<void> {
    await axiosInstance.post(ENDPOINTS.UPDATE_PUSH_SETTINGS, {
      organization,
      userId,
      ...settings,
    });
  },
};
