import axios from 'axios';
import { API_BASE_URL, ENDPOINTS } from '../../constants/api';
import axiosInstance from './axiosInstance';
import { secureStorage, appStorage } from '../storage';
import type { User } from '../../types';

interface AuthResponse {
  Success: boolean;
  Message?: string;
  userData: any;
  userCredential: {
    Uid: string;
    Credential: {
      IdToken: string;
      RefreshToken: string;
    };
    photoURL?: string;
  };
}

export const authApi = {
  async login(email: string, password: string, organization?: string): Promise<User> {
    const isInfoUser = email === 'info@gambot.co.il';
    const endpoint = isInfoUser ? ENDPOINTS.AUTHENTICATE_BY_ORG : ENDPOINTS.AUTHENTICATE;
    const payload = isInfoUser
      ? { username: email, password, organization }
      : { username: email, password };

    const response = await axios.post<AuthResponse>(`${API_BASE_URL}${endpoint}`, payload);
    const data = response.data;

    if (!data?.Success) {
      throw new Error(data?.Message || 'Login failed');
    }

    const userData = data.userData;
    const token = data.userCredential?.Credential?.IdToken;
    const refreshToken = data.userCredential?.Credential?.RefreshToken;

    if (!userData || !token) {
      throw new Error('Invalid response data');
    }

    const rawLanguage = (userData?.Language || userData?.language || 'hebrew').toLowerCase();
    const userLanguage: 'en' | 'he' =
      rawLanguage === 'english' || rawLanguage === 'en' ? 'en' : 'he';

    const user: User = {
      fullname: userData.UserName || userData.userName || email,
      email: userData.UserEmail || userData.userEmail || email,
      photoURL: data.userCredential?.photoURL || null,
      userId: data.userCredential?.Uid || userData.uID,
      organization: isInfoUser ? (organization || '') : (userData.Organization || userData.organization),
      wabaNumber: userData.wabaNumber || null,
      timeZone: userData?.timeZone || null,
      phoneNumber: userData?.PhoneNumber || userData?.phoneNumber || null,
      uID: userData?.uID || null,
      Email: userData?.Email || userData?.email || email,
      PhoneNumber: userData?.PhoneNumber || userData?.phoneNumber || null,
      authToken: token,
      refreshToken: refreshToken || null,
      SecurityRole: userData?.SecurityRole || userData?.securityRole || 'Admin',
      Permissions: userData?.Permissions || userData?.permissions || null,
      hasItsOwnSim: userData?.hasItsOwnSim || false,
      planName: userData?.PlanName || userData?.planName || null,
      language: userLanguage,
      Language: userLanguage,
      DataVisibility: userData?.DataVisibility || userData?.dataVisibility || undefined,
    };

    await secureStorage.setToken(token);
    if (refreshToken) {
      await secureStorage.setRefreshToken(refreshToken);
    }
    await appStorage.setUser(user);
    await appStorage.setLanguage(userLanguage);

    return user;
  },

  async forgotPassword(email: string): Promise<boolean> {
    const response = await axios.post(`${API_BASE_URL}${ENDPOINTS.FORGOT_PASSWORD}`, {
      email,
    });
    return response.data?.Success === true;
  },

  async logout(): Promise<void> {
    try {
      const deviceToken = await appStorage.getDeviceToken();
      const user = await appStorage.getUser();
      if (deviceToken && user) {
        await axiosInstance.post(ENDPOINTS.UNREGISTER_DEVICE, {
          organization: user.organization,
          deviceToken,
          platform: 'mobile',
        }).catch(() => {});
      }
    } finally {
      await appStorage.clearAll();
    }
  },

  async checkHealth(): Promise<boolean> {
    try {
      const response = await axios.get(`${API_BASE_URL}${ENDPOINTS.HEALTH}`, {
        timeout: 5000,
      });
      return response.status === 200;
    } catch {
      return false;
    }
  },
};
