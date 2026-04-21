/**
 * use-workout-coach-context tests.
 *
 * Verifies the flag gate, the null-return when the flag is off, and the
 * sendCoachPrompt wire-up with a mocked coach-service.
 */
import React from 'react';
import { act, render } from '@testing-library/react-native';
import { Text } from 'react-native';

const mockSendCoachPrompt = jest.fn();
const mockBuildContext = jest.fn();
const mockIsEnabled = jest.fn();

jest.mock('@/lib/services/coach-service', () => ({
  sendCoachPrompt: (...args: unknown[]) => mockSendCoachPrompt(...args),
}));

jest.mock('@/lib/services/coach-workout-recall', () => {
  const actual = jest.requireActual('@/lib/services/coach-workout-recall');
  return {
    ...actual,
    buildWorkoutRecallContext: (...args: unknown[]) => mockBuildContext(...args),
  };
});

jest.mock('@/lib/services/workout-coach-recall-flag', () => ({
  isWorkoutCoachRecallEnabled: () => mockIsEnabled(),
}));

jest.mock('@/lib/services/database/local-db', () => ({
  localDB: { db: null },
}));

// eslint-disable-next-line import/first
import { useWorkoutCoachContext } from '@/hooks/use-workout-coach-context';

interface HarnessProps {
  onReady: (api: ReturnType<typeof useWorkoutCoachContext>) => void;
}

function Harness({ onReady }: HarnessProps) {
  const api = useWorkoutCoachContext();
  React.useEffect(() => {
    onReady(api);
  }, [api, onReady]);
  return <Text testID="harness">ready</Text>;
}

function mockCtx(overrides: Record<string, unknown> = {}) {
  return {
    workoutId: 'w-1',
    found: true,
    exerciseName: 'Pull-Up',
    dateIso: '2026-04-15T10:00:00.000Z',
    sets: 3,
    reps: 8,
    weight: null,
    durationMinutes: null,
    latestFormEntry: null,
    ...overrides,
  };
}

describe('useWorkoutCoachContext', () => {
  beforeEach(() => {
    mockSendCoachPrompt.mockReset();
    mockBuildContext.mockReset();
    mockIsEnabled.mockReset();
  });

  it('returns enabled=false when the flag is off', async () => {
    mockIsEnabled.mockReturnValue(false);
    let api: ReturnType<typeof useWorkoutCoachContext> | null = null;
    render(<Harness onReady={(a) => (api = a)} />);
    expect(api).not.toBeNull();
    expect(api!.enabled).toBe(false);
  });

  it('returns enabled=true when the flag is on', () => {
    mockIsEnabled.mockReturnValue(true);
    let api: ReturnType<typeof useWorkoutCoachContext> | null = null;
    render(<Harness onReady={(a) => (api = a)} />);
    expect(api!.enabled).toBe(true);
  });

  it('askAboutWorkout returns null when flag is off and does NOT call the coach', async () => {
    mockIsEnabled.mockReturnValue(false);
    mockBuildContext.mockResolvedValue(mockCtx());
    let api: ReturnType<typeof useWorkoutCoachContext> | null = null;
    render(<Harness onReady={(a) => (api = a)} />);

    const result = await act(async () => await api!.askAboutWorkout('w-1', 'hi'));
    expect(result).toBeNull();
    expect(mockSendCoachPrompt).not.toHaveBeenCalled();
  });

  it('askAboutWorkout returns null when workoutId is empty', async () => {
    mockIsEnabled.mockReturnValue(true);
    mockBuildContext.mockResolvedValue(mockCtx());
    let api: ReturnType<typeof useWorkoutCoachContext> | null = null;
    render(<Harness onReady={(a) => (api = a)} />);

    const result = await act(async () => await api!.askAboutWorkout('', 'hi'));
    expect(result).toBeNull();
    expect(mockSendCoachPrompt).not.toHaveBeenCalled();
  });

  it('askAboutWorkout sends a system + recall-prompt + user message when flag is on', async () => {
    mockIsEnabled.mockReturnValue(true);
    mockBuildContext.mockResolvedValue(mockCtx());
    mockSendCoachPrompt.mockResolvedValue({ role: 'assistant', content: 'sure, lets dig in' });

    let api: ReturnType<typeof useWorkoutCoachContext> | null = null;
    render(<Harness onReady={(a) => (api = a)} />);

    const result = await act(async () =>
      await api!.askAboutWorkout('w-1', 'what about my tempo?'),
    );

    expect(mockSendCoachPrompt).toHaveBeenCalledTimes(1);
    const [messages, context] = mockSendCoachPrompt.mock.calls[0];
    expect(Array.isArray(messages)).toBe(true);
    expect(messages[0].role).toBe('system');
    expect(messages[1].role).toBe('user');
    expect(messages[1].content).toContain('Pull-Up');
    expect(messages[2].role).toBe('user');
    expect(messages[2].content).toBe('what about my tempo?');
    expect(context).toMatchObject({ focus: 'workout-retrospective' });
    expect(result).toEqual({ role: 'assistant', content: 'sure, lets dig in' });
  });

  it('askAboutWorkout omits the user follow-up when message is whitespace-only', async () => {
    mockIsEnabled.mockReturnValue(true);
    mockBuildContext.mockResolvedValue(mockCtx());
    mockSendCoachPrompt.mockResolvedValue({ role: 'assistant', content: 'ok' });

    let api: ReturnType<typeof useWorkoutCoachContext> | null = null;
    render(<Harness onReady={(a) => (api = a)} />);

    await act(async () => await api!.askAboutWorkout('w-1', '   '));

    expect(mockSendCoachPrompt).toHaveBeenCalledTimes(1);
    const [messages] = mockSendCoachPrompt.mock.calls[0];
    expect(messages).toHaveLength(2);
    expect(messages[1].role).toBe('user');
  });

  it('loadContext is always callable regardless of flag', async () => {
    mockIsEnabled.mockReturnValue(false);
    mockBuildContext.mockResolvedValue(mockCtx({ workoutId: 'w-9' }));

    let api: ReturnType<typeof useWorkoutCoachContext> | null = null;
    render(<Harness onReady={(a) => (api = a)} />);

    const ctx = await act(async () => await api!.loadContext('w-9'));
    expect(mockBuildContext).toHaveBeenCalledWith('w-9');
    expect(ctx.workoutId).toBe('w-9');
  });
});
