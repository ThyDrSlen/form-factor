/**
 * Pipeline-v2 cohort gating in coach-dispatch. Verifies that on-device
 * selection only fires for users inside the rollout cohort when the master
 * flag is on.
 */

import {
  dispatchCoachPrompt,
  CoachDispatchError,
  type CoachDispatchOptions,
  type CoachModelManagerLike,
} from '@/lib/services/coach-dispatch';
import type { CoachMessage } from '@/lib/services/coach-service';
import { getCounter, resetTelemetry } from '@/lib/services/coach-telemetry';

const messages: CoachMessage[] = [{ role: 'user', content: 'squat cues?' }];

const readyManager: CoachModelManagerLike = {
  getStatus: () => ({ status: 'ready' }),
};

const FLAG = 'EXPO_PUBLIC_COACH_PIPELINE_V2';
const COHORT = 'EXPO_PUBLIC_COACH_LOCAL_COHORT_PCT';
const originalFlag = process.env[FLAG];
const originalCohort = process.env[COHORT];

afterEach(() => {
  resetTelemetry();
  for (const [k, v] of [
    [FLAG, originalFlag],
    [COHORT, originalCohort],
  ] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('coach-dispatch cohort gating (pipeline-v2 flag)', () => {
  it('cohort=0 → prefer_local collapses to cloud when flag is on', async () => {
    process.env[FLAG] = 'on';
    process.env[COHORT] = '0';
    const cloudSend = jest.fn().mockResolvedValue({ role: 'assistant', content: 'cloud reply' });
    const localGenerate = jest.fn().mockResolvedValue({ role: 'assistant', content: 'local reply' });

    const opts: CoachDispatchOptions = {
      preference: 'prefer_local',
      modelManager: readyManager,
      cloudSend,
      localGenerate,
    };

    const result = await dispatchCoachPrompt(
      { messages, context: { profile: { id: 'user-1' } } },
      opts,
    );

    expect(result.content).toBe('cloud reply');
    expect(localGenerate).not.toHaveBeenCalled();
    expect(getCounter('coach_dispatch_prefer_local_cohort_skip')).toBe(1);
  });

  it('cohort=100 → prefer_local runs on-device when flag is on', async () => {
    process.env[FLAG] = 'on';
    process.env[COHORT] = '100';
    const cloudSend = jest.fn().mockResolvedValue({ role: 'assistant', content: 'cloud reply' });
    const localGenerate = jest.fn().mockResolvedValue({ role: 'assistant', content: 'local reply' });

    const opts: CoachDispatchOptions = {
      preference: 'prefer_local',
      modelManager: readyManager,
      cloudSend,
      localGenerate,
    };

    const result = await dispatchCoachPrompt(
      { messages, context: { profile: { id: 'user-1' } } },
      opts,
    );

    expect(result.content).toBe('local reply');
    expect(localGenerate).toHaveBeenCalledTimes(1);
    expect(cloudSend).not.toHaveBeenCalled();
  });

  it('cohort=50 → deterministic: same userId → same bucket decision', async () => {
    process.env[FLAG] = 'on';
    process.env[COHORT] = '50';
    const cloudSend = jest.fn().mockResolvedValue({ role: 'assistant', content: 'cloud reply' });
    const localGenerate = jest.fn().mockResolvedValue({ role: 'assistant', content: 'local reply' });

    const opts: CoachDispatchOptions = {
      preference: 'prefer_local',
      modelManager: readyManager,
      cloudSend,
      localGenerate,
    };

    const r1 = await dispatchCoachPrompt(
      { messages, context: { profile: { id: 'deterministic-user' } } },
      opts,
    );
    const r2 = await dispatchCoachPrompt(
      { messages, context: { profile: { id: 'deterministic-user' } } },
      opts,
    );
    // Both calls must resolve identically for the same userId.
    expect(r1.content).toBe(r2.content);
  });

  it('local_only + cohort=0 → throws local_unavailable when flag is on', async () => {
    process.env[FLAG] = 'on';
    process.env[COHORT] = '0';
    const localGenerate = jest.fn().mockResolvedValue({ role: 'assistant', content: 'local reply' });

    const opts: CoachDispatchOptions = {
      preference: 'local_only',
      modelManager: readyManager,
      localGenerate,
    };

    await expect(
      dispatchCoachPrompt(
        { messages, context: { profile: { id: 'user-1' } } },
        opts,
      ),
    ).rejects.toMatchObject({
      name: 'CoachDispatchError',
      code: 'local_unavailable',
    });
  });

  it('flag off → cohort is not enforced (prefer_local honors preference)', async () => {
    delete process.env[FLAG];
    process.env[COHORT] = '0';
    const cloudSend = jest.fn().mockResolvedValue({ role: 'assistant', content: 'cloud reply' });
    const localGenerate = jest.fn().mockResolvedValue({ role: 'assistant', content: 'local reply' });

    const opts: CoachDispatchOptions = {
      preference: 'prefer_local',
      modelManager: readyManager,
      cloudSend,
      localGenerate,
    };

    const result = await dispatchCoachPrompt(
      { messages, context: { profile: { id: 'user-1' } } },
      opts,
    );

    // Flag off: cohort ignored, local runs as before.
    expect(result.content).toBe('local reply');
    expect(localGenerate).toHaveBeenCalledTimes(1);
  });
});
