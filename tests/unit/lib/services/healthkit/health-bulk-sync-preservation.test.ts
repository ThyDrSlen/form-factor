jest.mock('@/lib/services/database/local-db', () => ({
  localDB: { insertHealthMetric: jest.fn(), getHealthMetricsForRange: jest.fn() },
}));
jest.mock('@/lib/services/database/sync-service', () => ({
  syncService: { syncToSupabase: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('@/lib/services/healthkit/health-metrics', () => ({
  getStepHistoryAsync: jest.fn(), getWeightHistoryAsync: jest.fn(),
}));
jest.mock('@/lib/logger', () => ({
  logWithTs: jest.fn(), warnWithTs: jest.fn(), errorWithTs: jest.fn(),
}));

import { localDB } from '@/lib/services/database/local-db';
import { getStepHistoryAsync, getWeightHistoryAsync } from '@/lib/services/healthkit/health-metrics';
import { syncAllHealthKitDataToSupabase } from '@/lib/services/healthkit/health-bulk-sync';

type Metric = Parameters<typeof localDB.insertHealthMetric>[0];
const date = Date.parse('2026-10-09T00:00:00Z');
const saved: Metric = {
  id: 'user-1_2026-10-09', user_id: 'user-1', summary_date: '2026-10-09',
  steps: 2254, weight_kg: 81.2, weight_timestamp: '2026-10-09T09:00:00Z',
  heart_rate_bpm: 64, heart_rate_timestamp: '2026-10-09T10:00:00Z',
};
let rows: Map<string, Metric>;

beforeEach(() => {
  jest.clearAllMocks();
  rows = new Map([[saved.summary_date, { ...saved }]]);
  (getStepHistoryAsync as jest.Mock).mockResolvedValue([]);
  (getWeightHistoryAsync as jest.Mock).mockResolvedValue([]);
  (localDB.getHealthMetricsForRange as jest.Mock).mockImplementation(async (user, start, end) =>
    [...rows.values()].filter(row => row.user_id === user && row.summary_date >= start && row.summary_date <= end));
  // Match the actual DB's full-row ON CONFLICT replacement, not a partial merge.
  (localDB.insertHealthMetric as jest.Mock).mockImplementation(async (row: Metric) => {
    rows.set(row.summary_date, { ...row });
  });
});

describe('bulk import missing-reading preservation (no native, disk, or network access)', () => {
  it.each([
    { steps: 3000, weight: null, expectedSteps: 3000, expectedWeight: 81.2 },
    { steps: 0, weight: 80.1, expectedSteps: 2254, expectedWeight: 80.1 },
    { steps: null, weight: 80.1, expectedSteps: 2254, expectedWeight: 80.1 },
  ])('merges available readings without clearing absent metrics: %j', async ({ steps, weight, expectedSteps, expectedWeight }) => {
    (getStepHistoryAsync as jest.Mock).mockResolvedValue(steps == null ? [] : [{ date, value: steps }]);
    (getWeightHistoryAsync as jest.Mock).mockResolvedValue(weight == null ? [] : [{ date, value: weight }]);

    const result = await syncAllHealthKitDataToSupabase('user-1', 7);

    expect(rows.get(saved.summary_date)).toEqual({
      ...saved, steps: expectedSteps, weight_kg: expectedWeight,
      weight_timestamp: weight == null ? saved.weight_timestamp : new Date(date).toISOString(),
    });
    expect(result).toEqual({ success: true, recordsSynced: 1, errors: 0 });
  });
  it('continues importing valid days after a write failure and reports exact counts', async () => {
    (getStepHistoryAsync as jest.Mock).mockResolvedValue([
      { date, value: 3000 }, { date: Date.parse('2026-10-10T00:00:00Z'), value: 4000 },
    ]);
    (localDB.insertHealthMetric as jest.Mock).mockRejectedValueOnce(new Error('write failed'));
    const result = await syncAllHealthKitDataToSupabase('user-1', 7);
    expect(result).toEqual({ success: false, recordsSynced: 1, errors: 1 });
    expect(rows.get(saved.summary_date)).toEqual(saved);
    expect(rows.get('2026-10-10')?.steps).toBe(4000);
  });

  it('fails closed if existing history cannot be read', async () => {
    (getStepHistoryAsync as jest.Mock).mockResolvedValue([{ date, value: 3000 }]);
    (localDB.getHealthMetricsForRange as jest.Mock).mockRejectedValueOnce(new Error('read failed'));
    const result = await syncAllHealthKitDataToSupabase('user-1', 7);
    expect(rows.get(saved.summary_date)).toEqual(saved);
    expect(localDB.insertHealthMetric).not.toHaveBeenCalled();
    expect(result).toEqual({ success: false, recordsSynced: 0, errors: 1 });
  });

  it('imports a new weight-only day with unknown steps, scoped to its owner and date', async () => {
    rows.clear();
    (getStepHistoryAsync as jest.Mock).mockResolvedValue([{ date, value: 0 }]);
    (getWeightHistoryAsync as jest.Mock).mockResolvedValue([{ date, value: 80.1 }]);
    await syncAllHealthKitDataToSupabase('user-1', 7);
    expect(localDB.getHealthMetricsForRange).toHaveBeenCalledWith('user-1', '2026-10-09', '2026-10-09');
    expect(rows.get(saved.summary_date)).toEqual({
      ...saved, steps: null, weight_kg: 80.1, weight_timestamp: new Date(date).toISOString(),
      heart_rate_bpm: null, heart_rate_timestamp: null,
    });
  });

  it('leaves history untouched when both readers return empty arrays', async () => {
    const result = await syncAllHealthKitDataToSupabase('user-1', 7);
    expect(rows.get(saved.summary_date)).toEqual(saved);
    expect(localDB.insertHealthMetric).not.toHaveBeenCalled();
    expect(result.recordsSynced).toBe(0);
  });

  it('does not persist synthetic zero-only days over saved history', async () => {
    (getStepHistoryAsync as jest.Mock).mockResolvedValue([{ date, value: 0 }]);

    const result = await syncAllHealthKitDataToSupabase('user-1', 7);

    expect(rows.get(saved.summary_date)).toEqual(saved);
    expect(localDB.insertHealthMetric).not.toHaveBeenCalled();
    expect(result).toEqual({ success: true, recordsSynced: 0, errors: 0 });
  });
});
