import { cacheMedia, getCachedMediaUri, type MediaType } from './mediaCache';

const MAX_CONCURRENT = 3;

interface QueueItem {
  url: string;
  type: MediaType;
}

let queue: QueueItem[] = [];
let activeCount = 0;
let processing = false;

function processQueue(): void {
  if (processing) return;
  processing = true;

  const next = async () => {
    while (queue.length > 0 && activeCount < MAX_CONCURRENT) {
      const item = queue.shift();
      if (!item) break;

      activeCount++;
      cacheMedia(item.url, item.type)
        .catch(() => {})
        .finally(() => {
          activeCount--;
          next();
        });
    }

    if (queue.length === 0 && activeCount === 0) {
      processing = false;
    }
  };

  next();
}

export function prefetchMedia(url: string, type: MediaType): void {
  const alreadyQueued = queue.some((item) => item.url === url);
  if (alreadyQueued) return;
  queue.push({ url, type });
  processQueue();
}

export async function prefetchMediaList(
  items: Array<{ url: string; type: MediaType }>
): Promise<void> {
  for (const item of items) {
    if (!item.url) continue;
    const cached = await getCachedMediaUri(item.url, item.type);
    if (!cached) {
      prefetchMedia(item.url, item.type);
    }
  }
}

export function clearPrefetchQueue(): void {
  queue = [];
}
