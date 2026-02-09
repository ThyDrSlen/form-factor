-- Social visibility hardening for videos, child engagement tables, and storage access

DROP POLICY IF EXISTS "videos read (authenticated)" ON public.videos;
DROP POLICY IF EXISTS "videos select visible via social graph" ON public.videos;

CREATE POLICY "videos select visible via social graph"
  ON public.videos
  FOR SELECT
  TO authenticated
  USING (public.can_view_user_content(user_id));

DROP POLICY IF EXISTS "video_comments read (authenticated)" ON public.video_comments;
DROP POLICY IF EXISTS "video_comments select visible parent" ON public.video_comments;

CREATE POLICY "video_comments select visible parent"
  ON public.video_comments
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.videos v
      WHERE v.id = video_id
        AND public.can_view_user_content(v.user_id)
    )
  );

DROP POLICY IF EXISTS "video_likes read (authenticated)" ON public.video_likes;
DROP POLICY IF EXISTS "video_likes select visible parent" ON public.video_likes;

CREATE POLICY "video_likes select visible parent"
  ON public.video_likes
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.videos v
      WHERE v.id = video_id
        AND public.can_view_user_content(v.user_id)
    )
  );

DROP POLICY IF EXISTS "video_views read (authenticated)" ON public.video_views;
DROP POLICY IF EXISTS "video_views select visible parent" ON public.video_views;

CREATE POLICY "video_views select visible parent"
  ON public.video_views
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.videos v
      WHERE v.id = video_id
        AND public.can_view_user_content(v.user_id)
    )
  );

DROP POLICY IF EXISTS "videos bucket - owners can read" ON storage.objects;
DROP POLICY IF EXISTS "videos bucket - authenticated can read" ON storage.objects;
DROP POLICY IF EXISTS "videos bucket - owner or social graph can read" ON storage.objects;

CREATE POLICY "videos bucket - owner or social graph can read"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'videos'
    AND (
      owner = auth.uid()
      OR (owner IS NOT NULL AND public.can_view_user_content(owner))
    )
  );
