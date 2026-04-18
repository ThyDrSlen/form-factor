import React from 'react';
import { render } from '@testing-library/react-native';
import { SessionComparisonCard } from '@/components/form-journey/SessionComparisonCard';
import {
  buildSessionComparison,
  type ExerciseSessionSummary,
} from '@/lib/services/session-comparison-aggregator';

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

function summary(overrides: Partial<ExerciseSessionSummary> = {}): ExerciseSessionSummary {
  return {
    sessionId: 'sess_curr',
    exerciseId: 'squat',
    completedAt: '2026-04-17T12:00:00Z',
    repCount: 10,
    avgFqi: 80,
    avgRomDeg: 100,
    avgDepthRatio: 0.9,
    avgSymmetryDeg: 5,
    faultCounts: {},
    ...overrides,
  };
}

describe('<SessionComparisonCard />', () => {
  it('renders baseline copy when there is no prior session', () => {
    const comparison = buildSessionComparison(summary({ exerciseId: 'squat' }), null);
    const { getByTestId, getByText } = render(
      <SessionComparisonCard comparison={comparison} />,
    );
    expect(getByTestId('session-comparison-card')).toBeTruthy();
    expect(getByText(/baseline/i)).toBeTruthy();
  });

  it('renders metric deltas when prior session exists', () => {
    const comparison = buildSessionComparison(
      summary({ avgFqi: 85, avgRomDeg: 110, avgSymmetryDeg: 3 }),
      summary({ sessionId: 'sess_prev', avgFqi: 75, avgRomDeg: 100, avgSymmetryDeg: 6 }),
    );
    const { getByTestId } = render(
      <SessionComparisonCard comparison={comparison} />,
    );
    expect(getByTestId('metric-fqi-delta').props.children).toMatch(/\+10/);
    expect(getByTestId('metric-rom-delta').props.children).toMatch(/\+10/);
    expect(getByTestId('metric-symmetry-delta').props.children).toMatch(/\+3/);
  });

  it('shows new fault row when faults appeared this session', () => {
    const comparison = buildSessionComparison(
      summary({ faultCounts: { forward_lean: 2 } }),
      summary({ sessionId: 'sess_prev', faultCounts: {} }),
    );
    const { getByTestId } = render(
      <SessionComparisonCard comparison={comparison} />,
    );
    expect(getByTestId('new-faults')).toBeTruthy();
  });

  it('shows resolved fault row when faults disappeared', () => {
    const comparison = buildSessionComparison(
      summary({ faultCounts: {} }),
      summary({ sessionId: 'sess_prev', faultCounts: { shallow_depth: 2 } }),
    );
    const { getByTestId } = render(
      <SessionComparisonCard comparison={comparison} />,
    );
    expect(getByTestId('resolved-faults')).toBeTruthy();
  });
});
