import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Searchbar, Menu, IconButton } from 'react-native-paper';
import { useAppTheme } from '../hooks/useAppTheme';
import { useRTL } from '../hooks/useRTL';
import { useRowDirection } from '../hooks/useRowDirection';

export interface SortOption {
  key: string;
  label: string;
}

interface ListToolbarProps {
  query: string;
  onChangeQuery: (q: string) => void;
  placeholder: string;
  sortOptions?: SortOption[];
  sortKey?: string;
  sortDir?: 'asc' | 'desc';
  /** Called with the tapped key; the screen toggles direction when the same key is tapped again. */
  onSort?: (key: string) => void;
  /** Extra trailing control (e.g. list/board toggle). */
  trailing?: React.ReactNode;
}

/** Always-visible search field (no hidden magnifier) + a compact sort menu. */
export function ListToolbar({ query, onChangeQuery, placeholder, sortOptions, sortKey, sortDir, onSort, trailing }: ListToolbarProps) {
  const theme = useAppTheme();
  const { isRTL } = useRTL();
  const rowDirection = useRowDirection();
  const [menuVisible, setMenuVisible] = useState(false);
  return (
    <View style={[styles.wrap, { backgroundColor: theme.colors.surface, flexDirection: rowDirection }]}>
      <Searchbar
        placeholder={placeholder}
        value={query}
        onChangeText={onChangeQuery}
        style={[styles.search, { backgroundColor: theme.colors.surfaceVariant }]}
        inputStyle={{ fontSize: 14, minHeight: 0, textAlign: isRTL ? 'right' : 'left' }}
        iconColor={theme.colors.onSurfaceVariant}
        elevation={0}
      />
      {sortOptions && sortOptions.length > 0 && onSort ? (
        <Menu
          visible={menuVisible}
          onDismiss={() => setMenuVisible(false)}
          anchor={<IconButton icon="sort" size={22} iconColor={theme.colors.onSurfaceVariant} onPress={() => setMenuVisible(true)} />}
          contentStyle={{ backgroundColor: theme.colors.surface }}
        >
          {sortOptions.map((opt) => (
            <Menu.Item
              key={opt.key}
              title={opt.label}
              leadingIcon={sortKey === opt.key ? (sortDir === 'asc' ? 'arrow-up' : 'arrow-down') : undefined}
              titleStyle={sortKey === opt.key ? { color: theme.colors.primary, fontWeight: '700' } : undefined}
              onPress={() => {
                setMenuVisible(false);
                onSort(opt.key);
              }}
            />
          ))}
        </Menu>
      ) : null}
      {trailing}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingHorizontal: 10, paddingVertical: 6, gap: 2 },
  search: { flex: 1, height: 40, borderRadius: 20 },
});

export default ListToolbar;
