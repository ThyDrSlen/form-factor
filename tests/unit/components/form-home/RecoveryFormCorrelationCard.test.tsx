import React from 'react';
import { render } from '@testing-library/react-native';
import { RecoveryFormCorrelationCard } from '@/components/form-home/RecoveryFormCorrelationCard';
import type { RecoveryFormCorrelation } from '@/lib/services/form-recovery-correlator';

function mkMetric(significance: 'low' | 'medium' | 'high', r = 0.5) {
  return {
    r,
    slope: 0.5,
    r2: r * r,
    sampleCount: 12,
    significance,
  };
}

describe('RecoveryFormCorrelationCard', () => {
  it('renders loading state', () => {
    const { getByTestId } = render(
      <RecoveryFormCorrelationCard data={null} loading />,
    );
    expect(getByTestId('recovery-correlation-loading')).toBeTruthy();
  });

  it('renders empty state when data is null', () => {
    const { getByTestId } = render(<RecoveryFormCorrelationCard data={null} />);
    expect(getByTestId('recovery-correlation-empty')).toBeTruthy();
  });

  it('renders empty state when sampleCount is 0', () => {
    const data: RecoveryFormCorrelation = {
      sleepVsFqi: mkMetric('low', 0),
      hrvVsFqi: mkMetric('low', 0),
      restingHrVsFqi: mkMetric('low', 0),
      insights: [],
      sampleCount: 0,
    };
    const { getByTestId } = render(
      <RecoveryFormCorrelationCard data={data} />,
    );
    expect(getByTestId('recovery-correlation-empty')).toBeTruthy();
  });

  it('renders mini bars for each insight when populated', () => {
    const data: RecoveryFormCorrelation = {
      sleepVsFqi: mkMetric('high', 0.72),
      hrvVsFqi: mkMetric('medium', 0.42),
      restingHrVsFqi: mkMetric('low', -0.12),
      insights: [
        {
          id: 'sleep_hours',
          title: 'Sleep × form',
          description: 'more sleep -> more FQI',
          metric: mkMetric('high', 0.72),
        },
        {
          id: 'hrv',
          title: 'HRV × form',
          description: 'HRV helps',
          metric: mkMetric('medium', 0.42),
        },
        {
          id: 'resting_hr',
          title: 'Resting HR × form',
          description: 'RHR hints',
          metric: mkMetric('low', -0.12),
        },
      ],
      sampleCount: 14,
    };
    const { getByTestId, getByText } = render(
      <RecoveryFormCorrelationCard data={data} />,
    );
    expect(getByTestId('recovery-correlation-card')).toBeTruthy();
    // Top insight should be the high-significance sleep one.
    expect(getByText('Sleep × form')).toBeTruthy();
    expect(getByTestId('recovery-correlation-bar-sleep_hours')).toBeTruthy();
    expect(getByTestId('recovery-correlation-bar-hrv')).toBeTruthy();
    expect(getByTestId('recovery-correlation-bar-resting_hr')).toBeTruthy();
  });
});
