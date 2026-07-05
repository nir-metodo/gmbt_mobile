import { useEffect } from 'react';
import { Tabs, useSegments, usePathname } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { Badge, useTheme } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { CommonActions } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '../../stores/authStore';
import { useChatStore } from '../../stores/chatStore';
import { useSettingsStore } from '../../stores/settingsStore';
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
  requiresTelephony?: boolean;
}

export default function TabsLayout() {
  const { t } = useTranslation();
  const theme = useTheme<AppTheme>();
  const insets = useSafeAreaInsets();
  const { isRTL } = useRTL();

  const user = useAuthStore((s) => s.user);
  const unreadCount = useChatStore((s) => s.unreadCount);
  const telephonyEnabled = useSettingsStore((s) => s.telephonyEnabled);
  const loadTelephonySettings = useSettingsStore((s) => s.loadTelephonySettings);

  useEffect(() => {
    if (user?.organization) {
      loadTelephonySettings(user.organization);
    }
  }, [user?.organization]);

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
      name: 'tasks',
      titleKey: 'tabs.tasks',
      icon: 'checkbox-marked-circle-outline',
      iconFocused: 'checkbox-marked-circle',
      permission: 'tasks',
    },
    {
      name: 'more',
      titleKey: 'tabs.more',
      icon: 'dots-grid',
      iconFocused: 'dots-grid',
      permission: null,
    },
  ];

  const isTabVisible = (tab: TabConfig) => {
    if (tab.requiresTelephony && !telephonyEnabled) return false;
    if (tab.permission !== null &&
        !hasPermission(user?.Permissions, user?.SecurityRole, tab.permission as any)) {
      return false;
    }
    return true;
  };

  const visibleTabs = tabs.filter(isTabVisible);
  const hiddenTabs = tabs.filter((tab) => !isTabVisible(tab));

  const segments = useSegments();
  const pathname = usePathname();
  const isInsideConversation = segments.includes('[phoneNumber]' as never) || 
    (pathname.startsWith('/chats/') && pathname !== '/chats' && pathname !== '/chats/');

  // The bottom tab bar must ALWAYS be visible (so every user can reach "More" →
  // Settings / Push Notifications / Logout), even if their only permitted features
  // live inside the "More" screen. We only collapse it while inside a full-screen
  // chat conversation.
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
            height: isInsideConversation ? 0 : tabBarHeight,
            paddingBottom: isInsideConversation ? 0 : insets.bottom,
            overflow: 'hidden' as const,
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
                      { backgroundColor: theme.custom.tabBarActive },
                    ]}
                  />
                )}
              </View>
            ),
          }}
          listeners={({ navigation }) => ({
            tabPress: (e) => {
              const state = navigation.getState();
              const tabRoute = state.routes.find((r: any) => r.name === tab.name);
              const nestedState = tabRoute?.state;
              // If the tab has a nested stack with more than 1 screen, reset to root
              if (nestedState && nestedState.routes && nestedState.routes.length > 1) {
                e.preventDefault();
                navigation.dispatch({
                  ...CommonActions.reset({
                    index: 0,
                    routes: [{ name: 'index' }],
                  }),
                  target: nestedState.key,
                });
              }
            },
          })}
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
    elevation: 0,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
  },
  tabBarLabel: {
    fontSize: fontSize.xs,
    fontWeight: '600',
    marginTop: 1,
  },
  tabBarItem: {
    paddingTop: 0,
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
    top: -8,
    width: 24,
    height: 3,
    borderRadius: 1.5,
  },
});
