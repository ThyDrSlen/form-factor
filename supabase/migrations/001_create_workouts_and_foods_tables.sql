-- Create workouts table
CREATE TABLE IF NOT EXISTS workouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  exercise VARCHAR(255) NOT NULL,
  sets INTEGER NOT NULL DEFAULT 1,
  reps INTEGER,
  weight INTEGER,
  duration INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create foods table
CREATE TABLE IF NOT EXISTS foods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  calories DECIMAL(8,2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE workouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE foods ENABLE ROW LEVEL SECURITY;

-- Create policies for workouts
CREATE POLICY "Users can view their own workouts" ON workouts
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own workouts" ON workouts
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own workouts" ON workouts
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own workouts" ON workouts
  FOR DELETE USING (auth.uid() = user_id);

-- Create policies for foods
CREATE POLICY "Users can view their own foods" ON foods
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own foods" ON foods
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own foods" ON foods
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own foods" ON foods
  FOR DELETE USING (auth.uid() = user_id);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS workouts_user_id_idx ON workouts(user_id);
CREATE INDEX IF NOT EXISTS workouts_created_at_idx ON workouts(created_at);
CREATE INDEX IF NOT EXISTS foods_user_id_idx ON foods(user_id);
CREATE INDEX IF NOT EXISTS foods_created_at_idx ON foods(created_at);

-- Create triggers for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_workouts_updated_at BEFORE UPDATE ON workouts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_foods_updated_at BEFORE UPDATE ON foods
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();