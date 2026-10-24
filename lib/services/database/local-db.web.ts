import type { SyncTableName, SyncOperation, SyncQueueItem } from './sync-types';
// Web-compatible version using localStorage (simplified for web)
// For production web, consider using IndexedDB wrapper like Dexie.js

import { errorWithTs, logWithTs, warnWithTs } from '@/lib/logger';

export interface LocalFood {
  id: string;
  name: string;
  calories: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  date: string;
  synced: number;
  deleted: number;
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

export type { SyncTableName, SyncOperation, SyncQueueItem } from './sync-types';

class LocalDatabase {
  public readonly supportsWorkoutSync: boolean = false;
  private initialized = false;
  private transactionTail: Promise<void> = Promise.resolve();

  async initialize(): Promise<void> {
    if (this.initialized) return;
    logWithTs('[LocalDB-Web] Initializing localStorage...');
    this.initialized = true;
  }

  private getStorageKey(type: 'foods' | 'workouts' | 'health_metrics' | 'nutrition_goals' | 'sync_queue'): string {
    return `formfactor_${type}`;
  }

  private getData<T>(key: string): T[] {
    try {
      const data = localStorage.getItem(key);
      if (data === null) return [];
      const parsed: unknown = JSON.parse(data);
      if (!Array.isArray(parsed)) {
        throw new Error(`Invalid stored collection for key ${key}: expected an array`);
      }
      return parsed;
    } catch (e) {
      warnWithTs(`[LocalDB-Web] Failed to read data for key ${key}`, e);
      // A failed read is not an empty collection. Aborting preserves the stored
      // bytes instead of letting a later read-modify-write silently replace them.
      throw e;
    }
  }

  private setData<T>(key: string, data: T[]): void {
    try {
      localStorage.setItem(key, JSON.stringify(data));
    } catch (e) {
      errorWithTs(`[LocalDB-Web] Failed to save data for key ${key}`, e);
      throw e;
    }
  }

  async withTransaction(fn: () => Promise<void>): Promise<void> {
    // Snapshot only when this transaction starts; overlapping rollbacks must
    // not restore storage over another transaction's successfully saved work.
    const transaction = this.transactionTail.then(async () => {
      const keys = ['foods', 'workouts', 'health_metrics', 'nutrition_goals', 'sync_queue'] as const;
      const snapshot = keys.map(key => [this.getStorageKey(key), localStorage.getItem(this.getStorageKey(key))] as const);
      try {
        await fn();
      } catch (error) {
        for (const [key, value] of snapshot) {
          if (value === null) localStorage.removeItem(key);
          else localStorage.setItem(key, value);
        }
        throw error;
      }
    });
    this.transactionTail = transaction.catch(() => {});
    await transaction;
  }

  // Food operations
  async insertFood(food: Omit<LocalFood, 'synced' | 'deleted' | 'updated_at'>): Promise<void> {
    const foods = this.getData<LocalFood>(this.getStorageKey('foods'));
    // Check if exists and replace
    const existingIndex = foods.findIndex(f => f.id === food.id);
    const newFood = {
      ...food,
      synced: 0,
      deleted: 0,
      updated_at: new Date().toISOString(),
    };
    
    if (existingIndex >= 0) {
      foods[existingIndex] = newFood;
    } else {
      foods.push(newFood);
    }
    this.setData(this.getStorageKey('foods'), foods);
  }

  async updateFood(id: string, updates: Partial<LocalFood>): Promise<void> {
    const foods = this.getData<LocalFood>(this.getStorageKey('foods'));
    const index = foods.findIndex(f => f.id === id);
    if (index !== -1) {
      foods[index] = { ...foods[index], ...updates, updated_at: updates.updated_at ?? new Date().toISOString() };
      this.setData(this.getStorageKey('foods'), foods);
    }
  }

  async softDeleteFood(id: string): Promise<void> {
    await this.updateFood(id, { deleted: 1, synced: 0 });
  }

