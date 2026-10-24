/**
 * Generic Sync Adapter
 *
 * Provides a table-agnostic sync engine for bidirectional sync between
 * local SQLite and Supabase. Handles last-write-wins conflict resolution,
 * soft deletes, and sync queue integration.
 */

import { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { createError, logError } from '../ErrorHandler';
import { supabase } from '../../supabase';
import { localDB } from './local-db';
import { accountCleanup } from './account-cleanup';
import { getQueuedSyncRecordIds } from './sync-retry-policy';
import type { WorkoutSyncTableName } from './sync-types';
import { errorWithTs, logWithTs, warnWithTs } from '@/lib/logger';

// =============================================================================
// Types
// =============================================================================

export interface SyncTableConfig {
  /** Local SQLite table name */
  localTable: WorkoutSyncTableName;
  /** Supabase table name (usually same as localTable) */
  supabaseTable: WorkoutSyncTableName;
  /** Primary key column name */
  primaryKey: string;
  /** Whether records are scoped to a user (has user_id column on Supabase) */
  userScoped: boolean;
  /** Whether this table supports soft delete (has deleted column locally) */
  supportsSoftDelete: boolean;
  /** Whether this table is append-only (no updates/deletes synced) */
  appendOnly: boolean;
  /** Columns to sync (excluding synced, deleted, and updated_at which are managed) */
  columns: string[];
  /** SQLite stores booleans as 0/1; Postgres expects booleans. */
  booleanColumns?: string[];
  /** Optional: Supabase upsert conflict columns */
  onConflict?: string;
  /** Optional: transform local row to Supabase row */
  localToRemote?: (row: Record<string, unknown>, userId: string) => Record<string, unknown>;
  /** Optional: transform Supabase row to local row */
  remoteToLocal?: (row: Record<string, unknown>) => Record<string, unknown>;
}

type GenericRealtimePayload = RealtimePostgresChangesPayload<Record<string, unknown>>;

// =============================================================================
// Generic Local DB Operations
// =============================================================================

async function runGenericWrite(
  db: typeof localDB.db,
  sql: string,
  values: (string | number | null)[],
  assertCurrent?: () => void,
): Promise<void> {
  if (!db) throw new Error('Database not initialized');
  if (!assertCurrent) {
    await db.runAsync(sql, values);
    return;
  }
  const assertWritable = () => {
    assertCurrent();
    if (localDB.db !== db) throw new Error('Database connection changed during generic sync');
  };
  assertWritable();
  const statement = await db.prepareAsync(sql);
  try {
    // Expo runAsync otherwise hides this await between validation and execution.
    assertWritable();
    await statement.executeAsync(values);
  } finally {
    await statement.finalizeAsync();
  }
}

/**
 * Generic upsert into a local SQLite table.
 * Sets synced=syncedValue, updated_at=now if not provided.
 */
export async function genericLocalUpsert(
  table: string,
  primaryKey: string,
  row: Record<string, unknown>,
  synced: number = 0,
  expectedUpdatedAt?: string,
  assertCurrent?: () => void,
): Promise<void> {
  assertValidTableName(table);

  const db = localDB.db;
  if (!db) throw new Error('Database not initialized');

  const columns = Object.keys(row).filter(col => table !== 'workout_session_events' || col !== 'updated_at');
  // Ensure synced and updated_at are included
  if (!columns.includes('synced')) columns.push('synced');
  if (table !== 'workout_session_events' && !columns.includes('updated_at')) columns.push('updated_at');

  const values: (string | number | null)[] = columns.map((col) => {
    if (col === 'synced') return synced;
    if (col === 'updated_at') return (row.updated_at as string) ?? new Date().toISOString();
    const v = row[col];
    if (v === undefined || v === null) return null;
    if (typeof v === 'string' || typeof v === 'number') return v;
    if (typeof v === 'boolean') return v ? 1 : 0;
    return String(v);
  });

  if (expectedUpdatedAt !== undefined) {
    // A captured-version reconciliation may only update the row we observed.
    // An upsert's conflict guard does not guard its INSERT branch, which would
    // resurrect a row removed while the remote request was in flight.
    await runGenericWrite(db,
      `UPDATE ${table} SET ${columns.map(col => `${col} = ?`).join(', ')} WHERE ${primaryKey} = ? AND updated_at = ?`,
      [...values, String(row[primaryKey]), expectedUpdatedAt],
      assertCurrent,
    );
    return;
  }

  const placeholders = columns.map(() => '?').join(', ');
  const colNames = columns.join(', ');
  await runGenericWrite(db,
    `INSERT INTO ${table} (${colNames}) VALUES (${placeholders}) ON CONFLICT(${primaryKey}) DO UPDATE SET ${columns.filter(col => col !== primaryKey).map(col => `${col} = excluded.${col}`).join(', ')}`,
    values,
    assertCurrent,
  );
}

/**
 * Generic get unsynced rows from a local table.
 */
export async function genericGetUnsynced(
  table: string,
  supportsSoftDelete: boolean,
): Promise<Record<string, unknown>[]> {
  assertValidTableName(table);

  const db = localDB.db;
  if (!db) throw new Error('Database not initialized');

  const query = supportsSoftDelete
    ? `SELECT * FROM ${table} WHERE synced = 0`
    : `SELECT * FROM ${table} WHERE synced = 0`;

  return await db.getAllAsync<Record<string, unknown>>(query);
}

/**
 * Generic get by ID from a local table.
 */
export async function genericGetById(
  table: string,
  primaryKey: string,
  id: string,
  includeDeleted = true,
): Promise<Record<string, unknown> | null> {
  const db = localDB.db;
  if (!db) throw new Error('Database not initialized');

  const query = includeDeleted
    ? `SELECT * FROM ${table} WHERE ${primaryKey} = ?`
    : `SELECT * FROM ${table} WHERE ${primaryKey} = ? AND deleted = 0`;

  const rows = await db.getAllAsync<Record<string, unknown>>(query, [id]);
  return rows[0] ?? null;
}

/**
 * Generic update sync status.
 */
export async function genericUpdateSyncStatus(
  table: string,
  primaryKey: string,
  id: string,
  synced: boolean,
  expectedVersion?: string | Record<string, unknown>,
  assertCurrent?: () => void,
): Promise<void> {
  assertValidTableName(table);

  const db = localDB.db;
  if (!db) throw new Error('Database not initialized');

  // Millisecond timestamps are not revision tokens. Uploads acknowledge only
  // the captured content, including tombstones and nullable fields, atomically.
  const captured = typeof expectedVersion === 'string'
    ? { updated_at: expectedVersion } : expectedVersion;
  const entries = Object.entries(captured ?? {});
  const guard = entries.map(([column]) => ` AND "${column.replace(/"/g, '""')}" IS ?`).join('');
  const values = entries.map(([, value]) => {
    if (value === undefined || value === null) return null;
    if (typeof value === 'boolean') return value ? 1 : 0;
    return typeof value === 'number' ? value : String(value);
  });
  await runGenericWrite(db,
    `UPDATE ${table} SET synced = ? WHERE ${primaryKey} = ?${guard}`,
    [synced ? 1 : 0, id, ...values],
    assertCurrent,
  );
}

/**
 * Generic soft delete.
 */
export async function genericSoftDelete(
  table: string,
  primaryKey: string,
  id: string,
): Promise<void> {
  assertValidTableName(table);

  const db = localDB.db;
  if (!db) throw new Error('Database not initialized');

  await db.runAsync(
    `UPDATE ${table} SET deleted = 1, synced = 0, updated_at = ? WHERE ${primaryKey} = ?`,
    [new Date().toISOString(), id],
  );
}

/**
 * Generic hard delete.
 */
export async function genericHardDelete(
  table: string,
  primaryKey: string,
  id: string,
  assertCurrent?: () => void,
): Promise<void> {
  assertValidTableName(table);

  const db = localDB.db;
  if (!db) throw new Error('Database not initialized');

  await runGenericWrite(db, `DELETE FROM ${table} WHERE ${primaryKey} = ?`, [id], assertCurrent);
}

/**
 * Generic get all rows (optionally including deleted).
 */
export async function genericGetAll(
  table: string,
  supportsSoftDelete: boolean,
  includeDeleted = false,
  orderBy?: string,
): Promise<Record<string, unknown>[]> {
  const db = localDB.db;
  if (!db) throw new Error('Database not initialized');

  let query = `SELECT * FROM ${table}`;
  if (supportsSoftDelete && !includeDeleted) {
    query += ' WHERE deleted = 0';
  }
  if (orderBy) {
    query += ` ORDER BY ${orderBy}`;
  }

  return await db.getAllAsync<Record<string, unknown>>(query);
}

// =============================================================================
// Generic Sync Operations
// =============================================================================

// Capture before the durable-storage await. Completed cleanup still invalidates
// old work, even when the same account signs back in before its response arrives.
function captureCleanupGuard(): () => void {
  const generation = accountCleanup.generation;
  const db = localDB.db;
  return () => {
    if (accountCleanup.isBlocked || generation !== accountCleanup.generation) {
      throw new Error('Account cleanup invalidated generic sync');
    }
    if (localDB.db !== db) throw new Error('Database connection changed during generic sync');
  };
}

/**
 * Sync local changes for a single table to Supabase.
 */
export async function syncTableToSupabase(
  config: SyncTableConfig,
  userId: string,
): Promise<void> {
  const assertCurrent = captureCleanupGuard();
  await accountCleanup.assertReady();
  assertCurrent();
  const unsynced = await genericGetUnsynced(config.localTable, config.supportsSoftDelete);
  assertCurrent();
  if (unsynced.length === 0) return;

  const queuedIds = await getQueuedSyncRecordIds(config.supabaseTable);
  assertCurrent();
  const label = config.supabaseTable;
  logWithTs(`[GenericSync] Syncing ${unsynced.length} ${label} rows to Supabase`);

  // Only the queue worker retries queued rows. A direct retry would reset the
  // queue entry on failure, then attempt it again in the same sync pass.
  for (const row of unsynced) {
    const id = String(row[config.primaryKey]);
    if (queuedIds.has(id)) continue;
    const isDeleted = config.supportsSoftDelete && row.deleted === 1;
    try {
      await syncWorkoutRowToSupabase(config, row, userId);
      assertCurrent();
    } catch (error) {
      assertCurrent(); // Cancellation must never enqueue retired account data.
      errorWithTs(`[GenericSync] Failed to sync ${label} ${id}:`, error);
      // Add to sync queue for retry
      const cleanRow = { ...row };
      delete cleanRow.synced;
      delete cleanRow.deleted;
      await localDB.addToSyncQueue(
        config.supabaseTable,
        isDeleted ? 'delete' : 'upsert',
        id,
        cleanRow,
      );
      assertCurrent();
    }
  }
}

/** Shared writer for initial uploads and queued retries. */
export async function syncWorkoutRowToSupabase(
  config: SyncTableConfig,
  row: Record<string, unknown>,
  userId: string,
): Promise<void> {
  const assertCurrent = captureCleanupGuard();
  await accountCleanup.assertReady();
  assertCurrent();
  const id = String(row[config.primaryKey]);
  const label = config.supabaseTable;
  const isDeleted = config.supportsSoftDelete && row.deleted === 1;

  // Resolve persisted ownership for the entire session graph. Neither the
  // current login nor a queued payload may claim unidentified device data.
  const ownershipJoins: Record<string, string> = {
    workout_sessions: 'workout_sessions ws',
    workout_session_exercises: 'workout_session_exercises child JOIN workout_sessions ws ON ws.id = child.session_id',
    workout_session_sets: 'workout_session_sets child JOIN workout_session_exercises ex ON ex.id = child.session_exercise_id JOIN workout_sessions ws ON ws.id = ex.session_id',
    workout_session_events: 'workout_session_events child JOIN workout_sessions ws ON ws.id = child.session_id',
  };
  const ownershipJoin = ownershipJoins[config.localTable];
  if (ownershipJoin) {
    const rows = await localDB.db!.getAllAsync<{ user_id: string | null }>(
      `SELECT ws.user_id FROM ${ownershipJoin} WHERE ${config.localTable === 'workout_sessions' ? 'ws' : 'child'}.id = ?`, [id],
    );
    assertCurrent();
    if (!userId || rows[0]?.user_id !== userId) throw new Error('Session ownership is unknown or belongs to another account');
  }

  if (isDeleted) {
    const { error } = await supabase
      .from(config.supabaseTable)
      .delete()
      .eq(config.primaryKey, id);
    assertCurrent();
    if (error) throw error;
    await genericUpdateSyncStatus(config.localTable, config.primaryKey, id, true, row, assertCurrent);
    assertCurrent();
    return;
  }

  if (config.appendOnly) {
    // Append-only: just insert, skip conflict check
    const remoteRow = buildRemoteRow(config, row, userId);
    const { error } = await supabase.from(config.supabaseTable).upsert([remoteRow], { onConflict: config.primaryKey, ignoreDuplicates: true });
    assertCurrent();
    if (error) throw error;
    await genericUpdateSyncStatus(config.localTable, config.primaryKey, id, true, row, assertCurrent);
    assertCurrent();
    return;
  }

  // Check server timestamp for last-write-wins
  const { data: existing, error: fetchError } = await supabase
    .from(config.supabaseTable)
    .select('*')
    .eq(config.primaryKey, id)
    .single();
  assertCurrent();

  if (fetchError && fetchError.code !== 'PGRST116') {
    throw fetchError;
  }

  if (config.localTable === 'workout_sessions' && existing && existing.user_id !== userId) {
    throw new Error('Server session ownership does not match the local owner');
  }

  // Server wins if newer
  if (existing && new Date(existing.updated_at) > new Date(String(row.updated_at))) {
    logWithTs(`[GenericSync] Server ${label} ${id} is newer, skipping`);
    const localRow = config.remoteToLocal
      ? config.remoteToLocal(existing)
      : stripRemoteOnlyFields(existing, config.userScoped);
    await genericLocalUpsert(config.localTable, config.primaryKey, { ...localRow, [config.primaryKey]: id }, 1, typeof row.updated_at === 'string' ? row.updated_at : undefined, assertCurrent);
    assertCurrent();
    return;
  }

  // Push local version to server
  const remoteRow = buildRemoteRow(config, row, userId);
  const upsertOpts = config.onConflict ? { onConflict: config.onConflict } : undefined;
  const { error } = await supabase
    .from(config.supabaseTable)
    .upsert([remoteRow], upsertOpts);
  assertCurrent();
  if (error) throw error;
  await genericUpdateSyncStatus(config.localTable, config.primaryKey, id, true, row, assertCurrent);
  assertCurrent();
  logWithTs(`[GenericSync] Synced ${label} ${id} to server`);
}

/**
 * Download all rows from Supabase for a table and merge into local DB.
 */
export async function downloadTableFromSupabase(
  config: SyncTableConfig,
  userId: string,
): Promise<void> {
  const assertCurrent = captureCleanupGuard();
  await accountCleanup.assertReady();
  assertCurrent();
  const label = config.supabaseTable;

  try {
    const remoteRows: Record<string, unknown>[] = [];
    const pageSize = 500;
    for (let offset = 0; ; offset += pageSize) {
      let query = supabase.from(config.supabaseTable).select('*');
      if (config.userScoped) query = query.eq('user_id', userId);
      const { data, error } = await query.order(config.primaryKey).range(offset, offset + pageSize - 1);
      assertCurrent();
      if (error) throw error;
      remoteRows.push(...(data ?? []));
      if (!data || data.length < pageSize) break;
    }

    const localRows = await genericGetAll(
      config.localTable,
      config.supportsSoftDelete,
      true, // include deleted
    );
    assertCurrent();
    const localMap = new Map(
      localRows.map((r) => [String(r[config.primaryKey]), r]),
    );

    if (remoteRows && remoteRows.length > 0) {
      for (const remoteRow of remoteRows) {
        const id = String(remoteRow[config.primaryKey]);
        const local = localMap.get(id);
        if (config.localTable === 'workout_sessions') {
          // Ownership comes from the verified server row, never the sync login.
          if (remoteRow.user_id !== userId || !userId) continue;
          if (local?.user_id && local.user_id !== remoteRow.user_id) continue;
          await runGenericWrite(localDB.db,
            'UPDATE workout_sessions SET user_id = ? WHERE id = ? AND user_id IS NULL',
            [userId, id],
            assertCurrent,
          );
          assertCurrent();
        }

        // Local soft-delete pending sync wins
        if (local && config.supportsSoftDelete && local.deleted === 1 && local.synced === 0) {
          continue;
        }

        // Local is newer? Skip
        if (local && local.updated_at && remoteRow.updated_at) {
          if (new Date(String(local.updated_at)) > new Date(String(remoteRow.updated_at))) {
            continue;
          }
        }

        // Transform and upsert locally
        const localRow = config.remoteToLocal
          ? config.remoteToLocal(remoteRow)
          : stripRemoteOnlyFields(remoteRow as Record<string, unknown>, config.userScoped);

        await genericLocalUpsert(config.localTable, config.primaryKey, localRow, 1, typeof local?.updated_at === 'string' && !config.appendOnly ? local.updated_at : undefined, assertCurrent);
        assertCurrent();
      }
      logWithTs(`[GenericSync] Downloaded ${remoteRows.length} ${label} rows`);
    }

    // Absence can mean changed visibility or concurrent pagination, not deletion.
    // Only explicit delete events or acknowledged local tombstones remove rows.
  } catch (error) {
    errorWithTs(`[GenericSync] Error downloading ${label}:`, error);
    // The coordinator owns the final status. Logging must not convert an
    // incomplete download or failed local write into successful recovery.
    throw error;
  }
}

/**
 * Handle a realtime change event for a generic table.
 *
 * When the local DB operation fails the error is surfaced via `onError`
 * so the caller (SyncService) can set its status to 'error' and schedule
 * a full resync to recover the lost change.
 */
export async function handleGenericRealtimeChange(
  config: SyncTableConfig,
  payload: GenericRealtimePayload,
  notifyCallback: () => void,
  scheduleConflictReconcile: (reason: string) => void,
  onError?: (table: string, error: unknown) => void,
): Promise<void> {
  const label = config.supabaseTable;

  try {
    const newRow = payload.new as Partial<Record<string, unknown>>;
    const assertCurrent = captureCleanupGuard();
    await accountCleanup.assertReady();
    assertCurrent();
    const oldRow = payload.old as Partial<Record<string, unknown>>;

    if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
      const id = newRow[config.primaryKey];
      if (!id || typeof id !== 'string') return;

      const local = await genericGetById(config.localTable, config.primaryKey, id, true);

      assertCurrent();
      if (config.localTable === 'workout_sessions') {
        if (typeof newRow.user_id !== 'string' || !newRow.user_id.trim()) return;
        if (local?.user_id && local.user_id !== newRow.user_id) return;
        await runGenericWrite(localDB.db,
          'UPDATE workout_sessions SET user_id = ? WHERE id = ? AND user_id IS NULL',
          [newRow.user_id, id],
          assertCurrent,
        );
        assertCurrent();
      }

      // Local unsynced wins
      if (local && local.synced === 0) {
        logWithTs(`[GenericSync] Local ${label} ${id} has unsynced changes, keeping local`);
        scheduleConflictReconcile(`${label}:${id}`);
        return;
      }

      const localRow = config.remoteToLocal
        ? config.remoteToLocal(newRow as Record<string, unknown>)
        : stripRemoteOnlyFields(newRow as Record<string, unknown>, config.userScoped);

      await genericLocalUpsert(config.localTable, config.primaryKey, localRow, 1, typeof local?.updated_at === 'string' && !config.appendOnly ? local.updated_at : undefined, assertCurrent);
      assertCurrent();
      notifyCallback();
    } else if (payload.eventType === 'DELETE') {
      const id = oldRow[config.primaryKey];
      if (!id || typeof id !== 'string') return;
      const local = await genericGetById(config.localTable, config.primaryKey, id, true);
      assertCurrent();
      if (local?.synced === 0) {
        scheduleConflictReconcile(`${label}:${id}`);
        return;
      }
      await genericHardDelete(config.localTable, config.primaryKey, id as string, assertCurrent);
      assertCurrent();
      notifyCallback();
    }
  } catch (error) {
    errorWithTs(
      `[GenericSync] Error handling realtime ${label} change:`,
      error instanceof Error ? error : new Error(String(error)),
    );
    const appError = createError(
      'sync',
      'REALTIME_CHANGE_FAILED',
      `Failed to apply realtime ${payload.eventType} for ${label}`,
      {
        details: { table: label, eventType: payload.eventType, error },
        retryable: true,
        severity: 'error',
      },
    );
    logError(appError, {
      feature: 'workouts',
      location: 'generic-sync.handleGenericRealtimeChange',
      meta: { table: label, eventType: payload.eventType },
    });
    onError?.(label, error);
  }
}

