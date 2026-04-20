import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { ExerciseSwapSheet } from '@/components/form-tracking/ExerciseSwapSheet';

describe('ExerciseSwapSheet', () => {
  it('shows the target name and both action buttons', () => {
    const { getByTestId, getByText } = render(
      <ExerciseSwapSheet
        visible
        targetExerciseName="Push-Up"
        currentExerciseName="Pull-Up"
        onDismiss={jest.fn()}
        onConfirm={jest.fn()}
      />,
    );
    expect(getByText('Swap to Push-Up')).toBeTruthy();
    expect(getByTestId('exercise-swap-sheet-add')).toBeTruthy();
    expect(getByTestId('exercise-swap-sheet-replace')).toBeTruthy();
  });

  it('calls onConfirm("append") when Add is pressed', () => {
    const onConfirm = jest.fn();
    const { getByTestId } = render(
      <ExerciseSwapSheet
        visible
        targetExerciseName="Squat"
        onDismiss={jest.fn()}
        onConfirm={onConfirm}
      />,
    );
    fireEvent.press(getByTestId('exercise-swap-sheet-add'));
    expect(onConfirm).toHaveBeenCalledWith('append');
  });

  it('calls onConfirm("replace") when Replace is pressed', () => {
    const onConfirm = jest.fn();
    const { getByTestId } = render(
      <ExerciseSwapSheet
        visible
        targetExerciseName="Deadlift"
        onDismiss={jest.fn()}
        onConfirm={onConfirm}
      />,
    );
    fireEvent.press(getByTestId('exercise-swap-sheet-replace'));
    expect(onConfirm).toHaveBeenCalledWith('replace');
  });

  it('calls onDismiss when cancel is tapped', () => {
    const onDismiss = jest.fn();
    const { getByTestId } = render(
      <ExerciseSwapSheet
        visible
        targetExerciseName="Bench"
        onDismiss={onDismiss}
        onConfirm={jest.fn()}
      />,
    );
    fireEvent.press(getByTestId('exercise-swap-sheet-cancel'));
    expect(onDismiss).toHaveBeenCalled();
  });
});
