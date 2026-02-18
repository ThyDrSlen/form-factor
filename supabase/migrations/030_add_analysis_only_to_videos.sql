ALTER TABLE public.videos
  ADD COLUMN IF NOT EXISTS analysis_only BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS videos_analysis_only_created_idx
  ON public.videos (analysis_only, created_at DESC);
