import { localDB } from '../../../lib/services/database/local-db';

const mockOpenDatabaseAsync = jest.fn();
const mockExecAsync = jest.fn();
const mockRunAsync = jest.fn();
const mockGetAllAsync = jest.fn();
const mockCloseAsync = jest.fn();
const mockWithTransactionAsync = jest.fn();

jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: (...args: unknown[]) => mockOpenDatabaseAsync(...args),
}));

function buildMockDb() {
  return {
    execAsync: mockExecAsync.mockResolvedValue(undefined),
    runAsync: mockRunAsync.mockResolvedValue(undefined),
    getAllAsync: mockGetAllAsync,
    closeAsync: mockCloseAsync.mockResolvedValue(undefined),
    withTransactionAsync: mockWithTransactionAsync.mockImplementation(
      async (fn: () => Promise<void>) => fn(),
    ),
  };
}

async function initLocalDbWith(rows: unknown[]) {
  const db = buildMockDb();
  mockOpenDatabaseAsync.mockResolvedValue(db);
  // Seed call inside initialize asks for exercises count; return zero rows.
  mockGetAllAsync.mockResolvedValue([]);
  await localDB.initialize();
  // After init, configure the query that the test is actually observing.
  mockGetAllAsync.mockReset();
  mockGetAllAsync.mockResolvedValue(rows);
  return db;
}

describe('LocalDatabase.getWorkoutsByExercise', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (localDB as unknown as { db: unknown; initPromise: unknown }).db = null;
    (localDB as unknown as { db: unknown; initPromise: unknown }).initPromise = null;
  });

  it('returns rows ordered by date desc for matching exercise', async () => {
    const rows = [
      {
        id: 'w1',
        exercise: 'Bench Press',
        sets: 3,
        reps: 5,
        weight: 185,
        date: '2025-04-12',
        synced: 1,
        deleted: 0,
        updated_at: '2025-04-12T00:00:00.000Z',
      },
      {
        id: 'w2',
        exercise: 'Bench Press',
        sets: 3,
        reps: 5,
        weight: 180,
        date: '2025-04-05',
        synced: 1,
        deleted: 0,
        updated_at: '2025-04-05T00:00:00.000Z',
      },
    ];
    await initLocalDbWith(rows);

    const result = await localDB.getWorkoutsByExercise('user-1', 'Bench Press');

    expect(result).toEqual(rows);
    expect(mockGetAllAsync).toHaveBeenCalledTimes(1);
    const [query, params] = mockGetAllAsync.mock.calls[0];
    expect(query).toContain('FROM workouts');
    expect(query).toContain('ORDER BY date DESC');
    expect(query).toContain('exercise = ?');
    expect(params).toEqual(['Bench Press']);
  });

  it('applies LIMIT clause when limit is positive', async () => {
    await initLocalDbWith([]);

    await localDB.getWorkoutsByExercise('user-1', 'Squat', 5);

    const [query, params] = mockGetAllAsync.mock.calls[0];
    expect(query).toContain('LIMIT ?');
    expect(params).toEqual(['Squat', 5]);
  });

  it('omits LIMIT clause when limit is undefined', async () => {
    await initLocalDbWith([]);

    await localDB.getWorkoutsByExercise('user-1', 'Deadlift');

    const [query, params] = mockGetAllAsync.mock.calls[0];
    expect(query).not.toContain('LIMIT');
    expect(params).toEqual(['Deadlift']);
  });

  it('ignores non-positive limit values', async () => {
    await initLocalDbWith([]);

    await localDB.getWorkoutsByExercise('user-1', 'Pullup', 0);

    const [query, params] = mockGetAllAsync.mock.calls[0];
    expect(query).not.toContain('LIMIT');
    expect(params).toEqual(['Pullup']);
  });

  it('floors fractional limit values', async () => {
    await initLocalDbWith([]);

    await localDB.getWorkoutsByExercise('user-1', 'OHP', 3.7);

    const [, params] = mockGetAllAsync.mock.calls[0];
    expect(params).toEqual(['OHP', 3]);
  });

  it('filters deleted rows via SQL predicate', async () => {
    await initLocalDbWith([]);

    await localDB.getWorkoutsByExercise('user-1', 'Row');

    const [query] = mockGetAllAsync.mock.calls[0];
    expect(query).toContain('deleted = 0');
  });

  it('accepts userId without using it in the query (local single-user)', async () => {
    await initLocalDbWith([]);

    await localDB.getWorkoutsByExercise('any-user', 'Row');

    const [query, params] = mockGetAllAsync.mock.calls[0];
    expect(query).not.toContain('user_id');
    expect(params).not.toContain('any-user');
  });
});
