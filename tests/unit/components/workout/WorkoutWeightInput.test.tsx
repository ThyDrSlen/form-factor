import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { WorkoutWeightInput } from '@/features/workouts/components/WorkoutWeightInput';
import { Button, Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { UnitsProvider, useUnits } from '@/contexts/UnitsContext';

// Characterization: exercise the real provider, not a rerendered unit prop.
describe('focused draft during persisted preference hydration', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each([
    { draft: '45.19471', pounds: 45.19471, kgText: '20.5', lbsText: '45.19' },
    { draft: '', pounds: null, kgText: '', lbsText: '' },
    { draft: '0', pounds: 0, kgText: '0', lbsText: '0' },
  ])('retains canonical $pounds through hydration and toggles', async ({ draft, pounds, kgText, lbsText }) => {
    let resolvePreference!: (unit: string) => void;
    const getItem = jest.spyOn(AsyncStorage, 'getItem').mockImplementationOnce(() =>
      new Promise<string>((resolve) => { resolvePreference = resolve; }));
    const setItem = jest.spyOn(AsyncStorage, 'setItem').mockResolvedValue(undefined);
    setItem.mockClear();
    const onChange = jest.fn();
    function Draft() {
      const { weightUnit, toggleWeightUnit } = useUnits();
      const [value, setValue] = React.useState<number | null>(100);
      return <>
        <WorkoutWeightInput value={value} unit={weightUnit} onChange={(next) => {
          onChange(next);
          setValue(next);
        }} />
        <Text testID="canonical-load">{JSON.stringify(value)}</Text>
        <Button title="Toggle units" onPress={toggleWeightUnit} />
      </>;
    }
    const screen = render(<UnitsProvider><Draft /></UnitsProvider>);
    expect(getItem).toHaveBeenCalledWith('@weight_unit');
    fireEvent(screen.getByLabelText('Weight (lbs)'), 'focus');
    fireEvent.changeText(screen.getByLabelText('Weight (lbs)'), draft);
    expect(screen.getByLabelText('Weight (lbs)').props.value).toBe(draft);

    await act(async () => { resolvePreference('kg'); });
    expect(screen.getByLabelText('Weight (kg)').props.value).toBe(kgText);
    expect(setItem).not.toHaveBeenCalled();
    for (const unit of ['lbs', 'kg', 'lbs', 'kg'] as const) {
      await act(async () => { fireEvent.press(screen.getByText('Toggle units')); });
      expect(screen.getByLabelText(`Weight (${unit})`).props.value).toBe(unit === 'kg' ? kgText : lbsText);
      expect(screen.getByTestId('canonical-load').props.children).toBe(JSON.stringify(pounds));
      expect(setItem).toHaveBeenLastCalledWith('@weight_unit', unit);
    }
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(pounds);
  });
});

it('edits kilograms while emitting pounds and preserves decimal input', () => {
  const onChange = jest.fn();
  const screen = render(<WorkoutWeightInput value={0} unit="kg" onChange={onChange} />);
  fireEvent.changeText(screen.getByLabelText('Weight (kg)'), '20.5');
  expect(onChange.mock.calls.at(-1)?.[0]).toBeCloseTo(45.19471, 5);
  expect(screen.getByLabelText('Weight (kg)').props.value).toBe('20.5');
});

it.each(['.', ','])('treats a lone %s as an unspecified decimal draft, not the previous load', (separator) => {
  const onChange = jest.fn();
  const screen = render(<WorkoutWeightInput value={25} unit="kg" onChange={onChange} />);
  fireEvent(screen.getByLabelText('Weight (kg)'), 'focus');
  fireEvent.changeText(screen.getByLabelText('Weight (kg)'), separator);
  expect(onChange).toHaveBeenLastCalledWith(null);
  screen.rerender(<WorkoutWeightInput value={null} unit="kg" onChange={onChange} />);
  expect(screen.getByLabelText('Weight (kg)').props.value).toBe(separator);
  fireEvent.changeText(screen.getByLabelText('Weight (kg)'), `${separator}5`);
  expect(onChange).toHaveBeenLastCalledWith(0.5 * 2.20462);
});

it('switches units while focused without writing rounded display values back', () => {
  const onChange = jest.fn();
  const screen = render(<WorkoutWeightInput value={220.462} unit="lbs" onChange={onChange} />);
  fireEvent(screen.getByLabelText('Weight (lbs)'), 'focus');
  screen.rerender(<WorkoutWeightInput value={220.462} unit="kg" onChange={onChange} />);
  expect(screen.getByLabelText('Weight (kg)').props.value).toBe('100');
  screen.rerender(<WorkoutWeightInput value={220.462} unit="lbs" onChange={onChange} />);
  expect(screen.getByLabelText('Weight (lbs)').props.value).toBe('220.46');
  expect(onChange).not.toHaveBeenCalled();
});

it('preserves a controlled draft through a delayed unit change and converts only subsequent edits', async () => {
  const onChange = jest.fn();
  function ControlledInput({ unit }: { unit: 'kg' | 'lbs' }) {
    const [pounds, setPounds] = React.useState<number | null>(null);
    return <WorkoutWeightInput value={pounds} unit={unit} onChange={(value) => {
      onChange(value);
      setPounds(value);
    }} />;
  }

  const screen = render(<ControlledInput unit="lbs" />);
  fireEvent(screen.getByLabelText('Weight (lbs)'), 'focus');
  fireEvent.changeText(screen.getByLabelText('Weight (lbs)'), '45.19471');
  expect(screen.getByLabelText('Weight (lbs)').props.value).toBe('45.19471');
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange).toHaveBeenLastCalledWith(45.19471);

  // Model a saved preference arriving after the focused draft has been edited.
  await act(async () => {
    await Promise.resolve();
    screen.rerender(<ControlledInput unit="kg" />);
  });
  expect(screen.getByLabelText('Weight (kg)').props.value).toBe('20.5');
  fireEvent(screen.getByLabelText('Weight (kg)'), 'blur');
  fireEvent(screen.getByLabelText('Weight (kg)'), 'focus');
  screen.rerender(<ControlledInput unit="lbs" />);
  expect(screen.getByLabelText('Weight (lbs)').props.value).toBe('45.19');
  screen.rerender(<ControlledInput unit="kg" />);
  expect(screen.getByLabelText('Weight (kg)').props.value).toBe('20.5');
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange).toHaveBeenLastCalledWith(45.19471);

  fireEvent.changeText(screen.getByLabelText('Weight (kg)'), '20.55555');
  expect(screen.getByLabelText('Weight (kg)').props.value).toBe('20.55555');
  expect(onChange).toHaveBeenCalledTimes(2);
  expect(onChange).toHaveBeenLastCalledWith(20.55555 * 2.20462);
});

it('distinguishes zero from unset, accepts decimal commas, and rejects invalid loads', () => {
  const onChange = jest.fn();
  const screen = render(<WorkoutWeightInput value={null} unit="lbs" onChange={onChange} />);
  const input = screen.getByLabelText('Weight (lbs)');
  fireEvent.changeText(input, '0');
  expect(onChange).toHaveBeenLastCalledWith(0);
  fireEvent.changeText(input, '');
  expect(onChange).toHaveBeenLastCalledWith(null);
  fireEvent.changeText(input, '12,5');
  expect(onChange).toHaveBeenLastCalledWith(12.5);
  onChange.mockClear();
  for (const text of ['-5', 'NaN', 'Infinity', '12x', '1.2.3']) fireEvent.changeText(input, text);
  expect(onChange).not.toHaveBeenCalled();
});
