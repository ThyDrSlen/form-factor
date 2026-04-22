/**
 * coach-model-dispatch
 *
 * Cost-aware model routing for coach turns. Given a task kind, session
 * signals, and user tier, returns which backing model should handle the
 * request.
 *
 * Design goals:
 * - Pure and synchronous so it is trivially testable and cheap to call on
 *   every coach turn.
 * - Independent of any transport — this module does not import the coach
 *   service, edge function client, or telemetry. Callers handle those.
 * - Feature-flag friendly: `dispatchDisabled` collapses every decision to
 *   the existing cloud default (`gpt-5.4-mini`) so the router can ship dark
 *   until the Gemma edge function (PR #502) lands.
 *
 * Decision matrix (see tests for full coverage):
 * - Tactical tasks (short, factual, deterministic): Gemma. Free tier gets
 *   the smaller `gemma-4-26b-a4b-it`; pro/premium get `gemma-4-31b-it`.
 * - Complex tasks (planning, macro reasoning, debriefs): GPT-5.4-mini for
 *   free/pro, GPT-5.4 for premium.
 * - `form_vision_check`: multimodal form-check via Gemma 4 vision input.
 *   Always routes to `gemma-4-31b-it` (Gemma 4's larger multimodal variant;
 *   the smaller `-26b-a4b-it` is text-only for the launch cut). Falls back
 *   to `gpt-5.4-mini` when `visionFallbackToCloud` is set — that's the
 *   escape hatch for when the Gemma edge function is unavailable.
 * - `general_chat` falls back to GPT-5.4-mini conservatively.
 * - High-fault override: a tactical task with `faultCount >= 3` is upgraded
 *   one rung (Gemma → GPT-5.4-mini) because the user is struggling and
 *   the extra cost is justified by coaching value. Does NOT apply to
 *   `form_vision_check` — vision needs the multimodal model regardless.
 * - `forceCloud`: upgrades any tactical decision to GPT-5.4-mini. Complex
 *   decisions are already cloud so the flag is a no-op there. Does NOT
 *   apply to `form_vision_check` because gpt-5.4-mini is text-only.
 *
 * TODO(#495): Wire this into `coach-service.sendCoachPrompt` once the
 * `coach-gemma` edge function from Stack B (PR #502) merges. Wiring will
 * live in `coach-service.ts` and gate on `isCoachModelDispatchEnabled()`.
 */

export type CoachTaskKind =
  | 'form_cue_lookup'
  | 'rest_calc'
  | 'encouragement'
  | 'fault_explainer'
  | 'voice_intent'
  | 'form_vision_check'
  | 'program_design'
  | 'nutrition_balance'
  | 'multi_turn_debrief'
  | 'session_generator'
  | 'general_chat';

export type CoachModelId =
  | 'gemma-4-26b-a4b-it'
  | 'gemma-4-31b-it'
  | 'gpt-5.4-mini'
  | 'gpt-5.4';

export type CoachUserTier = 'free' | 'pro' | 'premium';

export interface CoachSignals {
  readonly exerciseKey?: string;
  readonly currentFqi?: number;
  readonly faultCount?: number;
  readonly tokenBudgetRemaining?: number;
}

export interface DispatchDecision {
  readonly model: CoachModelId;
  readonly reason: string;
  readonly fellBackToCloud: boolean;
}

export interface DispatchOptions {
  readonly forceCloud?: boolean;
  readonly dispatchDisabled?: boolean;
  /**
   * When true and the task kind is `form_vision_check`, fall back to
   * `gpt-5.4-mini` (text-only). Only used by the vision dispatcher when
   * Gemma is unavailable — callers pass this if the Gemma edge function
   * returned 404 / 5xx on a previous try. Ignored for every other task.
   */
  readonly visionFallbackToCloud?: boolean;
}

const TACTICAL_TASKS: ReadonlySet<CoachTaskKind> = new Set<CoachTaskKind>([
  'form_cue_lookup',
  'rest_calc',
  'encouragement',
  'fault_explainer',
  // voice_intent: short classification tasks for hands-free voice control.
  // Routes to the cheapest Gemma tier — same cost bucket as form_cue_lookup.
  'voice_intent',
]);

const COMPLEX_TASKS: ReadonlySet<CoachTaskKind> = new Set<CoachTaskKind>([
  'program_design',
  'nutrition_balance',
  'multi_turn_debrief',
  'session_generator',
]);

const HIGH_FAULT_THRESHOLD = 3;

function tacticalGemmaForTier(tier: CoachUserTier): CoachModelId {
  return tier === 'free' ? 'gemma-4-26b-a4b-it' : 'gemma-4-31b-it';
}

function complexCloudForTier(tier: CoachUserTier): CoachModelId {
  return tier === 'premium' ? 'gpt-5.4' : 'gpt-5.4-mini';
}

// Routing is driven by taskKind. If you're tempted to branch on
// `CoachContext.focus`, add a new taskKind instead — focus is a cosmetic
// prompt label and does not reach the dispatcher.
export function decideCoachModel(
  taskKind: CoachTaskKind,
  signals: CoachSignals,
  userTier: CoachUserTier,
  options?: DispatchOptions,
): DispatchDecision {
  // Feature-flag bypass: route every turn to the legacy cloud model so the
  // module can ship inert until Stack B lands.
  if (options?.dispatchDisabled === true) {
    return {
      model: 'gpt-5.4-mini',
      reason: 'dispatch_disabled',
      fellBackToCloud: true,
    };
  }

  // Multimodal form-check. Always prefers Gemma 4's multimodal variant so
  // the image parts are actually consumed; only downgrades to text-only
  // GPT-5.4-mini when the caller explicitly opts in via
  // `visionFallbackToCloud` (the Gemma edge function returned 404/5xx on a
  // previous try, so the image will be stripped on the edge side).
  if (taskKind === 'form_vision_check') {
    if (options?.visionFallbackToCloud === true) {
      return {
        model: 'gpt-5.4-mini',
        reason: 'vision_fallback_cloud',
        fellBackToCloud: true,
      };
    }
    return {
      model: 'gemma-4-31b-it',
      reason: 'vision_gemma',
      fellBackToCloud: false,
    };
  }

  if (TACTICAL_TASKS.has(taskKind)) {
    // High-fault heuristic: bump tactical tasks to the cloud mini model
    // when the user is visibly struggling. Takes precedence over
    // forceCloud because the reason string is more informative.
    const faultCount = signals.faultCount ?? 0;
    if (faultCount >= HIGH_FAULT_THRESHOLD) {
      return {
        model: 'gpt-5.4-mini',
        reason: 'high_fault_upgrade',
        fellBackToCloud: true,
      };
    }

    if (options?.forceCloud === true) {
      return {
        model: 'gpt-5.4-mini',
        reason: 'force_cloud_override',
        fellBackToCloud: true,
      };
    }

    return {
      model: tacticalGemmaForTier(userTier),
      reason: 'tactical_gemma',
      fellBackToCloud: false,
    };
  }

  if (COMPLEX_TASKS.has(taskKind)) {
    return {
      model: complexCloudForTier(userTier),
      reason: 'complex_cloud',
      fellBackToCloud: true,
    };
  }

  // `general_chat` and any future unknown task fall back to the cloud
  // mini default.
  return {
    model: 'gpt-5.4-mini',
    reason: 'general_chat_default',
    fellBackToCloud: true,
  };
}
