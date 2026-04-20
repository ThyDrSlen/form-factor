/**
 * Motion presets for Moti transitions that respect Reduce Motion.
 *
 * When reduce-motion is enabled we collapse every animation to a 1ms linear
 * transition so state flips happen instantly but Moti is still driving the
 * lifecycle (important because some components key off `onDidAnimate`).
 */

export type MotionTransition = {
  type: 'timing' | 'spring';
  duration?: number;
  delay?: number;
  damping?: number;
  mass?: number;
  stiffness?: number;
};

/** Collapsed transition used when reduce-motion is enabled. */
export const REDUCED_TRANSITION: MotionTransition = {
  type: 'timing',
  duration: 1,
};

export function getPulseTransition(reduced: boolean): MotionTransition {
  if (reduced) return REDUCED_TRANSITION;
  return {
    type: 'timing',
    duration: 320,
  };
}

export function getFadeTransition(reduced: boolean): MotionTransition {
  if (reduced) return REDUCED_TRANSITION;
  return {
    type: 'timing',
    duration: 220,
  };
}

export function getSlideTransition(reduced: boolean): MotionTransition {
  if (reduced) return REDUCED_TRANSITION;
  return {
    type: 'spring',
    damping: 18,
    mass: 0.9,
    stiffness: 180,
  };
}
