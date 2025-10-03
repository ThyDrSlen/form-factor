import { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../../supabase';
import { localDB, LocalFood, LocalWorkout } from './local-db';

type SyncCallback = () => void;

class SyncService {
  private foodChannel: RealtimeChannel | null = null;
  private workoutChannel: RealtimeChannel | null = null;
  private isSyncing = false;
  private syncCallbacks: SyncCallback[] = [];

  // Register callback for sync completion
  onSyncComplete(callback: SyncCallback) {
    this.syncCallbacks.push(callback);
    return () => {
      this.syncCallbacks = this.syncCallbacks.filter(cb => cb !== callback);
    };
  }

  private notifySyncComplete() {
    this.syncCallbacks.forEach(cb => cb());
  }

  // Initialize Realtime subscriptions
  async initializeRealtimeSync(userId: string): Promise<void> {
    // Prevent duplicate subscriptions
    if (this.foodChannel || this.workoutChannel) {
      console.log('[SyncService] Realtime already initialized, skipping');
      return;
    }

    console.log('[SyncService] Initializing Realtime subscriptions for user:', userId);

    // Subscribe to foods table changes
    this.foodChannel = supabase
      .channel('foods_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'foods',
          filter: `user_id=eq.${userId}`,
        },
        async (payload) => {
          console.log('[SyncService] Realtime food change:', payload);
          await this.handleRealtimeFoodChange(payload);
        }
      )
      .subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
          console.log('[SyncService] ✅ Foods channel subscribed');
        } else if (status === 'CHANNEL_ERROR') {
          console.error('[SyncService] ❌ Foods channel error:', err);
        } else if (status === 'TIMED_OUT') {
          console.warn('[SyncService] ⏱️ Foods channel timeout, will retry');
        } else {
          console.log('[SyncService] Foods channel status:', status);
        }
      });

    // Subscribe to workouts table changes
    this.workoutChannel = supabase
      .channel('workouts_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'workouts',
          filter: `user_id=eq.${userId}`,
        },
        async (payload) => {
          console.log('[SyncService] Realtime workout change:', payload);
          await this.handleRealtimeWorkoutChange(payload);
        }
      )
      .subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
          console.log('[SyncService] ✅ Workouts channel subscribed');
        } else if (status === 'CHANNEL_ERROR') {
          console.error('[SyncService] ❌ Workouts channel error:', err);
        } else if (status === 'TIMED_OUT') {
          console.warn('[SyncService] ⏱️ Workouts channel timeout, will retry');
        } else {
          console.log('[SyncService] Workouts channel status:', status);
        }
      });
  }

  // Handle realtime food changes from Supabase with conflict detection
  private async handleRealtimeFoodChange(payload: any): Promise<void> {
    try {
      if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
        // Check if we have a local unsynced version (conflict detection)
        // Query all foods including soft-deleted ones to detect conflicts
        const allLocalFoods = await localDB.db!.getAllAsync<LocalFood>('SELECT * FROM foods WHERE id = ?', [payload.new.id]);
        const localFood = allLocalFoods[0];
        
        // If local has unsaved changes, don't overwrite (local wins, will sync later)
        if (localFood && localFood.synced === 0) {
          console.log(`[SyncService] Local food ${payload.new.id} has unsaved changes, keeping local version`);
          return;
        }

        const food: LocalFood = {
          id: payload.new.id,
          name: payload.new.name,
          calories: payload.new.calories,
          protein: payload.new.protein,
          carbs: payload.new.carbs,
          fat: payload.new.fat,
          date: payload.new.date || payload.new.created_at,
          synced: 1,
          deleted: 0,
          updated_at: payload.new.updated_at || new Date().toISOString(),
        };
        
        // Check if exists locally, update or insert atomically
        const existing = await localDB.db!.getAllAsync<LocalFood>('SELECT id FROM foods WHERE id = ?', [food.id]);
        if (existing.length > 0) {
          await localDB.updateFood(food.id, food);
        } else {
          await localDB.insertFood(food);
          await localDB.updateFoodSyncStatus(food.id, true);
        }
        
        this.notifySyncComplete();
      } else if (payload.eventType === 'DELETE') {
        await localDB.hardDeleteFood(payload.old.id);
        this.notifySyncComplete();
      }
    } catch (error) {
      console.error('[SyncService] Error handling realtime food change:', error);
    }
  }

  // Handle realtime workout changes from Supabase with conflict detection
  private async handleRealtimeWorkoutChange(payload: any): Promise<void> {
    try {
      if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
        // Check if we have a local unsynced version (conflict detection)
        // Query all workouts including soft-deleted ones to detect conflicts
        const allLocalWorkouts = await localDB.db!.getAllAsync<LocalWorkout>('SELECT * FROM workouts WHERE id = ?', [payload.new.id]);
        const localWorkout = allLocalWorkouts[0];
        
        // If local has unsaved changes, don't overwrite (local wins, will sync later)
        if (localWorkout && localWorkout.synced === 0) {
          console.log(`[SyncService] Local workout ${payload.new.id} has unsaved changes, keeping local version`);
          return;
        }

        const workout: LocalWorkout = {
          id: payload.new.id,
          exercise: payload.new.exercise,
          sets: payload.new.sets,
          reps: payload.new.reps,
          weight: payload.new.weight,
          duration: payload.new.duration,
          date: payload.new.date || payload.new.created_at,
          synced: 1,
          deleted: 0,
          updated_at: payload.new.updated_at || new Date().toISOString(),
        };
        
        // Check if exists locally, update or insert atomically
        const existing = await localDB.db!.getAllAsync<LocalWorkout>('SELECT id FROM workouts WHERE id = ?', [workout.id]);
        if (existing.length > 0) {
          await localDB.updateWorkout(workout.id, workout);
        } else {
          await localDB.insertWorkout(workout);
          await localDB.updateWorkoutSyncStatus(workout.id, true);
        }
        
        this.notifySyncComplete();
      } else if (payload.eventType === 'DELETE') {
        await localDB.hardDeleteWorkout(payload.old.id);
        this.notifySyncComplete();
      }
    } catch (error) {
      console.error('[SyncService] Error handling realtime workout change:', error);
    }
  }

  // Cleanup Realtime subscriptions
  async cleanupRealtimeSync(): Promise<void> {
    console.log('[SyncService] Cleaning up Realtime subscriptions');

    if (this.foodChannel) {
      await supabase.removeChannel(this.foodChannel);
      this.foodChannel = null;
    }

    if (this.workoutChannel) {
      await supabase.removeChannel(this.workoutChannel);
      this.workoutChannel = null;
    }
  }

  // Sync local changes to Supabase
  async syncToSupabase(): Promise<void> {
    if (this.isSyncing) {
      console.log('[SyncService] Sync already in progress');
      return;
    }

    this.isSyncing = true;
    console.log('[SyncService] Starting sync to Supabase...');

    try {
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        console.log('[SyncService] No authenticated user, skipping sync');
        return;
      }

      // Sync foods
      await this.syncFoodsToSupabase();

      // Sync workouts
      await this.syncWorkoutsToSupabase();

      // Process sync queue
      await this.processSyncQueue();

      // Cleanup synced deleted items
      await localDB.cleanupSyncedDeletes();

      console.log('[SyncService] Sync to Supabase completed');
      this.notifySyncComplete();
    } catch (error) {
      console.error('[SyncService] Error syncing to Supabase:', error);
    } finally {
      this.isSyncing = false;
    }
  }

  // Sync foods to Supabase with Last-Write-Wins conflict resolution
  private async syncFoodsToSupabase(): Promise<void> {
    const unsyncedFoods = await localDB.getUnsyncedFoods();
    console.log(`[SyncService] Syncing ${unsyncedFoods.length} foods to Supabase`);

    // Get current user
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      console.warn('[SyncService] No authenticated user, cannot sync foods');
      return;
    }

    for (const food of unsyncedFoods) {
      try {
        if (food.deleted) {
          // Delete from Supabase
          const { error } = await supabase
            .from('foods')
            .delete()
            .eq('id', food.id);

          if (error) throw error;
          await localDB.updateFoodSyncStatus(food.id, true);
        } else {
          // Check if record exists on server and compare timestamps (Last-Write-Wins)
          const { data: existing, error: fetchError } = await supabase
            .from('foods')
            .select('updated_at')
            .eq('id', food.id)
            .single();

          if (fetchError && fetchError.code !== 'PGRST116') { // PGRST116 = not found
            throw fetchError;
          }

          // If server version is newer, skip local update (server wins)
          if (existing && new Date(existing.updated_at) > new Date(food.updated_at)) {
            console.log(`[SyncService] Server version of food ${food.id} is newer, skipping local update`);
            await localDB.updateFoodSyncStatus(food.id, true);
            continue;
          }

          // Local version is newer or doesn't exist on server, push to server
          const foodData = {
            id: food.id,
            user_id: user.id,
            name: food.name,
            calories: food.calories,
            protein: food.protein,
            carbs: food.carbs,
            fat: food.fat,
            date: food.date,
            updated_at: food.updated_at,
          };

          const { error } = await supabase
            .from('foods')
            .upsert([foodData]);

          if (error) throw error;
          await localDB.updateFoodSyncStatus(food.id, true);
          console.log(`[SyncService] Synced food ${food.id} to server (local was newer)`);
        }
      } catch (error) {
        console.error(`[SyncService] Failed to sync food ${food.id}:`, error);
        // Add to sync queue for retry (strip local-only fields)
        const { deleted, synced, ...cleanFood } = food;
        await localDB.addToSyncQueue('foods', food.deleted ? 'delete' : 'upsert', food.id, cleanFood);
      }
    }
  }

  // Sync workouts to Supabase with Last-Write-Wins conflict resolution
  private async syncWorkoutsToSupabase(): Promise<void> {
    const unsyncedWorkouts = await localDB.getUnsyncedWorkouts();
    console.log(`[SyncService] Syncing ${unsyncedWorkouts.length} workouts to Supabase`);

    // Get current user
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      console.warn('[SyncService] No authenticated user, cannot sync workouts');
      return;
    }

    for (const workout of unsyncedWorkouts) {
      try {
        if (workout.deleted) {
          // Delete from Supabase
          const { error } = await supabase
            .from('workouts')
            .delete()
            .eq('id', workout.id);

          if (error) throw error;
          await localDB.updateWorkoutSyncStatus(workout.id, true);
        } else {
          // Check if record exists on server and compare timestamps (Last-Write-Wins)
          const { data: existing, error: fetchError } = await supabase
            .from('workouts')
            .select('updated_at')
            .eq('id', workout.id)
            .single();

          if (fetchError && fetchError.code !== 'PGRST116') { // PGRST116 = not found
            throw fetchError;
          }

          // If server version is newer, skip local update (server wins)
          if (existing && new Date(existing.updated_at) > new Date(workout.updated_at)) {
            console.log(`[SyncService] Server version of workout ${workout.id} is newer, skipping local update`);
            await localDB.updateWorkoutSyncStatus(workout.id, true);
            continue;
          }

          // Local version is newer or doesn't exist on server, push to server
          const workoutData = {
            id: workout.id,
            user_id: user.id,
            exercise: workout.exercise,
            sets: workout.sets,
            reps: workout.reps,
            weight: workout.weight,
            duration: workout.duration,
            date: workout.date || new Date().toISOString(),
            updated_at: workout.updated_at,
          };

          const { error } = await supabase
            .from('workouts')
            .upsert([workoutData]);

          if (error) throw error;
          await localDB.updateWorkoutSyncStatus(workout.id, true);
          console.log(`[SyncService] Synced workout ${workout.id} to server (local was newer)`);
        }
      } catch (error) {
        console.error(`[SyncService] Failed to sync workout ${workout.id}:`, error);
        // Add to sync queue for retry (strip local-only fields)
        const { deleted, synced, ...cleanWorkout } = workout;
        await localDB.addToSyncQueue('workouts', workout.deleted ? 'delete' : 'upsert', workout.id, cleanWorkout);
      }
    }
  }

  // Process items in sync queue
  private async processSyncQueue(): Promise<void> {
    const queue = await localDB.getSyncQueue();
    console.log(`[SyncService] Processing ${queue.length} items in sync queue`);

    // Get current user
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      console.warn('[SyncService] No authenticated user, cannot process sync queue');
      return;
    }

    for (const item of queue) {
      try {
        if (item.retry_count >= 5) {
          console.warn(`[SyncService] Max retries reached for queue item ${item.id}, removing`);
          await localDB.removeSyncQueueItem(item.id);
          continue;
        }

        const data = JSON.parse(item.data);

        if (item.operation === 'delete') {
          const { error } = await supabase
            .from(item.table_name)
            .delete()
            .eq('id', item.record_id);

          if (error) throw error;
        } else if (item.operation === 'upsert') {
          // Remove local-only fields (deleted, synced) that don't exist in Supabase schema
          const { deleted, synced, ...cleanData } = data;
          
          // Prepare data for Supabase with required fields
          const upsertData = {
            ...cleanData,
            user_id: user.id,
            updated_at: cleanData.updated_at || new Date().toISOString(),
            // For workouts, ensure date is set
            ...(item.table_name === 'workouts' && { date: cleanData.date || new Date().toISOString() }),
          };

          const { error } = await supabase
            .from(item.table_name)
            .upsert([upsertData]);

          if (error) throw error;
        }

        // Remove from queue on success
        await localDB.removeSyncQueueItem(item.id);
        
        // Update local record sync status
        if (item.table_name === 'foods') {
          await localDB.updateFoodSyncStatus(item.record_id, true);
        } else if (item.table_name === 'workouts') {
          await localDB.updateWorkoutSyncStatus(item.record_id, true);
        }
      } catch (error) {
        console.error(`[SyncService] Failed to process queue item ${item.id}:`, error);
        await localDB.incrementSyncQueueRetry(item.id);
      }
    }
  }

  // Download all data from Supabase to local DB
  async downloadFromSupabase(): Promise<void> {
    console.log('[SyncService] Downloading data from Supabase...');

    try {
      // Download foods
      const { data: foods, error: foodsError } = await supabase
        .from('foods')
        .select('*')
        .order('created_at', { ascending: false });

      if (foodsError && !foodsError.message.includes('relation "foods" does not exist')) {
        throw foodsError;
      }

      // Get all local foods (including deleted ones) to check for conflicts
      const allLocalFoods = await localDB.db!.getAllAsync<LocalFood>('SELECT * FROM foods');
      const localFoodMap = new Map(allLocalFoods.map(f => [f.id, f]));
      const serverFoodIds = new Set((foods || []).map(f => f.id));

      if (foods && foods.length > 0) {
        for (const food of foods) {
          const existingLocal = localFoodMap.get(food.id);
          
          // If local version is deleted and unsynced, skip download (local delete wins)
          if (existingLocal?.deleted === 1 && existingLocal?.synced === 0) {
            console.log(`[SyncService] Skipping food ${food.id} - local deletion pending sync`);
            continue;
          }

          // If exists locally and local is newer, skip (local wins)
          if (existingLocal && new Date(existingLocal.updated_at) > new Date(food.updated_at)) {
            console.log(`[SyncService] Skipping food ${food.id} - local is newer`);
            continue;
          }

          // Server wins - upsert the food
          const localFood: LocalFood = {
            id: food.id,
            name: food.name,
            calories: food.calories,
            protein: food.protein,
            carbs: food.carbs,
            fat: food.fat,
            date: food.created_at,
            synced: 1,
            deleted: 0,
            updated_at: food.updated_at || new Date().toISOString(),
          };

          if (existingLocal) {
            // Update existing
            await localDB.updateFood(food.id, localFood);
          } else {
            // Insert new
            await localDB.insertFood(localFood);
          }
        }
        console.log(`[SyncService] Downloaded ${foods.length} foods`);
      }

      // Delete local items that were deleted on server
      // (items that exist locally with synced=1 but don't exist on server)
      for (const localFood of allLocalFoods) {
        if (localFood.synced === 1 && !serverFoodIds.has(localFood.id) && localFood.deleted === 0) {
          console.log(`[SyncService] Deleting food ${localFood.id} - removed on server`);
          await localDB.hardDeleteFood(localFood.id);
        }
      }

      // Clean up deleted items that have been synced
      await this.cleanupSyncedDeletes();

      // Download workouts
      const { data: workouts, error: workoutsError } = await supabase
        .from('workouts')
        .select('*')
        .order('created_at', { ascending: false });

      if (workoutsError && !workoutsError.message.includes('relation "workouts" does not exist')) {
        throw workoutsError;
      }

      // Get all local workouts (including deleted ones) to check for conflicts
      const allLocalWorkouts = await localDB.db!.getAllAsync<LocalWorkout>('SELECT * FROM workouts');
      const localWorkoutMap = new Map(allLocalWorkouts.map(w => [w.id, w]));
      const serverWorkoutIds = new Set((workouts || []).map(w => w.id));

      if (workouts && workouts.length > 0) {
        for (const workout of workouts) {
          const existingLocal = localWorkoutMap.get(workout.id);
          
          // If local version is deleted and unsynced, skip download (local delete wins)
          if (existingLocal?.deleted === 1 && existingLocal?.synced === 0) {
            console.log(`[SyncService] Skipping workout ${workout.id} - local deletion pending sync`);
            continue;
          }

          // If exists locally and local is newer, skip (local wins)
          if (existingLocal && new Date(existingLocal.updated_at) > new Date(workout.updated_at)) {
            console.log(`[SyncService] Skipping workout ${workout.id} - local is newer`);
            continue;
          }

          // Server wins - upsert the workout
          const localWorkout: LocalWorkout = {
            id: workout.id,
            exercise: workout.exercise,
            sets: workout.sets,
            reps: workout.reps,
            weight: workout.weight,
            duration: workout.duration,
            date: workout.date || workout.created_at,
            synced: 1,
            deleted: 0,
            updated_at: workout.updated_at || new Date().toISOString(),
          };

          if (existingLocal) {
            // Update existing
            await localDB.updateWorkout(workout.id, localWorkout);
          } else {
            // Insert new
            await localDB.insertWorkout(localWorkout);
          }
        }
        console.log(`[SyncService] Downloaded ${workouts.length} workouts`);
      }

      // Delete local items that were deleted on server
      // (items that exist locally with synced=1 but don't exist on server)
      for (const localWorkout of allLocalWorkouts) {
        if (localWorkout.synced === 1 && !serverWorkoutIds.has(localWorkout.id) && localWorkout.deleted === 0) {
          console.log(`[SyncService] Deleting workout ${localWorkout.id} - removed on server`);
          await localDB.hardDeleteWorkout(localWorkout.id);
        }
      }

      this.notifySyncComplete();
    } catch (error) {
      console.error('[SyncService] Error downloading from Supabase:', error);
    }
  }

  // Clean up soft-deleted items that have been successfully synced
  private async cleanupSyncedDeletes(): Promise<void> {
    try {
      // Hard delete foods that are deleted and synced
      await localDB.db!.runAsync('DELETE FROM foods WHERE deleted = 1 AND synced = 1');
      
      // Hard delete workouts that are deleted and synced
      await localDB.db!.runAsync('DELETE FROM workouts WHERE deleted = 1 AND synced = 1');
      
      console.log('[SyncService] Cleaned up synced deleted items');
    } catch (error) {
      console.error('[SyncService] Error cleaning up deleted items:', error);
    }
  }

  // Full sync: download from Supabase then push local changes
  async fullSync(): Promise<void> {
    console.log('[SyncService] Starting full sync...');
    await this.downloadFromSupabase();
    await this.syncToSupabase();
    console.log('[SyncService] Full sync completed');
  }

  // Clear stuck sync queue items (useful for fixing corrupted queue)
  async clearSyncQueue(): Promise<void> {
    console.log('[SyncService] Clearing sync queue...');
    await localDB.clearSyncQueue();
    console.log('[SyncService] Sync queue cleared');
  }
}

// Export singleton instance
export const syncService = new SyncService();

