import React from 'react';
import { StyleSheet } from 'react-native';
import { Appbar } from 'react-native-paper';
import { useRouter } from 'expo-router';

const BRAND_COLOR = '#2e6155';

interface Props {
  title: string;
  subtitle?: string;
  /** Override the default back behaviour (router.back, falling back to the campaigns hub). */
  onBack?: () => void;
  actions?: Array<{ icon: string; onPress: () => void; disabled?: boolean }>;
}

/** Brand app bar used by the pushed WhatsApp-campaign screens (matches the campaigns hub header). */
export default function WaHeader({ title, subtitle, onBack, actions }: Props) {
  const router = useRouter();
  const back = () => {
    if (onBack) return onBack();
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/more/campaigns' as any);
  };
  return (
    <Appbar.Header style={{ backgroundColor: BRAND_COLOR }} mode="center-aligned">
      <Appbar.BackAction color="#FFFFFF" onPress={back} />
      <Appbar.Content title={title} subtitle={subtitle} titleStyle={styles.title} subtitleStyle={styles.subtitle} />
      {(actions || []).map((a, i) => (
        <Appbar.Action key={i} icon={a.icon} color="#FFFFFF" disabled={a.disabled} onPress={a.onPress} />
      ))}
    </Appbar.Header>
  );
}

const styles = StyleSheet.create({
  title: { color: '#FFFFFF', fontWeight: '700', fontSize: 17 },
  subtitle: { color: 'rgba(255,255,255,0.75)', fontSize: 12 },
});
