/**
 * Session Export Service
 *
 * Reads a workout session from local SQLite and writes a JSON or CSV
 * artefact to `expo-file-system` so the user can share it with a
 * trainer via the built-in `Share` sheet. No new deps: uses
 * `expo-file-system` (already a project dep) and `react-native`'s
 * `Share`.
 *
 * CSV schema (one row per rep):
 *   session_id, session_name, exercise_id, exercise_name,
 *   set_sort_order, set_type, rep_number, actual_weight,
 *   actual_reps, actual_seconds, planned_weight, planned_reps,
 *   perceived_rpe, tut_ms, tut_source, fqi_score, faults,
 *   completed_at
 *
 * JSON schema: the structured `SessionExportPayload` below.
 *
 * TODO(#461): once `lib/services/coach-service.ts` lands coach memory
 * enrichment, add a `coach_notes` column pulled from the daily debrief.
 */
import * as FileSystem from 'expo-file-system/legacy';

import { localDB } from '@/lib/services/database/local-db';
import { logWithTs } from '@/lib/logger';

// =============================================================================
// Public types
// =============================================================================

export type SessionExportFormat = 'json' | 'csv';

export interface SessionExportSetRow {
  sessionId: string;
  sessionName: string | null;
  exerciseId: string;
  exerciseName: string | null;
  setSortOrder: number;
  setType: string;
  /** Per-set number of reps (1 row per set). */
  actualReps: number | null;
  plannedReps: number | null;
  actualWeight: number | null;
  plannedWeight: number | null;
  actualSeconds: number | null;
  perceivedRpe: number | null;
  tutMs: number | null;
  tutSource: string | null;
  /** Optional FQI score pulled from set notes if present. */
  fqiScore: number | null;
  /** Comma-separated fault IDs if present in set notes. */
  faults: string | null;
  completedAt: string | null;
}

export interface SessionExportPayload {
  schemaVersion: 1;
  generatedAt: string;
  session: {
    id: string;
    name: string | null;
    goalProfile: string;
    startedAt: string;
    endedAt: string | null;
    durationSeconds: number | null;
    bodyweightLb: number | null;
    notes: string | null;
  };
  exercises: {
    id: string;
    exerciseId: string;
    exerciseName: string | null;
    sortOrder: number;
    notes: string | null;
    sets: SessionExportSetRow[];
  }[];
  totalSetCount: number;
  totalVolumeLb: number;
}

export interface SessionExportResult {
  path: string;
  bytes: number;
  format: SessionExportFormat;
}

// =============================================================================
// Internal helpers — SQLite shape passthroughs
// =============================================================================

interface SessionRow {
  id: string;
  name: string | null;
  goal_profile: string;
  started_at: string;
  ended_at: string | null;
  bodyweight_lb: number | null;
  notes: string | null;
}

interface SessionExerciseRow {
  id: string;
  exercise_id: string;
  exercise_name: string | null;
  sort_order: number;
  notes: string | null;
}

interface SessionSetRow {
  id: string;
  session_exercise_id: string;
  sort_order: number;
  set_type: string;
  planned_reps: number | null;
  planned_seconds: number | null;
  planned_weight: number | null;
  actual_reps: number | null;
  actual_seconds: number | null;
  actual_weight: number | null;
  completed_at: string | null;
  perceived_rpe: number | null;
  tut_ms: number | null;
  tut_source: string | null;
  notes: string | null;
}

// =============================================================================
// Internal helpers
// =============================================================================

/**
 * Some rows store notes as JSON blobs with FQI / fault context. Parse
 * defensively so non-JSON notes (free-form) simply skip extraction.
 */
