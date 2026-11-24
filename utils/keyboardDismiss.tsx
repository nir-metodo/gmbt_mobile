import { ReactNode, useRef } from 'react';
import { findNodeHandle, Keyboard, TextInput, View } from 'react-native';

/**
 * App-wide "tap outside the keyboard closes it" (like every normal phone app).
 *
 * A short tap anywhere that is not the focused text field dismisses the keyboard - on titles, empty space, lists, buttons.
 * It does nothing when the tap lands on the focused field itself, when it moves to another field, or when the finger scrolls.
 * A screen that must keep the keyboard open for its own buttons (the chat composer's send / attach) calls keepKeyboardOnTouch()
 * from that area's onTouchStart.
 */
let keepForThisTouch = false;
export const keepKeyboardOnTouch = () => { keepForThisTouch = true; };

const TAP_SLOP = 10;
const focusedInput = (): any => (TextInput as any).State?.currentlyFocusedInput?.() ?? null;

export function KeyboardDismissRoot({ children }: { children: ReactNode }) {
  const start = useRef<{ x: number; y: number; focused: any; keep: boolean } | null>(null);
  return (
    <View
      style={{ flex: 1 }}
      onTouchStart={(e) => {
        // Bubbles child → root, so a child's keepKeyboardOnTouch() has already run here.
        start.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY, focused: focusedInput(), keep: keepForThisTouch };
        keepForThisTouch = false;
      }}
      onTouchEnd={(e) => {
        const s = start.current;
        start.current = null;
        if (!s || !s.focused || s.keep) return;
        if (Math.abs(e.nativeEvent.pageX - s.x) > TAP_SLOP || Math.abs(e.nativeEvent.pageY - s.y) > TAP_SLOP) return;
        const target = e.nativeEvent.target;
        // Let a tap on another field (which takes the focus) settle before deciding.
        setTimeout(() => {
          const now = focusedInput();
          if (!now || now !== s.focused) return;
          let tag: number | null = null;
          try { tag = findNodeHandle(now); } catch { /* ignore */ }
          if (tag != null && Number(tag) === Number(target)) return;
          Keyboard.dismiss();
        }, 60);
      }}
    >
      {children}
    </View>
  );
}
