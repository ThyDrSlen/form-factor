-- Workout video sharing + comments

-- Core video records
CREATE TABLE IF NOT EXISTS public.videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  thumbnail_path TEXT,
  duration_seconds NUMERIC,
  exercise TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Comments on videos
CREATE TABLE IF NOT EXISTS public.video_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id UUID REFERENCES public.videos(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  comment TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Optional: likes
CREATE TABLE IF NOT EXISTS public.video_likes (
  video_id UUID REFERENCES public.videos(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (video_id, user_id)
);

-- Optional: views (audit-friendly)
CREATE TABLE IF NOT EXISTS public.video_views (
  video_id UUID REFERENCES public.videos(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (video_id, user_id, created_at)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS videos_user_id_idx ON public.videos(user_id);
CREATE INDEX IF NOT EXISTS videos_created_at_idx ON public.videos(created_at DESC);
CREATE INDEX IF NOT EXISTS video_comments_video_id_idx ON public.video_comments(video_id);
CREATE INDEX IF NOT EXISTS video_comments_created_at_idx ON public.video_comments(created_at);
CREATE INDEX IF NOT EXISTS video_likes_video_id_idx ON public.video_likes(video_id);
CREATE INDEX IF NOT EXISTS video_views_video_id_idx ON public.video_views(video_id);

-- Enable Row Level Security
ALTER TABLE public.videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_views ENABLE ROW LEVEL SECURITY;

-- Videos: everyone authenticated can read (with signed URLs); owners manage their own rows
CREATE POLICY "videos read (authenticated)" ON public.videos
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "videos insert own" ON public.videos
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "videos update own" ON public.videos
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "videos delete own" ON public.videos
  FOR DELETE USING (auth.uid() = user_id);

-- Comments: authenticated can read; authors write/delete their own
CREATE POLICY "video_comments read (authenticated)" ON public.video_comments
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "video_comments insert own" ON public.video_comments
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "video_comments delete own" ON public.video_comments
  FOR DELETE USING (auth.uid() = user_id);

-- Likes: authenticated can read; owners write/delete
CREATE POLICY "video_likes read (authenticated)" ON public.video_likes
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "video_likes insert own" ON public.video_likes
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "video_likes delete own" ON public.video_likes
  FOR DELETE USING (auth.uid() = user_id);

-- Views: authenticated can read and insert (no delete needed)
CREATE POLICY "video_views read (authenticated)" ON public.video_views
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "video_views insert (authenticated)" ON public.video_views
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');
