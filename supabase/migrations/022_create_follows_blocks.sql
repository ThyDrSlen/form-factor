-- Social graph: follows/blocks, block side effects, RLS, and realtime for follow requests

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'follow_status'
      AND n.nspname = 'public'
  ) THEN
    CREATE TYPE public.follow_status AS ENUM ('pending', 'accepted');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.follows (
  follower_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  following_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status public.follow_status NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (follower_id, following_id),
  CONSTRAINT follows_no_self_follow CHECK (follower_id <> following_id)
);

CREATE TABLE IF NOT EXISTS public.blocks (
  blocker_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  blocked_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (blocker_id, blocked_id),
  CONSTRAINT blocks_no_self_block CHECK (blocker_id <> blocked_id)
);

CREATE INDEX IF NOT EXISTS follows_follower_accepted_idx
  ON public.follows (follower_id, following_id)
  WHERE status = 'accepted';

CREATE INDEX IF NOT EXISTS follows_following_pending_idx
  ON public.follows (following_id, created_at DESC)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS follows_following_accepted_idx
  ON public.follows (following_id, created_at DESC)
  WHERE status = 'accepted';

CREATE INDEX IF NOT EXISTS blocks_blocked_idx
  ON public.blocks (blocked_id);

DROP TRIGGER IF EXISTS update_follows_updated_at ON public.follows;
CREATE TRIGGER update_follows_updated_at
  BEFORE UPDATE ON public.follows
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE FUNCTION public.prevent_follow_identity_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.follower_id <> OLD.follower_id OR NEW.following_id <> OLD.following_id THEN
    RAISE EXCEPTION 'Cannot change follower_id/following_id on follows rows';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_follow_identity_change ON public.follows;
CREATE TRIGGER prevent_follow_identity_change
  BEFORE UPDATE ON public.follows
  FOR EACH ROW EXECUTE FUNCTION public.prevent_follow_identity_change();

CREATE OR REPLACE FUNCTION public.remove_follows_on_block()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.follows f
  WHERE (f.follower_id = NEW.blocker_id AND f.following_id = NEW.blocked_id)
     OR (f.follower_id = NEW.blocked_id AND f.following_id = NEW.blocker_id);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_block_remove_follows ON public.blocks;
CREATE TRIGGER on_block_remove_follows
  AFTER INSERT ON public.blocks
  FOR EACH ROW EXECUTE FUNCTION public.remove_follows_on_block();

ALTER TABLE public.follows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blocks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "follows read own relationships" ON public.follows;
DROP POLICY IF EXISTS "follows insert own as follower" ON public.follows;
DROP POLICY IF EXISTS "follows update by followee" ON public.follows;
DROP POLICY IF EXISTS "follows delete if participant" ON public.follows;

CREATE POLICY "follows read own relationships"
  ON public.follows
  FOR SELECT
  TO authenticated
  USING (auth.uid() = follower_id OR auth.uid() = following_id);

CREATE POLICY "follows insert own as follower"
  ON public.follows
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = follower_id
    AND follower_id <> following_id
    AND NOT public.is_blocked_between(follower_id, following_id)
    AND (
      status = 'pending'
      OR (
        status = 'accepted'
        AND NOT public.is_profile_private(following_id)
      )
    )
  );

CREATE POLICY "follows update by followee"
  ON public.follows
  FOR UPDATE
  TO authenticated
  USING (
    auth.uid() = following_id
    AND status = 'pending'
  )
  WITH CHECK (
    auth.uid() = following_id
    AND status = 'accepted'
    AND NOT public.is_blocked_between(follower_id, following_id)
  );

CREATE POLICY "follows delete if participant"
  ON public.follows
  FOR DELETE
  TO authenticated
  USING (auth.uid() = follower_id OR auth.uid() = following_id);

DROP POLICY IF EXISTS "blocks select own" ON public.blocks;
DROP POLICY IF EXISTS "blocks insert own" ON public.blocks;
DROP POLICY IF EXISTS "blocks update own" ON public.blocks;
DROP POLICY IF EXISTS "blocks delete own" ON public.blocks;

CREATE POLICY "blocks select own"
  ON public.blocks
  FOR SELECT
  TO authenticated
  USING (auth.uid() = blocker_id);

CREATE POLICY "blocks insert own"
  ON public.blocks
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = blocker_id);

CREATE POLICY "blocks update own"
  ON public.blocks
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = blocker_id)
  WITH CHECK (auth.uid() = blocker_id);

CREATE POLICY "blocks delete own"
  ON public.blocks
  FOR DELETE
  TO authenticated
  USING (auth.uid() = blocker_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'follows'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.follows;
  END IF;
END
$$;
