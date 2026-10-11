import { useCallback, useEffect, useState } from 'react';

/**
 * Tracks whether a form differs from its last "clean" state, so a contextual Save bar can appear
 * only when there is something to save (no "Edit" button needed).
 *
 * Usage:
 *   const snapshot = JSON.stringify({ a, b, c });          // everything the user can edit
 *   const { dirty, markClean } = useDirtyTracker(snapshot);
 *   // after loading from the server (or after a successful save) set the form state, then:
 *   markClean();                                           // baseline = the snapshot of THAT render
 */
export function useDirtyTracker(snapshot: string) {
  const [baseline, setBaseline] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (pending) {
      setBaseline(snapshot);
      setPending(false);
    }
  }, [pending, snapshot]);

  const markClean = useCallback(() => setPending(true), []);
  const dirty = !pending && baseline !== null && baseline !== snapshot;
  return { dirty, markClean };
}
