import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Pressable, StyleSheet, ActivityIndicator, LayoutChangeEvent, GestureResponderEvent } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Audio, AVPlaybackStatus } from 'expo-av';

const BRAND = '#2e6155';

function fmt(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

// Only one recording plays at a time: starting a new one stops the previous one.
let activeStop: (() => void) | null = null;

interface Props {
  uri: string;
  /** Known call length in seconds (shown until the file reports its own duration). */
  durationSec?: number;
  autoPlay?: boolean;
}

/**
 * In-app player for call recordings (play / pause, seek by tapping the bar, elapsed / total time).
 * Replaces opening the recording URL in the browser so the user never leaves the app.
 */
export function RecordingPlayer({ uri, durationSec, autoPlay }: Props) {
  const theme = useTheme();
  const soundRef = useRef<Audio.Sound | null>(null);
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [totalMs, setTotalMs] = useState((durationSec || 0) * 1000);
  const [failed, setFailed] = useState(false);
  const [barWidth, setBarWidth] = useState(0);

  const onStatus = useCallback((st: AVPlaybackStatus) => {
    if (!st.isLoaded) return;
    setPositionMs(st.positionMillis || 0);
    if (st.durationMillis) setTotalMs(st.durationMillis);
    setPlaying(st.isPlaying);
    if (st.didJustFinish) {
      setPlaying(false);
      setPositionMs(0);
      soundRef.current?.setPositionAsync(0).catch(() => {});
    }
  }, []);

  const stop = useCallback(() => {
    soundRef.current?.pauseAsync().catch(() => {});
  }, []);

  const unload = useCallback(() => {
    const s = soundRef.current;
    soundRef.current = null;
    if (s) s.unloadAsync().catch(() => {});
    if (activeStop === stop) activeStop = null;
  }, [stop]);

  useEffect(() => unload, [unload]);

  const toggle = useCallback(async () => {
    try {
      setFailed(false);
      if (!soundRef.current) {
        setLoading(true);
        await Audio.setAudioModeAsync({ playsInSilentModeIOS: true, allowsRecordingIOS: false, staysActiveInBackground: false });
        const { sound } = await Audio.Sound.createAsync({ uri }, { shouldPlay: false, progressUpdateIntervalMillis: 250 }, onStatus);
        soundRef.current = sound;
        setLoading(false);
      }
      const status = await soundRef.current.getStatusAsync();
      if (status.isLoaded && status.isPlaying) {
        await soundRef.current.pauseAsync();
      } else {
        if (activeStop && activeStop !== stop) activeStop();
        activeStop = stop;
        await soundRef.current.playAsync();
      }
    } catch {
      setLoading(false);
      setFailed(true);
    }
  }, [uri, onStatus, stop]);

  useEffect(() => {
    if (autoPlay) toggle();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const seek = useCallback(async (e: GestureResponderEvent) => {
    if (!soundRef.current || !totalMs || !barWidth) return;
    const ratio = Math.min(1, Math.max(0, e.nativeEvent.locationX / barWidth));
    try { await soundRef.current.setPositionAsync(Math.floor(totalMs * ratio)); } catch { /* ignore */ }
  }, [totalMs, barWidth]);

  const progress = totalMs > 0 ? Math.min(1, positionMs / totalMs) : 0;

  return (
    <View style={[styles.wrap, { backgroundColor: theme.colors.surfaceVariant }]}>
      <Pressable onPress={toggle} hitSlop={6} style={[styles.playBtn, { backgroundColor: BRAND }]} disabled={loading}>
        {loading
          ? <ActivityIndicator size={16} color="#FFF" />
          : <MaterialCommunityIcons name={playing ? 'pause' : 'play'} size={22} color="#FFF" />}
      </Pressable>
      <View style={styles.mid}>
        <Pressable
          onPress={seek}
          onLayout={(e: LayoutChangeEvent) => setBarWidth(e.nativeEvent.layout.width)}
          style={styles.barHit}
        >
          <View style={[styles.barBg, { backgroundColor: theme.colors.outlineVariant || '#d1d5db' }]}>
            <View style={[styles.barFill, { width: `${progress * 100}%`, backgroundColor: BRAND }]} />
          </View>
        </Pressable>
        <View style={styles.times}>
          <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>{fmt(positionMs)}</Text>
          {failed
            ? <Text variant="labelSmall" style={{ color: '#E63946' }}>⚠</Text>
            : <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>{totalMs ? fmt(totalMs) : '--:--'}</Text>}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 12, marginVertical: 6, direction: 'ltr' },
  playBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  mid: { flex: 1 },
  barHit: { height: 22, justifyContent: 'center' },
  barBg: { height: 5, borderRadius: 3, overflow: 'hidden' },
  barFill: { height: 5, borderRadius: 3 },
  times: { flexDirection: 'row', justifyContent: 'space-between' },
});
