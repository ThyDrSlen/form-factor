/**
 * session-export-service tests
 *
 * The service reads from local SQLite and writes to expo-file-system. We
 * stub both so tests don't touch disk and can assert on shaping logic
 * (JSON payload, CSV row count, path construction, edge cases).
 */

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///tmp/ff-test/',
  getInfoAsync: jest.fn().mockResolvedValue({ exists: true }),
  makeDirectoryAsync: jest.fn().mockResolvedValue(undefined),
  writeAsStringAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/lib/services/database/local-db', () => ({
  localDB: {
    db: {
      getAllAsync: jest.fn(),
    },
  },
}));

import * as FileSystem from 'expo-file-system/legacy';

import { localDB } from '@/lib/services/database/local-db';
import {
  buildExportPath,
  buildSessionExportPayload,
  exportSession,
  payloadToSetRows,
  serializeExport,
  type SessionExportPayload,
} from '@/lib/services/session-export-service';

const writeMock = FileSystem.writeAsStringAsync as jest.Mock;
const makeDirMock = FileSystem.makeDirectoryAsync as jest.Mock;
const getInfoMock = FileSystem.getInfoAsync as jest.Mock;
const dbGetAll = localDB.db!.getAllAsync as jest.Mock;

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function mkSessionRow(overrides: Record<string, unknown> = {}) {
  return [
    {
      id: 'sess1',
      name: 'Leg Day',
      goal_profile: 'hypertrophy',
      started_at: '2026-04-10T09:00:00.000Z',
      ended_at: '2026-04-10T10:30:00.000Z',
      bodyweight_lb: 180,
      notes: null,
      ...overrides,
    },
  ];
}

function mkExerciseRows() {
  return [
    {
      id: 'wse1',
      exercise_id: 'squat',
      exercise_name: 'Back Squat',
      sort_order: 0,
      notes: null,
    },
    {
      id: 'wse2',
      exercise_id: 'rdl',
      exercise_name: 'RDL',
      sort_order: 1,
      notes: null,
    },
  ];
}

function mkSetRows() {
  return [
    {
      id: 'set1',
      session_exercise_id: 'wse1',
      sort_order: 0,
      set_type: 'warmup',
      planned_reps: 5,
      planned_seconds: null,
      planned_weight: 95,
      actual_reps: 5,
      actual_seconds: null,
      actual_weight: 95,
      completed_at: '2026-04-10T09:05:00.000Z',
      perceived_rpe: 4,
      tut_ms: 15000,
      tut_source: 'measured',
      notes: JSON.stringify({ fqiScore: 88, faults: ['forward_lean'] }),
    },
    {
      id: 'set2',
      session_exercise_id: 'wse1',
      sort_order: 1,
      set_type: 'normal',
      planned_reps: 5,
      planned_seconds: null,
      planned_weight: 225,
      actual_reps: 5,
      actual_seconds: null,
      actual_weight: 225,
      completed_at: '2026-04-10T09:15:00.000Z',
      perceived_rpe: 8,
      tut_ms: 20000,
      tut_source: 'measured',
      notes: null,
    },
    {
      id: 'set3',
      session_exercise_id: 'wse2',
      sort_order: 0,
      set_type: 'normal',
      planned_reps: 8,
      planned_seconds: null,
      planned_weight: 185,
      actual_reps: 8,
      actual_seconds: null,
      actual_weight: 185,
      completed_at: '2026-04-10T10:00:00.000Z',
      perceived_rpe: 7,
      tut_ms: 22000,
      tut_source: 'estimated',
      notes: JSON.stringify({ fqi_score: 92 }),
    },
  ];
}

function stubQueries() {
  dbGetAll
    .mockImplementationOnce(async () => mkSessionRow())
    .mockImplementationOnce(async () => mkExerciseRows())
    .mockImplementationOnce(async () => mkSetRows());
}

