import { I18nManager } from 'react-native';
import { useSettingsStore } from '../stores/settingsStore';

export function useRTL() {
  const language = useSettingsStore((s) => s.language);
  const isRTL = language === 'he';

  if (I18nManager.isRTL !== isRTL) {
    I18nManager.allowRTL(isRTL);
    I18nManager.forceRTL(isRTL);
  }

  return {
    isRTL,
    textAlign: isRTL ? 'right' as const : 'left' as const,
    flexDirection: isRTL ? 'row-reverse' as const : 'row' as const,
    writingDirection: isRTL ? 'rtl' as const : 'ltr' as const,
  };
}
