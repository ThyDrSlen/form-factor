/** Tables supported by the persistent upload queue on native and web. */
export type LegacySyncTableName = 'foods' | 'workouts' | 'health_metrics' | 'nutrition_goals';
export type WorkoutSyncTableName =
  | 'exercises' | 'workout_templates' | 'workout_template_exercises' | 'workout_template_sets'
  | 'workout_sessions' | 'workout_session_exercises' | 'workout_session_sets' | 'workout_session_events';
export type SyncTableName = LegacySyncTableName | WorkoutSyncTableName;
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
