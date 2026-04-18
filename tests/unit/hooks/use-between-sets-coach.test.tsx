import React from 'react';
import { Text, View } from 'react-native';
import { act, render } from '@testing-library/react-native';
import { useBetweenSetsCoach } from '@/hooks/use-between-sets-coach';

const mockRestTimer = jest.fn();
const mockExercises = jest.fn();
const mockSets = jest.fn();

jest.mock('@/lib/stores/session-runner', () => ({
  useSessionRunner: (selector: (s: unknown) => unknown) =>
    selector({
      get restTimer() {
        return mockRestTimer();
      },
      get exercises() {
        return mockExercises();
      },
      get sets() {
        return mockSets();
      },
    }),
}));

function TestHarness({ onRender }: { onRender: (r: ReturnType<typeof useBetweenSetsCoach>) => void }) {
  const result = useBetweenSetsCoach();
  onRender(result);
  return (
    <View testID="harness">
      <Text testID="set-id">{result.setId ?? 'none'}</Text>
      <Text testID="mobility-id">{result.recommendation?.mobility.id ?? 'none'}</Text>
      <Text testID="reflection-id">{result.recommendation?.reflection.id ?? 'none'}</Text>
    </View>
  );
}

describe('useBetweenSetsCoach', () => {
  beforeEach(() => {
    mockRestTimer.mockReset();
    mockExercises.mockReset();
    mockSets.mockReset();
  });

  it('returns null recommendation when no rest timer is active', () => {
    mockRestTimer.mockReturnValue(null);
    mockExercises.mockReturnValue([]);
    mockSets.mockReturnValue({});

    const onRender = jest.fn();
    render(<TestHarness onRender={onRender} />);

    const last = onRender.mock.calls[onRender.mock.calls.length - 1][0];
    expect(last.recommendation).toBeNull();
    expect(last.setId).toBeNull();
  });

  it('builds a recommendation for the active set', () => {
    mockRestTimer.mockReturnValue({
      setId: 'set-1',
      targetSeconds: 120,
      startedAt: '2026-04-16T10:00:00Z',
    });
    mockExercises.mockReturnValue([
      {
        id: 'ex-1',
        exercise: { id: 'e1', name: 'Bench Press', muscle_group: 'chest', is_compound: true },
      },
    ]);
    mockSets.mockReturnValue({
      'ex-1': [
        {
          id: 'set-1',
          set_type: 'normal',
          planned_reps: 8,
          actual_reps: 8,
          planned_weight: null,
          actual_weight: null,
          perceived_rpe: null,
        },
        {
          id: 'set-2',
          set_type: 'normal',
          planned_reps: 8,
          actual_reps: null,
          planned_weight: null,
          actual_weight: null,
          perceived_rpe: null,
        },
      ],
    });

    const onRender = jest.fn();
    render(<TestHarness onRender={onRender} />);

    const last = onRender.mock.calls[onRender.mock.calls.length - 1][0];
    expect(last.setId).toBe('set-1');
    expect(last.recommendation).not.toBeNull();
    expect(last.recommendation?.context.muscleGroup).toBe('chest');
    expect(last.recommendation?.context.setIndex).toBe(0);
    expect(last.recommendation?.context.totalSets).toBe(2);
  });

  it('returns null when the active set cannot be found in any exercise', () => {
    mockRestTimer.mockReturnValue({
      setId: 'missing-set',
      targetSeconds: 90,
      startedAt: '2026-04-16T10:00:00Z',
    });
    mockExercises.mockReturnValue([
      { id: 'ex-1', exercise: { id: 'e1', muscle_group: 'back' } },
    ]);
    mockSets.mockReturnValue({
      'ex-1': [{ id: 'other-set', set_type: 'normal' }],
    });

    const onRender = jest.fn();
    render(<TestHarness onRender={onRender} />);

    const last = onRender.mock.calls[onRender.mock.calls.length - 1][0];
    expect(last.recommendation).toBeNull();
  });

  it('refresh() re-derives the recommendation and varies the mobility/reflection picks', () => {
    mockRestTimer.mockReturnValue({
      setId: 'set-1',
      targetSeconds: 180,
      startedAt: '2026-04-16T10:00:00Z',
    });
    mockExercises.mockReturnValue([
      { id: 'ex-1', exercise: { id: 'e1', muscle_group: 'chest' } },
    ]);
    mockSets.mockReturnValue({
      'ex-1': [
        {
          id: 'set-1',
          set_type: 'normal',
          planned_reps: 8,
          actual_reps: 8,
          perceived_rpe: null,
        },
      ],
    });

    const onRender = jest.fn();
    const { rerender } = render(<TestHarness onRender={onRender} />);

    const first = onRender.mock.calls[onRender.mock.calls.length - 1][0];

    act(() => {
      first.refresh();
    });
    rerender(<TestHarness onRender={onRender} />);

    const second = onRender.mock.calls[onRender.mock.calls.length - 1][0];
    expect(second.recommendation?.mobility.id).not.toBe(first.recommendation?.mobility.id);
  });

  it('passes perceived_rpe into the recommendation to raise fatigue', () => {
    mockRestTimer.mockReturnValue({
      setId: 'set-1',
      targetSeconds: 120,
      startedAt: '2026-04-16T10:00:00Z',
    });
    mockExercises.mockReturnValue([
      { id: 'ex-1', exercise: { id: 'e1', muscle_group: 'quads' } },
    ]);
    mockSets.mockReturnValue({
      'ex-1': [
        {
          id: 'set-1',
          set_type: 'normal',
          planned_reps: 5,
          actual_reps: 5,
          perceived_rpe: 9,
        },
      ],
    });

    const onRender = jest.fn();
    render(<TestHarness onRender={onRender} />);

    const last = onRender.mock.calls[onRender.mock.calls.length - 1][0];
    expect(last.recommendation?.fatigueScore).toBeGreaterThan(0);
  });
});
