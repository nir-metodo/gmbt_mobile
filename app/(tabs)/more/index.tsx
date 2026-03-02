import React, { useMemo } from 'react';
import { View, StyleSheet, ScrollView, Dimensions } from 'react-native';
import { Appbar, Surface, Text, useTheme } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../../hooks/useAppTheme';
import { useRTL } from '../../../hooks/useRTL';
import { useAuthStore } from '../../../stores/authStore';

const BRAND_COLOR = '#2e6155';
const { width } = Dimensions.get('window');
const CARD_GAP = 12;
const CARD_COLUMNS = 3;
const CARD_SIZE = (width - 32 - CARD_GAP * (CARD_COLUMNS - 1)) / CARD_COLUMNS;

interface MenuItem {
  key: string;
  icon: string;
  labelKey: string;
  route: string;
  color: string;
  adminOnly?: boolean;
  permission?: string;
}

const MENU_ITEMS: MenuItem[] = [
  { key: 'dashboard', icon: 'chart-bar', labelKey: 'more.dashboard', route: '/(tabs)/more/dashboard', color: BRAND_COLOR },
  { key: 'tasks', icon: 'checkbox-marked-circle-outline', labelKey: 'more.tasks', route: '/(tabs)/more/tasks', color: '#FF9800', permission: 'tasks' },
  { key: 'cases', icon: 'briefcase-outline', labelKey: 'more.cases', route: '/(tabs)/more/cases', color: '#FF6B35' },
  { key: 'media', icon: 'folder-image', labelKey: 'more.media', route: '/(tabs)/more/media', color: '#0ea5e9' },
  { key: 'reports', icon: 'chart-box-outline', labelKey: 'more.reports', route: '/(tabs)/more/reports', color: '#6366f1' },
  { key: 'quotes', icon: 'file-document-outline', labelKey: 'more.quotes', route: '/(tabs)/more/quotes', color: '#7B2D8E' },
  { key: 'esignature', icon: 'draw-pen', labelKey: 'more.eSignature', route: '/(tabs)/more/esignature', color: '#00A86B' },
  { key: 'users', icon: 'account-group-outline', labelKey: 'more.users', route: '/(tabs)/more/users', color: '#E63946', adminOnly: true },
  { key: 'settings', icon: 'cog-outline', labelKey: 'more.settings', route: '/(tabs)/more/settings', color: '#6C757D' },
];

export default function MoreScreen() {
  const theme = useAppTheme();
  const { isRTL } = useRTL();
  const { t } = useTranslation();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);

  const visibleItems = useMemo(() => {
    return MENU_ITEMS.filter((item) => {
      if (item.adminOnly && user?.SecurityRole?.toLowerCase() !== 'admin') return false;
      if (item.permission && !user?.Permissions?.[item.permission]) return false;
      return true;
    });
  }, [user]);

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Appbar.Header style={{ backgroundColor: BRAND_COLOR }} mode="center-aligned">
        <Appbar.Content title={t('more.title')} titleStyle={styles.headerTitle} />
      </Appbar.Header>

      <ScrollView contentContainerStyle={styles.grid}>
        {visibleItems.map((item) => (
          <Surface
            key={item.key}
            style={[styles.card, { backgroundColor: theme.colors.surface }]}
            elevation={1}
          >
            <View
              style={styles.cardTouchable}
              onTouchEnd={() => router.push(item.route as any)}
            >
              <View style={[styles.iconCircle, { backgroundColor: item.color + '15' }]}>
                <MaterialCommunityIcons
                  name={item.icon as any}
                  size={28}
                  color={item.color}
                />
              </View>
              <Text
                variant="labelMedium"
                style={[styles.cardLabel, { color: theme.colors.onSurface }]}
                numberOfLines={2}
              >
                {t(item.labelKey)}
              </Text>
            </View>
          </Surface>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  headerTitle: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 18,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 16,
    gap: CARD_GAP,
  },
  card: {
    width: CARD_SIZE,
    borderRadius: 16,
    overflow: 'hidden',
  },
  cardTouchable: {
    alignItems: 'center',
    paddingVertical: 20,
    paddingHorizontal: 8,
  },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  cardLabel: {
    textAlign: 'center',
    fontWeight: '600',
  },
});
