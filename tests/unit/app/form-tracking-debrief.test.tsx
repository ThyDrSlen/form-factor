import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import FormTrackingDebriefScreen from '@/app/(modals)/form-tracking-debrief';

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockParams: { current: Record<string, string | undefined> } = { current: {} };

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    back: mockBack,
  }),
  useLocalSearchParams: () => mockParams.current,
}));

const sampleReps = [
  { index: 1, fqi: 82, faults: [] },
  { index: 2, fqi: 58, faults: ['Hips rising', 'Knees caving'] },
  { index: 3, fqi: 30, faults: ['Lost depth'] },
];

function setParams(next: Record<string, string | undefined>) {
  mockParams.current = next;
}

describe('FormTrackingDebriefScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setParams({});
  });

  it('renders header stats derived from the route params', () => {
    setParams({
      exerciseName: 'Squat',
      durationSeconds: '245',
      reps: JSON.stringify(sampleReps),
    });

    const { getByTestId } = render(<FormTrackingDebriefScreen />);

    expect(getByTestId('form-tracking-debrief-exercise').props.children).toBe('Squat');
    expect(getByTestId('form-tracking-debrief-rep-count').props.children).toBeDefined();
  });

  it('formats the duration as mm:ss and rounds the average FQI', () => {
    setParams({
      exerciseName: 'Squat',
      durationSeconds: '125',
      reps: JSON.stringify(sampleReps),
    });

    const { getByText } = render(<FormTrackingDebriefScreen />);
    // 125s -> 2:05
    expect(getByText('2:05')).toBeTruthy();
    // avg of 82 / 58 / 30 = 56.67 -> rounded to 57
    expect(getByText('57')).toBeTruthy();
  });

  it('renders the highlight pair and the rep breakdown list when reps are present', () => {
    setParams({
      exerciseName: 'Squat',
      durationSeconds: '125',
      reps: JSON.stringify(sampleReps),
    });

    const { getByTestId, queryByTestId } = render(<FormTrackingDebriefScreen />);

    expect(getByTestId('session-highlight-row')).toBeTruthy();
    expect(getByTestId('session-highlight-best-rep-index').props.children.join('')).toContain('1');
    expect(getByTestId('session-highlight-worst-rep-index').props.children.join('')).toContain('3');

    expect(getByTestId('rep-breakdown-list')).toBeTruthy();
    expect(getByTestId('rep-breakdown-row-1')).toBeTruthy();
    expect(getByTestId('rep-breakdown-row-2')).toBeTruthy();
    expect(getByTestId('rep-breakdown-row-3')).toBeTruthy();

    expect(queryByTestId('form-tracking-debrief-empty')).toBeNull();
  });

  it('renders the Ask coach CTA and delegates navigation to it', () => {
    setParams({
      exerciseName: 'Squat',
      durationSeconds: '60',
      reps: JSON.stringify(sampleReps),
    });

    const { getByTestId } = render(<FormTrackingDebriefScreen />);

    fireEvent.press(getByTestId('ask-coach-cta'));

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith(
      expect.objectContaining({
        pathname: '/(tabs)/coach',
        params: expect.objectContaining({
          prefill: expect.stringContaining('Squat'),
        }),
      }),
    );
  });

  it('renders the empty state when reps array is empty and hides the breakdown list', () => {
    setParams({
      exerciseName: 'Squat',
      durationSeconds: '0',
      reps: JSON.stringify([]),
    });

    const { getByTestId, queryByTestId } = render(<FormTrackingDebriefScreen />);

    expect(getByTestId('form-tracking-debrief-empty')).toBeTruthy();
    expect(queryByTestId('rep-breakdown-list')).toBeNull();
  });

  it('handles missing reps param and malformed JSON gracefully', () => {
    setParams({
      exerciseName: 'Squat',
      durationSeconds: '30',
      reps: '{{{not-json',
    });

    const { getByTestId } = render(<FormTrackingDebriefScreen />);
    expect(getByTestId('form-tracking-debrief-empty')).toBeTruthy();
  });

  it('shows a generic fallback title when exerciseName is missing', () => {
    setParams({ exerciseName: undefined, durationSeconds: '0', reps: JSON.stringify([]) });

    const { getByTestId } = render(<FormTrackingDebriefScreen />);
    expect(getByTestId('form-tracking-debrief-exercise').props.children).toBe('Session recap');
  });

  it('closes the debrief via the top-bar button', () => {
    setParams({ exerciseName: 'Squat', durationSeconds: '0', reps: JSON.stringify([]) });
    const { getByTestId } = render(<FormTrackingDebriefScreen />);
    fireEvent.press(getByTestId('form-tracking-debrief-close'));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});
