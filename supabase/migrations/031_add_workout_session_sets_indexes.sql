-- Add indexes for workout session history queries
CREATE INDEX IF NOT EXISTS idx_wss_completed_at
  ON workout_session_sets (completed_at DESC);

CREATE INDEX IF NOT EXISTS idx_wss_session_completed
  ON workout_session_sets (session_exercise_id, completed_at DESC);
