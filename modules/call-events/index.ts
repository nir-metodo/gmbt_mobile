import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';

export interface CallEventsConfig {
  enabled: boolean;
  baseUrl: string;
  token: string;
  organization: string;
  userId?: string;
  userName?: string;
  selfNumber?: string;
  reportOutgoing?: boolean;
  // Long-lived refresh token + endpoint so the native background sender can mint a fresh access
  // token on its own (Firebase ID tokens expire ~1h). Without these, a call that ends while the
  // app has been closed for over an hour would fail to POST (expired token) and only get delivered
  // — as a confusing batch — when the app is next opened.
  refreshToken?: string;
  refreshUrl?: string;
}

// `requireOptionalNativeModule` returns null when the native module isn't present
// (iOS, Expo Go, or an app build made before this module was added), so importing
// this on any platform is safe and never throws.
const Native = Platform.OS === 'android' ? requireOptionalNativeModule('CallEvents') : null;

export const CallEvents = {
  /** True only on an Android build that actually bundled the native module. */
  isSupported(): boolean {
    return !!Native && Native.isSupported?.() === true;
  },

  hasPermissions(): boolean {
    return !!Native && Native.hasPermissions?.() === true;
  },

  async requestPermissions(): Promise<boolean> {
    if (!Native) return false;
    try {
      return await Native.requestPermissions();
    } catch {
      return false;
    }
  },

  /** Whether the app is exempt from battery optimization — required for reliable background detection. */
  isIgnoringBatteryOptimizations(): boolean {
    return !!Native && Native.isIgnoringBatteryOptimizations?.() === true;
  },

  /** Opens the system battery-optimization exemption dialog. Resolves true if already exempt or shown. */
  async requestIgnoreBatteryOptimizations(): Promise<boolean> {
    if (!Native?.requestIgnoreBatteryOptimizations) return false;
    try {
      return await Native.requestIgnoreBatteryOptimizations();
    } catch {
      return false;
    }
  },

  configure(config: CallEventsConfig): void {
    Native?.configure?.(config);
  },

  getPending(): string {
    return (Native?.getPending?.() as string) ?? '';
  },

  clearPending(): void {
    Native?.clearPending?.();
  },

  /**
   * Reads finished calls from the system Call Log and reports any not-yet-sent ones to the backend.
   * Safety net for when the OS/OEM suppressed the real-time background broadcast. No-op off Android.
   */
  async scanRecentCalls(): Promise<boolean> {
    if (!Native?.scanRecentCalls) return false;
    try {
      return await Native.scanRecentCalls();
    } catch {
      return false;
    }
  },
};
