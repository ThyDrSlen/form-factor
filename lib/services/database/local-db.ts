import type { SyncTableName, SyncOperation, SyncQueueItem } from './sync-types';
import * as SQLite from 'expo-sqlite';
import { errorWithTs, logWithTs } from '@/lib/logger';
import { createError } from '@/lib/services/ErrorHandler';

interface DBResult<T> {
  ok: true;
  data: T;
}

interface DBError {
  ok: false;
  error: {
    domain: 'storage';
    code: string;
    message: string;
    retryable: boolean;
  };
}

type DBResponse<T> = DBResult<T> | DBError;

export interface LocalFood {
  id: string;
  name: string;
  calories: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  date: string;
  synced: number; // 0 = not synced, 1 = synced
  deleted: number; // 0 = active, 1 = soft deleted
  updated_at: string;
}

export interface LocalWorkout {
  id: string;
  exercise: string;
  sets: number;
  reps?: number;
  weight?: number;
  duration?: number;
  date: string;
  synced: number;
  deleted: number;
  updated_at: string;
}

export interface LocalHealthMetric {
  id: string;
  user_id: string;
  summary_date: string; // YYYY-MM-DD
  steps: number | null;
  heart_rate_bpm: number | null;
  heart_rate_timestamp: string | null;
  weight_kg: number | null;
  weight_timestamp: string | null;
  synced: number; // 0 = not synced, 1 = synced
  updated_at: string;
}

export interface LocalNutritionGoals {
  id: string;
  user_id: string;
  calories_goal: number;
  protein_goal: number;
  carbs_goal: number;
  fat_goal: number;
  synced: number;
  updated_at: string;
}

export interface ExerciseHistoryEntry {
  id: string;
  session_id: string;
  session_exercise_id: string;
  exercise_id: string;
  set_type: string;
  planned_weight: number | null;
  actual_weight: number | null;
  actual_reps: number | null;
  actual_seconds: number | null;
  completed_at: string;
  session_started_at: string;
  session_ended_at: string | null;
}

export interface ExercisePersonalRecords {
  maxWeight: number | null;
  maxReps: number | null;
  maxVolume: number | null;
  maxDurationSeconds: number | null;
}

export type { SyncTableName, SyncOperation, SyncQueueItem } from './sync-types';

class LocalDatabase {
  public readonly supportsWorkoutSync: boolean = true;
  public db: SQLite.SQLiteDatabase | null = null;
  private initPromise: Promise<void> | null = null;
  private transactionTail: Promise<void> = Promise.resolve();

  async initialize(): Promise<void> {
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = (async () => {
      try {
        logWithTs('[LocalDB] Opening database...');
        this.db = await SQLite.openDatabaseAsync('formfactor.db');
        
        await this.createTables();
        await this.seedLocalExercises();
        await this.migrateLegacyWorkouts();
        logWithTs('[LocalDB] Database initialized successfully');
      } catch (error) {
        errorWithTs('[LocalDB] Failed to initialize database:', error);
        throw error;
      }
    })();

    return this.initPromise;
  }

  async ensureInitialized(): Promise<DBResponse<SQLite.SQLiteDatabase>> {
    if (this.db) {
      return { ok: true as const, data: this.db };
    }

    const delays = [100, 300, 900];
    let lastError: unknown;

    for (let attempt = 0; attempt < delays.length; attempt++) {
      try {
        await this.initialize();
        if (this.db) {
          return { ok: true as const, data: this.db };
        }
      } catch (error) {
        lastError = error;
        errorWithTs(`[LocalDB] Init attempt ${attempt + 1} failed:`, error);
        // Reset initPromise so next attempt can retry
        this.initPromise = null;
        if (attempt < delays.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
        }
      }
    }

    const appError = createError(
      'storage',
      'DB_INIT_FAILED',
      lastError instanceof Error ? lastError.message : 'Database initialization failed after retries',
      { retryable: false, severity: 'error', details: lastError }
    );

    return {
      ok: false as const,
      error: {
        domain: 'storage' as const,
        code: appError.code,
        message: appError.message,
        retryable: appError.retryable,
      },
    };
  }

  private async createTables(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    // Create foods table
    await this.db.execAsync(`
      CREATE TABLE IF NOT EXISTS foods (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        calories REAL NOT NULL,
        protein REAL,
        carbs REAL,
        fat REAL,
        date TEXT NOT NULL,
        synced INTEGER DEFAULT 0,
        deleted INTEGER DEFAULT 0,
        updated_at TEXT NOT NULL
      );
    `);

    // Create workouts table
    await this.db.execAsync(`
      CREATE TABLE IF NOT EXISTS workouts (
        id TEXT PRIMARY KEY,
        exercise TEXT NOT NULL,
        sets INTEGER NOT NULL,
        reps INTEGER,
        weight REAL,
        duration INTEGER,
        date TEXT NOT NULL,
        synced INTEGER DEFAULT 0,
        deleted INTEGER DEFAULT 0,
        updated_at TEXT NOT NULL
      );
    `);

    // Create health_metrics table
    await this.db.execAsync(`
      CREATE TABLE IF NOT EXISTS health_metrics (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        summary_date TEXT NOT NULL,
        steps INTEGER,
        heart_rate_bpm REAL,
        heart_rate_timestamp TEXT,
        weight_kg REAL,
        weight_timestamp TEXT,
        synced INTEGER DEFAULT 0,
        updated_at TEXT NOT NULL,
        UNIQUE(user_id, summary_date)
      );
    `);

    await this.db.execAsync(`
      CREATE TABLE IF NOT EXISTS nutrition_goals (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        calories_goal REAL NOT NULL,
        protein_goal REAL NOT NULL,
        carbs_goal REAL NOT NULL,
        fat_goal REAL NOT NULL,
        synced INTEGER DEFAULT 0,
        updated_at TEXT NOT NULL
      );
    `);

    await this.db.execAsync(`
      CREATE TABLE IF NOT EXISTS sync_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        table_name TEXT NOT NULL,
        operation TEXT NOT NULL,
        record_id TEXT NOT NULL,
        data TEXT,
        created_at TEXT NOT NULL,
        retry_count INTEGER DEFAULT 0,
        next_retry_at TEXT
      );
    `);

    try {
      await this.db.execAsync('ALTER TABLE sync_queue ADD COLUMN next_retry_at TEXT;');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('duplicate column name')) {
        errorWithTs('[LocalDB] Failed to ensure sync_queue.next_retry_at column:', error);
      }
    }

    // =========================================================================
    // Workout Session System Tables
    // =========================================================================

    // Exercises reference table
    await this.db.execAsync(`
      CREATE TABLE IF NOT EXISTS exercises (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT,
        muscle_group TEXT,
        is_compound INTEGER NOT NULL DEFAULT 0,
        is_timed INTEGER NOT NULL DEFAULT 0,
        is_system INTEGER NOT NULL DEFAULT 1,
        created_by TEXT,
        synced INTEGER DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT ''
      );
    `);

    // Workout templates
    await this.db.execAsync(`
      CREATE TABLE IF NOT EXISTS workout_templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        goal_profile TEXT NOT NULL DEFAULT 'hypertrophy',
        is_public INTEGER NOT NULL DEFAULT 0,
        share_slug TEXT,
        synced INTEGER DEFAULT 0,
        deleted INTEGER DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT ''
      );
    `);

    // Workout template exercises
    await this.db.execAsync(`
      CREATE TABLE IF NOT EXISTS workout_template_exercises (
        id TEXT PRIMARY KEY,
        template_id TEXT NOT NULL,
        exercise_id TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        notes TEXT,
        default_rest_seconds INTEGER,
        default_tempo TEXT,
        synced INTEGER DEFAULT 0,
        deleted INTEGER DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT ''
      );
    `);

    // Workout template sets
    await this.db.execAsync(`
      CREATE TABLE IF NOT EXISTS workout_template_sets (
        id TEXT PRIMARY KEY,
        template_exercise_id TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        set_type TEXT NOT NULL DEFAULT 'normal',
        target_reps INTEGER,
        target_seconds INTEGER,
        target_weight REAL,
        target_rpe REAL,
        rest_seconds_override INTEGER,
        notes TEXT,
        synced INTEGER DEFAULT 0,
        deleted INTEGER DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT ''
      );
    `);

