import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
const mockAdd = jest.fn().mockResolvedValue(undefined);
let mockUnit: 'kg' | 'lbs' = 'kg';
jest.mock('@/features/workouts/contexts/WorkoutsContext', () => ({ useWorkouts: () => ({ addWorkout: mockAdd }) }));
jest.mock('@/contexts/UnitsContext', () => ({ useUnits: () => ({ weightUnit: mockUnit }) }));
jest.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ show: jest.fn() }) }));
jest.mock('@/hooks/use-safe-back', () => ({ useSafeBack: () => jest.fn() }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: require('react-native').View }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'quick-id' }));
jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn() }));
import AddWorkoutScreen from '@/app/(modals)/add-workout';

beforeEach(() => { mockUnit = 'kg'; mockAdd.mockClear(); });

// Characterization: pounds-origin drafts must not be converted on save.
it('saves precise pounds after toggles and rejected edits in the new unit', async () => {
  mockUnit = 'lbs';
  const screen = render(<AddWorkoutScreen />);
  fireEvent(screen.getByLabelText('Weight (lbs)'), 'focus');
  fireEvent.changeText(screen.getByLabelText('Weight (lbs)'), '45,19471');
  for (const unit of ['kg', 'lbs', 'kg'] as const) {
    mockUnit = unit;
    screen.rerender(<AddWorkoutScreen />);
  }
  const input = screen.getByLabelText('Weight (kg)');
  expect(input.props.value).toBe('20.5');
  for (const invalid of ['-5', 'NaN', '1.2.3']) fireEvent.changeText(input, invalid);
  expect(input.props.value).toBe('20.5');
  fireEvent(input, 'blur');
  expect(mockAdd).not.toHaveBeenCalled();
  await act(async () => { fireEvent.press(screen.getByText('Save Workout')); });
  expect(mockAdd).toHaveBeenCalledTimes(1);
  expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({ weight: 45.19471 }));
});
it('saves kg input as pounds even when the preference changes before save', async () => {
  const screen = render(<AddWorkoutScreen />);
  fireEvent.changeText(screen.getByLabelText('Weight (kg)'), '100');
  mockUnit = 'lbs';
  screen.rerender(<AddWorkoutScreen />);
  expect(screen.getByLabelText('Weight (lbs)').props.value).toBe('220.46');
  await act(async () => fireEvent.press(screen.getByText('Save Workout')));
  expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({ weight: 220.462 }));
});
it('retains full kg precision through repeated unit changes before saving', async () => {
  const screen = render(<AddWorkoutScreen />);
  fireEvent(screen.getByLabelText('Weight (kg)'), 'focus');
  fireEvent.changeText(screen.getByLabelText('Weight (kg)'), '20,55555');
  for (const unit of ['lbs', 'kg', 'lbs', 'kg'] as const) {
    mockUnit = unit;
    screen.rerender(<AddWorkoutScreen />);
  }
  expect(screen.getByLabelText('Weight (kg)').props.value).toBe('20.56');
  expect(mockAdd).not.toHaveBeenCalled();
  await act(async () => fireEvent.press(screen.getByText('Save Workout')));
  expect(mockAdd).toHaveBeenCalledTimes(1);
  expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({ weight: 20.55555 * 2.20462 }));
});

it.each(['untouched', 'cleared'])('saves %s weight as unspecified, not zero', async (scenario) => {
  const screen = render(<AddWorkoutScreen />);
  if (scenario === 'cleared') {
    fireEvent.changeText(screen.getByLabelText('Weight (kg)'), '12.5');
    fireEvent.changeText(screen.getByLabelText('Weight (kg)'), '');
  }
  mockUnit = 'lbs';
  screen.rerender(<AddWorkoutScreen />);
  expect(screen.getByLabelText('Weight (lbs)').props.value).toBe('');
  expect(mockAdd).not.toHaveBeenCalled();
  await act(async () => fireEvent.press(screen.getByText('Save Workout')));
  expect(mockAdd).toHaveBeenCalledTimes(1);
  expect(mockAdd.mock.calls[0][0].weight).toBeUndefined();
});

it('persists explicit zero rather than dropping it', async () => {
  const screen = render(<AddWorkoutScreen />);
  fireEvent.changeText(screen.getByLabelText('Weight (kg)'), '0');
  await act(async () => fireEvent.press(screen.getByText('Save Workout')));
  expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({ weight: 0 }));
});
