import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';

export interface PendingCallAction {
  action: 'answer';
  callId: string;
  from: string;
  name: string;
  at: number;
}

export type CallUiEvent = 'onCallAnswered' | 'onCallEnded' | 'onCallMuted' | 'onVoipToken';

// "CallUi" is the native incoming-call screen: Android = full-screen call notification woken by an FCM push, iPhone = CallKit woken by
// a PushKit VoIP push. null in Expo Go or in an app build made before this module existed - every method is then a safe no-op.
const Native: any = Platform.OS === 'android' || Platform.OS === 'ios' ? requireOptionalNativeModule('CallUi') : null;

export const CallUi = {
  /** True only on a build that bundled the native call screen. */
  isSupported(): boolean {
    return !!Native && Native.isSupported?.() === true;
  },

  /** The "Answer" the user pressed on the native call screen (read once; null when none or older than a minute). */
  consumePendingAction(): PendingCallAction | null {
    try {
      return (Native?.consumePendingAction?.() as PendingCallAction | null) ?? null;
    } catch {
      return null;
    }
  },

  hasPendingAction(): boolean {
    try {
      return !!Native && Native.hasPendingAction?.() === true;
    } catch {
      return false;
    }
  },

  /** The call was answered / ended in the app: remove the native notification / system call. */
  cancelIncoming(callId?: string | null): void {
    try {
      Native?.cancelIncoming?.(callId ?? null);
    } catch {
      /* ignore */
    }
  },

  /** Ends the system call (iPhone: CallKit) once the SIP call is over. */
  endCall(callId?: string | null): void {
    try {
      Native?.endCall?.(callId ?? null);
    } catch {
      /* ignore */
    }
  },

  /** iPhone: PushKit (VoIP) token of this device - registered on the backend so calls can wake the app. null elsewhere / not issued yet. */
  getVoipToken(): string | null {
    try {
      return (Native?.getVoipToken?.() as string | null) || null;
    } catch {
      return null;
    }
  },

  /** iPhone: debug builds use the APNs sandbox. */
  isVoipSandbox(): boolean {
    try {
      return Native?.isSandbox?.() === true;
    } catch {
      return false;
    }
  },

  /** Subscribe to native events (iPhone: onCallAnswered / onCallEnded / onCallMuted / onVoipToken). Returns the unsubscribe function. */
  addListener(event: CallUiEvent, cb: (payload: any) => void): () => void {
    try {
      const sub = Native?.addListener?.(event, cb);
      return () => { try { sub?.remove?.(); } catch { /* ignore */ } };
    } catch {
      return () => {};
    }
  },

  /** Android 14+: whether the app may show the call over the lock screen. */
  canUseFullScreenIntent(): boolean {
    try {
      return !Native || Native.canUseFullScreenIntent?.() !== false;
    } catch {
      return true;
    }
  },

  areNotificationsEnabled(): boolean {
    try {
      return !Native || Native.areNotificationsEnabled?.() !== false;
    } catch {
      return true;
    }
  },

  /** Xiaomi: the app's extra permissions page (pop-ups in the background / lock screen); elsewhere the app details page. false on a build without it. */
  openDevicePermissionSettings(): boolean {
    try {
      return !!Native && Native.openDevicePermissionSettings?.() === true;
    } catch {
      return false;
    }
  },

  /** The call notification channel's settings (sound, pop-up). false on a build without it. */
  openCallChannelSettings(): boolean {
    try {
      return !!Native && Native.openCallChannelSettings?.() === true;
    } catch {
      return false;
    }
  },

  openFullScreenIntentSettings(): boolean {
    try {
      return !!Native && Native.openFullScreenIntentSettings?.() === true;
    } catch {
      return false;
    }
  },
};
