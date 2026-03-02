import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { API_BASE_URL, ENDPOINTS } from '../../constants/api';
import { secureStorage, appStorage } from '../storage';
import { router } from 'expo-router';

const getAuthStore = () => require('../../stores/authStore').useAuthStore;

const CONFIG = {
  DEFAULT_TIMEOUT: 30000,
  UPLOAD_TIMEOUT: 120000,
  LONG_OPERATION_TIMEOUT: 60000,
  MAX_RETRIES: 3,
  RETRY_DELAY_BASE: 1000,
  RETRY_DELAY_MAX: 10000,
  CIRCUIT_THRESHOLD: 5,
  CIRCUIT_RESET_TIME: 30000,
};

const axiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: CONFIG.DEFAULT_TIMEOUT,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
  },
});

let circuitState = {
  isOpen: false,
  failures: 0,
  openedAt: null as number | null,
};

const checkCircuit = (): boolean => {
  if (!circuitState.isOpen) return true;
  const timeSinceOpened = Date.now() - (circuitState.openedAt || 0);
  if (timeSinceOpened > CONFIG.CIRCUIT_RESET_TIME) {
    return true;
  }
  return false;
};

const reportSuccess = () => {
  if (circuitState.failures > 0 || circuitState.isOpen) {
    circuitState = { isOpen: false, failures: 0, openedAt: null };
  }
};

const reportFailure = () => {
  circuitState.failures++;
  if (circuitState.failures >= CONFIG.CIRCUIT_THRESHOLD) {
    circuitState.isOpen = true;
    circuitState.openedAt = Date.now();
  }
};

let isRefreshing = false;
let failedQueue: Array<{
  resolve: (token: string) => void;
  reject: (error: any) => void;
}> = [];

const processQueue = (error: any, token: string | null = null) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else if (token) {
      prom.resolve(token);
    }
  });
  failedQueue = [];
};

const forceLogout = async () => {
  await appStorage.clearAll();
  delete axiosInstance.defaults.headers.common['Authorization'];
  try { getAuthStore().setState({ user: null, error: null }); } catch {}
  router.replace('/(auth)/login');
};

const refreshAndRetry = async (originalRequest: any) => {
  if (originalRequest._retry) {
    return Promise.reject(new Error('Already retried'));
  }

  if (isRefreshing) {
    return new Promise<string>((resolve, reject) => {
      failedQueue.push({ resolve, reject });
    }).then((token) => {
      originalRequest.headers['Authorization'] = 'Bearer ' + token;
      return axiosInstance(originalRequest);
    });
  }

  originalRequest._retry = true;
  isRefreshing = true;

  try {
    const refreshToken = await secureStorage.getRefreshToken();
    if (!refreshToken) throw new Error('No refresh token');

    const res = await axios.post(`${API_BASE_URL}${ENDPOINTS.REFRESH_TOKEN}`, {
      refreshToken,
    });

    if (!res?.data?.IdToken) {
      throw new Error('No IdToken in refresh response');
    }

    const newToken = res.data.IdToken;
    await secureStorage.setToken(newToken);

    const user = await appStorage.getUser();
    if (user) {
      user.authToken = newToken;
      await appStorage.setUser(user);
    }

    try {
      const authStore = getAuthStore();
      const storeUser = authStore.getState().user;
      if (storeUser) {
        authStore.setState({ user: { ...storeUser, authToken: newToken } });
      }
    } catch {}

    axiosInstance.defaults.headers.common['Authorization'] = 'Bearer ' + newToken;
    processQueue(null, newToken);

    originalRequest.headers['Authorization'] = 'Bearer ' + newToken;
    return axiosInstance(originalRequest);
  } catch (refreshError) {
    processQueue(refreshError, null);
    await forceLogout();
    return Promise.reject(refreshError);
  } finally {
    isRefreshing = false;
  }
};

// Request interceptor
axiosInstance.interceptors.request.use(
  async (config: InternalAxiosRequestConfig) => {
    if (!checkCircuit()) {
      return Promise.reject(
        new Error('Service temporarily unavailable. Please try again.')
      );
    }

    const token = await secureStorage.getToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    if (config.data instanceof FormData) {
      delete config.headers['Content-Type'];
    }

    const url = config.url || '';
    if (url.includes('upload') || url.includes('import') || config.data instanceof FormData) {
      config.timeout = CONFIG.UPLOAD_TIMEOUT;
    } else if (url.includes('campaign') || url.includes('bulk') || url.includes('export')) {
      config.timeout = CONFIG.LONG_OPERATION_TIMEOUT;
    }

    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor
axiosInstance.interceptors.response.use(
  async (response) => {
    reportSuccess();

    const data = response?.data;
    const msg = data?.Message || data?.message;
    const isTokenExpired =
      (typeof msg === 'string' && msg.includes('Firebase ID token expired')) ||
      (typeof data === 'string' && data.includes('Firebase ID token expired'));

    if (isTokenExpired) {
      return refreshAndRetry(response.config);
    }

    return response;
  },
  async (error: AxiosError) => {
    const isServerError = !error.response || (error.response?.status ?? 0) >= 500;
    const isTimeout = error.code === 'ECONNABORTED';
    const isNetworkError = error.message === 'Network Error';

    if (isServerError || isTimeout || isNetworkError) {
      reportFailure();
    }

    const status = error.response?.status;
    const originalRequest = error.config;
    const isRefreshEndpoint = originalRequest?.url?.includes('/refresh-token');

    if ((status === 401 || status === 403) && !isRefreshEndpoint && originalRequest) {
      return refreshAndRetry(originalRequest);
    }

    if ((status === 401 || status === 403) && isRefreshEndpoint) {
      await forceLogout();
    }

    return Promise.reject(error);
  }
);

export default axiosInstance;
