import React, { useMemo, useState } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../../../stores/authStore';
import { useAppTheme } from '../../../../hooks/useAppTheme';
import { useRTL } from '../../../../hooks/useRTL';
import { hasPermission } from '../../../../constants/permissions';
import { ScreenHeader } from '../../../../components/ScreenHeader';
import { EmptyState } from '../../../../components/EmptyState';
import FormsLinksTab from '../../../../components/submissions/FormsLinksTab';
import DocTemplatesTab from '../../../../components/submissions/DocTemplatesTab';
import ResponsesView from '../../../../components/submissions/ResponsesView';

type Tab = 'forms' | 'docs' | 'responses';

/** Forms & documents hub: send digital forms, send documents, and read the responses — one place, top tabs. */
export default function FormsAndDocumentsScreen() {
  const router = useRouter();
  const theme = useAppTheme();
  const { t } = useTranslation();
  const { isRTL } = useRTL();
  const user = useAuthStore((s) => s.user);
  const { tab: tabParam } = useLocalSearchParams<{ tab?: string }>();

  const canForms = hasPermission(user?.Permissions, user?.SecurityRole, 'webForms');
  const canDocs = hasPermission(user?.Permissions, user?.SecurityRole, 'documentTemplates');

  const tabs = useMemo(() => {
    const list: { key: Tab; icon: string; he: string; en: string; color: string }[] = [];
    if (canForms) list.push({ key: 'forms', icon: 'clipboard-text-outline', he: 'טפסים', en: 'Forms', color: '#0d9488' });
    if (canDocs) list.push({ key: 'docs', icon: 'file-document-outline', he: 'מסמכים', en: 'Documents', color: '#7c3aed' });
    list.push({ key: 'responses', icon: 'inbox-full-outline', he: 'תשובות', en: 'Responses', color: '#2e6155' });
    return list;
  }, [canForms, canDocs]);

  const initial = (tabs.find((x) => x.key === tabParam) || tabs[0]).key;
  const [tab, setTab] = useState<Tab>(initial);

  if (!canForms && !canDocs) {
    return (
      <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
        <ScreenHeader title={t('more.submissions')} onBack={() => router.back()} />
        <EmptyState icon="lock-outline" title={t('submissions.noAccess')} />
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
      <ScreenHeader title={t('more.submissions')} onBack={() => router.back()} />
      <View style={[styles.tabs, { flexDirection: isRTL ? 'row-reverse' : 'row', backgroundColor: theme.colors.surface, borderBottomColor: theme.colors.outlineVariant }]}>
        {tabs.map((x) => {
          const active = tab === x.key;
          return (
            <Pressable key={x.key} style={[styles.tab, active && { borderBottomColor: x.color }]} onPress={() => setTab(x.key)}>
              <MaterialCommunityIcons name={x.icon as any} size={18} color={active ? x.color : theme.colors.onSurfaceVariant} />
              <Text style={{ fontWeight: '700', fontSize: 14, color: active ? x.color : theme.colors.onSurfaceVariant }}>{isRTL ? x.he : x.en}</Text>
            </Pressable>
          );
        })}
      </View>
      {tab === 'forms' ? <FormsLinksTab /> : tab === 'docs' ? <DocTemplatesTab /> : <ResponsesView />}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  tabs: { borderBottomWidth: StyleSheet.hairlineWidth },
  tab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderBottomWidth: 3, borderBottomColor: 'transparent' },
});
