import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { FormMesocycleCard } from '@/components/form-journey/FormMesocycleCard';
import type { MesocycleInsights } from '@/lib/services/form-mesocycle-aggregator';

function insights(overrides: Partial<MesocycleInsights> = {}): MesocycleInsights {
  return {
    referenceIso: '2026-04-17T00:00:00.000Z',
    weeks: [
      { weekStartIso: '2026-03-23', weekIndex: 0, avgFqi: 70, sessionsCount: 1, repsCount: 10, setsCount: 2 },
      { weekStartIso: '2026-03-30', weekIndex: 1, avgFqi: 75, sessionsCount: 2, repsCount: 20, setsCount: 4 },
      { weekStartIso: '2026-04-06', weekIndex: 2, avgFqi: 80, sessionsCount: 2, repsCount: 22, setsCount: 5 },
      { weekStartIso: '2026-04-13', weekIndex: 3, avgFqi: 82, sessionsCount: 3, repsCount: 28, setsCount: 6 },
    ],
    topFaults: [
      { fault: 'valgus', count: 9, share: 0.11 },
      { fault: 'hips_rise', count: 4, share: 0.05 },
    ],
    deload: { severity: 'none', fqiDelta: 2, faultDelta: -0.1, reason: null },
    isEmpty: false,
    ...overrides,
  };
}

describe('FormMesocycleCard', () => {
  it('renders a loading placeholder when loading and no data yet', () => {
    const { getByTestId } = render(<FormMesocycleCard insights={null} loading />);
    expect(getByTestId('form-mesocycle-card-loading')).toBeTruthy();
  });

  it('renders an empty state when there is no data', () => {
    const empty = insights({
      weeks: [
        { weekStartIso: '2026-03-23', weekIndex: 0, avgFqi: null, sessionsCount: 0, repsCount: 0, setsCount: 0 },
        { weekStartIso: '2026-03-30', weekIndex: 1, avgFqi: null, sessionsCount: 0, repsCount: 0, setsCount: 0 },
        { weekStartIso: '2026-04-06', weekIndex: 2, avgFqi: null, sessionsCount: 0, repsCount: 0, setsCount: 0 },
        { weekStartIso: '2026-04-13', weekIndex: 3, avgFqi: null, sessionsCount: 0, repsCount: 0, setsCount: 0 },
      ],
      topFaults: [],
      isEmpty: true,
    });
    const { getByTestId } = render(<FormMesocycleCard insights={empty} />);
    expect(getByTestId('form-mesocycle-card-empty')).toBeTruthy();
  });

  it('renders the latest FQI + sparkline + top faults when data is present', () => {
    const { getByTestId, getAllByText } = render(
      <FormMesocycleCard insights={insights()} />,
    );
    expect(getByTestId('form-mesocycle-current-fqi').children.join('')).toBe('82');
    expect(getByTestId('form-mesocycle-sparkline').props.children.length).toBe(4);
    expect(getAllByText(/Valgus/).length).toBeGreaterThan(0);
  });

  it('shows a deload banner when severity is deload', () => {
    const data = insights({
      deload: {
        severity: 'deload',
        fqiDelta: -12,
        faultDelta: 0.8,
        reason: 'Last week your form quality slipped and fault rate rose — consider a lighter week.',
      },
    });
    const { getByTestId, getByText } = render(<FormMesocycleCard insights={data} />);
    expect(getByTestId('form-mesocycle-deload')).toBeTruthy();
    expect(getByText(/lighter week/)).toBeTruthy();
  });

  it('fires onPress when the card is tapped', () => {
    const onPress = jest.fn();
    const { getByTestId } = render(
      <FormMesocycleCard insights={insights()} onPress={onPress} />,
    );
    fireEvent.press(getByTestId('form-mesocycle-card'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('renders and fires the Ask-coach CTA when a handler is provided', () => {
    const onAskCoach = jest.fn();
    const { getByTestId } = render(
      <FormMesocycleCard insights={insights()} onAskCoach={onAskCoach} />,
    );
    fireEvent.press(getByTestId('form-mesocycle-ask-coach'));
    expect(onAskCoach).toHaveBeenCalledTimes(1);
  });

  it('hides the Ask-coach CTA when no handler is provided', () => {
    const { queryByTestId } = render(<FormMesocycleCard insights={insights()} />);
    expect(queryByTestId('form-mesocycle-ask-coach')).toBeNull();
  });
});
