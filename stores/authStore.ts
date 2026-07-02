import { create } from 'zustand';
import type { User } from '../types';
import { authApi } from '../services/api/auth';
import { appStorage, secureStorage } from '../services/storage';
import WebSocketService from '../services/websocket';
import axiosInstance, { setTokenCache } from '../services/api/axiosInstance';
import { ENDPOINTS } from '../constants/api';
import { pushNotificationService } from '../services/pushNotifications';
import { resetLocalDb } from '../services/db/repository';
import i18n from '../i18n';

export interface OrgFeatureToggles {
  [key: string]: boolean;
}

// Login failures often surface as raw Firebase/Google Identity Toolkit dumps
// (e.g. "INVALID_LOGIN_CREDENTIALS", a full verifyPassword URL, or a stack trace).
// We never want to show those to the user, so map known patterns to friendly,
// localized messages and fall back to a generic one for anything unexpected.
const mapAuthError = (error: any): string => {
  const errorCode = error?.response?.data?.ErrorCode;
  switch (errorCode) {
    case 'invalid_credentials':
      return i18n.t('login.invalidCredentials');
    case 'trial_expired':
      return i18n.t('login.trialExpired');
    case 'suspended':
      return i18n.t('login.accountSuspended');
  }

  const rawMessage =
    error?.response?.data?.Message || error?.message || '';
  const normalized = String(rawMessage).toUpperCase();

  if (
    normalized.includes('INVALID_LOGIN_CREDENTIALS') ||
    normalized.includes('INVALID_PASSWORD') ||
    normalized.includes('INVALID_EMAIL') ||
    normalized.includes('WRONG_PASSWORD') ||
    normalized.includes('INVALID_CREDENTIAL')
  ) {
    return i18n.t('login.invalidCredentials');
  }
  if (
    normalized.includes('EMAIL_NOT_FOUND') ||
    normalized.includes('USER_NOT_FOUND') ||
    normalized.includes('USER_DISABLED')
  ) {
    return i18n.t('login.invalidCredentials');
  }
  if (
    normalized.includes('TOO_MANY_ATTEMPTS') ||
    normalized.includes('TOO_MANY_REQUESTS')
  ) {
    return i18n.t('login.tooManyAttempts');
  }
  if (
    normalized.includes('NETWORK') ||
    normalized.includes('TIMEOUT') ||
    error?.code === 'ECONNABORTED' ||
    error?.code === 'ERR_NETWORK'
  ) {
    return i18n.t('login.networkError');
  }

  // A short, clean backend message is fine to surface; anything that looks like a
  // raw dump (URLs, JSON, exception text, very long strings) is replaced.
  const looksLikeDump =
    !rawMessage ||
    rawMessage.length > 120 ||
    /https?:\/\//i.test(rawMessage) ||
    /[{}\[\]]/.test(rawMessage) ||
    /exception|firebase|identitytoolkit|relyingparty/i.test(rawMessage);

  return looksLikeDump ? i18n.t('login.loginError') : rawMessage;
};

interface AuthState {
  user: User | null;
  isLoading: boolean;
  isInitialized: boolean;
  error: string | null;
  orgFeatureToggles: OrgFeatureToggles;

  initialize: () => Promise<void>;
  login: (email: string, password: string, organization?: string) => Promise<void>;
  logout: () => Promise<void>;
  forgotPassword: (email: string) => Promise<boolean>;
  clearError: () => void;
  updateUser: (updates: Partial<User>) => Promise<void>;
  fetchOrgFeatureToggles: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  isLoading: false,
  isInitialized: false,
  error: null,
  orgFeatureToggles: {},

  initialize: async () => {
    try {
      const [user, token] = await Promise.all([
        appStorage.getUser(),
        secureStorage.getToken(),
      ]);

      if (user && token) {
        user.authToken = token;
        setTokenCache(token);
        const lang = await appStorage.getLanguage();
        i18n.changeLanguage(lang);
        set({ user, isInitialized: true });

        pushNotificationService
          .registerPushTokenWithRetry(user.organization, user.uID || user.userId)
          .catch(() => {});
        get().fetchOrgFeatureToggles().catch(() => {});
      } else {
        set({ isInitialized: true });
      }
    } catch {
      set({ isInitialized: true });
    }
  },

  login: async (email, password, organization?) => {
    set({ isLoading: true, error: null });
    try {
      const user = await authApi.login(email, password, organization);
      i18n.changeLanguage(user.language);
      set({ user, isLoading: false });

      pushNotificationService
        .registerPushTokenWithRetry(user.organization, user.uID || user.userId)
        .catch(() => {});
      get().fetchOrgFeatureToggles().catch(() => {});
    } catch (error: any) {
      const errorMessage = mapAuthError(error);
      set({ isLoading: false, error: errorMessage });
      throw new Error(errorMessage);
    }
  },

  logout: async () => {
    const currentUser = get().user;
    try {
      WebSocketService.closeAll();
      // Detach this device's push token from the current account BEFORE clearing auth, so the
      // user stops receiving the previous account's notifications after switching accounts.
      if (currentUser?.organization) {
        await pushNotificationService
          .unregisterPushToken(currentUser.organization, currentUser.uID || currentUser.userId)
          .catch(() => {});
      }
      await authApi.logout();
    } finally {
      setTokenCache(null);
      // Wipe the on-device cache so one account's contacts/messages never leak into the next.
      resetLocalDb().catch(() => {});
      set({ user: null, error: null, orgFeatureToggles: {} });
    }
  },

  forgotPassword: async (email) => {
    set({ isLoading: true, error: null });
    try {
      const result = await authApi.forgotPassword(email);
      set({ isLoading: false });
      return result;
    } catch (error: any) {
      set({
        isLoading: false,
        error: error.message || i18n.t('login.recoveryError'),
      });
      return false;
    }
  },

  clearError: () => set({ error: null }),

  updateUser: async (updates) => {
    const currentUser = get().user;
    if (!currentUser) return;
    const updatedUser = { ...currentUser, ...updates };
    await appStorage.setUser(updatedUser);
    set({ user: updatedUser });
  },

  fetchOrgFeatureToggles: async () => {
    const user = get().user;
    if (!user?.organization) return;
    try {
      const res = await axiosInstance.post(ENDPOINTS.GET_FEATURE_TOGGLES, { organization: user.organization });
      if (res.data?.Success && res.data?.Data) {
        set({ orgFeatureToggles: res.data.Data });
      }
    } catch {
      // Silently fail - defaults will apply
    }
  },
}));
