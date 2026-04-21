/**
 * useMaybeShapedStreamCoach
 *
 * Thin selector that returns either the raw streaming coach hook
 * (`useStreamCoach`) or the sentence-boundary-buffered shaped variant
 * (`useShapedStreamCoach`) based on the `EXPO_PUBLIC_COACH_PIPELINE_V2`
 * master flag.
 *
 * Why: wave-24 pipeline wiring routes streaming consumers through the
 * shaped wrapper so they see complete sentences instead of mid-word
 * fragments (issue #465 Item 5). Callers import this selector and remain
 * unaware of which underlying hook they're using. Revert is a single
 * env-var flip back to `off`.
 *
 * The returned shape is the intersection of the two hooks' return types
 * (`buffered | isStreaming | complete | error | stats | start | abort |
 * reset`). The shaped hook adds a `pending` field; callers that want it
 * should call `useShapedStreamCoach` directly.
 */

import { useStreamCoach, type UseStreamCoachReturn } from './use-stream-coach';
import { useShapedStreamCoach } from './use-shaped-stream-coach';
import { isCoachPipelineV2Enabled } from '@/lib/services/coach-pipeline-v2-flag';

export type UseMaybeShapedStreamCoachReturn = UseStreamCoachReturn;

export function useMaybeShapedStreamCoach(): UseMaybeShapedStreamCoachReturn {
  // Read the flag synchronously at render time — React guarantees both
  // hooks execute unconditionally below to satisfy the rules of hooks.
  const raw = useStreamCoach();
  const shaped = useShapedStreamCoach();

  if (isCoachPipelineV2Enabled()) {
    // The shaped hook's return type is a superset (it adds `pending`), but
    // structurally matches the base `UseStreamCoachReturn`. Project back
    // to the base shape for callers that want a common surface.
    const { buffered, isStreaming, complete, error, stats, start, abort, reset } =
      shaped;
    return { buffered, isStreaming, complete, error, stats, start, abort, reset };
  }

  return raw;
}
