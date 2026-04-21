/**
 * progression-flags
 *
 * Feature flag gates for the progressive-overload intelligence engine.
 * The underlying services (`rep-max-calculator`, `weight-suggester`,
 * `exercise-history-service`, `progression-planner`, `pr-detector-overload`)
 * are pure and safe to call any time; these flags decide whether the
 * user-facing surfaces — the overload analytics card on the workouts tab
 * and the post-session progression-plan modal — are mounted.
 *
 * Parsing:
 * - `EXPO_PUBLIC_OVERLOAD_CARD=on`     → analytics card rendered on workouts tab
 * - `EXPO_PUBLIC_PROGRESSION_PLAN=on`  → "Plan" CTA opens progression-plan modal
 * - any other value (including unset)  → surface hidden (fail safe)
 *
 * Intentionally strict string matching: only the literal `'on'` flips a
 * flag. Mirrors `coach-model-dispatch-flag` so both knobs behave the same.
 *
 * Issue #475 — progressive overload engine. The services themselves landed
 * via #477 (squash-merged); these flags gate the consumer surfaces so the
 * engine can ship quietly until we are ready to promote it.
 */

const OVERLOAD_CARD_ENV_VAR = 'EXPO_PUBLIC_OVERLOAD_CARD';
const PROGRESSION_PLAN_ENV_VAR = 'EXPO_PUBLIC_PROGRESSION_PLAN';

function parseOnFlag(envVar: string): boolean {
  const raw = process.env[envVar];
  if (typeof raw !== 'string') return false;
  return raw === 'on';
}

/**
 * Whether the `OverloadAnalyticsCard` should mount on the workouts tab.
 * Default: off.
 */
export function isOverloadCardEnabled(): boolean {
  return parseOnFlag(OVERLOAD_CARD_ENV_VAR);
}

/**
 * Whether the progression-plan modal (and any call site that routes to it)
 * is reachable from the UI. Default: off.
 */
export function isProgressionPlanEnabled(): boolean {
  return parseOnFlag(PROGRESSION_PLAN_ENV_VAR);
}

export const PROGRESSION_FLAG_ENV_VARS = {
  overloadCard: OVERLOAD_CARD_ENV_VAR,
  progressionPlan: PROGRESSION_PLAN_ENV_VAR,
} as const;
