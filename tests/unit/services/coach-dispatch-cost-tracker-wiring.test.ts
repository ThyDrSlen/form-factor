/**
 * Wave-29 T4: dispatch → cost-tracker integration.
 *
 * Verifies that `dispatchCoachPrompt` wires `recordCoachUsage` through both
 * routing arms:
 *   - prefer_local + in-cohort + model-ready → localGenerate called AND
 *     recordCoachUsage called with provider tagged 'gemma_ondevice'.
 *   - prefer_local + out-of-cohort → cloud call AND recordCoachUsage called
 *     with provider tagged 'gemma_cloud' (or 'openai').
 *
 * STATUS: skipped. As of this commit, `recordCoachUsage` lives only in
 * lib/services/coach-cost-tracker.ts and has NO caller in either
 * coach-dispatch.ts or coach-service.ts. PR #548 (or a successor) must wire
 * `recordCoachUsage` into the dispatch path before this test can un-skip.
 *
 * The skipped bodies document the desired integration contract so the
 * un-skip is a one-line removal and the wiring intent is code-reviewable.
 * See TODO(wave-29-C-T4) on each `it.skip`.
 */

import type {
  CoachDispatchOptions,
  CoachModelManagerLike,
} from '@/lib/services/coach-dispatch';
import type { CoachMessage } from '@/lib/services/coach-service';

const readyManager: CoachModelManagerLike = {
  getStatus: () => ({ status: 'ready' }),
};

const baseMessages: CoachMessage[] = [{ role: 'user', content: 'cue me.' }];

// ---------------------------------------------------------------------------
// Cohort + flag env management
// ---------------------------------------------------------------------------
const FLAG = 'EXPO_PUBLIC_COACH_PIPELINE_V2';
const COHORT = 'EXPO_PUBLIC_COACH_LOCAL_COHORT_PCT';
const originalFlag = process.env[FLAG];
const originalCohort = process.env[COHORT];

afterEach(() => {
  for (const [k, v] of [
    [FLAG, originalFlag],
    [COHORT, originalCohort],
  ] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('coach-dispatch → coach-cost-tracker wiring (wave-29 T4)', () => {
  // TODO(wave-29-C-T4): un-skip once the dispatcher is wired to
  // recordCoachUsage (tracked via PR #548). The dispatch path in
  // lib/services/coach-dispatch.ts:121-141 selects local vs. cloud but does
  // not yet record usage. When un-skipping, the expected call shape is:
  //   recordCoachUsage({ provider: 'gemma_ondevice', taskKind: 'chat', ... })
  // for the local arm and provider: 'gemma_cloud' | 'openai' for the cloud arm.
  it.skip('prefer_local + in-cohort + model-ready → localGenerate + recordCoachUsage(provider=gemma_ondevice)', async () => {
    process.env[FLAG] = 'on';
    process.env[COHORT] = '100';

    // These mocks encode the expected integration contract. When the
    // wiring lands, the test should pass without modification (apart from
    // un-skip).
    const recordCoachUsage = jest.fn();
    jest.doMock('@/lib/services/coach-cost-tracker', () => ({
      recordCoachUsage,
    }));

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { dispatchCoachPrompt } = require('@/lib/services/coach-dispatch') as typeof import('@/lib/services/coach-dispatch');

    const cloudSend = jest.fn().mockResolvedValue({ role: 'assistant', content: 'cloud' });
    const localGenerate = jest
      .fn()
      .mockResolvedValue({ role: 'assistant', content: 'local reply' });

    const opts: CoachDispatchOptions = {
      preference: 'prefer_local',
      modelManager: readyManager,
      cloudSend,
      localGenerate,
    };

    const result = await dispatchCoachPrompt(
      { messages: baseMessages, context: { profile: { id: 'user-in' } } },
      opts,
    );

    expect(result.content).toBe('local reply');
    expect(localGenerate).toHaveBeenCalledTimes(1);
    expect(cloudSend).not.toHaveBeenCalled();
    expect(recordCoachUsage).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'gemma_ondevice' }),
    );
  });

  // TODO(wave-29-C-T4): un-skip once the dispatcher is wired to
  // recordCoachUsage. This case documents the cohort-skip arm at
  // coach-dispatch.ts:139-141 — when the user is out of the rollout cohort,
  // the dispatcher collapses to cloud AND should record the cloud call.
  it.skip('prefer_local + out-of-cohort → cloud + recordCoachUsage(provider=gemma_cloud|openai)', async () => {
    process.env[FLAG] = 'on';
    process.env[COHORT] = '0';

    const recordCoachUsage = jest.fn();
    jest.doMock('@/lib/services/coach-cost-tracker', () => ({
      recordCoachUsage,
    }));

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { dispatchCoachPrompt } = require('@/lib/services/coach-dispatch') as typeof import('@/lib/services/coach-dispatch');

    const cloudSend = jest
      .fn()
      .mockResolvedValue({ role: 'assistant', content: 'cloud reply' });
    const localGenerate = jest
      .fn()
      .mockResolvedValue({ role: 'assistant', content: 'local reply' });

    const opts: CoachDispatchOptions = {
      preference: 'prefer_local',
      modelManager: readyManager,
      cloudSend,
      localGenerate,
    };

    const result = await dispatchCoachPrompt(
      { messages: baseMessages, context: { profile: { id: 'user-out' } } },
      opts,
    );

    expect(result.content).toBe('cloud reply');
    expect(localGenerate).not.toHaveBeenCalled();
    expect(cloudSend).toHaveBeenCalledTimes(1);
    expect(recordCoachUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: expect.stringMatching(/^(gemma_cloud|openai)$/),
      }),
    );
  });
});
