/**
 * coach-dispatch
 *
 * Routes `sendCoachPrompt` through cloud or on-device (Gemma) based on a
 * user-configurable preference, with graceful fallback.
 *
 * Preferences:
 * - `cloud_only`:   Always use cloud. Errors propagate normally.
 * - `prefer_local`: Try on-device first; fall back to cloud on any failure
 *                   (model not ready OR generation error). Records a
 *                   single-time fallback telemetry counter for observability.
 * - `local_only`:   On-device only. If the model is not ready, throw a
 *                   typed `CoachDispatchError` with code `local_unavailable`.
 *
 * The on-device runtime is provided by the injected `modelManager` arg.
 * In tests we pass a minimal `{ getStatus }` stub; in production callers
 * pass the real `coach-model-manager` module. A `localGenerate` callable
 * is accepted in `opts` — if omitted, `prefer_local` cannot truly run on
 * device and will fall through to cloud (but still use the preference to
 * decide).
 */

import type { CoachMessage, CoachContext } from './coach-service';
import { sendCoachPrompt } from './coach-service';
import { recordCounter } from './coach-telemetry';
import { isInCohort } from './coach-rollout';
import { isCoachPipelineV2Enabled } from './coach-pipeline-v2-flag';

export type CoachRoutingPreference = 'cloud_only' | 'prefer_local' | 'local_only';

export interface CoachModelStatusSnapshot {
  status: 'none' | 'downloading' | 'ready' | 'error';
  progress?: number;
  errorMessage?: string;
  modelId?: string;
}

export interface CoachModelManagerLike {
  getStatus(): CoachModelStatusSnapshot;
}

export interface CoachDispatchArgs {
  messages: CoachMessage[];
  context?: CoachContext;
}

export interface CoachDispatchOptions {
  preference: CoachRoutingPreference;
  modelManager: CoachModelManagerLike;
  /**
   * Optional on-device generation callable. If the preference selects
   * on-device generation but this is not provided, the dispatcher treats the
   * local runtime as unavailable (same as model-not-ready).
   */
  localGenerate?: (args: CoachDispatchArgs) => Promise<CoachMessage>;
  /**
   * Optional cloud sender override (for testing). Defaults to
   * `sendCoachPrompt` from coach-service.
   */
  cloudSend?: (messages: CoachMessage[], context?: CoachContext) => Promise<CoachMessage>;
}

export type CoachDispatchErrorCode = 'local_unavailable' | 'local_generation_failed';

export class CoachDispatchError extends Error {
  readonly code: CoachDispatchErrorCode;
  readonly cause?: unknown;

  constructor(code: CoachDispatchErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'CoachDispatchError';
    this.code = code;
    this.cause = cause;
  }
}

async function runLocal(
  args: CoachDispatchArgs,
  opts: CoachDispatchOptions,
): Promise<CoachMessage> {
  const status = opts.modelManager.getStatus();
  if (status.status !== 'ready') {
    throw new CoachDispatchError(
      'local_unavailable',
      `On-device coach model is not ready (status=${status.status}).`,
    );
  }
  if (!opts.localGenerate) {
    throw new CoachDispatchError(
      'local_unavailable',
      'On-device coach runtime is not wired up.',
    );
  }
  try {
    return await opts.localGenerate(args);
  } catch (err) {
    throw new CoachDispatchError(
      'local_generation_failed',
      err instanceof Error ? err.message : 'Local generation failed',
      err,
    );
  }
}

export async function dispatchCoachPrompt(
  args: CoachDispatchArgs,
  opts: CoachDispatchOptions,
): Promise<CoachMessage> {
  const cloudSend = opts.cloudSend ?? sendCoachPrompt;

  // Pipeline v2: cohort-gate on-device selection. Even when the user picks
  // `prefer_local` / `local_only`, we only honour it if the user is in the
  // rollout cohort (hashed bucket < EXPO_PUBLIC_COACH_LOCAL_COHORT_PCT).
  //
  // - `local_only` out-of-cohort: surface `local_unavailable` so UIs can
  //   explain the fallback. This preserves the contract that `local_only`
  //   never silently hits the cloud.
  // - `prefer_local` out-of-cohort: collapse to cloud immediately, with a
  //   cohort-specific counter so product can see rollout headroom.
  // - Flag off: no change to behavior (preserves default 0% cohort rollout).
  const cohortEnforced = isCoachPipelineV2Enabled();
  const userId = args.context?.profile?.id;
  const inCohort = cohortEnforced ? isInCohort(userId) : true;

  switch (opts.preference) {
    case 'cloud_only':
      return cloudSend(args.messages, args.context);

    case 'local_only':
      if (cohortEnforced && !inCohort) {
        throw new CoachDispatchError(
          'local_unavailable',
          'On-device coach is not enabled for this user (out of rollout cohort).',
        );
      }
      return runLocal(args, opts);

    case 'prefer_local': {
      if (cohortEnforced && !inCohort) {
        recordCounter('coach_dispatch_prefer_local_cohort_skip');
        return cloudSend(args.messages, args.context);
      }
      try {
        return await runLocal(args, opts);
      } catch (err) {
        // Record single fallback event so product can track how often
        // prefer_local falls through. Counter is additive and never throws.
        recordCounter('coach_dispatch_prefer_local_fallback');
        return cloudSend(args.messages, args.context);
      }
    }

    default: {
      // Exhaustiveness guard — unknown preference falls back to cloud.
      const _exhaustive: never = opts.preference;
      void _exhaustive;
      return cloudSend(args.messages, args.context);
    }
  }
}
