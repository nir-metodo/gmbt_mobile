import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  Pressable,
  RefreshControl,
  Animated,
  ScrollView,
} from 'react-native';
import {
  Text,
  Searchbar,
  Chip,
  FAB,
  ActivityIndicator,
  IconButton,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../../../stores/authStore';
import { useAppTheme } from '../../../../hooks/useAppTheme';
import { useRTL } from '../../../../hooks/useRTL';
import { useDebouncedValue, useWindowedList } from '../../../../hooks/useWindowedList';
import { ListPaginationFooter } from '../../../../components/ListPaginationFooter';
import { esignatureApi } from '../../../../services/api/esignature';
import { getDataVisibility } from '../../../../constants/permissions';
import { formatDate } from '../../../../utils/formatters';
import { borderRadius } from '../../../../constants/theme';
import type { ESignatureDocument } from '../../../../types';
import { ScreenHeader } from '../../../../components/ScreenHeader';
import { ListToolbar } from '../../../../components/ListToolbar';
import { StatusFilterBar } from '../../../../components/StatusFilterBar';
import { DocumentListItem } from '../../../../components/DocumentListItem';
import { EmptyState } from '../../../../components/EmptyState';

const STATUS_FILTERS = ['all', 'pending', 'partiallySigned', 'signed', 'expired', 'cancelled'] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

const STATUS_COLORS: Record<string, string> = {
  pending: '#FF9800',
  partiallySigned: '#2196F3',
  signed: '#4CAF50',
  expired: '#F44336',
  cancelled: '#9E9E9E',
};

const STATUS_ICONS: Record<string, string> = {
  pending: 'clock-outline',
  partiallySigned: 'progress-check',
  signed: 'check-decagram',
  expired: 'clock-alert-outline',
  cancelled: 'close-circle-outline',
};

function getStatusColor(status: string): string {
  return STATUS_COLORS[status] || '#9E9E9E';
}

export default function ESignatureListScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useAppTheme();
  const { isRTL, flexDirection, textAlign } = useRTL();
  const { t } = useTranslation();

  const user = useAuthStore((s) => s.user);

  const [documents, setDocuments] = useState<ESignatureDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const esigDV = getDataVisibility(user?.DataVisibility, user?.SecurityRole, 'esignature');

  const fetchDocuments = useCallback(async () => {
    if (!user?.organization) { setLoading(false); return; }
    try {
      setError(null);
      const result = await esignatureApi.getDocuments(
        user.organization,
        esigDV as 'all' | 'own',
        user.uID || user.userId
      );
      setDocuments(Array.isArray(result) ? result : []);
    } catch (err: any) {
      setError(err.message || t('errors.generic'));
    } finally {
      setLoading(false);
    }
  }, [user?.organization, user?.uID, user?.userId, user?.SecurityRole, esigDV, t]);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchDocuments();
    setRefreshing(false);
  }, [fetchDocuments]);

  // Debounce search so the list re-filters once typing pauses (no per-keystroke flicker).
  const debouncedSearch = useDebouncedValue(searchQuery, 350);

  const baseList = useMemo(() => {
    let result = documents;
    if (debouncedSearch.trim()) {
      const query = debouncedSearch.toLowerCase();
      result = result.filter((d) => {
        const nameMatch =
          d.title?.toLowerCase().includes(query) ||
          d.documentName?.toLowerCase().includes(query);
        const contactMatch = d.contactName?.toLowerCase().includes(query);
        const signerMatch = d.signers?.some(
          (sg) =>
            sg.signerName?.toLowerCase().includes(query) ||
            sg.signerEmail?.toLowerCase().includes(query)
        );
        return nameMatch || contactMatch || signerMatch;
      });
    }
    return result;
  }, [documents, debouncedSearch]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const d of baseList) c[d.status] = (c[d.status] || 0) + 1;
    return c;
  }, [baseList]);

  const filteredDocuments = useMemo(() => {
    const result = statusFilter === 'all' ? [...baseList] : baseList.filter((d) => d.status === statusFilter);
    return result.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }, [baseList, statusFilter]);

  // Client-side pagination over the filtered list (search still spans everything).
  const { visible: visibleDocs, hasMore: docsHasMore, loadMore: docsLoadMore, loadAll: docsLoadAll, count: docsCount } = useWindowedList(filteredDocuments, {
    pageSize: 30,
    resetKey: `${statusFilter}|${debouncedSearch}`,
  });

  const openDocument = useCallback(
    (doc: ESignatureDocument) => {
      const docId = doc.documentId || doc.id;
      if (!docId) return;
      router.push(`/(tabs)/more/esignature/${docId}` as any);
    },
    [router],
  );

  const getSignersSummary = (doc: ESignatureDocument): string => {
    if (!doc.signers || doc.signers.length === 0) {
      return doc.contactName || '';
    }
    return doc.signers.map((s) => s.signerName).filter(Boolean).join(', ');
  };

  const getSignersCount = (doc: ESignatureDocument) => {
    if (!doc.signers || doc.signers.length === 0) return null;
    const signed = doc.signers.filter((s) => s.status === 'signed').length;
    return { signed, total: doc.signers.length };
  };

  const createDocument = useCallback(() => router.push('/(tabs)/more/esignature/create' as any), [router]);

  const renderDocumentCard = useCallback(
    ({ item }: { item: ESignatureDocument }) => {
      const signersSummary = getSignersSummary(item);
      const signersCount = getSignersCount(item);
      const expiring = !!item.expiresAt && item.status !== 'signed';
      const subtitle = [signersSummary, signersCount ? `${signersCount.signed}/${signersCount.total}` : ''].filter(Boolean).join(' · ');
      return (
        <DocumentListItem
          title={item.documentName || item.title}
          subtitle={subtitle}
          statusLabel={t(`esignature.${item.status}`)}
          statusColor={getStatusColor(item.status)}
          date={item.signedAt ? formatDate(item.signedAt) : expiring ? formatDate(item.expiresAt!) : formatDate(item.createdAt)}
          dateWarning={item.status === 'expired'}
          onPress={() => openDocument(item)}
        />
      );
    },
    [openDocument, t],
  );

  const renderEmpty = useCallback(() => {
    if (loading) return null;
    const filtering = documents.length > 0;
    return (
      <EmptyState
        icon="file-sign"
        title={filtering ? t('common.noResults') : t('esignature.noDocuments')}
        description={filtering ? undefined : t('esignature.noDocumentsDesc')}
        actionLabel={filtering ? undefined : t('esignature.addDocument')}
        onAction={filtering ? undefined : createDocument}
      />
    );
  }, [loading, documents.length, t, createDocument]);

  if (loading && documents.length === 0) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
      <ScreenHeader title={t('esignature.title')} onBack={() => router.back()} />

      <ListToolbar
        query={searchQuery}
        onChangeQuery={setSearchQuery}
        placeholder={t('esignature.searchPlaceholder')}
      />

      <StatusFilterBar
        allLabel={t('common.all')}
        allCount={baseList.length}
        options={STATUS_FILTERS.filter((f) => f !== 'all').map((st) => ({
          key: st,
          label: t(`esignature.${st}`),
          color: getStatusColor(st),
          count: counts[st] || 0,
        }))}
        value={statusFilter}
        onChange={(k) => setStatusFilter(k as StatusFilter)}
      />

      {/* Error banner */}
      {error ? (
        <Pressable
          onPress={fetchDocuments}
          style={[styles.errorBanner, { backgroundColor: theme.colors.errorContainer }]}
        >
          <MaterialCommunityIcons name="alert-circle" size={18} color={theme.colors.error} />
          <Text
            variant="bodySmall"
            style={[styles.errorText, { color: theme.colors.error }]}
            numberOfLines={1}
          >
            {error}
          </Text>
          <Text variant="labelSmall" style={{ color: theme.colors.error, fontWeight: '600' }}>
            {t('common.retry')}
          </Text>
        </Pressable>
      ) : null}

      {/* Document list */}
      <FlatList
        data={visibleDocs}
        renderItem={renderDocumentCard}
        keyExtractor={(item) => item.documentId || item.id}
        ListEmptyComponent={renderEmpty}
        ListFooterComponent={
          <ListPaginationFooter
            count={docsCount}
            total={filteredDocuments.length}
            hasMore={docsHasMore}
            onLoadMore={docsLoadMore}
            onLoadAll={docsLoadAll}
          />
        }
        onEndReached={docsHasMore ? docsLoadMore : undefined}
        onEndReachedThreshold={0.4}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[theme.colors.primary]}
            tintColor={theme.colors.primary}
          />
        }
        contentContainerStyle={[
          styles.listContent,
          filteredDocuments.length === 0 && styles.listContentEmpty,
        ]}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        showsVerticalScrollIndicator={false}
      />

      {/* FAB */}
      <FAB
        icon="plus"
        onPress={createDocument}
        style={[
          styles.fab,
          { backgroundColor: theme.colors.primary, bottom: insets.bottom + 16, left: isRTL ? 16 : undefined, right: isRTL ? undefined : 16 },
        ]}
        color="#FFFFFF"
        label={t('esignature.addDocument')}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    paddingBottom: 4,
  },
  headerRow: {
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  headerIcon: { padding: 4, marginEnd: 8 },
  searchWrap: {
    paddingHorizontal: 14,
    overflow: 'hidden',
    justifyContent: 'center',
    paddingBottom: 8,
  },
  searchbar: { height: 40, borderRadius: 20, elevation: 0 },
  filtersRow: {
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  filtersScroll: {
    paddingHorizontal: 14,
    gap: 8,
    alignItems: 'center',
  },
  filterChip: { height: 32 },
  filterChipText: { fontSize: 13 },
  listContent: { padding: 14, paddingBottom: 100 },
  listContentEmpty: { flexGrow: 1 },
  docCard: {
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    overflow: 'hidden',
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
  },
  docCardInner: {
    padding: 14,
    gap: 12,
    alignItems: 'flex-start',
  },
  docIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  docTopRow: {
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  docTitle: {
    fontWeight: '600',
    fontSize: 15,
    flexShrink: 1,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    flexShrink: 0,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  docMeta: {
    alignItems: 'center',
    gap: 14,
    flexWrap: 'wrap',
  },
  metaItem: {
    alignItems: 'center',
    gap: 4,
  },
  metaText: {
    fontSize: 12,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    paddingHorizontal: 40,
    gap: 12,
  },
  emptyTitle: { fontWeight: '600', marginTop: 8 },
  fab: {
    position: 'absolute',
    borderRadius: 16,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
  },
  errorText: { flex: 1, fontSize: 13 },
});
