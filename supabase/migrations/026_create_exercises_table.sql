-- ============================================================================
-- Migration 026: Create exercises reference table
-- ============================================================================

-- Exercises reference table (shared across all users)
CREATE TABLE IF NOT EXISTS exercises (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  category text CHECK (category IN ('push', 'pull', 'legs', 'core', 'cardio', 'full_body')),
  muscle_group text,
  is_compound boolean NOT NULL DEFAULT false,
  is_timed boolean NOT NULL DEFAULT false,
  is_system boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Trigger for updated_at
CREATE TRIGGER update_exercises_updated_at
  BEFORE UPDATE ON exercises
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Indexes
CREATE INDEX idx_exercises_name ON exercises (name);
CREATE INDEX idx_exercises_category ON exercises (category);
CREATE INDEX idx_exercises_created_by ON exercises (created_by) WHERE created_by IS NOT NULL;

-- RLS: all authenticated users can read, users can insert their own custom exercises
ALTER TABLE exercises ENABLE ROW LEVEL SECURITY;

CREATE POLICY "exercises_select" ON exercises
  FOR SELECT TO authenticated
  USING (is_system = true OR created_by = auth.uid());

CREATE POLICY "exercises_insert" ON exercises
  FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND is_system = false);

CREATE POLICY "exercises_update" ON exercises
  FOR UPDATE TO authenticated
  USING (created_by = auth.uid() AND is_system = false)
  WITH CHECK (created_by = auth.uid() AND is_system = false);

CREATE POLICY "exercises_delete" ON exercises
  FOR DELETE TO authenticated
  USING (created_by = auth.uid() AND is_system = false);

-- Seed system exercises from COMMON_WORKOUTS + form-tracking exercises
INSERT INTO exercises (name, category, muscle_group, is_compound, is_timed, is_system, created_by) VALUES
  -- Common exercises (from COMMON_WORKOUTS)
  ('Bench Press',      'push',      'chest',        true,  false, true, null),
  ('Back Squat',       'legs',      'quadriceps',   true,  false, true, null),
  ('Deadlift',         'pull',      'posterior_chain', true, false, true, null),
  ('Overhead Press',   'push',      'shoulders',    true,  false, true, null),
  ('Lat Pulldown',     'pull',      'back',         true,  false, true, null),
  ('Pull-Up',          'pull',      'back',         true,  false, true, null),
  ('Push-Up',          'push',      'chest',        true,  false, true, null),
  ('Dumbbell Row',     'pull',      'back',         true,  false, true, null),
  ('Incline Bench',    'push',      'chest',        true,  false, true, null),
  ('Leg Press',        'legs',      'quadriceps',   true,  false, true, null),
  ('Leg Curl',         'legs',      'hamstrings',   false, false, true, null),
  ('Leg Extension',    'legs',      'quadriceps',   false, false, true, null),
  ('Bicep Curl',       'pull',      'biceps',       false, false, true, null),
  ('Tricep Dip',       'push',      'triceps',      true,  false, true, null),
  ('Plank',            'core',      'core',         false, true,  true, null),
  ('Russian Twist',    'core',      'core',         false, false, true, null),
  ('Mountain Climbers','cardio',    'full_body',    false, true,  true, null),
  ('Burpees',          'cardio',    'full_body',    true,  false, true, null),
  ('Jump Rope',        'cardio',    'full_body',    false, true,  true, null),
  ('HIIT Circuit',     'cardio',    'full_body',    true,  true,  true, null),
  -- Form-tracking exercises
  ('Romanian Deadlift','pull',      'hamstrings',   true,  false, true, null),
  ('Dead Hang',        'pull',      'grip',         false, true,  true, null),
  ('Farmers Walk',     'full_body', 'grip',         true,  true,  true, null);

-- Enable realtime for exercises
ALTER PUBLICATION supabase_realtime ADD TABLE exercises;
