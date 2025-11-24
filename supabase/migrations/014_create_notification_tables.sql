-- Push notification tokens and user preferences

CREATE TABLE IF NOT EXISTS public.notification_tokens (
  token TEXT PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  platform TEXT,
  device_id TEXT,
  app_version TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS notification_tokens_user_device_idx
  ON public.notification_tokens(user_id, device_id)
  WHERE device_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.notification_preferences (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  comments BOOLEAN NOT NULL DEFAULT TRUE,
  likes BOOLEAN NOT NULL DEFAULT TRUE,
  reminders BOOLEAN NOT NULL DEFAULT TRUE,
  quiet_hours TSTZRANGE,
  timezone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.notification_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

-- Policies for tokens (owners only)
CREATE POLICY "notification_tokens select own" ON public.notification_tokens
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "notification_tokens insert own" ON public.notification_tokens
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "notification_tokens update own" ON public.notification_tokens
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "notification_tokens delete own" ON public.notification_tokens
  FOR DELETE USING (auth.uid() = user_id);

-- Policies for preferences (owners only)
CREATE POLICY "notification_preferences select own" ON public.notification_preferences
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "notification_preferences insert own" ON public.notification_preferences
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "notification_preferences update own" ON public.notification_preferences
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "notification_preferences delete own" ON public.notification_preferences
  FOR DELETE USING (auth.uid() = user_id);

-- Keep updated_at fresh
DROP TRIGGER IF EXISTS update_notification_tokens_updated_at ON public.notification_tokens;
CREATE TRIGGER update_notification_tokens_updated_at
  BEFORE UPDATE ON public.notification_tokens
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_notification_preferences_updated_at ON public.notification_preferences;
CREATE TRIGGER update_notification_preferences_updated_at
  BEFORE UPDATE ON public.notification_preferences
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
