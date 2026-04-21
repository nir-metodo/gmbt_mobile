import { useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
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
import { ErrorBoundary } from '../components/ErrorBoundary';
import { notificationService } from '../services/notifications';
import '../i18n';

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
      router.replace('/(tabs)/chats');
    }
  }, [user, isInitialized, segments, navigationState?.key]);

  // Register for push notifications when user logs in
  useEffect(() => {
    if (!user?.organization) return;
    notificationService.registerForPushNotifications().then((token) => {
      if (token && user.organization) {
        notificationService.registerDeviceWithServer(
          user.organization,
          user.uID || user.userId || '',
        );
      }
    }).catch(() => {});
  }, [user?.organization, user?.uID, user?.userId]);

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
