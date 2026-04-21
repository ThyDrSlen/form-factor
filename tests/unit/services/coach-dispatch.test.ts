import {
  dispatchCoachPrompt,
  CoachDispatchError,
  type CoachDispatchOptions,
  type CoachModelManagerLike,
  type CoachModelStatusSnapshot,
} from '@/lib/services/coach-dispatch';
import type { CoachMessage } from '@/lib/services/coach-service';
import { getCounter, resetTelemetry } from '@/lib/services/coach-telemetry';

const messages: CoachMessage[] = [{ role: 'user', content: 'squat cues?' }];

function makeManager(status: CoachModelStatusSnapshot['status']): CoachModelManagerLike {
  return {
    getStatus: () => ({ status }),
  };
}

describe('coach-dispatch', () => {
  beforeEach(() => {
    resetTelemetry();
  });

  it('cloud_only: routes straight to cloudSend and returns its reply', async () => {
    const cloudSend = jest.fn().mockResolvedValue({ role: 'assistant', content: 'cloud reply' });
    const localGenerate = jest.fn();

    const opts: CoachDispatchOptions = {
      preference: 'cloud_only',
      modelManager: makeManager('ready'),
      cloudSend,
      localGenerate,
    };

    const result = await dispatchCoachPrompt({ messages }, opts);

    expect(result).toEqual({ role: 'assistant', content: 'cloud reply' });
    expect(cloudSend).toHaveBeenCalledTimes(1);
    expect(localGenerate).not.toHaveBeenCalled();
  });

  it('cloud_only: propagates cloud errors without fallback', async () => {
    const cloudErr = new Error('Upstream failure');
    const cloudSend = jest.fn().mockRejectedValue(cloudErr);

    const opts: CoachDispatchOptions = {
      preference: 'cloud_only',
      modelManager: makeManager('ready'),
      cloudSend,
    };

    await expect(dispatchCoachPrompt({ messages }, opts)).rejects.toBe(cloudErr);
    expect(cloudSend).toHaveBeenCalledTimes(1);
  });

  it('prefer_local: uses local when model is ready', async () => {
    const cloudSend = jest.fn();
    const localGenerate = jest.fn().mockResolvedValue({ role: 'assistant', content: 'local reply' });

    const opts: CoachDispatchOptions = {
      preference: 'prefer_local',
      modelManager: makeManager('ready'),
      cloudSend,
      localGenerate,
    };

    const result = await dispatchCoachPrompt({ messages }, opts);
    expect(result).toEqual({ role: 'assistant', content: 'local reply' });
    expect(localGenerate).toHaveBeenCalledTimes(1);
    expect(cloudSend).not.toHaveBeenCalled();
    expect(getCounter('coach_dispatch_prefer_local_fallback')).toBe(0);
  });

  it('prefer_local: falls back to cloud when model is not ready, logs telemetry', async () => {
    const cloudSend = jest.fn().mockResolvedValue({ role: 'assistant', content: 'cloud fallback' });
    const localGenerate = jest.fn();

    const opts: CoachDispatchOptions = {
      preference: 'prefer_local',
      modelManager: makeManager('downloading'),
      cloudSend,
      localGenerate,
    };

    const result = await dispatchCoachPrompt({ messages }, opts);
    expect(result).toEqual({ role: 'assistant', content: 'cloud fallback' });
    expect(localGenerate).not.toHaveBeenCalled();
    expect(cloudSend).toHaveBeenCalledTimes(1);
    expect(getCounter('coach_dispatch_prefer_local_fallback')).toBe(1);
  });

  it('prefer_local: falls back to cloud when local generation throws', async () => {
    const cloudSend = jest.fn().mockResolvedValue({ role: 'assistant', content: 'cloud after local fail' });
    const localGenerate = jest.fn().mockRejectedValue(new Error('gemma crashed'));

    const opts: CoachDispatchOptions = {
      preference: 'prefer_local',
      modelManager: makeManager('ready'),
      cloudSend,
      localGenerate,
    };

    const result = await dispatchCoachPrompt({ messages }, opts);
    expect(result).toEqual({ role: 'assistant', content: 'cloud after local fail' });
    expect(localGenerate).toHaveBeenCalledTimes(1);
    expect(cloudSend).toHaveBeenCalledTimes(1);
    expect(getCounter('coach_dispatch_prefer_local_fallback')).toBe(1);
  });

  it('prefer_local: only logs fallback telemetry once per dispatch', async () => {
    const cloudSend = jest.fn().mockResolvedValue({ role: 'assistant', content: 'cloud' });
    const opts: CoachDispatchOptions = {
      preference: 'prefer_local',
      modelManager: makeManager('error'),
      cloudSend,
    };

    await dispatchCoachPrompt({ messages }, opts);
    expect(getCounter('coach_dispatch_prefer_local_fallback')).toBe(1);
  });

  it('local_only: returns local reply when model is ready', async () => {
    const cloudSend = jest.fn();
    const localGenerate = jest.fn().mockResolvedValue({ role: 'assistant', content: 'local only reply' });

    const opts: CoachDispatchOptions = {
      preference: 'local_only',
      modelManager: makeManager('ready'),
      cloudSend,
      localGenerate,
    };

    const result = await dispatchCoachPrompt({ messages }, opts);
    expect(result).toEqual({ role: 'assistant', content: 'local only reply' });
    expect(cloudSend).not.toHaveBeenCalled();
  });

  it('local_only: throws CoachDispatchError(local_unavailable) when model is not ready', async () => {
    const cloudSend = jest.fn();
    const localGenerate = jest.fn();

    const opts: CoachDispatchOptions = {
      preference: 'local_only',
      modelManager: makeManager('none'),
      cloudSend,
      localGenerate,
    };

    await expect(dispatchCoachPrompt({ messages }, opts)).rejects.toBeInstanceOf(CoachDispatchError);
    await expect(dispatchCoachPrompt({ messages }, opts)).rejects.toMatchObject({
      code: 'local_unavailable',
    });
    expect(cloudSend).not.toHaveBeenCalled();
    expect(localGenerate).not.toHaveBeenCalled();
  });

  it('local_only: throws local_unavailable when localGenerate is missing even if ready', async () => {
    const opts: CoachDispatchOptions = {
      preference: 'local_only',
      modelManager: makeManager('ready'),
      // localGenerate intentionally omitted
    };

    await expect(dispatchCoachPrompt({ messages }, opts)).rejects.toMatchObject({
      code: 'local_unavailable',
    });
  });

  it('local_only: propagates local generation errors as CoachDispatchError(local_generation_failed)', async () => {
    const localGenerate = jest.fn().mockRejectedValue(new Error('oom'));
    const opts: CoachDispatchOptions = {
      preference: 'local_only',
      modelManager: makeManager('ready'),
      localGenerate,
    };

    await expect(dispatchCoachPrompt({ messages }, opts)).rejects.toMatchObject({
      code: 'local_generation_failed',
    });
  });

  it('threads context through to cloudSend', async () => {
    const cloudSend = jest.fn().mockResolvedValue({ role: 'assistant', content: 'ok' });
    const opts: CoachDispatchOptions = {
      preference: 'cloud_only',
      modelManager: makeManager('ready'),
      cloudSend,
    };

    await dispatchCoachPrompt({ messages, context: { focus: 'squat' } }, opts);
    expect(cloudSend).toHaveBeenCalledWith(messages, { focus: 'squat' });
  });

  // ---------------------------------------------------------------------------
  // Gap #6 — combined unavailability conditions on `prefer_local`.
  //
  // coach-dispatch.ts:86-91 bundles the "model not ready" and "no localGenerate
  // wired" guards under the same `local_unavailable` code. When BOTH hold
  // simultaneously (user picked prefer_local but nothing is mounted), the
  // dispatcher must still route the cloud path AND still log a single
  // fallback telemetry — not throw or double-count.
  // ---------------------------------------------------------------------------

  it('prefer_local: model downloading AND missing localGenerate → cloud fallback with single telemetry log', async () => {
    const cloudSend = jest
      .fn()
      .mockResolvedValue({ role: 'assistant', content: 'cloud combined-fallback' });

    const opts: CoachDispatchOptions = {
      preference: 'prefer_local',
      modelManager: makeManager('downloading'),
      // localGenerate deliberately omitted so both guards trip.
      cloudSend,
    };

    const result = await dispatchCoachPrompt({ messages }, opts);
    expect(result).toEqual({ role: 'assistant', content: 'cloud combined-fallback' });
    expect(cloudSend).toHaveBeenCalledTimes(1);
    expect(getCounter('coach_dispatch_prefer_local_fallback')).toBe(1);
  });

  it('local_only: missing localGenerate AND status=downloading both surface local_unavailable', async () => {
    // Exercises the combined unavailability path under the stricter preference
    // to ensure both guards still collapse to the same typed error code.
    const opts: CoachDispatchOptions = {
      preference: 'local_only',
      modelManager: makeManager('downloading'),
      // localGenerate omitted.
    };

    await expect(dispatchCoachPrompt({ messages }, opts)).rejects.toBeInstanceOf(
      CoachDispatchError,
    );
    await expect(dispatchCoachPrompt({ messages }, opts)).rejects.toMatchObject({
      code: 'local_unavailable',
    });
  });
});
