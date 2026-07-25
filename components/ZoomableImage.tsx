import React, { useEffect } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';

const MAX_SCALE = 5;
const MIN_SCALE = 1;
const DOUBLE_TAP_SCALE = 2.5;

type Props = {
  uri: string;
  /** Bumped by the parent (e.g. the gallery index) so the transform resets when the image changes. */
  resetKey?: string | number;
  /** Called when the user pinches past 1x, so the parent can disable swipe/paging while zoomed. */
  onZoomChange?: (zoomed: boolean) => void;
  /**
   * Called when the user swipes horizontally while NOT zoomed, to page between media.
   * dir = +1 when swiping to the right, -1 when swiping to the left.
   */
  onHorizontalSwipe?: (dir: number) => void;
};

// Full-screen pinch-to-zoom + pan + double-tap image, built on the gesture-handler / reanimated
// stack already used across the app. Used by the chat media gallery so opened images can be
// zoomed in and out.
export default function ZoomableImage({ uri, resetKey, onZoomChange, onHorizontalSwipe }: Props) {
  const { width, height } = useWindowDimensions();

  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);
  // Horizontal drag offset used ONLY while not zoomed, to page between media (with live feedback).
  const swipeX = useSharedValue(0);

  const reset = () => {
    'worklet';
    scale.value = withTiming(1);
    savedScale.value = 1;
    translateX.value = withTiming(0);
    translateY.value = withTiming(0);
    savedTranslateX.value = 0;
    savedTranslateY.value = 0;
  };

  // Reset the transform whenever the shown image changes.
  useEffect(() => {
    scale.value = 1;
    savedScale.value = 1;
    translateX.value = 0;
    translateY.value = 0;
    savedTranslateX.value = 0;
    savedTranslateY.value = 0;
    swipeX.value = 0;
    onZoomChange?.(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey, uri]);

  const notifyZoom = (zoomed: boolean) => {
    onZoomChange?.(zoomed);
  };

  const clampTranslation = () => {
    'worklet';
    // Keep the image from being panned entirely off-screen. Allowed travel grows with zoom.
    const maxX = (width * (scale.value - 1)) / 2;
    const maxY = (height * (scale.value - 1)) / 2;
    translateX.value = Math.min(maxX, Math.max(-maxX, translateX.value));
    translateY.value = Math.min(maxY, Math.max(-maxY, translateY.value));
  };

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      const next = savedScale.value * e.scale;
      scale.value = Math.min(MAX_SCALE, Math.max(MIN_SCALE, next));
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      if (scale.value <= MIN_SCALE) {
        reset();
        runOnJS(notifyZoom)(false);
      } else {
        clampTranslation();
        savedTranslateX.value = translateX.value;
        savedTranslateY.value = translateY.value;
        runOnJS(notifyZoom)(true);
      }
    });

  const pan = Gesture.Pan()
    .minPointers(1)
    .onUpdate((e) => {
      if (scale.value > MIN_SCALE) {
        translateX.value = savedTranslateX.value + e.translationX;
        translateY.value = savedTranslateY.value + e.translationY;
      } else if (onHorizontalSwipe) {
        // Not zoomed → track horizontal drag to page between media (with rubber-band feedback).
        swipeX.value = e.translationX;
      }
    })
    .onEnd((e) => {
      if (scale.value > MIN_SCALE) {
        clampTranslation();
        savedTranslateX.value = translateX.value;
        savedTranslateY.value = translateY.value;
        return;
      }
      if (onHorizontalSwipe) {
        const SWIPE_THRESHOLD = 55;
        if (Math.abs(e.translationX) > SWIPE_THRESHOLD && Math.abs(e.translationX) > Math.abs(e.translationY)) {
          const dir = e.translationX > 0 ? 1 : -1;
          runOnJS(onHorizontalSwipe)(dir);
        }
        swipeX.value = withTiming(0);
      }
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      if (scale.value > MIN_SCALE) {
        reset();
        runOnJS(notifyZoom)(false);
      } else {
        scale.value = withTiming(DOUBLE_TAP_SCALE);
        savedScale.value = DOUBLE_TAP_SCALE;
        runOnJS(notifyZoom)(true);
      }
    });

  const composed = Gesture.Race(doubleTap, Gesture.Simultaneous(pinch, pan));

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value + swipeX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  return (
    <GestureDetector gesture={composed}>
      <Animated.View style={[styles.container, animatedStyle]}>
        <Image source={{ uri }} style={styles.image} contentFit="contain" />
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  container: { width: '100%', height: '100%' },
  image: { width: '100%', height: '100%' },
});