  async hardDeleteFood(id: string): Promise<void> {
    const foods = this.getData<LocalFood>(this.getStorageKey('foods'));
    this.setData(this.getStorageKey('foods'), foods.filter(f => f.id !== id));
  }

  async getAllFoods(): Promise<LocalFood[]> {
    return this.getData<LocalFood>(this.getStorageKey('foods'))
      .filter(f => f.deleted === 0)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }

  async getUnsyncedFoods(): Promise<LocalFood[]> {
    return this.getData<LocalFood>(this.getStorageKey('foods'))
      .filter(f => f.synced === 0);
  }

  async getFoodById(id: string, includeDeleted = true): Promise<LocalFood | null> {
    const foods = this.getData<LocalFood>(this.getStorageKey('foods'));
    const predicate = includeDeleted
      ? (f: LocalFood) => f.id === id
      : (f: LocalFood) => f.id === id && f.deleted === 0;
    return foods.find(predicate) || null;
  }

  async getAllFoodsWithDeleted(): Promise<LocalFood[]> {
    return this.getData<LocalFood>(this.getStorageKey('foods'));
  }

  async reconcileFood(
    incoming: LocalFood, expected: LocalFood, isCurrent?: () => boolean,
  ): Promise<boolean> {
    if (incoming.id !== expected.id || (isCurrent && !isCurrent())) return false;
    const key = this.getStorageKey('foods');
    const rows = this.getData<LocalFood>(key);
    const index = rows.findIndex(row => row.id === expected.id);
    const fields: (keyof LocalFood)[] = [
      'id', 'name', 'calories', 'protein', 'carbs', 'fat', 'date', 'synced', 'deleted', 'updated_at',
    ];
    // Do not yield between comparing the captured content and persisting the replacement.
    if (index < 0 || !fields.every(field => (rows[index][field] ?? null) === (expected[field] ?? null))) return false;
    rows[index] = {
      ...rows[index], name: incoming.name, calories: incoming.calories, protein: incoming.protein,
      carbs: incoming.carbs, fat: incoming.fat, date: incoming.date,
      updated_at: incoming.updated_at, deleted: incoming.deleted, synced: 1,
    };
    this.setData(key, rows);
    return true;
  }

  async reconcileWorkout(
    incoming: LocalWorkout, expected: LocalWorkout, isCurrent?: () => boolean,
  ): Promise<boolean> {
    if (incoming.id !== expected.id || (isCurrent && !isCurrent())) return false;
    const key = this.getStorageKey('workouts');
    const rows = this.getData<LocalWorkout>(key);
    const index = rows.findIndex(row => row.id === expected.id);
    const fields: (keyof LocalWorkout)[] = [
      'id', 'exercise', 'sets', 'reps', 'weight', 'duration', 'date', 'synced', 'deleted', 'updated_at',
    ];
    if (index < 0 || !fields.every(field => (rows[index][field] ?? null) === (expected[field] ?? null))) return false;
    rows[index] = {
      ...rows[index], exercise: incoming.exercise, sets: incoming.sets, reps: incoming.reps,
      weight: incoming.weight, duration: incoming.duration, date: incoming.date,
      updated_at: incoming.updated_at, deleted: incoming.deleted, synced: 1,
    };
    this.setData(key, rows);
    return true;
  }

  private updateLegacySyncStatus<T extends LocalFood | LocalWorkout | LocalNutritionGoals>(
    table: 'foods' | 'workouts' | 'nutrition_goals', id: string, synced: boolean, expected?: Partial<T>,
  ): void {
    const rows = this.getData<T>(this.getStorageKey(table));
    const current = rows.find(row => row.id === id);
    // localStorage read/check/write is synchronous, matching the native SQL
    // conditional update, without turning an acknowledgement into an edit.
    if (!current || Object.entries(expected ?? {}).some(([key, value]) =>
      (current[key as keyof T] ?? null) !== (value ?? null))) return;
    current.synced = synced ? 1 : 0;
    this.setData(this.getStorageKey(table), rows);
  }

