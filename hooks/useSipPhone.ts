import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useAuthStore } from '../stores/authStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useSipPhoneStore } from '../stores/sipPhoneStore';
import { sipPhone } from '../services/sip/sipPhone';

/**
 * Keeps the app's SIP phone registered while the app is in the foreground (organizations on the SIP trunk only).
 * It unregisters when the app goes to the background so a closed app never swallows a ring - the PBX then falls back to ringing
 * the user's mobile ("incoming calls also ring my phone").
 */
export function useSipPhone() {
  const organization = useAuthStore((s) => s.user?.organization);
  const available = useSettingsStore((s) => s.telephonySolutionAvailable);
  const provider = useSettingsStore((s) => s.telephonyProvider);
  const enabled = !!organization && available && provider === 'sip';

  useEffect(() => {
    if (!enabled || !organization || !sipPhone.isSupported()) return undefined;

    if (AppState.currentState === 'active') sipPhone.start(organization).catch(() => {});
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') sipPhone.start(organization).catch(() => {});
      // A call in progress keeps its audio when the user switches app / locks the screen; the phone is dropped once it ends.
      else if (state === 'background' && !useSipPhoneStore.getState().inCall) sipPhone.stop();
    });
    const unsubCall = useSipPhoneStore.subscribe((s, prev) => {
      if (prev.inCall && !s.inCall && AppState.currentState !== 'active') sipPhone.stop();
    });
    return () => {
      sub.remove();
      unsubCall();
      sipPhone.stop();
    };
  }, [enabled, organization]);
}
