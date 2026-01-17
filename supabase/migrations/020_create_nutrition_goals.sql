CREATE TABLE IF NOT EXISTS nutrition_goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  calories_goal DECIMAL(8,2) NOT NULL,
  protein_goal DECIMAL(8,2) NOT NULL,
  carbs_goal DECIMAL(8,2) NOT NULL,
  fat_goal DECIMAL(8,2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

ALTER TABLE nutrition_goals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own nutrition goals" ON nutrition_goals;
DROP POLICY IF EXISTS "Users can insert their own nutrition goals" ON nutrition_goals;
DROP POLICY IF EXISTS "Users can update their own nutrition goals" ON nutrition_goals;
DROP POLICY IF EXISTS "Users can delete their own nutrition goals" ON nutrition_goals;

CREATE POLICY "Users can view their own nutrition goals" ON nutrition_goals
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own nutrition goals" ON nutrition_goals
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own nutrition goals" ON nutrition_goals
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own nutrition goals" ON nutrition_goals
  FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS nutrition_goals_user_id_idx ON nutrition_goals(user_id);

DROP TRIGGER IF EXISTS update_nutrition_goals_updated_at ON nutrition_goals;
CREATE TRIGGER update_nutrition_goals_updated_at
BEFORE UPDATE ON nutrition_goals
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

ALTER PUBLICATION supabase_realtime ADD TABLE nutrition_goals;
