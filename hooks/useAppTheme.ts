import { useColorScheme } from 'react-native';
import { lightTheme, darkTheme } from '../constants/theme';
import { useSettingsStore } from '../stores/settingsStore';

export function useAppTheme() {
  const systemScheme = useColorScheme();
  const themeSetting = useSettingsStore((s) => s.theme);

  const isDark =
    themeSetting === 'dark' ||
    (themeSetting === 'system' && systemScheme === 'dark');

  return isDark ? darkTheme : lightTheme;
}
