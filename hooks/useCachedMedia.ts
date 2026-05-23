import { useState, useEffect, useRef } from 'react';
import { getCachedMediaUri, cacheMedia, type MediaType } from '../services/mediaCache';

interface UseCachedMediaResult {
  uri: string | null;
  isLoading: boolean;
}

export function useCachedMedia(
  remoteUrl: string | undefined | null,
  type: MediaType = 'image'
): UseCachedMediaResult {
  const [uri, setUri] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(!!remoteUrl);
  const mountedRef = useRef(true);
  const urlRef = useRef(remoteUrl);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    urlRef.current = remoteUrl;

    if (!remoteUrl) {
      setUri(null);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    (async () => {
      try {
        const cached = await getCachedMediaUri(remoteUrl, type);
        if (cancelled || urlRef.current !== remoteUrl) return;

        if (cached) {
          setUri(cached);
          setIsLoading(false);
          return;
        }

        const localPath = await cacheMedia(remoteUrl, type);
        if (cancelled || urlRef.current !== remoteUrl) return;
        setUri(localPath);
      } catch {
        if (cancelled || urlRef.current !== remoteUrl) return;
        setUri(remoteUrl);
      } finally {
        if (!cancelled && mountedRef.current && urlRef.current === remoteUrl) {
          setIsLoading(false);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [remoteUrl, type]);

  return { uri, isLoading };
}
