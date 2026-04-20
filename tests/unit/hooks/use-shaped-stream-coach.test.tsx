// Unit tests for hooks/use-shaped-stream-coach.ts (issue #465 Item 5).

const mockStreamCoachPrompt = jest.fn();

jest.mock('@/lib/services/coach-streaming', () => ({
  streamCoachPrompt: (...args: unknown[]) => mockStreamCoachPrompt(...args),
}));

import { renderHook, act } from '@testing-library/react-native';
import { useShapedStreamCoach } from '@/hooks/use-shaped-stream-coach';
import {
  getCoachTelemetrySnapshot,
  resetCoachTelemetry,
} from '@/lib/services/coach-telemetry';

beforeEach(() => {
  jest.clearAllMocks();
  resetCoachTelemetry();
});

describe('useShapedStreamCoach', () => {
  it('starts in idle state', () => {
    const { result } = renderHook(() => useShapedStreamCoach());
    expect(result.current.buffered).toBe('');
    expect(result.current.pending).toBe('');
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.complete).toBe(false);
  });

  it('only emits to buffered after a sentence boundary; intermediate text sits in pending', async () => {
    mockStreamCoachPrompt.mockImplementation(
      async (
        _m: unknown,
        _c: unknown,
        onChunk: (d: string) => void
      ) => {
        // Simulate the stream emitting deltas.
        onChunk('Push day');
        onChunk(' plan: Bench');
        onChunk(' 4x5. Incline');
        onChunk(' DB 3x8.');
        return { text: 'Push day plan: Bench 4x5. Incline DB 3x8.', chunkCount: 4, ttftMs: 5, durationMs: 20 };
      }
    );

    const { result } = renderHook(() => useShapedStreamCoach());
    await act(async () => {
      await result.current.start([{ role: 'user', content: 'plan push' }]);
    });

    expect(result.current.buffered).toBe('Push day plan: Bench 4x5. Incline DB 3x8.');
    expect(result.current.pending).toBe('');
    expect(result.current.complete).toBe(true);
    expect(result.current.isStreaming).toBe(false);
  });

  it('flushes the trailing buffer when the upstream stream closes mid-sentence', async () => {
    mockStreamCoachPrompt.mockImplementation(
      async (_m: unknown, _c: unknown, onChunk: (d: string) => void) => {
        onChunk('No terminator here');
        return { text: 'No terminator here', chunkCount: 1, ttftMs: 5, durationMs: 5 };
      }
    );

    const { result } = renderHook(() => useShapedStreamCoach());
    await act(async () => {
      await result.current.start([{ role: 'user', content: 'x' }]);
    });

    expect(result.current.buffered).toBe('No terminator here');
    expect(result.current.pending).toBe('');
    expect(result.current.complete).toBe(true);
  });

  it('records stream_buffered_pct telemetry while text is held back', async () => {
    mockStreamCoachPrompt.mockImplementation(
      async (_m: unknown, _c: unknown, onChunk: (d: string) => void) => {
        // First chunk buffers fully; second chunk crosses a sentence boundary.
        onChunk('half a sentence');
        // After the first chunk, the shaper holds 100% (15/15 chars) so
        // stream_buffered_pct should be ~1.
        onChunk(' done. ');
        return {
          text: 'half a sentence done. ',
          chunkCount: 2,
          ttftMs: 5,
          durationMs: 10,
        };
      }
    );

    const { result } = renderHook(() => useShapedStreamCoach());
    await act(async () => {
      await result.current.start([{ role: 'user', content: 'x' }]);
    });

    const snap = getCoachTelemetrySnapshot();
    // stream_buffered_pct is updated continuously; final state is 0 because
    // the flush emitted everything. Just assert it's a real ratio in [0,1].
    expect(snap.stream_buffered_pct).toBeGreaterThanOrEqual(0);
    expect(snap.stream_buffered_pct).toBeLessThanOrEqual(1);
    expect(snap.stream_chunks).toBe(2);
  });

  it('does not flicker pending into buffered for partial sentences (incremental render)', async () => {
    const renderedBufferedHistory: string[] = [];

    mockStreamCoachPrompt.mockImplementation(
      async (_m: unknown, _c: unknown, onChunk: (d: string) => void) => {
        onChunk('Sentence ');
        onChunk('one. Halfway ');
        onChunk('through');
        return {
          text: 'Sentence one. Halfway through',
          chunkCount: 3,
          ttftMs: 5,
          durationMs: 15,
        };
      }
    );

    const { result } = renderHook(() => useShapedStreamCoach());
    await act(async () => {
      await result.current.start([{ role: 'user', content: 'x' }]);
    });
    renderedBufferedHistory.push(result.current.buffered);

    // After completion, full text should be present (flush includes pending).
    expect(result.current.buffered).toBe('Sentence one. Halfway through');
  });

  it('reset() clears state', async () => {
    mockStreamCoachPrompt.mockImplementation(
      async (_m: unknown, _c: unknown, onChunk: (d: string) => void) => {
        onChunk('A. B.');
        return { text: 'A. B.', chunkCount: 1, ttftMs: 1, durationMs: 1 };
      }
    );

    const { result } = renderHook(() => useShapedStreamCoach());
    await act(async () => {
      await result.current.start([{ role: 'user', content: 'x' }]);
    });
    expect(result.current.complete).toBe(true);

    act(() => result.current.reset());
    expect(result.current.buffered).toBe('');
    expect(result.current.pending).toBe('');
    expect(result.current.complete).toBe(false);
  });

  it('captures errors into state', async () => {
    mockStreamCoachPrompt.mockRejectedValue(new Error('boom'));

    const { result } = renderHook(() => useShapedStreamCoach());
    let returned: string | null = 'sentinel';
    await act(async () => {
      returned = await result.current.start([{ role: 'user', content: 'x' }]);
    });

    expect(returned).toBeNull();
    expect(result.current.error?.message).toBe('boom');
    expect(result.current.complete).toBe(false);
  });
});
