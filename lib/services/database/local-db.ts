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
        retry_count INTEGER DEFAULT 0
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
    `);

    logWithTs('[LocalDB] Tables created successfully');
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
  async addToSyncQueue(tableName: string, operation: string, recordId: string, data?: any): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    await this.db.runAsync(
      'INSERT INTO sync_queue (table_name, operation, record_id, data, created_at) VALUES (?, ?, ?, ?, ?)',
      [tableName, operation, recordId, JSON.stringify(data || {}), new Date().toISOString()]
    );
  }

  async getSyncQueue(): Promise<any[]> {
    if (!this.db) throw new Error('Database not initialized');

    return await this.db.getAllAsync('SELECT * FROM sync_queue ORDER BY created_at ASC');
  }

  async removeSyncQueueItem(id: number): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    await this.db.runAsync('DELETE FROM sync_queue WHERE id = ?', [id]);
  }

  async incrementSyncQueueRetry(id: number): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    await this.db.runAsync('UPDATE sync_queue SET retry_count = retry_count + 1 WHERE id = ?', [id]);
  }

  // Cleanup operations
  async cleanupSyncedDeletes(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    await this.db.runAsync('DELETE FROM foods WHERE deleted = 1 AND synced = 1');
    await this.db.runAsync('DELETE FROM workouts WHERE deleted = 1 AND synced = 1');
  }

  async clearSyncQueue(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    await this.db.runAsync('DELETE FROM sync_queue');
    logWithTs('[LocalDB] Sync queue cleared');
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