  async updateFoodSyncStatus(id: string, synced: boolean, expected?: Partial<LocalFood>): Promise<void> {
    this.updateLegacySyncStatus<LocalFood>('foods', id, synced, expected);
  }

  async countFoods(): Promise<number> {
    return this.getData<LocalFood>(this.getStorageKey('foods'))
      .filter(f => f.deleted === 0).length;
  }

  async countUnsyncedFoods(): Promise<number> {
    return this.getData<LocalFood>(this.getStorageKey('foods'))
      .filter(f => f.synced === 0 && f.deleted === 0).length;
  }

  // Workout operations
  async insertWorkout(workout: Omit<LocalWorkout, 'synced' | 'deleted' | 'updated_at'>): Promise<void> {
    const workouts = this.getData<LocalWorkout>(this.getStorageKey('workouts'));
    const existingIndex = workouts.findIndex(w => w.id === workout.id);
    const newWorkout = {
      ...workout,
      synced: 0,
      deleted: 0,
      updated_at: new Date().toISOString(),
    };

    if (existingIndex >= 0) {
      workouts[existingIndex] = newWorkout;
    } else {
      workouts.push(newWorkout);
    }
    this.setData(this.getStorageKey('workouts'), workouts);
  }

  async updateWorkout(id: string, updates: Partial<LocalWorkout>): Promise<void> {
    const workouts = this.getData<LocalWorkout>(this.getStorageKey('workouts'));
    const index = workouts.findIndex(w => w.id === id);
    if (index !== -1) {
      workouts[index] = { ...workouts[index], ...updates, updated_at: updates.updated_at ?? new Date().toISOString() };
      this.setData(this.getStorageKey('workouts'), workouts);
    }
  }

  async softDeleteWorkout(id: string): Promise<void> {
    await this.updateWorkout(id, { deleted: 1, synced: 0 });
  }

  async hardDeleteWorkout(id: string): Promise<void> {
    const workouts = this.getData<LocalWorkout>(this.getStorageKey('workouts'));
    this.setData(this.getStorageKey('workouts'), workouts.filter(w => w.id !== id));
  }

  async getAllWorkouts(): Promise<LocalWorkout[]> {
    return this.getData<LocalWorkout>(this.getStorageKey('workouts'))
      .filter(w => w.deleted === 0)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }

  async getUnsyncedWorkouts(): Promise<LocalWorkout[]> {
    return this.getData<LocalWorkout>(this.getStorageKey('workouts'))
      .filter(w => w.synced === 0);
  }

  async getWorkoutById(id: string, includeDeleted = true): Promise<LocalWorkout | null> {
    const workouts = this.getData<LocalWorkout>(this.getStorageKey('workouts'));
    const predicate = includeDeleted
      ? (w: LocalWorkout) => w.id === id
      : (w: LocalWorkout) => w.id === id && w.deleted === 0;
    return workouts.find(predicate) || null;
  }

  async getAllWorkoutsWithDeleted(): Promise<LocalWorkout[]> {
    return this.getData<LocalWorkout>(this.getStorageKey('workouts'));
  }

  async getWorkoutsByExercise(
    userId: string,
    exerciseNameOrId: string,
    limit?: number,
  ): Promise<LocalWorkout[]> {
    void userId;
    const rows = this.getData<LocalWorkout>(this.getStorageKey('workouts'))
      .filter(w => w.deleted === 0 && w.exercise === exerciseNameOrId)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    if (typeof limit === 'number' && limit > 0) {
      return rows.slice(0, Math.floor(limit));
    }
    return rows;
  }

  async updateWorkoutSyncStatus(id: string, synced: boolean, expected?: Partial<LocalWorkout>): Promise<void> {
    this.updateLegacySyncStatus<LocalWorkout>('workouts', id, synced, expected);
  }

  async countWorkouts(): Promise<number> {
    return this.getData<LocalWorkout>(this.getStorageKey('workouts'))
      .filter(w => w.deleted === 0).length;
  }

