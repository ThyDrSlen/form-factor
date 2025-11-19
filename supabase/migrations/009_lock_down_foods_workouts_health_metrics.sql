BEGIN;

-- Ensure user scoping columns cannot be null
ALTER TABLE public.foods ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE public.workouts ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE public.health_metrics ALTER COLUMN user_id SET NOT NULL;

-- Guarantee row level security is actually enforced
ALTER TABLE public.foods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.health_metrics ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.foods FORCE ROW LEVEL SECURITY;
ALTER TABLE public.workouts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.health_metrics FORCE ROW LEVEL SECURITY;

-- Replace any legacy permissive policies with a single restrictive owner policy
DROP POLICY IF EXISTS "Only owners can manage foods" ON public.foods;
DROP POLICY IF EXISTS "Users can view their own foods" ON public.foods;
DROP POLICY IF EXISTS "Users can insert their own foods" ON public.foods;
DROP POLICY IF EXISTS "Users can update their own foods" ON public.foods;
DROP POLICY IF EXISTS "Users can delete their own foods" ON public.foods;

DROP POLICY IF EXISTS "Only owners can manage foods" ON public.foods;
CREATE POLICY "Only owners can manage foods" ON public.foods
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Only owners can manage workouts" ON public.workouts;
DROP POLICY IF EXISTS "Users can view their own workouts" ON public.workouts;
DROP POLICY IF EXISTS "Users can insert their own workouts" ON public.workouts;
DROP POLICY IF EXISTS "Users can update their own workouts" ON public.workouts;
DROP POLICY IF EXISTS "Users can delete their own workouts" ON public.workouts;

DROP POLICY IF EXISTS "Only owners can manage workouts" ON public.workouts;
CREATE POLICY "Only owners can manage workouts" ON public.workouts
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Only owners can manage health metrics" ON public.health_metrics;
DROP POLICY IF EXISTS "Users can view their own health metrics" ON public.health_metrics;
DROP POLICY IF EXISTS "Users can insert their own health metrics" ON public.health_metrics;
DROP POLICY IF EXISTS "Users can update their own health metrics" ON public.health_metrics;
DROP POLICY IF EXISTS "Users can delete their own health metrics" ON public.health_metrics;

DROP POLICY IF EXISTS "Only owners can manage health metrics" ON public.health_metrics;
CREATE POLICY "Only owners can manage health metrics" ON public.health_metrics
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

COMMIT;

