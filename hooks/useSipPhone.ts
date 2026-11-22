import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useAuthStore } from '../stores/authStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useSipPhoneStore } from '../stores/sipPhoneStore';
import { sipPhone } from '../services/sip/sipPhone';
import { attachCallUiEvents } from '../services/sip/callUiBridge';

/**
 * Keeps the app's SIP phone registered while the app is in the foreground (organizations on the SIP trunk only).
 * It unregisters when the app goes to the background so a closed app never swallows a ring - the PBX then falls back to ringing
 * the user's mobile ("incoming calls also ring my phone").
 */
export function useSipPhone() {
  const organization = useAuthStore((s) => s.user?.organization);
  const available = useSettingsStore((s) => s.telephonySolutionAvailable);
  const provider = useSettingsStore((s) => s.telephonyProvider);
  const userId = useAuthStore((s) => s.user?.uID || s.user?.userId);
  const enabled = !!organization && available && provider === 'sip';

  useEffect(() => {
    if (!enabled || !organization || !sipPhone.isSupported()) return undefined;
    const detachCallUi = attachCallUiEvents(organization, userId || '');

    // The user may have pressed Answer on the native full-screen call (app was closed / locked): arm the auto-answer BEFORE registering,
    // so the PBX's ring - which starts the moment we register - is answered at once.
    const begin = () => {
      sipPhone.pickUpNativeAnswer();
      sipPhone.start(organization).catch(() => {});
    };
    if (AppState.currentState === 'active') begin();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') begin();
      // A call in progress keeps its audio when the user switches app / locks the screen; the phone is dropped once it ends.
      // An accepted call that has not arrived yet keeps the phone registered too.
      else if (state === 'background' && !useSipPhoneStore.getState().inCall && !sipPhone.isAutoAnswerArmed()) sipPhone.stop();
    });
    const unsubCall = useSipPhoneStore.subscribe((s, prev) => {
      if (prev.inCall && !s.inCall && AppState.currentState !== 'active') sipPhone.stop();
    });
    return () => {
      sub.remove();
      unsubCall();
      detachCallUi();
      sipPhone.stop();
    };
  }, [enabled, organization, userId]);
}
