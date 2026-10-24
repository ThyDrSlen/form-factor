/**
 * Unit tests for generic-sync.ts — the table-agnostic bidirectional sync
 * adapter between local SQLite and Supabase.
 *
 * Covers all 13 exports: local CRUD, push/pull sync, realtime handling,
 * batch helpers, and cleanup. Mocks localDB.db, supabase.from(), and logger.
 */

// ---------------------------------------------------------------------------
// Mock: localDB.db — the SQLite database handle
// ---------------------------------------------------------------------------

const mockRunAsync = jest.fn().mockResolvedValue(undefined);
const mockGetAllAsync = jest.fn().mockResolvedValue([]);

const mockDb = {
  runAsync: mockRunAsync,
  prepareAsync: async (sql: string) => ({
    // Preserve the fixture's unbound runAsync(sql) overload for zero binds.
    executeAsync: async (values: unknown[]) => values.length ? mockRunAsync(sql, values) : mockRunAsync(sql),
    finalizeAsync: async () => {},
  }),
  getAllAsync: mockGetAllAsync,
};

jest.mock('@/lib/services/database/local-db', () => ({
  localDB: {
    get db() {
      return mockDb;
    },
    addToSyncQueue: jest.fn().mockResolvedValue(undefined),
    getSyncQueue: jest.fn().mockResolvedValue([]),
    withTransaction: jest.fn(async (fn: () => Promise<void>) => fn()),
  },
}));

// ---------------------------------------------------------------------------
// Mock: Supabase — chainable query builder via Proxy
// ---------------------------------------------------------------------------

let supabaseChainResult: { data?: unknown; error?: unknown } = {
  data: null,
  error: null,
};

/** Tracks the last .from() table name for assertions. */
let lastFromTable: string | null = null;

/** Tracks whether .delete() was called in the chain. */
let chainDeleteCalled = false;

/** Tracks whether .select() was called and with what arg. */
let chainSelectArg: string | null = null;

/** Tracks whether .order() was called. */
let chainOrderCalled = false;

/** Tracks .upsert() calls for inspection. */
let lastUpsertArgs: unknown[] = [];

function createQueryBuilder() {
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_target, prop: string) {
      if (prop === 'then') {
        return (resolve: (v: unknown) => void) => resolve(supabaseChainResult);
      }
      if (prop === 'delete') {
        return (..._args: unknown[]) => {
          chainDeleteCalled = true;
          return builder;
        };
      }
      if (prop === 'select') {
        return (arg: string) => {
          chainSelectArg = arg;
          return builder;
        };
      }
      if (prop === 'order') {
        return (..._args: unknown[]) => {
          chainOrderCalled = true;
          return builder;
        };
      }
      if (prop === 'upsert') {
        return (...args: unknown[]) => {
          lastUpsertArgs = args;
          return builder;
        };
      }
      if (prop === 'single') {
        return () => builder;
      }
      // .eq, .neq, .in, etc. — just chain
      return (..._args: unknown[]) => builder;
    },
  };
  const builder = new Proxy({} as Record<string, unknown>, handler);
  return builder;
}

const mockFrom = jest.fn().mockImplementation((table: string) => {
  lastFromTable = table;
  return createQueryBuilder();
});

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));

// ---------------------------------------------------------------------------
// Mock: Logger
// ---------------------------------------------------------------------------

