import { create } from 'zustand';

/** The agent's live SIP call placed from the app (drives the in-call screen + minimized bar: hold / mute / speaker / keypad / notes / hang up). */
export interface ActiveCall {
  callId: string;
  organization: string;
  phoneNumber: string;
  /** Customer / contact name when known (shown above the number). */
  name?: string;
  startedAt: number;
  answered: boolean;
  held: boolean;
  muted: boolean;
  /** Loudspeaker on. Default off = the phone's earpiece, like any phone call. */
  speaker: boolean;
  /** Full-screen call page open (false = minimized to the small bar so the user can keep working in the app). */
  expanded: boolean;
  /** What the agent typed during the call (saved to the call's documentation / timeline). */
  notes: string;
}

interface ActiveCallState {
  call: ActiveCall | null;
  start: (c: Pick<ActiveCall, 'callId' | 'organization' | 'phoneNumber'> & { name?: string; answered?: boolean }) => void;
  patch: (p: Partial<ActiveCall>) => void;
  clear: () => void;
}

export const useActiveCallStore = create<ActiveCallState>((set) => ({
  call: null,
  start: (c) => set({
    call: {
      callId: c.callId, organization: c.organization, phoneNumber: c.phoneNumber, name: c.name,
      startedAt: Date.now(), answered: !!c.answered, held: false, muted: false,
      speaker: false, expanded: true, notes: '', // the call page opens at once (dialing), the user can minimize it
    },
  }),
  patch: (p) => set((s) => (s.call ? { call: { ...s.call, ...p } } : s)),
  clear: () => set({ call: null }),
}));