    // Workout sessions
    await this.db.execAsync(`
      CREATE TABLE IF NOT EXISTS workout_sessions (
        id TEXT PRIMARY KEY,
        template_id TEXT,
        name TEXT,
        goal_profile TEXT NOT NULL DEFAULT 'hypertrophy',
        started_at TEXT NOT NULL,
        ended_at TEXT,
        timezone_offset_minutes INTEGER NOT NULL DEFAULT 0,
        bodyweight_lb REAL,
        notes TEXT,
        synced INTEGER DEFAULT 0,
        deleted INTEGER DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT ''
      );
    `);

    // Additive migration: unidentified device rows stay unowned. Only a new
    // authenticated write or a server row may establish ownership.
    const sessionColumns = await this.db.getAllAsync<{ name: string }>('PRAGMA table_info(workout_sessions)');
    if (!sessionColumns.some(column => column.name === 'user_id')) {
      await this.db.execAsync('ALTER TABLE workout_sessions ADD COLUMN user_id TEXT;');
    }
    await this.db.execAsync('CREATE INDEX IF NOT EXISTS idx_ws_owner ON workout_sessions(user_id, started_at DESC);');

    // Workout session exercises
    await this.db.execAsync(`
      CREATE TABLE IF NOT EXISTS workout_session_exercises (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        exercise_id TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        notes TEXT,
        synced INTEGER DEFAULT 0,
        deleted INTEGER DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT ''
      );
    `);

    // Workout session sets
    await this.db.execAsync(`
      CREATE TABLE IF NOT EXISTS workout_session_sets (
        id TEXT PRIMARY KEY,
        session_exercise_id TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        set_type TEXT NOT NULL DEFAULT 'normal',
        planned_reps INTEGER,
        planned_seconds INTEGER,
        planned_weight REAL,
        actual_reps INTEGER,
        actual_seconds INTEGER,
        actual_weight REAL,
        started_at TEXT,
        completed_at TEXT,
        rest_target_seconds INTEGER,
        rest_started_at TEXT,
        rest_completed_at TEXT,
        rest_skipped INTEGER NOT NULL DEFAULT 0,
        tut_ms INTEGER,
        tut_source TEXT NOT NULL DEFAULT 'unknown',
        perceived_rpe REAL,
        notes TEXT,
        synced INTEGER DEFAULT 0,
        deleted INTEGER DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT ''
      );
    `);

    // Workout session events (append-only)
    await this.db.execAsync(`
      CREATE TABLE IF NOT EXISTS workout_session_events (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        type TEXT NOT NULL,
        session_exercise_id TEXT,
        session_set_id TEXT,
        payload TEXT NOT NULL DEFAULT '{}',
        synced INTEGER DEFAULT 0
      );
    `);

    // A18: debrief notes — per-session free text notes + starred fault ids
    // + saved-for-next-time cue ids. Local-only for now; a follow-up wires
    // this to Supabase once the schema is approved.
    await this.db.execAsync(`
      CREATE TABLE IF NOT EXISTS debrief_notes (
        session_id TEXT PRIMARY KEY,
        notes TEXT NOT NULL DEFAULT '',
        starred_fault_ids TEXT NOT NULL DEFAULT '[]',
        saved_cues INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );
    `);

    // Create indexes for better query performance
    await this.db.execAsync(`
      CREATE INDEX IF NOT EXISTS idx_foods_date ON foods(date DESC);
      CREATE INDEX IF NOT EXISTS idx_foods_synced ON foods(synced);
      CREATE INDEX IF NOT EXISTS idx_workouts_date ON workouts(date DESC);
      CREATE INDEX IF NOT EXISTS idx_workouts_synced ON workouts(synced);
      CREATE INDEX IF NOT EXISTS idx_health_metrics_user_date ON health_metrics(user_id, summary_date DESC);
      CREATE INDEX IF NOT EXISTS idx_health_metrics_synced ON health_metrics(synced);
      CREATE INDEX IF NOT EXISTS idx_nutrition_goals_user ON nutrition_goals(user_id);

      CREATE INDEX IF NOT EXISTS idx_exercises_name ON exercises(name);
      CREATE INDEX IF NOT EXISTS idx_exercises_category ON exercises(category);

      CREATE INDEX IF NOT EXISTS idx_wt_synced ON workout_templates(synced);
      CREATE INDEX IF NOT EXISTS idx_wte_template ON workout_template_exercises(template_id, sort_order);
      CREATE INDEX IF NOT EXISTS idx_wts_exercise ON workout_template_sets(template_exercise_id, sort_order);

      CREATE INDEX IF NOT EXISTS idx_ws_started ON workout_sessions(started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_ws_synced ON workout_sessions(synced);
      CREATE INDEX IF NOT EXISTS idx_wse_session ON workout_session_exercises(session_id, sort_order);
      CREATE INDEX IF NOT EXISTS idx_wss_exercise ON workout_session_sets(session_exercise_id, sort_order);
      CREATE INDEX IF NOT EXISTS idx_wse_events_session ON workout_session_events(session_id, created_at);
    `);

