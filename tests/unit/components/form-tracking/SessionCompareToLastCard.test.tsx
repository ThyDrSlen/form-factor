import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { SessionCompareToLastCard } from '@/components/form-tracking/SessionCompareToLastCard';
import type {
  ExerciseSessionSummary,
  SessionComparison,
} from '@/lib/services/session-comparison-aggregator';

const baseSummary: ExerciseSessionSummary = {
  sessionId: 'curr',
  exerciseId: 'pullup',
  completedAt: '2026-04-21T12:00:00.000Z',
  repCount: 10,
  avgFqi: 82,
  avgRomDeg: 100,
  avgDepthRatio: 0.9,
  avgSymmetryDeg: 4,
  avgRestSec: 45,
  faultCounts: {},
};

function buildComparison(overrides: Partial<SessionComparison> = {}): SessionComparison {
  return {
    currentSessionId: 'curr',
    priorSessionId: 'prev',
    currentSummary: baseSummary,
    priorSummary: { ...baseSummary, sessionId: 'prev' },
    fqiDelta: 7,
    romDeltaDeg: 3,
    depthDeltaRatio: 0.05,
    symmetryDeltaDeg: -1,
    repCountDelta: 2,
    restDeltaSec: -5,
    faultCountDelta: -1,
    newFaults: [],
    resolvedFaults: [],
    overallTrend: 'improving',
    ...overrides,
  };
}

describe('SessionCompareToLastCard', () => {
  it('renders null when there is no prior session', () => {
    const { queryByTestId } = render(
      <SessionCompareToLastCard
        comparison={buildComparison({
          priorSessionId: null,
          priorSummary: null,
          overallTrend: 'baseline',
        })}
      />,
    );
    expect(queryByTestId('session-compare-to-last-card')).toBeNull();
  });

  it('renders all three delta cells with signed values', () => {
    const { getByTestId } = render(
      <SessionCompareToLastCard comparison={buildComparison()} />,
    );
    expect(getByTestId('session-compare-to-last-card-delta-reps-value').props.children).toBe(
      '+2',
    );
    expect(getByTestId('session-compare-to-last-card-delta-fqi-value').props.children).toBe(
      '+7',
    );
    expect(getByTestId('session-compare-to-last-card-delta-rest-value').props.children).toBe(
      '-5',
    );
  });

  it('uses positive tone (green) when FQI improved', () => {
    const { getByTestId } = render(
      <SessionCompareToLastCard comparison={buildComparison({ fqiDelta: 8 })} />,
    );
    const fqi = getByTestId('session-compare-to-last-card-delta-fqi-value');
    const flat = Array.isArray(fqi.props.style)
      ? Object.assign({}, ...fqi.props.style.filter(Boolean))
      : fqi.props.style;
    expect(flat.color).toBe('#3CC8A9');
  });

  it('uses negative tone (red) when reps regress', () => {
    const { getByTestId } = render(
      <SessionCompareToLastCard comparison={buildComparison({ repCountDelta: -3 })} />,
    );
    const reps = getByTestId('session-compare-to-last-card-delta-reps-value');
    const flat = Array.isArray(reps.props.style)
      ? Object.assign({}, ...reps.props.style.filter(Boolean))
      : reps.props.style;
    expect(flat.color).toBe('#EF4444');
  });

  it('renders zero deltas as ±0 in neutral tone', () => {
    const { getByTestId } = render(
      <SessionCompareToLastCard
        comparison={buildComparison({ repCountDelta: 0, fqiDelta: 0, restDeltaSec: 0 })}
      />,
    );
    expect(
      getByTestId('session-compare-to-last-card-delta-reps-value').props.children,
    ).toBe('±0');
    const reps = getByTestId('session-compare-to-last-card-delta-reps-value');
    const flat = Array.isArray(reps.props.style)
      ? Object.assign({}, ...reps.props.style.filter(Boolean))
      : reps.props.style;
    expect(flat.color).toBe('#9AACD1');
  });

  it('falls back to "—" when a delta is null', () => {
    const { getByTestId } = render(
      <SessionCompareToLastCard
        comparison={buildComparison({ fqiDelta: null, restDeltaSec: null })}
      />,
    );
    expect(
      getByTestId('session-compare-to-last-card-delta-fqi-value').props.children,
    ).toBe('—');
    expect(
      getByTestId('session-compare-to-last-card-delta-rest-value').props.children,
    ).toBe('—');
  });

  it('fires onPress and exposes button role when pressable', () => {
    const onPress = jest.fn();
    const { getByTestId } = render(
      <SessionCompareToLastCard comparison={buildComparison()} onPress={onPress} />,
    );
    fireEvent.press(getByTestId('session-compare-to-last-card-pressable'));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(
      getByTestId('session-compare-to-last-card-pressable').props.accessibilityRole,
    ).toBe('button');
  });
});
