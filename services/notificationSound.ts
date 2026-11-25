import { Audio } from 'expo-av';
import { Platform, AppState } from 'react-native';
import * as Notifications from 'expo-notifications';
import { isCallAudioManaged } from '../utils/callAudio';

let soundInstance: Audio.Sound | null = null;
let lastPlayedAt = 0;
const MIN_INTERVAL_MS = 2000;

async function ensureAudioMode() {
  // During a call the route (headset / earpiece / speaker) is owned by the call - don't touch the phone's audio mode.
  if (isCallAudioManaged()) return;
  await Audio.setAudioModeAsync({
    playsInSilentModeIOS: true,
    staysActiveInBackground: false,
    shouldDuckAndroid: true,
  });
}

export const notificationSound = {
  async playMessageSound(): Promise<void> {
    const now = Date.now();
    if (now - lastPlayedAt < MIN_INTERVAL_MS) return;
    if (AppState.currentState !== 'active') return;

    lastPlayedAt = now;

    try {
      await ensureAudioMode();

      if (soundInstance) {
        await soundInstance.replayAsync();
        return;
      }

      const { sound } = await Audio.Sound.createAsync(
        require('../assets/sounds/notification.wav'),
        { shouldPlay: true, volume: 0.7 }
      );
      soundInstance = sound;
    } catch {
      // Fallback: trigger a local notification with sound
      try {
        await Notifications.scheduleNotificationAsync({
          content: {
            title: '',
            body: '',
            sound: 'default',
          },
          trigger: null,
        });
      } catch {}
    }
  },

  async cleanup(): Promise<void> {
    if (soundInstance) {
      await soundInstance.unloadAsync();
      soundInstance = null;
    }
  },
};
