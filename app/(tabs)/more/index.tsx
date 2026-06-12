import React, { useMemo } from 'react';
import { View, StyleSheet, ScrollView, Dimensions } from 'react-native';
import { Appbar, Surface, Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../../hooks/useAppTheme';
import { useRTL } from '../../../hooks/useRTL';
import { useAuthStore } from '../../../stores/authStore';
import { hasPermission } from '../../../constants/permissions';

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
  featureKey?: string; // org-level feature toggle key
  featureDefault?: boolean; // default if toggle not set
}

const MENU_ITEMS: MenuItem[] = [
  { key: 'dashboard', icon: 'chart-bar', labelKey: 'more.dashboard', route: '/(tabs)/more/dashboard', color: BRAND_COLOR, permission: 'dashboard' },
  { key: 'tasks', icon: 'checkbox-marked-circle-outline', labelKey: 'more.tasks', route: '/(tabs)/more/tasks', color: '#FF9800', permission: 'tasks' },
  { key: 'cases', icon: 'briefcase-outline', labelKey: 'more.cases', route: '/(tabs)/more/cases', color: '#FF6B35', permission: 'cases' },
  { key: 'media', icon: 'folder-image', labelKey: 'more.media', route: '/(tabs)/more/media', color: '#0ea5e9', permission: 'mediaManager' },
  { key: 'reports', icon: 'chart-box-outline', labelKey: 'more.reports', route: '/(tabs)/more/reports', color: '#6366f1', permission: 'reports' },
  { key: 'quotes', icon: 'file-document-outline', labelKey: 'more.quotes', route: '/(tabs)/more/quotes', color: '#7B2D8E', permission: 'quotes', featureKey: 'enableQuotes', featureDefault: true },
  { key: 'invoices', icon: 'file-invoice-dollar', labelKey: 'more.invoices', route: '/(tabs)/more/invoices', color: '#2e6155', permission: 'invoices', featureKey: 'enableInvoices', featureDefault: true },
  { key: 'esignature', icon: 'draw-pen', labelKey: 'more.eSignature', route: '/(tabs)/more/esignature', color: '#00A86B', permission: 'esignature', featureKey: 'enableEsignature', featureDefault: true },
  { key: 'orders', icon: 'cart-outline', labelKey: 'more.orders', route: '/(tabs)/more/orders', color: '#E67E22', permission: 'orders', featureKey: 'enableOrders', featureDefault: true },
  { key: 'catalog', icon: 'tag-multiple-outline', labelKey: 'more.catalog', route: '/(tabs)/more/catalog', color: '#8B5CF6', permission: 'catalog', featureKey: 'enableCatalog', featureDefault: true },
  { key: 'inventory', icon: 'warehouse', labelKey: 'more.inventory', route: '/(tabs)/more/inventory', color: '#059669', permission: 'inventory', featureKey: 'enableInventory', featureDefault: false },
  { key: 'purchaseOrders', icon: 'truck-delivery-outline', labelKey: 'more.purchaseOrders', route: '/(tabs)/more/purchasing', color: '#D97706', permission: 'purchasing', featureKey: 'enablePurchaseOrders', featureDefault: false },
  { key: 'suppliers', icon: 'store-outline', labelKey: 'more.suppliers', route: '/(tabs)/more/suppliers', color: '#7C3AED', permission: 'purchasing', featureKey: 'enableSuppliers', featureDefault: false },
  { key: 'transactions', icon: 'credit-card-outline', labelKey: 'more.transactions', route: '/(tabs)/more/transactions', color: '#2e6155', permission: 'quotes', featureKey: 'enableTransactions', featureDefault: true },
  { key: 'employees', icon: 'badge-account-horizontal-outline', labelKey: 'more.employees', route: '/(tabs)/more/employees', color: '#2A9D8F', permission: 'employees', featureKey: 'enableEmployees', featureDefault: true },
  { key: 'calendar', icon: 'calendar-month-outline', labelKey: 'more.calendar', route: '/(tabs)/more/calendar', color: '#0284c7' },
  { key: 'email', icon: 'email-send-outline', labelKey: 'more.email', route: '/(tabs)/more/email', color: '#dc2626', permission: 'emailInbox' },
  { key: 'users', icon: 'account-group-outline', labelKey: 'more.users', route: '/(tabs)/more/users', color: '#E63946', adminOnly: true },
  { key: 'notifications', icon: 'bell-cog-outline', labelKey: 'more.notifications', route: '/(tabs)/more/notifications', color: '#FF6B35' },
  { key: 'settings', icon: 'cog-outline', labelKey: 'more.settings', route: '/(tabs)/more/settings', color: '#6C757D' },
];

export default function MoreScreen() {
  const theme = useAppTheme();
  const { isRTL } = useRTL();
  const { t } = useTranslation();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const orgFeatureToggles = useAuthStore((s) => s.orgFeatureToggles);

  const visibleItems = useMemo(() => {
    return MENU_ITEMS.filter((item) => {
      if (item.adminOnly && user?.SecurityRole?.toLowerCase() !== 'admin') return false;
      if (item.permission && !hasPermission(user?.Permissions, user?.SecurityRole, item.permission as any)) return false;
      if (item.featureKey) {
        const enabled = orgFeatureToggles[item.featureKey] ?? item.featureDefault ?? true;
        if (!enabled) return false;
      }
      return true;
    });
  }, [user, orgFeatureToggles]);

  // Note: we intentionally do NOT auto-navigate into a single feature here. The "More"
  // grid must always be reachable so the user can open Settings / Push Notifications /
  // Logout, even when only one content feature is permitted.

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Appbar.Header style={{ backgroundColor: BRAND_COLOR }} mode="center-aligned">
        <Appbar.Content title={t('more.title')} titleStyle={styles.headerTitle} />
      </Appbar.Header>

      <ScrollView contentContainerStyle={[styles.grid, { flexDirection: 'row' }]}>
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
