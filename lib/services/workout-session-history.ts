
import { localDB } from '@/lib/services/database/local-db';

export class WorkoutSessionHistoryError extends Error {
  constructor(public readonly code: 'authentication-required' | 'unsupported-platform') {
    super(code === 'authentication-required' ? 'Sign in to view your session history.' : 'Session history is available in the mobile app.');
    this.name = 'WorkoutSessionHistoryError';
  }
}

function assertAvailable(userId: string) {
  if (!userId?.trim()) throw new WorkoutSessionHistoryError('authentication-required');
  if (!localDB.supportsWorkoutSync) throw new WorkoutSessionHistoryError('unsupported-platform');
}


/** Completed workout sessions only. Quick logs remain in the separate workouts table. */
export interface WorkoutSessionHistorySummary {
  id: string;
  name: string | null;
  started_at: string;
  ended_at: string;
  completed_exercise_count: number;
  completed_set_count: number;
}

export interface WorkoutSessionHistorySet {
  id: string;
  sort_order: number;
  set_type: string;
  actual_reps: number | null;
  actual_seconds: number | null;
  /** Canonical pounds, matching quick logs; HealthKit body mass uses kilograms. */
  actual_weight: number | null;
  completed_at: string;
}
export interface WorkoutSessionHistoryExercise {
  id: string;
  name: string;
  sets: WorkoutSessionHistorySet[];
}
export interface WorkoutSessionHistoryDetail extends WorkoutSessionHistorySummary {
  exercises: WorkoutSessionHistoryExercise[];
}

export async function getWorkoutSessionHistoryDetail(userId: string, sessionId: string): Promise<WorkoutSessionHistoryDetail | null> {
  assertAvailable(userId);
  const ownedIds = userId;
  await localDB.initialize();
  const db = localDB.db;
  if (!db) throw new Error('Workout history storage is unavailable');
  const [summary] = await db.getAllAsync<WorkoutSessionHistorySummary>(
    `${summaryQuery} AND ws.id = ? GROUP BY ws.id`, [ownedIds, sessionId],
  );
  if (!summary) return null;
  const rows = await db.getAllAsync<WorkoutSessionHistorySet & { exercise_id: string; exercise_name: string }>(`
    SELECT wse.id AS exercise_id, COALESCE(e.name, 'Exercise unavailable') AS exercise_name,
      wss.id, wss.sort_order, wss.set_type, wss.actual_reps, wss.actual_seconds, wss.actual_weight, wss.completed_at
    FROM workout_session_sets wss
    JOIN workout_session_exercises wse ON wse.id = wss.session_exercise_id AND wse.deleted = 0
    JOIN workout_sessions ws ON ws.id = wse.session_id
    LEFT JOIN exercises e ON e.id = wse.exercise_id
    WHERE ws.user_id = ? AND ws.id = ? AND ws.deleted = 0 AND ws.ended_at IS NOT NULL
      AND wss.deleted = 0 AND wss.completed_at IS NOT NULL
    ORDER BY wse.sort_order, wse.id, wss.sort_order, wss.id
  `, [ownedIds, sessionId]);
  const exercises = new Map<string, WorkoutSessionHistoryExercise>();
  for (const { exercise_id, exercise_name, ...set } of rows) {
    if (!exercises.has(exercise_id)) exercises.set(exercise_id, { id: exercise_id, name: exercise_name, sets: [] });
    exercises.get(exercise_id)!.sets.push(set);
  }
  return { ...summary, exercises: [...exercises.values()] };
}

const summaryQuery = `
  SELECT ws.id, ws.name, ws.started_at, ws.ended_at,
    COUNT(DISTINCT CASE WHEN wss.id IS NOT NULL THEN wse.id END) AS completed_exercise_count,
    COUNT(wss.id) AS completed_set_count
  FROM workout_sessions ws
  LEFT JOIN workout_session_exercises wse ON wse.session_id = ws.id AND wse.deleted = 0
  LEFT JOIN workout_session_sets wss ON wss.session_exercise_id = wse.id
    AND wss.deleted = 0 AND wss.completed_at IS NOT NULL
  WHERE ws.user_id = ? AND ws.deleted = 0 AND ws.ended_at IS NOT NULL
`;

export async function listWorkoutSessionHistory(userId: string): Promise<WorkoutSessionHistorySummary[]> {
  assertAvailable(userId);
  const ownedIds = userId;
  await localDB.initialize();
  if (!localDB.db) throw new Error('Workout history storage is unavailable');
  return localDB.db.getAllAsync<WorkoutSessionHistorySummary>(
    `${summaryQuery} GROUP BY ws.id ORDER BY ws.started_at DESC, ws.id DESC`, [ownedIds],
  );
}