  async countUnsyncedWorkouts(): Promise<number> {
    return this.getData<LocalWorkout>(this.getStorageKey('workouts'))
      .filter(w => w.synced === 0 && w.deleted === 0).length;
  }

  // Health Metric operations
  async reconcileHealthMetric(metric: LocalHealthMetric, expectedUpdatedAt?: string, isCurrent?: () => boolean): Promise<boolean>;
  async reconcileHealthMetric(metric: LocalHealthMetric, expected: LocalHealthMetric, isCurrent?: () => boolean): Promise<boolean>;
  async reconcileHealthMetric(metric: LocalHealthMetric, expected?: string | LocalHealthMetric, isCurrent?: () => boolean): Promise<boolean> {
    if (isCurrent && !isCurrent()) return false;
    const metrics = this.getData<LocalHealthMetric>(this.getStorageKey('health_metrics'));
    const index = metrics.findIndex(m => m.user_id === metric.user_id && m.summary_date === metric.summary_date);
    const current = metrics[index];
    // No await between reading, checking and writing the synchronous web store.
    if (typeof expected === 'string') {
      if (!current || current.updated_at !== expected
        || !(Date.parse(current.updated_at) <= Date.parse(metric.updated_at))) return false;
    } else if (expected) {
      if (!current || expected.user_id !== metric.user_id || expected.summary_date !== metric.summary_date
        || !(Date.parse(current.updated_at) <= Date.parse(metric.updated_at))
        || (Object.keys(expected) as (keyof LocalHealthMetric)[]).some(key => current[key] !== expected[key])) return false;
    } else if (current && (current.synced !== 1 || !(Date.parse(current.updated_at) <= Date.parse(metric.updated_at)))) return false;
    const incoming = { ...metric, id: current?.id ?? `${metric.user_id}_${metric.summary_date}`, synced: 1 };
    if (index < 0) metrics.push(incoming);
    else metrics[index] = incoming;
    this.setData(this.getStorageKey('health_metrics'), metrics);
    return true;
  }

  async insertHealthMetric(metric: Omit<LocalHealthMetric, 'synced' | 'updated_at'>): Promise<void> {
    const metrics = this.getData<LocalHealthMetric>(this.getStorageKey('health_metrics'));
    const existingIndex = metrics.findIndex(m => m.id === metric.id || (m.user_id === metric.user_id && m.summary_date === metric.summary_date));
    
    const newMetric = {
      ...metric,
      id: metrics[existingIndex]?.id ?? metric.id,
      synced: 0,
      updated_at: new Date().toISOString(),
    };

    if (existingIndex >= 0) {
      metrics[existingIndex] = newMetric;
    } else {
      metrics.push(newMetric);
    }
    this.setData(this.getStorageKey('health_metrics'), metrics);
  }

  async getHealthMetricsForRange(userId: string, startDate: string, endDate: string): Promise<LocalHealthMetric[]> {
    const metrics = this.getData<LocalHealthMetric>(this.getStorageKey('health_metrics'));
    return metrics
      .filter(m => m.user_id === userId && m.summary_date >= startDate && m.summary_date <= endDate)
      .sort((a, b) => b.summary_date.localeCompare(a.summary_date));
  }

  async getLatestHealthMetric(userId: string): Promise<LocalHealthMetric | null> {
    const metrics = this.getData<LocalHealthMetric>(this.getStorageKey('health_metrics'));
    const userMetrics = metrics
      .filter(m => m.user_id === userId)
      .sort((a, b) => b.summary_date.localeCompare(a.summary_date));
    
    return userMetrics.length > 0 ? userMetrics[0] : null;
  }

  async getHealthMetricByDate(userId: string, summaryDate: string): Promise<LocalHealthMetric | null> {
    const metrics = this.getData<LocalHealthMetric>(this.getStorageKey('health_metrics'));
    return metrics.find(m => m.user_id === userId && m.summary_date === summaryDate) || null;
  }

  async getHealthMetricById(id: string): Promise<LocalHealthMetric | null> {
    const metrics = this.getData<LocalHealthMetric>(this.getStorageKey('health_metrics'));
    return metrics.find(m => m.id === id) || null;
  }

