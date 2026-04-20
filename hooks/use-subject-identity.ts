/**
 * useSubjectIdentity — React wrapper around SubjectIdentityTracker.
 *
 * Feeds 2D joints from the tracking loop into the tracker and exposes a
 * stable snapshot plus imperative helpers for reset/recalibrate. The
 * underlying class is stateful and frame-driven, so we hold it in a ref
 * and only surface the snapshot via state when `switchDetected` or
 * `isCalibrated` transitions change — that keeps the hook from re-rendering
 * the host screen every frame.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { Joint2D } from '@/lib/arkit/ARKitBodyTracker';
import {
  SubjectIdentityTracker,
  type SubjectIdentityOptions,
  type SubjectIdentitySnapshot,
} from '@/lib/tracking-quality/subject-identity';

export type UseSubjectIdentityOptions = SubjectIdentityOptions & {
  /** Set false to skip evaluation entirely (e.g. during fixture playback). */
  enabled?: boolean;
};

export type UseSubjectIdentityResult = {
  snapshot: SubjectIdentitySnapshot;
  /** Feed a frame of joints. Returns the latest snapshot. */
  step: (joints: Joint2D[]) => SubjectIdentitySnapshot;
  /** Accept the current subject as the new baseline. */
  recalibrate: () => void;
  /** Reset tracker to pre-calibration state. */
  reset: () => void;
};

function initialSnapshot(): SubjectIdentitySnapshot {
  return {
    isCalibrated: false,
    isOriginalSubject: true,
    switchDetected: false,
    centroidJump: 0,
    signatureDeviation: 0,
    framesSinceSwitchDetected: 0,
    recalibrated: false,
    signature: null,
  };
}

function jointsToMap(
  joints: Joint2D[],
): Record<string, { x: number; y: number; isTracked: boolean; confidence?: number }> {
  const map: Record<string, { x: number; y: number; isTracked: boolean; confidence?: number }> = {};
  for (const j of joints) {
    if (!j?.name) continue;
    map[j.name] = { x: j.x, y: j.y, isTracked: j.isTracked };
  }
  return map;
}

export function useSubjectIdentity(
  options?: UseSubjectIdentityOptions,
): UseSubjectIdentityResult {
  const enabled = options?.enabled ?? true;
  const trackerRef = useRef<SubjectIdentityTracker | null>(null);
  if (trackerRef.current === null) {
    trackerRef.current = new SubjectIdentityTracker(options);
  }

  const [snapshot, setSnapshot] = useState<SubjectIdentitySnapshot>(initialSnapshot);
  const lastPublishedRef = useRef<SubjectIdentitySnapshot>(snapshot);

  const step = useCallback(
    (joints: Joint2D[]): SubjectIdentitySnapshot => {
      const tracker = trackerRef.current!;
      if (!enabled) {
        return tracker.getSnapshot();
      }
      const next = tracker.step(jointsToMap(joints));
      const prev = lastPublishedRef.current;
      const needsPublish =
        prev.isCalibrated !== next.isCalibrated ||
        prev.switchDetected !== next.switchDetected ||
        prev.recalibrated !== next.recalibrated ||
        prev.isOriginalSubject !== next.isOriginalSubject;
      if (needsPublish) {
        lastPublishedRef.current = next;
        setSnapshot(next);
      }
      return next;
    },
    [enabled],
  );

  const recalibrate = useCallback(() => {
    trackerRef.current?.recalibrate();
    const next = trackerRef.current?.getSnapshot() ?? initialSnapshot();
    lastPublishedRef.current = next;
    setSnapshot(next);
  }, []);

  const reset = useCallback(() => {
    trackerRef.current?.reset();
    const next = initialSnapshot();
    lastPublishedRef.current = next;
    setSnapshot(next);
  }, []);

  // If consumer disables mid-session, clear switchDetected flag so banners
  // don't linger. Re-enable will pick up fresh state on next step().
  useEffect(() => {
    if (!enabled) {
      reset();
    }
  }, [enabled, reset]);

  return useMemo(
    () => ({ snapshot, step, recalibrate, reset }),
    [snapshot, step, recalibrate, reset],
  );
}
