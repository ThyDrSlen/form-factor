import { isAuthSessionMissingError, RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { supabase } from '../../supabase';
import { accountCleanup } from './account-cleanup';
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
import { getQueuedSyncRecordIds } from './sync-retry-policy';
import {
  syncAllWorkoutTablesToSupabase,
  downloadAllWorkoutTablesFromSupabase,
  cleanupWorkoutSyncedDeletes,
  WORKOUT_SYNC_CONFIGS,
  genericGetById,
  syncWorkoutRowToSupabase,
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
  private channelRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private realtimeRevision = 0;
  private syncRevision = 0;
  private get realtimeGeneration() { return this.realtimeRevision + accountCleanup.generation; }
  private get syncGeneration() { return this.syncRevision + accountCleanup.generation; }
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
  private readonly realtimeResyncDelayMs = 2_000;
  // Minimum delay enforced when scheduling a retry, regardless of computed backoff.
  // This acts as a floor against backward device-clock drift: if the clock jumps
  // backward after next_retry_at is written, the stored timestamp would immediately
  // pass the `<= Date.now()` check and trigger an infinite retry loop.  By ensuring
  // every retry is at least MIN_RETRY_DELAY_MS in the future (relative to the moment
  // we write it), we guarantee at least that much wall-clock time must elapse before
  // the item is eligible again — even if the clock later moves backward by a smaller
  // amount.  (Closes #387)
  private readonly minRetryDelayMs = 30_000;

  // An absent session is an expected signed-out/startup state, not a sync
  // failure. Other auth failures must remain visible and must not authorize work.
  private async getAuthenticatedUser() {
    const generation = this.syncGeneration;
    await this.assertAccountReady();
    const { data: { user }, error } = await supabase.auth.getUser();
    await this.assertAccountReady();
    if (generation !== this.syncGeneration) return null;
    if (error) {
      if (isAuthSessionMissingError(error)) return null;
      throw error;
    }
    return user;
  }

  private async assertAccountReady(): Promise<void> {
    try {
      await accountCleanup.assertReady();
    } catch (error) {
      this.setSyncStatus({
        state: 'error',
        lastError: error instanceof Error ? error.message : 'Account cleanup is pending',
        lastErrorAt: new Date().toISOString(),
      });
      throw error;
    }
  }

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

  private async refreshQueueSize(generation = this.syncGeneration): Promise<void> {
    try {
      const queueSize = await localDB.countSyncQueueItems();
      if (generation !== this.syncGeneration) return;
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
    // Use the larger of the exponential-backoff delay and the minimum floor so
    // that backward clock drift cannot make a just-failed item immediately
    // eligible again.  See #387.
    const delayMs = Math.max(this.minRetryDelayMs, this.getRetryDelayMs(item.retry_count));
    return new Date(Date.now() + delayMs).toISOString();
  }

  // Initialize Realtime subscriptions
  async initializeRealtimeSync(userId: string): Promise<void> {
    await this.assertAccountReady();
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
    this.realtimeRevision += 1;
    const generation = this.realtimeGeneration;

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
      if (generation !== this.realtimeGeneration) return;
      const currentState = this.channelStates.get(channelKey);
      if (currentState === 'subscribing' || currentState === 'subscribed' || currentState === 'retrying') {
        logWithTs(`[SyncService] ${label} channel already ${currentState}, skipping duplicate subscription`);
        return;
      }

      this.channelStates.set(channelKey, 'subscribing');
      const channel = buildChannel();
      storeChannel(channel);
      let retired = false;

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
        if (generation !== this.realtimeGeneration || retired || this.channelStates.get(channelKey) === 'retrying') {
          return;
        }

        retired = true;
        this.channelStates.set(channelKey, 'retrying');
        await cleanupChannel();
        // Logout can finish while unsubscribe/removeChannel is still awaiting.
        if (generation !== this.realtimeGeneration) return;

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

        const timer = setTimeout(() => {
          if (generation !== this.realtimeGeneration) return;
          this.channelRetryTimers.delete(channelKey);
          this.channelStates.delete(channelKey);
          createManagedChannel({ channelKey, label, buildChannel, storeChannel, clearChannel });
        }, retryDelayMs);
        this.channelRetryTimers.set(channelKey, timer);
      };

      channel.subscribe((status, err) => {
        if (generation !== this.realtimeGeneration || retired) return;
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
            if (generation !== this.realtimeGeneration || accountCleanup.isBlocked) return;
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
            if (generation !== this.realtimeGeneration || accountCleanup.isBlocked) return;
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
            if (generation !== this.realtimeGeneration || accountCleanup.isBlocked) return;
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
            if (generation !== this.realtimeGeneration || accountCleanup.isBlocked) return;
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
    for (const config of localDB.supportsWorkoutSync === false ? [] : WORKOUT_SYNC_CONFIGS) {
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
              if (generation !== this.realtimeGeneration || accountCleanup.isBlocked) return;
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

  private healthMetricFromServer(row: Partial<SupabaseHealthMetricRow>, userId: string): LocalHealthMetric {
    const updatedAt = row.updated_at ?? row.recorded_at;
    if (row.user_id !== userId || !row.summary_date || !updatedAt || !Number.isFinite(Date.parse(updatedAt))) {
      throw new Error('Invalid Health metric owner, natural key or content timestamp');
    }
    return {
      id: `${userId}_${row.summary_date}`, user_id: userId, summary_date: row.summary_date,
      steps: row.steps ?? null, heart_rate_bpm: row.heart_rate_bpm ?? null,
      heart_rate_timestamp: row.heart_rate_timestamp ?? null, weight_kg: row.weight_kg ?? null,
      weight_timestamp: row.weight_timestamp ?? null, synced: 1, updated_at: updatedAt,
    };
  }

  private async isHealthOwnerActive(userId: string): Promise<boolean> {
    const user = await this.getAuthenticatedUser();
    return user?.id === userId;
  }

  private async downloadHealthMetrics(userId: string, isCurrent: () => boolean): Promise<void> {
    const pageSize = 500;
    for (let offset = 0; ; offset += pageSize) {
      if (!isCurrent() || !await this.isHealthOwnerActive(userId) || !isCurrent()) return;
      const { data, error } = await supabase.from('health_metrics').select('*')
        .eq('user_id', userId).order('summary_date', { ascending: true })
        .range(offset, offset + pageSize - 1);
      if (!isCurrent()) return;
      if (error) throw error;
      if (!data) throw new Error('Health recovery returned no data');
      for (const row of data) {
        const metric = this.healthMetricFromServer(row, userId);
        if (!isCurrent() || !await this.isHealthOwnerActive(userId) || !isCurrent()) return;
        // Persistence revalidates again after native statement preparation.
        await localDB.reconcileHealthMetric(metric, undefined, isCurrent);
      }
      if (data.length < pageSize) return;
    }
    // Never infer deletions from a paginated listing or missing permissions.
  }

  // Handle realtime health metric changes from Supabase with conflict detection
  private async handleRealtimeHealthMetricChange(payload: GenericRealtimePayload): Promise<void> {
    const generation = this.syncGeneration;
    const isCurrent = () => generation === this.syncGeneration;
    try {
      const newRow = payload.new as Partial<SupabaseHealthMetricRow>;
      const oldRow = payload.old as Partial<SupabaseHealthMetricRow>;

      if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
        if (!newRow.user_id || !newRow.summary_date || !await this.isHealthOwnerActive(newRow.user_id) || !isCurrent()) return;
        const metric = this.healthMetricFromServer(newRow, newRow.user_id);
        const reconciled = await localDB.reconcileHealthMetric(metric, undefined, isCurrent);
        if (!isCurrent()) return;
        if (!reconciled) {
          this.scheduleConflictReconcile(`health_metric:${metric.id}`);
          return;
        }

        this.notifySyncComplete();
      } else if (payload.eventType === 'DELETE') {
        // Default replica identity can emit only a UUID. Without a durable UUID
        // mapping/tombstone it is unsafe to guess the owner/day or delete dirty data.
        if (!oldRow.user_id || !oldRow.summary_date || !oldRow.updated_at) return;
        if (!await this.isHealthOwnerActive(oldRow.user_id) || !isCurrent()) return;
        await localDB.deleteSyncedHealthMetric(oldRow.user_id, oldRow.summary_date, oldRow.updated_at, isCurrent);
        if (!isCurrent()) return;
        this.notifySyncComplete();
      }
    } catch (error) {
      if (!isCurrent()) return;
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
    this.syncRevision += 1;
    logWithTs('[SyncService] Cleaning up Realtime subscriptions');
    // Invalidate callbacks before awaiting any SDK cleanup, then cancel retries.
    this.realtimeRevision += 1;
    for (const timer of this.channelRetryTimers.values()) clearTimeout(timer);
    this.channelRetryTimers.clear();

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
    const generation = this.syncGeneration;
    const isCurrent = () => generation === this.syncGeneration && !accountCleanup.isBlocked;
    try {
      await this.assertAccountReady();
      if (!isCurrent()) return;
      await this.refreshQueueSize();
      if (!isCurrent()) return;
      this.setSyncStatus({ state: 'syncing', lastError: null });
      logWithTs('[SyncService] Starting sync to Supabase...');
      // Get current user
      const user = await this.getAuthenticatedUser();
      if (!isCurrent()) return;
      if (!user) {
        logWithTs('[SyncService] No authenticated user, skipping sync');
        this.setSyncStatus({ state: 'idle' });
        return;
      }

      // Sync foods
      await this.syncFoodsToSupabase();
      if (!isCurrent()) return;

      // Sync workouts
      await this.syncWorkoutsToSupabase();
      if (!isCurrent()) return;

      // Sync health metrics
      await this.syncHealthMetricsToSupabase();
      if (!isCurrent()) return;

      await this.syncNutritionGoalsToSupabase();
      if (!isCurrent()) return;

      // Sync workout session tables via generic adapter
      if (localDB.supportsWorkoutSync !== false) await syncAllWorkoutTablesToSupabase(user.id);
      if (!isCurrent()) return;

      // Process sync queue
      const queueHadErrors = await this.processSyncQueue();
      if (!isCurrent()) return;

      // Cleanup synced deleted items
      await localDB.cleanupSyncedDeletes();
      if (!isCurrent()) return;

      logWithTs('[SyncService] Sync to Supabase completed');
      await this.refreshQueueSize();
      if (!isCurrent()) return;
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

  private async syncFoodsToSupabase(): Promise<void> {
    await this.syncLegacyToSupabase('foods');
  }

  private async syncWorkoutsToSupabase(): Promise<void> {
    await this.syncLegacyToSupabase('workouts');
  }

  private async syncLegacyToSupabase(table: 'foods' | 'workouts'): Promise<void> {
    const generation = this.syncGeneration;
    const rows = table === 'foods' ? await localDB.getUnsyncedFoods() : await localDB.getUnsyncedWorkouts();
    if (rows.length === 0) return;
    const user = await this.getAuthenticatedUser();
    if (!user || generation !== this.syncGeneration) return;
    const queuedIds = await getQueuedSyncRecordIds(table);
    for (const row of rows) {
      if (generation !== this.syncGeneration) return;
      if (queuedIds.has(row.id)) continue;
      try {
        const winner = await this.uploadLegacyRow(table, row, user.id, generation);
        if (winner) await this.reconcileLegacyRow(table, winner, row, generation);
      } catch (error) {
        if (generation !== this.syncGeneration) return;
        errorWithTs(`[SyncService] Failed to sync ${table} ${row.id}:`, error);
        const { deleted, synced, ...content } = row;
        await localDB.addToSyncQueue(table, row.deleted ? 'delete' : 'upsert', row.id, content);
      }
    }
  }

  // Network resolution is shared by direct uploads and retries. Persistence is
  // separate so queued reconciliation and acknowledgement keep their transaction.
  private async uploadLegacyRow(
    table: 'foods' | 'workouts', row: LocalFood | LocalWorkout, userId: string, generation: number,
  ): Promise<LocalFood | LocalWorkout | null> {
    const isCurrent = () => generation === this.syncGeneration;
    const isActive = async () => isCurrent() && (await this.getAuthenticatedUser())?.id === userId && isCurrent();
    if (!await isActive()) return null;
    if (row.deleted) {
      const { error } = await supabase.from(table).delete().eq('id', row.id).eq('user_id', userId);
      if (!await isActive()) return null;
      if (error) throw error;
      return row;
    }
    const { data: existing, error: fetchError } = await supabase.from(table)
      .select('*').eq('id', row.id).eq('user_id', userId).single();
    if (!await isActive()) return null;
    if (fetchError && fetchError.code !== 'PGRST116') throw fetchError;
    if (existing && (existing.id !== row.id || existing.user_id !== userId)) {
      throw new Error(`${table} server ownership/key mismatch`);
    }
    if (existing && Date.parse(existing.updated_at) > Date.parse(row.updated_at)) {
      const metadata = {
        id: row.id, date: existing.date ?? existing.created_at ?? existing.updated_at,
        updated_at: existing.updated_at, synced: 1, deleted: 0,
      };
      return table === 'foods' ? {
        ...metadata, name: existing.name, calories: existing.calories,
        protein: existing.protein ?? undefined, carbs: existing.carbs ?? undefined, fat: existing.fat ?? undefined,
      } : {
        ...metadata, exercise: existing.exercise, sets: existing.sets,
        reps: existing.reps ?? undefined, weight: existing.weight ?? undefined, duration: existing.duration ?? undefined,
      };
    }
    const { synced, deleted, ...content } = row;
    const { error } = await supabase.from(table).upsert([{ ...content, user_id: userId }]);
    if (!await isActive()) return null;
    if (error) throw error;
    return row;
  }

  private reconcileLegacyRow(
    table: 'foods' | 'workouts', incoming: LocalFood | LocalWorkout,
    expected: LocalFood | LocalWorkout, generation: number,
  ): Promise<boolean> {
    const isCurrent = () => generation === this.syncGeneration;
    return table === 'foods'
      ? localDB.reconcileFood(incoming as LocalFood, expected as LocalFood, isCurrent)
      : localDB.reconcileWorkout(incoming as LocalWorkout, expected as LocalWorkout, isCurrent);
  }

  // Sync health metrics to Supabase with Last-Write-Wins conflict resolution
  private async syncHealthMetricsToSupabase(): Promise<void> {
    const generation = this.syncGeneration;
    await this.assertAccountReady();
    if (generation !== this.syncGeneration) return;
    const unsyncedMetrics = await localDB.getUnsyncedHealthMetrics();
    if (generation !== this.syncGeneration) return;
    if (unsyncedMetrics.length === 0) return;
    logWithTs(`[SyncService] Syncing ${unsyncedMetrics.length} health metrics to Supabase`);

    const user = await this.getAuthenticatedUser();
    if (generation !== this.syncGeneration) return;
    if (!user) {
      warnWithTs('[SyncService] No authenticated user, cannot sync health metrics');
      return;
    }

    const queuedIds = await getQueuedSyncRecordIds('health_metrics');
    for (const metric of unsyncedMetrics) {
      if (generation !== this.syncGeneration) return;
      if (queuedIds.has(metric.id)) continue;
      try {
        if (!metric.user_id || metric.user_id !== user.id) {
          warnWithTs(
            `[SyncService] Skipping health metric ${metric.id} because it belongs to another user (${metric.user_id})`
          );
          continue; // Another account's pending data is not disposable.

        }

        await this.syncHealthMetric(metric, user.id, generation);
      } catch (error) {
        if (generation !== this.syncGeneration) return;
        errorWithTs(`[SyncService] Failed to sync health metric ${metric.id}:`, error);
        // Add to sync queue for retry
        const { synced, ...cleanMetric } = metric;
        await localDB.addToSyncQueue('health_metrics', 'upsert', metric.id, cleanMetric);
      }
    }
  }

  private async syncHealthMetric(metric: LocalHealthMetric, userId: string, generation: number): Promise<boolean> {
    const isCurrent = () => generation === this.syncGeneration;
    if (metric.user_id !== userId) throw new Error('Health metric ownership mismatch');
    if (!isCurrent() || !await this.isHealthOwnerActive(userId) || !isCurrent()) return false;
    const { data: existing, error: fetchError } = await supabase.from('health_metrics')
      .select('*').eq('user_id', userId).eq('summary_date', metric.summary_date).single();
    if (!isCurrent()) return false;
    if (fetchError && fetchError.code !== 'PGRST116') throw fetchError;
    if (existing && (existing.user_id !== userId || existing.summary_date !== metric.summary_date)) {
      throw new Error('Health metric ownership/key mismatch');
    }
    if (!await this.isHealthOwnerActive(userId) || !isCurrent()) return false;
    if (existing && Date.parse(existing.updated_at) > Date.parse(metric.updated_at)) {
      return localDB.reconcileHealthMetric(this.healthMetricFromServer(existing, userId), metric, isCurrent);
    }
    const { id, synced, ...content } = metric;
    const { error } = await supabase.from('health_metrics')
      .upsert([{ ...content, recorded_at: metric.updated_at }], { onConflict: 'user_id,summary_date' });
    if (!isCurrent()) return false;
    if (error) throw error;
    if (!await this.isHealthOwnerActive(userId) || !isCurrent()) return false;
    return localDB.reconcileHealthMetric(metric, metric, isCurrent);
  }

  private async syncNutritionGoalsToSupabase(): Promise<void> {
    const generation = this.syncGeneration;
    await this.assertAccountReady();
    if (generation !== this.syncGeneration) return;
    const unsyncedGoals = await localDB.getUnsyncedNutritionGoals();
    if (generation !== this.syncGeneration) return;
    if (unsyncedGoals.length === 0) return;

    logWithTs(`[SyncService] Syncing ${unsyncedGoals.length} nutrition goals to Supabase`);

    const user = await this.getAuthenticatedUser();
    if (generation !== this.syncGeneration) return;
    if (!user) {
      warnWithTs('[SyncService] No authenticated user, cannot sync nutrition goals');
      return;
    }

    const queuedIds = await getQueuedSyncRecordIds('nutrition_goals');
    for (const goals of unsyncedGoals) {
      if (generation !== this.syncGeneration) return;
      if (queuedIds.has(goals.id)) continue;
      try {
        if (!goals.user_id || goals.user_id !== user.id) {
          warnWithTs(`[SyncService] Skipping nutrition goals ${goals.id} for different user (${goals.user_id})`);
          continue;
        }

        await this.syncNutritionGoalsRow(goals, user.id, generation);
      } catch (error) {
        if (generation !== this.syncGeneration) return;
        errorWithTs(`[SyncService] Failed to sync nutrition goals ${goals.id}:`, error);
        const { synced, ...cleanGoals } = goals;
        await localDB.addToSyncQueue('nutrition_goals', 'upsert', goals.id, cleanGoals);
      }
    }
  }

  private async syncNutritionGoalsRow(goals: LocalNutritionGoals, userId: string, generation: number): Promise<boolean> {
    const isCurrent = () => generation === this.syncGeneration;
    if (!isCurrent() || (await this.getAuthenticatedUser())?.id !== userId || !isCurrent()) return false;
    const { data: existing, error: fetchError } = await supabase.from('nutrition_goals')
      .select('*').eq('user_id', userId).single();
    if (!isCurrent() || (await this.getAuthenticatedUser())?.id !== userId || !isCurrent()) return false;
    if (fetchError && fetchError.code !== 'PGRST116') throw fetchError;
    if (existing && existing.user_id !== userId) {
      throw new Error('Nutrition goals server ownership mismatch');
    }
    if (existing && Date.parse(existing.updated_at) > Date.parse(goals.updated_at)) {
      return localDB.reconcileNutritionGoals({
        id: existing.id, user_id: existing.user_id,
        calories_goal: existing.calories_goal, protein_goal: existing.protein_goal,
        carbs_goal: existing.carbs_goal, fat_goal: existing.fat_goal,
        updated_at: existing.updated_at, synced: 1,
      }, goals, isCurrent);
    }
    const { synced, ...content } = goals;
    const { error } = await supabase.from('nutrition_goals')
      .upsert([content], { onConflict: 'user_id' });
    if (!isCurrent() || (await this.getAuthenticatedUser())?.id !== userId || !isCurrent()) return false;
    if (error) throw error;
    return localDB.reconcileNutritionGoals(goals, goals, isCurrent);
  }

  // Process items in sync queue
  private async processSyncQueue(): Promise<boolean> {
    const generation = this.syncGeneration;
    // Authenticate before deduplication: even stale-entry removal is a mutation.
    const user = await this.getAuthenticatedUser();
    if (generation !== this.syncGeneration) return false;
    if (!user) {
      warnWithTs('[SyncService] No authenticated user, cannot process sync queue');
      return false;
    }

    const queue = await localDB.getSyncQueue();
    if (generation !== this.syncGeneration) return false;
    const dedupedQueue = await this.removeStaleQueueDuplicates(queue, generation);
    if (generation !== this.syncGeneration) return false;
    logWithTs(`[SyncService] Processing ${dedupedQueue.length} items in sync queue`);
    let hadProcessingErrors = false;

    for (const item of dedupedQueue) {
      if (generation !== this.syncGeneration) return false;
      try {
        if (!this.isQueueItemReady(item)) {
          continue;
        }

        // Retain failed writes across app/schema fixes. Backoff caps retry frequency,
        // rather than deleting unsent changes after a fixed number of attempts.
        let data: Record<string, unknown> = {};
        if (item.data && item.table_name !== 'nutrition_goals') {
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

        if (item.table_name === 'nutrition_goals') {
          // This table has durable ownership; queued JSON is neither content
          // nor authorization evidence (and may predate the current row).
          const current = await localDB.getNutritionGoalsById(item.record_id);
          if (generation !== this.syncGeneration) return false;
          if (!current) throw new Error('Nutrition goals retry has no persisted row');
          if (current.user_id !== user.id) throw new Error('Nutrition goals belong to another account; retaining local data');
          if (item.operation !== 'upsert') throw new Error('Nutrition goals delete requires a durable tombstone');
          if ((current.synced === 1 || await this.syncNutritionGoalsRow(current, user.id, generation))
            && generation === this.syncGeneration) {
            await localDB.removeSyncQueueItem(item.id);
          }
          continue; // Direct uploads and retries share conflict resolution and CAS.
        }

        const itemUserId = typeof data.user_id === 'string' ? data.user_id : null;
        // Health retries authorize against the persisted row below, not stale queue JSON.
        if (item.table_name !== 'health_metrics' && itemUserId && itemUserId !== user.id) {
          // Conflicting ownership is not permission to delete unsent data.
          // Retain the row and retry with backoff until the owner can resolve it.
          throw new Error(
            `Queue item ${item.id} belongs to another account; retaining local data`
          );
        }

        if (item.table_name === 'health_metrics') {
          const current = await localDB.getHealthMetricById(item.record_id);
          if (generation !== this.syncGeneration) return false;
          if (!current) throw new Error('Health queue entry has no persisted ownership');
          if (current.user_id !== user.id) continue;
          if (item.operation !== 'upsert') throw new Error('Health delete requires a durable tombstone');
          if ((current.synced === 1 || await this.syncHealthMetric(current, user.id, generation))
            && generation === this.syncGeneration) {
            await localDB.removeSyncQueueItem(item.id);
          }
          continue; // The shared uploader owns conditional acknowledgement.
        }

        // Legacy queue entries are retry hints, not authoritative content.
        // A later offline edit may not have replaced the queued JSON snapshot.
        const operation = item.operation;
        if (item.table_name === 'foods' || item.table_name === 'workouts') {
          const current = item.table_name === 'foods'
            ? await localDB.getFoodById(item.record_id)
            : await localDB.getWorkoutById(item.record_id);
          if (generation !== this.syncGeneration) return false;
          if (!current) throw new Error(`Missing persisted ${item.table_name} row for queued retry`);
          if (current.synced === 1) {
            await localDB.removeSyncQueueItem(item.id);
            continue;
          }
          const table = item.table_name;
          const winner = await this.uploadLegacyRow(table, current, user.id, generation);
          if (generation !== this.syncGeneration) return false;
          if (winner) {
            await localDB.withTransaction(async () => {
              if (generation !== this.syncGeneration) return;
              if (await this.reconcileLegacyRow(table, winner, current, generation)
                && generation === this.syncGeneration) {
                await localDB.removeSyncQueueItem(item.id);
              }
            });
          }
          continue;
        }

        const tableConfig = WORKOUT_SYNC_CONFIGS.find(config => config.localTable === item.table_name);
        if (tableConfig) {
          if (localDB.supportsWorkoutSync === false) throw new Error('Workout session sync requires native storage');
          // The current row is authoritative. A stale queued snapshot must not
          // overwrite a later edit or replay a write that already succeeded.
          const current = await genericGetById(tableConfig.localTable, tableConfig.primaryKey, item.record_id);
          if (generation !== this.syncGeneration) return false;
          if (current?.synced !== 1) {
            await syncWorkoutRowToSupabase(tableConfig, current ?? {
              ...data,
              [tableConfig.primaryKey]: item.record_id,
              deleted: item.operation === 'delete' ? 1 : 0,
            }, user.id);
          }
        } else if (operation === 'delete') {
          const { error } = await supabase
            .from(item.table_name)
            .delete()
            .eq('id', item.record_id);

          if (error) throw error;
        } else if (operation === 'upsert') {
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

            };

          const { error } = await supabase.from(item.table_name).upsert([upsertData]);
          if (error) throw error;
        }

        // Legacy row reconciliation is handled above; generic uploads retain
        // their existing queue acknowledgement boundary.
        if (generation !== this.syncGeneration) return false;
        await localDB.withTransaction(async () => {
          if (generation !== this.syncGeneration) return;
          await localDB.removeSyncQueueItem(item.id);
        });
      } catch (error) {
        if (generation !== this.syncGeneration) return false;
        errorWithTs(`[SyncService] Failed to process queue item ${item.id}:`, error);
        const nextRetryAt = this.getNextRetryIso(item);
        await localDB.incrementSyncQueueRetry(item.id, nextRetryAt);
        if (generation !== this.syncGeneration) return false;
        hadProcessingErrors = true;
        this.setSyncStatus({
          state: 'error',
          lastError: error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
            ? error.message
            : `Queue item ${item.id} failed`,
          lastErrorAt: new Date().toISOString(),
        });
      }
    }

    if (generation !== this.syncGeneration) return false;
    await this.refreshQueueSize(generation);
    if (generation !== this.syncGeneration) return false;
    return hadProcessingErrors;
  }

  private async removeStaleQueueDuplicates(queue: SyncQueueItem[], generation: number): Promise<SyncQueueItem[]> {
    const latestIdsByRecord = new Map<string, number>();

    for (const item of queue) {
      const key = `${item.table_name}:${item.record_id}`;
      const existingId = latestIdsByRecord.get(key);
      if (existingId === undefined || item.id > existingId) {
        latestIdsByRecord.set(key, item.id);
      }
    }

    const dedupedQueue: SyncQueueItem[] = [];
    for (const item of queue) {
      if (generation !== this.syncGeneration) return [];
      const key = `${item.table_name}:${item.record_id}`;
      if (latestIdsByRecord.get(key) === item.id) {
        dedupedQueue.push(item);
        continue;
      }

      warnWithTs(
        `[SyncService] Removing stale duplicate queue item ${item.id} for ${item.table_name}:${item.record_id}`
      );
      await localDB.removeSyncQueueItem(item.id);
    }

    return dedupedQueue;
  }

  private async downloadLegacyRows<Row>(
    table: 'foods' | 'workouts', userId: string, isCurrent: () => boolean,
  ): Promise<Row[] | null> {
    const rows: Row[] = [];
    const pageSize = 500;
    for (let offset = 0; ; offset += pageSize) {
      if (!isCurrent()) return null;
      const { data, error } = await supabase.from(table).select('*')
        .eq('user_id', userId).order('id', { ascending: true })
        .range(offset, offset + pageSize - 1);
      if (!isCurrent()) return null;
      if (error) throw error;
      if (!data) throw new Error(`${table} recovery returned no data`);
      rows.push(...data as Row[]);
      if (data.length < pageSize) return rows;
    }
  }

  // Download all data from Supabase to local DB
  async downloadFromSupabase(throwOnError = false): Promise<void> {
    logWithTs('[SyncService] Downloading data from Supabase...');
    const generation = this.syncGeneration;
    const isCurrent = () => generation === this.syncGeneration;

    try {
      const healthUser = await this.getAuthenticatedUser();
      if (!healthUser || !isCurrent()) return;
      await this.downloadHealthMetrics(healthUser.id, isCurrent);
      if (!isCurrent()) return;
      // Download foods
      const foods = await this.downloadLegacyRows<SupabaseFoodRow>('foods', healthUser.id, isCurrent);
      if (!foods || !isCurrent()) return;

      // Get all local foods (including deleted ones) to check for conflicts
      const allLocalFoods = await localDB.getAllFoodsWithDeleted();
      const localFoodMap = new Map(allLocalFoods.map(f => [f.id, f]));


      if (foods && foods.length > 0) {
        for (const food of foods) {
          if (!isCurrent()) return;
          const existingLocal = localFoodMap.get(food.id);
          
          // Pending edits/deletes must reach the server before recovery can
          // replace them, even when another device has a later clock.
          if (existingLocal?.synced === 0) {
            logWithTs(`[SyncService] Skipping food ${food.id} - local changes pending sync`);
            continue;
          }

          // If exists locally and local is newer, skip (local wins)
          if (existingLocal && new Date(existingLocal.updated_at) > new Date(food.updated_at ?? '')) {
            logWithTs(`[SyncService] Skipping food ${food.id} - local is newer`);
            continue;
          }

          // Server wins - upsert the food
          const localFood: LocalFood = {
            id: food.id,
            name: food.name,
            calories: food.calories,
            protein: food.protein ?? undefined,
            carbs: food.carbs ?? undefined,
            fat: food.fat ?? undefined,
            date: food.date ?? food.created_at ?? food.updated_at ?? new Date().toISOString(),
            synced: 1,
            deleted: 0,
            updated_at: food.updated_at || new Date().toISOString(),
          };

          if (existingLocal) {
            // Update existing
            await localDB.updateFood(food.id, localFood);
          } else {
            // Local inserts deliberately create dirty rows. Recovery must
            // preserve the server revision and synced marker atomically.
            await localDB.withTransaction(async () => {
              if (!isCurrent()) return;
              await localDB.insertFood(localFood);
              await localDB.updateFood(food.id, localFood);
            });
          }
        }
        logWithTs(`[SyncService] Downloaded ${foods.length} foods`);
      }

      // Absence in a listing (pagination, RLS, or an unavailable table) is not
      // a deletion. Only explicit remote DELETEs or acknowledged tombstones
      // may remove local history.

      // Clean up deleted items that have been synced (foods)
      if (!isCurrent()) return;
      await this.cleanupSyncedDeletesLegacy();

      // Download workouts
      const workouts = await this.downloadLegacyRows<SupabaseWorkoutRow>('workouts', healthUser.id, isCurrent);
      if (!workouts || !isCurrent()) return;

      // Get all local workouts (including deleted ones) to check for conflicts
      const allLocalWorkouts = await localDB.getAllWorkoutsWithDeleted();
      const localWorkoutMap = new Map(allLocalWorkouts.map(w => [w.id, w]));


      if (workouts && workouts.length > 0) {
        for (const workout of workouts) {
          if (!isCurrent()) return;
          const existingLocal = localWorkoutMap.get(workout.id);
          
          if (existingLocal?.synced === 0) {
            logWithTs(`[SyncService] Skipping workout ${workout.id} - local changes pending sync`);
            continue;
          }

          // If exists locally and local is newer, skip (local wins)
          if (existingLocal && new Date(existingLocal.updated_at) > new Date(workout.updated_at ?? '')) {
            logWithTs(`[SyncService] Skipping workout ${workout.id} - local is newer`);
            continue;
          }

          // Server wins - upsert the workout
          const localWorkout: LocalWorkout = {
            id: workout.id,
            exercise: workout.exercise,
            sets: workout.sets,
            reps: workout.reps ?? undefined,
            weight: workout.weight ?? undefined,
            duration: workout.duration ?? undefined,
            date: workout.date ?? workout.created_at ?? workout.updated_at ?? new Date().toISOString(),
            synced: 1,
            deleted: 0,
            updated_at: workout.updated_at || new Date().toISOString(),
          };

          if (existingLocal) {
            // Update existing
            await localDB.updateWorkout(workout.id, localWorkout);
          } else {
            await localDB.withTransaction(async () => {
              if (!isCurrent()) return;
              await localDB.insertWorkout(localWorkout);
              await localDB.updateWorkout(workout.id, localWorkout);
            });
          }
        }
        logWithTs(`[SyncService] Downloaded ${workouts.length} workouts`);
      }



      const user = await this.getAuthenticatedUser();
      if (!isCurrent() || user?.id !== healthUser.id) return;
      // Download workout session tables via generic adapter
      if (user) {
        if (localDB.supportsWorkoutSync !== false) await downloadAllWorkoutTablesFromSupabase(user.id);
      }

      if (user) {
        if (!isCurrent()) return;
        const { data: nutritionGoals, error: nutritionGoalsError } = await supabase
          .from('nutrition_goals')
          .select('*')
          .eq('user_id', user.id)
          .single();

        if (!isCurrent()) return;
        if (nutritionGoalsError && nutritionGoalsError.code !== 'PGRST116') {
          throw nutritionGoalsError;
        }

        if (nutritionGoals) {
          const localGoals = await localDB.getNutritionGoals(user.id);
          if (!isCurrent()) return;
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

      if (isCurrent()) this.notifySyncComplete();
    } catch (error) {
      if (!isCurrent()) return;
      errorWithTs('[SyncService] Error downloading from Supabase:', error);
      this.setSyncStatus({
        state: 'error',
        lastError: error instanceof Error ? error.message : 'Failed to download data',
        lastErrorAt: new Date().toISOString(),
      });
      if (throwOnError) throw error;
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
      const generation = this.syncGeneration;
      try {
        await this.downloadFromSupabase(true);
        // Cleanup cancels the entire operation, not just the read phase. A
        // replacement account must start its own sync after its cache is ready.
        if (generation !== this.syncGeneration) return;
        await this.executeSyncToSupabase();
        if (generation !== this.syncGeneration) return;
        logWithTs('[SyncService] Full sync completed');
      } catch (error) {
        if (generation !== this.syncGeneration) return;
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
    const generation = this.syncGeneration;
    await this.assertAccountReady();
    if (generation !== this.syncGeneration) return;
    logWithTs('[SyncService] Clearing sync queue...');
    await localDB.clearSyncQueue();
    if (generation !== this.syncGeneration) return;
    await this.refreshQueueSize(generation);
    if (generation !== this.syncGeneration) return;
    this.setSyncStatus({ state: 'idle', lastError: null, lastErrorAt: null });
    logWithTs('[SyncService] Sync queue cleared');
  }

  /**
   * Fetch remote workouts for a given exercise. Mirrors
   * `localDB.getWorkoutsByExercise()` so callers can prefer local-first and
   * fall through to Supabase when the local store is cold.
   *
   * TODO(day): wire the remote Supabase query once progressive overload
   * becomes multi-device. For now we defer entirely to the local store to
   * avoid an extra network round-trip on the hot path.
   */
  async getWorkoutsByExerciseRemote(
    userId: string,
    exerciseNameOrId: string,
    limit?: number,
  ): Promise<LocalWorkout[]> {
    void userId;
    void exerciseNameOrId;
    void limit;
    return [];
  }
}

// Export singleton instance
export const syncService = new SyncService();