  async getUnsyncedHealthMetrics(): Promise<LocalHealthMetric[]> {
    const metrics = this.getData<LocalHealthMetric>(this.getStorageKey('health_metrics'));
    return metrics
      .filter(m => m.synced === 0)
      .sort((a, b) => a.summary_date.localeCompare(b.summary_date));
  }

  async updateHealthMetricSyncStatus(id: string, synced: boolean, expectedUpdatedAt?: string): Promise<void> {
    const metrics = this.getData<LocalHealthMetric>(this.getStorageKey('health_metrics'));
    const metric = metrics.find(m => m.id === id);
    if (metric && (expectedUpdatedAt === undefined || metric.updated_at === expectedUpdatedAt)) {
      metric.synced = synced ? 1 : 0;
      this.setData(this.getStorageKey('health_metrics'), metrics);
    }
  }

  async updateHealthMetric(id: string, updates: Partial<LocalHealthMetric>): Promise<void> {
    const metrics = this.getData<LocalHealthMetric>(this.getStorageKey('health_metrics'));
    const index = metrics.findIndex(m => m.id === id);
    if (index !== -1) {
      metrics[index] = { ...metrics[index], ...updates, updated_at: updates.updated_at ?? new Date().toISOString() };
      this.setData(this.getStorageKey('health_metrics'), metrics);
    }
  }

  async deleteSyncedHealthMetric(userId: string, summaryDate: string, updatedAt: string, isCurrent?: () => boolean): Promise<void> {
    if (isCurrent && !isCurrent()) return;
    const metrics = this.getData<LocalHealthMetric>(this.getStorageKey('health_metrics'));
    this.setData(this.getStorageKey('health_metrics'), metrics.filter(m => !(m.user_id === userId
      && m.summary_date === summaryDate && m.synced === 1 && Date.parse(m.updated_at) <= Date.parse(updatedAt))));
  }

  async deleteHealthMetric(id: string): Promise<void> {
    const metrics = this.getData<LocalHealthMetric>(this.getStorageKey('health_metrics'));
    this.setData(this.getStorageKey('health_metrics'), metrics.filter(m => m.id !== id));
  }

  async getHealthMetricsCount(userId: string): Promise<number> {
    const metrics = this.getData<LocalHealthMetric>(this.getStorageKey('health_metrics'));
    return metrics.filter(m => m.user_id === userId).length;
  }

  async reconcileNutritionGoals(
    incoming: LocalNutritionGoals, expected: LocalNutritionGoals, isCurrent?: () => boolean,
  ): Promise<boolean> {
    if (!incoming.user_id || !expected.user_id || incoming.user_id !== expected.user_id) return false;
    if (isCurrent && !isCurrent()) return false;
    const key = this.getStorageKey('nutrition_goals');
    const rows = this.getData<LocalNutritionGoals>(key);
    const index = rows.findIndex(row => row.id === expected.id);
    if (index < 0) return false;
    const fields: (keyof LocalNutritionGoals)[] = [
      'id', 'user_id', 'calories_goal', 'protein_goal', 'carbs_goal', 'fat_goal', 'synced', 'updated_at',
    ];
    if (!fields.every(field => rows[index][field] === expected[field])) return false;
    rows[index] = {
      ...rows[index],
      calories_goal: incoming.calories_goal,
      protein_goal: incoming.protein_goal,
      carbs_goal: incoming.carbs_goal,
      fat_goal: incoming.fat_goal,
      updated_at: incoming.updated_at,
      synced: 1,
    };
    this.setData(key, rows);
    return true;
  }

