/**
 * use-exercise-camera-guide
 *
 * React hook that fetches the placement guide for a given exercise and
 * manages the "Remind me next time" preference via AsyncStorage.
 *
 * The preference key is namespaced per exercise so dismissing the guide
 * for pushups does not silence it for squats. A top-level "suppress all"
 * preference is also exposed so the user can opt out entirely.
 *
 * Part of issue #479.
 */

import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { warnWithTs } from '@/lib/logger';
import {
  getPlacementGuide,
  hasPlacementGuide,
  type CameraPlacementGuide,
} from '@/lib/services/camera-placement-guide';

// =============================================================================
// Constants
// =============================================================================

const DISMISS_KEY_PREFIX = 'ff.cameraGuide.dismissed.';
const SUPPRESS_ALL_KEY = 'ff.cameraGuide.suppressAll';

function dismissKeyFor(exerciseKey: string): string {
  return `${DISMISS_KEY_PREFIX}${exerciseKey}`;
}

// =============================================================================
// Types
// =============================================================================

export interface UseExerciseCameraGuideValue {
  /** The placement guide, or null if no guide exists for the key. */
  guide: CameraPlacementGuide | null;
  /** Whether the guide should currently be shown. */
  visible: boolean;
  /** Hide the guide for this exercise only. */
  dismiss: () => Promise<void>;
  /** Hide the guide for this exercise AND remember "never show again". */
  dismissAndRemember: () => Promise<void>;
  /** Re-show the guide (clear the per-exercise dismiss). */
  reset: () => Promise<void>;
  /** Opt back in to guides globally. */
  clearGlobalSuppress: () => Promise<void>;
  /** True once the dismiss prefs have been loaded from storage. */
  ready: boolean;
}

// =============================================================================
// Hook
// =============================================================================

export function useExerciseCameraGuide(exerciseKey: string): UseExerciseCameraGuideValue {
  const guide = hasPlacementGuide(exerciseKey) ? getPlacementGuide(exerciseKey) : null;

  const [ready, setReady] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [suppressAll, setSuppressAll] = useState(false);

  // Load prefs on mount / when the active exercise changes.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [dismissedRaw, suppressRaw] = await Promise.all([
          AsyncStorage.getItem(dismissKeyFor(exerciseKey)),
          AsyncStorage.getItem(SUPPRESS_ALL_KEY),
        ]);
        if (cancelled) return;
        setDismissed(dismissedRaw === '1');
        setSuppressAll(suppressRaw === '1');
      } catch (error) {
        warnWithTs('[use-exercise-camera-guide] failed to load prefs', error);
      } finally {
        if (!cancelled) setReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [exerciseKey]);

  const dismiss = useCallback<UseExerciseCameraGuideValue['dismiss']>(async () => {
    setDismissed(true);
    try {
      await AsyncStorage.setItem(dismissKeyFor(exerciseKey), '1');
    } catch (error) {
      warnWithTs('[use-exercise-camera-guide] failed to save dismiss', error);
    }
  }, [exerciseKey]);

  const dismissAndRemember = useCallback<
    UseExerciseCameraGuideValue['dismissAndRemember']
  >(async () => {
    setDismissed(true);
    setSuppressAll(true);
    try {
      await AsyncStorage.multiSet([
        [dismissKeyFor(exerciseKey), '1'],
        [SUPPRESS_ALL_KEY, '1'],
      ]);
    } catch (error) {
      warnWithTs('[use-exercise-camera-guide] failed to save suppressAll', error);
    }
  }, [exerciseKey]);

  const reset = useCallback<UseExerciseCameraGuideValue['reset']>(async () => {
    setDismissed(false);
    try {
      await AsyncStorage.removeItem(dismissKeyFor(exerciseKey));
    } catch (error) {
      warnWithTs('[use-exercise-camera-guide] failed to clear dismiss', error);
    }
  }, [exerciseKey]);

  const clearGlobalSuppress = useCallback<
    UseExerciseCameraGuideValue['clearGlobalSuppress']
  >(async () => {
    setSuppressAll(false);
    try {
      await AsyncStorage.removeItem(SUPPRESS_ALL_KEY);
    } catch (error) {
      warnWithTs('[use-exercise-camera-guide] failed to clear suppressAll', error);
    }
  }, []);

  const visible = Boolean(guide) && !dismissed && !suppressAll;

  return {
    guide,
    visible,
    dismiss,
    dismissAndRemember,
    reset,
    clearGlobalSuppress,
    ready,
  };
}
