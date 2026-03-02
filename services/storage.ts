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

  async clearAll() {
    await AsyncStorage.multiRemove(Object.values(STORAGE_KEYS));
    await secureStorage.clearTokens();
    await secureStorage.clearSavedCredentials();
  },
};