  async upsertNutritionGoals(goals: Omit<LocalNutritionGoals, 'synced' | 'updated_at'>, synced = 0): Promise<void> {
    const stored = this.getData<LocalNutritionGoals>(this.getStorageKey('nutrition_goals'));
    const existingIndex = stored.findIndex(item => item.id === goals.id || item.user_id === goals.user_id);
    const newGoals = {
      ...goals,
      synced,
      updated_at: new Date().toISOString(),
    };

    if (existingIndex >= 0) {
      stored[existingIndex] = newGoals;
    } else {
      stored.push(newGoals);
    }
    this.setData(this.getStorageKey('nutrition_goals'), stored);
  }

  async getNutritionGoals(userId: string): Promise<LocalNutritionGoals | null> {
    const stored = this.getData<LocalNutritionGoals>(this.getStorageKey('nutrition_goals'));
    return stored.find(item => item.user_id === userId) || null;
  }

  async getNutritionGoalsById(id: string): Promise<LocalNutritionGoals | null> {
    const stored = this.getData<LocalNutritionGoals>(this.getStorageKey('nutrition_goals'));
    return stored.find(item => item.id === id) || null;
  }

  async getUnsyncedNutritionGoals(): Promise<LocalNutritionGoals[]> {
    const stored = this.getData<LocalNutritionGoals>(this.getStorageKey('nutrition_goals'));
    return stored.filter(item => item.synced === 0);
  }

  async updateNutritionGoalsSyncStatus(id: string, synced: boolean, expected?: Partial<LocalNutritionGoals>): Promise<void> {
    this.updateLegacySyncStatus<LocalNutritionGoals>('nutrition_goals', id, synced, expected);
  }

  async updateNutritionGoals(id: string, updates: Partial<LocalNutritionGoals>): Promise<void> {
    const stored = this.getData<LocalNutritionGoals>(this.getStorageKey('nutrition_goals'));
    const index = stored.findIndex(item => item.id === id);
    if (index !== -1) {
      stored[index] = { ...stored[index], ...updates, updated_at: new Date().toISOString() };
      this.setData(this.getStorageKey('nutrition_goals'), stored);
    }
  }

  async deleteNutritionGoals(id: string): Promise<void> {
    const stored = this.getData<LocalNutritionGoals>(this.getStorageKey('nutrition_goals'));
    this.setData(this.getStorageKey('nutrition_goals'), stored.filter(item => item.id !== id));
  }

  // Sync queue operations
  private getStoredSyncQueue(): SyncQueueItem[] {
    const queue = this.getData<SyncQueueItem>(this.getStorageKey('sync_queue'));
    const ids = new Set<number>();
    for (const item of queue) {
      if (!item || !Number.isSafeInteger(item.id) || item.id <= 0 || ids.has(item.id)) {
        // Invalid or duplicate identities make acknowledgement ambiguous. Keep
        // the original bytes rather than repairing IDs while requests are in flight.
        throw new Error('Invalid or duplicate stored sync queue identity');
      }
      ids.add(item.id);
    }
    return queue;
  }

  private getSyncQueueHighWater(stored: SyncQueueItem[]): number {
    const sequenceKey = `${this.getStorageKey('sync_queue')}_sequence`;
    const rawSequence = localStorage.getItem(sequenceKey);
    const sequence = rawSequence === null ? 0 : Number(rawSequence);
    if ((rawSequence !== null && !/^(0|[1-9]\d*)$/.test(rawSequence))
      || !Number.isSafeInteger(sequence) || sequence < 0) {
      throw new Error('Invalid stored sync queue sequence');
    }
    return stored.reduce((max, item) => Math.max(max, item.id), sequence);
  }

  private preserveSyncQueueHighWater(stored: SyncQueueItem[]): void {
    // Legacy queues may predate the counter. Persist their consumed IDs before
    // removing rows, not just when allocating the next operation.
    const highWater = String(this.getSyncQueueHighWater(stored));
    const key = `${this.getStorageKey('sync_queue')}_sequence`;
    if (localStorage.getItem(key) !== highWater) localStorage.setItem(key, highWater);
  }

