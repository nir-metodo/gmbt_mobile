import { create } from 'zustand';

/** The agent's live SIP call placed from the app (drives the in-call control bar: hold / mute / keypad / hang up). */
export interface ActiveCall {
  callId: string;
  organization: string;
  phoneNumber: string;
  startedAt: number;
  answered: boolean;
  held: boolean;
  muted: boolean;
}

interface ActiveCallState {
  call: ActiveCall | null;
  start: (c: Pick<ActiveCall, 'callId' | 'organization' | 'phoneNumber'>) => void;
  patch: (p: Partial<ActiveCall>) => void;
  clear: () => void;
}

export const useActiveCallStore = create<ActiveCallState>((set) => ({
  call: null,
  start: (c) => set({ call: { ...c, startedAt: Date.now(), answered: false, held: false, muted: false } }),
  patch: (p) => set((s) => (s.call ? { call: { ...s.call, ...p } } : s)),
  clear: () => set({ call: null }),
}));
