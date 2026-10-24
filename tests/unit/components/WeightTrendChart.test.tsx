import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { WeightTrendChart } from '@/features/health/components/WeightTrendChart';

jest.mock('@/lib/logger', () => ({ logWithTs: jest.fn() }));

it('rejects derived and unmarked points even if a caller passes legacy data', () => {
  const data = [{ date: Date.now(), value: 80 }, { date: Date.now(), value: 81, provenance: 'derived' }];
  render(<WeightTrendChart data={data as never} period="30d" weightUnit="kg" />);
  expect(screen.getByText('No weight data available')).toBeTruthy();
  expect(screen.queryByText(/Latest measured/)).toBeNull();
});

it('uses measured width and real elapsed dates, leaving long gaps disconnected', () => {
  const data = [1, 2, 10].map((day) => ({ provenance: 'observed' as const, date: new Date(2026, 9, day).getTime(), value: 80 + day }));
  render(<WeightTrendChart data={data} period="30d" weightUnit="kg" />);
  fireEvent(screen.getByTestId('weight-plot'), 'layout', { nativeEvent: { layout: { width: 300 } } });
  const points = data.map((_, i) => screen.getByTestId(`weight-point-${i}`).props.cx);
  expect((points[1] - points[0]) / (points[2] - points[0])).toBeCloseTo(1 / 9);
  expect(screen.getByTestId('weight-line').props.d.match(/M /g)).toHaveLength(2);
  expect(screen.getByText(/Latest measured/)).toBeTruthy();
});

it('scrubs nearest actual reading, adjusts with VoiceOver and offers a readable list', () => {
  const data = [1, 2, 10].map((day) => ({ provenance: 'observed' as const, date: new Date(2026, 9, day).getTime(), value: 80 + day, source: 'HealthKit' }));
  render(<WeightTrendChart data={data} period="30d" weightUnit="kg" />);
  const plot = screen.getByTestId('weight-plot');
  fireEvent(plot, 'layout', { nativeEvent: { layout: { width: 300 } } });
  fireEvent(plot, 'responderGrant', { nativeEvent: { locationX: 40 } });
  expect(screen.getByTestId('selected-reading').props.children.join('')).toContain('82.0');
  fireEvent(plot, 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
  expect(screen.getByTestId('selected-reading').props.children.join('')).toContain('90.0');
  fireEvent.press(screen.getByText('Show readings'));
  expect(screen.getByText(/Oct 2, 2026.*82.0 kg.*HealthKit.*Recorded/)).toBeTruthy();
});

it('displays one day of weight without implying a change or trend', () => {
  render(<WeightTrendChart data={[{ provenance: 'observed' as const, date: new Date(2026, 9, 9).getTime(), value: 80 }]} period="30d" weightUnit="kg" />);
  expect(screen.getByText('80.0')).toBeTruthy();
  expect(screen.getByText('--')).toBeTruthy();
  expect(screen.queryByText('Trend')).toBeNull();
  expect(screen.getByText('One day of weight data. Add a reading on another day to see a change.')).toBeTruthy();
});

it('renders an existing trend from two different days', () => {
  render(<WeightTrendChart data={[
    { provenance: 'observed' as const, date: new Date(2026, 9, 8).getTime(), value: 81 },
    { provenance: 'observed' as const, date: new Date(2026, 9, 9).getTime(), value: 80 },
  ]} period="30d" weightUnit="kg" />);
  expect(screen.getByText('Trend')).toBeTruthy();
  expect(screen.getByText('-1.0')).toBeTruthy();
});
