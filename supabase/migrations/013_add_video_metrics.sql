-- Add metrics JSON to videos for form/rep data
ALTER TABLE public.videos
ADD COLUMN IF NOT EXISTS metrics JSONB;
