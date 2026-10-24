import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import { VO2TrendCard } from '@/features/health/components/VO2TrendCard';
import type { RecordedHealthObservation } from '@/lib/services/healthkit/health-types';
const now = new Date(2026, 9, 10, 12).getTime();
const point = (daysAgo: number, value: number): RecordedHealthObservation => {
  const date = new Date(now); date.setDate(date.getDate() - daysAgo);
  return { date: date.getTime(), value, dayKey: date.toISOString().slice(0,10), source: 'HealthKit', unit: 'mL/kg/min', provenance: 'observed' };
};
it.each(['Other device', ''])('withholds a change when the source label is incompatible: %s', source => {
  const view = render(<VO2TrendCard data={[point(5,40), {...point(1,43), source}]} now={now} />);
  expect(view.queryByText('+3.0 mL/kg/min')).toBeNull();
  expect(view.getByText(/Change unavailable: source labels differ or are missing/)).toBeTruthy();
});
it('describes an empty selected window without implying global absence', () => {
  const view = render(<VO2TrendCard data={[point(60, 40)]} now={now} />);
  fireEvent.press(view.getByRole('tab', { name: 'VO₂ past 30 days' }));
  expect(view.getByText('No recorded VO₂ estimates in the past 30 days.')).toBeTruthy();
  expect(view.getByText('Try a wider range to view earlier estimates.')).toBeTruthy();
  fireEvent.press(view.getByRole('tab', { name: 'VO₂ past 90 days' }));
  expect(view.getByTestId('vo2-selected').props.children).toContain('40.0 mL/kg/min');
});
it('resets inspection to the latest estimate when switching to a wider or narrower range', () => {
  const view = render(<VO2TrendCard data={[point(120, 38), point(60, 40), point(20, 42), point(5, 43)]} now={now} />);
  act(() => view.getByTestId('vo2-plot').props.onAccessibilityAction({ nativeEvent: { actionName: 'decrement' } }));
  expect(view.getByTestId('vo2-selected').props.children).toContain('42.0 mL/kg/min');
  fireEvent.press(view.getByRole('tab', { name: 'VO₂ past 180 days' }));
  expect(view.getByTestId('vo2-selected').props.children).toContain('43.0 mL/kg/min');
  act(() => view.getByTestId('vo2-plot').props.onAccessibilityAction({ nativeEvent: { actionName: 'decrement' } }));
  fireEvent.press(view.getByRole('tab', { name: 'VO₂ past 30 days' }));
  expect(view.getByTestId('vo2-selected').props.children).toContain('43.0 mL/kg/min');
  expect(view.getByRole('tab', { name: 'VO₂ past 30 days' }).props.accessibilityState.selected).toBe(true);
});
it('switches calendar windows and withholds a change with only one recorded day', () => {
  const view = render(<VO2TrendCard data={[point(120, 38), point(60, 40), point(5, 43)]} now={now} />);
  expect(view.getByText('+3.0 mL/kg/min')).toBeTruthy();
  expect(view.getByText(/First-to-latest estimate change/)).toBeTruthy();
  fireEvent.press(view.getByRole('tab', { name: 'VO₂ past 30 days' }));
  expect(view.queryByText('+3.0 mL/kg/min')).toBeNull();
  expect(view.getByText(/One recorded day/)).toBeTruthy();
  fireEvent.press(view.getByRole('tab', { name: 'VO₂ past 180 days' }));
  expect(view.getByText('+5.0 mL/kg/min')).toBeTruthy();
});
it('leaves vertical scrolling alone and claims only deliberate horizontal scrubbing', () => {
  const view = render(<VO2TrendCard data={[point(5, 40), point(1, 43)]} now={now} />);
  const plot = view.getByTestId('vo2-plot');
  act(() => plot.props.onLayout({ nativeEvent: { layout: { width: 300 } } }));
  const touch = (pageX: number, pageY: number) => ({ nativeEvent: { pageX, pageY } });
  expect(plot.props.onStartShouldSetResponder(touch(100, 100))).toBe(false);
  expect(plot.props.onMoveShouldSetResponder(touch(102, 140))).toBe(false);
  expect(plot.props.onMoveShouldSetResponder(touch(105, 101))).toBe(false);
  expect(plot.props.onMoveShouldSetResponder(touch(120, 120))).toBe(false);
  expect(plot.props.onMoveShouldSetResponder(touch(130, 103))).toBe(true);
  expect(plot.props.onResponderTerminationRequest()).toBe(true);
});
it('retains source uncertainty and excludes invalid observations', () => {
  const view = render(<VO2TrendCard data={[
    point(5, 40), point(1, 43), point(-1, 99), point(0, 0), point(0, NaN),
    { ...point(0, 90), unit: 'bpm' },
    { ...point(0, 90), provenance: 'derived' as RecordedHealthObservation['provenance'] },
  ]} now={now} />);
  expect(view.getByText('2 estimates · 2 recorded days')).toBeTruthy();
  expect(view.getByText(/not a validated fitness trend/)).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: 'About this estimate' }));
  expect(view.getByText(/originating device and estimation method are unknown/)).toBeTruthy();
  expect(view.getByText(/generic HealthKit label is not source proof/)).toBeTruthy();
});
it('spaces estimates by date, leaves long gaps and supports touch and accessible inspection', () => {
  const view = render(<VO2TrendCard data={[point(60,40), point(58,41), point(5,43)]} now={now} />);
  const plot = view.getByTestId('vo2-plot');
  act(() => plot.props.onLayout({nativeEvent:{layout:{width:300}}}));
  const xs = [0,1,2].map(i=>view.getByTestId(`vo2-point-${i}`).props.cx);
  expect((xs[1]-xs[0])/(xs[2]-xs[0])).toBeCloseTo(2/55);
  expect(view.getByTestId('vo2-line').props.d.match(/M /g)).toHaveLength(2);
  act(() => plot.props.onResponderGrant({nativeEvent:{locationX:8}}));
  expect(view.getByTestId('vo2-selected').props.children).toContain('40.0 mL/kg/min');
  act(() => plot.props.onAccessibilityAction({nativeEvent:{actionName:'increment'}}));
  expect(view.getByTestId('vo2-selected').props.children).toContain('41.0 mL/kg/min');
});
