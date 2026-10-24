/**
 * HeartRatePill
 *
 * Top-right overlay showing live BPM + zone color while the scan
 * overlay is active. Zone buckets mirror useLiveFatigue:
 *   < 70% maxHR  → green (fresh)
 *   70-85% maxHR → amber (working)
 *   ≥ 85% maxHR  → red (fatigued)
 *
 * Renders null when bpm is missing so it never shows 0 BPM.
 */
import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

interface HeartRatePillProps {
  bpm: number | null | undefined;
  /** Timestamp of the sample (ms epoch) — used to show stale indicator */
  timestampMs?: number | null;
  /** Athlete's max HR for zone classification (default 190) */
  maxHeartRate?: number;
  /** Consider samples older than this (ms) stale; defaults 30s */
  staleAfterMs?: number;
  /** Optional clock for tests */
  now?: () => number;
  testID?: string;
}

type Zone = 'fresh' | 'working' | 'fatigued';

export function HeartRatePill({
  bpm,
  timestampMs,
  maxHeartRate = 190,
  staleAfterMs = 30_000,
  now = Date.now,
  testID,
}: HeartRatePillProps) {
  const zone = useMemo<Zone>(() => classifyZone(bpm, maxHeartRate), [bpm, maxHeartRate]);
  const isStale = useMemo(() => {
    if (timestampMs == null) return false;
    return now() - timestampMs > staleAfterMs;
  }, [timestampMs, now, staleAfterMs]);

  if (bpm == null || !Number.isFinite(bpm) || bpm <= 0) return null;

  const zoneStyle = zoneStyles[zone];
  return (
    <View
      style={[styles.container, zoneStyle.container, isStale && styles.stale]}
      testID={testID ?? 'heart-rate-pill'}
      accessibilityLabel={`Heart rate ${Math.round(bpm)} beats per minute${isStale ? ', stale' : ''}`}
    >
      <Text style={[styles.icon, zoneStyle.accent]}>♥</Text>
      <Text style={styles.bpm} testID="heart-rate-pill-bpm">
        {Math.round(bpm)}
      </Text>
      <Text style={styles.unit}>bpm</Text>
    </View>
  );
}

function classifyZone(
  bpm: number | null | undefined,
  maxHr: number,
): Zone {
  if (bpm == null || !Number.isFinite(bpm) || bpm <= 0 || maxHr <= 0) return 'fresh';
  const pct = bpm / maxHr;
  if (pct >= 0.85) return 'fatigued';
  if (pct >= 0.7) return 'working';
  return 'fresh';
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(12, 18, 36, 0.86)',
    borderWidth: 1,
  },
  bpm: {
    color: '#F5F7FF',
    fontSize: 14,
    fontWeight: '700',
  },
  unit: {
    color: 'rgba(220, 228, 245, 0.6)',
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  icon: {
    fontSize: 12,
  },
  stale: {
    opacity: 0.55,
  },
});

const zoneStyles: Record<Zone, { container: { borderColor: string }; accent: { color: string } }> = {
  fresh: {
    container: { borderColor: 'rgba(108, 255, 198, 0.5)' },
    accent: { color: '#6CFFC6' },
  },
  working: {
    container: { borderColor: 'rgba(255, 201, 76, 0.55)' },
    accent: { color: '#FFC94C' },
  },
  fatigued: {
    container: { borderColor: 'rgba(255, 110, 110, 0.65)' },
    accent: { color: '#FF6E6E' },
  },
};

export default HeartRatePill;
