import React, { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Appbar, SegmentedButtons } from 'react-native-paper';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAppTheme } from '../../../../hooks/useAppTheme';
import WhatsAppCampaigns from '../../../../components/campaigns/WhatsAppCampaigns';
import EmailCampaigns from '../../../../components/campaigns/EmailCampaigns';

const BRAND_COLOR = '#2e6155';
const CHANNEL_KEY = 'campaigns.channel';

type Channel = 'whatsapp' | 'email';

/**
 * Campaigns hub. Default channel = WhatsApp campaigns; a segmented toggle at the top switches to
 * Email campaigns (last choice is remembered). Each channel renders its own list + create/run flow.
 */
export default function CampaignsScreen() {
  const theme = useAppTheme();
  const router = useRouter();
  const { i18n } = useTranslation();
  const he = i18n.language !== 'en';
  const [channel, setChannel] = useState<Channel>('whatsapp');

  useEffect(() => {
    AsyncStorage.getItem(CHANNEL_KEY).then((v) => {
      if (v === 'email' || v === 'whatsapp') setChannel(v);
    }).catch(() => {});
  }, []);

  const changeChannel = (v: string) => {
    const next: Channel = v === 'email' ? 'email' : 'whatsapp';
    setChannel(next);
    AsyncStorage.setItem(CHANNEL_KEY, next).catch(() => {});
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Appbar.Header style={{ backgroundColor: BRAND_COLOR }} mode="center-aligned">
        <Appbar.BackAction color="#FFFFFF" onPress={() => router.back()} />
        <Appbar.Content title={he ? 'קמפיינים' : 'Campaigns'} titleStyle={styles.headerTitle} />
      </Appbar.Header>

      <View style={[styles.toggleWrap, { backgroundColor: theme.colors.surface, borderBottomColor: theme.colors.outline }]}>
        <SegmentedButtons
          value={channel}
          onValueChange={changeChannel}
          density="small"
          buttons={[
            { value: 'whatsapp', label: he ? 'וואטסאפ' : 'WhatsApp', icon: 'whatsapp' },
            { value: 'email', label: he ? 'מייל' : 'Email', icon: 'email-outline' },
          ]}
        />
      </View>

      <View style={styles.body}>
        {channel === 'whatsapp' ? <WhatsAppCampaigns /> : <EmailCampaigns />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerTitle: { color: '#FFFFFF', fontWeight: '700', fontSize: 18 },
  toggleWrap: { paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  body: { flex: 1 },
});
