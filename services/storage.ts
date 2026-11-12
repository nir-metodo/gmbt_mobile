import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { User } from '../types';

const SECURE_KEYS = {
  AUTH_TOKEN: 'auth_token',
  REFRESH_TOKEN: 'refresh_token',
  SAVED_EMAIL: 'saved_email',
  SAVED_PASSWORD: 'saved_password',
};

const STORAGE_KEYS = {
  USER: 'user',
  LANGUAGE: 'language',
  THEME: 'theme',
  DEVICE_TOKEN: 'device_token',
  CUSTOM_TABLES: 'custom_tables',
  REPORT_DEVICE_CALL_EVENTS: 'report_device_call_events',
  DEFAULT_SCREEN: 'default_screen',
  DEFAULT_DIALER: 'default_dialer',
  CALL_ALERT_SOUND: 'call_alert_sound',
  CALL_ALERT_VIBRATE: 'call_alert_vibrate',
};

export const secureStorage = {
  async setToken(token: string) {
    await SecureStore.setItemAsync(SECURE_KEYS.AUTH_TOKEN, token);
  },
  async getToken(): Promise<string | null> {
    return SecureStore.getItemAsync(SECURE_KEYS.AUTH_TOKEN);
  },
  async setRefreshToken(token: string) {
    await SecureStore.setItemAsync(SECURE_KEYS.REFRESH_TOKEN, token);
  },
  async getRefreshToken(): Promise<string | null> {
    return SecureStore.getItemAsync(SECURE_KEYS.REFRESH_TOKEN);
  },
  async clearTokens() {
    await SecureStore.deleteItemAsync(SECURE_KEYS.AUTH_TOKEN);
    await SecureStore.deleteItemAsync(SECURE_KEYS.REFRESH_TOKEN);
  },
  async setSavedCredentials(email: string, password: string) {
    await SecureStore.setItemAsync(SECURE_KEYS.SAVED_EMAIL, email);
    await SecureStore.setItemAsync(SECURE_KEYS.SAVED_PASSWORD, password);
  },
  async getSavedCredentials(): Promise<{ email: string; password: string } | null> {
    const email = await SecureStore.getItemAsync(SECURE_KEYS.SAVED_EMAIL);
    const password = await SecureStore.getItemAsync(SECURE_KEYS.SAVED_PASSWORD);
    if (email && password) return { email, password };
    return null;
  },
  async clearSavedCredentials() {
    await SecureStore.deleteItemAsync(SECURE_KEYS.SAVED_EMAIL);
    await SecureStore.deleteItemAsync(SECURE_KEYS.SAVED_PASSWORD);
  },
};

export const appStorage = {
  async setUser(user: User) {
    await AsyncStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(user));
  },
  async getUser(): Promise<User | null> {
    const data = await AsyncStorage.getItem(STORAGE_KEYS.USER);
    return data ? JSON.parse(data) : null;
  },
  async clearUser() {
    await AsyncStorage.removeItem(STORAGE_KEYS.USER);
  },

  async setLanguage(lang: 'en' | 'he') {
    await AsyncStorage.setItem(STORAGE_KEYS.LANGUAGE, lang);
  },
  async getLanguage(): Promise<'en' | 'he'> {
    const lang = await AsyncStorage.getItem(STORAGE_KEYS.LANGUAGE);
    return (lang as 'en' | 'he') || 'he';
  },

  async setTheme(theme: 'light' | 'dark' | 'system') {
    await AsyncStorage.setItem(STORAGE_KEYS.THEME, theme);
  },
  async getTheme(): Promise<'light' | 'dark' | 'system'> {
    const theme = await AsyncStorage.getItem(STORAGE_KEYS.THEME);
    return (theme as 'light' | 'dark' | 'system') || 'system';
  },

  async setDeviceToken(token: string) {
    await AsyncStorage.setItem(STORAGE_KEYS.DEVICE_TOKEN, token);
  },
  async getDeviceToken(): Promise<string | null> {
    return AsyncStorage.getItem(STORAGE_KEYS.DEVICE_TOKEN);
  },

  async setReportDeviceCallEvents(enabled: boolean) {
    await AsyncStorage.setItem(STORAGE_KEYS.REPORT_DEVICE_CALL_EVENTS, enabled ? '1' : '0');
  },
  async getReportDeviceCallEvents(): Promise<boolean> {
    return (await AsyncStorage.getItem(STORAGE_KEYS.REPORT_DEVICE_CALL_EVENTS)) === '1';
  },

  // In-app call alerts (sound / vibration). Both default to ON.
  async setCallAlertSound(enabled: boolean) {
    await AsyncStorage.setItem(STORAGE_KEYS.CALL_ALERT_SOUND, enabled ? '1' : '0');
  },
  async getCallAlertSound(): Promise<boolean> {
    return (await AsyncStorage.getItem(STORAGE_KEYS.CALL_ALERT_SOUND)) !== '0';
  },
  async setCallAlertVibrate(enabled: boolean) {
    await AsyncStorage.setItem(STORAGE_KEYS.CALL_ALERT_VIBRATE, enabled ? '1' : '0');
  },
  async getCallAlertVibrate(): Promise<boolean> {
    return (await AsyncStorage.getItem(STORAGE_KEYS.CALL_ALERT_VIBRATE)) !== '0';
  },

  // The user's preferred landing screen when opening the app. Empty string = "auto" (first
  // permitted screen). Stored as a route string like "/(tabs)/more/catalog".
  async setDefaultScreen(route: string) {
    await AsyncStorage.setItem(STORAGE_KEYS.DEFAULT_SCREEN, route || '');
  },
  async getDefaultScreen(): Promise<string> {
    return (await AsyncStorage.getItem(STORAGE_KEYS.DEFAULT_SCREEN)) || '';
  },

  // Which dialer every "call" button opens first: the organization's system dialer ('system') or the phone's own ('phone').
  // Empty = automatic (the system dialer when the org has a calling solution, else the phone's).
  async setDefaultDialer(value: 'system' | 'phone' | '') {
    await AsyncStorage.setItem(STORAGE_KEYS.DEFAULT_DIALER, value || '');
  },
  async getDefaultDialer(): Promise<'system' | 'phone' | ''> {
    const v = await AsyncStorage.getItem(STORAGE_KEYS.DEFAULT_DIALER);
    return v === 'system' || v === 'phone' ? v : '';
  },

  async clearAll() {
    await AsyncStorage.multiRemove(Object.values(STORAGE_KEYS));
    await secureStorage.clearTokens();
    await secureStorage.clearSavedCredentials();
  },
};
