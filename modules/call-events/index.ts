import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';

export interface CallEventsConfig {
  enabled: boolean;
  baseUrl: string;
  token: string;
  organization: string;
  reportOutgoing?: boolean;
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

  configure(config: CallEventsConfig): void {
    Native?.configure?.(config);
  },

  getPending(): string {
    return (Native?.getPending?.() as string) ?? '';
  },

  clearPending(): void {
    Native?.clearPending?.();
  },
};
