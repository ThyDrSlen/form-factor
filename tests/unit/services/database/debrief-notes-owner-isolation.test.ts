/** @jest-environment node */
import { DatabaseSync } from 'node:sqlite';
import { localDB } from '@/lib/services/database/local-db';

jest.mock('@/lib/logger', () => ({ logWithTs: jest.fn(), errorWithTs: jest.fn() }));

type Bind = string | number | null;
const savedAt = '2026-01-01T00:00:00.000Z';
let sqlite: DatabaseSync;
let previousDB: typeof localDB.db;
let beforePrepareReturns: (() => Promise<void>) | undefined;
let beforeReadReturns: (() => Promise<void>) | undefined;
let execute: jest.Mock;
let finalize: jest.Mock;

function seedParent(id: string, owner: string | null = 'owner-a', deleted: number | null = 0) {
  sqlite.prepare('INSERT INTO workout_sessions (id, user_id, started_at, deleted) VALUES (?, ?, ?, ?)')
    .run(id, owner, savedAt, deleted);
}

function seedNotes(id: string, stars = '["fault-a"]', savedCues = 1) {
  sqlite.prepare(`INSERT INTO debrief_notes (session_id, notes, starred_fault_ids, saved_cues, updated_at)
    VALUES (?, ?, ?, ?, ?)`).run(id, '  original\nnotes  ', stars, savedCues, savedAt);
}

function snapshot() {
  return sqlite.prepare('SELECT * FROM debrief_notes ORDER BY session_id').all();
}

beforeEach(async () => {
  sqlite = new DatabaseSync(':memory:');
  previousDB = localDB.db;
  beforePrepareReturns = undefined;
  beforeReadReturns = undefined;
  execute = jest.fn();
  finalize = jest.fn(async () => undefined);
  const connection = sqlite;
  const prepareAsync = async (sql: string) => {
    const statement = connection.prepare(sql);
    await beforePrepareReturns?.();
    return {
      executeAsync: async (args: Bind[] = []) => {
        execute();
        return statement.run(...args);
      },
      finalizeAsync: finalize,
    };
  };
  Object.assign(localDB, { db: {
    execAsync: async (sql: string) => { connection.exec(sql); },
    getAllAsync: async (sql: string, args: Bind[] = []) => connection.prepare(sql).all(...args),
    getFirstAsync: async (sql: string, args: Bind[] = []) => {
      const row = connection.prepare(sql).get(...args) ?? null;
      await beforeReadReturns?.();
      return row;
    },
    prepareAsync,
    // Expo runAsync itself awaits preparation; model that race rather than hiding it.
    runAsync: async (sql: string, args: Bind[] = []) => {
      const statement = await prepareAsync(sql);
      try { return await statement.executeAsync(args); }
      finally { await statement.finalizeAsync(); }
    },
  } });
  await (localDB as unknown as { createTables(): Promise<void> }).createTables();
  seedParent('session-a');
  seedNotes('session-a');
});

afterEach(() => {
  jest.restoreAllMocks();
  localDB.db = previousDB;
  sqlite.close();
});

