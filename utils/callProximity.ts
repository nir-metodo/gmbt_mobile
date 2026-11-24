import { DeviceEventEmitter, Platform } from 'react-native';

/**
 * Like a normal phone call: while the phone is held to the ear the screen goes dark and stops reacting to touch, so the cheek
 * can't press mute / hang up. It lights up again when the phone is taken away from the ear.
 *
 * Uses the phone's proximity sensor (react-native-incall-manager). Only the sensor and the screen are used here - the call's
 * audio route stays under callAudio.ts. With the loudspeaker on the screen stays lit. A build without the native module
 * (older install) simply skips this.
 */
type InCallManagerLike = {
  startProximitySensor: () => void;
  stopProximitySensor: () => void;
  turnScreenOff: () => void;
  turnScreenOn: () => void;
};

function load(): InCallManagerLike | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const m = require('react-native-incall-manager').default as InCallManagerLike | undefined;
    return m || null;
  } catch {
    return null;
  }
}

/** Starts watching the proximity sensor. Returns a function that stops it and lights the screen again. */
export function startCallProximity(isSpeakerOn: () => boolean): () => void {
  const mgr = load();
  if (!mgr) return () => {};
  let dark = false;
  const setDark = (on: boolean) => {
    if (on === dark) return;
    dark = on;
    try { if (on) mgr.turnScreenOff(); else mgr.turnScreenOn(); } catch { /* ignore */ }
  };
  // On Android the sensor events reach JS and we darken the screen ourselves; on iOS the sensor itself blanks the screen.
  const sub = Platform.OS === 'android'
    ? DeviceEventEmitter.addListener('Proximity', (e: { isNear?: boolean }) => setDark(!!e?.isNear && !isSpeakerOn()))
    : null;
  try { mgr.startProximitySensor(); } catch { /* ignore */ }
  return () => {
    sub?.remove();
    try { mgr.stopProximitySensor(); } catch { /* ignore */ }
    setDark(false);
    try { mgr.turnScreenOn(); } catch { /* ignore */ }
  };
}
