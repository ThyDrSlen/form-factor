-- ============================================================================
-- Migration 028: Create workout session tables + event log
-- ============================================================================

-- Workout sessions (actual performed instances)
CREATE TABLE IF NOT EXISTS workout_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  template_id uuid REFERENCES workout_templates(id) ON DELETE SET NULL,
  name text,
  goal_profile text NOT NULL DEFAULT 'hypertrophy'
    CHECK (goal_profile IN ('hypertrophy', 'strength', 'power', 'endurance', 'mixed')),
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  timezone_offset_minutes int NOT NULL DEFAULT 0,
  bodyweight_lb numeric,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ws_user_started ON workout_sessions (user_id, started_at DESC);

CREATE TRIGGER update_ws_updated_at
  BEFORE UPDATE ON workout_sessions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Session exercises (exercises performed in a session)
CREATE TABLE IF NOT EXISTS workout_session_exercises (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES workout_sessions(id) ON DELETE CASCADE,
  exercise_id uuid NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  sort_order int NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_wse_session_order ON workout_session_exercises (session_id, sort_order);

CREATE TRIGGER update_wse_updated_at
  BEFORE UPDATE ON workout_session_exercises
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Session sets (actual sets performed)
CREATE TABLE IF NOT EXISTS workout_session_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_exercise_id uuid NOT NULL REFERENCES workout_session_exercises(id) ON DELETE CASCADE,
  sort_order int NOT NULL DEFAULT 0,
  set_type text NOT NULL DEFAULT 'normal'
    CHECK (set_type IN ('normal', 'warmup', 'dropset', 'amrap', 'failure', 'timed')),

  -- Planned values (from template)
  planned_reps int,
  planned_seconds int,
  planned_weight numeric,

  -- Actual values (filled during session)
  actual_reps int,
  actual_seconds int,
  actual_weight numeric,

  -- Timing
  started_at timestamptz,
  completed_at timestamptz,

  -- Rest
  rest_target_seconds int,
  rest_started_at timestamptz,
  rest_completed_at timestamptz,
  rest_skipped boolean NOT NULL DEFAULT false,

  -- Time under tension
  tut_ms int,
  tut_source text NOT NULL DEFAULT 'unknown'
    CHECK (tut_source IN ('measured', 'estimated', 'unknown')),

  -- Metadata
  perceived_rpe numeric,
  notes text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_wss_exercise_order ON workout_session_sets (session_exercise_id, sort_order);

CREATE TRIGGER update_wss_updated_at
  BEFORE UPDATE ON workout_session_sets
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Session events (append-only event log)
CREATE TABLE IF NOT EXISTS workout_session_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES workout_sessions(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  type text NOT NULL CHECK (type IN (
    'session_started', 'exercise_started', 'set_started', 'set_completed',
    'rest_started', 'rest_completed', 'rest_skipped', 'session_completed'
  )),
  session_exercise_id uuid,
  session_set_id uuid,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX idx_wse_events_session ON workout_session_events (session_id, created_at);

-- RLS policies
ALTER TABLE workout_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE workout_session_exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE workout_session_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE workout_session_events ENABLE ROW LEVEL SECURITY;

-- Sessions: user can CRUD their own
CREATE POLICY "ws_select" ON workout_sessions
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY "ws_insert" ON workout_sessions
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE POLICY "ws_update" ON workout_sessions
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY "ws_delete" ON workout_sessions
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- Session exercises: access follows parent session
CREATE POLICY "wse_select" ON workout_session_exercises
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM workout_sessions ws WHERE ws.id = session_id AND ws.user_id = auth.uid()
  ));

CREATE POLICY "wse_insert" ON workout_session_exercises
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM workout_sessions ws WHERE ws.id = session_id AND ws.user_id = auth.uid()
  ));

CREATE POLICY "wse_update" ON workout_session_exercises
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM workout_sessions ws WHERE ws.id = session_id AND ws.user_id = auth.uid()
  ));

CREATE POLICY "wse_delete" ON workout_session_exercises
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM workout_sessions ws WHERE ws.id = session_id AND ws.user_id = auth.uid()
  ));

-- Session sets: access follows parent session exercise
CREATE POLICY "wss_select" ON workout_session_sets
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM workout_session_exercises wse
    JOIN workout_sessions ws ON ws.id = wse.session_id
    WHERE wse.id = session_exercise_id AND ws.user_id = auth.uid()
  ));

CREATE POLICY "wss_insert" ON workout_session_sets
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM workout_session_exercises wse
    JOIN workout_sessions ws ON ws.id = wse.session_id
    WHERE wse.id = session_exercise_id AND ws.user_id = auth.uid()
  ));

CREATE POLICY "wss_update" ON workout_session_sets
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM workout_session_exercises wse
    JOIN workout_sessions ws ON ws.id = wse.session_id
    WHERE wse.id = session_exercise_id AND ws.user_id = auth.uid()
  ));

CREATE POLICY "wss_delete" ON workout_session_sets
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM workout_session_exercises wse
    JOIN workout_sessions ws ON ws.id = wse.session_id
    WHERE wse.id = session_exercise_id AND ws.user_id = auth.uid()
  ));

-- Session events: access follows parent session (append-only, no update/delete)
CREATE POLICY "wse_events_select" ON workout_session_events
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM workout_sessions ws WHERE ws.id = session_id AND ws.user_id = auth.uid()
  ));

CREATE POLICY "wse_events_insert" ON workout_session_events
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM workout_sessions ws WHERE ws.id = session_id AND ws.user_id = auth.uid()
  ));

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE workout_sessions;
ALTER PUBLICATION supabase_realtime ADD TABLE workout_session_exercises;
ALTER PUBLICATION supabase_realtime ADD TABLE workout_session_sets;
ALTER PUBLICATION supabase_realtime ADD TABLE workout_session_events;
