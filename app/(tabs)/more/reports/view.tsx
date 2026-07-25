import React, { useCallback, useEffect, useState } from 'react';
import { View, StyleSheet, Share } from 'react-native';
import { Appbar, Text, ActivityIndicator } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useAppTheme } from '../../../../hooks/useAppTheme';
import { useRTL } from '../../../../hooks/useRTL';
import { useAuthStore } from '../../../../stores/authStore';
import axiosInstance from '../../../../services/api/axiosInstance';
import { ENDPOINTS } from '../../../../constants/api';

const BRAND = '#2563eb';

// Convert the report's email HTML into readable plain text for the OS share sheet (WhatsApp,
// email, etc.). Unlike a naive tag-strip that collapses everything to one line, this preserves
// structure: table rows become lines, cells are separated by " | ", and block elements break
// onto new lines — so a shared report stays legible.
function htmlToShareText(html: string): string {
  if (!html) return '';
  let text = html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .replace(/<\/(td|th)>/gi, ' | ')
    .replace(/<\/(tr|p|div|li|h[1-6]|table)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  // Decode the handful of entities that actually appear in these reports.
  text = text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)));
  return text
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').replace(/\s*\|\s*$/, '').trim())
    .filter((line) => line.length > 0)
    .join('\n')
    .slice(0, 6000);
}

// Report HTML is generated for email at a fixed 700px width. On a phone that would overflow
// horizontally, so we widen the viewport meta to ~740px which makes the mobile browser scale the
// whole page down to fit the screen (still pinch-to-zoomable).
function makeMobileFriendly(html: string): string {
  if (!html) return '';
  const viewport = '<meta name="viewport" content="width=740, user-scalable=yes">';
  if (/<meta[^>]*name=["']viewport["'][^>]*>/i.test(html)) {
    return html.replace(/<meta[^>]*name=["']viewport["'][^>]*>/i, viewport);
  }
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, (m) => `${m}${viewport}`);
  }
  return `<!DOCTYPE html><html dir="rtl"><head><meta charset="utf-8">${viewport}</head><body>${html}</body></html>`;
}

export default function ReportViewScreen() {
  const router = useRouter();
  const theme = useAppTheme();
  const { isRTL } = useRTL();
  const user = useAuthStore((s) => s.user);
  const org = user?.organization || '';
  const { reportId } = useLocalSearchParams<{ reportId: string }>();

  const [html, setHtml] = useState<string>('');
  const [title, setTitle] = useState<string>(isRTL ? 'דוח' : 'Report');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!org || !reportId) {
        setError(true);
        setLoading(false);
        return;
      }
      try {
        const res = await axiosInstance.post(ENDPOINTS.GET_SCHEDULED_REPORT_BY_ID, {
          organization: org,
          reportId,
        });
        const report = res.data?.report || res.data?.Report;
        const content = report?.content || report?.Content || '';
        if (!active) return;
        if (!content) {
          setError(true);
        } else {
          setHtml(makeMobileFriendly(content));
          if (report?.reportName) setTitle(report.reportName);
        }
      } catch {
        if (active) setError(true);
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    return () => {
      active = false;
    };
  }, [org, reportId]);

  const handleShare = useCallback(async () => {
    if (!html) return;
    try {
      await Share.share({ message: `${title}\n\n${htmlToShareText(html)}` });
    } catch {
      // ignore
    }
  }, [html, title]);

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Appbar.Header style={{ backgroundColor: BRAND }}>
        <Appbar.BackAction onPress={() => router.back()} color="#fff" />
        <Appbar.Content title={title} titleStyle={styles.headerTitle} />
        {!!html && <Appbar.Action icon="share-variant" onPress={handleShare} color="#fff" />}
      </Appbar.Header>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={BRAND} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <MaterialCommunityIcons name="file-alert-outline" size={64} color={theme.colors.onSurfaceVariant} />
          <Text variant="bodyLarge" style={{ color: theme.colors.onSurfaceVariant, marginTop: 16, textAlign: 'center' }}>
            {isRTL ? 'לא ניתן לטעון את הדוח' : 'Could not load the report'}
          </Text>
        </View>
      ) : (
        <WebView
          originWhitelist={['*']}
          source={{ html }}
          style={styles.webview}
          showsVerticalScrollIndicator
          startInLoadingState
          renderLoading={() => (
            <View style={styles.center}>
              <ActivityIndicator size="large" color={BRAND} />
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  headerTitle: { color: '#fff', fontWeight: '700', fontSize: 18 },
  webview: { flex: 1, backgroundColor: '#f0f2f5' },
});
