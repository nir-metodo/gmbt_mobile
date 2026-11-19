import React, { useCallback, useMemo, useState } from 'react';
import { View, StyleSheet, FlatList, Pressable, Linking, Alert, RefreshControl, Modal, ScrollView } from 'react-native';
import { Text, Card, ActivityIndicator, IconButton, Button, FAB } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '../../stores/authStore';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useRTL } from '../../hooks/useRTL';
import { ListToolbar } from '../ListToolbar';
import EmailHtmlPreview from '../campaigns/email/EmailHtmlPreview';
import { emailCampaignsApi, type EmailTemplateInfo } from '../../services/api/emailCampaigns';
import { WEB_APP_BASE_URL } from '../../constants/api';

/** Email templates: browse + preview, start an email campaign. Designing a new template opens the web editor. */
export default function EmailTemplatesTab() {
  const router = useRouter();
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const { isRTL, textAlign } = useRTL();
  const org = useAuthStore((s) => s.user?.organization) || '';

  const [templates, setTemplates] = useState<EmailTemplateInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<EmailTemplateInfo | null>(null);

  const load = useCallback(async () => {
    if (!org) return;
    try {
      setTemplates(await emailCampaignsApi.getTemplates(org));
    } catch {
      /* keep what we have */
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [org]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openWeb = useCallback(async () => {
    try { await Linking.openURL(`${WEB_APP_BASE_URL}/email/templates?source=mobileapp`); }
    catch { Alert.alert(isRTL ? 'שגיאה' : 'Error', isRTL ? 'לא ניתן לפתוח את הפורטל' : 'Could not open the web app'); }
  }, [isRTL]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return templates
      .filter((t) => !q || `${t.name} ${t.subject}`.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [templates, query]);

  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
      <ListToolbar query={query} onChangeQuery={setQuery} placeholder={isRTL ? 'חיפוש תבנית מייל...' : 'Search email templates...'} />
      {loading ? (
        <View style={styles.center}><ActivityIndicator /></View>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(t) => t.id}
          contentContainerStyle={{ padding: 12, paddingBottom: 110 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
          renderItem={({ item }) => (
            <Card style={[styles.card, { backgroundColor: theme.custom.cardBackground }]} onPress={() => setSelected(item)}>
              <Card.Content>
                <Text numberOfLines={1} style={[styles.name, { color: theme.colors.onSurface, textAlign }]}>{item.name}</Text>
                {item.subject ? (
                  <Text numberOfLines={1} style={[styles.sub, { color: theme.colors.onSurfaceVariant, textAlign }]}>{item.subject}</Text>
                ) : null}
              </Card.Content>
            </Card>
          )}
          ListEmptyComponent={
            <View style={styles.center}>
              <MaterialCommunityIcons name="email-outline" size={44} color={theme.colors.onSurfaceVariant} />
              <Text style={{ color: theme.colors.onSurfaceVariant, marginTop: 8 }}>{isRTL ? 'אין תבניות מייל' : 'No email templates'}</Text>
            </View>
          }
        />
      )}

      <FAB icon="plus" label={isRTL ? 'תבנית חדשה' : 'New template'} style={[styles.fab, { bottom: insets.bottom + 16 }]} color="white" onPress={openWeb} />

      <Modal visible={!!selected} transparent animationType="slide" onRequestClose={() => setSelected(null)}>
        <Pressable style={styles.overlay} onPress={() => setSelected(null)}>
          <Pressable style={[styles.sheet, { backgroundColor: theme.colors.surface, paddingBottom: insets.bottom + 12 }]} onPress={(e) => e.stopPropagation()}>
            <View style={[styles.rowBetween, { flexDirection: isRTL ? 'row-reverse' : 'row', marginBottom: 6 }]}>
              <Text numberOfLines={1} style={[styles.name, { flex: 1, color: theme.colors.onSurface, textAlign }]}>{selected?.name}</Text>
              <IconButton icon="close" size={20} onPress={() => setSelected(null)} />
            </View>
            <ScrollView style={{ maxHeight: 460 }}>
              {selected?.subject ? (
                <Text style={[styles.sub, { color: theme.colors.onSurfaceVariant, textAlign, marginBottom: 8 }]}>{selected.subject}</Text>
              ) : null}
              {selected ? <EmailHtmlPreview html={selected.html} rtl={isRTL} height={380} /> : null}
            </ScrollView>
            <Button mode="contained" icon="email-fast-outline" style={{ marginTop: 12 }} onPress={() => { setSelected(null); router.push('/(tabs)/more/campaigns/email-create' as any); }}>
              {isRTL ? 'קמפיין מייל חדש' : 'New email campaign'}
            </Button>
            <Button mode="outlined" icon="open-in-new" style={{ marginTop: 8 }} onPress={openWeb}>
              {isRTL ? 'עריכה בפורטל' : 'Edit in the web app'}
            </Button>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center', padding: 40 },
  card: { marginBottom: 10, borderRadius: 12 },
  rowBetween: { alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  name: { fontSize: 15, fontWeight: '700' },
  sub: { fontSize: 13, marginTop: 4 },
  fab: { position: 'absolute', right: 16, backgroundColor: '#2e6155' },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16 },
});
