-- Add date column to workouts table
ALTER TABLE workouts 
ADD COLUMN IF NOT EXISTS date TIMESTAMPTZ;

-- Set default value for existing rows (use created_at)
UPDATE workouts 
SET date = created_at 
WHERE date IS NULL;

-- Make date required for new rows
ALTER TABLE workouts 
ALTER COLUMN date SET DEFAULT NOW();

-- Add index for date column
CREATE INDEX IF NOT EXISTS workouts_date_idx ON workouts(date);

