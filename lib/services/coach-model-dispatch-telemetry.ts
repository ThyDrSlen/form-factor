/**
 * coach-model-dispatch-telemetry
 *
 * Stub event recorder for cost-aware model dispatch decisions. Emits a
 * `coach_dispatch_decision` event with the chosen model, reason, and
 * whether we fell back to the cloud.
 *
 * TODO(#495): When the coach-service rewire lands (post Stack B / PR #502)
 * this stub should be replaced with a wired call into the real telemetry
 * pipeline — either the existing `coach-telemetry` module (once it grows
 * a typed event recorder) or whatever analytics client Stack B introduces.
 * Until then the stub console.logs behind a `__DEV__` guard so engineers
 * can trace decisions locally without polluting production logs.
 *
 * The `coach-telemetry` module today exposes only `recordCounter` /
 * `getCounter` + cue-adoption helpers — there is no generic typed event
 * recorder, so this module intentionally does not import it.
 */

import { recordCounter } from './coach-telemetry';
import type { CoachModelId, CoachTaskKind, DispatchDecision } from './coach-model-dispatch';

const DISPATCH_EVENT_NAME = 'coach_dispatch_decision';
const DISPATCH_MISMATCH_EVENT_NAME = 'coach_dispatch_mismatch';

export function recordDispatchDecision(decision: DispatchDecision): void {
  // Additive, never-throws counter — safe to call from a hot path.
  recordCounter(DISPATCH_EVENT_NAME);
  recordCounter(`${DISPATCH_EVENT_NAME}:${decision.model}`);
  recordCounter(`${DISPATCH_EVENT_NAME}:reason:${decision.reason}`);

  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.log('[coach-dispatch]', DISPATCH_EVENT_NAME, {
      model: decision.model,
      reason: decision.reason,
      fellBackToCloud: decision.fellBackToCloud,
    });
  }
}

/**
 * Record a `coach_dispatch_mismatch` counter when the tier-expected baseline
 * model diverges from the model actually dispatched because of a feature
 * flag, forceCloud override, visionFallback, or dispatchDisabled bypass.
 *
 * Emits three counters so product can aggregate any of:
 *   - overall mismatch count       → `coach_dispatch_mismatch`
 *   - per-model-pair count         → `coach_dispatch_mismatch:<expected>:<actual>`
 *   - per-reason count             → `coach_dispatch_mismatch:reason:<reason>`
 *
 * No-op when expected === actual; callers can unconditionally invoke it
 * without gating on equality themselves.
 */
export function recordDispatchMismatch(
  expected: CoachModelId,
  actual: CoachModelId,
  reason: string,
): void {
  if (expected === actual) return;
  recordCounter(DISPATCH_MISMATCH_EVENT_NAME);
  recordCounter(`${DISPATCH_MISMATCH_EVENT_NAME}:${expected}:${actual}`);
  recordCounter(`${DISPATCH_MISMATCH_EVENT_NAME}:reason:${reason}`);

  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.log('[coach-dispatch]', DISPATCH_MISMATCH_EVENT_NAME, {
      expected,
      actual,
      reason,
    });
  }
}

export interface ExplicitProviderOverride {
  readonly taskKind: CoachTaskKind;
  readonly decidedProvider: 'gemma' | 'openai';
  readonly reason?: string;
}

/**
 * Telemetry sibling for callers that pin a provider explicitly (auto-debrief,
 * progression-planner). The dispatch router only fires `recordDispatchDecision`
 * when `provider === undefined`; this plugs the complex-task cloud path.
 */
export function recordExplicitProviderOverride(
  override: ExplicitProviderOverride,
): void {
  const reason = override.reason ?? 'explicit-override';
  recordCounter(DISPATCH_EVENT_NAME);
  recordCounter(`${DISPATCH_EVENT_NAME}:provider:${override.decidedProvider}`);
  recordCounter(`${DISPATCH_EVENT_NAME}:taskKind:${override.taskKind}`);
  recordCounter(`${DISPATCH_EVENT_NAME}:reason:${reason}`);

  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.log('[coach-dispatch]', DISPATCH_EVENT_NAME, {
      taskKind: override.taskKind,
      decidedProvider: override.decidedProvider,
      reason,
    });
  }
}
