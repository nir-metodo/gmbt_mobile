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
import { esignatureApi } from '../../../../services/api/esignature';
import { formatDate } from '../../../../utils/formatters';
import { borderRadius } from '../../../../constants/theme';
import type { ESignatureDocument } from '../../../../types';

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
  const [searchVisible, setSearchVisible] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const searchAnim = useRef(new Animated.Value(0)).current;

  const fetchDocuments = useCallback(async () => {
    if (!user?.organization) return;
    try {
      setError(null);
      const result = await esignatureApi.getDocuments(user.organization);
      setDocuments(Array.isArray(result) ? result : []);
    } catch (err: any) {
      setError(err.message || t('errors.generic'));
    } finally {
      setLoading(false);
    }
  }, [user?.organization, t]);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchDocuments();
    setRefreshing(false);
  }, [fetchDocuments]);

  const toggleSearch = useCallback(() => {
    const willShow = !searchVisible;
    if (willShow) {
      setSearchVisible(true);
      Animated.timing(searchAnim, {
        toValue: 1,
        duration: 220,
        useNativeDriver: false,
      }).start();
    } else {
      Animated.timing(searchAnim, {
        toValue: 0,
        duration: 180,
        useNativeDriver: false,
      }).start(() => {
        setSearchVisible(false);
        setSearchQuery('');
      });
    }
  }, [searchVisible, searchAnim]);

  const filteredDocuments = useMemo(() => {
    let result = documents;

    if (statusFilter !== 'all') {
      result = result.filter((d) => d.status === statusFilter);
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter((d) => {
        const nameMatch =
          d.title?.toLowerCase().includes(query) ||
          d.documentName?.toLowerCase().includes(query);
        const contactMatch = d.contactName?.toLowerCase().includes(query);
        const signerMatch = d.signers?.some(
          (s) =>
            s.signerName?.toLowerCase().includes(query) ||
            s.signerEmail?.toLowerCase().includes(query)
        );
        return nameMatch || contactMatch || signerMatch;
      });
    }

    return result.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }, [documents, statusFilter, searchQuery]);

  const openDocument = useCallback(
    (doc: ESignatureDocument) => {
      router.push({ pathname: '/(tabs)/more/esignature/[id]', params: { id: doc.id } });
    },
    [router],
  );

  const searchHeightInterp = searchAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 56],
  });

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

  const renderDocumentCard = useCallback(
    ({ item }: { item: ESignatureDocument }) => {
      const statusColor = getStatusColor(item.status);
      const statusIcon = STATUS_ICONS[item.status] || 'file-document';
      const signersSummary = getSignersSummary(item);
      const signersCount = getSignersCount(item);

      return (
        <Pressable
          onPress={() => openDocument(item)}
          android_ripple={{ color: theme.colors.surfaceVariant }}
          style={({ pressed }) => [
            styles.docCard,
            {
              backgroundColor: pressed ? theme.colors.surfaceVariant : theme.custom.cardBackground,
              borderColor: theme.colors.outlineVariant,
            },
          ]}
        >
          <View style={[styles.docCardInner, { flexDirection }]}>
            <View style={[styles.docIconWrap, { backgroundColor: `${statusColor}15` }]}>
              <MaterialCommunityIcons name={statusIcon as any} size={24} color={statusColor} />
            </View>

            <View style={{ flex: 1, gap: 4 }}>
              <View style={[styles.docTopRow, { flexDirection }]}>
                <Text
                  variant="titleSmall"
                  numberOfLines={1}
                  style={[styles.docTitle, { color: theme.colors.onSurface, textAlign, flex: 1 }]}
                >
                  {item.documentName || item.title}
                </Text>
                <Chip
                  compact
                  textStyle={[styles.statusChipText, { color: statusColor }]}
                  style={[styles.statusChip, { backgroundColor: `${statusColor}18` }]}
                >
                  {t(`esignature.${item.status}`)}
                </Chip>
              </View>

              {signersSummary ? (
                <View style={[styles.metaItem, { flexDirection }]}>
                  <MaterialCommunityIcons
                    name="account-group"
                    size={14}
                    color={theme.colors.onSurfaceVariant}
                  />
                  <Text
                    variant="labelSmall"
                    numberOfLines={1}
                    style={[styles.metaText, { color: theme.colors.onSurfaceVariant, flex: 1 }]}
                  >
                    {signersSummary}
                  </Text>
                  {signersCount && (
                    <Text variant="labelSmall" style={{ color: statusColor, fontWeight: '600' }}>
                      {signersCount.signed}/{signersCount.total}
                    </Text>
                  )}
                </View>
              ) : null}

              <View style={[styles.docMeta, { flexDirection }]}>
                <View style={[styles.metaItem, { flexDirection }]}>
                  <MaterialCommunityIcons
                    name="calendar"
                    size={14}
                    color={theme.colors.onSurfaceVariant}
                  />
                  <Text
                    variant="labelSmall"
                    style={[styles.metaText, { color: theme.colors.onSurfaceVariant }]}
                  >
                    {formatDate(item.createdAt)}
                  </Text>
                </View>

                {item.signedAt ? (
                  <View style={[styles.metaItem, { flexDirection }]}>
                    <MaterialCommunityIcons
                      name="check-decagram"
                      size={14}
                      color="#4CAF50"
                    />
                    <Text
                      variant="labelSmall"
                      style={[styles.metaText, { color: '#4CAF50' }]}
                    >
                      {formatDate(item.signedAt)}
                    </Text>
                  </View>
                ) : null}

                {item.expiresAt && item.status !== 'signed' ? (
                  <View style={[styles.metaItem, { flexDirection }]}>
                    <MaterialCommunityIcons
                      name="calendar-clock"
                      size={14}
                      color={item.status === 'expired' ? '#F44336' : '#FF9800'}
                    />
                    <Text
                      variant="labelSmall"
                      style={[styles.metaText, { color: item.status === 'expired' ? '#F44336' : theme.colors.onSurfaceVariant }]}
                    >
                      {formatDate(item.expiresAt)}
                    </Text>
                  </View>
                ) : null}
              </View>
            </View>
          </View>
        </Pressable>
      );
    },
    [theme, openDocument, flexDirection, textAlign, t],
  );

  const renderEmpty = useCallback(() => {
    if (loading) return null;

    return (
      <View style={styles.emptyContainer}>
        <MaterialCommunityIcons
          name="file-sign"
          size={72}
          color={theme.colors.onSurfaceVariant}
          style={{ opacity: 0.3 }}
        />
        <Text
          variant="titleMedium"
          style={[styles.emptyTitle, { color: theme.colors.onSurface }]}
        >
          {t('esignature.noDocuments')}
        </Text>
        <Text
          variant="bodyMedium"
          style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center' }}
        >
          {t('esignature.noDocumentsDesc')}
        </Text>
      </View>
    );
  }, [loading, theme, t]);

  if (loading && documents.length === 0) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
      {/* Header */}
      <View
        style={[
          styles.header,
          { backgroundColor: theme.custom.headerBackground, paddingTop: insets.top + 8 },
        ]}
      >
        <View style={[styles.headerRow, { flexDirection }]}>
          <IconButton
            icon={isRTL ? 'arrow-right' : 'arrow-left'}
            iconColor={theme.custom.headerText}
            size={24}
            onPress={() => router.back()}
          />
          <Text style={[styles.headerTitle, { flex: 1, textAlign }]}>{t('esignature.title')}</Text>
          <Pressable
            onPress={toggleSearch}
            hitSlop={8}
            style={({ pressed }) => [styles.headerIcon, pressed && { opacity: 0.7 }]}
          >
            <MaterialCommunityIcons
              name={searchVisible ? 'close' : 'magnify'}
              size={24}
              color={theme.custom.headerText}
            />
          </Pressable>
        </View>
      </View>

      {/* Search bar */}
      {searchVisible && (
        <Animated.View
          style={[
            styles.searchWrap,
            {
              height: searchHeightInterp,
              opacity: searchAnim,
              backgroundColor: theme.custom.headerBackground,
            },
          ]}
        >
          <Searchbar
            placeholder={t('esignature.searchPlaceholder')}
            value={searchQuery}
            onChangeText={setSearchQuery}
            style={[styles.searchbar, { backgroundColor: theme.colors.surface }]}
            inputStyle={{ fontSize: 14, textAlign: isRTL ? 'right' : 'left' }}
            iconColor={theme.colors.onSurfaceVariant}
            autoFocus
          />
        </Animated.View>
      )}

      {/* Filter chips */}
      <View
        style={[
          styles.filtersRow,
          { backgroundColor: theme.colors.surface, borderBottomColor: theme.colors.outline },
        ]}
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={[styles.filtersScroll, { flexDirection }]}
        >
          {STATUS_FILTERS.map((f) => {
            const chipColor = f === 'all' ? theme.colors.primary : getStatusColor(f);
            const isActive = statusFilter === f;

            return (
              <Chip
                key={f}
                selected={isActive}
                onPress={() => setStatusFilter(f)}
                showSelectedOverlay
                compact
                style={[
                  styles.filterChip,
                  isActive
                    ? { backgroundColor: `${chipColor}20`, borderColor: chipColor, borderWidth: 1 }
                    : { backgroundColor: theme.colors.surfaceVariant },
                ]}
                textStyle={[
                  styles.filterChipText,
                  isActive && { color: chipColor, fontWeight: '600' },
                ]}
              >
                {f === 'all' ? t('common.all') : t(`esignature.${f}`)}
              </Chip>
            );
          })}
        </ScrollView>
      </View>

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
        data={filteredDocuments}
        renderItem={renderDocumentCard}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={renderEmpty}
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
        onPress={() => router.push('/(tabs)/more/esignature/create' as any)}
        style={[
          styles.fab,
          { backgroundColor: theme.colors.primary, bottom: insets.bottom + 16 },
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
  headerIcon: { padding: 4, marginRight: 8 },
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
  },
  statusChip: {
    height: 24,
    borderRadius: 12,
  },
  statusChipText: {
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
    end: 16,
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