// =============================================================================
// Helpers
// =============================================================================

export function buildRemoteRow(
  config: SyncTableConfig,
  localRow: Record<string, unknown>,
  userId: string,
): Record<string, unknown> {
  if (config.localToRemote) {
    return config.localToRemote(localRow, userId);
  }

  // Select remote columns and add ownership only where the schema declares it.
  const remote: Record<string, unknown> = {};
  for (const col of config.columns) {
    if (col in localRow) {
      const value = localRow[col];
      remote[col] = config.booleanColumns?.includes(col) && (value === 0 || value === 1)
        ? value === 1 : value;
    }
  }
  // Always include PK
  remote[config.primaryKey] = localRow[config.primaryKey];
  if (config.userScoped) {
    remote.user_id = userId;
  }
  if (localRow.updated_at) {
    remote.updated_at = localRow.updated_at;
  }
  return remote;
}

function stripRemoteOnlyFields(
  row: Record<string, unknown>,
  stripUserId = false,
): Record<string, unknown> {
  const local = { ...row };
  if (stripUserId) delete local.user_id; // local schema omits user_id for user-scoped tables
  return local;
}

// =============================================================================
// Table Configs for Workout Session Tables
// =============================================================================

const workoutSessionColumns = [
  'id', 'template_id', 'name', 'goal_profile', 'started_at', 'ended_at',
  'timezone_offset_minutes', 'bodyweight_lb', 'notes',
];

