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
    reportOutgoing: false,
  });

  await flushPendingDeviceCallEvents();
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
  return CallEvents.hasPermissions();
}

export function disableDeviceCallEvents(): void {
  if (!CallEvents.isSupported()) return;
  CallEvents.configure({
    enabled: false,
    baseUrl: API_BASE_URL,
    token: '',
    organization: '',
  });
}
