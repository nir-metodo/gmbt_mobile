import React, { useState } from 'react';
import { Alert, Image, Linking, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useRTL } from '../../hooks/useRTL';
import { useRowDirection } from '../../hooks/useRowDirection';
import { BRAND } from '../dashboard/ui';
import { displayValue } from '../../utils/submissionsInsights';
import { formatDateTime } from '../../utils/formatters';
import type { SubmissionRecord } from '../../services/api/submissions';

interface Props {
  record: SubmissionRecord | null;
  onDismiss: () => void;
  onOpenChat: (phone: string) => void;
  /** Resolves a PDF URL for records that don't carry one (web forms render it server-side). */
  onResolvePdf: (record: SubmissionRecord) => Promise<string | null>;
}

const isImage = (v: string) => {
  const s = (v || '').trim();
  return s.startsWith('data:image') || /^https?:\/\/\S+\.(png|jpe?g|gif|webp|bmp)(\?\S*)?$/i.test(s);
};

/** Bottom sheet with every answer of one response + PDF / open-chat actions. */
export default function SubmissionDetailSheet({ record, onDismiss, onOpenChat, onResolvePdf }: Props) {
  const { t } = useTranslation();
  const theme = useAppTheme();
  const { textAlign } = useRTL();
  const dir = useRowDirection();
  const insets = useSafeAreaInsets();
  const [pdfBusy, setPdfBusy] = useState(false);

  const yes = t('submissions.yes');
  const no = t('submissions.no');

  const openPdf = async () => {
    if (!record) return;
    try {
      setPdfBusy(true);
      const url = record.pdfUrl || (await onResolvePdf(record));
      if (url) await Linking.openURL(url);
      else throw new Error('no url');
    } catch {
      Alert.alert(t('submissions.pdfFailed'));
    } finally {
      setPdfBusy(false);
    }
  };

  const title = record?.name || record?.phone || record?.email || t('submissions.noName');

  return (
    <Modal visible={!!record} transparent animationType="slide" onRequestClose={onDismiss} statusBarTranslucent>
      <Pressable style={styles.overlay} onPress={onDismiss}>
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={[styles.sheet, { backgroundColor: theme.colors.surface, paddingBottom: insets.bottom + 12 }]}
        >
          {record ? (
            <>
              <View style={[styles.header, { flexDirection: dir }]}>
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1} style={{ fontSize: 17, fontWeight: '800', color: theme.colors.onSurface, textAlign }}>
                    {title}
                  </Text>
                  <Text numberOfLines={1} style={{ fontSize: 12, color: theme.colors.onSurfaceVariant, textAlign }}>
                    {[record.sourceTitle, formatDateTime(record.submittedAt)].filter(Boolean).join(' · ')}
                  </Text>
                </View>
                <Pressable onPress={onDismiss} hitSlop={10}>
                  <MaterialCommunityIcons name="close" size={22} color={theme.colors.onSurfaceVariant} />
                </Pressable>
              </View>

              {(record.phone || record.email) && (
                <View style={[styles.contact, { flexDirection: dir, backgroundColor: theme.colors.surfaceVariant }]}>
                  {record.phone ? (
                    <View style={[styles.contactItem, { flexDirection: dir }]}>
                      <MaterialCommunityIcons name="phone-outline" size={14} color={BRAND} />
                      <Text style={{ fontSize: 13, color: theme.colors.onSurface }}>{record.phone}</Text>
                    </View>
                  ) : null}
                  {record.email ? (
                    <View style={[styles.contactItem, { flexDirection: dir }]}>
                      <MaterialCommunityIcons name="email-outline" size={14} color={BRAND} />
                      <Text style={{ fontSize: 13, color: theme.colors.onSurface }}>{record.email}</Text>
                    </View>
                  ) : null}
                </View>
              )}

              <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ paddingVertical: 4 }}>
                {record.rows.length === 0 ? (
                  <Text style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center', marginVertical: 20 }}>{t('submissions.noData')}</Text>
                ) : (
                  record.rows.map((r, i) => (
                    <View key={`${r.key}-${i}`} style={[styles.row, { borderBottomColor: theme.colors.outlineVariant || '#e2e8f0' }]}>
                      <Text style={{ fontSize: 12, color: theme.colors.onSurfaceVariant, textAlign }}>{r.label}</Text>
                      {isImage(r.value) ? (
                        <Image source={{ uri: r.value.trim() }} resizeMode="contain" style={styles.image} />
                      ) : (
                        <Text selectable style={{ fontSize: 15, color: theme.colors.onSurface, textAlign, marginTop: 2 }}>
                          {displayValue(r.value, yes, no) || '—'}
                        </Text>
                      )}
                    </View>
                  ))
                )}
              </ScrollView>

              <View style={[styles.actions, { flexDirection: dir }]}>
                <Button
                  mode="contained"
                  icon="file-pdf-box"
                  buttonColor={BRAND}
                  loading={pdfBusy}
                  disabled={pdfBusy || (record.kind === 'document' && !record.pdfUrl)}
                  onPress={openPdf}
                  style={{ flex: 1, borderRadius: 12 }}
                >
                  {t('submissions.openPdf')}
                </Button>
                {record.phone ? (
                  <Button mode="outlined" icon="chat-outline" textColor={BRAND} onPress={() => onOpenChat(record.phone)} style={{ flex: 1, borderRadius: 12 }}>
                    {t('submissions.openChat')}
                  </Button>
                ) : null}
              </View>
            </>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 16, paddingTop: 14, maxHeight: '88%' },
  header: { alignItems: 'center', gap: 8, marginBottom: 10 },
  contact: { flexWrap: 'wrap', gap: 14, padding: 10, borderRadius: 12, marginBottom: 6 },
  contactItem: { alignItems: 'center', gap: 5 },
  row: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  image: { width: '100%', height: 140, marginTop: 6, backgroundColor: '#f8fafc', borderRadius: 8 },
  actions: { gap: 10, marginTop: 12 },
});