const workoutSessionExerciseColumns = [
  'id', 'session_id', 'exercise_id', 'sort_order', 'notes',
];

const workoutSessionSetColumns = [
  'id', 'session_exercise_id', 'sort_order', 'set_type',
  'planned_reps', 'planned_seconds', 'planned_weight',
  'actual_reps', 'actual_seconds', 'actual_weight',
  'started_at', 'completed_at',
  'rest_target_seconds', 'rest_started_at', 'rest_completed_at', 'rest_skipped',
  'tut_ms', 'tut_source',
  'perceived_rpe', 'notes',
];

const workoutSessionEventColumns = [
  'id', 'session_id', 'type', 'session_exercise_id', 'session_set_id', 'payload',
];

const workoutTemplateColumns = [
  'id', 'name', 'description', 'goal_profile', 'is_public', 'share_slug',
];

const workoutTemplateExerciseColumns = [
  'id', 'template_id', 'exercise_id', 'sort_order', 'notes',
  'default_rest_seconds', 'default_tempo',
];

const workoutTemplateSetColumns = [
  'id', 'template_exercise_id', 'sort_order', 'set_type',
  'target_reps', 'target_seconds', 'target_weight', 'target_rpe',
  'rest_seconds_override', 'notes',
];

const exerciseColumns = [
  'id', 'name', 'category', 'muscle_group', 'is_compound', 'is_timed',
  'is_system', 'created_by',
];

