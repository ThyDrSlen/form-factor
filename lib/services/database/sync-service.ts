import { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../../supabase';
import { localDB, LocalFood, LocalWorkout, LocalHealthMetric, LocalNutritionGoals } from './local-db';
import { errorWithTs, logWithTs, warnWithTs } from '@/lib/logger';

type SyncCallback = () => void;

class SyncService {
  private foodChannel: RealtimeChannel | null = null;
  private workoutChannel: RealtimeChannel | null = null;
  private healthChannel: RealtimeChannel | null = null;
  private nutritionGoalsChannel: RealtimeChannel | null = null;
  private isSyncing = false;
  private syncPromise: Promise<void> | null = null;
  private syncCallbacks: SyncCallback[] = [];

  private getErrorCode(error: unknown): string | undefined {
    if (error && typeof error === 'object' && 'code' in error) {
      const code = (error as { code?: unknown }).code;
      return typeof code === 'string' ? code : undefined;
    }
    return undefined;
  }

  private isRlsViolation(error: unknown): boolean {
    return this.getErrorCode(error) === '42501';
  }

  private isInvalidUuid(error: unknown): boolean {
    return this.getErrorCode(error) === '22P02';
  }

  private isManagedTable(table: string): table is 'foods' | 'workouts' | 'health_metrics' | 'nutrition_goals' {
    return table === 'foods' || table === 'workouts' || table === 'health_metrics' || table === 'nutrition_goals';
  }

  private async purgeLocalRecord(table: 'foods' | 'workouts' | 'health_metrics' | 'nutrition_goals', id: string): Promise<void> {
    try {
      if (table === 'foods') {
        await localDB.hardDeleteFood(id);
        warnWithTs('[SyncService] Removed foreign food from local cache:', id);
      } else if (table === 'workouts') {
        await localDB.hardDeleteWorkout(id);
        warnWithTs('[SyncService] Removed foreign workout from local cache:', id);
      } else if (table === 'health_metrics') {
        await localDB.deleteHealthMetric(id);
        warnWithTs('[SyncService] Removed foreign health metric from local cache:', id);
      } else if (table === 'nutrition_goals') {
        await localDB.deleteNutritionGoals(id);
        warnWithTs('[SyncService] Removed foreign nutrition goals from local cache:', id);
      }
    } catch (purgeError) {
      errorWithTs('[SyncService] Failed to purge local record', { table, id, purgeError });
    }
  }

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
    if (this.foodChannel || this.workoutChannel || this.healthChannel) {
      logWithTs('[SyncService] Realtime already initialized, skipping');
      return;
    }

    logWithTs('[SyncService] Initializing Realtime subscriptions for user:', userId);

    const logChannelStatus = (label: string, status: string, err?: Error | null) => {
      if (status === 'SUBSCRIBED') {
        logWithTs(`[SyncService] ✅ ${label} channel subscribed`);
        return;
      }
      if (status === 'CHANNEL_ERROR') {
        if (err?.message) {
          errorWithTs(`[SyncService] ❌ ${label} channel error:`, err);
        } else {
          warnWithTs(
            `[SyncService] ⚠️ ${label} channel error without details (check realtime publication/RLS)`
          );
        }
        return;
      }
      if (status === 'TIMED_OUT') {
        warnWithTs(`[SyncService] ⏱️ ${label} channel timeout, will retry`);
        return;
      }
      logWithTs(`[SyncService] ${label} channel status:`, status);
    };

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
          logWithTs('[SyncService] Realtime food change:', payload);
          await this.handleRealtimeFoodChange(payload);
        }
      )
      .subscribe((status, err) => {
        logChannelStatus('Foods', status, err ?? undefined);
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
          logWithTs('[SyncService] Realtime workout change:', payload);
          await this.handleRealtimeWorkoutChange(payload);
        }
      )
      .subscribe((status, err) => {
        logChannelStatus('Workouts', status, err ?? undefined);
      });

    // Subscribe to health_metrics table changes
    this.healthChannel = supabase
      .channel('health_metrics_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'health_metrics',
          filter: `user_id=eq.${userId}`,
        },
        async (payload) => {
          logWithTs('[SyncService] Realtime health metric change:', payload);
          await this.handleRealtimeHealthMetricChange(payload);
        }
      )
      .subscribe((status, err) => {
        logChannelStatus('Health metrics', status, err ?? undefined);
      });
  }

  // Handle realtime food changes from Supabase with conflict detection
  private async handleRealtimeFoodChange(payload: any): Promise<void> {
    try {
      if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
        // Check if we have a local unsynced version (conflict detection)
        // Query all foods including soft-deleted ones to detect conflicts
        const localFood = await localDB.getFoodById(payload.new.id, true);
        
        // If local has unsaved changes, don't overwrite (local wins, will sync later)
        if (localFood && localFood.synced === 0) {
          logWithTs(`[SyncService] Local food ${payload.new.id} has unsaved changes, keeping local version`);
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
        if (localFood) {
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
      errorWithTs('[SyncService] Error handling realtime food change:', error);
    }
  }

  // Handle realtime workout changes from Supabase with conflict detection
  private async handleRealtimeWorkoutChange(payload: any): Promise<void> {
    try {
      if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
        // Check if we have a local unsynced version (conflict detection)
        // Query all workouts including soft-deleted ones to detect conflicts
        const localWorkout = await localDB.getWorkoutById(payload.new.id, true);
        
        // If local has unsaved changes, don't overwrite (local wins, will sync later)
        if (localWorkout && localWorkout.synced === 0) {
          logWithTs(`[SyncService] Local workout ${payload.new.id} has unsaved changes, keeping local version`);
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
        if (localWorkout) {
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
      errorWithTs('[SyncService] Error handling realtime workout change:', error);
    }
  }

  // Handle realtime health metric changes from Supabase with conflict detection
  private async handleRealtimeHealthMetricChange(payload: any): Promise<void> {
    try {
      if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
        // Check if we have a local unsynced version (conflict detection)
        const localMetric = await localDB.getHealthMetricById(payload.new.id);
        
        // If local has unsaved changes, don't overwrite (local wins, will sync later)
        if (localMetric && localMetric.synced === 0) {
          logWithTs(`[SyncService] Local health metric ${payload.new.id} has unsaved changes, keeping local version`);
          return;
        }

        const metric: LocalHealthMetric = {
          id: payload.new.id || `${payload.new.user_id}_${payload.new.summary_date}`,
          user_id: payload.new.user_id,
          summary_date: payload.new.summary_date,
          steps: payload.new.steps,
          heart_rate_bpm: payload.new.heart_rate_bpm,
          heart_rate_timestamp: payload.new.heart_rate_timestamp,
          weight_kg: payload.new.weight_kg,
          weight_timestamp: payload.new.weight_timestamp,
          synced: 1,
          updated_at: payload.new.updated_at || payload.new.recorded_at || new Date().toISOString(),
        };
        
        // Check if exists locally, update or insert atomically
        if (localMetric) {
          await localDB.updateHealthMetric(metric.id, metric);
        } else {
          await localDB.insertHealthMetric(metric);
          await localDB.updateHealthMetricSyncStatus(metric.id, true);
        }
        
        this.notifySyncComplete();
      } else if (payload.eventType === 'DELETE') {
        await localDB.deleteHealthMetric(payload.old.id);
        this.notifySyncComplete();
      }
    } catch (error) {
      errorWithTs('[SyncService] Error handling realtime health metric change:', error);
    }
  }

  private async handleRealtimeNutritionGoalsChange(payload: any): Promise<void> {
    try {
      if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
        const localGoals = await localDB.getNutritionGoalsById(payload.new.id);

        if (localGoals && localGoals.synced === 0) {
          logWithTs(`[SyncService] Local nutrition goals ${payload.new.id} has unsaved changes, keeping local version`);
          return;
        }

        const goals: LocalNutritionGoals = {
          id: payload.new.id,
          user_id: payload.new.user_id,
          calories_goal: payload.new.calories_goal,
          protein_goal: payload.new.protein_goal,
          carbs_goal: payload.new.carbs_goal,
          fat_goal: payload.new.fat_goal,
          synced: 1,
          updated_at: payload.new.updated_at || new Date().toISOString(),
        };

        await localDB.upsertNutritionGoals(goals, 1);
        this.notifySyncComplete();
      } else if (payload.eventType === 'DELETE') {
        await localDB.deleteNutritionGoals(payload.old.id);
        this.notifySyncComplete();
      }
    } catch (error) {
      errorWithTs('[SyncService] Error handling realtime nutrition goals change:', error);
    }
  }

  // Cleanup Realtime subscriptions
  async cleanupRealtimeSync(): Promise<void> {
    logWithTs('[SyncService] Cleaning up Realtime subscriptions');

    if (this.foodChannel) {
      await supabase.removeChannel(this.foodChannel);
      this.foodChannel = null;
    }

    if (this.workoutChannel) {
      await supabase.removeChannel(this.workoutChannel);
      this.workoutChannel = null;
    }

    if (this.healthChannel) {
      await supabase.removeChannel(this.healthChannel);
      this.healthChannel = null;
    }

    if (this.nutritionGoalsChannel) {
      await supabase.removeChannel(this.nutritionGoalsChannel);
      this.nutritionGoalsChannel = null;
    }
  }

  // Sync local changes to Supabase
  async syncToSupabase(): Promise<void> {
    if (this.isSyncing) {
      logWithTs('[SyncService] Sync already in progress');
      return;
    }

    this.isSyncing = true;
    logWithTs('[SyncService] Starting sync to Supabase...');

    try {
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        logWithTs('[SyncService] No authenticated user, skipping sync');
        return;
      }

      // Sync foods
      await this.syncFoodsToSupabase();

      // Sync workouts
      await this.syncWorkoutsToSupabase();

      // Sync health metrics
      await this.syncHealthMetricsToSupabase();

      await this.syncNutritionGoalsToSupabase();

      // Process sync queue
      await this.processSyncQueue();

      // Cleanup synced deleted items
      await localDB.cleanupSyncedDeletes();

      logWithTs('[SyncService] Sync to Supabase completed');
      this.notifySyncComplete();
    } catch (error) {
      errorWithTs('[SyncService] Error syncing to Supabase:', error);
    } finally {
      this.isSyncing = false;
    }
  }

  // Sync foods to Supabase with Last-Write-Wins conflict resolution
  private async syncFoodsToSupabase(): Promise<void> {
    const unsyncedFoods = await localDB.getUnsyncedFoods();
    if (unsyncedFoods.length === 0) return;

    logWithTs(`[SyncService] Syncing ${unsyncedFoods.length} foods to Supabase`);

    // Get current user
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      warnWithTs('[SyncService] No authenticated user, cannot sync foods');
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
            logWithTs(`[SyncService] Server version of food ${food.id} is newer, skipping local update`);
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
          logWithTs(`[SyncService] Synced food ${food.id} to server (local was newer)`);
        }
      } catch (error) {
        if (this.isRlsViolation(error)) {
          warnWithTs(`[SyncService] Food ${food.id} rejected by RLS, purging local copy`);
          await this.purgeLocalRecord('foods', food.id);
          continue;
        }

        errorWithTs(`[SyncService] Failed to sync food ${food.id}:`, error);
        // Add to sync queue for retry (strip local-only fields)
        const { deleted, synced, ...cleanFood } = food;
        await localDB.addToSyncQueue('foods', food.deleted ? 'delete' : 'upsert', food.id, cleanFood);
      }
    }
  }

  // Sync workouts to Supabase with Last-Write-Wins conflict resolution
  private async syncWorkoutsToSupabase(): Promise<void> {
    const unsyncedWorkouts = await localDB.getUnsyncedWorkouts();
    if (unsyncedWorkouts.length === 0) return;

    logWithTs(`[SyncService] Syncing ${unsyncedWorkouts.length} workouts to Supabase`);

    // Get current user
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      warnWithTs('[SyncService] No authenticated user, cannot sync workouts');
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
            logWithTs(`[SyncService] Server version of workout ${workout.id} is newer, skipping local update`);
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
          logWithTs(`[SyncService] Synced workout ${workout.id} to server (local was newer)`);
        }
      } catch (error) {
        if (this.isRlsViolation(error)) {
          warnWithTs(`[SyncService] Workout ${workout.id} rejected by RLS, purging local copy`);
          await this.purgeLocalRecord('workouts', workout.id);
          continue;
        }

        errorWithTs(`[SyncService] Failed to sync workout ${workout.id}:`, error);
        // Add to sync queue for retry (strip local-only fields)
        const { deleted, synced, ...cleanWorkout } = workout;
        await localDB.addToSyncQueue('workouts', workout.deleted ? 'delete' : 'upsert', workout.id, cleanWorkout);
      }
    }
  }

  // Sync health metrics to Supabase with Last-Write-Wins conflict resolution
  private async syncHealthMetricsToSupabase(): Promise<void> {
    const unsyncedMetrics = await localDB.getUnsyncedHealthMetrics();
    logWithTs(`[SyncService] Syncing ${unsyncedMetrics.length} health metrics to Supabase`);

    // Get current user
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      warnWithTs('[SyncService] No authenticated user, cannot sync health metrics');
      return;
    }

    for (const metric of unsyncedMetrics) {
      try {
        if (!metric.user_id || metric.user_id !== user.id) {
          warnWithTs(
            `[SyncService] Skipping health metric ${metric.id} because it belongs to another user (${metric.user_id})`
          );
          await this.purgeLocalRecord('health_metrics', metric.id);
          continue;
        }

        // Check if record exists on server and compare timestamps (Last-Write-Wins)
        const { data: existing, error: fetchError } = await supabase
          .from('health_metrics')
          .select('updated_at')
          .eq('user_id', user.id)
          .eq('summary_date', metric.summary_date)
          .single();

        if (fetchError && fetchError.code !== 'PGRST116') { // PGRST116 = not found
          throw fetchError;
        }

        // If server version is newer, skip local update (server wins)
        if (existing && new Date(existing.updated_at) > new Date(metric.updated_at)) {
          logWithTs(`[SyncService] Server version of health metric ${metric.id} is newer, skipping local update`);
          await localDB.updateHealthMetricSyncStatus(metric.id, true);
          continue;
        }

        // Local version is newer or doesn't exist on server, push to server
        const metricData = {
          user_id: user.id,
          summary_date: metric.summary_date,
          steps: metric.steps,
          heart_rate_bpm: metric.heart_rate_bpm,
          heart_rate_timestamp: metric.heart_rate_timestamp,
          weight_kg: metric.weight_kg,
          weight_timestamp: metric.weight_timestamp,
          recorded_at: metric.updated_at,
          updated_at: metric.updated_at,
        };

        const { error } = await supabase
          .from('health_metrics')
          .upsert([metricData], {
            onConflict: 'user_id,summary_date'
          });

        if (error) throw error;
        await localDB.updateHealthMetricSyncStatus(metric.id, true);
        logWithTs(`[SyncService] Synced health metric ${metric.id} to server (local was newer)`);
      } catch (error) {
        if (this.isRlsViolation(error)) {
          warnWithTs(`[SyncService] Health metric ${metric.id} rejected by RLS, purging local copy`);
          await this.purgeLocalRecord('health_metrics', metric.id);
          continue;
        }

        errorWithTs(`[SyncService] Failed to sync health metric ${metric.id}:`, error);
        // Add to sync queue for retry
        const { synced, ...cleanMetric } = metric;
        await localDB.addToSyncQueue('health_metrics', 'upsert', metric.id, cleanMetric);
      }
    }
  }

  private async syncNutritionGoalsToSupabase(): Promise<void> {
    const unsyncedGoals = await localDB.getUnsyncedNutritionGoals();
    if (unsyncedGoals.length === 0) return;

    logWithTs(`[SyncService] Syncing ${unsyncedGoals.length} nutrition goals to Supabase`);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      warnWithTs('[SyncService] No authenticated user, cannot sync nutrition goals');
      return;
    }

    for (const goals of unsyncedGoals) {
      try {
        if (!goals.user_id || goals.user_id !== user.id) {
          warnWithTs(`[SyncService] Skipping nutrition goals ${goals.id} for different user (${goals.user_id})`);
          await this.purgeLocalRecord('nutrition_goals', goals.id);
          continue;
        }

        const { data: existing, error: fetchError } = await supabase
          .from('nutrition_goals')
          .select('updated_at')
          .eq('user_id', user.id)
          .single();

        if (fetchError && fetchError.code !== 'PGRST116') {
          throw fetchError;
        }

        if (existing && new Date(existing.updated_at) > new Date(goals.updated_at)) {
          logWithTs(`[SyncService] Server version of nutrition goals ${goals.id} is newer, skipping local update`);
          await localDB.updateNutritionGoalsSyncStatus(goals.id, true);
          continue;
        }

        const goalsData = {
          id: goals.id,
          user_id: user.id,
          calories_goal: goals.calories_goal,
          protein_goal: goals.protein_goal,
          carbs_goal: goals.carbs_goal,
          fat_goal: goals.fat_goal,
          updated_at: goals.updated_at,
        };

        const { error } = await supabase
          .from('nutrition_goals')
          .upsert([goalsData], { onConflict: 'user_id' });

        if (error) throw error;
        await localDB.updateNutritionGoalsSyncStatus(goals.id, true);
        logWithTs(`[SyncService] Synced nutrition goals ${goals.id} to server (local was newer)`);
      } catch (error) {
        if (this.isRlsViolation(error)) {
          warnWithTs(`[SyncService] Nutrition goals ${goals.id} rejected by RLS, purging local copy`);
          await this.purgeLocalRecord('nutrition_goals', goals.id);
          continue;
        }

        errorWithTs(`[SyncService] Failed to sync nutrition goals ${goals.id}:`, error);
        const { synced, ...cleanGoals } = goals;
        await localDB.addToSyncQueue('nutrition_goals', 'upsert', goals.id, cleanGoals);
      }
    }
  }

  // Process items in sync queue
  private async processSyncQueue(): Promise<void> {
    const queue = await localDB.getSyncQueue();
    logWithTs(`[SyncService] Processing ${queue.length} items in sync queue`);

    // Get current user
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      warnWithTs('[SyncService] No authenticated user, cannot process sync queue');
      return;
    }

    for (const item of queue) {
      try {
        if (item.retry_count >= 5) {
          warnWithTs(`[SyncService] Max retries reached for queue item ${item.id}, removing`);
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
          const upsertData: Record<string, any> = {
            ...cleanData,
            user_id: user.id,
            updated_at: cleanData.updated_at || new Date().toISOString(),
            // For workouts, ensure date is set
            ...(item.table_name === 'workouts' && { date: cleanData.date || new Date().toISOString() }),
          };

          if (item.table_name === 'health_metrics') {
            delete upsertData.id;
          }

          let upsertError;
          if (item.table_name === 'health_metrics') {
            const { error } = await supabase
              .from('health_metrics')
              .upsert([upsertData], { onConflict: 'user_id,summary_date' });
            upsertError = error;
          } else if (item.table_name === 'nutrition_goals') {
            const { error } = await supabase
              .from('nutrition_goals')
              .upsert([upsertData], { onConflict: 'user_id' });
            upsertError = error;
          } else {
            const { error } = await supabase
              .from(item.table_name)
              .upsert([upsertData]);
            upsertError = error;
          }

          if (upsertError) throw upsertError;
        }

        // Remove from queue on success
        await localDB.removeSyncQueueItem(item.id);
        
        // Update local record sync status
        if (item.table_name === 'foods') {
          await localDB.updateFoodSyncStatus(item.record_id, true);
        } else if (item.table_name === 'workouts') {
          await localDB.updateWorkoutSyncStatus(item.record_id, true);
        } else if (item.table_name === 'health_metrics') {
          await localDB.updateHealthMetricSyncStatus(item.record_id, true);
        } else if (item.table_name === 'nutrition_goals') {
          await localDB.updateNutritionGoalsSyncStatus(item.record_id, true);
        }
      } catch (error) {
        if (this.isRlsViolation(error)) {
          warnWithTs(`[SyncService] Queue item ${item.id} was rejected by RLS, purging local record`);
          if (this.isManagedTable(item.table_name)) {
            await this.purgeLocalRecord(item.table_name, item.record_id);
          }
          await localDB.removeSyncQueueItem(item.id);
          continue;
        }

        if (this.isInvalidUuid(error) && item.table_name === 'health_metrics') {
          warnWithTs(`[SyncService] Queue item ${item.id} had invalid UUID, dropping metric`);
          await this.purgeLocalRecord('health_metrics', item.record_id);
          await localDB.removeSyncQueueItem(item.id);
          continue;
        }

        errorWithTs(`[SyncService] Failed to process queue item ${item.id}:`, error);
        await localDB.incrementSyncQueueRetry(item.id);
      }
    }
  }

  // Download all data from Supabase to local DB
  async downloadFromSupabase(): Promise<void> {
    logWithTs('[SyncService] Downloading data from Supabase...');

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
      const allLocalFoods = await localDB.getAllFoodsWithDeleted();
      const localFoodMap = new Map(allLocalFoods.map(f => [f.id, f]));
      const serverFoodIds = new Set((foods || []).map(f => f.id));

      if (foods && foods.length > 0) {
        for (const food of foods) {
          const existingLocal = localFoodMap.get(food.id);
          
          // If local version is deleted and unsynced, skip download (local delete wins)
          if (existingLocal?.deleted === 1 && existingLocal?.synced === 0) {
            logWithTs(`[SyncService] Skipping food ${food.id} - local deletion pending sync`);
            continue;
          }

          // If exists locally and local is newer, skip (local wins)
          if (existingLocal && new Date(existingLocal.updated_at) > new Date(food.updated_at)) {
            logWithTs(`[SyncService] Skipping food ${food.id} - local is newer`);
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
        logWithTs(`[SyncService] Downloaded ${foods.length} foods`);
      }

      // Delete local items that were deleted on server
      // (items that exist locally with synced=1 but don't exist on server)
      for (const localFood of allLocalFoods) {
        if (localFood.synced === 1 && !serverFoodIds.has(localFood.id) && localFood.deleted === 0) {
          logWithTs(`[SyncService] Deleting food ${localFood.id} - removed on server`);
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
      const allLocalWorkouts = await localDB.getAllWorkoutsWithDeleted();
      const localWorkoutMap = new Map(allLocalWorkouts.map(w => [w.id, w]));
      const serverWorkoutIds = new Set((workouts || []).map(w => w.id));

      if (workouts && workouts.length > 0) {
        for (const workout of workouts) {
          const existingLocal = localWorkoutMap.get(workout.id);
          
          // If local version is deleted and unsynced, skip download (local delete wins)
          if (existingLocal?.deleted === 1 && existingLocal?.synced === 0) {
            logWithTs(`[SyncService] Skipping workout ${workout.id} - local deletion pending sync`);
            continue;
          }

          // If exists locally and local is newer, skip (local wins)
          if (existingLocal && new Date(existingLocal.updated_at) > new Date(workout.updated_at)) {
            logWithTs(`[SyncService] Skipping workout ${workout.id} - local is newer`);
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
        logWithTs(`[SyncService] Downloaded ${workouts.length} workouts`);
      }

      // Delete local items that were deleted on server
      // (items that exist locally with synced=1 but don't exist on server)
      for (const localWorkout of allLocalWorkouts) {
        if (localWorkout.synced === 1 && !serverWorkoutIds.has(localWorkout.id) && localWorkout.deleted === 0) {
          logWithTs(`[SyncService] Deleting workout ${localWorkout.id} - removed on server`);
          await localDB.hardDeleteWorkout(localWorkout.id);
        }
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: nutritionGoals, error: nutritionGoalsError } = await supabase
          .from('nutrition_goals')
          .select('*')
          .eq('user_id', user.id)
          .single();

        if (nutritionGoalsError && nutritionGoalsError.code !== 'PGRST116') {
          throw nutritionGoalsError;
        }

        if (nutritionGoals) {
          const localGoals = await localDB.getNutritionGoals(user.id);
          if (localGoals && localGoals.synced === 0 && new Date(localGoals.updated_at) > new Date(nutritionGoals.updated_at)) {
            logWithTs(`[SyncService] Skipping nutrition goals ${nutritionGoals.id} - local is newer`);
          } else {
            await localDB.upsertNutritionGoals(
              {
                id: nutritionGoals.id,
                user_id: nutritionGoals.user_id,
                calories_goal: nutritionGoals.calories_goal,
                protein_goal: nutritionGoals.protein_goal,
                carbs_goal: nutritionGoals.carbs_goal,
                fat_goal: nutritionGoals.fat_goal,
              },
              1
            );
            logWithTs('[SyncService] Downloaded nutrition goals');
          }
        }
      }

      this.notifySyncComplete();
    } catch (error) {
      errorWithTs('[SyncService] Error downloading from Supabase:', error);
    }
  }

  // Clean up soft-deleted items that have been successfully synced
  private async cleanupSyncedDeletes(): Promise<void> {
    try {
      await localDB.cleanupSyncedDeletes();
      logWithTs('[SyncService] Cleaned up synced deleted items');
    } catch (error) {
      errorWithTs('[SyncService] Error cleaning up deleted items:', error);
    }
  }

  // Full sync: download from Supabase then push local changes
  async fullSync(): Promise<void> {
    if (this.syncPromise) {
      logWithTs('[SyncService] Joining existing sync request');
      return this.syncPromise;
    }

    this.syncPromise = (async () => {
      logWithTs('[SyncService] Starting full sync...');
      try {
        await this.downloadFromSupabase();
        await this.syncToSupabase();
        logWithTs('[SyncService] Full sync completed');
      } catch (error) {
        errorWithTs('[SyncService] Error during full sync:', error);
      } finally {
        this.syncPromise = null;
      }
    })();

    return this.syncPromise;
  }

  // Clear stuck sync queue items (useful for fixing corrupted queue)
  async clearSyncQueue(): Promise<void> {
    logWithTs('[SyncService] Clearing sync queue...');
    await localDB.clearSyncQueue();
    logWithTs('[SyncService] Sync queue cleared');
  }
}

// Export singleton instance
export const syncService = new SyncService();
