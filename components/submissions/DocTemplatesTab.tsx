import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAuthStore } from '../../stores/authStore';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useRTL } from '../../hooks/useRTL';
import { ListToolbar } from '../ListToolbar';
import { EmptyState } from '../EmptyState';
import { esignatureApi, type DocumentTemplate } from '../../services/api/esignature';
import ShareLinkSheet, { type ShareContact } from './ShareLinkSheet';

const DOC_COLOR = '#7c3aed';

/** Document templates: send a fill-in link to a customer, or open a signature request from the template. */
export default function DocTemplatesTab() {
  const theme = useAppTheme();
  const router = useRouter();
  const { isRTL, flexDirection, textAlign } = useRTL();
  const tr = (he: string, en: string) => (isRTL ? he : en);
  const user = useAuthStore((s) => s.user);
  const organization = user?.organization || '';

  const [templates, setTemplates] = useState<DocumentTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const [search, setSearch] = useState('');
  const [sharing, setSharing] = useState<DocumentTemplate | null>(null);

  const load = useCallback(async () => {
    if (!organization) return;
    try {
      setError(false);
      setTemplates(await esignatureApi.getDocumentTemplates(organization, true));
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
    return q ? templates.filter((t) => `${t.name} ${t.category || ''}`.toLowerCase().includes(q)) : templates;
  }, [templates, search]);

  // A fill-in link is a document created from the template (optionally tied to the recipient), like the web.
  const makeUrl = useCallback(async (contact?: ShareContact) => {
    if (!sharing) return '';
    const res = await esignatureApi.createFromTemplate({
      organization,
      templateId: sharing.id,
      documentName: sharing.name,
      language: user?.language === 'he' ? 'he' : 'en',
      contactPhone: contact?.phone || undefined,
      userId: user?.uID || (user as any)?.userId || '',
      userName: (user as any)?.fullname || (user as any)?.UserName || '',
      fillOnly: true,
      signers: contact ? [{ signerRole: 'signer1', signerName: contact.name || '', signerPhone: contact.phone, signerEmail: '' }] : undefined,
    });
    if (!res?.success) throw new Error(res?.error || tr('יצירת הקישור נכשלה', 'Could not create the link'));
    return res.data?.signers?.[0]?.formUrl || res.data?.mainFormUrl || '';
  }, [sharing, organization, user, isRTL]); // eslint-disable-line react-hooks/exhaustive-deps

  const renderItem = ({ item }: { item: DocumentTemplate }) => (
    <Pressable
      onPress={() => setSharing(item)}
      style={({ pressed }) => [styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.outlineVariant, borderStartColor: DOC_COLOR, opacity: pressed ? 0.75 : 1 }]}
    >
      <View style={[styles.top, { flexDirection }]}>
        <MaterialCommunityIcons name="file-document-outline" size={24} color={DOC_COLOR} />
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={{ fontSize: 15, fontWeight: '700', color: theme.colors.onSurface, textAlign }}>{item.name}</Text>
          {item.category || item.description ? (
            <Text numberOfLines={1} style={{ fontSize: 12, color: theme.colors.onSurfaceVariant, textAlign }}>{item.category || item.description}</Text>
          ) : null}
        </View>
        <Pressable onPress={() => setSharing(item)} hitSlop={8} style={[styles.iconBtn, { backgroundColor: '#dcfce7' }]}>
          <MaterialCommunityIcons name="link-variant" size={20} color="#16a34a" />
        </Pressable>
        <Pressable
          onPress={() => router.push({ pathname: '/(tabs)/more/esignature/create', params: { templateId: item.id } } as any)}
          hitSlop={8}
          style={[styles.iconBtn, { backgroundColor: '#f3e8ff' }]}
        >
          <MaterialCommunityIcons name="draw" size={20} color={DOC_COLOR} />
        </Pressable>
      </View>
    </Pressable>
  );

  return (
    <View style={{ flex: 1 }}>
      <ListToolbar query={search} onChangeQuery={setSearch} placeholder={tr('חיפוש מסמך...', 'Search documents...')} />
      <Text style={{ fontSize: 12, color: theme.colors.onSurfaceVariant, textAlign, paddingHorizontal: 16, paddingBottom: 4 }}>
        {tr('🔗 קישור למילוי · ✍️ בקשת חתימה', '🔗 fill-in link · ✍️ signature request')}
      </Text>
      {loading ? (
        <View style={styles.centered}><ActivityIndicator size="large" color={DOC_COLOR} /></View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(t) => t.id}
          renderItem={renderItem}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          contentContainerStyle={[styles.list, filtered.length === 0 && { flexGrow: 1 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} colors={[DOC_COLOR]} tintColor={DOC_COLOR} />}
          ListEmptyComponent={
            <EmptyState
              icon="file-document-outline"
              title={error ? tr('טעינת המסמכים נכשלה', 'Could not load documents') : tr('אין תבניות מסמכים', 'No document templates yet')}
              description={error ? undefined : tr('תבניות מסמכים נוצרות במערכת הווב', 'Document templates are created in the web app')}
            />
          }
        />
      )}
      <ShareLinkSheet visible={!!sharing} onDismiss={() => setSharing(null)} title={sharing?.name || ''} kind="document" user={user} makeUrl={makeUrl} />
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