beforeEach(() => {
  // resetAllMocks also drains mockImplementationOnce queues — important
  // because tests below chain `.mockImplementationOnce(...)` and we don't
  // want leftover queue entries leaking between tests.
  jest.resetAllMocks();
  getInfoMock.mockResolvedValue({ exists: true });
  makeDirMock.mockResolvedValue(undefined);
  writeMock.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// buildExportPath
// ---------------------------------------------------------------------------

describe('buildExportPath', () => {
  it('prefixes with documentDirectory and exports/ subdir', () => {
    const now = new Date('2026-04-16T10:30:45.123Z');
    const path = buildExportPath('sess-abc', 'json', now);
    expect(path.startsWith('file:///tmp/ff-test/exports/')).toBe(true);
    expect(path.endsWith('.json')).toBe(true);
  });

  it('sanitises unsafe characters in sessionId', () => {
    const now = new Date('2026-04-16T10:30:45.123Z');
    const path = buildExportPath('../sneaky/path', 'csv', now);
    expect(path).not.toContain('../');
    expect(path).not.toContain('sneaky/path');
    expect(path.endsWith('.csv')).toBe(true);
  });

  it('uses stable timestamp slug (colons/dots replaced)', () => {
    const now = new Date('2026-04-16T10:30:45.123Z');
    const path = buildExportPath('sess', 'json', now);
    // `file:` prefix contains a colon — strip the scheme before asserting.
    const withoutScheme = path.replace(/^file:/, '');
    expect(withoutScheme).not.toMatch(/:/);
    expect(path).toContain('2026-04-16T10-30-45-123Z');
  });
});

// ---------------------------------------------------------------------------
// buildSessionExportPayload
// ---------------------------------------------------------------------------

describe('buildSessionExportPayload', () => {
  it('returns a structured payload with session + exercises + totals', async () => {
    stubQueries();
    const payload = await buildSessionExportPayload('sess1');
    expect(payload.schemaVersion).toBe(1);
    expect(payload.session.id).toBe('sess1');
    expect(payload.session.goalProfile).toBe('hypertrophy');
    expect(payload.session.durationSeconds).toBe(5400); // 90 minutes
    expect(payload.exercises).toHaveLength(2);
    expect(payload.totalSetCount).toBe(3);
    // Volume = 5*95 + 5*225 + 8*185 = 475 + 1125 + 1480 = 3080
    expect(payload.totalVolumeLb).toBe(3080);
  });

  it('surfaces per-set fqi and faults parsed from notes JSON', async () => {
    stubQueries();
    const payload = await buildSessionExportPayload('sess1');
    const flat = payloadToSetRows(payload);
    expect(flat[0].fqiScore).toBe(88);
    expect(flat[0].faults).toBe('forward_lean');
    // set 2 has notes=null -> no fqi/faults
    expect(flat[1].fqiScore).toBeNull();
    expect(flat[1].faults).toBeNull();
    // set 3 uses snake_case fqi_score
    expect(flat[2].fqiScore).toBe(92);
  });

  it('copes with empty session (no exercises)', async () => {
    dbGetAll
      .mockImplementationOnce(async () => mkSessionRow())
      .mockImplementationOnce(async () => [])
      .mockImplementationOnce(async () => []);
    const payload = await buildSessionExportPayload('sess1');
    expect(payload.exercises).toHaveLength(0);
    expect(payload.totalSetCount).toBe(0);
    expect(payload.totalVolumeLb).toBe(0);
  });

  it('throws when the session does not exist', async () => {
    dbGetAll.mockImplementationOnce(async () => []);
    await expect(buildSessionExportPayload('missing')).rejects.toThrow(
      /not found/,
    );
  });

  it('handles missing ended_at (in-progress session) by setting durationSeconds=null', async () => {
    dbGetAll
      .mockImplementationOnce(async () => mkSessionRow({ ended_at: null }))
      .mockImplementationOnce(async () => mkExerciseRows())
      .mockImplementationOnce(async () => mkSetRows());
    const payload = await buildSessionExportPayload('sess1');
    expect(payload.session.durationSeconds).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// serializeExport
// ---------------------------------------------------------------------------

describe('serializeExport (json)', () => {
  it('returns pretty-printed JSON with a parseable payload', async () => {
    stubQueries();
    const payload = await buildSessionExportPayload('sess1');
    const json = serializeExport(payload, 'json');
    expect(json.startsWith('{')).toBe(true);
    expect(() => JSON.parse(json)).not.toThrow();
    const reparsed = JSON.parse(json) as SessionExportPayload;
    expect(reparsed.schemaVersion).toBe(1);
    expect(reparsed.exercises).toHaveLength(2);
  });
});

describe('serializeExport (csv)', () => {
  it('writes a header row + 1 row per set', async () => {
    stubQueries();
    const payload = await buildSessionExportPayload('sess1');
    const csv = serializeExport(payload, 'csv');
    const lines = csv.split('\n');
    expect(lines).toHaveLength(4); // header + 3 rows
    expect(lines[0]).toContain('session_id,session_name,exercise_id');
    expect(lines[0]).toContain('fqi_score,faults,completed_at');
  });

  it('escapes commas/quotes inside fields', async () => {
    dbGetAll
      .mockImplementationOnce(async () =>
        mkSessionRow({ name: 'Leg Day, Heavy "Push"' }),
      )
      .mockImplementationOnce(async () => mkExerciseRows())
      .mockImplementationOnce(async () => mkSetRows());
    const payload = await buildSessionExportPayload('sess1');
    const csv = serializeExport(payload, 'csv');
    // The session name should be wrapped in quotes with inner quotes doubled.
    expect(csv).toContain('"Leg Day, Heavy ""Push"""');
  });

  it('empty sessions produce header-only CSV', async () => {
    dbGetAll
      .mockImplementationOnce(async () => mkSessionRow())
      .mockImplementationOnce(async () => [])
      .mockImplementationOnce(async () => []);
    const payload = await buildSessionExportPayload('sess1');
    const csv = serializeExport(payload, 'csv');
    expect(csv.split('\n')).toHaveLength(1);
    expect(csv).toContain('session_id');
  });
});

// ---------------------------------------------------------------------------
// exportSession end-to-end
// ---------------------------------------------------------------------------

describe('exportSession', () => {
  it('writes a JSON file and returns path + byte count + format', async () => {
    stubQueries();
    const result = await exportSession('sess1', 'json');
    expect(result.format).toBe('json');
    expect(result.bytes).toBeGreaterThan(0);
    expect(result.path).toContain('exports/');
    expect(writeMock).toHaveBeenCalledTimes(1);
    const [calledPath, calledBody] = writeMock.mock.calls[0];
    expect(calledPath).toBe(result.path);
    expect(typeof calledBody).toBe('string');
    expect(calledBody.startsWith('{')).toBe(true);
  });

  it('writes a CSV file when format=csv', async () => {
    stubQueries();
    const result = await exportSession('sess1', 'csv');
    expect(result.format).toBe('csv');
    const [, body] = writeMock.mock.calls[0];
    expect(body.startsWith('session_id,')).toBe(true);
  });

  it('creates the exports/ subdirectory if missing', async () => {
    getInfoMock.mockResolvedValueOnce({ exists: false });
    stubQueries();
    await exportSession('sess1', 'json');
    expect(makeDirMock).toHaveBeenCalledWith(
      'file:///tmp/ff-test/exports/',
      { intermediates: true },
    );
  });

  it('skips makeDirectory when exports/ already exists', async () => {
    getInfoMock.mockResolvedValueOnce({ exists: true });
    stubQueries();
    await exportSession('sess1', 'json');
    expect(makeDirMock).not.toHaveBeenCalled();
  });

  it('propagates missing-session errors from the payload builder', async () => {
    dbGetAll.mockImplementationOnce(async () => []);
    await expect(exportSession('missing', 'json')).rejects.toThrow(
      /not found/,
    );
    expect(writeMock).not.toHaveBeenCalled();
  });
});
