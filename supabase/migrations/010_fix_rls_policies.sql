BEGIN;

-- Drop the restrictive policies that were blocking access
DROP POLICY IF EXISTS "Only owners can manage foods" ON public.foods;
DROP POLICY IF EXISTS "Only owners can manage workouts" ON public.workouts;
DROP POLICY IF EXISTS "Only owners can manage health metrics" ON public.health_metrics;

-- Re-create them as PERMISSIVE (default) policies
-- This ensures that users can actually access their data
CREATE POLICY "Only owners can manage foods" ON public.foods
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Only owners can manage workouts" ON public.workouts
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Only owners can manage health metrics" ON public.health_metrics
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

COMMIT;
