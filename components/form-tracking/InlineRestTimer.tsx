/**
 * InlineRestTimer
 *
 * Compact countdown pill shown on the scan overlay while the active
 * session's rest timer is ticking. Includes +15s and Skip controls.
 *
 * Display-only ticker + two button callbacks. Consumers drive the
 * timer state via useSessionRunner (`restTimer`).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

interface InlineRestTimerProps {
  /** Rest started ISO timestamp (null = no rest active) */
  startedAt: string | null;
  /** Target rest duration in seconds */
  targetSeconds: number | null;
  /** Called when user taps +15s */
  onExtend15: () => void;
  /** Called when user taps Skip */
  onSkip: () => void;
  /** Optional: provide Date.now alternative for tests */
  now?: () => number;
  testID?: string;
}

export function InlineRestTimer({
  startedAt,
  targetSeconds,
  onExtend15,
  onSkip,
  now = Date.now,
  testID,
}: InlineRestTimerProps) {
  const isActive = startedAt != null && targetSeconds != null && targetSeconds > 0;
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!isActive) return undefined;
    const interval = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, [isActive]);

  const remaining = useMemo(() => {
    if (!isActive) return 0;
    const start = new Date(startedAt as string).getTime();
    if (Number.isNaN(start)) return 0;
    const elapsed = Math.floor((now() - start) / 1000);
    return Math.max(0, (targetSeconds as number) - elapsed);
    // tick forces recompute — intentional dep
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, startedAt, targetSeconds, tick, now]);

  if (!isActive) return null;

  return (
    <View style={styles.container} testID={testID ?? 'inline-rest-timer'}>
      <View style={styles.ring}>
        <Text style={styles.ringText} testID="inline-rest-timer-countdown">
          {formatMMSS(remaining)}
        </Text>
      </View>
      <View style={styles.actions}>
        <Pressable
          onPress={onExtend15}
          style={({ pressed }) => [styles.btn, pressed && styles.btnPressed]}
          accessibilityRole="button"
          accessibilityLabel="Add 15 seconds to rest"
          testID="inline-rest-timer-extend"
        >
          <Text style={styles.btnText}>+15s</Text>
        </Pressable>
        <Pressable
          onPress={onSkip}
          style={({ pressed }) => [styles.btn, styles.btnSkip, pressed && styles.btnPressed]}
          accessibilityRole="button"
          accessibilityLabel="Skip rest"
          testID="inline-rest-timer-skip"
        >
          <Text style={styles.btnSkipText}>Skip</Text>
        </Pressable>
      </View>
    </View>
  );
}

function formatMMSS(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 20,
    backgroundColor: 'rgba(12, 18, 36, 0.86)',
    borderWidth: 1,
    borderColor: 'rgba(120, 180, 255, 0.3)',
  },
  ring: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 2,
    borderColor: '#4C8CFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringText: {
    color: '#F5F7FF',
    fontSize: 13,
    fontWeight: '700',
  },
  actions: {
    flexDirection: 'row',
    gap: 6,
  },
  btn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: 'rgba(76, 140, 255, 0.18)',
    borderWidth: 1,
    borderColor: 'rgba(76, 140, 255, 0.4)',
  },
  btnPressed: {
    opacity: 0.7,
  },
  btnSkip: {
    backgroundColor: 'rgba(255, 110, 110, 0.14)',
    borderColor: 'rgba(255, 110, 110, 0.35)',
  },
  btnText: {
    color: '#DCE4F5',
    fontSize: 12,
    fontWeight: '600',
  },
  btnSkipText: {
    color: '#FF9E9E',
    fontSize: 12,
    fontWeight: '600',
  },
});

export default InlineRestTimer;