function parseSetNotes(notes: string | null): {
  fqiScore: number | null;
  faults: string | null;
} {
  if (!notes) return { fqiScore: null, faults: null };
  try {
    const parsed = JSON.parse(notes) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      return { fqiScore: null, faults: null };
    }
    const rec = parsed as Record<string, unknown>;
    const fqi =
      typeof rec.fqiScore === 'number'
        ? rec.fqiScore
        : typeof rec.fqi_score === 'number'
          ? rec.fqi_score
          : null;
    let faults: string | null = null;
    if (Array.isArray(rec.faults)) {
      faults = rec.faults
        .map((x) => (typeof x === 'string' ? x : (x as { id?: string })?.id))
        .filter((x): x is string => typeof x === 'string' && x.length > 0)
        .join(',');
    } else if (typeof rec.faults === 'string') {
      faults = rec.faults;
    }
    return { fqiScore: fqi, faults };
  } catch {
    return { fqiScore: null, faults: null };
  }
}

function escapeCsvField(value: string | number | null | undefined): string {
  if (value == null) return '';
  const s = String(value);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function rowsToCsv(rows: SessionExportSetRow[]): string {
  const header = [
    'session_id',
    'session_name',
    'exercise_id',
    'exercise_name',
    'set_sort_order',
    'set_type',
    'actual_reps',
    'planned_reps',
    'actual_weight',
    'planned_weight',
    'actual_seconds',
    'perceived_rpe',
    'tut_ms',
    'tut_source',
    'fqi_score',
    'faults',
    'completed_at',
  ];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push(
      [
        r.sessionId,
        r.sessionName,
        r.exerciseId,
        r.exerciseName,
        r.setSortOrder,
        r.setType,
        r.actualReps,
        r.plannedReps,
        r.actualWeight,
        r.plannedWeight,
        r.actualSeconds,
        r.perceivedRpe,
        r.tutMs,
        r.tutSource,
        r.fqiScore,
        r.faults,
        r.completedAt,
      ]
        .map(escapeCsvField)
        .join(','),
    );
  }
  return lines.join('\n');
}

// =============================================================================
// Database layer
// =============================================================================

/**
 * Build an in-memory `SessionExportPayload` for the given session id.
 * Exported for tests / previews — does NOT touch the filesystem.
 */
