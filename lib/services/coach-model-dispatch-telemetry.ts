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
import type { CoachTaskKind, DispatchDecision } from './coach-model-dispatch';

const DISPATCH_EVENT_NAME = 'coach_dispatch_decision';

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
 * Telemetry sibling for callers that pin a provider explicitly (e.g.
 * auto-debrief, progression-planner). The dispatch router in coach-service
 * only fires `recordDispatchDecision` when `provider === undefined`, so
 * complex tasks that always route to the cloud never show up in the
 * decision counters. This function plugs that hole without touching the
 * router.
 *
 * Counter names are kept parallel to `recordDispatchDecision` so the
 * existing dashboards can read both surfaces off the same prefix.
 */
export interface ExplicitProviderOverride {
  readonly taskKind: CoachTaskKind;
  readonly decidedProvider: 'gemma' | 'openai';
  readonly reason?: string;
}

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