export const WORKOUT_SYNC_CONFIGS: SyncTableConfig[] = [
  {
    localTable: 'exercises',
    supabaseTable: 'exercises',
    primaryKey: 'id',
    userScoped: false,
    supportsSoftDelete: false,
    appendOnly: false,
    columns: exerciseColumns,
    booleanColumns: ['is_compound', 'is_timed', 'is_system'],
  },
  {
    localTable: 'workout_templates',
    supabaseTable: 'workout_templates',
    primaryKey: 'id',
    userScoped: true,
    supportsSoftDelete: true,
    appendOnly: false,
    columns: workoutTemplateColumns,
    booleanColumns: ['is_public'],
  },
  {
    localTable: 'workout_template_exercises',
    supabaseTable: 'workout_template_exercises',
    primaryKey: 'id',
    userScoped: false,
    supportsSoftDelete: true,
    appendOnly: false,
    columns: workoutTemplateExerciseColumns,
  },
  {
    localTable: 'workout_template_sets',
    supabaseTable: 'workout_template_sets',
    primaryKey: 'id',
    userScoped: false,
    supportsSoftDelete: true,
    appendOnly: false,
    columns: workoutTemplateSetColumns,
  },
  {
    localTable: 'workout_sessions',
    supabaseTable: 'workout_sessions',
    primaryKey: 'id',
    userScoped: true,
    supportsSoftDelete: true,
    appendOnly: false,
    columns: workoutSessionColumns,
    remoteToLocal: row => ({ ...row }), // user_id is persisted locally for sessions
  },
  {
    localTable: 'workout_session_exercises',
    supabaseTable: 'workout_session_exercises',
    primaryKey: 'id',
    userScoped: false,
    supportsSoftDelete: true,
    appendOnly: false,
    columns: workoutSessionExerciseColumns,
  },
  {
    localTable: 'workout_session_sets',
    supabaseTable: 'workout_session_sets',
    primaryKey: 'id',
    userScoped: false,
    supportsSoftDelete: true,
    appendOnly: false,
    columns: workoutSessionSetColumns,
    booleanColumns: ['rest_skipped'],
  },
  {
    localTable: 'workout_session_events',
    supabaseTable: 'workout_session_events',
    primaryKey: 'id',
    userScoped: false,
    supportsSoftDelete: false,
    appendOnly: true,
    columns: workoutSessionEventColumns,
    localToRemote: (row, _userId) => {
      const remote: Record<string, unknown> = {};
      for (const col of workoutSessionEventColumns) {
        if (col === 'payload') {
          // payload is stored as JSON string locally, but jsonb on Supabase
          if (typeof row[col] === 'string') {
            try {
              remote[col] = JSON.parse(row[col] as string);
            } catch {
              warnWithTs(
                `[generic-sync] Failed to parse JSON for column "${col}"` +
                  (row.id ? ` (row id: ${row.id})` : '') +
                  `, falling back to raw value`,
              );
              remote[col] = row[col];
            }
          } else {
            remote[col] = row[col];
          }
        } else if (col in row) {
          remote[col] = row[col];
        }
      }
      remote.created_at = row.created_at;
      return remote;
    },
    remoteToLocal: (row) => {
      const local = { ...row };
      // Store payload as JSON string locally
      if (local.payload && typeof local.payload === 'object') {
        local.payload = JSON.stringify(local.payload);
      }
      return local;
    },
  },
];

