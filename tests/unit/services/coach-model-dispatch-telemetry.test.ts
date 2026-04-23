/**
 * Tests for the tier ↔ model mismatch telemetry emitted by
 * `coach-model-dispatch-telemetry.recordDispatchMismatch`.
 *
 * The helper is a thin wrapper around `recordCounter`; we assert the emitted
 * counter keys against the in-memory sink so downstream dashboards can rely
 * on stable event names.
 */

import {
  recordDispatchMismatch,
  recordDispatchDecision,
} from '@/lib/services/coach-model-dispatch-telemetry';
import { expectedTierModel, decideCoachModel } from '@/lib/services/coach-model-dispatch';
import { getCounter, resetTelemetry } from '@/lib/services/coach-telemetry';

beforeEach(() => {
  resetTelemetry();
});

describe('recordDispatchMismatch', () => {
  it('is a no-op when expected === actual', () => {
    recordDispatchMismatch('gemma-4-31b-it', 'gemma-4-31b-it', 'tactical_gemma');
    expect(getCounter('coach_dispatch_mismatch')).toBe(0);
  });

  it('emits three counters (overall, per-pair, per-reason) on divergence', () => {
    recordDispatchMismatch('gemma-4-26b-a4b-it', 'gpt-5.4-mini', 'high_fault_upgrade');
    expect(getCounter('coach_dispatch_mismatch')).toBe(1);
    expect(
      getCounter('coach_dispatch_mismatch:gemma-4-26b-a4b-it:gpt-5.4-mini'),
    ).toBe(1);
    expect(getCounter('coach_dispatch_mismatch:reason:high_fault_upgrade')).toBe(1);
  });

  it('accumulates repeated mismatches', () => {
    recordDispatchMismatch('gemma-4-31b-it', 'gpt-5.4-mini', 'force_cloud_override');
    recordDispatchMismatch('gemma-4-31b-it', 'gpt-5.4-mini', 'force_cloud_override');
    expect(getCounter('coach_dispatch_mismatch')).toBe(2);
    expect(
      getCounter('coach_dispatch_mismatch:gemma-4-31b-it:gpt-5.4-mini'),
    ).toBe(2);
  });

  it('detects the forceCloud divergence pair against expectedTierModel', () => {
    const expected = expectedTierModel('form_cue_lookup', {}, 'pro');
    const decision = decideCoachModel('form_cue_lookup', {}, 'pro', { forceCloud: true });
    expect(expected).toBe('gemma-4-31b-it');
    expect(decision.model).toBe('gpt-5.4-mini');
    recordDispatchMismatch(expected, decision.model, decision.reason);
    expect(
      getCounter('coach_dispatch_mismatch:gemma-4-31b-it:gpt-5.4-mini'),
    ).toBe(1);
    expect(getCounter('coach_dispatch_mismatch:reason:force_cloud_override')).toBe(1);
  });

  it('detects dispatchDisabled divergence — tactical baseline → cloud fallback', () => {
    const expected = expectedTierModel('rest_calc', {}, 'free');
    const decision = decideCoachModel('rest_calc', {}, 'free', { dispatchDisabled: true });
    expect(expected).toBe('gemma-4-26b-a4b-it');
    expect(decision.model).toBe('gpt-5.4-mini');
    recordDispatchMismatch(expected, decision.model, decision.reason);
    expect(getCounter('coach_dispatch_mismatch:reason:dispatch_disabled')).toBe(1);
  });
});

describe('recordDispatchDecision (sanity — ensures mismatch does not collide with decision)', () => {
  it('emits the decision counters without touching mismatch buckets', () => {
    recordDispatchDecision({
      model: 'gemma-4-31b-it',
      reason: 'tactical_gemma',
      fellBackToCloud: false,
    });
    expect(getCounter('coach_dispatch_decision')).toBe(1);
    expect(getCounter('coach_dispatch_decision:gemma-4-31b-it')).toBe(1);
    expect(getCounter('coach_dispatch_decision:reason:tactical_gemma')).toBe(1);
    expect(getCounter('coach_dispatch_mismatch')).toBe(0);
  });
});
