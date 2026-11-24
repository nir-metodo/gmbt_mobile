import React, { useCallback, useMemo, useState } from 'react';
import { View, StyleSheet, FlatList, Pressable, Linking, Alert, RefreshControl, Modal, ScrollView } from 'react-native';
import { Text, Card, Chip, ActivityIndicator, IconButton, Button, FAB } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '../../stores/authStore';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useRTL } from '../../hooks/useRTL';
import { ListToolbar } from '../ListToolbar';
import TemplateBubble from '../campaigns/whatsapp/TemplateBubble';
import { analyzeTemplate, templateKey } from '../campaigns/whatsapp/campaignUtils';
import { campaignsApi, type WaTemplate } from '../../services/api/campaigns';
import axiosInstance from '../../services/api/axiosInstance';
import { WEB_APP_BASE_URL } from '../../constants/api';
import { defaultTemplateInfo } from './DefaultTemplatesTab';

type StatusFilter = 'all' | 'APPROVED' | 'PENDING' | 'REJECTED';

const STATUS_STYLE: Record<string, { bg: string; fg: string; he: string; en: string }> = {
  APPROVED: { bg: '#dcfce7', fg: '#166534', he: 'מאושרת', en: 'Approved' },
  PENDING: { bg: '#fef3c7', fg: '#92400e', he: 'ממתינה', en: 'Pending' },
  REJECTED: { bg: '#fee2e2', fg: '#991b1b', he: 'נדחתה', en: 'Rejected' },
  PAUSED: { bg: '#e5e7eb', fg: '#374151', he: 'מושהית', en: 'Paused' },
  DISABLED: { bg: '#e5e7eb', fg: '#374151', he: 'מושבתת', en: 'Disabled' },
};
const CATEGORY_LABEL: Record<string, { he: string; en: string }> = {
  MARKETING: { he: 'שיווק', en: 'Marketing' },
  UTILITY: { he: 'שירות', en: 'Utility' },
  AUTHENTICATION: { he: 'אימות', en: 'Authentication' },
};

const statusKey = (t: WaTemplate) => String(t.status || '').toUpperCase();

