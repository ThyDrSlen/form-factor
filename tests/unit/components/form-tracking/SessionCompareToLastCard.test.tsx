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
  it('renders the first-session placeholder when there is no prior session', () => {
    const { queryByTestId, getByTestId } = render(
      <SessionCompareToLastCard
        comparison={buildComparison({
          priorSessionId: null,
          priorSummary: null,
          overallTrend: 'baseline',
        })}
        exerciseName="Squat"
      />,
    );
    // The full compare card should not render — only the low-emphasis
    // placeholder card keyed by `-first-session`.
    expect(queryByTestId('session-compare-to-last-card')).toBeNull();
    expect(
      getByTestId('session-compare-to-last-card-first-session'),
    ).toBeTruthy();
  });

  it('renders null when comparison payload is entirely missing', () => {
    const { queryByTestId } = render(<SessionCompareToLastCard />);
    expect(queryByTestId('session-compare-to-last-card')).toBeNull();
    expect(queryByTestId('session-compare-to-last-card-first-session')).toBeNull();
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

  describe('loading state', () => {
    it('renders 3 skeleton cells when loading', () => {
      const { getByTestId } = render(<SessionCompareToLastCard loading />);
      expect(getByTestId('session-compare-to-last-card-loading')).toBeTruthy();
      expect(getByTestId('session-compare-to-last-card-skeleton-0')).toBeTruthy();
      expect(getByTestId('session-compare-to-last-card-skeleton-1')).toBeTruthy();
      expect(getByTestId('session-compare-to-last-card-skeleton-2')).toBeTruthy();
    });

    it('does not render delta values while loading', () => {
      const { queryByTestId } = render(
        <SessionCompareToLastCard loading comparison={buildComparison()} />,
      );
      expect(queryByTestId('session-compare-to-last-card-delta-reps-value')).toBeNull();
      expect(queryByTestId('session-compare-to-last-card')).toBeNull();
    });
  });

  describe('error state', () => {
    it('renders the error callout + accessible retry button', () => {
      const onRetry = jest.fn();
      const { getByTestId, getByText } = render(
        <SessionCompareToLastCard
          error={new Error('Network down')}
          onRetry={onRetry}
        />,
      );
      expect(getByTestId('session-compare-to-last-card-error')).toBeTruthy();
      expect(getByText("Couldn't load last session")).toBeTruthy();
      const retry = getByTestId('session-compare-to-last-card-retry');
      expect(retry.props.accessibilityRole).toBe('button');
      expect(retry.props.accessibilityLabel).toBe(
        'Retry loading last session comparison',
      );
    });

    it('invokes onRetry when the retry button is pressed', () => {
      const onRetry = jest.fn();
      const { getByTestId } = render(
        <SessionCompareToLastCard
          error={new Error('Network down')}
          onRetry={onRetry}
        />,
      );
      fireEvent.press(getByTestId('session-compare-to-last-card-retry'));
      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('renders the full card when error is cleared and comparison is available', () => {
      const onRetry = jest.fn();
      const { queryByTestId, rerender } = render(
        <SessionCompareToLastCard
          error={new Error('Network down')}
          onRetry={onRetry}
        />,
      );
      expect(queryByTestId('session-compare-to-last-card-error')).toBeTruthy();

      rerender(
        <SessionCompareToLastCard comparison={buildComparison()} onRetry={onRetry} />,
      );
      expect(queryByTestId('session-compare-to-last-card-error')).toBeNull();
      expect(queryByTestId('session-compare-to-last-card')).toBeTruthy();
    });

    it('falls back to null when error is set but no onRetry is given', () => {
      const { queryByTestId } = render(
        <SessionCompareToLastCard error={new Error('x')} />,
      );
      expect(queryByTestId('session-compare-to-last-card-error')).toBeNull();
    });
  });

  it('settles to the first-session placeholder when not loading, no error, no prior session', () => {
    const { queryByTestId, getByTestId } = render(
      <SessionCompareToLastCard
        comparison={buildComparison({
          priorSessionId: null,
          priorSummary: null,
          overallTrend: 'baseline',
        })}
      />,
    );
    // Neither the full card nor the loading/error variants render; only the
    // low-emphasis first-session placeholder is visible.
    expect(queryByTestId('session-compare-to-last-card')).toBeNull();
    expect(queryByTestId('session-compare-to-last-card-loading')).toBeNull();
    expect(queryByTestId('session-compare-to-last-card-error')).toBeNull();
    expect(getByTestId('session-compare-to-last-card-first-session')).toBeTruthy();
  });
});
