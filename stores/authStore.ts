import { create } from 'zustand';
import type { User } from '../types';
import { authApi } from '../services/api/auth';
import { appStorage, secureStorage } from '../services/storage';
import WebSocketService from '../services/websocket';
import axiosInstance, { setTokenCache } from '../services/api/axiosInstance';
import { ENDPOINTS } from '../constants/api';
import { pushNotificationService } from '../services/pushNotifications';
import i18n from '../i18n';

export interface OrgFeatureToggles {
  [key: string]: boolean;
}

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
          .registerPushToken(user.organization, user.uID || user.userId)
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
        .registerPushToken(user.organization, user.uID || user.userId)
        .catch(() => {});
      get().fetchOrgFeatureToggles().catch(() => {});
    } catch (error: any) {
      const errorCode = error.response?.data?.ErrorCode;
      let errorMessage: string;

      switch (errorCode) {
        case 'invalid_credentials':
          errorMessage = i18n.t('login.invalidCredentials');
          break;
        case 'trial_expired':
          errorMessage = i18n.t('login.trialExpired');
          break;
        case 'suspended':
          errorMessage = i18n.t('login.accountSuspended');
          break;
        default:
          errorMessage = error.response?.data?.Message || error.message || i18n.t('login.loginError');
      }

      set({ isLoading: false, error: errorMessage });
      throw new Error(errorMessage);
    }
  },

  logout: async () => {
    try {
      WebSocketService.closeAll();
      await authApi.logout();
    } finally {
      setTokenCache(null);
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
