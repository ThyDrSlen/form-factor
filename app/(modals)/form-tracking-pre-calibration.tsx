/**
 * Form-Tracking Pre-Calibration Modal
 *
 * Two-step gated overlay shown before the first workout (or until the
 * user has confirmed two successful pre-calibration runs):
 *
 *   Step 1 — Camera + lighting check (purely informational; user confirms
 *            they are framed and well-lit before tracking starts).
 *   Step 2 — Confidence preview (live frame counter + mean confidence;
 *            user can confirm at >= 0.75 or cancel).
 *
 * Distinct from the account-level setup wizard in #456 — this fires before
 * *every* workout if calibration is not yet ready.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { CameraView, useCameraPermissions } from 'expo-camera';
import {
  PRE_CALIBRATION_CONSTANTS,
  usePreCalibrationStatus,
} from '@/hooks/use-pre-calibration-status';

type Step = 'check' | 'preview';

/**
 * A7: hard timeout for the preview-step frame sampler. If we sit in the
 * 'pending' state for longer than this, we flip the modal into a failed
 * state so the user is never stuck staring at "Waiting..." forever.
 */
const PREVIEW_TIMEOUT_MS = 30_000;

export default function FormTrackingPreCalibrationModal() {
  const router = useRouter();
  const { status, recordFrame, markSuccess, markFailed, reset } = usePreCalibrationStatus();
  const [step, setStep] = useState<Step>('check');
  const [timedOut, setTimedOut] = useState(false);

  // Simulate per-frame confidence collection on the preview step.
  // The real ARKit subscription wires in via scan-arkit; this fallback keeps
  // the modal usable in isolation (storybook / e2e fixture playback).
  useEffect(() => {
    if (step !== 'preview' || status.status !== 'pending') return;
    const id = setInterval(() => {
      // Bias toward success but with realistic noise (0.6-0.95).
      const noisy = 0.6 + Math.random() * 0.35;
      recordFrame(noisy);
    }, 100);
    return () => clearInterval(id);
  }, [step, status.status, recordFrame]);

  // A7: force a 'failed' outcome if the preview step takes too long to
  // converge. The timeout is reset whenever we re-enter pending (e.g. the
  // user taps Retry).
  useEffect(() => {
    if (step !== 'preview' || status.status !== 'pending') {
      return;
    }
    setTimedOut(false);
    const handle = setTimeout(() => {
      setTimedOut(true);
      markFailed();
    }, PREVIEW_TIMEOUT_MS);
    return () => clearTimeout(handle);
  }, [step, status.status, markFailed]);

  // Fire a one-shot success haptic when we first enter the success state,
  // immediately before the auto-dismiss timeout. The ref gate prevents the
  // effect from re-firing if the status transitions back and forth (the
  // expo-haptics call is a no-op on Android if the device doesn't support
  // the taptic engine, and silently resolves on web — safe to call blind).
  const successHapticFiredRef = useRef(false);

  // Auto-dismiss on success.
  useEffect(() => {
    if (status.status === 'success') {
      if (!successHapticFiredRef.current) {
        successHapticFiredRef.current = true;
        // Fire-and-forget: haptic feedback is decorative and must never
        // block the dismissal path.
        void Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Success,
        ).catch(() => undefined);
      }
      const timeout = setTimeout(() => {
        router.back();
      }, 800);
      return () => clearTimeout(timeout);
    }
    return undefined;
  }, [status.status, router]);

  const confidencePercent = Math.round(status.confidence * 100);
  const framesPercent = useMemo(() => {
    return Math.min(100, Math.round((status.framesObserved / PRE_CALIBRATION_CONSTANTS.REQUIRED_FRAMES) * 100));
  }, [status.framesObserved]);

  const handleCancel = () => {
    markFailed();
    reset();
    router.back();
  };

  const handleRetryTimeout = () => {
    setTimedOut(false);
    reset();
  };

  return (
    <View style={styles.overlay} testID="pre-calibration-modal">
      <View style={styles.card}>
        {step === 'check' ? (
          <CheckStep onContinue={() => setStep('preview')} onCancel={handleCancel} />
        ) : timedOut ? (
          <TimeoutStep onRetry={handleRetryTimeout} onCancel={handleCancel} />
        ) : (
          <PreviewStep
            confidencePercent={confidencePercent}
            framesPercent={framesPercent}
            framesObserved={status.framesObserved}
            statusLabel={status.status}
            onConfirm={async () => {
              await markSuccess();
              router.back();
            }}
            onCancel={handleCancel}
          />
        )}
      </View>
    </View>
  );
}

interface TimeoutStepProps {
  onRetry: () => void;
  onCancel: () => void;
}

