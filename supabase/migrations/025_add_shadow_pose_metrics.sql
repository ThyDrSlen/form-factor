-- Add shadow-provider comparison fields for ARKit(primary) vs MediaPipe(shadow)

ALTER TABLE pose_samples
ADD COLUMN IF NOT EXISTS shadow_provider text,
ADD COLUMN IF NOT EXISTS shadow_model_version text,
ADD COLUMN IF NOT EXISTS shadow_angles jsonb,
ADD COLUMN IF NOT EXISTS shadow_angle_delta jsonb,
ADD COLUMN IF NOT EXISTS shadow_mean_abs_delta numeric(8,4),
ADD COLUMN IF NOT EXISTS shadow_p95_abs_delta numeric(8,4),
ADD COLUMN IF NOT EXISTS shadow_inference_ms integer,
ADD COLUMN IF NOT EXISTS shadow_compared_joints integer,
ADD COLUMN IF NOT EXISTS shadow_coverage_ratio numeric(6,4);

CREATE INDEX IF NOT EXISTS pose_samples_shadow_provider_idx ON pose_samples(shadow_provider, shadow_model_version);

ALTER TABLE session_metrics
ADD COLUMN IF NOT EXISTS shadow_enabled boolean,
ADD COLUMN IF NOT EXISTS shadow_provider text,
ADD COLUMN IF NOT EXISTS shadow_model_version text,
ADD COLUMN IF NOT EXISTS shadow_frames_compared integer,
ADD COLUMN IF NOT EXISTS shadow_mean_abs_delta numeric(8,4),
ADD COLUMN IF NOT EXISTS shadow_p95_abs_delta numeric(8,4),
ADD COLUMN IF NOT EXISTS shadow_max_abs_delta numeric(8,4),
ADD COLUMN IF NOT EXISTS shadow_coverage_ratio numeric(6,4);

CREATE INDEX IF NOT EXISTS session_metrics_shadow_idx ON session_metrics(shadow_enabled, shadow_provider);
