import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';

import { FormQualityRecoveryCard } from '@/components/form-tracking/FormQualityRecoveryCard';
import type { DrillPrescription } from '@/lib/services/form-quality-recovery';

const PRESCRIPTION: DrillPrescription = {
  drill: {
    id: 'tempo-squat-320',
    title: 'Tempo squat — 3s down, 2s pause, 0 up',
    category: 'technique',
    durationSec: 180,
    steps: ['Empty bar.', 'Descend 3 seconds.', 'Pause 2 seconds.'],
    why: 'Slower descent trains depth awareness and kills the rush past parallel.',
    targetFaults: ['shallow_depth'],
  },
  reason: '3 reps with moderate Shallow Depth — technique work.',
  priority: 1,
  targetFaults: [
    { faultCode: 'shallow_depth', count: 3, maxSeverity: 2, faultDisplayName: 'Shallow Depth' },
  ],
};

describe('FormQualityRecoveryCard', () => {
  it('renders priority, title, category, duration, reason', () => {
    const { getByTestId, getByText } = render(<FormQualityRecoveryCard prescription={PRESCRIPTION} />);
    expect(getByTestId('drill-priority-tempo-squat-320')).toBeTruthy();
    expect(getByText(PRESCRIPTION.drill.title)).toBeTruthy();
    expect(getByText('technique')).toBeTruthy();
    expect(getByText('3min')).toBeTruthy();
    expect(getByText(PRESCRIPTION.reason)).toBeTruthy();
  });

  it('formats short durations in seconds', () => {
    const short: DrillPrescription = {
      ...PRESCRIPTION,
      drill: { ...PRESCRIPTION.drill, durationSec: 45 },
    };
    const { getByText } = render(<FormQualityRecoveryCard prescription={short} />);
    expect(getByText('45s')).toBeTruthy();
  });

  it('formats mixed m+s durations correctly', () => {
    const mixed: DrillPrescription = {
      ...PRESCRIPTION,
      drill: { ...PRESCRIPTION.drill, durationSec: 95 },
    };
    const { getByText } = render(<FormQualityRecoveryCard prescription={mixed} />);
    expect(getByText('1m 35s')).toBeTruthy();
  });

  it('keeps details collapsed by default and expands on toggle', () => {
    const { queryByTestId, getByTestId } = render(<FormQualityRecoveryCard prescription={PRESCRIPTION} />);
    expect(queryByTestId('drill-body-tempo-squat-320')).toBeNull();
    fireEvent.press(getByTestId('drill-toggle-tempo-squat-320'));
    expect(getByTestId('drill-body-tempo-squat-320')).toBeTruthy();
  });

  it('renders all drill steps when expanded', () => {
    const { getByTestId, getByText } = render(<FormQualityRecoveryCard prescription={PRESCRIPTION} />);
    fireEvent.press(getByTestId('drill-toggle-tempo-squat-320'));
    for (const step of PRESCRIPTION.drill.steps) {
      expect(getByText(step)).toBeTruthy();
    }
  });

  it('invokes onRequestExplanation when Ask coach tapped', () => {
    const onRequestExplanation = jest.fn();
    const { getByTestId } = render(
      <FormQualityRecoveryCard prescription={PRESCRIPTION} onRequestExplanation={onRequestExplanation} />
    );
    fireEvent.press(getByTestId('drill-toggle-tempo-squat-320'));
    fireEvent.press(getByTestId('drill-explain-tempo-squat-320'));
    expect(onRequestExplanation).toHaveBeenCalledTimes(1);
    expect(onRequestExplanation).toHaveBeenCalledWith(PRESCRIPTION.drill);
  });

  it('shows a spinner while the explanation is loading', () => {
    const { getByTestId, queryByText } = render(
      <FormQualityRecoveryCard
        prescription={PRESCRIPTION}
        explanation={{ isLoading: true }}
        onRequestExplanation={() => {}}
      />
    );
    fireEvent.press(getByTestId('drill-toggle-tempo-squat-320'));
    // The explain button shows spinner, not label text
    expect(queryByText('Ask coach why')).toBeNull();
  });

  it('renders coach explanation body when provided', () => {
    const { getByTestId, getByText } = render(
      <FormQualityRecoveryCard
        prescription={PRESCRIPTION}
        explanation={{ isLoading: false, text: 'Deep work fixes shallow reps.' }}
        onRequestExplanation={() => {}}
      />
    );
    fireEvent.press(getByTestId('drill-toggle-tempo-squat-320'));
    expect(getByTestId('drill-explanation-tempo-squat-320')).toBeTruthy();
    expect(getByText('Deep work fixes shallow reps.')).toBeTruthy();
  });

  it('renders error message when explanation failed without text', () => {
    const { getByTestId, getByText } = render(
      <FormQualityRecoveryCard
        prescription={PRESCRIPTION}
        explanation={{ isLoading: false, error: 'Coach offline' }}
        onRequestExplanation={() => {}}
      />
    );
    fireEvent.press(getByTestId('drill-toggle-tempo-squat-320'));
    expect(getByTestId('drill-explanation-error-tempo-squat-320')).toBeTruthy();
    expect(getByText('Coach offline')).toBeTruthy();
  });

  it('invokes onMarkDone when the button is tapped', () => {
    const onMarkDone = jest.fn();
    const { getByTestId } = render(
      <FormQualityRecoveryCard prescription={PRESCRIPTION} onMarkDone={onMarkDone} />
    );
    fireEvent.press(getByTestId('drill-mark-done-tempo-squat-320'));
    expect(onMarkDone).toHaveBeenCalledWith('tempo-squat-320');
  });

  it('hides mark-done button and shows done icon when isDone', () => {
    const { queryByTestId, getByTestId } = render(
      <FormQualityRecoveryCard prescription={PRESCRIPTION} onMarkDone={() => {}} isDone />
    );
    expect(queryByTestId('drill-mark-done-tempo-squat-320')).toBeNull();
    expect(getByTestId('drill-done-tempo-squat-320')).toBeTruthy();
  });

  it('honors testID override on the outer container', () => {
    const { getByTestId } = render(
      <FormQualityRecoveryCard prescription={PRESCRIPTION} testID="custom-id" />
    );
    expect(getByTestId('custom-id')).toBeTruthy();
  });

  it('shows "Finding a drill for you…" caption when isFetchingDrill is true', () => {
    const { getByTestId, queryByText, getByText } = render(
      <FormQualityRecoveryCard prescription={PRESCRIPTION} isFetchingDrill />,
    );
    expect(getByTestId('drill-fetching-tempo-squat-320')).toBeTruthy();
    expect(getByText('Finding a drill for you…')).toBeTruthy();
    // Static reason copy is swapped out while the fetch is in flight.
    expect(queryByText(PRESCRIPTION.reason)).toBeNull();
  });

  it('restores the reason copy when isFetchingDrill flips back to false', () => {
    const { getByText, rerender, queryByTestId } = render(
      <FormQualityRecoveryCard prescription={PRESCRIPTION} isFetchingDrill />,
    );
    rerender(<FormQualityRecoveryCard prescription={PRESCRIPTION} isFetchingDrill={false} />);
    expect(queryByTestId('drill-fetching-tempo-squat-320')).toBeNull();
    expect(getByText(PRESCRIPTION.reason)).toBeTruthy();
  });
});
