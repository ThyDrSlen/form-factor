import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
let mockUnit: 'kg' | 'lbs' = 'kg';
jest.mock('@/contexts/UnitsContext', () => ({ useUnits: () => ({ weightUnit: mockUnit }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
import SetRow from '@/features/workouts/components/SetRow';

beforeEach(() => { mockUnit = 'kg'; });

// Characterization of controlled actual-load feedback with a nonzero plan.
it.each([
  { draft: '0', pounds: 0, kgText: '0', lbsText: '0' },
  { draft: '20,55555', pounds: 20.55555 * 2.20462, kgText: '20.56', lbsText: '45.32' },
])('keeps actual $pounds across focused toggles without additional set writes', ({ draft, pounds, kgText, lbsText }) => {
  const update = jest.fn();
  function ControlledRow() {
    const [set, setSet] = React.useState({
      id: 's1', set_type: 'normal', planned_weight: 220.462, actual_weight: null,
    } as React.ComponentProps<typeof SetRow>['set']);
    return <SetRow set={set} index={0} isTimed={false} onUpdateSet={(id, fields) => {
      update(id, fields);
      setSet((current) => ({ ...current, ...fields }));
    }} onCompleteSet={jest.fn()} onMenuPress={jest.fn()} />;
  }
  const screen = render(<ControlledRow />);
  fireEvent(screen.getByLabelText('Weight (kg)'), 'focus');
  fireEvent.changeText(screen.getByLabelText('Weight (kg)'), draft);
  for (const unit of ['lbs', 'kg', 'lbs', 'kg'] as const) {
    mockUnit = unit;
    screen.rerender(<ControlledRow />);
    expect(screen.getByLabelText(`Weight (${unit})`).props.value).toBe(unit === 'kg' ? kgText : lbsText);
  }
  expect(update).toHaveBeenCalledTimes(1);
  expect(update).toHaveBeenLastCalledWith('s1', { actual_weight: pounds });
});

it('hydrates actual pounds and changes units without updating the set', () => {
  const update = jest.fn();
  const set = { id: 's1', set_type: 'normal', planned_weight: 220.462, actual_weight: null } as any;
  const props = { set, index: 0, isTimed: false, onUpdateSet: update, onCompleteSet: jest.fn(), onMenuPress: jest.fn() };
  const screen = render(<SetRow {...props} />);
  screen.rerender(<SetRow {...props} set={{ ...set, actual_weight: 20.55555 * 2.20462 }} />);
  expect(screen.getByLabelText('Weight (kg)').props.value).toBe('20.56');
  mockUnit = 'lbs';
  screen.rerender(<SetRow {...props} set={{ ...set, actual_weight: 0 }} />);
  expect(screen.getByLabelText('Weight (lbs)').props.value).toBe('0');
  expect(update).not.toHaveBeenCalled();
});

it.each([
  ['', null],
  ['0', 0],
  ['20,55555', 20.55555 * 2.20462],
] as const)('writes %s as an actual load without substituting the planned load', (text, pounds) => {
  const update = jest.fn();
  const set = { id: 's1', set_type: 'normal', planned_weight: 220.462, actual_weight: null } as any;
  const screen = render(<SetRow set={set} index={0} isTimed={false} onUpdateSet={update}
    onCompleteSet={jest.fn()} onMenuPress={jest.fn()} />);
  fireEvent(screen.getByLabelText('Weight (kg)'), 'focus');
  fireEvent.changeText(screen.getByLabelText('Weight (kg)'), text);
  expect(update).toHaveBeenCalledTimes(1);
  expect(update).toHaveBeenCalledWith('s1', { actual_weight: pounds });
  expect(screen.getByLabelText('Weight (kg)').props.value).toBe(text);
});

it('reads planned pounds in kg and writes actual pounds, retaining explicit zero', () => {
  const update = jest.fn();
  const set = { id: 's1', set_type: 'normal', planned_weight: 220.462, actual_weight: null } as any;
  const props = { set, index: 0, isTimed: false, onUpdateSet: update, onCompleteSet: jest.fn(), onMenuPress: jest.fn() };
  const screen = render(<SetRow {...props} />);
  expect(screen.getByLabelText('Weight (kg)').props.value).toBe('100');
  fireEvent.changeText(screen.getByLabelText('Weight (kg)'), '50');
  expect(update).toHaveBeenLastCalledWith('s1', { actual_weight: 110.231 });
  screen.rerender(<SetRow {...props} set={{ ...set, actual_weight: 0 }} />);
  expect(screen.getByLabelText('Weight (kg)').props.value).toBe('0');
  mockUnit = 'lbs';
  screen.rerender(<SetRow {...props} set={{ ...set, actual_weight: 110.231 }} />);
  expect(screen.getByLabelText('Weight (lbs)').props.value).toBe('110.23');
});
