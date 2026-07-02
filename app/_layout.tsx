import { useCallback, useEffect, useRef } from 'react';
import { AppState, AppStateStatus, I18nManager, Linking } from 'react-native';
import { Slot, router, useSegments, useRootNavigationState } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { PaperProvider } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useAuthStore } from '../stores/authStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useChatStore } from '../stores/chatStore';
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
import { syncDeviceCallEventsConfig } from '../services/deviceCallEvents';
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

        // Keep the Android call-event receiver's stored token/config fresh, and flush any
        // events it queued while the app was backgrounded/killed. No-op on iOS / pre-rebuild.
        syncDeviceCallEventsConfig().catch(() => {});

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

    // Push the freshly-authenticated org/token down to the Android call-event receiver.
    syncDeviceCallEventsConfig().catch(() => {});
  }, [user?.organization, user?.uID, user?.userId]);

  // Play sound when a push notification arrives while app is in foreground
  useEffect(() => {
    const sub = notificationService.addNotificationReceivedListener(() => {
      notificationSound.playMessageSound();
    });
    return () => sub.remove();
  }, []);

  // Mirror the in-app unread count onto the OS app-icon badge (the number/dot shown on the
  // launcher icon). This is the same count that drives the in-app Chats tab badge, so the
  // icon stays in sync: it appears when there are unread conversations and clears to 0 the
  // moment they're read. Updates whenever the store's unreadCount changes (chat load, WS
  // message, mark as read/unread).
  const unreadCount = useChatStore((s) => s.unreadCount);
  useEffect(() => {
    notificationService.setBadgeCount(unreadCount ?? 0).catch(() => {});
  }, [unreadCount]);

  // Notification taps that launch the app from a KILLED/background state are delivered via
  // getLastNotificationResponseAsync() — NOT through the runtime listener below (which only
  // catches taps while JS is already running). Without handling the cold-start response the
  // app just opened to its default tab (the chat list), so tapping an "incoming message" push
  // dropped the user on the list instead of the specific chat. We also guard navigation until
  // the root navigator is mounted, otherwise an early router.push() is silently dropped.
  const handledNotifIdsRef = useRef<Set<string>>(new Set());
  const pendingResponseRef = useRef<Notifications.NotificationResponse | null>(null);

  const handleNotificationResponse = useCallback(async (response: Notifications.NotificationResponse) => {
      const data = response.notification.request.content.data;
      if (!data?.type) return;

      // Dedupe: a cold-start tap can surface both via getLastNotificationResponseAsync and the
      // runtime listener. Process each physical notification at most once.
      const notifId = response.notification.request.identifier;
      if (notifId) {
        if (handledNotifIdsRef.current.has(notifId)) return;
        handledNotifIdsRef.current.add(notifId);
      }

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
        case 'contactAssigned':
          if (data.contactPhone || data.phoneNumber) {
            router.push({ pathname: '/(tabs)/chats/[phoneNumber]', params: { phoneNumber: (data.contactPhone || data.phoneNumber) as string } });
          } else {
            router.push('/(tabs)/chats');
          }
          break;
        case 'newOrder':
        case 'newQuote':
        case 'orderAssigned':
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
  }, [user?.organization]);

  // Try to navigate for a pending notification response, but only once the root navigator is
  // mounted. If it isn't ready yet we keep the response in pendingResponseRef and retry when
  // navigationState becomes available (see effect below).
  const tryHandlePending = useCallback(() => {
    const pending = pendingResponseRef.current;
    if (!pending) return;
    if (!navigationState?.key) return; // navigator not ready — retry later
    pendingResponseRef.current = null;
    handleNotificationResponse(pending);
  }, [navigationState?.key, handleNotificationResponse]);

  // Runtime listener: taps while the app is already running (foreground/background).
  useEffect(() => {
    const sub = notificationService.addNotificationResponseListener((response) => {
      pendingResponseRef.current = response;
      tryHandlePending();
    });
    return () => sub.remove();
  }, [tryHandlePending]);

  // Cold start: the tap that LAUNCHED the app is only available here, not via the listener.
  useEffect(() => {
    let cancelled = false;
    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (cancelled || !response) return;
        pendingResponseRef.current = response;
        tryHandlePending();
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [tryHandlePending]);

  // Flush any pending response once the navigator is ready (and the user is loaded so the
  // target route's auth gating lets the deep link through instead of bouncing to login).
  useEffect(() => {
    tryHandlePending();
  }, [navigationState?.key, user?.organization, tryHandlePending]);

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
