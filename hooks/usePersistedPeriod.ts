import { useCallback, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from 'expo-router';
import { isPeriodKey, PeriodKey, PeriodRange, rangeForPeriod } from '../utils/datePresets';

/**
 * A period selection (all time / today / this week ...) that is remembered between visits and shared
 * by every screen using the same `storageKey`. The saved value is re-read whenever the screen gains
 * focus, so changing the period on a detail screen is reflected when going back.
 * `ready` flips to true once the saved value was read, so screens can wait for it before fetching
 * and avoid loading the data twice.
 */
export function usePersistedPeriod(storageKey: string, defaultKey: PeriodKey = 'all') {
  const [period, setPeriodState] = useState<PeriodKey>(defaultKey);
  const [ready, setReady] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      AsyncStorage.getItem(storageKey)
        .then((saved) => {
          if (active && isPeriodKey(saved)) setPeriodState(saved);
        })
        .catch(() => {})
        .finally(() => {
          if (active) setReady(true);
        });
      return () => {
        active = false;
      };
    }, [storageKey]),
  );

  const setPeriod = useCallback(
    (key: PeriodKey) => {
      setPeriodState(key);
      AsyncStorage.setItem(storageKey, key).catch(() => {});
    },
    [storageKey],
  );

  // Recompute when the calendar day changes so "today" never goes stale on a long-lived screen.
  const dayStamp = new Date().toDateString();
  const range: PeriodRange = useMemo(() => rangeForPeriod(period), [period, dayStamp]); // eslint-disable-line react-hooks/exhaustive-deps

  return { period, setPeriod, range, ready };
}
