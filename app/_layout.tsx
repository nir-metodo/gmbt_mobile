import { useEffect, useRef } from 'react';
import { AppState, AppStateStatus, I18nManager, Linking } from 'react-native';
import { Slot, router, useSegments, useRootNavigationState } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { PaperProvider } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useAuthStore } from '../stores/authStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useAppTheme } from '../hooks/useAppTheme';
import { secureStorage } from '../services/storage';
import axiosInstance from '../services/api/axiosInstance';
import { ENDPOINTS } from '../constants/api';
import { getLandingRoute } from '../constants/permissions';
import { ErrorBoundary } from '../components/ErrorBoundary';
import * as Notifications from 'expo-notifications';
import { notificationService } from '../services/notifications';
import { pushNotificationService } from '../services/pushNotifications';
import { notificationSound } from '../services/notificationSound';
import '../i18n';

I18nManager.allowRTL(true);
if (!I18nManager.isRTL) {
  I18nManager.forceRTL(true);
}

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const theme = useAppTheme();
  const initialize = useAuthStore((s) => s.initialize);
  const initializeSettings = useSettingsStore((s) => s.initialize);
  const isInitialized = useAuthStore((s) => s.isInitialized);
  const user = useAuthStore((s) => s.user);
  const themeSetting = useSettingsStore((s) => s.theme);
  const segments = useSegments();
  const navigationState = useRootNavigationState();

  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    async function bootstrap() {
      try {
        await Promise.all([initializeSettings(), initialize()]);
      } catch {
        useAuthStore.setState({ isInitialized: true });
      }
    }
    bootstrap();
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', async (nextState) => {
      if (appStateRef.current.match(/inactive|background/) && nextState === 'active') {
        const currentUser = useAuthStore.getState().user;
        if (!currentUser) return;
        try {
          const refreshToken = await secureStorage.getRefreshToken();
          if (!refreshToken) return;
          const res = await axiosInstance.post(ENDPOINTS.REFRESH_TOKEN, { refreshToken });
          if (res?.data?.IdToken) {
            const newToken = res.data.IdToken;
            await secureStorage.setToken(newToken);
            useAuthStore.getState().updateUser({ authToken: newToken });
          }
        } catch {
          // Non-critical — token refresh on foreground failed; user will get 401 on next request
        }

        // Re-register push token on foreground — handles the case where the user
        // denied the permission dialog at login but later enabled notifications in device settings.
        const userId = currentUser.uID || currentUser.userId || '';
        pushNotificationService.registerPushToken(currentUser.organization, userId).catch(() => {});
      }
      appStateRef.current = nextState;
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (isInitialized) {
      SplashScreen.hideAsync();
    }
  }, [isInitialized]);

  useEffect(() => {
    if (!isInitialized || !navigationState?.key) return;

    const inAuthGroup = segments[0] === '(auth)';

    if (!user && !inAuthGroup) {
      router.replace('/(auth)/login');
    } else if (user && inAuthGroup) {
      router.replace(getLandingRoute(user.Permissions, user.SecurityRole) as any);
    }
  }, [user, isInitialized, segments, navigationState?.key]);

  // Register for push notifications when user logs in
  useEffect(() => {
    if (!user?.organization) return;
    const userId = user.uID || user.userId || '';
    notificationService.registerForPushNotifications().then((token) => {
      if (token && user.organization) {
        notificationService.registerDeviceWithServer(user.organization, userId);
        pushNotificationService.registerPushToken(user.organization, userId);
      }
    }).catch(() => {});
  }, [user?.organization, user?.uID, user?.userId]);

  // Play sound when a push notification arrives while app is in foreground
  useEffect(() => {
    const sub = notificationService.addNotificationReceivedListener(() => {
      notificationSound.playMessageSound();
    });
    return () => sub.remove();
  }, []);

  // Handle notification tap and action buttons
  useEffect(() => {
    const sub = notificationService.addNotificationResponseListener(async (response) => {
      const data = response.notification.request.content.data;
      if (!data?.type) return;

      const actionId = response.actionIdentifier;

      // Handle task action buttons
      if ((data.type === 'taskAssigned' || data.type === 'taskReminder') && actionId && actionId !== Notifications.DEFAULT_ACTION_IDENTIFIER) {
        const org = user?.organization;
        if (actionId === 'MARK_COMPLETE' && data.taskId && org) {
          try {
            await axiosInstance.post(ENDPOINTS.COMPLETE_TASK, {
              organization: org,
              taskId: data.taskId,
            });
          } catch (e) { console.error('[Notification] Mark task complete failed:', e); }
          return;
        }
        if (actionId === 'CALL' && data.phoneNumber) {
          Linking.openURL(`tel:${data.phoneNumber}`);
          return;
        }
      }

      // Standard navigation on tap
      switch (data.type) {
        case 'incoming_call':
          router.push('/(tabs)/phone-calls');
          break;
        case 'incomingMessage':
          if (data.contactPhone) {
            router.push({ pathname: '/(tabs)/chats/[phoneNumber]', params: { phoneNumber: data.contactPhone } });
          } else {
            router.push('/(tabs)/chats');
          }
          break;
        case 'newLead':
        case 'leadAssigned':
          if (data.leadId) {
            router.push({ pathname: '/(tabs)/leads/[id]', params: { id: data.leadId } });
          } else {
            router.push('/(tabs)/leads');
          }
          break;
        case 'newCase':
        case 'caseAssigned':
          router.push('/(tabs)/cases');
          break;
        case 'newOrder':
        case 'newQuote':
          router.push('/(tabs)/more/quotes');
          break;
        case 'taskAssigned':
        case 'taskReminder':
          router.push('/(tabs)/more/tasks');
          break;
        case 'calendarEventReminder':
          router.push('/(tabs)/more/calendar');
          break;
        case 'gambotAiTransfer':
          if (data.contactPhone) {
            router.push({ pathname: '/(tabs)/chats/[phoneNumber]', params: { phoneNumber: data.contactPhone } });
          } else {
            router.push('/(tabs)/chats');
          }
          break;
        case 'internal_message':
          if (data.contactPhone || data.phoneNumber) {
            router.push({ pathname: '/(tabs)/chats/[phoneNumber]', params: { phoneNumber: (data.contactPhone || data.phoneNumber) as string } });
          } else {
            router.push('/(tabs)/chats');
          }
          break;
      }
    });
    return () => sub.remove();
  }, [user?.organization]);

  const isDark =
    themeSetting === 'dark' ||
    (themeSetting === 'system' && theme.dark);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <PaperProvider theme={theme}>
          <ErrorBoundary>
            <StatusBar style={isDark ? 'light' : 'dark'} />
            <Slot />
          </ErrorBoundary>
        </PaperProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
