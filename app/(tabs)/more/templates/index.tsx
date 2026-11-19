import React, { useState } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAppTheme } from '../../../../hooks/useAppTheme';
import { useRTL } from '../../../../hooks/useRTL';
import { ScreenHeader } from '../../../../components/ScreenHeader';
import WaTemplatesTab from '../../../../components/templates/WaTemplatesTab';
import EmailTemplatesTab from '../../../../components/templates/EmailTemplatesTab';
import DefaultTemplatesTab from '../../../../components/templates/DefaultTemplatesTab';

type Tab = 'whatsapp' | 'email' | 'defaults';

/** Templates hub: WhatsApp (create / approval status / campaign) and Email tabs. */
export default function TemplatesScreen() {
  const router = useRouter();
  const theme = useAppTheme();
  const { isRTL } = useRTL();
  const { tab: tabParam } = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<Tab>(tabParam === 'email' ? 'email' : tabParam === 'defaults' ? 'defaults' : 'whatsapp');

  const tabs: { key: Tab; icon: string; he: string; en: string; color: string }[] = [
    { key: 'whatsapp', icon: 'whatsapp', he: 'וואטסאפ', en: 'WhatsApp', color: '#16a34a' },
    { key: 'email', icon: 'email-outline', he: 'מיילים', en: 'Email', color: '#2563eb' },
    { key: 'defaults', icon: 'star-outline', he: 'ברירות מחדל', en: 'Defaults', color: '#2e6155' },
  ];

  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
      <ScreenHeader title={isRTL ? 'תבניות' : 'Templates'} onBack={() => router.back()} />
      <View style={[styles.tabs, { flexDirection: isRTL ? 'row-reverse' : 'row', backgroundColor: theme.colors.surface, borderBottomColor: theme.colors.outlineVariant }]}>
        {tabs.map((t) => {
          const active = tab === t.key;
          return (
            <Pressable key={t.key} style={[styles.tab, active && { borderBottomColor: t.color }]} onPress={() => setTab(t.key)}>
              <MaterialCommunityIcons name={t.icon as any} size={18} color={active ? t.color : theme.colors.onSurfaceVariant} />
              <Text style={{ fontWeight: '700', fontSize: 14, color: active ? t.color : theme.colors.onSurfaceVariant }}>{isRTL ? t.he : t.en}</Text>
            </Pressable>
          );
        })}
      </View>
      {tab === 'whatsapp' ? <WaTemplatesTab /> : tab === 'email' ? <EmailTemplatesTab /> : <DefaultTemplatesTab />}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  tabs: { borderBottomWidth: StyleSheet.hairlineWidth },
  tab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderBottomWidth: 3, borderBottomColor: 'transparent' },
});