/** WhatsApp templates: browse, check approval, preview, create a new one, and start a campaign from an approved one. */
export default function WaTemplatesTab() {
  const router = useRouter();
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const { isRTL, textAlign } = useRTL();
  const org = useAuthStore((s) => s.user?.organization) || '';

  const [templates, setTemplates] = useState<WaTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [selected, setSelected] = useState<WaTemplate | null>(null);

  const load = useCallback(async () => {
    if (!org) return;
    try {
      const list = await campaignsApi.getTemplates(org);
      setTemplates(list);
    } catch {
      /* keep what we have */
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [org]);

  // Reload whenever the tab/screen regains focus (e.g. returning from "new template").
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Pull the latest approval status from Meta (same two calls the web "refresh" runs), then reload the list.
  const syncStatus = useCallback(async () => {
    if (!org) return;
    setRefreshing(true);
    try {
      await Promise.all([
        axiosInstance.post('/api/Webhooks/SyncTemplatesFromWabaToFirebase', { organization: org }).catch(() => {}),
        axiosInstance.post('/api/Webhooks/SyncAllTemplatesStatus', { organization: org }).catch(() => {}),
      ]);
    } finally {
      await load();
    }
  }, [org, load]);

  const openWeb = useCallback(async () => {
    try { await Linking.openURL(`${WEB_APP_BASE_URL}/Templates?source=mobileapp`); }
    catch { Alert.alert(isRTL ? 'שגיאה' : 'Error', isRTL ? 'לא ניתן לפתוח את הפורטל' : 'Could not open the web app'); }
  }, [isRTL]);

  const startCampaign = useCallback((t: WaTemplate) => {
    setSelected(null);
    router.push({ pathname: '/(tabs)/more/campaigns/wa-create', params: { templateId: templateKey(t) } } as any);
  }, [router]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: templates.length, APPROVED: 0, PENDING: 0, REJECTED: 0 };
    templates.forEach((t) => { const k = statusKey(t); if (c[k] !== undefined) c[k] += 1; });
    return c;
  }, [templates]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return templates
      .filter((t) => filter === 'all' || statusKey(t) === filter)
      .filter((t) => {
        if (!q) return true;
        const info = analyzeTemplate(t, isRTL);
        return `${t.friendlyName || ''} ${t.name || ''} ${info.bodyText || ''}`.toLowerCase().includes(q);
      })
      .sort((a, b) => String(a.friendlyName || a.name).localeCompare(String(b.friendlyName || b.name)));
  }, [templates, filter, query, isRTL]);

  const statusChip = (t: WaTemplate) => {
    const s = STATUS_STYLE[statusKey(t)] || { bg: '#e5e7eb', fg: '#374151', he: t.status || '—', en: t.status || '—' };
    return (
      <View style={[styles.pill, { backgroundColor: s.bg }]}>
        <Text style={{ fontSize: 11, fontWeight: '700', color: s.fg }}>{isRTL ? s.he : s.en}</Text>
      </View>
    );
  };

  const renderItem = ({ item }: { item: WaTemplate }) => {
    const info = analyzeTemplate(item, isRTL);
    const cat = CATEGORY_LABEL[String(item.category || '').toUpperCase()];
    const def = defaultTemplateInfo(item, isRTL);
    return (
      <Card style={[styles.card, { backgroundColor: theme.custom.cardBackground }]} onPress={() => setSelected(item)}>
        <Card.Content>
          <View style={[styles.rowBetween, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
            <Text numberOfLines={1} style={[styles.name, { color: theme.colors.onSurface, textAlign, flex: 1 }]}>{item.friendlyName || def?.title || item.name}</Text>
            {statusChip(item)}
          </View>
          {def ? (
            <View style={{ marginTop: 4, gap: 2 }}>
              <Text style={{ alignSelf: isRTL ? 'flex-end' : 'flex-start', fontSize: 11, fontWeight: '700', color: def.setup ? '#1d4ed8' : '#047857', backgroundColor: def.setup ? '#dbeafe' : '#d1fae5', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 1 }}>
                {def.setup ? (isRTL ? 'תבנית הקמה' : 'Setup template') : (isRTL ? 'תבנית ברירת מחדל' : 'Default template')}
              </Text>
              {def.use ? <Text style={{ fontSize: 12, color: '#047857', textAlign, lineHeight: 17 }}>{isRTL ? 'משמשת ל: ' : 'Used for: '}{def.use}</Text> : null}
            </View>
          ) : null}
          <Text numberOfLines={2} style={[styles.snippet, { color: theme.colors.onSurfaceVariant, textAlign }]}>{info.bodyText}</Text>
          <Text style={[styles.meta, { color: theme.colors.onSurfaceVariant, textAlign }]}>
            {[cat ? (isRTL ? cat.he : cat.en) : item.category, item.language].filter(Boolean).join(' · ')}
          </Text>
        </Card.Content>
      </Card>
    );
  };

  const filters: { key: StatusFilter; he: string; en: string }[] = [
    { key: 'all', he: 'הכול', en: 'All' },
    { key: 'APPROVED', he: 'מאושרות', en: 'Approved' },
    { key: 'PENDING', he: 'ממתינות', en: 'Pending' },
    { key: 'REJECTED', he: 'נדחו', en: 'Rejected' },
  ];

  const selInfo = selected ? analyzeTemplate(selected, isRTL) : null;
  const selApproved = selected ? statusKey(selected) === 'APPROVED' : false;

  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
      <ListToolbar query={query} onChangeQuery={setQuery} placeholder={isRTL ? 'חיפוש תבנית...' : 'Search templates...'} />
      <View style={[styles.filters, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
        {filters.map((f) => (
          <Chip key={f.key} compact selected={filter === f.key} showSelectedOverlay onPress={() => setFilter(f.key)} textStyle={{ fontSize: 12 }}>
            {(isRTL ? f.he : f.en)} {counts[f.key] ?? 0}
          </Chip>
        ))}
        <IconButton icon="refresh" size={18} style={{ margin: 0 }} onPress={syncStatus} accessibilityLabel={isRTL ? 'רענן סטטוס' : 'Refresh status'} />
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator /></View>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(t) => templateKey(t)}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 12, paddingBottom: 110 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={syncStatus} />}
          ListEmptyComponent={
            <View style={styles.center}>
              <MaterialCommunityIcons name="message-text-outline" size={44} color={theme.colors.onSurfaceVariant} />
              <Text style={{ color: theme.colors.onSurfaceVariant, marginTop: 8 }}>{isRTL ? 'אין תבניות להצגה' : 'No templates to show'}</Text>
            </View>
          }
        />
      )}

      <FAB
        icon="plus"
        label={isRTL ? 'תבנית חדשה' : 'New template'}
        style={[styles.fab, { bottom: insets.bottom + 16 }]}
        color="white"
        onPress={() => router.push('/(tabs)/more/templates/new' as any)}
      />

      <Modal visible={!!selected} transparent animationType="slide" onRequestClose={() => setSelected(null)}>
        <Pressable style={styles.overlay} onPress={() => setSelected(null)}>
          <Pressable style={[styles.sheet, { backgroundColor: theme.colors.surface, paddingBottom: insets.bottom + 12 }]} onPress={(e) => e.stopPropagation()}>
            <View style={[styles.rowBetween, { flexDirection: isRTL ? 'row-reverse' : 'row', marginBottom: 8 }]}>
              <Text numberOfLines={1} style={[styles.name, { flex: 1, color: theme.colors.onSurface, textAlign }]}>{selected?.friendlyName || selected?.name}</Text>
              {selected ? statusChip(selected) : null}
              <IconButton icon="close" size={20} onPress={() => setSelected(null)} />
            </View>
            <ScrollView style={{ maxHeight: 420 }}>
              {selInfo ? <TemplateBubble info={selInfo} he={isRTL} /> : null}
              <Text style={[styles.meta, { color: theme.colors.onSurfaceVariant, textAlign, marginTop: 10 }]}>
                {[selected?.name, selected?.category, selected?.language].filter(Boolean).join(' · ')}
              </Text>
              {statusKey(selected || ({} as WaTemplate)) === 'REJECTED' && (selected as any)?.rejectedReason ? (
                <Text style={{ color: '#991b1b', marginTop: 6, textAlign }}>{String((selected as any).rejectedReason)}</Text>
              ) : null}
              {statusKey(selected || ({} as WaTemplate)) === 'PENDING' ? (
                <Text style={{ color: '#92400e', marginTop: 6, textAlign }}>
                  {isRTL ? 'ממתינה לאישור WhatsApp - בדרך כלל דקות עד כמה שעות. משוך לרענון כדי לעדכן סטטוס.' : 'Waiting for WhatsApp approval - usually minutes to a few hours. Pull to refresh the status.'}
                </Text>
              ) : null}
            </ScrollView>
            {selApproved && selected ? (
              <Button mode="contained" icon="bullhorn-outline" style={{ marginTop: 12 }} onPress={() => startCampaign(selected)}>
                {isRTL ? 'צור קמפיין עם התבנית' : 'Create a campaign with this template'}
              </Button>
            ) : null}
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
  filters: { gap: 6, paddingHorizontal: 12, paddingBottom: 6, flexWrap: 'wrap', alignItems: 'center' },
  card: { marginBottom: 10, borderRadius: 12 },
  rowBetween: { alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  name: { fontSize: 15, fontWeight: '700' },
  snippet: { fontSize: 13, marginTop: 6 },
  meta: { fontSize: 11, marginTop: 6 },
  pill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  fab: { position: 'absolute', right: 16, backgroundColor: '#2e6155' },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16 },
});