export async function buildSessionExportPayload(
  sessionId: string,
): Promise<SessionExportPayload> {
  const db = localDB.db;
  if (!db) {
    throw new Error('[session-export] local database not initialised');
  }

  const sessions = await db.getAllAsync<SessionRow>(
    `SELECT id, name, goal_profile, started_at, ended_at, bodyweight_lb, notes
       FROM workout_sessions
      WHERE id = ? AND deleted = 0`,
    [sessionId],
  );
  const session = sessions[0];
  if (!session) {
    throw new Error(`[session-export] session ${sessionId} not found`);
  }

  const exerciseRows = await db.getAllAsync<SessionExerciseRow>(
    `SELECT wse.id, wse.exercise_id, e.name AS exercise_name, wse.sort_order, wse.notes
       FROM workout_session_exercises wse
       LEFT JOIN exercises e ON e.id = wse.exercise_id
      WHERE wse.session_id = ? AND wse.deleted = 0
      ORDER BY wse.sort_order ASC`,
    [sessionId],
  );

  const exerciseIds = exerciseRows.map((r) => r.id);
  let setRows: SessionSetRow[] = [];
  if (exerciseIds.length > 0) {
    const placeholders = exerciseIds.map(() => '?').join(',');
    setRows = await db.getAllAsync<SessionSetRow>(
      `SELECT id, session_exercise_id, sort_order, set_type,
              planned_reps, planned_seconds, planned_weight,
              actual_reps, actual_seconds, actual_weight,
              completed_at, perceived_rpe, tut_ms, tut_source, notes
         FROM workout_session_sets
        WHERE session_exercise_id IN (${placeholders}) AND deleted = 0
        ORDER BY session_exercise_id, sort_order ASC`,
      exerciseIds,
    );
  }

  const sessionName = session.name;

  const exercises = exerciseRows.map((ex) => {
    const sets = setRows
      .filter((s) => s.session_exercise_id === ex.id)
      .map((s): SessionExportSetRow => {
        const extra = parseSetNotes(s.notes);
        return {
          sessionId: session.id,
          sessionName,
          exerciseId: ex.exercise_id,
          exerciseName: ex.exercise_name,
          setSortOrder: s.sort_order,
          setType: s.set_type,
          actualReps: s.actual_reps,
          plannedReps: s.planned_reps,
          actualWeight: s.actual_weight,
          plannedWeight: s.planned_weight,
          actualSeconds: s.actual_seconds,
          perceivedRpe: s.perceived_rpe,
          tutMs: s.tut_ms,
          tutSource: s.tut_source,
          fqiScore: extra.fqiScore,
          faults: extra.faults,
          completedAt: s.completed_at,
        };
      });
    return {
      id: ex.id,
      exerciseId: ex.exercise_id,
      exerciseName: ex.exercise_name,
      sortOrder: ex.sort_order,
      notes: ex.notes,
      sets,
    };
  });

  const totalSetCount = exercises.reduce((acc, ex) => acc + ex.sets.length, 0);
  const totalVolumeLb = exercises.reduce((acc, ex) => {
    return (
      acc +
      ex.sets.reduce((s, row) => {
        const reps = row.actualReps ?? 0;
        const weight = row.actualWeight ?? 0;
        return s + reps * weight;
      }, 0)
    );
  }, 0);

  const durationSeconds = session.ended_at
    ? Math.max(
        0,
        Math.round(
          (Date.parse(session.ended_at) - Date.parse(session.started_at)) / 1000,
        ),
      )
    : null;

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    session: {
      id: session.id,
      name: session.name,
      goalProfile: session.goal_profile,
      startedAt: session.started_at,
      endedAt: session.ended_at,
      durationSeconds,
      bodyweightLb: session.bodyweight_lb,
      notes: session.notes,
    },
    exercises,
    totalSetCount,
    totalVolumeLb,
  };
}

/** Flatten a payload into the CSV row list (1 row per set). */
export function payloadToSetRows(
  payload: SessionExportPayload,
): SessionExportSetRow[] {
  return payload.exercises.flatMap((ex) => ex.sets);
}

/** Serialize a payload to its final string content for the chosen format. */
export function serializeExport(
  payload: SessionExportPayload,
  format: SessionExportFormat,
): string {
  if (format === 'json') {
    return JSON.stringify(payload, null, 2);
  }
  return rowsToCsv(payloadToSetRows(payload));
}

// =============================================================================
// Filesystem layer
// =============================================================================

const EXPORT_SUBDIR = 'exports/';

/**
 * Build the absolute export file path inside the app's document directory.
 * Exported so tests can assert against a deterministic path prefix.
 */
export function buildExportPath(
  sessionId: string,
  format: SessionExportFormat,
  now: Date = new Date(),
): string {
  const base = FileSystem.documentDirectory ?? '';
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const safeSession = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${base}${EXPORT_SUBDIR}session-${safeSession}-${stamp}.${format}`;
}

async function ensureExportDir(): Promise<void> {
  const base = FileSystem.documentDirectory;
  if (!base) return;
  const dir = `${base}${EXPORT_SUBDIR}`;
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Export a session to disk and return the resulting path + byte size.
 * Host UI is responsible for calling `Share.share({ url: path })` (built
 * into React Native — no new dep).
 */
export async function exportSession(
  sessionId: string,
  format: SessionExportFormat,
): Promise<SessionExportResult> {
  const payload = await buildSessionExportPayload(sessionId);
  const content = serializeExport(payload, format);
  const path = buildExportPath(sessionId, format);
  await ensureExportDir();
  await FileSystem.writeAsStringAsync(path, content);
  const bytes = new TextEncoder().encode(content).byteLength;
  logWithTs('[session-export] wrote export', { path, bytes, format });
  return { path, bytes, format };
}
