-- ============================================================================
-- Migration 027: Create workout template tables
-- ============================================================================

-- Workout templates (shareable routine definitions)
CREATE TABLE IF NOT EXISTS workout_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  goal_profile text NOT NULL DEFAULT 'hypertrophy'
    CHECK (goal_profile IN ('hypertrophy', 'strength', 'power', 'endurance', 'mixed')),
  is_public boolean NOT NULL DEFAULT false,
  share_slug text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Partial unique index on share_slug (only non-null values must be unique)
CREATE UNIQUE INDEX idx_workout_templates_share_slug
  ON workout_templates (share_slug) WHERE share_slug IS NOT NULL;

CREATE INDEX idx_workout_templates_user ON workout_templates (user_id);

CREATE TRIGGER update_workout_templates_updated_at
  BEFORE UPDATE ON workout_templates
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Template exercises (ordered exercises within a template)
CREATE TABLE IF NOT EXISTS workout_template_exercises (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES workout_templates(id) ON DELETE CASCADE,
  exercise_id uuid NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  sort_order int NOT NULL DEFAULT 0,
  notes text,
  default_rest_seconds int,
  default_tempo text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_wte_template_order ON workout_template_exercises (template_id, sort_order);

CREATE TRIGGER update_wte_updated_at
  BEFORE UPDATE ON workout_template_exercises
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Template sets (planned sets for each exercise in a template)
CREATE TABLE IF NOT EXISTS workout_template_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_exercise_id uuid NOT NULL REFERENCES workout_template_exercises(id) ON DELETE CASCADE,
  sort_order int NOT NULL DEFAULT 0,
  set_type text NOT NULL DEFAULT 'normal'
    CHECK (set_type IN ('normal', 'warmup', 'dropset', 'amrap', 'failure', 'timed')),
  target_reps int,
  target_seconds int,
  target_weight numeric,
  target_rpe numeric,
  rest_seconds_override int,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_wts_exercise_order ON workout_template_sets (template_exercise_id, sort_order);

CREATE TRIGGER update_wts_updated_at
  BEFORE UPDATE ON workout_template_sets
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- RLS policies
ALTER TABLE workout_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE workout_template_exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE workout_template_sets ENABLE ROW LEVEL SECURITY;

-- Templates: user can CRUD their own, can read public templates
CREATE POLICY "wt_select" ON workout_templates
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR is_public = true);

CREATE POLICY "wt_insert" ON workout_templates
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "wt_update" ON workout_templates
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "wt_delete" ON workout_templates
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- Template exercises: access follows parent template
CREATE POLICY "wte_select" ON workout_template_exercises
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM workout_templates wt
      WHERE wt.id = template_id
        AND (wt.user_id = auth.uid() OR wt.is_public = true)
    )
  );

CREATE POLICY "wte_insert" ON workout_template_exercises
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM workout_templates wt
      WHERE wt.id = template_id AND wt.user_id = auth.uid()
    )
  );

CREATE POLICY "wte_update" ON workout_template_exercises
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM workout_templates wt
      WHERE wt.id = template_id AND wt.user_id = auth.uid()
    )
  );

CREATE POLICY "wte_delete" ON workout_template_exercises
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM workout_templates wt
      WHERE wt.id = template_id AND wt.user_id = auth.uid()
    )
  );

-- Template sets: access follows parent template exercise
CREATE POLICY "wts_select" ON workout_template_sets
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM workout_template_exercises wte
      JOIN workout_templates wt ON wt.id = wte.template_id
      WHERE wte.id = template_exercise_id
        AND (wt.user_id = auth.uid() OR wt.is_public = true)
    )
  );

CREATE POLICY "wts_insert" ON workout_template_sets
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM workout_template_exercises wte
      JOIN workout_templates wt ON wt.id = wte.template_id
      WHERE wte.id = template_exercise_id AND wt.user_id = auth.uid()
    )
  );

CREATE POLICY "wts_update" ON workout_template_sets
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM workout_template_exercises wte
      JOIN workout_templates wt ON wt.id = wte.template_id
      WHERE wte.id = template_exercise_id AND wt.user_id = auth.uid()
    )
  );

CREATE POLICY "wts_delete" ON workout_template_sets
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM workout_template_exercises wte
      JOIN workout_templates wt ON wt.id = wte.template_id
      WHERE wte.id = template_exercise_id AND wt.user_id = auth.uid()
    )
  );

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE workout_templates;
ALTER PUBLICATION supabase_realtime ADD TABLE workout_template_exercises;
ALTER PUBLICATION supabase_realtime ADD TABLE workout_template_sets;
