import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { API_BASE_URL, ENDPOINTS } from '../../constants/api';
import { secureStorage, appStorage } from '../storage';
import { router } from 'expo-router';

const getAuthStore = () => require('../../stores/authStore').useAuthStore;

// In-memory token cache — avoids expensive SecureStore reads on every request
let _cachedToken: string | null = null;

export const setTokenCache = (token: string | null) => {
  _cachedToken = token;
};

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

// ── JWT expiry helpers ─────────────────────────────────────────────────────
// Firebase ID tokens last ~1h. Screens can render cached data for a long time
// with no network call, so the token silently expires; the next write (e.g.
// creating a task) would otherwise be sent with a dead token. We decode the
// token's `exp` claim and refresh proactively before it expires.
const PROACTIVE_REFRESH_SKEW_MS = 90_000; // refresh ~90s before actual expiry
const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const base64UrlDecode = (input: string): string => {
  let str = input.replace(/-/g, '+').replace(/_/g, '/');
  let output = '';
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === '=') break;
    const idx = B64_CHARS.indexOf(ch);
    if (idx === -1) continue;
    buffer = (buffer << 6) | idx;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      output += String.fromCharCode((buffer >> bits) & 0xff);
    }
  }
  return output;
};

// Returns the token's expiry in ms since epoch, or 0 if it can't be parsed.
const getTokenExpMs = (token: string): number => {
  try {
    const payload = token.split('.')[1];
    if (!payload) return 0;
    const obj = JSON.parse(base64UrlDecode(payload));
    return typeof obj?.exp === 'number' ? obj.exp * 1000 : 0;
  } catch {
    return 0;
  }
};

// Unknown expiry (0) → don't pre-refresh; let the reactive path handle it.
const isTokenExpiredSoon = (token: string): boolean => {
  const exp = getTokenExpMs(token);
  if (!exp) return false;
  return Date.now() >= exp - PROACTIVE_REFRESH_SKEW_MS;
};

const isRefreshEndpoint = (url?: string) => !!url && url.includes('/refresh-token');

// Detects token-expiry signalled in any response shape (Message/message/error
// fields or raw string), so a 200/500 carrying an "expired token" message still
// triggers a refresh+retry instead of failing the user out.
const responseSignalsExpiredToken = (data: any): boolean => {
  const msg =
    typeof data === 'string'
      ? data
      : (data?.Message || data?.message || data?.error || '');
  return (
    typeof msg === 'string' &&
    /(firebase id token expired|expired firebase token|invalid or expired firebase token|token has expired|id token has expired)/i.test(
      msg,
    )
  );
};

// Performs the actual refresh-token exchange and propagates the new token to all
// caches/stores. Throws if it can't obtain a fresh token.
const performTokenRefresh = async (): Promise<string> => {
  const refreshToken = await secureStorage.getRefreshToken();
  if (!refreshToken) throw new Error('No refresh token');

  const res = await axios.post(`${API_BASE_URL}${ENDPOINTS.REFRESH_TOKEN}`, {
    refreshToken,
  });

  if (!res?.data?.IdToken) {
    throw new Error('No IdToken in refresh response');
  }

  const newToken = res.data.IdToken;
  _cachedToken = newToken;
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
  return newToken;
};

// Shared, de-duplicated refresh: concurrent callers wait on a single in-flight
// refresh instead of each firing their own. Returns the fresh token.
const ensureFreshToken = async (): Promise<string> => {
  if (isRefreshing) {
    return new Promise<string>((resolve, reject) => {
      failedQueue.push({ resolve, reject });
    });
  }
  isRefreshing = true;
  try {
    const newToken = await performTokenRefresh();
    processQueue(null, newToken);
    return newToken;
  } catch (err) {
    processQueue(err, null);
    throw err;
  } finally {
    isRefreshing = false;
  }
};

const refreshAndRetry = async (originalRequest: any) => {
  if (originalRequest._retry) {
    return Promise.reject(new Error('Already retried'));
  }

  if (isRefreshing) {
    return new Promise<string>((resolve, reject) => {
      failedQueue.push({ resolve, reject });
    }).then((token) => {
      originalRequest._retry = true;
      originalRequest.headers['Authorization'] = 'Bearer ' + token;
      return axiosInstance(originalRequest);
    });
  }

  originalRequest._retry = true;

  try {
    const newToken = await ensureFreshToken();
    originalRequest.headers['Authorization'] = 'Bearer ' + newToken;
    return axiosInstance(originalRequest);
  } catch (refreshError) {
    await forceLogout();
    return Promise.reject(refreshError);
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

    let token = _cachedToken ?? await secureStorage.getToken();

    // Proactively refresh an expired/expiring token before the request goes out,
    // so writes like "create task" never travel with a dead token (which would
    // otherwise fail or bounce the user to the login screen).
    if (token && !isRefreshEndpoint(config.url) && isTokenExpiredSoon(token)) {
      try {
        token = await ensureFreshToken();
      } catch {
        // Couldn't refresh proactively — fall back to the existing token and let
        // the reactive 401/expiry handler deal with it (incl. logout if needed).
      }
    }

    if (token) {
      _cachedToken = token;
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

    if (responseSignalsExpiredToken(response?.data) && !isRefreshEndpoint(response.config?.url)) {
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
    const onRefreshEndpoint = isRefreshEndpoint(originalRequest?.url);

    // Treat 401/403 OR any "expired token" payload (which some endpoints return
    // as a 500 with the message in an `error` field) as a refresh signal.
    const expired = responseSignalsExpiredToken(error.response?.data);

    if ((status === 401 || status === 403 || expired) && !onRefreshEndpoint && originalRequest) {
      return refreshAndRetry(originalRequest);
    }

    if ((status === 401 || status === 403) && onRefreshEndpoint) {
      await forceLogout();
    }

    return Promise.reject(error);
  }
);

export default axiosInstance;
