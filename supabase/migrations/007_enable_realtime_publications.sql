-- Enable Realtime for workouts and foods tables
-- This allows Postgres Changes to broadcast INSERT, UPDATE, DELETE events

-- Add workouts table to realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE workouts;

-- Add foods table to realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE foods;

-- Add health_metrics table to realtime publication (optional)
ALTER PUBLICATION supabase_realtime ADD TABLE health_metrics;

-- Verify publications (for debugging)
-- SELECT * FROM pg_publication_tables WHERE pubname = 'supabase_realtime';

