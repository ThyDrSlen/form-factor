import { getRecordedWeightHistoryAsync, getRecordedVO2HistoryAsync } from '@/lib/services/healthkit/health-metrics';
const mockQuery = jest.fn();
jest.mock('@/lib/services/healthkit/native-healthkit', () => ({ getNativeHealthKit: () => ({ getQuantitySamples: mockQuery }) }));
jest.mock('@/lib/services/ErrorHandler', () => ({ createError: jest.fn(), logError: jest.fn() }));
afterEach(() => jest.useRealTimers());
it('reads VO2 estimates via existing mapping with correct units and empty-safe failures', async () => {
  mockQuery.mockResolvedValue([{ startDate: new Date().toISOString(), value: 42 }]);
  expect(await getRecordedVO2HistoryAsync()).toEqual([expect.objectContaining({ value: 42, unit: 'mL/kg/min', provenance: 'observed' })]);
  expect(mockQuery).toHaveBeenLastCalledWith('vo2Max', expect.any(String), expect.any(String), 'ml/kg/min', null, true);
  mockQuery.mockRejectedValue(new Error('unavailable'));
  expect(await getRecordedVO2HistoryAsync()).toEqual([]);
});
it('preserves sparse actual timestamps and identical repeated readings, never fills missing days', async () => {
  jest.useFakeTimers(); jest.setSystemTime(new Date('2026-10-10T12:00:00Z'));
  mockQuery.mockResolvedValue([
    { startDate: '2026-10-09T09:00:00Z', value: 80 },
    { startDate: '2026-04-15T09:00:00Z', value: 80 },
    { startDate: 'bad', value: 80 }, { startDate: '2026-10-09T09:00:00Z', value: -2 },
  ]);
  const result = await getRecordedWeightHistoryAsync(180);
  expect(result).toHaveLength(2);
  expect(result[1]).toMatchObject({ date: Date.parse('2026-10-09T09:00:00Z'), value: 80, unit: 'kg', provenance: 'observed', source: 'HealthKit' });
  expect(mockQuery).toHaveBeenCalledWith('bodyMass', expect.any(String), expect.any(String), 'kg', null, true);
});
