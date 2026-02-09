-- Social foundation: profiles, profile bootstrap trigger, avatars bucket, and profile visibility helpers

CREATE TABLE IF NOT EXISTS public.profiles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  bio TEXT,
  is_private BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_unique_idx
  ON public.profiles (LOWER(username));

CREATE INDEX IF NOT EXISTS profiles_display_name_idx
  ON public.profiles (display_name);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'profiles_username_format_check'
      AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_username_format_check
      CHECK (username ~ '^[A-Za-z0-9_]{3,20}$');
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.generate_profile_username(user_uuid UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  base_username TEXT := 'user_' || SUBSTRING(REPLACE(user_uuid::TEXT, '-', '') FROM 1 FOR 8);
  candidate_username TEXT := base_username;
  suffix INTEGER := 0;
BEGIN
  LOOP
    EXIT WHEN NOT EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE LOWER(p.username) = LOWER(candidate_username)
    );

    suffix := suffix + 1;
    candidate_username := base_username || suffix::TEXT;
  END LOOP;

  RETURN candidate_username;
END;
$$;

CREATE OR REPLACE FUNCTION public.normalize_profile_username()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.username := LOWER(BTRIM(NEW.username));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS normalize_profile_username ON public.profiles;
CREATE TRIGGER normalize_profile_username
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.normalize_profile_username();

