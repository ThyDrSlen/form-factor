import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import type { FaultDefinition } from '@/lib/types/workout-definitions';

const mockMarkViewed = jest.fn();
const mockMarkStarted = jest.fn();
const mockMarkDismissed = jest.fn();

jest.mock('@/lib/services/drill-tracker', () => ({
  drillTracker: {
    markViewed: (...args: unknown[]) => mockMarkViewed(...args),
    markStarted: (...args: unknown[]) => mockMarkStarted(...args),
    markDismissed: (...args: unknown[]) => mockMarkDismissed(...args),
    markCompleted: jest.fn(),
  },
  logDrillEvent: jest.fn(),
}));

import { DrillSheet } from '@/components/form-tracking/DrillSheet';

const sampleFault: FaultDefinition = {
  id: 'shoulder_elevation',
  displayName: 'Elevated Shoulders',
  condition: () => true,
  severity: 2,
  dynamicCue: 'Draw shoulders down.',
  fqiPenalty: 12,
  drills: [
    {
      id: 'drill-a',
      title: 'Scap Pulls',
      durationSec: 60,
      reps: 10,
      steps: ['Hang', 'Pack scapulae', 'Release'],
    },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('DrillSheet', () => {
  it('renders nothing when fault is null', () => {
    const { queryByTestId } = render(
      <DrillSheet
        visible
        fault={null}
        exerciseId="pullup"
        sessionId="sess-1"
        onDismiss={jest.fn()}
      />,
    );
    expect(queryByTestId('drill-sheet')).toBeNull();
  });

  it('renders the fault heading and drill card', () => {
    const { getByText, getByTestId } = render(
      <DrillSheet
        visible
        fault={sampleFault}
        exerciseId="pullup"
        sessionId="sess-1"
        onDismiss={jest.fn()}
      />,
    );
    expect(getByText('Fix: Elevated Shoulders')).toBeTruthy();
    expect(getByText('Scap Pulls')).toBeTruthy();
    expect(getByTestId('drill-sheet-drill-0-start')).toBeTruthy();
  });

  it('logs drill view on open', () => {
    render(
      <DrillSheet
        visible
        fault={sampleFault}
        exerciseId="pullup"
        sessionId="sess-1"
        onDismiss={jest.fn()}
      />,
    );
    expect(mockMarkViewed).toHaveBeenCalledWith(
      expect.objectContaining({ drillId: 'drill-a', faultId: 'shoulder_elevation' }),
    );
  });

  it('invokes onStartDrill + tracker when Start is tapped', () => {
    const onStart = jest.fn();
    const { getByTestId } = render(
      <DrillSheet
        visible
        fault={sampleFault}
        exerciseId="pullup"
        sessionId="sess-1"
        onDismiss={jest.fn()}
        onStartDrill={onStart}
      />,
    );
    fireEvent.press(getByTestId('drill-sheet-drill-0-start'));
    expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ id: 'drill-a' }));
    expect(mockMarkStarted).toHaveBeenCalled();
  });

  it('calls onDismiss + tracker when Close is tapped', () => {
    const onDismiss = jest.fn();
    const { getByTestId } = render(
      <DrillSheet
        visible
        fault={sampleFault}
        exerciseId="pullup"
        sessionId="sess-1"
        onDismiss={onDismiss}
      />,
    );
    fireEvent.press(getByTestId('drill-sheet-dismiss'));
    expect(onDismiss).toHaveBeenCalled();
    expect(mockMarkDismissed).toHaveBeenCalled();
  });

  it('shows empty state when fault has no drills', () => {
    const { getByText } = render(
      <DrillSheet
        visible
        fault={{ ...sampleFault, drills: [] }}
        exerciseId="pullup"
        sessionId="sess-1"
        onDismiss={jest.fn()}
      />,
    );
    expect(getByText('No drills available yet for this fault.')).toBeTruthy();
  });
});
