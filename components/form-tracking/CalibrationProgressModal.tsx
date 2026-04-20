/**
 * CalibrationProgressModal
 *
 * Shown at session start while the pose fusion pipeline is in its
 * "collecting" calibration phase. Surfaces:
 *   - a progress bar (0-1)
 *   - a short step/status line
 *   - a "Recalibrate" control (so the user can restart if positioning
 *     changed mid-calibration)
 *
 * Pure UI — the caller drives visibility and progress. The component
 * never reads from the calibration module directly so it stays safe to
 * render across platforms (iOS ARKit, web fallback, tests).
 */

import React from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  type ViewStyle,
  type StyleProp,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { MotiView } from 'moti';

export interface CalibrationProgressModalProps {
  /** Whether the modal is visible. */
  visible: boolean;
  /** Progress 0..1. Values outside are clamped. */
  progress: number;
  /** Optional status line ("Hold still…", "Stand fully in frame"). */
  statusLabel?: string;
  /** Optional handler for the recalibrate action. */
  onRecalibrate?: () => void;
  /** Optional cancel handler — renders a second secondary button when set. */
  onCancel?: () => void;
  /** Optional style override for the modal body. */
  style?: StyleProp<ViewStyle>;
  /** Optional testID. */
  testID?: string;
}

function clampProgress(raw: number): number {
  if (!Number.isFinite(raw)) return 0;
  return Math.max(0, Math.min(1, raw));
}

export default function CalibrationProgressModal({
  visible,
  progress,
  statusLabel = 'Hold still while we calibrate your movement…',
  onRecalibrate,
  onCancel,
  style,
  testID,
}: CalibrationProgressModalProps) {
  const clamped = clampProgress(progress);
  const percent = Math.round(clamped * 100);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
      testID={testID ?? 'calibration-progress-modal'}
    >
      <View style={styles.backdrop}>
        <View
          style={[styles.body, style]}
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel={`Calibrating. ${percent} percent complete. ${statusLabel}`}
          accessibilityValue={{ min: 0, max: 100, now: percent }}
          testID="calibration-progress-body"
        >
          <View style={styles.iconBubble}>
            <Ionicons name="scan-outline" size={24} color="#4C8CFF" />
          </View>

          <Text style={styles.title}>Calibrating</Text>
          <Text style={styles.subtitle}>{statusLabel}</Text>

          <View style={styles.track}>
            <MotiView
              from={{ width: '0%' as unknown as number }}
              animate={{ width: `${percent}%` as unknown as number }}
              transition={{ type: 'timing', duration: 260 }}
              style={styles.fill}
            />
          </View>
          <Text style={styles.percent}>{percent}%</Text>

          <View style={styles.actions}>
            {onCancel ? (
              <TouchableOpacity
                onPress={onCancel}
                style={[styles.button, styles.secondaryButton]}
                accessibilityRole="button"
                accessibilityLabel="Cancel calibration"
                testID="calibration-cancel"
              >
                <Text style={styles.secondaryButtonText}>Cancel</Text>
              </TouchableOpacity>
            ) : null}
            {onRecalibrate ? (
              <TouchableOpacity
                onPress={onRecalibrate}
                style={[styles.button, styles.primaryButton]}
                accessibilityRole="button"
                accessibilityLabel="Restart calibration"
                testID="calibration-recalibrate"
              >
                <Ionicons name="refresh" size={14} color="#FFFFFF" />
                <Text style={styles.primaryButtonText}>Recalibrate</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.68)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  body: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#0B1A33',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(76, 140, 255, 0.4)',
    padding: 20,
    gap: 10,
    alignItems: 'center',
  },
  iconBubble: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(76, 140, 255, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  title: {
    color: '#F5F7FF',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  subtitle: {
    color: '#BCCFE8',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
  track: {
    width: '100%',
    height: 10,
    borderRadius: 6,
    backgroundColor: 'rgba(76, 140, 255, 0.15)',
    overflow: 'hidden',
    marginTop: 8,
  },
  fill: {
    height: '100%',
    backgroundColor: '#4C8CFF',
    borderRadius: 6,
  },
  percent: {
    color: '#9AACD1',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
    marginTop: 10,
  },
  button: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 12,
  },
  primaryButton: {
    backgroundColor: '#4C8CFF',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  secondaryButton: {
    backgroundColor: 'rgba(245, 247, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(245, 247, 255, 0.18)',
  },
  secondaryButtonText: {
    color: '#F5F7FF',
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
});
