/**
 * useProgressionSuggestion
 *
 * Thin React hook that pulls the previous session's avg FQI + last load and
 * memoises a progression-suggester result. Callers supply the raw inputs;
 * the hook does not issue any network calls so it's safe to invoke every
 * render.
 *
 * Pairs with `components/form-tracking/ProgressionSuggestionBadge` for the
 * scan add-set UI.
 *
 * Issue #447 W3-C item #3.
 */

import { useMemo } from 'react';
import {
  suggestNextWeight,
  type Suggestion,
  type WeightUnit,
} from '@/lib/services/progression-suggester';

export interface UseProgressionSuggestionArgs {
  exerciseId: string | null | undefined;
  /** Average FQI from the last completed session of this exercise (0-100). */
  lastSessionAvgFqi: number | null | undefined;
  /** Load used in the last session, in `unit`. */
  lastWeight: number | null | undefined;
  unit?: WeightUnit;
}

/**
 * @returns The `Suggestion` produced by `suggestNextWeight`, or `null` when
 * there are not enough inputs to produce a meaningful suggestion.
 */
export function useProgressionSuggestion({
  exerciseId,
  lastSessionAvgFqi,
  lastWeight,
  unit = 'lb',
}: UseProgressionSuggestionArgs): Suggestion | null {
  return useMemo(() => {
    if (!exerciseId) return null;
    if (typeof lastSessionAvgFqi !== 'number') return null;
    if (typeof lastWeight !== 'number') return null;
    return suggestNextWeight(exerciseId, lastSessionAvgFqi, lastWeight, unit);
  }, [exerciseId, lastSessionAvgFqi, lastWeight, unit]);
}
