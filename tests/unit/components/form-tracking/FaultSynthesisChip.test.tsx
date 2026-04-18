import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { FaultSynthesisChip } from '@/components/form-tracking/FaultSynthesisChip';
import {
  setFaultExplainerRunner,
  __resetFaultExplainerForTests,
  type FaultExplainer,
} from '@/lib/services/fault-explainer';

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

describe('<FaultSynthesisChip />', () => {
  beforeEach(() => {
    __resetFaultExplainerForTests();
  });

  it('renders nothing when fewer than two faults fire', async () => {
    const { queryByTestId } = render(
      <FaultSynthesisChip exerciseId="squat" faultIds={['shallow_depth']} />,
    );
    await waitFor(() => {
      expect(queryByTestId('fault-synthesis-chip')).toBeNull();
    });
  });

  it('renders the synthesized explanation when confidence is above the gate', async () => {
    const fake: FaultExplainer = {
      async synthesize() {
        return {
          synthesizedExplanation: 'Three related faults — try ankle mobility.',
          primaryFaultId: 'shallow_depth',
          rootCauseHypothesis: 'ankle mobility',
          confidence: 0.8,
          source: 'gemma-local',
        };
      },
    };
    setFaultExplainerRunner(fake);

    const { findByText, findByTestId } = render(
      <FaultSynthesisChip
        exerciseId="squat"
        faultIds={['shallow_depth', 'forward_lean']}
      />,
    );
    expect(await findByTestId('fault-synthesis-chip')).toBeTruthy();
    expect(
      await findByText('Three related faults — try ankle mobility.'),
    ).toBeTruthy();
    expect(await findByText(/Likely root cause:/i)).toBeTruthy();
  });

  it('stays hidden when confidence is below the gate', async () => {
    const low: FaultExplainer = {
      async synthesize() {
        return {
          synthesizedExplanation: 'low-confidence guess',
          primaryFaultId: 'shallow_depth',
          rootCauseHypothesis: null,
          confidence: 0.1,
          source: 'static-fallback',
        };
      },
    };
    setFaultExplainerRunner(low);

    const { queryByTestId } = render(
      <FaultSynthesisChip
        exerciseId="squat"
        faultIds={['shallow_depth', 'forward_lean']}
      />,
    );
    await waitFor(() => {
      expect(queryByTestId('fault-synthesis-chip')).toBeNull();
    });
  });

  it('invokes onPress with the primary fault id', async () => {
    const fake: FaultExplainer = {
      async synthesize() {
        return {
          synthesizedExplanation: 'synthesized',
          primaryFaultId: 'shallow_depth',
          rootCauseHypothesis: null,
          confidence: 0.9,
          source: 'gemma-local',
        };
      },
    };
    setFaultExplainerRunner(fake);

    const onPress = jest.fn();
    const { findByTestId } = render(
      <FaultSynthesisChip
        exerciseId="squat"
        faultIds={['shallow_depth', 'forward_lean']}
        onPress={onPress}
      />,
    );
    const button = await findByTestId('fault-synthesis-chip-button');
    fireEvent.press(button);
    expect(onPress).toHaveBeenCalledWith('shallow_depth');
  });
});
