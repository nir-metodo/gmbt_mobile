import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Modal, Platform, Pressable, Share, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { WebView } from 'react-native-webview';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '../hooks/useAppTheme';
import { registerPdfViewerHost, type PdfViewRequest } from '../utils/pdfViewer';

interface Props {
  /** null = closed. */
  request: PdfViewRequest | null;
  onClose: () => void;
}

// iOS WebView renders PDFs natively; Android's WebView doesn't, so it goes through the Google viewer.
const viewerUri = (url: string) =>
  Platform.OS === 'android' ? `https://docs.google.com/gview?embedded=true&url=${encodeURIComponent(url)}` : url;

/** Full-screen in-app PDF viewer: close, share, open in the system viewer. */
export function PdfViewerModal({ request, onClose }: Props) {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (request) { setLoading(true); setFailed(false); }
  }, [request?.url]); // eslint-disable-line react-hooks/exhaustive-deps

  const share = () => {
    if (request) Share.share({ message: request.url, url: request.url, title: request.title }).catch(() => {});
  };
  const external = () => {
    if (request) Linking.openURL(request.url).catch(() => {});
  };

  return (
    <Modal visible={!!request} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
        <View style={[styles.header, { paddingTop: insets.top + 6, backgroundColor: theme.custom?.headerBackground || theme.colors.primary }]}>
          <Pressable onPress={onClose} hitSlop={10} style={styles.btn}>
            <MaterialCommunityIcons name="close" size={24} color="#fff" />
          </Pressable>
          <Text numberOfLines={1} style={styles.title}>{request?.title || 'PDF'}</Text>
          <Pressable onPress={share} hitSlop={10} style={styles.btn}>
            <MaterialCommunityIcons name="share-variant" size={22} color="#fff" />
          </Pressable>
          <Pressable onPress={external} hitSlop={10} style={styles.btn}>
            <MaterialCommunityIcons name="open-in-new" size={22} color="#fff" />
          </Pressable>
        </View>
        {request ? (
          failed ? (
            <View style={styles.center}>
              <MaterialCommunityIcons name="file-alert-outline" size={48} color={theme.colors.onSurfaceVariant} />
              <Text style={{ color: theme.colors.onSurfaceVariant, marginTop: 8, textAlign: 'center' }}>לא ניתן להציג את הקובץ בתוך האפליקציה</Text>
              <Pressable onPress={external} style={[styles.openBtn, { backgroundColor: theme.colors.primary }]}>
                <Text style={{ color: '#fff', fontWeight: '700' }}>פתח בצורה חיצונית</Text>
              </Pressable>
            </View>
          ) : (
            <View style={{ flex: 1 }}>
              <WebView
                source={{ uri: viewerUri(request.url) }}
                style={{ flex: 1, backgroundColor: theme.colors.background }}
                originWhitelist={['*']}
                startInLoadingState={false}
                onLoadEnd={() => setLoading(false)}
                onError={() => { setLoading(false); setFailed(true); }}
                onHttpError={() => { setLoading(false); setFailed(true); }}
                setSupportMultipleWindows={false}
                allowsInlineMediaPlayback
              />
              {loading ? (
                <View style={[styles.center, StyleSheet.absoluteFill, { backgroundColor: theme.colors.background }]} pointerEvents="none">
                  <ActivityIndicator size="large" color={theme.colors.primary} />
                </View>
              ) : null}
            </View>
          )
        ) : null}
      </View>
    </Modal>
  );
}

/** Global host (mounted once in app/_layout.tsx): lets any screen call viewPdf(url, title). */
export function PdfViewerHost() {
  const [req, setReq] = useState<PdfViewRequest | null>(null);
  useEffect(() => {
    registerPdfViewerHost((r) => setReq(r));
    return () => registerPdfViewerHost(null);
  }, []);
  return <PdfViewerModal request={req} onClose={() => setReq(null)} />;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingBottom: 10, gap: 4 },
  btn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, color: '#fff', fontSize: 16, fontWeight: '700', textAlign: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  openBtn: { marginTop: 16, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 12 },
});

export default PdfViewerModal;
