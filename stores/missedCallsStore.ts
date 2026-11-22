import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { phoneCallsApi } from '../services/api/phoneCalls';

const SEEN_KEY = 'missed_calls_seen_at';

// Stored call times are UTC ISO strings (sometimes without the "Z").
function callTime(iso?: string): number {
  if (!iso) return 0;
  const s = /[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`;
  const t = new Date(s).getTime();
  return isNaN(t) ? 0 : t;
}

interface MissedCallsState {
  /** Inbound calls nobody answered since the user last opened the calls screen. */
  unseen: number;
  refresh: (organization: string, userId?: string) => Promise<void>;
  /** The calls screen was opened: everything up to now counts as seen. */
  markSeen: () => Promise<void>;
}

export const useMissedCallsStore = create<MissedCallsState>((set) => ({
  unseen: 0,

  refresh: async (organization, userId) => {
    if (!organization) return;
    try {
      let seenAt = parseInt((await AsyncStorage.getItem(SEEN_KEY)) || '0', 10) || 0;
      if (!seenAt) {
        // First run on this device: don't flood the badge with old history.
        seenAt = Date.now();
        await AsyncStorage.setItem(SEEN_KEY, String(seenAt));
      }
      const calls = await phoneCallsApi.getPbxCalls(organization, { userId, pageSize: 50 });
      const unseen = calls.filter((c) => c.direction === 'inbound' && c.status === 'missed' && callTime(c.createdAt) > seenAt).length;
      set({ unseen });
    } catch { /* keep the previous count */ }
  },

  markSeen: async () => {
    set({ unseen: 0 });
    try { await AsyncStorage.setItem(SEEN_KEY, String(Date.now())); } catch { /* ignore */ }
  },
}));
