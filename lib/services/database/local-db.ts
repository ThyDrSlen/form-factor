import * as SQLite from 'expo-sqlite';

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

class LocalDatabase {
  public db: SQLite.SQLiteDatabase | null = null;
  private initPromise: Promise<void> | null = null;

  async initialize(): Promise<void> {
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = (async () => {
      try {
        console.log('[LocalDB] Opening database...');
        this.db = await SQLite.openDatabaseAsync('formfactor.db');
        
        await this.createTables();
        console.log('[LocalDB] Database initialized successfully');
      } catch (error) {
        console.error('[LocalDB] Failed to initialize database:', error);
        throw error;
      }
    })();

    return this.initPromise;
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

    // Create sync queue table for operations that failed to sync
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
    `);

    console.log('[LocalDB] Tables created successfully');
  }

  // Food operations
  async insertFood(food: Omit<LocalFood, 'synced' | 'deleted' | 'updated_at'>): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    await this.db.runAsync(
      `INSERT OR REPLACE INTO foods (id, name, calories, protein, carbs, fat, date, synced, deleted, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?)`,
      [food.id, food.name, food.calories, food.protein || null, food.carbs || null, food.fat || null, food.date, new Date().toISOString()]
    );
  }

  async getAllFoods(): Promise<LocalFood[]> {
    if (!this.db) throw new Error('Database not initialized');

    const result = await this.db.getAllAsync<LocalFood>(
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
    if (!this.db) throw new Error('Database not initialized');

    await this.db.runAsync(
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
    if (!this.db) throw new Error('Database not initialized');

    const result = await this.db.getAllAsync<LocalWorkout>(
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
    console.log('[LocalDB] Sync queue cleared');
  }

  // Database utilities
  async clearAllData(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    await this.db.execAsync(`
      DELETE FROM foods;
      DELETE FROM workouts;
      DELETE FROM sync_queue;
    `);
    console.log('[LocalDB] All data cleared');
  }

  async close(): Promise<void> {
    if (this.db) {
      await this.db.closeAsync();
      this.db = null;
      this.initPromise = null;
      console.log('[LocalDB] Database closed');
    }
  }
}

// Export singleton instance
export const localDB = new LocalDatabase();

