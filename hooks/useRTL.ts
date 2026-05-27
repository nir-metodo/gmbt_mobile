import { I18nManager } from 'react-native';
import { useSettingsStore } from '../stores/settingsStore';

export function useRTL() {
  const language = useSettingsStore((s) => s.language);
  const isRTL = language === 'he' || I18nManager.isRTL;

  return {
    isRTL,
    textAlign: isRTL ? 'right' as const : 'left' as const,
    flexDirection: isRTL ? 'row-reverse' as const : 'row' as const,
    writingDirection: isRTL ? 'rtl' as const : 'ltr' as const,
    alignSelf: isRTL ? 'flex-end' as const : 'flex-start' as const,
  };
}
