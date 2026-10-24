/** @jest-environment node */
import { downloadAllWorkoutTablesFromSupabase, downloadTableFromSupabase, WORKOUT_SYNC_CONFIGS } from '@/lib/services/database/generic-sync';

const mockRange = jest.fn();
const mockRun = jest.fn();
const mockRead = jest.fn();
const mockFrom = jest.fn();
jest.mock('@/lib/services/database/local-db', () => ({
  localDB: { db: {
    runAsync: (...args: unknown[]) => mockRun(...args),
    prepareAsync: async (sql: string) => ({
      executeAsync: async (values: unknown[]) => mockRun(sql, values),
      finalizeAsync: async () => {},
    }),
    getAllAsync: (...args: unknown[]) => mockRead(...args),
  } },
}));
jest.mock('@/lib/supabase', () => ({ supabase: { from: (...args: unknown[]) => mockFrom(...args) } }));
jest.mock('@/lib/logger', () => ({ logWithTs: jest.fn(), warnWithTs: jest.fn(), errorWithTs: jest.fn() }));

const config = WORKOUT_SYNC_CONFIGS.find(table => table.localTable === 'workout_sessions')!;
const failure = { code: '42501', message: 'permission denied' };

beforeEach(() => {
  jest.clearAllMocks();
  mockRange.mockReset().mockResolvedValue({ data: [], error: null });
  mockRead.mockReset().mockResolvedValue([]);
  const query = { select: () => query, eq: () => query, or: () => query, order: () => query, range: mockRange };
  mockFrom.mockReturnValue(query);
});

test('propagates a page failure without applying an incomplete remote listing', async () => {
  const firstPage = Array.from({ length: 500 }, (_, id) => ({ id: `remote-${id}`, user_id: 'owner' }));
  mockRange.mockResolvedValueOnce({ data: firstPage, error: null })
    .mockResolvedValueOnce({ data: null, error: failure });
  await expect(downloadTableFromSupabase(config, 'owner')).rejects.toBe(failure);
  expect(mockRange.mock.calls).toEqual([[0, 499], [500, 999]]);
  expect(mockRead).not.toHaveBeenCalled();
  expect(mockRun).not.toHaveBeenCalled();
});

test('all-table recovery cannot resolve successfully after a table fails', async () => {
  mockRange.mockResolvedValueOnce({ data: null, error: failure });
  await expect(downloadAllWorkoutTablesFromSupabase('owner')).rejects.toBe(failure);
  expect(mockFrom).toHaveBeenCalledTimes(1);
  expect(mockRun).not.toHaveBeenCalled();
});

test('propagates a local storage failure rather than reporting successful recovery', async () => {
  const diskFailure = new Error('SQLite unavailable');
  mockRead.mockRejectedValueOnce(diskFailure);
  await expect(downloadTableFromSupabase(config, 'owner')).rejects.toBe(diskFailure);
});

test('a verified empty listing still completes without deleting local rows', async () => {
  mockRead.mockResolvedValueOnce([{ id: 'local', user_id: 'owner', synced: 1 }]);
  await expect(downloadTableFromSupabase(config, 'owner')).resolves.toBeUndefined();
  expect(mockRun).not.toHaveBeenCalled();
});
