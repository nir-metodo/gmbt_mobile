import React from 'react';
import { View, StyleSheet, Linking, Alert } from 'react-native';
import { Text, Button, IconButton } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../hooks/useAppTheme';
import { useRTL } from '../hooks/useRTL';
import { WEB_APP_BASE_URL } from '../constants/api';

interface WebFeatureScreenProps {
  titleKey: string;
  path: string;
  icon?: string;
  color?: string;
}

export default function WebFeatureScreen({ titleKey, path, icon = 'open-in-new', color }: WebFeatureScreenProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useAppTheme();
  const { t } = useTranslation();
  const { isRTL } = useRTL();

  const url = `${WEB_APP_BASE_URL}${path}`;
  const displayColor = color || theme.colors.primary;

  const handleOpen = async () => {
    try {
      const supported = await Linking.canOpenURL(url);
      if (supported) {
        await Linking.openURL(url);
      } else {
        Alert.alert(t('common.error'), t('errors.generic'));
      }
    } catch {
      Alert.alert(t('common.error'), t('errors.generic'));
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <View
        style={[
          styles.header,
          {
            backgroundColor: displayColor,
            paddingTop: insets.top + 4,
            flexDirection: isRTL ? 'row-reverse' : 'row',
          },
        ]}
      >
        <IconButton
          icon={isRTL ? 'arrow-right' : 'arrow-left'}
          iconColor="#FFFFFF"
          size={24}
          onPress={() => router.back()}
        />
        <Text style={styles.headerTitle} numberOfLines={1}>
          {t(titleKey)}
        </Text>
      </View>

      <View style={styles.content}>
        <View style={[styles.iconCircle, { backgroundColor: displayColor + '20' }]}>
          <MaterialCommunityIcons name={icon as any} size={64} color={displayColor} />
        </View>
        <Text variant="titleMedium" style={[styles.desc, { color: theme.colors.onSurface }]}>
          {t('more.openInWebDesc')}
        </Text>
        <Button
          mode="contained"
          onPress={handleOpen}
          icon="open-in-new"
          style={[styles.button, { backgroundColor: displayColor }]}
          contentStyle={styles.buttonContent}
        >
          {t('more.openInWeb')}
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 12,
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
    textAlign: 'center',
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  iconCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  desc: {
    textAlign: 'center',
    marginBottom: 32,
    lineHeight: 24,
  },
  button: {
    borderRadius: 12,
  },
  buttonContent: {
    flexDirection: 'row-reverse',
  },
});