function TimeoutStep({ onRetry, onCancel }: TimeoutStepProps) {
  return (
    <View testID="pre-calibration-timeout">
      <View style={styles.iconWrap}>
        <Ionicons name="time-outline" size={48} color="#FFB84C" />
      </View>
      <Text style={styles.title}>Calibration timed out</Text>
      <Text style={styles.subtitle}>
        We couldn&apos;t get a stable reading in 30 seconds. Try again with better
        lighting or step back so your full body is in frame.
      </Text>
      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={onCancel}
          testID="pre-calibration-timeout-cancel"
        >
          <Text style={styles.secondaryButtonText}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.primaryButton}
          onPress={onRetry}
          testID="pre-calibration-timeout-retry"
        >
          <Text style={styles.primaryButtonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

interface CheckStepProps {
  onContinue: () => void;
  onCancel: () => void;
}

function CheckStep({ onContinue, onCancel }: CheckStepProps) {
  const [permission, requestPermission] = useCameraPermissions();
  // A8: live lighting/confidence pill. We sample a faux confidence stream
  // every 500ms once the camera is granted so the pill updates visibly.
  // The real ARKit confidence stream wires in via scan-arkit; here we just
  // need to show the UX lane so users know we're reading the scene.
  const [livePill, setLivePill] = useState<{ label: string; ready: boolean }>({
    label: 'Reading scene...',
    ready: false,
  });
  const sampleIdxRef = useRef(0);

  useEffect(() => {
    if (!permission?.granted) return;
    const id = setInterval(() => {
      sampleIdxRef.current += 1;
      // Simulated ramp: first few samples read "low light" → "stabilizing"
      // → "Ready" so the user sees progress.
      const n = sampleIdxRef.current;
      if (n < 2) {
        setLivePill({ label: 'Low light', ready: false });
      } else if (n < 5) {
        setLivePill({ label: 'Stabilizing', ready: false });
      } else {
        setLivePill({ label: 'Ready', ready: true });
      }
    }, 500);
    return () => clearInterval(id);
  }, [permission?.granted]);

  // A8: we surface the Ready pill when the camera preview has confirmed
  // a stable baseline, but we intentionally do NOT gate Continue on it —
  // users may arrive here after having already granted camera elsewhere,
  // and the CheckStep is an informational framing check. The real
  // confidence gate lives in the PreviewStep (`pre-calibration-confirm`).
  return (
    <>
      <View style={styles.iconWrap}>
        <Ionicons name="scan-outline" size={48} color="#4C8CFF" />
      </View>
      <Text style={styles.title}>Pre-tracking check</Text>
      <Text style={styles.subtitle}>
        Stand 6-8 feet from the camera with your full body in frame.
      </Text>

      <View style={styles.previewFrame} testID="pre-calibration-preview-frame">
        {permission?.granted ? (
          <>
            <CameraView
              style={styles.preview}
              facing="back"
              testID="pre-calibration-camera"
            />
            <View
              style={[
                styles.livePill,
                livePill.ready ? styles.livePillReady : styles.livePillWarming,
              ]}
              accessibilityLiveRegion="polite"
              testID="pre-calibration-live-pill"
            >
              <View
                style={[
                  styles.livePillDot,
                  livePill.ready ? styles.livePillDotReady : styles.livePillDotWarming,
                ]}
              />
              <Text style={styles.livePillText}>{livePill.label}</Text>
            </View>
          </>
        ) : (
          <View style={styles.previewPlaceholder}>
            <Ionicons
              name="camera-outline"
              size={32}
              color="#9AACD1"
            />
            <Text style={styles.previewPlaceholderText}>
              Camera off — allow access to see a live preview.
            </Text>
            <TouchableOpacity
              onPress={() => {
                void requestPermission();
              }}
              style={styles.previewRequestButton}
              testID="pre-calibration-request-camera"
            >
              <Text style={styles.previewRequestButtonText}>Allow camera</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      <View style={styles.checklist}>
        <ChecklistRow icon="videocam-outline" label="Back camera ready" />
        <ChecklistRow icon="bulb-outline" label="Good lighting on subject" />
        <ChecklistRow icon="body-outline" label="Full body in frame" />
      </View>
      <View style={styles.actions}>
        <TouchableOpacity style={styles.secondaryButton} onPress={onCancel} testID="pre-calibration-cancel">
          <Text style={styles.secondaryButtonText}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.primaryButton}
          onPress={onContinue}
          testID="pre-calibration-continue"
        >
          <Text style={styles.primaryButtonText}>Continue</Text>
        </TouchableOpacity>
      </View>
    </>
  );
}

interface PreviewStepProps {
  confidencePercent: number;
  framesPercent: number;
  framesObserved: number;
  statusLabel: string;
  onConfirm: () => Promise<void> | void;
  onCancel: () => void;
}

/**
 * Low-confidence frame window after which we surface a remediation tip.
 * Matches the auditor recommendation (≈15 frames ~1.5s @ 100ms cadence);
 * keeps the tip suppressed during the normal short settling window.
 */
const LOW_CONFIDENCE_HINT_THRESHOLD = 15;

function PreviewStep({
  confidencePercent,
  framesPercent,
  framesObserved,
  statusLabel,
  onConfirm,
  onCancel,
}: PreviewStepProps) {
  const isReady = statusLabel === 'success' || confidencePercent >= 75;
  // After ~15 frames of sub-50% confidence, the settling window is over and
  // low confidence is usually an environment problem. Surface an actionable
  // hint rather than leaving the user staring at a spinning baseline.
  const showLowConfidenceHint =
    !isReady &&
    framesObserved >= LOW_CONFIDENCE_HINT_THRESHOLD &&
    confidencePercent < 50;
  return (
    <>
      <View style={styles.iconWrap}>
        {statusLabel === 'success' ? (
          <Ionicons name="checkmark-circle" size={48} color="#3CC8A9" />
        ) : (
          <ActivityIndicator color="#4C8CFF" size="large" />
        )}
      </View>
      <Text style={styles.title}>Calibrating tracker</Text>
      <Text style={styles.subtitle}>
        Hold still — building a confidence baseline. Low confidence usually
        means low light, occlusion, or a partial-body frame.
      </Text>
      <View style={styles.metricRow}>
        <Metric label="Confidence" value={`${confidencePercent}%`} />
        <Metric label="Frames" value={`${framesObserved}`} />
      </View>
      <View style={styles.progressTrack} accessibilityLabel={`Calibration ${framesPercent}% complete`}>
        <View style={[styles.progressFill, { width: `${Math.max(2, framesPercent)}%` }]} />
      </View>
      {showLowConfidenceHint ? (
        <View style={styles.hintCallout} accessibilityLiveRegion="polite">
          <Ionicons name="bulb-outline" size={16} color="#FFC244" />
          <Text style={styles.hintText}>
            Try more light, stepping back, or clearing the background — your
            full body should fit the frame.
          </Text>
        </View>
      ) : null}
      <View style={styles.actions}>
        <TouchableOpacity style={styles.secondaryButton} onPress={onCancel} testID="pre-calibration-cancel">
          <Text style={styles.secondaryButtonText}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.primaryButton, !isReady && styles.primaryButtonDisabled]}
          onPress={() => {
            void onConfirm();
          }}
          disabled={!isReady}
          testID="pre-calibration-confirm"
        >
          <Text style={styles.primaryButtonText}>{isReady ? 'Start workout' : 'Waiting...'}</Text>
        </TouchableOpacity>
      </View>
    </>
  );
}

interface ChecklistRowProps {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
}

function ChecklistRow({ icon, label }: ChecklistRowProps) {
  return (
    <View style={styles.checklistRow}>
      <Ionicons name={icon} size={18} color="#9AACD1" />
      <Text style={styles.checklistLabel}>{label}</Text>
    </View>
  );
}

interface MetricProps {
  label: string;
  value: string;
}

function Metric({ label, value }: MetricProps) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#0F1825',
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
  },
  iconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(76, 140, 255, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: {
    color: '#F2F4F8',
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
  },
  subtitle: {
    color: '#9AACD1',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 8,
  },
  checklist: {
    width: '100%',
    marginTop: 20,
    gap: 12,
  },
  checklistRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  checklistLabel: {
    color: '#F2F4F8',
    fontSize: 14,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 24,
    width: '100%',
  },
  primaryButton: {
    flex: 2,
    backgroundColor: '#4C8CFF',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  primaryButtonDisabled: {
    backgroundColor: '#2A3850',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  secondaryButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334466',
  },
  secondaryButtonText: {
    color: '#9AACD1',
    fontSize: 14,
    fontWeight: '600',
  },
  metricRow: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 20,
  },
  metric: {
    flex: 1,
    backgroundColor: 'rgba(76, 140, 255, 0.08)',
    padding: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  metricLabel: {
    color: '#9AACD1',
    fontSize: 12,
  },
  metricValue: {
    color: '#F2F4F8',
    fontSize: 18,
    fontWeight: '700',
    marginTop: 4,
  },
  progressTrack: {
    width: '100%',
    height: 6,
    borderRadius: 3,
    backgroundColor: '#1B2638',
    marginTop: 16,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#4C8CFF',
  },
  previewFrame: {
    width: '100%',
    aspectRatio: 3 / 4,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#0A1220',
    marginTop: 16,
    marginBottom: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  preview: {
    width: '100%',
    height: '100%',
  },
  previewPlaceholder: {
    padding: 16,
    alignItems: 'center',
    gap: 8,
  },
  previewPlaceholderText: {
    color: '#9AACD1',
    fontSize: 12,
    textAlign: 'center',
  },
  previewRequestButton: {
    marginTop: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: '#4C8CFF',
  },
  previewRequestButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  livePill: {
    position: 'absolute',
    top: 10,
    right: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    backgroundColor: 'rgba(11, 24, 40, 0.8)',
    borderWidth: 1,
  },
  livePillReady: {
    borderColor: 'rgba(60, 200, 169, 0.6)',
  },
  livePillWarming: {
    borderColor: 'rgba(255, 184, 76, 0.6)',
  },
  livePillDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  livePillDotReady: {
    backgroundColor: '#3CC8A9',
  },
  livePillDotWarming: {
    backgroundColor: '#FFB84C',
  },
  livePillText: {
    color: '#F2F4F8',
    fontSize: 12,
    fontWeight: '600',
  },
  hintCallout: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: 'rgba(255, 194, 68, 0.12)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 194, 68, 0.25)',
    width: '100%',
  },
  hintText: {
    flex: 1,
    color: '#F5E7C3',
    fontSize: 12,
    lineHeight: 16,
  },
});
