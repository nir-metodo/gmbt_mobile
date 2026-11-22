import { CallUi } from '../../modules/call-ui';
import { phoneCallsApi } from '../api/phoneCalls';
import { pushNotificationService } from '../pushNotifications';
import { useActiveCallStore } from '../../stores/activeCallStore';
import { sipPhone } from './sipPhone';

/**
 * iPhone: events of the system call screen (CallKit) while the app runs - the user answered, hung up or muted on it, or iOS issued
 * a new VoIP token. (Android has no such events: its call screen hands the answer over through consumePendingAction.)
 * Returns the cleanup function.
 */
export function attachCallUiEvents(organization: string, userId: string): () => void {
  const offs: Array<() => void> = [];

  offs.push(CallUi.addListener('onCallAnswered', () => {
    // The pending answer is read inside start(): arms the auto-answer, then the PBX ring that follows is picked up at once.
    sipPhone.pickUpNativeAnswer();
    sipPhone.start(organization).catch(() => {});
  }));

  offs.push(CallUi.addListener('onCallEnded', (e: { callId?: string; answered?: boolean }) => {
    if (!e?.answered) return; // declined / timed out before it was answered: nothing is running
    const call = useActiveCallStore.getState().call;
    sipPhone.hangup();
    if (call && (!e.callId || call.callId === e.callId)) {
      phoneCallsApi.sipCallControl(call.organization, call.callId, 'hangup').catch(() => {});
      useActiveCallStore.getState().clear();
    }
  }));

  offs.push(CallUi.addListener('onCallMuted', (e: { muted?: boolean }) => {
    const call = useActiveCallStore.getState().call;
    if (!call) return;
    phoneCallsApi.sipCallControl(call.organization, call.callId, e?.muted ? 'mute' : 'unmute').catch(() => {});
    useActiveCallStore.getState().patch({ muted: !!e?.muted });
  }));

  offs.push(CallUi.addListener('onVoipToken', (e: { token?: string }) => {
    pushNotificationService.registerVoipToken(organization, userId, e?.token).catch(() => {});
  }));

  // The token may have been issued before JavaScript started listening.
  pushNotificationService.registerVoipToken(organization, userId).catch(() => {});

  return () => offs.forEach((off) => off());
}
