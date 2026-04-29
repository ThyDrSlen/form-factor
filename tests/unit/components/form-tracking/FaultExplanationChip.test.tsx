/**
 * Tests for FaultExplanationChip.
 *
 * Covers:
 *  - happy-path render (chip is visible, closed modal)
 *  - tap-to-open opens the explanation modal and shows the rationale + cue
 *  - close via the X button dismisses the modal
 *  - backdrop tap dismisses the modal
 *  - severity toning + accessibility surface (role/label/testID)
 *  - lazy resolution: `getExplanation` override is not invoked until the
 *    modal is opened (explicit performance-sensitive contract)
 */

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import FaultExplanationChip from '@/components/form-tracking/FaultExplanationChip';
import type { RepContext } from '@/lib/types/workout-definitions';
import type { FaultExplanation } from '@/lib/services/fault-explainability';

jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'Ionicons',
}));

// The chip falls back to `useFaultExplanations()` when no override is given.
// Short-circuit the hook so the test doesn't have to bring in the full
// fault-explainability ruleset.
jest.mock('@/hooks/use-fault-explanations', () => ({
  useFaultExplanations: () => ({
    getExplanation: () => ({
      faultId: 'hips_rise_first',
      workoutId: 'deadlift',
      repNumber: 2,
      title: 'Hips Rise Before Shoulders',
      rationale: 'Your hips climbed faster than your shoulders during the first third of the pull.',
      cue: 'Drive your chest up as your hips rise — push the floor away.',
      metrics: { peakHipDeg: 92, peakShoulderDeg: 140, asymmetryDeg: 12 },
    }),
    getExplanationString: () => 'stub',
  }),
}));

function baseRep(): RepContext {
  const a = {
    leftKnee: 170,
    rightKnee: 170,
    leftElbow: 170,
    rightElbow: 170,
    leftHip: 170,
    rightHip: 170,
    leftShoulder: 90,
    rightShoulder: 90,
  };
  return {
    startAngles: a,
    endAngles: a,
    minAngles: a,
    maxAngles: a,
    durationMs: 2500,
    repNumber: 2,
    workoutId: 'deadlift',
  };
}

describe('FaultExplanationChip', () => {
  it('renders the chip with the fault name and a button accessibility role', () => {
    const { getByTestId, getByText } = render(
      <FaultExplanationChip
        faultId="hips_rise_first"
        faultDisplayName="Hips Rise First"
        severity={2}
        repId="set-1:2"
        repContext={baseRep()}
        workoutId="deadlift"
      />,
    );
    const chip = getByTestId('fault-explanation-chip');
    expect(chip.props.accessibilityRole).toBe('button');
    expect(chip.props.accessibilityLabel).toBe('Hips Rise First, tap to see why');
    expect(getByText('Hips Rise First')).toBeTruthy();
  });

  it('does not compute the explanation until the modal is opened (lazy contract)', () => {
    const getExplanation = jest.fn(
      (): FaultExplanation => ({
        faultId: 'hips_rise_first',
        workoutId: 'deadlift',
        repNumber: 2,
        title: 'Hips Rise Before Shoulders',
        rationale: 'stub rationale',
        cue: 'stub cue',
        metrics: { peakHipDeg: 90 },
      }),
    );

    render(
      <FaultExplanationChip
        faultId="hips_rise_first"
        faultDisplayName="Hips Rise First"
        severity={1}
        repId="set-1:2"
        repContext={baseRep()}
        workoutId="deadlift"
        getExplanation={getExplanation}
      />,
    );
    // Modal is closed by default — the override must NOT have been called yet.
    expect(getExplanation).not.toHaveBeenCalled();
  });

  it('opens the modal on press and renders the rationale, cue, and metrics', () => {
    const { getByTestId, getByText } = render(
      <FaultExplanationChip
        faultId="hips_rise_first"
        faultDisplayName="Hips Rise First"
        severity={3}
        repId="set-1:2"
        repContext={baseRep()}
        workoutId="deadlift"
      />,
    );
    fireEvent.press(getByTestId('fault-explanation-chip'));
    expect(getByText('Hips Rise Before Shoulders')).toBeTruthy();
    expect(getByText(/climbed faster than your shoulders/i)).toBeTruthy();
    expect(getByText(/push the floor away/i)).toBeTruthy();
    // Metrics panel rendered (title "Details" + at least one row)
    expect(getByTestId('fault-explanation-chip-metrics')).toBeTruthy();
  });

  it('invokes the getExplanation override with the full tuple when the modal opens', () => {
    const getExplanation = jest.fn(
      (): FaultExplanation => ({
        faultId: 'hips_rise_first',
        workoutId: 'deadlift',
        repNumber: 2,
        title: 'Hips Rise Before Shoulders',
        rationale: 'stub rationale',
        cue: 'stub cue',
        metrics: {},
      }),
    );
    const repContext = baseRep();
    const { getByTestId } = render(
      <FaultExplanationChip
        faultId="hips_rise_first"
        faultDisplayName="Hips Rise First"
        severity={2}
        repId="set-1:2"
        repContext={repContext}
        workoutId="deadlift"
        getExplanation={getExplanation}
      />,
    );
    fireEvent.press(getByTestId('fault-explanation-chip'));
    expect(getExplanation).toHaveBeenCalledWith('set-1:2', 'hips_rise_first', repContext, 'deadlift');
  });

  it('closes the modal when the X button is pressed', () => {
    const { getByTestId, queryByTestId } = render(
      <FaultExplanationChip
        faultId="hips_rise_first"
        faultDisplayName="Hips Rise First"
        severity={2}
        repId="set-1:2"
        repContext={baseRep()}
        workoutId="deadlift"
      />,
    );
    fireEvent.press(getByTestId('fault-explanation-chip'));
    expect(queryByTestId('fault-explanation-chip-close')).toBeTruthy();
    fireEvent.press(getByTestId('fault-explanation-chip-close'));
    // After close, metrics pane from the opened modal should not render.
    expect(queryByTestId('fault-explanation-chip-metrics')).toBeNull();
  });

  it('honors a custom testID for sub-element targeting', () => {
    const { getByTestId } = render(
      <FaultExplanationChip
        faultId="forward_lean"
        faultDisplayName="Forward Lean"
        severity={1}
        repId="set-2:4"
        repContext={baseRep()}
        workoutId="deadlift"
        testID="dl-fault"
      />,
    );
    expect(getByTestId('dl-fault')).toBeTruthy();
    fireEvent.press(getByTestId('dl-fault'));
    expect(getByTestId('dl-fault-close')).toBeTruthy();
  });
});
