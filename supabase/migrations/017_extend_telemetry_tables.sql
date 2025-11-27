-- Extend existing telemetry tables with versioning, environment, and quality columns

-- =============================================================================
-- POSE_SAMPLES: Add versioning, confidence, and environment columns
-- =============================================================================

ALTER TABLE pose_samples 
  ADD COLUMN IF NOT EXISTS frame_idx integer,
  ADD COLUMN IF NOT EXISTS model_version text,
  ADD COLUMN IF NOT EXISTS cue_config_version text,
  ADD COLUMN IF NOT EXISTS pose_confidence real[],
  ADD COLUMN IF NOT EXISTS inference_ms smallint,
  ADD COLUMN IF NOT EXISTS lighting_score real,
  ADD COLUMN IF NOT EXISTS camera_pose real[];

-- Index for model version queries
CREATE INDEX IF NOT EXISTS pose_samples_model_version_idx ON pose_samples(model_version);

-- =============================================================================
-- SESSION_METRICS: Add versioning, experiment, environment, and quality columns
-- =============================================================================

ALTER TABLE session_metrics
  -- Versioning
  ADD COLUMN IF NOT EXISTS model_version text,
  ADD COLUMN IF NOT EXISTS cue_config_version text,
  ADD COLUMN IF NOT EXISTS exercise_config_version text,
  -- Experiment tracking
  ADD COLUMN IF NOT EXISTS experiment_id text,
  ADD COLUMN IF NOT EXISTS variant text,
  -- Device info
  ADD COLUMN IF NOT EXISTS device_model text,
  ADD COLUMN IF NOT EXISTS os_version text,
  -- Environment context
  ADD COLUMN IF NOT EXISTS camera_angle_class text,
  ADD COLUMN IF NOT EXISTS distance_bucket text,
  ADD COLUMN IF NOT EXISTS lighting_bucket text,
  ADD COLUMN IF NOT EXISTS mirror_present boolean,
  -- Quality signals
  ADD COLUMN IF NOT EXISTS pose_lost_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS low_confidence_frames integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tracking_reset_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS user_aborted_early boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS cues_disabled_mid_session boolean DEFAULT false,
  -- Retention policy
  ADD COLUMN IF NOT EXISTS retention_class text DEFAULT 'short';

-- Indexes for analytics queries
CREATE INDEX IF NOT EXISTS session_metrics_experiment_idx ON session_metrics(experiment_id, variant);
CREATE INDEX IF NOT EXISTS session_metrics_model_version_idx ON session_metrics(model_version);
CREATE INDEX IF NOT EXISTS session_metrics_device_idx ON session_metrics(device_model, os_version);

-- =============================================================================
-- CUE_EVENTS: Add experiment tracking and config version
-- =============================================================================

ALTER TABLE cue_events
  ADD COLUMN IF NOT EXISTS experiment_id text,
  ADD COLUMN IF NOT EXISTS variant text,
  ADD COLUMN IF NOT EXISTS cue_config_version text;

-- Index for experiment analysis
CREATE INDEX IF NOT EXISTS cue_events_experiment_idx ON cue_events(experiment_id, variant);
