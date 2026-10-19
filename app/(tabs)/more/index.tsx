import React, { useMemo, useState } from 'react';
import { View, StyleSheet, ScrollView, Dimensions, Pressable } from 'react-native';
import { Appbar, Menu, Searchbar, Surface, Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../../hooks/useAppTheme';
import { useRTL } from '../../../hooks/useRTL';
import { useAuthStore } from '../../../stores/authStore';
import { useSettingsStore } from '../../../stores/settingsStore';
import { hasPermission } from '../../../constants/permissions';
import AddTaskSheet from '../../../components/AddTaskSheet';

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
  permissionAny?: string[]; // visible when the user has ANY of these permissions
  featureKey?: string; // org-level feature toggle key
  featureDefault?: boolean; // default if toggle not set
  requiresTelephony?: boolean; // only show when org telephony is enabled
}

interface MenuSection {
  key: string;
  titleKey: string;
  items: MenuItem[];
}

// Grouped so the screen can be scanned instead of read: the first group (Sales & marketing)
// starts with Campaigns. Route names are unchanged; only the grouping is new.
const MENU_SECTIONS: MenuSection[] = [
  {
    key: 'sales',
    titleKey: 'more.sectionSales',
    items: [
      { key: 'campaigns', icon: 'bullhorn-outline', labelKey: 'more.campaigns', route: '/(tabs)/more/campaigns', color: BRAND_COLOR, permission: 'campaigns' },
      { key: 'quotes', icon: 'file-document-outline', labelKey: 'more.quotes', route: '/(tabs)/more/quotes', color: '#7B2D8E', permission: 'quotes', featureKey: 'enableQuotes', featureDefault: true },
      { key: 'orders', icon: 'cart-outline', labelKey: 'more.orders', route: '/(tabs)/more/orders', color: '#E67E22', permission: 'orders', featureKey: 'enableOrders', featureDefault: true },
      { key: 'invoices', icon: 'receipt-text-outline', labelKey: 'more.invoices', route: '/(tabs)/more/invoices', color: '#2e6155', permission: 'invoices', featureKey: 'enableInvoices', featureDefault: true },
      { key: 'transactions', icon: 'credit-card-outline', labelKey: 'more.transactions', route: '/(tabs)/more/transactions', color: '#2e6155', permission: 'quotes', featureKey: 'enableTransactions', featureDefault: true },
      { key: 'esignature', icon: 'draw-pen', labelKey: 'more.eSignature', route: '/(tabs)/more/esignature', color: '#00A86B', permission: 'esignature', featureKey: 'enableEsignature', featureDefault: true },
      { key: 'catalog', icon: 'tag-multiple-outline', labelKey: 'more.catalog', route: '/(tabs)/more/catalog', color: '#8B5CF6', permission: 'catalog', featureKey: 'enableCatalog', featureDefault: true },
    ],
  },
  {
    key: 'communication',
    titleKey: 'more.sectionCommunication',
    items: [
      { key: 'phoneCalls', icon: 'phone-outline', labelKey: 'more.phoneCalls', route: '/(tabs)/more/phone-calls', color: '#2563eb', permission: 'phoneCalls', requiresTelephony: true },
      { key: 'email', icon: 'email-send-outline', labelKey: 'more.email', route: '/(tabs)/more/email', color: '#dc2626', permission: 'emailInbox' },
      { key: 'media', icon: 'folder-image', labelKey: 'more.media', route: '/(tabs)/more/media', color: '#0ea5e9', permission: 'mediaManager' },
    ],
  },
  {
    key: 'operations',
    titleKey: 'more.sectionOperations',
    items: [
      { key: 'calendar', icon: 'calendar-month-outline', labelKey: 'more.calendar', route: '/(tabs)/more/calendar', color: '#0284c7' },
      { key: 'cases', icon: 'briefcase-outline', labelKey: 'more.cases', route: '/(tabs)/more/cases', color: '#FF6B35', permission: 'cases' },
      { key: 'inventory', icon: 'warehouse', labelKey: 'more.inventory', route: '/(tabs)/more/inventory', color: '#059669', permission: 'inventory', featureKey: 'enableInventory', featureDefault: false },
      { key: 'purchaseOrders', icon: 'truck-delivery-outline', labelKey: 'more.purchaseOrders', route: '/(tabs)/more/purchasing', color: '#D97706', permission: 'purchasing', featureKey: 'enablePurchaseOrders', featureDefault: false },
      { key: 'suppliers', icon: 'store-outline', labelKey: 'more.suppliers', route: '/(tabs)/more/suppliers', color: '#7C3AED', permission: 'purchasing', featureKey: 'enableSuppliers', featureDefault: false },
    ],
  },
  {
    key: 'insights',
    titleKey: 'more.sectionInsights',
    items: [
      { key: 'dashboard', icon: 'chart-bar', labelKey: 'more.dashboard', route: '/(tabs)/more/dashboard', color: BRAND_COLOR, permission: 'dashboard' },
      { key: 'reports', icon: 'chart-box-outline', labelKey: 'more.reports', route: '/(tabs)/more/reports', color: '#6366f1', permission: 'reports' },
      { key: 'submissions', icon: 'clipboard-text-outline', labelKey: 'more.submissions', route: '/(tabs)/more/submissions', color: '#0d9488', permissionAny: ['webForms', 'documentTemplates'] },
    ],
  },
  {
    key: 'admin',
    titleKey: 'more.sectionAdmin',
    items: [
      { key: 'employees', icon: 'badge-account-horizontal-outline', labelKey: 'more.employees', route: '/(tabs)/more/employees', color: '#2A9D8F', permission: 'employees', featureKey: 'enableEmployees', featureDefault: true },
      { key: 'notifications', icon: 'bell-cog-outline', labelKey: 'more.notifications', route: '/(tabs)/more/notifications', color: '#FF6B35' },
      { key: 'settings', icon: 'cog-outline', labelKey: 'more.settings', route: '/(tabs)/more/settings', color: '#6C757D' },
    ],
  },
];

