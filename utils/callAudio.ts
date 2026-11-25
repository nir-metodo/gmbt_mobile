import { DeviceEventEmitter, PermissionsAndroid, Platform } from 'react-native';
import { Audio } from 'expo-av';

/**
 * Where the in-app call's audio comes out on Android: a Bluetooth / wired headset when one is connected, otherwise the earpiece
 * (like a normal phone call), or the loudspeaker when the user asks for it.
 *
 * Why this is needed: expo-av applies its audio mode to the whole phone on every Audio.setAudioModeAsync call, and its default
 * (playThroughEarpieceAndroid: false) switches the speakerphone ON. The app calls it for the ring sound, voice notes, recording
 * playback and the message sound, so a call that is answered through the app ended up on the loudspeaker with no way back.
 *
 * Headsets: expo-av only knows "earpiece" or "speaker" - it never starts a Bluetooth (SCO) link, so a Bluetooth headset got no
 * call audio. For the duration of a call the route is therefore handed to react-native-incall-manager (automatic routing:
 * Bluetooth > wired > earpiece, speaker only on request). That needs the BLUETOOTH_CONNECT permission on Android 12+, which is
 * requested when the call starts. A build without the native module (older install) falls back to the expo-av earpiece/speaker.
 */
/** Android and iOS (on iOS the same react-native-incall-manager override sits on top of WebRTC's own audio session). */
export const isSpeakerSupported = Platform.OS === 'android' || Platform.OS === 'ios';

type InCallManagerLike = {
  start: (setup?: { auto?: boolean; media?: 'audio' | 'video'; ringback?: string }) => void;
  stop: (setup?: { busytone?: string }) => void;
  setForceSpeakerphoneOn: (flag: boolean) => void;
};

function loadManager(): InCallManagerLike | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const m = require('react-native-incall-manager').default as InCallManagerLike | undefined;
    return m && typeof m.start === 'function' ? m : null;
  } catch {
    return null;
  }
}

let manager: InCallManagerLike | null = null;
let managerActive = false;
let starting: Promise<void> | null = null;
let currentRoute = '';
let routeSub: { remove: () => void } | null = null;

/** True while a call's audio route is owned by the call manager (headset-aware). */
export const isCallAudioManaged = () => managerActive;

/** Bluetooth or wired headset is carrying the call (then the screen must not go dark at the ear / in the pocket). */
export const isHeadsetRoute = () => currentRoute === 'BLUETOOTH' || currentRoute === 'WIRED_HEADSET';

async function ensureBluetoothPermission(): Promise<void> {
  if (Platform.OS !== 'android' || Number(Platform.Version) < 31) return;
  try {
    const perm = PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT;
    if (!perm) return;
    if (!(await PermissionsAndroid.check(perm))) await PermissionsAndroid.request(perm);
  } catch { /* without it the call still works on earpiece / speaker */ }
}

/** Call once when a call starts (idempotent): asks for the Bluetooth permission and turns on headset-aware routing. */
export function startCallAudio(): Promise<void> {
  if (!isSpeakerSupported || managerActive) return Promise.resolve();
  if (starting) return starting;
  starting = (async () => {
    try {
      await ensureBluetoothPermission();
      const m = loadManager();
      if (!m) return;
      routeSub?.remove();
      routeSub = DeviceEventEmitter.addListener('onAudioDeviceChanged', (e: { selectedAudioDevice?: string }) => {
        currentRoute = String(e?.selectedAudioDevice || '');
      });
      m.start({ media: 'audio', auto: true });
      manager = m;
      managerActive = true;
    } catch { /* fall back to expo-av routing */ } finally {
      starting = null;
    }
  })();
  return starting;
}

export async function setCallSpeaker(on: boolean): Promise<void> {
  if (!isSpeakerSupported) return;
  try {
    if (managerActive && manager) {
      // true = loudspeaker, null = automatic (Bluetooth > wired headset > earpiece)
      manager.setForceSpeakerphoneOn(on ? true : (null as unknown as boolean));
      return;
    }
    // expo-av fallback exists only for Android's earpiece/speaker flag; on iOS there is nothing to fall back to.
    if (Platform.OS === 'android') await Audio.setAudioModeAsync({ playThroughEarpieceAndroid: !on, shouldDuckAndroid: false });
  } catch { /* keep the current route */ }
}

/** Back to the normal app audio (loudspeaker routing for sounds / recordings) once the call is over. */
export async function resetCallAudio(): Promise<void> {
  if (!isSpeakerSupported) return;
  try {
    if (starting) await starting.catch(() => {});
    if (managerActive && manager) {
      try { manager.stop(); } catch { /* ignore */ }
      managerActive = false;
      manager = null;
    }
    routeSub?.remove();
    routeSub = null;
    currentRoute = '';
    if (Platform.OS === 'android') await Audio.setAudioModeAsync({ playThroughEarpieceAndroid: false, shouldDuckAndroid: true });
  } catch { /* ignore */ }
}
