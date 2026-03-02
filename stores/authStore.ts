import { create } from 'zustand';
import type { User } from '../types';
import { authApi } from '../services/api/auth';
import { appStorage, secureStorage } from '../services/storage';
import WebSocketService from '../services/websocket';
import i18n from '../i18n';

interface AuthState {
  user: User | null;
  isLoading: boolean;
  isInitialized: boolean;
  error: string | null;

  initialize: () => Promise<void>;
  login: (email: string, password: string, organization?: string) => Promise<void>;
  logout: () => Promise<void>;
  forgotPassword: (email: string) => Promise<boolean>;
  clearError: () => void;
  updateUser: (updates: Partial<User>) => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  isLoading: false,
  isInitialized: false,
  error: null,

  initialize: async () => {
    try {
      const user = await appStorage.getUser();
      const token = await secureStorage.getToken();

      if (user && token) {
        user.authToken = token;
        const lang = await appStorage.getLanguage();
        i18n.changeLanguage(lang);
        set({ user, isInitialized: true });
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
      set({ user: null, error: null });
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
}));
