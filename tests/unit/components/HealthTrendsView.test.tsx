import React from 'react';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react-native';
import { HealthTrendsView } from '@/features/health/components/HealthTrendsView';

const mockHealth: any = {};
const mockFetch = jest.fn();
jest.mock('expo-router', () => ({ useFocusEffect: (callback: any) => require('react').useEffect(callback, [callback]) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/features/health/contexts/HealthKitContext', () => ({ useHealthKit: () => mockHealth }));
jest.mock('@/features/auth/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'test-user' } }) }));
jest.mock('@/features/workouts/contexts/WorkoutsContext', () => ({ useWorkouts: () => ({ workouts: [] }) }));
jest.mock('@/features/nutrition/contexts/FoodContext', () => ({ useFood: () => ({ foods: [] }) }));
jest.mock('@/contexts/UnitsContext', () => ({ useUnits: () => ({ weightUnit: 'kg', convertWeight: (n: number) => n, getWeightLabel: () => 'kg' }) }));
jest.mock('@/lib/services/healthkit/health-aggregation', () => ({ fetchHealthTrendData: (...args: any[]) => mockFetch(...args) }));
jest.mock('@/features/health/components/WeightTrendChart', () => ({ WeightTrendChart: ({ data }: any) => {
  const { Text } = require('react-native');
  return <Text testID="weight-series">{JSON.stringify(data)}</Text>;
} }));

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-10-10T12:00:00'));
  Object.assign(mockHealth, { recordedWeightHistory: [], recordedVO2History: [], weightHistory: [], weightHistory30Days: [], weightHistory180Days: [], stepHistory: [], stepsToday: null, isLoading: false });
  mockFetch.mockReset().mockResolvedValue({ daily: [], weekly: [], monthly: [] });
});
afterEach(() => jest.useRealTimers());

it('shows adjacent completed weight periods with coverage and source uncertainty', async () => {
  mockHealth.recordedWeightHistory = [1, 2, 0, 7, 8, 9].map((day) => ({
    date: new Date(2026, 9, day, 12).getTime(), value: day >= 7 ? 82 : 80,
    provenance: 'observed', unit: 'kg', source: 'HealthKit',
  }));
  render(<HealthTrendsView />);
  fireEvent.press(screen.getByText('7 days'));
  await waitFor(() => expect(screen.getByText('Completed 7-day weight periods')).toBeTruthy());
  expect(screen.getByText('Recorded-day mean change: +2.0 kg')).toBeTruthy();
  expect(screen.getByText('Uneven coverage can affect this comparison. Device source is unknown.')).toBeTruthy();
  expect(screen.queryByText(/Previous: 2026-09-26/)).toBeNull();
  const details = screen.getByRole('button', { name: 'Weight comparison details' });
  expect(details.props.accessibilityState).toEqual({ expanded: false });
  fireEvent.press(details);
  expect(screen.getByRole('button', { name: 'Weight comparison details' }).props.accessibilityState).toEqual({ expanded: true });
  expect(screen.getByText('Previous: 2026-09-26–2026-10-02 · 3/7 recorded days · 3 readings')).toBeTruthy();
  expect(screen.getByText('Recent: 2026-10-03–2026-10-09 · 3/7 recorded days · 3 readings')).toBeTruthy();
  expect(screen.getByText('Recorded-day mean change: +2.0 kg')).toBeTruthy();
  expect(screen.getByText(/Missing days are not imputed; today is excluded/)).toBeTruthy();
  expect(screen.getByText(/Originating HealthKit device source is unknown/)).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Weight comparison details' }));
  expect(screen.queryByText(/Previous: 2026-09-26/)).toBeNull();
  expect(screen.getByText('Recorded-day mean change: +2.0 kg')).toBeTruthy();
  expect(screen.getByText('Uneven coverage can affect this comparison. Device source is unknown.')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Weight comparison details' }).props.accessibilityState).toEqual({ expanded: false });
});

it('groups calendar summaries separately from the fixed seven-day step history', async () => {
  mockHealth.stepsToday = 4500;
  mockFetch.mockResolvedValue({ daily: [], weekly: [{ period: '2026-10-05', avgSteps: 2100 }], monthly: [] });
  render(<HealthTrendsView />);
  await waitFor(() => expect(screen.queryByLabelText('Updating activity history')).toBeNull());
  const summary = within(screen.getByTestId('activity-summary'));
  expect(summary.getByText('This week · Monday to today')).toBeTruthy();
  expect(summary.getByText('2,100')).toBeTruthy();
  expect(summary.queryByText('Steps · past 7 days')).toBeNull();
  fireEvent.press(summary.getByRole('tab', { name: 'Today' }));
  await waitFor(() => expect(screen.queryByLabelText('Updating activity history')).toBeNull());
  expect(summary.getByText('4,500')).toBeTruthy();
  expect(summary.getByRole('tab', { name: 'Today' }).props.accessibilityState).toEqual({ selected: true });
  expect(screen.getByText('Steps · past 7 days')).toBeTruthy();
  expect(screen.getByLabelText('2026-10-10: 4,500 steps')).toBeTruthy();
  expect(screen.getByLabelText('2026-10-04: no step reading available')).toBeTruthy();
});

it('withholds a sparse weight comparison rather than implying a trend', async () => {
  mockHealth.recordedWeightHistory = [{ date: new Date(2026, 9, 9).getTime(), value: 80, provenance: 'observed', unit: 'kg', source: 'HealthKit' }];
  render(<HealthTrendsView />);
  await waitFor(() => expect(screen.getByText(/Comparison unavailable: need at least 3 recorded days in each period/)).toBeTruthy());
  expect(screen.queryByText(/Recorded-day mean change:/)).toBeNull();
});

it('shows only recorded VO₂ estimates with latest date, available count and source uncertainty', async () => {
  const estimate = (day: number, value: number, provenance = 'observed') => ({
    date: new Date(2026, 9, day, 9).getTime(), value, provenance, unit: 'mL/kg/min', source: 'HealthKit',
  });
  mockHealth.recordedVO2History = [estimate(9, 42.5), estimate(1, 40), estimate(11, 99), estimate(8, -2), estimate(8, 60, 'derived')];
  render(<HealthTrendsView />);
  await waitFor(() => expect(screen.getByText('VO₂ max')).toBeTruthy());
  expect(screen.getByText('42.5')).toBeTruthy();
  expect(screen.getByText('Latest estimate · Oct 9, 2026')).toBeTruthy();
  expect(screen.getByText('2 estimates · 2 recorded days')).toBeTruthy();
  expect(screen.getByTestId('vo2-plot')).toBeTruthy();
  fireEvent.press(screen.getByText('About this estimate'));
  expect(screen.getByText(/VO₂ originating device and estimation method are unknown/)).toBeTruthy();
  expect(screen.getByText(/not a laboratory measurement or clinical assessment/i)).toBeTruthy();
});

it('keeps absent VO₂ estimates explicitly unavailable, not zero', async () => {
  render(<HealthTrendsView />);
  await waitFor(() => expect(screen.getByText('No recorded VO₂ estimates in the past 90 days.')).toBeTruthy());
  expect(screen.queryByText('0.0 mL/kg/min')).toBeNull();
});

it('never turns carried-forward or saved daily weights into measured readings', async () => {
  mockHealth.weightHistory30Days = Array.from({ length: 28 }, (_, i) => ({ date: new Date(2026, 8, 13 + i).getTime(), value: 80 }));
  mockHealth.recordedWeightHistory = [{ date: new Date(2026, 9, 9, 9).getTime(), value: 80, provenance: 'observed', unit: 'kg', source: 'HealthKit', dayKey: '2026-10-09' }];
  mockFetch.mockResolvedValue({ daily: [{ date: '2026-10-10', weightKg: 80 }], weekly: [], monthly: [] });
  render(<HealthTrendsView />);
  await waitFor(() => expect(JSON.parse(screen.getByTestId('weight-series').props.children)).toEqual(mockHealth.recordedWeightHistory));
});

it('loads the full weight window independently of the activity summary range', async () => {
  render(<HealthTrendsView />);
  await waitFor(() => expect(mockFetch).toHaveBeenCalledWith('test-user', 180));
  fireEvent.press(screen.getByText('Today'));
  await waitFor(() => expect(mockFetch).toHaveBeenLastCalledWith('test-user', 180));
});

it('offers a wider range when recent readings are absent and filters invalid weights', async () => {
  mockHealth.recordedWeightHistory = [{ date: new Date(2026, 7, 1).getTime(), value: 79, provenance: 'observed' }, { date: new Date(2026, 9, 9).getTime(), value: -1, provenance: 'observed' }];
  mockFetch.mockResolvedValue({ daily: [{ date: '2026-08-01', weightKg: 79 }, { date: '2026-10-09', weightKg: -1 }], weekly: [], monthly: [] });
  render(<HealthTrendsView />);
  await waitFor(() => expect(screen.getByText('Show 180 days')).toBeTruthy());
  expect(screen.queryByTestId('weight-series')).toBeNull();
  fireEvent.press(screen.getByText('Show 180 days'));
  expect(JSON.parse(screen.getByTestId('weight-series').props.children)).toEqual([{ date: new Date(2026, 7, 1).getTime(), value: 79, provenance: 'observed', unit: 'kg' }]);
});

it('shows a seven-day steps fallback without turning missing synced days into zero', async () => {
  mockFetch.mockResolvedValue({ daily: [{ date: '2026-10-09', steps: 2500 }, { date: '2026-10-08', steps: 0 }], weekly: [], monthly: [] });
  mockHealth.stepHistory = [{ date: new Date(2026, 9, 9).getTime(), value: 3200 }];
  render(<HealthTrendsView />);
  await waitFor(() => expect(screen.getByLabelText('2026-10-09: 3,200 steps')).toBeTruthy());
  expect(screen.getByLabelText('2026-10-08: no step reading available')).toBeTruthy();
  expect(screen.getByText('Steps · past 7 days')).toBeTruthy();
  expect(screen.queryByTestId('weight-series')).toBeNull();
});

it('uses observed instants only and excludes future and out-of-range data', async () => {
  mockHealth.recordedWeightHistory = [
    { date: new Date(2026, 9, 9).getTime(), value: 82, provenance: 'observed' },
    { date: new Date(2026, 7, 1).getTime(), value: 79, provenance: 'observed' },
    { date: new Date(2026, 9, 11).getTime(), value: 83, provenance: 'observed' },
  ];
  mockHealth.weightHistory30Days = [{ date: new Date(2026, 9, 9).getTime(), value: 82 }];
  mockFetch.mockResolvedValue({ daily: [
    { date: '2026-10-09', weightKg: 80 }, { date: '2026-10-08', weightKg: 81 },
    { date: '2026-08-01', weightKg: 79 }, { date: '2026-10-11', weightKg: 83 },
  ], weekly: [], monthly: [] });
  render(<HealthTrendsView />);
  await waitFor(() => expect(JSON.parse(screen.getByTestId('weight-series').props.children)).toEqual([
    { date: new Date(2026, 9, 9).getTime(), value: 82, provenance: 'observed', unit: 'kg' },
  ]));
});

it('keeps absent history empty while allowing an explicit zero steps today', async () => {
  mockHealth.stepsToday = 0;
  render(<HealthTrendsView />);
  await waitFor(() => expect(screen.queryByLabelText('Updating activity history')).toBeNull());
  expect(screen.getByLabelText('2026-10-10: 0 steps')).toBeTruthy();
  expect(screen.getByLabelText('2026-10-09: no step reading available')).toBeTruthy();
  expect(screen.queryByTestId('weight-series')).toBeNull();
});

it('withholds saved daily weights with unknown observation provenance', async () => {
  mockFetch.mockResolvedValue({ daily: [{ date: '2026-10-09', weightKg: 80, steps: 1000 }], weekly: [], monthly: [] });
  render(<HealthTrendsView />);
  await waitFor(() => expect(screen.queryByLabelText('Updating activity history')).toBeNull());
  expect(screen.queryByTestId('weight-series')).toBeNull();
});
