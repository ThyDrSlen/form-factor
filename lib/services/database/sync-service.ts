import { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { supabase } from '../../supabase';
import {
  localDB,
  LocalFood,
  LocalWorkout,
  LocalHealthMetric,
  LocalNutritionGoals,
  SyncQueueItem,
  SyncTableName,
} from './local-db';
import { errorWithTs, logWithTs, warnWithTs } from '@/lib/logger';
import { createError, logError } from '../ErrorHandler';
import {
  syncAllWorkoutTablesToSupabase,
  downloadAllWorkoutTablesFromSupabase,
  cleanupWorkoutSyncedDeletes,
  WORKOUT_SYNC_CONFIGS,
  handleGenericRealtimeChange,
} from './generic-sync';

type SyncCallback = () => void;
type SyncStatusCallback = (status: SyncStatus) => void;

interface SupabaseFoodRow {
  id: string;
  user_id: string;
  name: string;
  calories: number;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  date?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

interface SupabaseWorkoutRow {
  id: string;
  user_id: string;
  exercise: string;
  sets: number;
  reps?: number | null;
  weight?: number | null;
  duration?: number | null;
  date?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

interface SupabaseHealthMetricRow {
  id?: string | null;
  user_id: string;
  summary_date: string;
  steps: number | null;
  heart_rate_bpm: number | null;
  heart_rate_timestamp: string | null;
  weight_kg: number | null;
  weight_timestamp: string | null;
  updated_at?: string | null;
  recorded_at?: string | null;
}

interface SupabaseNutritionGoalsRow {
  id: string;
  user_id: string;
  calories_goal: number;
  protein_goal: number;
  carbs_goal: number;
  fat_goal: number;
  updated_at?: string | null;
}

type GenericRealtimePayload = RealtimePostgresChangesPayload<Record<string, unknown>>;

export interface SyncStatus {
  state: 'idle' | 'syncing' | 'error';
  queueSize: number;
  lastError: string | null;
  lastErrorAt: string | null;
}

class SyncService {
  private foodChannel: RealtimeChannel | null = null;
  private workoutChannel: RealtimeChannel | null = null;
  private healthChannel: RealtimeChannel | null = null;
  private nutritionGoalsChannel: RealtimeChannel | null = null;
  private workoutSessionChannels: RealtimeChannel[] = [];
  private channelRetryCount = new Map<string, number>();
  private channelStates = new Map<string, string>();
  private syncPromise: Promise<void> | null = null;
  private syncCallbacks: SyncCallback[] = [];
  private syncStatusCallbacks: SyncStatusCallback[] = [];
  private syncStatus: SyncStatus = {
    state: 'idle',
    queueSize: 0,
    lastError: null,
    lastErrorAt: null,
  };
  private conflictSyncTimer: ReturnType<typeof setTimeout> | null = null;
  private realtimeResyncTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly maxChannelRetries = 3;
  private readonly conflictReconcileDelayMs = 750;
  private readonly maxQueueRetries = 5;
  private readonly realtimeResyncDelayMs = 2_000;

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

  private isManagedTable(table: string): table is SyncTableName {
    return table === 'foods' || table === 'workouts' || table === 'health_metrics' || table === 'nutrition_goals';
  }

  private async purgeLocalRecord(table: SyncTableName, id: string): Promise<void> {
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
    this.syncCallbacks.forEach((cb) => {
      cb();
    });
  }

  onSyncStatusChange(callback: SyncStatusCallback) {
    this.syncStatusCallbacks.push(callback);
    callback(this.syncStatus);
    return () => {
      this.syncStatusCallbacks = this.syncStatusCallbacks.filter(cb => cb !== callback);
    };
  }

  getSyncStatus(): SyncStatus {
    return this.syncStatus;
  }

  private async refreshQueueSize(): Promise<void> {
    try {
      const queueSize = await localDB.countSyncQueueItems();
      this.setSyncStatus({ queueSize });
    } catch (error) {
      warnWithTs('[SyncService] Failed to refresh sync queue size:', error);
    }
  }

  private setSyncStatus(patch: Partial<SyncStatus>): void {
    this.syncStatus = {
      ...this.syncStatus,
      ...patch,
    };
    this.syncStatusCallbacks.forEach((cb) => {
      cb(this.syncStatus);
    });
  }

  private scheduleConflictReconcile(reason: string): void {
    if (this.syncPromise || this.conflictSyncTimer) {
      return;
    }

    this.conflictSyncTimer = setTimeout(() => {
      this.conflictSyncTimer = null;
      this.syncToSupabase().catch((error) => {
        errorWithTs('[SyncService] Conflict reconcile sync failed:', { reason, error });
      });
    }, this.conflictReconcileDelayMs);
  }

  /**
   * Called when a realtime change handler fails to apply a remote change
   * to the local DB. Sets sync status to 'error' so the UI can indicate
   * stale data and schedules a full download to recover the lost change.
   */
  private handleRealtimeError(table: string, error: unknown): void {
    const message = error instanceof Error ? error.message : `Realtime ${table} change failed`;
    this.setSyncStatus({
      state: 'error',
      lastError: message,
      lastErrorAt: new Date().toISOString(),
    });
    this.scheduleResyncAfterRealtimeError(table);
  }

  /**
   * Debounced full resync after a realtime handler error. Multiple
   * errors within the delay window collapse into a single resync.
   */
  private scheduleResyncAfterRealtimeError(table: string): void {
    if (this.realtimeResyncTimer) {
      return;
    }

    this.realtimeResyncTimer = setTimeout(() => {
      this.realtimeResyncTimer = null;
      this.downloadFromSupabase().catch((resyncError) => {
        errorWithTs('[SyncService] Resync after realtime error failed:', { table, resyncError });
      });
    }, this.realtimeResyncDelayMs);
  }

  private getRetryDelayMs(retryCount: number): number {
    const baseDelayMs = 1_000;
    const maxDelayMs = 60_000;
    return Math.min(maxDelayMs, baseDelayMs * 2 ** retryCount);
  }

  private isQueueItemReady(item: SyncQueueItem): boolean {
    const nextRetryAt = item.next_retry_at ?? item.created_at;
    const nextRetryMs = new Date(nextRetryAt).getTime();
    if (!Number.isFinite(nextRetryMs)) {
      return true;
    }
    return nextRetryMs <= Date.now();
  }

  private getNextRetryIso(item: SyncQueueItem): string {
    return new Date(Date.now() + this.getRetryDelayMs(item.retry_count)).toISOString();
  }

  // Initialize Realtime subscriptions
  async initializeRealtimeSync(userId: string): Promise<void> {
    const hasActiveRealtimeState = Array.from(this.channelStates.values()).some(
      (state) => state === 'subscribing' || state === 'subscribed' || state === 'retrying'
    );

    // Prevent duplicate subscriptions
    if (
      this.foodChannel ||
      this.workoutChannel ||
      this.healthChannel ||
      this.nutritionGoalsChannel ||
      this.workoutSessionChannels.length > 0 ||
      hasActiveRealtimeState
    ) {
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

    const createManagedChannel = ({
      channelKey,
      label,
      buildChannel,
      storeChannel,
      clearChannel,
    }: {
      channelKey: string;
      label: string;
      buildChannel: () => RealtimeChannel;
      storeChannel: (channel: RealtimeChannel) => void;
      clearChannel: (channel: RealtimeChannel) => void;
    }): void => {
      const currentState = this.channelStates.get(channelKey);
      if (currentState === 'subscribing' || currentState === 'subscribed' || currentState === 'retrying') {
        logWithTs(`[SyncService] ${label} channel already ${currentState}, skipping duplicate subscription`);
        return;
      }

      this.channelStates.set(channelKey, 'subscribing');
      const channel = buildChannel();
      storeChannel(channel);

      const cleanupChannel = async (): Promise<void> => {
        try {
          await channel.unsubscribe();
        } catch (unsubscribeError) {
          warnWithTs(`[SyncService] Failed to unsubscribe ${label} channel:`, unsubscribeError);
        }

        try {
          await supabase.removeChannel(channel);
        } catch (removeError) {
          warnWithTs(`[SyncService] Failed to remove ${label} channel:`, removeError);
        }

        clearChannel(channel);
      };

      const scheduleRetry = async (reason: 'CHANNEL_ERROR' | 'TIMED_OUT'): Promise<void> => {
        if (this.channelStates.get(channelKey) === 'retrying') {
          return;
        }

        this.channelStates.set(channelKey, 'retrying');
        await cleanupChannel();

        const retryCount = this.channelRetryCount.get(channelKey) ?? 0;
        if (retryCount >= this.maxChannelRetries) {
          warnWithTs(
            `[SyncService] ${label} channel reached retry limit after ${reason.toLowerCase()}, leaving unsubscribed`
          );
          this.channelStates.set(channelKey, 'error');
          return;
        }

        const nextRetryCount = retryCount + 1;
        const retryDelayMs = this.getRetryDelayMs(retryCount);
        this.channelRetryCount.set(channelKey, nextRetryCount);
        warnWithTs(
          `[SyncService] Retrying ${label} channel after ${reason.toLowerCase()} (${nextRetryCount}/${this.maxChannelRetries}) in ${retryDelayMs}ms`
        );

        setTimeout(() => {
          createManagedChannel({ channelKey, label, buildChannel, storeChannel, clearChannel });
        }, retryDelayMs);
      };

      channel.subscribe((status, err) => {
        logChannelStatus(label, status, err ?? undefined);

        if (status === 'SUBSCRIBED') {
          this.channelStates.set(channelKey, 'subscribed');
          this.channelRetryCount.set(channelKey, 0);
          return;
        }

        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          void scheduleRetry(status);
        }
      });
    };

    // Subscribe to foods table changes
    createManagedChannel({
      channelKey: 'foods',
      label: 'Foods',
      buildChannel: () =>
        supabase.channel('foods_changes').on(
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
        ),
      storeChannel: (channel) => {
        this.foodChannel = channel;
      },
      clearChannel: (channel) => {
        if (this.foodChannel === channel) {
          this.foodChannel = null;
        }
      },
    });

    // Subscribe to workouts table changes
    createManagedChannel({
      channelKey: 'workouts',
      label: 'Workouts',
      buildChannel: () =>
        supabase.channel('workouts_changes').on(
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
        ),
      storeChannel: (channel) => {
        this.workoutChannel = channel;
      },
      clearChannel: (channel) => {
        if (this.workoutChannel === channel) {
          this.workoutChannel = null;
        }
      },
    });

    // Subscribe to health_metrics table changes
    createManagedChannel({
      channelKey: 'health_metrics',
      label: 'Health metrics',
      buildChannel: () =>
        supabase.channel('health_metrics_changes').on(
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
        ),
      storeChannel: (channel) => {
        this.healthChannel = channel;
      },
      clearChannel: (channel) => {
        if (this.healthChannel === channel) {
          this.healthChannel = null;
        }
      },
    });

    // Subscribe to nutrition_goals table changes
    createManagedChannel({
      channelKey: 'nutrition_goals',
      label: 'Nutrition goals',
      buildChannel: () =>
        supabase.channel('nutrition_goals_changes').on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'nutrition_goals',
            filter: `user_id=eq.${userId}`,
          },
          async (payload) => {
            logWithTs('[SyncService] Realtime nutrition goals change:', payload);
            await this.handleRealtimeNutritionGoalsChange(payload);
          }
        ),
      storeChannel: (channel) => {
        this.nutritionGoalsChannel = channel;
      },
      clearChannel: (channel) => {
        if (this.nutritionGoalsChannel === channel) {
          this.nutritionGoalsChannel = null;
        }
      },
    });

    // Subscribe to workout session tables via generic sync adapter
    for (const config of WORKOUT_SYNC_CONFIGS) {
      const filterClause = config.userScoped ? `user_id=eq.${userId}` : undefined;
      createManagedChannel({
        channelKey: `workout_session:${config.supabaseTable}`,
        label: config.supabaseTable,
        buildChannel: () =>
          supabase.channel(`${config.supabaseTable}_changes`).on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: config.supabaseTable,
              ...(filterClause ? { filter: filterClause } : {}),
            },
            async (payload) => {
              logWithTs(`[SyncService] Realtime ${config.supabaseTable} change:`, payload.eventType);
              await handleGenericRealtimeChange(
                config,
                payload,
                () => this.notifySyncComplete(),
                (reason: string) => this.scheduleConflictReconcile(reason),
                (table: string, error: unknown) => this.handleRealtimeError(table, error),
              );
            }
          ),
        storeChannel: (channel) => {
          this.workoutSessionChannels.push(channel);
        },
        clearChannel: (channel) => {
          this.workoutSessionChannels = this.workoutSessionChannels.filter((existing) => existing !== channel);
        },
      });
    }
  }

  // Handle realtime food changes from Supabase with conflict detection
  private async handleRealtimeFoodChange(payload: GenericRealtimePayload): Promise<void> {
    try {
      const newRow = payload.new as Partial<SupabaseFoodRow>;
      const oldRow = payload.old as Partial<SupabaseFoodRow>;

      if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
        if (!newRow.id || typeof newRow.id !== 'string') {
          return;
        }
        // Check if we have a local unsynced version (conflict detection)
        // Query all foods including soft-deleted ones to detect conflicts
        const localFood = await localDB.getFoodById(newRow.id, true);
        
        // If local has unsaved changes, don't overwrite (local wins, will sync later)
        if (localFood && localFood.synced === 0) {
          logWithTs(`[SyncService] Local food ${newRow.id} has unsaved changes, keeping local version`);
          this.scheduleConflictReconcile(`food:${newRow.id}`);
          return;
        }

        const food: LocalFood = {
          id: newRow.id,
          name: newRow.name ?? '',
          calories: Number(newRow.calories ?? 0),
          protein: newRow.protein ?? undefined,
          carbs: newRow.carbs ?? undefined,
          fat: newRow.fat ?? undefined,
          date: newRow.date ?? newRow.created_at ?? new Date().toISOString(),
          synced: 1,
          deleted: 0,
          updated_at: newRow.updated_at ?? new Date().toISOString(),
        };
        
        // Check if exists locally, update or insert atomically
        if (localFood) {
          await localDB.updateFood(food.id, food);
        } else {
          await localDB.withTransaction(async () => {
            await localDB.insertFood(food);
            await localDB.updateFoodSyncStatus(food.id, true);
          });
        }

        this.notifySyncComplete();
      } else if (payload.eventType === 'DELETE' && oldRow.id) {
        await localDB.hardDeleteFood(oldRow.id);
        this.notifySyncComplete();
      }
    } catch (error) {
      const appError = createError(
        'sync',
        'REALTIME_CHANGE_FAILED',
        `Failed to apply realtime ${payload.eventType} for foods`,
        {
          details: { table: 'foods', eventType: payload.eventType, error },
          retryable: true,
          severity: 'error',
        },
      );
      logError(appError, {
        feature: 'app',
        location: 'sync-service.handleRealtimeFoodChange',
        meta: { table: 'foods', eventType: payload.eventType },
      });
      this.handleRealtimeError('foods', error);
    }
  }

  // Handle realtime workout changes from Supabase with conflict detection
  private async handleRealtimeWorkoutChange(payload: GenericRealtimePayload): Promise<void> {
    try {
      const newRow = payload.new as Partial<SupabaseWorkoutRow>;
      const oldRow = payload.old as Partial<SupabaseWorkoutRow>;

      if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
        if (!newRow.id || typeof newRow.id !== 'string') {
          return;
        }
        // Check if we have a local unsynced version (conflict detection)
        // Query all workouts including soft-deleted ones to detect conflicts
        const localWorkout = await localDB.getWorkoutById(newRow.id, true);
        
        // If local has unsaved changes, don't overwrite (local wins, will sync later)
        if (localWorkout && localWorkout.synced === 0) {
          logWithTs(`[SyncService] Local workout ${newRow.id} has unsaved changes, keeping local version`);
          this.scheduleConflictReconcile(`workout:${newRow.id}`);
          return;
        }

        const workout: LocalWorkout = {
          id: newRow.id,
          exercise: newRow.exercise ?? '',
          sets: Number(newRow.sets ?? 0),
          reps: newRow.reps ?? undefined,
          weight: newRow.weight ?? undefined,
          duration: newRow.duration ?? undefined,
          date: newRow.date ?? newRow.created_at ?? new Date().toISOString(),
          synced: 1,
          deleted: 0,
          updated_at: newRow.updated_at ?? new Date().toISOString(),
        };
        
        // Check if exists locally, update or insert atomically
        if (localWorkout) {
          await localDB.updateWorkout(workout.id, workout);
        } else {
          await localDB.withTransaction(async () => {
            await localDB.insertWorkout(workout);
            await localDB.updateWorkoutSyncStatus(workout.id, true);
          });
        }

        this.notifySyncComplete();
      } else if (payload.eventType === 'DELETE' && oldRow.id) {
        await localDB.hardDeleteWorkout(oldRow.id);
        this.notifySyncComplete();
      }
    } catch (error) {
      const appError = createError(
        'sync',
        'REALTIME_CHANGE_FAILED',
        `Failed to apply realtime ${payload.eventType} for workouts`,
        {
          details: { table: 'workouts', eventType: payload.eventType, error },
          retryable: true,
          severity: 'error',
        },
      );
      logError(appError, {
        feature: 'app',
        location: 'sync-service.handleRealtimeWorkoutChange',
        meta: { table: 'workouts', eventType: payload.eventType },
      });
      this.handleRealtimeError('workouts', error);
    }
  }

  // Handle realtime health metric changes from Supabase with conflict detection
  private async handleRealtimeHealthMetricChange(payload: GenericRealtimePayload): Promise<void> {
    try {
      const newRow = payload.new as Partial<SupabaseHealthMetricRow>;
      const oldRow = payload.old as Partial<SupabaseHealthMetricRow>;

      if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
        const metricId = newRow.id || `${newRow.user_id ?? ''}_${newRow.summary_date ?? ''}`;
        if (!metricId || !newRow.user_id || !newRow.summary_date) {
          return;
        }
        // Check if we have a local unsynced version (conflict detection)
        const localMetric = await localDB.getHealthMetricById(metricId);
        
        // If local has unsaved changes, don't overwrite (local wins, will sync later)
        if (localMetric && localMetric.synced === 0) {
          logWithTs(`[SyncService] Local health metric ${metricId} has unsaved changes, keeping local version`);
          this.scheduleConflictReconcile(`health_metric:${metricId}`);
          return;
        }

        const metric: LocalHealthMetric = {
          id: metricId,
          user_id: newRow.user_id,
          summary_date: newRow.summary_date,
          steps: newRow.steps ?? null,
          heart_rate_bpm: newRow.heart_rate_bpm ?? null,
          heart_rate_timestamp: newRow.heart_rate_timestamp ?? null,
          weight_kg: newRow.weight_kg ?? null,
          weight_timestamp: newRow.weight_timestamp ?? null,
          synced: 1,
          updated_at: newRow.updated_at ?? newRow.recorded_at ?? new Date().toISOString(),
        };
        
        // Check if exists locally, update or insert atomically
        if (localMetric) {
          await localDB.updateHealthMetric(metric.id, metric);
        } else {
          await localDB.withTransaction(async () => {
            await localDB.insertHealthMetric(metric);
            await localDB.updateHealthMetricSyncStatus(metric.id, true);
          });
        }

        this.notifySyncComplete();
      } else if (payload.eventType === 'DELETE' && oldRow.id) {
        await localDB.deleteHealthMetric(oldRow.id);
        this.notifySyncComplete();
      }
    } catch (error) {
      const appError = createError(
        'sync',
        'REALTIME_CHANGE_FAILED',
        `Failed to apply realtime ${payload.eventType} for health_metrics`,
        {
          details: { table: 'health_metrics', eventType: payload.eventType, error },
          retryable: true,
          severity: 'error',
        },
      );
      logError(appError, {
        feature: 'app',
        location: 'sync-service.handleRealtimeHealthMetricChange',
        meta: { table: 'health_metrics', eventType: payload.eventType },
      });
      this.handleRealtimeError('health_metrics', error);
    }
  }

  private async handleRealtimeNutritionGoalsChange(payload: GenericRealtimePayload): Promise<void> {
    try {
      const newRow = payload.new as Partial<SupabaseNutritionGoalsRow>;
      const oldRow = payload.old as Partial<SupabaseNutritionGoalsRow>;

      if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
        if (!newRow.id || !newRow.user_id) {
          return;
        }
        const localGoals = await localDB.getNutritionGoalsById(newRow.id);

        if (localGoals && localGoals.synced === 0) {
          logWithTs(`[SyncService] Local nutrition goals ${newRow.id} has unsaved changes, keeping local version`);
          this.scheduleConflictReconcile(`nutrition_goals:${newRow.id}`);
          return;
        }

        const goals: LocalNutritionGoals = {
          id: newRow.id,
          user_id: newRow.user_id,
          calories_goal: Number(newRow.calories_goal ?? 0),
          protein_goal: Number(newRow.protein_goal ?? 0),
          carbs_goal: Number(newRow.carbs_goal ?? 0),
          fat_goal: Number(newRow.fat_goal ?? 0),
          synced: 1,
          updated_at: newRow.updated_at ?? new Date().toISOString(),
        };

        await localDB.upsertNutritionGoals(goals, 1);
        this.notifySyncComplete();
      } else if (payload.eventType === 'DELETE' && oldRow.id) {
        await localDB.deleteNutritionGoals(oldRow.id);
        this.notifySyncComplete();
      }
    } catch (error) {
      const appError = createError(
        'sync',
        'REALTIME_CHANGE_FAILED',
        `Failed to apply realtime ${payload.eventType} for nutrition_goals`,
        {
          details: { table: 'nutrition_goals', eventType: payload.eventType, error },
          retryable: true,
          severity: 'error',
        },
      );
      logError(appError, {
        feature: 'app',
        location: 'sync-service.handleRealtimeNutritionGoalsChange',
        meta: { table: 'nutrition_goals', eventType: payload.eventType },
      });
      this.handleRealtimeError('nutrition_goals', error);
    }
  }

  // Cleanup Realtime subscriptions
  async cleanupRealtimeSync(): Promise<void> {
    logWithTs('[SyncService] Cleaning up Realtime subscriptions');

    if (this.conflictSyncTimer) {
      clearTimeout(this.conflictSyncTimer);
      this.conflictSyncTimer = null;
    }

    if (this.realtimeResyncTimer) {
      clearTimeout(this.realtimeResyncTimer);
      this.realtimeResyncTimer = null;
    }

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

    // Clean up workout session channels
    for (const ch of this.workoutSessionChannels) {
      await supabase.removeChannel(ch);
    }
    this.workoutSessionChannels = [];
    this.channelRetryCount.clear();
    this.channelStates.clear();
  }

  // Sync local changes to Supabase
  async syncToSupabase(): Promise<void> {
    if (this.syncPromise) {
      logWithTs('[SyncService] Sync already in progress, awaiting existing operation');
      return this.syncPromise;
    }

    this.syncPromise = this.executeSyncToSupabase();
    try {
      await this.syncPromise;
    } finally {
      this.syncPromise = null;
    }
  }

  private async executeSyncToSupabase(): Promise<void> {
    await this.refreshQueueSize();
    this.setSyncStatus({ state: 'syncing', lastError: null });
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

      // Sync workout session tables via generic adapter
      await syncAllWorkoutTablesToSupabase(user.id);

      // Process sync queue
      const queueHadErrors = await this.processSyncQueue();

      // Cleanup synced deleted items
      await localDB.cleanupSyncedDeletes();

      logWithTs('[SyncService] Sync to Supabase completed');
      await this.refreshQueueSize();
      this.setSyncStatus({
        state: queueHadErrors ? 'error' : 'idle',
      });
      this.notifySyncComplete();
    } catch (error) {
      errorWithTs('[SyncService] Error syncing to Supabase:', error);
      this.setSyncStatus({
        state: 'error',
        lastError: error instanceof Error ? error.message : 'Failed to sync data',
        lastErrorAt: new Date().toISOString(),
      });
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
  private async processSyncQueue(): Promise<boolean> {
    const queue = await localDB.getSyncQueue();
    logWithTs(`[SyncService] Processing ${queue.length} items in sync queue`);
    let hadProcessingErrors = false;

    // Get current user
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      warnWithTs('[SyncService] No authenticated user, cannot process sync queue');
      return false;
    }

    for (const item of queue) {
      try {
        if (!this.isQueueItemReady(item)) {
          continue;
        }

        if (item.retry_count >= this.maxQueueRetries) {
          warnWithTs(`[SyncService] Max retries (${this.maxQueueRetries}) reached for queue item ${item.id}, removing`);
          await localDB.removeSyncQueueItem(item.id);
          continue;
        }

        let data: Record<string, unknown> = {};
        if (item.data) {
          let parsed: unknown;
          try {
            parsed = JSON.parse(item.data);
          } catch {
            warnWithTs(
              `[SyncService] Corrupted JSON in sync queue item ${item.id} ` +
                `(table: ${item.table_name}, op: ${item.operation}), removing`
            );
            await localDB.removeSyncQueueItem(item.id);
            continue;
          }
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            data = parsed as Record<string, unknown>;
          }
        }

        const itemUserId = typeof data.user_id === 'string' ? data.user_id : null;
        if (itemUserId && itemUserId !== user.id) {
          warnWithTs(
            `[SyncService] Skipping queue item ${item.id} because user_id ${String(itemUserId)} does not match current user ${user.id}`
          );
          continue;
        }

        if (item.operation === 'delete') {
          const { error } = await supabase
            .from(item.table_name)
            .delete()
            .eq('id', item.record_id);

          if (error) throw error;
        } else if (item.operation === 'upsert') {
          // Remove local-only fields (deleted, synced) that don't exist in Supabase schema
          const { deleted, synced, ...cleanData } = data;
          const cleanDataRecord = cleanData as Record<string, unknown>;
          
          // Prepare data for Supabase with required fields
          const upsertData: Record<string, unknown> = {
            ...cleanDataRecord,
            user_id: user.id,
            updated_at:
              typeof cleanDataRecord.updated_at === 'string'
                ? cleanDataRecord.updated_at
                : new Date().toISOString(),
            // For workouts, ensure date is set
            ...(item.table_name === 'workouts' && {
              date:
                typeof cleanDataRecord.date === 'string'
                  ? cleanDataRecord.date
                  : new Date().toISOString(),
            }),
          };

          if (item.table_name === 'health_metrics') {
            delete upsertData.id;
          }

          let upsertError: unknown = null;
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

        // Remove from queue and update sync status atomically
        await localDB.withTransaction(async () => {
          await localDB.removeSyncQueueItem(item.id);

          if (item.table_name === 'foods') {
            await localDB.updateFoodSyncStatus(item.record_id, true);
          } else if (item.table_name === 'workouts') {
            await localDB.updateWorkoutSyncStatus(item.record_id, true);
          } else if (item.table_name === 'health_metrics') {
            await localDB.updateHealthMetricSyncStatus(item.record_id, true);
          } else if (item.table_name === 'nutrition_goals') {
            await localDB.updateNutritionGoalsSyncStatus(item.record_id, true);
          }
        });
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
        const nextRetryAt = this.getNextRetryIso(item);
        await localDB.incrementSyncQueueRetry(item.id, nextRetryAt);
        hadProcessingErrors = true;
        this.setSyncStatus({
          state: 'error',
          lastError: error instanceof Error ? error.message : `Queue item ${item.id} failed`,
          lastErrorAt: new Date().toISOString(),
        });
      }
    }

    await this.refreshQueueSize();
    return hadProcessingErrors;
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

      // Clean up deleted items that have been synced (foods)
      await this.cleanupSyncedDeletesLegacy();

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
      // Download workout session tables via generic adapter
      if (user) {
        await downloadAllWorkoutTablesFromSupabase(user.id);
      }

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
      this.setSyncStatus({
        state: 'error',
        lastError: error instanceof Error ? error.message : 'Failed to download data',
        lastErrorAt: new Date().toISOString(),
      });
    }
  }

  // Clean up soft-deleted items that have been successfully synced (legacy foods/workouts only)
  private async cleanupSyncedDeletesLegacy(): Promise<void> {
    try {
      await localDB.cleanupSyncedDeletes();
      await cleanupWorkoutSyncedDeletes();
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
        await this.executeSyncToSupabase();
        logWithTs('[SyncService] Full sync completed');
      } catch (error) {
        errorWithTs('[SyncService] Error during full sync:', error);
        this.setSyncStatus({
          state: 'error',
          lastError: error instanceof Error ? error.message : 'Full sync failed',
          lastErrorAt: new Date().toISOString(),
        });
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
    await this.refreshQueueSize();
    this.setSyncStatus({ state: 'idle', lastError: null, lastErrorAt: null });
    logWithTs('[SyncService] Sync queue cleared');
  }
}

// Export singleton instance
export const syncService = new SyncService();
