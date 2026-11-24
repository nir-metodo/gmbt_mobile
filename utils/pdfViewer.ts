import { Linking } from 'react-native';

export interface PdfViewRequest {
  url: string;
  title?: string;
}

type Host = (req: PdfViewRequest | null) => void;
let host: Host | null = null;

/** The global in-app PDF viewer (mounted once in app/_layout.tsx) registers itself here. */
export function registerPdfViewerHost(h: Host | null) {
  host = h;
}

/** Opens a PDF inside the app (no jump to the browser). Falls back to the system viewer if the host isn't mounted. */
export function viewPdf(url: string, title?: string): Promise<void> {
  if (host) {
    host({ url, title });
    return Promise.resolve();
  }
  return Linking.openURL(url);
}