export const VALID_TABLE_NAMES = new Set<string>(
  WORKOUT_SYNC_CONFIGS.flatMap((config) => [config.localTable, config.supabaseTable]),
);

function assertValidTableName(table: string): void {
  if (VALID_TABLE_NAMES.has(table)) {
    return;
  }

  const appError = createError(
    'sync',
    'INVALID_SYNC_TABLE',
    `Invalid sync table name "${table}". Expected one of: ${Array.from(VALID_TABLE_NAMES).sort().join(', ')}`,
    {
      details: {
        table,
        validTableNames: Array.from(VALID_TABLE_NAMES).sort(),
      },
      retryable: false,
      severity: 'error',
    },
  );

  logError(appError, {
    feature: 'workouts',
    location: 'generic-sync.assertValidTableName',
    meta: { table },
  });

  throw new Error(appError.message);
}

/** Replace offline catalog IDs with server IDs without losing workout references. */
export async function reconcileSystemExerciseIds(): Promise<void> {
  const assertCurrent = captureCleanupGuard();
  await accountCleanup.assertReady();
  assertCurrent();
  const db = localDB.db;
  if (!db) return;
  const seeds = await db.getAllAsync<Record<string, unknown>>(
    "SELECT * FROM exercises WHERE is_system = 1 AND id LIKE 'seed-%'",
  );
  assertCurrent();
  if (!seeds.length) return;
  const { data: catalog, error } = await supabase.from('exercises').select('*')
    .eq('is_system', true).in('name', seeds.map(row => String(row.name)));
  assertCurrent();
  if (error) throw error;
  const mappings = seeds.map(seed => {
    const matches = (catalog ?? []).filter(remote => remote.name === seed.name && remote.category === seed.category);
    if (matches.length !== 1) throw new Error(`Cannot resolve system exercise "${String(seed.name)}" in the server catalog`);
    return { seed, remote: matches[0] };
  });
  await localDB.withTransaction(async () => {
    assertCurrent();
    for (const { seed, remote } of mappings) {
      await genericLocalUpsert('exercises', 'id', stripRemoteOnlyFields(remote), 1, undefined, assertCurrent);
      assertCurrent();
      for (const table of ['workout_template_exercises', 'workout_session_exercises']) {
        await runGenericWrite(db, `UPDATE ${table} SET exercise_id = ?, synced = 0 WHERE exercise_id = ?`, [remote.id, String(seed.id)], assertCurrent);
        assertCurrent();
      }
      await runGenericWrite(db, "DELETE FROM sync_queue WHERE table_name = 'exercises' AND record_id = ?", [String(seed.id)], assertCurrent);
      assertCurrent();
      await genericHardDelete('exercises', 'id', String(seed.id), assertCurrent);
      assertCurrent();
    }
  });
  assertCurrent();
}

