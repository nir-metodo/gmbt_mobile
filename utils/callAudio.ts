import { Platform } from 'react-native';
import { Audio } from 'expo-av';

/**
 * Where the in-app call's audio comes out on Android: earpiece (default, like a normal phone call) or the loudspeaker.
 *
 * Why this is needed: expo-av applies its audio mode to the whole phone on every Audio.setAudioModeAsync call, and its default
 * (playThroughEarpieceAndroid: false) switches the speakerphone ON. The app calls it for the ring sound, voice notes, recording
 * playback and the message sound, so a call that is answered through the app ended up on the loudspeaker with no way back.
 * Setting the mode here keeps the choice (expo-av remembers it for later calls) until the call ends.
 */
export const isSpeakerSupported = Platform.OS === 'android';

export async function setCallSpeaker(on: boolean): Promise<void> {
  if (!isSpeakerSupported) return;
  try {
    await Audio.setAudioModeAsync({ playThroughEarpieceAndroid: !on, shouldDuckAndroid: false });
  } catch { /* keep the current route */ }
}

/** Back to the normal app audio (loudspeaker routing for sounds / recordings) once the call is over. */
export async function resetCallAudio(): Promise<void> {
  if (!isSpeakerSupported) return;
  try {
    await Audio.setAudioModeAsync({ playThroughEarpieceAndroid: false, shouldDuckAndroid: true });
  } catch { /* ignore */ }
}
