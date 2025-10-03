// Web-compatible version using localStorage (simplified for web)
// For production web, consider using IndexedDB wrapper like Dexie.js

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
    console.log('[LocalDB-Web] Initializing localStorage...');
    this.initialized = true;
  }

  private getStorageKey(type: 'foods' | 'workouts' | 'sync_queue'): string {
    return `formfactor_${type}`;
  }

  private getData<T>(key: string): T[] {
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : [];
  }

  private setData<T>(key: string, data: T[]): void {
    localStorage.setItem(key, JSON.stringify(data));
  }

  // Food operations
  async insertFood(food: Omit<LocalFood, 'synced' | 'deleted' | 'updated_at'>): Promise<void> {
    const foods = this.getData<LocalFood>(this.getStorageKey('foods'));
    foods.push({
      ...food,
      synced: 0,
      deleted: 0,
      updated_at: new Date().toISOString(),
    });
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
    workouts.push({
      ...workout,
      synced: 0,
      deleted: 0,
      updated_at: new Date().toISOString(),
    });
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
      .filter(w => w.synced === 0);
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

  async clearAllData(): Promise<void> {
    localStorage.removeItem(this.getStorageKey('foods'));
    localStorage.removeItem(this.getStorageKey('workouts'));
    localStorage.removeItem(this.getStorageKey('sync_queue'));
    console.log('[LocalDB-Web] All data cleared');
  }

  async close(): Promise<void> {
    this.initialized = false;
  }
}

// Export singleton instance
export const localDB = new LocalDatabase();