/**
 * Run sync for all workout-related tables.
 */
export async function syncAllWorkoutTablesToSupabase(userId: string): Promise<void> {
  const assertCurrent = captureCleanupGuard();
  await accountCleanup.assertReady();
  assertCurrent();
  await reconcileSystemExerciseIds();
  assertCurrent();
  for (const config of WORKOUT_SYNC_CONFIGS) {
    await syncTableToSupabase(config, userId);
    assertCurrent();
  }
}

/**
 * Download all workout-related tables from Supabase.
 */
export async function downloadAllWorkoutTablesFromSupabase(userId: string): Promise<void> {
  const assertCurrent = captureCleanupGuard();
  await accountCleanup.assertReady();
  assertCurrent();
  for (const config of WORKOUT_SYNC_CONFIGS) {
    await downloadTableFromSupabase(config, userId);
    assertCurrent();
  }
}

/**
 * Cleanup synced soft-deleted rows across workout tables.
 */
export async function cleanupWorkoutSyncedDeletes(): Promise<void> {
  const assertCurrent = captureCleanupGuard();
  await accountCleanup.assertReady();
  assertCurrent();
  const db = localDB.db;
  if (!db) return;

  const tablesWithSoftDelete = WORKOUT_SYNC_CONFIGS.filter((c) => c.supportsSoftDelete);
  for (const config of tablesWithSoftDelete) {
    await runGenericWrite(db, `DELETE FROM ${config.localTable} WHERE deleted = 1 AND synced = 1`, [], assertCurrent);
    assertCurrent();
  }
}
