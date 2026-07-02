import { Platform } from 'react-native';
import { CallEvents } from '../modules/call-events';
import { API_BASE_URL, ENDPOINTS } from '../constants/api';
import { secureStorage } from './storage';
import { useAuthStore } from '../stores/authStore';
import { useSettingsStore } from '../stores/settingsStore';
import axiosInstance from './api/axiosInstance';

/**
 * Pushes the current auth/org/token + enabled flag down to the native call-event
 * receiver, and flushes any events the receiver couldn't deliver itself (e.g. when the
 * stored token had expired while the app was killed). Safe to call on any platform —
 * it no-ops when the native module isn't present (iOS / pre-rebuild builds).
 */
export async function syncDeviceCallEventsConfig(): Promise<void> {
  if (!CallEvents.isSupported()) return;

  const enabled = useSettingsStore.getState().reportDeviceCallEventsEnabled;
  const user = useAuthStore.getState().user;
  const token = (await secureStorage.getToken()) || '';
  // Long-lived refresh token so the native receiver can mint a fresh access token by itself when a
  // call ends after the short-lived (~1h) access token has expired in the background. This is what
  // makes real-time reporting keep working even when the app has been closed for a long time.
  const refreshToken = (await secureStorage.getRefreshToken()) || '';

  CallEvents.configure({
    enabled: !!enabled && !!user?.organization,
    baseUrl: API_BASE_URL,
    token,
    refreshToken,
    refreshUrl: `${API_BASE_URL}${ENDPOINTS.REFRESH_TOKEN}`,
    organization: user?.organization || '',
    // Attribute device call events to the logged-in app user so automations can target
    // the specific salesperson whose phone took/missed the call (multi-agent orgs).
    userId: user?.userId || user?.uID || '',
    userName: user?.fullname || '',
    // The "to" of an incoming device call = this agent's own line (the device can't read its own
    // number reliably), used for display and optional number-filtering in botomations.
    selfNumber: user?.phoneNumber || (user as any)?.PhoneNumber || user?.wabaNumber || '',
    reportOutgoing: false,
  });

  await flushPendingDeviceCallEvents();

  // Safety net: scan the system Call Log for any calls the real-time background receiver missed
  // (OEMs like Xiaomi/Samsung/Huawei routinely suppress background broadcast receivers). This runs
  // on every foreground, so a missed/answered call is reported as soon as the user opens the app.
  if (enabled && user?.organization) {
    await CallEvents.scanRecentCalls();
  }
}

// Mirror of CallReporter.FRESH_WINDOW_MS (native). A pending event older than this is dropped on
// flush instead of being delivered late: if a call wasn't reported right after it ended, we don't
// fire a stale notification hours later (the typical cause: the stored token expired in the
// background, so every real-time POST 401'd and queued — then flushed as one batch on app open).
const FRESH_WINDOW_MS = 5 * 60 * 1000;

/** Extracts the call END time (ms) from a queued event body, or null if it can't be derived. */
function pendingEventEndMs(ev: any): number | null {
  // callId format: "dev_{digits}_{callStartMs}" or "dev_ring_{digits}_{ms}" → trailing token is the ms.
  const startMs = Number(String(ev?.callId ?? '').split('_').pop());
  if (!Number.isFinite(startMs) || startMs <= 0) return null;
  return startMs + (Number(ev?.durationSeconds) || 0) * 1000;
}

/** Re-sends events the native receiver queued after a failed delivery, using a fresh token. */
async function flushPendingDeviceCallEvents(): Promise<void> {
  try {
    const raw = CallEvents.getPending();
    if (!raw) return;
    const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
    const now = Date.now();
    for (const line of lines) {
      try {
        const ev = JSON.parse(line);
        // Drop stale queued events — only deliver ones that ended within the freshness window.
        const endMs = pendingEventEndMs(ev);
        if (endMs != null && now - endMs > FRESH_WINDOW_MS) continue;
        await axiosInstance.post(ENDPOINTS.REPORT_DEVICE_CALL_EVENT, ev);
      } catch {
        // leave remaining ones queued for the next flush
      }
    }
    CallEvents.clearPending();
  } catch {
    // ignore
  }
}

/** Turns detection on: requests the Android permissions, then pushes config. Returns whether granted. */
export async function enableDeviceCallEvents(): Promise<boolean> {
  if (!CallEvents.isSupported()) return false;
  if (!CallEvents.hasPermissions()) {
    await CallEvents.requestPermissions();
  }
  // Battery-optimization exemption is what keeps the foreground service (and therefore call
  // detection) alive for hours while the app is closed — without it, aggressive OEMs kill the
  // process and calls only reach the server after the app is re-opened. Ask once on enable.
  try {
    if (!CallEvents.isIgnoringBatteryOptimizations()) {
      await CallEvents.requestIgnoreBatteryOptimizations();
    }
  } catch {
    // non-fatal — detection still works, just less reliably on some OEMs
  }
  await syncDeviceCallEventsConfig();
  const granted = CallEvents.hasPermissions();
  // Persist state to the DB so admins can see/verify which devices report calls.
  reportDeviceCallReportingState(true, granted);
  return granted;
}

export function disableDeviceCallEvents(): void {
  if (!CallEvents.isSupported()) return;
  CallEvents.configure({
    enabled: false,
    baseUrl: API_BASE_URL,
    token: '',
    organization: '',
  });
  reportDeviceCallReportingState(false, false);
}

/** Records the toggle state server-side (visible in DB + activity log). Best-effort, never throws. */
function reportDeviceCallReportingState(enabled: boolean, hasPermissions: boolean): void {
  try {
    const user = useAuthStore.getState().user;
    if (!user?.organization) return;
    axiosInstance
      .post(ENDPOINTS.SET_DEVICE_CALL_REPORTING, {
        organization: user.organization,
        enabled,
        hasPermissions,
        platform: Platform.OS,
        userId: user.userId || user.uID || '',
        userName: user.fullname || '',
      })
      .catch(() => {});
  } catch {
    // ignore — local state is the source of truth for the receiver
  }
}