    logWithTs('[LocalDB] Tables created successfully');
  }

  // Seed exercises locally so the picker works before first sync
  private async seedLocalExercises(): Promise<void> {
    const db = this.db;
    if (!db) return;

    try {
      const result = await db.getAllAsync<{ count: number }>('SELECT COUNT(*) as count FROM exercises');
      if (result[0]?.count && result[0].count > 0) return; // already seeded or synced

      const now = new Date().toISOString();
      const seed: Array<[string, string, string, string, number, number]> = [
        ['seed-bench-press', 'Bench Press', 'push', 'chest', 1, 0],
        ['seed-back-squat', 'Back Squat', 'legs', 'quadriceps', 1, 0],
        ['seed-deadlift', 'Deadlift', 'pull', 'posterior_chain', 1, 0],
        ['seed-overhead-press', 'Overhead Press', 'push', 'shoulders', 1, 0],
        ['seed-lat-pulldown', 'Lat Pulldown', 'pull', 'back', 1, 0],
        ['seed-pull-up', 'Pull-Up', 'pull', 'back', 1, 0],
        ['seed-push-up', 'Push-Up', 'push', 'chest', 1, 0],
        ['seed-dumbbell-row', 'Dumbbell Row', 'pull', 'back', 1, 0],
        ['seed-incline-bench', 'Incline Bench', 'push', 'chest', 1, 0],
        ['seed-leg-press', 'Leg Press', 'legs', 'quadriceps', 1, 0],
        ['seed-leg-curl', 'Leg Curl', 'legs', 'hamstrings', 0, 0],
        ['seed-leg-extension', 'Leg Extension', 'legs', 'quadriceps', 0, 0],
        ['seed-bicep-curl', 'Bicep Curl', 'pull', 'biceps', 0, 0],
        ['seed-tricep-dip', 'Tricep Dip', 'push', 'triceps', 1, 0],
        ['seed-plank', 'Plank', 'core', 'core', 0, 1],
        ['seed-russian-twist', 'Russian Twist', 'core', 'core', 0, 0],
        ['seed-mountain-climbers', 'Mountain Climbers', 'cardio', 'full_body', 0, 1],
        ['seed-burpees', 'Burpees', 'cardio', 'full_body', 1, 0],
        ['seed-jump-rope', 'Jump Rope', 'cardio', 'full_body', 0, 1],
        ['seed-hiit-circuit', 'HIIT Circuit', 'cardio', 'full_body', 1, 1],
        ['seed-romanian-deadlift', 'Romanian Deadlift', 'pull', 'hamstrings', 1, 0],
        ['seed-dead-hang', 'Dead Hang', 'pull', 'grip', 0, 1],
        ['seed-farmers-walk', 'Farmers Walk', 'full_body', 'grip', 1, 1],
      ];

      for (const [id, name, category, muscle_group, is_compound, is_timed] of seed) {
        await db.runAsync(
          `INSERT OR IGNORE INTO exercises (id, name, category, muscle_group, is_compound, is_timed, is_system, created_by, synced, updated_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 1, NULL, 0, ?, ?)`,
          [id, name, category, muscle_group, is_compound, is_timed, now, now],
        );
      }
      logWithTs(`[LocalDB] Seeded ${seed.length} exercises`);
    } catch (error) {
      errorWithTs('[LocalDB] Exercise seed failed:', error);
    }
  }

  /**
   * Run a callback inside a SQLite transaction. If the callback throws,
   * the transaction is rolled back; otherwise it is committed.
   */
  async withTransaction(fn: () => Promise<void>): Promise<void> {
    const dbResult = await this.ensureInitialized();
    if (!dbResult.ok) {
      throw new Error(dbResult.error.message);
    }
    // Expo transactions share one connection: overlapping BEGIN/ROLLBACK can
    // abort another caller's work. Keep transaction boundaries FIFO.
    const transaction = this.transactionTail.then(() => dbResult.data.withTransactionAsync(fn));
    this.transactionTail = transaction.catch(() => {});
    await transaction;
  }

  // Food operations
  async insertFood(food: Omit<LocalFood, 'synced' | 'deleted' | 'updated_at'>): Promise<void> {
    const dbResult = await this.ensureInitialized();
    if (!dbResult.ok) {
      throw new Error(dbResult.error.message);
    }

    await dbResult.data.runAsync(
      `INSERT OR REPLACE INTO foods (id, name, calories, protein, carbs, fat, date, synced, deleted, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?)`,
      [food.id, food.name, food.calories, food.protein || null, food.carbs || null, food.fat || null, food.date, new Date().toISOString()]
    );
  }

  async insertFoodAndQueue(
    food: Omit<LocalFood, 'synced' | 'deleted' | 'updated_at'>,
    syncData?: unknown,
  ): Promise<void> {
    const dbResult = await this.ensureInitialized();
    if (!dbResult.ok) {
      throw new Error(dbResult.error.message);
    }

    const now = new Date().toISOString();
    await this.withTransaction(async () => {
      await dbResult.data.runAsync(
        `INSERT OR REPLACE INTO foods (id, name, calories, protein, carbs, fat, date, synced, deleted, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?)`,
        [food.id, food.name, food.calories, food.protein || null, food.carbs || null, food.fat || null, food.date, now]
      );
      await dbResult.data.runAsync(
        'INSERT INTO sync_queue (table_name, operation, record_id, data, created_at, next_retry_at) VALUES (?, ?, ?, ?, ?, ?)',
        ['foods', 'upsert', food.id, JSON.stringify(syncData || {}), now, now]
      );
    });
  }

  async getAllFoods(): Promise<LocalFood[]> {
    const dbResult = await this.ensureInitialized();
    if (!dbResult.ok) {
      throw new Error(dbResult.error.message);
    }

    const result = await dbResult.data.getAllAsync<LocalFood>(
      'SELECT * FROM foods WHERE deleted = 0 ORDER BY date DESC'
    );
    return result;
  }

  async getUnsyncedFoods(): Promise<LocalFood[]> {
    if (!this.db) throw new Error('Database not initialized');

    const result = await this.db.getAllAsync<LocalFood>(
      'SELECT * FROM foods WHERE synced = 0 AND deleted = 0'
    );
    return result;
  }

  async getFoodById(id: string, includeDeleted = true): Promise<LocalFood | null> {
    if (!this.db) throw new Error('Database not initialized');

    const query = includeDeleted
      ? 'SELECT * FROM foods WHERE id = ?'
      : 'SELECT * FROM foods WHERE id = ? AND deleted = 0';

    const result = await this.db.getAllAsync<LocalFood>(query, [id]);
    return result[0] || null;
  }

  async getAllFoodsWithDeleted(): Promise<LocalFood[]> {
    if (!this.db) throw new Error('Database not initialized');

    return await this.db.getAllAsync<LocalFood>('SELECT * FROM foods');
  }

  async reconcileFood(
    incoming: LocalFood, expected: LocalFood, isCurrent?: () => boolean,
  ): Promise<boolean> {
    if (incoming.id !== expected.id) return false;
    const result = await this.runCurrentHealthWrite(
      `UPDATE foods
       SET name = ?, calories = ?, protein = ?, carbs = ?, fat = ?, date = ?, updated_at = ?, deleted = ?, synced = 1
       WHERE id IS ? AND name IS ? AND calories IS ? AND protein IS ? AND carbs IS ? AND fat IS ?
         AND date IS ? AND synced IS ? AND deleted IS ? AND updated_at IS ?`,
      [incoming.name, incoming.calories, incoming.protein ?? null, incoming.carbs ?? null, incoming.fat ?? null,
        incoming.date, incoming.updated_at, incoming.deleted, expected.id, expected.name, expected.calories,
        expected.protein ?? null, expected.carbs ?? null, expected.fat ?? null,
        expected.date, expected.synced, expected.deleted, expected.updated_at],
      // Always prepare explicitly to guard connection replacement, even without a caller guard.
      isCurrent ?? (() => true),
    );
    return result.changes > 0;
  }

  async reconcileWorkout(
    incoming: LocalWorkout, expected: LocalWorkout, isCurrent?: () => boolean,
  ): Promise<boolean> {
    if (incoming.id !== expected.id) return false;
    const result = await this.runCurrentHealthWrite(
      `UPDATE workouts
       SET exercise = ?, sets = ?, reps = ?, weight = ?, duration = ?, date = ?, updated_at = ?, deleted = ?, synced = 1
       WHERE id IS ? AND exercise IS ? AND sets IS ? AND reps IS ? AND weight IS ? AND duration IS ?
         AND date IS ? AND synced IS ? AND deleted IS ? AND updated_at IS ?`,
      [incoming.exercise, incoming.sets, incoming.reps ?? null, incoming.weight ?? null, incoming.duration ?? null,
        incoming.date, incoming.updated_at, incoming.deleted, expected.id, expected.exercise, expected.sets,
        expected.reps ?? null, expected.weight ?? null, expected.duration ?? null,
        expected.date, expected.synced, expected.deleted, expected.updated_at],
      isCurrent ?? (() => true),
    );
    return result.changes > 0;
  }

  private async updateLegacySyncStatus(
    table: 'foods' | 'workouts' | 'nutrition_goals', id: string, synced: boolean,
    expected?: Partial<LocalFood | LocalWorkout | LocalNutritionGoals>,
  ): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    // A network acknowledgement belongs to captured content, not just an ID
    // or millisecond timestamp. Do not mark concurrent edits/deletes as sent.
    const entries = Object.entries(expected ?? {});
    const guard = entries.map(([key]) => ` AND "${key.replace(/"/g, '""')}" IS ?`).join('');
    await this.db.runAsync(
      `UPDATE ${table} SET synced = ? WHERE id = ?${guard}`,
      [synced ? 1 : 0, id, ...entries.map(([, value]) => value ?? null)]
    );
  }

  async updateFoodSyncStatus(id: string, synced: boolean, expected?: Partial<LocalFood>): Promise<void> {
    await this.updateLegacySyncStatus('foods', id, synced, expected);
  }

  async softDeleteFood(id: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    await this.db.runAsync(
      'UPDATE foods SET deleted = 1, synced = 0, updated_at = ? WHERE id = ?',
      [new Date().toISOString(), id]
    );
  }

  async softDeleteFoodAndQueue(id: string, syncData?: unknown): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const now = new Date().toISOString();
    const db = this.db;
    await this.withTransaction(async () => {
      await db.runAsync(
        'UPDATE foods SET deleted = 1, synced = 0, updated_at = ? WHERE id = ?',
        [now, id]
      );
      await db.runAsync(
        'INSERT INTO sync_queue (table_name, operation, record_id, data, created_at, next_retry_at) VALUES (?, ?, ?, ?, ?, ?)',
        ['foods', 'delete', id, JSON.stringify(syncData || {}), now, now]
      );
    });
  }

  async hardDeleteFood(id: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    await this.db.runAsync('DELETE FROM foods WHERE id = ?', [id]);
  }

  async updateFood(id: string, updates: Partial<LocalFood>): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const fields = Object.keys(updates).filter(k => k !== 'id');
    if (fields.length === 0) return;

    const setClauses = fields.map(f => `${f} = ?`).join(', ');
    const values = fields.map(f => {
      const val = updates[f as keyof LocalFood];
      return val === undefined ? null : val;
    });
    values.push(id);

    await this.db.runAsync(
      `UPDATE foods SET ${setClauses} WHERE id = ?`,
      values
    );
  }

  async updateFoodAndQueue(
    id: string,
    updates: Partial<LocalFood>,
    syncData?: unknown,
  ): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const fields = Object.keys(updates).filter(k => k !== 'id');
    if (fields.length === 0) return;

    const setClauses = fields.map(f => `${f} = ?`).join(', ');
    const values = fields.map(f => {
      const val = updates[f as keyof LocalFood];
      return val === undefined ? null : val;
    });
    values.push(id);

    const now = new Date().toISOString();
    const db = this.db;
    await this.withTransaction(async () => {
      await db.runAsync(
        `UPDATE foods SET ${setClauses} WHERE id = ?`,
        values
      );
      await db.runAsync(
        'INSERT INTO sync_queue (table_name, operation, record_id, data, created_at, next_retry_at) VALUES (?, ?, ?, ?, ?, ?)',
        ['foods', 'upsert', id, JSON.stringify(syncData || {}), now, now]
      );
    });
  }

  // Workout operations
  async insertWorkout(workout: Omit<LocalWorkout, 'synced' | 'deleted' | 'updated_at'>): Promise<void> {
    const dbResult = await this.ensureInitialized();
    if (!dbResult.ok) {
      throw new Error(dbResult.error.message);
    }

    await dbResult.data.runAsync(
      `INSERT OR REPLACE INTO workouts (id, exercise, sets, reps, weight, duration, date, synced, deleted, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?)`,
      [
        workout.id,
        workout.exercise,
        workout.sets,
        workout.reps || null,
        workout.weight || null,
        workout.duration || null,
        workout.date,
        new Date().toISOString()
      ]
    );
  }

  async insertWorkoutAndQueue(
    workout: Omit<LocalWorkout, 'synced' | 'deleted' | 'updated_at'>,
    syncData?: unknown,
  ): Promise<void> {
    const dbResult = await this.ensureInitialized();
    if (!dbResult.ok) {
      throw new Error(dbResult.error.message);
    }

    const now = new Date().toISOString();
    await this.withTransaction(async () => {
      await dbResult.data.runAsync(
        `INSERT OR REPLACE INTO workouts (id, exercise, sets, reps, weight, duration, date, synced, deleted, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?)`,
        [
          workout.id,
          workout.exercise,
          workout.sets,
          workout.reps || null,
          workout.weight || null,
          workout.duration || null,
          workout.date,
          now,
        ]
      );
      await dbResult.data.runAsync(
        'INSERT INTO sync_queue (table_name, operation, record_id, data, created_at, next_retry_at) VALUES (?, ?, ?, ?, ?, ?)',
        ['workouts', 'upsert', workout.id, JSON.stringify(syncData || {}), now, now]
      );
    });
  }

  async getAllWorkouts(): Promise<LocalWorkout[]> {
    const dbResult = await this.ensureInitialized();
    if (!dbResult.ok) {
      throw new Error(dbResult.error.message);
    }

    const result = await dbResult.data.getAllAsync<LocalWorkout>(
      'SELECT * FROM workouts WHERE deleted = 0 ORDER BY date DESC'
    );
    return result;
  }

  async getUnsyncedWorkouts(): Promise<LocalWorkout[]> {
    if (!this.db) throw new Error('Database not initialized');

    const result = await this.db.getAllAsync<LocalWorkout>(
      'SELECT * FROM workouts WHERE synced = 0 AND deleted = 0'
    );
    return result;
  }

  async getWorkoutById(id: string, includeDeleted = true): Promise<LocalWorkout | null> {
    if (!this.db) throw new Error('Database not initialized');

    const query = includeDeleted
      ? 'SELECT * FROM workouts WHERE id = ?'
      : 'SELECT * FROM workouts WHERE id = ? AND deleted = 0';

    const result = await this.db.getAllAsync<LocalWorkout>(query, [id]);
    return result[0] || null;
  }

  async getAllWorkoutsWithDeleted(): Promise<LocalWorkout[]> {
    if (!this.db) throw new Error('Database not initialized');

    return await this.db.getAllAsync<LocalWorkout>('SELECT * FROM workouts');
  }

  async updateWorkoutSyncStatus(id: string, synced: boolean, expected?: Partial<LocalWorkout>): Promise<void> {
    await this.updateLegacySyncStatus('workouts', id, synced, expected);
  }

  async softDeleteWorkout(id: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    await this.db.runAsync(
      'UPDATE workouts SET deleted = 1, synced = 0, updated_at = ? WHERE id = ?',
      [new Date().toISOString(), id]
    );
  }

  async softDeleteWorkoutAndQueue(id: string, syncData?: unknown): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const now = new Date().toISOString();
    const db = this.db;
    await this.withTransaction(async () => {
      await db.runAsync(
        'UPDATE workouts SET deleted = 1, synced = 0, updated_at = ? WHERE id = ?',
        [now, id]
      );
      await db.runAsync(
        'INSERT INTO sync_queue (table_name, operation, record_id, data, created_at, next_retry_at) VALUES (?, ?, ?, ?, ?, ?)',
        ['workouts', 'delete', id, JSON.stringify(syncData || {}), now, now]
      );
    });
  }

  async hardDeleteWorkout(id: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    await this.db.runAsync('DELETE FROM workouts WHERE id = ?', [id]);
  }

  async updateWorkout(id: string, updates: Partial<LocalWorkout>): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const fields = Object.keys(updates).filter(k => k !== 'id');
    if (fields.length === 0) return;

    const setClauses = fields.map(f => `${f} = ?`).join(', ');
    const values = fields.map(f => {
      const val = updates[f as keyof LocalWorkout];
      return val === undefined ? null : val;
    });
    values.push(id);

    await this.db.runAsync(
      `UPDATE workouts SET ${setClauses} WHERE id = ?`,
      values
    );
  }

  async updateWorkoutAndQueue(
    id: string,
    updates: Partial<LocalWorkout>,
    syncData?: unknown,
  ): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const fields = Object.keys(updates).filter(k => k !== 'id');
    if (fields.length === 0) return;

    const setClauses = fields.map(f => `${f} = ?`).join(', ');
    const values = fields.map(f => {
      const val = updates[f as keyof LocalWorkout];
      return val === undefined ? null : val;
    });
    values.push(id);

    const now = new Date().toISOString();
    const db = this.db;
    await this.withTransaction(async () => {
      await db.runAsync(
        `UPDATE workouts SET ${setClauses} WHERE id = ?`,
        values
      );
      await db.runAsync(
        'INSERT INTO sync_queue (table_name, operation, record_id, data, created_at, next_retry_at) VALUES (?, ?, ?, ?, ?, ?)',
        ['workouts', 'upsert', id, JSON.stringify(syncData || {}), now, now]
      );
    });
  }

  /**
   * Fetch workouts for a specific exercise, sorted by date descending.
   *
   * The legacy `workouts` table is single-user-per-device (no `user_id` column);
   * `userId` is accepted for API symmetry with the forthcoming Supabase equivalent
   * so callers can pass a stable identifier without branching. The parameter name
   * `exerciseNameOrId` reflects that the local table stores the exercise as a
   * free-text `exercise` column — callers may pass either the canonical exercise
   * name (legacy path) or an exercise id if the session-based tables grow a
   * local aggregate view later.
   *
   * @param userId - Accepted for API parity; currently unused locally.
   * @param exerciseNameOrId - Exact match on the stored `exercise` column.
   * @param limit - Optional cap on the number of rows returned (newest first).
   */
  async getWorkoutsByExercise(
    userId: string,
    exerciseNameOrId: string,
    limit?: number,
  ): Promise<LocalWorkout[]> {
    void userId; // reserved for multi-user support; see Supabase stub in sync-service.ts
    const dbResult = await this.ensureInitialized();
    if (!dbResult.ok) {
      throw new Error(dbResult.error.message);
    }

    const params: (string | number)[] = [exerciseNameOrId];
    let query =
      'SELECT * FROM workouts WHERE deleted = 0 AND exercise = ? ORDER BY date DESC';
    if (typeof limit === 'number' && limit > 0) {
      query += ' LIMIT ?';
      params.push(Math.floor(limit));
    }
    return dbResult.data.getAllAsync<LocalWorkout>(query, params);
  }

  /** Completed, undeleted sets scoped to the persisted session owner; blank owners are rejected. */
  async getExerciseHistory(
    userId: string,
    exerciseId: string,
    limit = 20,
  ): Promise<ExerciseHistoryEntry[]> {
    if (!userId.trim()) {
      throw new Error('userId must not be blank');
    }
    const dbResult = await this.ensureInitialized();
    if (!dbResult.ok) {
      throw new Error(dbResult.error.message);
    }

    const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 20;

    return dbResult.data.getAllAsync<ExerciseHistoryEntry>(
      `SELECT
         ws.id,
         wse.session_id,
         ws.session_exercise_id,
         wse.exercise_id,
         ws.set_type,
         ws.planned_weight,
         ws.actual_weight,
         ws.actual_reps,
         ws.actual_seconds,
         ws.completed_at,
         s.started_at AS session_started_at,
         s.ended_at AS session_ended_at
       FROM workout_session_sets ws
       JOIN workout_session_exercises wse
         ON wse.id = ws.session_exercise_id
        AND COALESCE(wse.deleted, 0) = 0
       JOIN workout_sessions s
         ON s.id = wse.session_id
        AND COALESCE(s.deleted, 0) = 0
       WHERE s.user_id = ?
         AND wse.exercise_id = ?
         AND COALESCE(ws.deleted, 0) = 0
         AND ws.completed_at IS NOT NULL
       ORDER BY COALESCE(s.ended_at, s.started_at) DESC, ws.completed_at DESC, ws.sort_order DESC
       LIMIT ?`,
      [userId, exerciseId, safeLimit],
    );
  }

  /** Owner-scoped records; blank owners are rejected and missing eligible values retain null aggregates. */
  async getPersonalRecords(userId: string, exerciseId: string): Promise<ExercisePersonalRecords> {
    if (!userId.trim()) {
      throw new Error('userId must not be blank');
    }
    const dbResult = await this.ensureInitialized();
    if (!dbResult.ok) {
      throw new Error(dbResult.error.message);
    }

    const rows = await dbResult.data.getAllAsync<ExercisePersonalRecords>(
      `SELECT
         MAX(ws.actual_weight) AS maxWeight,
         MAX(ws.actual_reps) AS maxReps,
         MAX(CASE
           WHEN ws.actual_weight IS NOT NULL AND ws.actual_reps IS NOT NULL
           THEN ws.actual_weight * ws.actual_reps
         END) AS maxVolume,
         MAX(ws.actual_seconds) AS maxDurationSeconds
       FROM workout_session_sets ws
       JOIN workout_session_exercises wse
         ON wse.id = ws.session_exercise_id
        AND COALESCE(wse.deleted, 0) = 0
       JOIN workout_sessions s
         ON s.id = wse.session_id
        AND COALESCE(s.deleted, 0) = 0
       WHERE s.user_id = ?
         AND wse.exercise_id = ?
         AND COALESCE(ws.deleted, 0) = 0
         AND ws.completed_at IS NOT NULL`,
      [userId, exerciseId],
    );

    return rows[0] ?? {
      maxWeight: null,
      maxReps: null,
      maxVolume: null,
      maxDurationSeconds: null,
    };
  }

  // Health Metric operations
  // A single SQL statement protects the natural key even when a local write
  // lands between the service's read and this write. Never REPLACE a remote row.
  private async runCurrentHealthWrite(
    sql: string, values: SQLite.SQLiteBindValue[], isCurrent?: () => boolean,
  ): Promise<{ changes: number }> {
    const db = this.db;
    if (!db) throw new Error('Database not initialized');
    if (!isCurrent) return db.runAsync(sql, values);
    if (!isCurrent()) return { changes: 0 };
    // Expo's runAsync awaits prepareAsync internally. Revalidate after that
    // await so a prepared statement cannot repopulate a cleared account cache.
    const statement = await db.prepareAsync(sql);
    try {
      if (!isCurrent() || this.db !== db) return { changes: 0 };
      return await statement.executeAsync(values);
    } finally {
      await statement.finalizeAsync();
    }
  }

  async reconcileHealthMetric(metric: LocalHealthMetric, expectedUpdatedAt?: string, isCurrent?: () => boolean): Promise<boolean>;
  async reconcileHealthMetric(metric: LocalHealthMetric, expected: LocalHealthMetric, isCurrent?: () => boolean): Promise<boolean>;
  async reconcileHealthMetric(metric: LocalHealthMetric, expected?: string | LocalHealthMetric, isCurrent?: () => boolean): Promise<boolean> {
    if (!this.db) throw new Error('Database not initialized');
    const run = (sql: string, values: SQLite.SQLiteBindValue[]) => this.runCurrentHealthWrite(sql, values, isCurrent);
    if (typeof expected === 'string') {
      // Upload reconciliation is update-only: a concurrent deletion stays deleted.
      const result = await run(
        `UPDATE health_metrics SET steps = ?, heart_rate_bpm = ?, heart_rate_timestamp = ?,
           weight_kg = ?, weight_timestamp = ?, synced = 1, updated_at = ?
         WHERE user_id = ? AND summary_date = ? AND updated_at = ?
           AND julianday(updated_at) <= julianday(?)`,
        [metric.steps, metric.heart_rate_bpm, metric.heart_rate_timestamp, metric.weight_kg,
          metric.weight_timestamp, metric.updated_at, metric.user_id, metric.summary_date,
          expected, metric.updated_at],
      );
      return result.changes > 0;
    }
    if (expected) {
      if (expected.user_id !== metric.user_id || expected.summary_date !== metric.summary_date) return false;
      // Compare the entire submitted content, not only millisecond timestamps:
      // two HealthKit edits can share a timestamp. A deleted row stays deleted.
      const result = await run(
        `UPDATE health_metrics SET steps = ?, heart_rate_bpm = ?, heart_rate_timestamp = ?,
           weight_kg = ?, weight_timestamp = ?, synced = 1, updated_at = ?
         WHERE id = ? AND user_id = ? AND summary_date = ? AND updated_at = ? AND synced = ?
           AND steps IS ? AND heart_rate_bpm IS ? AND heart_rate_timestamp IS ?
           AND weight_kg IS ? AND weight_timestamp IS ?
           AND julianday(updated_at) <= julianday(?)`,
        [metric.steps, metric.heart_rate_bpm, metric.heart_rate_timestamp, metric.weight_kg,
          metric.weight_timestamp, metric.updated_at, expected.id, expected.user_id, expected.summary_date,
          expected.updated_at, expected.synced, expected.steps, expected.heart_rate_bpm,
          expected.heart_rate_timestamp, expected.weight_kg, expected.weight_timestamp, metric.updated_at],
      );
      return result.changes > 0;
    }
    const result = await run(
      `INSERT INTO health_metrics
       (id, user_id, summary_date, steps, heart_rate_bpm, heart_rate_timestamp, weight_kg, weight_timestamp, synced, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
       ON CONFLICT(user_id, summary_date) DO UPDATE SET
         steps = excluded.steps, heart_rate_bpm = excluded.heart_rate_bpm,
         heart_rate_timestamp = excluded.heart_rate_timestamp, weight_kg = excluded.weight_kg,
         weight_timestamp = excluded.weight_timestamp, synced = 1, updated_at = excluded.updated_at
       WHERE health_metrics.synced = 1
         AND julianday(health_metrics.updated_at) <= julianday(excluded.updated_at)`,
      [`${metric.user_id}_${metric.summary_date}`, metric.user_id, metric.summary_date, metric.steps,
        metric.heart_rate_bpm, metric.heart_rate_timestamp, metric.weight_kg, metric.weight_timestamp, metric.updated_at],
    );
    return result.changes > 0;
  }

  async insertHealthMetric(metric: Omit<LocalHealthMetric, 'synced' | 'updated_at'>): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    await this.db.runAsync(
      `INSERT INTO health_metrics
       (id, user_id, summary_date, steps, heart_rate_bpm, heart_rate_timestamp, weight_kg, weight_timestamp, synced, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
       ON CONFLICT(user_id, summary_date) DO UPDATE SET
         steps = excluded.steps, heart_rate_bpm = excluded.heart_rate_bpm,
         heart_rate_timestamp = excluded.heart_rate_timestamp, weight_kg = excluded.weight_kg,
         weight_timestamp = excluded.weight_timestamp, synced = 0, updated_at = excluded.updated_at`,
      [
        metric.id,
        metric.user_id,
        metric.summary_date,
        metric.steps,
        metric.heart_rate_bpm,
        metric.heart_rate_timestamp,
        metric.weight_kg,
        metric.weight_timestamp,
        new Date().toISOString()
      ]
    );
  }

  async insertHealthMetricAndQueue(
    metric: Omit<LocalHealthMetric, 'synced' | 'updated_at'>,
    syncData?: unknown,
  ): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const now = new Date().toISOString();
    const db = this.db;
    await this.withTransaction(async () => {
      await db.runAsync(
        `INSERT INTO health_metrics
         (id, user_id, summary_date, steps, heart_rate_bpm, heart_rate_timestamp, weight_kg, weight_timestamp, synced, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
         ON CONFLICT(user_id, summary_date) DO UPDATE SET
           steps = excluded.steps, heart_rate_bpm = excluded.heart_rate_bpm,
           heart_rate_timestamp = excluded.heart_rate_timestamp, weight_kg = excluded.weight_kg,
           weight_timestamp = excluded.weight_timestamp, synced = 0, updated_at = excluded.updated_at`,
        [
          metric.id,
          metric.user_id,
          metric.summary_date,
          metric.steps,
          metric.heart_rate_bpm,
          metric.heart_rate_timestamp,
          metric.weight_kg,
          metric.weight_timestamp,
          now,
        ]
      );
      await db.runAsync(
        `INSERT INTO sync_queue (table_name, operation, record_id, data, created_at, next_retry_at)
         SELECT 'health_metrics', 'upsert', id, ?, ?, ? FROM health_metrics
         WHERE user_id = ? AND summary_date = ?`,
        [JSON.stringify(syncData || {}), now, now, metric.user_id, metric.summary_date]
      );
    });
  }

  async getHealthMetricsForRange(userId: string, startDate: string, endDate: string): Promise<LocalHealthMetric[]> {
    if (!this.db) throw new Error('Database not initialized');

    const result = await this.db.getAllAsync<LocalHealthMetric>(
      `SELECT * FROM health_metrics 
       WHERE user_id = ? AND summary_date >= ? AND summary_date <= ?
       ORDER BY summary_date DESC`,
      [userId, startDate, endDate]
    );
    return result;
  }

  async getLatestHealthMetric(userId: string): Promise<LocalHealthMetric | null> {
    if (!this.db) throw new Error('Database not initialized');

    const result = await this.db.getAllAsync<LocalHealthMetric>(
      `SELECT * FROM health_metrics 
       WHERE user_id = ?
       ORDER BY summary_date DESC
       LIMIT 1`,
      [userId]
    );
    return result[0] || null;
  }

  async getHealthMetricByDate(userId: string, summaryDate: string): Promise<LocalHealthMetric | null> {
    if (!this.db) throw new Error('Database not initialized');

    const result = await this.db.getAllAsync<LocalHealthMetric>(
      `SELECT * FROM health_metrics 
       WHERE user_id = ? AND summary_date = ?`,
      [userId, summaryDate]
    );
    return result[0] || null;
  }

  async getHealthMetricById(id: string): Promise<LocalHealthMetric | null> {
    if (!this.db) throw new Error('Database not initialized');

    const result = await this.db.getAllAsync<LocalHealthMetric>(
      'SELECT * FROM health_metrics WHERE id = ?',
      [id]
    );
    return result[0] || null;
  }

  async getUnsyncedHealthMetrics(): Promise<LocalHealthMetric[]> {
    if (!this.db) throw new Error('Database not initialized');

    const result = await this.db.getAllAsync<LocalHealthMetric>(
      'SELECT * FROM health_metrics WHERE synced = 0 ORDER BY summary_date ASC'
    );
    return result;
  }

  async updateHealthMetricSyncStatus(id: string, synced: boolean, expectedUpdatedAt?: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    await this.db.runAsync(
      'UPDATE health_metrics SET synced = ? WHERE id = ? AND (? IS NULL OR updated_at = ?)',
      [synced ? 1 : 0, id, expectedUpdatedAt ?? null, expectedUpdatedAt ?? null]
    );
  }

  async updateHealthMetric(id: string, updates: Partial<LocalHealthMetric>): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const fields = Object.keys(updates).filter(k => k !== 'id');
    if (fields.length === 0) return;

    const setClauses = fields.map(f => `${f} = ?`).join(', ');
    const values = fields.map(f => {
      const val = updates[f as keyof LocalHealthMetric];
      return val === undefined ? null : val;
    });
    values.push(id);

    await this.db.runAsync(
      `UPDATE health_metrics SET ${setClauses} WHERE id = ?`,
      values
    );
  }

  async deleteSyncedHealthMetric(userId: string, summaryDate: string, updatedAt: string, isCurrent?: () => boolean): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    await this.runCurrentHealthWrite(
      'DELETE FROM health_metrics WHERE user_id = ? AND summary_date = ? AND synced = 1 AND julianday(updated_at) <= julianday(?)',
      [userId, summaryDate, updatedAt],
      isCurrent,
    );
  }

  async deleteHealthMetric(id: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    await this.db.runAsync('DELETE FROM health_metrics WHERE id = ?', [id]);
  }

  async getHealthMetricsCount(userId: string): Promise<number> {
    if (!this.db) throw new Error('Database not initialized');

    const result = await this.db.getAllAsync<{ count: number }>(
      'SELECT COUNT(*) as count FROM health_metrics WHERE user_id = ?',
      [userId]
    );
    return result[0]?.count || 0;
  }

  async reconcileNutritionGoals(
    incoming: LocalNutritionGoals, expected: LocalNutritionGoals, isCurrent?: () => boolean,
  ): Promise<boolean> {
    if (!incoming.user_id || !expected.user_id || incoming.user_id !== expected.user_id) return false;
    const result = await this.runCurrentHealthWrite(
      `UPDATE nutrition_goals
       SET calories_goal = ?, protein_goal = ?, carbs_goal = ?, fat_goal = ?, updated_at = ?, synced = 1
       WHERE id = ? AND user_id = ? AND calories_goal = ? AND protein_goal = ?
         AND carbs_goal = ? AND fat_goal = ? AND synced = ? AND updated_at = ?`,
      [incoming.calories_goal, incoming.protein_goal, incoming.carbs_goal, incoming.fat_goal,
        incoming.updated_at, expected.id, expected.user_id, expected.calories_goal,
        expected.protein_goal, expected.carbs_goal, expected.fat_goal, expected.synced, expected.updated_at],
      // Always prepare explicitly so connection replacement is guarded even
      // when the caller has no separate cancellation predicate.
      isCurrent ?? (() => true),
    );
    return result.changes > 0;
  }

  async upsertNutritionGoals(goals: Omit<LocalNutritionGoals, 'synced' | 'updated_at'>, synced = 0): Promise<void> {
    const dbResult = await this.ensureInitialized();
    if (!dbResult.ok) {
      throw new Error(dbResult.error.message);
    }

    await dbResult.data.runAsync(
      `INSERT OR REPLACE INTO nutrition_goals (id, user_id, calories_goal, protein_goal, carbs_goal, fat_goal, synced, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ,
      [
        goals.id,
        goals.user_id,
        goals.calories_goal,
        goals.protein_goal,
        goals.carbs_goal,
        goals.fat_goal,
        synced,
        new Date().toISOString(),
      ]
    );
  }

  async upsertNutritionGoalsAndQueue(
    goals: Omit<LocalNutritionGoals, 'synced' | 'updated_at'>,
    syncData?: unknown,
  ): Promise<void> {
    const dbResult = await this.ensureInitialized();
    if (!dbResult.ok) {
      throw new Error(dbResult.error.message);
    }

    const now = new Date().toISOString();
    await this.withTransaction(async () => {
      await dbResult.data.runAsync(
        `INSERT OR REPLACE INTO nutrition_goals (id, user_id, calories_goal, protein_goal, carbs_goal, fat_goal, synced, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
        [
          goals.id,
          goals.user_id,
          goals.calories_goal,
          goals.protein_goal,
          goals.carbs_goal,
          goals.fat_goal,
          now,
        ]
      );
      await dbResult.data.runAsync(
        'INSERT INTO sync_queue (table_name, operation, record_id, data, created_at, next_retry_at) VALUES (?, ?, ?, ?, ?, ?)',
        ['nutrition_goals', 'upsert', goals.id, JSON.stringify(syncData || {}), now, now]
      );
    });
  }

  async getNutritionGoals(userId: string): Promise<LocalNutritionGoals | null> {
    const dbResult = await this.ensureInitialized();
    if (!dbResult.ok) {
      throw new Error(dbResult.error.message);
    }

    const result = await dbResult.data.getAllAsync<LocalNutritionGoals>(
      'SELECT * FROM nutrition_goals WHERE user_id = ? LIMIT 1',
      [userId]
    );
    return result[0] || null;
  }

  async getNutritionGoalsById(id: string): Promise<LocalNutritionGoals | null> {
    if (!this.db) throw new Error('Database not initialized');

    const result = await this.db.getAllAsync<LocalNutritionGoals>(
      'SELECT * FROM nutrition_goals WHERE id = ? LIMIT 1',
      [id]
    );
    return result[0] || null;
  }

  async getUnsyncedNutritionGoals(): Promise<LocalNutritionGoals[]> {
    if (!this.db) throw new Error('Database not initialized');

    const result = await this.db.getAllAsync<LocalNutritionGoals>(
      'SELECT * FROM nutrition_goals WHERE synced = 0'
    );
    return result;
  }

  async updateNutritionGoalsSyncStatus(id: string, synced: boolean, expected?: Partial<LocalNutritionGoals>): Promise<void> {
    await this.updateLegacySyncStatus('nutrition_goals', id, synced, expected);
  }

  async updateNutritionGoals(id: string, updates: Partial<LocalNutritionGoals>): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const fields = Object.keys(updates).filter(k => k !== 'id');
    if (fields.length === 0) return;

    const setClauses = fields.map(f => `${f} = ?`).join(', ');
    const values = fields.map(f => {
      const val = updates[f as keyof LocalNutritionGoals];
      return val === undefined ? null : val;
    });
    values.push(id);

    await this.db.runAsync(
      `UPDATE nutrition_goals SET ${setClauses} WHERE id = ?`,
      values
    );
  }

  async insertNutritionGoals(goals: Omit<LocalNutritionGoals, 'synced' | 'updated_at'>): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    await this.db.runAsync(
      `INSERT OR REPLACE INTO nutrition_goals (id, user_id, calories_goal, protein_goal, carbs_goal, fat_goal, synced, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
      [goals.id, goals.user_id, goals.calories_goal, goals.protein_goal, goals.carbs_goal, goals.fat_goal, new Date().toISOString()]
    );
  }

  async insertNutritionGoalsAndQueue(
    goals: Omit<LocalNutritionGoals, 'synced' | 'updated_at'>,
    syncData?: unknown,
  ): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const now = new Date().toISOString();
    const db = this.db;
    await this.withTransaction(async () => {
      await db.runAsync(
        `INSERT OR REPLACE INTO nutrition_goals (id, user_id, calories_goal, protein_goal, carbs_goal, fat_goal, synced, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
        [goals.id, goals.user_id, goals.calories_goal, goals.protein_goal, goals.carbs_goal, goals.fat_goal, now]
      );
      await db.runAsync(
        'INSERT INTO sync_queue (table_name, operation, record_id, data, created_at, next_retry_at) VALUES (?, ?, ?, ?, ?, ?)',
        ['nutrition_goals', 'upsert', goals.id, JSON.stringify(syncData || {}), now, now]
      );
    });
  }

  async deleteNutritionGoals(id: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    await this.db.runAsync('DELETE FROM nutrition_goals WHERE id = ?', [id]);
  }

  // Sync queue operations
  async addToSyncQueue(
    tableName: SyncTableName,
    operation: SyncOperation,
    recordId: string,
    data?: unknown
  ): Promise<void> {
    const dbResult = await this.ensureInitialized();
    if (!dbResult.ok) {
      throw new Error(dbResult.error.message);
    }
    const nowIso = new Date().toISOString();

    await this.withTransaction(async () => {
      await dbResult.data.runAsync(
        'DELETE FROM sync_queue WHERE table_name = ? AND record_id = ?',
        [tableName, recordId]
      );
      await dbResult.data.runAsync(
        'INSERT INTO sync_queue (table_name, operation, record_id, data, created_at, next_retry_at) VALUES (?, ?, ?, ?, ?, ?)',
        [tableName, operation, recordId, JSON.stringify(data || {}), nowIso, nowIso]
      );
    });
  }

  async getSyncQueue(): Promise<SyncQueueItem[]> {
    if (!this.db) throw new Error('Database not initialized');

    return await this.db.getAllAsync<SyncQueueItem>(
      'SELECT * FROM sync_queue ORDER BY COALESCE(next_retry_at, created_at) ASC, id ASC'
    );
  }

  async removeSyncQueueItem(id: number): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    await this.db.runAsync('DELETE FROM sync_queue WHERE id = ?', [id]);
  }

  async incrementSyncQueueRetry(id: number, nextRetryAt: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    await this.db.runAsync(
      'UPDATE sync_queue SET retry_count = retry_count + 1, next_retry_at = ? WHERE id = ?',
      [nextRetryAt, id]
    );
  }

  async countSyncQueueItems(): Promise<number> {
    if (!this.db) throw new Error('Database not initialized');

    const rows = await this.db.getAllAsync<{ count: number }>(
      'SELECT COUNT(*) as count FROM sync_queue'
    );
    return rows[0]?.count ?? 0;
  }

  // Cleanup operations
  async cleanupSyncedDeletes(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const db = this.db;
    await this.withTransaction(async () => {
      await db.runAsync('DELETE FROM foods WHERE deleted = 1 AND synced = 1');
      await db.runAsync('DELETE FROM workouts WHERE deleted = 1 AND synced = 1');
      // Workout session tables
      await db.runAsync('DELETE FROM workout_templates WHERE deleted = 1 AND synced = 1');
      await db.runAsync('DELETE FROM workout_template_exercises WHERE deleted = 1 AND synced = 1');
      await db.runAsync('DELETE FROM workout_template_sets WHERE deleted = 1 AND synced = 1');
      await db.runAsync('DELETE FROM workout_sessions WHERE deleted = 1 AND synced = 1');
      await db.runAsync('DELETE FROM workout_session_exercises WHERE deleted = 1 AND synced = 1');
      await db.runAsync('DELETE FROM workout_session_sets WHERE deleted = 1 AND synced = 1');
    });
  }

  async clearSyncQueue(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    await this.db.runAsync('DELETE FROM sync_queue');
    logWithTs('[LocalDB] Sync queue cleared');
  }

  // Migrate legacy workouts into session format (runs once)
  async migrateLegacyWorkouts(): Promise<void> {
    const db = this.db;
    if (!db) return;

    try {
      // Check if migration was already done by looking for a marker
      const marker = await db.getAllAsync<{ count: number }>(
        "SELECT COUNT(*) as count FROM workout_sessions WHERE notes = '__legacy_migration__'"
      );
      if (marker[0]?.count > 0) return; // already migrated

      const legacyWorkouts = await db.getAllAsync<LocalWorkout>(
        'SELECT * FROM workouts WHERE deleted = 0'
      );

      if (legacyWorkouts.length === 0) return;

      logWithTs(`[LocalDB] Migrating ${legacyWorkouts.length} legacy workouts to sessions...`);

      for (const w of legacyWorkouts) {
        const now = new Date().toISOString();
        const sessionId = w.id; // reuse the old ID

        // Find matching exercise
        const exerciseRows = await db.getAllAsync<{ id: string }>(
          'SELECT id FROM exercises WHERE lower(name) = lower(?) LIMIT 1',
          [w.exercise]
        );

        if (exerciseRows.length === 0) {
          // No matching exercise found, skip
          continue;
        }

        const exerciseId = exerciseRows[0].id;

        // Check if session already exists
        const existing = await db.getAllAsync<{ id: string }>(
          'SELECT id FROM workout_sessions WHERE id = ?',
          [sessionId]
        );
        if (existing.length > 0) continue;

        // Wrap all three inserts for this workout in a single transaction
        await this.withTransaction(async () => {
          // Create session
          await db.runAsync(
            `INSERT INTO workout_sessions (id, template_id, name, goal_profile, started_at, ended_at, timezone_offset_minutes, bodyweight_lb, notes, synced, deleted, updated_at, created_at)
             VALUES (?, NULL, ?, 'hypertrophy', ?, ?, 0, NULL, '__legacy_migration__', 0, 0, ?, ?)`,
            [sessionId, w.exercise, w.date || now, w.date || now, now, now]
          );

          // Create session exercise
          const seId = `${sessionId}_ex0`;
          await db.runAsync(
            `INSERT INTO workout_session_exercises (id, session_id, exercise_id, sort_order, notes, synced, deleted, updated_at, created_at)
             VALUES (?, ?, ?, 0, NULL, 0, 0, ?, ?)`,
            [seId, sessionId, exerciseId, now, now]
          );

          // Create session set
          const ssId = `${sessionId}_set0`;
          await db.runAsync(
            `INSERT INTO workout_session_sets (id, session_exercise_id, sort_order, set_type, actual_reps, actual_weight, actual_seconds, completed_at, tut_source, synced, deleted, updated_at, created_at, rest_skipped)
             VALUES (?, ?, 0, 'normal', ?, ?, ?, ?, 'unknown', 0, 0, ?, ?, 0)`,
            [ssId, seId, w.reps ?? null, w.weight ?? null, w.duration ?? null, w.date || now, now, now]
          );
        });
      }

      logWithTs(`[LocalDB] Legacy workout migration complete`);
    } catch (error) {
      errorWithTs('[LocalDB] Legacy workout migration failed:', error);
    }
  }

  // Database utilities
  async clearAllData(): Promise<void> {
    const db = this.db;
    if (!db) throw new Error('Database not initialized');

    // Join the transaction serializer and retain this connection while waiting.
    // Cleanup must not be undone by another transaction's rollback or partly commit.
    await this.withTransaction(async () => {
      await db.execAsync(`
        DELETE FROM foods;
        DELETE FROM workouts;
        DELETE FROM health_metrics;
        DELETE FROM nutrition_goals;
        DELETE FROM sync_queue;
        DELETE FROM exercises;
        DELETE FROM workout_templates;
        DELETE FROM workout_template_exercises;
        DELETE FROM workout_template_sets;
        DELETE FROM workout_sessions;
        DELETE FROM workout_session_exercises;
        DELETE FROM workout_session_sets;
        DELETE FROM workout_session_events;
        DELETE FROM debrief_notes;
      `);
    });
    logWithTs('[LocalDB] All data cleared');
  }

  // =========================================================================
  // A18 — Debrief notes
  // =========================================================================

  /**
   * Upsert per-session debrief notes: free-text notes, starred fault ids,
   * and whether the user asked us to save the cues as personalized for
   * next time. Only an undeleted session's persisted owner may write; false
   * means no row was applied. Invalidated callers leave existing notes intact.
   */
  async saveDebriefNotes(
    userId: string,
    sessionId: string,
    notes: string,
    starredFaultIds: string[],
    savedCues: boolean,
    isCurrent?: () => boolean,
  ): Promise<boolean> {
    if (!userId.trim()) throw new Error('userId must not be blank');
    if (isCurrent && !isCurrent()) return false;
    if (!this.db) await this.initialize();
    if (isCurrent && !isCurrent()) return false;
    if (!this.db) throw new Error('Database not initialized');
    const now = new Date().toISOString();
    const result = await this.runCurrentHealthWrite(
      `INSERT INTO debrief_notes (session_id, notes, starred_fault_ids, saved_cues, updated_at)
       SELECT ?, ?, ?, ?, ?
       WHERE EXISTS (
         SELECT 1 FROM workout_sessions
         WHERE id = ? AND user_id = ? AND COALESCE(deleted, 0) = 0
       )
       ON CONFLICT(session_id) DO UPDATE SET
         notes = excluded.notes,
         starred_fault_ids = excluded.starred_fault_ids,
         saved_cues = excluded.saved_cues,
         updated_at = excluded.updated_at`,
      [
        sessionId,
        notes ?? '',
        JSON.stringify(Array.isArray(starredFaultIds) ? starredFaultIds : []),
        savedCues ? 1 : 0,
        now,
        sessionId,
        userId,
      ],
      // Force post-prepare connection checks even without caller cancellation.
      isCurrent ?? (() => true),
    );
    return result.changes > 0;
  }

  /**
   * Read the most recent debrief-notes row for the given session. Returns
   * null for unavailable/unowned notes or an invalidated caller/connection.
   */
  async getDebriefNotes(userId: string, sessionId: string, isCurrent?: () => boolean): Promise<
    | {
        sessionId: string;
        notes: string;
        starredFaultIds: string[];
        savedCues: boolean;
        updatedAt: string;
      }
    | null
  > {
    if (!userId.trim()) throw new Error('userId must not be blank');
    if (isCurrent && !isCurrent()) return null;
    if (!this.db) await this.initialize();
    if (isCurrent && !isCurrent()) return null;
    const db = this.db;
    if (!db) return null;
    const row = await db.getFirstAsync<{
      session_id: string;
      notes: string;
      starred_fault_ids: string;
      saved_cues: number;
      updated_at: string;
    }>(
      `SELECT n.session_id, n.notes, n.starred_fault_ids, n.saved_cues, n.updated_at
       FROM debrief_notes n JOIN workout_sessions s ON s.id = n.session_id
       WHERE n.session_id = ? AND s.user_id = ? AND COALESCE(s.deleted, 0) = 0`,
      [sessionId, userId],
    );
    if (this.db !== db || (isCurrent && !isCurrent()) || !row) return null;
    let starred: string[] = [];
    try {
      const parsed = JSON.parse(row.starred_fault_ids);
      if (Array.isArray(parsed)) {
        starred = parsed.filter((id): id is string => typeof id === 'string');
      }
    } catch {
      // tolerate legacy / malformed rows
    }
    return {
      sessionId: row.session_id,
      notes: row.notes ?? '',
      starredFaultIds: starred,
      savedCues: row.saved_cues === 1,
      updatedAt: row.updated_at,
    };
  }

  async close(): Promise<void> {
    if (this.db) {
      await this.db.closeAsync();
      this.db = null;
      this.initPromise = null;
      logWithTs('[LocalDB] Database closed');
    }
  }
}

// Export singleton instance
export const localDB = new LocalDatabase();
