import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

/**
 * "Call in progress" notification (Android). While the agent is on a call and leaves the app (home / another app), the call keeps
 * its audio but nothing on screen shows it. This pins an ongoing notification - tap = back to the call, "נתק" = hang up - and
 * is removed when the app is open again or the call ends.
 */
const ID = 'active-call';
const CHANNEL = 'activeCall';
export const ACTIVE_CALL_CATEGORY = 'activeCall';
export const ACTIVE_CALL_HANGUP = 'HANGUP_CALL';
export const ACTIVE_CALL_TYPE = 'active_call';

let shown = false;

export async function showOngoingCallNotification(title: string, body: string): Promise<void> {
  if (Platform.OS !== 'android' || shown) return;
  try {
    await Notifications.setNotificationChannelAsync(CHANNEL, {
      name: 'Active call',
      importance: Notifications.AndroidImportance.LOW, // silent: it only keeps the call reachable
      vibrationPattern: [0],
      sound: null,
    });
    await Notifications.setNotificationCategoryAsync(ACTIVE_CALL_CATEGORY, [
      { identifier: ACTIVE_CALL_HANGUP, buttonTitle: 'נתק', options: { opensAppToForeground: false, isDestructive: true } },
    ]);
    await Notifications.scheduleNotificationAsync({
      identifier: ID,
      content: {
        title,
        body,
        data: { type: ACTIVE_CALL_TYPE },
        categoryIdentifier: ACTIVE_CALL_CATEGORY,
        sticky: true,
        autoDismiss: false,
        priority: Notifications.AndroidNotificationPriority.LOW,
      } as any,
      trigger: { channelId: CHANNEL } as any,
    });
    shown = true;
  } catch { /* the in-app call bar still works */ }
}

export async function dismissOngoingCallNotification(): Promise<void> {
  if (Platform.OS !== 'android' || !shown) return;
  shown = false;
  try {
    await Notifications.dismissNotificationAsync(ID);
    await Notifications.cancelScheduledNotificationAsync(ID);
  } catch { /* already gone */ }
}
