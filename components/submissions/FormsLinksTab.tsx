import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { Snackbar, Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { useAuthStore } from '../../stores/authStore';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useRTL } from '../../hooks/useRTL';
import { ListToolbar } from '../ListToolbar';
import { EmptyState } from '../EmptyState';
import { buildFormPublicUrl, webFormsApi, type WebFormItem } from '../../services/api/webForms';
import ShareLinkSheet from './ShareLinkSheet';

const FORM_COLOR = '#0d9488';

/** Web forms: copy the public link or send it to a customer in one tap. */
export default function FormsLinksTab() {
  const theme = useAppTheme();
  const { isRTL, flexDirection, textAlign } = useRTL();
  const tr = (he: string, en: string) => (isRTL ? he : en);
  const user = useAuthStore((s) => s.user);
  const organization = user?.organization || '';

  const [forms, setForms] = useState<WebFormItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const [search, setSearch] = useState('');
  const [sharing, setSharing] = useState<WebFormItem | null>(null);
  const [toast, setToast] = useState('');

  const load = useCallback(async () => {
    if (!organization) return;
    try {
      setError(false);
      setForms(await webFormsApi.getAll(organization));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [organization]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? forms.filter((f) => f.title.toLowerCase().includes(q)) : forms;
  }, [forms, search]);

  const notPublished = () =>
    Alert.alert(tr('הטופס בטיוטה', 'Form is a draft'), tr('יש לפרסם את הטופס (במערכת הווב) לפני ששולחים אותו ללקוחות.', 'Publish the form (in the web app) before sending it to customers.'));

  const copy = async (f: WebFormItem) => {
    if (f.status !== 'published') return notPublished();
    await Clipboard.setStringAsync(buildFormPublicUrl(organization, f));
    setToast(tr('הקישור הועתק', 'Link copied'));
  };

  const send = (f: WebFormItem) => (f.status !== 'published' ? notPublished() : setSharing(f));

  const renderItem = ({ item }: { item: WebFormItem }) => {
    const published = item.status === 'published';
    return (
      <Pressable
        onPress={() => send(item)}
        style={({ pressed }) => [styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.outlineVariant, borderStartColor: FORM_COLOR, opacity: pressed ? 0.75 : 1 }]}
      >
        <View style={[styles.top, { flexDirection }]}>
          <MaterialCommunityIcons name="clipboard-text-outline" size={24} color={FORM_COLOR} />
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={{ fontSize: 15, fontWeight: '700', color: theme.colors.onSurface, textAlign }}>{item.title || tr('(ללא שם)', '(untitled)')}</Text>
            <Text numberOfLines={1} style={{ fontSize: 12, color: theme.colors.onSurfaceVariant, textAlign }}>
              {published ? tr('מפורסם', 'Published') : tr('טיוטה', 'Draft')}
            </Text>
          </View>
          <Pressable onPress={() => copy(item)} hitSlop={8} style={[styles.iconBtn, { backgroundColor: theme.colors.surfaceVariant }]}>
            <MaterialCommunityIcons name="content-copy" size={20} color={theme.colors.onSurface} />
          </Pressable>
          <Pressable onPress={() => send(item)} hitSlop={8} style={[styles.iconBtn, { backgroundColor: '#dcfce7' }]}>
            <MaterialCommunityIcons name="whatsapp" size={20} color="#16a34a" />
          </Pressable>
        </View>
      </Pressable>
    );
  };

  return (
    <View style={{ flex: 1 }}>
      <ListToolbar query={search} onChangeQuery={setSearch} placeholder={tr('חיפוש טופס...', 'Search forms...')} />
      {loading ? (
        <View style={styles.centered}><ActivityIndicator size="large" color={FORM_COLOR} /></View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(f) => f.id}
          renderItem={renderItem}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          contentContainerStyle={[styles.list, filtered.length === 0 && { flexGrow: 1 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} colors={[FORM_COLOR]} tintColor={FORM_COLOR} />}
          ListEmptyComponent={
            <EmptyState
              icon="clipboard-text-off-outline"
              title={error ? tr('טעינת הטפסים נכשלה', 'Could not load forms') : tr('אין טפסים', 'No forms yet')}
              description={error ? undefined : tr('טפסים נוצרים במערכת הווב (טפסי אינטרנט)', 'Forms are created in the web app (Web forms)')}
            />
          }
        />
      )}
      <ShareLinkSheet
        visible={!!sharing}
        onDismiss={() => setSharing(null)}
        title={sharing?.title || ''}
        kind="form"
        user={user}
        makeUrl={async () => (sharing ? buildFormPublicUrl(organization, sharing) : '')}
      />
      <Snackbar visible={!!toast} onDismiss={() => setToast('')} duration={1800}>{toast}</Snackbar>
    </View>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: 14, paddingBottom: 60 },
  card: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderStartWidth: 4, padding: 12 },
  top: { alignItems: 'center', gap: 10 },
  iconBtn: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
});
