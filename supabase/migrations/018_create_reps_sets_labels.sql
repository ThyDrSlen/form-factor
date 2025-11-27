-- Create reps, sets, rep_labels, and user_telemetry_consent tables

-- =============================================================================
-- REPS: Per-rep metrics and features for ML evaluation
-- =============================================================================

CREATE TABLE IF NOT EXISTS reps (
  rep_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id text NOT NULL,
  set_id uuid,
  rep_index integer NOT NULL,
  exercise text NOT NULL,
  side text,  -- 'left' | 'right' | null for bilateral
  start_ts timestamptz NOT NULL,
  end_ts timestamptz NOT NULL,
  
  -- Features (expandable via JSONB)
  features jsonb,  -- {rom_deg, depth_ratio, duration_ms, peak_velocity, ...}
  fqi smallint,    -- 0-100 form quality index
  faults_detected text[],
  cues_emitted jsonb,  -- [{type, ts}]
  adopted_within_3_reps boolean,
  
  -- Versioning and experiment tracking
  model_version text,
  cue_config_version text,
  experiment_id text,
  variant text,
  
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes for reps
CREATE INDEX IF NOT EXISTS reps_user_id_idx ON reps(user_id);
CREATE INDEX IF NOT EXISTS reps_session_idx ON reps(session_id);
CREATE INDEX IF NOT EXISTS reps_set_idx ON reps(set_id);
CREATE INDEX IF NOT EXISTS reps_exercise_idx ON reps(exercise);
CREATE INDEX IF NOT EXISTS reps_experiment_idx ON reps(experiment_id, variant);

-- RLS for reps
ALTER TABLE reps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "reps read own" ON reps
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "reps insert own" ON reps
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "reps update own" ON reps
  FOR UPDATE USING (auth.uid() = user_id);

-- =============================================================================
-- SETS: Per-set aggregates and media references
-- =============================================================================

CREATE TABLE IF NOT EXISTS sets (
  set_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id text NOT NULL,
  exercise text NOT NULL,
  
  -- Load and configuration
  load_value numeric,
  load_unit text,  -- 'kg' | 'lbs'
  tempo text,
  stance_width text,
  
  -- Aggregates
  reps_count integer,
  avg_fqi smallint,
  faults_histogram jsonb,  -- {"valgus": 3, "depth": 2}
  cues_per_min real,
  
  -- Media references
  media_uri text,
  media_sha256 text,
  
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes for sets
CREATE INDEX IF NOT EXISTS sets_user_id_idx ON sets(user_id);
CREATE INDEX IF NOT EXISTS sets_session_idx ON sets(session_id);
CREATE INDEX IF NOT EXISTS sets_exercise_idx ON sets(exercise);

-- RLS for sets
ALTER TABLE sets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sets read own" ON sets
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "sets insert own" ON sets
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "sets update own" ON sets
  FOR UPDATE USING (auth.uid() = user_id);

-- =============================================================================
-- REP_LABELS: Ground truth for model evaluation
-- =============================================================================

CREATE TABLE IF NOT EXISTS rep_labels (
  label_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rep_id uuid NOT NULL REFERENCES reps(rep_id) ON DELETE CASCADE,
  
  -- Ground truth
  label_good_form boolean,
  label_fault_types text[],
  label_source text NOT NULL,  -- 'trainer' | 'self' | 'auto'
  
  -- Labeler info
  labeler_id uuid REFERENCES auth.users(id),
  notes text,
  
  labeled_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes for rep_labels
CREATE INDEX IF NOT EXISTS rep_labels_rep_idx ON rep_labels(rep_id);
CREATE INDEX IF NOT EXISTS rep_labels_labeler_idx ON rep_labels(labeler_id);
CREATE INDEX IF NOT EXISTS rep_labels_source_idx ON rep_labels(label_source);

-- RLS for rep_labels
ALTER TABLE rep_labels ENABLE ROW LEVEL SECURITY;

-- Users can read labels on their own reps
CREATE POLICY "rep_labels read own reps" ON rep_labels
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM reps WHERE reps.rep_id = rep_labels.rep_id AND reps.user_id = auth.uid())
  );

-- Users can insert labels on their own reps (self-labeling)
CREATE POLICY "rep_labels insert own reps" ON rep_labels
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM reps WHERE reps.rep_id = rep_labels.rep_id AND reps.user_id = auth.uid())
  );

-- Trainers can label if user has consented (handled via labeler_id check in app logic)
-- For now, allow any authenticated user to insert if they're the labeler
CREATE POLICY "rep_labels insert as labeler" ON rep_labels
  FOR INSERT WITH CHECK (auth.uid() = labeler_id);

-- =============================================================================
-- USER_TELEMETRY_CONSENT: Privacy and data retention flags
-- =============================================================================

CREATE TABLE IF NOT EXISTS user_telemetry_consent (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Consent flags
  allow_anonymous_telemetry boolean DEFAULT true,
  allow_video_upload boolean DEFAULT false,
  allow_trainer_labeling boolean DEFAULT false,
  allow_extended_retention boolean DEFAULT false,
  
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- RLS for user_telemetry_consent
ALTER TABLE user_telemetry_consent ENABLE ROW LEVEL SECURITY;

CREATE POLICY "consent read own" ON user_telemetry_consent
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "consent insert own" ON user_telemetry_consent
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "consent update own" ON user_telemetry_consent
  FOR UPDATE USING (auth.uid() = user_id);

-- =============================================================================
-- FOREIGN KEY: Link sets to reps
-- =============================================================================

ALTER TABLE reps 
  ADD CONSTRAINT reps_set_fk 
  FOREIGN KEY (set_id) REFERENCES sets(set_id) ON DELETE SET NULL;
