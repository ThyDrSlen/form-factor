/**
 * Calibration Failure Recovery modal
 *
 * Opened by `app/(tabs)/scan-arkit.tsx` when
 * `use-calibration-failure-handler` reports a stalled calibration. Shows
 * the classified failure reason, a human-friendly explanation, and three
 * CTAs:
 *   - Retry calibration (primary)
 *   - Open camera guide (secondary)
 *   - Try a different exercise (tertiary)
 *
 * Introduced by issue #479. Pure UI — the heavy lifting lives in the
 * analyzer (lib/services/calibration-failure-analyzer.ts) and the
 * calling screen decides what each CTA does.
 */

import React, { useCallback, useEffect, useMemo } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';

const REASON_LABELS: Record<string, string> = {
  low_stability: 'Low stability',
  insufficient_samples: 'Not in frame',
  excessive_drift: 'Drifted out of frame',
  timeout: 'Timed out',
};

const REASON_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  low_stability: 'body-outline',
  insufficient_samples: 'expand-outline',
  excessive_drift: 'move-outline',
  timeout: 'time-outline',
};

export default function CalibrationFailureRecoveryModal(): React.ReactElement {
  const router = useRouter();
  const params = useLocalSearchParams<{
    reason?: string;
    title?: string;
    remediation?: string;
    suggestedExercise?: string;
    elapsedMs?: string;
    sampleCount?: string;
    avgStability?: string;
    driftDeg?: string;
  }>();

  const reason = params.reason ?? 'timeout';
  const title = params.title ?? 'Calibration failed';
  const remediation =
    params.remediation ??
    'We couldn\'t lock in a baseline. Check your lighting and framing, then retry.';
  const suggestedExercise = params.suggestedExercise;

  const metrics = useMemo(
    () => ({
      elapsedMs: params.elapsedMs ? Number(params.elapsedMs) : null,
      sampleCount: params.sampleCount ? Number(params.sampleCount) : null,
      avgStability: params.avgStability ? Number(params.avgStability) : null,
      driftDeg: params.driftDeg ? Number(params.driftDeg) : null,
    }),
    [params.avgStability, params.driftDeg, params.elapsedMs, params.sampleCount]
  );

  const handleRetry = useCallback(() => {
    router.replace({
      pathname: '/(tabs)/scan-arkit',
      params: { retryCalibration: '1' },
    } as never);
  }, [router]);

  const handleOpenGuide = useCallback(() => {
    router.replace({
      pathname: '/(tabs)/scan-arkit',
      params: { showCameraGuide: '1' },
    } as never);
  }, [router]);

  const handleTryOther = useCallback(() => {
    if (!suggestedExercise) {
      router.back();
      return;
    }
    router.replace({
      pathname: '/(tabs)/scan-arkit',
      params: { exercise: suggestedExercise },
    } as never);
  }, [router, suggestedExercise]);

  const handleClose = useCallback(() => {
    router.back();
  }, [router]);

  // Fire a warning haptic on mount so users get tactile feedback that
  // calibration failed — parity with the native iOS recovery pattern and
  // makes the modal feel less silent when it slides in.
  useEffect(() => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  }, []);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.closeButton}
          onPress={handleClose}
          accessibilityRole="button"
          accessibilityLabel="Close recovery modal"
        >
          <Ionicons name="close" size={22} color="#F5F7FF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Calibration help</Text>
        <View style={styles.closeButton} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.reasonTag}>
          <Ionicons
            name={REASON_ICONS[reason] ?? 'alert-circle-outline'}
            size={14}
            color="#F59E0B"
          />
          <Text style={styles.reasonTagText}>{REASON_LABELS[reason] ?? 'Issue detected'}</Text>
        </View>

        <Text style={styles.title}>{title}</Text>
        <Text style={styles.body}>{remediation}</Text>

        {(metrics.sampleCount !== null || metrics.avgStability !== null) && (
          <View style={styles.metricsCard}>
            <Text style={styles.metricsHeader}>What we saw</Text>
            {metrics.sampleCount !== null && (
              <Text style={styles.metricsLine}>
                Samples collected: <Text style={styles.metricsValue}>{metrics.sampleCount}</Text>
              </Text>
            )}
            {metrics.avgStability !== null && (
              <Text style={styles.metricsLine}>
                Avg stability:{' '}
                <Text style={styles.metricsValue}>{metrics.avgStability.toFixed(2)}</Text>
              </Text>
            )}
            {metrics.driftDeg !== null && (
              <Text style={styles.metricsLine}>
                Head drift: <Text style={styles.metricsValue}>{metrics.driftDeg.toFixed(1)}°</Text>
              </Text>
            )}
            {metrics.elapsedMs !== null && (
              <Text style={styles.metricsLine}>
                Elapsed:{' '}
                <Text style={styles.metricsValue}>
                  {(metrics.elapsedMs / 1000).toFixed(1)} s
                </Text>
              </Text>
            )}
          </View>
        )}

        <TouchableOpacity
          style={[styles.ctaButton, styles.ctaPrimary]}
          onPress={handleRetry}
          accessibilityRole="button"
          accessibilityLabel="Retry calibration"
        >
          <Ionicons name="refresh-outline" size={18} color="#0B1A33" />
          <Text style={styles.ctaPrimaryText}>Retry calibration</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.ctaButton, styles.ctaSecondary]}
          onPress={handleOpenGuide}
          accessibilityRole="button"
          accessibilityLabel="Open camera placement guide"
        >
          <Ionicons name="camera-outline" size={18} color="#F5F7FF" />
          <Text style={styles.ctaSecondaryText}>Open camera guide</Text>
        </TouchableOpacity>

        {suggestedExercise && (
          <TouchableOpacity
            style={[styles.ctaButton, styles.ctaTertiary]}
            onPress={handleTryOther}
            accessibilityRole="button"
            accessibilityLabel="Try a different exercise"
          >
            <Ionicons name="swap-horizontal-outline" size={18} color="#8693A8" />
            <Text style={styles.ctaTertiaryText}>
              Try {formatExerciseLabel(suggestedExercise)} instead
            </Text>
          </TouchableOpacity>
        )}

        <Text style={styles.footerNote}>
          If this keeps happening, the camera placement guide walks through common fixes.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function formatExerciseLabel(id: string): string {
  return id
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
    .toLowerCase();
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#050E1F',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#F5F7FF',
    fontFamily: 'Lexend_700Bold',
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
    gap: 12,
  },
  reasonTag: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(245, 158, 11, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.35)',
    marginBottom: 4,
  },
  reasonTagText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#F59E0B',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    fontFamily: 'Lexend_700Bold',
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#F5F7FF',
    fontFamily: 'Lexend_700Bold',
  },
  body: {
    fontSize: 14,
    lineHeight: 22,
    color: 'rgba(245, 247, 255, 0.85)',
    fontFamily: 'Lexend_400Regular',
    marginBottom: 8,
  },
  metricsCard: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 12,
    padding: 14,
    gap: 4,
    marginBottom: 4,
  },
  metricsHeader: {
    fontSize: 11,
    fontWeight: '700',
    color: '#8693A8',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 4,
    fontFamily: 'Lexend_500Medium',
  },
  metricsLine: {
    fontSize: 13,
    color: 'rgba(245, 247, 255, 0.82)',
    fontFamily: 'Lexend_400Regular',
  },
  metricsValue: {
    color: '#F5F7FF',
    fontWeight: '600',
    fontFamily: 'Lexend_500Medium',
  },
  ctaButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
    marginTop: 4,
  },
  ctaPrimary: {
    backgroundColor: '#FAB05C',
  },
  ctaPrimaryText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0B1A33',
    fontFamily: 'Lexend_700Bold',
  },
  ctaSecondary: {
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  ctaSecondaryText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#F5F7FF',
    fontFamily: 'Lexend_500Medium',
  },
  ctaTertiary: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  ctaTertiaryText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#8693A8',
    fontFamily: 'Lexend_400Regular',
  },
  footerNote: {
    fontSize: 11,
    color: '#5D6B83',
    textAlign: 'center',
    marginTop: 8,
    fontFamily: 'Lexend_400Regular',
  },
});