export default function MoreScreen() {
  const theme = useAppTheme();
  const { isRTL, textAlign } = useRTL();
  const { t } = useTranslation();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const orgFeatureToggles = useAuthStore((s) => s.orgFeatureToggles);
  const telephonyEnabled = useSettingsStore((s) => s.telephonyEnabled);

  const [query, setQuery] = useState('');
  const [quickMenuVisible, setQuickMenuVisible] = useState(false);
  const [taskSheetVisible, setTaskSheetVisible] = useState(false);

  const canCreateTask = hasPermission(user?.Permissions, user?.SecurityRole, 'tasks');

  const visibleSections = useMemo(() => {
    const q = query.trim().toLowerCase();
    return MENU_SECTIONS.map((section) => ({
      ...section,
      items: section.items.filter((item) => {
        if (item.adminOnly && user?.SecurityRole?.toLowerCase() !== 'admin') return false;
        if (item.requiresTelephony && !telephonyEnabled) return false;
        if (item.permission && !hasPermission(user?.Permissions, user?.SecurityRole, item.permission as any)) return false;
        if (item.permissionAny && !item.permissionAny.some((p) => hasPermission(user?.Permissions, user?.SecurityRole, p as any))) return false;
        if (item.featureKey) {
          const enabled = orgFeatureToggles[item.featureKey] ?? item.featureDefault ?? true;
          if (!enabled) return false;
        }
        if (q && !t(item.labelKey).toLowerCase().includes(q)) return false;
        return true;
      }),
    })).filter((section) => section.items.length > 0);
  }, [user, orgFeatureToggles, telephonyEnabled, query, t]);

  const totalVisible = useMemo(
    () => visibleSections.reduce((n, s) => n + s.items.length, 0),
    [visibleSections],
  );

  // Note: we intentionally do NOT auto-navigate into a single feature here. The "More"
  // grid must always be reachable so the user can open Settings / Push Notifications /
  // Logout, even when only one content feature is permitted.

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Appbar.Header style={{ backgroundColor: BRAND_COLOR }} mode="center-aligned">
        <Appbar.Content title={t('more.title')} titleStyle={styles.headerTitle} />
        {/* Quick create: the two things you create from anywhere without opening a list first. */}
        <Menu
          visible={quickMenuVisible}
          onDismiss={() => setQuickMenuVisible(false)}
          anchor={<Appbar.Action icon="plus" color="#FFFFFF" onPress={() => setQuickMenuVisible(true)} />}
          anchorPosition="bottom"
        >
          {canCreateTask && (
            <Menu.Item
              leadingIcon="checkbox-marked-circle-outline"
              title={t('more.newTask')}
              onPress={() => {
                setQuickMenuVisible(false);
                setTaskSheetVisible(true);
              }}
            />
          )}
          {hasPermission(user?.Permissions, user?.SecurityRole, 'leads') && (
            <Menu.Item
              leadingIcon="trending-up"
              title={t('leads.addLead', 'ליד חדש')}
              onPress={() => {
                setQuickMenuVisible(false);
                router.push({ pathname: '/(tabs)/leads/[id]', params: { id: 'new' } } as any);
              }}
            />
          )}
          {hasPermission(user?.Permissions, user?.SecurityRole, 'contacts') && (
            <Menu.Item
              leadingIcon="account-plus-outline"
              title={t('contacts.addContact', 'איש קשר חדש')}
              onPress={() => {
                setQuickMenuVisible(false);
                router.push({ pathname: '/(tabs)/contacts/[id]', params: { id: 'new' } } as any);
              }}
            />
          )}
          <Menu.Item
            leadingIcon="calendar-plus"
            title={t('more.newEvent')}
            onPress={() => {
              setQuickMenuVisible(false);
              router.push({ pathname: '/(tabs)/more/calendar', params: { create: String(Date.now()) } } as any);
            }}
          />
        </Menu>
      </Appbar.Header>

      <View style={[styles.searchWrap, { backgroundColor: theme.colors.background }]}>
        <Searchbar
          placeholder={t('more.searchPlaceholder')}
          value={query}
          onChangeText={setQuery}
          style={[styles.searchbar, { backgroundColor: theme.colors.surfaceVariant }]}
          inputStyle={{ fontSize: 14, textAlign, minHeight: 0 }}
          iconColor={theme.colors.onSurfaceVariant}
        />
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {visibleSections.map((section) => (
          <View key={section.key} style={styles.section}>
            <Text
              variant="labelLarge"
              style={[styles.sectionTitle, { color: theme.colors.onSurfaceVariant, textAlign: isRTL ? 'right' : 'left' }]}
            >
              {t(section.titleKey)}
            </Text>
            <View style={styles.grid}>
              {section.items.map((item) => (
                <Surface
                  key={item.key}
                  style={[styles.card, { backgroundColor: theme.colors.surface }]}
                  elevation={1}
                >
                  {/* Pressable (not a raw View + onTouchEnd) so a SCROLL gesture never fires navigation.
                      onTouchEnd fired on any finger-lift — including while scrolling — which threw the
                      user into whatever card they released over. Pressable cancels the press once the
                      ScrollView claims the gesture, and its small movement tolerance keeps real taps working. */}
                  <Pressable
                    style={({ pressed }) => [styles.cardTouchable, pressed && styles.cardPressed]}
                    onPress={() => router.push(item.route as any)}
                    android_ripple={{ color: item.color + '22', borderless: false }}
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
                  </Pressable>
                </Surface>
              ))}
            </View>
          </View>
        ))}

        {query.trim() !== '' && totalVisible === 0 && (
          <View style={styles.empty}>
            <MaterialCommunityIcons name="magnify" size={48} color={theme.colors.onSurfaceVariant} style={{ opacity: 0.4 }} />
            <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant, marginTop: 8 }}>
              {t('common.noResults')}
            </Text>
          </View>
        )}
      </ScrollView>

      <AddTaskSheet
        visible={taskSheetVisible}
        onDismiss={() => setTaskSheetVisible(false)}
        organization={user?.organization || ''}
        user={user}
      />
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
  searchWrap: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 2,
  },
  searchbar: {
    height: 40,
    borderRadius: 20,
    elevation: 0,
  },
  content: {
    padding: 16,
    paddingTop: 8,
    paddingBottom: 32,
  },
  section: {
    marginBottom: 12,
  },
  sectionTitle: {
    fontWeight: '700',
    marginBottom: 8,
    marginTop: 4,
    paddingHorizontal: 2,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
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
  cardPressed: {
    opacity: 0.6,
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
  empty: {
    alignItems: 'center',
    paddingTop: 48,
  },
});
