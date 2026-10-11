import { I18nManager } from 'react-native';
import { useRTL } from './useRTL';

/**
 * Direction to use for a horizontal row that must flow right-to-left in Hebrew.
 *
 * The app forces NATIVE RTL (I18nManager.forceRTL) so a plain 'row' already flows right→left and a
 * horizontal ScrollView starts at the right edge. useRTL()'s 'row-reverse' on top of that would flip
 * the row back to left→right, so only reverse when the layout is NOT natively RTL.
 */
export function useRowDirection(): 'row' | 'row-reverse' {
  const { flexDirection } = useRTL();
  return I18nManager.isRTL ? 'row' : flexDirection;
}
