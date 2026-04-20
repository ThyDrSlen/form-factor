/**
 * Session Snapshot
 *
 * Lightweight capture of an in-progress form-tracking session so the user
 * can quit mid-session without losing the rep count + form score + fault
 * list. Stored in AsyncStorage rather than the local SQLite DB so we can
 * ship without a migration; the schema is explicitly versioned so we can
 * migrate up later if we need persistent history.
 *
 * A snapshot is *not* a completed workout. It is a breadcrumb the debrief
 * screen can read back ("you ran 7 pullups, FQI 84 before you closed the
 * app") so the moment is not lost. Full workouts still go through the
 * session-runner / local-db pipeline as before.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export const SESSION_SNAPSHOT_STORAGE_KEY = 'form_session_snapshots_v1';
export const SESSION_SNAPSHOT_MAX_ENTRIES = 25;
export const SESSION_SNAPSHOT_SCHEMA_VERSION = 1;

export interface SessionSnapshotFault {
  /** Fault identifier (e.g. 'shallow_rom', 'hip_drop'). Free-form string. */
  key: string;
  /** Number of times this fault fired during the session. */
  count: number;
}

export interface SessionSnapshotInput {
  exerciseKey: string;
  repCount: number;
  currentFqi: number | null;
  faults?: SessionSnapshotFault[];
  /** ISO timestamp the session started. */
  startedAt: string;
  /** Optional sessionId — helpful if the user later resumes. */
  sessionId?: string;
  /** Optional notes field for the user / UI. */
  note?: string;
}

export interface SessionSnapshot extends SessionSnapshotInput {
  id: string;
  /** ISO timestamp the snapshot was saved. */
  savedAt: string;
  /** Version of the on-disk schema. */
  schemaVersion: number;
}

function safeParse(raw: string | null): SessionSnapshot[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSnapshot);
  } catch {
    return [];
  }
}

function isSnapshot(value: unknown): value is SessionSnapshot {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    typeof v.exerciseKey === 'string' &&
    typeof v.repCount === 'number' &&
    typeof v.startedAt === 'string' &&
    typeof v.savedAt === 'string'
  );
}

function generateSnapshotId(): string {
  // Randomness is cheap here — snapshots are user-scoped + local-only.
  const rand = Math.random().toString(36).slice(2, 10);
  return `snap_${Date.now().toString(36)}_${rand}`;
}

/**
 * Persist a lightweight snapshot. Returns the stored record so the caller
 * can display its id / timestamp immediately. Never throws — AsyncStorage
 * failures are swallowed and an in-memory result is returned.
 */
export async function saveSessionSnapshot(
  input: SessionSnapshotInput,
): Promise<SessionSnapshot> {
  if (!input.exerciseKey) throw new Error('exerciseKey required');
  if (!input.startedAt) throw new Error('startedAt required');
  if (typeof input.repCount !== 'number' || Number.isNaN(input.repCount)) {
    throw new Error('repCount must be a finite number');
  }

  const record: SessionSnapshot = {
    ...input,
    repCount: Math.max(0, Math.trunc(input.repCount)),
    currentFqi:
      input.currentFqi == null || Number.isNaN(input.currentFqi)
        ? null
        : Math.max(0, Math.min(100, input.currentFqi)),
    faults: Array.isArray(input.faults) ? input.faults.slice(0, 10) : [],
    id: generateSnapshotId(),
    savedAt: new Date().toISOString(),
    schemaVersion: SESSION_SNAPSHOT_SCHEMA_VERSION,
  };

  try {
    const raw = await AsyncStorage.getItem(SESSION_SNAPSHOT_STORAGE_KEY);
    const existing = safeParse(raw);
    const next = [record, ...existing].slice(0, SESSION_SNAPSHOT_MAX_ENTRIES);
    await AsyncStorage.setItem(SESSION_SNAPSHOT_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // best-effort — the record is still returned so the caller can show it
  }

  return record;
}

/**
 * Read back all stored snapshots, newest first. Returns an empty array on
 * corrupt storage rather than throwing.
 */
export async function listSessionSnapshots(): Promise<SessionSnapshot[]> {
  try {
    const raw = await AsyncStorage.getItem(SESSION_SNAPSHOT_STORAGE_KEY);
    return safeParse(raw);
  } catch {
    return [];
  }
}

/**
 * Remove a single snapshot by id. Returns whether the record was found.
 * Idempotent — deleting a missing id is a no-op.
 */
export async function deleteSessionSnapshot(id: string): Promise<boolean> {
  try {
    const existing = await listSessionSnapshots();
    const next = existing.filter((s) => s.id !== id);
    if (next.length === existing.length) return false;
    await AsyncStorage.setItem(SESSION_SNAPSHOT_STORAGE_KEY, JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}

/**
 * Nuke all snapshots. Mainly useful for tests + a hidden settings action.
 */
export async function clearSessionSnapshots(): Promise<void> {
  try {
    await AsyncStorage.removeItem(SESSION_SNAPSHOT_STORAGE_KEY);
  } catch {
    // best-effort
  }
}
