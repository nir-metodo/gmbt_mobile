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
  internalMessage: boolean;
  newLeadCreated: boolean;
  leadAssignedToMe: boolean;
  leadsOnlyMyLeads: boolean;
  newCaseCreated: boolean;
  caseAssignedToMe: boolean;
  casesOnlyMyCases: boolean;
  contactAssignedToMe: boolean;
  newOrderCreated: boolean;
  orderAssignedToMe: boolean;
  ordersOnlyMyOrders: boolean;
  taskReminder: boolean;
  taskAssignedToMe: boolean;
  calendarEventReminder: boolean;
  gambotAiTransfer: boolean;
  incomingCall: boolean;
  scheduledReport: boolean;
}

export const DEFAULT_PUSH_SETTINGS: PushNotificationSettings = {
  incomingMessages: true,
  messagesOnlyMyContacts: false,
  internalMessage: true,
  newLeadCreated: true,
  leadAssignedToMe: true,
  leadsOnlyMyLeads: false,
  newCaseCreated: true,
  caseAssignedToMe: true,
  casesOnlyMyCases: false,
  contactAssignedToMe: true,
  newOrderCreated: true,
  orderAssignedToMe: true,
  ordersOnlyMyOrders: false,
  taskReminder: true,
  taskAssignedToMe: true,
  calendarEventReminder: true,
  gambotAiTransfer: true,
  incomingCall: true,
  scheduledReport: true,
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

async function clearStoredRegistrationToken(): Promise<void> {
  try {
    await AsyncStorage.removeItem(PUSH_TOKEN_REGISTERED_KEY);
  } catch {
    // Non-critical.
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

  // Remove this device's push token from the backend so a user stops receiving notifications
  // after logging out. Must run BEFORE auth state is cleared (we still need org + userId + a valid
  // request token). Without this, the previous account's token lingers server-side and keeps
  // delivering its messages to this device even after switching accounts.
  async unregisterPushToken(organization: string, userId: string): Promise<void> {
    try {
      let expoPushToken: string | null = null;
      // Prefer the OS token (no prompt when permission is already granted).
      try {
        if (Device.isDevice) {
          const projectId = Constants.expoConfig?.extra?.eas?.projectId;
          const tokenData = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
          expoPushToken = tokenData.data;
        }
      } catch {
        // ignore — fall back to the stored registration key below
      }
      // Fallback: recover the token from the stored `${org}:${userId}:${token}` key.
      if (!expoPushToken) {
        const stored = await getStoredRegistrationToken();
        if (stored) {
          const parts = stored.split(':');
          if (parts.length >= 3) expoPushToken = parts.slice(2).join(':');
        }
      }
      if (expoPushToken) {
        await axiosInstance.post(ENDPOINTS.UNREGISTER_PUSH_TOKEN, {
          organization,
          userId,
          expoPushToken,
        });
      }
    } catch {
      // Best-effort — never block logout on this.
    } finally {
      await clearStoredRegistrationToken();
    }
  },

  async getPushSettings(organization: string, userId: string): Promise<PushNotificationSettings> {
    try {
      const response = await axiosInstance.post(ENDPOINTS.GET_PUSH_SETTINGS, {
        organization,
        userId,
      });
      // The backend returns the saved values nested under `settings`
      // ({ success, settings: { ... } }). Fall back to the raw body for
      // backwards-compatibility with any flat response shape.
      const saved = response.data?.settings ?? response.data ?? {};
      return { ...DEFAULT_PUSH_SETTINGS, ...saved };
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
