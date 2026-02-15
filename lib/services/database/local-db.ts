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

export type SyncTableName = 'foods' | 'workouts' | 'health_metrics' | 'nutrition_goals';
export type SyncOperation = 'upsert' | 'delete';

export interface SyncQueueItem {
  id: number;
  table_name: SyncTableName;
  operation: SyncOperation;
  record_id: string;
  data: string | null;
  created_at: string;
  retry_count: number;
  next_retry_at: string | null;
}

class LocalDatabase {
  public db: SQLite.SQLiteDatabase | null = null;
  private initPromise: Promise<void> | null = null;

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

  async updateFoodSyncStatus(id: string, synced: boolean): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    await this.db.runAsync(
      'UPDATE foods SET synced = ?, updated_at = ? WHERE id = ?',
      [synced ? 1 : 0, new Date().toISOString(), id]
    );
  }

  async softDeleteFood(id: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    await this.db.runAsync(
      'UPDATE foods SET deleted = 1, synced = 0, updated_at = ? WHERE id = ?',
      [new Date().toISOString(), id]
    );
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

  async updateWorkoutSyncStatus(id: string, synced: boolean): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    await this.db.runAsync(
      'UPDATE workouts SET synced = ?, updated_at = ? WHERE id = ?',
      [synced ? 1 : 0, new Date().toISOString(), id]
    );
  }

  async softDeleteWorkout(id: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    await this.db.runAsync(
      'UPDATE workouts SET deleted = 1, synced = 0, updated_at = ? WHERE id = ?',
      [new Date().toISOString(), id]
    );
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

  // Health Metric operations
  async insertHealthMetric(metric: Omit<LocalHealthMetric, 'synced' | 'updated_at'>): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    await this.db.runAsync(
      `INSERT OR REPLACE INTO health_metrics 
       (id, user_id, summary_date, steps, heart_rate_bpm, heart_rate_timestamp, weight_kg, weight_timestamp, synced, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
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

  async updateHealthMetricSyncStatus(id: string, synced: boolean): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    await this.db.runAsync(
      'UPDATE health_metrics SET synced = ?, updated_at = ? WHERE id = ?',
      [synced ? 1 : 0, new Date().toISOString(), id]
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

  async updateNutritionGoalsSyncStatus(id: string, synced: boolean): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    await this.db.runAsync(
      'UPDATE nutrition_goals SET synced = ?, updated_at = ? WHERE id = ?',
      [synced ? 1 : 0, new Date().toISOString(), id]
    );
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
    if (!this.db) throw new Error('Database not initialized');
    const nowIso = new Date().toISOString();

    await this.db.runAsync(
      'INSERT INTO sync_queue (table_name, operation, record_id, data, created_at, next_retry_at) VALUES (?, ?, ?, ?, ?, ?)',
      [tableName, operation, recordId, JSON.stringify(data || {}), nowIso, nowIso]
    );
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

    await this.db.runAsync('DELETE FROM foods WHERE deleted = 1 AND synced = 1');
    await this.db.runAsync('DELETE FROM workouts WHERE deleted = 1 AND synced = 1');
    // Workout session tables
    await this.db.runAsync('DELETE FROM workout_templates WHERE deleted = 1 AND synced = 1');
    await this.db.runAsync('DELETE FROM workout_template_exercises WHERE deleted = 1 AND synced = 1');
    await this.db.runAsync('DELETE FROM workout_template_sets WHERE deleted = 1 AND synced = 1');
    await this.db.runAsync('DELETE FROM workout_sessions WHERE deleted = 1 AND synced = 1');
    await this.db.runAsync('DELETE FROM workout_session_exercises WHERE deleted = 1 AND synced = 1');
    await this.db.runAsync('DELETE FROM workout_session_sets WHERE deleted = 1 AND synced = 1');
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
      }

      logWithTs(`[LocalDB] Legacy workout migration complete`);
    } catch (error) {
      errorWithTs('[LocalDB] Legacy workout migration failed:', error);
    }
  }

  // Database utilities
  async clearAllData(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    await this.db.execAsync(`
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
    `);
    logWithTs('[LocalDB] All data cleared');
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
