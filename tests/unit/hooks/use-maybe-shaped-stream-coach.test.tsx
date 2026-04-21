// Unit tests for hooks/use-maybe-shaped-stream-coach.ts — verifies the
// flag-gated selector dispatches to the correct underlying hook.

const mockStreamCoachPrompt = jest.fn();

jest.mock('@/lib/services/coach-streaming', () => ({
  streamCoachPrompt: (...args: unknown[]) => mockStreamCoachPrompt(...args),
}));

import { renderHook, act } from '@testing-library/react-native';
import { useMaybeShapedStreamCoach } from '@/hooks/use-maybe-shaped-stream-coach';
import { resetCoachTelemetry } from '@/lib/services/coach-telemetry';

const FLAG_ENV_VAR = 'EXPO_PUBLIC_COACH_PIPELINE_V2';
const originalFlag = process.env[FLAG_ENV_VAR];

beforeEach(() => {
  jest.clearAllMocks();
  resetCoachTelemetry();
});

afterEach(() => {
  if (originalFlag === undefined) {
    delete process.env[FLAG_ENV_VAR];
  } else {
    process.env[FLAG_ENV_VAR] = originalFlag;
  }
});

describe('useMaybeShapedStreamCoach', () => {
  it('returns raw stream state when pipeline-v2 flag is off', async () => {
    delete process.env[FLAG_ENV_VAR];
    // Raw hook appends every delta immediately; no sentence boundary.
    mockStreamCoachPrompt.mockImplementation(
      async (_m: unknown, _c: unknown, onChunk: (d: string) => void) => {
        onChunk('Keep your ');
        onChunk('chest ');
        onChunk('up');
        return { text: 'Keep your chest up', chunkCount: 3, ttftMs: 1, durationMs: 2 };
      }
    );

    const { result } = renderHook(() => useMaybeShapedStreamCoach());
    await act(async () => {
      await result.current.start([{ role: 'user', content: 'hi' }]);
    });
    // Raw hook sees all three appended chunks.
    expect(result.current.buffered).toBe('Keep your chest up');
    expect(result.current.complete).toBe(true);
  });

  it('returns shaped stream state when pipeline-v2 flag is on (sentence-buffered)', async () => {
    process.env[FLAG_ENV_VAR] = 'on';
    // Shaped hook only emits up to the last sentence boundary; final flush
    // on stream close emits whatever remains.
    mockStreamCoachPrompt.mockImplementation(
      async (_m: unknown, _c: unknown, onChunk: (d: string) => void) => {
        onChunk('First. ');
        onChunk('Second ');
        onChunk('incomplete');
        return { text: 'First. Second incomplete', chunkCount: 3, ttftMs: 1, durationMs: 2 };
      }
    );

    const { result } = renderHook(() => useMaybeShapedStreamCoach());
    await act(async () => {
      await result.current.start([{ role: 'user', content: 'hi' }]);
    });

    // Final buffered must match the upstream full text after flush.
    expect(result.current.buffered).toBe('First. Second incomplete');
    expect(result.current.complete).toBe(true);
  });
});
