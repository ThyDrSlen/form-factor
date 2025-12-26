-- Ensure health_metrics is included in the realtime publication
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'health_metrics'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.health_metrics;
  END IF;
END $$;
