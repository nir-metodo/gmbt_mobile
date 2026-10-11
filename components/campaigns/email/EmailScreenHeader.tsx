import React from 'react';
import { View } from 'react-native';
import { Appbar } from 'react-native-paper';
import { useRouter } from 'expo-router';
import { BRAND } from './emailCampaignHelpers';

interface Props {
  title: string;
  /** Overrides the default router.back(). */
  onBack?: () => void;
  actions?: { icon: string; onPress: () => void; disabled?: boolean }[];
}

/** Brand-coloured app bar for the full-screen email campaign routes (the hub's own header is only on index). */
export default function EmailScreenHeader({ title, onBack, actions }: Props) {
  const router = useRouter();
  return (
    <Appbar.Header style={{ backgroundColor: BRAND }} mode="center-aligned">
      <Appbar.BackAction color="#FFFFFF" onPress={onBack || (() => router.back())} />
      <Appbar.Content title={title} titleStyle={{ color: '#FFFFFF', fontWeight: '700', fontSize: 18 }} />
      {(actions || []).map((a) => (
        <Appbar.Action key={a.icon} icon={a.icon} color="#FFFFFF" onPress={a.onPress} disabled={a.disabled} />
      ))}
      {!actions || actions.length === 0 ? <View style={{ width: 48 }} /> : null}
    </Appbar.Header>
  );
}
