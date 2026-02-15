-- ============================================================================
-- Migration 029: Migrate legacy workouts into workout_sessions format
-- ============================================================================
-- Each old workout row (exercise, sets, reps, weight, duration, date)
-- becomes a workout_session with one workout_session_exercise and one
-- workout_session_set (with actual values populated).
--
-- exercise text is matched to exercises.name (case-insensitive).
-- Unmatched exercises are skipped (they would need the exercises table seeded first).

-- Insert sessions from legacy workouts
INSERT INTO workout_sessions (id, user_id, name, goal_profile, started_at, ended_at, timezone_offset_minutes, bodyweight_lb, notes, created_at, updated_at)
SELECT
  w.id,
  w.user_id,
  w.exercise,              -- use exercise name as session name
  'hypertrophy',           -- default goal profile
  COALESCE(w.date, w.created_at)::timestamptz,
  COALESCE(w.date, w.created_at)::timestamptz,  -- ended_at = started_at (instant completion)
  0,
  NULL,
  NULL,
  w.created_at,
  w.updated_at
FROM workouts w
WHERE NOT EXISTS (
  SELECT 1 FROM workout_sessions ws WHERE ws.id = w.id
);

-- Insert session exercises (match exercise name to exercises table)
INSERT INTO workout_session_exercises (id, session_id, exercise_id, sort_order, notes, created_at, updated_at)
SELECT
  gen_random_uuid(),
  w.id,
  e.id,
  0,
  NULL,
  w.created_at,
  w.updated_at
FROM workouts w
JOIN exercises e ON lower(e.name) = lower(w.exercise)
WHERE EXISTS (
  SELECT 1 FROM workout_sessions ws WHERE ws.id = w.id
)
AND NOT EXISTS (
  SELECT 1 FROM workout_session_exercises wse WHERE wse.session_id = w.id
);

-- Insert session sets with actual values from legacy data
INSERT INTO workout_session_sets (
  id, session_exercise_id, sort_order, set_type,
  actual_reps, actual_weight, actual_seconds,
  completed_at, tut_source,
  created_at, updated_at
)
SELECT
  gen_random_uuid(),
  wse.id,
  0,
  'normal',
  w.reps,
  w.weight,
  w.duration,
  COALESCE(w.date, w.created_at)::timestamptz,
  'unknown',
  w.created_at,
  w.updated_at
FROM workouts w
JOIN workout_session_exercises wse ON wse.session_id = w.id
WHERE NOT EXISTS (
  SELECT 1 FROM workout_session_sets wss WHERE wss.session_exercise_id = wse.id
);
