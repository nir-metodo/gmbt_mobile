import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { appStorage } from './storage';
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

async function getStoredRegistrationToken(): Promise<string | null> {
  return appStorage.getDeviceToken();
}

async function setStoredRegistrationToken(token: string): Promise<void> {
  await appStorage.setDeviceToken(token);
}

export const pushNotificationService = {
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

    const alreadyRegistered = await getStoredRegistrationToken();
    if (alreadyRegistered === expoPushToken) {
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
      await setStoredRegistrationToken(expoPushToken);
    } catch {
      // Non-critical — device still receives push via existing channel
    }

    return expoPushToken;
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
