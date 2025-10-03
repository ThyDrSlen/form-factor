-- Add updated_at column to workouts table
ALTER TABLE workouts
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Backfill existing rows
UPDATE workouts
SET updated_at = created_at
WHERE updated_at IS NULL;

-- Add updated_at column to foods table
ALTER TABLE foods
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Backfill existing rows
UPDATE foods
SET updated_at = created_at
WHERE updated_at IS NULL;

-- Create or replace function to update updated_at column
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Drop existing triggers if they exist (idempotent)
DROP TRIGGER IF EXISTS update_workouts_updated_at ON workouts;
DROP TRIGGER IF EXISTS update_foods_updated_at ON foods;

-- Create triggers for workouts and foods tables
CREATE TRIGGER update_workouts_updated_at 
BEFORE UPDATE ON workouts
FOR EACH ROW 
EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_foods_updated_at 
BEFORE UPDATE ON foods
FOR EACH ROW 
EXECUTE FUNCTION update_updated_at_column();