  async addToSyncQueue(
    tableName: SyncTableName,
    operation: SyncOperation,
    recordId: string,
    data?: unknown
  ): Promise<void> {
    const stored = this.getStoredSyncQueue();
    // Never reuse identities consumed by replacement, acknowledgement or rollback.
    const maxId = this.getSyncQueueHighWater(stored);
    const nextId = maxId + 1;
    if (!Number.isSafeInteger(nextId) || nextId <= maxId) {
      throw new Error('Sync queue identity range exhausted or invalid');
    }
    localStorage.setItem(`${this.getStorageKey('sync_queue')}_sequence`, String(nextId));
    const queue = stored.filter(item => !(item.table_name === tableName && item.record_id === recordId));
    const nowIso = new Date().toISOString();
    queue.push({
      id: nextId,
      table_name: tableName,
      operation,
      record_id: recordId,
      data: JSON.stringify(data ?? {}),
      created_at: nowIso,
      retry_count: 0,
      next_retry_at: nowIso,
    });
    this.setData(this.getStorageKey('sync_queue'), queue);
  }

  async getSyncQueue(): Promise<SyncQueueItem[]> {
    return this.getStoredSyncQueue().sort((a, b) => {
      const aNext = new Date(a.next_retry_at ?? a.created_at).getTime();
      const bNext = new Date(b.next_retry_at ?? b.created_at).getTime();
      if (aNext !== bNext) return aNext - bNext;
      return a.id - b.id;
    });
  }

  async removeSyncQueueItem(id: number): Promise<void> {
    const queue = this.getStoredSyncQueue();
    this.preserveSyncQueueHighWater(queue);
    this.setData(this.getStorageKey('sync_queue'), queue.filter(item => item.id !== id));
  }

  async clearSyncQueue(): Promise<void> {
    this.preserveSyncQueueHighWater(this.getStoredSyncQueue());
    this.setData(this.getStorageKey('sync_queue'), []);
  }

  async incrementSyncQueueRetry(id: number, nextRetryAt: string): Promise<void> {
    const queue = this.getStoredSyncQueue();
    const item = queue.find(i => i.id === id);
    if (item) {
      item.retry_count++;
      item.next_retry_at = nextRetryAt;
      this.setData(this.getStorageKey('sync_queue'), queue);
    }
  }

  async countSyncQueueItems(): Promise<number> {
    return this.getStoredSyncQueue().length;
  }

  // Cleanup operations (for web interface compat)
  async cleanupSyncedDeletes(): Promise<void> {
    // In web version, we hard delete immediately in hardDelete* methods, 
    // but we keep soft deleted items until they are synced?
    // Actually softDelete sets deleted=1.
    // We should remove items that are deleted=1 AND synced=1
    
    const foods = this.getData<LocalFood>(this.getStorageKey('foods'));
    const activeFoods = foods.filter(f => !(f.deleted === 1 && f.synced === 1));
    if (activeFoods.length !== foods.length) {
      this.setData(this.getStorageKey('foods'), activeFoods);
    }

    const workouts = this.getData<LocalWorkout>(this.getStorageKey('workouts'));
    const activeWorkouts = workouts.filter(w => !(w.deleted === 1 && w.synced === 1));
    if (activeWorkouts.length !== workouts.length) {
      this.setData(this.getStorageKey('workouts'), activeWorkouts);
    }
  }

  async clearAllData(): Promise<void> {
    // Share the transaction boundary so a pending rollback cannot resurrect
    // cleared account data. Keep the queue sequence to prevent stale ID reuse.
    await this.withTransaction(async () => {
      this.preserveSyncQueueHighWater(this.getStoredSyncQueue());
      localStorage.removeItem(this.getStorageKey('foods'));
      localStorage.removeItem(this.getStorageKey('workouts'));
      localStorage.removeItem(this.getStorageKey('health_metrics'));
      localStorage.removeItem(this.getStorageKey('nutrition_goals'));
      localStorage.removeItem(this.getStorageKey('sync_queue'));
    });
    logWithTs('[LocalDB-Web] All data cleared');
  }

  async close(): Promise<void> {
    this.initialized = false;
  }
}

// Export singleton instance
export const localDB = new LocalDatabase();
