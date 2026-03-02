import * as Notifications from 'expo-notifications';
import * as Device from 'expo-constants';
import { Platform } from 'react-native';
import { appStorage } from './storage';
import axiosInstance from './api/axiosInstance';
import { ENDPOINTS } from '../constants/api';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export const notificationService = {
  async registerForPushNotifications(): Promise<string | null> {
    if (!Device.default.isDevice) {
      console.warn('Push notifications only work on physical devices');
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

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Default',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#2e6155',
      });

      await Notifications.setNotificationChannelAsync('messages', {
        name: 'Messages',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        sound: 'default',
      });

      await Notifications.setNotificationChannelAsync('calls', {
        name: 'Phone Calls',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 500, 250, 500],
        sound: 'default',
      });
    }

    const tokenData = await Notifications.getExpoPushTokenAsync();
    const token = tokenData.data;

    await appStorage.setDeviceToken(token);
    return token;
  },

  async registerDeviceWithServer(organization: string, userId: string): Promise<void> {
    const token = await appStorage.getDeviceToken();
    if (!token) return;

    try {
      await axiosInstance.post(ENDPOINTS.REGISTER_DEVICE, {
        organization,
        userId,
        deviceToken: token,
        platform: Platform.OS,
      });
    } catch (error) {
      console.error('Failed to register device token:', error);
    }
  },

  async scheduleLocalNotification(
    title: string,
    body: string,
    data?: Record<string, any>,
    triggerDate?: Date
  ): Promise<string> {
    const trigger: Notifications.NotificationTriggerInput = triggerDate
      ? { type: Notifications.SchedulableTriggerInputTypes.DATE, date: triggerDate }
      : null;

    return Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        data: data || {},
        sound: 'default',
      },
      trigger,
    });
  },

  addNotificationReceivedListener(handler: (notification: Notifications.Notification) => void) {
    return Notifications.addNotificationReceivedListener(handler);
  },

  addNotificationResponseListener(
    handler: (response: Notifications.NotificationResponse) => void
  ) {
    return Notifications.addNotificationResponseReceivedListener(handler);
  },

  async setBadgeCount(count: number): Promise<void> {
    await Notifications.setBadgeCountAsync(count);
  },
};
