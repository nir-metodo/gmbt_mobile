import { create } from 'zustand';
import type { SmartCallOptions } from '../utils/phoneCall';

interface DialSheetState {
  /** The call the user just asked for (null = sheet closed). */
  opts: SmartCallOptions | null;
  open: (opts: SmartCallOptions) => void;
  close: () => void;
}

export const useDialSheetStore = create<DialSheetState>((set) => ({
  opts: null,
  open: (opts) => set({ opts }),
  close: () => set({ opts: null }),
}));
