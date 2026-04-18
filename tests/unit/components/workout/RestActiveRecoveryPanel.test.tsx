import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import RestActiveRecoveryPanel from '@/components/workout/RestActiveRecoveryPanel';
import { buildBetweenSetsRecommendation } from '@/lib/services/between-sets-coach';

describe('RestActiveRecoveryPanel', () => {
  const rec = buildBetweenSetsRecommendation({
    setType: 'normal',
    setIndex: 1,
    totalSets: 4,
    restSeconds: 120,
    muscleGroup: 'chest',
    plannedReps: 8,
    actualReps: 8,
  });

  it('renders the empty state when there is no recommendation', () => {
    const { getByTestId } = render(<RestActiveRecoveryPanel recommendation={null} />);
    expect(getByTestId('rest-active-recovery-empty')).toBeTruthy();
  });

  it('renders the panel with a fatigue label and muscle group', () => {
    const { getByTestId } = render(<RestActiveRecoveryPanel recommendation={rec} />);
    expect(getByTestId('rest-active-recovery-panel')).toBeTruthy();
    expect(getByTestId('rest-fatigue-label')).toBeTruthy();
    expect(getByTestId('rest-muscle-group').props.children).toBe('chest');
  });

  it('renders a refresh button only when onRefresh is provided', () => {
    const { queryByTestId } = render(<RestActiveRecoveryPanel recommendation={rec} />);
    expect(queryByTestId('rest-recommendation-refresh')).toBeNull();
  });

  it('invokes onRefresh when the refresh button is pressed', () => {
    const onRefresh = jest.fn();
    const { getByTestId } = render(
      <RestActiveRecoveryPanel recommendation={rec} onRefresh={onRefresh} />,
    );
    fireEvent.press(getByTestId('rest-recommendation-refresh'));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('renders Fresh label for low fatigue score', () => {
    const low = { ...rec, fatigueScore: 0.1 };
    const { getByTestId } = render(<RestActiveRecoveryPanel recommendation={low} />);
    expect(getByTestId('rest-fatigue-label').props.children).toBe('Fresh');
  });

  it('renders Max label for saturated fatigue score', () => {
    const max = { ...rec, fatigueScore: 0.95 };
    const { getByTestId } = render(<RestActiveRecoveryPanel recommendation={max} />);
    expect(getByTestId('rest-fatigue-label').props.children).toBe('Max');
  });

  it('does not render the muscle badge when muscle group is null', () => {
    const noMuscle = { ...rec, context: { ...rec.context, muscleGroup: null } };
    const { queryByTestId } = render(<RestActiveRecoveryPanel recommendation={noMuscle} />);
    expect(queryByTestId('rest-muscle-group')).toBeNull();
  });

  it('renders a breathing cue card, mobility card, and reflection card together', () => {
    const { getByTestId } = render(<RestActiveRecoveryPanel recommendation={rec} />);
    expect(getByTestId('breathing-cue-card')).toBeTruthy();
    expect(getByTestId('mobility-drill-card')).toBeTruthy();
    expect(getByTestId('reflection-prompt-card')).toBeTruthy();
  });
});