DROP TRIGGER IF EXISTS update_profiles_updated_at ON public.profiles;
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE FUNCTION public.is_blocked_between(user_a UUID, user_b UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  blocked BOOLEAN := FALSE;
BEGIN
  IF user_a IS NULL OR user_b IS NULL OR user_a = user_b THEN
    RETURN FALSE;
  END IF;

  IF to_regclass('public.blocks') IS NULL THEN
    RETURN FALSE;
  END IF;

  EXECUTE $q$
    SELECT EXISTS (
      SELECT 1
      FROM public.blocks b
      WHERE (b.blocker_id = $1 AND b.blocked_id = $2)
         OR (b.blocker_id = $2 AND b.blocked_id = $1)
    )
  $q$
    INTO blocked
    USING user_a, user_b;

  RETURN COALESCE(blocked, FALSE);
END;
$$;

CREATE OR REPLACE FUNCTION public.has_accepted_follow(follower_user_id UUID, following_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  has_follow BOOLEAN := FALSE;
BEGIN
  IF follower_user_id IS NULL OR following_user_id IS NULL THEN
    RETURN FALSE;
  END IF;

  IF to_regclass('public.follows') IS NULL THEN
    RETURN FALSE;
  END IF;

  EXECUTE $q$
    SELECT EXISTS (
      SELECT 1
      FROM public.follows f
      WHERE f.follower_id = $1
        AND f.following_id = $2
        AND f.status = 'accepted'
    )
  $q$
    INTO has_follow
    USING follower_user_id, following_user_id;

  RETURN COALESCE(has_follow, FALSE);
END;
$$;

CREATE OR REPLACE FUNCTION public.are_mutual_followers(user_a UUID, user_b UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_accepted_follow(user_a, user_b)
    AND public.has_accepted_follow(user_b, user_a)
$$;

CREATE OR REPLACE FUNCTION public.is_profile_private(target_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  profile_private BOOLEAN := TRUE;
BEGIN
  SELECT p.is_private
  INTO profile_private
  FROM public.profiles p
  WHERE p.user_id = target_user_id;

  RETURN COALESCE(profile_private, TRUE);
END;
$$;

CREATE OR REPLACE FUNCTION public.can_view_user_content(target_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  viewer_id UUID := auth.uid();
  target_is_private BOOLEAN;
BEGIN
  IF viewer_id IS NULL OR target_user_id IS NULL THEN
    RETURN FALSE;
  END IF;

  IF viewer_id = target_user_id THEN
    RETURN TRUE;
  END IF;

  IF public.is_blocked_between(viewer_id, target_user_id) THEN
    RETURN FALSE;
  END IF;

  SELECT p.is_private
  INTO target_is_private
  FROM public.profiles p
  WHERE p.user_id = target_user_id;

  IF target_is_private IS NULL THEN
    RETURN FALSE;
  END IF;

  IF target_is_private = FALSE THEN
    RETURN TRUE;
  END IF;

  RETURN public.has_accepted_follow(viewer_id, target_user_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.can_user_view_user_content(viewer_user_id UUID, target_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_is_private BOOLEAN;
BEGIN
  IF viewer_user_id IS NULL OR target_user_id IS NULL THEN
    RETURN FALSE;
  END IF;

  IF viewer_user_id = target_user_id THEN
    RETURN TRUE;
  END IF;

  IF public.is_blocked_between(viewer_user_id, target_user_id) THEN
    RETURN FALSE;
  END IF;

  SELECT p.is_private
  INTO target_is_private
  FROM public.profiles p
  WHERE p.user_id = target_user_id;

  IF target_is_private IS NULL THEN
    RETURN FALSE;
  END IF;

  IF target_is_private = FALSE THEN
    RETURN TRUE;
  END IF;

  RETURN public.has_accepted_follow(viewer_user_id, target_user_id);
END;
$$;

REVOKE ALL ON FUNCTION public.is_blocked_between(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_accepted_follow(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.are_mutual_followers(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_profile_private(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_view_user_content(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_user_view_user_content(UUID, UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.is_blocked_between(UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_accepted_follow(UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.are_mutual_followers(UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_profile_private(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_view_user_content(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_user_view_user_content(UUID, UUID) TO authenticated, service_role;

DROP TRIGGER IF EXISTS on_auth_user_created_create_profile ON auth.users;

CREATE OR REPLACE FUNCTION public.handle_new_auth_user_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, username, display_name, avatar_url)
  VALUES (
    NEW.id,
    public.generate_profile_username(NEW.id),
    NULLIF(
      BTRIM(
        COALESCE(
          NEW.raw_user_meta_data ->> 'display_name',
          NEW.raw_user_meta_data ->> 'full_name',
          NEW.raw_user_meta_data ->> 'name'
        )
      ),
      ''
    ),
    NULLIF(
      COALESCE(
        NEW.raw_user_meta_data ->> 'avatar_url',
        NEW.raw_user_meta_data ->> 'picture'
      ),
      ''
    )
  )
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created_create_profile
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user_profile();

INSERT INTO public.profiles (user_id, username, display_name, avatar_url)
SELECT
  u.id,
  public.generate_profile_username(u.id),
  NULLIF(
    BTRIM(
      COALESCE(
        u.raw_user_meta_data ->> 'display_name',
        u.raw_user_meta_data ->> 'full_name',
        u.raw_user_meta_data ->> 'name'
      )
    ),
    ''
  ) AS display_name,
  NULLIF(
    COALESCE(
      u.raw_user_meta_data ->> 'avatar_url',
      u.raw_user_meta_data ->> 'picture'
    ),
    ''
  ) AS avatar_url
FROM auth.users u
ON CONFLICT (user_id) DO UPDATE
SET
  display_name = COALESCE(public.profiles.display_name, EXCLUDED.display_name),
  avatar_url = COALESCE(public.profiles.avatar_url, EXCLUDED.avatar_url);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles select visible" ON public.profiles;
DROP POLICY IF EXISTS "profiles insert own" ON public.profiles;
DROP POLICY IF EXISTS "profiles update own" ON public.profiles;
DROP POLICY IF EXISTS "profiles delete own" ON public.profiles;

CREATE POLICY "profiles select visible"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (public.can_view_user_content(user_id));

CREATE POLICY "profiles insert own"
  ON public.profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "profiles update own"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "profiles delete own"
  ON public.profiles
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', TRUE)
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public;

DROP POLICY IF EXISTS "avatars bucket - public can read" ON storage.objects;
DROP POLICY IF EXISTS "avatars bucket - owners can upload" ON storage.objects;
DROP POLICY IF EXISTS "avatars bucket - owners can update" ON storage.objects;
DROP POLICY IF EXISTS "avatars bucket - owners can delete" ON storage.objects;

CREATE POLICY "avatars bucket - public can read"
  ON storage.objects
  FOR SELECT
  TO public
  USING (bucket_id = 'avatars');

CREATE POLICY "avatars bucket - owners can upload"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'avatars' AND owner = auth.uid());

CREATE POLICY "avatars bucket - owners can update"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (bucket_id = 'avatars' AND owner = auth.uid())
  WITH CHECK (bucket_id = 'avatars' AND owner = auth.uid());

CREATE POLICY "avatars bucket - owners can delete"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (bucket_id = 'avatars' AND owner = auth.uid());
