-- Video sharing: direct share inbox/outbox, thread replies, preferences, and realtime

CREATE TABLE IF NOT EXISTS public.video_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id UUID NOT NULL REFERENCES public.videos(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  message TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT video_shares_no_self_share CHECK (sender_id <> recipient_id)
);

CREATE TABLE IF NOT EXISTS public.share_replies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  share_id UUID NOT NULL REFERENCES public.video_shares(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION public.restrict_video_share_updates()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id <> OLD.id
     OR NEW.video_id <> OLD.video_id
     OR NEW.sender_id <> OLD.sender_id
     OR NEW.recipient_id <> OLD.recipient_id
     OR NEW.message IS DISTINCT FROM OLD.message
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'Only read_at can be updated on video_shares';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS restrict_video_share_updates ON public.video_shares;
CREATE TRIGGER restrict_video_share_updates
  BEFORE UPDATE ON public.video_shares
  FOR EACH ROW EXECUTE FUNCTION public.restrict_video_share_updates();

CREATE INDEX IF NOT EXISTS video_shares_recipient_created_idx
  ON public.video_shares (recipient_id, created_at DESC);

CREATE INDEX IF NOT EXISTS video_shares_sender_created_idx
  ON public.video_shares (sender_id, created_at DESC);

CREATE INDEX IF NOT EXISTS video_shares_unread_idx
  ON public.video_shares (recipient_id, created_at DESC)
  WHERE read_at IS NULL;

CREATE INDEX IF NOT EXISTS share_replies_share_created_idx
  ON public.share_replies (share_id, created_at ASC);

ALTER TABLE public.video_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.share_replies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "video_shares select participants" ON public.video_shares;
DROP POLICY IF EXISTS "video_shares insert mutual and unblocked" ON public.video_shares;
DROP POLICY IF EXISTS "video_shares update recipient" ON public.video_shares;
DROP POLICY IF EXISTS "video_shares delete participants" ON public.video_shares;

CREATE POLICY "video_shares select participants"
  ON public.video_shares
  FOR SELECT
  TO authenticated
  USING (auth.uid() = sender_id OR auth.uid() = recipient_id);

CREATE POLICY "video_shares insert mutual and unblocked"
  ON public.video_shares
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = sender_id
    AND sender_id <> recipient_id
    AND public.are_mutual_followers(sender_id, recipient_id)
    AND NOT public.is_blocked_between(sender_id, recipient_id)
    AND EXISTS (
      SELECT 1
      FROM public.videos v
      WHERE v.id = video_id
        AND public.can_view_user_content(v.user_id)
        AND public.can_user_view_user_content(recipient_id, v.user_id)
    )
  );

CREATE POLICY "video_shares update recipient"
  ON public.video_shares
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = recipient_id)
  WITH CHECK (auth.uid() = recipient_id);

CREATE POLICY "video_shares delete participants"
  ON public.video_shares
  FOR DELETE
  TO authenticated
  USING (auth.uid() = sender_id OR auth.uid() = recipient_id);

DROP POLICY IF EXISTS "share_replies select participants" ON public.share_replies;
DROP POLICY IF EXISTS "share_replies insert participants" ON public.share_replies;
DROP POLICY IF EXISTS "share_replies delete own" ON public.share_replies;

CREATE POLICY "share_replies select participants"
  ON public.share_replies
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.video_shares vs
      WHERE vs.id = share_id
        AND (auth.uid() = vs.sender_id OR auth.uid() = vs.recipient_id)
    )
  );

CREATE POLICY "share_replies insert participants"
  ON public.share_replies
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1
      FROM public.video_shares vs
      WHERE vs.id = share_id
        AND (auth.uid() = vs.sender_id OR auth.uid() = vs.recipient_id)
    )
  );

CREATE POLICY "share_replies delete own"
  ON public.share_replies
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS follow_requests BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS new_followers BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS video_shares BOOLEAN NOT NULL DEFAULT TRUE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'video_shares'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.video_shares;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'share_replies'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.share_replies;
  END IF;
END
$$;
