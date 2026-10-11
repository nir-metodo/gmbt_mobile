import React, { useState } from 'react';
import { View, StyleSheet, Image } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useAppTheme } from '../../../hooks/useAppTheme';
import { useRTL } from '../../../hooks/useRTL';
import type { TemplateInfo } from './campaignUtils';

interface Props {
  info: TemplateInfo;
  /** Body with the sample recipient's values merged in (falls back to the raw template body). */
  bodyText?: string;
  mediaUrl?: string;
  /** Hebrew / English labels inside the bubble. */
  he: boolean;
}

const BUTTON_ICON: Record<string, string> = {
  URL: 'open-in-new',
  PHONE_NUMBER: 'phone',
  QUICK_REPLY: 'reply',
};

/** Renders a WhatsApp-style bubble of an approved template (header / body / footer / buttons). */
export default function TemplateBubble({ info, bodyText, mediaUrl, he }: Props) {
  const theme = useAppTheme();
  const { textAlign, flexDirection, writingDirection } = useRTL();
  const [imgFailed, setImgFailed] = useState(false);
  const ink = theme.dark ? '#e9edef' : '#111111';
  const sub = theme.dark ? 'rgba(233,237,239,0.6)' : 'rgba(0,0,0,0.5)';

  const isMedia = info.headerFormat === 'IMAGE' || info.headerFormat === 'VIDEO' || info.headerFormat === 'DOCUMENT';
  const mediaIcon =
    info.headerFormat === 'VIDEO' ? 'play-circle-outline' : info.headerFormat === 'DOCUMENT' ? 'file-document-outline' : 'image-outline';

  return (
    <View style={[styles.wrap, { backgroundColor: theme.custom?.chatBackground || theme.colors.surfaceVariant }]}>
      <View style={[styles.bubble, { backgroundColor: theme.custom?.chatBubbleOut || '#dcf8c6' }]}>
        {isMedia ? (
          mediaUrl && info.headerFormat === 'IMAGE' && !imgFailed ? (
            <Image source={{ uri: mediaUrl }} style={styles.media} resizeMode="cover" onError={() => setImgFailed(true)} />
          ) : (
            <View style={[styles.media, styles.mediaPlaceholder, { backgroundColor: 'rgba(0,0,0,0.08)' }]}>
              <MaterialCommunityIcons name={mediaIcon as any} size={34} color="rgba(0,0,0,0.45)" />
              <Text style={styles.mediaHint}>
                {info.headerFormat === 'IMAGE' ? (he ? 'תמונה' : 'Image') : info.headerFormat === 'VIDEO' ? (he ? 'וידאו' : 'Video') : he ? 'מסמך' : 'Document'}
              </Text>
            </View>
          )
        ) : null}

        {info.headerText ? (
          <Text style={[styles.headerText, { textAlign, writingDirection, color: ink }]}>{info.headerText}</Text>
        ) : null}

        <Text style={[styles.body, { textAlign, writingDirection, color: ink }]}>{bodyText ?? info.bodyText}</Text>

        {info.footerText ? <Text style={[styles.footer, { textAlign, writingDirection, color: sub }]}>{info.footerText}</Text> : null}
      </View>

      {info.buttons.length > 0 && (
        <View style={styles.buttons}>
          {info.buttons.map((b, i) => (
            <View key={i} style={[styles.button, { flexDirection, backgroundColor: theme.custom?.chatBubbleIn || '#fff' }]}>
              <MaterialCommunityIcons name={(BUTTON_ICON[b.type] || 'gesture-tap') as any} size={16} color="#0a7cff" />
              <Text style={styles.buttonText} numberOfLines={1}>
                {b.text || b.type}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: 12, padding: 12 },
  bubble: { borderRadius: 10, padding: 8, gap: 6 },
  media: { width: '100%', height: 150, borderRadius: 8 },
  mediaPlaceholder: { alignItems: 'center', justifyContent: 'center', gap: 4 },
  mediaHint: { fontSize: 12, color: 'rgba(0,0,0,0.5)' },
  headerText: { fontSize: 15, fontWeight: '700', color: '#111' },
  body: { fontSize: 14, lineHeight: 20, color: '#111' },
  footer: { fontSize: 12, color: 'rgba(0,0,0,0.5)' },
  buttons: { marginTop: 6, gap: 4 },
  button: { borderRadius: 8, paddingVertical: 8, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', gap: 6 },
  buttonText: { color: '#0a7cff', fontSize: 14, fontWeight: '600' },
});
