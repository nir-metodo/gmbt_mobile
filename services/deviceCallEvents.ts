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

  CallEvents.configure({
    enabled: !!enabled && !!user?.organization,
    baseUrl: API_BASE_URL,
    token,
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

/** Re-sends events the native receiver queued after a failed delivery, using a fresh token. */
async function flushPendingDeviceCallEvents(): Promise<void> {
  try {
    const raw = CallEvents.getPending();
    if (!raw) return;
    const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      try {
        const ev = JSON.parse(line);
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
