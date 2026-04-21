/**
 * SnapForFeedbackButton
 *
 * Headless button that grabs a single JPEG frame off an existing
 * `CameraView` (passed in via `cameraRef`) and hands the resulting URI to
 * the caller via `onSnap`. Intentionally does NOT:
 *   - instantiate its own camera (reuses the ARKit scan view's camera)
 *   - call coach-service directly (the caller invokes `coach-vision`)
 *   - mount itself into `app/(tabs)/scan-arkit.tsx` (a follow-up PR does
 *     that so this change can land without conflicting with another
 *     in-flight PR touching the scan screen)
 *
 * The parent is expected to wire `onSnap` to:
 *   1. `encodeJpegToBase64(uri)`
 *   2. `composeVisionPrompt({ exercise, phase, base64Image })`
 *   3. `dispatchVisionRequest(message)` (see lib/services/coach-vision.ts)
 *
 * Accessibility: button role + label + hint per the repo pattern
 * (see RepPainFlagButton.tsx).
 */

import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { CameraView } from 'expo-camera';
import { warnWithTs } from '@/lib/logger';

export interface SnapForFeedbackButtonProps {
  /**
   * Ref to the already-mounted `CameraView` on the scan screen. Must be
   * non-null before the user can press; we render the button disabled
   * until the parent assigns the ref.
   */
  readonly cameraRef: React.RefObject<CameraView | null>;
  /**
   * Callback invoked with the local JPEG URI after a successful snap.
   * The caller is responsible for encoding + dispatching; this component
   * only owns the capture.
   */
  readonly onSnap: (uri: string) => void;
  /**
   * Canonical exercise key ('squat', 'deadlift', etc). Passed through
   * in the `onSnap` context so the caller can compose the prompt with
   * exercise metadata in scope.
   */
  readonly exercise: string;
  /** Current session phase ('setup', 'bottom', 'top', etc). */
  readonly phase: string;
  /**
   * JPEG compression quality, 0..1. Defaults to 0.6 — enough for Gemma
   * to read joint angles without blowing base64 size.
   */
  readonly quality?: number;
  /**
   * Optional error handler. When omitted, errors are logged via
   * warnWithTs and silently swallowed so the button stays usable.
   */
  readonly onError?: (error: unknown) => void;
  readonly testID?: string;
  readonly disabled?: boolean;
}

const DEFAULT_QUALITY = 0.6;

export function SnapForFeedbackButton({
  cameraRef,
  onSnap,
  exercise,
  phase,
  quality = DEFAULT_QUALITY,
  onError,
  testID = 'snap-for-feedback-button',
  disabled = false,
}: SnapForFeedbackButtonProps) {
  const [inFlight, setInFlight] = useState(false);

  const handlePress = useCallback(async () => {
    if (inFlight || disabled) return;
    const camera = cameraRef.current;
    if (!camera) {
      warnWithTs('[SnapForFeedbackButton] cameraRef not mounted yet');
      return;
    }
    setInFlight(true);
    try {
      const picture = await camera.takePictureAsync({
        quality,
        base64: false,
        skipProcessing: false,
      });
      if (picture?.uri) {
        onSnap(picture.uri);
      } else {
        warnWithTs('[SnapForFeedbackButton] takePictureAsync returned no uri');
      }
    } catch (err) {
      if (onError) {
        onError(err);
      } else {
        warnWithTs('[SnapForFeedbackButton] snapshot failed', err);
      }
    } finally {
      setInFlight(false);
    }
  }, [cameraRef, onSnap, quality, inFlight, disabled, onError]);

  const cameraReady = cameraRef.current != null;
  const isDisabled = disabled || inFlight || !cameraReady;
  const hint = `Sends a single frame to the AI coach to critique your ${exercise || 'lift'} in the ${phase || 'current'} phase.`;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Snap for coach feedback"
      accessibilityHint={hint}
      accessibilityState={{ disabled: isDisabled, busy: inFlight }}
      disabled={isDisabled}
      onPress={handlePress}
      testID={testID}
      style={({ pressed }) => [
        styles.button,
        pressed && styles.buttonPressed,
        isDisabled && styles.buttonDisabled,
      ]}
    >
      <Ionicons
        name={inFlight ? 'hourglass-outline' : 'camera'}
        size={18}
        color="#FFFFFF"
      />
      <Text style={styles.buttonText}>
        {inFlight ? 'Sending…' : 'Snap for feedback'}
      </Text>
    </Pressable>
  );
}

export default SnapForFeedbackButton;

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#4C8CFF',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 14,
    alignSelf: 'center',
  },
  buttonPressed: {
    backgroundColor: '#3B76E0',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontFamily: 'Lexend_700Bold',
  },
});
