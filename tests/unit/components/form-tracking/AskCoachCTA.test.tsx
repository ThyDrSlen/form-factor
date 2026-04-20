import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import {
  AskCoachCTA,
  buildCoachPrefill,
} from '@/components/form-tracking/AskCoachCTA';

const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

describe('AskCoachCTA', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('buildCoachPrefill', () => {
    it('produces the stable serialization when every field is present', () => {
      expect(
        buildCoachPrefill({
          exerciseName: 'Squat',
          repCount: 8,
          averageFqi: 74.4,
          topFault: 'Knees caving',
        }),
      ).toBe(
        'Just finished Squat, 8 reps, avg FQI 74. Top fault: Knees caving. What should I work on?',
      );
    });

    it('falls back to a generic exercise and no-fault caption when inputs are sparse', () => {
      expect(
        buildCoachPrefill({
          exerciseName: '',
          repCount: 0,
          averageFqi: null,
          topFault: null,
        }),
      ).toBe(
        'Just finished that lift, 0 reps, avg FQI n/a. No standout fault. What should I work on?',
      );
    });

    it('rounds the average FQI', () => {
      expect(
        buildCoachPrefill({
          exerciseName: 'Pullup',
          repCount: 5,
          averageFqi: 66.7,
          topFault: 'Hips rising',
        }),
      ).toContain('avg FQI 67');
    });

    it('guards against non-finite averages', () => {
      expect(
        buildCoachPrefill({
          exerciseName: 'Pushup',
          repCount: 10,
          averageFqi: Number.NaN,
          topFault: undefined,
        }),
      ).toContain('avg FQI n/a');
    });
  });

  describe('navigation', () => {
    it('pushes to the coach tab with the serialized prefill param', () => {
      const { getByTestId } = render(
        <AskCoachCTA
          exerciseName="Squat"
          repCount={8}
          averageFqi={74}
          topFault="Knees caving"
        />,
      );

      fireEvent.press(getByTestId('ask-coach-cta'));

      expect(mockPush).toHaveBeenCalledTimes(1);
      expect(mockPush).toHaveBeenCalledWith({
        pathname: '/(tabs)/coach',
        params: {
          prefill:
            'Just finished Squat, 8 reps, avg FQI 74. Top fault: Knees caving. What should I work on?',
        },
      });
    });

    it('still navigates with a safe prefill when session data is missing', () => {
      const { getByTestId } = render(
        <AskCoachCTA
          exerciseName=""
          repCount={0}
          averageFqi={null}
        />,
      );

      fireEvent.press(getByTestId('ask-coach-cta'));

      expect(mockPush).toHaveBeenCalledWith(
        expect.objectContaining({
          pathname: '/(tabs)/coach',
          params: expect.objectContaining({
            prefill: expect.stringContaining('that lift'),
          }),
        }),
      );
    });

    it('exposes an accessible button role and label', () => {
      const { getByTestId } = render(
        <AskCoachCTA
          exerciseName="Squat"
          repCount={3}
          averageFqi={60}
          topFault="Hips rising"
        />,
      );

      const button = getByTestId('ask-coach-cta');
      expect(button.props.accessibilityRole).toBe('button');
      expect(button.props.accessibilityLabel).toBe('Ask coach about this session');
    });
  });
});
