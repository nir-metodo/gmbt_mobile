import * as FileSystem from 'expo-file-system';
import * as Crypto from 'expo-crypto';

export type MediaType = 'image' | 'video' | 'audio' | 'document';

const BASE_DIR = FileSystem.documentDirectory + 'media_cache/';

const SUB_DIRS: Record<MediaType, string> = {
  image: 'images/',
  video: 'videos/',
  audio: 'audio/',
  document: 'documents/',
};

const EXTENSION_MAP: Record<MediaType, string> = {
  image: '.jpg',
  video: '.mp4',
  audio: '.ogg',
  document: '.pdf',
};

let initialized = false;

async function ensureDirectories(): Promise<void> {
  if (initialized) return;
  for (const sub of Object.values(SUB_DIRS)) {
    const dir = BASE_DIR + sub;
    const info = await FileSystem.getInfoAsync(dir);
    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    }
  }
  initialized = true;
}

async function hashUrl(url: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.MD5, url);
}

function getExtensionFromUrl(url: string, fallbackType: MediaType): string {
  try {
    const pathname = new URL(url).pathname;
    const ext = pathname.substring(pathname.lastIndexOf('.'));
    if (ext && ext.length > 1 && ext.length <= 6) return ext;
  } catch {}
  return EXTENSION_MAP[fallbackType];
}

function getFilePath(hash: string, type: MediaType, extension: string): string {
  return BASE_DIR + SUB_DIRS[type] + hash + extension;
}

export async function getCachedMediaUri(
  remoteUrl: string,
  type: MediaType = 'image'
): Promise<string | null> {
  try {
    await ensureDirectories();
    const hash = await hashUrl(remoteUrl);
    const ext = getExtensionFromUrl(remoteUrl, type);
    const localPath = getFilePath(hash, type, ext);
    const info = await FileSystem.getInfoAsync(localPath);
    return info.exists ? localPath : null;
  } catch {
    return null;
  }
}

export async function cacheMedia(
  remoteUrl: string,
  type: MediaType = 'image'
): Promise<string> {
  await ensureDirectories();
  const hash = await hashUrl(remoteUrl);
  const ext = getExtensionFromUrl(remoteUrl, type);
  const localPath = getFilePath(hash, type, ext);

  const info = await FileSystem.getInfoAsync(localPath);
  if (info.exists) return localPath;

  const downloadResult = await FileSystem.downloadAsync(remoteUrl, localPath);
  if (downloadResult.status !== 200) {
    await FileSystem.deleteAsync(localPath, { idempotent: true });
    throw new Error(`Download failed with status ${downloadResult.status}`);
  }
  return localPath;
}

export async function clearCache(): Promise<void> {
  try {
    const info = await FileSystem.getInfoAsync(BASE_DIR);
    if (info.exists) {
      await FileSystem.deleteAsync(BASE_DIR, { idempotent: true });
    }
    initialized = false;
    await ensureDirectories();
  } catch (err) {
    console.error('[MediaCache] clearCache error:', err);
  }
}

export async function getCacheSize(): Promise<number> {
  try {
    await ensureDirectories();
    let totalBytes = 0;
    for (const sub of Object.values(SUB_DIRS)) {
      const dir = BASE_DIR + sub;
      const dirInfo = await FileSystem.getInfoAsync(dir);
      if (!dirInfo.exists) continue;
      const files = await FileSystem.readDirectoryAsync(dir);
      for (const file of files) {
        const fileInfo = await FileSystem.getInfoAsync(dir + file);
        if (fileInfo.exists && fileInfo.size) {
          totalBytes += fileInfo.size;
        }
      }
    }
    return totalBytes;
  } catch {
    return 0;
  }
}

export function formatCacheSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}
