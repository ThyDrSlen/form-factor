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

export interface SyncQueueItem {
  id: number;
  table_name: string;
  operation: string;
  record_id: string;
  data: string | null;
  created_at: string;
  retry_count: number;
}

class LocalDatabase {
  private initialized = false;

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
      return data ? JSON.parse(data) : [];
    } catch (e) {
      warnWithTs(`[LocalDB-Web] Failed to parse data for key ${key}`, e);
      return [];
    }
  }

  private setData<T>(key: string, data: T[]): void {
    try {
      localStorage.setItem(key, JSON.stringify(data));
    } catch (e) {
      errorWithTs(`[LocalDB-Web] Failed to save data for key ${key}`, e);
    }
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
      foods[index] = { ...foods[index], ...updates, updated_at: new Date().toISOString() };
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

  async updateFoodSyncStatus(id: string, synced: boolean): Promise<void> {
    await this.updateFood(id, { synced: synced ? 1 : 0 });
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
      workouts[index] = { ...workouts[index], ...updates, updated_at: new Date().toISOString() };
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
      .filter(w => w.synced === 0 && w.deleted === 0);
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

  async updateWorkoutSyncStatus(id: string, synced: boolean): Promise<void> {
    await this.updateWorkout(id, { synced: synced ? 1 : 0 });
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
  async insertHealthMetric(metric: Omit<LocalHealthMetric, 'synced' | 'updated_at'>): Promise<void> {
    const metrics = this.getData<LocalHealthMetric>(this.getStorageKey('health_metrics'));
    const existingIndex = metrics.findIndex(m => m.id === metric.id || (m.user_id === metric.user_id && m.summary_date === metric.summary_date));
    
    const newMetric = {
      ...metric,
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

  async updateHealthMetricSyncStatus(id: string, synced: boolean): Promise<void> {
    await this.updateHealthMetric(id, { synced: synced ? 1 : 0 });
  }

  async updateHealthMetric(id: string, updates: Partial<LocalHealthMetric>): Promise<void> {
    const metrics = this.getData<LocalHealthMetric>(this.getStorageKey('health_metrics'));
    const index = metrics.findIndex(m => m.id === id);
    if (index !== -1) {
      metrics[index] = { ...metrics[index], ...updates, updated_at: new Date().toISOString() };
      this.setData(this.getStorageKey('health_metrics'), metrics);
    }
  }

  async deleteHealthMetric(id: string): Promise<void> {
    const metrics = this.getData<LocalHealthMetric>(this.getStorageKey('health_metrics'));
    this.setData(this.getStorageKey('health_metrics'), metrics.filter(m => m.id !== id));
  }

  async getHealthMetricsCount(userId: string): Promise<number> {
    const metrics = this.getData<LocalHealthMetric>(this.getStorageKey('health_metrics'));
    return metrics.filter(m => m.user_id === userId).length;
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

  async updateNutritionGoalsSyncStatus(id: string, synced: boolean): Promise<void> {
    await this.updateNutritionGoals(id, { synced: synced ? 1 : 0 });
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
  async addToSyncQueue(
    tableName: string,
    operation: string,
    recordId: string,
    data: any
  ): Promise<void> {
    const queue = this.getData<SyncQueueItem>(this.getStorageKey('sync_queue'));
    const maxId = queue.reduce((max, item) => Math.max(max, item.id), 0);
    queue.push({
      id: maxId + 1,
      table_name: tableName,
      operation,
      record_id: recordId,
      data: JSON.stringify(data),
      created_at: new Date().toISOString(),
      retry_count: 0,
    });
    this.setData(this.getStorageKey('sync_queue'), queue);
  }

  async getSyncQueue(): Promise<SyncQueueItem[]> {
    return this.getData<SyncQueueItem>(this.getStorageKey('sync_queue'));
  }

  async removeSyncQueueItem(id: number): Promise<void> {
    const queue = this.getData<SyncQueueItem>(this.getStorageKey('sync_queue'));
    this.setData(this.getStorageKey('sync_queue'), queue.filter(item => item.id !== id));
  }

  async clearSyncQueue(): Promise<void> {
    this.setData(this.getStorageKey('sync_queue'), []);
  }

  async incrementSyncQueueRetry(id: number): Promise<void> {
    const queue = this.getData<SyncQueueItem>(this.getStorageKey('sync_queue'));
    const item = queue.find(i => i.id === id);
    if (item) {
      item.retry_count++;
      this.setData(this.getStorageKey('sync_queue'), queue);
    }
  }

  async countSyncQueueItems(): Promise<number> {
    return this.getData<SyncQueueItem>(this.getStorageKey('sync_queue')).length;
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
    localStorage.removeItem(this.getStorageKey('foods'));
    localStorage.removeItem(this.getStorageKey('workouts'));
    localStorage.removeItem(this.getStorageKey('health_metrics'));
    localStorage.removeItem(this.getStorageKey('sync_queue'));
    logWithTs('[LocalDB-Web] All data cleared');
  }

  async close(): Promise<void> {
    this.initialized = false;
  }
}

// Export singleton instance
export const localDB = new LocalDatabase();

