import { useEffect, useState } from 'react';
import { Keyboard, Platform, useWindowDimensions, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Layout helper for centered Paper `Modal` forms (Modal > ScrollView).
 *
 * Replaces `KeyboardAvoidingView` inside such modals. KAV's padding is measured against its own
 * frame and, inside a centered Portal modal, it leaves a stale blank strip at the bottom of the
 * surface (the form ends above the card's edge). Here we instead:
 *  - `surface`: lift the whole card by the keyboard height (spread onto contentContainerStyle),
 *  - `body`: bound the content wrapper so the ScrollView fills the card to the bottom and
 *    scrolls when the form is taller than the visible area.
 *
 * @param ratio the modal's `maxHeight` as a fraction of the screen (match the style's value).
 * @param chrome total vertical padding of the card (top + bottom).
 */
export function useModalKeyboard(ratio = 0.85, chrome = 56) {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [kb, setKb] = useState(0);

  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const s = Keyboard.addListener(showEvt, (e) => setKb(e.endCoordinates?.height ?? 0));
    const h = Keyboard.addListener(hideEvt, () => setKb(0));
    return () => { s.remove(); h.remove(); };
  }, []);

  const base = height * ratio - chrome;
  const visible = height - kb - insets.top - chrome - 24;
  const surface: ViewStyle = { marginBottom: kb };
  const body: ViewStyle = { maxHeight: Math.max(200, kb > 0 ? Math.min(base, visible) : base) };
  return { keyboardHeight: kb, surface, body };
}
