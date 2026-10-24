import { useEffect } from 'react';
import { jointsForWorkout } from '@/lib/pose/workout-joint-scope';
import { POSE2D_CACHE_MAX_ENTRIES } from '@/features/form-tracking/hooks/scan/scan-constants';
import type { ScanPoseFramesCtx } from '@/features/form-tracking/hooks/scan/use-scan-pose-frames';

export function useScanPose2DSmoothing(ctx: ScanPoseFramesCtx) {
  const {
    detectionMode, occlusionManagerRef, pose2D, pose2DCacheKeysRef, pose2DCacheRef,
    setSmoothedPose2DJoints, smoothedPose2DRef, subjectIdentity,
  } = ctx;

  useEffect(() => {
    if (!pose2D || pose2D.joints.length === 0) {
      pose2DCacheRef.current.clear();
      pose2DCacheKeysRef.current = null;
      smoothedPose2DRef.current = null;
      setSmoothedPose2DJoints(null);
      return;
    }

    const alpha = 0.55;
    const cache = pose2DCacheRef.current;
    const joints = jointsForWorkout(pose2D.joints, detectionMode);
    const seenKeys = new Set<string>();
    const nextJoints = joints.map((joint) => {
      if (!joint.isTracked) {
        return { ...joint };
      }
      const key = joint.name.toLowerCase();
      seenKeys.add(key);
      let prev = cache.get(key);
      // Drop any cached entry that was ever poisoned with a non-finite
      // component (NaN / +-Infinity). Without this guard a single bad
      // incoming frame would contaminate every subsequent eased value
      // because `prev.x + (target - prev.x) * alpha` === NaN, and the
      // result gets written back into the cache forever.
      if (prev && (!Number.isFinite(prev.x) || !Number.isFinite(prev.y))) {
        cache.delete(key);
        prev = undefined;
      }
      const targetX = joint.x;
      const targetY = joint.y;
      const safeTargetX = Number.isFinite(targetX) ? targetX : prev?.x ?? 0;
      const safeTargetY = Number.isFinite(targetY) ? targetY : prev?.y ?? 0;
      const easedX = prev ? prev.x + (safeTargetX - prev.x) * alpha : safeTargetX;
      const easedY = prev ? prev.y + (safeTargetY - prev.y) * alpha : safeTargetY;
      // Reinsert to move this key to the tail (most-recently-used) slot; Map
      // preserves insertion order so the head is always the oldest entry.
      if (prev) cache.delete(key);
      cache.set(key, { x: easedX, y: easedY });
      return { ...joint, x: easedX, y: easedY };
    });

    // Drop any untracked/stale aliases still lingering from a previous frame.
    for (const key of Array.from(cache.keys())) {
      if (!seenKeys.has(key)) {
        cache.delete(key);
      }
    }

    // Hard cap: evict oldest insertions beyond the bound. 30 covers every
    // joint we render on the skeleton overlay with room for alias spillover.
    while (cache.size > POSE2D_CACHE_MAX_ENTRIES) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey === undefined) break;
      cache.delete(oldestKey);
    }
    pose2DCacheKeysRef.current = cache.size;

    // The smoothed joints always live in a ref — the skeleton SVG below
    // reads from the ref during render, and `pose` state changes each frame
    // already force the containing component to re-render. We intentionally
    // avoid bumping React state on every pose tick; only flip
    // smoothedPose2DJoints state when the partial-tracking badge visibility
    // (i.e. whether we have *any* renderable tracked joints) changes, so
    // downstream gestureRecordingEnabled-style effects still fire on the
    // visible/hidden transition without re-running each frame.
    smoothedPose2DRef.current = nextJoints;
    const hasAnyTracked = nextJoints.some((joint) => joint.isTracked);
    setSmoothedPose2DJoints((prev) => {
      const prevHasAny = prev !== null && prev.length > 0 && prev.some((j) => j.isTracked);
      if (prevHasAny === hasAnyTracked) {
        return prev;
      }
      return hasAnyTracked ? nextJoints : null;
    });

    // Resilience (#445): feed joints into the subject-identity tracker and
    // occlusion manager. The tracker is a no-op while tracking is stopped.
    if (hasAnyTracked) {
      subjectIdentity.step(nextJoints);
      const occMap: Record<string, { x: number; y: number; isTracked: boolean; confidence?: number } | null> = {};
      for (const j of nextJoints) {
        if (!j?.name) continue;
        occMap[j.name] = j.isTracked
          ? { x: j.x, y: j.y, isTracked: true, confidence: 0.9 }
          : null;
      }
      occlusionManagerRef.current?.update(occMap);
    }

    return undefined;
    // Intentionally keep dep list tight: adding subjectIdentity here would churn this frame-driven effect every snapshot change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pose2D, detectionMode]);

  return {

  };
}

export type ScanPose2DSmoothingCtx = ScanPoseFramesCtx & ReturnType<typeof useScanPose2DSmoothing>;
