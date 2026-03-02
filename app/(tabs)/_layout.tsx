import { Tabs } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { Badge, useTheme } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '../../stores/authStore';
import { useChatStore } from '../../stores/chatStore';
import { useRTL } from '../../hooks/useRTL';
import { hasPermission } from '../../constants/permissions';
import { fontSize, spacing } from '../../constants/theme';
import type { AppTheme } from '../../constants/theme';

type TabIconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

interface TabConfig {
  name: string;
  titleKey: string;
  icon: TabIconName;
  iconFocused: TabIconName;
  permission: string | null;
  badge?: number;
}

export default function TabsLayout() {
  const { t } = useTranslation();
  const theme = useTheme<AppTheme>();
  const insets = useSafeAreaInsets();
  const { isRTL } = useRTL();

  const user = useAuthStore((s) => s.user);
  const unreadCount = useChatStore((s) => s.unreadCount);

  const tabs: TabConfig[] = [
    {
      name: 'chats',
      titleKey: 'tabs.chats',
      icon: 'chat-outline',
      iconFocused: 'chat',
      permission: 'chats',
      badge: unreadCount,
    },
    {
      name: 'contacts',
      titleKey: 'tabs.contacts',
      icon: 'account-group-outline',
      iconFocused: 'account-group',
      permission: 'contacts',
    },
    {
      name: 'leads',
      titleKey: 'tabs.leads',
      icon: 'trending-up',
      iconFocused: 'trending-up',
      permission: 'leads',
    },
    {
      name: 'phone-calls',
      titleKey: 'tabs.phoneCalls',
      icon: 'phone-outline',
      iconFocused: 'phone',
      permission: 'phoneCalls',
    },
    {
      name: 'more',
      titleKey: 'tabs.more',
      icon: 'dots-grid',
      iconFocused: 'dots-grid',
      permission: null,
    },
  ];

  const visibleTabs = tabs.filter(
    (tab) =>
      tab.permission === null ||
      hasPermission(user?.Permissions, user?.SecurityRole, tab.permission as any)
  );

  const hiddenTabs = tabs.filter(
    (tab) =>
      tab.permission !== null &&
      !hasPermission(user?.Permissions, user?.SecurityRole, tab.permission as any)
  );

  const tabBarHeight = 60 + insets.bottom;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: [
          styles.tabBar,
          {
            backgroundColor: theme.custom.tabBarBackground,
            borderTopColor: theme.custom.divider,
            height: tabBarHeight,
            paddingBottom: insets.bottom,
          },
        ],
        tabBarActiveTintColor: theme.custom.tabBarActive,
        tabBarInactiveTintColor: theme.custom.tabBarInactive,
        tabBarLabelStyle: styles.tabBarLabel,
        tabBarItemStyle: styles.tabBarItem,
      }}
    >
      {visibleTabs.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: t(tab.titleKey),
            tabBarIcon: ({ focused, color }) => (
              <View style={styles.iconContainer}>
                <MaterialCommunityIcons
                  name={focused ? tab.iconFocused : tab.icon}
                  size={24}
                  color={color}
                />
                {tab.badge != null && tab.badge > 0 && (
                  <Badge
                    size={18}
                    style={[
                      styles.badge,
                      { backgroundColor: theme.custom.unreadBadge },
                    ]}
                  >
                    {tab.badge > 99 ? '99+' : tab.badge}
                  </Badge>
                )}
                {focused && (
                  <View
                    style={[
                      styles.activeIndicator,
                      { backgroundColor: theme.colors.primary },
                    ]}
                  />
                )}
              </View>
            ),
          }}
        />
      ))}

      {hiddenTabs.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{ href: null }}
        />
      ))}
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    paddingTop: spacing.xs,
  },
  tabBarLabel: {
    fontSize: fontSize.xs,
    fontWeight: '600',
    marginTop: 2,
  },
  tabBarItem: {
    paddingTop: spacing.xs,
  },
  iconContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    width: 32,
    height: 28,
  },
  badge: {
    position: 'absolute',
    top: -6,
    right: -12,
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
  },
  activeIndicator: {
    position: 'absolute',
    bottom: -6,
    width: 20,
    height: 3,
    borderRadius: 1.5,
  },
});
