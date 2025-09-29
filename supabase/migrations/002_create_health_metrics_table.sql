-- Ensure helper function exists (idempotent with migration 001)
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create health_metrics table for storing daily HealthKit summaries
CREATE TABLE IF NOT EXISTS health_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  summary_date DATE NOT NULL,
  steps INTEGER,
  heart_rate_bpm DECIMAL(6,2),
  heart_rate_timestamp TIMESTAMPTZ,
  weight_kg DECIMAL(7,3),
  weight_timestamp TIMESTAMPTZ,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT health_metrics_user_summary_unique UNIQUE (user_id, summary_date)
);

-- Enable Row Level Security
ALTER TABLE health_metrics ENABLE ROW LEVEL SECURITY;

-- Policies to allow users to manage their own data
CREATE POLICY "Users can view their own health metrics" ON health_metrics
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own health metrics" ON health_metrics
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own health metrics" ON health_metrics
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own health metrics" ON health_metrics
  FOR DELETE USING (auth.uid() = user_id);

-- Helpful indexes
CREATE INDEX IF NOT EXISTS health_metrics_user_id_idx ON health_metrics(user_id);
CREATE INDEX IF NOT EXISTS health_metrics_summary_date_idx ON health_metrics(summary_date);

-- Trigger to keep updated_at current
CREATE TRIGGER update_health_metrics_updated_at BEFORE UPDATE ON health_metrics
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
