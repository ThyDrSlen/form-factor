import { useEffect, useRef, useState } from 'react';
import type { Joint2D } from '@/lib/arkit/ARKitBodyTracker';

const HOLD_MS = 150;
const MAX_JOINTS = 30;
// ARKit upLeg joints are hips, not knees. Keep them and the torso visible
// for curl sway feedback; only omit irrelevant lower-leg/foot drawings.
// Normalize separators/case, then match whole anatomical aliases rather than
// any name containing "leg" (which would incorrectly hide upLeg/upperLeg hips).
const CURL_LOWER_LEG_ALIAS = /^(?:left|right)?(?:leg|lowerleg|shin|calf|knee|ankle|foot(?:index)?|feet|heel|(?:big|small)?toes?)(?:end|\d+|joint)*$/;
const isCurlLowerLegJoint = (name: string): boolean => (
  CURL_LOWER_LEG_ALIAS.test(name.toLowerCase().replace(/[_\s-]/g, ''))
);
type Entry = { joint: Joint2D; seenAt: number };

/** Display-only geometry; never use retained joints for scoring or gestures. */
export function usePoseOverlay(joints: readonly Joint2D[] | undefined, enabled: boolean, source: string, frameTimestamp?: number): Joint2D[] {
  const cache = useRef(new Map<string, Entry>());
  const lastFrameTimestamp = useRef<number | null>(null);
  const previousSource = useRef(source);
  const [visible, setVisible] = useState<Joint2D[]>([]);

  useEffect(() => {
    if (!enabled || previousSource.current !== source) {
      cache.current.clear();
      lastFrameTimestamp.current = null;
    }
    previousSource.current = source;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const now = Date.now();
    // Expire before merging a new frame so recovery after a long gap snaps
    // to the live position instead of easing from a different/stale subject.
    for (const [key, entry] of cache.current) {
      if (now - entry.seenAt >= HOLD_MS) cache.current.delete(key);
    }
    // A poll can return a copy of a cached frame. Only a newer sensor frame
    // may advance smoothing or renew the display hold window.
    const freshFrame = frameTimestamp === undefined || (
      Number.isFinite(frameTimestamp) &&
      (lastFrameTimestamp.current === null || frameTimestamp > lastFrameTimestamp.current)
    );
    if (enabled && freshFrame) {
      if (frameTimestamp !== undefined) lastFrameTimestamp.current = frameTimestamp;
      for (const joint of joints ?? []) {
        if (!joint.isTracked || !Number.isFinite(joint.x) || !Number.isFinite(joint.y)) continue;
        const key = joint.name.toLowerCase();
        if (source === 'dumbbell_curl' && isCurlLowerLegJoint(key)) continue;
        const previous = cache.current.get(key)?.joint;
        const smoothed = previous ? {
          ...joint,
          x: previous.x + (joint.x - previous.x) * 0.55,
          y: previous.y + (joint.y - previous.y) * 0.55,
        } : { ...joint };
        cache.current.delete(key);
        cache.current.set(key, { joint: smoothed, seenAt: now });
      }
    }
    while (cache.current.size > MAX_JOINTS) {
      cache.current.delete(cache.current.keys().next().value!);
    }

    const publish = () => {
      const timestamp = Date.now();
      let expiresAt = Infinity;
      for (const [key, entry] of cache.current) {
        if (timestamp - entry.seenAt >= HOLD_MS) cache.current.delete(key);
        else expiresAt = Math.min(expiresAt, entry.seenAt + HOLD_MS);
      }
      setVisible(Array.from(cache.current.values(), entry => entry.joint));
      // Even if the native stream stops completely, don't leave a ghost pose.
      if (Number.isFinite(expiresAt)) timer = setTimeout(publish, expiresAt - timestamp);
    };
    publish();
    return () => { if (timer !== undefined) clearTimeout(timer); };
  }, [joints, enabled, source, frameTimestamp]);

  return enabled ? visible : [];
}
