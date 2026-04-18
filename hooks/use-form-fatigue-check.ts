import { useMemo } from 'react';
import {
  detectFormFatigue,
  type FatigueAssessment,
  type FatigueDetectorOptions,
  type SetFqiPoint,
} from '@/lib/services/form-fatigue-detector';

/**
 * React-friendly wrapper around {@link detectFormFatigue}. Memoizes on the
 * inputs so consumers can call it inline within a render without churning
 * object identity for downstream `useEffect`s.
 *
 * Callers pass the per-set FQI averages for the current session (in set order)
 * and receive the current fatigue assessment. Pure — no fetch, no side effects.
 */
export function useFormFatigueCheck(
  sets: SetFqiPoint[],
  options?: FatigueDetectorOptions,
): FatigueAssessment {
  const { minSets, windowSize, dropThreshold } = options ?? {};
  return useMemo(
    () => detectFormFatigue(sets, { minSets, windowSize, dropThreshold }),
    [sets, minSets, windowSize, dropThreshold],
  );
}
