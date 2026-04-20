// Unit tests for hooks/use-stream-coach.ts (issue #465 Item 1 + Item 4).

const mockStreamCoachPrompt = jest.fn();

jest.mock('@/lib/services/coach-streaming', () => ({
  streamCoachPrompt: (...args: unknown[]) => mockStreamCoachPrompt(...args),
}));

import { renderHook, act } from '@testing-library/react-native';
import { useStreamCoach } from '@/hooks/use-stream-coach';
import {
  getCoachTelemetrySnapshot,
  resetCoachTelemetry,
} from '@/lib/services/coach-telemetry';

beforeEach(() => {
  jest.clearAllMocks();
  resetCoachTelemetry();
});

describe('useStreamCoach', () => {
  it('starts in idle state', () => {
    const { result } = renderHook(() => useStreamCoach());
    expect(result.current.buffered).toBe('');
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.complete).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.stats).toBeNull();
  });

  it('appends each delta into buffered and flips isStreaming -> complete', async () => {
    mockStreamCoachPrompt.mockImplementation(
      async (
        _msgs: unknown,
        _ctx: unknown,
        onChunk: (d: string) => void
      ) => {
        onChunk('hello ');
        onChunk('world');
        return { text: 'hello world', chunkCount: 2, ttftMs: 5, durationMs: 10 };
      }
    );

    const { result } = renderHook(() => useStreamCoach());

    let returned: string | null = null;
    await act(async () => {
      returned = await result.current.start([{ role: 'user', content: 'hi' }]);
    });

    expect(returned).toBe('hello world');
    expect(result.current.buffered).toBe('hello world');
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.complete).toBe(true);
    expect(result.current.stats).toEqual({
      text: 'hello world',
      chunkCount: 2,
      ttftMs: 5,
      durationMs: 10,
    });
  });

  it('records stream telemetry: chunks + complete stats', async () => {
    mockStreamCoachPrompt.mockImplementation(
      async (_m: unknown, _c: unknown, onChunk: (d: string) => void) => {
        onChunk('a');
        onChunk('b');
        onChunk('c');
        return { text: 'abc', chunkCount: 3, ttftMs: 7, durationMs: 30 };
      }
    );

    const { result } = renderHook(() => useStreamCoach());
    await act(async () => {
      await result.current.start([{ role: 'user', content: 'x' }]);
    });

    const snap = getCoachTelemetrySnapshot();
    expect(snap.stream_chunks).toBe(3);
    expect(snap.last_ttft_ms).toBe(7);
    expect(snap.last_duration_ms).toBe(30);
  });

  it('captures errors into state and returns null', async () => {
    mockStreamCoachPrompt.mockRejectedValue(new Error('boom'));

    const { result } = renderHook(() => useStreamCoach());
    let returned: string | null = 'sentinel';
    await act(async () => {
      returned = await result.current.start([{ role: 'user', content: 'x' }]);
    });

    expect(returned).toBeNull();
    expect(result.current.error).toEqual(expect.any(Error));
    expect(result.current.error?.message).toBe('boom');
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.complete).toBe(false);
  });

  it('records stream_abort_count on AbortError-shaped failure', async () => {
    const abortErr = new Error('cancelled');
    abortErr.name = 'AbortError';
    mockStreamCoachPrompt.mockRejectedValue(abortErr);

    const { result } = renderHook(() => useStreamCoach());
    await act(async () => {
      await result.current.start([{ role: 'user', content: 'x' }]);
    });

    const snap = getCoachTelemetrySnapshot();
    expect(snap.stream_abort_count).toBeGreaterThanOrEqual(1);
  });

  it('reset() returns the hook to idle', async () => {
    mockStreamCoachPrompt.mockImplementation(
      async (_m: unknown, _c: unknown, onChunk: (d: string) => void) => {
        onChunk('x');
        return { text: 'x', chunkCount: 1, ttftMs: 1, durationMs: 1 };
      }
    );

    const { result } = renderHook(() => useStreamCoach());
    await act(async () => {
      await result.current.start([{ role: 'user', content: 'x' }]);
    });
    expect(result.current.complete).toBe(true);

    act(() => result.current.reset());
    expect(result.current.buffered).toBe('');
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.complete).toBe(false);
    expect(result.current.stats).toBeNull();
  });

  it('abort() bumps the telemetry abort counter even when no stream is in flight (no-op safety)', () => {
    const { result } = renderHook(() => useStreamCoach());
    const before = getCoachTelemetrySnapshot().stream_abort_count;
    act(() => result.current.abort());
    // No in-flight controller -> safe no-op; counter must not increment.
    expect(getCoachTelemetrySnapshot().stream_abort_count).toBe(before);
  });

  it('starting a second call cancels the first in-flight stream', async () => {
    type StreamResult = { text: string; chunkCount: number; ttftMs: number; durationMs: number };
    const firstControl: { signal?: AbortSignal; resolve?: (v: StreamResult) => void } = {};

    mockStreamCoachPrompt.mockImplementationOnce(
      (
        _m: unknown,
        _c: unknown,
        _onChunk: (d: string) => void,
        opts: { signal?: AbortSignal }
      ) => {
        firstControl.signal = opts.signal;
        return new Promise<StreamResult>((resolve, reject) => {
          firstControl.resolve = resolve;
          opts.signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
          );
        });
      }
    );
    mockStreamCoachPrompt.mockImplementationOnce(
      async (_m: unknown, _c: unknown, onChunk: (d: string) => void) => {
        onChunk('second');
        return { text: 'second', chunkCount: 1, ttftMs: 2, durationMs: 5 };
      }
    );

    const { result } = renderHook(() => useStreamCoach());

    await act(async () => {
      // Fire-and-forget first call
      result.current.start([{ role: 'user', content: 'first' }]);
      await Promise.resolve();
      // Now start the second call - this should abort the first
      await result.current.start([{ role: 'user', content: 'second' }]);
    });

    expect(firstControl.signal?.aborted).toBe(true);
    expect(result.current.buffered).toBe('second');
    // Avoid hanging the first promise indefinitely - cause it to resolve cleanly.
    firstControl.resolve?.({ text: '', chunkCount: 0, ttftMs: 0, durationMs: 0 });
  });
});
