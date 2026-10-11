import React, { useCallback, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, FlatList, RefreshControl, Pressable, Alert } from 'react-native';
import { Text, Searchbar, FAB, Menu, IconButton, ActivityIndicator, Button } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../stores/authStore';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useRTL } from '../../hooks/useRTL';
import { EmailCampaignListItem, emailCampaignsApi, errorMessage } from '../../services/api/emailCampaigns';
import { BRAND, formatDateTime, parseRunAt, statusMeta } from './email/emailCampaignHelpers';

const sortKey = (c: EmailCampaignListItem) => {
  const t = new Date(c.modifiedOn || c.createdOn || 0).getTime();
  return isNaN(t) ? 0 : t;
};

/** Email campaigns list (body only — the hub screen provides the app bar and channel toggle). */
export default function EmailCampaigns() {
  const router = useRouter();
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const { flexDirection, textAlign, isRTL } = useRTL();
  const { i18n } = useTranslation();
  const he = i18n.language !== 'en';
  const { user } = useAuthStore();
  const org = user?.organization || '';
  const userInfo = useMemo(
    () => ({ userId: user?.uID || user?.userId || '', userName: user?.fullname || user?.name || user?.email || '' }),
    [user],
  );

  const [items, setItems] = useState<EmailCampaignListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const loadedOnce = useRef(false);

  const load = useCallback(
    async (mode: 'initial' | 'refresh' | 'silent' = 'initial') => {
      if (!org) {
        setLoading(false);
        return;
      }
      if (mode === 'initial') setLoading(true);
      setError('');
      try {
        setItems(await emailCampaignsApi.list(org));
        loadedOnce.current = true;
      } catch (e) {
        setError(errorMessage(e, he ? 'שגיאה בטעינת הקמפיינים' : 'Failed to load campaigns'));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [org, he],
  );

  // Reload whenever the tab/screen regains focus (e.g. after create / send / delete)
  useFocusEffect(
    useCallback(() => {
      load(loadedOnce.current ? 'silent' : 'initial');
    }, [load]),
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items
      .filter((c) => !q || (c.name || '').toLowerCase().includes(q))
      .sort((a, b) => sortKey(b) - sortKey(a));
  }, [items, search]);

  const go = (pathname: string, params?: Record<string, string>) =>
    router.push({ pathname: `/(tabs)/more/campaigns/${pathname}`, params } as any);

  const openCampaign = (c: EmailCampaignListItem) => {
    // A draft has nothing to show in results yet — open the editor instead.
    if (statusMeta(c.status, he).key === 'draft') go('email-create', { id: c.id });
    else go('email-results', { id: c.id });
  };

  const duplicate = async (c: EmailCampaignListItem) => {
    setMenuFor(null);
    setBusyId(c.id);
    try {
      await emailCampaignsApi.duplicate(org, userInfo, c.id, he ? '(עותק)' : '(copy)');
      await load('silent');
    } catch (e) {
      Alert.alert(he ? 'שגיאה' : 'Error', errorMessage(e, he ? 'שכפול נכשל' : 'Duplicate failed'));
    } finally {
      setBusyId(null);
    }
  };

  const remove = (c: EmailCampaignListItem) => {
    setMenuFor(null);
    Alert.alert(
      he ? 'מחיקת קמפיין' : 'Delete campaign',
      he ? `למחוק את "${c.name}"? לא ניתן לשחזר.` : `Delete "${c.name}"? This cannot be undone.`,
      [
        { text: he ? 'ביטול' : 'Cancel', style: 'cancel' },
        {
          text: he ? 'מחיקה' : 'Delete',
          style: 'destructive',
          onPress: async () => {
            setBusyId(c.id);
            try {
              await emailCampaignsApi.remove(org, c.id);
              setItems((prev) => prev.filter((x) => x.id !== c.id));
            } catch (e) {
              Alert.alert(he ? 'שגיאה' : 'Error', errorMessage(e, he ? 'מחיקה נכשלה' : 'Delete failed'));
            } finally {
              setBusyId(null);
            }
          },
        },
      ],
    );
  };

  const scheduleLine = (c: EmailCampaignListItem) => {
    if (c.trigger === 'Scheduled') {
      const d = parseRunAt(c.runAt);
      const when = d ? formatDateTime(d, he) : c.runAt;
      return `${he ? 'מתוזמן' : 'Scheduled'}${when ? ': ' + when : ''}`;
    }
    return he ? 'שליחה ידנית' : 'Manual send';
  };

  const renderItem = ({ item }: { item: EmailCampaignListItem }) => {
    const m = statusMeta(item.status, he);
    return (
      <Pressable
        onPress={() => openCampaign(item)}
        style={({ pressed }) => [
          styles.card,
          { backgroundColor: theme.colors.surface, borderColor: theme.colors.outline, opacity: pressed ? 0.85 : 1 },
        ]}
      >
        <View style={[styles.row, { flexDirection }]}>
          <View style={styles.iconWrap}>
            <MaterialCommunityIcons name="email-outline" size={22} color={BRAND} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: theme.colors.onSurface, textAlign }} numberOfLines={2}>
              {item.name || (he ? 'ללא שם' : 'Untitled')}
            </Text>
            <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 12, textAlign, marginTop: 2 }} numberOfLines={1}>
              {scheduleLine(item)}
              {' · '}
              {item.recipientSource === 'Excel' ? (he ? 'קובץ Excel' : 'Excel list') : he ? 'אנשי קשר' : 'Contacts'}
            </Text>
          </View>
          {busyId === item.id ? (
            <ActivityIndicator size="small" color={BRAND} style={{ margin: 12 }} />
          ) : (
            <Menu
              visible={menuFor === item.id}
              onDismiss={() => setMenuFor(null)}
              anchor={<IconButton icon="dots-vertical" size={20} onPress={() => setMenuFor(item.id)} />}
            >
              <Menu.Item
                leadingIcon="chart-box-outline"
                title={he ? 'תוצאות' : 'Results'}
                onPress={() => {
                  setMenuFor(null);
                  go('email-results', { id: item.id });
                }}
              />
              <Menu.Item
                leadingIcon="pencil-outline"
                title={he ? 'עריכה / שליחה' : 'Edit / Send'}
                onPress={() => {
                  setMenuFor(null);
                  go('email-create', { id: item.id });
                }}
              />
              <Menu.Item leadingIcon="content-copy" title={he ? 'שכפול' : 'Duplicate'} onPress={() => duplicate(item)} />
              <Menu.Item
                leadingIcon="delete-outline"
                title={he ? 'מחיקה' : 'Delete'}
                titleStyle={{ color: theme.colors.error }}
                onPress={() => remove(item)}
              />
            </Menu>
          )}
        </View>
        <View style={[styles.row, { flexDirection, marginTop: 6, justifyContent: 'space-between' }]}>
          <View style={[styles.badge, { backgroundColor: m.color + '22' }]}>
            <Text style={{ color: m.color, fontWeight: '700', fontSize: 12 }}>{m.label}</Text>
          </View>
          <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 11 }}>
            {formatDateTime(item.modifiedOn || item.createdOn, he)}
            {item.modifiedBy ? ` · ${item.modifiedBy}` : ''}
          </Text>
        </View>
      </Pressable>
    );
  };

  return (
    <View style={styles.flex}>
      <View style={styles.searchWrap}>
        <Searchbar
          placeholder={he ? 'חיפוש קמפיין' : 'Search campaigns'}
          value={search}
          onChangeText={setSearch}
          style={{ backgroundColor: theme.colors.surface }}
          inputStyle={{ textAlign }}
        />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={BRAND} />
        </View>
      ) : error && items.length === 0 ? (
        <View style={styles.center}>
          <Text style={{ color: theme.colors.error, textAlign: 'center', marginBottom: 12 }}>{error}</Text>
          <Button mode="outlined" onPress={() => load('initial')}>
            {he ? 'נסו שוב' : 'Retry'}
          </Button>
        </View>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(c) => c.id}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 12, paddingBottom: insets.bottom + 96, flexGrow: 1 }}
          ListHeaderComponent={
            error ? <Text style={{ color: theme.colors.error, textAlign, marginBottom: 8 }}>{error}</Text> : null
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <MaterialCommunityIcons name="email-fast-outline" size={56} color={theme.colors.onSurfaceVariant} />
              <Text style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center', marginTop: 12 }}>
                {search
                  ? he
                    ? 'לא נמצאו קמפיינים'
                    : 'No campaigns found'
                  : he
                    ? 'עדיין אין קמפייני מייל. לחצו על + כדי ליצור את הראשון.'
                    : 'No email campaigns yet. Tap + to create your first one.'}
              </Text>
            </View>
          }
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                load('refresh');
              }}
              colors={[BRAND]}
            />
          }
        />
      )}

      <FAB
        icon="plus"
        onPress={() => go('email-create')}
        color="#FFFFFF"
        style={[
          styles.fab,
          { backgroundColor: BRAND, bottom: insets.bottom + 16, left: isRTL ? 16 : undefined, right: isRTL ? undefined : 16 },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  searchWrap: { paddingHorizontal: 12, paddingTop: 10 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 12, marginBottom: 10 },
  row: { alignItems: 'center', gap: 10 },
  iconWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#2e615522',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10 },
  fab: { position: 'absolute', borderRadius: 16 },
});
