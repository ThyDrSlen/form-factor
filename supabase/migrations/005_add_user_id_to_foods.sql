-- Add user_id column to foods table
ALTER TABLE foods
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Enable Row Level Security
ALTER TABLE foods ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (idempotent)
DROP POLICY IF EXISTS "Users can view their own foods" ON foods;
DROP POLICY IF EXISTS "Users can insert their own foods" ON foods;
DROP POLICY IF EXISTS "Users can update their own foods" ON foods;
DROP POLICY IF EXISTS "Users can delete their own foods" ON foods;

-- Create policies for foods
CREATE POLICY "Users can view their own foods" ON foods
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own foods" ON foods
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own foods" ON foods
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own foods" ON foods
  FOR DELETE USING (auth.uid() = user_id);

-- Add index for user_id
CREATE INDEX IF NOT EXISTS foods_user_id_idx ON foods(user_id);

