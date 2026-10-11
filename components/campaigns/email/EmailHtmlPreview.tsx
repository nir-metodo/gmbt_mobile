import React, { useMemo } from 'react';
import { View, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { WebView } from 'react-native-webview';
import { wrapEmailHtml } from './emailCampaignHelpers';

interface Props {
  html: string;
  rtl?: boolean;
  height?: number;
  style?: StyleProp<ViewStyle>;
}

const BASE_URL = 'https://gambot.azurewebsites.net/';

/**
 * Read-only render of an email in an isolated WebView (the mobile twin of the web preview iframe).
 * JavaScript is off and link taps are blocked, so previewing an email can never navigate away or run scripts.
 */
export default function EmailHtmlPreview({ html, rtl = false, height = 380, style }: Props) {
  const source = useMemo(() => ({ html: wrapEmailHtml(html, rtl), baseUrl: BASE_URL }), [html, rtl]);

  return (
    <View style={[styles.wrap, { height }, style]}>
      <WebView
        originWhitelist={['*']}
        source={source}
        javaScriptEnabled={false}
        domStorageEnabled={false}
        nestedScrollEnabled
        setSupportMultipleWindows={false}
        onShouldStartLoadWithRequest={(req) => req.url === 'about:blank' || req.url.startsWith(BASE_URL) || req.url.startsWith('data:')}
        style={styles.web}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: '#ffffff', borderRadius: 10, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: '#cbd5e1' },
  web: { flex: 1, backgroundColor: '#ffffff' },
});
