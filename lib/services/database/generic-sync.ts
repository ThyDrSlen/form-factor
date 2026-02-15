/**
 * Generic Sync Adapter
 *
 * Provides a table-agnostic sync engine for bidirectional sync between
 * local SQLite and Supabase. Handles last-write-wins conflict resolution,
 * soft deletes, and sync queue integration.
 */

import { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { supabase } from '../../supabase';
import { localDB } from './local-db';
import { errorWithTs, logWithTs, warnWithTs } from '@/lib/logger';

// =============================================================================
// Types
// =============================================================================

export interface SyncTableConfig {
  /** Local SQLite table name */
  localTable: string;
  /** Supabase table name (usually same as localTable) */
  supabaseTable: string;
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

/**
 * Generic upsert into a local SQLite table.
 * Sets synced=syncedValue, updated_at=now if not provided.
 */
export async function genericLocalUpsert(
  table: string,
  primaryKey: string,
  row: Record<string, unknown>,
  synced: number = 0,
): Promise<void> {
  const db = localDB.db;
  if (!db) throw new Error('Database not initialized');

  const columns = Object.keys(row);
  // Ensure synced and updated_at are included
  if (!columns.includes('synced')) columns.push('synced');
  if (!columns.includes('updated_at')) columns.push('updated_at');

  const values: (string | number | null)[] = columns.map((col) => {
    if (col === 'synced') return synced;
    if (col === 'updated_at') return (row.updated_at as string) ?? new Date().toISOString();
    const v = row[col];
    if (v === undefined || v === null) return null;
    if (typeof v === 'string' || typeof v === 'number') return v;
    if (typeof v === 'boolean') return v ? 1 : 0;
    return String(v);
  });

  const placeholders = columns.map(() => '?').join(', ');
  const colNames = columns.join(', ');

  await db.runAsync(
    `INSERT OR REPLACE INTO ${table} (${colNames}) VALUES (${placeholders})`,
    values,
  );
}

/**
 * Generic get unsynced rows from a local table.
 */
export async function genericGetUnsynced(
  table: string,
  supportsSoftDelete: boolean,
): Promise<Record<string, unknown>[]> {
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
): Promise<void> {
  const db = localDB.db;
  if (!db) throw new Error('Database not initialized');

  await db.runAsync(
    `UPDATE ${table} SET synced = ? WHERE ${primaryKey} = ?`,
    [synced ? 1 : 0, id],
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
): Promise<void> {
  const db = localDB.db;
  if (!db) throw new Error('Database not initialized');

  await db.runAsync(`DELETE FROM ${table} WHERE ${primaryKey} = ?`, [id]);
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

function getErrorCode(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

function isRlsViolation(error: unknown): boolean {
  return getErrorCode(error) === '42501';
}

/**
 * Sync local changes for a single table to Supabase.
 */
export async function syncTableToSupabase(
  config: SyncTableConfig,
  userId: string,
): Promise<void> {
  const unsynced = await genericGetUnsynced(config.localTable, config.supportsSoftDelete);
  if (unsynced.length === 0) return;

  const label = config.supabaseTable;
  logWithTs(`[GenericSync] Syncing ${unsynced.length} ${label} rows to Supabase`);

  for (const row of unsynced) {
    const id = String(row[config.primaryKey]);
    const isDeleted = config.supportsSoftDelete && row.deleted === 1;
    try {

      if (isDeleted) {
        const { error } = await supabase
          .from(config.supabaseTable)
          .delete()
          .eq(config.primaryKey, id);
        if (error) throw error;
        await genericUpdateSyncStatus(config.localTable, config.primaryKey, id, true);
        continue;
      }

      if (config.appendOnly) {
        // Append-only: just insert, skip conflict check
        const remoteRow = buildRemoteRow(config, row, userId);
        const { error } = await supabase.from(config.supabaseTable).upsert([remoteRow]);
        if (error) throw error;
        await genericUpdateSyncStatus(config.localTable, config.primaryKey, id, true);
        continue;
      }

      // Check server timestamp for last-write-wins
      const { data: existing, error: fetchError } = await supabase
        .from(config.supabaseTable)
        .select('updated_at')
        .eq(config.primaryKey, id)
        .single();

      if (fetchError && fetchError.code !== 'PGRST116') {
        throw fetchError;
      }

      // Server wins if newer
      if (existing && new Date(existing.updated_at) > new Date(String(row.updated_at))) {
        logWithTs(`[GenericSync] Server ${label} ${id} is newer, skipping`);
        await genericUpdateSyncStatus(config.localTable, config.primaryKey, id, true);
        continue;
      }

      // Push local version to server
      const remoteRow = buildRemoteRow(config, row, userId);
      const upsertOpts = config.onConflict ? { onConflict: config.onConflict } : undefined;
      const { error } = await supabase
        .from(config.supabaseTable)
        .upsert([remoteRow], upsertOpts);
      if (error) throw error;
      await genericUpdateSyncStatus(config.localTable, config.primaryKey, id, true);
      logWithTs(`[GenericSync] Synced ${label} ${id} to server`);
    } catch (error) {
      if (isRlsViolation(error)) {
        warnWithTs(`[GenericSync] ${label} ${id} rejected by RLS, purging`);
        await genericHardDelete(config.localTable, config.primaryKey, id);
        continue;
      }
      errorWithTs(`[GenericSync] Failed to sync ${label} ${id}:`, error);
      // Add to sync queue for retry
      const cleanRow = { ...row };
      delete cleanRow.synced;
      delete cleanRow.deleted;
      await localDB.addToSyncQueue(
        config.supabaseTable as any,
        isDeleted ? 'delete' : 'upsert',
        id,
        cleanRow,
      );
    }
  }
}

/**
 * Download all rows from Supabase for a table and merge into local DB.
 */
export async function downloadTableFromSupabase(
  config: SyncTableConfig,
  userId: string,
): Promise<void> {
  const label = config.supabaseTable;

  try {
    let query = supabase.from(config.supabaseTable).select('*');
    if (config.userScoped) {
      query = query.eq('user_id', userId);
    }
    query = query.order('created_at', { ascending: false });

    const { data: remoteRows, error } = await query;
    if (error) {
      if (error.message.includes('does not exist')) return;
      throw error;
    }

    const localRows = await genericGetAll(
      config.localTable,
      config.supportsSoftDelete,
      true, // include deleted
    );
    const localMap = new Map(
      localRows.map((r) => [String(r[config.primaryKey]), r]),
    );
    const serverIds = new Set((remoteRows || []).map((r: Record<string, unknown>) => String(r[config.primaryKey])));

    if (remoteRows && remoteRows.length > 0) {
      for (const remoteRow of remoteRows) {
        const id = String(remoteRow[config.primaryKey]);
        const local = localMap.get(id);

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

        await genericLocalUpsert(config.localTable, config.primaryKey, localRow, 1);
      }
      logWithTs(`[GenericSync] Downloaded ${remoteRows.length} ${label} rows`);
    }

    // Clean up local rows that were deleted on server
    if (!config.appendOnly) {
      for (const local of localRows) {
        const id = String(local[config.primaryKey]);
        const isSynced = local.synced === 1;
        const isNotDeleted = !config.supportsSoftDelete || local.deleted === 0;
        if (isSynced && isNotDeleted && !serverIds.has(id)) {
          logWithTs(`[GenericSync] Removing ${label} ${id} - deleted on server`);
          await genericHardDelete(config.localTable, config.primaryKey, id);
        }
      }
    }
  } catch (error) {
    errorWithTs(`[GenericSync] Error downloading ${label}:`, error);
  }
}

/**
 * Handle a realtime change event for a generic table.
 */
export async function handleGenericRealtimeChange(
  config: SyncTableConfig,
  payload: GenericRealtimePayload,
  notifyCallback: () => void,
  scheduleConflictReconcile: (reason: string) => void,
): Promise<void> {
  const label = config.supabaseTable;

  try {
    const newRow = payload.new as Partial<Record<string, unknown>>;
    const oldRow = payload.old as Partial<Record<string, unknown>>;

    if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
      const id = newRow[config.primaryKey];
      if (!id || typeof id !== 'string') return;

      const local = await genericGetById(config.localTable, config.primaryKey, id, true);

      // Local unsynced wins
      if (local && local.synced === 0) {
        logWithTs(`[GenericSync] Local ${label} ${id} has unsynced changes, keeping local`);
        scheduleConflictReconcile(`${label}:${id}`);
        return;
      }

      const localRow = config.remoteToLocal
        ? config.remoteToLocal(newRow as Record<string, unknown>)
        : stripRemoteOnlyFields(newRow as Record<string, unknown>, config.userScoped);

      await genericLocalUpsert(config.localTable, config.primaryKey, localRow, 1);
      notifyCallback();
    } else if (payload.eventType === 'DELETE') {
      const id = oldRow[config.primaryKey];
      if (!id || typeof id !== 'string') return;
      await genericHardDelete(config.localTable, config.primaryKey, id as string);
      notifyCallback();
    }
  } catch (error) {
    errorWithTs(`[GenericSync] Error handling realtime ${label} change:`, error);
  }
}

// =============================================================================
// Helpers
// =============================================================================

function buildRemoteRow(
  config: SyncTableConfig,
  localRow: Record<string, unknown>,
  userId: string,
): Record<string, unknown> {
  if (config.localToRemote) {
    return config.localToRemote(localRow, userId);
  }

  // Default: strip synced/deleted, add user_id
  const remote: Record<string, unknown> = {};
  for (const col of config.columns) {
    if (col in localRow) {
      remote[col] = localRow[col];
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
  delete local.created_at; // managed by Supabase
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
  },
  {
    localTable: 'workout_templates',
    supabaseTable: 'workout_templates',
    primaryKey: 'id',
    userScoped: true,
    supportsSoftDelete: true,
    appendOnly: false,
    columns: workoutTemplateColumns,
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
          remote[col] = typeof row[col] === 'string' ? JSON.parse(row[col] as string) : row[col];
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

/**
 * Run sync for all workout-related tables.
 */
export async function syncAllWorkoutTablesToSupabase(userId: string): Promise<void> {
  for (const config of WORKOUT_SYNC_CONFIGS) {
    await syncTableToSupabase(config, userId);
  }
}

/**
 * Download all workout-related tables from Supabase.
 */
export async function downloadAllWorkoutTablesFromSupabase(userId: string): Promise<void> {
  for (const config of WORKOUT_SYNC_CONFIGS) {
    await downloadTableFromSupabase(config, userId);
  }
}

/**
 * Cleanup synced soft-deleted rows across workout tables.
 */
export async function cleanupWorkoutSyncedDeletes(): Promise<void> {
  const db = localDB.db;
  if (!db) return;

  const tablesWithSoftDelete = WORKOUT_SYNC_CONFIGS.filter((c) => c.supportsSoftDelete);
  for (const config of tablesWithSoftDelete) {
    await db.runAsync(`DELETE FROM ${config.localTable} WHERE deleted = 1 AND synced = 1`);
  }
}