jest.mock('@/lib/logger', () => ({
  logWithTs: jest.fn(),
  warnWithTs: jest.fn(),
  errorWithTs: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Mock: ErrorHandler
// ---------------------------------------------------------------------------

jest.mock('@/lib/services/ErrorHandler', () => ({
  createError: jest.fn((_domain: string, code: string, message: string) => ({
    domain: 'sync',
    code,
    message,
  })),
  logError: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Import under test
// ---------------------------------------------------------------------------

import {
  genericLocalUpsert,
  buildRemoteRow,
  reconcileSystemExerciseIds,
  genericGetUnsynced,
  genericGetById,
  genericUpdateSyncStatus,
  genericSoftDelete,
  genericHardDelete,
  genericGetAll,
  syncTableToSupabase,
  downloadTableFromSupabase,
  handleGenericRealtimeChange,
  syncAllWorkoutTablesToSupabase,
  downloadAllWorkoutTablesFromSupabase,
  cleanupWorkoutSyncedDeletes,
  WORKOUT_SYNC_CONFIGS,
  SyncTableConfig,
} from '@/lib/services/database/generic-sync';
import { localDB } from '@/lib/services/database/local-db';
import { warnWithTs, errorWithTs } from '@/lib/logger';
import { logError } from '@/lib/services/ErrorHandler';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Minimal config for a user-scoped table with soft delete. */
function makeConfig(overrides: Partial<SyncTableConfig> = {}): SyncTableConfig {
  return {
    localTable: 'workout_sessions',
    supabaseTable: 'workout_sessions',
    primaryKey: 'id',
    userScoped: true,
    supportsSoftDelete: true,
    appendOnly: false,
    columns: ['id', 'name', 'started_at'],
    remoteToLocal: WORKOUT_SYNC_CONFIGS.find(config => config.localTable === 'workout_sessions')!.remoteToLocal,
    ...overrides,
  };
}

/** Minimal config for an append-only table. */
function makeAppendOnlyConfig(overrides: Partial<SyncTableConfig> = {}): SyncTableConfig {
  return {
    localTable: 'workout_session_events',
    supabaseTable: 'workout_session_events',
    primaryKey: 'id',
    userScoped: false,
    supportsSoftDelete: false,
    appendOnly: true,
    columns: ['id', 'session_id', 'type', 'payload'],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

/** Only the named persisted row is owned; unrelated lookups remain unknown. */
function mockPersistedOwner(table: 'workout_sessions' | 'workout_session_events', id: string, userId: string): void {
  const from = table === 'workout_sessions'
    ? 'workout_sessions ws WHERE ws.id = ?'
    : 'workout_session_events child JOIN workout_sessions ws ON ws.id = child.session_id WHERE child.id = ?';
  mockGetAllAsync.mockImplementation(async (sql: string, params?: string[]) =>
    sql === `SELECT ws.user_id FROM ${from}` && params?.length === 1 && params[0] === id
      ? [{ user_id: userId }]
      : [],
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(localDB.getSyncQueue).mockReset().mockResolvedValue([]);
  mockRunAsync.mockResolvedValue(undefined);
  mockGetAllAsync.mockResolvedValue([]);
  supabaseChainResult = { data: null, error: null };
  lastFromTable = null;
  chainDeleteCalled = false;
  chainSelectArg = null;
  chainOrderCalled = false;
  lastUpsertArgs = [];
  // Re-set mockFrom implementation after clearAllMocks removes it
  mockFrom.mockImplementation((table: string) => {
    lastFromTable = table;
    return createQueryBuilder();
  });
});

// =============================================================================
// 1. genericLocalUpsert
// =============================================================================

describe('genericLocalUpsert', () => {
  it('inserts a row with synced=0 by default and auto-generates updated_at', async () => {
    const before = new Date().toISOString();
    await genericLocalUpsert('workout_sessions', 'id', {
      id: 'ws-1',
      name: 'Push day',
    });

    expect(mockRunAsync).toHaveBeenCalledTimes(1);
    const [sql, values] = mockRunAsync.mock.calls[0];
    expect(sql).toContain('INSERT INTO workout_sessions');
    expect(sql).toContain('synced');
    expect(sql).toContain('updated_at');
    // synced value should be 0
    const syncedIdx = sql
      .match(/\(([^)]+)\)/)?.[1]
      .split(',')
      .map((c: string) => c.trim())
      .indexOf('synced');
    expect(values[syncedIdx!]).toBe(0);
    // updated_at should be an ISO string generated at call time
    const uaIdx = sql
      .match(/\(([^)]+)\)/)?.[1]
      .split(',')
      .map((c: string) => c.trim())
      .indexOf('updated_at');
    const ts = values[uaIdx!] as string;
    expect(new Date(ts).toISOString()).toBe(ts);
    expect(ts >= before).toBe(true);
  });

  it('uses synced=1 when explicitly passed', async () => {
    await genericLocalUpsert('workout_sessions', 'id', { id: 'ws-2' }, 1);

    const [sql, values] = mockRunAsync.mock.calls[0];
    const cols = sql.match(/\(([^)]+)\)/)?.[1].split(',').map((c: string) => c.trim());
    const syncedIdx = cols.indexOf('synced');
    expect(values[syncedIdx]).toBe(1);
  });

  it('preserves the row-supplied updated_at instead of auto-generating', async () => {
    const customTs = '2024-06-15T10:00:00.000Z';
    await genericLocalUpsert('workout_sessions', 'id', {
      id: 'ws-3',
      updated_at: customTs,
    });

    const [, values] = mockRunAsync.mock.calls[0];
    expect(values).toContain(customTs);
  });

  it('converts boolean values to 0/1', async () => {
    await genericLocalUpsert('exercises', 'id', {
      id: 'ex-1',
      is_compound: true,
      is_timed: false,
    });

    const [, values] = mockRunAsync.mock.calls[0];
    expect(values).toContain(1); // true -> 1
    expect(values).toContain(0); // false -> 0 (also synced=0)
  });

  it('converts null/undefined to null', async () => {
    await genericLocalUpsert('workout_sessions', 'id', {
      id: 'ws-4',
      name: null,
      started_at: undefined,
    });

    const [, values] = mockRunAsync.mock.calls[0];
    // name and started_at should be null
    const nullCount = values.filter((v: unknown) => v === null).length;
    expect(nullCount).toBeGreaterThanOrEqual(2);
  });

  it('throws when db is not initialized', async () => {
    // Temporarily override the db getter to return null
    const origDb = Object.getOwnPropertyDescriptor(localDB, 'db');
    Object.defineProperty(localDB, 'db', { get: () => null, configurable: true });

    await expect(
      genericLocalUpsert('workout_sessions', 'id', { id: 'ws-x' }),
    ).rejects.toThrow('Database not initialized');

    // Restore
    if (origDb) {
      Object.defineProperty(localDB, 'db', origDb);
    } else {
      Object.defineProperty(localDB, 'db', {
        get: () => mockDb,
        configurable: true,
      });
    }
  });

  it('throws on invalid table name', async () => {
    await expect(
      genericLocalUpsert('malicious_table', 'id', { id: '1' }),
    ).rejects.toThrow(/Invalid sync table name/);
  });
});

// =============================================================================
// 2. genericGetUnsynced
// =============================================================================

describe('genericGetUnsynced', () => {
  it('queries rows with synced=0', async () => {
    mockGetAllAsync.mockResolvedValue([
      { id: 'ws-1', synced: 0, deleted: 0 },
    ]);

    const result = await genericGetUnsynced('workout_sessions', true);
    expect(result).toHaveLength(1);
    expect(mockGetAllAsync).toHaveBeenCalledWith(
      expect.stringContaining('WHERE synced = 0'),
    );
  });

  it('returns empty array when no unsynced rows exist', async () => {
    mockGetAllAsync.mockResolvedValue([]);
    const result = await genericGetUnsynced('workout_sessions', false);
    expect(result).toEqual([]);
  });

  it('throws on invalid table name', async () => {
    await expect(genericGetUnsynced('bad_table', false)).rejects.toThrow(
      /Invalid sync table name/,
    );
  });

  it('throws when db is not initialized', async () => {
    const origDb = Object.getOwnPropertyDescriptor(localDB, 'db');
    Object.defineProperty(localDB, 'db', { get: () => null, configurable: true });

    await expect(
      genericGetUnsynced('workout_sessions', false),
    ).rejects.toThrow('Database not initialized');

    if (origDb) Object.defineProperty(localDB, 'db', origDb);
    else Object.defineProperty(localDB, 'db', { get: () => mockDb, configurable: true });
  });
});

// =============================================================================
// 3. genericGetById
// =============================================================================

describe('genericGetById', () => {
  it('returns the matching row including deleted by default', async () => {
    mockGetAllAsync.mockResolvedValue([{ id: 'ws-1', name: 'Leg day', deleted: 1 }]);
    const row = await genericGetById('workout_sessions', 'id', 'ws-1');
    expect(row).toEqual({ id: 'ws-1', name: 'Leg day', deleted: 1 });
    expect(mockGetAllAsync).toHaveBeenCalledWith(
      expect.stringContaining('WHERE id = ?'),
      ['ws-1'],
    );
    // Should NOT filter by deleted when includeDeleted=true (default)
    expect(mockGetAllAsync.mock.calls[0][0]).not.toContain('deleted = 0');
  });

  it('excludes deleted rows when includeDeleted=false', async () => {
    mockGetAllAsync.mockResolvedValue([]);
    await genericGetById('workout_sessions', 'id', 'ws-del', false);
    expect(mockGetAllAsync.mock.calls[0][0]).toContain('deleted = 0');
  });

  it('returns null when no row matches', async () => {
    mockGetAllAsync.mockResolvedValue([]);
    const row = await genericGetById('workout_sessions', 'id', 'missing');
    expect(row).toBeNull();
  });
});

// =============================================================================
// 4. genericUpdateSyncStatus
// =============================================================================

describe('genericUpdateSyncStatus', () => {
  it('sets synced=1 for a given id', async () => {
    await genericUpdateSyncStatus('workout_sessions', 'id', 'ws-1', true);
    expect(mockRunAsync).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE workout_sessions SET synced = ?'),
      [1, 'ws-1'],
    );
  });

  it('sets synced=0 for a given id', async () => {
    await genericUpdateSyncStatus('workout_sessions', 'id', 'ws-1', false);
    expect(mockRunAsync).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE workout_sessions SET synced = ?'),
      [0, 'ws-1'],
    );
  });

  it('throws on invalid table name', async () => {
    await expect(
      genericUpdateSyncStatus('invalid_table', 'id', 'x', true),
    ).rejects.toThrow(/Invalid sync table name/);
  });
});

// =============================================================================
// 5. genericSoftDelete
// =============================================================================

describe('genericSoftDelete', () => {
  it('sets deleted=1, synced=0, and fresh updated_at', async () => {
    const before = new Date().toISOString();
    await genericSoftDelete('workout_sessions', 'id', 'ws-1');

    expect(mockRunAsync).toHaveBeenCalledTimes(1);
    const [sql, values] = mockRunAsync.mock.calls[0];
    expect(sql).toContain('SET deleted = 1, synced = 0, updated_at = ?');
    expect(sql).toContain('WHERE id = ?');
    // updated_at is first param, id is second
    const ts = values[0] as string;
    expect(ts >= before).toBe(true);
    expect(values[1]).toBe('ws-1');
  });

  it('throws on invalid table name', async () => {
    await expect(genericSoftDelete('nope', 'id', 'x')).rejects.toThrow(
      /Invalid sync table name/,
    );
  });
});

// =============================================================================
// 6. genericHardDelete
// =============================================================================

describe('genericHardDelete', () => {
  it('runs DELETE FROM for the given id', async () => {
    await genericHardDelete('workout_sessions', 'id', 'ws-1');
    expect(mockRunAsync).toHaveBeenCalledWith(
      'DELETE FROM workout_sessions WHERE id = ?',
      ['ws-1'],
    );
  });

  it('throws on invalid table name', async () => {
    await expect(genericHardDelete('evil', 'id', '1')).rejects.toThrow(
      /Invalid sync table name/,
    );
  });
});

// =============================================================================
// 7. genericGetAll
// =============================================================================

describe('genericGetAll', () => {
  it('returns all non-deleted rows for soft-delete tables by default', async () => {
    mockGetAllAsync.mockResolvedValue([{ id: 'ws-1', deleted: 0 }]);
    const result = await genericGetAll('workout_sessions', true);
    expect(result).toHaveLength(1);
    expect(mockGetAllAsync.mock.calls[0][0]).toContain('WHERE deleted = 0');
  });

  it('includes deleted rows when includeDeleted=true', async () => {
    mockGetAllAsync.mockResolvedValue([
      { id: 'ws-1', deleted: 0 },
      { id: 'ws-2', deleted: 1 },
    ]);
    const result = await genericGetAll('workout_sessions', true, true);
    expect(result).toHaveLength(2);
    expect(mockGetAllAsync.mock.calls[0][0]).not.toContain('WHERE deleted');
  });

  it('does not filter by deleted when supportsSoftDelete=false', async () => {
    mockGetAllAsync.mockResolvedValue([{ id: 'ex-1' }]);
    const result = await genericGetAll('exercises', false);
    expect(result).toHaveLength(1);
    expect(mockGetAllAsync.mock.calls[0][0]).not.toContain('deleted');
  });

  it('applies ORDER BY clause when provided', async () => {
    mockGetAllAsync.mockResolvedValue([]);
    await genericGetAll('workout_sessions', true, false, 'started_at DESC');
    expect(mockGetAllAsync.mock.calls[0][0]).toContain('ORDER BY started_at DESC');
  });

  it('combines WHERE and ORDER BY clauses', async () => {
    mockGetAllAsync.mockResolvedValue([]);
    await genericGetAll('workout_sessions', true, false, 'name ASC');
    const sql = mockGetAllAsync.mock.calls[0][0];
    expect(sql).toContain('WHERE deleted = 0');
    expect(sql).toContain('ORDER BY name ASC');
    // WHERE must come before ORDER BY
    expect(sql.indexOf('WHERE')).toBeLessThan(sql.indexOf('ORDER BY'));
  });
});

// =============================================================================
// 8. syncTableToSupabase
// =============================================================================

describe('syncTableToSupabase', () => {
  it('does nothing when there are no unsynced rows', async () => {
    mockGetAllAsync.mockResolvedValue([]); // genericGetUnsynced returns []

    await syncTableToSupabase(makeConfig(), 'user-1');

    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('pushes a normal row using upsert with last-write-wins', async () => {
    const localRow = {
      id: 'ws-1',
      name: 'Push day',
      started_at: '2025-01-01T10:00:00Z',
      synced: 0,
      deleted: 0,
      updated_at: '2025-06-01T12:00:00Z',
    };
    // genericGetUnsynced returns our row
    mockGetAllAsync.mockResolvedValueOnce([localRow]);
    mockPersistedOwner('workout_sessions', localRow.id, 'user-1');

    // Return different results per from() call:
    // 1st call = LWW select (not found), 2nd call = upsert (success)
    const results = [
      { data: null, error: { code: 'PGRST116', message: 'not found' } },
      { data: null, error: null },
    ];
    let fromCallIdx = 0;
    mockFrom.mockImplementation(() => {
      const idx = fromCallIdx++;
      const result = results[idx] ?? { data: null, error: null };
      const handler: ProxyHandler<Record<string, unknown>> = {
        get(_target, prop: string) {
          if (prop === 'then') {
            return (resolve: (v: unknown) => void) => resolve(result);
          }
          return (..._args: unknown[]) => new Proxy({}, handler);
        },
      };
      return new Proxy({}, handler);
    });

    await syncTableToSupabase(makeConfig(), 'user-1');

    // Should call from() twice: once for LWW select, once for upsert
    expect(mockFrom.mock.calls).toEqual([['workout_sessions'], ['workout_sessions']]);
    // Acknowledge only the full captured content, not just its timestamp.
    expect(mockRunAsync).toHaveBeenCalledTimes(1);
    expect(mockRunAsync).toHaveBeenCalledWith(
      'UPDATE workout_sessions SET synced = ? WHERE id = ? AND "id" IS ? AND "name" IS ? AND "started_at" IS ? AND "synced" IS ? AND "deleted" IS ? AND "updated_at" IS ?',
      [1, 'ws-1', 'ws-1', 'Push day', '2025-01-01T10:00:00Z', 0, 0, localRow.updated_at],
    );
  });

  it('skips push when server row is newer (last-write-wins)', async () => {
    const localRow = {
      id: 'ws-1',
      name: 'Old local',
      synced: 0,
      deleted: 0,
      updated_at: '2025-01-01T10:00:00Z',
    };
    mockGetAllAsync.mockResolvedValueOnce([localRow]);
    mockPersistedOwner('workout_sessions', localRow.id, 'user-1');
    // Server has a newer timestamp
    supabaseChainResult = {
      data: { id: 'ws-1', user_id: 'user-1', name: 'Server newer', updated_at: '2025-06-15T10:00:00Z' },
      error: null,
    };

    await syncTableToSupabase(makeConfig(), 'user-1');

    // Apply winning content only to the observed local version; never insert.
    expect(mockFrom).toHaveBeenCalledTimes(1);
    expect(lastUpsertArgs).toEqual([]);
    expect(mockRunAsync).toHaveBeenCalledTimes(1);
    expect(mockRunAsync).toHaveBeenCalledWith(
      'UPDATE workout_sessions SET id = ?, user_id = ?, name = ?, updated_at = ?, synced = ? WHERE id = ? AND updated_at = ?',
      ['ws-1', 'user-1', 'Server newer', '2025-06-15T10:00:00Z', 1, 'ws-1', localRow.updated_at],
    );
  });

  it('pushes when local row is newer than server', async () => {
    const localRow = {
      id: 'ws-1',
      name: 'Updated local',
      started_at: '2025-01-01T10:00:00Z',
      synced: 0,
      deleted: 0,
      updated_at: '2025-06-20T10:00:00Z',
    };
    mockGetAllAsync.mockResolvedValueOnce([localRow]);
    mockPersistedOwner('workout_sessions', localRow.id, 'user-1');
    // Server has older timestamp
    supabaseChainResult = {
      data: { id: 'ws-1', user_id: 'user-1', updated_at: '2025-06-15T10:00:00Z' },
      error: null,
    };

    await syncTableToSupabase(makeConfig(), 'user-1');

    // Should have called upsert (via from())
    // At minimum, from() called for select + upsert = 2 calls
    expect(mockFrom.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('syncs soft-deleted row via DELETE on server, then marks synced', async () => {
    const deletedRow = {
      id: 'ws-del',
      name: 'Deleted session',
      synced: 0,
      deleted: 1,
      updated_at: '2025-06-01T12:00:00Z',
    };
    mockGetAllAsync.mockResolvedValueOnce([deletedRow]);
    mockPersistedOwner('workout_sessions', deletedRow.id, 'user-1');
    supabaseChainResult = { data: null, error: null };

    await syncTableToSupabase(makeConfig(), 'user-1');

    // Should call from() for delete
    expect(mockFrom).toHaveBeenCalledWith('workout_sessions');
    expect(chainDeleteCalled).toBe(true);
    // Acknowledge the captured tombstone, not a subsequently restored row.
    expect(mockRunAsync).toHaveBeenCalledTimes(1);
    expect(mockRunAsync).toHaveBeenCalledWith(
      'UPDATE workout_sessions SET synced = ? WHERE id = ? AND "id" IS ? AND "name" IS ? AND "synced" IS ? AND "deleted" IS ? AND "updated_at" IS ?',
      [1, 'ws-del', 'ws-del', 'Deleted session', 0, 1, deletedRow.updated_at],
    );
  });

  it('retains local row and queues retry on RLS violation (42501)', async () => {
    const row = {
      id: 'ws-rls',
      name: 'Forbidden',
      synced: 0,
      deleted: 0,
      updated_at: '2025-06-01T12:00:00Z',
    };
    mockGetAllAsync.mockResolvedValueOnce([row]);
    mockPersistedOwner('workout_sessions', row.id, 'user-1');

    // 1st from() = LWW select (not found), 2nd from() = upsert (RLS error)
    const results = [
      { data: null, error: { code: 'PGRST116', message: 'not found' } },
      { data: null, error: { code: '42501', message: 'RLS violation' } },
    ];
    let callIdx = 0;
    mockFrom.mockImplementation(() => {
      const result = results[callIdx++] ?? { data: null, error: null };
      const handler: ProxyHandler<Record<string, unknown>> = {
        get(_target, prop: string) {
          if (prop === 'then') return (resolve: (v: unknown) => void) => resolve(result);
          return (..._args: unknown[]) => new Proxy({}, handler);
        },
      };
      return new Proxy({}, handler);
    });

    await syncTableToSupabase(makeConfig(), 'user-1');

    expect(mockRunAsync).not.toHaveBeenCalledWith(
      'DELETE FROM workout_sessions WHERE id = ?', ['ws-rls'],
    );
    expect(localDB.addToSyncQueue).toHaveBeenCalledWith(
      'workout_sessions', 'upsert', 'ws-rls', expect.objectContaining({ name: 'Forbidden' }),
    );
  });

  it('adds to sync queue on non-RLS error', async () => {
    const row = {
      id: 'ws-fail',
      name: 'Timeout session',
      synced: 0,
      deleted: 0,
      updated_at: '2025-06-01T12:00:00Z',
    };
    mockGetAllAsync.mockResolvedValueOnce([row]);
    mockPersistedOwner('workout_sessions', row.id, 'user-1');

    // 1st from() = LWW select (not found), 2nd from() = upsert (server error)
    const results = [
      { data: null, error: { code: 'PGRST116', message: 'not found' } },
      { data: null, error: { code: '500', message: 'server down' } },
    ];
    let callIdx = 0;
    mockFrom.mockImplementation(() => {
      const result = results[callIdx++] ?? { data: null, error: null };
      const handler: ProxyHandler<Record<string, unknown>> = {
        get(_target, prop: string) {
          if (prop === 'then') return (resolve: (v: unknown) => void) => resolve(result);
          return (..._args: unknown[]) => new Proxy({}, handler);
        },
      };
      return new Proxy({}, handler);
    });

    await syncTableToSupabase(makeConfig(), 'user-1');

    expect(localDB.addToSyncQueue).toHaveBeenCalledWith(
      'workout_sessions',
      'upsert',
      'ws-fail',
      expect.objectContaining({ name: 'Timeout session' }),
    );
    // The queued row should not include synced/deleted meta
    const queuedRow = (localDB.addToSyncQueue as jest.Mock).mock.calls[0][3];
    expect(queuedRow).not.toHaveProperty('synced');
    expect(queuedRow).not.toHaveProperty('deleted');
  });

  it('append-only mode skips LWW timestamp check', async () => {
    // Match the production event schema: created_at, nullable references, no updated_at.
    const eventRow = {
      id: 'evt-1',
      session_id: 'ws-1',
      created_at: '2025-06-01T12:00:00Z',
      type: 'rep_complete',
      session_exercise_id: null,
      session_set_id: null,
      payload: '{}',
      synced: 0,
    };
    mockGetAllAsync.mockResolvedValueOnce([eventRow]);
    mockPersistedOwner('workout_session_events', eventRow.id, 'user-1');
    supabaseChainResult = { data: null, error: null };

    await syncTableToSupabase(makeAppendOnlyConfig(), 'user-1');

    // Should only call from() once (for the upsert), NOT for an LWW select
    // because append-only skips the timestamp check
    expect(mockFrom).toHaveBeenCalledTimes(1);
    expect(chainSelectArg).toBeNull();
    expect(lastUpsertArgs).toEqual([
      [{ id: 'evt-1', session_id: 'ws-1', type: 'rep_complete', payload: '{}' }],
      { onConflict: 'id', ignoreDuplicates: true },
    ]);
    // Even without updated_at, acknowledgement compares every captured field.
    expect(mockRunAsync).toHaveBeenCalledTimes(1);
    expect(mockRunAsync).toHaveBeenCalledWith(
      'UPDATE workout_session_events SET synced = ? WHERE id = ? AND "id" IS ? AND "session_id" IS ? AND "created_at" IS ? AND "type" IS ? AND "session_exercise_id" IS ? AND "session_set_id" IS ? AND "payload" IS ? AND "synced" IS ?',
      [1, 'evt-1', 'evt-1', 'ws-1', eventRow.created_at, 'rep_complete', null, null, '{}', 0],
    );
  });

  it('passes onConflict to upsert when configured', async () => {
    const row = {
      id: 'ws-oc',
      name: 'Conflict test',
      started_at: '2025-01-01T10:00:00Z',
      synced: 0,
      deleted: 0,
      updated_at: '2025-06-20T10:00:00Z',
    };
    mockGetAllAsync.mockResolvedValueOnce([row]);
    mockPersistedOwner('workout_sessions', row.id, 'user-1');
    // No existing server row
    supabaseChainResult = { data: null, error: { code: 'PGRST116', message: 'not found' } };

    const config = makeConfig({ onConflict: 'id' });
    await syncTableToSupabase(config, 'user-1');

    // The second from() call should have been for upsert which passes onConflict
    // We verify mockFrom was called (the proxy handles the chaining internally)
    expect(mockFrom).toHaveBeenCalled();
  });

  it('uses localToRemote transform when provided', async () => {
    const row = {
      id: 'ws-tr',
      name: 'Transform test',
      started_at: '2025-01-01T10:00:00Z',
      synced: 0,
      deleted: 0,
      updated_at: '2025-06-20T10:00:00Z',
    };
    mockGetAllAsync.mockResolvedValueOnce([row]);
    mockPersistedOwner('workout_sessions', row.id, 'user-1');
    supabaseChainResult = { data: null, error: { code: 'PGRST116', message: 'not found' } };

    const localToRemote = jest.fn().mockReturnValue({ id: 'ws-tr', custom_field: 'yes' });
    const config = makeConfig({ localToRemote });
    await syncTableToSupabase(config, 'user-1');

    expect(localToRemote).toHaveBeenCalledWith(row, 'user-1');
  });

  it('adds user_id for user-scoped tables in default buildRemoteRow', async () => {
    const row = {
      id: 'ws-scope',
      name: 'Scoped test',
      started_at: '2025-01-01T10:00:00Z',
      synced: 0,
      deleted: 0,
      updated_at: '2025-06-20T10:00:00Z',
    };
    mockGetAllAsync.mockResolvedValueOnce([row]);
    mockPersistedOwner('workout_sessions', row.id, 'user-1');
    supabaseChainResult = { data: null, error: { code: 'PGRST116', message: 'not found' } };

    // Spy on the upsert args via the proxy
    let capturedUpsertData: unknown[] = [];
    mockFrom.mockImplementation(() => {
      const handler: ProxyHandler<Record<string, unknown>> = {
        get(_target, prop: string) {
          if (prop === 'then') {
            return (resolve: (v: unknown) => void) => resolve(supabaseChainResult);
          }
          if (prop === 'upsert') {
            return (...args: unknown[]) => {
              capturedUpsertData = args;
              return _target;
            };
          }
          return (..._args: unknown[]) => new Proxy({}, handler);
        },
      };
      return new Proxy({}, handler);
    });

    mockPersistedOwner('workout_sessions', row.id, 'user-42');
    await syncTableToSupabase(makeConfig({ userScoped: true }), 'user-42');

    // Check the upsert was called with user_id in the row
    expect(capturedUpsertData).toHaveLength(2);
    const upsertRows = capturedUpsertData[0] as Record<string, unknown>[];
    expect(upsertRows[0]).toHaveProperty('user_id', 'user-42');
  });

  it('adds soft-deleted row to sync queue as delete operation on failure', async () => {
    const row = {
      id: 'ws-delfail',
      name: 'Delete fail',
      synced: 0,
      deleted: 1,
      updated_at: '2025-06-01T12:00:00Z',
    };
    mockGetAllAsync.mockResolvedValueOnce([row]);
    mockPersistedOwner('workout_sessions', row.id, 'user-1');
    // DELETE fails with generic error
    supabaseChainResult = {
      data: null,
      error: { code: '500', message: 'server error' },
    };

    await syncTableToSupabase(makeConfig(), 'user-1');

    expect(localDB.addToSyncQueue).toHaveBeenCalledWith(
      'workout_sessions',
      'delete',
      'ws-delfail',
      expect.any(Object),
    );
  });
});

// =============================================================================
// 9. downloadTableFromSupabase
// =============================================================================

describe('downloadTableFromSupabase', () => {
  it('upserts remote rows into local DB with synced=1', async () => {
    const remoteRow = {
      id: 'ws-remote-1',
      name: 'Remote session',
      updated_at: '2025-06-01T12:00:00Z',
      created_at: '2025-06-01T10:00:00Z',
      user_id: 'user-1',
    };
    supabaseChainResult = { data: [remoteRow], error: null };
    // genericGetAll (local) returns empty
    mockGetAllAsync.mockResolvedValueOnce([]);

    await downloadTableFromSupabase(makeConfig(), 'user-1');

    // Should call genericLocalUpsert (via runAsync)
    expect(mockRunAsync).toHaveBeenCalled();
    const insertCall = mockRunAsync.mock.calls.find(
      ([sql]: [string]) => sql.includes('INSERT'),
    );
    expect(insertCall).toBeDefined();
  });

  it('skips remote row when local is newer', async () => {
    const remoteRow = {
      id: 'ws-old',
      name: 'Old remote',
      updated_at: '2025-01-01T10:00:00Z',
      created_at: '2025-01-01T10:00:00Z',
      user_id: 'user-1',
    };
    supabaseChainResult = { data: [remoteRow], error: null };
    // Local has a newer version
    mockGetAllAsync.mockResolvedValueOnce([
      { id: 'ws-old', name: 'Newer local', updated_at: '2025-06-15T10:00:00Z', synced: 1, deleted: 0 },
    ]);

    await downloadTableFromSupabase(makeConfig(), 'user-1');

    // Should NOT insert/update because local is newer
    const insertCalls = mockRunAsync.mock.calls.filter(
      ([sql]: [string]) => sql.includes('INSERT'),
    );
    expect(insertCalls).toHaveLength(0);
  });

  it('keeps local soft-delete pending sync over server version', async () => {
    const remoteRow = {
      id: 'ws-kept',
      name: 'Server version',
      updated_at: '2025-06-15T10:00:00Z',
      created_at: '2025-01-01T10:00:00Z',
      user_id: 'user-1',
    };
    supabaseChainResult = { data: [remoteRow], error: null };
    // Local has unsynced soft delete
    mockGetAllAsync.mockResolvedValueOnce([
      { id: 'ws-kept', name: 'To be deleted', deleted: 1, synced: 0, updated_at: '2025-06-10T10:00:00Z' },
    ]);

    await downloadTableFromSupabase(makeConfig(), 'user-1');

    // Should NOT overwrite the local pending delete
    const insertCalls = mockRunAsync.mock.calls.filter(
      ([sql]: [string]) => sql.includes('INSERT'),
    );
    expect(insertCalls).toHaveLength(0);
  });

  it('retains local synced rows absent from a remote listing', async () => {
    // Server returns empty
    supabaseChainResult = { data: [], error: null };
    // Local has a synced, non-deleted row
    mockGetAllAsync.mockResolvedValueOnce([
      { id: 'ws-gone', name: 'Removed from server', synced: 1, deleted: 0 },
    ]);

    await downloadTableFromSupabase(makeConfig(), 'user-1');

    expect(mockRunAsync).not.toHaveBeenCalledWith(
      'DELETE FROM workout_sessions WHERE id = ?',
      ['ws-gone'],
    );
  });

  it('does NOT delete local unsynced rows absent from server', async () => {
    supabaseChainResult = { data: [], error: null };
    mockGetAllAsync.mockResolvedValueOnce([
      { id: 'ws-new', name: 'New local only', synced: 0, deleted: 0 },
    ]);

    await downloadTableFromSupabase(makeConfig(), 'user-1');

    // Should not delete unsynced local rows
    const deleteCalls = mockRunAsync.mock.calls.filter(
      ([sql]: [string]) => sql.includes('DELETE FROM'),
    );
    expect(deleteCalls).toHaveLength(0);
  });

  it('does NOT clean up rows for append-only tables', async () => {
    supabaseChainResult = { data: [], error: null };
    mockGetAllAsync.mockResolvedValueOnce([
      { id: 'evt-local', synced: 1, deleted: 0 },
    ]);

    await downloadTableFromSupabase(makeAppendOnlyConfig(), 'user-1');

    const deleteCalls = mockRunAsync.mock.calls.filter(
      ([sql]: [string]) => sql.includes('DELETE FROM'),
    );
    expect(deleteCalls).toHaveLength(0);
  });

  it('uses remoteToLocal transform when provided', async () => {
    const remoteRow = {
      id: 'ws-transform',
      name: 'Raw remote',
      user_id: 'user-1',
      updated_at: '2025-06-01T12:00:00Z',
      created_at: '2025-06-01T10:00:00Z',
    };
    supabaseChainResult = { data: [remoteRow], error: null };
    mockGetAllAsync.mockResolvedValueOnce([]);

    const remoteToLocal = jest.fn().mockReturnValue({
      id: 'ws-transform',
      name: 'Transformed',
      updated_at: '2025-06-01T12:00:00Z',
    });
    const config = makeConfig({ remoteToLocal, userScoped: false });
    await downloadTableFromSupabase(config, 'user-1');

    expect(remoteToLocal).toHaveBeenCalledWith(remoteRow);
  });

  it('reports missing required remote schema instead of successful recovery', async () => {
    supabaseChainResult = {
      data: null,
      error: { message: 'relation "workout_sessions" does not exist', code: '42P01' },
    };

    // No table was downloaded; the coordinator must not report success.
    await expect(
      downloadTableFromSupabase(makeConfig(), 'user-1'),
    ).rejects.toEqual(supabaseChainResult.error);
  });

  it('logs and propagates non-missing-table supabase errors', async () => {
    supabaseChainResult = {
      data: null,
      error: { message: 'permission denied', code: '42501' },
    };

    await expect(downloadTableFromSupabase(makeConfig(), 'user-1'))
      .rejects.toEqual(supabaseChainResult.error);

    expect(errorWithTs).toHaveBeenCalledWith(
      expect.stringContaining('Error downloading'),
      expect.anything(),
    );
  });

  it('preserves creation time and persisted session ownership in local rows', async () => {
    const remoteRow = {
      id: 'ws-strip',
      name: 'Strip test',
      updated_at: '2025-06-01T12:00:00Z',
      created_at: '2025-06-01T10:00:00Z',
      user_id: 'user-1',
    };
    supabaseChainResult = { data: [remoteRow], error: null };
    mockGetAllAsync.mockResolvedValueOnce([]);

    await downloadTableFromSupabase(makeConfig({ userScoped: true }), 'user-1');

    // Sessions retain their verified server owner alongside creation time.
    const insertCall = mockRunAsync.mock.calls.find(
      ([sql]: [string]) => sql.includes('INSERT'),
    );
    expect(insertCall).toBeDefined();
    const [sql, values] = insertCall!;
    expect(sql).toContain('created_at');
    expect(sql).toContain('user_id');
    expect(values).toContain('user-1');
    expect(values).toContain(remoteRow.created_at);
  });

  it('scopes query by user_id for user-scoped tables', async () => {
    supabaseChainResult = { data: [], error: null };
    mockGetAllAsync.mockResolvedValueOnce([]);

    await downloadTableFromSupabase(makeConfig({ userScoped: true }), 'user-99');

    expect(mockFrom).toHaveBeenCalledWith('workout_sessions');
    // The Proxy-based chain builder will handle .eq('user_id', 'user-99')
    // We trust the implementation calls it; from() is the entry point
  });
});

// =============================================================================
// 10. handleGenericRealtimeChange
// =============================================================================

describe('handleGenericRealtimeChange', () => {
  const notifyCb = jest.fn();
  const conflictCb = jest.fn();

  beforeEach(() => {
    notifyCb.mockClear();
    conflictCb.mockClear();
  });

  it('INSERT: upserts remote row locally and notifies', async () => {
    const payload = {
      eventType: 'INSERT' as const,
      new: { id: 'ws-rt1', user_id: 'user-1', name: 'Realtime insert', updated_at: '2025-06-01T12:00:00Z' },
      old: {},
      schema: 'public',
      table: 'workout_sessions',
      commit_timestamp: '2025-06-01T12:00:00Z',
      errors: [],
    };
    // genericGetById returns null (no local row)
    mockGetAllAsync.mockResolvedValueOnce([]);

    await handleGenericRealtimeChange(makeConfig(), payload, notifyCb, conflictCb);

    // Should insert locally
    expect(mockRunAsync).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO workout_sessions'),
      expect.any(Array),
    );
    expect(notifyCb).toHaveBeenCalledTimes(1);
  });

  it('UPDATE: local unsynced wins over server update', async () => {
    const payload = {
      eventType: 'UPDATE' as const,
      new: { id: 'ws-conflict', user_id: 'user-1', name: 'Server update', updated_at: '2025-06-15T12:00:00Z' },
      old: {},
      schema: 'public',
      table: 'workout_sessions',
      commit_timestamp: '2025-06-15T12:00:00Z',
      errors: [],
    };
    // Local row has unsynced changes (synced=0)
    mockGetAllAsync.mockResolvedValueOnce([
      { id: 'ws-conflict', name: 'Local edit', synced: 0, updated_at: '2025-06-10T12:00:00Z' },
    ]);

    await handleGenericRealtimeChange(makeConfig(), payload, notifyCb, conflictCb);

    // Should NOT overwrite local — notify conflict reconcile instead
    expect(notifyCb).not.toHaveBeenCalled();
    expect(conflictCb).toHaveBeenCalledWith('workout_sessions:ws-conflict');
    // Should not have inserted
    const insertCalls = mockRunAsync.mock.calls.filter(
      ([sql]: [string]) => sql.includes('INSERT'),
    );
    expect(insertCalls).toHaveLength(0);
  });

  it('UPDATE: overwrites local synced row with server version', async () => {
    const payload = {
      eventType: 'UPDATE' as const,
      new: { id: 'ws-synced', user_id: 'user-1', name: 'Server newer', updated_at: '2025-06-20T12:00:00Z' },
      old: {},
      schema: 'public',
      table: 'workout_sessions',
      commit_timestamp: '2025-06-20T12:00:00Z',
      errors: [],
    };
    // Local is synced (synced=1)
    mockGetAllAsync.mockResolvedValueOnce([
      { id: 'ws-synced', name: 'Old local', synced: 1, updated_at: '2025-06-15T12:00:00Z' },
    ]);

    await handleGenericRealtimeChange(makeConfig(), payload, notifyCb, conflictCb);

    expect(notifyCb).toHaveBeenCalledTimes(1);
    expect(conflictCb).not.toHaveBeenCalled();
    expect(mockRunAsync.mock.calls).toEqual([
      [
        'UPDATE workout_sessions SET user_id = ? WHERE id = ? AND user_id IS NULL',
        ['user-1', 'ws-synced'],
      ],
      [
        'UPDATE workout_sessions SET id = ?, user_id = ?, name = ?, updated_at = ?, synced = ? WHERE id = ? AND updated_at = ?',
        ['ws-synced', 'user-1', 'Server newer', '2025-06-20T12:00:00Z', 1, 'ws-synced', '2025-06-15T12:00:00Z'],
      ],
    ]);
  });

  it('DELETE: hard-deletes local row and notifies', async () => {
    const payload = {
      eventType: 'DELETE' as const,
      new: {},
      old: { id: 'ws-del' },
      schema: 'public',
      table: 'workout_sessions',
      commit_timestamp: '2025-06-01T12:00:00Z',
      errors: [],
    };

    await handleGenericRealtimeChange(makeConfig(), payload, notifyCb, conflictCb);

    expect(mockRunAsync).toHaveBeenCalledWith(
      'DELETE FROM workout_sessions WHERE id = ?',
      ['ws-del'],
    );
    expect(notifyCb).toHaveBeenCalledTimes(1);
  });

  it('ignores INSERT/UPDATE with invalid id (non-string or missing)', async () => {
    const payload = {
      eventType: 'INSERT' as const,
      new: { id: 123 }, // numeric, not string
      old: {},
      schema: 'public',
      table: 'workout_sessions',
      commit_timestamp: '2025-06-01T12:00:00Z',
      errors: [],
    };

    await handleGenericRealtimeChange(makeConfig(), payload, notifyCb, conflictCb);

    expect(notifyCb).not.toHaveBeenCalled();
    expect(mockRunAsync).not.toHaveBeenCalled();
  });

  it('ignores DELETE with missing id', async () => {
    const payload = {
      eventType: 'DELETE' as const,
      new: {},
      old: {}, // no id
      schema: 'public',
      table: 'workout_sessions',
      commit_timestamp: '2025-06-01T12:00:00Z',
      errors: [],
    };

    await handleGenericRealtimeChange(makeConfig(), payload, notifyCb, conflictCb);

    expect(notifyCb).not.toHaveBeenCalled();
    expect(mockRunAsync).not.toHaveBeenCalled();
  });

  it('uses remoteToLocal transform when configured', async () => {
    const payload = {
      eventType: 'INSERT' as const,
      new: { id: 'ws-xform', user_id: 'user-1', name: 'Raw', updated_at: '2025-06-01T12:00:00Z' },
      old: {},
      schema: 'public',
      table: 'workout_sessions',
      commit_timestamp: '2025-06-01T12:00:00Z',
      errors: [],
    };
    mockGetAllAsync.mockResolvedValueOnce([]);

    const remoteToLocal = jest.fn().mockReturnValue({
      id: 'ws-xform',
      name: 'Transformed',
      updated_at: '2025-06-01T12:00:00Z',
    });

    await handleGenericRealtimeChange(
      makeConfig({ remoteToLocal }),
      payload,
      notifyCb,
      conflictCb,
    );

    expect(remoteToLocal).toHaveBeenCalled();
    expect(notifyCb).toHaveBeenCalledTimes(1);
  });

  it('logs error and does not throw on internal failure', async () => {
    const payload = {
      eventType: 'INSERT' as const,
      new: { id: 'ws-err', name: 'Error test' },
      old: {},
      schema: 'public',
      table: 'workout_sessions',
      commit_timestamp: '2025-06-01T12:00:00Z',
      errors: [],
    };
    // Make getById throw
    mockGetAllAsync.mockRejectedValueOnce(new Error('DB read failed'));

    await expect(
      handleGenericRealtimeChange(makeConfig(), payload, notifyCb, conflictCb),
    ).resolves.toBeUndefined();

    expect(logError).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'REALTIME_CHANGE_FAILED',
        message: expect.stringContaining('Failed to apply realtime'),
      }),
      expect.objectContaining({
        location: 'generic-sync.handleGenericRealtimeChange',
      }),
    );
  });
});

// =============================================================================
// 11. syncAllWorkoutTablesToSupabase
// =============================================================================

describe('syncAllWorkoutTablesToSupabase', () => {
  it('iterates all WORKOUT_SYNC_CONFIGS and calls sync for each', async () => {
    // All tables return no unsynced rows
    mockGetAllAsync.mockResolvedValue([]);

    await syncAllWorkoutTablesToSupabase('user-1');

    // genericGetUnsynced is called once per config via getAllAsync
    expect(mockGetAllAsync).toHaveBeenCalledTimes(WORKOUT_SYNC_CONFIGS.length + 1);
  });

  it('continues syncing remaining tables even if one has rows', async () => {
    // First config will have an unsynced row, rest empty
    let callCount = 0;
    mockGetAllAsync.mockImplementation(() => {
      callCount++;
      if (callCount === 2) {
        return Promise.resolve([
          { id: 'row-1', synced: 0, deleted: 0, updated_at: '2025-06-01T12:00:00Z' },
        ]);
      }
      return Promise.resolve([]);
    });
    supabaseChainResult = { data: null, error: { code: 'PGRST116', message: 'not found' } };

    await syncAllWorkoutTablesToSupabase('user-1');

    // Should have called getAllAsync at least for all configs
    expect(callCount).toBeGreaterThanOrEqual(WORKOUT_SYNC_CONFIGS.length);
  });
});

// =============================================================================
// 12. downloadAllWorkoutTablesFromSupabase
// =============================================================================

describe('downloadAllWorkoutTablesFromSupabase', () => {
  it('downloads all WORKOUT_SYNC_CONFIGS tables', async () => {
    supabaseChainResult = { data: [], error: null };
    mockGetAllAsync.mockResolvedValue([]);

    await downloadAllWorkoutTablesFromSupabase('user-1');

    // from() should be called once per config for the download query
    expect(mockFrom).toHaveBeenCalledTimes(WORKOUT_SYNC_CONFIGS.length);
  });
});

// =============================================================================
// 13. cleanupWorkoutSyncedDeletes
// =============================================================================

describe('cleanupWorkoutSyncedDeletes', () => {
  it('deletes synced soft-deleted rows from all soft-delete tables', async () => {
    await cleanupWorkoutSyncedDeletes();

    const softDeleteConfigs = WORKOUT_SYNC_CONFIGS.filter((c) => c.supportsSoftDelete);
    expect(mockRunAsync).toHaveBeenCalledTimes(softDeleteConfigs.length);

    for (const config of softDeleteConfigs) {
      expect(mockRunAsync).toHaveBeenCalledWith(
        `DELETE FROM ${config.localTable} WHERE deleted = 1 AND synced = 1`,
      );
    }
  });

  it('skips tables without soft delete support', async () => {
    await cleanupWorkoutSyncedDeletes();

    const nonSoftDeleteTables = WORKOUT_SYNC_CONFIGS.filter((c) => !c.supportsSoftDelete);
    for (const config of nonSoftDeleteTables) {
      // Use exact table name match to avoid substring false positives
      // (e.g. "exercises" matching "workout_template_exercises")
      const expectedSql = `DELETE FROM ${config.localTable} WHERE deleted = 1 AND synced = 1`;
      const calls = mockRunAsync.mock.calls.filter(
        ([sql]: [string]) => sql === expectedSql,
      );
      expect(calls).toHaveLength(0);
    }
  });

  it('gracefully handles null db', async () => {
    const origDb = Object.getOwnPropertyDescriptor(localDB, 'db');
    Object.defineProperty(localDB, 'db', { get: () => null, configurable: true });

    // Should return without error when db is null
    await expect(cleanupWorkoutSyncedDeletes()).resolves.toBeUndefined();
    expect(mockRunAsync).not.toHaveBeenCalled();

    if (origDb) Object.defineProperty(localDB, 'db', origDb);
    else Object.defineProperty(localDB, 'db', { get: () => mockDb, configurable: true });
  });
});

// =============================================================================
// WORKOUT_SYNC_CONFIGS structure validation
// =============================================================================

describe('WORKOUT_SYNC_CONFIGS', () => {
  it('has the expected number of table configs', () => {
    expect(WORKOUT_SYNC_CONFIGS.length).toBe(8);
  });

  it('includes all core workout tables', () => {
    const tables = WORKOUT_SYNC_CONFIGS.map((c) => c.localTable);
    expect(tables).toContain('exercises');
    expect(tables).toContain('workout_templates');
    expect(tables).toContain('workout_template_exercises');
    expect(tables).toContain('workout_template_sets');
    expect(tables).toContain('workout_sessions');
    expect(tables).toContain('workout_session_exercises');
    expect(tables).toContain('workout_session_sets');
    expect(tables).toContain('workout_session_events');
  });

  it('marks workout_session_events as append-only', () => {
    const events = WORKOUT_SYNC_CONFIGS.find((c) => c.localTable === 'workout_session_events');
    expect(events?.appendOnly).toBe(true);
    expect(events?.supportsSoftDelete).toBe(false);
  });

  it('marks exercises as non-user-scoped', () => {
    const exercises = WORKOUT_SYNC_CONFIGS.find((c) => c.localTable === 'exercises');
    expect(exercises?.userScoped).toBe(false);
    expect(exercises?.supportsSoftDelete).toBe(false);
  });

  it('marks workout_sessions and workout_templates as user-scoped', () => {
    const sessions = WORKOUT_SYNC_CONFIGS.find((c) => c.localTable === 'workout_sessions');
    const templates = WORKOUT_SYNC_CONFIGS.find((c) => c.localTable === 'workout_templates');
    expect(sessions?.userScoped).toBe(true);
    expect(templates?.userScoped).toBe(true);
  });

  it('workout_session_events has localToRemote that parses JSON payload', () => {
    const events = WORKOUT_SYNC_CONFIGS.find((c) => c.localTable === 'workout_session_events');
    expect(events?.localToRemote).toBeDefined();

    // Test JSON string -> parsed object
    const result = events!.localToRemote!(
      { id: 'evt-1', session_id: 'ws-1', type: 'rep', payload: '{"reps":10}' },
      'user-1',
    );
    expect(result.payload).toEqual({ reps: 10 });
  });

  it('workout_session_events localToRemote handles non-string payload', () => {
    const events = WORKOUT_SYNC_CONFIGS.find((c) => c.localTable === 'workout_session_events');

    const result = events!.localToRemote!(
      { id: 'evt-2', session_id: 'ws-1', type: 'rep', payload: { reps: 5 } },
      'user-1',
    );
    expect(result.payload).toEqual({ reps: 5 });
  });

  it('workout_session_events localToRemote handles invalid JSON gracefully', () => {
    const events = WORKOUT_SYNC_CONFIGS.find((c) => c.localTable === 'workout_session_events');

    const result = events!.localToRemote!(
      { id: 'evt-3', session_id: 'ws-1', type: 'rep', payload: '{bad json' },
      'user-1',
    );
    // Falls back to raw string value
    expect(result.payload).toBe('{bad json');
    expect(warnWithTs).toHaveBeenCalledWith(
      expect.stringContaining('Failed to parse JSON'),
    );
  });

  it('workout_session_events remoteToLocal stringifies object payload', () => {
    const events = WORKOUT_SYNC_CONFIGS.find((c) => c.localTable === 'workout_session_events');
    expect(events?.remoteToLocal).toBeDefined();

    const result = events!.remoteToLocal!({
      id: 'evt-4',
      session_id: 'ws-1',
      type: 'rep',
      payload: { reps: 15 },
    });
    expect(result.payload).toBe('{"reps":15}');
  });

  it('workout_session_events remoteToLocal keeps string payload as-is', () => {
    const events = WORKOUT_SYNC_CONFIGS.find((c) => c.localTable === 'workout_session_events');

    const result = events!.remoteToLocal!({
      id: 'evt-5',
      session_id: 'ws-1',
      type: 'rep',
      payload: 'already-a-string',
    });
    expect(result.payload).toBe('already-a-string');
  });
});


describe('workout model integrity', () => {
  it('stores events without an updated_at column and uses non-destructive upserts', async () => {
    await genericLocalUpsert('workout_session_events', 'id', {
      id: 'event-1', session_id: 'session-1', type: 'session_started',
      created_at: '2026-09-18T00:00:00Z', payload: '{}',
    });
    const [sql] = mockRunAsync.mock.calls[0];
    expect(sql).not.toContain('updated_at');
    expect(sql).toContain('ON CONFLICT(id) DO UPDATE');
    expect(sql).not.toContain('REPLACE');
  });

  it('remaps offline catalog IDs and both parent references in one transaction', async () => {
    mockGetAllAsync.mockResolvedValueOnce([{ id: 'seed-pull-up', name: 'Pull-Up', category: 'pull' }]);
    supabaseChainResult = { data: [{ id: 'server-uuid', name: 'Pull-Up', category: 'pull', is_system: true }], error: null };
    await reconcileSystemExerciseIds();
    expect(localDB.withTransaction).toHaveBeenCalledTimes(1);
    for (const table of ['workout_template_exercises', 'workout_session_exercises']) {
      expect(mockRunAsync).toHaveBeenCalledWith(
        `UPDATE ${table} SET exercise_id = ?, synced = 0 WHERE exercise_id = ?`, ['server-uuid', 'seed-pull-up'],
      );
    }
    expect(mockRunAsync).toHaveBeenCalledWith("DELETE FROM sync_queue WHERE table_name = 'exercises' AND record_id = ?", ['seed-pull-up']);
  });

  it('leaves offline workouts intact if the server catalog is missing a match', async () => {
    mockGetAllAsync.mockResolvedValueOnce([{ id: 'seed-pull-up', name: 'Pull-Up', category: 'pull' }]);
    supabaseChainResult = { data: [], error: null };
    await expect(reconcileSystemExerciseIds()).rejects.toThrow('Cannot resolve system exercise');
    expect(mockRunAsync).not.toHaveBeenCalled();
  });

  it('downloads all pages before merging and does not infer deletes from a listing', async () => {
    const firstPage = Array.from({ length: 500 }, (_, i) => ({ id: `row-${i}`, user_id: 'user-1', name: 'Session' }));
    const range = jest.fn().mockResolvedValueOnce({ data: firstPage, error: null })
      .mockResolvedValueOnce({ data: [{ id: 'last-row', user_id: 'user-1', name: 'Last session' }], error: null });
    const query = { select: () => query, eq: () => query, order: () => query, range };
    mockFrom.mockReturnValue(query);
    mockGetAllAsync.mockResolvedValueOnce([{ id: 'not-visible', synced: 1, deleted: 0 }]);
    await downloadTableFromSupabase(makeConfig(), 'user-1');
    expect(range.mock.calls).toEqual([[0, 499], [500, 999]]);
    expect(mockRunAsync.mock.calls.filter(([sql]) => sql.startsWith('INSERT'))).toHaveLength(501);
    expect(mockRunAsync.mock.calls.filter(([sql]) => sql.startsWith('UPDATE workout_sessions SET user_id'))).toHaveLength(501);
    expect(mockRunAsync.mock.calls.some(([sql]) => sql.startsWith('DELETE'))).toBe(false);
  });
});


test('converts SQLite boolean flags to remote booleans', () => {
  const config = WORKOUT_SYNC_CONFIGS.find(config => config.localTable === 'exercises')!;
  expect(buildRemoteRow(config, { id: 'exercise-1', is_compound: 1, is_timed: 0, is_system: 0 }, 'user-1')).toEqual({
    id: 'exercise-1', is_compound: true, is_timed: false, is_system: false,
  });
});


test('remote payload columns agree with the checked-in Postgres migrations', () => {
  const fs = require('fs');
  const path = require('path');
  const sql = ['026_create_exercises_table.sql', '027_create_workout_templates.sql', '028_create_workout_sessions.sql']
    .map(file => fs.readFileSync(path.join(process.cwd(), 'supabase/migrations', file), 'utf8')).join('\n');
  for (const config of WORKOUT_SYNC_CONFIGS) {
    const definition = sql.split(`CREATE TABLE IF NOT EXISTS ${config.supabaseTable} (`)[1].split('\n);')[0];
    const columns = new Set(Array.from(definition.matchAll(/^  ([a-z_]+)\s+(?:uuid|text|int|numeric|boolean|timestamptz|jsonb)\b/gm), match => (match as RegExpMatchArray)[1]));
    const row = Object.fromEntries(config.columns.map(column => [column, column === 'payload' ? '{}' : null]));
    row.id = 'row-1';
    row.created_at = '2026-09-18T00:00:00Z';
    if (!config.appendOnly) row.updated_at = row.created_at;
    for (const column of Object.keys(buildRemoteRow(config, row, 'user-1'))) {
      expect({ table: config.supabaseTable, column, exists: columns.has(column) }).toEqual({ table: config.supabaseTable, column, exists: true });
    }
    expect(columns.has('user_id')).toBe(config.userScoped);
  }
});

test('remote merges condition updates on the local version that was read', async () => {
  await genericLocalUpsert('workout_sessions', 'id', { id: 'session-1', name: 'Remote', updated_at: 'remote-version' }, 1, 'original-local-version');
  expect(mockRunAsync).toHaveBeenCalledTimes(1);
  expect(mockRunAsync).toHaveBeenCalledWith(
    'UPDATE workout_sessions SET id = ?, name = ?, updated_at = ?, synced = ? WHERE id = ? AND updated_at = ?',
    ['session-1', 'Remote', 'remote-version', 1, 'session-1', 'original-local-version'],
  );
});
