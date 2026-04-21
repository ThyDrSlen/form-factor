/**
 * coach-pipeline-v2-flag
 *
 * Master feature flag gate for the wave-24 coach pipeline wiring. Controls
 * whether the coach request flow runs through the newer pipeline composition
 * (output shaper, injection hardener, cloud safety filter, cohort-gated
 * on-device selection, model dispatch by task kind, cached session memory,
 * cue preferences, drill/progression provider dispatch, AutoDebriefCard UI).
 *
 * Parsing (mirrors `coach-model-dispatch-flag.ts`):
 * - `EXPO_PUBLIC_COACH_PIPELINE_V2=on`  → pipeline v2 enabled
 * - `EXPO_PUBLIC_COACH_PIPELINE_V2=off` → pipeline v2 disabled
 * - unset / anything else               → pipeline v2 disabled (fail safe)
 *
 * Intentionally strict string matching. The single revert knob is this env
 * var; any wiring in the codebase should gate on `isCoachPipelineV2Enabled()`
 * so reverts are a one-line config change.
 */

const FLAG_ENV_VAR = 'EXPO_PUBLIC_COACH_PIPELINE_V2';

export function isCoachPipelineV2Enabled(): boolean {
  const raw = process.env[FLAG_ENV_VAR];
  if (typeof raw !== 'string') return false;
  return raw === 'on';
}
