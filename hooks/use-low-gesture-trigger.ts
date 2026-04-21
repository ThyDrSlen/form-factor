/**
 * useLowGestureTrigger
 *
 * Alternate hand-gesture recording trigger for exercises where the user's
 * arms spend most of the set extended overhead or straight out — making the
 * existing "both hands above shoulders" gesture ambiguous or impossible
 * (e.g. overhead press, jumping jacks, Y/T/W). This hook watches the live
 * 2D joint stream for both hands held *below the hips* for a hold window,
 * then fires a single trigger callback. Re-entrant fires are rate-limited.
 *
 * Designed to slot in next to the existing arms-above-shoulders detector in
 * scan-arkit.tsx rather than replace it. Accessibility benefit (issue #428
 * Gap 5): users holding a barbell overhead can still start/stop recording
 * one-handed by briefly lowering their hands past the hip line.
 */
import { useCallback, useRef } from 'react';

/**
 * Minimal 2D joint shape — mirrors the ARKit skeleton payload used in
 * scan-arkit.tsx and `lib/tracking-quality/human-validation.ts`. Kept as a
 * local interface so this hook has zero downstream dependencies.
 */
export interface LowGestureJoint {
  /** Lowercase-or-mixed-case joint name; we match by substring. */
  name: string;
  /** Normalised (0..1) image-space Y — 0 = top of frame, 1 = bottom. */
  y: number;
  /** Whether ARKit trusts this joint for the current frame. */
  isTracked: boolean;
}

export interface UseLowGestureTriggerOptions {
  /** Master on/off switch (e.g. user setting, or disable while recording). */
  enabled: boolean;
  /** Joint stream refreshed per frame by the caller. */
  joints: readonly LowGestureJoint[] | null | undefined;
  /** Fired once per confirmed gesture. */
  onTrigger: () => void;
  /**
   * How long (ms) both hands must stay below the hip line before we fire.
   * Default 500 ms — mirrors the existing arms-above-shoulders detector.
   */
  holdMs?: number;
  /**
   * Minimum normalised Y delta between each hand and the corresponding hip
   * before we consider the hand "below" the hip. Default 0.04 (≈4 % of
   * frame height) to filter out idle arm swing noise.
   */
  marginY?: number;
  /**
   * Minimum gap (ms) between consecutive trigger fires. Default 2000 ms —
   * prevents the gesture from re-firing while the user is still lowering /
   * raising their hands after a completed gesture.
   */
  cooldownMs?: number;
  /** Optional clock override for deterministic tests. */
  now?: () => number;
}

const DEFAULT_HOLD_MS = 500;
const DEFAULT_MARGIN_Y = 0.04;
const DEFAULT_COOLDOWN_MS = 2000;

type JointFinder = (needle: string) => LowGestureJoint | undefined;

function makeFinder(joints: readonly LowGestureJoint[]): JointFinder {
  return (needle) =>
    joints.find((joint) => joint.isTracked && joint.name.toLowerCase().includes(needle));
}

/**
 * Determine whether both hands are currently held below the hip line.
 * Exported for unit-test coverage; not part of the public hook surface.
 */
export function handsBelowHips(
  joints: readonly LowGestureJoint[] | null | undefined,
  marginY: number = DEFAULT_MARGIN_Y,
): boolean {
  if (!joints || joints.length === 0) return false;
  const find = makeFinder(joints);
  const leftHand = find('left_hand');
  const rightHand = find('right_hand');
  const leftHip = find('left_hip');
  const rightHip = find('right_hip');
  if (!leftHand || !rightHand || !leftHip || !rightHip) return false;
  // Y grows downward, so "below" means the hand's y is greater than hip + margin.
  return leftHand.y > leftHip.y + marginY && rightHand.y > rightHip.y + marginY;
}

/**
 * Result object exposing a deterministic pure-function check plus a reset
 * in case the caller wants to cancel a pending hold (e.g. after the user
 * taps the manual record button).
 */
export interface UseLowGestureTriggerResult {
  /** Reset any in-progress hold so the next frame starts the window fresh. */
  reset: () => void;
}

export function useLowGestureTrigger(
  options: UseLowGestureTriggerOptions,
): UseLowGestureTriggerResult {
  const {
    enabled,
    joints,
    onTrigger,
    holdMs = DEFAULT_HOLD_MS,
    marginY = DEFAULT_MARGIN_Y,
    cooldownMs = DEFAULT_COOLDOWN_MS,
    now,
  } = options;

  const holdStartRef = useRef<number | null>(null);
  const lastTriggerRef = useRef<number>(0);
  const onTriggerRef = useRef(onTrigger);
  const nowRef = useRef(now);

  onTriggerRef.current = onTrigger;
  nowRef.current = now;

  // Run detection inline on every render so callers can drive re-evaluation
  // by re-rendering with a fresh frame reference — the caller already re-
  // renders per ARKit pose tick and we can ride that cadence without needing
  // to thread a separate ref-count prop through the hook.
  if (!enabled) {
    holdStartRef.current = null;
  } else if (!handsBelowHips(joints, marginY)) {
    holdStartRef.current = null;
  } else {
    const clock = nowRef.current ?? Date.now;
    const t = clock();
    if (holdStartRef.current === null) {
      holdStartRef.current = t;
    } else {
      const heldFor = t - holdStartRef.current;
      const sinceLast = t - lastTriggerRef.current;
      if (heldFor >= holdMs && sinceLast > cooldownMs) {
        lastTriggerRef.current = t;
        holdStartRef.current = null;
        try {
          onTriggerRef.current();
        } catch {
          /* swallow listener failures — trigger is best-effort */
        }
      }
    }
  }

  const reset = useCallback(() => {
    holdStartRef.current = null;
  }, []);

  return { reset };
}

export default useLowGestureTrigger;