describe('native debrief notes owner isolation', () => {
  test('reads the existing shape for the persisted session owner', async () => {
    expect(await localDB.getDebriefNotes('owner-a', 'session-a')).toEqual({
      sessionId: 'session-a', notes: '  original\nnotes  ', starredFaultIds: ['fault-a'],
      savedCues: true, updatedAt: savedAt,
    });
  });

  test.each([
    ['foreign', 'owner-b', 0], ['unknown', null, 0], ['blank', '', 0],
    ['deleted', 'owner-a', 1], ['missing-parent', null, 0],
  ] as const)('denies reads and writes for %s while preserving exact notes', async (id, owner, deleted) => {
    if (id !== 'missing-parent') seedParent(id, owner, deleted);
    seedNotes(id);
    const before = snapshot();
    const read = await localDB.getDebriefNotes('owner-a', id);
    const applied = await localDB.saveDebriefNotes('owner-a', id, 'replacement', [], false);
    expect({ read, applied }).toEqual({ read: null, applied: false });
    expect(snapshot()).toEqual(before);
  });

  test('inserts and edits only owned notes, retaining empty text, empty stars, and saved_cues zero', async () => {
    seedParent('fresh', 'owner-a', null);
    expect(await localDB.getDebriefNotes('owner-a', 'fresh')).toBeNull();
    expect(await localDB.saveDebriefNotes('owner-a', 'fresh', ' first\n ', ['x'], true)).toBe(true);
    expect(await localDB.getDebriefNotes('owner-a', 'fresh')).toEqual({
      sessionId: 'fresh', notes: ' first\n ', starredFaultIds: ['x'], savedCues: true,
      updatedAt: expect.any(String),
    });
    expect(await localDB.saveDebriefNotes('owner-a', 'fresh', '', [], false)).toBe(true);
    expect(await localDB.getDebriefNotes('owner-a', 'fresh')).toEqual({
      sessionId: 'fresh', notes: '', starredFaultIds: [], savedCues: false, updatedAt: expect.any(String),
    });
    expect(sqlite.prepare('SELECT saved_cues FROM debrief_notes WHERE session_id = ?').get('fresh')).toEqual({ saved_cues: 0 });
    expect(await localDB.saveDebriefNotes('owner-a', 'absent', 'no parent', [], false)).toBe(false);
    expect(await localDB.getDebriefNotes('owner-a', 'absent')).toBeNull();
  });

  test.each([' owner-a ', "owner-a' OR 1=1 --", 'absent-owner'])('does not normalize or interpolate owner %s', async owner => {
    const before = snapshot();
    expect(await localDB.getDebriefNotes(owner, 'session-a')).toBeNull();
    expect(await localDB.saveDebriefNotes(owner, 'session-a', 'overwrite', [], false)).toBe(false);
    expect(snapshot()).toEqual(before);
  });

  test.each([
    ['not-json', []], ['{"id":"fault"}', []], ['null', []],
    ['["valid",0,null,false,{"id":"bad"},"0",""]', ['valid', '0', '']],
  ])('tolerates legacy starred fault JSON %s', async (json, expected) => {
    seedParent('legacy');
    seedNotes('legacy', json as string, 0);
    expect(await localDB.getDebriefNotes('owner-a', 'legacy')).toEqual({
      sessionId: 'legacy', notes: '  original\nnotes  ', starredFaultIds: expected,
      savedCues: false, updatedAt: savedAt,
    });
  });

  describe.each([false, true])('prepared write with existing notes=%s', existing => {
    test.each([
      "UPDATE workout_sessions SET user_id = 'owner-b' WHERE id = 'session-a'",
      "UPDATE workout_sessions SET user_id = NULL WHERE id = 'session-a'",
      "UPDATE workout_sessions SET deleted = 1 WHERE id = 'session-a'",
      "DELETE FROM workout_sessions WHERE id = 'session-a'",
    ])('checks parent ownership at execution: %s', async mutation => {
      if (!existing) sqlite.exec('DELETE FROM debrief_notes');
      const before = snapshot();
      beforePrepareReturns = async () => { sqlite.exec(mutation); };
      expect(await localDB.saveDebriefNotes('owner-a', 'session-a', 'stale', ['stale'], true)).toBe(false);
      expect(execute).toHaveBeenCalledTimes(1);
      expect(finalize).toHaveBeenCalledTimes(1);
      expect(snapshot()).toEqual(before);
    });
  });

  test('cancels and finalizes a prepared write when its caller lifetime expires', async () => {
    const before = snapshot();
    let current = true;
    beforePrepareReturns = async () => { current = false; };
    expect(await localDB.saveDebriefNotes('owner-a', 'session-a', 'stale', [], false, () => current)).toBe(false);
    expect(execute).not.toHaveBeenCalled();
    expect(finalize).toHaveBeenCalledTimes(1);
    expect(snapshot()).toEqual(before);
  });

  test.each([false, true])('cancels and finalizes a prepared write on connection replacement (callback=%s)', async withCallback => {
    const before = snapshot();
    const replacement = Object.assign({}, localDB.db!);
    beforePrepareReturns = async () => { localDB.db = replacement; };
    expect(await localDB.saveDebriefNotes('owner-a', 'session-a', 'stale', [], false,
      withCallback ? () => true : undefined)).toBe(false);
    expect(execute).not.toHaveBeenCalled();
    expect(finalize).toHaveBeenCalledTimes(1);
    expect(snapshot()).toEqual(before);
  });

  test('finalizes an acquired statement on execution failure without changing the old notes', async () => {
    const before = snapshot();
    sqlite.exec(`CREATE TRIGGER reject_debrief BEFORE UPDATE ON debrief_notes
      BEGIN SELECT RAISE(ABORT, 'debrief write rejected'); END;`);
    await expect(localDB.saveDebriefNotes('owner-a', 'session-a', 'replacement', [], false))
      .rejects.toThrow('debrief write rejected');
    expect(execute).toHaveBeenCalledTimes(1);
    expect(finalize).toHaveBeenCalledTimes(1);
    expect(snapshot()).toEqual(before);
  });

  test('does not publish a real read after caller invalidation', async () => {
    let current = true;
    beforeReadReturns = async () => { current = false; };
    expect(await localDB.getDebriefNotes('owner-a', 'session-a', () => current)).toBeNull();
  });

  test.each([false, true])('does not publish a real read after connection replacement (callback=%s)', async withCallback => {
    const replacement = Object.assign({}, localDB.db!);
    beforeReadReturns = async () => { localDB.db = replacement; };
    expect(await localDB.getDebriefNotes('owner-a', 'session-a', withCallback ? () => true : undefined)).toBeNull();
  });

  describe.each(['read', 'write'] as const)('%s', operation => {
    test('stops an already invalid caller before initialization or SQL', async () => {
      const before = snapshot();
      localDB.db = null;
      const initialize = jest.spyOn(localDB, 'initialize').mockRejectedValue(new Error('must not initialize'));
      const result = operation === 'read'
        ? await localDB.getDebriefNotes('owner-a', 'session-a', () => false)
        : await localDB.saveDebriefNotes('owner-a', 'session-a', 'stale', [], false, () => false);
      expect(result).toBe(operation === 'read' ? null : false);
      expect(initialize).not.toHaveBeenCalled();
      expect(snapshot()).toEqual(before);
    });

    test('rechecks caller lifetime after initialization', async () => {
      const before = snapshot();
      const connection = localDB.db;
      const read = jest.spyOn(connection!, 'getFirstAsync');
      const prepare = jest.spyOn(connection!, 'prepareAsync');
      let current = true;
      localDB.db = null;
      jest.spyOn(localDB, 'initialize').mockImplementation(async () => {
        localDB.db = connection;
        current = false;
      });
      const result = operation === 'read'
        ? await localDB.getDebriefNotes('owner-a', 'session-a', () => current)
        : await localDB.saveDebriefNotes('owner-a', 'session-a', 'stale', [], false, () => current);
      expect(result).toBe(operation === 'read' ? null : false);
      expect(read).not.toHaveBeenCalled();
      expect(prepare).not.toHaveBeenCalled();
      expect(snapshot()).toEqual(before);
    });
    test.each(['', ' ', '\t\n'])('rejects blank owner %j before initialization', async owner => {
      const before = snapshot();
      localDB.db = null;
      const initialize = jest.spyOn(localDB, 'initialize').mockRejectedValue(new Error('must not initialize'));
      const result = operation === 'read'
        ? localDB.getDebriefNotes(owner, 'session-a')
        : localDB.saveDebriefNotes(owner, 'session-a', 'changed', [], false);
      await expect(result).rejects.toThrow(/userId/);
      expect(initialize).not.toHaveBeenCalled();
      expect(snapshot()).toEqual(before);
    });
  });
});
