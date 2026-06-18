import React from 'react';
import { View, Pressable } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../hooks/useAppTheme';

interface ListPaginationFooterProps {
  count: number;
  total: number;
  hasMore: boolean;
  onLoadMore: () => void;
  onLoadAll: () => void;
}

/**
 * Shared footer for the client-paginated entity lists (leads/quotes/cases/orders/...).
 * Shows "X / Y" and, while more rows remain, "Load more" + "Load all" buttons.
 */
function ListPaginationFooterBase({ count, total, hasMore, onLoadMore, onLoadAll }: ListPaginationFooterProps) {
  const theme = useAppTheme();
  const { t } = useTranslation();
  if (total === 0) return null;
  return (
    <View style={{ alignItems: 'center', paddingVertical: 14, gap: 8 }}>
      <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
        {count} / {total}
      </Text>
      {hasMore && (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Pressable
            onPress={onLoadMore}
            style={{ paddingHorizontal: 16, paddingVertical: 6, borderRadius: 16, backgroundColor: theme.colors.primaryContainer }}
          >
            <Text style={{ fontSize: 12, fontWeight: '600', color: theme.colors.onPrimaryContainer }}>
              {t('common.loadMore', 'טען עוד')}
            </Text>
          </Pressable>
          <Pressable
            onPress={onLoadAll}
            style={{ paddingHorizontal: 16, paddingVertical: 6, borderRadius: 16, backgroundColor: theme.colors.surfaceVariant }}
          >
            <Text style={{ fontSize: 12, fontWeight: '600', color: theme.colors.onSurfaceVariant }}>
              {t('common.loadAll', 'טען הכול')}
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

export const ListPaginationFooter = React.memo(ListPaginationFooterBase);
