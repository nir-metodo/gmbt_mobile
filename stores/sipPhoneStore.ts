import { create } from 'zustand';

/** A call ringing in the app (somebody dialed the office number / this agent's extension). */
export interface IncomingSipCall {
  from: string;
  name: string;
  /** Gateway call id (X-Gambot-CallId) - lets the in-call bar control the call. */
  callId: string;
}

interface SipPhoneState {
  /** The app's SIP phone is registered on the PBX: calls ring here and click-to-call talks through the app. */
  registered: boolean;
  incoming: IncomingSipCall | null;
  /** True while a call's audio runs through the app. */
  inCall: boolean;
  setRegistered: (v: boolean) => void;
  setIncoming: (c: IncomingSipCall | null) => void;
  setInCall: (v: boolean) => void;
}

export const useSipPhoneStore = create<SipPhoneState>((set) => ({
  registered: false,
  incoming: null,
  inCall: false,
  setRegistered: (registered) => set({ registered }),
  setIncoming: (incoming) => set({ incoming }),
  setInCall: (inCall) => set({ inCall }),
}));
