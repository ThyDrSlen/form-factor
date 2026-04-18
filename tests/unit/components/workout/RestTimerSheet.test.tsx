import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import RestTimerSheet from '@/components/workout/RestTimerSheet';

jest.mock('@gorhom/bottom-sheet', () => {
  const ReactActual = jest.requireActual('react');
  const Fragment = ReactActual.Fragment;
  const Passthrough = ReactActual.forwardRef(
    ({ children }: { children?: React.ReactNode }, _ref: unknown) =>
      ReactActual.createElement(Fragment, null, children),
  );
  const ScrollPassthrough = ({ children }: { children?: React.ReactNode }) =>
    ReactActual.createElement(Fragment, null, children);
  return { __esModule: true, default: Passthrough, BottomSheetScrollView: ScrollPassthrough };
});

const mockSkipRest = jest.fn(() => Promise.resolve());
const mockExtendRest = jest.fn();

const mockStoreRef: {
  value: {
    restTimer: { targetSeconds: number; startedAt: string; setId: string } | null;
    exercises: Array<{
      id: string;
      exercise?: { id: string; name: string; muscle_group: string };
    }>;
    sets: Record<
      string,
      Array<{
        id: string;
        set_type: string;
        planned_reps: number | null;
        actual_reps: number | null;
        perceived_rpe: number | null;
      }>
    >;
  };
} = {
  value: {
    restTimer: {
      setId: 'set-1',
      targetSeconds: 60,
      startedAt: new Date(Date.now() - 30_000).toISOString(),
    },
    exercises: [
      {
        id: 'ex-1',
        exercise: { id: 'e1', name: 'Bench Press', muscle_group: 'chest' },
      },
    ],
    sets: {
      'ex-1': [
        {
          id: 'set-1',
          set_type: 'normal',
          planned_reps: 8,
          actual_reps: 8,
          perceived_rpe: null,
        },
        {
          id: 'set-2',
          set_type: 'normal',
          planned_reps: 8,
          actual_reps: null,
          perceived_rpe: null,
        },
      ],
    },
  },
};

jest.mock('@/lib/stores/session-runner', () => ({
  useSessionRunner: (selector: (s: unknown) => unknown) =>
    selector({
      get restTimer() {
        return mockStoreRef.value.restTimer;
      },
      get exercises() {
        return mockStoreRef.value.exercises;
      },
      get sets() {
        return mockStoreRef.value.sets;
      },
      skipRest: () => mockSkipRest(),
      extendRest: (seconds: number) => mockExtendRest(seconds),
    }),
}));

const mockImpactAsync = jest.fn(() => Promise.resolve());
jest.mock('expo-haptics', () => ({
  ImpactFeedbackStyle: { Medium: 'medium' },
  impactAsync: () => mockImpactAsync(),
}));

describe('RestTimerSheet', () => {
  beforeEach(() => {
    mockSkipRest.mockClear();
    mockExtendRest.mockClear();
    mockImpactAsync.mockClear();
  });

  it('renders the sheet with a timer display', () => {
    const { getByTestId } = render(<RestTimerSheet onClose={() => undefined} />);
    expect(getByTestId('rest-timer-sheet')).toBeTruthy();
    expect(getByTestId('rest-timer-display')).toBeTruthy();
  });

  it('renders the active recovery panel with recommendation content', () => {
    const { getByTestId } = render(<RestTimerSheet onClose={() => undefined} />);
    expect(getByTestId('rest-active-recovery-panel')).toBeTruthy();
    expect(getByTestId('breathing-cue-card')).toBeTruthy();
    expect(getByTestId('mobility-drill-card')).toBeTruthy();
    expect(getByTestId('reflection-prompt-card')).toBeTruthy();
  });

  it('invokes extendRest with 15 or 30 seconds on the respective buttons', () => {
    const { getByTestId } = render(<RestTimerSheet onClose={() => undefined} />);
    fireEvent.press(getByTestId('rest-timer-extend-15'));
    fireEvent.press(getByTestId('rest-timer-extend-30'));
    expect(mockExtendRest).toHaveBeenCalledWith(15);
    expect(mockExtendRest).toHaveBeenCalledWith(30);
  });

  it('calls skipRest + onClose when SetReady is pressed', async () => {
    const onClose = jest.fn();
    const { getByTestId } = render(<RestTimerSheet onClose={onClose} />);
    fireEvent.press(getByTestId('set-ready-button'));
    await waitFor(() => expect(mockSkipRest).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('calls skipRest + onClose when Skip link is pressed', async () => {
    const onClose = jest.fn();
    const { getByTestId } = render(<RestTimerSheet onClose={onClose} />);
    fireEvent.press(getByTestId('rest-timer-skip'));
    await waitFor(() => expect(mockSkipRest).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('renders the empty panel state when there is no active rest', () => {
    const prev = mockStoreRef.value.restTimer;
    mockStoreRef.value.restTimer = null;
    const { getByTestId } = render(<RestTimerSheet onClose={() => undefined} />);
    expect(getByTestId('rest-active-recovery-empty')).toBeTruthy();
    mockStoreRef.value.restTimer = prev;
  });
});
