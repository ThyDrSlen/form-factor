DROP POLICY IF EXISTS "profiles public read" ON public.profiles;

CREATE POLICY "profiles public read"
  ON public.profiles
  FOR SELECT
  TO anon
  USING (is_private = FALSE);

CREATE OR REPLACE FUNCTION public.get_public_profile_page(profile_username TEXT)
RETURNS TABLE (
  username TEXT,
  display_name TEXT,
  avatar_url TEXT,
  bio TEXT,
  is_private BOOLEAN,
  created_at TIMESTAMPTZ,
  workout_count BIGINT,
  follower_count BIGINT,
  following_count BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_profile public.profiles%ROWTYPE;
BEGIN
  SELECT p.*
  INTO target_profile
  FROM public.profiles p
  WHERE p.username = LOWER(BTRIM(profile_username));

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF auth.uid() IS NOT NULL AND public.is_blocked_between(auth.uid(), target_profile.user_id) THEN
    RETURN;
  END IF;

  IF target_profile.is_private THEN
    RETURN QUERY
    SELECT
      target_profile.username,
      NULL::TEXT,
      NULL::TEXT,
      NULL::TEXT,
      TRUE,
      NULL::TIMESTAMPTZ,
      NULL::BIGINT,
      NULL::BIGINT,
      NULL::BIGINT;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    target_profile.username,
    target_profile.display_name,
    target_profile.avatar_url,
    target_profile.bio,
    FALSE,
    target_profile.created_at,
    (SELECT COUNT(*)::BIGINT FROM public.workout_sessions ws WHERE ws.user_id = target_profile.user_id),
    (
      SELECT COUNT(*)::BIGINT
      FROM public.follows f
      WHERE f.following_id = target_profile.user_id
        AND f.status = 'accepted'
    ),
    (
      SELECT COUNT(*)::BIGINT
      FROM public.follows f
      WHERE f.follower_id = target_profile.user_id
        AND f.status = 'accepted'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_profile_page(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_profile_page(TEXT) TO anon, authenticated, service_role;
