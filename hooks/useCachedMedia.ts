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
  const [state, setState] = useState<{ uri: string | null; isLoading: boolean }>({
    uri: remoteUrl || null,
    isLoading: false,
  });
  const mountedRef = useRef(true);
  const urlRef = useRef(remoteUrl);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    urlRef.current = remoteUrl;

    if (!remoteUrl) {
      setState({ uri: null, isLoading: false });
      return;
    }

    // For images and video, use remote URL directly — RN Image/Video handle caching natively
    if (type === 'image' || type === 'video') {
      setState({ uri: remoteUrl, isLoading: false });
      return;
    }

    // For audio/documents, check cache then download if needed
    let cancelled = false;
    setState({ uri: remoteUrl, isLoading: true });

    (async () => {
      try {
        const cached = await getCachedMediaUri(remoteUrl, type);
        if (cancelled || urlRef.current !== remoteUrl) return;

        if (cached) {
          if (mountedRef.current) setState({ uri: cached, isLoading: false });
          return;
        }

        const localPath = await cacheMedia(remoteUrl, type);
        if (cancelled || urlRef.current !== remoteUrl) return;
        if (mountedRef.current) setState({ uri: localPath, isLoading: false });
      } catch {
        if (cancelled || urlRef.current !== remoteUrl) return;
        if (mountedRef.current) setState({ uri: remoteUrl, isLoading: false });
      }
    })();

    return () => { cancelled = true; };
  }, [remoteUrl, type]);

  return state;
}
